/**
 * Verifies the PORTED finance engine (src/lib/finance/engine) against the
 * reviewed candidate schema on a disposable database. It uses the real public
 * tables (users/branches/expense_categories) instead of the lab stand-ins, so a
 * wrong table or column in the port fails here. Never touches DATABASE_URL. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { FinanceDatabase, FinanceTransaction } from "../src/lib/finance/types";
import { approveExpense, confirmCashCount, createExpense, listAccounts, listCategories, listExpenses, listSelectableCategories, openAccount, payExpense, requestCashCount, transferCash } from "../src/lib/finance/engine";

const root = process.cwd(), read = (f: string) => readFileSync(path.join(root, f), "utf8");
const candidate = read("prototypes/finance-release/release-candidate.test-only.sql");
const settlementUpgrade = read("prisma/manual-settlement-upgrade.sql");
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
const opening = (kind: "VAULT" | "CUSTODY", holderId: string | null, amount: string) =>
  ({ requestId: req(), branchId: "1", kind, holderId, openingAmount: amount, openingDate: "2026-10-20", counted: true });

test("ported engine works on the candidate schema with the real public tables", { timeout: 120_000 }, async () => {
  const pg = new PGlite();
  try {
    for (const f of ["tests/fixtures/inventory-baseline.sql", "tests/fixtures/finance-legacy-categories.sql"]) await pg.exec(read(f));
    await pg.exec("SET selahtone.finance_release_candidate_test_only='yes'");
    await pg.exec(candidate);
    await pg.exec(settlementUpgrade);
    const db = adapter(pg);
    const balance = async (id: string) => (await listAccounts(db, "1")).find(a => a.id === id)!.balance;
    const count = async () => Number((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance.movements")).rows[0].n);
    const categories = (await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM public.expense_categories")).rows[0].n;
    assert.equal(categories, 7);

    assert.deepEqual((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance.accounts")).rows[0], { n: 0 });
    // A branch vault and an employee custody, opened only by management.
    await assert.rejects(() => openAccount(db, "3", opening("VAULT", null, "1000"), today));
    const vault = (await openAccount(db, "1", opening("VAULT", null, "1000"), today)).id;
    const custody = (await openAccount(db, "2", opening("CUSTODY", "3", "100"), today)).id;
    assert.equal(await balance(vault), "1000.00");
    await transferCash(db, "1", { requestId: req(), fromId: vault, toId: custody, amount: "250", expectedBalance: "1000", actuallyTransferred: true, negativeAcknowledged: false });
    assert.equal(await balance(vault), "750.00"); assert.equal(await balance(custody), "350.00");

    // An expense uses an EXISTING legacy category by its real id.
    const draft = await createExpense(db, "1", { requestId: req(), branchId: "1", categoryId: "1", amount: "40", expenseDate: "2026-10-21", description: "مصروف منقول", beneficiary: "", documentNumber: "", taxAmount: "" });
    await approveExpense(db, "2", { requestId: req(), expenseId: draft.id, expectedRevision: "1" });
    await payExpense(db, "2", { requestId: req(), expenseId: draft.id, expectedRevision: "2", method: "CASH", accountId: vault, paymentDate: "2026-10-21", actuallyPaid: true, expectedBalance: "750", negativeAcknowledged: false }, today);
    assert.equal(await balance(vault), "710.00"); assert.equal(await count(), 2);

    // Two-step cash count: an observation changes nothing until it is confirmed.
    const observed = await requestCashCount(db, "1", { requestId: req(), accountId: vault, expectedBalance: "710", countedAmount: "700", reason: "جرد منقول", actuallyCounted: true }, today);
    assert.equal(await balance(vault), "710.00");
    await confirmCashCount(db, "1", { requestId: req(), countId: observed.id, reason: "تأكيد الجرد", stillCurrent: true });
    assert.equal(await balance(vault), "700.00");

    // Legacy rows are untouched by every finance operation above.
    assert.deepEqual((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM public.expenses")).rows[0], { n: 0 });
    assert.deepEqual((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM public.journal_entries")).rows[0], { n: 0 });
    assert.deepEqual((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM public.expense_categories")).rows[0], { n: 7 });
    // The staged app code must not create a lab stand-in schema by accident.
    assert.equal((await pg.query<{ value: string | null }>("SELECT to_regnamespace('finance_lab')::text AS value")).rows[0].value, null);
  } finally { await pg.close(); }
});

test("branch staff records an expense for their own branch only", { timeout: 120_000 }, async () => {
  const pg = new PGlite();
  try {
    for (const f of ["tests/fixtures/inventory-baseline.sql", "tests/fixtures/finance-legacy-categories.sql"]) await pg.exec(read(f));
    await pg.exec("SET selahtone.finance_release_candidate_test_only='yes'");
    await pg.exec(candidate);
    await pg.exec(settlementUpgrade);
    const db = adapter(pg);
    // خزنة الفرع 1 (المستخدم 3 موظف في الفرع نفسه، والمستخدم 1 مدير، و2 محاسب).
    await openAccount(db, "1", opening("VAULT", null, "1000"), today);

    const draft = { branchId: "1", categoryId: "1", amount: "40", expenseDate: "2026-10-21", description: "مصروف موظف", beneficiary: "", documentNumber: "", taxAmount: "" };
    const created = await createExpense(db, "3", { requestId: req(), ...draft });
    assert.ok(created.id);

    // لا يسجّل الموظف مصروفًا لفرع آخر، ولا يعتمد مصروفًا.
    await assert.rejects(() => createExpense(db, "3", { requestId: req(), ...draft, branchId: "2" }));
    await assert.rejects(() => approveExpense(db, "3", { requestId: req(), expenseId: created.id, expectedRevision: "1" }));

    // يرى مصروفاته هو فقط، وتبقى حالته بانتظار الاعتماد.
    const own = await listExpenses(db, "3");
    assert.equal(own.length, 1);
    assert.equal(own[0].id, created.id);
    assert.equal(own[0].requestedBy, "3");
    assert.equal(own[0].status, "PENDING");
    assert.equal(own[0].approvedBy, null);

    // الإدارة ترى نفس المصروف، وتظل رؤية الموظف محدودة بعد مصروف إداري جديد.
    await createExpense(db, "1", { requestId: req(), ...draft, amount: "10", description: "مصروف إدارة" });
    assert.equal((await listExpenses(db, "3")).length, 1);
    assert.equal((await listExpenses(db, "1")).length, 2);
  } finally { await pg.close(); }
});

test("branch staff reads the active categories needed to record an expense", { timeout: 120_000 }, async () => {
  const pg = new PGlite();
  try {
    for (const f of ["tests/fixtures/inventory-baseline.sql", "tests/fixtures/finance-legacy-categories.sql"]) await pg.exec(read(f));
    await pg.exec("SET selahtone.finance_release_candidate_test_only='yes'");
    await pg.exec(candidate);
    await pg.exec(settlementUpgrade);
    const db = adapter(pg);

    // إدارة البنود للمدير والمحاسب فقط: قائمة البنود الكاملة مرفوضة للموظف.
    await assert.rejects(() => listCategories(db, "3"));
    assert.equal((await listCategories(db, "1")).length, 7);

    // الموظف يقرأ البنود النشطة فقط ليسجّل مصروفه؛ البند الموقوف (٦) لا يظهر له.
    const selectable = await listSelectableCategories(db, "3");
    assert.equal(selectable.length, 6);
    assert.equal(selectable.every((category) => category.active), true);
    assert.equal(selectable.some((category) => category.id === "6"), false);

    const created = await createExpense(db, "3", { requestId: req(), branchId: "1", categoryId: selectable[0].id, amount: "12", expenseDate: "2026-10-21", description: "مصروف موظف", beneficiary: "", documentNumber: "", taxAmount: "" });
    assert.ok(created.id);
  } finally { await pg.close(); }
});
