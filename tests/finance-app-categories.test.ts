/**
 * Verifies the application category bridge (src/lib/finance/app-categories)
 * against the reviewed finance schema on a disposable database: it writes to a
 * COPY of the legacy public.expense_categories table, keeps old ids and codes,
 * records revision/audit/idempotency, and refuses staff. Never touches DATABASE_URL.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { appCategoryPort, createAppCategory, editAppCategory, snapshotOf } from "../src/lib/finance/app-categories";
import { createExpense, listCategories } from "../src/lib/finance/engine";
import { FinanceProblem, type FinanceDatabase, type FinanceTransaction } from "../src/lib/finance/types";

const root = process.cwd(), read = (f: string) => readFileSync(path.join(root, f), "utf8");
const candidate = read("prototypes/finance-release/release-candidate.test-only.sql");
const req = () => randomUUID();

async function fixture(): Promise<{ pg: PGlite; db: FinanceDatabase }> {
  const pg = new PGlite();
  for (const f of ["tests/fixtures/inventory-baseline.sql", "tests/fixtures/finance-legacy-categories.sql"]) await pg.exec(read(f));
  await pg.exec("SET selahtone.finance_release_candidate_test_only='yes'");
  await pg.exec(candidate);
  const db: FinanceDatabase = {
    serializable: (work) => pg.transaction(async (tx) => {
      await tx.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
      const port: FinanceTransaction = { query: async <T extends Record<string, unknown>>(sql: string, parameters: unknown[] = []) => ({ rows: (await tx.query(sql, parameters)).rows as T[] }) };
      port.categoryPort = appCategoryPort(port);
      return work(port);
    }),
  };
  return { pg, db };
}

test("management adds a category without touching the legacy rows", { timeout: 120_000 }, async () => {
  const { pg, db } = await fixture();
  try {
    const before = await pg.query<{ id: number; code: string; name: string }>("SELECT id,code,name_ar AS name FROM public.expense_categories ORDER BY id");
    assert.equal(before.rows.length, 7);
    const created = await createAppCategory(db, "1", { requestId: req(), name: "صيانة أجهزة" });
    const after = await pg.query<{ id: number; code: string; name: string; active: boolean }>("SELECT id,code,name_ar AS name,is_active AS active FROM public.expense_categories ORDER BY id");
    assert.equal(after.rows.length, 8);
    // The seven legacy rows are byte-identical: nothing was copied or rewritten.
    assert.deepEqual(after.rows.slice(0, 7).map((row) => ({ id: row.id, code: row.code, name: row.name })), before.rows);
    const revision = await pg.query<{ revision: number }>("SELECT revision FROM finance.category_revisions WHERE category_id=$1::int", [created.id]);
    assert.deepEqual(revision.rows, [{ revision: 1 }]);
    const audit = await pg.query<{ action: string }>("SELECT action FROM finance.category_audit WHERE category_id=$1::int", [created.id]);
    assert.deepEqual(audit.rows, [{ action: "CREATE" }]);
    // The engine lists it through the same port, so a new expense can use it.
    const listed = await listCategories(db, "1");
    assert.ok(listed.some((category) => category.id === created.id && category.active));
  } finally { await pg.close(); }
});

test("the same request id never creates a second category, staff never can", { timeout: 120_000 }, async () => {
  const { pg, db } = await fixture();
  try {
    const requestId = req();
    const first = await createAppCategory(db, "1", { requestId, name: "نقل" });
    const replay = await createAppCategory(db, "1", { requestId, name: "نقل" });
    assert.equal(replay.id, first.id);
    assert.equal(replay.replayed, true);
    const conflict = await createAppCategory(db, "1", { requestId, name: "اسم آخر" }).catch((error: unknown) => error);
    assert.ok(conflict instanceof FinanceProblem, "a reused request id with different data must be refused");
    const total = await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM public.expense_categories");
    assert.equal(total.rows[0].n, 8);
    // Role is re-read from the database, so a staff session is refused here.
    await assert.rejects(() => createAppCategory(db, "3", { requestId: req(), name: "مصروف موظف" }), /للمدير والمحاسب فقط/);
    const duplicate = await createAppCategory(db, "1", { requestId: req(), name: "نقل" }).catch((error: unknown) => error);
    assert.ok(duplicate instanceof FinanceProblem && duplicate.code === "category_duplicate", "a duplicate name must be refused");
  } finally { await pg.close(); }
});

test("editing keeps history: snapshot guard, revision bump and deactivation", { timeout: 120_000 }, async () => {
  const { pg, db } = await fixture();
  try {
    const created = await createAppCategory(db, "1", { requestId: req(), name: "قرطاسية" });
    const readRow = async () => (await pg.query<{ id: string; code: string; name: string; active: boolean; revision: number }>(
      `SELECT p.id::text AS id,p.code,p.name_ar AS name,p.is_active AS active,COALESCE(r.revision,1) AS revision
       FROM public.expense_categories p LEFT JOIN finance.category_revisions r ON r.category_id=p.id WHERE p.id=$1::int`, [created.id])).rows[0];
    const before = await readRow();
    // A stale snapshot is refused and changes nothing.
    const stale = await editAppCategory(db, "1", { requestId: req(), categoryId: created.id, expectedSnapshot: "f".repeat(64), name: "قرطاسية ومكتبية", active: true, reason: "توسيع الاسم" })
      .catch((error: unknown) => error);
    assert.ok(stale instanceof FinanceProblem && stale.code === "category_changed", "a stale snapshot must be refused");
    assert.deepEqual(await readRow(), before);

    // A correct snapshot renames the category and bumps its revision.
    await editAppCategory(db, "1", { requestId: req(), categoryId: created.id, expectedSnapshot: snapshotOf(before), name: "قرطاسية ومكتبية", active: true, reason: "توسيع الاسم" });
    const renamed = await readRow();
    assert.equal(renamed.name, "قرطاسية ومكتبية");
    assert.equal(renamed.revision, before.revision + 1);
    const audits = await pg.query<{ action: string }>("SELECT action FROM finance.category_audit WHERE category_id=$1::int ORDER BY id", [created.id]);
    assert.deepEqual(audits.rows.map((row) => row.action), ["CREATE", "EDIT"]);

    // Deactivation stops new expenses without deleting anything.
    await editAppCategory(db, "1", { requestId: req(), categoryId: created.id, expectedSnapshot: snapshotOf(renamed), name: renamed.name, active: false, reason: "إيقاف مؤقت" });
    const off = await readRow();
    assert.equal(off.active, false);
    await assert.rejects(() => createExpense(db, "1", { requestId: req(), branchId: "1", categoryId: created.id, amount: "5", expenseDate: "2026-10-22", description: "بعد الإيقاف", beneficiary: "", documentNumber: "", taxAmount: "" }), /بند المصروف متوقف/);
    const total = await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM public.expense_categories");
    assert.equal(total.rows[0].n, 8, "deactivation never deletes a category");
  } finally { await pg.close(); }
});
