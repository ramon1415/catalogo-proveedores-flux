import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const client = readFileSync(join(root, "comprobantes_batch.js"), "utf8");
const html = readFileSync(join(root, "comprobantes_batch.html"), "utf8");

function bracedBlock(source, openingBrace) {
  assert.equal(source[openingBrace], "{", "Expected an opening brace");
  let depth = 0;

  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) {
      return {
        start: openingBrace,
        end: index + 1,
        text: source.slice(openingBrace, index + 1),
      };
    }
  }

  assert.fail("Unterminated braced block");
}

function declaredFunction(name) {
  const declaration = new RegExp(
    `(?:async\\s+)?function\\s+${name}\\s*\\(`,
  ).exec(client);
  assert.ok(declaration, `Missing browser function ${name}`);
  const openingBrace = client.indexOf("{", declaration.index + declaration[0].length);
  return bracedBlock(client, openingBrace).text;
}

function catchClause(functionSource) {
  const clause = /\bcatch\s*\([^)]*\)\s*\{/.exec(functionSource);
  assert.ok(clause, "Expected a catch clause");
  const openingBrace = functionSource.indexOf("{", clause.index);
  return bracedBlock(functionSource, openingBrace).text;
}

function tryClause(functionSource) {
  const clause = /\btry\s*\{/.exec(functionSource);
  assert.ok(clause, "Expected a try clause");
  const openingBrace = functionSource.indexOf("{", clause.index);
  return bracedBlock(functionSource, openingBrace).text;
}

function firstMatchingWrite(source, patterns) {
  const matches = patterns
    .map((pattern) => pattern.exec(source))
    .filter(Boolean)
    .sort((left, right) => left.index - right.index);
  return matches[0] || null;
}

const acceptExtraction = declaredFunction("acceptExtraction");
const acceptTry = tryClause(acceptExtraction);
const acceptCatch = catchClause(acceptExtraction);
const renderOperation = declaredFunction("renderOperation");
const operationErrorNotice = declaredFunction("operationErrorNotice");
const operationWorkflow = declaredFunction("operationWorkflow");
const persistIndividualReceipt = declaredFunction("persistIndividualReceipt");
const operationContextIsCurrent = declaredFunction("operationContextIsCurrent");
const reconcileOperation = declaredFunction("reconcileOperation");
const refreshLinkPreview = declaredFunction("refreshLinkPreview");
const setBusy = declaredFunction("setBusy");

test("an accept error remains in the open operation instead of reloading the batch", () => {
  assert.doesNotMatch(
    acceptCatch,
    /\b(?:loadBatches|openBatch)\s*\(/,
    "The catch path must not reload/reopen the batch and reset the four-step workflow",
  );
  assert.doesNotMatch(
    acceptCatch,
    /operationDialog\.close\s*\(/,
    "The catch path must keep the operation modal open",
  );
  assert.match(
    acceptCatch,
    /state\.operationError\s*=\s*friendlyError\s*\(\s*error\s*\)/,
    "The failure must be retained in operation state, not only in a toast",
  );
  assert.match(
    acceptCatch,
    /renderOperation\s*\(/,
    "The retained failure must be rendered without reopening the batch",
  );
});

test("the retained accept error is rendered as a persistent operation alert", () => {
  const stateDeclaration = /const\s+state\s*=\s*\{/.exec(client);
  assert.ok(stateDeclaration, "Missing browser state");
  const stateOpeningBrace = client.indexOf("{", stateDeclaration.index);
  const stateSource = bracedBlock(client, stateOpeningBrace).text;

  assert.match(stateSource, /\boperationError\s*:\s*null\b/);
  assert.match(renderOperation, /operationErrorNotice\s*\(/);
  assert.match(operationErrorNotice, /state\.operationError/);
  assert.match(operationErrorNotice, /role=["']alert["']/);
  assert.match(operationErrorNotice, /escapeHtml\s*\(\s*state\.operationError\s*\)/);
});

test("the accepted operation id is stored in UI state before evidence persistence", () => {
  const acceptCall = acceptTry.indexOf("RPC.acceptExtraction");
  const acceptedId = acceptTry.indexOf("accepted.operation_id", acceptCall);
  const persistCall = acceptTry.search(/persistIndividualReceipt\s*\(\s*operationId\b/);
  const operationWrite = firstMatchingWrite(acceptTry, [
    /state\.operation\.bank_operation_id\s*=\s*(?:operationId|accepted\.operation_id)\b/,
    /Object\.assign\s*\(\s*state\.operation\s*,\s*\{[\s\S]{0,500}?bank_operation_id\s*:\s*(?:operationId|accepted\.operation_id)\b/,
    /state\.operation\s*=\s*\{[\s\S]{0,500}?bank_operation_id\s*:\s*(?:operationId|accepted\.operation_id)\b[\s\S]{0,500}?\}/,
  ]);

  assert.notEqual(acceptCall, -1, "Missing extraction accept RPC");
  assert.notEqual(acceptedId, -1, "Missing operation_id from accept response");
  assert.notEqual(persistCall, -1, "Missing evidence persistence call");
  assert.ok(operationWrite, "Accepted operation_id must be copied into state.operation");
  assert.ok(acceptedId < operationWrite.index, "State may only store the returned operation_id");
  assert.ok(
    operationWrite.index < persistCall,
    "operation_id must survive in state before evidence work can fail",
  );
});

test("shareable evidence is stored and rendered as active step 2 without closing the modal", () => {
  const persistence = /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+persistIndividualReceipt\s*\(\s*operationId\b[\s\S]{0,300}?\)/.exec(acceptTry);
  assert.ok(persistence, "The shareable evidence returned by persistence must not be discarded");
  const evidenceVariable = persistence[1];
  const afterPersistence = acceptTry.slice(persistence.index + persistence[0].length);
  const evidenceWrite = firstMatchingWrite(afterPersistence, [
    new RegExp(`state\\.linkPreview\\.evidence\\s*=\\s*${evidenceVariable}\\b`),
    new RegExp(`state\\.linkPreview\\s*=\\s*\\{[\\s\\S]{0,500}?\\bevidence\\s*:\\s*${evidenceVariable}\\b[\\s\\S]{0,500}?\\}`),
    ...(evidenceVariable === "evidence"
      ? [/state\.linkPreview\s*=\s*\{[\s\S]{0,500}?\bevidence\s*[,}][\s\S]{0,500}?\}/]
      : []),
  ]);
  assert.ok(evidenceWrite, "Shareable evidence must be copied into state.linkPreview.evidence");

  const renderAfterEvidence = afterPersistence.indexOf(
    "renderOperation()",
    evidenceWrite.index + evidenceWrite[0].length,
  );
  assert.notEqual(renderAfterEvidence, -1, "The operation must render immediately after evidence is stored");
  assert.doesNotMatch(acceptTry, /\b(?:loadBatches|openBatch)\s*\(/);
  assert.doesNotMatch(acceptTry, /operationDialog\.close\s*\(/);
  assert.match(
    persistIndividualReceipt,
    /evidence\.status\s*!==\s*["']shareable["'][\s\S]{0,100}?throw/,
    "Evidence persistence must return only a shareable record",
  );
  assert.match(operationWorkflow, /evidence\.status\s*===\s*["']shareable["']/);
  assert.match(
    operationWorkflow,
    /number:\s*["']2["'][\s\S]{0,300}?state:\s*searched\s*\?\s*["']done["']\s*:\s*receiptReady\s*\?\s*["']active["']/,
    "Step 2 must become active from the locally stored shareable evidence",
  );
});

test("a retry after partial evidence failure reuses the operation id instead of accepting again", () => {
  assert.match(
    acceptExtraction,
    /let\s+operationId\s*=\s*state\.operation\.bank_operation_id/,
  );
  const guard = /if\s*\(\s*!operationId\s*\)\s*\{/.exec(acceptTry);
  assert.ok(guard, "The accept RPC must be guarded by the existing operation_id");
  const guardOpeningBrace = acceptTry.indexOf("{", guard.index);
  const acceptGuard = bracedBlock(acceptTry, guardOpeningBrace);
  const persistCall = acceptTry.search(/persistIndividualReceipt\s*\(\s*operationId\b/);

  assert.match(acceptGuard.text, /RPC\.acceptExtraction/);
  assert.match(
    acceptGuard.text,
    /state\.operation(?:\.bank_operation_id\s*=|\s*=\s*\{[\s\S]*?bank_operation_id\s*:)/,
    "The guarded first accept must persist its operation_id for the next attempt",
  );
  assert.ok(
    persistCall > acceptGuard.end,
    "Evidence persistence must run after the guarded accept so a retry can skip that accept",
  );
  assert.doesNotMatch(
    acceptCatch,
    /state\.operation\s*=\s*null|state\.operation\.bank_operation_id\s*=\s*null/,
    "A partial failure must not discard the accepted operation_id",
  );
});

test("late async results are scoped to the same modal operation", () => {
  assert.match(client, /\boperationEpoch\s*:\s*0\b/);
  assert.match(client, /function\s+openOperation[\s\S]*?state\.operationEpoch\s*\+=\s*1/);
  assert.match(client, /operationDialog\.addEventListener\(\s*["']close["'][\s\S]*?state\.operationEpoch\s*\+=\s*1/);
  assert.match(acceptExtraction, /epoch:\s*state\.operationEpoch/);
  assert.match(acceptExtraction, /operationContextIsCurrent\s*\(\s*operationContext\s*\)/);
  assert.match(operationContextIsCurrent, /state\.operationEpoch\s*===\s*context\.epoch/);
  assert.match(operationContextIsCurrent, /currentExtractionId\s*===\s*context\.extractionId/);
  assert.match(operationContextIsCurrent, /dom\.operationDialog\.open/);
  assert.match(reconcileOperation, /operationContextIsCurrent\s*\(\s*context\s*\)/);
});

test("accept snapshots the reviewed page and invalidates an older preview", () => {
  assert.match(acceptExtraction, /receipt:\s*state\.individualReceipt/);
  assert.match(acceptExtraction, /evidence:\s*object\(state\.linkPreview\?\.evidence\)/);
  assert.match(acceptExtraction, /state\.previewRequest\s*\+=\s*1/);
  assert.match(
    acceptExtraction,
    /persistIndividualReceipt\s*\(\s*operationId\s*,\s*operationContext\.receipt\s*,\s*operationContext\.evidence/s,
  );
  assert.match(
    client,
    /function\s+persistIndividualReceipt\s*\([\s\S]{0,200}?receipt\s*=\s*state\.individualReceipt/,
  );
  assert.match(refreshLinkPreview, /const\s+epoch\s*=\s*state\.operationEpoch/);
  assert.match(refreshLinkPreview, /epoch\s*!==\s*state\.operationEpoch/);
});

test("background reconciliation cannot turn a successful accept into an error", () => {
  assert.doesNotMatch(acceptTry, /await\s+reconcileOperation\s*\(/);
  assert.match(acceptExtraction, /finally\s*\{[\s\S]*?void\s+reconcileOperation\s*\(\s*operationContext\s*,\s*operationId\s*\)/);
  assert.match(reconcileOperation, /catch\s*\([^)]*\)\s*\{/);
  assert.doesNotMatch(reconcileOperation, /operationLinkStatuses\s*\[[^\]]+\]\s*=\s*["']unreconciled["']/);
  assert.doesNotMatch(reconcileOperation, /\b(?:loadBatches|openBatch)\s*\(/);
});

test("the modal cannot be dismissed while its reviewed PDF is being committed", () => {
  assert.match(client, /operationDialog\.addEventListener\(\s*["']cancel["'][\s\S]*?state\.busy[\s\S]*?preventDefault\s*\(/);
  assert.match(setBusy, /dom\.closeOperationBtn\.disabled\s*=\s*busy/);
});

test("the deployed page cache-busts the corrected transition client", () => {
  assert.match(
    html,
    /comprobantes_batch\.js\?v=20260809-step-transition-hotfix/,
  );
});
