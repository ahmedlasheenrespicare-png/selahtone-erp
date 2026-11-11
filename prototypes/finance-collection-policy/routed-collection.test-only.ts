/**
 * Disposable laboratory command. NOT imported by the application, NOT a
 * migration, NOT an authorization layer and NOT proof of physical cash.
 *
 * It extends the branch-marker experiment with ONE decision point: the cash
 * destination is read AFTER the shared marker and AFTER replay resolution.
 * A custody opening that committed before this point must be visible to the
 * collection, even if the collection transaction started earlier. Participating
 * writers share the marker; the whole transaction must be retried on a
 * serialization abort. Replay never re-routes and never touches the marker.
 */
import { chooseCashDestination, type CashAccount, type Collector } from "./destination";
import { recordRoutedCollectionTestOnly } from "./vault-collection-command.test-only";
import { branchMarker } from "./branch-barrier.test-only";
import { FinanceProblem, type FinanceDatabase, type FinanceTransaction, type WriteResult } from "../../src/lib/finance/types";

type Row = Record<string, unknown>;
type Collection = { requestId: string; saleId: string; amount: string; method: string; actuallyPaid: boolean; vaultReceived: boolean };

const problem = (message: string): never => { throw new FinanceProblem("experimental_route", message); };

/** Read-only destination decision. The caller owns the snapshot and locks. */
async function readRoute(tx: FinanceTransaction, branch: string, actorId: bigint): Promise<"VAULT" | "CUSTODY"> {
  const actors = await tx.query<Row & { id: string; role: Collector["role"]; status: string; reset: boolean; branchId: string | null }>(
    `SELECT id::text AS id,role_code::text AS role,status::text AS status,must_change_password AS reset,branch_id::text AS "branchId" FROM public.users WHERE id=$1::bigint`, [actorId.toString()]);
  const actor = actors.rows[0];
  if (!actor) problem("اختبار اصطناعي: المسجّل غير موجود.");
  const accounts = await tx.query<Row & CashAccount>(
    `SELECT id::text AS id,branch_id::text AS "branchId",kind,holder_id::text AS "holderId",(closed_at IS NOT NULL) AS closed
       FROM finance.accounts WHERE branch_id=$1::bigint AND (kind='VAULT' OR (kind='CUSTODY' AND holder_id=$2::bigint)) ORDER BY id`,
    [branch, actorId.toString()]);
  const collector: Collector = { id: actor.id, role: actor.role, branchId: actor.branchId, active: actor.status === "ACTIVE", mustChangePassword: actor.reset };
  const choice = chooseCashDestination(collector, branch, accounts.rows);
  if (!choice.ok) return problem(`اختبار اصطناعي: لا وجهة صالحة للتحصيل (${choice.reason}).`);
  return choice.kind;
}

/** The saved treatment, not today's accounts, decides how a replay is hashed. */
async function savedRoute(tx: FinanceTransaction, requestId: string): Promise<"VAULT" | "CUSTODY"> {
  const rows = await tx.query<Row & { treatment: string }>(
    `SELECT a.treatment FROM finance.collection_allocations_test_only a
       JOIN public.commerce_collections c ON c.id=a.collection_id WHERE c.request_id=$1::uuid`, [requestId]);
  if (rows.rows[0]?.treatment === "VAULT_MOVEMENT") return "VAULT";
  if (rows.rows[0]?.treatment === "CUSTODY_PENDING") return "CUSTODY";
  return problem("اختبار اصطناعي: تعذّر تحديد وجهة الطلب المحفوظ.");
}

function effectiveRaw(route: "VAULT" | "CUSTODY", raw: Collection): Record<string, unknown> {
  const { vaultReceived, ...base } = raw;
  // A vault write needs the operator's explicit receipt attestation; never
  // manufacture one from the chosen route. A custody write must not record a
  // vault receipt even if the form carried one before routing was decided.
  if (route === "VAULT") {
    if (vaultReceived !== true) throw new FinanceProblem("vault_receipt_required", "اختبار اصطناعي: يلزم إقرار استلام الخزنة للوجهة المختارة.");
    return { ...base, vaultReceived: true };
  }
  return base;
}

export async function branchRoutedCollectionTestOnly(db: FinanceDatabase, actorId: bigint, raw: Collection): Promise<WriteResult> {
  return db.serializable(async tx => {
    const prior = await tx.query<Row & { found: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM public.commerce_collections WHERE request_id=$1::uuid) AS found`, [raw.requestId]);
    const replayPath = prior.rows[0]?.found === true;
    let branch: string | undefined;
    let route: "VAULT" | "CUSTODY";
    if (replayPath) {
      route = await savedRoute(tx, raw.requestId);
    } else {
      const sale = await tx.query<Row & { branch: string }>(`SELECT branch_id::text AS branch FROM public.commerce_sales WHERE id=$1::bigint`, [raw.saleId]);
      branch = sale.rows[0]?.branch;
      if (!branch) problem("اختبار اصطناعي: الفاتورة غير متاحة.");
      await branchMarker(tx, branch);
      // Decision point: an opening committed before this read is visible only
      // after a whole-transaction retry with a fresh snapshot.
      route = await readRoute(tx, branch, actorId);
    }
    const result = await recordRoutedCollectionTestOnly(route, tx, actorId, effectiveRaw(route, raw), async (innerTx, lockedBranch, aid) => {
      if (replayPath || lockedBranch !== branch) problem("اختبار اصطناعي: تغيرت حالة إعادة الطلب أو فرع الفاتورة.");
      if (await readRoute(innerTx, branch!, aid) !== route) problem("اختبار اصطناعي: تغيرت وجهة التحصيل بعد المراجعة؛ أعد المحاولة.");
    });
    if (replayPath && !result.replayed) problem("اختبار اصطناعي: تغيرت حالة إعادة الطلب.");
    return result;
  });
}
