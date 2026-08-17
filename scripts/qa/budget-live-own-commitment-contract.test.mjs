import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const guardSource = readFileSync(
  new URL("../../budget_live_frontend_guards.js", import.meta.url),
  "utf8",
);
const solicitudesHtml = readFileSync(
  new URL("../../solicitudes.html", import.meta.url),
  "utf8",
);
const aprobacionesHtml = readFileSync(
  new URL("../../aprobaciones.html", import.meta.url),
  "utf8",
);

function loadGuard(available) {
  const query = {
    select() { return this; },
    eq() { return this; },
    then(resolve, reject) {
      return Promise.resolve({ data: [{ available }], error: null }).then(resolve, reject);
    },
  };
  const window = {
    supabaseClient: {
      from(name) {
        assert.equal(name, "budget_availability");
        return query;
      },
    },
  };
  const document = {
    readyState: "loading",
    addEventListener() {},
  };
  const context = vm.createContext({ window, document });
  vm.runInContext(guardSource, context);
  return window.FluxBudgetGuards;
}

function savedRequest(overrides = {}) {
  return {
    id: "request-under-review",
    company_id: "company",
    cost_center_id: "cost-center",
    budget_category_id: "category",
    budget_month: "2026-08-01",
    amount_requested: 19095.22,
    exchange_rate: 1,
    budget_decision: "aprobable",
    status: "submitted",
    ...overrides,
  };
}

function approx(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
}

test("approval revalidation excludes the current request commitment exactly once", async () => {
  const guard = loadGuard(0);
  const saved = savedRequest();
  const result = await guard.revalidateBudget(saved, { persistedRequest: saved });
  assert.equal(result.status, "ok");
  assert.equal(result.live_available, 0);
  assert.equal(result.own_commitment, 19095.22);
  assert.equal(result.available, 19095.22);
  assert.equal(result.after, 0);
  assert.equal(result.shortfall, 0);
});

test("same-budget edits restore the old commitment and evaluate the new amount", async () => {
  const guard = loadGuard(0);
  const saved = savedRequest();
  const increase = await guard.revalidateBudget(
    { ...saved, amount_requested: 20000 },
    { persistedRequest: saved },
  );
  assert.equal(increase.status, "insufficient");
  approx(increase.after, -904.78);

  const decrease = await guard.revalidateBudget(
    { ...saved, amount_requested: 18000 },
    { persistedRequest: saved },
  );
  assert.equal(decrease.status, "ok");
  approx(decrease.after, 1095.22);
});

test("changing budget coordinates never moves the old commitment into the target budget", async () => {
  const guard = loadGuard(1000);
  const saved = savedRequest();
  const result = await guard.revalidateBudget(
    { ...saved, budget_category_id: "other-category", amount_requested: 2000 },
    { persistedRequest: saved },
  );
  assert.equal(result.own_commitment, 0);
  assert.equal(result.status, "insufficient");
  assert.equal(result.after, -1000);
});

test("blocked or inactive requests receive no self-commitment credit", async () => {
  for (const overrides of [
    { budget_decision: "bloqueado" },
    { status: "rejected" },
    { status: "cancelled" },
  ]) {
    const guard = loadGuard(0);
    const saved = savedRequest(overrides);
    const result = await guard.revalidateBudget(saved, { persistedRequest: saved });
    assert.equal(result.own_commitment, 0);
    assert.equal(result.status, "insufficient");
  }
});

test("approval uses base-currency amount while edit keeps its preconverted target amount", async () => {
  const guard = loadGuard(0);
  const saved = savedRequest({ amount_requested: 100, exchange_rate: 20 });
  const approval = await guard.revalidateBudget(saved, { persistedRequest: saved });
  assert.equal(approval.status, "ok");
  assert.equal(approval.own_commitment, 2000);
  assert.equal(approval.amount, 2000);
  assert.equal(approval.after, 0);

  const edit = await guard.revalidateBudget(
    { ...saved, amount_requested: 2200 },
    { persistedRequest: saved, amountIsBudgetBase: true },
  );
  assert.equal(edit.status, "insufficient");
  assert.equal(edit.amount, 2200);
  assert.equal(edit.after, -200);
});

test("contract stays on the view, passes the persisted baseline, and busts both page caches", () => {
  assert.match(guardSource, /\.from\("budget_availability"\)/);
  assert.doesNotMatch(guardSource, /rpc\(["']approval_batch_budget_validation/);
  assert.match(guardSource, /\{ persistedRequest: request, amountIsBudgetBase: true \}/);
  assert.match(guardSource, /\{ persistedRequest: request \}/);
  assert.match(guardSource, /amount_requested: amount \* exchangeRate/);
  assert.match(guardSource, /Disponible para esta solicitud/);
  assert.match(solicitudesHtml, /budget_live_frontend_guards\.js\?v=20260817-self-commit/);
  assert.match(aprobacionesHtml, /budget_live_frontend_guards\.js\?v=20260817-self-commit/);
});
