import Link from "next/link";
import DashboardWallet, { type WalletPocketItem } from "@/app/(app)/dashboard/dashboard-wallet";
import { AppIcon } from "@/components/app-icon";
import PantherSpotlightCard, {
  type PantherChartPoint,
  type PantherChartSeries,
} from "@/components/panther-spotlight-card";
import { displayMoney } from "@/lib/commerce-display";
import { listExpenses } from "@/lib/finance/engine";
import { cairoDate } from "@/lib/finance/validation";
import { prisma } from "@/lib/prisma";
import { financePage, financeRead } from "../page-context";
import { formatMoney } from "../format";
import FinanceExpensesView, { type FinanceExpenseRow } from "./finance-expenses-view";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  PENDING: "بانتظار الاعتماد",
  APPROVED: "معتمد",
  PAID: "مدفوع",
};

function moneyToCents(raw: string): bigint {
  const trimmed = raw.trim();
  const negative = trimmed.startsWith("-");
  const [whole = "0", fraction = ""] = trimmed.replace(/^-/, "").split(".");
  const cents = BigInt(whole || "0") * 100n + BigInt((fraction + "00").slice(0, 2) || "0");
  return negative ? -cents : cents;
}

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams?: Promise<{ category?: string }>;
}) {
  const { session, canManage } = await financePage();
  const resolvedParams = searchParams ? await searchParams : undefined;
  const initialCategory =
    typeof resolvedParams?.category === "string" && resolvedParams.category.trim()
      ? resolvedParams.category.trim()
      : "all";

  const [expenses, branches] = await Promise.all([
    financeRead(session, (tx) => listExpenses({ serializable: (work) => work(tx) }, session.id)),
    prisma.branch.findMany({ select: { id: true, nameAr: true } }),
  ]);
  const branchNames = new Map(branches.map((branch) => [branch.id.toString(), branch.nameAr]));

  let totalCents = 0n;
  let paidCents = 0n;
  let pendingTotalCents = 0n;
  let approvedTotalCents = 0n;
  let pendingCount = 0;
  let approvedCount = 0;
  let paidCount = 0;
  const branchSet = new Set<string>();
  const categoryTotals = new Map<string, { total: bigint; paid: bigint; count: number }>();
  const branchTotals = new Map<string, { total: bigint; paid: bigint; count: number }>();

  const rows: FinanceExpenseRow[] = expenses.map((expense) => {
    const branchName = branchNames.get(expense.branchId) ?? "الفرع";
    const cents = moneyToCents(expense.amount);
    totalCents += cents;
    if (expense.status === "PENDING") {
      pendingCount += 1;
      pendingTotalCents += cents;
    } else if (expense.status === "APPROVED") {
      approvedCount += 1;
      approvedTotalCents += cents;
    } else if (expense.status === "PAID") {
      paidCount += 1;
      paidCents += cents;
    }
    branchSet.add(branchName);

    const catStat = categoryTotals.get(expense.categorySnapshot) ?? { total: 0n, paid: 0n, count: 0 };
    catStat.total += cents;
    if (expense.status === "PAID") catStat.paid += cents;
    catStat.count += 1;
    categoryTotals.set(expense.categorySnapshot, catStat);

    const brStat = branchTotals.get(branchName) ?? { total: 0n, paid: 0n, count: 0 };
    brStat.total += cents;
    if (expense.status === "PAID") brStat.paid += cents;
    brStat.count += 1;
    branchTotals.set(branchName, brStat);

    return {
      id: expense.id,
      expenseDate: expense.expenseDate,
      branchName,
      categorySnapshot: expense.categorySnapshot,
      description: expense.description,
      amountFormatted: formatMoney(expense.amount),
      status: expense.status,
      statusLabel: STATUS_LABEL[expense.status] ?? expense.status,
    };
  });

  const walletExpenses = rows;
  const currentMonthPrefix = cairoDate().slice(0, 7);

  let monthTotalCents = 0n;
  let monthPaidCents = 0n;
  let monthApprovedCents = 0n;
  let monthPendingCents = 0n;
  let monthCount = 0;
  let monthUnpaidCount = 0;

  const monthExpensesChrono = expenses
    .filter((exp) => String(exp.expenseDate).startsWith(currentMonthPrefix))
    .slice()
    .sort((a, b) => {
      const cmp = String(a.expenseDate).localeCompare(String(b.expenseDate));
      return cmp !== 0 ? cmp : Number(a.id) - Number(b.id);
    });

  for (const exp of monthExpensesChrono) {
    const amt = moneyToCents(exp.amount);
    monthTotalCents += amt;
    monthCount += 1;
    if (exp.status === "PAID") {
      monthPaidCents += amt;
    } else if (exp.status === "APPROVED") {
      monthApprovedCents += amt;
      monthUnpaidCount += 1;
    } else {
      monthPendingCents += amt;
      monthUnpaidCount += 1;
    }
  }

  const monthPendingAndApprovedCents = monthPendingCents + monthApprovedCents;

  const expensesSeries: PantherChartSeries[] = [];
  if (monthExpensesChrono.length === 0) {
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
        },
        {
          label: "الآن — لا مصروفات هذا الشهر",
          shortLabel: "الآن",
          value: 0,
          formattedValue: "0 ج.م",
          secondaryValue: 0,
          secondaryLabel: "المدفوع",
          secondaryFormatted: "0 ج.م",
        },
      ],
    });
  } else if (monthExpensesChrono.length <= 14) {
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
    const itemPoints: PantherChartPoint[] = [];

    for (const exp of monthExpensesChrono) {
      const amt = moneyToCents(exp.amount);
      const bName = branchNames.get(exp.branchId) ?? "الفرع";
      const stLabel = STATUS_LABEL[exp.status] ?? exp.status;
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
      const amt = moneyToCents(exp.amount);
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
        secondaryLabel: "المدفوع",
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
        detail: "مصروفات معتمدة وجاهزة لتسجيل الدفع الفعلي",
      },
      {
        label: "بانتظار الاعتماد",
        shortLabel: "للاعتماد",
        value: Number(monthPendingCents) / 100,
        formattedValue: `${displayMoney(monthPendingCents)} ج.م`,
        detail: "مصروفات مسجّلة بانتظار مراجعة واعتماد الإدارة",
      },
    ],
  });

  const workflowSeries: PantherChartSeries[] = [
    {
      id: "ledger-stages",
      label: "حسب المرحلة",
      points: [
        {
          label: "مدفوع فعليًا بالسجل",
          shortLabel: "مدفوع",
          value: Number(paidCents) / 100,
          formattedValue: `${displayMoney(paidCents)} ج.م`,
          detail: `${paidCount} مصروف مكتمل الصرف الفعلي`,
        },
        {
          label: "معتمد بانتظار الصرف",
          shortLabel: "للصرف",
          value: Number(approvedTotalCents) / 100,
          formattedValue: `${displayMoney(approvedTotalCents)} ج.م`,
          detail: `${approvedCount} مصروف معتمد بانتظار تسجيل الصرف`,
        },
        {
          label: "بانتظار الاعتماد",
          shortLabel: "للاعتماد",
          value: Number(pendingTotalCents) / 100,
          formattedValue: `${displayMoney(pendingTotalCents)} ج.م`,
          detail: `${pendingCount} مصروف مسجّل بانتظار مراجعة الإدارة`,
        },
      ],
    },
  ];

  if (categoryTotals.size > 0) {
    const catPoints: PantherChartPoint[] = Array.from(categoryTotals.entries())
      .sort((a, b) => (b[1].total > a[1].total ? 1 : b[1].total < a[1].total ? -1 : 0))
      .slice(0, 6)
      .map(([catName, stat], idx) => ({
        label: catName,
        shortLabel: catName.slice(0, 9) || `بند ${idx + 1}`,
        value: Number(stat.total) / 100,
        formattedValue: `${displayMoney(stat.total)} ج.م`,
        secondaryValue: Number(stat.paid) / 100,
        secondaryLabel: "المدفوع",
        secondaryFormatted: `${displayMoney(stat.paid)} ج.م`,
        detail: `${stat.count} مصروف مسجّل في هذا البند`,
      }));
    if (catPoints.length === 1) {
      catPoints.unshift({
        label: "نقطة الأساس",
        shortLabel: "٠",
        value: 0,
        formattedValue: "0 ج.م",
      });
    }
    workflowSeries.push({
      id: "top-categories",
      label: "أعلى البنود",
      points: catPoints,
    });
  }

  if (branchTotals.size > 0) {
    const brPoints: PantherChartPoint[] = Array.from(branchTotals.entries()).map(([bName, stat], idx) => ({
      label: bName,
      shortLabel: bName.replace(/^فرع\s+/, "").slice(0, 10) || `#${idx + 1}`,
      value: Number(stat.total) / 100,
      formattedValue: `${displayMoney(stat.total)} ج.م`,
      secondaryValue: Number(stat.paid) / 100,
      secondaryLabel: "المدفوع",
      secondaryFormatted: `${displayMoney(stat.paid)} ج.م`,
      detail: `${stat.count} مصروف في ${bName}`,
    }));
    if (brPoints.length === 1) {
      brPoints.unshift({
        label: "نقطة الأساس",
        shortLabel: "٠",
        value: 0,
        formattedValue: "0 ج.م",
      });
    }
    workflowSeries.push({
      id: "by-branch",
      label: "حسب الفرع",
      points: brPoints,
    });
  }

  const unpaidLedgerCents = pendingTotalCents + approvedTotalCents;
  const unpaidLedgerCount = pendingCount + approvedCount;

  const pocketItems: WalletPocketItem[] = [
    {
      key: "total-expenses",
      label: "إجمالي المصروفات",
      value: `${displayMoney(totalCents)} ج.م`,
      kind: "money",
    },
    {
      key: "paid-expenses",
      label: "المدفوع فعليًا",
      value: `${displayMoney(paidCents)} ج.م`,
      kind: "money",
    },
    ...(pendingCount > 0
      ? [
          {
            key: "pending-approval",
            label: "للاعتماد",
            value: String(pendingCount),
            kind: "count" as const,
          },
        ]
      : []),
    ...(approvedCount > 0
      ? [
          {
            key: "pending-pay",
            label: "للصرف",
            value: String(approvedCount),
            kind: "count" as const,
          },
        ]
      : []),
  ];

  return (
    <div className="fin-page">
      <Link href={canManage ? "/finance" : "/finance/mine"} className="fin-back">
        <AppIcon name="arrow" />
        <span>{canManage ? "العودة إلى المالية" : "العودة إلى عهدتي"}</span>
      </Link>

      <div className="fin-heading">
        <div>
          <p className="fin-heading__eyebrow">
            <span className="fin-eyebrow-dot" aria-hidden="true" />
            المصروفات والاعتمادات
          </p>
          <h1>{canManage ? "سجل المصروفات" : "مصروفاتي"}</h1>
          <p>
            {canManage
              ? "التسجيل والاعتماد والصرف الفعلي ثلاث خطوات منفصلة. الاعتماد الذاتي جائز مع حفظ المُدخل والمعتمد."
              : "هذه المصروفات التي سجلتها أنت فقط مع حالتها أمام الإدارة. الاعتماد والصرف للمدير والمحاسب."}
          </p>
        </div>
        <div className="fin-actions">
          <Link className="fin-button" href="/finance/expenses/new">
            <span className="fin-button__plus" aria-hidden="true">+</span>
            <span>تسجيل مصروف</span>
          </Link>
        </div>
      </div>

      <div className="dashboard-cards-grid" aria-label="حافظة المصروفات ومؤشرات الصرف والاعتماد">
        {walletExpenses.length > 0 ? (
          <div className="dashboard-cards-grid__wallet">
            <DashboardWallet
              balanceValue={`${displayMoney(totalCents)} ج.م`}
              balanceLabel="إجمالي المصروفات"
              pocketItems={pocketItems}
              hint="اسحب البطاقات أفقيًا لتقليب أحدث المصروفات، ومرّر على الجيب لإظهار الإجماليات"
            >
              {walletExpenses.map((expense) => (
                <article key={expense.id} className="stat-card">
                  <div className="stat-card__head">
                    <h3>{expense.description}</h3>
                    <p>
                      {expense.branchName} · <bdi dir="ltr">{expense.expenseDate}</bdi> · بند {expense.categorySnapshot}
                    </p>
                    <span className="stat-card__badge">{expense.statusLabel}</span>
                  </div>

                  <div className="stat-card__body">
                    <div className="fin-wallet-pills">
                      <span className="fin-wallet-pill">{expense.categorySnapshot}</span>
                      <span className="fin-wallet-pill">{expense.branchName}</span>
                    </div>

                    <div className="stat-grid">
                      <div className="stat-grid__item">
                        <span className="stat-grid__label">المبلغ الفعال</span>
                        <strong className="stat-grid__value">
                          <bdi dir="ltr">{expense.amountFormatted}</bdi> <small>ج.م</small>
                        </strong>
                      </div>

                      <div className="stat-grid__item">
                        <span className="stat-grid__label">الحالة الحالية</span>
                        <strong className="stat-grid__value">
                          <small>{expense.statusLabel}</small>
                        </strong>
                      </div>

                      {canManage ? (
                        <Link
                          href={`/finance/expenses/${expense.id}`}
                          className="stat-grid__item is-link fin-wallet-action-link"
                        >
                          <span className="stat-grid__label">
                            مراجعة بيانات المصروف أو الاعتماد وتسجيل الصرف الفعلي
                          </span>
                          <strong className="stat-grid__value">فتح تفاصيل المصروف</strong>
                          <AppIcon name="arrow" className="stat-grid__arrow" />
                        </Link>
                      ) : (
                        <Link
                          href="/finance/expenses/new"
                          className="stat-grid__item is-link fin-wallet-action-link"
                        >
                          <span className="stat-grid__label">إضافة بند مصروف جديد بانتظار الاعتماد</span>
                          <strong className="stat-grid__value">تسجيل مصروف جديد</strong>
                          <AppIcon name="arrow" className="stat-grid__arrow" />
                        </Link>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </DashboardWallet>
          </div>
        ) : null}

        <div className="dashboard-cards-grid__item">
          <PantherSpotlightCard
            layout="wallet"
            icon="expenseReceipt"
            chartVariant="area"
            title="مصروفات الشهر وحالة الصرف"
            subtitle={`محدّث الآن · شهر ${currentMonthPrefix}`}
            pill={`${monthCount} مصروف هذا الشهر`}
            primary={{
              label: "مصروفات الشهر الحالي",
              value: displayMoney(monthTotalCents),
              unit: "ج.م",
              delta: `مدفوع منها فعليًا: ${displayMoney(monthPaidCents)} ج.م`,
              tone: "positive",
            }}
            secondary={{
              label: "معلّق للاعتماد أو الصرف",
              value: displayMoney(monthPendingAndApprovedCents),
              unit: "ج.م",
              delta:
                monthUnpaidCount > 0
                  ? `${monthUnpaidCount} مصروف بانتظار إجراء في الشهر الحالي`
                  : "0 معلقات · جميع مصروفات الشهر مسدّدة",
              tone: monthUnpaidCount > 0 ? "negative" : "positive",
            }}
            series={expensesSeries}
            actionHref="/finance/expenses/new"
            actionLabel="تسجيل بند مصروف جديد"
          />
        </div>

        <div className="dashboard-cards-grid__item">
          <PantherSpotlightCard
            layout="wallet"
            icon="approvalFlow"
            chartVariant="donut"
            title="مراحل الاعتماد وبنود الصرف"
            subtitle={
              canManage
                ? "محدّث الآن · توزيع سجل المصروفات حسب المرحلة والبند والفرع"
                : "محدّث الآن · مصروفاتك المسجّلة وحالة اعتمادها وصرفها"
            }
            pill={`${rows.length} مصروف بالسجل`}
            primary={{
              label: "المدفوع فعليًا بالسجل",
              value: displayMoney(paidCents),
              unit: "ج.م",
              delta: `${paidCount} مصروف مكتمل الصرف من أصل ${rows.length}`,
              tone: "positive",
            }}
            secondary={{
              label: "بانتظار اعتماد أو صرف",
              value: displayMoney(unpaidLedgerCents),
              unit: "ج.م",
              delta:
                unpaidLedgerCount > 0
                  ? `${pendingCount} بانتظار الاعتماد · ${approvedCount} معتمد بانتظار الصرف`
                  : "0 معلقات · كافة مصروفات السجل مسدّدة",
              tone: unpaidLedgerCount > 0 ? "negative" : "positive",
            }}
            series={workflowSeries}
            actionHref={rows.length > 0 ? "#expenses-directory" : "/finance/expenses/new"}
            actionLabel={rows.length > 0 ? "مراجعة جدول المصروفات" : "تسجيل مصروف جديد"}
          />
        </div>
      </div>

      <section className="fin-kpi-strip" aria-label="ملخص المصروفات">
        <article className="fin-kpi-card is-accent">
          <span className="fin-kpi-card__icon" aria-hidden="true">
            <AppIcon name="expenses" />
          </span>
          <div className="fin-kpi-card__body">
            <span className="fin-kpi-card__label">إجمالي المصروفات</span>
            <strong className="fin-kpi-card__value">
              <bdi dir="ltr">{displayMoney(totalCents)}</bdi> <small>ج.م</small>
            </strong>
            <small className="fin-kpi-card__sub">{rows.length} مصروف في السجل</small>
          </div>
        </article>

        <article className={`fin-kpi-card${pendingCount > 0 ? " is-alert" : ""}`}>
          <span className="fin-kpi-card__icon" aria-hidden="true">
            <AppIcon name="receipt" />
          </span>
          <div className="fin-kpi-card__body">
            <span className="fin-kpi-card__label">بانتظار الاعتماد</span>
            <strong className="fin-kpi-card__value">{pendingCount}</strong>
            <small className="fin-kpi-card__sub">يعتمدها المدير أو المحاسب</small>
          </div>
        </article>

        <article className={`fin-kpi-card${approvedCount > 0 ? " is-alert" : ""}`}>
          <span className="fin-kpi-card__icon" aria-hidden="true">
            <AppIcon name="cash" />
          </span>
          <div className="fin-kpi-card__body">
            <span className="fin-kpi-card__label">معتمد بانتظار الصرف</span>
            <strong className="fin-kpi-card__value">{approvedCount}</strong>
            <small className="fin-kpi-card__sub">جاهز لتسجيل الصرف الفعلي</small>
          </div>
        </article>

        <article className="fin-kpi-card">
          <span className="fin-kpi-card__icon" aria-hidden="true">
            <AppIcon name="check" />
          </span>
          <div className="fin-kpi-card__body">
            <span className="fin-kpi-card__label">مدفوع فعليًا</span>
            <strong className="fin-kpi-card__value">
              <bdi dir="ltr">{displayMoney(paidCents)}</bdi> <small>ج.م</small>
            </strong>
            <small className="fin-kpi-card__sub">عدد المصروفات المدفوعة: {paidCount}</small>
          </div>
        </article>
      </section>

      {rows.length === 0 ? (
        <div className="fin-panel fin-empty fin-empty-state">
          <span className="fin-empty-state__icon" aria-hidden="true">
            <AppIcon name="expenses" />
          </span>
          <h2>لا توجد مصروفات مسجلة بعد</h2>
          <p>ابدأ بتسجيل أول مصروف ليظهر هنا مع حالة الاعتماد والصرف الفعلي.</p>
          <Link className="fin-button" href="/finance/expenses/new">
            <span className="fin-button__plus" aria-hidden="true">+</span>
            <span>تسجيل مصروف</span>
          </Link>
        </div>
      ) : (
        <>
          <div id="expenses-directory" className="fin-directory-heading">
            <h2>سجل المصروفات الكامل</h2>
            <span>بحث فوري بالوصف أو البند وتصفية بحالة الاعتماد والصرف والفرع</span>
          </div>
          <FinanceExpensesView
            rows={rows}
            branches={Array.from(branchSet)}
            canManage={canManage}
            initialCategory={initialCategory}
          />
        </>
      )}
    </div>
  );
}
