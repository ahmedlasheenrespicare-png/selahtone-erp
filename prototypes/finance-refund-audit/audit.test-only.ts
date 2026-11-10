/** Synthetic read-only evidence inventory; not historical truth or a production tool. */
import type { FinanceTransaction } from "../../src/lib/finance/types";

type RefundEvidence = Record<string, unknown> & {
  refundId: string; saleId: string; method: string; amount: string;
  movementId: string | null; historicalId: string | null; findings: string[];
};
type OrphanEvidence = Record<string, unknown> & { id: string; branchId: string; reference: string; findings: string[] };

/** One caller-owned disposable consistent snapshot; no repairs, no live data. */
export async function auditSyntheticRefunds(tx: FinanceTransaction, branchId: string): Promise<{
  refunds: RefundEvidence[]; orphanMovements: OrphanEvidence[]; orphanHistorical: OrphanEvidence[];
}> {
  if (!/^[1-9]\d*$/.test(branchId)) throw new Error("invalid synthetic branch id");
  const refunds = (await tx.query<RefundEvidence>(`SELECT r.id::text AS "refundId",r.sale_id::text AS "saleId",r.method,r.amount::text AS amount,
    m.id::text AS "movementId",h.id::text AS "historicalId",
    array_remove(ARRAY[
      CASE WHEN r.method='CASH' AND m.id IS NULL AND h.id IS NULL THEN 'NO_EVIDENCE' END,
      CASE WHEN r.method<>'CASH' AND (m.id IS NOT NULL OR h.id IS NOT NULL) THEN 'NONCASH_WITH_CASH_EVIDENCE' END,
      CASE WHEN m.id IS NOT NULL AND h.id IS NOT NULL THEN 'MOVEMENT_AND_HISTORICAL' END,
      CASE WHEN m.id IS NOT NULL AND (m.branch_id<>s.branch_id OR a.branch_id<>s.branch_id OR m.amount<>r.amount) THEN 'MOVEMENT_MISMATCH' END,
      CASE WHEN m.id IS NOT NULL AND m.after_cash_count_id IS NULL AND NOT m.after_opening THEN 'CHECKPOINT_UNATTESTED' END,
      CASE WHEN m.after_cash_count_id IS NOT NULL AND (c.account_id IS DISTINCT FROM m.source_id OR c.status IS DISTINCT FROM 'CONFIRMED') THEN 'MOVEMENT_COUNT_MISMATCH' END,
      CASE WHEN m.after_cash_count_id IS NOT NULL AND c.status='CONFIRMED' AND c.resolved_at>m.created_at THEN 'COUNT_RECORDED_AFTER_MOVEMENT' END,
      CASE WHEN m.after_cash_count_id IS NOT NULL AND c.status='CONFIRMED' AND c.resolved_at=m.created_at THEN 'COUNT_MOVEMENT_TIMESTAMP_BOUNDARY' END,
      CASE WHEN m.id IS NOT NULL AND m.created_at<a.opened_at THEN 'MOVEMENT_RECORDED_BEFORE_OPENING' END,
      CASE WHEN m.id IS NOT NULL AND m.created_at=a.opened_at THEN 'OPENING_TIMESTAMP_BOUNDARY' END,
      CASE WHEN m.id IS NOT NULL AND a.closed_at IS NOT NULL AND m.created_at>a.closed_at THEN 'MOVEMENT_RECORDED_AFTER_CLOSE' END,
      CASE WHEN m.id IS NOT NULL AND a.closed_at IS NOT NULL AND m.created_at=a.closed_at THEN 'CLOSE_TIMESTAMP_BOUNDARY' END,
      CASE WHEN h.id IS NOT NULL AND (h.sale_id<>r.sale_id OR h.branch_id<>s.branch_id OR ha.branch_id<>s.branch_id OR h.amount<>r.amount) THEN 'HISTORICAL_MISMATCH' END,
      CASE WHEN h.checkpoint_type='COUNT' AND (hc.account_id IS DISTINCT FROM h.account_id OR hc.status IS DISTINCT FROM 'CONFIRMED') THEN 'HISTORICAL_COUNT_MISMATCH' END
    ], NULL) AS findings
    FROM public.commerce_refunds r JOIN public.commerce_sales s ON s.id=r.sale_id
    LEFT JOIN finance.movements m ON m.kind='REFUND' AND m.external_ref=('refund:'||r.id::text)
    LEFT JOIN finance.accounts a ON a.id=m.source_id
    LEFT JOIN finance.cash_counts c ON c.id=m.after_cash_count_id
    LEFT JOIN finance.historical_commerce h ON h.event_type='REFUND' AND h.event_id=r.id
    LEFT JOIN finance.accounts ha ON ha.id=h.account_id
    LEFT JOIN finance.cash_counts hc ON hc.id=h.checkpoint_count_id
    WHERE s.branch_id=$1::bigint ORDER BY r.id`, [branchId])).rows;
  // String comparison intentionally avoids casting malformed or oversized IDs.
  const orphanMovements = (await tx.query<OrphanEvidence>(`SELECT m.id::text AS id,m.branch_id::text AS "branchId",m.external_ref AS reference,
    ARRAY['ORPHAN_OR_NONCANONICAL_REFERENCE']::text[] AS findings
    FROM finance.movements m LEFT JOIN public.commerce_refunds r ON m.external_ref=('refund:'||r.id::text)
    WHERE m.kind='REFUND' AND m.branch_id=$1::bigint AND r.id IS NULL ORDER BY m.id`, [branchId])).rows;
  const orphanHistorical = (await tx.query<OrphanEvidence>(`SELECT h.id::text AS id,h.branch_id::text AS "branchId",h.event_id::text AS reference,
    ARRAY['ORPHAN_HISTORICAL_REFUND']::text[] AS findings
    FROM finance.historical_commerce h LEFT JOIN public.commerce_refunds r ON r.id=h.event_id
    WHERE h.event_type='REFUND' AND h.branch_id=$1::bigint AND r.id IS NULL ORDER BY h.id`, [branchId])).rows;
  return { refunds, orphanMovements, orphanHistorical };
}
