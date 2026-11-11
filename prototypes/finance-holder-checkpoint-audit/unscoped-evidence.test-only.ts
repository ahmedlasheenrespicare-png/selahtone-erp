/** Disposable synthetic evidence only; caller owns read-only snapshot and opt-in. */
import type { FinanceTransaction } from "../../src/lib/finance/types";

type Evidence = Record<string, unknown> & { id: string; kind: "REVIEW" | "CORRECTION" | "MOVEMENT"; evidence: Record<string, unknown> };

/** Two independent cursors: IDs in each result refer to reviews or corrections,
 * respectively. This global inventory is not a branch authorization boundary. */
export async function auditSyntheticUnscopedEvidence(
  tx: FinanceTransaction, kind: "reviews" | "corrections", afterId: string, limit: number,
): Promise<{ rows: Evidence[]; nextAfterId: string | null }> {
  if (kind !== "reviews" && kind !== "corrections") throw new Error("invalid synthetic inventory kind");
  if (!/^(0|[1-9]\d{0,17})$/.test(afterId)) throw new Error("invalid synthetic identifier");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("invalid synthetic page limit");
  const optIn = await tx.query<{ enabled: string | null }>("SELECT current_setting('selahtone.holder_checkpoint_audit_test_only', true) AS enabled");
  if (optIn.rows[0]?.enabled !== "yes") throw new Error("synthetic audit requires explicit test-only opt-in");
  const sql = kind === "reviews" ? `
    SELECT r.id::text AS id, 'REVIEW'::text AS kind, jsonb_build_object(
      'expenseId',r.expense_id::text,'existingExpenseId',e.id::text,'branchId',e.branch_id::text,
      'status',r.status,'reason',r.reason,'proposedAmount',r.proposed_amount::text,
      'snapshotHasSource',coalesce((r.original_snapshot->'payment') ? 'source',false),
      'snapshotSource',r.original_snapshot->'payment'->>'source',
      'snapshotPaymentId',r.original_snapshot->'payment'->>'id') AS evidence
    FROM finance.expense_reviews r LEFT JOIN finance.expenses e ON e.id=r.expense_id
    WHERE r.id>$1::bigint AND (e.id IS NULL OR e.branch_id IS NULL)
    ORDER BY r.id LIMIT $2::int` : `
    WITH page AS (
      SELECT c.* FROM finance.expense_corrections c
      LEFT JOIN finance.expenses direct_e ON direct_e.id=c.expense_id
      LEFT JOIN finance.payments p ON p.id=c.payment_id
      LEFT JOIN finance.expenses payment_e ON payment_e.id=p.expense_id
      LEFT JOIN finance.expense_reviews r ON r.id=c.review_id
      LEFT JOIN finance.expenses review_e ON review_e.id=r.expense_id
      WHERE c.id>$1::bigint AND direct_e.branch_id IS NULL
        AND payment_e.branch_id IS NULL AND review_e.branch_id IS NULL
      ORDER BY c.id LIMIT $2::int
    )
    SELECT c.id::text AS id,event.kind,event.evidence FROM page c
    LEFT JOIN finance.payments p ON p.id=c.payment_id
    LEFT JOIN finance.expense_reviews r ON r.id=c.review_id
    CROSS JOIN LATERAL (
      SELECT 'CORRECTION'::text AS kind,0::bigint AS event_id,jsonb_build_object(
        'expenseId',c.expense_id::text,'paymentId',c.payment_id::text,
        'paymentExpenseId',p.expense_id::text,'reviewId',c.review_id::text,
        'reviewExpenseId',r.expense_id::text,'beforeAmount',c.before_amount::text,
        'afterAmount',c.after_amount::text,'bookDifference',c.book_difference::text,
        'reason',c.reason) AS evidence
      UNION ALL
      SELECT 'MOVEMENT',m.id,jsonb_build_object('movementId',m.id::text,'branchId',m.branch_id::text,
        'kind',m.kind,'sourceId',m.source_id::text,'destinationId',m.destination_id::text,
        'amount',m.amount::text,'createdAt',m.created_at::text)
      FROM finance.movements m WHERE m.expense_correction_id=c.id
    ) event ORDER BY c.id,event.kind,event.event_id`;
  const result = await tx.query<Evidence>(sql, [afterId, limit + 1]);
  const ids = [...new Set(result.rows.map(row => row.id))];
  const include = new Set(ids.slice(0, limit));
  return { rows: result.rows.filter(row => include.has(row.id)), nextAfterId: ids.length > limit ? ids[limit - 1] : null };
}
