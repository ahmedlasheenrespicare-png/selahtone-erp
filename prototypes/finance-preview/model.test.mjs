import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DemoProblem, createInitialState, setRole, parseMoney, formatMoney, balanceOf, totalCash,
  visibleAccounts, selectableCashAccounts, inspectTransfer, recordTransfer,
  inspectExpense, createExpense, approveExpense, inspectExpensePayment, payExpense,
  inspectPaidExpenseReview, requestPaidExpenseReview, inspectCollection, recordCollection,
} from "./model.mjs";

function rejected(fn, text) { assert.throws(fn, (error) => error instanceof DemoProblem && text.test(error.message)); }

test("money uses exact integer cents and supports Arabic digits", () => {
  assert.equal(parseMoney("١٢٣٫٤٥"), 12345n);
  assert.equal(parseMoney("999999999999.99"), 99_999_999_999_999n);
  assert.equal(formatMoney(-123456n), "−1,234.56");
  for (const input of ["", "0", "-3", "1.234", "1e3", "NaN", "1000000000000", "1,000"]) rejected(() => parseMoney(input), /مبلغ|أكبر/);
});

test("transfers keep the aggregate constant and require acknowledgement of a negative result", () => {
  const start = createInitialState();
  const transfer = { fromId: "vault-a", toId: "custody-a", amount: "5100", actuallyTransferred: true };
  assert.equal(inspectTransfer(start, transfer).projected, -10_000n);
  rejected(() => recordTransfer(start, transfer), /سالب/);
  const next = recordTransfer(start, { ...transfer, negativeAcknowledged: true });
  assert.equal(balanceOf(start, "vault-a"), 500_000n);
  assert.equal(balanceOf(next, "vault-a"), -10_000n);
  assert.equal(balanceOf(next, "custody-a"), 590_000n);
  assert.equal(totalCash(next), totalCash(start));
  assert.equal(next.movements.length, 1);
  rejected(() => recordTransfer(start, { ...transfer, actuallyTransferred: false }), /حدث فعلي/);
  rejected(() => recordTransfer(start, { ...transfer, toId: "custody-b" }), /الفرع نفسه/);
  rejected(() => recordTransfer(start, { ...transfer, toId: "vault-a" }), /خزنة وعهدة/);
});

test("expense creation and self approval do not change cash; only actual cash payment does", () => {
  const start = createInitialState();
  const draft = { branchId: "branch-a", categoryId: "supplies", amount: "125.35", date: "2026-10-29", description: "مصروف تجريبي" };
  assert.equal(inspectExpense(start, draft).amountCents, 12535n);
  const requested = createExpense(start, draft);
  const id = requested.expenses[0].id;
  assert.equal(requested.expenses[0].status, "PENDING");
  assert.equal(totalCash(requested), totalCash(start));
  rejected(() => payExpense(requested, { expenseId: id, method: "CASH", accountId: "vault-a", paymentDate: "2026-10-29", actuallyPaid: true }), /معتمد/);
  const approved = approveExpense(requested, id);
  assert.equal(approved.expenses[0].approvedBy, "manager");
  assert.equal(totalCash(approved), totalCash(start));
  const payment = { expenseId: id, method: "CASH", accountId: "custody-a", paymentDate: "2026-10-29", actuallyPaid: true };
  const paid = payExpense(approved, payment);
  assert.equal(paid.expenses[0].status, "PAID");
  assert.equal(paid.expenses[0].payment.paymentDate, "2026-10-29");
  assert.match(paid.expenses[0].payment.recordedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(balanceOf(paid, "custody-a"), 80_000n - 12535n);
  assert.equal(totalCash(paid), totalCash(start) - 12535n);
  rejected(() => payExpense(paid, payment), /لم يُدفع سابقًا/);
  rejected(() => payExpense(approved, { ...payment, actuallyPaid: false }), /دُفع فعلي/);
  rejected(() => payExpense(approved, { ...payment, accountId: "vault-b" }), /فرع المصروف/);
  rejected(() => payExpense(approved, { ...payment, paymentDate: "2026-02-30" }), /تاريخ/);
  rejected(() => payExpense(approved, { ...payment, paymentDate: "" }), /تاريخ/);
  rejected(() => createExpense(start, { ...draft, date: "2026-02-30" }), /تاريخ/);
});

test("optional payee, document and manually entered tax remain distinct from an unknown tax", () => {
  const start = createInitialState();
  const draft = { branchId: "branch-a", categoryId: "supplies", amount: "114.00", date: "2026-10-29", description: "مستلزمات تجريبية", beneficiary: "  جهة تجريبية  ", documentNumber: "  F-123  ", taxAmount: "١٤٫٠٠" };
  const inspected = inspectExpense(start, draft);
  assert.equal(inspected.beneficiary, "جهة تجريبية");
  assert.equal(inspected.documentNumber, "F-123");
  assert.equal(inspected.taxCents, 1400n);
  assert.equal(inspectExpense(start, { ...draft, taxAmount: "" }).taxCents, null);
  assert.equal(inspectExpense(start, { ...draft, taxAmount: "٠" }).taxCents, 0n);
  rejected(() => inspectExpense(start, { ...draft, taxAmount: "115" }), /الضريبة/);
  rejected(() => inspectExpense(start, { ...draft, taxAmount: "-1" }), /مبلغ/);
  rejected(() => inspectExpense(start, { ...draft, taxAmount: "abc" }), /مبلغ/);
  rejected(() => inspectExpense(start, { ...draft, beneficiary: "x".repeat(121) }), /المستفيد/);
  const requested = createExpense(start, draft), approved = approveExpense(requested, requested.expenses[0].id);
  const paid = payExpense(approved, { expenseId: requested.expenses[0].id, method: "CASH", accountId: "vault-a", paymentDate: "2026-10-28", actuallyPaid: true });
  assert.equal(totalCash(paid), totalCash(start) - 11400n); // Tax is part of the total, not an additional movement.
  assert.equal(paid.expenses[0].payment.paymentDate, "2026-10-28");
});

test("cash paid before opening is marked historical after confirmation, without a second cash movement", () => {
  const start = approveExpense(createInitialState(), "exp-1001");
  const before = { expenseId: "exp-1001", method: "CASH", accountId: "vault-a", paymentDate: "2026-10-24", actuallyPaid: true };
  rejected(() => inspectExpensePayment(start, before), /سبق الجرد/);
  const confirmed = { ...before, includedInOpening: true };
  assert.equal(inspectExpensePayment(start, confirmed).historical, true);
  const historical = payExpense(start, confirmed);
  assert.equal(historical.expenses[0].payment.historical, true);
  assert.equal(historical.expenses[0].payment.accountId, "vault-a");
  assert.equal(historical.expenses[0].payment.paymentDate, "2026-10-24");
  assert.equal(totalCash(historical), totalCash(start));
  assert.equal(historical.movements.length, 0);

  const sameDay = { ...before, paymentDate: "2026-10-25" };
  rejected(() => inspectExpensePayment(start, sameDay), /يوم الجرد/);
  rejected(() => payExpense(start, { ...sameDay, openingOrder: "before" }), /سبق الجرد/);
  const sameDayBefore = payExpense(start, { ...sameDay, openingOrder: "before", includedInOpening: true });
  assert.equal(totalCash(sameDayBefore), totalCash(start));
  const sameDayAfter = payExpense(start, { ...sameDay, openingOrder: "after" });
  assert.equal(sameDayAfter.expenses[0].payment.historical, false);
  assert.equal(totalCash(sameDayAfter), totalCash(start) - 75_000n);
  assert.equal(sameDayAfter.movements.length, 1);
});

test("non-cash expense payments do not alter physical cash or claim a bank balance", () => {
  for (const method of ["CARD", "BANK_TRANSFER", "WALLET"]) {
    const start = approveExpense(createInitialState(), "exp-1001");
    const input = { expenseId: "exp-1001", method, accountId: "", paymentDate: "2026-10-29", actuallyPaid: true };
    assert.equal(inspectExpensePayment(start, input).account, null);
    const next = payExpense(start, input);
    assert.equal(totalCash(next), totalCash(start));
    assert.equal(next.movements.length, 0);
    rejected(() => payExpense(start, { ...input, accountId: "vault-a" }), /غير النقدية/);
  }
});

test("cash expense may make the account negative only after an explicit warning", () => {
  const start = approveExpense(createInitialState(), "exp-1001");
  const payment = { expenseId: "exp-1001", method: "CASH", accountId: "custody-a", paymentDate: "2026-10-29", actuallyPaid: true };
  // The example account initially holds 800.00 while this expense is 750.00.
  assert.equal(inspectExpensePayment(start, payment).projected, 5000n);
  const shifted = recordTransfer(start, { fromId: "custody-a", toId: "vault-a", amount: "100", actuallyTransferred: true });
  assert.equal(inspectExpensePayment(shifted, payment).projected, -5000n);
  rejected(() => payExpense(shifted, payment), /سالب/);
  assert.equal(balanceOf(payExpense(shifted, { ...payment, negativeAcknowledged: true }), "custody-a"), -5000n);
});

test("cash collection credits only its selected holder; non-cash is excluded", () => {
  const start = createInitialState();
  const cash = { branchId: "branch-a", method: "CASH", amount: "100", accountId: "custody-a", actuallyReceived: true };
  const received = recordCollection(start, cash);
  assert.equal(balanceOf(received, "custody-a"), 90_000n);
  assert.equal(balanceOf(received, "vault-a"), balanceOf(start, "vault-a"));
  assert.equal(totalCash(received), totalCash(start) + 10000n);
  const delivered = recordTransfer(received, { fromId: "custody-a", toId: "vault-a", amount: "100", actuallyTransferred: true });
  assert.equal(totalCash(delivered), totalCash(received));
  for (const method of ["CARD", "BANK_TRANSFER", "WALLET"]) {
    const noncash = recordCollection(start, { ...cash, method, accountId: "" });
    assert.equal(totalCash(noncash), totalCash(start));
    assert.equal(noncash.movements.length, 0);
    rejected(() => inspectCollection(start, { ...cash, method }), /غير النقدي/);
  }
  rejected(() => recordCollection(start, { ...cash, actuallyReceived: false }), /تم/);
});

test("accountant can manage branch-b custody and self-approve an expense", () => {
  const accountant = setRole(createInitialState(), "accountant");
  const transferred = recordTransfer(accountant, { fromId: "vault-b", toId: "custody-b", amount: "100", actuallyTransferred: true });
  assert.equal(balanceOf(transferred, "vault-b"), 240_000n);
  assert.equal(balanceOf(transferred, "custody-b"), 40_000n);
  assert.equal(totalCash(transferred), totalCash(accountant));
  const requested = createExpense(transferred, { branchId: "branch-b", categoryId: "utilities", amount: "50", date: "2026-10-29", description: "مصروف محاسب تجريبي" });
  const id = requested.expenses[0].id;
  const approved = approveExpense(requested, id);
  assert.equal(approved.expenses[0].createdBy, "accountant");
  assert.equal(approved.expenses[0].approvedBy, "accountant");
  assert.equal(totalCash(approved), totalCash(transferred));
  const paid = payExpense(approved, { expenseId: id, method: "CASH", accountId: "custody-b", paymentDate: "2026-10-29", actuallyPaid: true });
  assert.equal(balanceOf(paid, "custody-b"), 35_000n);
});

test("paid mistakes create a manual review without changing the original or cash", () => {
  const start = createInitialState();
  const draft = createExpense(start, { branchId:"branch-a", categoryId:"supplies", amount:"120", date:"2026-10-29", description:"خطأ تسجيل تجريبي" });
  const id = draft.expenses[0].id, approved = approveExpense(draft, id);
  const paid = payExpense(approved, { expenseId:id, method:"CASH", accountId:"vault-a", paymentDate:"2026-10-29", actuallyPaid:true });
  const input = { expenseId:id, reason:"المبلغ الصحيح 100 بعد المراجعة", proposedAmount:"١٠٠" };
  rejected(() => inspectPaidExpenseReview(draft, input), /مدفوع/);
  rejected(() => requestPaidExpenseReview(paid, { ...input, reason:"" }), /سبب/);
  rejected(() => requestPaidExpenseReview(setRole(paid,"staff"), input), /المحاسب/);
  const reviewed = requestPaidExpenseReview(paid, input);
  assert.equal(reviewed.paidReviews[0].originalAmountCents, 12000n);
  assert.equal(reviewed.paidReviews[0].proposedAmountCents, 10000n);
  assert.equal(reviewed.paidReviews[0].reason, input.reason);
  assert.deepEqual(reviewed.expenses, paid.expenses); assert.deepEqual(reviewed.movements, paid.movements);
  assert.equal(totalCash(reviewed), totalCash(paid)); assert.equal(balanceOf(reviewed, "vault-a"), balanceOf(paid, "vault-a"));
  rejected(() => requestPaidExpenseReview(reviewed, input), /مفتوح/);
});

test("staff scope is limited to own custody or branch safe for a collection", () => {
  const staff = setRole(createInitialState(), "staff");
  assert.deepEqual(visibleAccounts(staff).map((a) => a.id), ["custody-a"]);
  assert.deepEqual(selectableCashAccounts(staff, "branch-a").map((a) => a.id), ["vault-a", "custody-a"]);
  assert.deepEqual(selectableCashAccounts(staff, "branch-b"), []);
  rejected(() => inspectCollection(staff, { branchId: "branch-b", method: "CASH", amount: "10", accountId: "vault-b" }), /فرعه/);
  rejected(() => inspectTransfer(staff, { fromId: "vault-a", toId: "custody-a", amount: "10" }), /المحاسب/);
  rejected(() => approveExpense(staff, "exp-1001"), /المحاسب/);
  rejected(() => createExpense(staff, {}), /المحاسب/);
  rejected(() => payExpense(staff, {}), /المحاسب/);
});
