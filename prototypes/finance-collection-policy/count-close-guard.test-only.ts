/**
 * Disposable experiment only. This is not an integration or production guard.
 * Called inside the real engine's transaction after the real account lock and
 * tentative count/closure write; an error rolls the complete command back.
 */
import { FinanceProblem, type FinanceTransaction } from "../../src/lib/finance/types";
import { lockAndValidatePendingSourcesTestOnly } from "./period.test-only";

type Item = Record<string, unknown> & { id: string; amount: string };
export async function checkCountClosePeriodTestOnly(tx: FinanceTransaction, accountId: string, closing: boolean) {
  // This sample assumes the calling command already holds the account row lock.
  // IDs are compared independently, even when the numeric totals agree.
  const pending = await lockAndValidatePendingSourcesTestOnly(tx, accountId);
  const oldCollections = await tx.query<Item>(`SELECT c.id::text AS id,c.amount::text AS amount
    FROM public.commerce_collections c JOIN public.commerce_sales sale ON sale.id=c.sale_id
    JOIN finance.accounts acct ON acct.id=$1::bigint
    WHERE sale.branch_id=acct.branch_id AND sale.created_by_id=acct.holder_id AND c.method='CASH'
      AND c.created_at>COALESCE((SELECT resolved_at FROM finance.settlements WHERE account_id=acct.id AND status='CONFIRMED' ORDER BY resolved_at DESC,id DESC LIMIT 1),acct.opened_at)
    ORDER BY c.id FOR UPDATE OF c`, [accountId]);
  const oldPayments = await tx.query<Item>(`SELECT p.id::text AS id,p.amount::text AS amount
    FROM finance.payments p JOIN finance.expenses expense ON expense.id=p.expense_id
    JOIN finance.accounts acct ON acct.id=$1::bigint
    WHERE expense.branch_id=acct.branch_id AND expense.requested_by=acct.holder_id AND p.source='HOLDER_CASH'
      AND p.recorded_at>COALESCE((SELECT resolved_at FROM finance.settlements WHERE account_id=acct.id AND status='CONFIRMED' ORDER BY resolved_at DESC,id DESC LIMIT 1),acct.opened_at)
    ORDER BY p.id FOR UPDATE OF p`, [accountId]);
  const equivalent = (left: Item[], right: Item[]) => left.length === right.length && left.every((item, i) => item.id === right[i].id && item.amount === right[i].amount);
  if (!equivalent(oldCollections.rows, pending.collections) || !equivalent(oldPayments.rows, pending.payments)) {
    throw new FinanceProblem("experimental_period_mismatch", "اختبار اصطناعي: تختلف عناصر الفترة؛ الجرد أو الإقفال يتطلب مراجعة مستقلة.");
  }
  if (closing && (pending.collections.length || pending.payments.length)) {
    throw new FinanceProblem("experimental_pending", "اختبار اصطناعي: عناصر الفترة لم تُسوَّ.");
  }
}
