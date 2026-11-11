/** Disposable synthetic audit, NOT a production tool or an allocation decision.
 * Candidate custodies are based on the expense requester and branch solely to
 * enumerate possible evidence; they do not establish physical possession. */
import type { FinanceTransaction } from "../../src/lib/finance/types";

export type HolderCheckpointEvidence = Record<string, unknown> & {
  paymentId: string;
  expenseId: string;
  branchId: string;
  requesterId: string;
  recorderId: string;
  paymentDate: string;
  recordedAt: string;
  amount: string;
  accountId: string | null;
  accountClosedAt: string | null;
  referenceType: "OPENING" | "SETTLEMENT" | "COUNT" | null;
  referenceId: string | null;
  referenceDate: string | null;
  referenceRecordedAt: string | null;
  dateBefore: boolean | null;
  dateSame: boolean | null;
  recordedAfter: boolean | null;
  recordedEqual: boolean | null;
};

/** Single query and caller-owned read-only snapshot. Limit applies to payments,
 * not evidence rows. Never use on real data: no security or scalability review. */
export async function auditSyntheticHolderCheckpoints(
  tx: FinanceTransaction,
  branchId: string,
  afterPaymentId: string,
  limit: number,
): Promise<{ rows: HolderCheckpointEvidence[]; nextAfterId: string | null }> {
  if (!/^[1-9]\d{0,17}$/.test(branchId) || !/^(0|[1-9]\d{0,17})$/.test(afterPaymentId)) throw new Error("invalid synthetic identifier");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("invalid synthetic page limit");
  const optIn = await tx.query<{ enabled: string | null }>("SELECT current_setting('selahtone.holder_checkpoint_audit_test_only', true) AS enabled");
  if (optIn.rows[0]?.enabled !== "yes") throw new Error("synthetic audit requires explicit test-only opt-in");

  const result = await tx.query<HolderCheckpointEvidence>(`WITH page AS (
    SELECT p.id,p.expense_id,p.amount,p.payment_date,p.recorded_at,p.recorded_by,e.branch_id,e.requested_by
    FROM finance.payments p JOIN finance.expenses e ON e.id=p.expense_id
    WHERE p.source='HOLDER_CASH' AND e.branch_id=$1::bigint AND p.id > $2::bigint
    ORDER BY p.id LIMIT $3::int
  )
  SELECT p.id::text AS "paymentId",p.expense_id::text AS "expenseId",p.branch_id::text AS "branchId",
    p.requested_by::text AS "requesterId",p.recorded_by::text AS "recorderId",
    p.payment_date::text AS "paymentDate",p.recorded_at::text AS "recordedAt",p.amount::text AS amount,
    a.id::text AS "accountId",a.closed_at::text AS "accountClosedAt",
    r.type AS "referenceType",r.id::text AS "referenceId",r.date::text AS "referenceDate",r.recorded_at::text AS "referenceRecordedAt",
    (p.payment_date < r.date) AS "dateBefore",(p.payment_date = r.date) AS "dateSame",
    (p.recorded_at > r.recorded_at) AS "recordedAfter",(p.recorded_at = r.recorded_at) AS "recordedEqual"
  FROM page p
  LEFT JOIN finance.accounts a ON a.kind='CUSTODY' AND a.branch_id=p.branch_id AND a.holder_id=p.requested_by
  LEFT JOIN LATERAL (
    SELECT 'OPENING'::text AS type, a.id AS id, a.opening_date AS date, a.opened_at AS recorded_at WHERE a.id IS NOT NULL
    UNION ALL
    SELECT 'SETTLEMENT'::text, s.id, (s.resolved_at AT TIME ZONE 'Africa/Cairo')::date, s.resolved_at
      FROM finance.settlements s WHERE s.account_id=a.id AND s.status='CONFIRMED'
    UNION ALL
    SELECT 'COUNT'::text, c.id, c.counted_on, c.resolved_at
      FROM finance.cash_counts c WHERE c.account_id=a.id AND c.status='CONFIRMED'
  ) r ON true
  ORDER BY p.id,a.id,r.type,r.recorded_at,r.id`, [branchId, afterPaymentId, limit + 1]);
  const paymentIds = [...new Set(result.rows.map((row) => row.paymentId))];
  const nextAfterId = paymentIds.length > limit ? paymentIds[limit - 1] : null;
  const included = new Set(paymentIds.slice(0, limit));
  return { rows: result.rows.filter((row) => included.has(row.paymentId)), nextAfterId };
}
