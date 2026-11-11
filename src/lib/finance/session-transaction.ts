import { FinanceProblem, type FinanceDatabase, type FinanceTransaction } from "./types";
import {
  isSystemAdmin,
  parseAdminEmails,
  resolveHiddenKeys,
  writeAllowedForKeys,
} from "../access-control";

export type FinanceSession = { id: string; role: string; branchId: string | null; email?: string };

/** Recheck the user attributes used by the outer access decision, under the
 * same row lock and transaction as the finance operation. When supplied, email
 * is matched too because system-admin access depends on it. The authenticated
 * write wrapper below additionally checks the auth-session and access rules. */
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

type AccessRuleRow = { subject_kind: "role" | "user"; key: string; allowed: boolean };

/** Re-evaluate the same role/user rules used by the HTTP guard, inside the
 * finance transaction. Matching rows stay shared-locked until COMMIT, so a
 * concurrent revocation either wins before this decision or waits for it.
 * With SERIALIZABLE, a concurrent first deny also conflicts with the predicate
 * read instead of silently bypassing the write boundary. */
async function assertFinanceAccess(
  tx: FinanceTransaction,
  session: AuthenticatedFinanceSession,
  accessKey: string,
): Promise<void> {
  if (isSystemAdmin(session.role, session.email, parseAdminEmails(process.env.ADMIN_EMAILS))) return;
  const rows = await tx.query<AccessRuleRow>(
    `SELECT subject_kind, key, allowed FROM public.access_control
      WHERE (subject_kind='role' AND subject=$1)
         OR (subject_kind='user' AND subject=$2)
      FOR SHARE`,
    [session.role, session.id],
  );
  const roleRows = new Map<string, boolean>();
  const userRows = new Map<string, boolean>();
  for (const row of rows.rows) {
    if (row.subject_kind === "role") roleRows.set(row.key, row.allowed);
    else userRows.set(row.key, row.allowed);
  }
  if (!writeAllowedForKeys(resolveHiddenKeys(roleRows, userRows), accessKey)) {
    throw new FinanceProblem("forbidden", "تغيّرت صلاحية هذه العملية؛ راجع الصفحة قبل إعادة المحاولة.");
  }
}

async function assertSessionValid(tx: FinanceTransaction, session: AuthenticatedFinanceSession): Promise<void> {
  const result = await tx.query<{ valid: boolean }>(`SELECT expires_at > clock_timestamp() AS valid
    FROM public.auth_sessions WHERE id=$1::text AND user_id=$2::bigint`, [session.sessionId, session.id]);
  if (result.rows[0]?.valid !== true)
    throw new FinanceProblem("forbidden", "انتهت الجلسة أو أُلغيت؛ سجّل الدخول مجددًا قبل المحاولة.");
}

/** Write boundary for authenticated HTTP actions. Lock user, access rules and
 * then the particular session row in a consistent order. The access decision
 * is repeated here even though the action already checked it for early UX
 * feedback. Session expiry is checked both before the work and again after all
 * writes, immediately before the adapter commits; revocation of a locked row
 * waits for the transaction. */
export function financeDbForSession(
  db: FinanceDatabase,
  session: AuthenticatedFinanceSession,
  accessKey: string,
): FinanceDatabase {
  return { serializable: work => db.serializable(async tx => {
    await assertFinanceActor(tx, session);
    await assertFinanceAccess(tx, session, accessKey);
    const locked = await tx.query<{ id: string }>(`SELECT id FROM public.auth_sessions
      WHERE id=$1::text AND user_id=$2::bigint FOR SHARE`, [session.sessionId, session.id]);
    if (!locked.rows[0])
      throw new FinanceProblem("forbidden", "انتهت الجلسة أو أُلغيت؛ سجّل الدخول مجددًا قبل المحاولة.");
    await assertSessionValid(tx, session);
    const result = await work(tx);
    await assertSessionValid(tx, session);
    return result;
  }) };
}
