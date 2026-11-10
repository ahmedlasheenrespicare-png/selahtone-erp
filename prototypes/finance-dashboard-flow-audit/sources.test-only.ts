import type { FinanceTransaction } from "../../src/lib/finance/types";
import type { SyntheticEvent } from "./recorded-flow.test-only";

export type SyntheticSourceEvent = SyntheticEvent & {
  cancelledSale: boolean;
  historicalPayment: boolean;
  hasCorrection: boolean;
};

/** Test-only evidence inventory. Must be called in a disposable synthetic DB
 * under a caller-owned READ ONLY transaction and explicit opt-in. Not an API. */
export async function readSyntheticRecordedEvents(tx: FinanceTransaction, scope: { branchId: string; actorId?: string }, month: string): Promise<SyntheticSourceEvent[]> {
  if (!/^[1-9]\d{0,18}$/.test(scope.branchId) || (scope.actorId !== undefined && !/^[1-9]\d{0,18}$/.test(scope.actorId)) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("invalid synthetic scope or month");
  const gate = await tx.query<{ enabled: string | null }>(`SELECT current_setting('selahtone.dashboard_flow_test_only', true) AS enabled`);
  if (gate.rows[0]?.enabled !== "yes") throw new Error("synthetic dashboard flow opt-in required");
  // The moment is recording time, not cash receipt/payment time. Include
  // cancelled sales and mark them; never manufacture a reversal for cancellation.
  // payment.amount is the recorded payment, not a later expense correction.
  const rows = await tx.query<SyntheticSourceEvent>(`
    WITH bounds AS (SELECT ($3::date::timestamp AT TIME ZONE 'Africa/Cairo') AS start_at,
      (($3::date + INTERVAL '1 month')::timestamp AT TIME ZONE 'Africa/Cairo') AS end_at),
    events AS (
      SELECT 'COLLECTION'::text AS kind, c.id, s.branch_id, c.created_by_id AS actor_id, c.method, c.amount, c.created_at AS recorded_at,
        (s.cancelled_at IS NOT NULL) AS cancelled_sale, false AS historical_payment, false AS has_correction
      FROM public.commerce_collections c JOIN public.commerce_sales s ON s.id=c.sale_id
      UNION ALL
      SELECT 'REFUND'::text, r.id, s.branch_id, r.created_by_id, r.method, r.amount, r.created_at,
        (s.cancelled_at IS NOT NULL), false, false
      FROM public.commerce_refunds r JOIN public.commerce_sales s ON s.id=r.sale_id
      UNION ALL
      SELECT 'PAYMENT'::text, p.id, e.branch_id, p.recorded_by, p.method, p.amount, p.recorded_at,
        false, p.historical, EXISTS(SELECT 1 FROM finance.expense_corrections ec WHERE ec.expense_id=e.id)
      FROM finance.payments p JOIN finance.expenses e ON e.id=p.expense_id
    )
    SELECT ev.id::text AS id, ev.kind, ev.branch_id::text AS "branchId", ev.actor_id::text AS "actorId", ev.method,
      ev.amount::text AS amount, to_char(ev.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "recordedAt",
      ev.cancelled_sale AS "cancelledSale", ev.historical_payment AS "historicalPayment", ev.has_correction AS "hasCorrection"
    FROM events ev CROSS JOIN bounds b
    WHERE ev.branch_id=$1::bigint AND ($2::bigint IS NULL OR ev.actor_id=$2::bigint)
      AND ev.recorded_at >= b.start_at AND ev.recorded_at < b.end_at
    ORDER BY ev.kind,ev.id`, [scope.branchId, scope.actorId ?? null, `${month}-01`]);
  return rows.rows;
}
