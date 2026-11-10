/** Disposable experiment only. Not imported by the application or a migration.
 * Locks known predecessor rows and fails closed when the transaction's start
 * is not strictly later than each closed_at. This explores two schedules; it
 * cannot establish historical or physical ordering, clock correctness, all
 * writers, account identity, or safety of the experimental partial index.
 */
import { FinanceProblem, type FinanceDatabase, type FinanceTransaction } from "../../src/lib/finance/types";

export function guardSyntheticReplacementOpen(db: FinanceDatabase): FinanceDatabase {
  return { serializable: work => db.serializable(tx => {
    const port: FinanceTransaction = { ...tx, query: async <T extends Record<string, unknown>>(sql: string, params?: unknown[]) => {
      if (sql.includes("INSERT INTO finance.accounts (branch_id,kind,holder_id,opening_amount,opening_date,opened_by)") && params?.[1] === "CUSTODY") {
        const rows = await tx.query<{ closed: boolean; ordered: boolean | null }>(`SELECT closed_at IS NOT NULL AS closed,
          CURRENT_TIMESTAMP > closed_at AS ordered FROM finance.accounts
          WHERE branch_id=$1::bigint AND holder_id=$2::bigint AND kind='CUSTODY' ORDER BY id FOR UPDATE`, [params[0],params[2]]);
        if (!rows.rows.length || rows.rows.some(row => !row.closed || !row.ordered))
          throw new FinanceProblem("experimental_reopen_boundary", "اختبار اصطناعي: تعذر إثبات حد زمني لفتح العهدة البديلة؛ أعد المراجعة بمعاملة جديدة.");
      }
      return tx.query<T>(sql,params);
    } };
    return work(port);
  }) };
}
