import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  isExceptionPaymentRequest,
  renderEmail,
  signExceptionQuickApprovalToken,
} from "../../supabase/functions/notification-dispatcher/index.ts";
import { handleRequest as handleQuickRequest } from "../../supabase/functions/payment-request-exception-quick-approve/index.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const QA_RECIPIENTS = Object.freeze([
  "qa.bot@quantta.mx",
  "raul.robles.qa@gmail.com",
  "raul.robles+qa@gmail.com",
]);

function event(payload = {}, recipient = QA_RECIPIENTS[0]) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    event_type: "payment_request.created",
    source_table: "payment_requests",
    source_id: "22222222-2222-4222-8222-222222222222",
    source_folio: "SOL-QA-529",
    recipient_type: "profile",
    recipient_profile_id: "33333333-3333-4333-8333-333333333333",
    recipient_email: recipient,
    subject: "Nueva solicitud de pago: SOL-QA-529",
    payload,
    attempt_count: 0,
    priority: "normal",
  };
}

const normalPayload = {
  folio: "SOL-QA-529",
  provider: "Proveedor QA",
  amount: 1250,
  currency: "MXN",
  company: "Operadora QA",
  cost_center: "Centro QA",
  budget_category: "Servicios QA",
  requester: "Solicitante QA",
  budget_decision: "aprobable",
  is_extraordinary_adjustment: false,
};

const exceptionPayload = {
  ...normalPayload,
  budget_decision: "bloqueado",
  budget_shortfall: 250,
};

test("QA fixtures contain only the explicitly authorized recipients", () => {
  assert.deepEqual(QA_RECIPIENTS, [
    "qa.bot@quantta.mx",
    "raul.robles.qa@gmail.com",
    "raul.robles+qa@gmail.com",
  ]);
  assert.equal(QA_RECIPIENTS.some((email) => /cesar/i.test(email)), false);
});

test("normal payment request email is unchanged", () => {
  assert.equal(isExceptionPaymentRequest(normalPayload), false);
  const rendered = renderEmail(event(normalPayload), "test_only");
  assert.equal(
    rendered.subject,
    "[DEV TEST] Nueva solicitud de pago: SOL-QA-529",
  );
  assert.doesNotMatch(rendered.html, /Fuera de presupuesto/);
  assert.doesNotMatch(rendered.html, />Autorizar excepción<\/a>/);
});

test("exception email is unmistakable while quick approve is disabled", () => {
  assert.equal(isExceptionPaymentRequest(exceptionPayload), true);
  const rendered = renderEmail(event(exceptionPayload), "test_only", null);
  assert.equal(
    rendered.subject,
    "[DEV TEST] ⚠️ EXCEPCIÓN (fuera de presupuesto) — SOL-QA-529",
  );
  assert.match(rendered.html, /Solicitud FUERA DE PRESUPUESTO por autorizar/);
  assert.match(rendered.html, /Faltante de presupuesto/);
  assert.match(rendered.text, /EXCEPCION: FUERA DE PRESUPUESTO/);
  assert.doesNotMatch(rendered.html, />Autorizar excepción<\/a>/);
  assert.doesNotMatch(
    rendered.text,
    /Autorizar excepción \(sin entrar al sistema\)/,
  );
});

test("quick approve button uses a fragment token when explicitly supplied", () => {
  const quickUrl =
    "https://qa.example.test/payment_request_exception_quick_approve.html#token=abc.def";
  const rendered = renderEmail(
    event(exceptionPayload, QA_RECIPIENTS[1]),
    "test_only",
    quickUrl,
  );
  assert.match(rendered.html, />Autorizar excepción<\/a>/);
  assert.match(rendered.html, /#token=abc\.def/);
  assert.doesNotMatch(rendered.html, /\?token=/);
});

test("signed material binds the Supabase project ref", async () => {
  const material = {
    version: 1,
    project_ref: "abcdefghijklmnopqrst",
    notification_event_id: "11111111-1111-4111-8111-111111111111",
    payment_request_id: "22222222-2222-4222-8222-222222222222",
    approver_profile_id: "33333333-3333-4333-8333-333333333333",
    submitted_at: "2026-09-03T12:00:00.000Z",
    snapshot_hash: "a".repeat(64),
    expires_at: "2026-09-06T12:00:00.000Z",
    jti: "b".repeat(64),
  };
  const token = await signExceptionQuickApprovalToken(
    material,
    "q".repeat(48),
  );
  const [payloadSegment, signatureSegment] = token.split(".");
  const decoded = JSON.parse(
    Buffer.from(payloadSegment, "base64url").toString("utf8"),
  );
  assert.equal(decoded.project_ref, material.project_ref);
  assert.match(signatureSegment, /^[A-Za-z0-9_-]+$/);
});

function unsignedToken() {
  const payload = {
    version: 1,
    project_ref: "abcdefghijklmnopqrst",
    notification_event_id: "11111111-1111-4111-8111-111111111111",
    payment_request_id: "22222222-2222-4222-8222-222222222222",
    approver_profile_id: "33333333-3333-4333-8333-333333333333",
    submitted_at: "2026-09-03T12:00:00.000Z",
    snapshot_hash: "a".repeat(64),
    expires_at: "2026-09-06T12:00:00.000Z",
    jti: "b".repeat(64),
  };
  return `${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${"c".repeat(43)}`;
}

test("edge kill switch rejects before any RPC or approval call", async () => {
  let fetchCalls = 0;
  const runtime = {
    env(name) {
      return {
        PAYMENT_REQUEST_EXCEPTION_QUICK_APPROVE_ALLOWED_ORIGIN:
          "https://qa.example.test",
        PAYMENT_REQUEST_EXCEPTION_QUICK_APPROVE_ENABLED: "false",
        SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-placeholder",
      }[name];
    },
    async fetch() {
      fetchCalls += 1;
      throw new Error("fetch must not be called while disabled");
    },
  };
  const response = await handleQuickRequest(
    new Request("https://edge.example.test", {
      method: "POST",
      headers: {
        Origin: "https://qa.example.test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "preview", token: unsignedToken() }),
    }),
    runtime,
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { state: "invalid" });
  assert.equal(fetchCalls, 0);
});

test("edge CORS origin is environment-bound and fail-closed", async () => {
  let fetchCalls = 0;
  const response = await handleQuickRequest(
    new Request("https://edge.example.test", {
      method: "POST",
      headers: {
        Origin: "https://not-allowed.example.test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "preview", token: unsignedToken() }),
    }),
    {
      env(name) {
        return name ===
            "PAYMENT_REQUEST_EXCEPTION_QUICK_APPROVE_ALLOWED_ORIGIN"
          ? "https://qa.example.test"
          : undefined;
      },
      async fetch() {
        fetchCalls += 1;
        throw new Error("fetch must not be called for a rejected origin");
      },
    },
  );
  assert.equal(response.status, 403);
  assert.equal(fetchCalls, 0);
});

test("exception runtime URLs are environment-bound", () => {
  const environmentBoundPaths = [
    "supabase/functions/payment-request-exception-quick-approve/index.ts",
    "payment_request_exception_quick_approve.js",
    "payment_request_exception_quick_approve.html",
  ];
  const environmentBoundRuntime = environmentBoundPaths
    .map((relativePath) =>
      fs.readFileSync(path.join(ROOT, relativePath), "utf8")
    )
    .join("\n");
  assert.doesNotMatch(
    environmentBoundRuntime,
    /catalogo-proveedores-flux-git-dev-quantta-team\.vercel\.app/,
  );
  assert.doesNotMatch(environmentBoundRuntime, /scsirgbuqjcwoaxfacth/);
  assert.match(
    environmentBoundRuntime,
    /PAYMENT_REQUEST_EXCEPTION_QUICK_APPROVE_ALLOWED_ORIGIN/,
  );
  assert.match(environmentBoundRuntime, /project_ref/);

  const dispatcher = fs.readFileSync(
    path.join(
      ROOT,
      "supabase/functions/notification-dispatcher/index.ts",
    ),
    "utf8",
  );
  assert.match(
    dispatcher,
    /PAYMENT_REQUEST_EXCEPTION_QUICK_APPROVE_BASE_URL/,
  );
  assert.doesNotMatch(
    dispatcher,
    /const EXCEPTION_QUICK_APPROVE_BASE_URL\s*=/,
  );
});

test("migration timestamp matches the version recorded in Supabase DEV", () => {
  assert.equal(
    fs.existsSync(
      path.join(
        ROOT,
        "supabase/migrations/20260903154601_payment_request_exception_quick_approve_dev.sql",
      ),
    ),
    true,
  );
  assert.equal(
    fs.existsSync(
      path.join(
        ROOT,
        "supabase/migrations/20260903120000_payment_request_exception_quick_approve_dev.sql",
      ),
    ),
    false,
  );
});
