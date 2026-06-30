#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const EXPECTED_PROJECT_REF = process.env.EXPECTED_SUPABASE_DEV_PROJECT_REF || 'scsirgbuqjcwoaxfacth';
const WORKSPACE = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const EVIDENCE_DIR = path.resolve(WORKSPACE, process.env.OPS_EVIDENCE_DIR || '.ops-evidence/supabase-dev');
const STARTED_AT = new Date();

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return '';
  return process.argv[index + 1] || '';
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function fail(message, details) {
  ensureDir(EVIDENCE_DIR);
  const payload = {
    ok: false,
    message,
    details: details || null,
    finishedAt: new Date().toISOString()
  };
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'summary-' + timestamp() + '.json'), JSON.stringify(payload, null, 2));
  console.error('::error::' + message);
  process.exit(1);
}

function redact(value) {
  let output = String(value || '');
  const secrets = [
    process.env.SUPABASE_DEV_DB_URL,
    process.env.SUPABASE_DEV_PROJECT_REF,
    process.env.SUPABASE_DEV_ACCESS_TOKEN,
    process.env.PGPASSWORD
  ].filter((item) => item && item.length >= 4);

  for (const secret of secrets) {
    output = output.split(secret).join('***REDACTED***');
  }

  output = output.replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, 'postgres://***REDACTED***');
  output = output.replace(/(service_role|access_token|api[_-]?key|password|secret)(\s*[:=]\s*)([^\s,'"}]+)/gi, '$1$2***REDACTED***');
  return output;
}

function assertRequiredEnv() {
  if (process.env.CONFIRM_DEV !== EXPECTED_PROJECT_REF) {
    fail('CONFIRM_DEV must match the approved Supabase DEV project ref.');
  }
  if (!process.env.SUPABASE_DEV_DB_URL) {
    fail('SUPABASE_DEV_DB_URL is required.');
  }
  if (!process.env.SUPABASE_DEV_PROJECT_REF) {
    fail('SUPABASE_DEV_PROJECT_REF is required.');
  }
  if (process.env.SUPABASE_DEV_PROJECT_REF !== EXPECTED_PROJECT_REF) {
    fail('SUPABASE_DEV_PROJECT_REF does not match the approved DEV project ref.');
  }
}

function parseDbUrl() {
  try {
    return new URL(process.env.SUPABASE_DEV_DB_URL);
  } catch (error) {
    fail('SUPABASE_DEV_DB_URL is not a valid PostgreSQL connection URL.');
  }
}

function assertNoProdSignals(dbUrl, requestedPath) {
  const signals = [
    dbUrl.hostname,
    dbUrl.username,
    dbUrl.pathname,
    requestedPath,
    process.env.SUPABASE_ENV || '',
    process.env.FLUX_ENV || ''
  ].join(' ').toLowerCase();

  const normalizedSignals = signals.split('/').join('.').split('\\').join('.');
  if (/(^|[._-])(prod|production|main)([._-]|$)/.test(normalizedSignals)) {
    fail('A PROD/main signal was detected in the target host, env, database name or script path. Aborting DEV workflow.');
  }

  if (!['postgres:', 'postgresql:'].includes(dbUrl.protocol)) {
    fail('SUPABASE_DEV_DB_URL must use postgres:// or postgresql://.');
  }
}

function resolveRepoPath(inputPath) {
  if (!inputPath || !inputPath.trim()) {
    fail('script_path is required.');
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(inputPath)) {
    fail('script_path must be a repository path, not a URL.');
  }
  if (path.isAbsolute(inputPath)) {
    fail('script_path must be relative to the repository root.');
  }
  const resolved = path.resolve(WORKSPACE, inputPath);
  if (!resolved.startsWith(WORKSPACE + path.sep) && resolved !== WORKSPACE) {
    fail('script_path escapes the repository root.');
  }
  return resolved;
}

function assertSqlFile(filePath, phase) {
  if (!fs.existsSync(filePath)) {
    fail('Missing required ' + phase + ' SQL file: ' + path.relative(WORKSPACE, filePath));
  }
  if (!filePath.endsWith('.sql')) {
    fail('Only .sql files are allowed: ' + path.relative(WORKSPACE, filePath));
  }
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    fail('Expected a SQL file for ' + phase + ': ' + path.relative(WORKSPACE, filePath));
  }
}

function buildPlan(targetPath) {
  if (!fs.existsSync(targetPath)) {
    fail('script_path does not exist: ' + path.relative(WORKSPACE, targetPath));
  }

  const stat = fs.statSync(targetPath);
  const baseDir = stat.isDirectory() ? targetPath : path.dirname(targetPath);
  const loadFile = stat.isDirectory() ? path.join(baseDir, 'load.sql') : targetPath;
  const plan = [
    { phase: 'precheck', file: path.join(baseDir, 'precheck.sql') },
    { phase: 'load', file: loadFile },
    { phase: 'postcheck', file: path.join(baseDir, 'postcheck.sql') }
  ];

  for (const item of plan) {
    assertSqlFile(item.file, item.phase);
  }
  return plan;
}

function ensurePsql() {
  const result = spawnSync('psql', ['--version'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    fail('psql is required but was not available. Install postgresql-client before running this helper.');
  }
}

function runPhase(item, logFile) {
  const relativeFile = path.relative(WORKSPACE, item.file);
  const header = '\n===== ' + item.phase.toUpperCase() + ' :: ' + relativeFile + ' =====\n';
  fs.appendFileSync(logFile, header);
  console.log('::group::' + item.phase + ' SQL phase');
  console.log('Running ' + item.phase + ' from ' + relativeFile);

  const started = Date.now();
  const result = spawnSync('psql', [
    '--no-psqlrc',
    '--set', 'ON_ERROR_STOP=1',
    '--dbname', process.env.SUPABASE_DEV_DB_URL,
    '--file', item.file
  ], {
    encoding: 'utf8',
    env: Object.assign({}, process.env, { PSQL_HISTORY: '/dev/null' })
  });

  const rawOutput = (result.stdout || '') + (result.stderr || '');
  const safeOutput = redact(rawOutput);
  fs.appendFileSync(logFile, safeOutput + '\n');

  const stopToken = 'supabase_sql_' + item.phase + '_' + Date.now();
  console.log('::stop-commands::' + stopToken);
  if (safeOutput.trim()) {
    console.log(safeOutput.trim().slice(0, 12000));
  } else {
    console.log('(no SQL output)');
  }
  console.log('::' + stopToken + '::');
  console.log('::endgroup::');

  if (result.error) {
    fail('Failed to execute psql for ' + item.phase + '.', { phase: item.phase, error: result.error.message });
  }
  if (result.status !== 0) {
    fail('SQL phase failed: ' + item.phase + '.', { phase: item.phase, status: result.status, file: relativeFile });
  }

  return {
    phase: item.phase,
    file: relativeFile,
    status: result.status,
    durationMs: Date.now() - started
  };
}

function main() {
  ensureDir(EVIDENCE_DIR);
  assertRequiredEnv();
  const requestedPath = getArg('--script-path') || process.env.SCRIPT_PATH || '';
  const dbUrl = parseDbUrl();
  assertNoProdSignals(dbUrl, requestedPath);
  const targetPath = resolveRepoPath(requestedPath);
  const plan = buildPlan(targetPath);
  ensurePsql();

  const logFile = path.join(EVIDENCE_DIR, 'supabase-dev-sql-' + timestamp() + '.log');
  const phases = [];

  console.log('Supabase DEV SQL deployment starting.');
  console.log('Project ref: ' + EXPECTED_PROJECT_REF);
  console.log('SQL plan: ' + plan.map((item) => item.phase + '=' + path.relative(WORKSPACE, item.file)).join(', '));

  for (const item of plan) {
    phases.push(runPhase(item, logFile));
  }

  const summary = {
    ok: true,
    startedAt: STARTED_AT.toISOString(),
    finishedAt: new Date().toISOString(),
    projectRef: EXPECTED_PROJECT_REF,
    scriptPath: path.relative(WORKSPACE, targetPath),
    phases,
    evidenceLog: path.relative(WORKSPACE, logFile)
  };
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'summary-' + timestamp() + '.json'), JSON.stringify(summary, null, 2));
  console.log('::notice::Supabase DEV SQL deployment finished successfully. Evidence was saved as an artifact.');
}

main();
