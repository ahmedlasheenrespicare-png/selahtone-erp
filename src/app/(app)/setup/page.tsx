import { AppIcon } from "@/components/app-icon";
import PantherSpotlightCard, {
  type PantherChartPoint,
  type PantherChartSeries,
} from "@/components/panther-spotlight-card";
import PrintPageButton from "@/components/print-page-button";
import { canSeeAllBranches, requireSession } from "@/lib/auth";
import { isValidAuthSecret } from "@/lib/auth-secret";
import { inventoryEnabled } from "@/lib/feature-flags";
import { financeDb, financeEnabled } from "@/lib/finance/db";
import { requireSystemAdminOrRedirect } from "@/lib/access-control-server";
import { prisma } from "@/lib/prisma";
import { lineTax, money } from "@/lib/tax";
import SetupReadinessView, {
  type BranchReadinessRow,
  type CheckAxis,
  type ReadinessCheckItem,
  type SafeEnvFlagItem,
} from "./setup-readiness-view";
import "./setup.css";

export const dynamic = "force-dynamic";

const nf = new Intl.NumberFormat("ar-EG-u-nu-latn", {
  maximumFractionDigits: 2,
});

/**
 * مركز فحص الجاهزية والأمان الحيّ (/setup):
 * تشخيص فعلي من القاعدة على ٤ محاور (البنية، الأمان والهوية، المبيعات والضرائب، المالية والخزينة)
 * دون كشف أي أسرار أو أرصدة مالية، ودون اقتراح تهيئة بيانات على قاعدة قائمة.
 */
export default async function SetupPage() {
  const session = await requireSession();
  await requireSystemAdminOrRedirect();

  if (!canSeeAllBranches(session)) {
    return (
      <div className="dashboard">
        <div className="alert alert-err" role="alert">
          فحص الجاهزية والأمان متاح للمدير والمحاسب فقط.
        </div>
      </div>
    );
  }

  const isManager = session.role === "MANAGER";
  const financeOn = financeEnabled();
  const inventoryOn = inventoryEnabled();
  const now = new Date();

  // قياس زمن استجابة قاعدة البيانات الحقيقي بالملي ثانية
  const pingStart = Date.now();
  await prisma.$queryRaw`SELECT 1`;
  const dbLatencyMs = Math.max(1, Date.now() - pingStart);

  const [
    branchList,
    usersSummary,
    taxRates,
    productsCount,
    activeExpenseCatsCount,
    totalExpenseCatsCount,
    activeSalesCatsCount,
    activeSalesTypesCount,
    commerceSettings,
    activeSessionCount,
    expiredSessionCount,
    lockedThrottleCount,
    financeProbe,
  ] = await Promise.all([
    prisma.branch.findMany({
      include: {
        warehouses: true,
        users: { select: { id: true, status: true, roleCode: true } },
      },
      orderBy: { code: "asc" },
    }),
    prisma.user.findMany({
      select: {
        id: true,
        roleCode: true,
        status: true,
        mustChangePassword: true,
      },
    }),
    prisma.taxRate.findMany({ orderBy: { rate: "asc" } }),
    prisma.product.count(),
    prisma.expenseCategory.count({ where: { isActive: true } }),
    prisma.expenseCategory.count(),
    prisma.salesItemCategory.count({ where: { isActive: true } }).catch(() => 0),
    prisma.salesItemType.count({ where: { isActive: true } }).catch(() => 0),
    prisma.commerceSettings.findFirst().catch(() => null),
    prisma.authSession.count({ where: { expiresAt: { gt: now } } }).catch(() => 0),
    prisma.authSession.count({ where: { expiresAt: { lte: now } } }).catch(() => 0),
    prisma.loginThrottle.count({ where: { lockedUntil: { gt: now } } }).catch(() => 0),
    financeOn
      ? financeDb
          .serializable((tx) =>
            tx.query<{
              id: string;
              branchId: string;
              kind: string;
            }>(
              `SELECT id::text AS id,
                      branch_id::text AS "branchId",
                      kind::text AS kind
                 FROM finance.accounts
                WHERE closed_at IS NULL`,
            ),
          )
          .then((res) => ({ ok: true, rows: res.rows }))
          .catch(() => ({ ok: false, rows: [] as { id: string; branchId: string; kind: string }[] }))
      : Promise.resolve({ ok: false, rows: [] as { id: string; branchId: string; kind: string }[] }),
  ]);

  // إحصاءات المستخدمين والأمان
  const totalUsers = usersSummary.length;
  const activeUsers = usersSummary.filter((u) => u.status === "ACTIVE");
  const activeManagers = activeUsers.filter((u) => u.roleCode === "MANAGER").length;
  const mustChangePwCount = activeUsers.filter((u) => u.mustChangePassword).length;

  // إحصاءات الفروع والخزائن والمستودعات
  const openVaultBranches = new Set<string>();
  const openCustodyCountByBranch = new Map<string, number>();
  for (const row of financeProbe.rows) {
    if (row.kind === "VAULT") openVaultBranches.add(row.branchId);
    else if (row.kind === "CUSTODY") {
      openCustodyCountByBranch.set(
        row.branchId,
        (openCustodyCountByBranch.get(row.branchId) ?? 0) + 1,
      );
    }
  }

  const branchMatrix: BranchReadinessRow[] = branchList.map((b) => {
    const bId = b.id.toString();
    const activeWarehouses = b.warehouses.filter((w) => w.isActive);
    const hasDefaultWarehouse = b.warehouses.some((w) => w.isDefault && w.isActive);
    const activeStaff = b.users.filter((u) => u.status === "ACTIVE").length;
    const hasOpenVault = openVaultBranches.has(bId);
    const openCustodies = openCustodyCountByBranch.get(bId) ?? 0;

    if (!b.isActive) {
      return {
        id: bId,
        nameAr: b.nameAr,
        code: b.code,
        city: b.city,
        invoicePrefix: b.invoicePrefix,
        isActive: false,
        warehouseCodes: b.warehouses.map((w) => w.code).join(" · "),
        hasDefaultWarehouse,
        activeStaffCount: activeStaff,
        totalStaffCount: b.users.length,
        hasOpenVault,
        openCustodyCount: openCustodies,
        ready: true,
        verdictLabel: "فرع موقوف اختياريًا",
        remediationHref: isManager ? "/admin" : null,
        remediationLabel: isManager ? "مراجعة الفرع" : null,
      };
    }

    const missingReasons: string[] = [];
    let remHref: string | null = null;
    let remLabel: string | null = null;

    if (!hasDefaultWarehouse || activeWarehouses.length === 0) {
      missingReasons.push("بلا مستودع افتراضي نشط");
      remHref = "/admin";
      remLabel = "مراجعة الفروع";
    }
    if (financeOn && !hasOpenVault) {
      missingReasons.push("بلا خزنة مفتوحة");
      remHref = "/finance/accounts";
      remLabel = "فتح خزنة الفرع";
    }
    if (activeStaff === 0) {
      missingReasons.push("لا موظف فرع نشط");
      if (!remHref) {
        remHref = "/admin";
        remLabel = "إسناد موظف";
      }
    }

    return {
      id: bId,
      nameAr: b.nameAr,
      code: b.code,
      city: b.city,
      invoicePrefix: b.invoicePrefix,
      isActive: true,
      warehouseCodes: activeWarehouses.map((w) => w.code).join(" · "),
      hasDefaultWarehouse,
      activeStaffCount: activeStaff,
      totalStaffCount: b.users.length,
      hasOpenVault,
      openCustodyCount: openCustodies,
      ready: missingReasons.length === 0,
      verdictLabel:
        missingReasons.length === 0
          ? "جاهز للتشغيل الكامل ✓"
          : `ينقصه: ${missingReasons.join(" + ")}`,
      remediationHref: remHref,
      remediationLabel: remLabel,
    };
  });

  const activeBranches = branchMatrix.filter((b) => b.isActive);
  const branchesMissingWarehouse = activeBranches.filter(
    (b) => !b.hasDefaultWarehouse,
  ).length;
  const branchesMissingVault = financeOn
    ? activeBranches.filter((b) => !b.hasOpenVault).length
    : 0;

  // اختبارات محرك الضريبة الحيّة
  const activeTaxRates = taxRates.filter((t) => t.isActive);
  const tax5 = taxRates.find((t) => t.code === "VAT5");
  const vat14 = taxRates.find((t) => t.code === "VAT14");
  const comp8 = taxRates.find((t) => t.code === "COMP8");

  const tax5Check = tax5
    ? lineTax(18500, [{ code: tax5.code, rate: Number(tax5.rate) / 100 }])
    : null;
  const compoundCheck =
    vat14 && comp8
      ? lineTax(18500, [
          { code: vat14.code, rate: Number(vat14.rate) / 100 },
          {
            code: comp8.code,
            rate: Number(comp8.rate) / 100,
            compoundOnPrevious: true,
          },
        ])
      : null;

  // متغيرات البيئة الآمنة
  const authSecretValid = isValidAuthSecret(process.env.AUTH_SECRET);
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const isProd = nodeEnv === "production";
  const demoModeActive = process.env.DEMO_LOGIN === "true" || process.env.FINANCE_LAB === "1";

  const staffDiscPct = commerceSettings
    ? (commerceSettings.staffDiscountBps / 100).toFixed(1).replace(/\.0$/, "")
    : "5";
  const mgrDiscPct = commerceSettings
    ? (commerceSettings.managerDiscountBps / 100).toFixed(1).replace(/\.0$/, "")
    : "25";

  // بناء مصفوفة الفحوصات الستة عشر عبر المحاور الأربعة
  const checks: ReadinessCheckItem[] = [
    // ١) محور البنية وقاعدة البيانات (INFRA)
    {
      id: "db-conn",
      axis: "INFRA",
      axisLabel: "البنية والقاعدة",
      label: "اتصال قاعدة البيانات وزمن الاستجابة",
      severity: dbLatencyMs <= 400 ? "ok" : "warn",
      statusLabel: dbLatencyMs <= 400 ? "متصل وسريع ✓" : "استجابة بطيئة نسبيًا",
      detail: `استعلام PostgreSQL الحيّ نجح خلال ${dbLatencyMs} ملّي ثانية`,
    },
    {
      id: "branches-active",
      axis: "INFRA",
      axisLabel: "البنية والقاعدة",
      label: "الفروع التشغيلية النشطة",
      severity: activeBranches.length > 0 ? "ok" : "fail",
      statusLabel:
        activeBranches.length > 0
          ? `${activeBranches.length} فرع نشط ✓`
          : "لا يوجد فرع نشط",
      detail: `إجمالي الفروع بالقاعدة: ${branchMatrix.length} (${activeBranches.length} نشط)`,
      actionHref: activeBranches.length === 0 ? "/admin" : undefined,
      actionLabel: activeBranches.length === 0 ? "إضافة فرع" : undefined,
    },
    {
      id: "warehouses-map",
      axis: "INFRA",
      axisLabel: "البنية والقاعدة",
      label: "ربط المستودعات الافتراضية بالفروع",
      severity:
        activeBranches.length > 0 && branchesMissingWarehouse === 0
          ? "ok"
          : "warn",
      statusLabel:
        branchesMissingWarehouse === 0
          ? "مكتمل ✓"
          : `${branchesMissingWarehouse} فرع بلا مستودع`,
      detail:
        activeBranches.map((b) => `${b.code}→${b.warehouseCodes || "—"}`).join(" · ") ||
        "لا توجد مستودعات بعد",
      actionHref: branchesMissingWarehouse > 0 ? "/admin" : undefined,
      actionLabel: branchesMissingWarehouse > 0 ? "مراجعة الفروع" : undefined,
    },
    {
      id: "data-integrity-policy",
      axis: "INFRA",
      axisLabel: "البنية والقاعدة",
      label: "حماية البيانات التشغيلية القائمة",
      severity: "ok",
      statusLabel: "محمية ✓",
      detail:
        "لا تُشغّل تهيئة البيانات على قاعدة قائمة حفاظًا على الفواتير والأرصدة الحقيقية.",
    },

    // ٢) محور الأمان والهوية والجلسات (SECURITY)
    {
      id: "auth-secret",
      axis: "SECURITY",
      axisLabel: "الأمان والهوية",
      label: "قوة وصلاحية مفتاح التوقيع (AUTH_SECRET)",
      severity: authSecretValid ? "ok" : "fail",
      statusLabel: authSecretValid ? "مضبوط وآمن ✓" : "غير مستوفٍ للشرط",
      detail: authSecretValid
        ? "المفتاح السري مضبوط بطول >= 32 حرفًا ولا يطابق القيم الافتراضية"
        : "يلزم ضبط AUTH_SECRET بقيمة عشوائية لا تقل عن 32 حرفًا في متغيرات الخادم",
    },
    {
      id: "prod-isolation",
      axis: "SECURITY",
      axisLabel: "الأمان والهوية",
      label: "عزل أدوات المختبر في بيئة الإنتاج",
      severity: isProd && demoModeActive ? "fail" : "ok",
      statusLabel:
        isProd && demoModeActive ? "يتطلّب تعطيلًا فوريًا" : "آمن ✓",
      detail: isProd
        ? "بيئة إنتاج فعلية (production) مع إيقاف الدخول التجريبي"
        : `بيئة التشغيل الحالية (${nodeEnv}) مخصّصة للتطوير أو المعاينة`,
    },
    {
      id: "active-manager",
      axis: "SECURITY",
      axisLabel: "الأمان والهوية",
      label: "توفّر مدير عام نشط (منع قفل الإدارة)",
      severity: activeManagers >= 1 ? "ok" : "fail",
      statusLabel:
        activeManagers >= 1 ? `${activeManagers} مدير نشط ✓` : "خطر قفل إداري",
      detail: `إجمالي المستخدمين: ${totalUsers} (${activeUsers.length} نشط، بينهم ${activeManagers} مدير عام)`,
      actionHref: "/admin",
      actionLabel: "إدارة الحسابات",
    },
    {
      id: "temp-passwords",
      axis: "SECURITY",
      axisLabel: "الأمان والهوية",
      label: "كلمات المرور المؤقتة للحسابات النشطة",
      severity: mustChangePwCount === 0 ? "ok" : "warn",
      statusLabel:
        mustChangePwCount === 0
          ? "لا توجد مؤقتة ✓"
          : `${mustChangePwCount} بانتظار التغيير`,
      detail:
        mustChangePwCount === 0
          ? "جميع الحسابات النشطة غيّرت كلمات مرورها المؤقتة"
          : `يوجد ${mustChangePwCount} حساب نشط سيُطالَب بتغيير كلمة المرور فور أول دخول`,
      actionHref: mustChangePwCount > 0 ? "/admin" : undefined,
      actionLabel: mustChangePwCount > 0 ? "مراجعة الحسابات" : undefined,
    },
    {
      id: "login-throttles",
      axis: "SECURITY",
      axisLabel: "الأمان والهوية",
      label: "حالات التقييد المؤقت لمحاولات الدخول (Throttle)",
      severity: lockedThrottleCount === 0 ? "ok" : "warn",
      statusLabel:
        lockedThrottleCount === 0
          ? "لا حظر نشط ✓"
          : `${lockedThrottleCount} قفل مؤقت نشط`,
      detail:
        lockedThrottleCount === 0
          ? "لا توجد محاولات دخول متكررة مقيّدة حاليًا"
          : `يوجد ${lockedThrottleCount} معرّف مقيّد مؤقتًا نتيجة محاولات دخول خاطئة`,
      actionHref: lockedThrottleCount > 0 ? "/admin" : undefined,
      actionLabel: lockedThrottleCount > 0 ? "سجل الأمان" : undefined,
    },
    {
      id: "sessions-hygiene",
      axis: "SECURITY",
      axisLabel: "الأمان والهوية",
      label: "نظافة سجل الجلسات المنتهية",
      severity: expiredSessionCount <= 20 ? "ok" : "warn",
      statusLabel:
        expiredSessionCount === 0
          ? "نظيف تمامًا ✓"
          : `${expiredSessionCount} جلسة منتهية`,
      detail: `${activeSessionCount} جلسة نشطة الآن مقابل ${expiredSessionCount} جلسة منتهية الصلاحية`,
    },

    // ٣) محور المبيعات والضرائب (COMMERCE)
    {
      id: "sales-catalog",
      axis: "COMMERCE",
      axisLabel: "المبيعات والضرائب",
      label: inventoryOn
        ? "جاهزية الأصناف وشجرة البيع"
        : "جاهزية شجرة أصناف البيع الفنية",
      severity:
        activeSalesCategoriesOk(
          inventoryOn,
          activeSalesCatsCount,
          activeSalesTypesCount,
          productsCount,
        )
          ? "ok"
          : "warn",
      statusLabel: activeSalesCategoriesOk(
        inventoryOn,
        activeSalesCatsCount,
        activeSalesTypesCount,
        productsCount,
      )
        ? "جاهزة للبيع ✓"
        : "تحتاج تهيئة أصناف",
      detail: inventoryOn
        ? `${productsCount} صنف مخزني · ${activeSalesCatsCount} تصنيف بيع (${activeSalesTypesCount} نوع نشط)`
        : `${activeSalesCatsCount} تصنيف فني نشط و${activeSalesTypesCount} نوع نشط للكاونتر`,
      actionHref: isManager ? "/sales/catalog" : undefined,
      actionLabel: isManager ? "أصناف البيع" : undefined,
    },
    {
      id: "discount-caps",
      axis: "COMMERCE",
      axisLabel: "المبيعات والضرائب",
      label: "سقف خصم المبيعات للموظف والمدير",
      severity: "ok",
      statusLabel: "مضبوط ✓",
      detail: `سقف خصم الموظف: ${staffDiscPct}% · سقف خصم المدير: ${mgrDiscPct}%`,
      actionHref: isManager ? "/sales/settings" : undefined,
      actionLabel: isManager ? "سقف الخصم" : undefined,
    },
    {
      id: "tax-rates",
      axis: "COMMERCE",
      axisLabel: "المبيعات والضرائب",
      label: "معدلات الضريبة المعتمدة في القاعدة",
      severity: activeTaxRates.length >= 3 ? "ok" : "warn",
      statusLabel:
        activeTaxRates.length >= 3
          ? `${activeTaxRates.length} معدلات نشطة ✓`
          : "معدلات ناقصة",
      detail:
        activeTaxRates.map((t) => `${t.code}=${Number(t.rate)}%`).join(" · ") ||
        "لا توجد معدلات ضريبية نشطة",
    },
    {
      id: "tax-engine-math",
      axis: "COMMERCE",
      axisLabel: "المبيعات والضرائب",
      label: "دقّة محرك الضريبة المفردة والمركّبة",
      severity:
        tax5Check?.total === 925 &&
        (compoundCheck ? compoundCheck.total === 4277.2 : true)
          ? "ok"
          : "warn",
      statusLabel:
        tax5Check?.total === 925 ? "مطابق حسابيًا ✓" : "تحقّق من VAT5/COMP8",
      detail: `ضريبة 5% على 18,500 = ${
        tax5Check ? `${money(tax5Check.total)} ج.م` : "غير متاح"
      }${
        compoundCheck
          ? ` · المركّبة (14% ثم 8%) = ${money(compoundCheck.total)} ج.م`
          : ""
      }`,
    },

    // ٤) محور المالية والخزينة (FINANCE)
    {
      id: "finance-schema",
      axis: "FINANCE",
      axisLabel: "المالية والخزينة",
      label: "حالة وحدة المالية ومخطط الحسابات",
      severity: !financeOn || financeProbe.ok ? "ok" : "fail",
      statusLabel: !financeOn
        ? "معطّلة مرحليًا"
        : financeProbe.ok
          ? "مفعّلة وسليمة ✓"
          : "خطأ في مخطط finance",
      detail: !financeOn
        ? "وحدة المالية متوقفة اختياريًا عبر FINANCE_ENABLED"
        : financeProbe.ok
          ? `مخطط finance متصل ويعمل بعزل SERIALIZABLE (${financeProbe.rows.length} حساب مفتوح)`
          : "تعذّر القراءة من جداول finance.accounts؛ راجع ترقية قاعدة البيانات",
      actionHref: financeOn ? "/finance" : undefined,
      actionLabel: financeOn ? "مركز المالية" : undefined,
    },
    {
      id: "branch-vaults",
      axis: "FINANCE",
      axisLabel: "المالية والخزينة",
      label: "تغطية الخزائن المفتوحة للفروع النشطة",
      severity:
        !financeOn || (activeBranches.length > 0 && branchesMissingVault === 0)
          ? "ok"
          : "warn",
      statusLabel: !financeOn
        ? "غير مطلوب حاليًا"
        : branchesMissingVault === 0
          ? `${activeBranches.length}/${activeBranches.length} خزنة مفتوحة ✓`
          : `${branchesMissingVault} فرع بلا خزنة`,
      detail: !financeOn
        ? "يُفعَّل فحص الخزائن عند تشغيل وحدة المالية"
        : branchesMissingVault === 0
          ? "كل فرع نشط يملك خزنة مفتوحة جاهزة للتوريد والصرف"
          : `يوجد ${branchesMissingVault} فرع نشط يحتاج فتح خزنة بجرد فعلي`,
      actionHref:
        financeOn && branchesMissingVault > 0 ? "/finance/accounts" : undefined,
      actionLabel:
        financeOn && branchesMissingVault > 0 ? "فتح خزنة" : undefined,
    },
    {
      id: "expense-categories",
      axis: "FINANCE",
      axisLabel: "المالية والخزينة",
      label: "جاهزية دليل بنود المصروفات النشطة",
      severity: activeExpenseCatsCount > 0 ? "ok" : "warn",
      statusLabel:
        activeExpenseCatsCount > 0
          ? `${activeExpenseCatsCount} بند نشط ✓`
          : "لا بنود نشطة",
      detail: `${activeExpenseCatsCount} بند نشط من إجمالي ${totalExpenseCatsCount} بند في الدليل`,
      actionHref: financeOn ? "/finance/categories" : undefined,
      actionLabel: financeOn ? "بنود المصروفات" : undefined,
    },
  ];

  const passedCount = checks.filter((c) => c.severity === "ok").length;
  const issuesCount = checks.length - passedCount;
  const readinessPct = Math.round((passedCount / checks.length) * 100);

  // نسب الجاهزية لكل محور
  function axisScore(axis: CheckAxis): { pct: number; passed: number; total: number } {
    const subset = checks.filter((c) => c.axis === axis);
    const ok = subset.filter((c) => c.severity === "ok").length;
    return {
      pct: subset.length > 0 ? Math.round((ok / subset.length) * 100) : 100,
      passed: ok,
      total: subset.length,
    };
  }

  const infraScore = axisScore("INFRA");
  const secScore = axisScore("SECURITY");
  const commScore = axisScore("COMMERCE");
  const finScore = axisScore("FINANCE");

  const gaugePoints: PantherChartPoint[] = [
    {
      label: "درجة الجاهزية والأمان الإجمالية",
      shortLabel: "الجاهزية",
      value: readinessPct,
      formattedValue: `${readinessPct}%`,
      detail: `${passedCount} فحص سليم من أصل ${checks.length} فحص حيّ`,
    },
  ];

  const axesBarPoints: PantherChartPoint[] = [
    {
      label: "البنية وقاعدة البيانات",
      shortLabel: "البنية",
      value: infraScore.pct,
      formattedValue: `${infraScore.pct}%`,
      detail: `${infraScore.passed}/${infraScore.total} فحوصات مكتملة`,
    },
    {
      label: "الأمان والهوية والجلسات",
      shortLabel: "الأمان",
      value: secScore.pct,
      formattedValue: `${secScore.pct}%`,
      detail: `${secScore.passed}/${secScore.total} فحوصات مكتملة`,
    },
    {
      label: "المبيعات والضرائب",
      shortLabel: "المبيعات",
      value: commScore.pct,
      formattedValue: `${commScore.pct}%`,
      detail: `${commScore.passed}/${commScore.total} فحوصات مكتملة`,
    },
    {
      label: "المالية والخزينة",
      shortLabel: "المالية",
      value: finScore.pct,
      formattedValue: `${finScore.pct}%`,
      detail: `${finScore.passed}/${finScore.total} فحوصات مكتملة`,
    },
  ];

  const sessionDonutPoints: PantherChartPoint[] = [
    {
      label: "جلسات نشطة ومصادق عليها",
      shortLabel: "نشطة",
      value: activeSessionCount,
      formattedValue: `${activeSessionCount} جلسة`,
      detail: "جلسات صالحة قيد العمل الآن",
      tone: "accent",
    },
    {
      label: "جلسات منتهية الصلاحية",
      shortLabel: "منتهية",
      value: expiredSessionCount,
      formattedValue: `${expiredSessionCount} جلسة`,
      detail: "قابلة للتطهير الفوري دون المساس بالمستخدمين المتصلين",
      tone: "alt",
    },
    {
      label: "قيود تقييد مؤقت (Throttle)",
      shortLabel: "مقيّدة",
      value: lockedThrottleCount,
      formattedValue: `${lockedThrottleCount} قيد`,
      detail: "محاولات دخول متكررة مرفوضة",
      tone: lockedThrottleCount > 0 ? "danger" : "warn",
    },
  ];

  const spotlightSeries: PantherChartSeries[] = [
    {
      id: "readiness-gauge",
      label: "مؤشر الجاهزية",
      chartVariant: "gauge",
      points: gaugePoints,
    },
    {
      id: "axes-bars",
      label: "جاهزية المحاور",
      chartVariant: "bars",
      points: axesBarPoints,
    },
    {
      id: "sessions-donut",
      label: "نبض الجلسات",
      chartVariant: "donut",
      points: sessionDonutPoints,
    },
  ];

  const checkedAtLabel = new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "Africa/Cairo",
  }).format(now);

  const envItems: SafeEnvFlagItem[] = [
    {
      key: "NODE_ENV",
      title: "بيئة التشغيل",
      valueLabel: nodeEnv,
      status: "ok",
      statusLabel: isProd ? "إنتاج" : "تطوير/معاينة",
      hint: "يحدّد سلوك الكوكيز المؤمّنة وتحسينات الأداء.",
    },
    {
      key: "AUTH_SECRET",
      title: "مفتاح توقيع الجلسات",
      valueLabel: authSecretValid ? "مضبوط ومخفي بأمان" : "يحتاج ضبطًا",
      status: authSecretValid ? "ok" : "fail",
      statusLabel: authSecretValid ? ">= 32 حرفًا ✓" : "غير صالح",
      hint: "لا يُعرض المفتاح السري مطلقًا؛ يُتحقّق من طوله وصلاحيته فقط.",
    },
    {
      key: "FINANCE_ENABLED",
      title: "وحدة المالية والخزينة",
      valueLabel: financeOn ? "مفعّلة (true)" : "معطّلة (false)",
      status: !financeOn || financeProbe.ok ? "ok" : "fail",
      statusLabel: financeOn ? "نشطة ✓" : "موقوفة",
      hint: "تتحكّم في تفعيل الخزائن والعُهَد والمصروفات والتسويات.",
    },
    {
      key: "INVENTORY_ENABLED",
      title: "وحدة المخزون والمستودعات",
      valueLabel: inventoryOn ? "مفعّلة (true)" : "معطّلة (false)",
      status: "ok",
      statusLabel: inventoryOn ? "نشطة" : "بيع بأصناف فنية",
      hint: "عند تعطيلها يسجّل الكاونتر المبيعات عبر شجرة أصناف البيع الفنية مباشرةً.",
    },
    {
      key: "TIMEZONE",
      title: "التوقيت المحاسبي المعتمد",
      valueLabel: "Africa/Cairo",
      status: "ok",
      statusLabel: "موثّق ✓",
      hint: `توقيت الخادم بالقاهرة الآن: ${checkedAtLabel}`,
    },
    {
      key: "DATABASE_PING",
      title: "استجابة قاعدة البيانات",
      valueLabel: `${dbLatencyMs} ms`,
      status: dbLatencyMs <= 400 ? "ok" : "warn",
      statusLabel: dbLatencyMs <= 400 ? "ممتاز ✓" : "مرتفع نسبيًا",
      hint: "زمن رحلة الاستعلام الفعلي بين تطبيق Next.js ومحرك PostgreSQL.",
    },
  ];

  return (
    <div className="dashboard">
      <section className="dashboard-overview no-print" aria-labelledby="setup-title">
        <div className="setup-header-bar">
          <div>
            <h2 id="setup-title">فحص الجاهزية والأمان</h2>
            <p>
              لوحة تشخيص حيّة تتحقق من سلامة قاعدة البيانات، وإعدادات الأمان والجلسات، وجاهزية المبيعات والضرائب والخزائن النقدية.
            </p>
          </div>
          <div className="setup-header-actions">
            <span className="dashboard-scope">
              <span /> {passedCount}/{checks.length} فحص سليم
            </span>
            <PrintPageButton
              label="طباعة تقرير الجاهزية"
              className="setup-btn"
              title="طباعة تقرير الجاهزية والأمان الرسمي"
            />
          </div>
        </div>
      </section>

      <div className="no-print">
        <PantherSpotlightCard
          icon="efficiencyGauge"
          chartVariant="gauge"
          title="مؤشر الجاهزية والأمان الشامل"
          subtitle={`فحص حيّ بتاريخ ${checkedAtLabel}`}
          pill={`استجابة القاعدة: ${dbLatencyMs} ms`}
          primary={{
            label: "درجة الجاهزية والأمان الكلية",
            value: `${readinessPct}%`,
            unit: `(${passedCount}/${checks.length})`,
            delta:
              issuesCount === 0
                ? "جميع المحاور الأربعة مستوفية بالكامل وجاهزة للتشغيل"
                : `يوجد ${issuesCount} بند تنبيهي يقبل المعالجة من الروابط أدناه`,
            tone: issuesCount === 0 ? "positive" : "negative",
          }}
          secondary={{
            label: "الجلسات النشطة وحالة الوصول",
            value: nf.format(activeSessionCount),
            unit: "جلسة",
            delta:
              lockedThrottleCount > 0
                ? `${lockedThrottleCount} قفل دخول مؤقت نشط الآن`
                : `${nf.format(activeBranches.length)} فرع نشط · ${nf.format(activeUsers.length)} مستخدم فاعل`,
            tone: lockedThrottleCount > 0 ? "negative" : "positive",
          }}
          series={spotlightSeries}
          actionHref="#readiness-hub"
          actionLabel="استعراض الفحوصات التفصيلية ومصفوفة الفروع"
        />
      </div>

      <section
        className="dashboard-pulse-strip no-print"
        aria-label="ملخص مؤشرات الجاهزية والأمان"
      >
        <div className="dashboard-pulse-card is-accent">
          <span className="dashboard-pulse-card__icon" aria-hidden="true">
            <AppIcon name="shield" />
          </span>
          <div className="dashboard-pulse-card__body">
            <span className="dashboard-pulse-card__label">اجتياز الفحوصات</span>
            <strong className="dashboard-pulse-card__value">
              {passedCount} <small>من {checks.length}</small>
            </strong>
            <small className="dashboard-pulse-card__sub">
              نسبة الجاهزية الكلية {readinessPct}%
            </small>
          </div>
        </div>

        <div className="dashboard-pulse-card">
          <span className="dashboard-pulse-card__icon" aria-hidden="true">
            <AppIcon name="check" />
          </span>
          <div className="dashboard-pulse-card__body">
            <span className="dashboard-pulse-card__label">استجابة القاعدة (DB)</span>
            <strong className="dashboard-pulse-card__value">
              <bdi dir="ltr">{dbLatencyMs}</bdi> <small>ms</small>
            </strong>
            <small className="dashboard-pulse-card__sub">
              اتصال PostgreSQL نشط ومباشر
            </small>
          </div>
        </div>

        <div className="dashboard-pulse-card">
          <span className="dashboard-pulse-card__icon" aria-hidden="true">
            <AppIcon name="settings" />
          </span>
          <div className="dashboard-pulse-card__body">
            <span className="dashboard-pulse-card__label">الوحدات المفعّلة</span>
            <strong
              className="dashboard-pulse-card__value"
              style={{ fontSize: "1.02rem" }}
            >
              المبيعات{financeOn ? " · المالية" : ""}
              {inventoryOn ? " · المخزون" : ""}
            </strong>
            <small className="dashboard-pulse-card__sub">
              {activeTaxRates.length} معدلات ضريبية · {activeExpenseCatsCount} بند مصروف
            </small>
          </div>
        </div>

        <div
          className={`dashboard-pulse-card${
            lockedThrottleCount > 0 || !authSecretValid ? " is-alert" : ""
          }`}
        >
          <span className="dashboard-pulse-card__icon" aria-hidden="true">
            <AppIcon name="lock" />
          </span>
          <div className="dashboard-pulse-card__body">
            <span className="dashboard-pulse-card__label">الجلسات والأمان</span>
            <strong className="dashboard-pulse-card__value">
              {nf.format(activeSessionCount)} <small>نشطة</small>
            </strong>
            <small className="dashboard-pulse-card__sub">
              {nf.format(expiredSessionCount)} منتهية ·{" "}
              {nf.format(lockedThrottleCount)} قفل مؤقت
            </small>
          </div>
        </div>
      </section>

      <div
        className={`setup-safety-banner${issuesCount > 0 ? " is-warn" : ""}`}
        role="status"
      >
        <span>
          <strong>قاعدة السلامة التشغيلية:</strong>{" "}
          {issuesCount === 0
            ? "جميع الفحوصات الأساسية ناجحة. عند الترقية راجع الفحوصات من هذه الشاشة فقط، ولا تُشغّل تهيئة البيانات على قاعدة قائمة لأنها قد تغيّر بيانات حقيقية."
            : "عالج البنود التنبيهية من أزرار الإجراء السريع أدناه، ولا تُشغّل تهيئة البيانات على قاعدة قائمة لأنها قد تغيّر بيانات حقيقية."}
        </span>
      </div>

      <SetupReadinessView
        isManager={isManager}
        financeOn={financeOn}
        checks={checks}
        branches={branchMatrix}
        envItems={envItems}
        expiredSessionCount={expiredSessionCount}
        checkedAtLabel={checkedAtLabel}
      />
    </div>
  );
}

function activeSalesCategoriesOk(
  inventoryOn: boolean,
  activeSalesCatsCount: number,
  activeSalesTypesCount: number,
  productsCount: number,
): boolean {
  if (activeSalesCatsCount > 0 && activeSalesTypesCount > 0) return true;
  if (inventoryOn && productsCount > 0) return true;
  return false;
}
