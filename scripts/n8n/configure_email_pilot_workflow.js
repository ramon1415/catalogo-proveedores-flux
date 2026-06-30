#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const EXPECTED_CONFIRM = 'n8n-dev';
const EXPECTED_TEST_CONFIRM = 'TEST_ONLY';
const EXPECTED_WORKFLOW_NAME = 'Flux DEV - Notification Dispatcher EMAIL PILOT';
const EXPECTED_SUPABASE_DEV_URL = 'https://scsirgbuqjcwoaxfacth.supabase.co';
const WORKSPACE = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const EVIDENCE_DIR = path.resolve(WORKSPACE, process.env.OPS_EVIDENCE_DIR || '.ops-evidence/n8n-email-pilot-dev');
const STARTED_AT = new Date();
const ALLOWED_EVENT_TYPES = [
  'payment_request.created',
  'payment_request.approved',
  'payment_request.rejected',
  'payment_request.changes_requested',
  'payment_request.exception_approved',
  'payment_request.exception_rejected'
];

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

function sensitiveValues() {
  return [
    process.env.N8N_DEV_API_URL,
    process.env.N8N_DEV_API_KEY,
    process.env.FLUX_DEV_SUPABASE_URL,
    process.env.FLUX_DEV_SUPABASE_ANON_KEY,
    process.env.FLUX_DEV_DISPATCHER_EMAIL,
    process.env.FLUX_DEV_DISPATCHER_PASSWORD,
    process.env.FLUX_DEV_EMAIL_FROM,
    process.env.FLUX_DEV_TEST_RECIPIENT_EMAIL,
    process.env.FLUX_DEV_MIN_CREATED_AT,
    process.env.N8N_DEV_EMAIL_CREDENTIAL_ID,
    process.env.N8N_DEV_EMAIL_CREDENTIAL_TYPE
  ].filter((item) => item && String(item).length >= 4);
}

function redact(value) {
  let output = String(value || '');
  for (const secret of sensitiveValues()) {
    output = output.split(secret).join('***REDACTED***');
  }
  output = output.replace(/(api[_-]?key|authorization|bearer|password|secret|token|credential)(\s*[:=]\s*)([^\s,'"}]+)/gi, '$1$2***REDACTED***');
  return output;
}

function writeSummary(payload) {
  ensureDir(EVIDENCE_DIR);
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'summary-email-pilot-config-' + timestamp() + '.json'), JSON.stringify(payload, null, 2));
}

function fail(message, details) {
  writeSummary({
    ok: false,
    message,
    details: details || null,
    finishedAt: new Date().toISOString()
  });
  console.error('::error::' + message);
  process.exit(1);
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    fail(name + ' is required.');
  }
  return String(value).trim();
}

function normalizeUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function assertNoPrivilegedKeySignal(value, name) {
  const normalized = String(value || '').toLowerCase().replace(/[^a-z]/g, '');
  if (normalized.includes('servicerole')) {
    fail(name + ' appears to contain a privileged database key. Use the DEV anon key only.');
  }
}

function assertRequiredEnv() {
  if (process.env.CONFIRM_DEV !== EXPECTED_CONFIRM) {
    fail('CONFIRM_DEV must be exactly n8n-dev.');
  }
  if (process.env.CONFIRM_TEST_ONLY !== EXPECTED_TEST_CONFIRM) {
    fail('CONFIRM_TEST_ONLY must be exactly TEST_ONLY.');
  }

  requiredEnv('N8N_DEV_API_URL');
  requiredEnv('N8N_DEV_API_KEY');
  const supabaseUrl = requiredEnv('FLUX_DEV_SUPABASE_URL');
  const anonKey = requiredEnv('FLUX_DEV_SUPABASE_ANON_KEY');
  requiredEnv('FLUX_DEV_DISPATCHER_EMAIL');
  requiredEnv('FLUX_DEV_DISPATCHER_PASSWORD');
  requiredEnv('FLUX_DEV_EMAIL_FROM');
  requiredEnv('FLUX_DEV_TEST_RECIPIENT_EMAIL');

  if (normalizeUrl(supabaseUrl) !== EXPECTED_SUPABASE_DEV_URL) {
    fail('FLUX_DEV_SUPABASE_URL must point to the approved Supabase DEV host.');
  }
  assertNoPrivilegedKeySignal(anonKey, 'FLUX_DEV_SUPABASE_ANON_KEY');

  if (!requiredEnv('FLUX_DEV_TEST_RECIPIENT_EMAIL').includes('@')) {
    fail('FLUX_DEV_TEST_RECIPIENT_EMAIL must look like an email address.');
  }
  if (!requiredEnv('FLUX_DEV_EMAIL_FROM').includes('@')) {
    fail('FLUX_DEV_EMAIL_FROM must look like an email address.');
  }

  const credentialId = process.env.N8N_DEV_EMAIL_CREDENTIAL_ID || '';
  const credentialType = process.env.N8N_DEV_EMAIL_CREDENTIAL_TYPE || '';
  if ((credentialId && !credentialType) || (!credentialId && credentialType)) {
    fail('N8N_DEV_EMAIL_CREDENTIAL_ID and N8N_DEV_EMAIL_CREDENTIAL_TYPE must be provided together or omitted together.');
  }
}

function assertNoProdSignals(urlObject, label) {
  const signals = [
    urlObject.hostname,
    urlObject.pathname,
    process.env.N8N_ENV || '',
    process.env.FLUX_ENV || ''
  ].join(' ').toLowerCase();
  const normalizedSignals = signals.split('/').join('.').split('\\').join('.');
  if (/(^|[._-])(prod|production|main)([._-]|$)/.test(normalizedSignals)) {
    fail('A production/main signal was detected in ' + label + '. Aborting DEV configuration.');
  }
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
  assertNoProdSignals(parsed, 'N8N_DEV_API_URL');
  return parsed;
}

function endpoint(base, apiPath) {
  const cleanApiPath = apiPath.replace(/^\/api\/v1/, '').replace(/^\//, '');
  const basePath = base.pathname.replace(/\/+$/, '');
  const prefix = basePath.endsWith('/api/v1') ? basePath : basePath + '/api/v1';
  return new URL(prefix + '/' + cleanApiPath, base.origin);
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
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(target, options);
  const text = await response.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      parsed = { message: redact(text).slice(0, 500) };
    }
  }

  if (!response.ok) {
    const safeMessage = parsed && parsed.message ? redact(parsed.message) : null;
    fail('n8n API request failed: ' + method + ' ' + apiPath + ' returned ' + response.status + '.', { status: response.status, message: safeMessage });
  }
  return parsed || {};
}

function workflowFromResponse(response) {
  return response && response.data && typeof response.data === 'object' ? response.data : response;
}

function getVerifiedActive(response, workflowId, action) {
  const workflow = workflowFromResponse(response);
  if (workflow && typeof workflow.active === 'boolean') return workflow.active;
  fail('n8n API verification response did not include active status after ' + action + '.', { workflowId });
}

function assertWorkflowName(workflow) {
  if (!workflow || workflow.name !== EXPECTED_WORKFLOW_NAME) {
    fail('Unexpected workflow name. Refusing to configure workflow.', { expected: EXPECTED_WORKFLOW_NAME, actual: workflow && workflow.name ? workflow.name : null });
  }
}

function findNode(workflow, name) {
  if (!Array.isArray(workflow.nodes)) {
    fail('n8n workflow response does not include nodes.');
  }
  const matches = workflow.nodes.filter((node) => node && node.name === name);
  if (matches.length !== 1) {
    fail('Expected exactly one node named ' + name + '.', { count: matches.length });
  }
  return matches[0];
}

function jsLiteral(value) {
  return JSON.stringify(String(value));
}

function buildSetConfigJsCode() {
  const minCreatedAt = process.env.FLUX_DEV_MIN_CREATED_AT && process.env.FLUX_DEV_MIN_CREATED_AT.trim()
    ? process.env.FLUX_DEV_MIN_CREATED_AT.trim()
    : new Date(Date.now() - 60 * 60 * 1000).toISOString();

  return [
    'return [{',
    '  json: {',
    '    FLUX_DEV_SUPABASE_URL: ' + jsLiteral(normalizeUrl(process.env.FLUX_DEV_SUPABASE_URL)) + ',',
    '    FLUX_DEV_SUPABASE_ANON_KEY: ' + jsLiteral(process.env.FLUX_DEV_SUPABASE_ANON_KEY) + ',',
    '    FLUX_DEV_DISPATCHER_EMAIL: ' + jsLiteral(process.env.FLUX_DEV_DISPATCHER_EMAIL) + ',',
    '    FLUX_DEV_DISPATCHER_PASSWORD: ' + jsLiteral(process.env.FLUX_DEV_DISPATCHER_PASSWORD) + ',',
    '    FLUX_DEV_MIN_CREATED_AT: ' + jsLiteral(minCreatedAt) + ',',
    "    FLUX_DEV_WORKER_ID: 'n8n-dev-dispatcher-email-pilot',",
    '    EMAIL_FROM: ' + jsLiteral(process.env.FLUX_DEV_EMAIL_FROM) + ',',
    '    EMAIL_PILOT_MODE: true,',
    '    SEND_TO_TEST_EMAIL_ONLY: true,',
    '    TEST_RECIPIENT_EMAIL: ' + jsLiteral(process.env.FLUX_DEV_TEST_RECIPIENT_EMAIL) + ',',
    '    SEND_TO_REAL_RECIPIENT: false,',
    '    MAX_EVENTS_PER_RUN: 1,',
    '    allowed_event_types: [',
    ALLOWED_EVENT_TYPES.map((eventType) => "      '" + eventType + "'").join(',\n'),
    '    ]',
    '  }',
    '}];'
  ].join('\n');
}

function shouldEnableEmailNode() {
  const value = String(process.env.ENABLE_EMAIL_NODE || 'false').trim().toLowerCase();
  if (value !== 'true' && value !== 'false') {
    fail('ENABLE_EMAIL_NODE must be true or false.');
  }
  return value === 'true';
}

function configureEmailNode(emailNode, enableEmailNode) {
  if (enableEmailNode) {
    if (process.env.CONFIRM_TEST_ONLY !== EXPECTED_TEST_CONFIRM) {
      fail('Email node can only be enabled with TEST_ONLY confirmation.');
    }
    if (!process.env.FLUX_DEV_TEST_RECIPIENT_EMAIL || !process.env.FLUX_DEV_TEST_RECIPIENT_EMAIL.includes('@')) {
      fail('Email node can only be enabled when TEST recipient email is present.');
    }
    emailNode.disabled = false;
  } else {
    emailNode.disabled = true;
  }

  const credentialId = process.env.N8N_DEV_EMAIL_CREDENTIAL_ID || '';
  const credentialType = process.env.N8N_DEV_EMAIL_CREDENTIAL_TYPE || '';
  if (!credentialId && !credentialType) return false;

  emailNode.credentials = Object.assign({}, emailNode.credentials || {});
  emailNode.credentials[credentialType] = {
    id: credentialId,
    name: credentialId
  };
  return true;
}

function buildUpdatePayload(workflow) {
  return {
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections || {},
    settings: workflow.settings || {}
  };
}

async function main() {
  ensureDir(EVIDENCE_DIR);
  assertRequiredEnv();

  const workflowId = getArg('--workflow-id') || process.env.N8N_WORKFLOW_ID || '';
  if (!workflowId.trim()) {
    fail('workflow_id is required.');
  }

  const base = getApiBase();
  const enableEmailNode = shouldEnableEmailNode();

  console.log('n8n EMAIL PILOT DEV configuration starting.');
  console.log('Workflow id: ' + workflowId);
  console.log('Email node requested enabled: ' + String(enableEmailNode));

  const fetched = await apiRequest(base, 'GET', '/workflows/' + encodeURIComponent(workflowId));
  const workflow = workflowFromResponse(fetched);
  assertWorkflowName(workflow);

  const setConfigNode = findNode(workflow, 'Set Config');
  setConfigNode.parameters = Object.assign({}, setConfigNode.parameters || {}, {
    jsCode: buildSetConfigJsCode()
  });

  const emailNode = findNode(workflow, 'Email Send Pilot');
  const emailNodeCredentialsAttached = configureEmailNode(emailNode, enableEmailNode);

  const payload = buildUpdatePayload(workflow);
  if (Object.prototype.hasOwnProperty.call(payload, 'active')) {
    fail('Internal safety failure: update payload must not include active.');
  }

  await apiRequest(base, 'PUT', '/workflows/' + encodeURIComponent(workflowId), payload);
  await apiRequest(base, 'POST', '/workflows/' + encodeURIComponent(workflowId) + '/deactivate');
  const verified = await apiRequest(base, 'GET', '/workflows/' + encodeURIComponent(workflowId));
  const verifiedActive = getVerifiedActive(verified, workflowId, 'configuration deactivate');
  if (verifiedActive) {
    fail('Configured workflow is still active after deactivate call.', { workflowId });
  }

  writeSummary({
    ok: true,
    startedAt: STARTED_AT.toISOString(),
    finishedAt: new Date().toISOString(),
    workflow_id: workflowId,
    workflow_name: EXPECTED_WORKFLOW_NAME,
    set_config_updated: true,
    email_node_enabled: enableEmailNode,
    email_node_credentials_attached: emailNodeCredentialsAttached,
    send_to_test_email_only: true,
    send_to_real_recipient: false,
    active: false
  });

  console.log('::notice::n8n EMAIL PILOT DEV configured and left inactive. Workflow id: ' + workflowId);
}

main().catch((error) => {
  fail('Unexpected n8n EMAIL PILOT configuration failure.', { error: redact(error && error.stack ? error.stack : error) });
});
