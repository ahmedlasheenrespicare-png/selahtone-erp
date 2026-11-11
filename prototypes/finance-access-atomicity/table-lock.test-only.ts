/**
 * PostgreSQL disposable experiment only. Not an authorization boundary and
 * never import this module into the application. The coarse lock is taken
 * before authentication to avoid a pre-lock SERIALIZABLE snapshot: this can
 * delay permission administration even for a revoked session. Global lock
 * order, database privileges, HTTP semantics and throughput are unreviewed.
 */
import { KNOWN_ACCESS_KEYS, resolveHiddenKeys, writeAllowedForKeys } from "../../src/lib/access-control";
import { financeDbForSession, type AuthenticatedFinanceSession } from "../../src/lib/finance/session-transaction";
import { FinanceProblem, type FinanceDatabase } from "../../src/lib/finance/types";

type AccessRow = { subject_kind: string; key: string; allowed: boolean };
/** No system-admin bypass is modelled; callers must be authenticated non-admins. */
export function accessTableLockTestOnly(db: FinanceDatabase, session: AuthenticatedFinanceSession, key: string): FinanceDatabase {
  if (!KNOWN_ACCESS_KEYS.has(key)) throw new FinanceProblem("forbidden", "اختبار: مفتاح صلاحية غير معروف.");
  return { serializable: work => db.serializable(async tx => {
    // Must be the first statement: taking a SERIALIZABLE snapshot before the
    // lock can retain stale permissions even after the waiting writer commits.
    await tx.query("LOCK TABLE public.access_control IN SHARE MODE");
    return financeDbForSession({serializable: fn => fn(tx)}, session).serializable(async current => {
      const rows = await current.query<AccessRow>(`SELECT subject_kind,key,allowed FROM public.access_control
        WHERE (subject_kind='role' AND subject=$1::text) OR (subject_kind='user' AND subject=$2::text)`, [session.role, session.id]);
      const role = new Map<string,boolean>(), user = new Map<string,boolean>();
      for (const row of rows.rows) (row.subject_kind === "role" ? role : user).set(row.key,row.allowed);
      if (!writeAllowedForKeys(resolveHiddenKeys(role,user),key)) throw new FinanceProblem("forbidden", "اختبار: الكتابة معطلة بالصلاحيات.");
      return work(current);
    });
  }) };
}
