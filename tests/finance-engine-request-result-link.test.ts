/**
 * Disposable PGlite tests for the strict request -> result link in the
 * STANDALONE finance_lab engine. No DATABASE_URL, no business data, no
 * production SQL, no proof of a cash movement.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { FinanceProblem, type FinanceDatabase, type FinanceTransaction } from "../prototypes/finance-engine/types";
import { openAccount, addCategory, createExpense, approveExpense } from "../prototypes/finance-engine/engine";
import {
  RESULT_TABLES, RESULT_TABLE_BY_ACTION, DYNAMIC_CATEGORY_TABLE, resolveResultTable,
} from "../prototypes/finance-engine/request-result-link";

const schema = readFileSync("prototypes/finance-engine/schema.test-only.sql", "utf8");
const req = () => randomUUID();
const today = "2026-10-29";
const forbidden = (e: unknown) => e instanceof FinanceProblem && e.code === "forbidden";

function adapter(pg: PGlite): FinanceDatabase {
  return { serializable: work => pg.transaction(async tx => {
    await tx.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
    const executor: FinanceTransaction = {
      query: async (sql, parameters = []) => ({ rows: (await tx.query(sql, parameters)).rows as never[] }),
    };
    return work(executor);
  }) };
}
async function fresh(): Promise<{ pg: PGlite; db: FinanceDatabase }> {
  const pg = new PGlite();
  await pg.exec("SET selahtone.finance_lab_test_only = 'yes'");
  await pg.exec(schema);
  await pg.exec(`INSERT INTO finance_lab.branches(id,name_ar,is_active) VALUES(1,'فرع تجريبي',TRUE),(2,'فرع آخر',TRUE);
    INSERT INTO finance_lab.users(id,branch_id,role_code,status,must_change_password,full_name) VALUES
    (1,NULL,'MANAGER','ACTIVE',FALSE,'مدير'),(2,NULL,'ACCOUNTANT','ACTIVE',FALSE,'محاسب');`);
  return { pg, db: adapter(pg) };
}
const opening = (extra: Record<string, unknown> = {}) => ({
  requestId: req(), branchId: "1", kind: "VAULT", holderId: null,
  openingAmount: "1000.00", openingDate: "2026-10-20", counted: true, ...extra,
});
const expense = (categoryId: string) => ({
  requestId: req(), branchId: "1", categoryId, amount: "114.00", expenseDate: "2026-10-19",
  description: "مصروف تجريبي", beneficiary: "جهة اختبار", documentNumber: "DEMO-1", taxAmount: "14.00",
});

async function linkRow(pg: PGlite, requestId: string) {
  return (await pg.query<{ action: string; actorId: string; resultTable: string; resultId: string }>(
    `SELECT action,actor_id::text AS "actorId",result_table AS "resultTable",result_id::text AS "resultId"
     FROM finance_lab.request_results WHERE request_id=$1::uuid`, [requestId])).rows[0];
}
async function counts(pg: PGlite) {
  return (await pg.query<{ requests: number; links: number; accounts: number; expenses: number }>(
    `SELECT (SELECT count(*)::int FROM finance_lab.requests) AS requests,
            (SELECT count(*)::int FROM finance_lab.request_results) AS links,
            (SELECT count(*)::int FROM finance_lab.accounts) AS accounts,
            (SELECT count(*)::int FROM finance_lab.expenses) AS expenses`)).rows[0];
}

test("every lab command action has an explicit, whitelisted result table", () => {
  const source = readFileSync("prototypes/finance-engine/engine.ts", "utf8");
  const actions = [...source.matchAll(/command\(\s*db\s*,\s*actorId\w*\s*,\s*"([A-Z_]+)"/g)].map(m => m[1]);
  assert.equal(actions.length, 19, "expected the 19 lab command actions");
  for (const action of actions) {
    const mapped = RESULT_TABLE_BY_ACTION[action];
    assert.ok(mapped, `missing result-table mapping for ${action}`);
    assert.ok(mapped === DYNAMIC_CATEGORY_TABLE || RESULT_TABLES.has(mapped), `unwhitelisted table for ${action}`);
  }
  for (const [action, table] of Object.entries(RESULT_TABLE_BY_ACTION)) {
    assert.ok(table === DYNAMIC_CATEGORY_TABLE || RESULT_TABLES.has(table), `bad mapping for ${action}`);
  }
});

test("the lab category link follows the explicit bridge, not a guessed table", async () => {
  const throwing = { query: async () => { throw new Error("resolution must not query"); } } as unknown as FinanceTransaction;
  assert.equal(await resolveResultTable(throwing, "CATEGORY_CREATE", "1"), "finance_lab.categories");
  const bridged = { ...throwing, categoryPort: {} } as unknown as FinanceTransaction;
  assert.equal(await resolveResultTable(bridged, "CATEGORY_EDIT", "1"), "public.expense_categories");
  assert.equal(await resolveResultTable(throwing, "OPEN_ACCOUNT", "1"), "finance_lab.accounts");
  await assert.rejects(() => resolveResultTable(throwing, "UNKNOWN_ACTION", "1"), forbidden);
});

test("lab commands save strict links; replay refuses tampered, missing and legacy links", { timeout: 180_000 }, async () => {
  const { pg, db } = await fresh();
  try {
    const openRaw = opening();
    const vault = await openAccount(db, "1", openRaw, today);
    const categoryRaw = { requestId: req(), name: "صيانة رابط مخبري" };
    const category = await addCategory(db, "2", categoryRaw);
    const expenseRaw = expense(category.id);
    const saved = await createExpense(db, "1", expenseRaw);
    const approvalRaw = { requestId: req(), expenseId: saved.id, expectedRevision: "1" };
    await approveExpense(db, "2", approvalRaw);

    const expected: Array<[string, string, string]> = [
      [openRaw.requestId, "finance_lab.accounts", vault.id],
      [categoryRaw.requestId, "finance_lab.categories", category.id],
      [expenseRaw.requestId, "finance_lab.expenses", saved.id],
      [approvalRaw.requestId, "finance_lab.expenses", saved.id],
    ];
    for (const [requestId, table, resultId] of expected) {
      const link = await linkRow(pg, requestId);
      assert.ok(link, `missing link for ${requestId}`);
      assert.equal(link.resultTable, table);
      assert.equal(link.resultId, resultId);
    }
    assert.deepEqual(await openAccount(db, "1", openRaw, today), { id: vault.id, replayed: true });
    assert.deepEqual(await addCategory(db, "2", categoryRaw), { id: category.id, replayed: true });
    assert.deepEqual(await createExpense(db, "1", expenseRaw), { id: saved.id, replayed: true });

    const before = await counts(pg);
    // A tampered finance_lab.requests.result_id no longer matches the link.
    await pg.query("UPDATE finance_lab.requests SET result_id=999999 WHERE request_id=$1::uuid", [expenseRaw.requestId]);
    await assert.rejects(() => createExpense(db, "1", expenseRaw), forbidden);
    assert.deepEqual(await counts(pg), before, "tampered replay writes nothing");
    await pg.query("UPDATE finance_lab.requests SET result_id=$1::bigint WHERE request_id=$2::uuid", [saved.id, expenseRaw.requestId]);
    assert.deepEqual(await createExpense(db, "1", expenseRaw), { id: saved.id, replayed: true });

    // Strict: a saved request without a link is refused, including 23505 recovery.
    await pg.query("DELETE FROM finance_lab.request_results WHERE request_id=$1::uuid", [expenseRaw.requestId]);
    await assert.rejects(() => createExpense(db, "1", expenseRaw), forbidden);
    let injected = false;
    const duplicate: FinanceDatabase = { serializable: work => db.serializable(tx => work({
      ...tx,
      query: async <T extends Record<string, unknown>>(sql: string, parameters?: unknown[]) => {
        if (!injected && sql.includes("FROM finance_lab.requests")) {
          injected = true;
          throw Object.assign(new Error("synthetic unique"), { code: "23505" });
        }
        return tx.query<T>(sql, parameters);
      },
    })) };
    await assert.rejects(() => createExpense(duplicate, "1", expenseRaw), forbidden);
    assert.equal(injected, true, "23505 recovery must reach the link guard");
    assert.deepEqual(await counts(pg), { ...before, links: before.links - 1 }, "no write on strict refusal");

    // A truly old request row (same hash, no link) is still refused.
    const old = (await pg.query<{ hash: string; actor: string; action: string }>(
      `SELECT request_hash AS hash,actor_id::text AS actor,action FROM finance_lab.requests WHERE request_id=$1::uuid`,
      [expenseRaw.requestId])).rows[0];
    await pg.query("DELETE FROM finance_lab.requests WHERE request_id=$1::uuid", [expenseRaw.requestId]);
    await pg.query(`INSERT INTO finance_lab.requests(request_id,request_hash,actor_id,action,result_id)
      VALUES($1::uuid,$2,$3::bigint,$4,$5::bigint)`, [expenseRaw.requestId, old.hash, old.actor, old.action, saved.id]);
    await assert.rejects(() => createExpense(db, "1", expenseRaw), forbidden);
    assert.deepEqual(await counts(pg), { ...before, links: before.links - 1 }, "legacy replay must not write");
  } finally { await pg.close(); }
});
