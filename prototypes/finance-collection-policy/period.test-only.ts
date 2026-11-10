/** Synthetic only. No runtime integration, migration, historical inference or movements. */
import { createHash } from "node:crypto";
import { FinanceProblem, type FinanceTransaction } from "../../src/lib/finance/types";
type Row = Record<string, unknown>;
type IdAmount = Row & { id: string; amount: string };
const problem = (code: string, message: string): never => { throw new FinanceProblem(code, message); };
function checkedIds(ids: readonly string[]): string[] {
  if (ids.some(id => !/^[1-9]\d*$/.test(id)) || new Set(ids).size !== ids.length) return problem("invalid_review", "قائمة العناصر غير صالحة.");
  return [...ids].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1);
}
function same(rows: IdAmount[], ids: string[]): boolean { return rows.length === ids.length && rows.every((r, i) => r.id === ids[i]); }

function fingerprint(collections: IdAmount[], payments: IdAmount[]): string {
  return createHash("sha256").update(JSON.stringify({ collections: collections.map(({ id, amount }) => [id, amount]), payments: payments.map(({ id, amount }) => [id, amount]) })).digest("hex");
}
/** Preview only; the final capture re-reads and locks these items. */
export async function reviewTestPeriod(tx: FinanceTransaction, accountId: string) {
  const c = await tx.query<IdAmount>(`SELECT a.collection_id::text AS id,c.amount::text AS amount FROM finance.collection_allocations_test_only a JOIN public.commerce_collections c ON c.id=a.collection_id WHERE a.account_id=$1::bigint AND a.treatment='CUSTODY_PENDING' AND a.settlement_id IS NULL ORDER BY a.collection_id`, [accountId]);
  const p = await tx.query<IdAmount>(`SELECT a.payment_id::text AS id,p.amount::text AS amount FROM finance.holder_payment_allocations_test_only a JOIN finance.payments p ON p.id=a.payment_id WHERE a.account_id=$1::bigint AND a.settlement_id IS NULL ORDER BY a.payment_id`, [accountId]);
  return { collections: c.rows, payments: p.rows, hash: fingerprint(c.rows, p.rows) };
}

/** Attach a newly recorded HOLDER_CASH payment to its recorder's custody in the same transaction. */
export async function allocateTestHolderPayment(tx: FinanceTransaction, actorId: string, paymentId: string) {
  const actors = await tx.query<Row & { role: string; branch: string | null; status: string; reset: boolean }>(`SELECT role_code::text AS role,branch_id::text AS branch,status::text AS status,must_change_password AS reset FROM public.users WHERE id=$1::bigint FOR SHARE`, [actorId]);
  const actor = actors.rows[0];
  if (!actor || actor.status !== "ACTIVE" || actor.reset || !["MANAGER", "ACCOUNTANT", "CS_AGENT"].includes(actor.role)) return problem("forbidden", "المسجل غير مخوّل.");
  const rows = await tx.query<Row & { recorder: string; requester: string; branch: string; source: string; method: string; amount: string }>(`SELECT p.recorded_by::text AS recorder,e.requested_by::text AS requester,e.branch_id::text AS branch,p.source,p.method,p.amount::text AS amount
    FROM finance.payments p JOIN finance.expenses e ON e.id=p.expense_id WHERE p.id=$1::bigint`, [paymentId]);
  const item = rows.rows[0];
  if (!item || item.recorder !== actorId || item.requester !== actorId || item.source !== "HOLDER_CASH" || item.method !== "CASH") return problem("invalid_payment", "الصرف غير مطابق للمسجّل أو المصدر.");
  if (actor.role === "CS_AGENT" && actor.branch !== item.branch) return problem("forbidden", "الصرف خارج فرع المسجّل.");
  const existing = await tx.query<Row & { accountId: string; assignedBy: string }>(`SELECT account_id::text AS "accountId",assigned_by::text AS "assignedBy" FROM finance.holder_payment_allocations_test_only WHERE payment_id=$1::bigint`, [paymentId]);
  if (existing.rows[0]) {
    if (existing.rows[0].assignedBy !== actorId) return problem("request_conflict", "الصرف مسجّل لمسجّل آخر.");
    return { ...existing.rows[0], replayed: true };
  }
  const accounts = await tx.query<Row & { id: string; closed: boolean }>(`SELECT id::text AS id,(closed_at IS NOT NULL) AS closed FROM finance.accounts WHERE branch_id=$1::bigint AND holder_id=$2::bigint AND kind='CUSTODY' AND closed_at IS NULL ORDER BY id FOR UPDATE`, [item.branch, actorId]);
  if (accounts.rows.length !== 1 || accounts.rows[0].closed) return problem("custody_unavailable", "يلزم عهدة مفتوحة للمسجّل.");
  const accountId = accounts.rows[0].id;
  const fresh = await tx.query<Row & { recorder: string; requester: string; branch: string; source: string; method: string; amount: string }>(`SELECT p.recorded_by::text AS recorder,e.requested_by::text AS requester,e.branch_id::text AS branch,p.source,p.method,p.amount::text AS amount
    FROM finance.payments p JOIN finance.expenses e ON e.id=p.expense_id WHERE p.id=$1::bigint FOR UPDATE OF p`, [paymentId]);
  const latest = fresh.rows[0];
  if (!latest || latest.recorder !== item.recorder || latest.requester !== item.requester || latest.branch !== item.branch || latest.source !== item.source || latest.method !== item.method || latest.amount !== item.amount) return problem("payment_stale", "تغيّر الصرف أثناء تحديد العهدة.");
  await tx.query("INSERT INTO finance.holder_payment_allocations_test_only(payment_id,account_id,assigned_by) VALUES($1::bigint,$2::bigint,$3::bigint)", [paymentId, accountId, actorId]);
  await tx.query("UPDATE finance.accounts SET revision=revision+1 WHERE id=$1::bigint", [accountId]);
  return { accountId, assignedBy: actorId, replayed: false };
}

/** Caller holds the account lock. Test-only current-source check, not historical evidence. */
export async function lockAndValidatePendingSourcesTestOnly(tx: FinanceTransaction, accountId: string) {
  // Re-check current source consistency under row locks. This is not a
  // historical proof and does not make the test-only hook production-ready.
  const c = await tx.query<IdAmount & { validSource: boolean }>(`SELECT a.collection_id::text AS id,c.amount::text AS amount,
      COALESCE(a.movement_id IS NULL AND c.method='CASH' AND sale.branch_id=acct.branch_id
        AND c.created_by_id=acct.holder_id AND a.assigned_by=c.created_by_id,false) AS "validSource"
    FROM finance.collection_allocations_test_only a JOIN public.commerce_collections c ON c.id=a.collection_id
    JOIN public.commerce_sales sale ON sale.id=c.sale_id JOIN finance.accounts acct ON acct.id=a.account_id
    WHERE a.account_id=$1::bigint AND a.treatment='CUSTODY_PENDING' AND a.settlement_id IS NULL
    ORDER BY a.collection_id FOR UPDATE OF a,c,sale`, [accountId]);
  const p = await tx.query<IdAmount & { validSource: boolean }>(`SELECT a.payment_id::text AS id,p.amount::text AS amount,
      COALESCE(p.method='CASH' AND p.source='HOLDER_CASH' AND expense.branch_id=acct.branch_id
        AND expense.requested_by=acct.holder_id AND p.recorded_by=acct.holder_id AND a.assigned_by=p.recorded_by,false) AS "validSource"
    FROM finance.holder_payment_allocations_test_only a JOIN finance.payments p ON p.id=a.payment_id
    JOIN finance.expenses expense ON expense.id=p.expense_id JOIN finance.accounts acct ON acct.id=a.account_id
    WHERE a.account_id=$1::bigint AND a.settlement_id IS NULL ORDER BY a.payment_id FOR UPDATE OF a,p,expense`, [accountId]);
  if (c.rows.some(item => !item.validSource)) return problem("invalid_collection_allocation", "مصدر التحصيل المخصص غير متسق مع العهدة؛ يلزم تدقيق مستقل.");
  if (p.rows.some(item => !item.validSource)) return problem("invalid_payment_allocation", "مصدر الصرف المخصص غير متسق مع العهدة؛ يلزم تدقيق مستقل.");
  return { collections:c.rows, payments:p.rows };
}

/**
 * Experimental item capture plus a synthetic status transition. Not a real
 * settlement: it posts no cash movements and does not replace finance engine.
 * The caller must own a serializable transaction and roll back on all errors.
 */
export async function captureTestPeriod(tx: FinanceTransaction, accountId: string, settlementId: string, actorId: string, collectionIds: readonly string[], paymentIds: readonly string[], reviewedHash: string) {
  return capturePeriodTestOnly(tx, accountId, settlementId, actorId, collectionIds, paymentIds, reviewedHash, false);
}

async function capturePeriodTestOnly(tx: FinanceTransaction, accountId: string, settlementId: string, actorId: string, collectionIds: readonly string[], paymentIds: readonly string[], reviewedHash: string, checkRevision: boolean) {
  const collections = checkedIds(collectionIds), payments = checkedIds(paymentIds);
  if (!/^[a-f0-9]{64}$/.test(reviewedHash)) return problem("invalid_review", "بصمة المراجعة غير صالحة.");
  const accounts = await tx.query<Row & { closed: boolean; kind: string; branchId: string; revision: string }>(`SELECT (closed_at IS NOT NULL) AS closed,kind,branch_id::text AS "branchId",revision::text AS revision FROM finance.accounts WHERE id=$1::bigint FOR UPDATE`, [accountId]);
  const account = accounts.rows[0];
  if (!account || account.kind !== "CUSTODY") return problem("invalid_account", "العهدة غير موجودة.");
  const actors = await tx.query<Row & { role: string; branch: string | null; status: string; reset: boolean }>(`SELECT role_code::text AS role,branch_id::text AS branch,status::text AS status,must_change_password AS reset FROM public.users WHERE id=$1::bigint FOR SHARE`, [actorId]);
  const actor = actors.rows[0];
  if (!actor || actor.status !== "ACTIVE" || actor.reset || !["MANAGER", "ACCOUNTANT"].includes(actor.role) || (actor.role === "ACCOUNTANT" && actor.branch !== account.branchId)) return problem("forbidden", "المعتمد غير مخوّل.");
  const settlements = await tx.query<Row & { accountId: string; branchId: string; requester: string; status: string; sales: string; expenses: string; revision: string | null }>(`SELECT account_id::text AS "accountId",branch_id::text AS "branchId",requested_by::text AS requester,status,sales_total::text AS sales,expenses_total::text AS expenses,account_revision::text AS revision FROM finance.settlements WHERE id=$1::bigint FOR UPDATE`, [settlementId]);
  const s = settlements.rows[0];
  if (!s || s.accountId !== accountId || s.branchId !== account.branchId) return problem("invalid_settlement", "التسوية غير مطابقة للعهدة.");
  if (s.requester === actorId) return problem("forbidden", "لا اعتماد ذاتي.");
  const receipts = await tx.query<Row & { collections: string[]; payments: string[]; hash: string; sales: string; expenses: string }>(`SELECT collection_ids AS collections,payment_ids AS payments,snapshot_hash AS hash,sales_total::text AS sales,expenses_total::text AS expenses FROM finance.settlement_allocation_receipts_test_only WHERE settlement_id=$1::bigint`, [settlementId]);
  const old = receipts.rows[0];
  if (old) {
    if (s.status !== "CONFIRMED" || JSON.stringify(old.collections) !== JSON.stringify(collections) || JSON.stringify(old.payments) !== JSON.stringify(payments) || old.hash !== reviewedHash || old.sales !== s.sales || old.expenses !== s.expenses) return problem("settlement_conflict", "التسوية المعادة لا تطابق الإيصال.");
    return { replayed: true };
  }
  if (s.status !== "OPEN") return problem("legacy_settlement", "لا تُلحق عناصر بتسوية سابقة.");
  if (account.closed) return problem("account_closed", "العهدة مقفلة.");
  if (checkRevision && (s.revision === null || s.revision !== account.revision)) return problem("experimental_revision_stale", "اختبار اصطناعي: تغيّرت نسخة العهدة أو لا تتوفر مراجعة موثوقة.");
  const assignedCollections = await tx.query<IdAmount>(`SELECT a.collection_id::text AS id,c.amount::text AS amount FROM finance.collection_allocations_test_only a JOIN public.commerce_collections c ON c.id=a.collection_id WHERE a.account_id=$1::bigint AND a.treatment='CUSTODY_PENDING' AND a.settlement_id IS NULL ORDER BY a.collection_id FOR UPDATE OF a,c`, [accountId]);
  const assignedPayments = await tx.query<IdAmount>(`SELECT a.payment_id::text AS id,p.amount::text AS amount FROM finance.holder_payment_allocations_test_only a JOIN finance.payments p ON p.id=a.payment_id WHERE a.account_id=$1::bigint AND a.settlement_id IS NULL ORDER BY a.payment_id FOR UPDATE OF a,p`, [accountId]);
  if (!same(assignedCollections.rows, collections) || !same(assignedPayments.rows, payments) || fingerprint(assignedCollections.rows, assignedPayments.rows) !== reviewedHash) return problem("period_stale", "تغيّرت عناصر الفترة؛ أعد المراجعة.");
  const totals = await tx.query<Row & { matches: boolean }>(`SELECT
    (SELECT COALESCE(SUM(c.amount),0) FROM finance.collection_allocations_test_only a JOIN public.commerce_collections c ON c.id=a.collection_id WHERE a.account_id=$1::bigint AND a.treatment='CUSTODY_PENDING' AND a.settlement_id IS NULL)=$2::numeric
    AND (SELECT COALESCE(SUM(p.amount),0) FROM finance.holder_payment_allocations_test_only a JOIN finance.payments p ON p.id=a.payment_id WHERE a.account_id=$1::bigint AND a.settlement_id IS NULL)=$3::numeric AS matches`, [accountId,s.sales,s.expenses]);
  if (!totals.rows[0]?.matches) return problem("total_mismatch", "إجمالي العناصر لا يطابق التسوية المراجعة.");
  await tx.query("UPDATE finance.collection_allocations_test_only SET settlement_id=$2::bigint WHERE account_id=$1::bigint AND treatment='CUSTODY_PENDING' AND settlement_id IS NULL", [accountId, settlementId]);
  await tx.query("UPDATE finance.holder_payment_allocations_test_only SET settlement_id=$2::bigint WHERE account_id=$1::bigint AND settlement_id IS NULL", [accountId, settlementId]);
  // Even an empty period changes account state; invalidate older snapshots.
  await tx.query("UPDATE finance.accounts SET revision=revision+1 WHERE id=$1::bigint", [accountId]);
  await tx.query(`UPDATE finance.settlements SET status='CONFIRMED',resolved_by=$2::bigint,resolved_at=CURRENT_TIMESTAMP,resolution_reason='اختبار اصطناعي فقط',transfer_amount=0,transfer_direction='TO_VAULT' WHERE id=$1::bigint`, [settlementId, actorId]);
  await tx.query(`INSERT INTO finance.settlement_allocation_receipts_test_only(settlement_id,account_id,collection_ids,payment_ids,snapshot_hash,sales_total,expenses_total) VALUES($1::bigint,$2::bigint,$3::jsonb,$4::jsonb,$5,$6::numeric,$7::numeric)`, [settlementId,accountId,JSON.stringify(collections),JSON.stringify(payments),reviewedHash,s.sales,s.expenses]);
  return { replayed: false };
}

/**
 * Synthetic comparison experiment only: refuses a new standalone capture when
 * the request's account revision is missing or stale. It does not post real
 * settlement movements or authenticate history, and does not protect against
 * writers that fail to bump revision. The original model remains available to
 * characterize its limitations. Caller owns a serializable transaction.
 */
export async function captureRevisionCheckedTestPeriod(tx: FinanceTransaction, accountId: string, settlementId: string, actorId: string, collectionIds: readonly string[], paymentIds: readonly string[], reviewedHash: string) {
  // The shared core checks authorization and receipt replay before freshness.
  return capturePeriodTestOnly(tx, accountId, settlementId, actorId, collectionIds, paymentIds, reviewedHash, true);
}

/**
 * TEST HARNESS ONLY: invoked immediately after the real confirmation UPDATE
 * within that very same still-open transaction. This does NOT verify transaction
 * provenance and MUST NOT be called for a previously confirmed settlement.
 * It is not an application integration or a migration.
 */
export async function attachAfterRealConfirmationTestOnly(
  tx: FinanceTransaction, accountId: string, settlementId: string, actorId: string,
  collectionIds: readonly string[], paymentIds: readonly string[], reviewedHash: string,
  // Only the separate isolated allocated-formula experiment may disable this.
  // It must first exclude unassigned sources, and is not a transition policy.
  legacyCrossCheck = true,
): Promise<void> {
  const collections = checkedIds(collectionIds), payments = checkedIds(paymentIds);
  if (!/^[a-f0-9]{64}$/.test(reviewedHash)) return problem("invalid_review", "بصمة المراجعة غير صالحة.");
  const account = await tx.query<Row & { id: string; branchId: string; kind: string; closed: boolean }>(`SELECT id::text AS id,branch_id::text AS "branchId",kind,(closed_at IS NOT NULL) AS closed FROM finance.accounts WHERE id=$1::bigint FOR UPDATE`, [accountId]);
  const a = account.rows[0];
  if (!a || a.kind !== "CUSTODY" || a.closed) return problem("invalid_account", "العهدة غير مفتوحة.");
  const settlement = await tx.query<Row & { accountId: string; branchId: string; status: string; resolver: string | null; sales: string; expenses: string }>(`SELECT account_id::text AS "accountId",branch_id::text AS "branchId",status,resolved_by::text AS resolver,sales_total::text AS sales,expenses_total::text AS expenses FROM finance.settlements WHERE id=$1::bigint FOR UPDATE`, [settlementId]);
  const s = settlement.rows[0];
  if (!s || s.accountId !== accountId || s.branchId !== a.branchId || s.status !== "CONFIRMED" || s.resolver !== actorId) return problem("invalid_settlement", "الاعتماد لا يطابق العهدة أو المعتمد.");
  const existing = await tx.query<IdAmount>(`SELECT settlement_id::text AS id,'0' AS amount FROM finance.settlement_allocation_receipts_test_only WHERE settlement_id=$1::bigint`, [settlementId]);
  if (existing.rows.length) return problem("settlement_conflict", "يوجد إيصال تخصيص سابق؛ لا يُستخدم مُعترِض الاختبار على سجل قديم.");
  const checked = await lockAndValidatePendingSourcesTestOnly(tx, accountId);
  const c = { rows: checked.collections }, p = { rows: checked.payments };
  if (!same(c.rows, collections) || !same(p.rows, payments) || fingerprint(c.rows, p.rows) !== reviewedHash) return problem("period_stale", "تغيّرت عناصر الفترة؛ أعد المراجعة.");
  // Transitional cross-check only: equal totals are not enough. Match the IDs
  // selected by the current engine's old period formula too. This does NOT
  // prove the history or physical holder is correct; production cutover still
  // needs an approved independent policy and complete evidence.
  const oldCollections = await tx.query<IdAmount>(`SELECT c.id::text AS id,c.amount::text AS amount
    FROM public.commerce_collections c JOIN public.commerce_sales sale ON sale.id=c.sale_id
    JOIN finance.accounts acct ON acct.id=$1::bigint
    WHERE sale.branch_id=acct.branch_id AND sale.created_by_id=acct.holder_id AND c.method='CASH'
      AND c.created_at>COALESCE((SELECT resolved_at FROM finance.settlements
        WHERE account_id=acct.id AND status='CONFIRMED' AND id<>$2::bigint ORDER BY resolved_at DESC,id DESC LIMIT 1),acct.opened_at)
    ORDER BY c.id FOR UPDATE OF c`, [accountId,settlementId]);
  const oldPayments = await tx.query<IdAmount>(`SELECT p.id::text AS id,p.amount::text AS amount
    FROM finance.payments p JOIN finance.expenses expense ON expense.id=p.expense_id
    JOIN finance.accounts acct ON acct.id=$1::bigint
    WHERE expense.branch_id=acct.branch_id AND expense.requested_by=acct.holder_id AND p.source='HOLDER_CASH'
      AND p.recorded_at>COALESCE((SELECT resolved_at FROM finance.settlements
        WHERE account_id=acct.id AND status='CONFIRMED' AND id<>$2::bigint ORDER BY resolved_at DESC,id DESC LIMIT 1),acct.opened_at)
    ORDER BY p.id FOR UPDATE OF p`, [accountId,settlementId]);
  if (legacyCrossCheck && (!same(oldCollections.rows, collections) || !same(oldPayments.rows, payments)))
    return problem("legacy_period_mismatch", "العناصر المخصصة لا تطابق عناصر معادلة التسوية الحالية؛ يلزم تدقيق وانتقال مستقلان.");
  const totals = await tx.query<Row & { matches: boolean }>(`SELECT
    (SELECT COALESCE(SUM(c.amount),0) FROM finance.collection_allocations_test_only a JOIN public.commerce_collections c ON c.id=a.collection_id WHERE a.account_id=$1::bigint AND a.treatment='CUSTODY_PENDING' AND a.settlement_id IS NULL)=$2::numeric
    AND (SELECT COALESCE(SUM(p.amount),0) FROM finance.holder_payment_allocations_test_only a JOIN finance.payments p ON p.id=a.payment_id WHERE a.account_id=$1::bigint AND a.settlement_id IS NULL)=$3::numeric AS matches`, [accountId,s.sales,s.expenses]);
  if (!totals.rows[0]?.matches) return problem("total_mismatch", "إجمالي العناصر لا يطابق التسوية المعتمدة.");
  await tx.query("UPDATE finance.collection_allocations_test_only SET settlement_id=$2::bigint WHERE account_id=$1::bigint AND treatment='CUSTODY_PENDING' AND settlement_id IS NULL", [accountId,settlementId]);
  await tx.query("UPDATE finance.holder_payment_allocations_test_only SET settlement_id=$2::bigint WHERE account_id=$1::bigint AND settlement_id IS NULL", [accountId,settlementId]);
  await tx.query(`INSERT INTO finance.settlement_allocation_receipts_test_only(settlement_id,account_id,collection_ids,payment_ids,snapshot_hash,sales_total,expenses_total) VALUES($1::bigint,$2::bigint,$3::jsonb,$4::jsonb,$5,$6::numeric,$7::numeric)`, [settlementId,accountId,JSON.stringify(collections),JSON.stringify(payments),reviewedHash,s.sales,s.expenses]);
}
