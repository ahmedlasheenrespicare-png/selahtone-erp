/**
 * TEST ONLY. Strict request -> result link for the disposable finance_candidate
 * category bridge. NOT a migration, NOT production code, and NOT proof that a
 * cash movement occurred. The candidate schema carries its own request_results
 * table; a saved request without a link is refused under the strict policy.
 */
import { FinanceProblem, type FinanceCategoryPort, type FinanceTransaction } from "../finance-engine/types";

type LinkRow = Record<string, unknown> & { action: string; actorId: string; resultTable: string; resultId: string };
export type SavedResult = { action: string; actorId: string; resultId: string };

/** Only the legacy category table is a valid result for CREATE/EDIT here. */
export const CANDIDATE_RESULT_TABLES = new Set(["public.expense_categories"] as const);
export type CandidateResultTable = typeof CANDIDATE_RESULT_TABLES extends Set<infer T> ? T : never;
export const CANDIDATE_ACTION_TABLE: Record<string, CandidateResultTable> = {
  CREATE: "public.expense_categories",
  EDIT: "public.expense_categories",
};

const reject = (): never => {
  throw new FinanceProblem("forbidden", "تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.");
};

export function resolveCandidateResultTable(action: string): CandidateResultTable {
  const table = CANDIDATE_ACTION_TABLE[action];
  if (!table || !CANDIDATE_RESULT_TABLES.has(table)) return reject();
  return table;
}

function positiveId(resultId: string): boolean {
  try {
    const value = BigInt(resultId);
    return value > 0n && value <= 2147483647n;
  } catch { return false; }
}

async function resultRowExists(
  tx: FinanceTransaction, resultId: string, categoryPort?: FinanceCategoryPort,
): Promise<boolean> {
  if (!positiveId(resultId)) return false;
  if (categoryPort) return categoryPort.exists(resultId);
  const rows = await tx.query<{ id: string }>(`SELECT id::text AS id FROM public.expense_categories WHERE id=$1::int`, [resultId]);
  return rows.rows[0]?.id === resultId;
}

export async function saveResultLink(
  tx: FinanceTransaction, requestId: string, action: string, actorId: string,
  resultTable: CandidateResultTable, resultId: string, categoryPort?: FinanceCategoryPort,
): Promise<void> {
  if (!CANDIDATE_ACTION_TABLE[action] || !CANDIDATE_RESULT_TABLES.has(resultTable)) return reject();
  if (!(await resultRowExists(tx, resultId, categoryPort))) return reject();
  await tx.query(`INSERT INTO finance_candidate.request_results(request_id,action,actor_id,result_table,result_id)
    VALUES($1::uuid,$2,$3::bigint,$4,$5::bigint)`, [requestId, action, actorId, resultTable, resultId]);
}

/** Plain read, no new lock order. Strict: a missing/tampered link is refused. */
export async function requireSavedResultLink(
  tx: FinanceTransaction, requestId: string, prior: SavedResult, categoryPort?: FinanceCategoryPort,
): Promise<void> {
  const rows = await tx.query<LinkRow>(`SELECT action,actor_id::text AS "actorId",result_table AS "resultTable",result_id::text AS "resultId"
    FROM finance_candidate.request_results WHERE request_id=$1::uuid`, [requestId]);
  const link = rows.rows[0];
  if (!link || link.action !== prior.action || link.actorId !== prior.actorId || link.resultId !== prior.resultId
    || !CANDIDATE_RESULT_TABLES.has(link.resultTable as CandidateResultTable)) return reject();
  if (!(await resultRowExists(tx, link.resultId, categoryPort))) return reject();
}
