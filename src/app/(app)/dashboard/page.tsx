import Link from "next/link";
import type { ReactNode } from "react";
import { AppIcon, type AppIconName } from "@/components/app-icon";
import PantherSpotlightCard from "@/components/panther-spotlight-card";
import TodayInvoiceRail from "./today-invoice-rail";
import PrintPageButton from "@/components/print-page-button";
// عميلٌ لا خادم: فإنّ التمريرَ تفاعل، والصفحةُ نفسها تُبنى على الخادم.
import DashboardSectionSwitcher from "./dashboard-section-switcher";
import DashboardWallet, { type WalletPocketItem } from "./dashboard-wallet";
import MonthlySalesPanther from "./monthly-sales-panther";
import "./dashboard-switcher.css";
import { prisma } from "@/lib/prisma";
import { requireSession, branchScope, canSeeAllBranches } from "@/lib/auth";
import {
  loadDashboardExecutiveSuite,
  normalizeSearchQuery,
} from "@/lib/dashboard-executive";
import {
  type DashboardSectionId,
  type DashboardSectionMeta,
  isValidDashboardSectionId,
} from "@/lib/dashboard-sections";
import {
  loadDashboardOperationalData,
  type DashboardActivityItem,
} from "@/lib/dashboard-pulse";
import { inventoryEnabled } from "@/lib/feature-flags";
import { financeEnabled } from "@/lib/finance/db";
import {
  loadCashSummary,
  loadDashboardFinanceSpotlights,
  loadEmployeeCash,
} from "@/lib/finance/dashboard";
import {
  loadTodayExpenses,
  type TodayExpensesSummary,
} from "@/lib/finance/today-expenses";
import { formatInventoryDecimal, stockValueScaled } from "@/lib/inventory-math";
import { isPathAllowedForScope } from "@/lib/menu-scope";
import {
  loadCollectionsSpotlight,
  loadSalesChartSeries,
  loadSalesStats,
} from "@/lib/sales-stats";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  MANAGER: "مدير الشركة",
  ACCOUNTANT: "المحاسب",
  CS_AGENT: "موظف الكاونتر",
};

const nf = new Intl.NumberFormat("ar-EG-u-nu-latn", { maximumFractionDigits: 2 });
const monthFormatter = new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
  month: "long",
  year: "numeric",
  timeZone: "Africa/Cairo",
});
const activityTimeFormatter = new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Africa/Cairo",
});

type Metric = {
  label: string;
  value: string;
  unit?: string;
  detail: string;
  icon: AppIconName;
  tone: string;
};

type QuickActionItem = {
  key: string;
  label: string;
  href: string;
  icon: AppIconName;
  primary?: boolean;
  badge?: number;
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ branch?: string; q?: string; section?: string }>;
}) {
  const session = await requireSession();
  const scope = branchScope(session);
  const canViewAllBranches = canSeeAllBranches(session);
  const params = searchParams ? await searchParams : {};
  const rawSearchQ =
    typeof params.q === "string" ? normalizeSearchQuery(params.q) : "";
  const requestedSection =
    typeof params.section === "string" && isValidDashboardSectionId(params.section.trim())
      ? params.section.trim()
      : null;

  const allBranches = await prisma.branch.findMany({
    where: { isActive: true, ...(scope.branchId ? { id: BigInt(scope.branchId) } : {}) },
    include: {
      warehouses: true,
      _count: { select: { users: true } },
    },
    orderBy: { code: "asc" },
  });

  const requestedBranch =
    !scope.branchId &&
    canViewAllBranches &&
    params.branch &&
    /^[1-9]\d{0,17}$/.test(params.branch) &&
    allBranches.some((b) => b.id.toString() === params.branch)
      ? params.branch
      : null;

  const buildDashboardHref = (branchVal: string | null, qVal: string | null = rawSearchQ || null) => {
    const usp = new URLSearchParams();
    if (branchVal) usp.set("branch", branchVal);
    if (qVal) usp.set("q", qVal);
    if (requestedSection) usp.set("section", requestedSection);
    const qs = usp.toString();
    return qs ? `/dashboard?${qs}` : "/dashboard";
  };

  const effectiveBranchId = scope.branchId ?? requestedBranch;
  const branches = requestedBranch
    ? allBranches.filter((b) => b.id.toString() === requestedBranch)
    : allBranches;
  const selectedBranchObj = effectiveBranchId
    ? allBranches.find((b) => b.id.toString() === effectiveBranchId) ?? null
    : null;
  const activeScopeLabel = selectedBranchObj
    ? selectedBranchObj.nameAr
    : canViewAllBranches
      ? "كل الفروع النشطة"
      : session.branchName ?? "فرعك الحالي";

  const [productCount, taxCount, expenseCategories, stockLevels] = await Promise.all([
    prisma.product.count({ where: { isActive: true } }),
    prisma.taxRate.count({ where: { isActive: true } }),
    prisma.expenseCategory.count(),
    prisma.stockLevel.findMany({
      where: effectiveBranchId
        ? { warehouse: { branchId: BigInt(effectiveBranchId) } }
        : {},
      select: { qtyOnHand: true, avgCost: true },
    }),
  ]);

  const stockValue = stockLevels.reduce(
    (sum, stock) => sum + stockValueScaled(stock.qtyOnHand.toFixed(2), stock.avgCost.toFixed(4)),
    0n,
  );
  const warehouseCount = branches.reduce((count, branch) => count + branch.warehouses.length, 0);
  const now = new Date();

  const isEmployee = session.role === "CS_AGENT";
  const isAccountant = session.role === "ACCOUNTANT";
  const canManageExpenses = session.role === "MANAGER" || session.role === "ACCOUNTANT";
  const finOn = financeEnabled();
  const canOpen = (href: string) => isPathAllowedForScope(session.menuScope, href);
  const invOn = inventoryEnabled() && canOpen("/inventory");

  let cash: Awaited<ReturnType<typeof loadEmployeeCash>> = null;
  try {
    cash = isEmployee ? await loadEmployeeCash(session) : null;
  } catch (error) {
    console.error("dashboard: employee cash failed", error);
  }
  let summary: Awaited<ReturnType<typeof loadCashSummary>> = null;
  try {
    summary = isEmployee ? null : await loadCashSummary(session, effectiveBranchId);
  } catch (error) {
    console.error("dashboard: cash summary failed", error);
  }
  const currentMonthLabel = monthFormatter.format(now);

  let financeSpotlights: Awaited<ReturnType<typeof loadDashboardFinanceSpotlights>> = null;
  try {
    financeSpotlights = await loadDashboardFinanceSpotlights(session, {
      branches: branches.map((b) => ({ id: b.id.toString(), nameAr: b.nameAr })),
      monthLabel: currentMonthLabel,
      cash,
      summary,
      branchFilterId: effectiveBranchId,
    });
  } catch (error) {
    console.error("dashboard: finance spotlights failed", error);
  }

  let todayExpenses: TodayExpensesSummary | null = null;
  let todayExpensesError = false;
  if (finOn) {
    try {
      todayExpenses = await loadTodayExpenses(session);
    } catch (error) {
      console.error("dashboard: today expenses failed", error);
      todayExpensesError = true;
    }
  }

  let monthSales: Awaited<ReturnType<typeof loadSalesStats>> | null = null;
  let todaySales: Awaited<ReturnType<typeof loadSalesStats>> | null = null;
  let monthSalesSeries: Awaited<ReturnType<typeof loadSalesChartSeries>> = [];
  let collectionsSpotlight: Awaited<ReturnType<typeof loadCollectionsSpotlight>> | null = null;
  let pulseData: Awaited<ReturnType<typeof loadDashboardOperationalData>> | null = null;
  let execSuite: Awaited<ReturnType<typeof loadDashboardExecutiveSuite>> | null = null;

  try {
    [monthSales, todaySales, monthSalesSeries, collectionsSpotlight, pulseData, execSuite] =
      await Promise.all([
        loadSalesStats(prisma, effectiveBranchId, "month"),
        loadSalesStats(prisma, effectiveBranchId, "today"),
        loadSalesChartSeries(prisma, effectiveBranchId, "month"),
        loadCollectionsSpotlight(prisma, effectiveBranchId, {
          canSell: session.role === "MANAGER" || session.role === "CS_AGENT",
          context: "dashboard",
        }),
        loadDashboardOperationalData(prisma, {
          branchId: effectiveBranchId,
          branches: branches.map((b) => ({
            id: b.id.toString(),
            nameAr: b.nameAr,
            code: b.code,
            city: b.city,
            warehouseCodes: b.warehouses.map((w) => w.code),
            usersCount: b._count.users,
          })),
        }),
        loadDashboardExecutiveSuite(prisma, {
          branchId: effectiveBranchId,
          canManage: !isEmployee,
          monthLabel: currentMonthLabel,
          branches: branches.map((b) => ({ id: b.id.toString(), nameAr: b.nameAr })),
          financeOpsSummary: financeSpotlights?.financeOpsSummary ?? null,
          paidExpenseFlow: financeSpotlights?.paidExpenseFlow ?? null,
          employeeCustodyState: cash
            ? {
                settlementStale: cash.settlementStale,
                pendingActionsCount:
                  (cash.openSettlementId ? 1 : 0) +
                  cash.pendingExpenses +
                  cash.approvedUnpaid,
              }
            : null,
          searchQuery: rawSearchQ || null,
          canAccessInventorySerials: invOn && canOpen("/inventory/serials"),
          canAccessSalesStats: canOpen("/sales/stats"),
          canAccessFinance: finOn && canOpen(isEmployee ? "/finance/mine" : "/finance"),
        }),
      ]);
  } catch (error) {
    console.error("dashboard: sales & operational pulse failed", error);
  }

  const monthTotalNum = monthSales ? Number(monthSales.total) : 0;
  const monthOutstandingNum = monthSales ? Number(monthSales.outstandingTotal) : 0;
  const monthOutstandingPct =
    monthTotalNum > 0
      ? Math.min(100, Math.round((monthOutstandingNum / monthTotalNum) * 1000) / 10)
      : 0;
  const monthCollectedPct =
    monthTotalNum > 0 ? Math.max(0, Math.round((100 - monthOutstandingPct) * 10) / 10) : 0;

  const expectedBalanceValue = cash
    ? `${nf.format(Number(cash.expected))} ج.م`
    : summary
      ? `${nf.format(Number(summary.totalExpected))} ج.م`
      : "—";
  const todayNetSalesValue = pulseData
    ? `${pulseData.todayNetSalesFormatted} ج.م`
    : todaySales
      ? `${nf.format(Number(todaySales.total))} ج.م`
      : cash
        ? `${nf.format(Number(cash.todaySales))} ج.م`
        : "—";

  const unapprovedSettlements = cash
    ? cash.openSettlementId
      ? 1
      : 0
    : summary?.pendingSettlements ?? 0;
  const unapprovedExpenses = cash
    ? cash.pendingExpenses
    : summary?.pendingExpenses ?? 0;
  const approvedUnpaidExpenses = cash
    ? cash.approvedUnpaid
    : summary?.approvedUnpaid ?? 0;

  const pocketItems: WalletPocketItem[] = [
    { key: "expected", label: "المستحق للخزنة", value: expectedBalanceValue, kind: "money" },
    { key: "today-sales", label: "مبيعات اليوم", value: todayNetSalesValue, kind: "money" },
    ...(unapprovedSettlements > 0
      ? [{ key: "settlements", label: "تسويات", value: nf.format(unapprovedSettlements), kind: "count" as const }]
      : []),
    ...(unapprovedExpenses > 0
      ? [{ key: "expenses", label: "مصروفات", value: nf.format(unapprovedExpenses), kind: "count" as const }]
      : []),
  ];

  // مهام الإجراء الموحّدة لكل دور (منعًا لتكرار شرائح الانتظار داخل الحافظة)
  const unifiedActions = isEmployee
    ? (cash
        ? [
            cash.settlementStale
              ? { key: "stale", tone: "warning", icon: "cash" as AppIconName, text: "طلب تسوية معلق وقد بطل بحركة نقدية بعده — ألغِه بسبب وأعد الجرد بطلب جديد.", href: "/finance/mine" }
              : null,
            cash.openSettlementId
              ? { key: "open", tone: "info", icon: "cash" as AppIconName, text: "لديك طلب تسوية معلق بانتظار اعتماد المدير. أي حركة نقدية جديدة تُبطل المعدود.", href: "/finance/mine" }
              : null,
            cash.pendingExpenses > 0
              ? { key: "pending", tone: "info", icon: "expenses" as AppIconName, text: `${nf.format(cash.pendingExpenses)} مصروفًا بانتظار اعتماد المدير.`, href: "/finance/expenses" }
              : null,
            cash.approvedUnpaid > 0
              ? { key: "approved", tone: "warning", icon: "expenses" as AppIconName, text: `${nf.format(cash.approvedUnpaid)} مصروفًا معتمدًا بانتظار تسجيل الصرف.`, href: "/finance/expenses" }
              : null,
            cash.outstandingCount > 0
              ? { key: "outstanding", tone: "info", icon: "receipt" as AppIconName, text: `${nf.format(cash.outstandingCount)} فاتورة عليها باقٍ لدى العملاء.`, href: "/sales" }
              : null,
          ].filter((item): item is { key: string; tone: string; icon: AppIconName; text: string; href: string } => item !== null && canOpen(item.href))
        : [])
    : !summary
      ? []
      : (isAccountant
          ? [
              summary.pendingSettlements > 0 && { key: "settle", tone: "warning", icon: "cash" as AppIconName, text: `${nf.format(summary.pendingSettlements)} طلب تسوية عهدة بانتظار تأكيدك.`, href: "/finance/settlements" },
              summary.approvedUnpaid > 0 && { key: "pay", tone: "warning", icon: "expenses" as AppIconName, text: `${nf.format(summary.approvedUnpaid)} مصروفًا معتمدًا بانتظار تسجيل صرفه.`, href: "/finance/expenses" },
              summary.pendingExpenses > 0 && { key: "pending", tone: "info", icon: "expenses" as AppIconName, text: `${nf.format(summary.pendingExpenses)} مصروفًا بانتظار اعتماد المدير.`, href: "/finance/expenses" },
            ]
          : [
              summary.pendingExpenses > 0 && { key: "approve", tone: "warning", icon: "expenses" as AppIconName, text: `${nf.format(summary.pendingExpenses)} مصروفًا بانتظار اعتمادك الآن.`, href: "/finance/expenses" },
              summary.pendingSettlements > 0 && { key: "settle", tone: "warning", icon: "cash" as AppIconName, text: `${nf.format(summary.pendingSettlements)} طلب تسوية عهدة بانتظار مراجعتك.`, href: "/finance/settlements" },
              summary.approvedUnpaid > 0 && { key: "pay", tone: "info", icon: "expenses" as AppIconName, text: `${nf.format(summary.approvedUnpaid)} مصروفًا معتمدًا بانتظار الصرف.`, href: "/finance/expenses" },
            ]
        ).filter(
          (item): item is { key: string; tone: string; icon: AppIconName; text: string; href: string } =>
            typeof item !== "boolean" && canOpen(item.href),
        );

  const metrics: Metric[] = isEmployee
    ? [
        { label: "مبيعات اليوم", value: nf.format(pulseData?.todayInvoicesCount ?? cash?.todaySalesCount ?? 0), detail: "فاتورة أتممتها في فرعك اليوم", icon: "receipt", tone: "blue" },
        { label: "باقٍ على العملاء", value: nf.format(cash?.outstandingCount ?? 0), detail: "فاتورة لم تُسدَّد بالكامل", icon: "cash", tone: "amber" },
        { label: "الأصناف المتاحة", value: nf.format(productCount), detail: "في نطاق فرعك", icon: "products", tone: "violet" },
        { label: "مستودعات فرعك", value: nf.format(warehouseCount), detail: "تخدم مبيعاتك", icon: "warehouse", tone: "cyan" },
      ]
    : isAccountant
      ? [
          { label: "تسويات للتأكيد", value: nf.format(summary?.pendingSettlements ?? 0), detail: "طلبات سلّمها الموظفون", icon: "cash", tone: "amber" },
          { label: "بانتظار الصرف", value: nf.format(summary?.approvedUnpaid ?? 0), detail: "مصروفات اعتمدت ولم تُصرف", icon: "expenses", tone: "violet" },
          { label: "المتوقَّع في العهد", value: summary ? nf.format(Number(summary.totalExpected)) : "0", unit: "ج.م", detail: "ما سيُسلَّم للخزنة", icon: "stockValue", tone: "cyan" },
          { label: "العهد القائمة", value: nf.format(summary?.custodyCount ?? 0), detail: "عهدة نشطة", icon: "branch", tone: "blue" },
        ]
      : [
          { label: "الفروع النشطة", value: nf.format(branches.length), detail: selectedBranchObj ? "الفرع المصفّى" : "في نطاق حسابك", icon: "branch", tone: "blue" },
          { label: "المستودعات", value: nf.format(warehouseCount), detail: "في الفروع المعروضة", icon: "warehouse", tone: "cyan" },
          { label: "المنتجات النشطة", value: nf.format(productCount), detail: "في دليل المنتجات", icon: "products", tone: "violet" },
          { label: "قيمة المخزون", value: formatInventoryDecimal(stockValue, 6), unit: "ج.م", detail: "محسوبة بمتوسط التكلفة", icon: "stockValue", tone: "amber" },
        ];

  // أزرار الإجراءات السريعة في الترويسة حسب الدور والصلاحيات
  const candidateQuickActions: QuickActionItem[] = isEmployee
    ? [
        { key: "new-sale", label: "فاتورة بيع جديدة", href: "/sales/new", icon: "sales", primary: true },
        ...(finOn ? [{ key: "my-cash", label: "عهدتي والتسوية", href: "/finance/mine", icon: "cash" as AppIconName }] : []),
        ...(finOn ? [{ key: "new-exp", label: "تسجيل مصروف", href: "/finance/expenses/new", icon: "expenses" as AppIconName }] : []),
      ]
    : isAccountant
      ? [
          ...(finOn ? [{ key: "settlements", label: "تسويات العهد", href: "/finance/settlements", icon: "cash" as AppIconName, primary: true, badge: summary?.pendingSettlements ?? 0 }] : []),
          ...(finOn ? [{ key: "expenses", label: "صرف المصروفات", href: "/finance/expenses", icon: "expenses" as AppIconName, badge: summary?.approvedUnpaid ?? 0 }] : []),
          ...(finOn ? [{ key: "finance", label: "لوحة المالية", href: "/finance", icon: "stockValue" as AppIconName }] : []),
          { key: "sales", label: "سجل الفواتير", href: "/sales", icon: "receipt" },
        ]
      : [
          { key: "new-sale", label: "فاتورة بيع", href: "/sales/new", icon: "sales", primary: true },
          ...(finOn ? [{ key: "new-exp", label: "تسجيل مصروف", href: "/finance/expenses/new", icon: "expenses" as AppIconName }] : []),
          ...(finOn ? [{ key: "settlements", label: "تسويات العهد", href: "/finance/settlements", icon: "cash" as AppIconName, badge: summary?.pendingSettlements ?? 0 }] : []),
          { key: "stats", label: "إحصائيات المبيعات", href: effectiveBranchId ? `/sales/stats?period=month&branch=${effectiveBranchId}` : "/sales/stats?period=month", icon: "reports" },
        ];
  const quickActions = candidateQuickActions.filter((a) => canOpen(a.href.split("?")[0]));
  const primaryQuickAction = quickActions.find((action) => action.primary) ?? quickActions[0];
  const secondaryQuickActions = quickActions.filter((action) => action.key !== primaryQuickAction?.key);

  // بطاقة المهام العاجلة في شريط نبض اليوم
  const urgentTaskCount = isEmployee
    ? (cash?.openSettlementId ? 1 : 0) + (cash?.pendingExpenses ?? 0) + (cash?.approvedUnpaid ?? 0)
    : isAccountant
      ? (summary?.pendingSettlements ?? 0) + approvedUnpaidExpenses
      : unapprovedExpenses + unapprovedSettlements;

  const urgentTaskHref = unifiedActions[0]?.href ?? (finOn && canOpen("/finance/expenses") ? "/finance/expenses" : "/sales");
  const urgentTaskSub = isEmployee
    ? urgentTaskCount > 0
      ? `${cash?.pendingExpenses ?? 0} مصروف · ${cash?.openSettlementId ? "طلب تسوية مفتوح" : "متابعة العهدة"}`
      : "لا مهام معلّقة على عهدتك الآن"
    : isAccountant
      ? `${nf.format(summary?.pendingSettlements ?? 0)} تسوية للتأكيد · ${nf.format(approvedUnpaidExpenses)} مصروف للصرف`
      : `${nf.format(unapprovedExpenses)} مصروف للاعتماد · ${nf.format(unapprovedSettlements)} تسوية عهدة`;

  // دمج السجل الحيّ لآخر الحركات (مبيعات + تحصيلات + مصروفات + تسويات)
  const mergedActivities: DashboardActivityItem[] = [
    ...(pulseData?.recentCommerceEvents ?? []),
    ...(financeSpotlights?.recentActivities ?? []),
  ]
    .sort((a, b) => b.timestampMs - a.timestampMs)
    .slice(0, 8);

  // خريطة عهدة كل فرع (للإدارة والمحاسب فقط — لا تُكشف للكاونتر)
  const custodyExpectedByBranchName = new Map<string, string>();
  if (!isEmployee && summary) {
    for (const c of summary.custodies) {
      custodyExpectedByBranchName.set(c.branchName, c.expected);
    }
  }

  const lowStockTotalCount = pulseData?.lowStockTotalCount ?? 0;
  const outOfStockCount = pulseData?.outOfStockCount ?? 0;

  const dashboardScopeControl: ReactNode = canViewAllBranches && !scope.branchId && allBranches.length > 1 ? (
    <details className="dashboard-scope-menu">
      <summary aria-label={`تغيير نطاق العرض، الحالي ${activeScopeLabel}`}>
        <span className="dashboard-scope-menu__label">النطاق</span>
        <strong>{activeScopeLabel}</strong>
        <span className="dashboard-scope-menu__chevron" aria-hidden="true">⌄</span>
      </summary>
      <nav className="dashboard-scope-menu__panel" aria-label="خيارات نطاق العرض">
        <Link href={buildDashboardHref(null)} aria-current={requestedBranch === null ? "page" : undefined}>
          كل الفروع ({nf.format(allBranches.length)})
        </Link>
        {allBranches.map((branch) => {
          const idStr = branch.id.toString();
          return (
            <Link key={idStr} href={buildDashboardHref(idStr)} aria-current={requestedBranch === idStr ? "page" : undefined}>
              {branch.nameAr}
            </Link>
          );
        })}
      </nav>
    </details>
  ) : null;

  const dashboardOmniSearchForm: ReactNode = (
    <form method="get" action="/dashboard" className="dashboard-omni-form" role="search">
      {requestedBranch ? <input type="hidden" name="branch" value={requestedBranch} /> : null}
      {requestedSection ? <input type="hidden" name="section" value={requestedSection} /> : null}
      <span className="dashboard-omni-form__icon" aria-hidden="true"><AppIcon name="search" /></span>
      <input
        type="search"
        name="q"
        defaultValue={rawSearchQ}
        placeholder="بحث فوري: سيريال، هاتف أو اسم عميل، فاتورة أو كود صنف..."
        aria-label="ابحث برقم السيريال أو هاتف العميل أو رقم الفاتورة أو كود الصنف"
        className="dashboard-omni-form__input"
      />
      <div className="dashboard-omni-form__actions">
        {rawSearchQ ? <Link href={buildDashboardHref(requestedBranch, null)} className="dashboard-omni-form__clear" aria-label="مسح البحث">×</Link> : null}
        <button type="submit" className="dashboard-omni-form__submit" aria-label="تنفيذ البحث"><AppIcon name="search" /></button>
      </div>
    </form>
  );

  const dashboardHeaderContent: ReactNode = (
    <div className="dashboard-heading__intro">
      <p className="dashboard-eyebrow">
        <span /> لوحة القيادة · {activeScopeLabel}
      </p>
      <h1>أهلًا بك، {session.name}</h1>
    </div>
  );

  const dashboardHeaderTools: ReactNode = (
    <div className="dashboard-heading__tools">
      {dashboardScopeControl}
      {dashboardOmniSearchForm}
      <div className="dashboard-quick-actions" role="navigation" aria-label="إجراءات سريعة">
        {primaryQuickAction ? (
          <Link
            href={primaryQuickAction.href}
            className="dashboard-quick-btn dashboard-quick-btn--icon is-primary"
            aria-label={primaryQuickAction.label}
            title={primaryQuickAction.label}
          >
            <AppIcon name={primaryQuickAction.icon} />
            {primaryQuickAction.badge && primaryQuickAction.badge > 0 ? (
              <strong className="dashboard-quick-btn__badge">{nf.format(primaryQuickAction.badge)}</strong>
            ) : null}
          </Link>
        ) : null}
        <details className="dashboard-quick-menu">
          <summary aria-label="المزيد من الإجراءات" title="المزيد من الإجراءات">
            <span aria-hidden="true">⋯</span>
            <small>المزيد</small>
          </summary>
          <div className="dashboard-quick-menu__panel">
            {secondaryQuickActions.map((action) => (
              <Link key={action.key} href={action.href}>
                <AppIcon name={action.icon} />
                <span>{action.label}</span>
                {action.badge && action.badge > 0 ? (
                  <strong className="dashboard-quick-btn__badge">{nf.format(action.badge)}</strong>
                ) : null}
              </Link>
            ))}
            <PrintPageButton
              label="ملخص إغلاق اليوم"
              title="طباعة ملخص إغلاق اليوم وحصيلة المبيعات والسيولة"
              className="dashboard-quick-menu__print"
            />
          </div>
        </details>
      </div>
    </div>
  );

  const dashboardPrelude: ReactNode = (
    <>
      {/* ملخّص إغلاق اليوم الرسمي المخصّص للطباعة */}
      <section className="print-only-brief" aria-label="ملخص إغلاق اليوم">
        <div className="print-only-brief__head">
          <div>
            <strong>صلة تون للخدمات السمعية — ملخص إغلاق اليوم</strong>
            <small>
              النطاق: {activeScopeLabel} · أعدّه: {session.name} ({ROLE_LABEL[session.role] ?? session.role})
            </small>
          </div>
          <span>{activityTimeFormatter.format(new Date())}</span>
        </div>
        <div className="print-only-brief__grid">
          <div>
            <span>صافي مبيعات اليوم</span>
            <strong>{todaySales ? `${nf.format(Number(todaySales.total))} ج.م` : todayNetSalesValue}</strong>
          </div>
          <div>
            <span>فواتير اليوم النشطة</span>
            <strong>{todaySales ? nf.format(todaySales.invoiceCount) : "0"} فاتورة</strong>
          </div>
          <div>
            <span>المحصّل من مبيعات اليوم</span>
            <strong>
              {todaySales
                ? `${nf.format(Math.max(0, Number(todaySales.total) - Number(todaySales.outstandingTotal)))} ج.م`
                : "0 ج.م"}
            </strong>
          </div>
          <div>
            <span>الرصيد النقدي المتوقع</span>
            <strong>{expectedBalanceValue}</strong>
          </div>
          <div>
            <span>صافي مبيعات الشهر</span>
            <strong>{monthSales ? `${nf.format(Number(monthSales.total))} ج.م` : "0 ج.م"}</strong>
          </div>
          <div>
            <span>إجمالي الذمم المتبقية</span>
            <strong>{monthSales ? `${nf.format(Number(monthSales.outstandingTotal))} ج.م` : "0 ج.م"}</strong>
          </div>
        </div>
      </section>

      {/* نتائج البحث تظهر أسفل الترويسة؛ حقل البحث نفسه مدمج داخلها */}
      {execSuite?.omniSearch ? (
        <section className="dashboard-omni-section" aria-label="نتائج البحث الفوري">
          <div className="dashboard-omni-results" role="region" aria-label="نتائج البحث الفوري">
            <div className="dashboard-omni-results__head">
              <strong>
                نتائج البحث عن «{execSuite.omniSearch.query}» ({nf.format(execSuite.omniSearch.totalHits)})
              </strong>
              <Link
                href={buildDashboardHref(requestedBranch, null)}
                className="dashboard-omni-results__close"
              >
                إغلاق النتائج
              </Link>
            </div>

            {execSuite.omniSearch.totalHits === 0 ? (
              <p className="dashboard-omni-empty">
                لا توجد نتائج مطابقة لـ «{execSuite.omniSearch.query}» ضمن {activeScopeLabel}. جرّب جزءًا من رقم السيريال أو آخر أرقام الهاتف أو رقم الفاتورة.
              </p>
            ) : (
              <div className="dashboard-omni-grid">
                {execSuite.omniSearch.serials.length > 0 ? (
                  <div className="dashboard-omni-group">
                    <h3>الأرقام التسلسلية ({nf.format(execSuite.omniSearch.serials.length)})</h3>
                    <ul>
                      {execSuite.omniSearch.serials.map((ser) => {
                        const targetHref = ser.saleId
                          ? `/sales/${ser.saleId}`
                          : invOn && canOpen("/inventory/serials")
                            ? "/inventory/serials"
                            : null;
                        const body = (
                          <>
                            <div>
                              <strong dir="ltr">{ser.serialNumber}</strong>
                              <small>
                                {ser.productName} · <span dir="ltr">{ser.sku}</span> · {ser.warehouseName} ({ser.branchName})
                              </small>
                            </div>
                            <span
                              className={`dashboard-feed__badge ${
                                ser.isAvailable ? "is-positive" : "is-warning"
                              }`}
                            >
                              {ser.isAvailable
                                ? "متاح بالمستودع"
                                : `مباع — فاتورة #${ser.saleId}${ser.customerName ? ` (${ser.customerName})` : ""}`}
                            </span>
                          </>
                        );
                        return (
                          <li key={ser.serialId}>
                            {targetHref && canOpen(targetHref) ? (
                              <Link href={targetHref} className="dashboard-omni-hit">
                                {body}
                              </Link>
                            ) : (
                              <div className="dashboard-omni-hit">{body}</div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}

                {execSuite.omniSearch.sales.length > 0 ? (
                  <div className="dashboard-omni-group">
                    <h3>الفواتير والعملاء ({nf.format(execSuite.omniSearch.sales.length)})</h3>
                    <ul>
                      {execSuite.omniSearch.sales.map((sale) => (
                        <li key={sale.saleId}>
                          <Link href={`/sales/${sale.saleId}`} className="dashboard-omni-hit">
                            <div>
                              <strong>
                                فاتورة #{sale.saleId} — {sale.customerName}
                              </strong>
                              <small>
                                <span dir="ltr">{sale.customerPhone}</span> · {sale.branchName} · الصافي{" "}
                                <bdi dir="ltr">{sale.netTotalFormatted}</bdi> ج.م
                              </small>
                            </div>
                            <span className={`dashboard-feed__badge is-${sale.tone}`}>
                              {sale.statusLabel}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {execSuite.omniSearch.products.length > 0 ? (
                  <div className="dashboard-omni-group">
                    <h3>الأصناف والمخزون ({nf.format(execSuite.omniSearch.products.length)})</h3>
                    <ul>
                      {execSuite.omniSearch.products.map((prod) => {
                        const prodHref = invOn && canOpen("/inventory") ? "/inventory" : null;
                        const prodBody = (
                          <>
                            <div>
                              <strong>{prod.nameAr}</strong>
                              <small>
                                <span dir="ltr">{prod.sku}</span> · سعر البيع{" "}
                                <bdi dir="ltr">{prod.salePriceFormatted}</bdi> ج.م
                                {prod.isSerialized ? " · تسلسلي" : ""}
                              </small>
                            </div>
                            <span className="dashboard-feed__badge is-neutral">
                              متاح {prod.qtyOnHandFormatted}
                            </span>
                          </>
                        );
                        return (
                          <li key={prod.productId}>
                            {prodHref ? (
                              <Link href={prodHref} className="dashboard-omni-hit">
                                {prodBody}
                              </Link>
                            ) : (
                              <div className="dashboard-omni-hit">{prodBody}</div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </section>
      ) : null}
    </>
  );

  return (
    <div className="dashboard">
      {/* ٣–٥. قائمة أقسام لوحة القيادة المنسدلة (كل قسم ومؤشر على حدة + العرض الشامل) */}
      {(() => {
        const pulseNode: ReactNode = (
          <section className="dashboard-pulse-strip" aria-label="نبض عمليات اليوم">
        <Link href="/sales" className="dashboard-pulse-card is-accent">
          <span className="dashboard-pulse-card__icon" aria-hidden="true">
            <AppIcon name="sales" />
          </span>
          <div className="dashboard-pulse-card__body">
            <span className="dashboard-pulse-card__label">صافي مبيعات اليوم</span>
            <strong className="dashboard-pulse-card__value">
              <bdi dir="ltr">{pulseData?.todayNetSalesFormatted ?? "0.00"}</bdi> <small>ج.م</small>
            </strong>
            <small className="dashboard-pulse-card__sub">
              {pulseData && pulseData.todayGrowthPct !== null ? (
                <span className={`dashboard-pulse-delta is-${pulseData.todayGrowthDirection}`}>
                  {pulseData.todayGrowthPct >= 0 ? "↑ +" : "↓ "}
                  {nf.format(pulseData.todayGrowthPct)}% عن الأمس
                </span>
              ) : (
                `${nf.format(pulseData?.todayInvoicesCount ?? 0)} فاتورة نشطة اليوم · أمس ${pulseData?.yesterdayNetSalesFormatted ?? "0.00"} ج.م`
              )}
            </small>
          </div>
        </Link>

        <Link href="/sales" className="dashboard-pulse-card">
          <span className="dashboard-pulse-card__icon" aria-hidden="true">
            <AppIcon name="cash" />
          </span>
          <div className="dashboard-pulse-card__body">
            <span className="dashboard-pulse-card__label">تحصيلات اليوم الفعلية</span>
            <strong className="dashboard-pulse-card__value">
              <bdi dir="ltr">{pulseData?.todayNetCollectedFormatted ?? "0.00"}</bdi> <small>ج.م</small>
            </strong>
            <small className="dashboard-pulse-card__sub">
              نقدي <bdi dir="ltr">{pulseData?.todayCashCollectedFormatted ?? "0.00"}</bdi> · بطاقة/تحويل{" "}
              <bdi dir="ltr">{pulseData?.todayElectronicCollectedFormatted ?? "0.00"}</bdi>
            </small>
          </div>
        </Link>

        <Link
          href={urgentTaskHref}
          className={`dashboard-pulse-card${urgentTaskCount > 0 ? " is-alert" : ""}`}
        >
          <span className="dashboard-pulse-card__icon" aria-hidden="true">
            <AppIcon name="expenses" />
          </span>
          <div className="dashboard-pulse-card__body">
            <span className="dashboard-pulse-card__label">
              {isAccountant ? "مهام تنتظر التنفيذ" : isEmployee ? "مهام عهدتك اليوم" : "بانتظار قرارك الآن"}
            </span>
            <strong className="dashboard-pulse-card__value">
              {nf.format(urgentTaskCount)} <small>{urgentTaskCount === 1 ? "مهمة" : "مهام"}</small>
            </strong>
            <small className="dashboard-pulse-card__sub">{urgentTaskSub}</small>
          </div>
        </Link>

        {invOn && canOpen("/inventory") ? (
          <Link
            href="/inventory"
            className={`dashboard-pulse-card${lowStockTotalCount > 0 ? " is-alert" : ""}`}
          >
            <span className="dashboard-pulse-card__icon" aria-hidden="true">
              <AppIcon name="inventory" />
            </span>
            <div className="dashboard-pulse-card__body">
              <span className="dashboard-pulse-card__label">
                {isEmployee ? "مخزون فرعك والنواقص" : "قيمة المخزون والنواقص"}
              </span>
              <strong className="dashboard-pulse-card__value">
                {isEmployee ? (
                  <>
                    {nf.format(lowStockTotalCount)} <small>تنبيه نقص</small>
                  </>
                ) : (
                  <>
                    <bdi dir="ltr">{formatInventoryDecimal(stockValue, 6)}</bdi> <small>ج.م</small>
                  </>
                )}
              </strong>
              <small className="dashboard-pulse-card__sub">
                {lowStockTotalCount > 0
                  ? `${nf.format(outOfStockCount)} نافد · ${nf.format(lowStockTotalCount)} صنف يحتاج توريدًا`
                  : `${nf.format(productCount)} صنف نشط · الأرصدة آمنة`}
              </small>
            </div>
          </Link>
        ) : (
          <div className={`dashboard-pulse-card${lowStockTotalCount > 0 ? " is-alert" : ""}`}>
            <span className="dashboard-pulse-card__icon" aria-hidden="true">
              <AppIcon name={isEmployee ? "products" : "stockValue"} />
            </span>
            <div className="dashboard-pulse-card__body">
              <span className="dashboard-pulse-card__label">
                {isEmployee ? "الأصناف ومستودع فرعك" : "قيمة المخزون والأصناف"}
              </span>
              <strong className="dashboard-pulse-card__value">
                {isEmployee ? (
                  <>
                    {nf.format(productCount)} <small>صنف نشط</small>
                  </>
                ) : (
                  <>
                    <bdi dir="ltr">{formatInventoryDecimal(stockValue, 6)}</bdi> <small>ج.م</small>
                  </>
                )}
              </strong>
              <small className="dashboard-pulse-card__sub">
                {lowStockTotalCount > 0
                  ? `${nf.format(lowStockTotalCount)} رصيد مخزوني منخفض · ${nf.format(warehouseCount)} مستودع`
                  : `${nf.format(productCount)} صنف نشط عبر ${nf.format(warehouseCount)} مستودع`}
              </small>
            </div>
          </div>
        )}
      </section>
        );

        const paceNode: ReactNode = execSuite?.monthPace ? (
        <section className="dashboard-pace-strip" aria-label="وتيرة الشهر وتوقع الإغلاق">
          <div className="dashboard-pace-strip__progress">
            <div className="dashboard-pace-strip__progress-top">
              <strong>وتيرة {currentMonthLabel}</strong>
              <span>
                اليوم {nf.format(execSuite.monthPace.dayOfMonth)} من{" "}
                {nf.format(execSuite.monthPace.daysInMonth)} (
                {nf.format(execSuite.monthPace.monthProgressPct)}%)
              </span>
            </div>
            <div
              className="dashboard-pace-strip__bar"
              role="progressbar"
              aria-valuenow={execSuite.monthPace.monthProgressPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="نسبة الأيام المنقضية من الشهر"
            >
              <span style={{ width: `${execSuite.monthPace.monthProgressPct}%` }} />
            </div>
          </div>

          <div className="dashboard-pace-strip__metrics">
            <div className="dashboard-pace-metric">
              <span>متوسط البيع اليومي</span>
              <strong>
                <bdi dir="ltr">{execSuite.monthPace.dailyAverageFormatted}</bdi> <small>ج.م/يوم</small>
              </strong>
            </div>

            <div className="dashboard-pace-metric">
              <span>الإغلاق المتوقّع لنهاية الشهر</span>
              <strong>
                <bdi dir="ltr">{execSuite.monthPace.projectedCloseFormatted}</bdi> <small>ج.م</small>
              </strong>
            </div>

            <div className="dashboard-pace-metric">
              <span>مقارنة بنفس الفترة من الشهر الماضي</span>
              <div className="dashboard-pace-metric__row">
                {execSuite.monthPace.paceVsLastMonthPct !== null ? (
                  <span
                    className={`dashboard-pace-badge is-${execSuite.monthPace.paceDirection}`}
                  >
                    {execSuite.monthPace.paceVsLastMonthPct > 0
                      ? `↑ متقدّم +${nf.format(execSuite.monthPace.paceVsLastMonthPct)}%`
                      : execSuite.monthPace.paceVsLastMonthPct < 0
                        ? `↓ أقل ${nf.format(execSuite.monthPace.paceVsLastMonthPct)}%`
                        : "نفس وتيرة الشهر الماضي"}
                  </span>
                ) : (
                  <span className="dashboard-pace-badge is-flat">
                    الشهر الماضي: <bdi dir="ltr">{execSuite.monthPace.prevFullMonthFormatted}</bdi> ج.م
                  </span>
                )}
                <small>
                  مقابل <bdi dir="ltr">{execSuite.monthPace.prevSameSpanFormatted}</bdi> ج.م لنفس الأيام
                </small>
              </div>
            </div>
          </div>
        </section>
        ) : null;

        const governanceNode: ReactNode = !isEmployee && execSuite?.governance ? (
        <section
          className={`dashboard-governance${execSuite.governance.isClean ? " is-clean" : " has-alerts"}`}
          aria-label="الرقابة المالية والخصومات"
        >
          <div className="dashboard-governance__head">
            <span className="dashboard-governance__icon" aria-hidden="true">
              <AppIcon name="shield" />
            </span>
            <div>
              <strong>تنبيهات الرقابة المالية والخصومات</strong>
              {execSuite.governance.isClean ? (
                <p>
                  ضوابط التشغيل سليمة اليوم — لا إلغاءات أو مرتجعات مسجّلة اليوم، ولا تجاوزات لسقف خصم الكاونتر (
                  {execSuite.governance.staffDiscountPctLabel})، ولا فروقات جرد معلّقة.
                </p>
              ) : (
                <p>حالات رقابية تستوجب المراجعة ضمن {activeScopeLabel}:</p>
              )}
            </div>
          </div>

          {!execSuite.governance.isClean ? (
            <div className="dashboard-governance__list">
              {execSuite.governance.alerts.map((al) => {
                const allowed = canOpen(al.href);
                const content = (
                  <>
                    <div>
                      <strong>{al.title}</strong>
                      <small>{al.detail}</small>
                    </div>
                    <span className={`dashboard-feed__badge is-${al.tone === "danger" ? "danger" : "warning"}`}>
                      مراجعة
                    </span>
                  </>
                );
                return allowed ? (
                  <Link
                    key={al.key}
                    href={al.href}
                    className={`dashboard-governance__item is-${al.tone}`}
                  >
                    {content}
                  </Link>
                ) : (
                  <div key={al.key} className={`dashboard-governance__item is-${al.tone}`}>
                    {content}
                  </div>
                );
              })}
            </div>
          ) : null}
        </section>
        ) : null;

        /* شريحة «نبض اليوم» داخل الحافظة — دمج بطاقات النبض الأربع (Option B) */
        const pulseSlideNode: ReactNode = (
          <article className="stat-card is-pulse-slide" data-dash-part="pulse" aria-labelledby="pulse-slide-title">
            <div className="stat-card__head">
              <h3 id="pulse-slide-title">نبض اليوم</h3>
              <p>صافي المبيعات، التحصيلات، المهام والمخزون الآن.</p>
              <span className="stat-card__badge">اليوم</span>
            </div>
            <div className="stat-card__body">
              <div className="stat-grid pulse-slide__grid">
                <Link href="/sales" className="stat-grid__item is-link pulse-cell pulse-cell--sales">
                  <span className="stat-grid__label">
                    <span className="stat-grid__icon is-blue" aria-hidden="true">
                      <AppIcon name="sales" />
                    </span>
                    صافي مبيعات اليوم
                  </span>
                  <span className="stat-grid__value">
                    <bdi dir="ltr">{pulseData?.todayNetSalesFormatted ?? "0.00"}</bdi> <small>ج.م</small>
                  </span>
                  <span className="stat-grid__detail pulse-cell__sub">
                    {pulseData && pulseData.todayGrowthPct !== null ? (
                      <span className={`dashboard-pulse-delta is-${pulseData.todayGrowthDirection}`}>
                        {pulseData.todayGrowthPct >= 0 ? "↑ +" : "↓ "}
                        {nf.format(pulseData.todayGrowthPct)}% عن الأمس
                      </span>
                    ) : (
                      `${nf.format(pulseData?.todayInvoicesCount ?? 0)} فاتورة نشطة اليوم · أمس ${pulseData?.yesterdayNetSalesFormatted ?? "0.00"} ج.م`
                    )}
                  </span>
                </Link>

                <Link href="/sales" className="stat-grid__item is-link pulse-cell pulse-cell--collections">
                  <span className="stat-grid__label">
                    <span className="stat-grid__icon is-cyan" aria-hidden="true">
                      <AppIcon name="cash" />
                    </span>
                    تحصيلات اليوم الفعلية
                  </span>
                  <span className="stat-grid__value">
                    <bdi dir="ltr">{pulseData?.todayNetCollectedFormatted ?? "0.00"}</bdi> <small>ج.م</small>
                  </span>
                  <span className="stat-grid__detail pulse-cell__sub">
                    نقدي <bdi dir="ltr">{pulseData?.todayCashCollectedFormatted ?? "0.00"}</bdi> · بطاقة/تحويل{" "}
                    <bdi dir="ltr">{pulseData?.todayElectronicCollectedFormatted ?? "0.00"}</bdi>
                  </span>
                </Link>

                <Link
                  href={urgentTaskHref}
                  className={`stat-grid__item is-link pulse-cell pulse-cell--tasks${urgentTaskCount > 0 ? " pulse-cell--alert" : ""}`}
                >
                  <span className="stat-grid__label">
                    <span className="stat-grid__icon is-blue" aria-hidden="true">
                      <AppIcon name="expenses" />
                    </span>
                    {isAccountant ? "مهام تنتظر التنفيذ" : isEmployee ? "مهام عهدتك اليوم" : "بانتظار قرارك الآن"}
                  </span>
                  <span className="stat-grid__value">
                    {nf.format(urgentTaskCount)} <small>{urgentTaskCount === 1 ? "مهمة" : "مهام"}</small>
                  </span>
                  <span className="stat-grid__detail pulse-cell__sub">{urgentTaskSub}</span>
                </Link>

                {invOn && canOpen("/inventory") ? (
                  <Link
                    href="/inventory"
                    className={`stat-grid__item is-link pulse-cell pulse-cell--stock${lowStockTotalCount > 0 ? " pulse-cell--alert" : ""}`}
                  >
                    <span className="stat-grid__label">
                      <span className="stat-grid__icon is-cyan" aria-hidden="true">
                        <AppIcon name={isEmployee ? "products" : "stockValue"} />
                      </span>
                      {isEmployee ? "مخزون فرعك والنواقص" : "قيمة المخزون والنواقص"}
                    </span>
                    <span className="stat-grid__value">
                      {isEmployee ? (
                        <>
                          {nf.format(lowStockTotalCount)} <small>تنبيه نقص</small>
                        </>
                      ) : (
                        <>
                          <bdi dir="ltr">{formatInventoryDecimal(stockValue, 6)}</bdi> <small>ج.م</small>
                        </>
                      )}
                    </span>
                    <span className="stat-grid__detail pulse-cell__sub">
                      {lowStockTotalCount > 0
                        ? `${nf.format(outOfStockCount)} نافد · ${nf.format(lowStockTotalCount)} صنف يحتاج توريدًا`
                        : `${nf.format(productCount)} صنف نشط · الأرصدة آمنة`}
                    </span>
                  </Link>
                ) : (
                  <div className={`stat-grid__item pulse-cell pulse-cell--stock${lowStockTotalCount > 0 ? " pulse-cell--alert" : ""}`}>
                    <span className="stat-grid__label">
                      <span className="stat-grid__icon is-cyan" aria-hidden="true">
                        <AppIcon name={isEmployee ? "products" : "stockValue"} />
                      </span>
                      {isEmployee ? "الأصناف ومستودع فرعك" : "قيمة المخزون والأصناف"}
                    </span>
                    <span className="stat-grid__value">
                      {isEmployee ? (
                        <>
                          {nf.format(productCount)} <small>صنف نشط</small>
                        </>
                      ) : (
                        <>
                          <bdi dir="ltr">{formatInventoryDecimal(stockValue, 6)}</bdi> <small>ج.م</small>
                        </>
                      )}
                    </span>
                    <span className="stat-grid__detail pulse-cell__sub">
                      {lowStockTotalCount > 0
                        ? `${nf.format(lowStockTotalCount)} رصيد مخزوني منخفض · ${nf.format(warehouseCount)} مستودع`
                        : `${nf.format(productCount)} صنف نشط عبر ${nf.format(warehouseCount)} مستودع`}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </article>
        );

        /* شريحة «وتيرة الشهر» داخل الحافظة */
        const paceSlideNode: ReactNode = execSuite?.monthPace ? (
          <article className="stat-card is-pace-slide" data-dash-part="pace" aria-labelledby="pace-slide-title">
            <div className="stat-card__head">
              <h3 id="pace-slide-title">وتيرة {currentMonthLabel}</h3>
              <p>تقدّم الشهر والإغلاق المتوقّع مقارنةً بنفس الفترة الماضية.</p>
              <span className="stat-card__badge">{nf.format(execSuite.monthPace.monthProgressPct)}%</span>
            </div>
            <div className="stat-card__body">
              <div className="dashboard-pace-strip__progress pace-slide__progress">
                <div className="dashboard-pace-strip__progress-top">
                  <strong>وتيرة {currentMonthLabel}</strong>
                  <span>
                    اليوم {nf.format(execSuite.monthPace.dayOfMonth)} من{" "}
                    {nf.format(execSuite.monthPace.daysInMonth)} (
                    {nf.format(execSuite.monthPace.monthProgressPct)}%)
                  </span>
                </div>
                <div
                  className="dashboard-pace-strip__bar"
                  role="progressbar"
                  aria-valuenow={execSuite.monthPace.monthProgressPct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="نسبة الأيام المنقضية من الشهر"
                >
                  <span style={{ width: `${execSuite.monthPace.monthProgressPct}%` }} />
                </div>
              </div>
              <div className="dashboard-pace-strip__metrics pace-slide__metrics">
                <div className="dashboard-pace-metric">
                  <span>متوسط البيع اليومي</span>
                  <strong>
                    <bdi dir="ltr">{execSuite.monthPace.dailyAverageFormatted}</bdi> <small>ج.م/يوم</small>
                  </strong>
                </div>
                <div className="dashboard-pace-metric">
                  <span>الإغلاق المتوقّع لنهاية الشهر</span>
                  <strong>
                    <bdi dir="ltr">{execSuite.monthPace.projectedCloseFormatted}</bdi> <small>ج.م</small>
                  </strong>
                </div>
                <div className="dashboard-pace-metric">
                  <span>مقارنة بنفس الفترة من الشهر الماضي</span>
                  <div className="dashboard-pace-metric__row">
                    {execSuite.monthPace.paceVsLastMonthPct !== null ? (
                      <span className={`dashboard-pace-badge is-${execSuite.monthPace.paceDirection}`}>
                        {execSuite.monthPace.paceVsLastMonthPct > 0
                          ? `↑ متقدّم +${nf.format(execSuite.monthPace.paceVsLastMonthPct)}%`
                          : execSuite.monthPace.paceVsLastMonthPct < 0
                            ? `↓ أقل ${nf.format(execSuite.monthPace.paceVsLastMonthPct)}%`
                            : "نفس وتيرة الشهر الماضي"}
                      </span>
                    ) : (
                      <span className="dashboard-pace-badge is-flat">
                        الشهر الماضي: <bdi dir="ltr">{execSuite.monthPace.prevFullMonthFormatted}</bdi> ج.م
                      </span>
                    )}
                    <small>
                      مقابل <bdi dir="ltr">{execSuite.monthPace.prevSameSpanFormatted}</bdi> ج.م لنفس الأيام
                    </small>
                  </div>
                </div>
              </div>
            </div>
          </article>
        ) : null;

        /* شريحة «درع الرقابة» داخل الحافظة — بحد أقصى ٣ تنبيهات مع «عرض الكل» */
        const governanceSlideNode: ReactNode =
          !isEmployee && execSuite?.governance ? (
            <article className="stat-card is-governance-slide" data-dash-part="governance" aria-labelledby="governance-slide-title">
              <div className="stat-card__head">
                <h3 id="governance-slide-title">درع الرقابة</h3>
                <p>
                  {execSuite.governance.isClean
                    ? `الضوابط سليمة ضمن ${activeScopeLabel}`
                    : `حالات رقابية تستوجب المراجعة ضمن ${activeScopeLabel}`}
                </p>
                <span className={`stat-card__badge${execSuite.governance.isClean ? "" : " is-alert"}`}>
                  {execSuite.governance.isClean ? "سليمة" : `${nf.format(execSuite.governance.alerts.length)} تنبيه`}
                </span>
              </div>
              <div className="stat-card__body">
                <div
                  className={`dashboard-governance governance-slide__body${execSuite.governance.isClean ? " is-clean" : " has-alerts"}`}
                >
                  <div className="dashboard-governance__head">
                    <span className="dashboard-governance__icon" aria-hidden="true">
                      <AppIcon name="shield" />
                    </span>
                    <div>
                      <strong>تنبيهات الرقابة المالية والخصومات</strong>
                      {execSuite.governance.isClean ? (
                        <p>
                          ضوابط التشغيل سليمة اليوم — لا إلغاءات أو مرتجعات مسجّلة اليوم، ولا تجاوزات لسقف خصم الكاونتر (
                          {execSuite.governance.staffDiscountPctLabel})، ولا فروقات جرد معلّقة.
                        </p>
                      ) : (
                        <p>الأحدث يحتاج مراجعتك الآن:</p>
                      )}
                    </div>
                  </div>

                  {!execSuite.governance.isClean ? (
                    <div className="dashboard-governance__list">
                      {execSuite.governance.alerts.slice(0, 3).map((al) => {
                        const allowed = canOpen(al.href);
                        const content = (
                          <>
                            <div>
                              <strong>{al.title}</strong>
                              <small>{al.detail}</small>
                            </div>
                            <span className={`dashboard-feed__badge is-${al.tone === "danger" ? "danger" : "warning"}`}>
                              مراجعة
                            </span>
                          </>
                        );
                        return allowed ? (
                          <Link
                            key={al.key}
                            href={al.href}
                            className={`dashboard-governance__item is-${al.tone}`}
                          >
                            {content}
                          </Link>
                        ) : (
                          <div key={al.key} className={`dashboard-governance__item is-${al.tone}`}>
                            {content}
                          </div>
                        );
                      })}
                      {execSuite.governance.alerts.length > 3 ? (
                        <Link href="/dashboard?section=governance" className="governance-more">
                          عرض الكل ({nf.format(execSuite.governance.alerts.length)} تنبيه)
                        </Link>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </article>
          ) : null;

        const walletNode: ReactNode = (
          <DashboardWallet
            balanceValue={expectedBalanceValue}
            balanceLabel="المستحق للخزنة"
            pocketItems={pocketItems}
          >
            {/* الشريحة ١: عهدة الموظف (للكاونتر) أو المستحق للخزنة وعهد الفروع الموحّدة (للإدارة والمحاسب) */}
            {cash ? (
              <article className="stat-card is-custody" aria-labelledby="cash-title">
                <div className="stat-card__head">
                  <h3 id="cash-title">عهدة الموظف</h3>
                  <p>الرصيد، زائدًا مبيعات الفترة، ناقصًا مصروفاتها من نقدك.</p>
                </div>
                <div className="stat-card__body">
                  <div className="stat-grid">
                    <div className="stat-grid__item">
                      <span className="stat-grid__label">رصيد العهدة</span>
                      <span className="stat-grid__value">{nf.format(Number(cash.balance))} ج.م</span>
                    </div>
                    <div className="stat-grid__item">
                      <span className="stat-grid__label">مبيعات الفترة</span>
                      <span className="stat-grid__value">{nf.format(Number(cash.sales))} ج.م</span>
                    </div>
                    <div className="stat-grid__item">
                      <span className="stat-grid__label">مصروفاتها من نقدك</span>
                      <span className="stat-grid__value">{nf.format(Number(cash.expenses))} ج.م</span>
                    </div>
                    <div className="stat-grid__item is-primary">
                      <span className="stat-grid__label">المتوقَّع بيدك</span>
                      <span className="stat-grid__value">{nf.format(Number(cash.expected))} ج.م</span>
                    </div>
                    <div className="stat-grid__item">
                      <span className="stat-grid__label">مبيعات اليوم نقدًا</span>
                      <span className="stat-grid__value">{nf.format(Number(cash.todaySales))} ج.م</span>
                    </div>
                    <div className="stat-grid__item">
                      <span className="stat-grid__label">مصروفات اليوم من نقدك</span>
                      <span className="stat-grid__value">{nf.format(Number(cash.todayExpenses))} ج.م</span>
                    </div>
                    <div className="stat-grid__item is-wide">
                      <span className="stat-grid__label">باقٍ على العملاء</span>
                      <span className="stat-grid__value">
                        {nf.format(Number(cash.outstanding))} ج.م{" "}
                        <small>{nf.format(cash.outstandingCount)} فاتورة آجلة</small>
                      </span>
                    </div>
                  </div>
                </div>
                <div className="dashboard-panel__footer">
                  <span>المتوقَّع بيدك يتغيّر مع كل بيع نقدي ومع كل مصروف تصرفه من نقدك</span>
                </div>
              </article>
            ) : summary ? (
              <article className="stat-card is-custody" aria-labelledby="summary-title">
                <div className="stat-card__head">
                  <h3 id="summary-title">المستحق للخزنة وعُهَد الفروع</h3>
                  <p>المتوقَّع تسليمه فعليًا من كل عهدة نشطة عند التسوية.</p>
                  <span className="stat-card__badge">{nf.format(summary.custodyCount)} عهدة</span>
                </div>
                <div className="stat-card__body">
                  <div className="stat-grid">
                    {summary.custodies.map((custody) => (
                      <div className="stat-grid__item" key={custody.branchName}>
                        <span className="stat-grid__label">{custody.branchName}</span>
                        <span className="stat-grid__value">{nf.format(Number(custody.expected))} ج.م</span>
                      </div>
                    ))}
                    <div className="stat-grid__item">
                      <span className="stat-grid__label">متوسط العهدة</span>
                      <span className="stat-grid__value">
                        {summary.custodyCount > 0
                          ? `${nf.format(Math.round(Number(summary.totalExpected) / summary.custodyCount))} ج.م`
                          : "0 ج.م"}
                      </span>
                    </div>
                    <div className="stat-grid__item is-primary">
                      <span className="stat-grid__label">إجمالي المستحق للخزنة</span>
                      <span className="stat-grid__value">{nf.format(Number(summary.totalExpected))} ج.م</span>
                    </div>
                  </div>
                </div>
                <div className="dashboard-panel__footer">
                  <span>مجمَّع «المتوقَّع بيده» (الرصيد + مبيعات النقد − مصروفات العهدة)</span>
                </div>
              </article>
            ) : null}

            {pulseSlideNode}

            {paceSlideNode}

            {/* الشريحة ٢: شريحة موحّدة للمهام والقرارات المعلّقة (بدل شريحتين مكرّرتين) */}
            <article className="stat-card is-todo" aria-labelledby="unified-todo-title">
              <div className="stat-card__head">
                <h3 id="unified-todo-title">
                  {isEmployee ? "ما ينتظرك اليوم" : isAccountant ? "مهام الصرف والتأكيد" : "ما ينتظر قرارك"}
                </h3>
                <p>إجراءات معلّقة بروابط مباشرة للتنفيذ الفوري.</p>
                <span className="stat-card__badge">{nf.format(unifiedActions.length)} عنصر</span>
              </div>
              <div className="stat-card__body">
                <div className="stat-grid">
                  {unifiedActions.length > 0 ? (
                    unifiedActions.map((item) => (
                      <Link className="stat-grid__item is-link" key={item.key} href={item.href}>
                        <span className="stat-grid__label">
                          <span
                            className={`stat-grid__icon ${item.tone === "warning" ? "is-cyan" : "is-blue"}`}
                            aria-hidden="true"
                          >
                            <AppIcon name={item.icon} />
                          </span>
                          {item.text}
                        </span>
                        <AppIcon className="stat-grid__arrow" name="arrow" />
                      </Link>
                    ))
                  ) : (
                    <div className="stat-grid__item is-note">
                      <span className="stat-grid__label">
                        كل شيء محدّث ومعتمد — لا توجد طلبات تسوية أو مصروفات معلّقة بانتظارك الآن.
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </article>

            {governanceSlideNode}

            {/* الشريحة الأخيرة: صورة النطاق وإعدادات النظام */}
            <article className="stat-card is-overview" aria-labelledby="overview-title">
              <div className="stat-card__head">
                <h3 id="overview-title">صورة النطاق السريعة</h3>
                <p>{isEmployee ? "مبيعاتك ونطاق فرعك" : isAccountant ? "ما يتحرّك تحت يدك" : "ملخص البنية والأصول"}</p>
                <span className="stat-card__badge">{activeScopeLabel}</span>
              </div>
              <div className="stat-card__body">
                <div className="stat-grid">
                  {metrics.map((metric) => (
                    <div className={`stat-grid__item${metric.unit ? " is-primary" : ""}`} key={metric.label}>
                      <span className="stat-grid__label">
                        <span className={`stat-grid__icon is-${metric.tone}`} aria-hidden="true">
                          <AppIcon name={metric.icon} />
                        </span>
                        {metric.label}
                      </span>
                      <span className="stat-grid__value">
                        {metric.value}
                        {metric.unit ? ` ${metric.unit}` : ""}
                      </span>
                      <span className="stat-grid__detail">{metric.detail}</span>
                    </div>
                  ))}
                  {!isEmployee && !isAccountant ? (
                    <div className="stat-grid__item is-note">
                      <span className="stat-grid__label">
                        الضرائب النشطة: {nf.format(taxCount)} · بنود المصروفات: {nf.format(expenseCategories)}
                      </span>
                    </div>
                  ) : null}
                  {!isEmployee && !isAccountant && canViewAllBranches && canOpen("/setup") ? (
                    <Link className="stat-grid__link" href="/setup">
                      عرض تفاصيل الإعداد <AppIcon name="arrow" />
                    </Link>
                  ) : null}
                </div>
              </div>
            </article>
          </DashboardWallet>
        );

        const efficiencyNode: ReactNode = execSuite?.compositeEfficiencySpotlight ? (
          <PantherSpotlightCard
            layout="wallet"
            icon="efficiencyGauge"
            chartVariant="gauge"
            title={execSuite.compositeEfficiencySpotlight.title}
            subtitle={execSuite.compositeEfficiencySpotlight.subtitle}
            pill={execSuite.compositeEfficiencySpotlight.pill}
            primary={execSuite.compositeEfficiencySpotlight.primary}
            secondary={execSuite.compositeEfficiencySpotlight.secondary}
            series={execSuite.compositeEfficiencySpotlight.series}
            actionHref={
              canOpen(execSuite.compositeEfficiencySpotlight.actionHref.split("?")[0])
                ? execSuite.compositeEfficiencySpotlight.actionHref
                : "/sales"
            }
            actionLabel={
              canOpen(execSuite.compositeEfficiencySpotlight.actionHref.split("?")[0])
                ? execSuite.compositeEfficiencySpotlight.actionLabel
                : "مراجعة سجل العمليات"
            }
          />
        ) : null;

        const monthlySalesNode: ReactNode = monthSales ? (
          <MonthlySalesPanther
            monthLabel={currentMonthLabel}
            totalFormatted={nf.format(Number(monthSales.total))}
            outstandingFormatted={nf.format(Number(monthSales.outstandingTotal))}
            averageFormatted={nf.format(Number(monthSales.averageInvoice))}
            invoiceCount={nf.format(monthSales.invoiceCount)}
            outstandingCount={nf.format(monthSales.outstandingCount)}
            hasOutstanding={monthOutstandingNum > 0}
            collectedPercent={monthCollectedPct}
            outstandingPercent={monthOutstandingPct}
            hasSales={monthSales.invoiceCount > 0}
            series={monthSalesSeries}
            reportHref={
              session.role === "MANAGER"
                ? effectiveBranchId
                  ? `/sales/stats?period=month&branch=${effectiveBranchId}`
                  : "/sales/stats?period=month"
                : "/sales"
            }
            reportLabel={
              session.role === "MANAGER"
                ? "عرض التقرير الكامل لمبيعات الشهر"
                : "عرض سجل فواتير الشهر"
            }
          />
        ) : null;

        const collectionsNode: ReactNode = collectionsSpotlight ? (
          <PantherSpotlightCard
            layout="wallet"
            icon="customerCollection"
            chartVariant="donut"
            title={collectionsSpotlight.title}
            subtitle={collectionsSpotlight.subtitle}
            pill={collectionsSpotlight.pill}
            primary={collectionsSpotlight.primary}
            secondary={collectionsSpotlight.secondary}
            series={collectionsSpotlight.series}
            actionHref={collectionsSpotlight.actionHref}
            actionLabel={collectionsSpotlight.actionLabel}
          />
        ) : null;

        const cashConversionNode: ReactNode = execSuite?.cashConversionSpotlight ? (
          <PantherSpotlightCard
            layout="wallet"
            icon="cashConversion"
            chartVariant="waterfall"
            title={execSuite.cashConversionSpotlight.title}
            subtitle={execSuite.cashConversionSpotlight.subtitle}
            pill={execSuite.cashConversionSpotlight.pill}
            primary={execSuite.cashConversionSpotlight.primary}
            secondary={execSuite.cashConversionSpotlight.secondary}
            series={execSuite.cashConversionSpotlight.series}
            actionHref={
              canOpen(execSuite.cashConversionSpotlight.actionHref.split("?")[0])
                ? execSuite.cashConversionSpotlight.actionHref
                : "/sales"
            }
            actionLabel={
              canOpen(execSuite.cashConversionSpotlight.actionHref.split("?")[0])
                ? execSuite.cashConversionSpotlight.actionLabel
                : "مراجعة الفواتير والتحصيلات"
            }
          />
        ) : null;

        const cashBalanceNode: ReactNode = financeSpotlights?.cashBalance ? (
          <PantherSpotlightCard
            layout="wallet"
            icon="balanceScale"
            chartVariant="donut"
            title={financeSpotlights.cashBalance.title}
            subtitle={financeSpotlights.cashBalance.subtitle}
            pill={financeSpotlights.cashBalance.pill}
            primary={financeSpotlights.cashBalance.primary}
            secondary={financeSpotlights.cashBalance.secondary}
            series={financeSpotlights.cashBalance.series}
            actionHref={
              canOpen(financeSpotlights.cashBalance.actionHref)
                ? financeSpotlights.cashBalance.actionHref
                : "/sales"
            }
            actionLabel={
              canOpen(financeSpotlights.cashBalance.actionHref)
                ? financeSpotlights.cashBalance.actionLabel
                : "سجل المبيعات"
            }
          />
        ) : null;

        const monthlyExpensesNode: ReactNode = financeSpotlights?.monthlyExpenses ? (
          <PantherSpotlightCard
            layout="wallet"
            icon="expenseReceipt"
            chartVariant="area"
            title={financeSpotlights.monthlyExpenses.title}
            subtitle={financeSpotlights.monthlyExpenses.subtitle}
            pill={financeSpotlights.monthlyExpenses.pill}
            primary={financeSpotlights.monthlyExpenses.primary}
            secondary={financeSpotlights.monthlyExpenses.secondary}
            series={financeSpotlights.monthlyExpenses.series}
            actionHref={
              canOpen(financeSpotlights.monthlyExpenses.actionHref)
                ? financeSpotlights.monthlyExpenses.actionHref
                : "/finance/expenses"
            }
            actionLabel={financeSpotlights.monthlyExpenses.actionLabel}
          />
        ) : null;

        const profitabilityNode: ReactNode = execSuite?.fifthSpotlight ? (
          <PantherSpotlightCard
            layout="wallet"
            icon={isEmployee ? "serialScan" : "netProfit"}
            chartVariant={isEmployee ? "columns" : "waterfall"}
            title={execSuite.fifthSpotlight.title}
            subtitle={execSuite.fifthSpotlight.subtitle}
            pill={execSuite.fifthSpotlight.pill}
            primary={execSuite.fifthSpotlight.primary}
            secondary={execSuite.fifthSpotlight.secondary}
            series={execSuite.fifthSpotlight.series}
            actionHref={
              canOpen(execSuite.fifthSpotlight.actionHref.split("?")[0])
                ? execSuite.fifthSpotlight.actionHref
                : "/sales"
            }
            actionLabel={
              canOpen(execSuite.fifthSpotlight.actionHref.split("?")[0])
                ? execSuite.fifthSpotlight.actionLabel
                : "مراجعة سجل المبيعات"
            }
          />
        ) : null;

        const branchEfficiencyNode: ReactNode = execSuite?.branchEfficiencySpotlight ? (
          <PantherSpotlightCard
            layout="wallet"
            icon="branchScorecard"
            chartVariant="bars"
            title={execSuite.branchEfficiencySpotlight.title}
            subtitle={execSuite.branchEfficiencySpotlight.subtitle}
            pill={execSuite.branchEfficiencySpotlight.pill}
            primary={execSuite.branchEfficiencySpotlight.primary}
            secondary={execSuite.branchEfficiencySpotlight.secondary}
            series={execSuite.branchEfficiencySpotlight.series}
            actionHref={
              canOpen(execSuite.branchEfficiencySpotlight.actionHref.split("?")[0])
                ? execSuite.branchEfficiencySpotlight.actionHref
                : "/sales"
            }
            actionLabel={
              canOpen(execSuite.branchEfficiencySpotlight.actionHref.split("?")[0])
                ? execSuite.branchEfficiencySpotlight.actionLabel
                : "استعراض فواتير الفرع"
            }
          />
        ) : null;

        const agingRadarNode: ReactNode = execSuite?.agingRadar ? (
        <section className="dashboard-aging-card" aria-labelledby="aging-radar-title">
          <div className="dashboard-surface-card__head">
            <div>
              <h2 id="aging-radar-title">رادار أولويات التحصيل وأعمار الذمم</h2>
              <p>
                توزيع الذمم المفتوحة حسب عمر الفاتورة وأهم العملاء المستحق متابعتهم اليوم ضمن {activeScopeLabel}.
              </p>
            </div>
            <div className="dashboard-aging-card__head-end">
              <span
                className={`dashboard-feed__badge ${
                  execSuite.agingRadar.totalOpenCount > 0 ? "is-warning" : "is-positive"
                }`}
              >
                {execSuite.agingRadar.totalOpenCount > 0
                  ? `${nf.format(execSuite.agingRadar.totalOpenCount)} فاتورة آجلة · ${execSuite.agingRadar.totalDueFormatted} ج.م`
                  : "لا ذمم متأخرة"}
              </span>
              <Link href="/sales" className="dashboard-surface-card__link">
                كل الفواتير <AppIcon name="arrow" />
              </Link>
            </div>
          </div>

          <div className="dashboard-aging-body">
            <div className="dashboard-aging-buckets">
              {execSuite.agingRadar.buckets.map((b) => (
                <div key={b.key} className={`dashboard-aging-bucket is-${b.tone}`}>
                  <div className="dashboard-aging-bucket__top">
                    <span>{b.label}</span>
                    <strong>{nf.format(b.count)} فاتورة</strong>
                  </div>
                  <div className="dashboard-aging-bucket__amount">
                    <bdi dir="ltr">{b.totalFormatted}</bdi> <small>ج.م</small>
                  </div>
                  <div className="dashboard-aging-bucket__track" aria-hidden="true">
                    <span style={{ width: `${Math.max(b.count > 0 ? 6 : 0, b.sharePct)}%` }} />
                  </div>
                  <small className="dashboard-aging-bucket__share">
                    {nf.format(b.sharePct)}% من إجمالي الذمم المفتوحة
                  </small>
                </div>
              ))}
            </div>

            <div className="dashboard-aging-priority">
              <div className="dashboard-stock-box__head">
                <strong>أعلى الفواتير أولويةً للمتابعة والتحصيل</strong>
                <span className="dashboard-branches-sub">مرتّبة حسب الأقدمية وقيمة المتبقّي</span>
              </div>

              {execSuite.agingRadar.priorityInvoices.length > 0 ? (
                <ul className="dashboard-aging-list">
                  {execSuite.agingRadar.priorityInvoices.map((inv) => (
                    <li key={inv.saleId} className="dashboard-aging-row">
                      <div className="dashboard-aging-row__info">
                        <div className="dashboard-aging-row__title">
                          <strong>
                            فاتورة #{inv.saleId} — {inv.customerName}
                          </strong>
                          <span
                            className={`dashboard-feed__badge is-${
                              inv.tone === "danger"
                                ? "danger"
                                : inv.tone === "warning"
                                  ? "warning"
                                  : "neutral"
                            }`}
                          >
                            {inv.ageLabel}
                          </span>
                        </div>
                        <small>
                          هاتف: <span dir="ltr">{inv.customerPhone}</span> · {inv.branchName} · سُدّد{" "}
                          <bdi dir="ltr">{inv.paidFormatted}</bdi> من <bdi dir="ltr">{inv.netTotalFormatted}</bdi> ج.م
                        </small>
                      </div>

                      <div className="dashboard-aging-row__end">
                        <div className="dashboard-aging-row__due">
                          <span>المتبقّي</span>
                          <strong>
                            <bdi dir="ltr">{inv.dueFormatted}</bdi> ج.م
                          </strong>
                        </div>
                        <Link href={inv.href} className="dashboard-aging-row__cta">
                          تحصيل / متابعة
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="dashboard-stock-ok">
                  ممتاز — لا توجد فواتير آجلة مفتوحة بانتظار التحصيل ضمن النطاق المعروض حاليًا.
                </p>
              )}
            </div>
          </div>
        </section>
        ) : null;

        const liveFeedNode: ReactNode = (
        <article className="dashboard-surface-card" aria-labelledby="live-feed-title">
          <div className="dashboard-surface-card__head">
            <div>
              <h2 id="live-feed-title">آخر العمليات الحيّة</h2>
              <p>أحدث الفواتير والتحصيلات والمصروفات والتسويات المسجّلة ضمن صلاحية حسابك.</p>
            </div>
            <Link href="/sales" className="dashboard-surface-card__link">
              سجل المبيعات <AppIcon name="arrow" />
            </Link>
          </div>

          {mergedActivities.length === 0 ? (
            <div className="dashboard-empty">
              <AppIcon name="receipt" />
              <strong>لا توجد حركات مسجّلة بعد</strong>
              <p>ستظهر هنا أحدث الفواتير والتحصيلات والمصروفات فور تسجيلها.</p>
            </div>
          ) : (
            <ul className="dashboard-feed">
              {mergedActivities.map((item) => {
                const iconName: AppIconName =
                  item.kind === "sale"
                    ? "receipt"
                    : item.kind === "collection"
                      ? "cash"
                      : item.kind === "expense"
                        ? "expenses"
                        : "check";
                const allowed = canOpen(item.href);
                const inner = (
                  <>
                    <span className={`dashboard-feed__icon is-${item.kind}`} aria-hidden="true">
                      <AppIcon name={iconName} />
                    </span>
                    <div className="dashboard-feed__main">
                      <div className="dashboard-feed__top">
                        <strong>{item.title}</strong>
                        <span className="dashboard-feed__amount">
                          <bdi dir="ltr">{item.amountFormatted}</bdi>
                        </span>
                      </div>
                      <div className="dashboard-feed__meta">
                        <span>{item.subtitle}</span>
                        <span className="dashboard-feed__meta-end">
                          <span className={`dashboard-feed__badge is-${item.tone}`}>
                            {item.statusLabel}
                          </span>
                          <time dateTime={item.timestampIso}>
                            {activityTimeFormatter.format(new Date(item.timestampIso))}
                          </time>
                        </span>
                      </div>
                    </div>
                  </>
                );
                return (
                  <li key={item.key} className="dashboard-feed__row">
                    {allowed ? (
                      <Link href={item.href} className="dashboard-feed__link">
                        {inner}
                      </Link>
                    ) : (
                      <div className="dashboard-feed__link">{inner}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </article>
        );

        const branchHealthNode: ReactNode = (
        <article className="dashboard-surface-card" aria-labelledby="branch-stock-title">
          <div className="dashboard-surface-card__head">
            <div>
              <h2 id="branch-stock-title">صحّة الفروع وتنبيهات المخزون</h2>
              <p>متابعة مبيعات الفروع اليوم والذمم وتنبيهات الأصناف النافدة أو المنخفضة.</p>
            </div>
            {invOn && canOpen("/inventory") ? (
              <Link
                href={isAccountant ? "/inventory/receipts" : "/inventory/receipts/new"}
                className="dashboard-surface-card__link"
              >
                {isAccountant ? "سجل التوريدات" : "+ توريد مخزون"}
              </Link>
            ) : null}
          </div>

          <div className="dashboard-surface-card__body">
            {/* تنبيهات النواقص المخزونية */}
            <div className="dashboard-stock-box">
              <div className="dashboard-stock-box__head">
                <strong>تنبيهات أرصدة المخزون</strong>
                <span
                  className={`dashboard-feed__badge ${
                    lowStockTotalCount > 0 ? "is-warning" : "is-positive"
                  }`}
                >
                  {lowStockTotalCount > 0
                    ? `${nf.format(lowStockTotalCount)} صنف منخفض أو نافد`
                    : "الأرصدة آمنة"}
                </span>
              </div>

              {pulseData && pulseData.lowStockItems.length > 0 ? (
                <ul className="dashboard-stock-list">
                  {pulseData.lowStockItems.map((st) => (
                    <li key={st.key} className="dashboard-stock-item">
                      <div>
                        <strong>{st.productName}</strong>
                        <small>
                          <span dir="ltr">{st.sku}</span> · {st.warehouseName} ({st.branchName})
                        </small>
                      </div>
                      <span
                        className={`dashboard-feed__badge ${
                          st.isZero ? "is-danger" : "is-warning"
                        }`}
                      >
                        {st.isZero ? "نافد (0)" : `متبقٍّ ${st.qtyFormatted}`}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="dashboard-stock-ok">
                  لا توجد أصناف مخزونية مسجّلة برصيد صفري أو منخفض (٢ فأقل) في النطاق المعروض.
                </p>
              )}
            </div>

            {/* بطاقات صحة الفروع النشطة (خرجت من ضيق الحافظة إلى عرض مريح وواضح) */}
            <div className="dashboard-branches-box">
              <div className="dashboard-stock-box__head">
                <strong>الفروع النشطة اليوم ({nf.format(branches.length)})</strong>
                <span className="dashboard-branches-sub">مبيعات اليوم · الذمم · المستودعات</span>
              </div>

              {pulseData && pulseData.branchHealth.length > 0 ? (
                <div className="dashboard-branch-cards">
                  {pulseData.branchHealth.map((bh) => {
                    const expectedCustody = custodyExpectedByBranchName.get(bh.branchName);
                    const effBadge = execSuite?.branchScoresById?.[bh.branchId];
                    return (
                      <div key={bh.branchId} className="dashboard-branch-card">
                        <div className="dashboard-branch-card__top">
                          <div className="dashboard-branch-name">
                            <span className="dashboard-branch-name__icon">
                              <AppIcon name="branch" />
                            </span>
                            <span>
                              <strong>{bh.branchName}</strong>
                              <small>
                                <span dir="ltr">{bh.branchCode}</span>
                                {bh.city ? ` · ${bh.city}` : ""} · {nf.format(bh.usersCount)} مستخدم
                              </small>
                            </span>
                          </div>
                          <div className="dashboard-warehouse-list">
                            {effBadge ? (
                              <span
                                className={`dashboard-feed__badge is-${effBadge.tone}`}
                                title={`تقييم كفاءة الفرع: ${effBadge.gradeLabel}`}
                              >
                                كفاءة {nf.format(effBadge.score)}/100
                              </span>
                            ) : null}
                            {bh.warehouseCodes.length > 0 ? (
                              bh.warehouseCodes.map((code) => (
                                <span key={code} dir="ltr">
                                  {code}
                                </span>
                              ))
                            ) : (
                              <span className="dashboard-warehouse-list__empty">بلا مستودع</span>
                            )}
                          </div>
                        </div>

                        <div className="dashboard-branch-card__stats">
                          <div>
                            <span>مبيعات اليوم</span>
                            <strong>
                              <bdi dir="ltr">{bh.todaySalesFormatted}</bdi> ج.م
                            </strong>
                            <small>{nf.format(bh.todayInvoicesCount)} فاتورة</small>
                          </div>
                          <div>
                            <span>ذمم العملاء</span>
                            <strong className={bh.outstandingNum > 0 ? "is-due" : ""}>
                              <bdi dir="ltr">{bh.outstandingFormatted}</bdi> ج.م
                            </strong>
                            <small>{nf.format(bh.outstandingCount)} آجلة</small>
                          </div>
                          {!isEmployee && expectedCustody !== undefined ? (
                            <div>
                              <span>المتوقَّع بالعهدة</span>
                              <strong>
                                <bdi dir="ltr">{nf.format(Number(expectedCustody))}</bdi> ج.م
                              </strong>
                              <small>نقد الفرع</small>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="dashboard-empty">
                  <AppIcon name="branch" />
                  <strong>لا توجد فروع نشطة متاحة</strong>
                </div>
              )}
            </div>
          </div>
        </article>
        );

        const governanceAlertCount = execSuite?.governance?.alerts.length ?? 0;
        const overdueInvoicesCount = execSuite?.agingRadar?.totalOpenCount ?? 0;

        const sectionItems: DashboardSectionMeta[] = [
          {
            id: "pulse-wallet",
            group: "modes",
            label: "نبض اليوم والحافظة الذكية (الوضع المركّز)",
            description: "الأرقام الأربعة الفورية ووتيرة الشهر والحافظة الذكية ومهام القرار",
            icon: "dashboard",
            stageKind: "pulse-wallet",
            badgeCount: urgentTaskCount,
            badgeTone: urgentTaskCount > 0 ? "alert" : "neutral",
          },
          {
            id: "all",
            group: "modes",
            label: "عرض شامل (كل محتويات لوحة القيادة معًا)",
            description: "إظهار جميع المؤشرات والرادارات والفروع والسجل الحي في صفحة واحدة",
            icon: "reports",
            stageKind: "full",
          },
          {
            id: "pulse",
            group: "daily",
            label: "نبض عمليات اليوم",
            description: "مبيعات اليوم، التحصيلات الفعلية، المهام العاجلة، وحالة المخزون",
            icon: "sales",
            stageKind: "wide",
          },
          ...(paceNode
            ? [
                {
                  id: "pace" as DashboardSectionId,
                  group: "daily" as const,
                  label: `وتيرة ${currentMonthLabel} وتوقّع الإغلاق`,
                  description: "متوسط البيع اليومي والإغلاق المتوقع مقارنةً بالشهر الماضي",
                  icon: "calendar" as AppIconName,
                  stageKind: "wide" as const,
                },
              ]
            : []),
          ...(governanceNode
            ? [
                {
                  id: "governance" as DashboardSectionId,
                  group: "daily" as const,
                  label: "درع الرقابة المالية والخصومات",
                  description: "مراقبة الإلغاءات والمرتجعات وسقف خصم الكاونتر وفروقات الجرد",
                  icon: "shield" as AppIconName,
                  stageKind: "wide" as const,
                  badgeCount: governanceAlertCount,
                  badgeTone: (governanceAlertCount > 0 ? "alert" : "neutral") as "alert" | "neutral",
                },
              ]
            : []),
          {
            id: "wallet",
            group: "daily",
            label: "الحافظة الذكية ومهام القرار",
            description: "المستحق للخزنة وعُهَد الفروع، القرارات المعلّقة، وصورة النطاق السريعة",
            icon: "cash",
            stageKind: "card",
            badgeCount: unifiedActions.length,
            badgeTone: unifiedActions.length > 0 ? "alert" : "neutral",
          },
          ...(efficiencyNode
            ? [
                {
                  id: "efficiency" as DashboardSectionId,
                  group: "spotlights" as const,
                  label: "مؤشر الكفاءة التشغيلية الشامل",
                  description: "عدّاد الكفاءة من 100 عبر التحصيل والمبيعات والمصروفات والتسويات والمخزون",
                  icon: "check" as AppIconName,
                  stageKind: "card" as const,
                },
              ]
            : []),
          ...(monthlySalesNode
            ? [
                {
                  id: "monthly-sales" as DashboardSectionId,
                  group: "spotlights" as const,
                  label: `مبيعات الشهر (${currentMonthLabel})`,
                  description: "منحنى تطور مبيعات الشهر ومتوسط الفاتورة ونسبة التحصيل",
                  icon: "sales" as AppIconName,
                  stageKind: "card" as const,
                },
              ]
            : []),
          ...(collectionsNode
            ? [
                {
                  id: "collections" as DashboardSectionId,
                  group: "spotlights" as const,
                  label: "التحصيل والعملاء وطرق الدفع",
                  description: "توزيع المحصّل الفعلي مقابل الآجل ووسائل الدفع",
                  icon: "receipt" as AppIconName,
                  stageKind: "card" as const,
                },
              ]
            : []),
          ...(cashConversionNode
            ? [
                {
                  id: "cash-conversion" as DashboardSectionId,
                  group: "spotlights" as const,
                  label: "مؤشر التحوّل النقدي الصافي",
                  description: "مسار تحوّل المبيعات إلى سيولة صافية بعد التحصيل والمصروفات",
                  icon: "transfers" as AppIconName,
                  stageKind: "card" as const,
                },
              ]
            : []),
          ...(cashBalanceNode
            ? [
                {
                  id: "cash-balance" as DashboardSectionId,
                  group: "spotlights" as const,
                  label: "الميزان النقدي وسيولة الخزائن والعُهَد",
                  description: "توزيع السيولة النقدية بين الخزائن الرئيسية وعُهَد الفروع المفتوحة",
                  icon: "cash" as AppIconName,
                  stageKind: "card" as const,
                },
              ]
            : []),
          ...(monthlyExpensesNode
            ? [
                {
                  id: "monthly-expenses" as DashboardSectionId,
                  group: "spotlights" as const,
                  label: "مصروفات الشهر وحالة الصرف",
                  description: "توزيع مصروفات الشهر بين المدفوع والمعتمد والمعلّق للاعتماد",
                  icon: "expenses" as AppIconName,
                  stageKind: "card" as const,
                },
              ]
            : []),
          ...(profitabilityNode
            ? [
                {
                  id: "profitability" as DashboardSectionId,
                  group: "spotlights" as const,
                  label: isEmployee
                    ? "حركة الأصناف والسيريالات"
                    : "الربحية وصافي التشغيل",
                  description: isEmployee
                    ? "نشاط الأصناف والأجهزة التسلسلية في فرعك هذا الشهر"
                    : "صافي المبيعات مطروحًا منه تكلفة البضاعة والمصروفات التشغيلية",
                  icon: (isEmployee ? "products" : "stockValue") as AppIconName,
                  stageKind: "card" as const,
                },
              ]
            : []),
          ...(branchEfficiencyNode
            ? [
                {
                  id: "branch-efficiency" as DashboardSectionId,
                  group: "spotlights" as const,
                  label: "مؤشر تقييم وكفاءة الفروع",
                  description: "مقارنة درجات كفاءة الفروع النشطة من 100",
                  icon: "branch" as AppIconName,
                  stageKind: "card" as const,
                },
              ]
            : []),
          ...(agingRadarNode
            ? [
                {
                  id: "aging-radar" as DashboardSectionId,
                  group: "operations" as const,
                  label: "رادار أولويات التحصيل وأعمار الذمم",
                  description: "شرائح أعمار الفواتير الآجلة وقائمة العملاء الأعلى أولوية للمتابعة",
                  icon: "receipt" as AppIconName,
                  stageKind: "wide" as const,
                  badgeCount: overdueInvoicesCount,
                  badgeTone: (overdueInvoicesCount > 0 ? "alert" : "neutral") as "alert" | "neutral",
                },
              ]
            : []),
          {
            id: "live-feed",
            group: "operations",
            label: "آخر العمليات الحيّة",
            description: "السجل الحيّ لأحدث الفواتير والتحصيلات والمصروفات والتسويات",
            icon: "receipt",
            stageKind: "wide",
            badgeCount: mergedActivities.length,
            badgeTone: "neutral",
          },
          {
            id: "branch-health",
            group: "operations",
            label: "صحّة الفروع وتنبيهات المخزون",
            description: "تنبيهات الأصناف النافدة أو المنخفضة وبطاقات أداء كل فرع نشط",
            icon: "branch",
            stageKind: "wide",
            badgeCount: lowStockTotalCount > 0 ? lowStockTotalCount : branches.length,
            badgeTone: lowStockTotalCount > 0 ? "alert" : "neutral",
          },
        ];

        /* بطاقة «مصروفات اليوم» — نفس مصدر سجل المصروفات بأي حالة، تأتي بعد «تفاصيل تحصيلات اليوم» */
        const todayExpensesNode: ReactNode = (
          <article
            className="dashboard-surface-card dash-today-card dash-today-expenses"
            data-dash-part="today-expenses"
            aria-labelledby="today-expenses-title"
          >
            <div className="dashboard-surface-card__head">
              <div>
                <h2 id="today-expenses-title">
                  مصروفات اليوم
                  {todayExpenses && todayExpenses.count > 0 ? ` (${nf.format(todayExpenses.count)})` : ""}
                </h2>
                <p>بنود اليوم بكل حالاتها (انتظار الاعتماد · معتمدة · مدفوعة) — المبالغ بعد آخر تصحيح معتمد.</p>
              </div>
              {finOn && canOpen("/finance/expenses") ? (
                <Link href="/finance/expenses" className="dashboard-surface-card__link">
                  سجل المصروفات <AppIcon name="arrow" />
                </Link>
              ) : null}
            </div>

            {!finOn ? (
              <div className="dashboard-empty dash-today-expenses__notice">
                <AppIcon name="expenses" />
                <strong>تتطلب هذه البطاقة وحدة المالية</strong>
                <p>تظهر مصروفات اليوم وتفاصيلها هنا تلقائيًا بعد تفعيل وحدة المالية وتطبيق ترحيلها المعتمد على الإنتاج.</p>
              </div>
            ) : todayExpensesError ? (
              <div className="dashboard-empty dash-today-expenses__notice dash-today-expenses__notice--error">
                <AppIcon name="expenses" />
                <strong>تعذّرت قراءة مصروفات اليوم</strong>
                <p>حدّث الصفحة؛ إن تكرر الخلل فأبلغ مدير النظام.</p>
              </div>
            ) : !todayExpenses || todayExpenses.count === 0 ? (
              <div className="dashboard-empty">
                <AppIcon name="receipt" />
                <strong>لا توجد مصروفات اليوم بعد</strong>
                <p>تُسجّل من «تسجيل مصروف» وتظهر هنا فور حفظها.</p>
              </div>
            ) : (
              <>
                <div className="dash-today-kpis" role="group" aria-label="ملخص مصروفات اليوم">
                  <div className="dash-today-kpi">
                    <span className="dash-today-kpi__label">
                      إجمالي مصروفات اليوم
                      <small>كل الحالات</small>
                    </span>
                    <strong className="dash-today-kpi__value">
                      <bdi dir="ltr">{todayExpenses.totalFormatted}</bdi> ج.م
                    </strong>
                    <span className="dash-today-kpi__note">{nf.format(todayExpenses.count)} بنود</span>
                  </div>
                  <div className="dash-today-kpi">
                    <span className="dash-today-kpi__label">
                      المدفوع
                      <small>صُرفت فعليًا</small>
                    </span>
                    <strong className="dash-today-kpi__value">
                      <bdi dir="ltr">{todayExpenses.paidFormatted}</bdi> ج.م
                    </strong>
                    <span className="dash-today-kpi__note">{nf.format(todayExpenses.paidCount)} مدفوعة</span>
                  </div>
                  <div className="dash-today-kpi">
                    <span className="dash-today-kpi__label">
                      بانتظار الدفع
                      <small>معتمدة وبانتظار الاعتماد</small>
                    </span>
                    <strong className={`dash-today-kpi__value${todayExpenses.waitingCents > 0n ? " is-outstanding" : ""}`}>
                      <bdi dir="ltr">{todayExpenses.waitingFormatted}</bdi> ج.م
                    </strong>
                    <span className={`dash-today-kpi__note${todayExpenses.waitingCents > 0n ? " is-warn" : ""}`}>
                      {nf.format(todayExpenses.pendingCount)} بانتظار · {nf.format(todayExpenses.approvedCount)} معتمدة
                    </span>
                  </div>
                </div>

                <ul className="dash-today-invoice-list dash-today-expense-list">
                  {todayExpenses.rows.map((row) => {
                    const detailHref = `/finance/expenses/${row.id}`;
                    const allowed = canManageExpenses && canOpen(detailHref);
                    const tone = row.status === "PAID" ? "paid" : row.status === "APPROVED" ? "approved" : "pending";
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
                            {` · ${row.branchName} · سجّلها ${row.requestedByName}`}
                            {row.status === "PAID" && row.paymentMethodLabel ? ` · صُرفت ${row.paymentMethodLabel}` : ""}
                          </span>
                        </span>
                        <span className="dash-today-invoice__amount">
                          <bdi dir="ltr">{row.amountFormatted}</bdi> ج.م
                        </span>
                      </>
                    );
                    return (
                      <li key={row.id} className="dash-today-invoice dash-today-expense">
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
                <p className="dash-today-note">
                  المبالغ بعد آخر تصحيح مالي معتمد (إن وُجد) · تُحتسب بنود اليوم بتاريخ المصروف لا بتاريخ الصرف.
                </p>
              </>
            )}
          </article>
        );

        /* بطاقتا «فواتير اليوم» و«تفاصيل تحصيلات اليوم» — تظهران تحت الحافظة في الوضع المركّز فقط */
        const todayPanelsNode: ReactNode = pulseData ? (
          <div className="dash-today-grid dash-today-grid--stack" data-dash-part="today" aria-label="فواتير اليوم وتحصيلاته">
            <article className="dashboard-surface-card dash-today-card" data-dash-part="today-invoices" aria-labelledby="today-invoices-title">
              <div className="dashboard-surface-card__head">
                <div>
                  <h2 id="today-invoices-title">
                    فواتير اليوم{pulseData.todayInvoicesCount > 0 ? ` (${nf.format(pulseData.todayInvoicesCount)})` : ""}
                  </h2>
                  <p>كل فواتير اليوم بترتيب الأحدث — إيصال لكل فاتورة؛ مرّر يمينًا ويسارًا أو استخدم الأسهم.</p>
                </div>
                <Link href="/sales" className="dashboard-surface-card__link">
                  سجل المبيعات <AppIcon name="arrow" />
                </Link>
              </div>

              {pulseData.todayInvoicesList.length === 0 ? (
                <div className="dashboard-empty">
                  <AppIcon name="receipt" />
                  <strong>لا توجد فواتير اليوم بعد</strong>
                  <p>ستظهر أحدث الفواتير الصادرة اليوم فور تسجيلها.</p>
                </div>
              ) : (
                <TodayInvoiceRail invoices={pulseData.todayInvoicesList} canOpen={canOpen("/sales/1")} />
              )}
            </article>

            <article className="dashboard-surface-card dash-today-card" data-dash-part="today-collections" aria-labelledby="today-collections-title">
              <div className="dashboard-surface-card__head">
                <div>
                  <h2 id="today-collections-title">
                    تفاصيل تحصيلات اليوم
                    {pulseData.todaySplitDistinctInvoices > 0
                      ? ` (${nf.format(pulseData.todaySplitDistinctInvoices)} فاتورة)`
                      : ""}
                  </h2>
                  <p>صافي تحصيلات اليوم وإجمالي اليوم والمتبقّي، مع فصل فواتير النقدي عن البطاقة.</p>
                </div>
                <Link href="/sales" className="dashboard-surface-card__link">
                  سجل المبيعات <AppIcon name="arrow" />
                </Link>
              </div>

              <div className="dash-today-kpis" role="group" aria-label="ملخص تحصيلات اليوم">
                <div className="dash-today-kpi">
                  <span className="dash-today-kpi__label">
                    صافي تحصيلات اليوم
                    <small>بعد المرتجعات</small>
                  </span>
                  <strong className="dash-today-kpi__value">
                    <bdi dir="ltr">{pulseData.todayNetCollectedFormatted}</bdi> ج.م
                  </strong>
                  <span className="dash-today-kpi__note">
                    {pulseData.todayRefundsMovesCount > 0
                      ? `مرتجعات −${pulseData.todayRefundsTotalFormatted} ج.م (${nf.format(pulseData.todayRefundsMovesCount)} حركة)`
                      : `${nf.format(pulseData.todaySplitDistinctInvoices)} فاتورة مسددة جزئيًا أو كليًا`}
                  </span>
                </div>
                <div className="dash-today-kpi">
                  <span className="dash-today-kpi__label">
                    إجمالي اليوم
                    <small>مبيعات اليوم الصافية</small>
                  </span>
                  <strong className="dash-today-kpi__value">
                    <bdi dir="ltr">{pulseData.todayNetSalesFormatted}</bdi> ج.م
                  </strong>
                  <span className="dash-today-kpi__note">{nf.format(pulseData.todayInvoicesCount)} فاتورة</span>
                </div>
                <div className="dash-today-kpi">
                  <span className="dash-today-kpi__label">
                    إجمالي المتبقي
                    <small>متبقي تحصيل فواتير اليوم</small>
                  </span>
                  <strong className={`dash-today-kpi__value${pulseData.todayRemainingCount > 0 ? " is-outstanding" : ""}`}>
                    <bdi dir="ltr">{pulseData.todayRemainingFormatted}</bdi> ج.م
                  </strong>
                  <span className={`dash-today-kpi__note${pulseData.todayRemainingCount > 0 ? " is-warn" : ""}`}>
                    {pulseData.todayRemainingCount > 0
                      ? `${nf.format(pulseData.todayRemainingCount)} فاتورة آجلة`
                      : "كل فواتير اليوم مسددة"}
                  </span>
                </div>
              </div>

              <div className="dash-today-split">
                {pulseData.todaySplitSections.map((section) => {
                  const sectionTitle =
                    section.method === "CASH"
                      ? "فواتير نقدي"
                      : section.method === "CARD"
                        ? "فواتير بطاقة"
                        : `فواتير ${section.label}`;
                  const slug =
                    section.method === "CASH" ? "cash" : section.method === "CARD" ? "card" : "other";
                  const icon: AppIconName =
                    section.method === "CASH"
                      ? "cash"
                      : section.method === "CARD"
                        ? "receipt"
                        : "transfers";
                  return (
                    <section
                      key={section.method}
                      className={`dash-today-section dash-today-section--${slug}`}
                      aria-label={sectionTitle}
                    >
                      <header className="dash-today-section__head">
                        <span className="dash-today-section__icon" aria-hidden="true">
                          <AppIcon name={icon} />
                        </span>
                        <h3>{sectionTitle}</h3>
                        <span className="dash-today-section__count">{nf.format(section.invoiceCount)} فاتورة</span>
                        <strong className="dash-today-section__sum">
                          <bdi dir="ltr">{section.totalFormatted}</bdi> ج.م
                        </strong>
                      </header>
                      {section.rows.length === 0 ? (
                        <p className="dash-today-section__empty">لا توجد تحصيلات {section.label} اليوم.</p>
                      ) : (
                        <ul className="dash-today-invoice-list">
                          {section.rows.map((row) => {
                            const href = `/sales/${row.saleId}`;
                            const allowed = canOpen(href);
                            const inner = (
                              <>
                                <span className="dash-today-invoice__id" dir="ltr">
                                  <bdi>ST-{row.saleId}</bdi>
                                </span>
                                <span className="dash-today-invoice__main">
                                  <span className="dash-today-invoice__customer">{row.customerName}</span>
                                  <span className="dash-today-invoice__meta">
                                    من إجمالي {row.invoiceTotalFormatted} ج.م
                                    {row.hasRemaining
                                      ? ` · متبقٍّ ${row.remainingFormatted} ج.م`
                                      : " · مسددة"}
                                  </span>
                                </span>
                                <span className="dash-today-invoice__amount">
                                  <bdi dir="ltr">{row.amountFormatted}</bdi> ج.م
                                </span>
                              </>
                            );
                            return (
                              <li key={row.key} className="dash-today-invoice">
                                {allowed ? (
                                  <Link href={href} className="dash-today-invoice__link">
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
                    </section>
                  );
                })}
              </div>
              {pulseData.todayRefundsList.length > 0 ? (
                <section className="dash-today-section dash-today-section--refund" aria-label="مرتجعات اليوم">
                  <header className="dash-today-section__head">
                    <span className="dash-today-section__icon dash-today-section__icon--refund" aria-hidden="true">
                      <AppIcon name="arrow" />
                    </span>
                    <h3>مرتجعات اليوم</h3>
                    <span className="dash-today-section__count">
                      {pulseData.todayRefundsList.length === 1
                        ? "مرتجعة واحدة"
                        : `${nf.format(pulseData.todayRefundsList.length)} مرتجعات`}
                    </span>
                    <strong className="dash-today-section__sum is-refund">
                      <bdi dir="ltr">−{pulseData.todayRefundsTotalFormatted}</bdi> ج.م
                    </strong>
                  </header>
                  <ul className="dash-today-invoice-list">
                    {pulseData.todayRefundsList.map((refund) => {
                      const href = `/sales/${refund.saleId}`;
                      const allowed = canOpen(href);
                      const inner = (
                        <>
                          <span className="dash-today-invoice__id" dir="ltr">
                            <bdi>ST-{refund.saleId}</bdi>
                          </span>
                          <span className="dash-today-invoice__main">
                            <span className="dash-today-invoice__customer">{refund.customerName}</span>
                            <span className="dash-today-invoice__meta">
                              {refund.methodLabel} · سجّلها {refund.staffName} ·{" "}
                              <time dateTime={refund.timestampIso}>
                                {activityTimeFormatter.format(new Date(refund.timestampIso))}
                              </time>
                            </span>
                          </span>
                          <span className="dash-today-refund__amount">
                            <bdi dir="ltr">−{refund.amountFormatted}</bdi> ج.م
                          </span>
                        </>
                      );
                      return (
                        <li key={refund.key} className="dash-today-invoice">
                          {allowed ? (
                            <Link href={href} className="dash-today-invoice__link">
                              {inner}
                            </Link>
                          ) : (
                            <div className="dash-today-invoice__link is-static">{inner}</div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  <p className="dash-today-note dash-today-note--tight">
                    تُخصم المرتجعات من تحصيلات اليوم في خانة «صافي تحصيلات اليوم» أعلاه وتُوزَّع نقصًا على وسيلة الدفع.
                  </p>
                </section>
              ) : null}

              <p className="dash-today-note">
                المبالغ في الأقسام = تحصيلات كل وسيلة بعد خصم مرتجعاتها · الفاتورة الواحدة تتوزّع مبالغها على الوسائل التي سُدّد بها منها.
              </p>
            </article>

            {todayExpensesNode}
          </div>
        ) : null;

        const sectionSlots: Partial<Record<DashboardSectionId, ReactNode>> = {
          pulse: pulseNode,
          pace: paceNode,
          governance: governanceNode,
          wallet: walletNode,
          efficiency: efficiencyNode,
          "monthly-sales": monthlySalesNode,
          collections: collectionsNode,
          "cash-conversion": cashConversionNode,
          "cash-balance": cashBalanceNode,
          "monthly-expenses": monthlyExpensesNode,
          profitability: profitabilityNode,
          "branch-efficiency": branchEfficiencyNode,
          "aging-radar": agingRadarNode,
          "live-feed": liveFeedNode,
          "branch-health": branchHealthNode,
        };

        const fullDashboardWallet: ReactNode = (
          <section className="dashboard-all-wallet dashboard-cards-grid__wallet" aria-labelledby="dashboard-all-wallet-title">
            <div className="dashboard-all-wallet__head">
              <h2 id="dashboard-all-wallet-title">الحافظة المالية</h2>
              <p>موضع الحافظة يتغير بحسب التصميم المختار.</p>
            </div>
            {walletNode}
          </section>
        );

        const allPanelHeader: ReactNode = (
          <header className="dashboard-all-panel__head">
            <div>
              <span className="dashboard-all-panel__eyebrow">نظرة موحّدة</span>
              <h2 id="dashboard-all-title">لوحة المتابعة الشاملة</h2>
              <p>في التصميم الواسع تدخل الحافظة ضمن الشبكة، وتظهر أعلى اللوحة في التصميم المضغوط.</p>
            </div>
          </header>
        );
        const allSpotlightCards: ReactNode = (
          <>
            {efficiencyNode ? <div className="dashboard-cards-grid__item">{efficiencyNode}</div> : null}
            {monthlySalesNode ? <div className="dashboard-cards-grid__item">{monthlySalesNode}</div> : null}
            {collectionsNode ? <div className="dashboard-cards-grid__item">{collectionsNode}</div> : null}
            {cashConversionNode ? <div className="dashboard-cards-grid__item">{cashConversionNode}</div> : null}
            {cashBalanceNode ? <div className="dashboard-cards-grid__item">{cashBalanceNode}</div> : null}
            {monthlyExpensesNode ? <div className="dashboard-cards-grid__item">{monthlyExpensesNode}</div> : null}
            {profitabilityNode ? <div className="dashboard-cards-grid__item">{profitabilityNode}</div> : null}
            {branchEfficiencyNode ? <div className="dashboard-cards-grid__item">{branchEfficiencyNode}</div> : null}
          </>
        );
        const allPanelAfterCards: ReactNode = (
          <>
            {agingRadarNode}
            <section className="dashboard-lower-grid" aria-label="آخر الحركات وصحة الفروع والمخزون">
              {liveFeedNode}
              {branchHealthNode}
            </section>
          </>
        );

        // التصميم الواسع يعيد شبكة الدمج الأخير ويضع الحافظة كأول بطاقة داخلها.
        const fullDashboardView: ReactNode = (
          <section className="dashboard-all-panel" aria-labelledby="dashboard-all-title">
            {allPanelHeader}
            <div className="dashboard-cards-grid">
              {fullDashboardWallet}
              {allSpotlightCards}
            </div>
            {allPanelAfterCards}
          </section>
        );

        // التصميم المضغوط يرفع الحافظة فوق اللوحة ويضغط بطاقات المؤشرات في عمودين.
        const compactDashboardView: ReactNode = (
          <section className="dashboard-all-panel" aria-labelledby="dashboard-all-title">
            {allPanelHeader}
            <div className="dashboard-cards-grid dashboard-all-panel__spotlights">
              {allSpotlightCards}
            </div>
            {allPanelAfterCards}
          </section>
        );

        return (
          <DashboardSectionSwitcher
            userScopeKey={`${session.id}-${session.role}`}
            initialSectionParam={requestedSection}
            items={sectionItems}
            slots={sectionSlots}
            fullView={fullDashboardView}
            compactView={compactDashboardView}
            fullViewWallet={fullDashboardWallet}
            belowWalletSlot={todayPanelsNode}
            headerContent={dashboardHeaderContent}
            headerTools={dashboardHeaderTools}
            beforeContent={dashboardPrelude}
          />
        );
      })()}

      <div className="dashboard-account-note">
        <span>
          حسابك: <strong>{ROLE_LABEL[session.role] ?? session.role}</strong>
        </span>
        <span aria-hidden="true">·</span>
        <span dir="ltr">{session.email}</span>
      </div>
    </div>
  );
}
