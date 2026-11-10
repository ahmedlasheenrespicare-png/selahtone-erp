/**
 * TEST ONLY. Strict identity link for the lab engine's transaction callbacks.
 *
 * `command()` has its own UUID request id; the commerce callbacks do not. They
 * do, however, already carry a stable natural identity: a CASH collection or
 * refund writes finance_lab.movements with external_ref `collection:<id>` /
 * `refund:<id>`, and a historical record writes finance_lab.historical_commerce
 * with (event_type,event_id). A deterministic UUID derived from that identity
 * lets the callbacks reuse finance_lab.request_results WITHOUT a new table, a
 * new migration, a changed function signature or a changed release fingerprint.
 *
 * NOT a migration, NOT production code, and NOT proof that cash moved.
 */
import { createHash } from "node:crypto";
import { FinanceProblem, type FinanceTransaction } from "./types";
import { RESULT_TABLES, saveResultLink, type ResultTable } from "./request-result-link";

type IdentityRow = { id: string; ref: string };
type CallbackLinkRow = { action: string; actorId: string; resultTable: string; resultId: string };

/** Every row-creating commerce callback has an explicit whitelisted table. */
export const CALLBACK_RESULT_TABLE_BY_ACTION: Record<string, ResultTable> = {
  CASH_COLLECTION: "finance_lab.movements",
  CASH_REFUND: "finance_lab.movements",
  HISTORICAL_COMMERCE: "finance_lab.historical_commerce",
};

/** Same message as the command link: a missing/tampered link is never migrated. */
const reject = (): never => {
  throw new FinanceProblem("forbidden", "تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.");
};

/** Deterministic, collision-resistant UUID for a callback identity. */
export function callbackRequestId(action: string, externalRef: string): string {
  const hex = createHash("sha256").update(`selahtone-finance-callback:${action}:${externalRef}`).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function tableFor(action: string): ResultTable {
  const table = CALLBACK_RESULT_TABLE_BY_ACTION[action];
  if (!table || !RESULT_TABLES.has(table)) return reject();
  return table;
}

/** Plain read by natural identity; never a lock or a write. */
async function callbackRowByIdentity(
  tx: FinanceTransaction, action: string, table: ResultTable, externalRef: string,
): Promise<IdentityRow | null> {
  if (table === "finance_lab.movements") {
    const kind = action === "CASH_COLLECTION" ? "COLLECTION" : "REFUND";
    const rows = await tx.query<IdentityRow>(`SELECT id::text AS id, external_ref AS ref
      FROM finance_lab.movements WHERE kind=$1 AND external_ref=$2 ORDER BY id LIMIT 1`, [kind, externalRef]);
    return rows.rows[0] ?? null;
  }
  if (table === "finance_lab.historical_commerce") {
    const rows = await tx.query<IdentityRow>(`SELECT id::text AS id,
      lower(event_type)||':'||event_id::text AS ref FROM finance_lab.historical_commerce
      WHERE lower(event_type)||':'||event_id::text=$1 ORDER BY id LIMIT 1`, [externalRef]);
    return rows.rows[0] ?? null;
  }
  return reject();
}

/** Save the link AFTER the callback created its row, in the SAME transaction. */
export async function saveCallbackResultLink(
  tx: FinanceTransaction, action: string, externalRef: string, actorId: string, resultId: string,
): Promise<void> {
  const table = tableFor(action);
  const row = await callbackRowByIdentity(tx, action, table, externalRef);
  if (!row || row.id !== resultId || row.ref !== externalRef) return reject();
  await saveResultLink(tx, callbackRequestId(action, externalRef), action, actorId, table, resultId, tx.categoryPort);
}

/** Strict verification: link action/actor/table/row AND the row's natural identity. */
export async function requireCallbackResultLink(
  tx: FinanceTransaction, action: string, externalRef: string, prior: { action: string; actorId: string; resultId: string },
): Promise<void> {
  const table = tableFor(action);
  const id = callbackRequestId(action, externalRef);
  const rows = await tx.query<CallbackLinkRow>(`SELECT action,actor_id::text AS "actorId",
    result_table AS "resultTable",result_id::text AS "resultId"
    FROM finance_lab.request_results WHERE request_id=$1::uuid`, [id]);
  const link = rows.rows[0];
  if (!link || link.action !== prior.action || link.actorId !== prior.actorId
    || link.resultId !== prior.resultId || link.resultTable !== table) return reject();
  const row = await callbackRowByIdentity(tx, action, table, externalRef);
  if (!row || row.id !== prior.resultId || row.ref !== externalRef) return reject();
}

/**
 * Strict pre-check before a callback writes. An out-of-band/legacy result row
 * with no matching link is refused instead of being accepted or back-filled.
 * A correctly linked row is a duplicate, not a second write.
 */
export async function refuseUnlinkedCallbackResult(
  tx: FinanceTransaction, action: string, externalRef: string, actorId: string,
): Promise<void> {
  const table = tableFor(action);
  const row = await callbackRowByIdentity(tx, action, table, externalRef);
  if (!row) return;
  await requireCallbackResultLink(tx, action, externalRef, { action, actorId, resultId: row.id });
  throw new FinanceProblem("duplicate", "هوية الحركة النقدية مسجلة بالفعل؛ راجعها قبل إعادة التسجيل.");
}
