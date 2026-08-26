import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  renderApprovalBatchSubmittedEmail,
  signQuickApprovalToken,
} from "../../supabase/functions/approval-batch-submitted-dispatcher/index.ts";
import { handleRequest } from "../../supabase/functions/approval-batch-quick-approve/index.ts";

const SECRET = "quick-approval-contract-secret-with-32-plus-bytes";
const ORIGIN = "https://catalogo-proveedores-flux-git-dev-quantta-team.vercel.app";

function material(overrides = {}) {
  return {
    version: 1,
    notification_event_id: "00000000-0000-4000-8000-000000000001",
    batch_id: "00000000-0000-4000-8000-000000000002",
    director_id: "00000000-0000-4000-8000-000000000003",
    submitted_at: "2026-08-26T18:00:00.000Z",
    snapshot_hash: "a".repeat(64),
    expires_at: "2026-08-29T18:00:00.000Z",
    jti: "b".repeat(64),
    ...overrides,
  };
}

function document() {
  return {
    batch: {
      id: material().batch_id,
      label: "CORTE DEMO 26/AGO/2026",
      company_name: "Operadora Tlacatecpan",
      period_start: "2026-08-20",
      period_end: "2026-08-26",
      submitted_at: material().submitted_at,
      item_count: 3,
      totals_by_currency: [{ currency: "MXN", amount: 1234.56 }],
    },
  };
}

function runtime(fetchMock) {
  return {
    env: (name) => ({
      APPROVAL_BATCH_QUICK_APPROVE_SECRET: SECRET,
      SUPABASE_URL: "https://scsirgbuqjcwoaxfacth.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-contract",
    })[name],
    fetch: fetchMock,
  };
}

function request(method, body, origin = ORIGIN) {
  return new Request("https://example.invalid/functions/v1/approval-batch-quick-approve", {
    method,
    headers: {
      ...(origin ? { Origin: origin } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

test("email has two mobile-safe CTAs and token only in the fragment", () => {
  const token = "payload.signature";
  const quickUrl = `${ORIGIN}/approval_batch_quick_approve.html#token=${token}`;
  const rendered = renderApprovalBatchSubmittedEmail(document(), "test_only", "director", quickUrl);

  assert.match(rendered.html, />Revisar corte</);
  assert.match(rendered.html, />Aprobar corte</);
  assert.match(rendered.html, /min-height:44px/);
  assert.match(rendered.html, /approval_batch_quick_approve\.html#token=payload\.signature/);
  assert.doesNotMatch(rendered.html, /approval_batch_quick_approve\.html\?token=/);
  assert.match(rendered.text, /La aprobación rápida autoriza todas las partidas pendientes del corte/);
});

test("feature flag fallback preserves the current single-CTA email", () => {
  const rendered = renderApprovalBatchSubmittedEmail(document(), "test_only", "director");
  assert.match(rendered.html, />Revisar y autorizar corte</);
  assert.doesNotMatch(rendered.html, />Aprobar corte</);
  assert.match(rendered.html, /mismo formato disponible en el botón PDF/);
});

test("HMAC token is deterministic for the same event and uses two base64url segments", async () => {
  const first = await signQuickApprovalToken(material(), SECRET);
  const retry = await signQuickApprovalToken(material(), SECRET);
  assert.equal(first, retry);
  assert.match(first, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  const payload = JSON.parse(Buffer.from(first.split(".")[0], "base64url").toString("utf8"));
  assert.deepEqual(payload, material());
});

test("OPTIONS is 204 and GET is 405 with zero RPC calls", async () => {
  let calls = 0;
  const fetchMock = async () => { calls += 1; throw new Error("unexpected"); };
  const options = await handleRequest(request("OPTIONS"), runtime(fetchMock));
  const get = await handleRequest(request("GET"), runtime(fetchMock));
  assert.equal(options.status, 204);
  assert.equal(options.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(get.status, 405);
  assert.equal(calls, 0);
});

test("preview validates HMAC and invokes only the read-only preview RPC", async () => {
  const token = await signQuickApprovalToken(material(), SECRET);
  const calls = [];
  const fetchMock = async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(options.body) });
    assert.match(String(url), /\/rpc\/preview_approval_batch_quick_approval$/);
    return Response.json({
      state: "ready",
      label: "CORTE DEMO",
      company: "Operadora",
      period_start: "2026-08-20",
      period_end: "2026-08-26",
      item_count: 3,
      totals_by_currency: [{ currency: "MXN", amount: 300 }],
      expires_at: material().expires_at,
      review_url: `${ORIGIN}/approval_batches.html?batch_id=${material().batch_id}`,
      recipient_email: "must-not-leak@example.invalid",
    });
  };
  const response = await handleRequest(request("POST", { action: "preview", token }), runtime(fetchMock));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.state, "ready");
  assert.equal(body.recipient_email, undefined);
  assert.equal(calls.length, 1);
});

test("only explicit approve POST can invoke the mutation RPC", async () => {
  const token = await signQuickApprovalToken(material(), SECRET);
  let rpcName = "";
  const fetchMock = async (url) => {
    rpcName = String(url);
    return Response.json({ state: "approved", batch_id: material().batch_id, approved_items: 3 });
  };
  const response = await handleRequest(request("POST", { action: "approve", token }), runtime(fetchMock));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.state, "approved");
  assert.match(rpcName, /\/rpc\/approve_approval_batch_quick$/);
  assert.equal(body.batch_id, undefined);
  assert.equal(body.approved_items, undefined);
});

test("tampered payload and signature are denied before business RPC", async () => {
  const valid = await signQuickApprovalToken(material(), SECRET);
  const [payload, signature] = valid.split(".");
  const changed = material({ batch_id: "00000000-0000-4000-8000-000000000099" });
  const changedPayload = Buffer.from(JSON.stringify(changed)).toString("base64url");
  let calls = 0;
  const fetchMock = async () => { calls += 1; throw new Error("unexpected"); };

  const tamperedPayload = await handleRequest(
    request("POST", { action: "approve", token: `${changedPayload}.${signature}` }),
    runtime(fetchMock),
  );
  const tamperedSignature = await handleRequest(
    request("POST", { action: "approve", token: `${payload}.${"A".repeat(signature.length)}` }),
    runtime(fetchMock),
  );
  assert.equal(tamperedPayload.status, 401);
  assert.equal(tamperedSignature.status, 401);
  assert.equal(calls, 0);
});

test("page removes the fragment and never uses persistent browser storage", async () => {
  const html = await readFile(new URL("../../approval_batch_quick_approve.html", import.meta.url), "utf8");
  const js = await readFile(new URL("../../approval_batch_quick_approve.js", import.meta.url), "utf8");
  assert.match(html, /name="referrer" content="no-referrer"/);
  assert.match(js, /history\.replaceState/);
  assert.match(js, /location\.hash/);
  assert.doesNotMatch(js, /localStorage|sessionStorage|document\.cookie/);
  assert.doesNotMatch(html + js, /anon[_-]?key|SUPABASE_ANON_KEY/i);
});

test("migration preserves the UI RPC and enforces one-time, all-pending and trigger-owned notification", async () => {
  const sql = await readFile(
    new URL("../../supabase/migrations/20260826201712_approval_batch_quick_approve_dev.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /create or replace function public\.approve_entire_batch\(p_batch_id uuid\)/i);
  assert.match(sql, /approval_batch_require_active_direction\(\)/i);
  assert.match(sql, /approve_entire_batch_internal\(p_batch_id, v_actor\)/i);
  assert.match(sql, /unique \(notification_event_id\)/i);
  assert.match(sql, /unique \(token_jti_hash\)/i);
  assert.match(sql, /for update of item, request/i);
  assert.match(sql, /v_non_pending_count > 0/i);
  assert.match(sql, /v_batch\.status <> 'submitted'/i);
  assert.doesNotMatch(sql, /close_approval_batch/i);
  assert.doesNotMatch(sql, /insert_approval_batch_notification/i);
  assert.match(sql, /force row level security/i);
  assert.match(sql, /revoke all[\s\S]*from public, anon, authenticated/i);
});
