import type { SessionUser } from "@/lib/auth";
import { assertFinanceActor, financeDb, financeEnabled } from "@/lib/finance/db";
import type { FinanceTransaction } from "@/lib/finance/types";

/** بطاقة الموظف: ما بيده فعلًا، وما يطلبه منه النظام اليوم.
 * لا تعرض رصيد العهدة وحده — الرصيد الدفتري يتجاهل مبيعات الفترة ومصروفاتها،
 * والموظف يُسأل عن «المتوقَّع بيده» لا عن الرصيد. */

export type EmployeeCash = {
  accountId: string;
  balance: string;
  sales: string;
  expenses: string;
  /** الرقم الذي يُسأل عنه الموظف عند التسليم: balance + sales − expenses. */
  expected: string;
  todaySales: string;
  todaySalesCount: number;
  todayExpenses: string;
  outstanding: string;
  outstandingCount: number;
  openSettlementId: string | null;
  /** طلب معلق وقعت بعده حركة نقدية، فالمعدود لم يعد مطابقًا للنقد في اليد. */
  settlementStale: boolean;
  pendingExpenses: number;
  approvedUnpaid: number;
};

/** ملخّص نقدي مختصر للإدارة: لا يُغني عن شاشة التسويات، بل يلفت النظر إليها. */
export type CashSummary = {
  custodyCount: number;
  totalExpected: string;
  pendingSettlements: number;
  pendingExpenses: number;
  approvedUnpaid: number;
};

function toCents(value: string): bigint {
  const negative = value.trim().startsWith("-");
  const [whole = "0", fraction = ""] = value.replace("-", "").split(".");
  return (negative ? -1n : 1n) * (BigInt(whole || "0") * 100n + BigInt((fraction + "00").slice(0, 2) || "0"));
}

function toMoney(cents: bigint): string {
  const sign = cents < 0n ? "-" : "";
  const abs = cents < 0n ? -cents : cents;
  return `${sign}${(abs / 100n).toString()}.${(abs % 100n).toString().padStart(2, "0")}`;
}

/** بداية اليوم بتوقيت القاهرة؛ created_at عمود timestamptz فالمقارنة به تصحّ. */
const CAIRO_DAY_START = `(CURRENT_DATE AT TIME ZONE 'Africa/Cairo')`;

async function read<T>(session: SessionUser, work: (tx: FinanceTransaction) => Promise<T>): Promise<T> {
  return financeDb.serializable(async (tx) => {
    await assertFinanceActor(tx, { id: session.id, role: session.role, branchId: session.branchId });
    return work(tx);
  });
}

export async function loadEmployeeCash(session: SessionUser): Promise<EmployeeCash | null> {
  if (!financeEnabled()) return null;
  return read(session, async (tx) => {
    const accounts = await tx.query<{ id: string; branchId: string; balance: string }>(`SELECT a.id::text AS id,
      a.branch_id::text AS "branchId",
      (a.opening_amount + COALESCE((SELECT SUM(CASE WHEN m.destination_id=a.id THEN m.amount ELSE -m.amount END)
        FROM finance.movements m WHERE m.source_id=a.id OR m.destination_id=a.id),0))::text AS balance
      FROM finance.accounts a WHERE a.kind='CUSTODY' AND a.holder_id=$1::bigint`, [session.id]);
    const account = accounts.rows[0];
    if (!account) return null;

    const since = await tx.query<{ since: string }>(`SELECT COALESCE(
        (SELECT resolved_at::text FROM finance.settlements WHERE account_id=$1::bigint AND status='CONFIRMED' ORDER BY resolved_at DESC, id DESC LIMIT 1),
        (SELECT opened_at::text FROM finance.accounts WHERE id=$1::bigint)) AS since`, [account.id]);
    const from = since.rows[0].since;

    const periodSales = await tx.query<{ total: string }>(`SELECT COALESCE(SUM(c.amount),0)::text AS total
      FROM public.commerce_collections c JOIN public.commerce_sales s ON s.id=c.sale_id
      WHERE s.branch_id=$1::bigint AND c.method='CASH' AND c.created_at > $2::timestamptz`, [account.branchId, from]);
    const periodExpenses = await tx.query<{ total: string }>(`SELECT COALESCE(SUM(p.amount),0)::text AS total
      FROM finance.payments p JOIN finance.expenses e ON e.id=p.expense_id
      WHERE e.branch_id=$1::bigint AND p.source='HOLDER_CASH' AND p.recorded_at > $2::timestamptz`, [account.branchId, from]);

    const todaySales = await tx.query<{ total: string; n: number }>(`SELECT COALESCE(SUM(c.amount),0)::text AS total,
        COUNT(DISTINCT s.id)::int AS n
      FROM public.commerce_collections c JOIN public.commerce_sales s ON s.id=c.sale_id
      WHERE s.branch_id=$1::bigint AND c.method='CASH' AND c.created_at >= ${CAIRO_DAY_START}`, [account.branchId]);
    const todayExpenses = await tx.query<{ total: string }>(`SELECT COALESCE(SUM(p.amount),0)::text AS total
      FROM finance.payments p JOIN finance.expenses e ON e.id=p.expense_id
      WHERE e.branch_id=$1::bigint AND p.source='HOLDER_CASH' AND p.recorded_at >= ${CAIRO_DAY_START}`, [account.branchId]);

    // الباقي على العملاء: فواتير الفرع غير الملغاة التي لم تُحصَّل كاملًا.
    const outstanding = await tx.query<{ total: string; n: number }>(`SELECT COALESCE(SUM(x.remaining),0)::text AS total, COUNT(*)::int AS n FROM (
        SELECT s.total - COALESCE((SELECT SUM(c.amount) FROM public.commerce_collections c WHERE c.sale_id=s.id),0) AS remaining
        FROM public.commerce_sales s WHERE s.branch_id=$1::bigint AND s.cancelled_at IS NULL) x
      WHERE x.remaining > 0`, [account.branchId]);

    const open = await tx.query<{ id: string; createdAt: string }>(`SELECT id::text AS id, created_at::text AS "createdAt"
      FROM finance.settlements WHERE account_id=$1::bigint AND status='OPEN' ORDER BY id DESC LIMIT 1`, [account.id]);
    const openSettlement = open.rows[0] ?? null;

    // نفس شروط المحرك عند الاعتماد: حركة على العهدة، أو تحصيل نقدي في الفرع،
    // أو صرف من نقد الموظف — أيها وقع بعد تقديم الطلب أبطل المعدود.
    let settlementStale = false;
    if (openSettlement) {
      const stale = await tx.query<{ n: number }>(`SELECT ((
          SELECT count(*) FROM finance.movements
           WHERE (source_id=$1::bigint OR destination_id=$1::bigint) AND created_at > $2::timestamptz)
        + (SELECT count(*) FROM public.commerce_collections c JOIN public.commerce_sales s ON s.id=c.sale_id
            WHERE s.branch_id=$3::bigint AND c.method='CASH' AND c.created_at > $2::timestamptz)
        + (SELECT count(*) FROM finance.payments p JOIN finance.expenses e ON e.id=p.expense_id
            WHERE e.branch_id=$3::bigint AND p.source='HOLDER_CASH' AND p.recorded_at > $2::timestamptz)
        )::int AS n`, [account.id, openSettlement.createdAt, account.branchId]);
      settlementStale = Number(stale.rows[0].n) > 0;
    }

    // العدد والمبلغ فقط: وصف المصروف ومستفيده وضريبته لا يظهر لمن لا يملكه.
    const pending = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM finance.expenses
      WHERE status='PENDING' AND requested_by=$1::bigint`, [session.id]);
    const approved = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM finance.expenses
      WHERE status='APPROVED' AND requested_by=$1::bigint`, [session.id]);

    const balanceCents = toCents(account.balance);
    const salesCents = toCents(periodSales.rows[0].total);
    const expensesCents = toCents(periodExpenses.rows[0].total);

    return {
      accountId: account.id,
      balance: toMoney(balanceCents),
      sales: toMoney(salesCents),
      expenses: toMoney(expensesCents),
      expected: toMoney(balanceCents + salesCents - expensesCents),
      todaySales: toMoney(toCents(todaySales.rows[0].total)),
      todaySalesCount: Number(todaySales.rows[0].n),
      todayExpenses: toMoney(toCents(todayExpenses.rows[0].total)),
      outstanding: toMoney(toCents(outstanding.rows[0].total)),
      outstandingCount: Number(outstanding.rows[0].n),
      openSettlementId: openSettlement?.id ?? null,
      settlementStale,
      pendingExpenses: Number(pending.rows[0].n),
      approvedUnpaid: Number(approved.rows[0].n),
    };
  });
}

export async function loadCashSummary(session: SessionUser): Promise<CashSummary | null> {
  if (!financeEnabled()) return null;
  const branchId = session.branchId === null || session.branchId === undefined ? null : String(session.branchId);
  return read(session, async (tx) => {
    const totals = await tx.query<{ total: string; n: number }>(`SELECT COALESCE(SUM(x.bal + x.period_sales - x.period_expenses),0)::text AS total,
        COUNT(*)::int AS n FROM (
      SELECT a.id,
        (a.opening_amount + COALESCE((SELECT SUM(CASE WHEN m.destination_id=a.id THEN m.amount ELSE -m.amount END)
          FROM finance.movements m WHERE m.source_id=a.id OR m.destination_id=a.id),0)) AS bal,
        COALESCE((SELECT SUM(c.amount) FROM public.commerce_collections c JOIN public.commerce_sales s ON s.id=c.sale_id
          WHERE s.branch_id=a.branch_id AND c.method='CASH'
            AND c.created_at > COALESCE((SELECT st.resolved_at FROM finance.settlements st
              WHERE st.account_id=a.id AND st.status='CONFIRMED' ORDER BY st.resolved_at DESC, st.id DESC LIMIT 1), a.opened_at)),0) AS period_sales,
        COALESCE((SELECT SUM(p.amount) FROM finance.payments p JOIN finance.expenses e ON e.id=p.expense_id
          WHERE e.branch_id=a.branch_id AND p.source='HOLDER_CASH'
            AND p.recorded_at > COALESCE((SELECT st2.resolved_at FROM finance.settlements st2
              WHERE st2.account_id=a.id AND st2.status='CONFIRMED' ORDER BY st2.resolved_at DESC, st2.id DESC LIMIT 1), a.opened_at)),0) AS period_expenses
      FROM finance.accounts a
      WHERE a.kind='CUSTODY' AND ($1::bigint IS NULL OR a.branch_id=$1::bigint)) x`, [branchId]);

    const pendingSettlements = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM finance.settlements WHERE status='OPEN'`);
    const pendingExpenses = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM finance.expenses WHERE status='PENDING'`);
    const approvedUnpaid = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM finance.expenses WHERE status='APPROVED'`);

    return {
      custodyCount: Number(totals.rows[0].n),
      totalExpected: toMoney(toCents(totals.rows[0].total)),
      pendingSettlements: Number(pendingSettlements.rows[0].n),
      pendingExpenses: Number(pendingExpenses.rows[0].n),
      approvedUnpaid: Number(approvedUnpaid.rows[0].n),
    };
  });
}
