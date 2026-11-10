import { periodSourceWarningSql } from "./period-source-warning";
import { holderCorrectionPeriodSql } from "./holder-correction-period-sql";
/** Shared read-only SQL for finance dashboard totals. */
/* المتوقَّع بيد كل عهدة = الرصيد + مبيعات الفترة − مصروفاتها من نقد العهدة.
   كُتب مرة واحدة ويُستخدم مرتين: للإجمالي، ولتفصيله فرعًا فرعًا. */
export const CUSTODY_EXPECTATION_SQL = `SELECT a.id, a.branch_id,
    (a.opening_amount + COALESCE((SELECT SUM(CASE WHEN m.destination_id=a.id THEN m.amount ELSE -m.amount END)
      FROM finance.movements m WHERE m.source_id=a.id OR m.destination_id=a.id),0)) AS bal,
    COALESCE((SELECT SUM(c.amount) FROM public.commerce_collections c JOIN public.commerce_sales s ON s.id=c.sale_id
      WHERE s.branch_id=a.branch_id AND c.method='CASH' AND (a.holder_id IS NULL OR s.created_by_id=a.holder_id)
        AND c.created_at > COALESCE((SELECT st.resolved_at FROM finance.settlements st
          WHERE st.account_id=a.id AND st.status='CONFIRMED' ORDER BY st.resolved_at DESC, st.id DESC LIMIT 1), a.opened_at)),0) AS period_sales,
    COALESCE((SELECT SUM(p.amount) FROM finance.payments p JOIN finance.expenses e ON e.id=p.expense_id
      WHERE e.branch_id=a.branch_id AND p.source='HOLDER_CASH' AND (a.holder_id IS NULL OR e.requested_by=a.holder_id)
        AND p.recorded_at > COALESCE((SELECT st2.resolved_at FROM finance.settlements st2
          WHERE st2.account_id=a.id AND st2.status='CONFIRMED' ORDER BY st2.resolved_at DESC, st2.id DESC LIMIT 1), a.opened_at)),0) AS period_expenses,
    (EXISTS (SELECT 1 FROM public.commerce_collections c JOIN public.commerce_sales s ON s.id=c.sale_id
      WHERE s.branch_id=a.branch_id AND c.method='CASH' AND c.created_at=COALESCE((SELECT st.resolved_at FROM finance.settlements st
        WHERE st.account_id=a.id AND st.status='CONFIRMED' ORDER BY st.resolved_at DESC, st.id DESC LIMIT 1), a.opened_at))
    OR EXISTS (SELECT 1 FROM finance.payments p JOIN finance.expenses e ON e.id=p.expense_id
      WHERE e.branch_id=a.branch_id AND p.source='HOLDER_CASH' AND p.recorded_at=COALESCE((SELECT st.resolved_at FROM finance.settlements st
        WHERE st.account_id=a.id AND st.status='CONFIRMED' ORDER BY st.resolved_at DESC, st.id DESC LIMIT 1), a.opened_at))) AS boundary_ambiguous,
    EXISTS (SELECT 1 FROM finance.accounts other WHERE other.kind='CUSTODY' AND other.closed_at IS NULL AND other.holder_id=a.holder_id AND other.id<>a.id) AS multiple_custodies,
    ${periodSourceWarningSql("a.branch_id", "a.holder_id", "COALESCE((SELECT st4.resolved_at FROM finance.settlements st4 WHERE st4.account_id=a.id AND st4.status='CONFIRMED' ORDER BY st4.resolved_at DESC,st4.id DESC LIMIT 1),a.opened_at)")} AS source_recorder_mismatch,
    ${holderCorrectionPeriodSql("a.branch_id", "COALESCE((SELECT st3.resolved_at FROM finance.settlements st3 WHERE st3.account_id=a.id AND st3.status='CONFIRMED' ORDER BY st3.resolved_at DESC,st3.id DESC LIMIT 1),a.opened_at)")} AS holder_correction_in_period
  FROM finance.accounts a
  WHERE a.kind='CUSTODY' AND a.closed_at IS NULL AND ($1::bigint IS NULL OR a.branch_id=$1::bigint)`;

