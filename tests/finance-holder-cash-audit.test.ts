/** Disposable direct-engine tests for the temporary holder-cash guard. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { approveExpense, cancelCashCount, closeAccount, confirmCashCount, createExpense, openAccount, payExpense, requestCashCount, settlementOverview } from "../src/lib/finance/engine";
import { FinanceProblem, type FinanceDatabase, type FinanceTransaction } from "../src/lib/finance/types";

test("holder-cash requires the recorder as requester and an open branch custody", { timeout: 120_000 }, async () => {
  const pg = new PGlite(); const sql = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  try {
    for (const file of ["tests/fixtures/inventory-baseline.sql", "tests/fixtures/finance-legacy-categories.sql", "tests/fixtures/commerce-collections.sql"]) await pg.exec(sql(file));
    await pg.exec("ALTER TABLE public.commerce_sales ADD COLUMN created_by_id bigint; SET selahtone.finance_release_candidate_test_only='yes'");
    for (const file of ["prototypes/finance-release/release-candidate.test-only.sql", "prisma/manual-settlement-upgrade.sql", "prisma/manual-custody-closure-upgrade.sql", "prisma/manual-custody-and-count-requests.sql"]) await pg.exec(sql(file));
    const db: FinanceDatabase = { serializable: (work) => pg.transaction(async (tx) => {
      await tx.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
      const port: FinanceTransaction = { query: async <T extends Record<string, unknown>>(query: string, params: unknown[] = []) => ({ rows: (await tx.query(query, params)).rows as T[] }) };
      return work(port);
    }) };
    const today = "2026-11-07";
    const custody = await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "CUSTODY", holderId: "3", openingAmount: "0", openingDate: "2026-10-20", counted: true }, today);
    const expense = await createExpense(db, "3", { requestId: randomUUID(), branchId: "1", categoryId: "1", amount: "12", expenseDate: "2026-10-21", description: "مصروف اصطناعي" });
    await approveExpense(db, "1", { requestId: randomUUID(), expenseId: expense.id, expectedRevision: "1" });
    const raw = { requestId: randomUUID(), expenseId: expense.id, expectedRevision: "2", method: "CASH", accountId: null, paymentDate: "2026-11-07", actuallyPaid: true, source: "HOLDER_CASH" };
    await pg.exec("UPDATE users SET branch_id=2 WHERE id=3");
    await assert.rejects(() => payExpense(db, "3", raw, today), (e: unknown) => e instanceof FinanceProblem && e.code === "forbidden");
    await pg.exec("UPDATE users SET branch_id=1 WHERE id=3");
    await closeAccount(db, "1", { requestId: randomUUID(), accountId: custody.id, reason: "إقفال اصطناعي" });
    await assert.rejects(() => payExpense(db, "1", raw, today), (e: unknown) => e instanceof FinanceProblem && e.code === "holder_cash_on_behalf");
    await assert.rejects(() => payExpense(db, "3", raw, today), (e: unknown) => e instanceof FinanceProblem && e.code === "account_closed");
    const state = (await pg.query<{ status: string; payments: number; movements: number }>(`SELECT status,(SELECT count(*)::int FROM finance.payments) AS payments,(SELECT count(*)::int FROM finance.movements) AS movements FROM finance.expenses WHERE id=$1::bigint`, [expense.id])).rows[0];
    assert.deepEqual(state, { status: "APPROVED", payments: 0, movements: 0 });
    assert.equal((await settlementOverview(db, "3")).account, null);
    // A recorder without a custody cannot use holder cash, even if management.
    await pg.exec("UPDATE users SET branch_id=1 WHERE id=1");
    const own = await createExpense(db, "1", { requestId: randomUUID(), branchId: "1", categoryId: "1", amount: "9", expenseDate: "2026-10-21", description: "مصروف مسجل اصطناعي" });
    await approveExpense(db, "2", { requestId: randomUUID(), expenseId: own.id, expectedRevision: "1" });
    const ownPay = { ...raw, requestId: randomUUID(), expenseId: own.id };
    await assert.rejects(() => payExpense(db, "1", ownPay, today), (e: unknown) => e instanceof FinanceProblem && e.code === "holder_custody_unavailable");
    const managerCustody = await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "CUSTODY", holderId: "1", openingAmount: "0", openingDate: "2026-10-20", counted: true }, today);
    await pg.query("UPDATE finance.accounts SET opened_at=now() - interval '1 day' WHERE id=$1::bigint", [managerCustody.id]);
    const count = await requestCashCount(db, "2", { requestId: randomUUID(), accountId: managerCustody.id, expectedBalance: "0", countedAmount: "0", reason: "جرد اصطناعي", actuallyCounted: true }, today);
    await assert.rejects(() => payExpense(db, "1", ownPay, today), (e: unknown) => e instanceof FinanceProblem && e.code === "holder_cash_count_open");
    assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance.payments")).rows[0].n, 0);
    await cancelCashCount(db, "2", { requestId: randomUUID(), countId: count.id, reason: "إلغاء جرد قديم" });
    const snapshot = async () => (await pg.query<{ status: string; expense_revision: string; account_revision: string; payments: number; movements: number; audits: number; requests: number }>(`SELECT
      e.status,e.revision::text AS expense_revision,
      (SELECT revision::text FROM finance.accounts WHERE id=$2::bigint) AS account_revision,
      (SELECT count(*)::int FROM finance.payments) AS payments,
      (SELECT count(*)::int FROM finance.movements) AS movements,
      (SELECT count(*)::int FROM finance.audit_events) AS audits,
      (SELECT count(*)::int FROM finance.requests) AS requests
      FROM finance.expenses e WHERE e.id=$1::bigint`, [own.id,managerCustody.id])).rows[0];
    // Fail after the request identity and all service writes were executed but
    // before commit: even audit, revisions and request identity must roll back.
    let reached = false;
    const failing: FinanceDatabase = { serializable: work => db.serializable(tx => work({ ...tx, query: async <T extends Record<string,unknown>>(query: string, params?: unknown[]) => {
      const result = await tx.query<T>(query,params);
      if (query.includes("INSERT INTO finance.requests")) { reached = true; throw new Error("synthetic failure after payment request"); }
      return result;
    }})) };
    const before = await snapshot();
    await assert.rejects(() => payExpense(failing, "1", ownPay, today), /synthetic failure after payment request/);
    assert.equal(reached,true);
    assert.deepEqual(await snapshot(),before,"payment, status, revisions, audit and request identity roll back together");
    assert.equal((await payExpense(db, "1", ownPay, today)).replayed, false);
    const saved = await snapshot();
    assert.equal(saved.status,"PAID");
    assert.equal(BigInt(saved.expense_revision),BigInt(before.expense_revision)+1n);
    assert.equal(BigInt(saved.account_revision),BigInt(before.account_revision)+1n);
    assert.equal(saved.payments,before.payments+1);
    assert.equal(saved.movements,before.movements,"holder cash creates no immediate movement");
    assert.equal(saved.audits,before.audits+1); assert.equal(saved.requests,before.requests+1);
    assert.equal((await payExpense(db, "1", ownPay, today)).replayed, true);
    assert.deepEqual(await snapshot(),saved,"replay has no additional effect");
    await assert.rejects(() => payExpense(db,"1",{...ownPay,paymentDate:"2026-11-06"},today), (e: unknown) => e instanceof FinanceProblem && e.code === "request_conflict");
    assert.deepEqual(await snapshot(),saved,"conflicting replay has no effect");
    const overview = await settlementOverview(db, "1", managerCustody.id);
    assert.equal(overview.expenses, "9.00"); assert.equal(overview.account?.balance, "0.00");
    await assert.rejects(() => closeAccount(db, "2", { requestId: randomUUID(), accountId: managerCustody.id, reason: "إقفال" }), (e: unknown) => e instanceof FinanceProblem && e.code === "account_unsettled");
    // A successful request remains replayable even if a count is opened later.
    const postCount = await requestCashCount(db, "2", { requestId: randomUUID(), accountId: managerCustody.id, expectedBalance: "-9", countedAmount: "0", reason: "جرد بعد الدفع", actuallyCounted: true }, today);
    assert.equal((await payExpense(db, "1", ownPay, today)).replayed, true);
    await confirmCashCount(db, "2", { requestId: randomUUID(), countId: postCount.id, reason: "اعتماد جرد تجريبي", stillCurrent: true });
    assert.equal((await payExpense(db, "1", ownPay, today)).replayed, true);
    const afterCountExpense = await createExpense(db, "1", { requestId: randomUUID(), branchId: "1", categoryId: "1", amount: "3", expenseDate: "2026-10-21", description: "صرف بعد جرد" });
    await approveExpense(db, "2", { requestId: randomUUID(), expenseId: afterCountExpense.id, expectedRevision: "1" });
    await assert.rejects(() => payExpense(db, "1", { ...ownPay, requestId: randomUUID(), expenseId: afterCountExpense.id }, today), (e: unknown) => e instanceof FinanceProblem && e.code === "holder_cash_after_count");
    // Legacy/replay behavior: an already committed request remains idempotent
    // even if an account is later closed; no second payment or revision bump.
    const revisionBefore = (await pg.query<{ revision: string }>("SELECT revision::text AS revision FROM finance.accounts WHERE id=$1::bigint", [managerCustody.id])).rows[0].revision;
    await pg.query("UPDATE finance.accounts SET closed_at=now(),closed_by=2 WHERE id=$1::bigint", [managerCustody.id]);
    assert.equal((await payExpense(db, "1", ownPay, today)).replayed, true);
    assert.equal((await pg.query<{ revision: string }>("SELECT revision::text AS revision FROM finance.accounts WHERE id=$1::bigint", [managerCustody.id])).rows[0].revision, revisionBefore);
    assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance.payments")).rows[0].n, 1);
    assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance.movements")).rows[0].n, 1, "only the synthetic count adjustment exists");
  } finally { await pg.close(); }
});

test("holder-cash replay rechecks current staff branch without reapplying new-write guards", { timeout:120_000 }, async () => {
  const pg=new PGlite();
  try {
    for(const file of ["tests/fixtures/inventory-baseline.sql","tests/fixtures/finance-legacy-categories.sql","tests/fixtures/commerce-collections.sql"]) await pg.exec(readFileSync(file,"utf8"));
    await pg.exec("ALTER TABLE public.commerce_sales ADD COLUMN created_by_id bigint; SET selahtone.finance_release_candidate_test_only='yes'");
    for(const file of ["prototypes/finance-release/release-candidate.test-only.sql","prisma/manual-settlement-upgrade.sql","prisma/manual-custody-closure-upgrade.sql","prisma/manual-custody-and-count-requests.sql"]) await pg.exec(readFileSync(file,"utf8"));
    const db:FinanceDatabase={serializable:work=>pg.transaction(async tx=>{
      await tx.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
      return work({query:async <T extends Record<string,unknown>>(query:string,params:unknown[]=[])=>({rows:(await tx.query(query,params)).rows as T[]})});
    })};
    const today="2026-11-07";
    const custody=await openAccount(db,"1",{requestId:randomUUID(),branchId:"1",kind:"CUSTODY",holderId:"3",openingAmount:"0",openingDate:"2026-10-20",counted:true},today);
    const expense=await createExpense(db,"3",{requestId:randomUUID(),branchId:"1",categoryId:"1",amount:"8",expenseDate:"2026-11-07",description:"صرف اصطناعي"});
    await approveExpense(db,"1",{requestId:randomUUID(),expenseId:expense.id,expectedRevision:"1"});
    const input={requestId:randomUUID(),expenseId:expense.id,expectedRevision:"2",method:"CASH",accountId:null,paymentDate:today,actuallyPaid:true,source:"HOLDER_CASH"};
    const saved=await payExpense(db,"3",input,today);assert.equal(saved.replayed,false);
    const snapshot=async()=> (await pg.query<{n:number;rev:string}>(`SELECT (SELECT count(*)::int FROM finance.payments) AS n,(SELECT revision::text FROM finance.accounts WHERE id=$1::bigint) AS rev`,[custody.id])).rows[0];
    const before=await snapshot();
    // Synthetic external transfer illustrates historical replay scope; the
    // ordinary directory forbids moving a holder with an open custody.
    await pg.exec("UPDATE users SET branch_id=2 WHERE id=3");
    const forbidden=(e:unknown)=>e instanceof FinanceProblem && e.code==="forbidden";
    await assert.rejects(()=>payExpense(db,"3",input,today),forbidden);
    let injected=false;
    const duplicate:FinanceDatabase={serializable:work=>db.serializable(tx=>work({...tx,query:async <T extends Record<string,unknown>>(q:string,p?:unknown[])=>{
      if(!injected && q.includes("FROM finance.requests")){injected=true;throw Object.assign(new Error("synthetic duplicate conflict"),{code:"23505"});}
      return tx.query<T>(q,p);
    }}))};
    await assert.rejects(()=>payExpense(duplicate,"3",input,today),forbidden);
    assert.equal(injected,true);assert.deepEqual(await snapshot(),before);
    await pg.exec("UPDATE users SET branch_id=1 WHERE id=3; UPDATE finance.accounts SET closed_at=now(),closed_by=1 WHERE holder_id=3");
    assert.deepEqual(await payExpense(db,"3",input,today),{id:saved.id,replayed:true},"closed account must not invalidate matching authorized replay");
    assert.deepEqual(await snapshot(),before);
  } finally {await pg.close();}
});
