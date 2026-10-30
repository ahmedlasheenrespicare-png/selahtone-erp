import "server-only";
import { prisma } from "@/lib/prisma";
import { appCategoryPort } from "./app-categories";
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

/** Map driver errors to PostgreSQL-ish codes; unknown errors are rethrown. */
export function sqlError(error: unknown): never {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: string }).code;
    const meta = (error as {
      meta?: { code?: string; message?: string; driverAdapterError?: { cause?: { originalCode?: string; originalMessage?: string } } };
    }).meta;
    const driver = meta?.driverAdapterError?.cause;
    const pgCode = code === "P2034" ? "40001" : code === "P2010" ? (meta?.code ?? driver?.originalCode) : undefined;
    if (pgCode) {
      const converted = new Error("Finance transaction failed") as Error & { code: string; constraint?: string };
      converted.code = pgCode;
      const match = (meta?.message ?? driver?.originalMessage)?.match(/constraint ["']([^"']+)["']/);
      if (match) converted.constraint = match[1];
      throw converted;
    }
  }
  throw error;
}

function port(tx: unknown): FinanceTransaction {
  const client = tx as { $queryRawUnsafe: <T>(sql: string, ...params: unknown[]) => Promise<T> };
  const adapter: FinanceTransaction = {
    query: async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => {
      try { return { rows: (await client.$queryRawUnsafe<T[]>(sql, ...params)) ?? [] }; } catch (error) { return sqlError(error); }
    },
    verifyBranchState: async (branchId: string, active: boolean) => {
      const rows = await client.$queryRawUnsafe<Array<{ active: boolean }>>(
        `SELECT is_active AS active FROM public.branches WHERE id=$1::bigint FOR SHARE`, branchId,
      );
      if (!rows[0] || rows[0].active !== active) throw new FinanceProblem("branch_state_mismatch", "تعذّر التحقق من حالة الفرع؛ لم تُسجَّل العملية.");
    },
    verifySaleBranch: async (saleId: string, branchId: string) => {
      const rows = await client.$queryRawUnsafe<Array<{ branchId: string }>>(
        `SELECT branch_id::text AS "branchId" FROM public.commerce_sales WHERE id=$1::bigint FOR UPDATE`, saleId,
      );
      if (!rows[0] || rows[0].branchId !== branchId) throw new FinanceProblem("sale_branch", "الفاتورة غير موجودة أو لا تتبع هذا الفرع؛ لم تُحفظ العملية.");
    },
  };
  // Category management rides the same transaction: the engine reaches the
  // existing public.expense_categories table only through this reviewed bridge.
  adapter.categoryPort = appCategoryPort(adapter);
  return adapter;
}

/** A single SERIALIZABLE transaction; every error rolls the whole unit back. */
export const financeDb: FinanceDatabase = {
  serializable: async (work) => {
    try {
      return await prisma.$transaction((tx) => work(port(tx)), { isolationLevel: "Serializable", maxWait: 5000, timeout: 20000 });
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
