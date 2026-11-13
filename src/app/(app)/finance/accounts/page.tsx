import { custodyRequestSnapshot } from "@/lib/finance/custody-request-snapshot";
import { writeAllowedForKeys } from "@/lib/access-control";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppIcon } from "@/components/app-icon";
import DataTable from "@/components/data-driven/data-table";
import { FinKpiStrip } from "@/components/finance/fin-kpi-strip";
import { FinStepper } from "@/components/finance/fin-stepper";
import { countShareRingPercent } from "@/components/stat-ring-pill-model";
import { getSession } from "@/lib/auth";
import { assertFinanceActor, financeDb, financeEnabled } from "@/lib/finance/db";
import { listAccounts, listCustodyRequests } from "@/lib/finance/engine";
import { computeBranchAccountCoverage } from "@/lib/finance/new-account-helpers";
import { cairoDate } from "@/lib/finance/validation";
import { getAccessContext, requirePageAccess } from "@/lib/access-control-server";
import { prisma } from "@/lib/prisma";
import { formatMoney } from "../format";
import AccountForm, { type BranchOption, type StaffOption } from "./account-form";
import { CustodyRequestDecision } from "./custody-request-decision";
import { openAccountSummaryColumns, type OpenAccountSummaryRow } from "./open-account-summary-metadata";
import "./accounts.css";

export const dynamic = "force-dynamic";

export default async function FinanceAccountsPage({
  searchParams,
}: {
  searchParams?: Promise<{ kind?: string; branchId?: string; holderId?: string }>;
}) {
  const session = await getSession();
  await requirePageAccess("/finance/accounts");
  const access = await getAccessContext();
  const canOpenAccount = writeAllowedForKeys(access.hidden, "/finance/accounts#open");
  const canDecideCustody = writeAllowedForKeys(access.hidden, "/finance/accounts#decide-custody");
  if (!session) redirect("/login");
  if (session.mustChangePassword) redirect("/change-password");
  if (!financeEnabled()) redirect("/dashboard");

  const canManage = session.role === "MANAGER" || session.role === "ACCOUNTANT";
  if (!canManage) {
    return (
      <div className="fin-page">
        <Link href="/finance" className="fin-back">
          العودة إلى المالية
        </Link>
        <div className="fin-alert fin-alert--error">
          فتح الحسابات النقدية متاح للمدير والمحاسب فقط.
        </div>
      </div>
    );
  }

  const resolvedParams = searchParams ? await searchParams : undefined;
  const initialKind =
    resolvedParams?.kind === "CUSTODY"
      ? "CUSTODY"
      : resolvedParams?.kind === "VAULT"
        ? "VAULT"
        : undefined;
  const initialBranchId =
    typeof resolvedParams?.branchId === "string" ? resolvedParams.branchId.trim() : undefined;
  const initialHolderId =
    typeof resolvedParams?.holderId === "string" ? resolvedParams.holderId.trim() : undefined;

  const [branches, staff, { accounts, pendingRequests }] = await Promise.all([
    prisma.branch.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      select: { id: true, nameAr: true, code: true },
    }),
    prisma.user.findMany({
      where: { status: "ACTIVE", roleCode: "CS_AGENT", branchId: { not: null } },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, branchId: true },
    }),
    financeDb.serializable(async (tx) => {
      await assertFinanceActor(tx, {
        id: session.id,
        role: session.role,
        branchId: session.branchId,
      });
      const subDb = { serializable: <T,>(work: (t: typeof tx) => Promise<T>) => work(tx) };
      const loadedAccounts = await listAccounts(subDb, session.id);
      const loadedRequests = canDecideCustody ? await listCustodyRequests(subDb, session.id, "PENDING") : [];
      return { accounts: loadedAccounts, pendingRequests: loadedRequests };
    }),
  ]);

  const branchOptions: BranchOption[] = branches.map((branch) => ({
    id: branch.id.toString(),
    name: branch.nameAr,
    code: branch.code,
  }));
  const branchNameById = new Map(branchOptions.map((b) => [b.id, b.name]));

  const staffOptions: StaffOption[] = staff
    .filter((member) => member.branchId !== null)
    .map((member) => ({
      id: member.id.toString(),
      name: member.fullName,
      branchId: member.branchId!.toString(),
    }));
  const staffMap = new Map(staffOptions.map((member) => [member.id, member]));

  // Request labels must use the originating branch and requester even when
  // the branch or user has since been stopped or the requester was moved.
  // IDs come only from the already-scoped pending requests.
  const [requestBranches, requestUsers] = pendingRequests.length ? await Promise.all([
    prisma.branch.findMany({ where: { id: { in: [...new Set(pendingRequests.map(item => BigInt(String(item.branchId))))] } }, select: { id: true, nameAr: true, isActive: true } }),
    prisma.user.findMany({ where: { id: { in: [...new Set(pendingRequests.map(item => BigInt(String(item.requesterId))))] } }, select: { id: true, fullName: true, status: true, branchId: true } }),
  ]) : [[], []];
  const requestBranchMap = new Map(requestBranches.map(branch => [branch.id.toString(), branch]));
  const requestUserMap = new Map(requestUsers.map(user => [user.id.toString(), user]));

  const coverage = computeBranchAccountCoverage(branchOptions, staffOptions, accounts);
  // للعرض فقط: الفروع النشطة المغطاة بخزنة مفتوحة ÷ إجمالي الفروع النشطة.
  const vaultCoverageRingPercent = countShareRingPercent({
    partCount: coverage.openVaultCount,
    totalCount: coverage.totalActiveBranches,
  });
  const today = cairoDate();

  const custodyRequests = pendingRequests.map((item) => {
    const branch = requestBranchMap.get(String(item.branchId));
    const requester = requestUserMap.get(String(item.requesterId));
    return {
      id: String(item.id),
      amount: String(item.amount),
      reason: String(item.reason),
      requesterName: requester?.fullName ?? `موظف #${String(item.requesterId)}`,
      holderUnavailable: !requester || requester.status !== "ACTIVE" || requester.branchId?.toString() !== String(item.branchId),
      branchUnavailable: !branch || !branch.isActive,
      branchName: branch ? `${branch.nameAr}${branch.isActive ? "" : " · فرع غير نشط"}` : `فرع #${String(item.branchId)}`,
      createdAt: String(item.createdAt),
      expectedSnapshot: custodyRequestSnapshot({ id: String(item.id), branchId: String(item.branchId), requesterId: String(item.requesterId), amount: String(item.amount), reason: String(item.reason) }),
      hasRegisteredCustody: accounts.some(account => account.kind === "CUSTODY" && account.branchId === String(item.branchId) && account.holderId === String(item.requesterId)),
    };
  });

  const openAccounts = accounts.filter((acc) => !acc.closedAt);
  const openAccountRows: OpenAccountSummaryRow[] = openAccounts.slice(0, 12).map((acc) => ({
    id: acc.id,
    kind: acc.kind,
    kindLabel: acc.kind === "VAULT" ? "خزنة فرع" : "عهدة موظف",
    branchName: branchNameById.get(acc.branchId) ?? "الفرع",
    holderName: acc.holderId ? staffMap.get(acc.holderId)?.name ?? `موظف #${acc.holderId}` : "—",
    openingDate: acc.openingDate,
    openingBalanceFormatted: formatMoney(acc.currentOpening),
    balanceFormatted: formatMoney(acc.balance),
  }));

  return (
    <div className="fin-page">
      <Link href="/finance" className="fin-back">
        <AppIcon name="arrow" />
        <span>العودة إلى الحسابات النقدية</span>
      </Link>

      <div className="fin-heading">
        <div>
          <p className="fin-heading__eyebrow">
            <span className="fin-eyebrow-dot" aria-hidden="true" />
            تأسيس وجرد الحسابات النقدية
          </p>
          <h1>فتح خزنة أو عهدة</h1>
          <p>
            الرصيد يُسجَّل بعد جرد فعلي فقط؛ الصفر مقبول إن كان هذا هو الواقع، ولا يُفترض أي رصيد تلقائيًا.
          </p>
        </div>
        <div className="fin-actions">
          <Link href="/finance/transfers" className="fin-button fin-button--secondary">
            <AppIcon name="arrow" />
            <span>تسليم وتحويل النقد</span>
          </Link>
          <Link href="/finance" className="fin-button fin-button--secondary">
            <AppIcon name="cash" />
            <span>سجل الحسابات النقدية</span>
          </Link>
        </div>
      </div>

      {/* شريط نبض التغطية النقدية والطلبات */}
      <FinKpiStrip
        label="تغطية الخزائن والعهد"
        className="no-print"
        items={[
          {
            icon: "shield",
            label: "تغطية خزائن الفروع النشطة",
            value: (
              <>
                {coverage.openVaultCount} <small>من {coverage.totalActiveBranches}</small>
              </>
            ),
            sub:
              coverage.missingVaultBranches.length === 0
                ? "كل الفروع النشطة مغطّاة بخزنة رئيسية"
                : `${coverage.missingVaultBranches.length} فرع بانتظار فتح خزنته`,
            tone: "accent",
            ring: {
              percent: vaultCoverageRingPercent,
              percentLabel: "نسبة الفروع النشطة المغطاة بخزنة مفتوحة من إجمالي الفروع النشطة",
              emptyLabel: coverage.totalActiveBranches === 0 ? "لا فروع" : "غير متاح",
            },
          },
          {
            icon: "branch",
            label: "فروع تفتقر إلى خزنة",
            value: (
              <>
                {coverage.missingVaultBranches.length} <small>فرع</small>
              </>
            ),
            sub:
              coverage.missingVaultBranches.length > 0
                ? coverage.missingVaultBranches.map((b) => b.name).join(" · ")
                : "لا توجد فروع نشطة بلا خزنة",
            tone: coverage.missingVaultBranches.length > 0 ? "alert" : "default",
          },
          {
            icon: "transfers",
            label: "العُهَد المفتوحة للموظفين",
            value: (
              <>
                {coverage.openCustodyCount} <small>عهدة قائمة</small>
              </>
            ),
            sub: `${coverage.availableStaffCount} موظف نشط دون عهدة مفتوحة؛ قد تمنع القيود فتح بديل`,
          },
          ...(canDecideCustody ? [{
            icon: "cash" as const,
            label: session.role === "ACCOUNTANT" ? "طلبات عهدة فرعك بانتظار القرار" : "طلبات عهدة بانتظار القرار",
            value: (
              <>
                {custodyRequests.length} <small>طلب</small>
              </>
            ),
            sub: session.role === "ACCOUNTANT" && !session.branchId
              ? "لا يوجد فرع محدد لحسابك؛ لا يمكنك البت في الطلبات"
              : custodyRequests.length > 0
                ? "طلبات ضمن نطاق قرارك بانتظار الموافقة أو الرفض"
                : "لا توجد طلبات معلّقة ضمن نطاق قرارك",
            tone: custodyRequests.length > 0 ? "alert" as const : "default" as const,
          }] : []),
        ]}
      />

      <FinStepper
        className="no-print fin-stepper--page"
        label="خطوات تأسيس الحساب النقدي"
        steps={[
          { key: "count", title: "العدّ والجرد الفعلي للنقد", description: "حصر الفئات النقدية الموجودة فعليًا وقت الافتتاح", status: "current" },
          { key: "opening", title: "إقرار وتثبيت رصيد البداية", description: "توثيق الرصيد وتاريخ الجرد في سجل التدقيق", status: "pending" },
          { key: "operate", title: "التشغيل والتسوية الدورية", description: "استقبال التحصيلات والتحويلات والجرد الدوري", status: "pending" },
        ]}
      />

      {canDecideCustody && custodyRequests.length > 0 ? (
        <section className="fin-form-stack" aria-label="طلبات العهدة المعلقة">
          <div className="fin-alert fin-alert--warning" role="status">
            {custodyRequests.length === 1
              ? "يوجد طلب عهدة واحد من موظف بانتظار قرارك."
              : `توجد ${custodyRequests.length} طلبات عهدة من الموظفين بانتظار قرارك.`}
          </div>
          {custodyRequests.map((item) => (
            <CustodyRequestDecision
              key={item.id}
              requestId={randomUUID()}
              request={item}
              today={today}
            />
          ))}
        </section>
      ) : null}

      {!canOpenAccount ? null : !branchOptions.length ? (
        <div className="fin-panel fin-empty">
          لا يوجد فرع نشط؛ أضف فرعًا نشطًا من شاشة «الفروع والمستخدمون» قبل فتح حساب نقدي.
        </div>
      ) : (
        <AccountForm
          requestId={randomUUID()}
          today={today}
          branches={branchOptions}
          staff={staffOptions}
          vaultBranches={coverage.openVaultBranchIds}
          custodyStaff={coverage.openCustodyHolderIds}
          closedCustodyStaff={coverage.closedCustodyHolderIds}
          missingVaultBranches={coverage.missingVaultBranches}
          initialKind={initialKind}
          initialBranchId={initialBranchId}
          initialHolderId={initialHolderId}
          userScopeKey={session.id}
        />
      )}

      {/* ملخص سريع للخزائن والعُهَد القائمة حاليًا */}
      {openAccounts.length > 0 ? (
        <section className="fin-page__section no-print" aria-label="الحسابات النقدية القائمة حاليًا">
          <div className="fin-panel">
            <div className="fin-panel__heading">
              <h2>الخزائن والعُهَد المفتوحة حاليًا ({openAccounts.length})</h2>
              <p>مراجعة سريعة للحسابات النشطة وأرصدتها الحالية لتفادي تكرار الفتح.</p>
            </div>
            <DataTable rows={openAccountRows} columns={openAccountSummaryColumns} rowKey={(row) => row.id}
              regionLabel="جدول مالي قابل للتمرير" regionClassName="fin-table-wrap" tableClassName="fin-table"
              caption="الخزائن والعُهَد المفتوحة وأرصدتها الدفترية الحالية" />
          </div>
        </section>
      ) : null}
    </div>
  );
}
