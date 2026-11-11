/**
 * Disposable-only branch-level marker experiment. NOT an application adapter,
 * migration, authorization design, routing solution, or physical-cash proof.
 * Only participating writers share this marker. Preflight reads may expose
 * timing before authorization. Entire transactions must be retried on abort.
 */
import { FinanceProblem, type FinanceDatabase, type FinanceTransaction, type WriteResult } from "../../src/lib/finance/types";
import { recordCustodyCollectionTestOnly, recordVaultCollectionTestOnly } from "./vault-collection-command.test-only";
import { requestAllocatedSettlementTestOnly } from "./reviewed-settlement.test-only";
import { decideCustodyRequest, openAccount } from "../../src/lib/finance/engine";
import { isRetryableTransactionConflict } from "../../src/lib/transaction-retry";

type Collection = {requestId:string; saleId:string; amount:string; method:string; actuallyPaid:boolean};
type Settlement = {requestId:string; accountId:string; expectedBalance:string; countedAmount:string; reason:string; actuallyCounted:boolean};
type Review = {collectionIds:string[];paymentIds:string[];reviewedHash:string};
const problem = (message:string):never => {throw new FinanceProblem("experimental_branch_barrier",message);};
export async function branchMarker(tx:FinanceTransaction,branch:string):Promise<void> {
  const result=await tx.query<{revision:string}>(`UPDATE finance.branch_source_barriers_test_only SET revision=revision+1 WHERE branch_id=$1::bigint RETURNING revision::text AS revision`,[branch]);
  if(result.rows.length!==1) problem("اختبار اصطناعي: حاجز الفرع غير متاح.");
}
export async function branchCollectionTestOnly(db:FinanceDatabase,actorId:bigint,raw:Collection):Promise<WriteResult> {
  return db.serializable(async tx=>{
    const prior=await tx.query<{found:boolean}>("SELECT EXISTS(SELECT 1 FROM public.commerce_collections WHERE request_id=$1::uuid) AS found",[raw.requestId]);
    const replayPath=prior.rows[0]?.found===true;
    let branch:string|undefined;
    if(!replayPath) {
      const sale=await tx.query<{branch:string}>("SELECT branch_id::text AS branch FROM public.commerce_sales WHERE id=$1::bigint",[raw.saleId]);
      branch=sale.rows[0]?.branch;if(!branch) return problem("اختبار اصطناعي: الفاتورة غير متاحة.");
      await branchMarker(tx,branch);
    }
    const result=await recordCustodyCollectionTestOnly(tx,actorId,raw,async(_tx,lockedBranch)=>{
      if(replayPath) problem("اختبار اصطناعي: تغيرت حالة إعادة الطلب.");
      if(lockedBranch!==branch) problem("اختبار اصطناعي: تغير فرع الفاتورة.");
    });
    if(replayPath && !result.replayed) problem("اختبار اصطناعي: تغيرت حالة إعادة الطلب.");
    return result;
  });
}
export async function branchSettlementTestOnly(db:FinanceDatabase,actorId:string,raw:Settlement,review:Review):Promise<WriteResult> {
  return db.serializable(async tx=>{
    const prior=await tx.query<{found:boolean}>("SELECT EXISTS(SELECT 1 FROM finance.requests WHERE request_id=$1::uuid) AS found",[raw.requestId]);
    const replayPath=prior.rows[0]?.found===true;
    let branch:string|undefined;
    if(!replayPath) {
      const account=await tx.query<{branch:string}>("SELECT branch_id::text AS branch FROM finance.accounts WHERE id=$1::bigint",[raw.accountId]);
      branch=account.rows[0]?.branch;if(!branch) return problem("اختبار اصطناعي: العهدة غير متاحة.");
      await branchMarker(tx,branch);
    }
    const wrapped:FinanceTransaction={...tx,query:async<T extends Record<string,unknown>>(sql:string,params?:unknown[])=>{
      const accountLock=sql.includes("FROM finance.accounts WHERE id=$1::bigint FOR UPDATE");
      if(replayPath && accountLock) problem("اختبار اصطناعي: تغيرت حالة إعادة الطلب.");
      const result=await tx.query<T>(sql,params);
      if(accountLock && result.rows[0]?.branchId!==branch) problem("اختبار اصطناعي: تغير فرع العهدة.");
      return result;
    }};
    const joined:FinanceDatabase={serializable:work=>work(wrapped)};
    const result=await requestAllocatedSettlementTestOnly(joined,actorId,raw,raw.accountId,review);
    if(replayPath && !result.replayed) problem("اختبار اصطناعي: تغيرت حالة إعادة الطلب.");
    return result;
  });
}

/** Vault-only variant; a completed custody opening forces a new routing decision. */
export async function branchVaultCollectionTestOnly(db:FinanceDatabase,actorId:bigint,raw:Collection & {vaultReceived:boolean}):Promise<WriteResult> {
  return db.serializable(async tx=>{
    const prior=await tx.query<{found:boolean}>("SELECT EXISTS(SELECT 1 FROM public.commerce_collections WHERE request_id=$1::uuid) AS found",[raw.requestId]);
    const replayPath=prior.rows[0]?.found===true;
    let branch:string|undefined;
    if(!replayPath) {
      const sale=await tx.query<{branch:string}>("SELECT branch_id::text AS branch FROM public.commerce_sales WHERE id=$1::bigint",[raw.saleId]);
      branch=sale.rows[0]?.branch;if(!branch) return problem("اختبار اصطناعي: الفاتورة غير متاحة.");
      await branchMarker(tx,branch);
    }
    const result=await recordVaultCollectionTestOnly(tx,actorId,raw,async(_tx,lockedBranch)=>{
      if(replayPath) problem("اختبار اصطناعي: تغيرت حالة إعادة الطلب.");
      if(lockedBranch!==branch) problem("اختبار اصطناعي: تغير فرع الفاتورة.");
    });
    if(replayPath && !result.replayed) problem("اختبار اصطناعي: تغيرت حالة إعادة الطلب.");
    return result;
  });
}

// The engine normally owns and retries its own transaction. Since this lab
// wrapper owns the outer transaction, never retry/recover inside an aborted tx.
class OuterAbort extends Error {constructor(readonly original:unknown){super("synthetic branch transaction must abort");}}
export async function branchOpenCustodyTestOnly(db:FinanceDatabase,actorId:string,raw:{requestId:string;branchId:string;kind:"CUSTODY";holderId:string;openingAmount:string;openingDate:string;counted:boolean},today:string):Promise<WriteResult> {
  try {
    return await db.serializable(async tx=>{
      const prior=await tx.query<{found:boolean}>("SELECT EXISTS(SELECT 1 FROM finance.requests WHERE request_id=$1::uuid) AS found",[raw.requestId]);
      const replayPath=prior.rows[0]?.found===true;
      if(!replayPath) await branchMarker(tx,raw.branchId);
      const guarded:FinanceTransaction={...tx,query:async<T extends Record<string,unknown>>(sql:string,params?:unknown[])=>{
        if(replayPath && sql.includes("INSERT INTO finance.accounts (branch_id,kind,holder_id,opening_amount,opening_date,opened_by)")) problem("اختبار اصطناعي: تغيرت حالة إعادة الطلب.");
        return tx.query<T>(sql,params);
      }};
      const joined:FinanceDatabase={serializable:async work=>{try{return await work(guarded);}catch(error){
        if(isRetryableTransactionConflict(error) || (typeof error==="object" && error!==null && "code" in error && (error.code==="23505" || error.code==="P2002"))) throw new OuterAbort(error);
        throw error;
      }}};
      const result=await openAccount(joined,actorId,raw,today);
      if(replayPath && !result.replayed) problem("اختبار اصطناعي: تغيرت حالة إعادة الطلب.");
      return result;
    });
  } catch(error) {if(error instanceof OuterAbort)throw error.original;throw error;}
}

/** Approval path experiment; rejection and other writers remain outside it. */
export async function branchApproveCustodyTestOnly(db:FinanceDatabase,actorId:string,raw:{requestId:string;requestId2:string;decision:"APPROVE";reason:string;openingDate:string;counted:boolean;expectedSnapshot:string},today:string):Promise<WriteResult> {
  try {
    return await db.serializable(async tx=>{
      const prior=await tx.query<{found:boolean}>("SELECT EXISTS(SELECT 1 FROM finance.requests WHERE request_id=$1::uuid) AS found",[raw.requestId]);
      const replayPath=prior.rows[0]?.found===true;
      let branch:string|undefined;
      if(!replayPath) {
        const request=await tx.query<{branch:string}>("SELECT branch_id::text AS branch FROM finance.custody_requests WHERE id=$1::bigint",[raw.requestId2]);
        branch=request.rows[0]?.branch;if(!branch) return problem("اختبار اصطناعي: طلب العهدة غير متاح.");
        await branchMarker(tx,branch);
      }
      const guarded:FinanceTransaction={...tx,query:async<T extends Record<string,unknown>>(sql:string,params?:unknown[])=>{
        const lock=sql.includes("FROM finance.custody_requests WHERE id=$1::bigint FOR UPDATE");
        if(replayPath && lock) problem("اختبار اصطناعي: تغيرت حالة إعادة الطلب.");
        const result=await tx.query<T>(sql,params);
        if(lock && result.rows[0]?.branchId!==branch) problem("اختبار اصطناعي: تغير فرع طلب العهدة.");
        return result;
      }};
      const joined:FinanceDatabase={serializable:async work=>{try{return await work(guarded);}catch(error){
        if(isRetryableTransactionConflict(error) || (typeof error==="object" && error!==null && "code" in error && (error.code==="23505" || error.code==="P2002"))) throw new OuterAbort(error);
        throw error;
      }}};
      const result=await decideCustodyRequest(joined,actorId,raw,today);
      if(replayPath && !result.replayed) problem("اختبار اصطناعي: تغيرت حالة إعادة الطلب.");
      return result;
    });
  } catch(error) {if(error instanceof OuterAbort)throw error.original;throw error;}
}
