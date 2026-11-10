/**
 * Disposable result-link design for the standalone finance laboratory engine.
 * NOT a migration, NOT production code, and NOT proof of a cash movement.
 * The lab schema already carries finance_lab.request_results; this module makes
 * every lab command save a strict link and refuse legacy/tampered replays.
 * When the lab engine is wired to an experimental category port, the link uses
 * that port's plain existence read instead of guessing an INTEGER id.
 */
import { FinanceProblem, type FinanceCategoryPort, type FinanceTransaction } from "./types";

type IdRow = Record<string, unknown> & { id: string };
type LinkRow = Record<string, unknown> & { action: string; actorId: string; resultTable: string; resultId: string };
export type SavedResult = { action: string; actorId: string; resultId: string };

/** Whitelisted result tables; a value outside this set never reaches SQL. */
export const RESULT_TABLES = new Set([
  "finance_lab.accounts", "finance_lab.categories", "finance_lab.expenses",
  "finance_lab.payments", "finance_lab.movements", "finance_lab.cash_counts",
  "finance_lab.expense_reviews", "finance_lab.expense_corrections",
  "finance_lab.opening_corrections", "finance_lab.reconciliation_cases",
  "finance_lab.reconciliation_notes", "finance_lab.expense_attachments",
  "finance_lab.historical_commerce", "public.expense_categories",
] as const);
export type ResultTable = typeof RESULT_TABLES extends Set<infer T> ? T : never;
export const DYNAMIC_CATEGORY_TABLE = "DYNAMIC_CATEGORY";

/** Every `command()` action in the lab engine has an explicit table here. */
export const RESULT_TABLE_BY_ACTION: Record<string, ResultTable | typeof DYNAMIC_CATEGORY_TABLE> = {
  RECON_CASE_CREATE: "finance_lab.reconciliation_cases",
  RECON_CASE_NOTE: "finance_lab.reconciliation_notes",
  RECON_CASE_CLOSE: "finance_lab.reconciliation_cases",
  OPEN_ACCOUNT: "finance_lab.accounts",
  OPENING_CORRECTION: "finance_lab.opening_corrections",
  CATEGORY_CREATE: DYNAMIC_CATEGORY_TABLE,
  CATEGORY_EDIT: DYNAMIC_CATEGORY_TABLE,
  EXPENSE_CREATE: "finance_lab.expenses",
  EXPENSE_EDIT: "finance_lab.expenses",
  EXPENSE_APPROVE: "finance_lab.expenses",
  TRANSFER: "finance_lab.movements",
  EXPENSE_PAY: "finance_lab.payments",
  EXPENSE_REVIEW_CREATE: "finance_lab.expense_reviews",
  CASH_COUNT_CREATE: "finance_lab.cash_counts",
  CASH_COUNT_CONFIRM: "finance_lab.cash_counts",
  CASH_COUNT_CANCEL: "finance_lab.cash_counts",
  EXPENSE_REVIEW_CONFIRM: "finance_lab.expense_corrections",
  EXPENSE_REVIEW_CLOSE: "finance_lab.expense_reviews",
  EXPENSE_ATTACHMENT_ADD: "finance_lab.expense_attachments",
};

const reject = (): never => {
  throw new FinanceProblem("forbidden", "تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.");
};

/** A lab category command uses the explicit public bridge when present. */
export async function resolveResultTable(
  tx: FinanceTransaction, action: string, _resultId: string,
): Promise<ResultTable> {
  const mapped = RESULT_TABLE_BY_ACTION[action];
  if (!mapped) return reject();
  if (mapped !== DYNAMIC_CATEGORY_TABLE) return mapped;
  return tx.categoryPort ? "public.expense_categories" : "finance_lab.categories";
}

function positiveId(resultId: string, max?: bigint): boolean {
  try {
    const value = BigInt(resultId);
    return value > 0n && (max === undefined || value <= max);
  } catch { return false; }
}

async function resultRowExists(
  tx: FinanceTransaction, table: string, resultId: string, categoryPort?: FinanceCategoryPort,
): Promise<boolean> {
  if (table === "public.expense_categories") {
    if (!positiveId(resultId, 2147483647n)) return false;
    if (categoryPort) return categoryPort.exists(resultId);
    const rows = await tx.query<IdRow>(`SELECT id::text AS id FROM public.expense_categories WHERE id=$1::int`, [resultId]);
    return rows.rows[0]?.id === resultId;
  }
  if (!RESULT_TABLES.has(table as ResultTable) || !positiveId(resultId)) return false;
  const rows = await tx.query<IdRow>(`SELECT id::text AS id FROM ${table} WHERE id=$1::bigint`, [resultId]);
  return rows.rows[0]?.id === resultId;
}

export async function saveResultLink(
  tx: FinanceTransaction, requestId: string, action: string, actorId: string,
  resultTable: ResultTable, resultId: string, categoryPort?: FinanceCategoryPort,
): Promise<void> {
  if (!RESULT_TABLES.has(resultTable)) return reject();
  if (!(await resultRowExists(tx, resultTable, resultId, categoryPort))) return reject();
  await tx.query(`INSERT INTO finance_lab.request_results(request_id,action,actor_id,result_table,result_id)
    VALUES($1::uuid,$2,$3::bigint,$4,$5::bigint)`, [requestId, action, actorId, resultTable, resultId]);
}

/** Plain read, no new lock order. Strict: a missing/tampered link is refused. */
export async function requireSavedResultLink(
  tx: FinanceTransaction, requestId: string, prior: SavedResult, categoryPort?: FinanceCategoryPort,
): Promise<void> {
  const rows = await tx.query<LinkRow>(`SELECT action,actor_id::text AS "actorId",result_table AS "resultTable",result_id::text AS "resultId"
    FROM finance_lab.request_results WHERE request_id=$1::uuid`, [requestId]);
  const link = rows.rows[0];
  if (!link || link.action !== prior.action || link.actorId !== prior.actorId || link.resultId !== prior.resultId
    || !RESULT_TABLES.has(link.resultTable as ResultTable)) return reject();
  if (!(await resultRowExists(tx, link.resultTable, link.resultId, categoryPort))) return reject();
}
