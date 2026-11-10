import { CUSTODY_EXPECTATION_SQL } from "../src/lib/finance/custody-summary-sql";
/**
 * Verifies the employee-custody settlement engine against the reviewed candidate
 * schema plus the manual settlement upgrade, on a disposable database.
 * The rules under test: requesting never moves money, confirmation is atomic,
 * full-difference examples use the right direction, expenses paid from
 * the employee's cash are never deducted twice, and permissions hold.
 * Never touches DATABASE_URL. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { FinanceDatabase, FinanceTransaction } from "../src/lib/finance/types";
import { FinanceProblem } from "../src/lib/finance/types";
import {
  approveExpense, cancelCashCount, cancelSettlement, closeAccount, confirmSettlement, createExpense,
  editUnpaidExpense, listSettlements, openAccount, payExpense, rejectSettlement, requestCashCount,
  requestSettlement, settlementOverview,
} from "../src/lib/finance/engine";

const root = process.cwd(), read = (f: string) => readFileSync(path.join(root, f), "utf8");
const candidate = read("prototypes/finance-release/release-candidate.test-only.sql");
const upgrade = read("prisma/manual-settlement-upgrade.sql");
const req = () => randomUUID();
const today = "2026-10-29";

function adapter(pg: PGlite): FinanceDatabase {
  return {
    serializable: (work) => pg.transaction(async (tx) => {
      await tx.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
      const port: FinanceTransaction = { query: async <T extends Record<string, unknown>>(sql: string, parameters: unknown[] = []) => ({ rows: (await tx.query(sql, parameters)).rows as T[] }) };
      return work(port);
    }),
  };
}

const opening = (kind: "VAULT" | "CUSTODY", holderId: string | null, amount: string, branchId = "1") =>
  ({ requestId: req(), branchId, kind, holderId, openingAmount: amount, openingDate: "2026-10-20", counted: true });

async function fresh(): Promise<PGlite> {
  const pg = new PGlite();
  for (const f of ["tests/fixtures/inventory-baseline.sql", "tests/fixtures/finance-legacy-categories.sql", "tests/fixtures/commerce-collections.sql"]) await pg.exec(read(f));
  await pg.exec("SET selahtone.finance_release_candidate_test_only='yes'");
  await pg.exec(candidate);
  await pg.exec(upgrade);
  await pg.exec(read("prisma/manual-custody-closure-upgrade.sql"));
  await pg.exec("ALTER TABLE public.commerce_sales ADD COLUMN created_by_id bigint");
  return pg;
}

async function addCashSale(pg: PGlite, branchId: string, amount: string): Promise<void> {
  const sale = await pg.query<{ id: number }>("INSERT INTO public.commerce_sales(branch_id,created_by_id) VALUES ($1::bigint,3) RETURNING id", [branchId]);
  await pg.query("INSERT INTO public.commerce_collections(sale_id,amount,method) VALUES ($1::bigint,$2::numeric,'CASH')", [sale.rows[0].id, amount]);
}

const balances = async (pg: PGlite) => Object.fromEntries(
  (await pg.query<{ id: string; balance: string }>(
    `SELECT a.id::text AS id, (a.opening_amount + COALESCE((SELECT SUM(CASE WHEN m.destination_id=a.id THEN m.amount ELSE -m.amount END)
      FROM finance.movements m WHERE m.source_id=a.id OR m.destination_id=a.id),0))::text AS balance FROM finance.accounts a`)).rows
    .map((row) => [row.id, row.balance]));

const statuses = async (pg: PGlite) => (await pg.query<{ status: string }>("SELECT status FROM finance.settlements ORDER BY id")).rows.map((r) => r.status);
const movementCount = async (pg: PGlite) => Number((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance.movements")).rows[0].n);

const expenseDraft = { branchId: "1", categoryId: "1", amount: "800", expenseDate: "2026-10-21", description: "مصروف موظف", beneficiary: "", documentNumber: "", taxAmount: "" };
const holderCashPayment = (expenseId: string, revision: string) => ({
  expenseId, expectedRevision: revision, method: "CASH", accountId: "", paymentDate: "2026-10-21", actuallyPaid: true,
  openingOrder: "", includedInOpening: false, afterCountId: "", afterCount: false, expectedBalance: "", negativeAcknowledged: false, source: "HOLDER_CASH",
});
/** نفس النموذج حين يختار «خصم فوري من حساب»: يُمرَّر الحساب ورصيده المراجَع. */
const accountPayment = (expenseId: string, revision: string, accountId: string, expectedBalance: string) => ({
  ...holderCashPayment(expenseId, revision), accountId, expectedBalance, source: "ACCOUNT",
});

test("surplus settlement: the difference moves from the custody to the vault", { timeout: 180_000 }, async () => {
  const pg = await fresh();
  try {
    const db = adapter(pg);
    await openAccount(db, "1", opening("VAULT", null, "10000"), today);
    await openAccount(db, "1", opening("CUSTODY", "3", "1000"), today);
    await addCashSale(pg, "1", "5000");

    // الموظف ينشئ مصروفه، والإدارة تعتمده، ثم يسجّل أنه صرفه من نقده.
    const expense = await createExpense(db, "3", { requestId: req(), ...expenseDraft });
    await approveExpense(db, "1", { requestId: req(), expenseId: expense.id, expectedRevision: "1" });
    await payExpense(db, "3", { requestId: req(), ...holderCashPayment(expense.id, "2") });
    // الصرف من نقد الموظف بلا أي حركة نقدية (يُسوّى في التسوية).
    assert.equal(await movementCount(pg), 0);

    const overview = await settlementOverview(db, "3");
    assert.equal(overview.account?.balance, "1000.00");
    assert.equal(overview.sales, "5000.00");
    assert.equal(overview.expenses, "800.00");
    assert.equal(overview.expected, "5200.00");

    const request = await requestSettlement(db, "3", {
      requestId: req(), accountId: "2", countedAmount: "5200", expectedBalance: "1000", reason: "تسوية الفترة", actuallyCounted: true,
    });
    assert.deepEqual(await statuses(pg), ["OPEN"]);
    // الطلب لا يحرك النقد.
    assert.equal(await movementCount(pg), 0);

    // لا طلب ثانٍ مفتوح، ولا اعتماد ذاتي، ولا اتجاه خاطئ.
    await assert.rejects(() => requestSettlement(db, "3", { requestId: req(), accountId: "2", countedAmount: "5200", expectedBalance: "1000", reason: "طلب ثانٍ", actuallyCounted: true }));
    await assert.rejects(() => confirmSettlement(db, "3", { requestId: req(), settlementId: request.id, expectedBalance: "1000", transferAmount: "4200", transferDirection: "TO_VAULT", reason: "اعتماد", actuallyTransferred: true }));
    await assert.rejects(() => confirmSettlement(db, "1", { requestId: req(), settlementId: request.id, expectedBalance: "1000", transferAmount: "4200", transferDirection: "TO_CUSTODY", reason: "اتجاه خاطئ", actuallyTransferred: true }));

    const confirmation = { requestId: req(), settlementId: request.id, expectedBalance: "1000", transferAmount: "4200", transferDirection: "TO_VAULT" as const, reason: "اعتماد الفرق", actuallyTransferred: true };
    const confirmed = await confirmSettlement(db, "1", confirmation);
    assert.equal(confirmed.replayed, false);

    const after = await balances(pg);
    assert.equal(after["1"], "14200.00"); // الخزنة + الفرق
    assert.equal(after["2"], "1000.00");  // العهدة تعود لمستواها
    assert.deepEqual(await statuses(pg), ["CONFIRMED"]);

    // إعادة الإرسال لا تحرك شيئًا.
    const replayed = await confirmSettlement(db, "1", confirmation);
    assert.equal(replayed.replayed, true);
    assert.deepEqual(await balances(pg), after);
  } finally {
    await pg.close();
  }
});

test("deficit settlement: the difference moves from the vault to the custody", { timeout: 180_000 }, async () => {
  const pg = await fresh();
  try {
    const db = adapter(pg);
    await openAccount(db, "1", opening("VAULT", null, "10000"), today);
    await openAccount(db, "1", opening("CUSTODY", "3", "1000"), today);
    await addCashSale(pg, "1", "300");
    const bigExpense = await createExpense(db, "3", { requestId: req(), ...expenseDraft, amount: "900" });
    await approveExpense(db, "1", { requestId: req(), expenseId: bigExpense.id, expectedRevision: "1" });
    await payExpense(db, "3", { requestId: req(), ...holderCashPayment(bigExpense.id, "2") });

    const overview = await settlementOverview(db, "3");
    assert.equal(overview.expected, "400.00"); // 1000 + 300 − 900

    const request = await requestSettlement(db, "3", {
      requestId: req(), accountId: "2", countedAmount: "400", expectedBalance: "1000", reason: "عجز العهدة", actuallyCounted: true,
    });
    await confirmSettlement(db, "1", {
      requestId: req(), settlementId: request.id, expectedBalance: "1000", transferAmount: "600",
      transferDirection: "TO_CUSTODY", reason: "تغطية العجز", actuallyTransferred: true,
    });

    const after = await balances(pg);
    assert.equal(after["1"], "9400.00"); // الخزنة − العجز
    assert.equal(after["2"], "1000.00"); // العهدة تعود لمستواها
  } finally {
    await pg.close();
  }
});

test("settlement rules: scope, rejection and cancellation never move money", { timeout: 180_000 }, async () => {
  const pg = await fresh();
  try {
    const db = adapter(pg);
    await openAccount(db, "1", opening("VAULT", null, "10000"), today);
    await openAccount(db, "1", opening("CUSTODY", "3", "1000"), today);
    await addCashSale(pg, "1", "100");

    // التسوية للعهدة فقط: الخزنة مرفوضة.
    await assert.rejects(() => requestSettlement(db, "3", { requestId: req(), accountId: "1", countedAmount: "10000", expectedBalance: "10000", reason: "خزنة", actuallyCounted: true }));
    // الموظف لا يطلب تسوية لعهدة موظف في فرع آخر.
    const other = await pg.query<{ id: number }>(`INSERT INTO public.users(branch_id,role_code,full_name,email,password_hash,status,must_change_password)
      VALUES (2,'CS_AGENT','موظف فرع 2','b2@test.local','x','ACTIVE',false) RETURNING id`);
    await openAccount(db, "1", opening("CUSTODY", String(other.rows[0].id), "500", "2"), today);
    await assert.rejects(() => requestSettlement(db, "3", { requestId: req(), accountId: "3", countedAmount: "500", expectedBalance: "500", reason: "فرع آخر", actuallyCounted: true }));

    const first = await requestSettlement(db, "3", { requestId: req(), accountId: "2", countedAmount: "1100", expectedBalance: "1000", reason: "طلب أول", actuallyCounted: true });
    assert.equal((await listSettlements(db, "3")).length, 1);
    assert.equal((await listSettlements(db, "1")).length, 1);
    assert.equal((await listSettlements(db, "2")).length, 1); // المحاسب يرى نفس الطلب

    // الرفض بلا أثر مالي.
    await rejectSettlement(db, "1", { requestId: req(), settlementId: first.id, reason: "مبالغ غير مطابقة" });
    assert.equal(await movementCount(pg), 0);
    assert.deepEqual(await statuses(pg), ["REJECTED"]);

    // طلب جديد بعد الرفض، ثم إلغاؤه من صاحبه.
    const second = await requestSettlement(db, "3", { requestId: req(), accountId: "2", countedAmount: "1100", expectedBalance: "1000", reason: "طلب ثانٍ", actuallyCounted: true });
    await cancelSettlement(db, "3", { requestId: req(), settlementId: second.id, reason: "تراجع الموظف" });
    assert.equal(await movementCount(pg), 0);
    assert.deepEqual(await statuses(pg), ["REJECTED", "CANCELLED"]);
    assert.deepEqual(await balances(pg), { "1": "10000.00", "2": "1000.00", "3": "500.00" });
  } finally {
    await pg.close();
  }
});

test("the two pay sources are not interchangeable: only holder cash reaches the settlement", { timeout: 180_000 }, async () => {
  const pg = await fresh();
  try {
    const db = adapter(pg);
    await openAccount(db, "1", opening("VAULT", null, "10000"), today);
    await openAccount(db, "1", opening("CUSTODY", "3", "1000"), today);
    await addCashSale(pg, "1", "500");

    // خصم فوري من العهدة: المبلغ يخرج منها الآن بحركة EXPENSE.
    const debited = await createExpense(db, "3", { requestId: req(), ...expenseDraft, amount: "800" });
    await approveExpense(db, "1", { requestId: req(), expenseId: debited.id, expectedRevision: "1" });
    await payExpense(db, "1", { requestId: req(), ...accountPayment(debited.id, "2", "2", "1000.00") });
    assert.equal(await movementCount(pg), 1);
    assert.deepEqual(await balances(pg), { "1": "10000.00", "2": "200.00" });

    // وهو لا يظهر في التسوية: النقد خرج من العهدة نفسها، فلا يُسترد مرتين.
    const afterDebit = await settlementOverview(db, "3");
    assert.equal(afterDebit.expenses, "0.00");
    assert.equal(afterDebit.expected, "700.00"); // 200 + 500 − 0

    // مصروف صُرف من نقد الموظف: بلا حركة، ويُسوّى في التسوية.
    const fromHolder = await createExpense(db, "3", { requestId: req(), ...expenseDraft, amount: "300" });
    await approveExpense(db, "1", { requestId: req(), expenseId: fromHolder.id, expectedRevision: "1" });
    await payExpense(db, "3", { requestId: req(), ...holderCashPayment(fromHolder.id, "2") });
    assert.equal(await movementCount(pg), 1); // لم تُضاف حركة
    assert.deepEqual(await balances(pg), { "1": "10000.00", "2": "200.00" });

    const afterHolder = await settlementOverview(db, "3");
    assert.equal(afterHolder.expenses, "300.00");
    assert.equal(afterHolder.expected, "400.00"); // 200 + 500 − 300
  } finally {
    await pg.close();
  }
});

test("any cash movement after the request blocks confirmation, and re-requesting keeps the collection", { timeout: 180_000 }, async () => {
  const pg = await fresh();
  try {
    const db = adapter(pg);
    await openAccount(db, "1", opening("VAULT", null, "10000"), today);
    await openAccount(db, "1", opening("CUSTODY", "3", "1000"), today);
    await addCashSale(pg, "1", "500");

    const first = await requestSettlement(db, "3", {
      requestId: req(), accountId: "2", countedAmount: "1500", expectedBalance: "1000", reason: "تسوية", actuallyCounted: true,
    });
    const asRequested = (await pg.query<{ sales: string; expected: string }>(
      `SELECT sales_total::text AS sales, expected_amount::text AS expected FROM finance.settlements WHERE id=$1::bigint`, [first.id])).rows[0];
    assert.equal(asRequested.sales, "500.00");
    assert.equal(asRequested.expected, "1500.00");

    // تسجيل تحصيل بعد الطلب يمنع الاعتماد احتياطًا، دون استنتاج حركة نقد فعلية.
    await addCashSale(pg, "1", "200");

    await assert.rejects(
      () => confirmSettlement(db, "1", {
        requestId: req(), settlementId: first.id, expectedBalance: "1000", transferAmount: "200",
        transferDirection: "TO_VAULT", reason: "اعتماد", actuallyTransferred: true,
      }),
      (error: unknown) => error instanceof FinanceProblem && /سُجّل مصدر نقدي في الفرع أو حركة على العهدة بعد تقديم الطلب/.test(error.message) && /لا يثبت تغير النقد الفعلي/.test(error.message),
    );
    assert.equal(await movementCount(pg), 0);
    assert.deepEqual(await statuses(pg), ["OPEN"]);

    // يُلغى الطلب بسبب، ويُعاد الجرد بطلب جديد؛ الفترة تبدأ من آخر اعتماد فلا يضيع التحصيل.
    await cancelSettlement(db, "3", { requestId: req(), settlementId: first.id, reason: "إعادة الجرد بعد بيع جديد" });
    const second = await requestSettlement(db, "3", {
      requestId: req(), accountId: "2", countedAmount: "1700", expectedBalance: "1000", reason: "تسوية بعد إعادة الجرد", actuallyCounted: true,
    });
    const recounted = (await pg.query<{ sales: string; expected: string; deviation: string }>(
      `SELECT sales_total::text AS sales, expected_amount::text AS expected, deviation::text AS deviation FROM finance.settlements WHERE id=$1::bigint`, [second.id])).rows[0];
    assert.equal(recounted.sales, "700.00"); // ٥٠٠ + ٢٠٠
    assert.equal(recounted.expected, "1700.00");
    assert.equal(recounted.deviation, "0.00");

    await confirmSettlement(db, "1", {
      requestId: req(), settlementId: second.id, expectedBalance: "1000", transferAmount: "700",
      transferDirection: "TO_VAULT", reason: "اعتماد", actuallyTransferred: true,
    });
    assert.deepEqual(await balances(pg), { "1": "10700.00", "2": "1000.00" });
  } finally {
    await pg.close();
  }
});

test("a vault that would go negative is refused before any money moves", { timeout: 180_000 }, async () => {
  const pg = await fresh();
  try {
    const db = adapter(pg);
    await openAccount(db, "1", opening("VAULT", null, "100"), today);
    await openAccount(db, "1", opening("CUSTODY", "3", "1000"), today);

    const request = await requestSettlement(db, "3", {
      requestId: req(), accountId: "2", countedAmount: "500", expectedBalance: "1000", reason: "عجز", actuallyCounted: true,
    });
    const confirm = (negativeAcknowledged: boolean) => confirmSettlement(db, "1", {
      requestId: req(), settlementId: request.id, expectedBalance: "1000", transferAmount: "500",
      transferDirection: "TO_CUSTODY", reason: "تغطية العجز", actuallyTransferred: true, negativeAcknowledged,
    });

    // الخزنة فيها ١٠٠ فقط، فتغطية ٥٠٠ تجعلها −٤٠٠ بلا تنبيه.
    await assert.rejects(() => confirm(false));
    assert.equal(await movementCount(pg), 0);
    assert.deepEqual(await balances(pg), { "1": "100.00", "2": "1000.00" });

    // بعد الإقرار الصريح تُسجَّل، ويبقى السالب ظاهرًا لا مخفيًا.
    // العهدة تعود إلى رصيدها الدفتري، والخزنة تحمل العجز كاملًا.
    await confirm(true);
    assert.deepEqual(await balances(pg), { "1": "-400.00", "2": "1000.00" });
  } finally {
    await pg.close();
  }
});

test("count snapshots expected cash including unsettled sales and expenses, directly and by holder", { timeout: 180_000 }, async () => {
  const pg = await fresh();
  try {
    await pg.exec(read("prisma/manual-custody-and-count-requests.sql"));
    const db = adapter(pg);
    const { requestCashCount, confirmCashCount, requestCountFromHolder, submitHolderCount, listMyCountRequests } = await import("../src/lib/finance/engine");
    await openAccount(db, "1", opening("VAULT", null, "10000"), today);
    const custody = await openAccount(db, "1", opening("CUSTODY", "3", "1000"), today);
    await addCashSale(pg, "1", "5000");
    const expense = await createExpense(db, "3", { requestId: req(), ...expenseDraft });
    await approveExpense(db, "1", { requestId: req(), expenseId: expense.id, expectedRevision: "1" });
    await payExpense(db, "3", { requestId: req(), ...holderCashPayment(expense.id, "2") });
    assert.equal((await settlementOverview(db, "3")).expected, "5200.00");
    const countFields = async (id: string) => (await pg.query<{ observed: string; counted: string; difference: string; status: string }>(`SELECT observed_balance::text AS observed,counted_amount::text AS counted,difference::text AS difference,status FROM finance.cash_counts WHERE id=$1::bigint`, [id])).rows[0];
    const match = await requestCashCount(db, "1", { requestId: req(), accountId: custody.id, expectedBalance: "5200", countedAmount: "5200", reason: "جرد مطابق", actuallyCounted: true }, today);
    assert.deepEqual(await countFields(match.id), { observed: "5200.00", counted: "5200.00", difference: "0.00", status: "OPEN" });
    assert.equal((await listMyCountRequests(db, "3")).length, 0, "direct counts must not appear as holder requests");
    assert.equal(await movementCount(pg), 0);
    await confirmCashCount(db, "1", { requestId: req(), countId: match.id, reason: "تأكيد المطابقة", stillCurrent: true });
    assert.equal(await movementCount(pg), 0);
    const direct = await requestCashCount(db, "1", { requestId: req(), accountId: custody.id, expectedBalance: "5200", countedAmount: "5300", reason: "زيادة فعلية", actuallyCounted: true }, today);
    assert.deepEqual(await countFields(direct.id), { observed: "5200.00", counted: "5300.00", difference: "100.00", status: "OPEN" });
    const confirmation = { requestId: req(), countId: direct.id, reason: "تأكيد الزيادة", stillCurrent: true };
    await confirmCashCount(db, "1", confirmation);
    assert.equal((await confirmCashCount(db, "1", confirmation)).replayed, true);
    assert.equal(await movementCount(pg), 1);
    assert.equal((await balances(pg))[custody.id], "1100.00");
    assert.equal((await settlementOverview(db, "3")).expected, "5300.00");
    const directed = await requestCountFromHolder(db, "1", { requestId: req(), accountId: custody.id, reason: "جرد من صاحب العهدة" });
    await assert.rejects(() => confirmCashCount(db, "1", { requestId: req(), countId: directed.id, reason: "مبكر", stillCurrent: true }), (e: unknown) => e instanceof FinanceProblem && e.code === "count_not_submitted");
    assert.equal((await listMyCountRequests(db, "3")).length, 1);
    // Synthetic external transfer violates the normal directory guard; it must
    // neither reveal the old branch count nor let a direct POST submit it.
    await pg.query("UPDATE public.users SET branch_id=2 WHERE id=3");
    assert.equal((await listMyCountRequests(db, "3")).length, 0);
    const beforeWrongBranch = (await pg.query(`SELECT (SELECT count(*)::int FROM finance.requests) AS requests,(SELECT count(*)::int FROM finance.audit_events) AS audit,(SELECT count(*)::int FROM finance.movements) AS movements`)).rows[0];
    await assert.rejects(() => submitHolderCount(db, "3", { requestId: req(), countId: directed.id, countedAmount: "1", actuallyCounted: true }), (e: unknown) => e instanceof FinanceProblem && e.code === "forbidden");
    assert.deepEqual((await pg.query(`SELECT (SELECT count(*)::int FROM finance.requests) AS requests,(SELECT count(*)::int FROM finance.audit_events) AS audit,(SELECT count(*)::int FROM finance.movements) AS movements`)).rows[0], beforeWrongBranch);
    assert.equal((await pg.query<{ counter_id: string | null }>("SELECT counter_id::text FROM finance.cash_counts WHERE id=$1::bigint", [directed.id])).rows[0].counter_id, null);
    await pg.query("UPDATE public.users SET branch_id=1 WHERE id=3");
    // A new holder-cash expense is blocked while the directed count is open;
    // the submitted observation must therefore retain the previous period.
    const laterExpense = await createExpense(db, "3", { requestId: req(), ...expenseDraft, amount: "20" });
    await approveExpense(db, "1", { requestId: req(), expenseId: laterExpense.id, expectedRevision: "1" });
    await assert.rejects(() => payExpense(db, "3", { requestId: req(), ...holderCashPayment(laterExpense.id, "2") }), (e: unknown) => e instanceof FinanceProblem && e.code === "holder_cash_count_open");
    const submit = { requestId: req(), countId: directed.id, countedAmount: "5280", actuallyCounted: true };
    await submitHolderCount(db, "3", submit);
    assert.equal((await submitHolderCount(db, "3", submit)).replayed, true);
    await pg.query("UPDATE public.users SET branch_id=2 WHERE id=3");
    await assert.rejects(() => submitHolderCount(db, "3", submit), (e: unknown) => e instanceof FinanceProblem && e.code === "forbidden", "replay cannot expose the old branch result");
    await pg.query("UPDATE public.users SET branch_id=1 WHERE id=3");
    assert.deepEqual(await countFields(directed.id), { observed: "5300.00", counted: "5280.00", difference: "-20.00", status: "OPEN" });
    await confirmCashCount(db, "1", { requestId: req(), countId: directed.id, reason: "تأكيد العجز", stillCurrent: true });
    assert.equal(await movementCount(pg), 2);
    assert.equal((await balances(pg))[custody.id], "1080.00");
    assert.equal((await settlementOverview(db, "3")).expected, "5280.00");
    const settlement = await requestSettlement(db, "3", { requestId: req(), accountId: custody.id, countedAmount: "5280", expectedBalance: "1080", reason: "تسوية بعد الجرد", actuallyCounted: true });
    await confirmSettlement(db, "1", { requestId: req(), settlementId: settlement.id, expectedBalance: "1080", transferAmount: "4200", transferDirection: "TO_VAULT", reason: "تسوية", actuallyTransferred: true });
    assert.equal((await balances(pg))[custody.id], "1080.00");
    assert.equal((await balances(pg))["1"], "14200.00");
    await addCashSale(pg, "1", "50");
    const legacy = await pg.query<{ id: string }>(`INSERT INTO finance.cash_counts(account_id,counted_amount,observed_balance,difference,account_revision,counted_on,reason,created_by,requested_by,counter_id) SELECT id,1080,1080,0,revision,CURRENT_DATE,'جرد قديم اصطناعي',1,1,3 FROM finance.accounts WHERE id=$1::bigint RETURNING id::text AS id`, [custody.id]);
    const beforeLegacy = await movementCount(pg);
    await assert.rejects(() => confirmCashCount(db, "1", { requestId: req(), countId: legacy.rows[0].id, reason: "قديم", stillCurrent: true }), (e: unknown) => e instanceof FinanceProblem && e.code === "count_stale");
    assert.equal(await movementCount(pg), beforeLegacy, "legacy ambiguous snapshots are not silently rewritten or posted");
  } finally { await pg.close(); }
});

test("settlement snapshot revision catches holder cash with equal transaction timestamps", { timeout: 180_000 }, async () => {
  const pg = await fresh();
  try {
    const db = adapter(pg);
    await openAccount(db, "1", opening("VAULT", null, "100"), today);
    const custody = await openAccount(db, "1", opening("CUSTODY", "3", "0"), today);
    await pg.query("UPDATE finance.accounts SET opened_at=now()-interval '1 day' WHERE id=$1::bigint", [custody.id]);
    const expense = await createExpense(db, "3", { requestId: req(), ...expenseDraft, amount: "9" });
    await approveExpense(db, "1", { requestId: req(), expenseId: expense.id, expectedRevision: "1" });
    const request = await requestSettlement(db, "3", { requestId: req(), accountId: custody.id, countedAmount: "0", expectedBalance: "0", reason: "جرد اصطناعي", actuallyCounted: true });
    const snapshot = (await pg.query<{ revision: string; snapshot: string }>(`SELECT a.revision::text AS revision,s.account_revision::text AS snapshot FROM finance.accounts a JOIN finance.settlements s ON s.account_id=a.id WHERE s.id=$1::bigint`, [request.id])).rows[0];
    assert.equal(snapshot.revision, snapshot.snapshot);
    const payment = { requestId: req(), ...holderCashPayment(expense.id, "2") };
    await payExpense(db, "3", payment, today);
    // Manufactured equality reproduces the timestamp boundary, independently of
    // wall-clock scheduling. The real payment already incremented the revision.
    await pg.query(`UPDATE finance.payments SET recorded_at=(SELECT created_at FROM finance.settlements WHERE id=$1::bigint) WHERE expense_id=$2::bigint`, [request.id, expense.id]);
    assert.equal((await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM finance.payments p JOIN finance.settlements s ON s.id=$1::bigint WHERE p.expense_id=$2::bigint AND p.recorded_at>s.created_at`, [request.id,expense.id])).rows[0].n, 0);
    const decision = { requestId: req(), settlementId: request.id, expectedBalance: "0", transferAmount: "0", transferDirection: "TO_VAULT", reason: "اعتماد اصطناعي", actuallyTransferred: true };
    await assert.rejects(() => confirmSettlement(db, "1", decision), (e: unknown) => e instanceof FinanceProblem && e.code === "count_stale");
    assert.deepEqual(await statuses(pg), ["OPEN"]); assert.equal(await movementCount(pg), 0);
    assert.equal((await payExpense(db, "3", payment, today)).replayed, true);
    await cancelSettlement(db, "3", { requestId: req(), settlementId: request.id, reason: "إلغاء وإعادة الجرد" });
    const replacement = await requestSettlement(db, "3", { requestId: req(), accountId: custody.id, countedAmount: "0", expectedBalance: "0", reason: "جرد جديد", actuallyCounted: true });
    const recheck = { ...decision, requestId: req(), settlementId: replacement.id };
    assert.equal((await confirmSettlement(db, "1", recheck)).replayed, false);
    assert.equal((await confirmSettlement(db, "1", recheck)).replayed, true);
    assert.equal((await pg.query<{ expenses: string }>("SELECT expenses_total::text AS expenses FROM finance.settlements WHERE id=$1::bigint", [replacement.id])).rows[0].expenses, "9.00");
  } finally { await pg.close(); }
});

test("legacy settlement without revision cannot be confirmed; migration is additive and cancellation remains possible", { timeout: 180_000 }, async () => {
  const pg = await fresh();
  try {
    const db = adapter(pg);
    await openAccount(db, "1", opening("VAULT", null, "0"), today);
    const custody = await openAccount(db, "1", opening("CUSTODY", "3", "0"), today);
    const request = await requestSettlement(db, "3", { requestId: req(), accountId: custody.id, countedAmount: "0", expectedBalance: "0", reason: "طلب قديم اصطناعي", actuallyCounted: true });
    await pg.exec("ALTER TABLE finance.settlements DROP COLUMN account_revision");
    const decision = { requestId: req(), settlementId: request.id, expectedBalance: "0", transferAmount: "0", transferDirection: "TO_VAULT", reason: "اعتماد اصطناعي", actuallyTransferred: true };
    await assert.rejects(() => confirmSettlement(db, "1", decision), (e: unknown) => e instanceof FinanceProblem && e.code === "count_stale");
    await assert.rejects(() => requestSettlement(db, "3", { requestId: req(), accountId: custody.id, countedAmount: "0", expectedBalance: "0", reason: "طلب اصطناعي آخر", actuallyCounted: true }), (e: unknown) => e instanceof FinanceProblem && e.code === "settlement_exists");
    const migration = read("prisma/manual-settlement-revision-upgrade.sql");
    await pg.exec(migration); await pg.exec(migration);
    assert.equal((await pg.query<{ revision: string | null }>("SELECT account_revision::text AS revision FROM finance.settlements WHERE id=$1::bigint", [request.id])).rows[0].revision, null);
    await assert.rejects(() => confirmSettlement(db, "1", decision), (e: unknown) => e instanceof FinanceProblem && e.code === "count_stale");
    await cancelSettlement(db, "3", { requestId: req(), settlementId: request.id, reason: "إلغاء طلب قديم" });
    await pg.exec("ALTER TABLE finance.settlements DROP COLUMN account_revision");
    await assert.rejects(() => requestSettlement(db, "3", { requestId: req(), accountId: custody.id, countedAmount: "0", expectedBalance: "0", reason: "بدون ترقية", actuallyCounted: true }), (e: unknown) => e instanceof FinanceProblem && e.code === "not_ready");
    assert.deepEqual(await statuses(pg), ["CANCELLED"]); assert.equal(await movementCount(pg), 0);
  } finally { await pg.close(); }
});

test("a legacy closed vault cannot receive or fund a settlement; replay remains safe", { timeout: 180_000 }, async () => {
  const pg = await fresh();
  try {
    const db = adapter(pg);
    const vault = await openAccount(db, "1", opening("VAULT", null, "100"), today);
    const custody = await openAccount(db, "1", opening("CUSTODY", "3", "100"), today);
    const pending = await requestSettlement(db, "3", { requestId: req(), accountId: custody.id, expectedBalance: "100", countedAmount: "90", reason: "طلب اصطناعي", actuallyCounted: true });
    // Application normally prohibits closing a vault. Simulate a legacy or
    // external bad state in the disposable DB; never repair actual data here.
    await pg.query("UPDATE finance.accounts SET closed_at=now(),closed_by=1 WHERE id=$1::bigint", [vault.id]);
    const command = { requestId: req(), settlementId: pending.id, expectedBalance: "100", transferAmount: "10", transferDirection: "TO_CUSTODY", reason: "تأكيد اصطناعي", actuallyTransferred: true };
    const snapshot = async () => (await pg.query(`SELECT
      (SELECT count(*)::int FROM finance.requests) AS requests,
      (SELECT count(*)::int FROM finance.audit_events) AS audit,
      (SELECT count(*)::int FROM finance.movements) AS movements,
      (SELECT jsonb_agg(jsonb_build_array(id::text,revision::text) ORDER BY id) FROM finance.accounts) AS revisions,
      (SELECT status FROM finance.settlements WHERE id=$1::bigint) AS status`, [pending.id])).rows[0];
    const before = await snapshot(); const beforeBalances = await balances(pg);
    await assert.rejects(() => confirmSettlement(db, "1", command), (error: unknown) => error instanceof FinanceProblem && error.code === "account_closed" && error.message.includes("خزنة الفرع مقفلة"));
    assert.deepEqual(await snapshot(), before); assert.deepEqual(await balances(pg), beforeBalances);
    await pg.query("UPDATE finance.accounts SET closed_at=NULL,closed_by=NULL WHERE id=$1::bigint", [vault.id]);
    assert.equal((await confirmSettlement(db, "1", command)).replayed, false);
    const committed = await snapshot();
    // A saved response is returned before new-state checks, without posting a
    // second movement, even if a legacy row is subsequently closed.
    await pg.query("UPDATE finance.accounts SET closed_at=now(),closed_by=1 WHERE id=$1::bigint", [vault.id]);
    assert.equal((await confirmSettlement(db, "1", command)).replayed, true);
    assert.deepEqual(await snapshot(), committed);
  } finally { await pg.close(); }
});

test("inconsistent settlement branch is rejected without posting; saved confirmation replays", { timeout: 180_000 }, async () => {
  const pg = await fresh();
  try {
    const db = adapter(pg);
    await openAccount(db, "1", opening("VAULT", null, "100"), today);
    const custody = await openAccount(db, "1", opening("CUSTODY", "3", "100"), today);
    const pending = await requestSettlement(db, "3", { requestId: req(), accountId: custody.id, expectedBalance: "100", countedAmount: "90", reason: "طلب اصطناعي", actuallyCounted: true });
    // SQL constraints permit a branch inconsistent with the referenced account.
    // This deliberately corrupt legacy fixture is not a data repair proposal.
    await pg.query("UPDATE finance.settlements SET branch_id=2 WHERE id=$1::bigint", [pending.id]);
    const command = { requestId: req(), settlementId: pending.id, expectedBalance: "100", transferAmount: "10", transferDirection: "TO_CUSTODY", reason: "تأكيد اصطناعي", actuallyTransferred: true };
    const snapshot = async () => (await pg.query(`SELECT
      (SELECT count(*)::int FROM finance.requests) AS requests,
      (SELECT count(*)::int FROM finance.audit_events) AS audit,
      (SELECT count(*)::int FROM finance.movements) AS movements,
      (SELECT jsonb_agg(jsonb_build_array(id::text,revision::text) ORDER BY id) FROM finance.accounts) AS revisions,
      (SELECT status FROM finance.settlements WHERE id=$1::bigint) AS status,
      (SELECT branch_id::text FROM finance.settlements WHERE id=$1::bigint) AS branch`, [pending.id])).rows[0];
    const before = await snapshot(); const beforeBalances = await balances(pg);
    await assert.rejects(() => confirmSettlement(db, "1", command), (error: unknown) => error instanceof FinanceProblem && error.code === "settlement_branch_mismatch");
    assert.deepEqual(await snapshot(), before); assert.deepEqual(await balances(pg), beforeBalances);
    await pg.query("UPDATE finance.settlements SET branch_id=1 WHERE id=$1::bigint", [pending.id]);
    assert.equal((await confirmSettlement(db, "1", command)).replayed, false);
    await pg.query("UPDATE finance.settlements SET branch_id=2 WHERE id=$1::bigint", [pending.id]);
    const committed = await snapshot(); const committedBalances = await balances(pg);
    assert.equal((await confirmSettlement(db, "1", command)).replayed, true);
    assert.deepEqual(await snapshot(), committed); assert.deepEqual(await balances(pg), committedBalances);
  } finally { await pg.close(); }
});


test("settlement accepts partial and zero transfer amounts; they are not proof of physical delivery", { timeout: 180_000 }, async () => {
  const pg = await fresh();
  try {
    const db = adapter(pg);
    const vault = await openAccount(db, "1", opening("VAULT", null, "10000"), today);
    const custody = await openAccount(db, "1", opening("CUSTODY", "3", "1000"), today);
    const one = await requestSettlement(db, "3", { requestId: req(), accountId: custody.id, countedAmount: "1500", expectedBalance: "1000", reason: "اختبار اصطناعي", actuallyCounted: true });
    const partial = { requestId: req(), settlementId: one.id, expectedBalance: "1000", transferAmount: "200", transferDirection: "TO_VAULT", reason: "تحويل جزئي اصطناعي", actuallyTransferred: true };
    await assert.rejects(() => confirmSettlement(db, "1", { ...partial, reason: "" }), (e: unknown) => e instanceof FinanceProblem && e.code === "invalid_input");
    await assert.rejects(() => confirmSettlement(db, "1", { ...partial, actuallyTransferred: false }), (e: unknown) => e instanceof FinanceProblem && e.code === "invalid_input");
    assert.deepEqual(await balances(pg), { [vault.id]: "10000.00", [custody.id]: "1000.00" });
    assert.deepEqual(await statuses(pg), ["OPEN"]);
    assert.equal(await movementCount(pg), 0);
    await confirmSettlement(db, "1", partial);
    assert.deepEqual(await balances(pg), { [vault.id]: "10200.00", [custody.id]: "1300.00" });
    assert.equal(await movementCount(pg), 2);
    const savedPartial = (await pg.query<{ transfer_amount: string; resolution_reason: string; transfer_direction: string }>(`SELECT transfer_amount::text,resolution_reason,transfer_direction FROM finance.settlements WHERE id=$1::bigint`, [one.id])).rows[0];
    assert.deepEqual(savedPartial, { transfer_amount: "200.00", resolution_reason: partial.reason, transfer_direction: "TO_VAULT" });
    assert.equal((await confirmSettlement(db, "1", partial)).replayed, true);
    await assert.rejects(() => confirmSettlement(db, "1", { ...partial, transferAmount: "100" }), (e: unknown) => e instanceof FinanceProblem && e.code === "request_conflict");
    assert.equal(await movementCount(pg), 2);
    const two = await requestSettlement(db, "3", { requestId: req(), accountId: custody.id, countedAmount: "1400", expectedBalance: "1300", reason: "اختبار آخر", actuallyCounted: true });
    await confirmSettlement(db, "1", { requestId: req(), settlementId: two.id, expectedBalance: "1300", transferAmount: "0", transferDirection: "TO_VAULT", reason: "لا تحويل اصطناعي", actuallyTransferred: true });
    assert.deepEqual(await balances(pg), { [vault.id]: "10200.00", [custody.id]: "1400.00" });
    assert.equal(await movementCount(pg), 3, "zero transfer creates no TRANSFER movement, but nonzero book adjustment remains");
    const row = (await pg.query<{ transfer_amount: string; handover_movement_id: string | null }>(`SELECT transfer_amount::text,handover_movement_id::text FROM finance.settlements WHERE id=$1::bigint`, [two.id])).rows[0];
    assert.deepEqual(row, { transfer_amount: "0.00", handover_movement_id: null });
  } finally { await pg.close(); }
});

test("multiple open custodies stop count, settlement and closure but permit cancellation and replay", { timeout: 120_000 }, async () => {
  const pg = await fresh();
  try {
    await pg.exec(read("prisma/manual-custody-and-count-requests.sql"));
    const db = adapter(pg);
    const { requestCashCount, confirmCashCount, cancelCashCount, requestCountFromHolder, submitHolderCount, closeAccount } = await import("../src/lib/finance/engine");
    await openAccount(db, "1", opening("VAULT", null, "100"), today);
    const custody = await openAccount(db, "1", opening("CUSTODY", "3", "0"), today);
    const count = await requestCashCount(db, "1", { requestId: req(), accountId: custody.id, countedAmount: "0", expectedBalance: "0", reason: "جرد اصطناعي", actuallyCounted: true }, today);
    const pendingInput = { requestId: req(), accountId: custody.id, countedAmount: "0", expectedBalance: "0", reason: "تسوية اصطناعية", actuallyCounted: true };
    const pending = await requestSettlement(db, "3", pendingInput);
    const indicator = async (branch: string) => (await pg.query<{ multiple: boolean; value: string }>(`SELECT x.multiple_custodies AS multiple,(x.bal+x.period_sales-x.period_expenses)::text AS value FROM (${CUSTODY_EXPECTATION_SQL}) x WHERE x.id=$2::bigint`, [branch,custody.id])).rows[0];
    const indicatorBefore = await indicator("1");
    assert.equal(indicatorBefore.multiple, false);
    // External legacy-style duplicate in another branch; not a supported opening workflow.
    await pg.query(`INSERT INTO finance.accounts(branch_id,kind,holder_id,opening_amount,opening_date,opened_by) VALUES(2,'CUSTODY',3,0,$1::date,1)`, [today]);
    const indicatorAfter = await indicator("1");
    assert.equal(indicatorAfter.multiple, true);
    assert.equal(indicatorAfter.value, indicatorBefore.value, "the warning must not rewrite or adjust aggregates");
    await pg.exec(`INSERT INTO users(branch_id,role_code,full_name,email,password_hash,status,must_change_password) VALUES (2,'CS_AGENT','موظف آخر اصطناعي','other-duplicate@example.test','fixture','ACTIVE',false)`);
    const unrelated = await openAccount(db, "1", opening("CUSTODY", "5", "0", "2"), today);
    const otherBranch = (await pg.query<{ id: string; multiple: boolean }>(`SELECT x.id::text AS id,x.multiple_custodies AS multiple FROM (${CUSTODY_EXPECTATION_SQL}) x ORDER BY x.id`, ["2"])).rows;
    assert.equal(otherBranch.find(row => row.id === unrelated.id)?.multiple, false);
    assert.equal(otherBranch.filter(row => row.multiple).length, 1);
    const blocked = (e: unknown) => e instanceof FinanceProblem && e.code === "multiple_open_custodies";
    assert.equal((await settlementOverview(db, "3")).multipleCustodies, true);
    assert.equal((await settlementOverview(db, "3")).account, null);
    const before = (await pg.query(`SELECT (SELECT count(*)::int FROM finance.requests) AS requests,(SELECT count(*)::int FROM finance.audit_events) AS audits,(SELECT count(*)::int FROM finance.movements) AS movements`)).rows[0];
    await assert.rejects(() => confirmCashCount(db, "1", { requestId: req(), countId: count.id, reason: "تأكيد", stillCurrent: true }), blocked);
    await assert.rejects(() => confirmSettlement(db, "1", { requestId: req(), settlementId: pending.id, expectedBalance: "0", transferAmount: "0", transferDirection: "TO_VAULT", reason: "تأكيد", actuallyTransferred: true }), blocked);
    assert.deepEqual((await pg.query(`SELECT (SELECT count(*)::int FROM finance.requests) AS requests,(SELECT count(*)::int FROM finance.audit_events) AS audits,(SELECT count(*)::int FROM finance.movements) AS movements`)).rows[0], before);
    await cancelCashCount(db, "1", { requestId: req(), countId: count.id, reason: "مراجعة العهد" });
    await cancelSettlement(db, "3", { requestId: req(), settlementId: pending.id, reason: "مراجعة العهد" });
    assert.equal((await requestSettlement(db, "3", pendingInput)).replayed, true);
    await assert.rejects(() => requestSettlement(db, "3", { requestId: req(), accountId: custody.id, countedAmount: "0", expectedBalance: "0", reason: "جديد", actuallyCounted: true }), blocked);
    await assert.rejects(() => requestCashCount(db, "1", { requestId: req(), accountId: custody.id, countedAmount: "0", expectedBalance: "0", reason: "جديد", actuallyCounted: true }, today), blocked);
    await assert.rejects(() => requestCountFromHolder(db, "1", { requestId: req(), accountId: custody.id, reason: "جرد موجّه" }), blocked);
    await assert.rejects(() => closeAccount(db, "1", { requestId: req(), accountId: custody.id, reason: "إقفال" }), blocked);
    // Synthetic legacy open directed count tests the submit path too.
    const directed = (await pg.query<{ id: string }>(`INSERT INTO finance.cash_counts(account_id,counted_amount,observed_balance,difference,account_revision,counted_on,reason,created_by,requested_by) VALUES ($1::bigint,0,0,0,0,CURRENT_DATE,'جرد قديم',1,1) RETURNING id::text`, [custody.id])).rows[0].id;
    await assert.rejects(() => submitHolderCount(db, "3", { requestId: req(), countId: directed, countedAmount: "0", actuallyCounted: true }), blocked);
    assert.equal(await movementCount(pg), 0);
    await cancelCashCount(db, "1", { requestId: req(), countId: directed, reason: "مراجعة" });
  } finally { await pg.close(); }
});

test("settlement and directed count replays check current holder scope but allow cancellation and closed-account replay", {timeout:180_000}, async()=>{
  const pg=await fresh();
  try {
    await pg.exec(read("prisma/manual-custody-and-count-requests.sql"));
    const db=adapter(pg);
    const {requestCountFromHolder,submitHolderCount,cancelCashCount,closeAccount}=await import("../src/lib/finance/engine");
    const account=await openAccount(db,"1",opening("CUSTODY","3","0"),today);
    const create={requestId:req(),accountId:account.id,countedAmount:"0",expectedBalance:"0",reason:"طلب اصطناعي",actuallyCounted:true};
    const settlement=await requestSettlement(db,"3",create);
    const directed=await requestCountFromHolder(db,"1",{requestId:req(),accountId:account.id,reason:"جرد اصطناعي"});
    const submit={requestId:req(),countId:directed.id,countedAmount:"0",actuallyCounted:true};
    const counted=await submitHolderCount(db,"3",submit);
    const snapshot=async()=> (await pg.query(`SELECT (SELECT count(*)::int FROM finance.requests) AS requests,(SELECT count(*)::int FROM finance.audit_events) AS audits,(SELECT count(*)::int FROM finance.movements) AS movements,(SELECT revision::text FROM finance.accounts WHERE id=$1::bigint) AS revision`,[account.id])).rows[0];
    const before=await snapshot();
    // Emulate an external move: normal directory operations prohibit it while
    // the custody remains open. Existing cancellation must stay available.
    await pg.exec("UPDATE users SET branch_id=2 WHERE id=3");
    const denied=(e:unknown)=>e instanceof FinanceProblem && e.code==="forbidden";
    await assert.rejects(()=>requestSettlement(db,"3",create),denied);
    await assert.rejects(()=>submitHolderCount(db,"3",submit),denied);
    const duplicate=()=>{let injected=false;return {get injected(){return injected;},db:{serializable:<T,>(work:(tx:FinanceTransaction)=>Promise<T>)=>db.serializable(tx=>work({...tx,query:async <R extends Record<string,unknown>>(sql:string,params?:unknown[])=>{
      if(!injected && sql.includes("FROM finance.requests")){injected=true;throw Object.assign(new Error("synthetic unique"),{code:"23505"});}
      return tx.query<R>(sql,params);
    }}))} satisfies FinanceDatabase};};
    const a=duplicate(),b=duplicate();
    await assert.rejects(()=>requestSettlement(a.db,"3",create),denied);
    await assert.rejects(()=>submitHolderCount(b.db,"3",submit),denied);
    assert.ok(a.injected && b.injected);assert.deepEqual(await snapshot(),before);
    const cancel={requestId:req(),settlementId:settlement.id,reason:"إلغاء اصطناعي"};
    const cancelled=await cancelSettlement(db,"3",cancel);
    assert.deepEqual(await cancelSettlement(db,"3",cancel),{id:cancelled.id,replayed:true});
    await pg.exec("UPDATE users SET branch_id=1 WHERE id=3");
    await cancelCashCount(db,"1",{requestId:req(),countId:directed.id,reason:"إلغاء اصطناعي"});
    await closeAccount(db,"1",{requestId:req(),accountId:account.id,reason:"إقفال اصطناعي"});
    const closed=await snapshot();
    assert.deepEqual(await requestSettlement(db,"3",create),{id:settlement.id,replayed:true});
    assert.deepEqual(await submitHolderCount(db,"3",submit),{id:counted.id,replayed:true});
    assert.deepEqual(await snapshot(),closed);
  } finally {await pg.close();}
});

test("staff transfer replay checks current custody and branch scope without reopening closed accounts", {timeout:180_000}, async()=>{
  const pg=await fresh();
  try {
    const db=adapter(pg);
    const {transferCash,closeAccount}=await import("../src/lib/finance/engine");
    const vault=await openAccount(db,"1",opening("VAULT",null,"0"),today);
    const custody=await openAccount(db,"1",opening("CUSTODY","3","10"),today);
    const input={requestId:req(),fromId:custody.id,toId:vault.id,amount:"10",expectedBalance:"10",actuallyTransferred:true,negativeAcknowledged:false};
    const result=await transferCash(db,"3",input);assert.equal(result.replayed,false);
    const snapshot=async()=> (await pg.query(`SELECT (SELECT count(*)::int FROM finance.movements) AS movements,(SELECT count(*)::int FROM finance.requests) AS requests,(SELECT count(*)::int FROM finance.audit_events) AS audits,(SELECT revision::text FROM finance.accounts WHERE id=$1::bigint) AS revision`,[custody.id])).rows[0];
    const before=await snapshot(),forbidden=(e:unknown)=>e instanceof FinanceProblem && e.code==="forbidden";
    assert.deepEqual(await transferCash(db,"3",input),{id:result.id,replayed:true});
    // Simulate a legacy/external move, which the normal directory blocks while
    // the custody remains open. Check both ordinary and duplicate recovery.
    await pg.exec("UPDATE users SET branch_id=2 WHERE id=3");
    await assert.rejects(()=>transferCash(db,"3",input),forbidden);
    let injected=false;
    const duplicate:FinanceDatabase={serializable:work=>db.serializable(tx=>work({...tx,query:async <T extends Record<string,unknown>>(sql:string,params?:unknown[])=>{
      if(!injected && sql.includes("FROM finance.requests")){injected=true;throw Object.assign(new Error("synthetic unique"),{code:"23505"});}
      return tx.query<T>(sql,params);
    }}))};
    await assert.rejects(()=>transferCash(duplicate,"3",input),forbidden);assert.equal(injected,true);
    assert.deepEqual(await snapshot(),before);
    await pg.exec("UPDATE users SET branch_id=1 WHERE id=3; UPDATE finance.accounts SET holder_id=1 WHERE holder_id=3");
    await assert.rejects(()=>transferCash(db,"3",input),forbidden);
    await pg.exec("UPDATE finance.accounts SET holder_id=3 WHERE holder_id=1 AND kind='CUSTODY'");
    await closeAccount(db,"1",{requestId:req(),accountId:custody.id,reason:"إقفال اصطناعي"});
    const closed=await snapshot();
    assert.deepEqual(await transferCash(db,"3",input),{id:result.id,replayed:true});
    assert.deepEqual(await snapshot(),closed,"replay does not create a movement or bump a revision");
  } finally {await pg.close();}
});


test("settlement cancellation replay rechecks owner or management without branch or open-state requirements", {timeout:180_000}, async()=>{
  const pg=await fresh();
  try {
    const db=adapter(pg);
    const custody=await openAccount(db,"1",opening("CUSTODY","3","0"),today);
    const create={requestId:req(),accountId:custody.id,countedAmount:"0",expectedBalance:"0",reason:"طلب اصطناعي",actuallyCounted:true};
    const settlement=await requestSettlement(db,"3",create);
    const cancel={requestId:req(),settlementId:settlement.id,reason:"إلغاء إداري اصطناعي"};
    await cancelSettlement(db,"2",cancel);
    assert.deepEqual(await cancelSettlement(db,"2",cancel),{id:settlement.id,replayed:true});
    const snapshot=async()=> (await pg.query(`SELECT (SELECT count(*)::int FROM finance.requests) AS requests,(SELECT count(*)::int FROM finance.audit_events) AS audits,(SELECT count(*)::int FROM finance.movements) AS movements,(SELECT status FROM finance.settlements WHERE id=$1::bigint) AS status`,[settlement.id])).rows[0];
    const before=await snapshot();
    // A formerly-authorized accountant no longer has administrative scope.
    await pg.exec("UPDATE users SET role_code='CS_AGENT',branch_id=1 WHERE id=2");
    const denied=(e:unknown)=>e instanceof FinanceProblem && e.code==="forbidden";
    await assert.rejects(()=>cancelSettlement(db,"2",cancel),denied);
    let injected=false;
    const duplicate:FinanceDatabase={serializable:work=>db.serializable(tx=>work({...tx,query:async <T extends Record<string,unknown>>(sql:string,params?:unknown[])=>{
      if(!injected && sql.includes("FROM finance.requests")){injected=true;throw Object.assign(new Error("synthetic unique"),{code:"23505"});}
      return tx.query<T>(sql,params);
    }}))};
    await assert.rejects(()=>cancelSettlement(duplicate,"2",cancel),denied);assert.equal(injected,true);
    assert.deepEqual(await snapshot(),before);
    // A current manager may still see their own saved decision.
    await pg.exec("UPDATE users SET role_code='ACCOUNTANT',branch_id=NULL WHERE id=2");
    assert.deepEqual(await cancelSettlement(db,"2",cancel),{id:settlement.id,replayed:true});
    assert.deepEqual(await snapshot(),before);
  } finally {await pg.close();}
});

test("count cancellation replay requires current management role even on duplicate recovery", {timeout:180_000}, async()=>{
  const pg=await fresh();
  try {
    await pg.exec(read("prisma/manual-custody-and-count-requests.sql"));
    const db=adapter(pg);
    const {requestCountFromHolder,cancelCashCount}=await import("../src/lib/finance/engine");
    const custody=await openAccount(db,"1",opening("CUSTODY","3","0"),today);
    const count=await requestCountFromHolder(db,"1",{requestId:req(),accountId:custody.id,reason:"جرد اصطناعي"});
    const cancel={requestId:req(),countId:count.id,reason:"إلغاء جرد اصطناعي"};
    await cancelCashCount(db,"2",cancel);
    assert.deepEqual(await cancelCashCount(db,"2",cancel),{id:count.id,replayed:true});
    const snapshot=async()=> (await pg.query(`SELECT (SELECT count(*)::int FROM finance.requests) AS requests,(SELECT count(*)::int FROM finance.audit_events) AS audits,(SELECT count(*)::int FROM finance.movements) AS movements,(SELECT revision::text FROM finance.accounts WHERE id=$1::bigint) AS revision,(SELECT status FROM finance.cash_counts WHERE id=$2::bigint) AS status`,[custody.id,count.id])).rows[0];
    const before=await snapshot();
    await pg.exec("UPDATE users SET role_code='CS_AGENT',branch_id=1 WHERE id=2");
    const denied=(e:unknown)=>e instanceof FinanceProblem && e.code==="forbidden";
    await assert.rejects(()=>cancelCashCount(db,"2",cancel),denied);
    let injected=false;
    // Reach duplicate recovery after the initial role check; the second
    // transaction simulates a role change between the two attempts.
    const duplicate:FinanceDatabase={serializable:work=>db.serializable(tx=>work({...tx,query:async <T extends Record<string,unknown>>(sql:string,params?:unknown[])=>{
      if(!injected && sql.includes("FROM finance.requests")){injected=true;throw Object.assign(new Error("synthetic unique"),{code:"23505"});}
      return tx.query<T>(sql,params);
    }}))};
    // To exercise recovery with a downgraded actor, give the first
    // transaction the saved manager role while leaving the database unchanged.
    let first=true;
    const demoted:FinanceDatabase={serializable:work=>duplicate.serializable(tx=>work({...tx,query:async <T extends Record<string,unknown>>(sql:string,params?:unknown[])=>{
      const result=await tx.query<T>(sql,params);
      if(first && sql.includes("FROM public.users")){first=false;return {rows:result.rows.map(row=>({...row,role:"ACCOUNTANT"})) as T[]};}
      return result;
    }}))};
    await assert.rejects(()=>cancelCashCount(demoted,"2",cancel),denied);assert.equal(injected,true);
    assert.deepEqual(await snapshot(),before);
    await pg.exec("UPDATE users SET role_code='ACCOUNTANT',branch_id=NULL WHERE id=2");
    assert.deepEqual(await cancelCashCount(db,"2",cancel),{id:count.id,replayed:true});
    assert.deepEqual(await snapshot(),before);
  } finally {await pg.close();}
});

test("settlement request replay rejects inconsistent stored result without changing data", {timeout:180_000}, async()=>{
  const pg=await fresh();
  try {
    const db=adapter(pg);
    const account=await openAccount(db,"1",opening("CUSTODY","3","0"),today);
    const input={requestId:req(),accountId:account.id,countedAmount:"0",expectedBalance:"0",reason:"طلب اصطناعي",actuallyCounted:true};
    const result=await requestSettlement(db,"3",input);
    const other=(await pg.query<{id:string}>(`INSERT INTO finance.settlements(account_id,branch_id,requested_by,system_balance,counted_amount,sales_total,expenses_total,expected_amount,deviation,adjustment,reason,account_revision,status,resolved_by,resolved_at,resolution_reason)
      VALUES($1::bigint,1,1,0,0,0,0,0,0,0,'نتيجة مختلفة اصطناعية',0,'CANCELLED',1,now(),'اختبار') RETURNING id::text`,[account.id])).rows[0].id;
    const snapshot=async()=> (await pg.query(`SELECT (SELECT count(*)::int FROM finance.requests) AS requests,(SELECT count(*)::int FROM finance.audit_events) AS audits,(SELECT count(*)::int FROM finance.movements) AS movements,(SELECT revision::text FROM finance.accounts WHERE id=$1::bigint) AS revision,(SELECT status FROM finance.settlements WHERE id=$2::bigint) AS status`,[account.id,result.id])).rows[0];
    const forbidden=(e:unknown)=>e instanceof FinanceProblem && e.code==="forbidden";
    await pg.query(`UPDATE finance.requests SET result_id=$1::bigint WHERE request_id=$2::uuid`,[other,input.requestId]);
    const before=await snapshot();
    await assert.rejects(()=>requestSettlement(db,"3",input),forbidden);
    let injected=false;
    const duplicate:FinanceDatabase={serializable:work=>db.serializable(tx=>work({...tx,query:async <T extends Record<string,unknown>>(sql:string,params?:unknown[])=>{
      if(!injected && sql.includes("FROM finance.requests")){injected=true;throw Object.assign(new Error("synthetic unique"),{code:"23505"});}
      return tx.query<T>(sql,params);
    }}))};
    await assert.rejects(()=>requestSettlement(duplicate,"3",input),forbidden);assert.ok(injected);
    assert.deepEqual(await snapshot(),before);
    await pg.query(`UPDATE finance.requests SET result_id=$1::bigint WHERE request_id=$2::uuid`,[result.id,input.requestId]);
    // Also fail closed on inconsistent account, branch or requester in the
    // referenced row, not merely on an unrelated result id.
    await pg.query(`UPDATE finance.settlements SET branch_id=2 WHERE id=$1::bigint`,[result.id]);
    await assert.rejects(()=>requestSettlement(db,"3",input),forbidden);
    await pg.query(`UPDATE finance.settlements SET branch_id=1,requested_by=1 WHERE id=$1::bigint`,[result.id]);
    await assert.rejects(()=>requestSettlement(db,"3",input),forbidden);
    await pg.query(`UPDATE finance.settlements SET requested_by=3 WHERE id=$1::bigint`,[result.id]);
    assert.deepEqual(await requestSettlement(db,"3",input),{id:result.id,replayed:true});
    assert.deepEqual(await snapshot(),before);
  } finally {await pg.close();}
});

test("count submission and cancellation replays reject a different stored result", {timeout:180_000}, async()=>{
  const pg=await fresh();
  try {
    await pg.exec(read("prisma/manual-custody-and-count-requests.sql"));
    const db=adapter(pg);
    const {requestCountFromHolder,submitHolderCount,cancelCashCount}=await import("../src/lib/finance/engine");
    const custody=await openAccount(db,"1",opening("CUSTODY","3","0"),today);
    const count=await requestCountFromHolder(db,"1",{requestId:req(),accountId:custody.id,reason:"جرد اصطناعي"});
    const submit={requestId:req(),countId:count.id,countedAmount:"0",actuallyCounted:true};
    await submitHolderCount(db,"3",submit);
    const cancel={requestId:req(),countId:count.id,reason:"إلغاء اصطناعي"};
    await cancelCashCount(db,"1",cancel);
    const settlement=await requestSettlement(db,"3",{requestId:req(),accountId:custody.id,countedAmount:"0",expectedBalance:"0",reason:"طلب اصطناعي",actuallyCounted:true});
    const cancelSettlementInput={requestId:req(),settlementId:settlement.id,reason:"إلغاء اصطناعي"};
    await cancelSettlement(db,"3",cancelSettlementInput);
    const snapshot=async()=> (await pg.query(`SELECT (SELECT count(*)::int FROM finance.requests) AS requests,(SELECT count(*)::int FROM finance.audit_events) AS audits,(SELECT count(*)::int FROM finance.movements) AS movements,(SELECT revision::text FROM finance.accounts WHERE id=$1::bigint) AS revision,(SELECT status FROM finance.cash_counts WHERE id=$2::bigint) AS count_status,(SELECT status FROM finance.settlements WHERE id=$3::bigint) AS settlement_status`,[custody.id,count.id,settlement.id])).rows[0];
    const before=await snapshot();
    for(const [id,original,invoke] of [
      [submit.requestId,count.id,()=>submitHolderCount(db,"3",submit)],
      [cancel.requestId,count.id,()=>cancelCashCount(db,"1",cancel)],
      [cancelSettlementInput.requestId,settlement.id,()=>cancelSettlement(db,"3",cancelSettlementInput)],
    ] as const){
      await pg.query(`UPDATE finance.requests SET result_id=999999 WHERE request_id=$1::uuid`,[id]);
      await assert.rejects(invoke,(e:unknown)=>e instanceof FinanceProblem && e.code==="forbidden");
      assert.deepEqual(await snapshot(),before);
      await pg.query(`UPDATE finance.requests SET result_id=$1::bigint WHERE request_id=$2::uuid`,[original,id]);
      assert.deepEqual(await invoke(),{id:original,replayed:true});
    }
    assert.deepEqual(await snapshot(),before);
  } finally {await pg.close();}
});

test("approval, rejection and count confirmation replays reject a mismatched stored result", { timeout: 180_000 }, async () => {
  const pg = await fresh();
  try {
    await pg.exec(read("prisma/manual-custody-and-count-requests.sql"));
    const db = adapter(pg);
    const { requestCashCount, confirmCashCount } = await import("../src/lib/finance/engine");
    const vault = await openAccount(db, "1", opening("VAULT", null, "10000"), today);
    const custody = await openAccount(db, "1", opening("CUSTODY", "3", "0"), today);

    const approved = await requestSettlement(db, "3", { requestId: req(), accountId: custody.id, countedAmount: "0", expectedBalance: "0", reason: "طلب اعتماد اصطناعي", actuallyCounted: true });
    const confirmation = { requestId: req(), settlementId: approved.id, expectedBalance: "0", transferAmount: "0", transferDirection: "TO_VAULT" as const, reason: "اعتماد اصطناعي", actuallyTransferred: true };
    await confirmSettlement(db, "1", confirmation);
    const rejected = await requestSettlement(db, "3", { requestId: req(), accountId: custody.id, countedAmount: "0", expectedBalance: "0", reason: "طلب رفض اصطناعي", actuallyCounted: true });
    const rejection = { requestId: req(), settlementId: rejected.id, reason: "رفض اصطناعي" };
    await rejectSettlement(db, "1", rejection);
    const count = await requestCashCount(db, "1", { requestId: req(), accountId: vault.id, expectedBalance: "10000", countedAmount: "10000", reason: "جرد اصطناعي", actuallyCounted: true }, today);
    const countConfirm = { requestId: req(), countId: count.id, reason: "تأكيد جرد اصطناعي", stillCurrent: true };
    await confirmCashCount(db, "1", countConfirm);

    const snapshot = async () => (await pg.query(`SELECT
      (SELECT count(*)::int FROM finance.requests) AS requests,
      (SELECT count(*)::int FROM finance.audit_events) AS audits,
      (SELECT count(*)::int FROM finance.movements) AS movements,
      (SELECT string_agg(status, ',' ORDER BY id) FROM finance.settlements) AS settlements,
      (SELECT string_agg(status, ',' ORDER BY id) FROM finance.cash_counts) AS counts,
      (SELECT string_agg(revision::text, ',' ORDER BY id) FROM finance.accounts) AS revisions`)).rows[0];
    const before = await snapshot();
    const forbidden = (e: unknown) => e instanceof FinanceProblem && e.code === "forbidden";
    let injected = false;
    const duplicate: FinanceDatabase = { serializable: work => db.serializable(tx => work({ ...tx, query: async <T extends Record<string, unknown>>(sql: string, params?: unknown[]) => {
      if (!injected && sql.includes("FROM finance.requests")) { injected = true; throw Object.assign(new Error("synthetic unique"), { code: "23505" }); }
      return tx.query<T>(sql, params);
    } })) };

    for (const [id, original, invoke] of [
      [confirmation.requestId, approved.id, (source?: FinanceDatabase) => confirmSettlement(source ?? db, "1", confirmation)],
      [rejection.requestId, rejected.id, (source?: FinanceDatabase) => rejectSettlement(source ?? db, "1", rejection)],
      [countConfirm.requestId, count.id, (source?: FinanceDatabase) => confirmCashCount(source ?? db, "1", countConfirm)],
    ] as const) {
      await pg.query(`UPDATE finance.requests SET result_id=999999 WHERE request_id=$1::uuid`, [id]);
      await assert.rejects(() => invoke(), forbidden);
      injected = false;
      await assert.rejects(() => invoke(duplicate), forbidden);
      assert.equal(injected, true, "duplicate recovery must reach the replay guard");
      assert.deepEqual(await snapshot(), before);
      await pg.query(`UPDATE finance.requests SET result_id=$1::bigint WHERE request_id=$2::uuid`, [original, id]);
      assert.deepEqual(await invoke(), { id: original, replayed: true });
      assert.deepEqual(await snapshot(), before);
    }
  } finally { await pg.close(); }
});

test("remaining decision replays reject a mismatched stored result", { timeout: 180_000 }, async () => {
  const pg = await fresh();
  try {
    await pg.exec(read("prisma/manual-custody-and-count-requests.sql"));
    const db = adapter(pg);
    const vault = await openAccount(db, "1", opening("VAULT", null, "10000"), today);
    const custody = await openAccount(db, "1", opening("CUSTODY", "3", "0"), today);

    const expense = await createExpense(db, "3", { requestId: req(), ...expenseDraft });
    const approval = { requestId: req(), expenseId: expense.id, expectedRevision: "1" };
    await approveExpense(db, "1", approval);
    const edit = { requestId: req(), expenseId: expense.id, expectedRevision: "2", reason: "تعديل اصطناعي", ...expenseDraft };
    await editUnpaidExpense(db, "1", edit);
    const count = await requestCashCount(db, "1", { requestId: req(), accountId: vault.id, expectedBalance: "10000", countedAmount: "10000", reason: "جرد ملغى اصطناعي", actuallyCounted: true }, today);
    const cancelCount = { requestId: req(), countId: count.id, reason: "إلغاء جرد اصطناعي" };
    await cancelCashCount(db, "1", cancelCount);
    const closure = { requestId: req(), accountId: custody.id, reason: "إقفال اصطناعي" };
    await closeAccount(db, "1", closure);

    const snapshot = async () => (await pg.query(`SELECT
      (SELECT count(*)::int FROM finance.requests) AS requests,
      (SELECT count(*)::int FROM finance.audit_events) AS audits,
      (SELECT count(*)::int FROM finance.movements) AS movements,
      (SELECT status FROM finance.expenses WHERE id=$1::bigint) AS expense_status,
      (SELECT revision::text FROM finance.expenses WHERE id=$1::bigint) AS expense_revision,
      (SELECT status FROM finance.cash_counts WHERE id=$2::bigint) AS count_status,
      (SELECT closed_at::text FROM finance.accounts WHERE id=$3::bigint) AS closed_at`, [expense.id, count.id, custody.id])).rows[0];
    const before = await snapshot();
    const forbidden = (e: unknown) => e instanceof FinanceProblem && e.code === "forbidden";
    let injected = false;
    const duplicate: FinanceDatabase = { serializable: work => db.serializable(tx => work({ ...tx, query: async <T extends Record<string, unknown>>(sql: string, params?: unknown[]) => {
      if (!injected && sql.includes("FROM finance.requests")) { injected = true; throw Object.assign(new Error("synthetic unique"), { code: "23505" }); }
      return tx.query<T>(sql, params);
    } })) };

    for (const [id, original, invoke] of [
      [approval.requestId, expense.id, (source?: FinanceDatabase) => approveExpense(source ?? db, "1", approval)],
      [edit.requestId, expense.id, (source?: FinanceDatabase) => editUnpaidExpense(source ?? db, "1", edit)],
      [cancelCount.requestId, count.id, (source?: FinanceDatabase) => cancelCashCount(source ?? db, "1", cancelCount)],
      [closure.requestId, custody.id, (source?: FinanceDatabase) => closeAccount(source ?? db, "1", closure)],
    ] as const) {
      await pg.query(`UPDATE finance.requests SET result_id=999999 WHERE request_id=$1::uuid`, [id]);
      await assert.rejects(() => invoke(), forbidden);
      injected = false;
      await assert.rejects(() => invoke(duplicate), forbidden);
      assert.equal(injected, true, "duplicate recovery must reach the replay guard");
      assert.deepEqual(await snapshot(), before);
      await pg.query(`UPDATE finance.requests SET result_id=$1::bigint WHERE request_id=$2::uuid`, [original, id]);
      assert.deepEqual(await invoke(), { id: original, replayed: true });
      assert.deepEqual(await snapshot(), before);
    }
  } finally { await pg.close(); }
});
