/**
 * Pure comparison experiment only. This is not an authorization check, an
 * evidence record, or a new close-request version. A caller would need to
 * read account and pending rows from one consistent snapshot, coordinate all
 * writers, and preserve replay before using any comparable design.
 */
import { createHash } from "node:crypto";
import type { FinanceTransaction } from "../../src/lib/finance/types";
import { syntheticCloseAccountSnapshotV2 } from "./close-identity.test-only";

function canonicalIds(ids: readonly string[]): string[] {
  if (ids.some(id => !/^[1-9]\d{0,18}$/.test(id))) throw new Error("invalid synthetic pending id");
  const sorted = [...ids].sort((a,b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);
  if (sorted.some((id,i) => i > 0 && id === sorted[i-1])) throw new Error("duplicate synthetic pending id");
  return sorted;
}

/** Current OPEN identifiers only; no attributes or terminal history included. */
export function syntheticClosePendingSnapshot(accountSnapshotV2:string, counts:readonly string[], settlements:readonly string[]):string {
  if (!/^[a-f0-9]{64}$/.test(accountSnapshotV2)) throw new Error("invalid synthetic account snapshot");
  return createHash("sha256").update(JSON.stringify(["close-pending-experiment-v1",accountSnapshotV2,canonicalIds(counts),canonicalIds(settlements)])).digest("hex");
}

/**
 * Test-only single-statement reader: a consistent statement snapshot is not
 * a lock, and does not protect a later close command from concurrent writers.
 * No access control, pagination, historical reconstruction, or production use.
 */
export async function readSyntheticClosePendingSnapshot(tx: FinanceTransaction, accountId:string):Promise<string|null> {
  const result=await tx.query<{id:string;branchId:string;kind:"VAULT"|"CUSTODY";holderId:string|null;closed:boolean;revision:string;counts:string[];settlements:string[]}>(`SELECT a.id::text AS id,a.branch_id::text AS "branchId",a.kind,a.holder_id::text AS "holderId",
    a.closed_at IS NOT NULL AS closed,a.revision::text AS revision,
    COALESCE((SELECT jsonb_agg(c.id::text ORDER BY c.id) FROM finance.cash_counts c WHERE c.account_id=a.id AND c.status='OPEN'),'[]'::jsonb) AS counts,
    COALESCE((SELECT jsonb_agg(s.id::text ORDER BY s.id) FROM finance.settlements s WHERE s.account_id=a.id AND s.status='OPEN'),'[]'::jsonb) AS settlements
    FROM finance.accounts a WHERE a.id=$1::bigint`,[accountId]);
  const account=result.rows[0];
  if (!account) return null;
  return syntheticClosePendingSnapshot(syntheticCloseAccountSnapshotV2(account),account.counts,account.settlements);
}
