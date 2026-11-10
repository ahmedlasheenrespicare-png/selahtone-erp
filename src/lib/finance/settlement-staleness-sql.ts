/** Display-only conservative indicator. Aliases: settlement st, account a.
 * The engine remains authoritative under lock; this does not prove a request
 * is confirmable, and timestamps alone cannot establish commit order. */
export const SETTLEMENT_STALE_SQL = `(
  (to_jsonb(st)->>'account_revision') IS DISTINCT FROM a.revision::text
  OR EXISTS (SELECT 1 FROM finance.movements m
    WHERE (m.source_id=a.id OR m.destination_id=a.id) AND m.created_at > st.created_at)
  OR EXISTS (SELECT 1 FROM public.commerce_collections c JOIN public.commerce_sales s ON s.id=c.sale_id
    WHERE s.branch_id=a.branch_id AND c.method='CASH' AND c.created_at > st.created_at)
  OR EXISTS (SELECT 1 FROM finance.payments p JOIN finance.expenses e ON e.id=p.expense_id
    WHERE e.branch_id=a.branch_id AND p.source='HOLDER_CASH' AND p.recorded_at > st.created_at)
)`;
