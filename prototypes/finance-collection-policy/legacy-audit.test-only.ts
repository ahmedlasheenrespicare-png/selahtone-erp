/** Read-only synthetic cutover inventory. Evidence is not proof of settlement. */
import type { FinanceTransaction } from "../../src/lib/finance/types";
type Result = Record<string, unknown> & {
  cashCount: string; cashAmount: string; differentRecorderCount: string; differentRecorderAmount: string;
  noEvidenceCount: string; noEvidenceAmount: string; movementOnlyCount: string; historicalOnlyCount: string;
  overlapCount: string; inconsistentEvidenceCount: string; orphanMovementCount: string; orphanHistoricalCount: string;
  holderCashCount: string; holderCashAmount: string; holderCashDifferentRecorderCount: string;
  openSettlements: string; confirmedSettlements: string; openCounts: string;
};

/** Aggregate one branch; caller owns transaction/snapshot. Never writes or decides a backfill. */
export async function auditLegacyTestBranch(tx: FinanceTransaction, branchId: string): Promise<Result> {
  if (!/^[1-9]\d*$/.test(branchId)) throw new Error("invalid synthetic branch id");
  const result = await tx.query<Result>(`WITH cash AS (
    SELECT c.id,c.amount,c.created_by_id AS collector_id,s.created_by_id AS sale_creator_id,s.id AS sale_id,s.branch_id,
      m.id AS movement_id,h.id AS history_id,
      (m.id IS NOT NULL AND (m.amount<>c.amount OR m.branch_id<>s.branch_id OR m.actor_id<>c.created_by_id OR dest.branch_id IS DISTINCT FROM s.branch_id)) AS movement_mismatch,
      (h.id IS NOT NULL AND (h.amount<>c.amount OR h.branch_id<>s.branch_id OR h.sale_id<>s.id OR histacct.branch_id IS DISTINCT FROM s.branch_id)) AS history_mismatch
    FROM public.commerce_collections c JOIN public.commerce_sales s ON s.id=c.sale_id
    LEFT JOIN finance.movements m ON m.kind='COLLECTION' AND m.external_ref=('collection:'||c.id::text)
    LEFT JOIN finance.accounts dest ON dest.id=m.destination_id
    LEFT JOIN finance.historical_commerce h ON h.event_type='COLLECTION' AND h.event_id=c.id
    LEFT JOIN finance.accounts histacct ON histacct.id=h.account_id
    WHERE s.branch_id=$1::bigint AND c.method='CASH'
  ), holder AS (
    SELECT p.amount,p.recorded_by,e.requested_by FROM finance.payments p JOIN finance.expenses e ON e.id=p.expense_id
    WHERE e.branch_id=$1::bigint AND p.source='HOLDER_CASH'
  )
  SELECT
    (SELECT COUNT(*)::text FROM cash) AS "cashCount",
    (SELECT COALESCE(SUM(amount),0)::numeric(22,2)::text FROM cash) AS "cashAmount",
    (SELECT COUNT(*)::text FROM cash WHERE collector_id IS DISTINCT FROM sale_creator_id) AS "differentRecorderCount",
    (SELECT COALESCE(SUM(amount),0)::numeric(22,2)::text FROM cash WHERE collector_id IS DISTINCT FROM sale_creator_id) AS "differentRecorderAmount",
    (SELECT COUNT(*)::text FROM cash WHERE movement_id IS NULL AND history_id IS NULL) AS "noEvidenceCount",
    (SELECT COALESCE(SUM(amount),0)::numeric(22,2)::text FROM cash WHERE movement_id IS NULL AND history_id IS NULL) AS "noEvidenceAmount",
    (SELECT COUNT(*)::text FROM cash WHERE movement_id IS NOT NULL AND history_id IS NULL) AS "movementOnlyCount",
    (SELECT COUNT(*)::text FROM cash WHERE movement_id IS NULL AND history_id IS NOT NULL) AS "historicalOnlyCount",
    (SELECT COUNT(*)::text FROM cash WHERE movement_id IS NOT NULL AND history_id IS NOT NULL) AS "overlapCount",
    (SELECT COUNT(*)::text FROM cash WHERE movement_mismatch OR history_mismatch) AS "inconsistentEvidenceCount",
    (SELECT COUNT(*)::text FROM finance.movements m WHERE m.kind='COLLECTION' AND m.branch_id=$1::bigint AND NOT EXISTS
      (SELECT 1 FROM public.commerce_collections c JOIN public.commerce_sales s ON s.id=c.sale_id WHERE m.external_ref=('collection:'||c.id::text) AND c.method='CASH' AND s.branch_id=$1::bigint)) AS "orphanMovementCount",
    (SELECT COUNT(*)::text FROM finance.historical_commerce h WHERE h.event_type='COLLECTION' AND h.branch_id=$1::bigint AND NOT EXISTS
      (SELECT 1 FROM public.commerce_collections c JOIN public.commerce_sales s ON s.id=c.sale_id WHERE c.id=h.event_id AND c.method='CASH' AND s.branch_id=$1::bigint)) AS "orphanHistoricalCount",
    (SELECT COUNT(*)::text FROM holder) AS "holderCashCount",
    (SELECT COALESCE(SUM(amount),0)::numeric(22,2)::text FROM holder) AS "holderCashAmount",
    (SELECT COUNT(*)::text FROM holder WHERE recorded_by IS DISTINCT FROM requested_by) AS "holderCashDifferentRecorderCount",
    (SELECT COUNT(*)::text FROM finance.settlements WHERE branch_id=$1::bigint AND status='OPEN') AS "openSettlements",
    (SELECT COUNT(*)::text FROM finance.settlements WHERE branch_id=$1::bigint AND status='CONFIRMED') AS "confirmedSettlements",
    (SELECT COUNT(*)::text FROM finance.cash_counts c JOIN finance.accounts a ON a.id=c.account_id WHERE a.branch_id=$1::bigint AND c.status='OPEN') AS "openCounts"`, [branchId]);
  return result.rows[0];
}
