import { redirect } from "next/navigation";
import { getSession, type SessionUser } from "@/lib/auth";
import { assertFinanceActor, financeDb, financeEnabled } from "@/lib/finance/db";
import type { FinanceTransaction } from "@/lib/finance/types";

/** Shared guard for every finance screen: no finance query runs while the staged
 * module is switched off, and the page falls back to the dashboard silently. */
export type FinanceContext = { session: SessionUser; canManage: boolean };

export async function financePage(): Promise<FinanceContext> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.mustChangePassword) redirect("/change-password");
  if (!financeEnabled()) redirect("/dashboard");
  return { session, canManage: session.role === "MANAGER" || session.role === "ACCOUNTANT" };
}

/** Reads inside one SERIALIZABLE transaction after re-checking the session row. */
export async function financeRead<T>(
  session: SessionUser,
  work: (tx: FinanceTransaction) => Promise<T>,
): Promise<T> {
  return financeDb.serializable(async (tx) => {
    await assertFinanceActor(tx, { id: session.id, role: session.role, branchId: session.branchId });
    return work(tx);
  });
}
