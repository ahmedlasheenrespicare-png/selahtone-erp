import "server-only";
import { prisma } from "@/lib/prisma";
import { financePort, sqlError } from "./port";
import { FinanceProblem, type FinanceDatabase, type FinanceTransaction } from "./types";

/**
 * Staged finance access for the real application.
 *
 * The finance schema is NOT installed in production yet. While the
 * `FINANCE_ENABLED` flag is off, no page, action or query in this app reads or
 * writes the `finance` schema, so enabling this code in a deploy is a no-op for
 * users. Turning it on requires: a reviewed migration applied to the database,
 * a successful postflight comparison, and an explicit environment change that
 * is approved separately from any deploy.
 */
export function financeEnabled(): boolean {
  return process.env.FINANCE_ENABLED === "true";
}

export { sqlError };

/** A single SERIALIZABLE transaction; every error rolls the whole unit back. */
export const financeDb: FinanceDatabase = {
  serializable: async (work) => {
    try {
      return await prisma.$transaction((tx) => work(financePort(tx)), { isolationLevel: "Serializable", maxWait: 5000, timeout: 20000 });
    } catch (error) { return sqlError(error); }
  },
};

export type FinanceSession = { id: string; role: string; branchId: string | null };

/**
 * Re-check the session against the database row under a shared lock, inside the
 * same transaction. The session cookie is trusted for identity, but role,
 * branch, status and password change are re-read so a suspended user or a
 * changed role cannot act on a stale cookie.
 */
export async function assertFinanceActor(tx: FinanceTransaction, session: FinanceSession): Promise<void> {
  const rows = await tx.query<{ role: string; branchId: string | null; status: string; mustChange: boolean }>(
    `SELECT role_code::text AS role, branch_id::text AS "branchId", status::text AS status,
       must_change_password AS "mustChange" FROM public.users WHERE id=$1::bigint FOR SHARE`, [session.id]);
  const row = rows.rows[0];
  if (!row || row.status !== "ACTIVE" || row.mustChange || row.role !== session.role ||
      (row.branchId ?? null) !== (session.branchId ?? null)) {
    throw new FinanceProblem("forbidden", "تعذّر التحقق من صلاحية الحساب؛ أعد الدخول ثم حاول مرة أخرى.");
  }
}
