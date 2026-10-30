/**
 * Verifies the employee-custody settlement engine against the reviewed candidate
 * schema plus the manual settlement upgrade, on a disposable database.
 * The rules under test: requesting never moves money, confirmation is atomic,
 * the difference is settled in full in the right direction, expenses paid from
 * the employee's cash are never deducted twice, and permissions hold.
 * Never touches DATABASE_URL. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { FinanceDatabase, FinanceTransaction } from "../src/lib/finance/types";
import {
  approveExpense, cancelSettlement, confirmSettlement, createExpense, listSettlements,
  openAccount, payExpense, rejectSettlement, requestSettlement, settlementOverview,
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
  return pg;
}

async function addCashSale(pg: PGlite, branchId: string, amount: string): Promise<void> {
  const sale = await pg.query<{ id: number }>("INSERT INTO public.commerce_sales(branch_id) VALUES ($1::bigint) RETURNING id", [branchId]);
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
