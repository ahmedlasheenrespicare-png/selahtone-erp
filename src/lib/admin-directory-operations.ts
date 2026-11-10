import type { PrismaClient, RoleCode, UserStatus } from "@prisma/client";
import { canManageTargetUser, type AdminRole } from "./admin-directory";
import { financePort, sqlError } from "./finance/port";

/** Used after the server action has authenticated the system admin. */
export class DirectoryProblem extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "DirectoryProblem"; }
}
type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
const codeOf = (e: unknown) => typeof e === "object" && e !== null && "code" in e ? String(e.code) : "";
const retryable = (e: unknown) => ["P2034", "40001", "40P01"].includes(codeOf(e));
async function run<T>(db: PrismaClient, work: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await db.$transaction(work, { isolationLevel: "Serializable", maxWait: 5000, timeout: 20000 }); }
    catch (e) {
      // Prisma errors from transaction/commit and raw SQL both have to be
      // recognized; financePort normalizes raw SQL before reaching here.
      let normalized: unknown = e;
      try { sqlError(e); } catch (converted) { normalized = converted; }
      if (retryable(normalized) && attempt < 2) continue;
      if (retryable(normalized)) throw new DirectoryProblem("concurrency", "تغيّرت البيانات بالتزامن؛ أعد فتح النموذج وحاول مجددًا.");
      throw e;
    }
  }
}
async function checkBranch(tx: Tx, branchId: bigint | null): Promise<void> {
  if (branchId === null) return;
  const rows = await financePort(tx).query<{ active: boolean }>(`SELECT is_active AS active FROM public.branches WHERE id=$1::bigint FOR SHARE`, [branchId.toString()]);
  if (!rows.rows[0]?.active) throw new DirectoryProblem("branch_unavailable", "الفرع المختار غير موجود أو غير نشط.");
}
async function openCustodies(tx: Tx, query: string, params: string[]) {
  try { return await financePort(tx).query<{ id: string }>(query, params); }
  catch (e) {
    if (retryable(e)) throw e;
    throw new DirectoryProblem("custody_unavailable", "تعذّر التحقق من العهد النقدية؛ لم يُحفظ التغيير. راجع جاهزية المالية ثم أعد المحاولة.");
  }
}

/** Detect an installed finance schema even when its UI flag is off. */
async function custodyTablePresent(tx: Tx, financeOn: boolean): Promise<boolean> {
  if (financeOn) return true; // If missing, the guarded account query fails closed.
  try {
    const presence = await financePort(tx).query<{ schemaPresent: boolean; tablePresent: boolean }>(`SELECT to_regnamespace('finance') IS NOT NULL AS "schemaPresent", to_regclass('finance.accounts') IS NOT NULL AS "tablePresent"`);
    const state = presence.rows[0];
    if (!state || (state.schemaPresent && !state.tablePresent)) throw new DirectoryProblem("custody_unavailable", "مخطط المالية غير مكتمل؛ لم يُحفظ التغيير.");
    return state.tablePresent;
  } catch (e) {
    if (retryable(e) || e instanceof DirectoryProblem) throw e;
    throw new DirectoryProblem("custody_unavailable", "تعذّر التحقق من جاهزية المالية؛ لم يُحفظ التغيير.");
  }
}

type DirectoryFinanceAccount = { id: string; branchId: string; kind: string; holderId: string | null };
/** Read-only UI hint, never an authorization decision; actions recheck under locks. */
export async function readDirectoryFinanceAccounts(db: PrismaClient, financeOn: boolean): Promise<{ state: "absent" | "ready" | "unavailable"; rows: DirectoryFinanceAccount[] }> {
  try {
    return await run(db, async tx => {
      if (!(await custodyTablePresent(tx, financeOn))) return { state: "absent" as const, rows: [] };
      const result = await financePort(tx).query<DirectoryFinanceAccount>(`SELECT id::text AS id,branch_id::text AS "branchId",kind::text AS kind,holder_id::text AS "holderId" FROM finance.accounts WHERE closed_at IS NULL`);
      return { state: "ready" as const, rows: result.rows };
    });
  } catch (error) {
    // Avoid leaking SQL or account data through logs; the UI reports uncertainty.
    console.error("Directory custody summary unavailable", codeOf(error) || "unknown");
    return { state: "unavailable", rows: [] };
  }
}

type UserData = { fullName: string; email: string; phone: string | null; roleCode: RoleCode; branchId: bigint | null; status: UserStatus };
type ExpectedUser = Pick<UserData, "fullName" | "email" | "phone" | "roleCode" | "branchId" | "status">;
export async function updateDirectoryUser(db: PrismaClient, input: { userId: bigint; actorRole: AdminRole; data: UserData; expected: ExpectedUser; financeOn: boolean; revokeSessions?: boolean }): Promise<void> {
  await run(db, async tx => {
    // Branch before user agrees with opening custody (branch then holder).
    await checkBranch(tx, input.data.branchId);
    const locked = await financePort(tx).query<{ id: string }>(`SELECT id::text AS id FROM public.users WHERE id=$1::bigint FOR UPDATE`, [input.userId.toString()]);
    if (!locked.rows[0]) throw new DirectoryProblem("not_found", "المستخدم غير موجود.");
    const target = await tx.user.findUniqueOrThrow({ where: { id: input.userId }, select: { fullName: true, email: true, phone: true, roleCode: true, branchId: true, status: true } });
    if (!canManageTargetUser(input.actorRole, target.roleCode)) throw new DirectoryProblem("forbidden", "إدارة حسابات المديرين والمحاسبين متاحة للمدير العام فقط.");
    const expected = input.expected;
    if (target.fullName !== expected.fullName || target.email !== expected.email || target.phone !== expected.phone || target.roleCode !== expected.roleCode || target.branchId !== expected.branchId || target.status !== expected.status)
      throw new DirectoryProblem("user_changed", "تغيّرت بيانات المستخدم؛ أعد فتح النموذج وراجعها.");
    const branchChanged = target.branchId !== input.data.branchId;
    const suspending = target.status === "ACTIVE" && input.data.status === "SUSPENDED";
    if ((branchChanged || suspending) && await custodyTablePresent(tx, input.financeOn)) {
      const rows = await openCustodies(tx, `SELECT id::text AS id FROM finance.accounts WHERE kind='CUSTODY' AND holder_id=$1::bigint AND closed_at IS NULL ORDER BY id LIMIT 1`, [input.userId.toString()]);
      const account = rows.rows[0];
      if (account) throw new DirectoryProblem("open_custody", `لا يمكن ${suspending ? "إيقاف حساب الموظف" : "نقل الموظف إلى فرع آخر"} وفي ذمّته عهدة نقدية مفتوحة (#${account.id}). راجع مسؤول النظام لتصفيتها وإقفالها أولًا.`);
    }
    await tx.user.update({ where: { id: input.userId }, data: input.data });
    if (input.data.status === "SUSPENDED" || input.revokeSessions) await tx.authSession.deleteMany({ where: { userId: input.userId } });
  });
}
/** For trusted local operators; this is NOT an authorization boundary. */
export async function setDirectoryUserStatus(db: PrismaClient, email: string, status: UserStatus, financeEnabled: boolean): Promise<void> {
  const target = await db.user.findUnique({ where: { email }, select: { id: true, fullName: true, email: true, phone: true, roleCode: true, branchId: true, status: true } });
  if (!target) throw new DirectoryProblem("not_found", "المستخدم غير موجود.");
  const expected = { fullName: target.fullName, email: target.email, phone: target.phone, roleCode: target.roleCode, branchId: target.branchId, status: target.status };
  await updateDirectoryUser(db, { userId: target.id, actorRole: "MANAGER", expected, data: { ...expected, status }, financeOn: financeEnabled, revokeSessions: true });
}
export async function createDirectoryUser(db: PrismaClient, data: UserData & { passwordHash: string; mustChangePassword: boolean }): Promise<void> {
  await run(db, async tx => { await checkBranch(tx, data.branchId); await tx.user.create({ data }); });
}
export async function setDirectoryBranchActive(db: PrismaClient, branchId: bigint, active: boolean, financeOn: boolean): Promise<void> {
  await run(db, async tx => {
    const row = await financePort(tx).query<{ id: string }>(`SELECT id::text AS id FROM public.branches WHERE id=$1::bigint FOR UPDATE`, [branchId.toString()]);
    if (!row.rows[0]) throw new DirectoryProblem("not_found", "الفرع غير موجود.");
    if (!active) {
      const count = await tx.user.count({ where: { branchId, status: "ACTIVE" } });
      if (count > 0) throw new DirectoryProblem("active_users", `انقل الموظفين النشطين (${count}) أو أوقف حساباتهم قبل إيقاف الفرع.`);
      if (await custodyTablePresent(tx, financeOn)) {
        const rows = await openCustodies(tx, `SELECT id::text AS id FROM finance.accounts WHERE branch_id=$1::bigint AND kind='CUSTODY' AND closed_at IS NULL ORDER BY id LIMIT 1`, [branchId.toString()]);
        if (rows.rows.length) throw new DirectoryProblem("open_custody", "يوجد بالفرع عهدة نقدية مفتوحة لم تُقفل بعد؛ راجع مسؤول النظام لتصفيتها وإقفالها قبل إيقاف الفرع.");
      }
    }
    await tx.branch.update({ where: { id: branchId }, data: { isActive: active } });
    await tx.warehouse.updateMany({ where: { branchId }, data: { isActive: active } });
  });
}
