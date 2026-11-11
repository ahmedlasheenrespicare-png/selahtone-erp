/**
 * Disposable SQL-intercepting experiment only. Not a production command or
 * adapter. Uses the real closeAccount inside the caller's SERIALIZABLE tx,
 * translates request hashes ONLY in this test adapter, and compares the reviewed
 * account snapshot under the row lock. Always roll back on errors. The SQL
 * matches current engine internals and is intentionally not a supported API.
 */
import { closeAccount } from "../../src/lib/finance/engine";
import { FinanceProblem, type FinanceDatabase, type FinanceTransaction } from "../../src/lib/finance/types";
import { identifier, inputObject, requestId, text } from "../../src/lib/finance/validation";
import { syntheticCloseAccountSnapshot, syntheticCloseAccountSnapshotV2, syntheticCloseReplayMatches, syntheticCloseRequestIdentity } from "./close-identity.test-only";

export async function reviewedCloseTestOnly(db: FinanceDatabase, actorRaw: string, raw: unknown) {
  const actorId = identifier(actorRaw, "المستخدم");
  const value = inputObject(raw);
  const input = {requestId:requestId(value.requestId),accountId:identifier(value.accountId,"الحساب"),reason:text(value.reason,"سبب الإقفال",300)};
  const identity = syntheticCloseRequestIdentity(actorId,input,value);
  const expected = value.expectedAccountSnapshot;
  const adapter: FinanceDatabase = {serializable: work => db.serializable(async tx => {
    const wrapped: FinanceTransaction = {...tx,query:async <T extends Record<string,unknown>>(sql:string,params?:unknown[]) => {
      if (sql.includes('SELECT request_hash AS "requestHash", actor_id::text AS "actorId", action, result_id::text AS "resultId" FROM finance.requests')) {
        const found = await tx.query<{requestHash:string;actorId:string;action:string;resultId:string}>(sql,params);
        const old = found.rows[0];
        if (old) {
          if (!syntheticCloseReplayMatches(old,actorId,identity)) throw new FinanceProblem("request_conflict","طلب الإقفال الاصطناعي مختلف.");
          // The unmodified real engine expects the legacy digest. Never persist
          // this translation; it exists only in the returned test row.
          return {rows:[{...old,requestHash:identity.legacyHash} as unknown as T]};
        }
        if (!identity.reviewedHash) throw new FinanceProblem("review_required","راجع هوية العهدة قبل الإقفال الاصطناعي.");
        return {rows:[]};
      }
      if (sql.includes('kind, closed_at::text AS "closedAt" FROM finance.accounts WHERE id=$1::bigint FOR UPDATE')) {
        const locked=await tx.query<T>(sql,params);
        const state=await tx.query<{id:string;branchId:string;kind:"VAULT"|"CUSTODY";holderId:string|null;closed:boolean;revision:string}>(`SELECT id::text AS id,branch_id::text AS "branchId",kind,holder_id::text AS "holderId",closed_at IS NOT NULL AS closed,revision::text AS revision FROM finance.accounts WHERE id=$1::bigint`,[input.accountId]);
        const actual=state.rows[0] && (identity.version === 2 ? syntheticCloseAccountSnapshotV2(state.rows[0]) : syntheticCloseAccountSnapshot(state.rows[0]));
        if (!state.rows[0] || typeof expected !== "string" || actual !== expected)
          throw new FinanceProblem("account_changed","تغيّرت هوية العهدة؛ أعد المراجعة الاصطناعية.");
        return locked;
      }
      if (sql.includes("INSERT INTO finance.requests (request_id,request_hash,actor_id,action,result_id)")) {
        if (!identity.reviewedHash || !params || params[0] !== input.requestId || params[1] !== identity.legacyHash || params[2] !== actorId || params[3] !== "CLOSE_ACCOUNT")
          throw new FinanceProblem("request_conflict","تعذّر إثبات هوية الإقفال الاصطناعي.");
        return tx.query<T>(sql,[params[0],identity.reviewedHash,...params.slice(2)]);
      }
      return tx.query<T>(sql,params);
    }};
    return work(wrapped);
  })};
  return closeAccount(adapter,actorId,input);
}
