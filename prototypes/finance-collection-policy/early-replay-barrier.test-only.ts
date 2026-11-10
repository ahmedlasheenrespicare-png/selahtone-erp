/**
 * Disposable experiment only, not an application adapter or a lock protocol.
 * Requires a pre-provisioned test marker for a known account. A preflight
 * existence hint chooses the replay path without making an authorization or
 * identity decision; the underlying command still makes those checks. Any
 * unexpected new write on that path aborts. New writes mark before invoice or
 * account locks. Caller must retry recognized aborts as whole transactions.
 * This is not a historical cutover, physical-cash proof, or global barrier.
 */
import { FinanceProblem, type FinanceDatabase, type FinanceTransaction, type WriteResult } from "../../src/lib/finance/types";
import { recordCustodyCollectionTestOnly } from "./vault-collection-command.test-only";
import { cancelAllocatedSettlementTestOnly, confirmAllocatedSettlementTestOnly, requestAllocatedSettlementTestOnly } from "./reviewed-settlement.test-only";

type CollectionInput = {requestId:string; saleId:string; amount:string; method:string; actuallyPaid:boolean};
type SettlementInput = {requestId:string; accountId:string; expectedBalance:string; countedAmount:string; reason:string; actuallyCounted:boolean};
type Review = {collectionIds:string[]; paymentIds:string[]; reviewedHash:string};
async function mark(tx:FinanceTransaction,accountId:string):Promise<void> {
  const result=await tx.query<{revision:string}>(`UPDATE finance.source_order_barriers_test_only SET revision=revision+1 WHERE account_id=$1::bigint RETURNING revision::text AS revision`,[accountId]);
  if(result.rows.length!==1) throw new FinanceProblem("experimental_barrier_missing","اختبار اصطناعي: حاجز المصدر غير متاح.");
}
const replayOnly = ():never => {throw new FinanceProblem("experimental_replay_changed","اختبار اصطناعي: تغيرت حالة إعادة الطلب؛ لم تحفظ كتابة جديدة.");};

export async function collectEarlyBarrierTestOnly(db:FinanceDatabase,actorId:bigint,accountId:string,raw:CollectionInput):Promise<WriteResult> {
  return db.serializable(async tx=>{
    const prior=await tx.query<{found:boolean}>("SELECT EXISTS(SELECT 1 FROM public.commerce_collections WHERE request_id=$1::uuid) AS found",[raw.requestId]);
    const replayPath=prior.rows[0]?.found===true;
    if(!replayPath) await mark(tx,accountId);
    const result=await recordCustodyCollectionTestOnly(tx,actorId,raw,async()=>{if(replayPath)replayOnly();});
    if(replayPath && !result.replayed) replayOnly();
    if(!result.replayed) {
      const allocation=await tx.query<{accountId:string}>("SELECT account_id::text AS \"accountId\" FROM finance.collection_allocations_test_only WHERE collection_id=$1::bigint",[result.id]);
      if(allocation.rows[0]?.accountId!==accountId) throw new FinanceProblem("experimental_barrier_scope","اختبار اصطناعي: العهدة لا تطابق الحاجز.");
    }
    return result;
  });
}

export async function settlementEarlyBarrierTestOnly(db:FinanceDatabase,actorId:string,raw:SettlementInput,review:Review):Promise<WriteResult> {
  return db.serializable(async tx=>{
    const prior=await tx.query<{found:boolean}>("SELECT EXISTS(SELECT 1 FROM finance.requests WHERE request_id=$1::uuid) AS found",[raw.requestId]);
    const replayPath=prior.rows[0]?.found===true;
    if(!replayPath) await mark(tx,raw.accountId);
    const guarded:FinanceTransaction={...tx,query:async <T extends Record<string,unknown>>(sql:string,params?:unknown[])=>{
      if(replayPath && sql.includes("FROM finance.accounts WHERE id=$1::bigint FOR UPDATE")) replayOnly();
      return tx.query<T>(sql,params);
    }};
    const joined:FinanceDatabase={serializable:work=>work(guarded)};
    const result=await requestAllocatedSettlementTestOnly(joined,actorId,raw,raw.accountId,review);
    if(replayPath && !result.replayed) replayOnly();
    return result;
  });
}

/** A test-only confirmation variant; no general coordination or production use. */
export async function confirmationEarlyBarrierTestOnly(db:FinanceDatabase,actorId:string,accountId:string,raw:{requestId:string;settlementId:string;expectedBalance:string;transferAmount:string;transferDirection:string;reason:string;actuallyTransferred:boolean},review:Review):Promise<WriteResult> {
  return db.serializable(async tx=>{
    const prior=await tx.query<{found:boolean}>("SELECT EXISTS(SELECT 1 FROM finance.requests WHERE request_id=$1::uuid) AS found",[raw.requestId]);
    const replayPath=prior.rows[0]?.found===true;
    if(!replayPath) await mark(tx,accountId);
    const guarded:FinanceTransaction={...tx,query:async <T extends Record<string,unknown>>(sql:string,params?:unknown[])=>{
      if(replayPath && sql.includes("FROM finance.settlements s WHERE s.id=$1::bigint FOR UPDATE")) replayOnly();
      return tx.query<T>(sql,params);
    }};
    const joined:FinanceDatabase={serializable:work=>work(guarded)};
    const result=await confirmAllocatedSettlementTestOnly(joined,actorId,raw,accountId,review);
    if(replayPath && !result.replayed) replayOnly();
    return result;
  });
}

/** Test-only cancellation wrapper; does not turn cancellation into a review. */
export async function cancellationEarlyBarrierTestOnly(db:FinanceDatabase,actorId:string,accountId:string,raw:{requestId:string;settlementId:string;reason:string}):Promise<WriteResult> {
  return db.serializable(async tx=>{
    const prior=await tx.query<{found:boolean}>("SELECT EXISTS(SELECT 1 FROM finance.requests WHERE request_id=$1::uuid) AS found",[raw.requestId]);
    const replayPath=prior.rows[0]?.found===true;
    if(!replayPath) await mark(tx,accountId);
    const guarded:FinanceTransaction={...tx,query:async <T extends Record<string,unknown>>(sql:string,params?:unknown[])=>{
      if(replayPath && sql.includes("FROM finance.settlements s WHERE s.id=$1::bigint FOR UPDATE")) replayOnly();
      return tx.query<T>(sql,params);
    }};
    const joined:FinanceDatabase={serializable:work=>work(guarded)};
    const result=await cancelAllocatedSettlementTestOnly(joined,actorId,raw,accountId);
    if(replayPath && !result.replayed) replayOnly();
    return result;
  });
}
