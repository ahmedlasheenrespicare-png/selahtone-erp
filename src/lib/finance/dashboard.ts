import type { SessionUser } from "@/lib/auth";
import type {
  PantherChartPoint,
  PantherChartSeries,
  PantherMetricBlock,
} from "@/components/panther-spotlight-card";
import { displayMoney } from "@/lib/commerce-display";
import { assertFinanceActor, financeDb, financeEnabled } from "@/lib/finance/db";
import { listAccounts, listExpenses, listSettlements } from "@/lib/finance/engine";
import type { FinanceTransaction } from "@/lib/finance/types";
import { cairoDate } from "@/lib/finance/validation";

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
  /** عهدة كل فرع على حدة — تعرضها البطاقة تفصيلًا تحت الإجمالي */
  custodies: { branchName: string; expected: string }[];
};

/* المتوقَّع بيد كل عهدة = الرصيد + مبيعات الفترة − مصروفاتها من نقد العهدة.
   كُتب مرة واحدة ويُستخدم مرتين: للإجمالي، ولتفصيله فرعًا فرعًا. */
const CUSTODY_EXPECTATION_SQL = `SELECT a.id, a.branch_id,
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
  WHERE a.kind='CUSTODY' AND a.closed_at IS NULL AND ($1::bigint IS NULL OR a.branch_id=$1::bigint)`;

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
const CAIRO_DAY_START = `(DATE_TRUNC('day', NOW() AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo')`;

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
      FROM finance.accounts a WHERE a.kind='CUSTODY' AND a.holder_id=$1::bigint AND a.closed_at IS NULL`, [session.id]);
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

export async function loadCashSummary(
  session: SessionUser,
  branchFilterId?: string | null,
): Promise<CashSummary | null> {
  if (!financeEnabled()) return null;
  const branchId =
    session.branchId !== null && session.branchId !== undefined
      ? String(session.branchId)
      : branchFilterId ?? null;
  return read(session, async (tx) => {
    const totals = await tx.query<{ total: string; n: number }>(
      `SELECT COALESCE(SUM(x.bal + x.period_sales - x.period_expenses),0)::text AS total,
        COUNT(*)::int AS n FROM (${CUSTODY_EXPECTATION_SQL}) x`,
      [branchId],
    );

    // عهدة كل فرع على حدة. محجوب: فتعثّر هذا الاستعلام لا يجوز أن يُسقط
    // اللوحة كلها، بل تظهر البطاقة بإجماليها دون تفصيل الفروع.
    let custodies: { branchName: string; expected: string }[] = [];
    try {
      const perBranch = await tx.query<{ branch_name: string; total: string }>(
        `SELECT b.name_ar AS branch_name,
            COALESCE(SUM(x.bal + x.period_sales - x.period_expenses),0)::text AS total
          FROM (${CUSTODY_EXPECTATION_SQL}) x
          JOIN public.branches b ON b.id = x.branch_id
          GROUP BY b.id, b.name_ar
          ORDER BY COALESCE(SUM(x.bal + x.period_sales - x.period_expenses),0) DESC, b.name_ar`,
        [branchId],
      );
      custodies = perBranch.rows.map((row) => ({
        branchName: row.branch_name,
        expected: toMoney(toCents(row.total)),
      }));
    } catch (error) {
      console.error("[dashboard] تعذّر حساب العهدة فرعًا فرعًا", error);
    }

    const pendingSettlements = await tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM finance.settlements
       WHERE status='OPEN' AND ($1::bigint IS NULL OR branch_id=$1::bigint)`,
      [branchId],
    );
    const pendingExpenses = await tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM finance.expenses
       WHERE status='PENDING' AND ($1::bigint IS NULL OR branch_id=$1::bigint)`,
      [branchId],
    );
    const approvedUnpaid = await tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM finance.expenses
       WHERE status='APPROVED' AND ($1::bigint IS NULL OR branch_id=$1::bigint)`,
      [branchId],
    );

    return {
      custodyCount: Number(totals.rows[0].n),
      totalExpected: toMoney(toCents(totals.rows[0].total)),
      pendingSettlements: Number(pendingSettlements.rows[0].n),
      pendingExpenses: Number(pendingExpenses.rows[0].n),
      approvedUnpaid: Number(approvedUnpaid.rows[0].n),
      custodies,
    };
  });
}

export type DashboardSpotlightData = {
  title: string;
  subtitle: string;
  pill: string;
  primary: PantherMetricBlock;
  secondary: PantherMetricBlock;
  series: PantherChartSeries[];
  actionHref: string;
  actionLabel: string;
};

export type DashboardFinanceActivity = {
  key: string;
  kind: "expense" | "settlement";
  title: string;
  subtitle: string;
  amountFormatted: string;
  statusLabel: string;
  tone: "positive" | "warning" | "neutral";
  timestampMs: number;
  timestampIso: string;
  href: string;
};

export type DashboardPaidExpenseFlow = {
  /** المصروفات المدفوعة فعليًا هذا الشهر ضمن صلاحية المستخدم بالسنت */
  monthPaidCentsStr: string;
  /** المصروفات المدفوعة يومًا بيوم (YYYY-MM-DD -> cents) */
  monthPaidByDayCents: Record<string, string>;
  /** المصروفات المدفوعة لكل فرع (branchId -> cents) */
  monthPaidByBranchIdCents: Record<string, string>;
};

export type DashboardFinanceOpsSummary = {
  /** إجمالي المصروفات المعتمدة والمدفوعة هذا الشهر بالسنت */
  monthRecognizedExpensesCentsStr: string;
  /** المصروفات المعتمدة والمدفوعة يومًا بيوم (YYYY-MM-DD -> cents) */
  monthRecognizedByDayCents: Record<string, string>;
  /** المصروفات المعتمدة والمدفوعة لكل فرع (branchId -> cents) */
  monthRecognizedByBranchIdCents: Record<string, string>;
  /** طلبات تسوية معلّقة بطلت بسبب حركة نقدية لاحقة */
  staleOpenSettlementsCount: number;
  /** طلبات تسوية (مفتوحة أو مؤكّدة هذا الشهر) ذات فرق جرد فعلي */
  varianceSettlementsCount: number;
  /** مجموع القيم المطلقة لفروقات الجرد بالسنت */
  varianceTotalAbsCentsStr: string;
  /** عدد طلبات التسوية الباطلة لكل فرع */
  staleByBranchId: Record<string, number>;
  /** عدد طلبات التسوية ذات الفروقات لكل فرع */
  varianceByBranchId: Record<string, number>;
  /** عدد المعاملات المالية المعلّقة للاعتماد أو الصرف */
  pendingBacklogCount: number;
};

export type DashboardFinanceSpotlights = {
  cashBalance: DashboardSpotlightData | null;
  monthlyExpenses: DashboardSpotlightData | null;
  recentActivities: DashboardFinanceActivity[];
  financeOpsSummary: DashboardFinanceOpsSummary | null;
  paidExpenseFlow: DashboardPaidExpenseFlow;
};

const EXPENSE_STATUS_AR: Record<string, string> = {
  PENDING: "بانتظار الاعتماد",
  APPROVED: "معتمد للصرف",
  PAID: "مدفوع فعليًا",
};

const SETTLEMENT_STATUS_AR: Record<string, string> = {
  OPEN: "معلّق للاعتماد",
  CONFIRMED: "تسوية مؤكّدة",
  REJECTED: "مرفوض",
  CANCELLED: "ملغى",
};

/**
 * يبني بطاقتَي «الميزان النقدي» و«مصروفات الشهر وحالة الصرف» للوحة القيادة
 * مع احترام حدود الصلاحيات: المدير والمحاسب للشركة، والموظف لعهدته ومصروفاته فقط.
 */
export async function loadDashboardFinanceSpotlights(
  session: SessionUser,
  opts: {
    branches: Array<{ id: string; nameAr: string }>;
    monthLabel: string;
    cash: EmployeeCash | null;
    summary: CashSummary | null;
    branchFilterId?: string | null;
  },
): Promise<DashboardFinanceSpotlights | null> {
  if (!financeEnabled()) return null;

  const canManage = session.role === "MANAGER" || session.role === "ACCOUNTANT";
  const canReadOwnExpenses = session.role === "CS_AGENT" && Boolean(session.branchId);
  if (!canManage && !canReadOwnExpenses) return null;

  const {
    accounts: rawAccounts,
    expenses: rawExpenses,
    settlements: rawSettlements,
    staleOpenBranchIds,
  } = await read(session, async (tx) => {
    const inlineDb = { serializable: <R>(work: (inner: FinanceTransaction) => Promise<R>) => work(tx) };
    const loadedAccounts = await listAccounts(inlineDb, session.id);
    const loadedExpenses =
      canManage || canReadOwnExpenses ? await listExpenses(inlineDb, session.id) : [];
    const loadedSettlements = await listSettlements(inlineDb, session.id);
    const staleRows = canManage
      ? await tx.query<{ branchId: string }>(`
          SELECT st.branch_id::text AS "branchId"
          FROM finance.settlements st
          WHERE st.status = 'OPEN'
            AND (
              EXISTS (
                SELECT 1 FROM finance.movements m
                WHERE (m.source_id = st.account_id OR m.destination_id = st.account_id)
                  AND m.created_at > st.created_at
              )
              OR EXISTS (
                SELECT 1 FROM public.commerce_collections c
                JOIN public.commerce_sales s ON s.id = c.sale_id
                WHERE s.branch_id = st.branch_id
                  AND c.method = 'CASH'
                  AND c.created_at > st.created_at
              )
              OR EXISTS (
                SELECT 1 FROM finance.payments p
                JOIN finance.expenses e ON e.id = p.expense_id
                WHERE e.branch_id = st.branch_id
                  AND p.source = 'HOLDER_CASH'
                  AND p.recorded_at > st.created_at
              )
            )
        `)
      : { rows: [] };
    return {
      accounts: loadedAccounts,
      expenses: loadedExpenses,
      settlements: loadedSettlements,
      staleOpenBranchIds: staleRows.rows.map((r) => String(r.branchId)),
    };
  });

  const activeBranchFilter =
    session.branchId ? String(session.branchId) : opts.branchFilterId ?? null;
  const accounts = activeBranchFilter
    ? rawAccounts.filter((a) => String(a.branchId) === activeBranchFilter)
    : rawAccounts;
  const expenses = activeBranchFilter
    ? rawExpenses.filter((e) => String(e.branchId) === activeBranchFilter)
    : rawExpenses;
  const settlements = activeBranchFilter
    ? rawSettlements.filter((s) => String(s.branchId) === activeBranchFilter)
    : rawSettlements;

  const branchNames = new Map(opts.branches.map((b) => [b.id, b.nameAr]));
  const currentMonthPrefix = cairoDate().slice(0, 7);

  // ── ١. حساب مصروفات الشهر وحالة الصرف ──
  const monthExpensesChrono = expenses
    .filter((exp) => String(exp.expenseDate).startsWith(currentMonthPrefix))
    .slice()
    .sort((a, b) => {
      const cmp = String(a.expenseDate).localeCompare(String(b.expenseDate));
      return cmp !== 0 ? cmp : Number(a.id) - Number(b.id);
    });

  let monthTotalCents = 0n;
  let monthPaidCents = 0n;
  let monthApprovedCents = 0n;
  let monthPendingCents = 0n;
  let monthApprovedCount = 0;
  let monthPendingCount = 0;
  const monthExpByBranch = new Map<string, bigint>();

  for (const exp of monthExpensesChrono) {
    const amt = toCents(exp.amount);
    monthTotalCents += amt;
    const bName = branchNames.get(exp.branchId) ?? "الفرع";
    monthExpByBranch.set(bName, (monthExpByBranch.get(bName) ?? 0n) + amt);

    if (exp.status === "PAID") {
      monthPaidCents += amt;
    } else if (exp.status === "APPROVED") {
      monthApprovedCents += amt;
      monthApprovedCount += 1;
    } else {
      monthPendingCents += amt;
      monthPendingCount += 1;
    }
  }

  const monthUnpaidCents = monthApprovedCents + monthPendingCents;
  const monthUnpaidCount = monthApprovedCount + monthPendingCount;
  const monthCount = monthExpensesChrono.length;

  const expensesSeries: PantherChartSeries[] = [];
  if (monthCount === 0) {
    expensesSeries.push({
      id: "month-cum",
      label: "مسار مصروفات الشهر",
      points: [
        {
          label: "بداية الشهر",
          shortLabel: "البداية",
          value: 0,
          formattedValue: "0 ج.م",
          secondaryValue: 0,
          secondaryLabel: "المدفوع",
          secondaryFormatted: "0 ج.م",
          detail: "نقطة بداية الشهر الحالي",
        },
        {
          label: "الآن — لا مصروفات هذا الشهر",
          shortLabel: "الآن",
          value: 0,
          formattedValue: "0 ج.م",
          secondaryValue: 0,
          secondaryLabel: "المدفوع",
          secondaryFormatted: "0 ج.م",
          detail: "لم تُسجّل بنود مصروفات في الشهر الحالي بعد",
        },
      ],
    });
  } else if (monthCount <= 14) {
    let cumAll = 0n;
    let cumPaid = 0n;
    const cumPoints: PantherChartPoint[] = [
      {
        label: "بداية الشهر",
        shortLabel: "٠",
        value: 0,
        formattedValue: "0 ج.م",
        secondaryValue: 0,
        secondaryLabel: "المدفوع",
        secondaryFormatted: "0 ج.م",
        detail: "بداية حساب مصروفات الشهر",
      },
    ];
    const itemPoints: PantherChartPoint[] = [];

    for (const exp of monthExpensesChrono) {
      const amt = toCents(exp.amount);
      const bName = branchNames.get(exp.branchId) ?? "الفرع";
      const stLabel = EXPENSE_STATUS_AR[exp.status] ?? exp.status;
      cumAll += amt;
      if (exp.status === "PAID") cumPaid += amt;

      cumPoints.push({
        label: `${exp.categorySnapshot} · ${bName}`,
        shortLabel: `#${exp.id}`,
        value: Number(cumAll) / 100,
        formattedValue: `${displayMoney(cumAll)} ج.م`,
        secondaryValue: Number(cumPaid) / 100,
        secondaryLabel: "المدفوع فعليًا",
        secondaryFormatted: `${displayMoney(cumPaid)} ج.م`,
        detail: `${displayMoney(amt)} ج.م (${stLabel}) — ${exp.description}`,
      });

      itemPoints.push({
        label: exp.description,
        shortLabel: `#${exp.id}`,
        value: Number(amt) / 100,
        formattedValue: `${displayMoney(amt)} ج.م`,
        detail: `${exp.categorySnapshot} · ${bName} · ${stLabel}`,
      });
    }

    expensesSeries.push({
      id: "month-cum",
      label: "مسار مصروفات الشهر",
      points: cumPoints,
    });
    expensesSeries.push({
      id: "month-items",
      label: "كل مصروف",
      points: itemPoints,
    });
  } else {
    const byDay = new Map<string, { all: bigint; paid: bigint; count: number }>();
    for (const exp of monthExpensesChrono) {
      const dKey = String(exp.expenseDate);
      const cur = byDay.get(dKey) ?? { all: 0n, paid: 0n, count: 0 };
      const amt = toCents(exp.amount);
      cur.all += amt;
      if (exp.status === "PAID") cur.paid += amt;
      cur.count += 1;
      byDay.set(dKey, cur);
    }
    let cumAll = 0n;
    let cumPaid = 0n;
    const cumPoints: PantherChartPoint[] = [
      {
        label: "بداية الشهر",
        shortLabel: "٠",
        value: 0,
        formattedValue: "0 ج.م",
        secondaryValue: 0,
        secondaryLabel: "المدفوع",
        secondaryFormatted: "0 ج.م",
      },
    ];
    for (const [dKey, info] of byDay.entries()) {
      cumAll += info.all;
      cumPaid += info.paid;
      cumPoints.push({
        label: `يوم ${dKey}`,
        shortLabel: dKey.slice(5),
        value: Number(cumAll) / 100,
        formattedValue: `${displayMoney(cumAll)} ج.م`,
        secondaryValue: Number(cumPaid) / 100,
        secondaryLabel: "المدفوع فعليًا",
        secondaryFormatted: `${displayMoney(cumPaid)} ج.م`,
        detail: `مصروفات اليوم ${displayMoney(info.all)} ج.م (${info.count} بند)`,
      });
    }
    expensesSeries.push({
      id: "month-cum",
      label: "مسار مصروفات الشهر",
      points: cumPoints,
    });
  }

  expensesSeries.push({
    id: "status-breakdown",
    label: "حسب حالة الصرف",
    points: [
      {
        label: "مدفوع فعليًا (الشهر الحالي)",
        shortLabel: "مدفوع",
        value: Number(monthPaidCents) / 100,
        formattedValue: `${displayMoney(monthPaidCents)} ج.م`,
        detail: "مصروفات اعتُمدت وسُجّل صرفها الفعلي هذا الشهر",
      },
      {
        label: "معتمد بانتظار الصرف",
        shortLabel: "للصرف",
        value: Number(monthApprovedCents) / 100,
        formattedValue: `${displayMoney(monthApprovedCents)} ج.م`,
        detail: `${monthApprovedCount} بند معتمد وجاهز لتسجيل الدفع الفعلي`,
      },
      {
        label: "بانتظار الاعتماد",
        shortLabel: "للاعتماد",
        value: Number(monthPendingCents) / 100,
        formattedValue: `${displayMoney(monthPendingCents)} ج.م`,
        detail: `${monthPendingCount} بند مسجّل بانتظار مراجعة واعتماد الإدارة`,
      },
    ],
  });

  const monthlyExpensesSpotlight: DashboardSpotlightData = {
    title: "مصروفات الشهر وحالة الصرف",
    subtitle: canManage
      ? `محدّث الآن · ${opts.monthLabel}`
      : `مصروفاتك المسجّلة · ${opts.monthLabel}`,
    pill: `${monthCount} مصروف`,
    primary: {
      label: canManage ? "مصروفات الشهر الحالي" : "مصروفاتك هذا الشهر",
      value: displayMoney(monthTotalCents),
      unit: "ج.م",
      delta: `مدفوع منها فعليًا: ${displayMoney(monthPaidCents)} ج.م`,
      tone: "positive",
    },
    secondary: {
      label: "معلّق للاعتماد أو الصرف",
      value: displayMoney(monthUnpaidCents),
      unit: "ج.م",
      delta:
        monthUnpaidCount > 0
          ? `${monthPendingCount} للاعتماد · ${monthApprovedCount} معتمد بانتظار الصرف`
          : "0 معلقات · جميع مصروفات الشهر مسدّدة",
      tone: monthUnpaidCount > 0 ? "negative" : "positive",
    },
    series: expensesSeries,
    actionHref: "/finance/expenses",
    actionLabel: canManage
      ? "مراجعة سجل المصروفات وحالة الصرف"
      : "عرض مصروفاتي وتسجيل مصروف جديد",
  };

  // ── ٢. حساب الميزان النقدي ──
  let cashBalanceSpotlight: DashboardSpotlightData | null = null;

  if (canManage && opts.summary) {
    let vaultTotalCents = 0n;
    let openVaultCount = 0;
    let openCustodyCount = 0;
    const vaultByBranch = new Map<string, bigint>();
    const openAccountPoints: PantherChartPoint[] = [];

    for (const acc of accounts) {
      if (acc.closedAt) continue;
      const balCents = toCents(acc.balance);
      const bName = branchNames.get(acc.branchId) ?? "الفرع";
      if (acc.kind === "VAULT") {
        vaultTotalCents += balCents;
        openVaultCount += 1;
        vaultByBranch.set(bName, (vaultByBranch.get(bName) ?? 0n) + balCents);
        openAccountPoints.push({
          label: `خزنة ${bName}`,
          shortLabel: `خزنة ${bName.replace(/^فرع\s+/, "")}`,
          value: Number(balCents) / 100,
          formattedValue: `${displayMoney(balCents)} ج.م`,
          detail: "رصيد الخزنة الدفتري المفتوح",
        });
      } else {
        openCustodyCount += 1;
        openAccountPoints.push({
          label: `عهدة ${bName}`,
          shortLabel: `عهدة ${bName.replace(/^فرع\s+/, "")}`,
          value: Number(balCents) / 100,
          formattedValue: `${displayMoney(balCents)} ج.م`,
          detail: "الرصيد الدفتري للعهدة المفتوحة",
        });
      }
    }

    const custodyByBranch = new Map<string, bigint>();
    for (const c of opts.summary.custodies) {
      custodyByBranch.set(
        c.branchName,
        (custodyByBranch.get(c.branchName) ?? 0n) + toCents(c.expected),
      );
    }

    const expectedCustodyCents = toCents(opts.summary.totalExpected);
    const totalLiquidityCents = vaultTotalCents + expectedCustodyCents;
    const netSurplusCents = totalLiquidityCents - monthTotalCents;

    const cashSeries: PantherChartSeries[] = [
      {
        id: "liquidity-mix",
        label: "توزيع السيولة",
        chartVariant: "donut",
        points: [
          {
            label: "أرصدة الخزائن المفتوحة",
            shortLabel: "الخزائن",
            value: Number(vaultTotalCents) / 100,
            formattedValue: `${displayMoney(vaultTotalCents)} ج.م`,
            detail: `موزّعة على ${openVaultCount} خزنة فرع نشطة`,
            tone: "accent",
          },
          {
            label: "المستحق بالعُهَد المفتوحة",
            shortLabel: "العُهَد",
            value: Number(expectedCustodyCents) / 100,
            formattedValue: `${displayMoney(expectedCustodyCents)} ج.م`,
            detail: `عبر ${openCustodyCount} عهدة موظف مفتوحة`,
            tone: "alt",
          },
        ],
      },
    ];

    if (opts.branches.length > 0) {
      const branchPoints: PantherChartPoint[] = opts.branches.map((b) => {
        const vCents = vaultByBranch.get(b.nameAr) ?? 0n;
        const cCents = custodyByBranch.get(b.nameAr) ?? 0n;
        const liqCents = vCents + cCents;
        const eCents = monthExpByBranch.get(b.nameAr) ?? 0n;
        return {
          label: b.nameAr,
          shortLabel: b.nameAr.replace(/^فرع\s+/, ""),
          value: Number(liqCents) / 100,
          formattedValue: `${displayMoney(liqCents)} ج.م`,
          secondaryValue: Number(eCents) / 100,
          secondaryLabel: "مصروفات الشهر",
          secondaryFormatted: `${displayMoney(eCents)} ج.م`,
          detail: `خزنة ${displayMoney(vCents)} + عهدة متوقعة ${displayMoney(cCents)} ج.م`,
        };
      });
      if (branchPoints.length === 1) {
        branchPoints.unshift({
          label: "نقطة الأساس",
          shortLabel: "٠",
          value: 0,
          formattedValue: "0.00 ج.م",
        });
      }
      cashSeries.push({
        id: "branch-balance",
        label: "ميزان الفروع",
        points: branchPoints,
      });
    }

    cashSeries.push({
      id: "cash-equation",
      label: "معادلة السيولة",
      points: [
        {
          label: "أرصدة الخزائن",
          shortLabel: "الخزائن",
          value: Number(vaultTotalCents) / 100,
          formattedValue: `${displayMoney(vaultTotalCents)} ج.م`,
          detail: `موزّعة على ${openVaultCount} خزنة فرع نشطة`,
        },
        {
          label: "المستحق بالعُهَد المفتوحة",
          shortLabel: "العُهَد",
          value: Number(expectedCustodyCents) / 100,
          formattedValue: `${displayMoney(expectedCustodyCents)} ج.م`,
          detail: `عبر ${openCustodyCount} عهدة موظف مفتوحة`,
        },
        {
          label: "إجمالي السيولة المتوقعة",
          shortLabel: "الإجمالي",
          value: Number(totalLiquidityCents) / 100,
          formattedValue: `${displayMoney(totalLiquidityCents)} ج.م`,
          detail: "مجموع أرصدة الخزائن + المستحق بالعُهَد",
        },
        {
          label: "مصروفات الشهر الحالي",
          shortLabel: "المصروفات",
          value: Number(monthTotalCents) / 100,
          formattedValue: `${displayMoney(monthTotalCents)} ج.م`,
          detail: `${monthCount} بند مصروف في الشهر الحالي`,
        },
        {
          label: "صافي السيولة بعد المصروفات",
          shortLabel: "الصافي",
          value: Number(netSurplusCents) / 100,
          formattedValue: `${displayMoney(netSurplusCents)} ج.م`,
          detail: "إجمالي السيولة مطروحًا منه مصروفات الشهر",
        },
      ],
    });

    if (openAccountPoints.length > 1) {
      cashSeries.push({
        id: "open-accounts",
        label: "الأوعية المفتوحة",
        points: openAccountPoints,
      });
    }

    cashBalanceSpotlight = {
      title: "الميزان النقدي",
      subtitle: `محدّث الآن · سيولة الخزائن والعُهَد المفتوحة (${opts.branches.length} فرع)`,
      pill: `${openVaultCount + openCustodyCount} وعاء نقدي`,
      primary: {
        label: "إجمالي السيولة المتوقعة",
        value: displayMoney(totalLiquidityCents),
        unit: "ج.م",
        delta: `خزائن: ${displayMoney(vaultTotalCents)} · عُهَد: ${displayMoney(expectedCustodyCents)} ج.م`,
        tone: "positive",
      },
      secondary: {
        label: "صافي السيولة بعد مصروفات الشهر",
        value: displayMoney(netSurplusCents),
        unit: "ج.م",
        delta:
          opts.summary.pendingSettlements > 0
            ? `${opts.summary.pendingSettlements} طلب تسوية بانتظار المراجعة`
            : "0 تسويات معلّقة · الأرصدة محدّثة",
        tone: opts.summary.pendingSettlements > 0 ? "negative" : "positive",
      },
      series: cashSeries,
      actionHref: "/finance",
      actionLabel: "فتح لوحة المالية والأوعية النقدية",
    };
  } else if (opts.cash) {
    const balCents = toCents(opts.cash.balance);
    const salesCents = toCents(opts.cash.sales);
    const expCents = toCents(opts.cash.expenses);
    const expectedCents = toCents(opts.cash.expected);
    const todaySalesCents = toCents(opts.cash.todaySales);
    const todayExpCents = toCents(opts.cash.todayExpenses);

    cashBalanceSpotlight = {
      title: "الميزان النقدي",
      subtitle: "محدّث الآن · حركة عهدتك النقدية منذ آخر تسوية",
      pill: `${opts.cash.todaySalesCount} بيع اليوم`,
      primary: {
        label: "المتوقَّع بيدك الآن",
        value: displayMoney(expectedCents),
        unit: "ج.م",
        delta: `رصيد ${displayMoney(balCents)} + مقبوضات ${displayMoney(salesCents)} ج.م`,
        tone: "positive",
      },
      secondary: {
        label: "منصرفات من نقد العهدة",
        value: displayMoney(expCents),
        unit: "ج.م",
        delta:
          expCents > 0n
            ? `منها مصروفات اليوم: ${displayMoney(todayExpCents)} ج.م · تُسوّى عند التسليم`
            : "0 منصرفات من نقد العهدة في هذه الفترة",
        tone: expCents > 0n ? "negative" : "positive",
      },
      series: [
        {
          id: "custody-equation",
          label: "معادلة العهدة",
          points: [
            {
              label: "رصيد العهدة الدفتري",
              shortLabel: "الرصيد",
              value: Number(balCents) / 100,
              formattedValue: `${displayMoney(balCents)} ج.م`,
              detail: "الرصيد قبل مبيعات ومصروفات الفترة",
            },
            {
              label: "بعد مقبوضات الفترة نقدًا",
              shortLabel: "+المقبوضات",
              value: Number(balCents + salesCents) / 100,
              formattedValue: `${displayMoney(balCents + salesCents)} ج.م`,
              detail: `مبيعات الفترة نقدًا: +${displayMoney(salesCents)} ج.م`,
            },
            {
              label: "المتوقَّع بيدك الآن",
              shortLabel: "المتوقَّع",
              value: Number(expectedCents) / 100,
              formattedValue: `${displayMoney(expectedCents)} ج.م`,
              detail: `بعد خصم منصرفات العهدة: −${displayMoney(expCents)} ج.م`,
            },
          ],
        },
        {
          id: "today-vs-period",
          label: "اليوم والفترة",
          points: [
            {
              label: "مبيعات اليوم نقدًا",
              shortLabel: "بيع اليوم",
              value: Number(todaySalesCents) / 100,
              formattedValue: `${displayMoney(todaySalesCents)} ج.م`,
              detail: `${opts.cash.todaySalesCount} عملية بيع نقدي اليوم`,
            },
            {
              label: "مصروفات اليوم من نقدك",
              shortLabel: "صرف اليوم",
              value: Number(todayExpCents) / 100,
              formattedValue: `${displayMoney(todayExpCents)} ج.م`,
            },
            {
              label: "إجمالي مقبوضات الفترة",
              shortLabel: "بيع الفترة",
              value: Number(salesCents) / 100,
              formattedValue: `${displayMoney(salesCents)} ج.م`,
            },
            {
              label: "إجمالي منصرفات الفترة",
              shortLabel: "صرف الفترة",
              value: Number(expCents) / 100,
              formattedValue: `${displayMoney(expCents)} ج.م`,
            },
          ],
        },
      ],
      actionHref: "/finance/mine",
      actionLabel: "فتح شاشة عهدتي والتسوية",
    };
  }

  const recentActivities: DashboardFinanceActivity[] = [];

  for (const exp of expenses.slice(0, 6)) {
    const tsStr = String(exp.paymentRecordedAt ?? exp.createdAt ?? exp.expenseDate);
    const tsDate = new Date(tsStr);
    const tsMs = Number.isNaN(tsDate.getTime()) ? Date.now() : tsDate.getTime();
    const bName = branchNames.get(String(exp.branchId)) ?? "الفرع";
    const statusLabel = EXPENSE_STATUS_AR[exp.status] ?? exp.status;
    const tone: DashboardFinanceActivity["tone"] =
      exp.status === "PAID"
        ? "positive"
        : exp.status === "APPROVED"
          ? "warning"
          : "neutral";
    recentActivities.push({
      key: `fin-exp-${exp.id}`,
      kind: "expense",
      title: `مصروف #${exp.id} — ${exp.categorySnapshot}`,
      subtitle: `${bName}${exp.beneficiary ? ` · ${exp.beneficiary}` : exp.description ? ` · ${exp.description.slice(0, 36)}` : ""}`,
      amountFormatted: `${displayMoney(toCents(exp.amount))} ج.م`,
      statusLabel,
      tone,
      timestampMs: tsMs,
      timestampIso: new Date(tsMs).toISOString(),
      href: `/finance/expenses/${exp.id}`,
    });
  }

  for (const st of settlements.slice(0, 4)) {
    const tsStr = String(st.resolvedAt ?? st.createdAt);
    const tsDate = new Date(tsStr);
    const tsMs = Number.isNaN(tsDate.getTime()) ? Date.now() : tsDate.getTime();
    const bName = branchNames.get(String(st.branchId)) ?? "الفرع";
    const statusLabel = SETTLEMENT_STATUS_AR[st.status] ?? st.status;
    const tone: DashboardFinanceActivity["tone"] =
      st.status === "CONFIRMED"
        ? "positive"
        : st.status === "OPEN"
          ? "warning"
          : "neutral";
    recentActivities.push({
      key: `fin-st-${st.id}`,
      kind: "settlement",
      title: `طلب تسوية عهدة #${st.id}`,
      subtitle: `${bName} · المعدود ${displayMoney(toCents(st.countedAmount))} ج.م`,
      amountFormatted: `${displayMoney(toCents(st.expectedAmount))} ج.م`,
      statusLabel,
      tone,
      timestampMs: tsMs,
      timestampIso: new Date(tsMs).toISOString(),
      href: canManage ? "/finance/settlements" : "/finance/mine",
    });
  }

  const paidByDayMap = new Map<string, bigint>();
  const paidByBranchIdMap = new Map<string, bigint>();
  let paidFlowTotalCents = 0n;
  for (const exp of monthExpensesChrono) {
    if (exp.status !== "PAID") continue;
    const amt = toCents(exp.amount);
    paidFlowTotalCents += amt;
    const dKey = String(exp.expenseDate).slice(0, 10);
    paidByDayMap.set(dKey, (paidByDayMap.get(dKey) ?? 0n) + amt);
    const bId = String(exp.branchId);
    paidByBranchIdMap.set(bId, (paidByBranchIdMap.get(bId) ?? 0n) + amt);
  }
  const paidExpenseFlow: DashboardPaidExpenseFlow = {
    monthPaidCentsStr: paidFlowTotalCents.toString(),
    monthPaidByDayCents: Object.fromEntries(
      Array.from(paidByDayMap.entries()).map(([k, v]) => [k, v.toString()]),
    ),
    monthPaidByBranchIdCents: Object.fromEntries(
      Array.from(paidByBranchIdMap.entries()).map(([k, v]) => [k, v.toString()]),
    ),
  };

  let financeOpsSummary: DashboardFinanceOpsSummary | null = null;
  if (canManage) {
    let recognizedCents = 0n;
    const byDayMap = new Map<string, bigint>();
    const byBranchIdMap = new Map<string, bigint>();

    for (const exp of monthExpensesChrono) {
      if (exp.status !== "PAID" && exp.status !== "APPROVED") continue;
      const amt = toCents(exp.amount);
      recognizedCents += amt;
      const dKey = String(exp.expenseDate).slice(0, 10);
      byDayMap.set(dKey, (byDayMap.get(dKey) ?? 0n) + amt);
      const bId = String(exp.branchId);
      byBranchIdMap.set(bId, (byBranchIdMap.get(bId) ?? 0n) + amt);
    }

    const filteredStaleBranchIds = activeBranchFilter
      ? staleOpenBranchIds.filter((bId) => bId === activeBranchFilter)
      : staleOpenBranchIds;
    const staleByBranchId: Record<string, number> = {};
    for (const bId of filteredStaleBranchIds) {
      staleByBranchId[bId] = (staleByBranchId[bId] ?? 0) + 1;
    }

    let varianceCount = 0;
    let varianceAbsCents = 0n;
    const varianceByBranchId: Record<string, number> = {};
    let openSettlementsCount = 0;
    for (const st of settlements) {
      if (st.status === "OPEN") openSettlementsCount += 1;
      const stDatePrefix = String(st.resolvedAt ?? st.createdAt).slice(0, 7);
      const relevant =
        st.status === "OPEN" ||
        (st.status === "CONFIRMED" && stDatePrefix === currentMonthPrefix);
      if (!relevant) continue;
      const dev = toCents(String(st.deviation ?? "0"));
      if (dev !== 0n) {
        varianceCount += 1;
        varianceAbsCents += dev < 0n ? -dev : dev;
        const bId = String(st.branchId);
        varianceByBranchId[bId] = (varianceByBranchId[bId] ?? 0) + 1;
      }
    }

    financeOpsSummary = {
      monthRecognizedExpensesCentsStr: recognizedCents.toString(),
      monthRecognizedByDayCents: Object.fromEntries(
        Array.from(byDayMap.entries()).map(([k, v]) => [k, v.toString()]),
      ),
      monthRecognizedByBranchIdCents: Object.fromEntries(
        Array.from(byBranchIdMap.entries()).map(([k, v]) => [k, v.toString()]),
      ),
      staleOpenSettlementsCount: filteredStaleBranchIds.length,
      varianceSettlementsCount: varianceCount,
      varianceTotalAbsCentsStr: varianceAbsCents.toString(),
      staleByBranchId,
      varianceByBranchId,
      pendingBacklogCount: monthPendingCount + monthApprovedCount + openSettlementsCount,
    };
  }

  return {
    cashBalance: cashBalanceSpotlight,
    monthlyExpenses: monthlyExpensesSpotlight,
    recentActivities,
    financeOpsSummary,
    paidExpenseFlow,
  };
}
