#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const EXPECTED_CONFIRM = 'n8n-dev';
const WORKSPACE = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const EVIDENCE_DIR = path.resolve(WORKSPACE, process.env.OPS_EVIDENCE_DIR || '.ops-evidence/n8n-dev');
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

function redact(value) {
  let output = String(value || '');
  const secrets = [process.env.N8N_DEV_API_KEY, process.env.N8N_DEV_API_URL].filter((item) => item && item.length >= 4);
  for (const secret of secrets) {
    output = output.split(secret).join('***REDACTED***');
  }
  output = output.replace(/(api[_-]?key|authorization|bearer|password|secret|token)(\s*[:=]\s*)([^\s,'"}]+)/gi, '$1$2***REDACTED***');
  return output;
}

function writeSummary(payload) {
  ensureDir(EVIDENCE_DIR);
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'summary-update-' + timestamp() + '.json'), JSON.stringify(payload, null, 2));
}

function fail(message, details) {
  writeSummary({ ok: false, message, details: details || null, finishedAt: new Date().toISOString() });
  console.error('::error::' + message);
  process.exit(1);
}

function assertRequiredEnv() {
  if (process.env.CONFIRM_DEV !== EXPECTED_CONFIRM) fail('CONFIRM_DEV must be exactly n8n-dev.');
  if (!process.env.N8N_DEV_API_URL) fail('N8N_DEV_API_URL is required.');
  if (!process.env.N8N_DEV_API_KEY) fail('N8N_DEV_API_KEY is required.');
}

function getApiBase() {
  let parsed;
  try {
    parsed = new URL(process.env.N8N_DEV_API_URL);
  } catch (error) {
    fail('N8N_DEV_API_URL is not a valid URL.');
  }

  const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
  if (parsed.protocol !== 'https:' && !localHosts.has(parsed.hostname)) {
    fail('N8N_DEV_API_URL must use HTTPS unless it targets localhost.');
  }

  const signals = [parsed.hostname, parsed.pathname, process.env.N8N_ENV || '', process.env.FLUX_ENV || ''].join(' ').toLowerCase();
  const normalizedSignals = signals.split('/').join('.').split('\\').join('.');
  if (/(^|[._-])(prod|production|main)([._-]|$)/.test(normalizedSignals)) {
    fail('A PROD/main signal was detected in N8N_DEV_API_URL or environment. Aborting DEV update.');
  }
  return parsed;
}

function endpoint(base, apiPath) {
  const cleanApiPath = apiPath.replace(/^\/api\/v1/, '').replace(/^\//, '');
  const basePath = base.pathname.replace(/\/+$/, '');
  const prefix = basePath.endsWith('/api/v1') ? basePath : basePath + '/api/v1';
  return new URL(prefix + '/' + cleanApiPath, base.origin);
}

function resolveRepoPath(inputPath) {
  if (!inputPath || !inputPath.trim()) fail('workflow_json_path is required.');
  if (/^[a-z][a-z0-9+.-]*:/i.test(inputPath)) fail('workflow_json_path must be a repository path, not a URL.');
  if (path.isAbsolute(inputPath)) fail('workflow_json_path must be relative to the repository root.');
  const resolved = path.resolve(WORKSPACE, inputPath);
  if (!resolved.startsWith(WORKSPACE + path.sep) && resolved !== WORKSPACE) fail('workflow_json_path escapes the repository root.');
  if (!resolved.endsWith('.json')) fail('workflow_json_path must point to a .json file.');
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) fail('workflow_json_path does not exist: ' + inputPath);
  return resolved;
}

function detectSecretLikeValues(value, currentPath, findings) {
  if (!value || typeof value !== 'object') return;
  const riskyKeys = new Set([
    'apikey', 'api_key', 'access_token', 'accesstoken', 'refresh_token', 'refreshtoken',
    'password', 'passwd', 'client_secret', 'clientsecret', 'private_key', 'privatekey',
    'service_role', 'servicekey', 'secret', 'token'
  ]);
  for (const [key, child] of Object.entries(value)) {
    const nextPath = currentPath ? currentPath + '.' + key : key;
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (riskyKeys.has(normalizedKey) && typeof child === 'string' && child.trim()) {
      const allowedExpression = /^=\{\{\s*\$/.test(child.trim()) || /^\{\{\s*\$/.test(child.trim());
      if (!allowedExpression) findings.push(nextPath);
    }
    detectSecretLikeValues(child, nextPath, findings);
  }
}

function readWorkflow(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  if (/service[_-]?role/i.test(raw)) fail('Workflow JSON appears to contain a service role reference. Remove secrets before updating.');
  let workflow;
  try {
    workflow = JSON.parse(raw);
  } catch (error) {
    fail('Workflow JSON is not valid JSON.', { error: error.message });
  }
  const findings = [];
  detectSecretLikeValues(workflow, '', findings);
  if (findings.length > 0) {
    fail('Workflow JSON appears to contain secret-like values. Remove credentials from JSON and use n8n credentials instead.', { fields: findings.slice(0, 25) });
  }
  if (!Array.isArray(workflow.nodes)) fail('Workflow JSON must include a nodes array.');
  if (!workflow.connections || typeof workflow.connections !== 'object') workflow.connections = {};
  return workflow;
}

function shouldDisableNode(node) {
  const type = String(node.type || '').toLowerCase();
  const operation = JSON.stringify(node.parameters || {}).toLowerCase();
  if (type.includes('scheduletrigger') || type.endsWith('.cron') || type.includes('cron') || type.includes('interval')) return true;
  if (type.includes('emailsend')) return true;
  if ((type.includes('gmail') || type.includes('microsoftoutlook') || type.includes('smtp')) && operation.includes('send')) return true;
  return false;
}

function buildInactivePayload(workflow, fallbackName) {
  const disabledNodes = [];
  const nodes = workflow.nodes.map((node) => {
    const copy = Object.assign({}, node);
    if (shouldDisableNode(copy)) {
      copy.disabled = true;
      disabledNodes.push(copy.name || copy.id || copy.type || 'unnamed-node');
    }
    return copy;
  });
  const payload = {
    name: workflow.name || fallbackName,
    nodes,
    connections: workflow.connections || {},
    settings: workflow.settings || {},
    active: false
  };
  if (Array.isArray(workflow.tags) && workflow.tags.length > 0) payload.tags = workflow.tags;
  return { payload, disabledNodes };
}

async function apiRequest(base, method, apiPath, body) {
  const target = endpoint(base, apiPath);
  const options = {
    method,
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'X-N8N-API-KEY': process.env.N8N_DEV_API_KEY
    }
  };
  if (body !== undefined) options.body = JSON.stringify(body);
  const response = await fetch(target, options);
  const text = await response.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      parsed = { raw: redact(text).slice(0, 4000) };
    }
  }
  if (!response.ok) {
    fail('n8n API request failed: ' + method + ' ' + apiPath + ' returned ' + response.status + '.', { status: response.status, response: parsed });
  }
  return parsed || {};
}

async function main() {
  ensureDir(EVIDENCE_DIR);
  assertRequiredEnv();
  const workflowId = getArg('--workflow-id') || process.env.N8N_WORKFLOW_ID || '';
  if (!workflowId.trim()) fail('workflow id is required via --workflow-id or N8N_WORKFLOW_ID.');
  const workflowPathInput = getArg('--workflow-json-path') || process.env.WORKFLOW_JSON_PATH || '';
  const workflowPath = resolveRepoPath(workflowPathInput);
  const base = getApiBase();
  const workflow = readWorkflow(workflowPath);
  const fallbackName = path.basename(workflowPath, '.json') + ' DEV update';
  const { payload, disabledNodes } = buildInactivePayload(workflow, fallbackName);

  console.log('n8n DEV workflow update starting.');
  console.log('Workflow id: ' + workflowId);
  console.log('Workflow path: ' + path.relative(WORKSPACE, workflowPath));
  console.log('Workflow will be saved with active=false. Disabled nodes: ' + (disabledNodes.join(', ') || 'none'));

  await apiRequest(base, 'PUT', '/workflows/' + encodeURIComponent(workflowId), payload);
  await apiRequest(base, 'POST', '/workflows/' + encodeURIComponent(workflowId) + '/deactivate');
  const verified = await apiRequest(base, 'GET', '/workflows/' + encodeURIComponent(workflowId));
  const verifiedActive = Boolean(verified.active || (verified.data && verified.data.active));
  if (verifiedActive) fail('Updated workflow is still active after deactivate call.', { workflowId });

  writeSummary({
    ok: true,
    startedAt: STARTED_AT.toISOString(),
    finishedAt: new Date().toISOString(),
    workflowId,
    workflowName: payload.name,
    workflowJsonPath: path.relative(WORKSPACE, workflowPath),
    active: false,
    disabledNodes,
    apiHost: base.hostname
  });
  console.log('::notice::n8n DEV workflow updated and left inactive. Workflow id: ' + workflowId);
}

main().catch((error) => {
  fail('Unexpected n8n update failure.', { error: redact(error && error.stack ? error.stack : error) });
});
