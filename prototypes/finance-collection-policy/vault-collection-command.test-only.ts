/**
 * Disposable laboratory command only; NOT application integration.
 * The caller must own a SERIALIZABLE transaction and roll it back on any error.
 * It does not handle stock/initial sales, provide retry, integrate the real
 * service or establish physical cash receipt. Never use in production.
 */
import { customerPosition, validateCollectionAmount } from "../../src/lib/commerce-math";
import { scaledInteger } from "../../src/lib/inventory-math";
import { parseMoneyMovement } from "../../src/lib/commerce-validation";
import { canPerformCommerce, type CommerceActor } from "../../src/lib/commerce-policy";
import { FinanceProblem, type FinanceTransaction } from "../../src/lib/finance/types";
import { allocateTestCollection } from "./allocate.test-only";
import { vaultReceiptIdentityTestOnly, vaultReceiptReplayMatchesTestOnly } from "./vault-receipt-identity.test-only";

type Row = Record<string, unknown>;
export async function recordRoutedCollectionTestOnly(
  route: "VAULT" | "CUSTODY",
  tx: FinanceTransaction,
  actorId: bigint,
  raw: unknown,
  // Test injection only. Production has no such hook or route barrier.
  beforeNewWrite?: (tx: FinanceTransaction, branchId: string, actorId: bigint) => Promise<void>,
): Promise<{ id: string; replayed: boolean }> {
  const parsed = parseMoneyMovement(raw, false);
  if (!parsed.ok || parsed.value.method !== "CASH") throw new FinanceProblem("invalid_collection", "طلب التحصيل الاصطناعي غير صالح.");
  const input = parsed.value;
  const actors = await tx.query<Row & { role: CommerceActor["role"]; status: CommerceActor["status"]; reset: boolean; branch: string | null; canCancel: boolean }>(`SELECT role_code::text AS role,status::text AS status,must_change_password AS reset,branch_id::text AS branch,can_cancel_sales AS "canCancel" FROM public.users WHERE id=$1::bigint FOR SHARE`, [actorId.toString()]);
  const actor = actors.rows[0];
  const sales = await tx.query<Row & { branch: string; active: boolean; total: string }>(`SELECT s.branch_id::text AS branch,b.is_active AS active,s.total::text AS total FROM public.commerce_sales s JOIN public.branches b ON b.id=s.branch_id WHERE s.id=$1::bigint FOR UPDATE OF s`, [input.saleId]);
  const sale = sales.rows[0];
  if (!actor || !sale || !canPerformCommerce({ role: actor.role, status: actor.status, mustChangePassword: actor.reset, branchId: actor.branch === null ? null : BigInt(actor.branch), canCancelSales: actor.canCancel }, "RECORD_COLLECTION", BigInt(sale.branch), sale.active))
    throw new FinanceProblem("forbidden", "المسجّل غير مخوّل للتحصيل الاصطناعي.");
  const identity = vaultReceiptIdentityTestOnly(actorId, input, raw);
  const existing = await tx.query<Row & { id: string; actor: string; hash: string }>(`SELECT id::text AS id,created_by_id::text AS actor,request_hash AS hash FROM public.commerce_collections WHERE request_id=$1::uuid`, [input.requestId]);
  if (existing.rows[0]) {
    const old = existing.rows[0];
    if (!vaultReceiptReplayMatchesTestOnly({ createdById: BigInt(old.actor), requestHash: old.hash }, actorId, identity)) throw new FinanceProblem("request_conflict", "طلب اصطناعي مسجل ببيانات مختلفة.");
    return { id: old.id, replayed: true };
  }
  // The vault route requires a new attested identity; custody retains the
  // current hash and rejects an unexpected vault attestation in this sketch.
  if (route === "VAULT" && (!identity.acknowledged || identity.reviewedHash === null)) throw new FinanceProblem("vault_receipt_required", "يلزم إقرار استلام الخزنة للتحصيل الاصطناعي.");
  if (route === "CUSTODY" && identity.hasReceipt) throw new FinanceProblem("unexpected_receipt", "إقرار الخزنة لا ينطبق على تحصيل العهدة الاصطناعي.");
  const requestHash = route === "VAULT" ? identity.reviewedHash : identity.baseHash;
  await beforeNewWrite?.(tx, sale.branch, actorId);
  // Serialize all new invoice mutations against the production-style revision
  // bump, then calculate from locked invoice's recorded totals. No JS floats.
  // An error must abort the caller's transaction; never catch-and-commit it.
  await tx.query("UPDATE public.commerce_sales SET revision=revision+1 WHERE id=$1::bigint", [input.saleId]);
  const sums = await tx.query<Row & { returned: string; collected: string; refunded: string }>(`SELECT
    COALESCE((SELECT SUM(rl.total) FROM public.commerce_return_lines rl JOIN public.commerce_returns r ON r.id=rl.return_id WHERE r.sale_id=$1::bigint),0)::text AS returned,
    COALESCE((SELECT SUM(c.amount) FROM public.commerce_collections c WHERE c.sale_id=$1::bigint),0)::text AS collected,
    COALESCE((SELECT SUM(r.amount) FROM public.commerce_refunds r WHERE r.sale_id=$1::bigint),0)::text AS refunded`, [input.saleId]);
  const sumsRow = sums.rows[0];
  if (!sumsRow) throw new FinanceProblem("invalid_collection", "تعذّر حساب المستحق للفاتورة الاصطناعية.");
  const position = customerPosition({ originalTotalCents: scaledInteger(sale.total,2), returnedCents: scaledInteger(sumsRow.returned,2), collectedCents: scaledInteger(sumsRow.collected,2), refundedCents: scaledInteger(sumsRow.refunded,2) });
  validateCollectionAmount(position.dueFromCustomerCents,scaledInteger(input.amount,2));
  const inserted = await tx.query<Row & { id: string }>(`INSERT INTO public.commerce_collections(request_id,request_hash,sale_id,amount,method,is_initial,created_by_id) VALUES($1::uuid,$2,$3::bigint,$4::numeric,'CASH',false,$5::bigint) RETURNING id::text AS id`, [input.requestId,requestHash,input.saleId,input.amount,actorId.toString()]);
  const assigned = await allocateTestCollection(tx, actorId.toString(), inserted.rows[0].id, { vaultReceived: route === "VAULT" });
  if (route === "VAULT" && assigned.treatment !== "VAULT_MOVEMENT") throw new FinanceProblem("not_vault_destination", "الوجهة المختارة ليست خزنة؛ يجب استخدام المسار الصحيح.");
  if (route === "CUSTODY") {
    if (assigned.treatment !== "CUSTODY_PENDING") throw new FinanceProblem("not_custody_destination", "الوجهة المختارة ليست عهدة؛ يجب استخدام المسار الصحيح.");
    // Allocation already holds the selected custody lock. This temporary
    // policy mirrors the application's open count/settlement restriction.
    const pending = await tx.query<Row & { blocked: boolean }>(`SELECT EXISTS(SELECT 1 FROM finance.cash_counts WHERE account_id=$1::bigint AND status='OPEN')
      OR EXISTS(SELECT 1 FROM finance.settlements WHERE account_id=$1::bigint AND status='OPEN') AS blocked`, [assigned.accountId]);
    if (pending.rows[0]?.blocked) throw new FinanceProblem("custody_pending", "لا يمكن التحصيل النقدي مؤقتًا مع طلب جرد أو تسوية مفتوح.");
  }
  return { id: inserted.rows[0].id, replayed: false };
}

/** Existing vault-only laboratory command; no production integration. */
export function recordVaultCollectionTestOnly(tx: FinanceTransaction, actorId: bigint, raw: unknown, beforeNewWrite?: (tx: FinanceTransaction, branchId: string, actorId: bigint) => Promise<void>): Promise<{id:string;replayed:boolean}> {
  return recordRoutedCollectionTestOnly("VAULT",tx,actorId,raw,beforeNewWrite);
}

/** Custody-only laboratory command: callers must abort the whole transaction on error. */
export function recordCustodyCollectionTestOnly(tx: FinanceTransaction, actorId: bigint, raw: unknown, beforeNewWrite?: (tx: FinanceTransaction, branchId: string, actorId: bigint) => Promise<void>): Promise<{id:string;replayed:boolean}> {
  return recordRoutedCollectionTestOnly("CUSTODY",tx,actorId,raw,beforeNewWrite);
}
