/** Synthetic, read-only-by-caller inventory, not an accounting classifier. */
import type { FinanceTransaction } from "../../src/lib/finance/types";

type EvidenceRow = Record<string, unknown> & {
  expenseId: string;
  kind: "EXPENSE" | "PAYMENT" | "REVIEW" | "CORRECTION" | "MOVEMENT";
  evidence: Record<string, unknown>;
};

/** Pages expenses rather than records. All evidence rows and the extra
 * lookahead expansion are unbounded; the caller owns the read-only snapshot. */
export async function auditSyntheticUnmatchedReviews(
  tx: FinanceTransaction, branchId: string, afterExpenseId: string, limit: number,
): Promise<{ rows: EvidenceRow[]; nextAfterId: string | null }> {
  return auditSyntheticExpenseEvidence(tx, branchId, afterExpenseId, limit, "unmatched");
}

/** Mixed-source evidence only; does not decide whether either payment occurred. */
export async function auditSyntheticMixedPaymentReviews(
  tx: FinanceTransaction, branchId: string, afterExpenseId: string, limit: number,
): Promise<{ rows: EvidenceRow[]; nextAfterId: string | null }> {
  return auditSyntheticExpenseEvidence(tx, branchId, afterExpenseId, limit, "mixed");
}

async function auditSyntheticExpenseEvidence(
  tx: FinanceTransaction, branchId: string, afterExpenseId: string, limit: number,
  mode: "unmatched" | "mixed",
): Promise<{ rows: EvidenceRow[]; nextAfterId: string | null }> {
  if (!/^[1-9]\d{0,17}$/.test(branchId) || !/^(0|[1-9]\d{0,17})$/.test(afterExpenseId)) throw new Error("invalid synthetic identifier");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("invalid synthetic page limit");
  const optIn = await tx.query<{ enabled: string | null }>("SELECT current_setting('selahtone.holder_checkpoint_audit_test_only', true) AS enabled");
  if (optIn.rows[0]?.enabled !== "yes") throw new Error("synthetic audit requires explicit test-only opt-in");

  // A missing holder payment is only an observation: legitimate noncash or
  // account-cash records are also included. Do not infer source from snapshots.
  const result = await tx.query<EvidenceRow>(`WITH page AS (
    SELECT e.id,e.branch_id,e.requested_by,e.status,e.amount,e.revision
    FROM finance.expenses e
    WHERE e.branch_id=$1::bigint AND e.id>$2::bigint
      AND (($4::text='unmatched' AND NOT EXISTS (SELECT 1 FROM finance.payments p WHERE p.expense_id=e.id AND p.source='HOLDER_CASH'))
        OR ($4::text='mixed' AND EXISTS (SELECT 1 FROM finance.payments p WHERE p.expense_id=e.id AND p.source='HOLDER_CASH')
          AND EXISTS (SELECT 1 FROM finance.payments p WHERE p.expense_id=e.id AND p.source IS DISTINCT FROM 'HOLDER_CASH')))
      AND (EXISTS (SELECT 1 FROM finance.expense_reviews r WHERE r.expense_id=e.id)
        OR EXISTS (SELECT 1 FROM finance.expense_corrections c
          LEFT JOIN finance.expense_reviews r ON r.id=c.review_id
          LEFT JOIN finance.payments p ON p.id=c.payment_id
          WHERE c.expense_id=e.id OR r.expense_id=e.id OR p.expense_id=e.id))
    ORDER BY e.id LIMIT $3::int
  )
  SELECT e.id::text AS "expenseId",event.kind,event.evidence FROM page e
  CROSS JOIN LATERAL (
    SELECT 'EXPENSE'::text AS kind,0::bigint AS event_id,jsonb_build_object(
      'branchId',e.branch_id::text,'requesterId',e.requested_by::text,'status',e.status,
      'amount',e.amount::text,'revision',e.revision) AS evidence
    UNION ALL
    SELECT 'PAYMENT',p.id,jsonb_build_object(
      'paymentId',p.id::text,'source',p.source,'method',p.method,'accountId',p.account_id::text,
      'amount',p.amount::text,'paymentDate',p.payment_date::text,'recordedAt',p.recorded_at::text,
      'recordedBy',p.recorded_by::text,'historical',p.historical)
      FROM finance.payments p WHERE p.expense_id=e.id
    UNION ALL
    SELECT 'REVIEW',r.id,jsonb_build_object(
      'reviewId',r.id::text,'expenseId',r.expense_id::text,'status',r.status,
      'expenseRevision',r.expense_revision,'proposedAmount',r.proposed_amount::text,
      'reason',r.reason,'createdBy',r.created_by::text,'createdAt',r.created_at::text,
      'resolvedBy',r.resolved_by::text,'resolvedAt',r.resolved_at::text,'resolutionReason',r.resolution_reason,
      'snapshotHasSource',coalesce((r.original_snapshot->'payment') ? 'source',false),
      'snapshotSource',r.original_snapshot->'payment'->>'source',
      'snapshotPaymentId',r.original_snapshot->'payment'->>'id',
      'snapshotAmount',r.original_snapshot->'payment'->>'amount',
      'snapshotEffectiveAmount',r.original_snapshot->>'effectiveAmount')
      FROM finance.expense_reviews r WHERE r.expense_id=e.id
    UNION ALL
    SELECT 'CORRECTION',c.id,jsonb_build_object(
      'correctionId',c.id::text,'expenseId',c.expense_id::text,'paymentId',c.payment_id::text,
      'paymentExpenseId',p.expense_id::text,'reviewId',c.review_id::text,'reviewExpenseId',r.expense_id::text,
      'beforeAmount',c.before_amount::text,'afterAmount',c.after_amount::text,
      'accountId',c.account_id::text,'bookDifference',c.book_difference::text,
      'balanceBefore',c.balance_before::text,'balanceAfter',c.balance_after::text,
      'reason',c.reason,'createdBy',c.created_by::text,'createdAt',c.created_at::text)
      FROM finance.expense_corrections c LEFT JOIN finance.expense_reviews r ON r.id=c.review_id
      LEFT JOIN finance.payments p ON p.id=c.payment_id
      WHERE c.expense_id=e.id OR r.expense_id=e.id OR p.expense_id=e.id
    UNION ALL
    SELECT 'MOVEMENT',m.id,jsonb_build_object(
      'movementId',m.id::text,'correctionId',c.id::text,'kind',m.kind,'branchId',m.branch_id::text,
      'sourceId',m.source_id::text,'destinationId',m.destination_id::text,'amount',m.amount::text,
      'actorId',m.actor_id::text,'createdAt',m.created_at::text)
      FROM finance.expense_corrections c LEFT JOIN finance.expense_reviews r ON r.id=c.review_id
      LEFT JOIN finance.payments p ON p.id=c.payment_id
      JOIN finance.movements m ON m.expense_correction_id=c.id
      WHERE c.expense_id=e.id OR r.expense_id=e.id OR p.expense_id=e.id
  ) event ORDER BY e.id,event.kind,event.event_id`, [branchId, afterExpenseId, limit + 1, mode]);
  const ids = [...new Set(result.rows.map(row => row.expenseId))];
  const included = new Set(ids.slice(0, limit));
  return { rows: result.rows.filter(row => included.has(row.expenseId)), nextAfterId: ids.length > limit ? ids[limit - 1] : null };
}
