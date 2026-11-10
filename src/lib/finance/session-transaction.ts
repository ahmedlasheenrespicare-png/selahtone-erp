import { FinanceProblem, type FinanceDatabase, type FinanceTransaction } from "./types";

export type FinanceSession = { id: string; role: string; branchId: string | null; email?: string };

/** Recheck the user attributes used by the outer access decision, under the
 * same row lock and transaction as the finance operation. When supplied, email
 * is matched too because system-admin access depends on it. This does not check
 * the auth-session row or make access-control rule changes atomic. */
export async function assertFinanceActor(tx: FinanceTransaction, session: FinanceSession): Promise<void> {
  const rows = await tx.query<{ role: string; branchId: string | null; status: string; mustChange: boolean; email: string }>(
    `SELECT email, role_code::text AS role, branch_id::text AS "branchId", status::text AS status,
       must_change_password AS "mustChange" FROM public.users WHERE id=$1::bigint FOR SHARE`, [session.id]);
  const row = rows.rows[0];
  if (!row || row.status !== "ACTIVE" || row.mustChange || row.role !== session.role ||
      (row.branchId ?? null) !== (session.branchId ?? null) ||
      (session.email !== undefined && row.email !== session.email)) {
    throw new FinanceProblem("forbidden", "تعذّر التحقق من صلاحية الحساب؛ أعد الدخول ثم حاول مرة أخرى.");
  }
}

/** Re-evaluate on every transaction, including retries and replay recovery. */
export function financeDbForActor(db: FinanceDatabase, session: FinanceSession): FinanceDatabase {
  return { serializable: work => db.serializable(async tx => {
    await assertFinanceActor(tx, session);
    return work(tx);
  }) };
}

export type AuthenticatedFinanceSession = FinanceSession & { sessionId: string; email: string };

/** Write boundary for authenticated HTTP actions. Lock user first, then the
 * particular session row: directory/password changes use that same order.
 * Revocation after the lock waits for this transaction; an expired/revoked or
 * mismatched session cannot begin a write or replay. This checks expiry when
 * the row is acquired, not continuously until commit. Access-control rules
 * are still checked separately by the action, outside the transaction. */
export function financeDbForSession(db: FinanceDatabase, session: AuthenticatedFinanceSession): FinanceDatabase {
  return { serializable: work => db.serializable(async tx => {
    await assertFinanceActor(tx, session);
    const locked = await tx.query<{ id: string }>(`SELECT id FROM public.auth_sessions
      WHERE id=$1::text AND user_id=$2::bigint FOR SHARE`, [session.sessionId, session.id]);
    if (!locked.rows[0])
      throw new FinanceProblem("forbidden", "انتهت الجلسة أو أُلغيت؛ سجّل الدخول مجددًا قبل المحاولة.");
    // Evaluate wall-clock expiry only *after* the row lock is acquired; a
    // waiting transaction may have started while the session was still valid.
    const result = await tx.query<{ valid: boolean }>(`SELECT expires_at > clock_timestamp() AS valid
      FROM public.auth_sessions WHERE id=$1::text AND user_id=$2::bigint`, [session.sessionId, session.id]);
    if (result.rows[0]?.valid !== true)
      throw new FinanceProblem("forbidden", "انتهت الجلسة أو أُلغيت؛ سجّل الدخول مجددًا قبل المحاولة.");
    return work(tx);
  }) };
}
