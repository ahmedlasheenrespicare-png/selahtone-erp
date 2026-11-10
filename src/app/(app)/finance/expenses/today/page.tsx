/* مصروفات اليوم — نسخة «خاصة باليوم» من «سجل المصروفات» (./page.tsx). نفس التصميم والمكوّنات والصلاحيات،
   كل البيانات محصورة في يوم القاهرة الحالي عبر loadTodayExpenses (expense_date = اليوم)، بلا حد بنود،
   وجميع الروابط والتفاصيل مماثلة للنسخة الكاملة لكنها لليوم فقط. */
import Link from "next/link";
import DashboardWallet, { type WalletPocketItem } from "@/app/(app)/dashboard/dashboard-wallet";
import { AppIcon } from "@/components/app-icon";
import PantherSpotlightCard, { type PantherChartPoint } from "@/components/panther-spotlight-card";
import { writeAllowedForKeys } from "@/lib/access-control";
import { getAccessContext, requirePageAccess } from "@/lib/access-control-server";
import { displayMoney } from "@/lib/commerce-display";
import { financePage } from "../../page-context";
import { loadTodayExpenses } from "@/lib/finance/today-expenses";
import { cairoDate } from "@/lib/finance/validation";
import FinanceExpensesView, { type FinanceExpenseRow } from "../finance-expenses-view";
import { FinEmptyState } from "@/components/finance/fin-empty-state";
import { FinKpiStrip } from "@/components/finance/fin-kpi-strip";

export const dynamic = "force-dynamic";

const todayFormatter = new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Africa/Cairo",
});
const nf = new Intl.NumberFormat("ar-EG-u-nu-latn", { maximumFractionDigits: 2 });

const STATUS_CHIP_TONE: Record<"PENDING" | "APPROVED" | "PAID", "pending" | "approved" | "paid"> = {
  PENDING: "pending",
  APPROVED: "approved",
  PAID: "paid",
};

export default async function FinanceExpensesTodayPage() {
  await requirePageAccess("/finance/expenses/today");
  const { session, canManage } = await financePage();
  const access = await getAccessContext();
  const canOpen = (href: string) => access.isAllowed(href.split("?")[0]);
  const canCreateExpense = writeAllowedForKeys(access.hidden, "/finance/expenses/new");
  const canOpenExpenseDetails = canManage && canOpen("/finance/expenses");
  const todayIso = cairoDate();

  const today = await loadTodayExpenses(session).catch((error) => {
    console.error("expenses today: load failed", error);
    return null;
  });

  const items = today?.rows ?? [];
  const branchesInTable = Array.from(
    new Map(items.map((row) => [row.branchId, { id: row.branchId, label: `${row.branchName} · ${row.branchCode}` }])).values(),
  ).sort((a, b) => a.label.localeCompare(b.label, "ar"));
  const totalCents = today?.totalCents ?? 0n;
  const paidCents = today?.paidCents ?? 0n;
  const waitingCents = today?.waitingCents ?? 0n;
  const count = today?.count ?? 0;
  const paidCount = today?.paidCount ?? 0;
  const pendingCount = today?.pendingCount ?? 0;
  const approvedCount = today?.approvedCount ?? 0;
  const totalFormatted = today?.totalFormatted ?? "0.00";
  const paidFormatted = today?.paidFormatted ?? "0.00";
  const waitingFormatted = today?.waitingFormatted ?? "0.00";
  const todayLabel = todayFormatter.format(new Date());

  const rows: FinanceExpenseRow[] = items.map((row) => ({
    id: row.id,
    expenseDate: todayIso, // بنود اليوم كلها بهذا التاريخ (expense_date = يوم القاهرة)
    branchId: row.branchId,
    branchName: `${row.branchName} · ${row.branchCode}`,
    categorySnapshot: row.categorySnapshot,
    description: row.description,
    amountFormatted: row.amountFormatted,
    status: row.status,
    statusLabel: row.statusLabel,
  }));

  const pocketItems: WalletPocketItem[] = [
    {
      key: "total-today",
      label: "إجمالي مصروفات اليوم",
      value: `${totalFormatted} ج.م`,
      kind: "money",
    },
    {
      key: "paid-today",
      label: "المدفوع فعليًا اليوم",
      value: `${paidFormatted} ج.م`,
      kind: "money",
    },
    {
      key: "waiting-today",
      label: "بانتظار التنفيذ",
      value: `${waitingFormatted} ج.م`,
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
    {
      key: "today-count",
      label: "بنود اليوم",
      value: String(count),
      kind: "count",
    },
  ];

  const todayExpensesChartPoints: PantherChartPoint[] = (() => {
    if (items.length === 0) return [];
    const sumByStatus: Record<"PAID" | "APPROVED" | "PENDING", bigint> = {
      PAID: 0n,
      APPROVED: 0n,
      PENDING: 0n,
    };
    const countByStatus: Record<"PAID" | "APPROVED" | "PENDING", number> = {
      PAID: 0,
      APPROVED: 0,
      PENDING: 0,
    };
    for (const row of items) {
      sumByStatus[row.status] += row.amount;
      countByStatus[row.status] += 1;
    }
    const meta = [
      { status: "PAID" as const, label: "مدفوع", tone: "accent" as const },
      { status: "APPROVED" as const, label: "معتمد", tone: "alt" as const },
      { status: "PENDING" as const, label: "بانتظار الاعتماد", tone: "warn" as const },
    ];
    return meta
      .filter(({ status }) => sumByStatus[status] > 0n)
      .map(({ status, label, tone }) => ({
        label,
        shortLabel: label,
        tone,
        value: Number(sumByStatus[status]) / 100,
        formattedValue: `${displayMoney(sumByStatus[status])} ج.م`,
        detail: `${nf.format(countByStatus[status])} ${
          countByStatus[status] === 1 ? "بند" : "بنود"
        } من بنود اليوم`,
        pinKey: status,
      }));
  })();

  return (
    <div className="fin-page">
      <div className="fin-heading">
        <div>
          <p className="fin-heading__eyebrow">
            <span className="fin-eyebrow-dot" aria-hidden="true" />
            المصروفات والاعتمادات · اليوم
          </p>
          <h1>مصروفات اليوم</h1>
          <p>
            بنود اليوم بتوقيت القاهرة ({todayLabel}) بكل حالاتها — بانتظار الاعتماد · معتمدة · مدفوعة — المبالغ بعد آخر
            تصحيح مالي معتمد، بلا حد بنود — مثل سجل المصروفات لكن لليوم فقط.
          </p>
        </div>
      </div>

      {today === null ? (
        <FinEmptyState icon="expenses" title="تعذّرت قراءة مصروفات اليوم">
          <p>حدّث الصفحة؛ إن تكرر الخلل فأبلغ مدير النظام.</p>
        </FinEmptyState>
      ) : (
        <>
          {today && (
            <div className="dashboard-cards-grid" aria-label="حافظة مصروفات اليوم ومؤشرات اليوم">
              {items.length > 0 ? (
                <div className="dashboard-cards-grid__wallet">
                  <DashboardWallet
                    balanceValue={`${totalFormatted} ج.م`}
                    balanceLabel="إجمالي مصروفات اليوم"
                    pocketItems={pocketItems}
                    hint="اسحب البطاقات أفقيًا لتقليب بنود اليوم، ومرّر على الجيب لإظهار الملخصات اليومية"
                  >
                    {items.map((expense) => {
                      const detailHref = `/finance/expenses/${expense.id}`;
                      const allowed = canManage && canOpen(detailHref);
                      const tone = STATUS_CHIP_TONE[expense.status];
                      const inner = (
                        <>
                          <span className={`dash-today-expense__chip dash-today-expense__chip--${tone}`}>
                            {expense.statusLabel}
                          </span>
                          <span className="dash-today-invoice__main">
                            <span className="dash-today-invoice__customer">{expense.categorySnapshot}</span>
                            <span className="dash-today-invoice__meta">
                              {expense.description}
                              {expense.beneficiary ? ` · ${expense.beneficiary}` : ""}
                              {` · ${expense.branchName} · ${expense.branchCode} · سجّلها ${expense.requestedByName}`}
                              {expense.status === "PAID" && expense.paymentMethodLabel
                                ? ` · صُرفت ${expense.paymentMethodLabel}`
                                : ""}
                            </span>
                          </span>
                          <span className="dash-today-invoice__amount">
                            <bdi dir="ltr">{expense.amountFormatted}</bdi> ج.م
                          </span>
                        </>
                      );
                      return (
                        <article key={expense.id} className="stat-card">
                          <div className="stat-card__head">
                            <h3>{expense.description}</h3>
                            <p>
                              {expense.branchName} · {expense.branchCode} · بند {expense.categorySnapshot}
                            </p>
                            <span className="stat-card__badge">{expense.statusLabel}</span>
                          </div>
                          <div className="stat-card__body">
                            <div className="fin-wallet-pills">
                              <span className="fin-wallet-pill">{expense.categorySnapshot}</span>
                              {expense.beneficiary ? (
                                <span className="fin-wallet-pill">{expense.beneficiary}</span>
                              ) : null}
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
                              {allowed ? (
                                <Link
                                  href={detailHref}
                                  className="stat-grid__item is-link fin-wallet-action-link"
                                >
                                  <span className="stat-grid__label">
                                    مراجعة بيانات المصروف أو الاعتماد وتسجيل الصرف الفعلي
                                  </span>
                                  <strong className="stat-grid__value">فتح تفاصيل المصروف</strong>
                                  <AppIcon name="arrow" className="stat-grid__arrow" />
                                </Link>
                              ) : canCreateExpense ? (
                                <Link
                                  href="/finance/expenses/new"
                                  className="stat-grid__item is-link fin-wallet-action-link"
                                >
                                  <span className="stat-grid__label">إضافة بند مصروف جديد بانتظار الاعتماد</span>
                                  <strong className="stat-grid__value">تسجيل مصروف جديد</strong>
                                  <AppIcon name="arrow" className="stat-grid__arrow" />
                                </Link>
                              ) : null}
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </DashboardWallet>
                </div>
              ) : (
                <section className="dashboard-cards-grid__wallet" aria-label="حافظة مصروفات اليوم — لا توجد بنود بعد">
                  <FinEmptyState icon="expenses" title="حافظة اليوم — بلا بنود بعد" style={{ margin: 0, height: "100%" }}>
                    <p>لا توجد مصروفات بتاريخ اليوم حتى الآن. تُسجّل من «تسجيل مصروف اليوم» وتظهر هنا فور حفظها — بتوقيت القاهرة.</p>
                    <ul className="fin-wallet-pills" style={{ listStyle: "none", padding: 0, display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
                      {pocketItems.map((pocket) => (
                        <li key={pocket.key} className="fin-wallet-pill">
                          {pocket.label}: <bdi dir="ltr">{pocket.value}</bdi>
                        </li>
                      ))}
                    </ul>
                    {canCreateExpense ? <Link className="fin-button" href="/finance/expenses/new">
                      <span className="fin-button__plus" aria-hidden="true">+</span>
                      <span>تسجيل مصروف اليوم</span>
                    </Link> : null}
                  </FinEmptyState>
                </section>
              )}

              <div className="dashboard-cards-grid__item">
                <PantherSpotlightCard
                  layout="wallet"
                  icon="expenseReceipt"
                  chartVariant="donut"
                  title="مصروفات اليوم"
                  subtitle="بنود اليوم بكل حالاتها (بانتظار الاعتماد · معتمدة · مدفوعة) — المبالغ بعد آخر تصحيح معتمد."
                  pill="اليوم"
                  primary={{
                    label: "إجمالي مصروفات اليوم",
                    value: totalFormatted,
                    unit: "ج.م",
                    delta:
                      count > 0
                        ? `${nf.format(count)} ${count === 1 ? "بند" : "بنود"} · ${nf.format(paidCount)} مدفوعة`
                        : "لا بنود بعد",
                    tone: "positive",
                  }}
                  secondary={{
                    label: "بانتظار التنفيذ",
                    value: waitingFormatted,
                    unit: "ج.م",
                    delta:
                      waitingCents > 0n
                        ? `${nf.format(pendingCount)} بانتظار · ${nf.format(approvedCount)} معتمدة`
                        : "كل بنود اليوم مصروفة",
                    tone: waitingCents > 0n ? "negative" : "positive",
                  }}
                  series={[
                    {
                      id: "expense-status",
                      label: "حسب الحالة",
                      chartVariant: "donut",
                      points: todayExpensesChartPoints,
                    },
                  ]}
                  actionHref={canCreateExpense ? "/finance/expenses/new" : undefined}
                  actionLabel="تسجيل مصروف اليوم"
                  dataDashPart="today-expenses"
                  detailsHudToggle
                >
                  {items.length === 0 ? (
                    <div className="dashboard-empty">
                      <AppIcon name="receipt" />
                      <strong>لا توجد مصروفات اليوم بعد</strong>
                      <p>تُسجّل من «تسجيل مصروف» وتظهر هنا فور حفظها.</p>
                    </div>
                  ) : (
                    <ul className="dash-today-invoice-list dash-today-expense-list">
                      {items.map((row) => {
                        const detailHref = `/finance/expenses/${row.id}`;
                        const allowed = canManage && canOpen(detailHref);
                        const tone = STATUS_CHIP_TONE[row.status];
                        const inner = (
                          <>
                            <span className={`dash-today-expense__chip dash-today-expense__chip--${tone}`}>
                              {row.statusLabel}
                            </span>
                            <span className="dash-today-invoice__main">
                              <span className="dash-today-invoice__customer">{row.categorySnapshot}</span>
                              <span className="dash-today-invoice__meta">
                                {row.description}
                                {row.beneficiary ? ` · ${row.beneficiary}` : ""}
                                {` · ${row.branchName} · ${row.branchCode} · سجّلها ${row.requestedByName}`}
                                {row.status === "PAID" && row.paymentMethodLabel
                                  ? ` · صُرفت ${row.paymentMethodLabel}`
                                  : ""}
                              </span>
                            </span>
                            <span className="dash-today-invoice__amount">
                              <bdi dir="ltr">{row.amountFormatted}</bdi> ج.م
                            </span>
                          </>
                        );
                        return (
                          <li key={row.id} className="dash-today-invoice dash-today-expense" data-pin-part={row.status}>
                            {allowed ? (
                              <Link href={detailHref} className="dash-today-invoice__link">
                                {inner}
                              </Link>
                            ) : (
                              <div className="dash-today-invoice__link is-static">{inner}</div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <p className="dash-today-note">
                    المبالغ بعد آخر تصحيح مالي معتمد (إن وُجد) · تُحتسب بنود اليوم بتاريخ المصروف لا بتاريخ الصرف.
                  </p>
                </PantherSpotlightCard>
              </div>
            </div>
          )}

          <FinKpiStrip
            label="ملخص مصروفات اليوم"
            items={[
              {
                icon: "expenses",
                label: "إجمالي مصروفات اليوم",
                value: (
                  <>
                    <bdi dir="ltr">{totalFormatted}</bdi> <small>ج.م</small>
                  </>
                ),
                sub: `${count} بند لليوم`,
                tone: "accent",
              },
              {
                icon: "receipt",
                label: "بانتظار الاعتماد",
                value: String(pendingCount),
                sub: "يعتمدها المدير أو المحاسب",
                tone: pendingCount > 0 ? "alert" : "default",
              },
              {
                icon: "cash",
                label: "معتمد بانتظار الصرف",
                value: String(approvedCount),
                sub: "جاهز لتسجيل الصرف الفعلي",
                tone: approvedCount > 0 ? "alert" : "default",
              },
              {
                icon: "check",
                label: "مدفوع فعليًا",
                value: (
                  <>
                    <bdi dir="ltr">{paidFormatted}</bdi> <small>ج.م</small>
                  </>
                ),
                sub: `عدد بنود المدفوع: ${paidCount}`,
              },
            ]}
          />

          {items.length === 0 ? (
            <FinEmptyState icon="expenses" title="لا توجد مصروفات اليوم بعد">
              <p>تُسجّل من «تسجيل مصروف» وتظهر هنا فور حفظها — بتوقيت القاهرة.</p>
              {canCreateExpense ? <Link className="fin-button" href="/finance/expenses/new">
                <span className="fin-button__plus" aria-hidden="true">+</span>
                <span>تسجيل مصروف</span>
              </Link> : null}
            </FinEmptyState>
          ) : (
            <>
              <div id="expenses-today-directory" className="fin-directory-heading">
                <h2>بنود اليوم</h2>
                <span>بنود اليوم فقط — بحث فوري بالوصف أو البند وتصفية بالحالة والفرع والبند</span>
                {canOpen("/finance/expenses") ? <Link href="/finance/expenses" style={{ marginInlineStart: "auto", alignSelf: "center", fontSize: "0.85rem" }}>
                  سجل المصروفات الكامل ←
                </Link> : null}
              </div>
              <FinanceExpensesView
                rows={rows}
                branches={branchesInTable}
                canManage={canOpenExpenseDetails}
                initialCategory="all"
              />
              <p className="fin-page__foot">
                يعرض كل بنود اليوم في نطاق حسابك (بلا حد) · تاريخ المصروف هو المعتمد، لا تاريخ الصرف · المبالغ بعد آخر
                تصحيح مالي معتمد (إن وُجد).
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}
