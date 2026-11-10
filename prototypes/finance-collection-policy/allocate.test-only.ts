/** Narrow disposable-DB experiment, NOT called by the application. */
import { postCashCollectionInTransaction } from "../../src/lib/finance/engine";
import { FinanceProblem, type FinanceTransaction } from "../../src/lib/finance/types";
import { chooseCashDestination, type CashAccount, type Collector } from "./destination";

type Row = Record<string, unknown>;
export async function allocateTestCollection(tx: FinanceTransaction, collectorId: string, collectionId: string, options?: { vaultReceived: boolean }) {
  const actors = await tx.query<Row & { id: string; role: Collector["role"]; branchId: string | null; status: string; mustChangePassword: boolean }>(`SELECT id::text AS id,role_code::text AS role,branch_id::text AS "branchId",status::text AS status,must_change_password AS "mustChangePassword" FROM public.users WHERE id=$1::bigint FOR SHARE`, [collectorId]);
  const actor = actors.rows[0];
  if (!actor || actor.status !== "ACTIVE" || actor.mustChangePassword || !["MANAGER", "ACCOUNTANT", "CS_AGENT"].includes(actor.role)) throw new FinanceProblem("forbidden", "المسجل غير مخول.");
  const items = await tx.query<Row & { id: string; branchId: string; collectorId: string; amount: string; method: string }>(`SELECT c.id::text AS id,s.branch_id::text AS "branchId",c.created_by_id::text AS "collectorId",c.amount::text AS amount,c.method FROM public.commerce_collections c JOIN public.commerce_sales s ON s.id=c.sale_id WHERE c.id=$1::bigint`, [collectionId]);
  const collection = items.rows[0];
  if (!collection || collection.collectorId !== actor.id || collection.method !== "CASH") throw new FinanceProblem("invalid_collection", "التحصيل غير مطابق للمسجّل أو ليس نقديًا.");
  if (actor.role === "CS_AGENT" && actor.branchId !== collection.branchId) throw new FinanceProblem("forbidden", "التحصيل خارج فرع المسجّل.");
  const previous = await tx.query<Row & { accountId: string; treatment: string; assignedBy: string }>(`SELECT account_id::text AS "accountId",treatment,assigned_by::text AS "assignedBy" FROM finance.collection_allocations_test_only WHERE collection_id=$1::bigint`, [collectionId]);
  if (previous.rows[0]) {
    if (previous.rows[0].assignedBy !== actor.id) throw new FinanceProblem("request_conflict", "التحصيل مسجل لمسجّل آخر.");
    return { ...previous.rows[0], replayed: true };
  }
  // Read candidates first, then lock only the chosen account. A real service
  // may already hold the custody: locking an unrelated vault here would invert
  // transfer's account order. Serializable isolation remains mandatory; this
  // is not a proof for every concurrent opening/closing or cross-service lock.
  const accounts = await tx.query<Row & { id: string; branchId: string; kind: CashAccount["kind"]; holderId: string | null; closed: boolean }>(`SELECT id::text AS id,branch_id::text AS "branchId",kind,holder_id::text AS "holderId",(closed_at IS NOT NULL) AS closed FROM finance.accounts WHERE branch_id=$1::bigint AND (kind='VAULT' OR (kind='CUSTODY' AND holder_id=$2::bigint)) ORDER BY id`, [collection.branchId, actor.id]);
  const collector = { id: actor.id, role: actor.role, branchId: actor.branchId, active: true, mustChangePassword: false };
  const choice = chooseCashDestination(collector, collection.branchId, accounts.rows);
  if (!choice.ok) throw new FinanceProblem(choice.reason, "لا يمكن تحديد حساب مفتوح للتحصيل النقدي.");
  const locked = await tx.query<Row & { id: string; branchId: string; kind: CashAccount["kind"]; holderId: string | null; closed: boolean }>(`SELECT id::text AS id,branch_id::text AS "branchId",kind,holder_id::text AS "holderId",(closed_at IS NOT NULL) AS closed FROM finance.accounts WHERE id=$1::bigint FOR UPDATE`, [choice.accountId]);
  const freshAccount = locked.rows[0];
  const priorAccount = accounts.rows.find(a => a.id === choice.accountId);
  if (!freshAccount || !priorAccount || freshAccount.branchId !== priorAccount.branchId || freshAccount.kind !== priorAccount.kind || freshAccount.holderId !== priorAccount.holderId || freshAccount.closed !== priorAccount.closed)
    throw new FinanceProblem("account_stale", "تغيّر الحساب أثناء تحديد وجهة التحصيل.");
  // Match capture's account-then-item order. The earlier read only chose the
  // lock; re-lock the source and reject changes before writing an assignment.
  const checked = await tx.query<Row & { id: string; branchId: string; collectorId: string; amount: string; method: string }>(`SELECT c.id::text AS id,s.branch_id::text AS "branchId",c.created_by_id::text AS "collectorId",c.amount::text AS amount,c.method FROM public.commerce_collections c JOIN public.commerce_sales s ON s.id=c.sale_id WHERE c.id=$1::bigint FOR UPDATE OF c`, [collectionId]);
  const fresh = checked.rows[0];
  if (!fresh || fresh.branchId !== collection.branchId || fresh.collectorId !== collection.collectorId || fresh.method !== collection.method || fresh.amount !== collection.amount)
    throw new FinanceProblem("collection_stale", "تغيّر التحصيل أثناء تحديد العهدة.");
  let movementId: string | null = null;
  const treatment = choice.kind === "VAULT" ? "VAULT_MOVEMENT" : "CUSTODY_PENDING";
  if (choice.kind === "VAULT") {
    if (options?.vaultReceived !== true) throw new FinanceProblem("vault_receipt_required", "يلزم إقرار استلام الخزنة للتحصيل الاصطناعي.");
    // The chosen vault is locked above and remains locked through posting.
    // Existing allocations replay before this guard; new ones fail closed.
    const counts = await tx.query<Row & { blocked: boolean }>("SELECT EXISTS(SELECT 1 FROM finance.cash_counts WHERE account_id=$1::bigint AND status IN ('OPEN','CONFIRMED')) AS blocked", [choice.accountId]);
    if (counts.rows[0]?.blocked) throw new FinanceProblem("vault_count_blocked", "التحصيل المباشر للخزنة محظور مع جرد مفتوح أو جرد مؤكد سابق؛ يلزم مراجعة مستقلة.");
    movementId = await postCashCollectionInTransaction(tx, actor.id, { branchId: collection.branchId, accountId: choice.accountId, amount: collection.amount, collectionId: collection.id });
  }
  else await tx.query(`UPDATE finance.accounts SET revision=revision+1 WHERE id=$1::bigint`, [choice.accountId]);
  await tx.query(`INSERT INTO finance.collection_allocations_test_only(collection_id,account_id,treatment,movement_id,assigned_by,vault_received_attested) VALUES($1::bigint,$2::bigint,$3,$4::bigint,$5::bigint,$6::boolean)`, [collection.id, choice.accountId, treatment, movementId, actor.id, choice.kind === "VAULT" ? true : null]);
  return { accountId: choice.accountId, treatment, assignedBy: actor.id, replayed: false };
}

/** The proposed item-based total; not the app's current settlement formula. */
export async function pendingTestCollections(tx: FinanceTransaction, accountId: string): Promise<string> {
  const rows = await tx.query<Row & { total: string }>(`SELECT COALESCE(SUM(c.amount),0)::numeric(22,2)::text AS total FROM finance.collection_allocations_test_only a JOIN public.commerce_collections c ON c.id=a.collection_id WHERE a.account_id=$1::bigint AND a.treatment='CUSTODY_PENDING' AND a.settlement_id IS NULL`, [accountId]);
  return rows.rows[0].total;
}

/**
 * Candidate hook for a future settlement transaction, NOT a settlement command.
 * The caller must have calculated and confirmed the settlement in the SAME
 * transaction; never use this as a way to attach items to old confirmed records.
 * This experiment assumes *all* the settlement's sales come from assigned items.
 */
export async function attachTestCollectionsToSettlement(tx: FinanceTransaction, settlementId: string, reviewedIds: readonly string[]): Promise<{ replayed: boolean }> {
  const unique = new Set(reviewedIds);
  if (!reviewedIds.length || unique.size !== reviewedIds.length || reviewedIds.some((id) => !/^[1-9]\d*$/.test(id)))
    throw new FinanceProblem("invalid_review", "راجع قائمة التحصيلات المحددة.");
  const sorted = [...unique].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1);
  const settlements = await tx.query<Row & { accountId: string; status: string; salesTotal: string }>(`SELECT account_id::text AS "accountId",status,sales_total::text AS "salesTotal" FROM finance.settlements WHERE id=$1::bigint FOR UPDATE`, [settlementId]);
  const settlement = settlements.rows[0];
  if (!settlement || settlement.status !== "CONFIRMED") throw new FinanceProblem("invalid_settlement", "يجب اعتماد التسوية في المعاملة نفسها.");
  const accounts = await tx.query<Row & { kind: string; closed: boolean }>(`SELECT kind,(closed_at IS NOT NULL) AS closed FROM finance.accounts WHERE id=$1::bigint FOR UPDATE`, [settlement.accountId]);
  if (!accounts.rows[0] || accounts.rows[0].kind !== "CUSTODY" || accounts.rows[0].closed) throw new FinanceProblem("account_closed", "العهدة غير مفتوحة.");
  const assigned = await tx.query<Row & { id: string; amount: string }>(`SELECT a.collection_id::text AS id,c.amount::text AS amount FROM finance.collection_allocations_test_only a JOIN public.commerce_collections c ON c.id=a.collection_id WHERE a.account_id=$1::bigint AND a.treatment='CUSTODY_PENDING' AND a.settlement_id=$2::bigint ORDER BY a.collection_id FOR UPDATE OF a`, [settlement.accountId, settlementId]);
  const same = (rows: Array<{ id: string }>) => rows.length === sorted.length && rows.every((row, i) => row.id === sorted[i]);
  if (assigned.rows.length) {
    if (!same(assigned.rows)) throw new FinanceProblem("settlement_conflict", "سبق اعتماد تحصيلات مختلفة لهذه التسوية.");
    return { replayed: true };
  }
  const pending = await tx.query<Row & { id: string; amount: string }>(`SELECT a.collection_id::text AS id,c.amount::text AS amount FROM finance.collection_allocations_test_only a JOIN public.commerce_collections c ON c.id=a.collection_id WHERE a.account_id=$1::bigint AND a.treatment='CUSTODY_PENDING' AND a.settlement_id IS NULL ORDER BY a.collection_id FOR UPDATE OF a`, [settlement.accountId]);
  if (!same(pending.rows)) throw new FinanceProblem("collection_stale", "تغيرت التحصيلات؛ أعد المراجعة قبل الاعتماد.");
  // Compare as exact decimals in the database, never JavaScript float.
  const totals = await tx.query<Row & { matches: boolean }>(`SELECT COALESCE(SUM(c.amount),0)=$2::numeric AS matches FROM finance.collection_allocations_test_only a JOIN public.commerce_collections c ON c.id=a.collection_id WHERE a.account_id=$1::bigint AND a.treatment='CUSTODY_PENDING' AND a.settlement_id IS NULL`, [settlement.accountId, settlement.salesTotal]);
  if (!totals.rows[0]?.matches) throw new FinanceProblem("total_mismatch", "إجمالي التحصيلات لا يطابق التسوية.");
  await tx.query(`UPDATE finance.collection_allocations_test_only SET settlement_id=$2::bigint WHERE account_id=$1::bigint AND treatment='CUSTODY_PENDING' AND settlement_id IS NULL`, [settlement.accountId, settlementId]);
  return { replayed: false };
}

/** Closure building block only; caller must retain this lock through actual close. */
export async function assertTestNoPendingCollections(tx: FinanceTransaction, accountId: string): Promise<void> {
  const account = await tx.query<Row & { id: string }>(`SELECT id::text AS id FROM finance.accounts WHERE id=$1::bigint FOR UPDATE`, [accountId]);
  if (!account.rows[0]) throw new FinanceProblem("not_found", "الحساب غير موجود.");
  const pending = await tx.query<Row & { hasPending: boolean }>(`SELECT EXISTS(SELECT 1 FROM finance.collection_allocations_test_only WHERE account_id=$1::bigint AND treatment='CUSTODY_PENDING' AND settlement_id IS NULL) AS "hasPending"`, [accountId]);
  if (pending.rows[0]?.hasPending) throw new FinanceProblem("pending_collections", "توجد تحصيلات غير مسوّاة على العهدة.");
}
