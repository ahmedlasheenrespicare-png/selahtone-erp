/** Synthetic evidence inventory only. Never infer allocation or settlement. */
import type { FinanceTransaction } from "../../src/lib/finance/types";

type EvidenceRow = Record<string, unknown> & {
  paymentId: string;
  expenseId: string;
  kind: "PAYMENT" | "REVIEW" | "CORRECTION" | "MOVEMENT";
  evidence: Record<string, unknown>;
};

/** Pages payments, not events; caller must hold a read-only snapshot. Neither
 * the opt-in nor this helper enforce security or a production-safe workload. */
export async function auditSyntheticHolderCorrections(
  tx: FinanceTransaction, branchId: string, afterPaymentId: string, limit: number,
): Promise<{ rows: EvidenceRow[]; nextAfterId: string | null }> {
  if (!/^[1-9]\d{0,17}$/.test(branchId) || !/^(0|[1-9]\d{0,17})$/.test(afterPaymentId)) throw new Error("invalid synthetic identifier");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("invalid synthetic page limit");
  const optIn = await tx.query<{ enabled: string | null }>("SELECT current_setting('selahtone.holder_checkpoint_audit_test_only', true) AS enabled");
  if (optIn.rows[0]?.enabled !== "yes") throw new Error("synthetic audit requires explicit test-only opt-in");

  // Deliberately enumerate separately, not a review × correction × movement
  // join. Matching any correction link makes contradictory legacy links visible.
  const result = await tx.query<EvidenceRow>(`WITH page AS (
    SELECT p.id,p.expense_id,p.amount,p.payment_date,p.recorded_at,p.recorded_by,p.historical,e.branch_id,e.requested_by
    FROM finance.payments p JOIN finance.expenses e ON e.id=p.expense_id
    WHERE p.source='HOLDER_CASH' AND e.branch_id=$1::bigint AND p.id > $2::bigint
    ORDER BY p.id LIMIT $3::int
  )
  SELECT p.id::text AS "paymentId",p.expense_id::text AS "expenseId",event.kind,event.evidence
  FROM page p
  CROSS JOIN LATERAL (
    SELECT 'PAYMENT'::text AS kind, 0::bigint AS event_id, jsonb_build_object(
      'amount',p.amount::text,'paymentDate',p.payment_date::text,'recordedAt',p.recorded_at::text,
      'recordedBy',p.recorded_by::text,'requesterId',p.requested_by::text,'historical',p.historical) AS evidence
    UNION ALL
    SELECT 'REVIEW',r.id,jsonb_build_object(
      'reviewId',r.id::text,'expenseId',r.expense_id::text,'expenseRevision',r.expense_revision,
      'status',r.status,'proposedAmount',r.proposed_amount::text,'reason',r.reason,
      'createdAt',r.created_at::text,'createdBy',r.created_by::text,
      'resolvedAt',r.resolved_at::text,'resolvedBy',r.resolved_by::text,'resolutionReason',r.resolution_reason,
      'snapshotHasSource',coalesce((r.original_snapshot->'payment') ? 'source',false),
      'snapshotSource',r.original_snapshot->'payment'->>'source',
      'snapshotPaymentId',r.original_snapshot->'payment'->>'id',
      'snapshotAmount',r.original_snapshot->'payment'->>'amount',
      'snapshotEffectiveAmount',r.original_snapshot->>'effectiveAmount')
      FROM finance.expense_reviews r WHERE r.expense_id=p.expense_id
    UNION ALL
    SELECT 'CORRECTION',c.id,jsonb_build_object(
      'correctionId',c.id::text,'expenseId',c.expense_id::text,'paymentId',c.payment_id::text,
      'reviewId',c.review_id::text,'reviewExpenseId',r.expense_id::text,
      'beforeAmount',c.before_amount::text,'afterAmount',c.after_amount::text,
      'accountId',c.account_id::text,'bookDifference',c.book_difference::text,
      'balanceBefore',c.balance_before::text,'balanceAfter',c.balance_after::text,
      'reason',c.reason,'createdBy',c.created_by::text,'createdAt',c.created_at::text)
      FROM finance.expense_corrections c LEFT JOIN finance.expense_reviews r ON r.id=c.review_id
      WHERE c.expense_id=p.expense_id OR c.payment_id=p.id OR r.expense_id=p.expense_id
    UNION ALL
    SELECT 'MOVEMENT',m.id,jsonb_build_object(
      'movementId',m.id::text,'correctionId',c.id::text,'kind',m.kind,'branchId',m.branch_id::text,
      'sourceId',m.source_id::text,'destinationId',m.destination_id::text,'amount',m.amount::text,
      'actorId',m.actor_id::text,'createdAt',m.created_at::text)
      FROM finance.expense_corrections c LEFT JOIN finance.expense_reviews r ON r.id=c.review_id
      JOIN finance.movements m ON m.expense_correction_id=c.id
      WHERE c.expense_id=p.expense_id OR c.payment_id=p.id OR r.expense_id=p.expense_id
  ) event
  ORDER BY p.id,event.kind,event.event_id`, [branchId, afterPaymentId, limit + 1]);
  const paymentIds = [...new Set(result.rows.map(row => row.paymentId))];
  const included = new Set(paymentIds.slice(0, limit));
  return { rows: result.rows.filter(row => included.has(row.paymentId)), nextAfterId: paymentIds.length > limit ? paymentIds[limit - 1] : null };
}
