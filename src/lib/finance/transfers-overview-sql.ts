/** Shared authorized scope: $1 manager/accountant, $2 staff branch, $3 staff custody.
 * A null staff branch or custody matches nothing, never all branches. */
export const TRANSFER_SCOPE_SQL = `m.kind = 'TRANSFER' AND
  ($1::boolean OR (m.branch_id = $2::bigint AND
    (m.source_id = $3::bigint OR m.destination_id = $3::bigint)))`;

/** Aggregate recorded transfer movements, not a cash balance or physical proof.
 * $4 is the first Cairo date of the current month; stop at transaction time.
 * Call only after session revalidation in the same transaction as the ledger. */
export const TRANSFER_MONTH_SQL = `
WITH bounds AS (
  SELECT ($4::date::timestamp AT TIME ZONE 'Africa/Cairo') AS from_at,
    LEAST((($4::date + INTERVAL '1 month')::timestamp AT TIME ZONE 'Africa/Cairo'), CURRENT_TIMESTAMP) AS to_at
)
SELECT m.branch_id::text AS "branchId",
  (m.created_at AT TIME ZONE 'Africa/Cairo')::date::text AS "dateKey",
  CASE WHEN da.kind = 'VAULT' THEN 'TO_VAULT' ELSE 'TO_CUSTODY' END AS direction,
  SUM(m.amount)::text AS amount, COUNT(*)::int AS count
FROM finance.movements m
LEFT JOIN finance.accounts da ON da.id = m.destination_id
CROSS JOIN bounds b
WHERE ${TRANSFER_SCOPE_SQL}
  AND m.created_at >= b.from_at AND m.created_at < b.to_at
GROUP BY m.branch_id, (m.created_at AT TIME ZONE 'Africa/Cairo')::date,
  CASE WHEN da.kind = 'VAULT' THEN 'TO_VAULT' ELSE 'TO_CUSTODY' END
ORDER BY "dateKey", "branchId", direction`;
