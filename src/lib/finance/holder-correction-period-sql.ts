/** Trusted SQL fragments only: a correction can point by payment, expense or
 * review-expense. The payment's branch scopes the check; no holder attribution
 * is assumed. The recorded-time boundary includes equality conservatively. */
export function holderCorrectionPeriodSql(branchSql: string, sinceSql: string): string {
  return `EXISTS (SELECT 1 FROM finance.payments p JOIN finance.expenses e ON e.id=p.expense_id
    WHERE e.branch_id=${branchSql} AND p.source='HOLDER_CASH' AND p.recorded_at >= ${sinceSql}
      AND EXISTS (SELECT 1 FROM finance.expense_corrections c
        LEFT JOIN finance.expense_reviews r ON r.id=c.review_id
        WHERE c.payment_id=p.id OR c.expense_id=p.expense_id OR r.expense_id=p.expense_id))`;
}
