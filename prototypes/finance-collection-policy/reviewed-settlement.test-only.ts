/**
 * Disposable-only transaction wrappers for exploring a request-bound pending
 * membership snapshot. Never used by the app. They do not prove human review,
 * historic correctness, a safe cutover, or all lock orders. No retry is supplied
 * for the enclosing transaction; caller must restart the entire operation on a
 * known transaction abort and never catch-and-commit a failure.
 */
import { isRetryableTransactionConflict } from "../../src/lib/transaction-retry";
import { cancelSettlement, confirmSettlement, requestSettlement } from "../../src/lib/finance/engine";
import { FinanceProblem, type FinanceDatabase, type FinanceTransaction, type WriteResult } from "../../src/lib/finance/types";
import { testAllocatedFormula } from "./allocated-formula.test-only";
import { reviewTestPeriod } from "./period.test-only";

// The real engine normally owns the transaction and retries there. This lab
// wrapper already owns one, so a nested retry or uniqueness recovery on the
// same aborted tx is invalid. Propagate the original error only after rollback.
class OuterAbort extends Error {
  constructor(readonly original:unknown) { super("synthetic enclosing transaction must abort"); }
}
function uniqueConflict(error:unknown):boolean {
  return typeof error==="object" && error!==null && "code" in error && (error.code==="23505" || error.code==="P2002");
}
function joinedTransaction(tx:FinanceTransaction):FinanceDatabase {
  return {serializable:async work=>{
    try {return await work(tx);}
    catch(error) {
      if(isRetryableTransactionConflict(error) || uniqueConflict(error)) throw new OuterAbort(error);
      throw error;
    }
  }};
}
async function outerTransaction<T>(db:FinanceDatabase,work:(tx:FinanceTransaction)=>Promise<T>):Promise<T> {
  try {return await db.serializable(work);}
  catch(error) {if(error instanceof OuterAbort) throw error.original;throw error;}
}

type Review = { collectionIds:string[];paymentIds:string[];reviewedHash:string };
function matching(a:Review,b:Review):boolean {
  return a.reviewedHash===b.reviewedHash && JSON.stringify(a.collectionIds)===JSON.stringify(b.collectionIds) && JSON.stringify(a.paymentIds)===JSON.stringify(b.paymentIds);
}
function validate(review:Review):void {
  for(const ids of [review.collectionIds,review.paymentIds]) {
    if(!Array.isArray(ids) || ids.some(id=>typeof id!=="string" || !/^[1-9]\d{0,18}$/.test(id)) || ids.some((id,i)=>i>0 && BigInt(ids[i-1])>=BigInt(id)))
      throw new FinanceProblem("experimental_review_invalid","اختبار اصطناعي: قائمة المراجعة غير صالحة أو غير مرتبة.");
  }
  if(!/^[a-f0-9]{64}$/.test(review.reviewedHash)) throw new FinanceProblem("experimental_review_invalid","اختبار اصطناعي: بصمة المراجعة غير صالحة.");
}
async function readEvidence(tx:FinanceTransaction,settlementId:string,accountId:string):Promise<Review|null> {
  const result=await tx.query<{accountId:string;collectionIds:unknown;paymentIds:unknown;reviewedHash:string}>(`SELECT account_id::text AS "accountId",collection_ids AS "collectionIds",payment_ids AS "paymentIds",snapshot_hash AS "reviewedHash" FROM finance.settlement_request_reviews_test_only WHERE settlement_id=$1::bigint`,[settlementId]);
  const row=result.rows[0];
  if(!row || row.accountId!==accountId || !Array.isArray(row.collectionIds) || !Array.isArray(row.paymentIds)) return null;
  const value={collectionIds:row.collectionIds as string[],paymentIds:row.paymentIds as string[],reviewedHash:row.reviewedHash.trim()};
  validate(value);return value;
}
function expectedEvidence(saved:Review|null,review:Review):void {
  if(!saved || !matching(saved,review)) throw new FinanceProblem("experimental_request_review_mismatch","اختبار اصطناعي: مراجعة الطلب غير موجودة أو لا تطابق العناصر المقدمة.");
}

/** A legacy request without synthetic evidence is rejected, never upgraded. */
export async function requestAllocatedSettlementTestOnly(db:FinanceDatabase,actorId:string,raw:unknown,accountId:string,review:Review):Promise<WriteResult> {
  validate(review);
  return outerTransaction(db,async tx=>{
    const joined=joinedTransaction(tx);
    const result=await requestSettlement(testAllocatedFormula(joined,accountId),actorId,raw);
    if(result.replayed) expectedEvidence(await readEvidence(tx,result.id,accountId),review);
    else {
      const current=await reviewTestPeriod(tx,accountId);
      const snapshot={collectionIds:current.collections.map(x=>x.id),paymentIds:current.payments.map(x=>x.id),reviewedHash:current.hash};
      if(!matching(snapshot,review)) throw new FinanceProblem("experimental_review_stale","اختبار اصطناعي: تغيّرت عناصر المراجعة قبل إنشاء الطلب.");
      await tx.query(`INSERT INTO finance.settlement_request_reviews_test_only(settlement_id,account_id,collection_ids,payment_ids,snapshot_hash)
        VALUES($1::bigint,$2::bigint,$3::jsonb,$4::jsonb,$5)`,[result.id,accountId,JSON.stringify(review.collectionIds),JSON.stringify(review.paymentIds),review.reviewedHash]);
    }
    return result;
  });
}

/** Confirmation and replay must match the saved test-only request snapshot. */
export async function confirmAllocatedSettlementTestOnly(db:FinanceDatabase,actorId:string,raw:unknown,accountId:string,review:Review):Promise<WriteResult> {
  validate(review);
  return outerTransaction(db,async tx=>{
    const joined=joinedTransaction(tx);
    const result=await confirmSettlement(testAllocatedFormula(joined,accountId,{actorId,...review}),actorId,raw);
    expectedEvidence(await readEvidence(tx,result.id,accountId),review);
    return result;
  });
}

/** Synthetic cancellation adapter; it does not manufacture review evidence. */
export async function cancelAllocatedSettlementTestOnly(db:FinanceDatabase,actorId:string,raw:unknown,accountId:string):Promise<WriteResult> {
  return outerTransaction(db,async tx=>{
    const result=await cancelSettlement(joinedTransaction(tx),actorId,raw);
    const found=await tx.query<{accountId:string}>("SELECT account_id::text AS \"accountId\" FROM finance.settlements WHERE id=$1::bigint",[result.id]);
    if(found.rows[0]?.accountId!==accountId) throw new FinanceProblem("experimental_scope","اختبار اصطناعي: طلب التسوية لا يطابق العهدة.");
    return result;
  });
}
