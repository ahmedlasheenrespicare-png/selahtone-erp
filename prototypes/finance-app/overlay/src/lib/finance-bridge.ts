/** TEST ONLY: pure helpers used by the disposable finance/commerce bridge. */
import type { PrismaClient } from "@prisma/client";
import { signedMoney } from "../../prototypes/finance-engine/validation";
import { FinanceProblem, type FinanceTransaction } from "../../prototypes/finance-engine/types";

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
export function sqlError(error: unknown): never {
  if (typeof error === "object" && error && "code" in error) {
    const code = (error as { code?: string }).code;
    const meta = (error as { meta?: { code?: string; message?: string; driverAdapterError?: { cause?: { originalCode?: string; originalMessage?: string } } } }).meta;
    const driver = meta?.driverAdapterError?.cause;
    const pgCode = code === "P2034" ? "40001" : code === "P2010" ? (meta?.code ?? driver?.originalCode) : undefined;
    if (pgCode) {
      const converted = new Error("Disposable finance transaction failed") as Error & { code: string; constraint?: string };
      converted.code = pgCode;
      // Prisma adapters may report the PostgreSQL constraint in the message.
      const match = (meta?.message ?? driver?.originalMessage)?.match(/constraint ["']([^"']+)["']/);
      if (match) converted.constraint = match[1];
      throw converted;
    }
  }
  throw error;
}
export function financeTx(tx: Tx): FinanceTransaction {
  return { query: async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => {
    try { return { rows: await tx.$queryRawUnsafe<T[]>(sql, ...params) }; } catch (error) { return sqlError(error); }
  }, verifyBranchState: async (branchId, active) => { await assertFinanceBranch(tx, branchId, active); },
  verifySaleBranch: async (saleId, branchId) => {
    const rows = await tx.$queryRawUnsafe<Array<{branchId:string}>>(`SELECT branch_id::text AS "branchId" FROM public.commerce_sales WHERE id=$1::bigint FOR UPDATE`, saleId);
    if (!rows[0] || rows[0].branchId !== branchId) throw new FinanceProblem("sale_branch", "الفاتورة غير موجودة أو لا تتبع هذا الفرع؛ لم تُحفظ المراجعة.");
    // Force old SERIALIZABLE invoice snapshots to retry without changing any
    // invoice field, amount, timestamp, or revision when a claim is filed.
    await tx.$queryRawUnsafe(`UPDATE public.commerce_sales SET revision=revision WHERE id=$1::bigint RETURNING id`,saleId);
  } };
}
/** Refuse stale duplicated lab identity rows. Both the real session identity and
 * lab policy must agree, under locks in the same transaction. */
export async function assertFinanceActor(tx: Tx, actorId: string, expected?: { role: string; branchId: string | null }): Promise<void> {
  const rows = await tx.$queryRawUnsafe<Array<{ publicRole: string; labRole: string; publicBranch: string | null; labBranch: string | null; publicStatus: string; labStatus: string; publicChange: boolean; labChange: boolean }>>(`
    SELECT p.role_code::text AS "publicRole", l.role_code AS "labRole", p.branch_id::text AS "publicBranch", l.branch_id::text AS "labBranch",
      p.status::text AS "publicStatus", l.status AS "labStatus", p.must_change_password AS "publicChange", l.must_change_password AS "labChange"
    FROM public.users p JOIN finance_lab.users l ON l.id=p.id WHERE p.id=$1::bigint FOR SHARE OF p,l`, actorId);
  const a = rows[0];
  if (!a || a.publicStatus !== "ACTIVE" || a.labStatus !== "ACTIVE" || a.publicChange || a.labChange ||
      a.publicRole !== a.labRole || a.publicBranch !== a.labBranch ||
      (expected && (a.publicRole !== expected.role || a.publicBranch !== expected.branchId))) {
    throw new FinanceProblem("forbidden", "تعذّر التحقق من صلاحية الحساب في معمل التجربة.");
  }
}

/** The disposable public and finance schemas duplicate branch status. Check
 * BOTH under shared locks in the same transaction; disagreement fails closed. */
export async function assertFinanceBranch(tx: Tx, branchId: string, expectedActive: boolean): Promise<void> {
  const rows = await tx.$queryRawUnsafe<Array<{ publicActive: boolean; labActive: boolean }>>(`
    SELECT p.is_active AS "publicActive",l.is_active AS "labActive"
    FROM public.branches p JOIN finance_lab.branches l ON l.id=p.id WHERE p.id=$1::bigint FOR SHARE OF p,l`, branchId);
  const branch = rows[0];
  if (!branch || branch.publicActive !== branch.labActive || branch.publicActive !== expectedActive) {
    throw new FinanceProblem("branch_state_mismatch", "تعذّر التحقق من حالة الفرع في معمل التجربة؛ لم تُسجّل العملية.");
  }
}

/** Parsed before hashing so reusing a request with a different holder conflicts. */
export function parseCashChoice(raw: unknown, method: string, refund: boolean): { accountId: string | null; expectedBalance: string | null; negativeAcknowledged: boolean; checkpointRef: string | null; afterCheckpoint: boolean } {
  const data = (typeof raw === "object" && raw !== null && !Array.isArray(raw)) ? raw as Record<string, unknown> : {};
  if (method !== "CASH") {
    if (data.cashAccountId || data.expectedBalance || data.negativeAcknowledged === true || data.cashCheckpointRef || data.afterCheckpoint === true) throw new FinanceProblem("invalid_input", "الوسيلة غير النقدية لا تستخدم حسابًا نقديًا.");
    return { accountId: null, expectedBalance: null, negativeAcknowledged: false, checkpointRef: null, afterCheckpoint: false };
  }
  const accountId = typeof data.cashAccountId === "string" && /^[1-9]\d{0,18}$/.test(data.cashAccountId) && BigInt(data.cashAccountId) <= 9223372036854775807n ? data.cashAccountId : null;
  if (!accountId) throw new FinanceProblem("account_required", "اختر المكان الفعلي للنقد.");
  let expectedBalance: string | null = null;
  if (refund) {
    expectedBalance = signedMoney(data.expectedBalance, "الرصيد الذي روجع");
  } else if (data.expectedBalance || data.negativeAcknowledged === true) {
    throw new FinanceProblem("invalid_input", "التحصيل لا يخصم رصيدًا ولا يحتاج تأكيد سالب.");
  }
  if (data.negativeAcknowledged !== undefined && typeof data.negativeAcknowledged !== "boolean") throw new FinanceProblem("invalid_input", "تأكيد الرصيد غير صالح.");
  const checkpointRef = data.cashCheckpointRef === "OPENING" ? "OPENING" : typeof data.cashCheckpointRef === "string" && /^[1-9]\d{0,18}$/.test(data.cashCheckpointRef) && BigInt(data.cashCheckpointRef) <= 9223372036854775807n ? data.cashCheckpointRef : null;
  if (!checkpointRef || data.afterCheckpoint !== true) throw new FinanceProblem("checkpoint_review_required", "راجع آخر جرد للحساب وأكد أن التحصيل أو الرد الفعلي حدث بعده. إن سبقه استخدم مراجعة العملية التاريخية.");
  return { accountId, expectedBalance, negativeAcknowledged: data.negativeAcknowledged === true, checkpointRef, afterCheckpoint: true };
}
