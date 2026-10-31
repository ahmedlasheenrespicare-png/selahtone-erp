import { appCategoryPort } from "./app-categories";
import { FinanceProblem, type FinanceTransaction } from "./types";

/**
 * The bridge that lets the finance engine run on any Prisma transaction.
 *
 * The engine speaks raw SQL over a tiny `query` port, so it can join an
 * already-open SERIALIZABLE transaction instead of opening a second one. That
 * is what keeps a commerce write (a sale, a collection, a refund) and its cash
 * movement atomic: they commit together or not at all.
 *
 * Kept free of `server-only` and of the Prisma singleton so tests and other
 * server modules can build a port without starting a client.
 */

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

export function financePort(tx: unknown): FinanceTransaction {
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
