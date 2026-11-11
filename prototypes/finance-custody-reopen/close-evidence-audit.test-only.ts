/**
 * Synthetic read-only fingerprint comparison, NOT an authorization boundary,
 * forensic audit, historical reconstruction, or production data tool. Audit
 * events are not request-linked: even unique matching candidates may be wrong.
 * All hashes here are unkeyed and can be rewritten by a database writer.
 * The current comparator obtains all candidates in one SQL statement for a
 * consistent statement snapshot. It is not a standalone production audit.
 */
import type { FinanceTransaction } from "../../src/lib/finance/types";
import { syntheticCloseAccountSnapshot, syntheticCloseAccountSnapshotV2, syntheticCloseRequestIdentity } from "./close-identity.test-only";

export type SyntheticCloseEvidence = "ambiguous_sources" | "state_inconsistent" | "legacy_candidate" | "reviewed_current_match" | "reviewed_v2_current_match" | "unresolved";
type Account = {id:string;branchId:string;kind:"CUSTODY"|"VAULT";holderId:string|null;closed:boolean;revision:string};
type Request = {requestId:string;actorId:string;hash:string};
type Audit = {actorId:string;reason:string|null};

/** Historical unsafe variant retained solely to demonstrate mixed snapshots. */
export async function inspectSyntheticCloseEvidenceMultiStatementUnsafe(tx: FinanceTransaction, accountId: string): Promise<SyntheticCloseEvidence> {
  const accounts=await tx.query<{id:string;branchId:string;kind:"CUSTODY"|"VAULT";holderId:string|null;closed:boolean;revision:string}>(`SELECT id::text AS id,branch_id::text AS "branchId",kind,holder_id::text AS "holderId",closed_at IS NOT NULL AS closed,revision::text AS revision FROM finance.accounts WHERE id=$1::bigint`,[accountId]);
  const requests=await tx.query<{requestId:string;actorId:string;hash:string}>(`SELECT request_id::text AS "requestId",actor_id::text AS "actorId",request_hash AS hash FROM finance.requests WHERE action='CLOSE_ACCOUNT' AND result_id=$1::bigint ORDER BY request_id`,[accountId]);
  const audits=await tx.query<{actorId:string;reason:string|null}>(`SELECT actor_id::text AS "actorId",reason FROM finance.audit_events WHERE entity_type='ACCOUNT' AND action='CLOSE' AND entity_id=$1::bigint ORDER BY id`,[accountId]);
  return classify(accounts.rows, requests.rows, audits.rows);
}

/** All candidate rows come from one statement snapshot, even at READ COMMITTED. */
export async function inspectSyntheticCloseEvidence(tx: FinanceTransaction, accountId: string): Promise<SyntheticCloseEvidence> {
  const result = await tx.query<{accounts:Account[];requests:Request[];audits:Audit[]}>(`SELECT
    COALESCE((SELECT jsonb_agg(to_jsonb(a)) FROM (SELECT id::text AS id,branch_id::text AS "branchId",kind,holder_id::text AS "holderId",closed_at IS NOT NULL AS closed,revision::text AS revision FROM finance.accounts WHERE id=$1::bigint LIMIT 2) a),'[]'::jsonb) AS accounts,
    COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM (SELECT request_id::text AS "requestId",actor_id::text AS "actorId",request_hash AS hash FROM finance.requests WHERE action='CLOSE_ACCOUNT' AND result_id=$1::bigint LIMIT 2) r),'[]'::jsonb) AS requests,
    COALESCE((SELECT jsonb_agg(to_jsonb(e)) FROM (SELECT actor_id::text AS "actorId",reason FROM finance.audit_events WHERE entity_type='ACCOUNT' AND action='CLOSE' AND entity_id=$1::bigint LIMIT 2) e),'[]'::jsonb) AS audits`,[accountId]);
  const row=result.rows[0];
  if (!row) return "ambiguous_sources";
  return classify(row.accounts,row.requests,row.audits);
}

function classify(accounts:Account[], requests:Request[], audits:Audit[]):SyntheticCloseEvidence {
  if (accounts.length!==1 || requests.length!==1 || audits.length!==1) return "ambiguous_sources";
  const account=accounts[0], request=requests[0], audit=audits[0];
  if (!account.closed || account.kind!=="CUSTODY" || !account.holderId || request.actorId!==audit.actorId) return "state_inconsistent";
  const input={requestId:request.requestId,accountId:account.id,reason:audit.reason};
  const assumedOpenSnapshot=syntheticCloseAccountSnapshot({...account,closed:false});
  const identity=syntheticCloseRequestIdentity(request.actorId,input,{expectedAccountSnapshot:assumedOpenSnapshot});
  if (request.hash.trim()===identity.legacyHash) return "legacy_candidate";
  if (request.hash.trim()===identity.reviewedHash) return "reviewed_current_match";
  // A v2 candidate assumes the current revision was also the version reviewed
  // before closure. This is only a comparison, not an authenticated history.
  if (!/^(0|[1-9]\d{0,18})$/.test(account.revision)) return "state_inconsistent";
  const snapshotV2=syntheticCloseAccountSnapshotV2({...account,closed:false});
  const identityV2=syntheticCloseRequestIdentity(request.actorId,input,{reviewVersion:2,expectedAccountSnapshot:snapshotV2});
  if (request.hash.trim()===identityV2.reviewedHash) return "reviewed_v2_current_match";
  return "unresolved";
}
