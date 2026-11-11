import assert from "node:assert/strict";
import test from "node:test";
import { auditSyntheticExpensePeriods, type SyntheticExpense } from "../prototypes/finance-dashboard-flow-audit/expenses.test-only";

test("synthetic expense evidence keeps expense, physical-date attestation and recording periods distinct", () => {
  const base: SyntheticExpense = { id: "1", branchId: "1", requesterId: "3", status: "PAID", expenseDate: "2026-02-15", paymentDate: "2026-03-01", recordedAt: "2026-02-28T22:30:00Z", effectiveAmount: "10.00", paymentAmount: "10.00" };
  const rows: SyntheticExpense[] = [
    base,
    { ...base, id: "2", expenseDate: "2026-03-02", paymentDate: "2026-02-28", recordedAt: "2026-03-02T12:00:00Z", effectiveAmount: "12.00" },
    { ...base, id: "3", status: "PENDING", expenseDate: "2026-03-10", paymentDate: null, recordedAt: null, paymentAmount: null },
    { ...base, id: "4", expenseDate: "2026-03-05", paymentDate: null, recordedAt: null, paymentAmount: null },
    { ...base, id: "5", requesterId: "9", expenseDate: "2026-03-10", paymentDate: "2026-03-11" },
    { ...base, id: "6", branchId: "2", expenseDate: "2026-03-10" },
    { ...base, id: "7", expenseDate: "2026-02-30", paymentDate: "2026-03-01", recordedAt: "2026-03-01T10:00:00", paymentAmount: "bad" },
    { ...base, id: "8", expenseDate: "2026-02-01", paymentDate: "2026-02-02", recordedAt: "2026-02-30T22:30:00Z" },
  ];
  const before = structuredClone(rows);
  const own = auditSyntheticExpensePeriods(rows, { branchId: "1", requesterId: "3" }, "2026-03");
  assert.deepEqual(own.expenseMonth, ["2", "3", "4"]);
  assert.deepEqual(own.paymentMonth, ["1", "7"]);
  assert.deepEqual(own.recordedMonth, ["1", "2"], "Cairo month boundary applies to recording time");
  assert.deepEqual(own.findings, [
    { id: "2", issues: ["AMOUNT_MISMATCH"] },
    { id: "4", issues: ["MISSING_PAYMENT_DATE", "MISSING_RECORDED_AT", "MISSING_PAYMENT_AMOUNT", "PAID_WITHOUT_PAYMENT"] },
    { id: "7", issues: ["MISSING_EXPENSE_DATE", "MISSING_RECORDED_AT", "MISSING_PAYMENT_AMOUNT"] },
    { id: "8", issues: ["MISSING_RECORDED_AT"] },
  ]);
  const branch = auditSyntheticExpensePeriods(rows, { branchId: "1" }, "2026-03");
  assert.deepEqual(branch.paymentMonth, ["1", "5", "7"]);
  assert.deepEqual(rows, before, "read-only audit must not mutate input");
  assert.throws(() => auditSyntheticExpensePeriods([...rows, { ...base }], { branchId: "1" }, "2026-03"), /duplicate/);
  assert.throws(() => auditSyntheticExpensePeriods(rows, { branchId: "1" }, "2026-13"), /invalid/);
});

import { syntheticRecordedFlow, type SyntheticEvent } from "../prototypes/finance-dashboard-flow-audit/recorded-flow.test-only";

test("synthetic recorded flow separates methods, event types, months and actor scopes without assuming physical cash", () => {
  const base: SyntheticEvent = { id: "1", kind: "COLLECTION", branchId: "1", actorId: "3", method: "CASH", amount: "10.20", recordedAt: "2026-02-28T22:30:00Z" };
  const events: SyntheticEvent[] = [base,
    { ...base, id: "2", method: "CARD", amount: "20.00" },
    { ...base, kind: "REFUND", amount: "2.10" },
    { ...base, id: "3", kind: "PAYMENT", amount: "3.00" },
    { ...base, id: "4", kind: "PAYMENT", actorId: "9", amount: "4.00" },
    { ...base, id: "5", branchId: "2" },
    { ...base, id: "6", recordedAt: "2026-02-28T21:59:59Z" },
  ];
  const before = structuredClone(events);
  const result = syntheticRecordedFlow(events, { branchId: "1", actorId: "3" }, "2026-03");
  assert.equal(result.complete, true);
  if (result.complete) {
    assert.deepEqual(result.buckets.CASH, { collection: 1020n, refund: 210n, payment: 300n });
    assert.deepEqual(result.buckets.CARD, { collection: 2000n, refund: 0n, payment: 0n });
  }
  const invalid = syntheticRecordedFlow([...events, { ...base, id: "7", method: "UNKNOWN" }], { branchId: "1" }, "2026-03");
  assert.deepEqual(invalid, { complete: false, issues: ["COLLECTION:7"] });
  assert.throws(() => syntheticRecordedFlow([...events, base], { branchId: "1" }, "2026-03"), /duplicate/);
  assert.deepEqual(events, before);
});
