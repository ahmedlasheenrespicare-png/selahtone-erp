/** GLOBAL synthetic inventory only. Caller must own a consistent read-only
 * snapshot. Session opt-in is not authorization and cannot make this safe for
 * a real database. Never perform remediation from these rows. */
import type { FinanceTransaction } from "../../src/lib/finance/types";

type SyntheticCustody = Record<string, unknown> & {
  id: string;
  branchId: string | null;
  holderId: string | null;
  missingHolder: boolean;
  missingBranch: boolean;
  missingUser: boolean;
  inactiveUser: boolean;
  branchMismatch: boolean;
  anotherOpenCustody: boolean;
  openCount: boolean;
  openSettlement: boolean;
};

/** Pages by account id, not holder. No inference of financial balance, actual
 * cash, cause, chronological attribution, or which account is correct. */
export async function auditSyntheticOpenCustodies(
  tx: FinanceTransaction, afterId: string, limit: number,
): Promise<{ rows: SyntheticCustody[]; nextAfterId: string | null }> {
  if (!/^(0|[1-9]\d{0,17})$/.test(afterId)) throw new Error("invalid synthetic account cursor");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("invalid synthetic page limit");
  const enabled = await tx.query<{ enabled: string | null }>("SELECT current_setting('selahtone.custody_uniqueness_test_only', true) AS enabled");
  if (enabled.rows[0]?.enabled !== "yes") throw new Error("synthetic custody audit requires explicit opt-in");
  const result = await tx.query<SyntheticCustody>(`SELECT a.id::text AS id,a.branch_id::text AS "branchId",a.holder_id::text AS "holderId",
    (a.holder_id IS NULL) AS "missingHolder",(b.id IS NULL) AS "missingBranch",
    (a.holder_id IS NOT NULL AND u.id IS NULL) AS "missingUser",
    (u.id IS NOT NULL AND u.status::text IS DISTINCT FROM 'ACTIVE') AS "inactiveUser",
    (u.id IS NOT NULL AND u.branch_id IS DISTINCT FROM a.branch_id) AS "branchMismatch",
    EXISTS (SELECT 1 FROM finance.accounts other WHERE other.kind='CUSTODY' AND other.closed_at IS NULL
      AND other.holder_id=a.holder_id AND other.id<>a.id) AS "anotherOpenCustody",
    EXISTS (SELECT 1 FROM finance.cash_counts c WHERE c.account_id=a.id AND c.status='OPEN') AS "openCount",
    EXISTS (SELECT 1 FROM finance.settlements s WHERE s.account_id=a.id AND s.status='OPEN') AS "openSettlement"
    FROM finance.accounts a LEFT JOIN public.users u ON u.id=a.holder_id LEFT JOIN public.branches b ON b.id=a.branch_id
    WHERE a.kind='CUSTODY' AND a.closed_at IS NULL AND a.id>$1::bigint AND (
      a.holder_id IS NULL OR b.id IS NULL OR u.id IS NULL OR u.status::text IS DISTINCT FROM 'ACTIVE'
      OR u.branch_id IS DISTINCT FROM a.branch_id OR EXISTS (SELECT 1 FROM finance.accounts other
        WHERE other.kind='CUSTODY' AND other.closed_at IS NULL AND other.holder_id=a.holder_id AND other.id<>a.id))
    ORDER BY a.id LIMIT $2::int`, [afterId, limit + 1]);
  const rows = result.rows.slice(0, limit);
  return { rows, nextAfterId: result.rows.length > limit ? rows[rows.length - 1].id : null };
}
