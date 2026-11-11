/** Isolated closed-account correction audit; never connects to production. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { closeAccount, closePaidExpenseReview, confirmCashCount, confirmPaidExpenseCorrection, correctOpeningBalance, listAccounts, openAccount, payExpense, requestCashCount, requestPaidExpenseReview } from "../src/lib/finance/engine";
import { expenseReviewSnapshot } from "../src/lib/finance/expense-review-snapshot";
import { FinanceProblem, type FinanceDatabase, type FinanceTransaction } from "../src/lib/finance/types";

test("closed account correction movement audit", { timeout: 120_000 }, async () => {
  const pg = new PGlite(); const read = (file: string) => readFileSync(file, "utf8");
  try {
    for (const file of ["tests/fixtures/inventory-baseline.sql", "tests/fixtures/finance-legacy-categories.sql", "tests/fixtures/commerce-collections.sql"]) await pg.exec(read(file));
    await pg.exec("ALTER TABLE public.commerce_sales ADD COLUMN created_by_id bigint");
    await pg.exec("SET selahtone.finance_release_candidate_test_only='yes'");
    for (const file of ["prototypes/finance-release/release-candidate.test-only.sql", "prisma/manual-settlement-upgrade.sql", "prisma/manual-custody-closure-upgrade.sql"]) await pg.exec(read(file));
    const db: FinanceDatabase = { serializable: (work) => pg.transaction(async (tx) => {
      await tx.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
      return work({ query: async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => ({ rows: (await tx.query(sql, params)).rows as T[] }) } as FinanceTransaction);
    }) };
    const custody = (await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "CUSTODY", holderId: "3", openingAmount: "10", openingDate: "2026-10-20", counted: true }, "2026-11-07")).id;
    const expense = await pg.query<{ id: number }>(`INSERT INTO finance.expenses(branch_id,category_id,category_snapshot,amount,expense_date,description,status,requested_by,approved_by,approved_at)
      VALUES(1,1,'اختبار',10,'2026-10-21','اختبار تصحيح','APPROVED',3,1,CURRENT_TIMESTAMP) RETURNING id`);
    const expenseId = String(expense.rows[0].id);
    await payExpense(db, "1", { requestId: randomUUID(), expenseId, expectedRevision: "1", method: "CASH", accountId: custody, paymentDate: "2026-10-21", actuallyPaid: true, expectedBalance: "10", source: "ACCOUNT" }, "2026-11-07");
    const review = await requestPaidExpenseReview(db, "1", { requestId: randomUUID(), expenseId, expectedRevision: "2", reason: "مراجعة المبلغ", proposedAmount: "5" });
    await closeAccount(db, "1", { requestId: randomUUID(), accountId: custody, reason: "إقفال تجريبي" });
    await assert.rejects(() => confirmPaidExpenseCorrection(db, "2", { requestId: randomUUID(), reviewId: review.id, confirmedAmount: "5", reason: "تصحيح اختباري", verifiedPayment: true, noPriorSettlement: true, expectedBalance: "0" }),
      (error: unknown) => error instanceof FinanceProblem && error.code === "account_closed");
    await assert.rejects(() => correctOpeningBalance(db, "1", { requestId: randomUUID(), accountId: custody, expectedOpening: "10", correctedOpening: "20", expectedBalance: "0", verifiedOpening: true, noPriorSettlement: true, reason: "تصحيح افتتاح" }),
      (error: unknown) => error instanceof FinanceProblem && error.code === "account_closed");
    assert.equal((await listAccounts(db, "1"))[0].balance, "0.00");
    assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance.movements")).rows[0].n, 1, "only original payment movement remains");
    assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance.opening_corrections")).rows[0].n, 0);
    assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance.expense_corrections")).rows[0].n, 0);
    assert.equal((await pg.query<{ status: string }>("SELECT status FROM finance.expense_reviews WHERE id=$1", [review.id])).rows[0].status, "OPEN");
    const getReview = async () => (await pg.query<{ id:string; expenseId:string; expenseRevision:number; status:string; reason:string; proposedAmount:string|null; createdBy:string; createdAt:string }>(`SELECT id::text AS id,expense_id::text AS "expenseId",expense_revision AS "expenseRevision",status,reason,proposed_amount::text AS "proposedAmount",created_by::text AS "createdBy",created_at::text AS "createdAt" FROM finance.expense_reviews WHERE id=$1::bigint`, [review.id])).rows[0];
    const close = { requestId: randomUUID(), reviewId: review.id, reason: "إغلاق دون تصحيح", reviewedNoChange: true, expectedRevision: "2", expectedReviewSnapshot: expenseReviewSnapshot(await getReview()) };
    const snapshot = async () => (await pg.query<{ requests: number; audit: number; movements: number; corrections: number; revision: number }>(`SELECT (SELECT count(*)::int FROM finance.requests) AS requests,
      (SELECT count(*)::int FROM finance.audit_events) AS audit, (SELECT count(*)::int FROM finance.movements) AS movements,
      (SELECT count(*)::int FROM finance.expense_corrections) AS corrections,
      (SELECT revision FROM finance.expenses WHERE id=$1::bigint) AS revision`, [expenseId])).rows[0];
    const before = await snapshot();
    await assert.rejects(() => closePaidExpenseReview(db, "1", close), (e: unknown) => e instanceof FinanceProblem && e.code === "self_review_close");
    await assert.rejects(() => closePaidExpenseReview(db, "3", close), (e: unknown) => e instanceof FinanceProblem && e.code === "forbidden");
    await assert.rejects(() => closePaidExpenseReview(db, "2", { ...close, reviewedNoChange: false }), (e: unknown) => e instanceof FinanceProblem && e.code === "invalid_input");
    await assert.rejects(() => closePaidExpenseReview(db, "2", { ...close, reason: " " }), (e: unknown) => e instanceof FinanceProblem && e.code === "invalid_input");
    await assert.rejects(() => closePaidExpenseReview(db, "2", { ...close, expectedRevision: "1" }), (e: unknown) => e instanceof FinanceProblem && e.code === "revision_changed");
    await assert.rejects(() => closePaidExpenseReview(db, "2", { ...close, expectedRevision: undefined }), (e: unknown) => e instanceof FinanceProblem && e.code === "invalid_input");
    await assert.rejects(() => closePaidExpenseReview(db, "2", { ...close, expectedReviewSnapshot: undefined }), (e: unknown) => e instanceof FinanceProblem && e.code === "invalid_input");
    await pg.query("UPDATE finance.expense_reviews SET reason='سبب معدل اصطناعي' WHERE id=$1::bigint", [review.id]);
    await assert.rejects(() => closePaidExpenseReview(db, "2", close), (e: unknown) => e instanceof FinanceProblem && e.code === "review_changed");
    await pg.query("UPDATE finance.expense_reviews SET reason='مراجعة المبلغ' WHERE id=$1::bigint", [review.id]);
    assert.equal(expenseReviewSnapshot(await getReview()), close.expectedReviewSnapshot);
    assert.deepEqual(await snapshot(), before);
    // Fail after the review status, both audit entries and idempotency record
    // were written, but before commit; no partial close may persist.
    let reached=false;
    const failing:FinanceDatabase={serializable:work=>db.serializable(tx=>work({...tx,query:async <T extends Record<string,unknown>>(sql:string,params?:unknown[])=>{
      const result=await tx.query<T>(sql,params);
      if(sql.includes("INSERT INTO finance.requests")){reached=true;throw new Error("synthetic close failure after request");}
      return result;
    }}))};
    await assert.rejects(()=>closePaidExpenseReview(failing,"2",close),/synthetic close failure after request/);
    assert.equal(reached,true);
    assert.deepEqual(await snapshot(),before);
    assert.equal((await getReview()).status,"OPEN");
    assert.equal((await closePaidExpenseReview(db, "2", close)).replayed, false);
    assert.equal((await closePaidExpenseReview(db, "2", close)).replayed, true);
    await assert.rejects(() => closePaidExpenseReview(db, "2", { ...close, reviewedNoChange: false }), (e: unknown) => e instanceof FinanceProblem && e.code === "request_conflict");
    await assert.rejects(() => closePaidExpenseReview(db, "2", { ...close, reviewedNoChange: undefined }), (e: unknown) => e instanceof FinanceProblem && e.code === "request_conflict");
    await assert.rejects(() => closePaidExpenseReview(db, "2", { ...close, reason: "سبب مختلف" }), (e: unknown) => e instanceof FinanceProblem && e.code === "request_conflict");
    await assert.rejects(() => closePaidExpenseReview(db, "2", { ...close, requestId: randomUUID() }), (e: unknown) => e instanceof FinanceProblem && e.code === "review_closed");
    const after = await snapshot();
    assert.deepEqual({ ...after, requests: before.requests, audit: before.audit }, before);
    assert.equal(after.requests, Number(before.requests) + 1);
    assert.equal(after.audit, Number(before.audit) + 2);
    // Replay is subject to current actor status and role, including the unique
    // conflict recovery path; it never repeats the no-change decision.
    await pg.exec("UPDATE users SET status='SUSPENDED' WHERE id=2");
    await assert.rejects(()=>closePaidExpenseReview(db,"2",close), (e:unknown)=>e instanceof FinanceProblem && e.code==="forbidden");
    let injected=false;
    const duplicate:FinanceDatabase={serializable:work=>db.serializable(tx=>work({...tx,query:async <T extends Record<string,unknown>>(sql:string,params?:unknown[])=>{
      if(!injected && sql.includes("FROM finance.requests")){injected=true;throw Object.assign(new Error("synthetic unique"),{code:"23505"});}
      return tx.query<T>(sql,params);
    }}))};
    // Inject after actor validation with an active actor, then suspend before
    // the recovery transaction, matching a permission change during recovery.
    await pg.exec("UPDATE users SET status='ACTIVE' WHERE id=2");
    const duringRecovery:FinanceDatabase={serializable:async work=>{
      if(injected) await pg.exec("UPDATE users SET status='SUSPENDED' WHERE id=2");
      return duplicate.serializable(work);
    }};
    await assert.rejects(()=>closePaidExpenseReview(duringRecovery,"2",close), (e:unknown)=>e instanceof FinanceProblem && e.code==="forbidden");
    assert.equal(injected,true);assert.deepEqual(await snapshot(),after);
    await pg.exec("UPDATE users SET status='ACTIVE' WHERE id=2");
    assert.deepEqual(await closePaidExpenseReview(db,"2",close),{id:review.id,replayed:true});
    assert.deepEqual(await snapshot(),after);
    await assert.rejects(() => closePaidExpenseReview(db, "2", { ...close, expectedRevision: "1" }), (e: unknown) => e instanceof FinanceProblem && e.code === "request_conflict");
    // Simulate a previously stored request using the original no-revision hash.
    // Replay must not fabricate an acknowledgment or repeat the close.
    const legacy = { requestId: randomUUID(), reviewId: review.id, reason: "إغلاق قديم اصطناعي" };
    // Strict lab policy requires a result link even for synthetic legacy hashes.
    const link = (requestId: string, resultId: string) => pg.query(
      `INSERT INTO finance.request_results(request_id,action,actor_id,result_table,result_id)
       VALUES($1::uuid,'EXPENSE_REVIEW_CLOSE',2,'finance.expense_reviews',$2::bigint)`, [requestId, resultId]);
    const legacyHash = createHash("sha256").update(JSON.stringify({ actorId: "2", action: "EXPENSE_REVIEW_CLOSE", payload: legacy })).digest("hex");
    await pg.query(`INSERT INTO finance.requests (request_id,request_hash,actor_id,action,result_id)
      VALUES ($1::uuid,$2,2,'EXPENSE_REVIEW_CLOSE',$3::bigint)`, [legacy.requestId,legacyHash,review.id]);
    await link(legacy.requestId, review.id);
    const beforeReplay = await snapshot();
    assert.equal((await closePaidExpenseReview(db, "2", legacy)).replayed, true);
    assert.deepEqual(await snapshot(), beforeReplay);
    // Also preserve a prior saved revision-bound request from before review snapshots.
    const prior = { requestId: randomUUID(), reviewId: review.id, reason: "إغلاق سابق بإصدار", expectedRevision: "2", reviewedNoChange: true };
    const priorPayload = { requestId: prior.requestId, reviewId: prior.reviewId, reason: prior.reason, expectedRevision: 2 };
    const priorHash = createHash("sha256").update(JSON.stringify({ actorId: "2", action: "EXPENSE_REVIEW_CLOSE", payload: priorPayload })).digest("hex");
    await pg.query(`INSERT INTO finance.requests (request_id,request_hash,actor_id,action,result_id) VALUES ($1::uuid,$2,2,'EXPENSE_REVIEW_CLOSE',$3::bigint)`, [prior.requestId,priorHash,review.id]);
    await link(prior.requestId, review.id);
    const beforePriorReplay = await snapshot();
    assert.equal((await closePaidExpenseReview(db, "2", prior)).replayed, true);
    assert.deepEqual(await snapshot(), beforePriorReplay);
    // A prior snapshot-bound payload also omitted the acknowledgment from its
    // hash. Its replay does not establish whether the prior person checked it.
    const oldSnapshot = { ...close, requestId:randomUUID() };
    const oldSnapshotPayload = { requestId:oldSnapshot.requestId,reviewId:oldSnapshot.reviewId,reason:oldSnapshot.reason,expectedRevision:2,expectedReviewSnapshot:oldSnapshot.expectedReviewSnapshot };
    const oldSnapshotHash = createHash("sha256").update(JSON.stringify({actorId:"2",action:"EXPENSE_REVIEW_CLOSE",payload:oldSnapshotPayload})).digest("hex");
    await pg.query(`INSERT INTO finance.requests (request_id,request_hash,actor_id,action,result_id) VALUES ($1::uuid,$2,2,'EXPENSE_REVIEW_CLOSE',$3::bigint)`,[oldSnapshot.requestId,oldSnapshotHash,review.id]);
    await link(oldSnapshot.requestId, review.id);
    const beforeOldSnapshot=await snapshot();
    assert.deepEqual(await closePaidExpenseReview(db,"2",oldSnapshot),{id:review.id,replayed:true});
    assert.deepEqual(await closePaidExpenseReview(db,"2",{...oldSnapshot,reviewedNoChange:false}),{id:review.id,replayed:true});
    assert.deepEqual(await snapshot(),beforeOldSnapshot);
    const closed = (await pg.query<{ status: string; resolved_by: string; resolution_reason: string }>("SELECT status,resolved_by::text,resolution_reason FROM finance.expense_reviews WHERE id=$1", [review.id])).rows[0];
    assert.deepEqual(closed, { status: "CLOSED", resolved_by: "2", resolution_reason: close.reason });
    // Existing count-covered annotation does not post money; preserve the
    // current behavior pending a separate historical correction policy.
    await pg.exec(`INSERT INTO users(branch_id,role_code,full_name,email,password_hash,status,must_change_password) VALUES (1,'CS_AGENT','موظف آخر','second@example.test','fixture','ACTIVE',false)`);
    const other = (await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "CUSTODY", holderId: "5", openingAmount: "0", openingDate: "2026-10-20", counted: true }, "2026-11-07")).id;
    const count = await requestCashCount(db, "1", { requestId: randomUUID(), accountId: other, expectedBalance: "0", countedAmount: "0", reason: "جرد فعلي", actuallyCounted: true }, "2026-11-07");
    await confirmCashCount(db, "2", { requestId: randomUUID(), countId: count.id, reason: "تأكيد الجرد", stillCurrent: true });
    await closeAccount(db, "1", { requestId: randomUUID(), accountId: other, reason: "إقفال" });
    await correctOpeningBalance(db, "1", { requestId: randomUUID(), accountId: other, expectedOpening: "0", correctedOpening: "10", expectedBalance: "0", verifiedOpening: true, coveredCountId: count.id, countCovered: true, reason: "توثيق مشمول بالجرد" });
    assert.equal((await listAccounts(db, "1")).find((account) => account.id === other)?.balance, "0.00");
    assert.equal((await pg.query<{ resolution: string }>("SELECT resolution FROM finance.opening_corrections WHERE account_id=$1", [other])).rows[0].resolution, "COUNT_COVERED");
    assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance.movements")).rows[0].n, 1);
  } finally { await pg.close(); }
});
