/**
 * Disposable schema-link design for finance command replays. NOT a migration,
 * NOT approval to run SQL on a business database, and NOT proof that a cash
 * movement occurred. The link table is a lab draft: it ties each saved command
 * to the row it created so a tampered `finance.requests.result_id` cannot point
 * at another row. Strict policy: an old request without a link is rejected.
 */
import { FinanceProblem, type FinanceCategoryPort, type FinanceTransaction } from "./types";

type IdRow = Record<string, unknown> & { id: string };
type LinkRow = Record<string, unknown> & { action: string; actorId: string; resultTable: string; resultId: string };
export type SavedResult = { action: string; actorId: string; resultId: string };

/** Whitelisted result tables; a value outside this set never reaches SQL. */
export const RESULT_TABLES = new Set([
  "finance.accounts", "finance.expenses", "finance.payments", "finance.movements",
  "finance.cash_counts", "finance.expense_reviews", "finance.expense_corrections",
  "finance.opening_corrections", "finance.reconciliation_cases", "finance.reconciliation_notes",
  "finance.custody_requests", "finance.settlements", "public.expense_categories",
] as const);
export type ResultTable = typeof RESULT_TABLES extends Set<infer T> ? T : never;
export const DYNAMIC_RESULT_TABLE = "DYNAMIC";

/** Every `command()` action in engine.ts must have an explicit table here. */
export const RESULT_TABLE_BY_ACTION: Record<string, ResultTable | typeof DYNAMIC_RESULT_TABLE> = {
  RECON_CASE_CREATE: "finance.reconciliation_cases",
  RECON_CASE_NOTE: "finance.reconciliation_notes",
  RECON_CASE_CLOSE: "finance.reconciliation_cases",
  OPEN_ACCOUNT: "finance.accounts",
  CLOSE_ACCOUNT: "finance.accounts",
  OPENING_CORRECTION: "finance.opening_corrections",
  CATEGORY_CREATE: "public.expense_categories",
  CATEGORY_EDIT: "public.expense_categories",
  EXPENSE_CREATE: "finance.expenses",
  EXPENSE_EDIT: "finance.expenses",
  EXPENSE_APPROVE: "finance.expenses",
  TRANSFER: "finance.movements",
  CUSTODY_REQUEST: "finance.custody_requests",
  CUSTODY_DECIDE: DYNAMIC_RESULT_TABLE,
  HOLDER_COUNT: "finance.cash_counts",
  COUNT_REQUEST: "finance.cash_counts",
  EXPENSE_PAY: "finance.payments",
  EXPENSE_REVIEW_CREATE: "finance.expense_reviews",
  CASH_COUNT_CREATE: "finance.cash_counts",
  CASH_COUNT_CONFIRM: "finance.cash_counts",
  CASH_COUNT_CANCEL: "finance.cash_counts",
  EXPENSE_REVIEW_CONFIRM: "finance.expense_corrections",
  EXPENSE_REVIEW_CLOSE: "finance.expense_reviews",
  SETTLEMENT_CREATE: "finance.settlements",
  SETTLEMENT_CONFIRM: "finance.settlements",
  SETTLEMENT_REJECT: "finance.settlements",
  SETTLEMENT_CANCEL: "finance.settlements",
};

const reject = (): never => {
  throw new FinanceProblem("forbidden", "تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.");
};

/** Approval returns an account id, rejection returns a custody-request id.
 *  The decision is taken from the command payload, NOT from a coincidental id
 *  collision between finance.accounts and finance.custody_requests. */
export async function resolveResultTable(
  tx: FinanceTransaction, action: string, resultId: string, payload?: unknown,
): Promise<ResultTable> {
  const mapped = RESULT_TABLE_BY_ACTION[action];
  if (!mapped) return reject();
  if (mapped !== DYNAMIC_RESULT_TABLE) return mapped;
  const decision = typeof payload === "object" && payload !== null && "decision" in payload
    ? (payload as { decision?: unknown }).decision : undefined;
  if (decision === "APPROVE") return "finance.accounts";
  if (decision === "REJECT") return "finance.custody_requests";
  return reject();
}

export async function saveResultLink(
  tx: FinanceTransaction, requestId: string, action: string, actorId: string,
  resultTable: ResultTable, resultId: string, categoryPort?: FinanceCategoryPort,
): Promise<void> {
  if (!RESULT_TABLES.has(resultTable)) return reject();
  if (!(await resultRowExists(tx, resultTable, resultId, categoryPort))) return reject();
  await tx.query(`INSERT INTO finance.request_results(request_id,action,actor_id,result_table,result_id)
    VALUES($1::uuid,$2,$3::bigint,$4,$5::bigint)`, [requestId, action, actorId, resultTable, resultId]);
}

async function resultRowExists(
  tx: FinanceTransaction, table: string, resultId: string, categoryPort?: FinanceCategoryPort,
): Promise<boolean> {
  if (table === "public.expense_categories") {
    if (categoryPort) return categoryPort.exists(resultId);
    const rows = await tx.query<IdRow>(`SELECT id::text AS id FROM public.expense_categories WHERE id=$1::int`, [resultId]);
    return rows.rows[0]?.id === resultId;
  }
  if (!RESULT_TABLES.has(table as ResultTable)) return false;
  const rows = await tx.query<IdRow>(`SELECT id::text AS id FROM ${table} WHERE id=$1::bigint`, [resultId]);
  return rows.rows[0]?.id === resultId;
}

/** Plain read, no new lock order. Strict: a missing/tampered link is refused. */
export async function requireSavedResultLink(
  tx: FinanceTransaction, requestId: string, prior: SavedResult, categoryPort?: FinanceCategoryPort,
): Promise<void> {
  const rows = await tx.query<LinkRow>(`SELECT action,actor_id::text AS "actorId",result_table AS "resultTable",result_id::text AS "resultId"
    FROM finance.request_results WHERE request_id=$1::uuid`, [requestId]);
  const link = rows.rows[0];
  if (!link || link.action !== prior.action || link.actorId !== prior.actorId || link.resultId !== prior.resultId
    || !RESULT_TABLES.has(link.resultTable as ResultTable)) return reject();
  if (!(await resultRowExists(tx, link.resultTable, link.resultId, categoryPort))) return reject();
}
