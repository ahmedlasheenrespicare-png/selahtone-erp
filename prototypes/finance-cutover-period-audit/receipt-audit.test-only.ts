/**
 * Disposable synthetic data only. This diagnostic never determines historical
 * correctness, approves cutover, repairs records, or runs in the application.
 */
import { createHash } from "node:crypto";
import type { FinanceTransaction } from "../../src/lib/finance/types";

type Row = Record<string, unknown>;
type Item = Row & { id: string; amount: string; allocationAccount: string; validSource: boolean };
type Settlement = Row & { id: string; accountId: string; status: string; sales: string; expenses: string; receiptAccount: string | null; receiptCollections: unknown; receiptPayments: unknown; hash: string | null; receiptSales: string | null; receiptExpenses: string | null; linkedToAccount: boolean; scopeValid: boolean };
export type ReceiptIssue = "receipt_account_mismatch" | "settlement_scope_mismatch" | "receipt_on_unconfirmed" | "invalid_collection_ids" | "invalid_payment_ids" | "collection_membership_mismatch" | "payment_membership_mismatch" | "invalid_collection_allocation" | "invalid_payment_allocation" | "snapshot_mismatch" | "receipt_total_mismatch" | "attached_total_mismatch";
export type ReceiptReview = { settlementId: string; accountId: string; receiptAccountId: string; issues: ReceiptIssue[]; collections: Item[]; payments: Item[] };
function parseIds(raw: unknown): string[] | null {
  // JSONB normally arrives decoded; some adapters return its JSON text.
  if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch { return null; } }
  if (!Array.isArray(raw) || raw.some(id => typeof id !== "string" || !/^[1-9]\d{0,18}$/.test(id)) || new Set(raw).size !== raw.length) return null;
  return [...raw].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);
}
function sameIds(expected: string[], items: Item[]): boolean {
  return expected.length === items.length && expected.every((id, i) => id === items[i].id);
}
function snapshotHash(collections: Item[], payments: Item[]): string {
  return createHash("sha256").update(JSON.stringify({ collections: collections.map(({ id, amount }) => [id, amount]), payments: payments.map(({ id, amount }) => [id, amount]) })).digest("hex");
}
function cents(value: string): bigint {
  const match = /^(-?)(\d+)\.(\d{2})$/.exec(value);
  if (!match) throw new Error("unexpected synthetic NUMERIC scale");
  const total = BigInt(match[2]) * 100n + BigInt(match[3]);
  return match[1] ? -total : total;
}
function total(items: Item[]): bigint { return items.reduce((sum, item) => sum + cents(item.amount), 0n); }

/** Requires explicit opt-in and read-only stable snapshot, just like period audit. */
export async function auditTestOnlyReceipts(tx: FinanceTransaction, accountId: string): Promise<{ reviews: ReceiptReview[]; confirmedWithoutReceipt: string[]; linkedWithoutReceipt: { settlementId: string; accountId: string; status: string }[] }> {
  if (!/^[1-9]\d{0,18}$/.test(accountId)) throw new Error("invalid synthetic account id");
  const safety = await tx.query<Row & { optedIn: boolean; readOnly: boolean; stableSnapshot: boolean }>(`SELECT
    current_setting('selahtone.cutover_period_audit_test_only',true)='yes' AS "optedIn",
    current_setting('transaction_read_only')='on' AS "readOnly",
    current_setting('transaction_isolation') IN ('repeatable read','serializable') AS "stableSnapshot"`);
  if (!safety.rows[0]?.optedIn || !safety.rows[0]?.readOnly || !safety.rows[0]?.stableSnapshot) throw new Error("synthetic receipt audit requires explicit opt-in and a read-only repeatable snapshot");
  const account = await tx.query<Row & { id: string }>("SELECT id::text AS id FROM finance.accounts WHERE id=$1::bigint AND kind='CUSTODY' AND holder_id IS NOT NULL", [accountId]);
  if (!account.rows[0]) throw new Error("synthetic custody not found");
  // Include both sides of a mismatched receipt account, not just the settlement owner.
  const settlements = await tx.query<Settlement>(`SELECT s.id::text AS id,s.account_id::text AS "accountId",s.status,
      s.sales_total::text AS sales,s.expenses_total::text AS expenses,r.account_id::text AS "receiptAccount",
      r.collection_ids AS "receiptCollections",r.payment_ids AS "receiptPayments",r.snapshot_hash::text AS hash,
      r.sales_total::text AS "receiptSales",r.expenses_total::text AS "receiptExpenses",
      (s.branch_id=owner.branch_id AND owner.kind='CUSTODY' AND owner.holder_id IS NOT NULL) AS "scopeValid",
      (EXISTS (SELECT 1 FROM finance.collection_allocations_test_only ca WHERE ca.settlement_id=s.id AND ca.account_id=$1::bigint)
        OR EXISTS (SELECT 1 FROM finance.holder_payment_allocations_test_only pa WHERE pa.settlement_id=s.id AND pa.account_id=$1::bigint)) AS "linkedToAccount"
    FROM finance.settlements s JOIN finance.accounts owner ON owner.id=s.account_id
    LEFT JOIN finance.settlement_allocation_receipts_test_only r ON r.settlement_id=s.id
    WHERE s.account_id=$1::bigint OR r.account_id=$1::bigint
      OR EXISTS (SELECT 1 FROM finance.collection_allocations_test_only ca WHERE ca.settlement_id=s.id AND ca.account_id=$1::bigint)
      OR EXISTS (SELECT 1 FROM finance.holder_payment_allocations_test_only pa WHERE pa.settlement_id=s.id AND pa.account_id=$1::bigint)
    ORDER BY s.id`, [accountId]);
  const reviews: ReceiptReview[] = [], confirmedWithoutReceipt: string[] = [];
  const linkedWithoutReceipt: { settlementId: string; accountId: string; status: string }[] = [];
  for (const settlement of settlements.rows) {
    if (settlement.receiptAccount === null) {
      if (settlement.accountId === accountId && settlement.status === "CONFIRMED") confirmedWithoutReceipt.push(settlement.id);
      if (settlement.linkedToAccount) linkedWithoutReceipt.push({ settlementId: settlement.id, accountId: settlement.accountId, status: settlement.status });
      continue;
    }
    const collections = (await tx.query<Item>(`SELECT c.id::text AS id,c.amount::text AS amount,a.account_id::text AS "allocationAccount",
      COALESCE(a.account_id=s.account_id AND a.treatment='CUSTODY_PENDING' AND a.movement_id IS NULL AND c.method='CASH'
        AND sale.branch_id=acct.branch_id AND c.created_by_id=acct.holder_id AND a.assigned_by=c.created_by_id,false) AS "validSource"
      FROM finance.collection_allocations_test_only a JOIN public.commerce_collections c ON c.id=a.collection_id
      JOIN public.commerce_sales sale ON sale.id=c.sale_id JOIN finance.settlements s ON s.id=a.settlement_id
      JOIN finance.accounts acct ON acct.id=s.account_id WHERE a.settlement_id=$1::bigint ORDER BY c.id`, [settlement.id])).rows;
    const payments = (await tx.query<Item>(`SELECT p.id::text AS id,p.amount::text AS amount,a.account_id::text AS "allocationAccount",
      COALESCE(a.account_id=s.account_id AND p.method='CASH' AND p.source='HOLDER_CASH' AND expense.branch_id=acct.branch_id
        AND expense.requested_by=acct.holder_id AND p.recorded_by=acct.holder_id AND a.assigned_by=p.recorded_by,false) AS "validSource"
      FROM finance.holder_payment_allocations_test_only a JOIN finance.payments p ON p.id=a.payment_id
      JOIN finance.expenses expense ON expense.id=p.expense_id JOIN finance.settlements s ON s.id=a.settlement_id
      JOIN finance.accounts acct ON acct.id=s.account_id WHERE a.settlement_id=$1::bigint ORDER BY p.id`, [settlement.id])).rows;
    const issues: ReceiptIssue[] = [];
    if (settlement.receiptAccount !== settlement.accountId) issues.push("receipt_account_mismatch");
    if (!settlement.scopeValid) issues.push("settlement_scope_mismatch");
    if (settlement.status !== "CONFIRMED") issues.push("receipt_on_unconfirmed");
    const collectionIds = parseIds(settlement.receiptCollections), paymentIds = parseIds(settlement.receiptPayments);
    if (!collectionIds) issues.push("invalid_collection_ids");
    else if (!sameIds(collectionIds, collections)) issues.push("collection_membership_mismatch");
    if (!paymentIds) issues.push("invalid_payment_ids");
    else if (!sameIds(paymentIds, payments)) issues.push("payment_membership_mismatch");
    if (collections.some(item => !item.validSource)) issues.push("invalid_collection_allocation");
    if (payments.some(item => !item.validSource)) issues.push("invalid_payment_allocation");
    if (snapshotHash(collections, payments) !== settlement.hash) issues.push("snapshot_mismatch");
    if (settlement.receiptSales === null || settlement.receiptExpenses === null || cents(settlement.receiptSales) !== cents(settlement.sales) || cents(settlement.receiptExpenses) !== cents(settlement.expenses)) issues.push("receipt_total_mismatch");
    if (total(collections) !== cents(settlement.sales) || total(payments) !== cents(settlement.expenses)) issues.push("attached_total_mismatch");
    reviews.push({ settlementId: settlement.id, accountId: settlement.accountId, receiptAccountId: settlement.receiptAccount, issues, collections, payments });
  }
  return { reviews, confirmedWithoutReceipt, linkedWithoutReceipt };
}
