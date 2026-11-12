import Link from "next/link";
import { redirect } from "next/navigation";
import DashboardWallet, { type WalletPocketItem } from "@/app/(app)/dashboard/dashboard-wallet";
import { AppIcon } from "@/components/app-icon";
import DataTable from "@/components/data-driven/data-table";
import PantherSpotlightCard from "@/components/panther-spotlight-card";
import { branchScope, requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  isPeriod,
  loadExecutiveSalesAnalytics,
  loadSalesChartSeries,
  type Period,
} from "@/lib/sales-stats";
import {
  SalesStatsActionToolbar,
  SalesStatsTopItemsPanel,
} from "./sales-stats-interactive";
import { getAccessContext, requirePageAccess } from "@/lib/access-control-server";
import {
  salesStatsBranchColumns,
  salesStatsCategoryColumns,
  salesStatsStaffColumns,
} from "./sales-stats-tables-metadata";

export const dynamic = "force-dynamic";

const nf = new Intl.NumberFormat("ar-EG-u-nu-latn", { maximumFractionDigits: 2 });
const dateTimeFormatter = new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Cairo",
});

const PERIODS: Array<{ value: Period; label: string }> = [
  { value: "today", label: "اليوم" },
  { value: "7", label: "آخر ٧ أيام" },
  { value: "month", label: "هذا الشهر" },
  { value: "all", label: "كل الفترة" },
];

function buildStatsHref(period: Period, branchId: string | null): string {
  const sp = new URLSearchParams();
  sp.set("period", period);
  if (branchId) sp.set("branch", branchId);
  return `/sales/stats?${sp.toString()}`;
}

export default async function SalesStatsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; branch?: string }>;
}) {
  await requirePageAccess("/sales/stats");

  const session = await requireSession();
  // الإحصاء ملخّص مالي وتجاري للإدارة؛ موظف الكاونتر يرى مبيعاته في اللوحة.
  if (session.role !== "MANAGER") redirect("/sales");

  const showProfitability = (await getAccessContext()).isAllowed("/sales/stats#profitability");
  const params = await searchParams;
  const period: Period = isPeriod(params.period) ? params.period : "month";
  const scope = branchScope(session);

  const availableBranches = await prisma.branch.findMany({
    where: {
      isActive: true,
      ...(scope.branchId ? { id: BigInt(scope.branchId) } : {}),
    },
    select: { id: true, nameAr: true, code: true },
    orderBy: { code: "asc" },
  });

  const requestedBranch =
    !scope.branchId &&
    params.branch &&
    /^[1-9]\d{0,17}$/.test(params.branch) &&
    availableBranches.some((b) => b.id.toString() === params.branch)
      ? params.branch
      : null;

  const effectiveBranchId = scope.branchId ?? requestedBranch;
  const selectedBranchObj = effectiveBranchId
    ? availableBranches.find((b) => b.id.toString() === effectiveBranchId) ?? null
    : null;
  const branchScopeLabel = selectedBranchObj ? selectedBranchObj.nameAr : "كل الفروع النشطة";
  const periodLabel = PERIODS.find((p) => p.value === period)?.label ?? "هذا الشهر";

  const [exec, salesSeries] = await Promise.all([
    loadExecutiveSalesAnalytics(prisma, effectiveBranchId, period),
    loadSalesChartSeries(prisma, effectiveBranchId, period),
  ]);

  const comp = exec.comparison;
  const growthText = comp
    ? comp.growthPct !== null
      ? `${comp.growthPct >= 0 ? "↑ +" : "↓ "}${nf.format(comp.growthPct)}% ${comp.label} (${comp.prevNetSalesFormatted} ج.م)`
      : comp.direction === "up"
        ? `نمو إيجابي ${comp.label} (لا مبيعات في الفترة السابقة)`
        : `مستقر ${comp.label}`
    : null;

  const primaryDelta =
    exec.invoiceCount > 0
      ? growthText
        ? `${growthText} · متوسط الفاتورة ${exec.averageInvoiceFormatted} ج.م`
        : `متوسط الفاتورة ${exec.averageInvoiceFormatted} ج.م · خصومات ${exec.discountFormatted} ج.م`
      : growthText
        ? `لا مبيعات في هذه الفترة · ${comp?.label}: ${comp?.prevNetSalesFormatted} ج.م`
        : "لا توجد مبيعات مسجلة في هذه الفترة";

  const pocketItems: WalletPocketItem[] = [
    {
      key: "net-sales",
      label: "صافي المبيعات",
      value: `${exec.netSalesFormatted} ج.م`,
      kind: "money",
    },
    {
      key: "net-collected",
      label: "صافي المحصّل",
      value: `${exec.netCollectedFormatted} ج.م`,
      kind: "money",
    },
    ...(showProfitability ? [{
      key: "stock-profit",
      label: "ربح المخزوني",
      value: `${exec.stockProfitFormatted} ج.م`,
      kind: "money" as const,
    }] : []),
    {
      key: "invoices-count",
      label: "فواتير نشطة",
      value: nf.format(exec.invoiceCount),
      kind: "count",
    },
  ];

  // Explicit allowlist: no cost/profit data is serialized to client components when denied.
  const topItems = showProfitability ? exec.topItems : exec.topItems.map((item) => ({
    key: item.key, name: item.name, category: item.category, isStock: item.isStock,
    quantityFormatted: item.quantityFormatted, quantityNum: item.quantityNum, lines: item.lines,
    revenueFormatted: item.revenueFormatted, revenueNum: item.revenueNum, sharePct: item.sharePct,
  }));
  const generatedAt = dateTimeFormatter.format(new Date());

  const categoryBreakdown = (() => {
    const map = new Map<
      string,
      { category: string; lines: number; qty: number; revenue: number }
    >();
    let totalRev = 0;
    for (const item of exec.topItems) {
      const cat = item.category || "أصناف متنوعة";
      const cur = map.get(cat) ?? { category: cat, lines: 0, qty: 0, revenue: 0 };
      cur.lines += item.lines;
      cur.qty += item.quantityNum;
      cur.revenue += item.revenueNum;
      totalRev += item.revenueNum;
      map.set(cat, cur);
    }
    return Array.from(map.values())
      .sort((a, b) => b.revenue - a.revenue)
      .map((row) => ({
        ...row,
        sharePct: totalRev > 0 ? Math.round((row.revenue / totalRev) * 1000) / 10 : 0,
      }));
  })();

  return (
    <div className="inv-page sale-print sales-stats-page">
      <div className="inv-heading">
        <div>
          <p className="inv-heading__eyebrow">
            <span className="sales-eyebrow-dot" aria-hidden="true" />
            مركز تحليلات المبيعات · {branchScopeLabel}
          </p>
          <h1>إحصائيات المبيعات{showProfitability ? " والربحية" : ""}</h1>
          <p>
            تحليل صافي المبيعات والتحصيلات{showProfitability ? " وهوامش الربح" : ""} ومقارنة أداء الفروع والموظفين ({periodLabel}).
          </p>
        </div>
        <div className="inv-actions sales-stats-head-actions">
          <SalesStatsActionToolbar
            fileSlug={`${period}-${selectedBranchObj?.code ?? "all"}`}
            exportPayload={{
              periodLabel,
              branchLabel: branchScopeLabel,
              generatedAt,
              invoiceCount: exec.invoiceCount,
              cancelledCount: exec.cancelledCount,
              subtotalFormatted: exec.subtotalFormatted,
              discountFormatted: exec.discountFormatted,
              returnedFormatted: exec.returnedFormatted,
              netSalesFormatted: exec.netSalesFormatted,
              netCollectedFormatted: exec.netCollectedFormatted,
              collectionRatePct: exec.collectionRatePct,
              outstandingFormatted: exec.outstandingFormatted,
              ...(showProfitability ? { profitability: { stockProfitFormatted: exec.stockProfitFormatted, stockMarginPct: exec.stockMarginPct } } : {}),
              catalogRevenueFormatted: exec.catalogRevenueFormatted,
              paymentMethods: exec.paymentMethods,
              branchPerformance: exec.branchPerformance,
              staffPerformance: exec.staffPerformance,
              topItems,
            }}
          />
          <Link className="inv-button inv-button--secondary no-print" href="/sales">
            ← الفواتير
          </Link>
        </div>
      </div>

      {/* شريط الفلاتر الزمني والفرعي */}
      <div className="sales-stats-filters no-print">
        <div className="sales-period-bar" role="navigation" aria-label="الفترة الزمنية">
          <span className="sales-filter-group-label">الفترة:</span>
          {PERIODS.map((item) => (
            <Link
              key={item.value}
              className={`sales-period-pill${item.value === period ? " is-active" : ""}`}
              href={buildStatsHref(item.value, requestedBranch)}
            >
              {item.label}
            </Link>
          ))}
        </div>

        {!scope.branchId && availableBranches.length > 1 ? (
          <div className="sales-period-bar" role="navigation" aria-label="تصفية حسب الفرع">
            <span className="sales-filter-group-label">الفرع:</span>
            <Link
              className={`sales-period-pill${requestedBranch === null ? " is-active" : ""}`}
              href={buildStatsHref(period, null)}
            >
              كل الفروع ({availableBranches.length})
            </Link>
            {availableBranches.map((b) => {
              const idStr = b.id.toString();
              return (
                <Link
                  key={idStr}
                  className={`sales-period-pill${requestedBranch === idStr ? " is-active" : ""}`}
                  href={buildStatsHref(period, idStr)}
                >
                  {b.nameAr}
                </Link>
              );
            })}
          </div>
        ) : null}
      </div>

      {/* الشبكة المتجاوبة الموحّدة: الحافظة + المؤشرات التفاعلية الثلاثة */}
      <div
        className="dashboard-cards-grid no-print"
        aria-label="حافظة إحصائيات المبيعات والمؤشرات التحليلية"
      >
        <div className="dashboard-cards-grid__wallet">
          <DashboardWallet
            balanceValue={`${exec.netSalesFormatted} ج.م`}
            balanceLabel={`صافي مبيعات — ${periodLabel}`}
            pocketItems={pocketItems}
            hint="اسحب شرائح الإحصاء أفقيًا، ومرّر على الجيب لإظهار صافي المبيعات"
          >
            {/* الشريحة ١: معادلة المبيعات والضريبة والمقارنة */}
            <article className="stat-card is-sales" aria-labelledby="stats-eq-title">
              <div className="stat-card__head">
                <h3 id="stats-eq-title">معادلة مبيعات الفترة</h3>
                <p>الإجمالي ناقص الخصم والمرتجعات؛ والضريبة متضمنة في السعر النهائي.</p>
                <span className="stat-card__badge">{nf.format(exec.invoiceCount)} فاتورة</span>
              </div>
              <div className="stat-card__body">
                <div className="stat-grid">
                  <div className="stat-grid__item">
                    <span className="stat-grid__label">إجمالي قبل الخصم</span>
                    <span className="stat-grid__value">{exec.subtotalFormatted} ج.م</span>
                  </div>
                  <div className="stat-grid__item">
                    <span className="stat-grid__label">الخصومات الممنوحة</span>
                    <span className="stat-grid__value">{exec.discountFormatted} ج.م</span>
                  </div>
                  <div className="stat-grid__item">
                    <span className="stat-grid__label">قيمة المرتجعات</span>
                    <span className="stat-grid__value">{exec.returnedFormatted} ج.م</span>
                  </div>
                  <div className="stat-grid__item">
                    <span className="stat-grid__label">متوسط الفاتورة</span>
                    <span className="stat-grid__value">{exec.averageInvoiceFormatted} ج.م</span>
                  </div>
                  <div className="stat-grid__item is-primary">
                    <span className="stat-grid__label">صافي المبيعات بعد المرتجعات</span>
                    <span className="stat-grid__value">{exec.netSalesFormatted} ج.م</span>
                  </div>
                  <div className="stat-grid__item is-note">
                    <span className="stat-grid__label">
                      منها ضريبة متضمنة في السعر (لا تُضاف فوق الإجمالي)
                    </span>
                    <span className="stat-grid__value">{exec.taxFormatted} ج.م</span>
                  </div>
                </div>
              </div>
              {growthText ? (
                <div className="dashboard-panel__footer">
                  <span>{growthText}</span>
                </div>
              ) : null}
            </article>

            {/* الشريحة ٢: طرق الدفع والتحصيل */}
            <article className="stat-card is-custody" aria-labelledby="stats-methods-title">
              <div className="stat-card__head">
                <h3 id="stats-methods-title">طرق التحصيل وحركة النقد</h3>
                <p>صافي التحصيلات بعد خصم المبالغ المردودة حسب وسيلة الدفع.</p>
                <span className="stat-card__badge">{nf.format(exec.collectionRatePct)}% تحصيل</span>
              </div>
              <div className="stat-card__body">
                <div className="stat-grid">
                  {exec.paymentMethods.map((m) => (
                    <div className="stat-grid__item" key={m.method}>
                      <span className="stat-grid__label">
                        {m.label} ({nf.format(m.sharePct)}%)
                      </span>
                      <span className="stat-grid__value">{m.netFormatted} ج.م</span>
                    </div>
                  ))}
                  <div className="stat-grid__item is-primary">
                    <span className="stat-grid__label">صافي المحصّل الفعلي</span>
                    <span className="stat-grid__value">{exec.netCollectedFormatted} ج.م</span>
                  </div>
                </div>
              </div>
              <div className="dashboard-panel__footer">
                <span>المبالغ المردودة فعليًا للعملاء: {exec.refundedFormatted} ج.م</span>
              </div>
            </article>

            {/* الشريحة ٣: الفواتير الملغاة والمرتجعة والذمم */}
            <article className="stat-card is-todo" aria-labelledby="stats-inv-title">
              <div className="stat-card__head">
                <h3 id="stats-inv-title">الفواتير والمرتجعات والذمم</h3>
                <p>متابعة الإلغاء والمرتجعات وأرصدة العملاء المتبقية.</p>
              </div>
              <div className="stat-card__body">
                <div className="stat-grid">
                  <div className="stat-grid__item">
                    <span className="stat-grid__label">فواتير ملغاة في الفترة</span>
                    <span className="stat-grid__value">{nf.format(exec.cancelledCount)}</span>
                  </div>
                  <div className="stat-grid__item">
                    <span className="stat-grid__label">فواتير شملتها مرتجعات</span>
                    <span className="stat-grid__value">{nf.format(exec.returnedInvoicesCount)}</span>
                  </div>
                  <div className="stat-grid__item">
                    <span className="stat-grid__label">فواتير عليها باقٍ</span>
                    <span className="stat-grid__value">{nf.format(exec.outstandingCount)}</span>
                  </div>
                  <div className="stat-grid__item">
                    <span className="stat-grid__label">مستحق رد للعملاء</span>
                    <span className="stat-grid__value">{exec.dueToCustomerFormatted} ج.م</span>
                  </div>
                  <div className="stat-grid__item is-primary">
                    <span className="stat-grid__label">مجموع المتبقي على العملاء</span>
                    <span className="stat-grid__value">{exec.outstandingFormatted} ج.م</span>
                  </div>
                </div>
              </div>
            </article>
          </DashboardWallet>
        </div>

        {/* المؤشر ١: ميزان مبيعات الفترة */}
        <div className="dashboard-cards-grid__item">
          <PantherSpotlightCard
            layout="wallet"
            icon="salesGrowth"
            chartVariant="area"
            title={`ميزان مبيعات — ${periodLabel}`}
            subtitle={`محدّث الآن · ${branchScopeLabel}`}
            pill={`${nf.format(exec.invoiceCount)} فاتورة`}
            primary={{
              label: "صافي المبيعات بعد المرتجعات",
              value: exec.netSalesFormatted,
              unit: "ج.م",
              delta: primaryDelta,
              tone: comp?.direction === "down" ? "negative" : "positive",
            }}
            secondary={{
              label: "الباقي على العملاء",
              value: exec.outstandingFormatted,
              unit: "ج.م",
              delta:
                exec.outstandingNum > 0
                  ? `${nf.format(exec.outstandingCount)} فاتورة عليها باقٍ بانتظار التحصيل`
                  : "0 متأخرات · فواتير الفترة مسدّدة بالكامل",
              tone: exec.outstandingNum > 0 ? "negative" : "positive",
            }}
            series={salesSeries}
            actionHref="/sales"
            actionLabel="عرض سجل الفواتير والتحصيلات"
          />
        </div>

        {/* المؤشر ٢: التحصيل وطرق الدفع */}
        <div className="dashboard-cards-grid__item">
          <PantherSpotlightCard
            layout="wallet"
            icon="customerCollection"
            chartVariant="donut"
            title={exec.collectionsSpotlight.title}
            subtitle={exec.collectionsSpotlight.subtitle}
            pill={exec.collectionsSpotlight.pill}
            primary={exec.collectionsSpotlight.primary}
            secondary={exec.collectionsSpotlight.secondary}
            series={exec.collectionsSpotlight.series}
            actionHref={exec.collectionsSpotlight.actionHref}
            actionLabel={exec.collectionsSpotlight.actionLabel}
          />
        </div>

        {/* المؤشر ٣: الربحية وأداء الأصناف */}
        {showProfitability ? <div className="dashboard-cards-grid__item">
          <PantherSpotlightCard
            layout="wallet"
            icon="netProfit"
            chartVariant="bars"
            title={exec.profitabilitySpotlight.title}
            subtitle={exec.profitabilitySpotlight.subtitle}
            pill={exec.profitabilitySpotlight.pill}
            primary={exec.profitabilitySpotlight.primary}
            secondary={exec.profitabilitySpotlight.secondary}
            series={exec.profitabilitySpotlight.series}
            actionHref={exec.profitabilitySpotlight.actionHref}
            actionLabel={exec.profitabilitySpotlight.actionLabel}
          />
        </div> : null}
      </div>

      {/* شريط المؤشرات التنفيذية السريعة (يظهر في الشاشة وفي الطباعة) */}
      <section className="sales-kpi-strip" aria-label="ملخص المؤشرات التنفيذية">
        <article className="sales-kpi-card is-accent">
          <span className="sales-kpi-card__icon" aria-hidden="true">
            <AppIcon name="sales" />
          </span>
          <div className="sales-kpi-card__body">
            <span className="sales-kpi-card__label">صافي المبيعات</span>
            <strong className="sales-kpi-card__value">
              <bdi dir="ltr">{exec.netSalesFormatted}</bdi> <small>ج.م</small>
            </strong>
            <small className="sales-kpi-card__sub">
              {comp && comp.growthPct !== null ? (
                <span
                  className={`sales-growth-badge is-${comp.direction}`}
                >
                  {comp.growthPct >= 0 ? "↑ +" : "↓ "}
                  {nf.format(comp.growthPct)}% {comp.label}
                </span>
              ) : (
                `${nf.format(exec.invoiceCount)} فاتورة نشطة · متوسط ${exec.averageInvoiceFormatted} ج.م`
              )}
            </small>
          </div>
        </article>

        <article className="sales-kpi-card">
          <span className="sales-kpi-card__icon" aria-hidden="true">
            <AppIcon name="cash" />
          </span>
          <div className="sales-kpi-card__body">
            <span className="sales-kpi-card__label">صافي المحصّل ونسبة التحصيل</span>
            <strong className="sales-kpi-card__value">
              <bdi dir="ltr">{exec.netCollectedFormatted}</bdi> <small>ج.م</small>
            </strong>
            <small className="sales-kpi-card__sub">
              نسبة التحصيل <bdi dir="ltr">{nf.format(exec.collectionRatePct)}%</bdi> · ملغى{" "}
              {nf.format(exec.cancelledCount)}
            </small>
          </div>
        </article>

        {showProfitability ? <article className="sales-kpi-card">
          <span className="sales-kpi-card__icon" aria-hidden="true">
            <AppIcon name="stockValue" />
          </span>
          <div className="sales-kpi-card__body">
            <span className="sales-kpi-card__label">ربح الأصناف المخزونية</span>
            <strong className="sales-kpi-card__value">
              <bdi dir="ltr">{exec.stockProfitFormatted}</bdi> <small>ج.م</small>
            </strong>
            <small className="sales-kpi-card__sub">
              هامش ربح المخزون <bdi dir="ltr">{nf.format(exec.stockMarginPct)}%</bdi> · كتالوج{" "}
              {exec.catalogRevenueFormatted} ج.م
            </small>
          </div>
        </article> : null}

        <article className={`sales-kpi-card${exec.outstandingNum > 0 ? " is-alert" : ""}`}>
          <span className="sales-kpi-card__icon" aria-hidden="true">
            <AppIcon name="receipt" />
          </span>
          <div className="sales-kpi-card__body">
            <span className="sales-kpi-card__label">المتبقي على العملاء</span>
            <strong className="sales-kpi-card__value">
              <bdi dir="ltr">{exec.outstandingFormatted}</bdi> <small>ج.م</small>
            </strong>
            <small className="sales-kpi-card__sub">
              {nf.format(exec.outstandingCount)} فاتورة آجلة · مرتجعات {exec.returnedFormatted} ج.م
            </small>
          </div>
        </article>
      </section>

      {/* لوحة مقارنة أداء الفروع وأداء موظفي المبيعات */}
      <section className="sales-stats-compare-grid" aria-label="مقارنة أداء الفروع والموظفين">
        <div className="inv-panel">
          <div className="inv-panel__heading">
            <h2>مقارنة أداء الفروع</h2>
            <p>ترتيب الفروع النشطة حسب صافي المبيعات ونسبة التحصيل في الفترة المختارة.</p>
          </div>
          {exec.branchPerformance.length === 0 ? (
            <div className="inv-panel__body">
              <p className="inv-field__hint">لا توجد فروع نشطة متاحة في هذا النطاق.</p>
            </div>
          ) : (
            <DataTable
              rows={exec.branchPerformance}
              columns={salesStatsBranchColumns}
              rowKey={(branch) => branch.branchId}
              regionLabel="جدول مقارنة الفروع"
              tableClassName="inv-table sales-stats-table"
            />
          )}
        </div>

        <div className="inv-panel">
          <div className="inv-panel__heading">
            <h2>أداء موظفي المبيعات</h2>
            <p>مساهمة البائعين في الفواتير النشطة ومتوسط قيمة الفاتورة ونسبة التحصيل.</p>
          </div>
          {exec.staffPerformance.length === 0 ? (
            <div className="inv-panel__body">
              <p className="inv-field__hint">لم تُسجّل فواتير نشطة بواسطة الموظفين في هذه الفترة.</p>
            </div>
          ) : (
            <DataTable
              rows={exec.staffPerformance}
              columns={salesStatsStaffColumns}
              rowKey={(staff) => staff.userId}
              regionLabel="جدول أداء الموظفين"
              tableClassName="inv-table sales-stats-table"
            />
          )}
        </div>
      </section>

      {/* تحليل الإيراد والكمية حسب التصنيف السمعي */}
      {categoryBreakdown.length > 0 ? (
        <section className="inv-panel" aria-label="تحليل المبيعات حسب التصنيف">
          <div className="inv-panel__heading">
            <h2>تحليل المبيعات حسب التصنيف</h2>
            <p>توزيع صافي إيراد الفترة والكميات المباعة عبر تصنيفات الخدمات السمعية والأصناف.</p>
          </div>
          <DataTable
            rows={categoryBreakdown}
            columns={salesStatsCategoryColumns}
            rowKey={(category) => category.category}
            regionLabel="جدول تحليل التصنيفات"
            tableClassName="inv-table sales-stats-table"
          />
        </section>
      ) : null}

      {/* لوحة أكثر الأصناف مبيعًا التفاعلية */}
      <SalesStatsTopItemsPanel items={topItems} showProfitability={showProfitability} />
    </div>
  );
}
