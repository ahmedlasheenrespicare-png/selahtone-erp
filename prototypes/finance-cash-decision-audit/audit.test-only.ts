import type { FinanceTransaction } from "../../src/lib/finance/types";

export type CashDecisionOrphan = { id: string; kind: string; actorId: string; createdAt: string };
export type CashDecisionAudit = {
  movements: number;
  linked: number;
  orphans: CashDecisionOrphan[];
};

/** Synthetic read-only evidence audit. It verifies recorded decisions, never
 * physical cash, actual human presence, or coverage of an unknown legacy DB. */
export async function auditCashDecisionEvidence(tx: FinanceTransaction): Promise<CashDecisionAudit> {
  const result = await tx.query<CashDecisionOrphan & { requestId: string | null }>(`
    WITH evidence AS (
      -- Direct handover: its request result is the movement itself.
      SELECT m.id,r.request_id::text AS request_id FROM finance.movements m
      JOIN finance.requests r ON r.action='TRANSFER' AND r.result_id=m.id AND r.actor_id=m.actor_id AND r.created_at=m.created_at
      WHERE m.kind='TRANSFER' AND m.settlement_id IS NULL
      UNION ALL
      -- Opening correction: explicit reasoned book-only decision.
      SELECT m.id,r.request_id::text FROM finance.movements m
      JOIN finance.opening_corrections d ON d.id=m.opening_correction_id AND d.created_by=m.actor_id AND d.created_at=m.created_at AND length(btrim(d.reason))>=3
      JOIN finance.requests r ON r.action='OPENING_CORRECTION' AND r.result_id=d.id AND r.actor_id=m.actor_id AND r.created_at=m.created_at
      UNION ALL
      -- Account-funded expense: prior approval plus actual-payment attestation.
      SELECT m.id,r.request_id::text FROM finance.movements m
      JOIN finance.payments p ON p.id=m.expense_payment_id AND p.recorded_by=m.actor_id AND p.recorded_at=m.created_at AND p.actually_paid AND NOT p.historical
      JOIN finance.expenses e ON e.id=p.expense_id AND e.approved_by IS NOT NULL AND e.approved_at IS NOT NULL AND e.approved_at<=m.created_at
      JOIN finance.requests r ON r.action='EXPENSE_PAY' AND r.result_id=p.id AND r.actor_id=m.actor_id AND r.created_at=m.created_at
      UNION ALL
      -- Count adjustment: the reviewer resolved the exact count in this command.
      SELECT m.id,r.request_id::text FROM finance.movements m
      JOIN finance.cash_counts c ON c.id=m.cash_count_id AND c.status='CONFIRMED' AND c.resolved_by=m.actor_id AND c.resolved_at=m.created_at AND c.resolution_reason IS NOT NULL
      JOIN finance.requests r ON r.action='CASH_COUNT_CONFIRM' AND r.result_id=c.id AND r.actor_id=m.actor_id AND r.created_at=m.created_at
      UNION ALL
      -- Paid-expense correction: separate review and corrected resolution.
      SELECT m.id,r.request_id::text FROM finance.movements m
      JOIN finance.expense_corrections d ON d.id=m.expense_correction_id AND d.created_by=m.actor_id AND d.created_at=m.created_at
      JOIN finance.expense_reviews v ON v.id=d.review_id AND v.status='CORRECTED' AND v.resolved_by=m.actor_id AND v.resolved_at=m.created_at AND v.resolution_reason IS NOT NULL
      JOIN finance.requests r ON r.action='EXPENSE_REVIEW_CONFIRM' AND r.result_id=d.id AND r.actor_id=m.actor_id AND r.created_at=m.created_at
      UNION ALL
      -- Settlement adjustment and handover share one non-self approval.
      SELECT m.id,r.request_id::text FROM finance.movements m
      JOIN finance.settlements s ON s.id=m.settlement_id AND s.status='CONFIRMED' AND s.resolved_by=m.actor_id AND s.resolved_at=m.created_at
        AND s.resolution_reason IS NOT NULL AND s.requested_by<>s.resolved_by AND s.transfer_amount>=0
      JOIN finance.requests r ON r.action='SETTLEMENT_CONFIRM' AND r.result_id=s.id AND r.actor_id=m.actor_id AND r.created_at=m.created_at
      UNION ALL
      -- Real commerce collection record saved in the same transaction.
      SELECT m.id,c.request_id::text FROM finance.movements m
      JOIN public.commerce_collections c ON m.kind='COLLECTION' AND m.external_ref='collection:'||c.id::text
        AND c.created_by_id=m.actor_id AND c.created_at=m.created_at AND c.amount=m.amount AND c.method='CASH'
      JOIN public.commerce_sales s ON s.id=c.sale_id AND s.branch_id=m.branch_id
      UNION ALL
      -- A refund is linked only to its actual same-transaction commerce record.
      SELECT m.id,f.request_id::text FROM finance.movements m
      JOIN public.commerce_refunds f ON m.kind='REFUND' AND m.external_ref='refund:'||f.id::text
        AND f.created_by_id=m.actor_id AND f.created_at=m.created_at AND f.amount=m.amount AND f.method='CASH'
      JOIN public.commerce_sales s ON s.id=f.sale_id AND s.branch_id=m.branch_id
      UNION ALL
      -- Historical annotation is valid only with its attestations and audit.
      SELECT m.id,a.id::text FROM finance.movements m
      JOIN finance.historical_commerce h ON m.external_ref=lower(h.event_type)||':'||h.event_id::text
        AND h.created_by=m.actor_id AND h.created_at=m.created_at AND h.amount=m.amount AND h.branch_id=m.branch_id
        AND h.verified_actual AND h.before_checkpoint AND h.included_in_checkpoint AND h.not_previously_recorded
      JOIN finance.audit_events a ON a.entity_type='HISTORICAL_COMMERCE' AND a.entity_id=h.id AND a.actor_id=m.actor_id AND a.created_at=m.created_at AND a.reason IS NOT NULL
    )
    SELECT m.id::text AS id,m.kind,m.actor_id::text AS "actorId",m.created_at::text AS "createdAt",e.request_id::text AS "requestId"
    FROM finance.movements m LEFT JOIN evidence e ON e.id=m.id
  `);
  const orphans = result.rows.filter(row => !row.requestId).map(({ requestId: _requestId, ...row }) => row);
  return { movements: result.rows.length, linked: result.rows.length - orphans.length, orphans };
}
