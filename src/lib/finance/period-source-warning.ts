import type { FinanceTransaction } from "./types";

/** SQL expressions are trusted application constants, never user input. This
 * read-only hint does not establish physical custody or permanent membership. */
export function periodSourceWarningSql(branch: string, holder: string, since: string): string {
  return `((${holder}) IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.commerce_collections c JOIN public.commerce_sales s ON s.id=c.sale_id
      WHERE s.branch_id=(${branch}) AND c.method='CASH' AND c.created_at >= (${since})
        AND (s.created_by_id=(${holder}) OR to_jsonb(c)->>'created_by_id'=(${holder})::text)
        AND (to_jsonb(c)->>'created_by_id') IS DISTINCT FROM s.created_by_id::text)
    OR EXISTS (SELECT 1 FROM finance.payments p JOIN finance.expenses e ON e.id=p.expense_id
      WHERE e.branch_id=(${branch}) AND p.source='HOLDER_CASH' AND p.recorded_at >= (${since})
        AND (e.requested_by=(${holder}) OR p.recorded_by=(${holder}))
        AND p.recorded_by IS DISTINCT FROM e.requested_by)
  ))`;
}

/** Informational only: relevant mismatches (and missing collection recorder)
 * since the boundary, including ties. Never blocks a command. */
export async function periodSourceWarning(tx: FinanceTransaction, branchId: string, holderId: string | null, since: string): Promise<boolean> {
  if (!holderId) return false;
  const rows = await tx.query<{ found: boolean }>(
    `SELECT ${periodSourceWarningSql("$1::bigint", "$3::bigint", "$2::timestamptz")} AS found`,
    [branchId, since, holderId],
  );
  if (typeof rows.rows[0]?.found !== "boolean") throw new Error("period source warning unavailable");
  return rows.rows[0].found;
}
