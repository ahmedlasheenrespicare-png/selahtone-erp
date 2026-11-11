/** Synthetic, read-only evidence inventory. It does not determine historical correctness. */
import type { FinanceTransaction } from "../../src/lib/finance/types";

export type CountEvidence = Record<string, unknown> & {
  countId: string; accountId: string; kind: string; status: string; countedOn: string;
  counted: string; observed: string; difference: string; accountRevision: string;
  requestedBy: string | null; counterId: string | null; movementId: string | null;
  movementAmount: string | null; movementDirection: string | null; movementBranchMatches: boolean | null;
  referenceEvidence: string; findings: string[];
};

/** Caller supplies an isolated synthetic snapshot, never a production connection. */
export async function auditSyntheticCounts(tx: FinanceTransaction, branchId: string): Promise<CountEvidence[]> {
  if (!/^[1-9]\d*$/.test(branchId)) throw new Error("invalid synthetic branch id");
  return (await tx.query<CountEvidence>(`SELECT c.id::text AS "countId", a.id::text AS "accountId", a.kind, c.status,
    c.counted_on::text AS "countedOn", c.counted_amount::text AS counted,
    c.observed_balance::text AS observed, c.difference::text AS difference,
    c.account_revision::text AS "accountRevision", c.requested_by::text AS "requestedBy", c.counter_id::text AS "counterId",
    m.id::text AS "movementId", m.amount::text AS "movementAmount",
    CASE WHEN m.id IS NULL THEN NULL WHEN m.destination_id=c.account_id THEN 'IN'
      WHEN m.source_id=c.account_id THEN 'OUT' ELSE 'OTHER_ACCOUNT' END AS "movementDirection",
    CASE WHEN m.id IS NULL THEN NULL ELSE m.branch_id=a.branch_id END AS "movementBranchMatches",
    CASE WHEN evidence.has_book_balance THEN 'BOOK_BALANCE_AUDIT_PRESENT' ELSE 'REFERENCE_UNPROVEN' END AS "referenceEvidence",
    array_remove(ARRAY[
      CASE WHEN c.requested_by IS NOT NULL AND c.counter_id IS NULL AND c.status='OPEN' THEN 'AWAITING_HOLDER' END,
      CASE WHEN c.status<>'CONFIRMED' AND m.id IS NOT NULL THEN 'MOVEMENT_ON_UNCONFIRMED' END,
      CASE WHEN c.status='CONFIRMED' AND c.requested_by IS NOT NULL AND c.counter_id IS NULL THEN 'CONFIRMED_WITHOUT_HOLDER' END,
      CASE WHEN c.status='CONFIRMED' AND c.difference<>0 AND m.id IS NULL THEN 'MISSING_ADJUSTMENT' END,
      CASE WHEN c.status='CONFIRMED' AND c.difference=0 AND m.id IS NOT NULL THEN 'UNEXPECTED_ADJUSTMENT' END,
      CASE WHEN m.id IS NOT NULL AND (m.branch_id<>a.branch_id OR
        (c.difference>0 AND (m.destination_id IS DISTINCT FROM c.account_id OR m.source_id IS NOT NULL)) OR
        (c.difference<0 AND (m.source_id IS DISTINCT FROM c.account_id OR m.destination_id IS NOT NULL)) OR
        m.amount<>ABS(c.difference)) THEN 'ADJUSTMENT_MISMATCH' END
    ],NULL) AS findings
  FROM finance.cash_counts c JOIN finance.accounts a ON a.id=c.account_id
  LEFT JOIN finance.movements m ON m.cash_count_id=c.id
  LEFT JOIN LATERAL (
    SELECT COALESCE(bool_or(e.after_data ? 'bookBalance'),false) AS has_book_balance
    FROM finance.audit_events e WHERE e.entity_type='CASH_COUNT' AND e.entity_id=c.id
      AND e.action IN ('CREATE','HOLDER_COUNTED')
  ) evidence ON true
  WHERE a.branch_id=$1::bigint ORDER BY c.id`, [branchId])).rows;
}
