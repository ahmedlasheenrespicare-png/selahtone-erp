/** Recorded source events only, not a cash balance or proof of physical payment.
 * $1=branch or null (authorized manager), $2=recorder or null, $3=Cairo month.
 * Call only after authorization and session/branch verification in one snapshot. */
export const RECORDED_FLOW_SQL = `
WITH bounds AS (SELECT ($3::date::timestamp AT TIME ZONE 'Africa/Cairo') AS from_at,
  LEAST((($3::date + INTERVAL '1 month')::timestamp AT TIME ZONE 'Africa/Cairo'), now()) AS to_at),
events AS (
  SELECT 'COLLECTION'::text AS kind, c.method, c.amount, c.created_at AS recorded_at,
    s.branch_id, c.created_by_id AS actor_id, (s.cancelled_at IS NOT NULL) AS flagged
  FROM public.commerce_collections c JOIN public.commerce_sales s ON s.id=c.sale_id
  UNION ALL
  SELECT 'REFUND'::text, r.method, r.amount, r.created_at, s.branch_id, r.created_by_id, (s.cancelled_at IS NOT NULL)
  FROM public.commerce_refunds r JOIN public.commerce_sales s ON s.id=r.sale_id
  UNION ALL
  SELECT 'PAYMENT'::text, p.method, p.amount, p.recorded_at, e.branch_id, p.recorded_by,
    (p.historical OR EXISTS(SELECT 1 FROM finance.expense_corrections x WHERE x.expense_id=e.id))
  FROM finance.payments p JOIN finance.expenses e ON e.id=p.expense_id
)
SELECT ev.kind, ev.method, SUM(ev.amount)::text AS amount, COUNT(*)::int AS count,
  COUNT(*) FILTER (WHERE ev.flagged)::int AS flagged
FROM events ev CROSS JOIN bounds b
WHERE ($1::bigint IS NULL OR ev.branch_id=$1::bigint) AND ($2::bigint IS NULL OR ev.actor_id=$2::bigint)
  AND ev.recorded_at >= b.from_at AND ev.recorded_at < b.to_at
GROUP BY ev.kind,ev.method ORDER BY ev.kind,ev.method`;
