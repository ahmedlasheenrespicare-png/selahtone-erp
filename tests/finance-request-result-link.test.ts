/**
 * Disposable PGlite tests for the strict result-link design. No DATABASE_URL,
 * no business data, no production SQL execution. The link table is a lab draft.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { FinanceProblem, type FinanceDatabase, type FinanceTransaction } from "../src/lib/finance/types";
import {
  openAccount, createExpense, approveExpense, payExpense, requestCashCount,
  requestCustody, decideCustodyRequest,
} from "../src/lib/finance/engine";
import { appCategoryPort, createAppCategory, editAppCategory, snapshotOf } from "../src/lib/finance/app-categories";
import { createCandidateCategory, editCandidateCategory, listCandidateCategories } from "../src/lib/finance/categories";
import { custodyRequestSnapshot } from "../src/lib/finance/custody-request-snapshot";
import {
  RESULT_TABLES, RESULT_TABLE_BY_ACTION, DYNAMIC_RESULT_TABLE, resolveResultTable,
} from "../src/lib/finance/request-result-link";

const root = process.cwd(), read = (f: string) => readFileSync(path.join(root, f), "utf8");
const req = () => randomUUID();
const today = "2026-10-29";

function adapter(pg: PGlite): FinanceDatabase {
  return {
    serializable: work => pg.transaction(async tx => {
      await tx.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
      const port: FinanceTransaction = {
        query: async <T extends Record<string, unknown>>(sql: string, parameters: unknown[] = []) =>
          ({ rows: (await tx.query(sql, parameters)).rows as T[] }),
      };
      port.categoryPort = appCategoryPort(port);
      return work(port);
    }),
  };
}

async function fresh(): Promise<PGlite> {
  const pg = new PGlite();
  for (const f of ["tests/fixtures/inventory-baseline.sql", "tests/fixtures/finance-legacy-categories.sql", "tests/fixtures/commerce-collections.sql"]) await pg.exec(read(f));
  await pg.exec("SET selahtone.finance_release_candidate_test_only='yes'");
  await pg.exec("SET selahtone.finance_candidate_test_only='yes'");
  await pg.exec(read("prototypes/finance-release/release-candidate.test-only.sql"));
  await pg.exec(read("prisma/manual-settlement-upgrade.sql"));
  await pg.exec(read("prisma/manual-custody-closure-upgrade.sql"));
  await pg.exec(read("prisma/manual-custody-and-count-requests.sql"));
  await pg.exec("ALTER TABLE public.commerce_sales ADD COLUMN created_by_id bigint");
  return pg;
}

const opening = (kind: "VAULT" | "CUSTODY", holderId: string | null, amount: string, branchId = "1") =>
  ({ requestId: req(), branchId, kind, holderId, openingAmount: amount, openingDate: "2026-10-20", counted: true });
const expenseDraft = { branchId: "1", categoryId: "1", amount: "800", expenseDate: "2026-10-21", description: "مصروف موظف", beneficiary: "", documentNumber: "", taxAmount: "" };
const holderCashPayment = (expenseId: string, revision: string) => ({
  expenseId, expectedRevision: revision, method: "CASH", accountId: "", paymentDate: "2026-10-21", actuallyPaid: true,
  openingOrder: "", includedInOpening: false, afterCountId: "", afterCount: false, expectedBalance: "", negativeAcknowledged: false, source: "HOLDER_CASH",
});

async function linkRow(pg: PGlite, requestId: string) {
  return (await pg.query<{ action: string; actorId: string; resultTable: string; resultId: string }>(
    `SELECT action,actor_id::text AS "actorId",result_table AS "resultTable",result_id::text AS "resultId"
     FROM finance.request_results WHERE request_id=$1::uuid`, [requestId])).rows[0];
}
const forbidden = (e: unknown) => e instanceof FinanceProblem && e.code === "forbidden";

test("every engine command action has an explicit result-table mapping", () => {
  const source = read("src/lib/finance/engine.ts");
  const actions = [...source.matchAll(/command\(\s*db\s*,\s*actorId\w*\s*,\s*"([A-Z_]+)"/g)].map(m => m[1]);
  assert.ok(actions.length >= 27, "expected the finance engine command actions to be enumerated");
  for (const action of actions) {
    const mapped = RESULT_TABLE_BY_ACTION[action];
    assert.ok(mapped, `missing result-table mapping for ${action}`);
    assert.ok(mapped === DYNAMIC_RESULT_TABLE || RESULT_TABLES.has(mapped), `unwhitelisted table for ${action}`);
  }
  for (const [action, table] of Object.entries(RESULT_TABLE_BY_ACTION)) {
    assert.ok(table === DYNAMIC_RESULT_TABLE || RESULT_TABLES.has(table), `bad mapping for ${action}`);
  }
});

test("new commands save a strict result link; replays reject mismatched, missing and legacy links", { timeout: 180_000 }, async () => {
  const pg = await fresh();
  try {
    const db = adapter(pg);
    const vaultRaw = opening("VAULT", null, "10000");
    const vault = await openAccount(db, "1", vaultRaw, today);
    await openAccount(db, "1", opening("CUSTODY", "3", "0"), today);
    const expenseRaw = { requestId: req(), ...expenseDraft };
    const expense = await createExpense(db, "3", expenseRaw);
    const approval = { requestId: req(), expenseId: expense.id, expectedRevision: "1" };
    await approveExpense(db, "1", approval);
    const payment = { requestId: req(), ...holderCashPayment(expense.id, "2") };
    await payExpense(db, "3", payment, today);
    const countRaw = { requestId: req(), accountId: vault.id, expectedBalance: "10000", countedAmount: "10000", reason: "جرد رابط", actuallyCounted: true };
    const count = await requestCashCount(db, "1", countRaw, today);
    const categoryRaw = { requestId: req(), name: "بند رابط اصطناعي" };
    const category = await createAppCategory(db, "1", categoryRaw);
    const editRaw = { requestId: req(), categoryId: category.id, expectedSnapshot: snapshotOf({ id: category.id, code: "LEGACY", name: categoryRaw.name, active: true, revision: 1 }), name: "بند رابط معدل", active: false, reason: "تعديل رابط" };
    // Rebuild the snapshot from the stored row so the edit command accepts it.
    const stored = (await pg.query<{ id: string; code: string; name: string; active: boolean; revision: number }>(
      `SELECT p.id::text AS id,p.code,p.name_ar AS name,p.is_active AS active,COALESCE(r.revision,1) AS revision
       FROM public.expense_categories p LEFT JOIN finance.category_revisions r ON r.category_id=p.id WHERE p.id=$1::int`, [category.id])).rows[0];
    editRaw.expectedSnapshot = snapshotOf(stored);
    await editAppCategory(db, "1", editRaw);

    const expected: Array<[string, string, string]> = [
      [vaultRaw.requestId, "finance.accounts", vault.id],
      [expenseRaw.requestId, "finance.expenses", expense.id],
      [approval.requestId, "finance.expenses", expense.id],
      [payment.requestId, "finance.payments", (await linkRow(pg, payment.requestId)).resultId],
      [countRaw.requestId, "finance.cash_counts", count.id],
      [categoryRaw.requestId, "public.expense_categories", category.id],
      [editRaw.requestId, "public.expense_categories", category.id],
    ];
    for (const [requestId, table, resultId] of expected) {
      const link = await linkRow(pg, requestId);
      assert.ok(link, `missing link for ${requestId}`);
      assert.equal(link.resultTable, table);
      assert.equal(link.resultId, resultId);
    }
    assert.deepEqual(await createExpense(db, "3", expenseRaw), { id: expense.id, replayed: true });
    assert.deepEqual(await createAppCategory(db, "1", categoryRaw), { id: category.id, replayed: true });
    assert.deepEqual(await editAppCategory(db, "1", editRaw), { id: category.id, replayed: true });

    // A tampered finance.requests.result_id no longer matches the saved link.
    const snapshot = async () => (await pg.query<{ requests: number; links: number; expenses: number; audits: number }>(
      `SELECT (SELECT count(*)::int FROM finance.requests) AS requests,
              (SELECT count(*)::int FROM finance.request_results) AS links,
              (SELECT count(*)::int FROM finance.expenses) AS expenses,
              (SELECT count(*)::int FROM finance.audit_events) AS audits`)).rows[0];
    const before = await snapshot();
    await pg.query("UPDATE finance.requests SET result_id=999999 WHERE request_id=$1::uuid", [expenseRaw.requestId]);
    await assert.rejects(() => createExpense(db, "3", expenseRaw), forbidden);
    assert.deepEqual(await snapshot(), { ...before, requests: before.requests }, "no new request or write");
    await pg.query("UPDATE finance.requests SET result_id=$1::bigint WHERE request_id=$2::uuid", [expense.id, expenseRaw.requestId]);
    assert.deepEqual(await createExpense(db, "3", expenseRaw), { id: expense.id, replayed: true });

    // Strict policy: a saved request without a link is refused, including the
    // unique-conflict recovery path, and is not treated as a legacy replay.
    await pg.query("DELETE FROM finance.request_results WHERE request_id=$1::uuid", [expenseRaw.requestId]);
    await assert.rejects(() => createExpense(db, "3", expenseRaw), forbidden);
    let injected = false;
    const duplicate: FinanceDatabase = { serializable: work => db.serializable(tx => work({ ...tx, query: async <T extends Record<string, unknown>>(sql: string, params?: unknown[]) => {
      if (!injected && sql.includes("FROM finance.requests")) { injected = true; throw Object.assign(new Error("synthetic unique"), { code: "23505" }); }
      return tx.query<T>(sql, params);
    } })) };
    await assert.rejects(() => createExpense(duplicate, "3", expenseRaw), forbidden);
    assert.equal(injected, true, "23505 recovery must reach the link guard");
    assert.deepEqual(await snapshot(), { ...before, links: before.links - 1 }, "no write on strict refusal");

    // A truly old request row (same hash, no link) is still refused.
    const old = (await pg.query<{ hash: string; actor: string; action: string }>(
      `SELECT request_hash AS hash,actor_id::text AS actor,action FROM finance.requests WHERE request_id=$1::uuid`, [expenseRaw.requestId])).rows[0];
    await pg.query("DELETE FROM finance.requests WHERE request_id=$1::uuid", [expenseRaw.requestId]);
    await pg.query(`INSERT INTO finance.requests(request_id,request_hash,actor_id,action,result_id)
      VALUES($1::uuid,$2,$3::bigint,$4,$5::bigint)`, [expenseRaw.requestId, old.hash, old.actor, old.action, expense.id]);
    await assert.rejects(() => createExpense(db, "3", expenseRaw), forbidden);
    assert.deepEqual(await snapshot(), { ...before, links: before.links - 1 }, "legacy replay must not write");
  } finally { await pg.close(); }
});

test("CUSTODY_DECIDE resolves its result table from the decision, not a coincidental id", async () => {
  // No query is needed: the saved command payload must decide the table.
  const tx = { query: async () => { throw new Error("dynamic resolution must not guess from ids"); } } as unknown as FinanceTransaction;
  assert.equal(await resolveResultTable(tx, "CUSTODY_DECIDE", "1", { decision: "REJECT" }), "finance.custody_requests");
  assert.equal(await resolveResultTable(tx, "CUSTODY_DECIDE", "1", { decision: "APPROVE" }), "finance.accounts");
  await assert.rejects(() => resolveResultTable(tx, "CUSTODY_DECIDE", "1", {}), forbidden);
});

test("CUSTODY_DECIDE saves the strict link for reject and approve", { timeout: 180_000 }, async () => {
  const pg = await fresh();
  try {
    const db = adapter(pg);
    // Create account id 1 so a rejected custody request with id 1 collides with it.
    await openAccount(db, "1", opening("VAULT", null, "1000"), today);
    const rejectedRaw = { requestId: req(), amount: "100", reason: "طلب للرفض" };
    const rejected = await requestCustody(db, "3", rejectedRaw);
    assert.equal(rejected.id, "1", "synthetic id collision with the existing account");
    const reject = { requestId: req(), requestId2: rejected.id, decision: "REJECT" as const, reason: "رفض اصطناعي" };
    await decideCustodyRequest(db, "1", reject, today);
    assert.equal((await linkRow(pg, reject.requestId)).resultTable, "finance.custody_requests");
    assert.equal((await linkRow(pg, reject.requestId)).resultId, rejected.id);

    const approvedRaw = { requestId: req(), amount: "200", reason: "طلب للاعتماد" };
    const approved = await requestCustody(db, "3", approvedRaw);
    const row = (await pg.query<{ id: string; branchId: string; requesterId: string; amount: string; reason: string }>(
      `SELECT id::text AS id,branch_id::text AS "branchId",requester_id::text AS "requesterId",requested_amount::text AS amount,reason
       FROM finance.custody_requests WHERE id=$1::bigint`, [approved.id])).rows[0];
    const approve = { requestId: req(), requestId2: approved.id, decision: "APPROVE" as const, reason: "اعتماد اصطناعي", openingDate: "2026-10-20", counted: true, expectedSnapshot: custodyRequestSnapshot(row) };
    const opened = await decideCustodyRequest(db, "1", approve, today);
    assert.equal((await linkRow(pg, approve.requestId)).resultTable, "finance.accounts");
    assert.equal((await linkRow(pg, approve.requestId)).resultId, opened.id);
    assert.deepEqual(await decideCustodyRequest(db, "1", approve, today), { id: opened.id, replayed: true });
  } finally { await pg.close(); }
});

test("ported category bridge saves and checks the finance result link", { timeout: 180_000 }, async () => {
  const pg = await fresh();
  try {
    const db = adapter(pg);
    const createRaw = { requestId: req(), name: "بند الجسر المنقول" };
    const created = await createCandidateCategory(db, "1", createRaw);
    const createLink = await linkRow(pg, createRaw.requestId);
    assert.ok(createLink, "the ported CREATE request must carry a link");
    assert.equal(createLink.action, "CREATE");
    assert.equal(createLink.resultTable, "public.expense_categories");
    assert.equal(createLink.resultId, created.id);
    assert.deepEqual(await createCandidateCategory(db, "1", createRaw), { id: created.id, replayed: true });

    const row = (await listCandidateCategories(db, "1")).find(r => r.id === created.id)!;
    const editRaw = { requestId: req(), categoryId: created.id, expectedSnapshot: row.snapshot, name: "بند الجسر المعدل", active: false, reason: "تعديل رابط" };
    await editCandidateCategory(db, "1", editRaw);
    const editLink = await linkRow(pg, editRaw.requestId);
    assert.ok(editLink, "the ported EDIT request must carry a link");
    assert.equal(editLink.action, "EDIT");
    assert.equal(editLink.resultTable, "public.expense_categories");
    assert.equal(editLink.resultId, created.id);
    assert.deepEqual(await editCandidateCategory(db, "1", editRaw), { id: created.id, replayed: true });

    // A tampered category_id no longer matches the saved link.
    await pg.query("UPDATE finance.category_requests SET category_id=1 WHERE request_id=$1::uuid", [createRaw.requestId]);
    await assert.rejects(() => createCandidateCategory(db, "1", createRaw), forbidden);
    await pg.query("UPDATE finance.category_requests SET category_id=$1::int WHERE request_id=$2::uuid", [created.id, createRaw.requestId]);

    // Strict: a saved request without a link is refused, including 23505 recovery.
    await pg.query("DELETE FROM finance.request_results WHERE request_id=$1::uuid", [createRaw.requestId]);
    await assert.rejects(() => createCandidateCategory(db, "1", createRaw), forbidden);
    let injected = false;
    const duplicate: FinanceDatabase = { serializable: work => db.serializable(tx => work({
      ...tx,
      query: async <T extends Record<string, unknown>>(sql: string, parameters?: unknown[]) => {
        if (!injected && sql.includes("FROM finance.category_requests")) {
          injected = true;
          throw Object.assign(new Error("synthetic unique"), { code: "23505" });
        }
        return tx.query<T>(sql, parameters);
      },
    })) };
    await assert.rejects(() => createCandidateCategory(duplicate, "1", createRaw), forbidden);
    assert.equal(injected, true, "23505 recovery must reach the link guard");

    // A truly old request row (same hash, no link) is still refused.
    const old = (await pg.query<{ hash: string; actor: string; action: string }>(
      `SELECT request_hash AS hash,actor_id::text AS actor,action FROM finance.category_requests WHERE request_id=$1::uuid`,
      [createRaw.requestId])).rows[0];
    await pg.query("DELETE FROM finance.category_requests WHERE request_id=$1::uuid", [createRaw.requestId]);
    await pg.query(`INSERT INTO finance.category_requests(request_id,request_hash,actor_id,action,category_id)
      VALUES($1::uuid,$2,$3::bigint,$4,$5::int)`, [createRaw.requestId, old.hash, old.actor, old.action, created.id]);
    await assert.rejects(() => createCandidateCategory(db, "1", createRaw), forbidden);
  } finally { await pg.close(); }
});
