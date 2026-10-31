/**
 * The pay-expense form must say where the cash came from. A payload without
 * `source` silently becomes an immediate account debit, and such a payment is
 * invisible to the settlement — the employee's expense then never returns to
 * him. These tests lock the shaping rules without a session or a database.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { payExpensePayload, payExpenseSource } from "../src/lib/finance/pay-expense-source";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

const base = {
  requestId: "3f2b7c1e-9a44-4a0e-9a55-1c9d3f4b2a11",
  expenseId: "7",
  expectedRevision: "2",
  paymentDate: "2026-10-31",
  actuallyPaid: "yes",
};

test("a missing or unknown source falls back to an immediate account debit", () => {
  assert.equal(payExpenseSource(undefined), "ACCOUNT");
  assert.equal(payExpenseSource(""), "ACCOUNT");
  assert.equal(payExpenseSource("anything"), "ACCOUNT");
  assert.equal(payExpenseSource(null), "ACCOUNT");
  assert.equal(payExpensePayload(form({ ...base, method: "CASH", accountId: "2" })).source, "ACCOUNT");
});

test("holder cash is explicit and nothing else is accepted as it", () => {
  assert.equal(payExpenseSource("HOLDER_CASH"), "HOLDER_CASH");
  assert.equal(payExpenseSource("holder_cash"), "ACCOUNT");
});

test("holder cash drops every account field, even if the browser sends them", () => {
  const payload = payExpensePayload(form({
    ...base,
    source: "HOLDER_CASH",
    method: "CASH",
    // حقول تخصّ الخصم الفوري؛ يجب ألا تصل إلى المحرك مع نقد الموظف.
    accountId: "2",
    expectedBalance: "1000.00",
    openingOrder: "AFTER",
    includedInOpening: "yes",
    negativeAcknowledged: "yes",
    afterCountId: "1",
    afterCount: "yes",
  }));

  assert.equal(payload.source, "HOLDER_CASH");
  assert.equal(payload.method, "CASH");
  assert.equal(payload.accountId, null);
  assert.equal(payload.expectedBalance, null);
  assert.equal(payload.openingOrder, null);
  assert.equal(payload.includedInOpening, false);
  assert.equal(payload.negativeAcknowledged, false);
  assert.equal(payload.afterCountId, null);
  assert.equal(payload.afterCount, false);
  // ما لا علاقة له بالحساب يمرّ كما هو.
  assert.equal(payload.expenseId, "7");
  assert.equal(payload.paymentDate, "2026-10-31");
  assert.equal(payload.actuallyPaid, true);
});

test("an immediate account debit keeps the account, balance and count fields", () => {
  const payload = payExpensePayload(form({
    ...base,
    source: "ACCOUNT",
    method: "CASH",
    accountId: "2",
    expectedBalance: "1000.00",
    openingOrder: "AFTER",
    includedInOpening: "yes",
    negativeAcknowledged: "yes",
  }));

  assert.equal(payload.source, "ACCOUNT");
  assert.equal(payload.accountId, "2");
  assert.equal(payload.expectedBalance, "1000.00");
  assert.equal(payload.openingOrder, "AFTER");
  assert.equal(payload.includedInOpening, true);
  assert.equal(payload.negativeAcknowledged, true);
});

test("a non-cash payment never carries an account whatever the source is", () => {
  for (const source of ["HOLDER_CASH", "ACCOUNT"]) {
    const payload = payExpensePayload(form({ ...base, source, method: "BANK_TRANSFER", accountId: "2", expectedBalance: "1000.00" }));
    assert.equal(payload.accountId, null);
    assert.equal(payload.expectedBalance, null);
  }
});

test("unconfirmed checkboxes stay false, so a payment is never assumed", () => {
  assert.equal(payExpensePayload(form({ ...base, source: "HOLDER_CASH", method: "CASH", actuallyPaid: "no" })).actuallyPaid, false);
  const unchecked: Record<string, string> = { ...base, source: "HOLDER_CASH", method: "CASH" };
  delete unchecked.actuallyPaid; // مربع تأكيد غير مُعلَّم لا يُرسل قيمة إطلاقًا.
  assert.equal(payExpensePayload(form(unchecked)).actuallyPaid, false);
});
