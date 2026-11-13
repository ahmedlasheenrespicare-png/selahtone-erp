import { redirect } from "next/navigation";

import { isSystemAdmin, parseAdminEmails } from "@/lib/access-control";
import { AppIcon } from "@/components/app-icon";
import PantherSpotlightCard, {
  type PantherChartPoint,
  type PantherChartSeries,
} from "@/components/panther-spotlight-card";
import PrintPageButton from "@/components/print-page-button";
import { countShareRingPercent } from "@/components/stat-ring-pill-model";
import { ROLE_LABELS, type AdminRole } from "@/lib/admin-directory";
import { canSeeAllBranches, getSession } from "@/lib/auth";
import { financeEnabled } from "@/lib/finance/db";
import { readDirectoryFinanceAccounts } from "@/lib/admin-directory-operations";
import { getAccessContext, requireSystemAdminOrRedirect } from "@/lib/access-control-server";
import { prisma } from "@/lib/prisma";
import type { BranchRow, UserRow } from "./admin-forms";
import PermissionsPanel from "./permissions-panel";
import AdminHubView, { type SecurityAttemptRow } from "./admin-hub-view";
import "./admin.css";

export const dynamic = "force-dynamic";

const ATTEMPT_LABELS: Record<
  SecurityAttemptRow["resultCode"],
  { label: string; tone: SecurityAttemptRow["tone"] }
> = {
  SUCCESS: { label: "دخول ناجح", tone: "ok" },
  FAILED: { label: "بيانات دخول خاطئة", tone: "err" },
  THROTTLED: { label: "تقييد مؤقت (محاولات متكررة)", tone: "warn" },
  PASSWORD_CHANGE_SUCCESS: { label: "تغيير كلمة المرور", tone: "info" },
  PASSWORD_CHANGE_FAILED: { label: "تعذّر تغيير كلمة المرور", tone: "warn" },
  PASSWORD_RESET: { label: "تصفير كلمة المرور من الإدارة", tone: "info" },
};

/**
 * Executive governance center for branches, users, permissions, financial custodies & auth audit.
 */
export default async function AdminPage() {
  const session = await getSession();
  await requireSystemAdminOrRedirect();
  if (!session) redirect("/login");
  if (session.mustChangePassword) redirect("/change-password");
  if (!canSeeAllBranches(session)) {
    return (
      <div className="dashboard">
        <div className="alert alert-err" role="alert">
          إدارة الفروع والمستخدمين متاحة للمدير والمحاسب فقط.
        </div>
      </div>
    );
  }

  const access = await getAccessContext();
  let permissionRows: { subject_kind: string; subject: string; key: string; allowed: boolean }[] = [];
  let permissionsHealthy = access.storeHealthy;
  if (permissionsHealthy) {
    try {
      permissionRows = await prisma.$queryRaw`SELECT subject_kind, subject, key, allowed FROM public.access_control`;
    } catch {
      permissionsHealthy = false;
    }
  }

  const now = new Date();
  const financeOn = financeEnabled();

  const [
    branches,
    users,
    activeSessionGroups,
    lastLoginGroups,
    recentAttempts,
    activeThrottlesCount,
    openFinanceAccounts,
  ] = await Promise.all([
    prisma.branch.findMany({
      orderBy: { code: "asc" },
      include: { _count: { select: { users: true, warehouses: true } } },
    }),
    prisma.user.findMany({
      orderBy: [{ roleCode: "asc" }, { fullName: "asc" }],
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        roleCode: true,
        branchId: true,
        status: true,
        mustChangePassword: true,
        branch: { select: { nameAr: true } },
      },
    }),
    prisma.authSession
      .groupBy({
        by: ["userId"],
        where: { expiresAt: { gt: now } },
        _count: { _all: true },
      })
      .catch(() => []),
    prisma.loginAttempt
      .groupBy({
        by: ["userId"],
        where: { result: "SUCCESS", userId: { not: null } },
        _max: { createdAt: true },
      })
      .catch(() => []),
    prisma.loginAttempt
      .findMany({
        orderBy: { id: "desc" },
        take: 120,
        include: {
          user: {
            select: {
              fullName: true,
              roleCode: true,
              branch: { select: { nameAr: true } },
            },
          },
        },
      })
      .catch(() => []),
    prisma.loginThrottle
      .count({
        where: { lockedUntil: { gt: now } },
      })
      .catch(() => 0),
    readDirectoryFinanceAccounts(prisma, financeOn),
  ]);

  const financeSummaryVisible = financeOn && openFinanceAccounts.state === "ready";

  // خرائط الجلسات وآخر دخول
  let totalActiveSessions = 0;
  const activeSessionByUser = new Map<string, number>();
  for (const g of activeSessionGroups) {
    activeSessionByUser.set(g.userId.toString(), g._count._all);
    totalActiveSessions += g._count._all;
  }

  const lastLoginFmt = new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Africa/Cairo",
  });
  const cairoDayFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const lastLoginByUser = new Map<string, string>();
  for (const g of lastLoginGroups) {
    if (g.userId !== null && g._max.createdAt) {
      lastLoginByUser.set(
        g.userId.toString(),
        lastLoginFmt.format(g._max.createdAt),
      );
    }
  }

  // خرائط الخزائن والعُهَد المفتوحة (بلا كشف أي أرصدة)
  const openVaultByBranch = new Set<string>();
  const openCustodyCountByBranch = new Map<string, number>();
  const openCustodyByUser = new Map<string, string>();

  for (const acc of openFinanceAccounts.rows) {
    if (acc.kind === "VAULT") {
      openVaultByBranch.add(acc.branchId);
    } else if (acc.kind === "CUSTODY") {
      openCustodyCountByBranch.set(
        acc.branchId,
        (openCustodyCountByBranch.get(acc.branchId) ?? 0) + 1,
      );
      if (acc.holderId && !openCustodyByUser.has(acc.holderId)) {
        openCustodyByUser.set(acc.holderId, acc.id);
      }
    }
  }

  // عدد الموظفين النشطين لكل فرع
  const activeStaffByBranch = new Map<string, number>();
  let managerCount = 0;
  let accountantCount = 0;
  let agentCount = 0;
  let activeUsersCount = 0;
  let mustChangePwCount = 0;

  for (const user of users) {
    if (user.roleCode === "MANAGER") managerCount += 1;
    else if (user.roleCode === "ACCOUNTANT") accountantCount += 1;
    else agentCount += 1;

    if (user.status === "ACTIVE") {
      activeUsersCount += 1;
      if (user.branchId !== null) {
        const bKey = user.branchId.toString();
        activeStaffByBranch.set(bKey, (activeStaffByBranch.get(bKey) ?? 0) + 1);
      }
    }
    if (user.mustChangePassword) mustChangePwCount += 1;
  }

  const branchRows: BranchRow[] = branches.map((b) => {
    const bId = b.id.toString();
    return {
      id: bId,
      code: b.code,
      nameAr: b.nameAr,
      city: b.city,
      phone: b.phone,
      invoicePrefix: b.invoicePrefix,
      isActive: b.isActive,
      userCount: b._count.users,
      activeUserCount: activeStaffByBranch.get(bId) ?? 0,
      warehouseCount: b._count.warehouses,
      hasOpenVault: openVaultByBranch.has(bId),
      openCustodyCount: openCustodyCountByBranch.get(bId) ?? 0,
    };
  });

  const userRows: UserRow[] = users.map((u) => {
    const uId = u.id.toString();
    return {
      id: uId,
      fullName: u.fullName,
      email: u.email,
      phone: u.phone,
      role: u.roleCode as AdminRole,
      branchId: u.branchId === null ? null : u.branchId.toString(),
      branchName: u.branch?.nameAr ?? null,
      isActive: u.status === "ACTIVE",
      mustChangePassword: u.mustChangePassword,
      isSelf: uId === session.id,
      activeSessionCount: activeSessionByUser.get(uId) ?? 0,
      lastLoginLabel: lastLoginByUser.get(uId) ?? null,
      openCustodyId: openCustodyByUser.get(uId) ?? null,
    };
  });

  // بناء سجل الأمان + منحنى الـ ٧ أيام الأخيرة
  const last7Days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86_400_000);
    last7Days.push(cairoDayFmt.format(d));
  }
  const dayAuthStats = new Map<string, { ok: number; fail: number }>();
  for (const dKey of last7Days) {
    dayAuthStats.set(dKey, { ok: 0, fail: 0 });
  }

  let recentFailedOrThrottled = 0;

  const securityRows: SecurityAttemptRow[] = recentAttempts.map((att) => {
    const code = att.result as SecurityAttemptRow["resultCode"];
    const meta = ATTEMPT_LABELS[code] ?? { label: code, tone: "info" as const };
    const dayKey = cairoDayFmt.format(att.createdAt);
    const stat = dayAuthStats.get(dayKey);
    if (stat) {
      if (code === "SUCCESS") stat.ok += 1;
      else if (code === "FAILED" || code === "THROTTLED") {
        stat.fail += 1;
        recentFailedOrThrottled += 1;
      }
    }

    return {
      id: att.id.toString(),
      userFullName: att.user?.fullName ?? null,
      userRoleLabel: att.user?.roleCode
        ? ROLE_LABELS[att.user.roleCode as AdminRole] ?? att.user.roleCode
        : null,
      branchName: att.user?.branch?.nameAr ?? null,
      shortIdentifierHash: `${att.identifierHash.slice(0, 10)}…`,
      resultCode: code,
      resultLabel: meta.label,
      tone: meta.tone,
      timestampFormatted: lastLoginFmt.format(att.createdAt),
    };
  });

  const activeBranches = branchRows
    .filter((b) => b.isActive)
    .map((b) => ({ id: b.id, nameAr: b.nameAr, code: b.code }));

  const vaultsReadyCount = branchRows.filter(
    (b) => b.isActive && b.hasOpenVault,
  ).length;

  // السلاسل التفاعلية لبطاقة المؤشر التنفيذي
  const branchTeamPoints: PantherChartPoint[] =
    branchRows.length > 0
      ? branchRows.map((b) => ({
          label: b.nameAr,
          shortLabel: b.code,
          value: b.activeUserCount,
          formattedValue: `${b.activeUserCount} موظف نشط`,
          secondaryValue: financeSummaryVisible ? b.openCustodyCount : b.warehouseCount,
          secondaryLabel: financeSummaryVisible ? "العُهَد المفتوحة" : "المستودعات",
          secondaryFormatted: financeSummaryVisible
            ? `${b.openCustodyCount} عهدة`
            : `${b.warehouseCount} مستودع`,
          detail: `${b.isActive ? "نشط" : "موقوف"} · ${
            financeSummaryVisible
              ? b.hasOpenVault
                ? "خزنة مفتوحة"
                : "بانتظار فتح خزنة"
              : `${b.warehouseCount} مستودع`
          }`,
        }))
      : [
          {
            label: "لا توجد فروع بعد",
            shortLabel: "—",
            value: 0,
            formattedValue: "0 فرع",
          },
        ];

  const roleMixPoints: PantherChartPoint[] = [
    {
      label: "موظفو الفروع (CS_AGENT)",
      shortLabel: "موظف فرع",
      value: agentCount,
      formattedValue: `${agentCount} حساب`,
      detail: "عمليات البيع والتحصيل والعهدة داخل الفرع",
      tone: "accent",
    },
    {
      label: "المحاسبون (ACCOUNTANT)",
      shortLabel: "محاسب",
      value: accountantCount,
      formattedValue: `${accountantCount} حساب`,
      detail: "إشراف مالي ورقابة على جميع الفروع",
      tone: "alt",
    },
    {
      label: "المديرون العامّون (MANAGER)",
      shortLabel: "مدير",
      value: managerCount,
      formattedValue: `${managerCount} حساب`,
      detail: "صلاحية كاملة على الفروع والمستخدمين والإعدادات",
      tone: "warn",
    },
  ];

  const authPulsePoints: PantherChartPoint[] = last7Days.map((dKey) => {
    const st = dayAuthStats.get(dKey) ?? { ok: 0, fail: 0 };
    return {
      label: `يوم ${dKey}`,
      shortLabel: dKey.slice(5),
      value: st.ok,
      formattedValue: `${st.ok} دخول ناجح`,
      secondaryValue: st.fail,
      secondaryLabel: "محاولات مرفوضة",
      secondaryFormatted: `${st.fail} مرفوضة`,
      detail:
        st.fail > 0
          ? `${st.ok} ناجح مقابل ${st.fail} محاولة مرفوضة`
          : `${st.ok} عملية دخول ناجحة بلا رفض`,
    };
  });

  const spotlightSeries: PantherChartSeries[] = [
    {
      id: "branch-team",
      label: "الفروع والفريق",
      chartVariant: "columns",
      points: branchTeamPoints,
    },
    {
      id: "roles-mix",
      label: "هيكل الأدوار",
      chartVariant: "donut",
      points: roleMixPoints,
    },
    {
      id: "auth-pulse",
      label: "نبض الدخول (٧ أيام)",
      chartVariant: "area",
      points: authPulsePoints,
    },
  ];

  return (
    <div className="dashboard">
      <section className="dashboard-overview no-print" aria-labelledby="admin-title">
        <div className="admin-header-bar">
          <div>
            <h2 id="admin-title">الفروع والمستخدمون</h2>
            <p>
              مركز موحّد لإدارة الفروع والمستودعات، وحوكمة صلاحيات المستخدمين والعُهَد، ومراقبة الجلسات وسجل الأمان.
            </p>
          </div>
          <div className="admin-header-actions">
            <span className="dashboard-scope">
              <span />
              {session.role === "MANAGER"
                ? "صلاحية المدير العام"
                : "صلاحية المحاسب (عرض + موظفو الفروع)"}
            </span>
            <PrintPageButton
              label="طباعة الدليل"
              className="admin-ghost-btn"
              title="طباعة دليل الفروع والمستخدمين والصلاحيات"
            />
          </div>
        </div>
      </section>

      <div className="no-print">
        <PantherSpotlightCard
          icon="branchScorecard"
          chartVariant="columns"
          title="حوكمة الفروع والفريق وأمان الوصول"
          subtitle={`محدّث الآن · ${activeBranches.length} فرع نشط و${activeUsersCount} حساب فاعل`}
          pill={`${totalActiveSessions} جلسة متصلة الآن`}
          primary={{
            label: "المستخدمون النشطون بالنظام",
            value: String(activeUsersCount),
            unit: `من ${userRows.length}`,
            delta: `${managerCount} مدير · ${accountantCount} محاسب · ${agentCount} موظف فرع`,
            tone: "positive",
          }}
          secondary={{
            label: financeSummaryVisible ? "جاهزية خزائن الفروع النشطة" : "الفروع النشطة بالتشغيل",
            value: financeSummaryVisible
              ? `${vaultsReadyCount}/${activeBranches.length}`
              : String(activeBranches.length),
            unit: "فرع",
            delta:
              activeThrottlesCount > 0
                ? `${activeThrottlesCount} قيد تقييد دخول مؤقت نشط الآن`
                : mustChangePwCount > 0
                  ? `${mustChangePwCount} حساب بانتظار تغيير كلمة المرور المؤقتة`
                  : "جميع الحسابات النشطة مستوفية لسياسة الأمان",
            tone: activeThrottlesCount > 0 ? "negative" : "positive",
            // للعرض فقط: نفس مقام بطاقة المالية (الفروع النشطة)، وبسطها الفروع المغطاة بخزنة مفتوحة.
            // بلا ملخص مالي متاح تبقى البطاقة بلا حلقة ولا تعرض تغطية مضللة.
            ...(financeSummaryVisible
              ? {
                  ring: {
                    percent: countShareRingPercent({
                      partCount: vaultsReadyCount,
                      totalCount: activeBranches.length,
                    }),
                    percentLabel: "نسبة الفروع النشطة المغطاة بخزنة مفتوحة من إجمالي الفروع النشطة",
                    emptyLabel: activeBranches.length === 0 ? "لا فروع" : "غير متاح",
                  },
                }
              : {}),
          }}
          series={spotlightSeries}
          actionHref="#admin-directory"
          actionLabel="الانتقال إلى إدارة المستخدمين والفروع وسجل الأمان"
        />
      </div>

      <section
        className="dashboard-pulse-strip no-print"
        aria-label="ملخص الفروع والمستخدمين والأمان"
      >
        <div className="dashboard-pulse-card is-accent">
          <span className="dashboard-pulse-card__icon" aria-hidden="true">
            <AppIcon name="branch" />
          </span>
          <div className="dashboard-pulse-card__body">
            <span className="dashboard-pulse-card__label">الفروع التشغيلية</span>
            <strong className="dashboard-pulse-card__value">
              {activeBranches.length} <small>نشط من {branchRows.length}</small>
            </strong>
            <small className="dashboard-pulse-card__sub">
              {financeSummaryVisible
                ? `${vaultsReadyCount} فرع بخزنة مفتوحة`
                : "مستودع افتراضي مستقل لكل فرع"}
            </small>
          </div>
        </div>

        <div className="dashboard-pulse-card">
          <span className="dashboard-pulse-card__icon" aria-hidden="true">
            <AppIcon name="shield" />
          </span>
          <div className="dashboard-pulse-card__body">
            <span className="dashboard-pulse-card__label">الفريق النشط</span>
            <strong className="dashboard-pulse-card__value">
              {activeUsersCount} <small>من {userRows.length}</small>
            </strong>
            <small className="dashboard-pulse-card__sub">
              {userRows.length - activeUsersCount} موقوف ·{" "}
              {openCustodyByUser.size} بعهدة نقدية مفتوحة
            </small>
          </div>
        </div>

        <div className="dashboard-pulse-card">
          <span className="dashboard-pulse-card__icon" aria-hidden="true">
            <AppIcon name="check" />
          </span>
          <div className="dashboard-pulse-card__body">
            <span className="dashboard-pulse-card__label">الجلسات المفتوحة الآن</span>
            <strong className="dashboard-pulse-card__value">
              {totalActiveSessions} <small>جلسة</small>
            </strong>
            <small className="dashboard-pulse-card__sub">
              موزّعة على {activeSessionByUser.size} مستخدم متصل
            </small>
          </div>
        </div>

        <div
          className={`dashboard-pulse-card${
            activeThrottlesCount > 0 || recentFailedOrThrottled >= 3
              ? " is-alert"
              : ""
          }`}
        >
          <span className="dashboard-pulse-card__icon" aria-hidden="true">
            <AppIcon name="lock" />
          </span>
          <div className="dashboard-pulse-card__body">
            <span className="dashboard-pulse-card__label">الأمان وكلمات المرور</span>
            <strong className="dashboard-pulse-card__value">
              {mustChangePwCount} <small>مؤقتة</small>
            </strong>
            <small className="dashboard-pulse-card__sub">
              {activeThrottlesCount > 0
                ? `${activeThrottlesCount} حظر مؤقت نشط الآن`
                : `${recentFailedOrThrottled} محاولة دخول مرفوضة خلال ٧ أيام`}
            </small>
          </div>
        </div>
      </section>

      {openFinanceAccounts.state === "unavailable" && <div className="alert alert-err" role="alert">تعذّر التحقق من العهد النقدية؛ الأرقام المعروضة ليست دليلًا على عدم وجود عهد. تُمنع التغييرات المقيّدة حتى إصلاح القراءة.</div>}
      {!financeOn && openFinanceAccounts.state === "ready" && <div className="alert alert-err" role="alert">المالية معطّلة في الواجهة، لكن جداولها موجودة ويستمر فحص العهد قبل نقل أو إيقاف المستخدم وإيقاف الفرع. تواصل مع مسؤول النظام لترتيب أي معالجة معتمدة.</div>}

      <PermissionsPanel users={userRows.map((user) => ({ ...user, isSystemAdmin: isSystemAdmin(user.role, user.email, parseAdminEmails(process.env.ADMIN_EMAILS)) }))} rows={permissionRows} healthy={permissionsHealthy} />

      <AdminHubView
        actorRole={session.role as AdminRole}
        financeOn={financeOn}
        financeAccountsKnown={openFinanceAccounts.state !== "unavailable"}
        users={userRows}
        branches={branchRows}
        activeBranches={activeBranches}
        securityRows={securityRows}
        activeThrottlesCount={activeThrottlesCount}
      />
    </div>
  );
}
