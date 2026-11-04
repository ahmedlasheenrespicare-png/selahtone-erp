import { randomUUID } from "node:crypto";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppIcon } from "@/components/app-icon";
import { getSession } from "@/lib/auth";
import { assertFinanceActor, financeDb, financeEnabled } from "@/lib/finance/db";
import { listAccounts, listCustodyRequests } from "@/lib/finance/engine";
import { computeBranchAccountCoverage } from "@/lib/finance/new-account-helpers";
import { cairoDate } from "@/lib/finance/validation";
import { requireMenuScopeAccess } from "@/lib/menu-scope-guard";
import { prisma } from "@/lib/prisma";
import { formatMoney } from "../format";
import AccountForm, { type BranchOption, type StaffOption } from "./account-form";
import { CustodyRequestDecision } from "./custody-request-decision";
import "./accounts.css";

export const dynamic = "force-dynamic";

export default async function FinanceAccountsPage({
  searchParams,
}: {
  searchParams?: Promise<{ kind?: string; branchId?: string; holderId?: string }>;
}) {
  const session = await getSession();
  await requireMenuScopeAccess("/finance/accounts");
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
      const loadedRequests = await listCustodyRequests(subDb, session.id, "PENDING");
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

  const coverage = computeBranchAccountCoverage(branchOptions, staffOptions, accounts);
  const today = cairoDate();

  const custodyRequests = pendingRequests.map((item) => {
    const reqStaff = staffMap.get(String(item.requesterId));
    return {
      id: String(item.id),
      amount: String(item.amount),
      reason: String(item.reason),
      requesterName: reqStaff?.name ?? "موظف",
      branchName: reqStaff ? branchNameById.get(reqStaff.branchId) : undefined,
      createdAt: String(item.createdAt),
    };
  });

  const openAccounts = accounts.filter((acc) => !acc.closedAt);

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
      <section className="fin-kpi-strip no-print" aria-label="تغطية الخزائن والعهد">
        <div className="fin-kpi-card is-accent">
          <span className="fin-kpi-card__icon" aria-hidden="true">
            <AppIcon name="shield" />
          </span>
          <div className="fin-kpi-card__body">
            <span className="fin-kpi-card__label">تغطية خزائن الفروع النشطة</span>
            <strong className="fin-kpi-card__value">
              {coverage.openVaultCount} <small>من {coverage.totalActiveBranches}</small>
            </strong>
            <small className="fin-kpi-card__sub">
              {coverage.missingVaultBranches.length === 0
                ? "كل الفروع النشطة مغطّاة بخزنة رئيسية"
                : `${coverage.missingVaultBranches.length} فرع بانتظار فتح خزنته`}
            </small>
          </div>
        </div>

        <div
          className={`fin-kpi-card${
            coverage.missingVaultBranches.length > 0 ? " is-alert" : ""
          }`}
        >
          <span className="fin-kpi-card__icon" aria-hidden="true">
            <AppIcon name="branch" />
          </span>
          <div className="fin-kpi-card__body">
            <span className="fin-kpi-card__label">فروع تفتقر إلى خزنة</span>
            <strong className="fin-kpi-card__value">
              {coverage.missingVaultBranches.length} <small>فرع</small>
            </strong>
            <small className="fin-kpi-card__sub">
              {coverage.missingVaultBranches.length > 0
                ? coverage.missingVaultBranches.map((b) => b.name).join(" · ")
                : "لا توجد فروع نشطة بلا خزنة"}
            </small>
          </div>
        </div>

        <div className="fin-kpi-card">
          <span className="fin-kpi-card__icon" aria-hidden="true">
            <AppIcon name="transfers" />
          </span>
          <div className="fin-kpi-card__body">
            <span className="fin-kpi-card__label">العُهَد المفتوحة للموظفين</span>
            <strong className="fin-kpi-card__value">
              {coverage.openCustodyCount} <small>عهدة قائمة</small>
            </strong>
            <small className="fin-kpi-card__sub">
              {coverage.availableStaffCount} موظف نشط متاح لفتح عهدة
            </small>
          </div>
        </div>

        <div className={`fin-kpi-card${custodyRequests.length > 0 ? " is-alert" : ""}`}>
          <span className="fin-kpi-card__icon" aria-hidden="true">
            <AppIcon name="cash" />
          </span>
          <div className="fin-kpi-card__body">
            <span className="fin-kpi-card__label">طلبات عهدة بانتظار القرار</span>
            <strong className="fin-kpi-card__value">
              {custodyRequests.length} <small>طلب</small>
            </strong>
            <small className="fin-kpi-card__sub">
              {custodyRequests.length > 0
                ? "واردة من موظفي الفروع لاعتمادها أو رفضها"
                : "لا توجد طلبات عهدة معلّقة حاليًا"}
            </small>
          </div>
        </div>
      </section>

      <ol className="fin-stepper no-print" aria-label="خطوات تأسيس الحساب النقدي">
        <li className="fin-stepper__step is-current">
          <span className="fin-stepper__num">1</span>
          <div className="fin-stepper__body">
            <strong>العدّ والجرد الفعلي للنقد</strong>
            <small>حصر الفئات النقدية الموجودة فعليًا وقت الافتتاح</small>
          </div>
        </li>
        <li className="fin-stepper__step">
          <span className="fin-stepper__num">2</span>
          <div className="fin-stepper__body">
            <strong>إقرار وتثبيت رصيد البداية</strong>
            <small>توثيق الرصيد وتاريخ الجرد في سجل التدقيق</small>
          </div>
        </li>
        <li className="fin-stepper__step">
          <span className="fin-stepper__num">3</span>
          <div className="fin-stepper__body">
            <strong>التشغيل والتسوية الدورية</strong>
            <small>استقبال التحصيلات والتحويلات والجرد الدوري</small>
          </div>
        </li>
      </ol>

      {custodyRequests.length > 0 ? (
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

      {!branchOptions.length ? (
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
            <div className="fin-table-wrap">
              <table className="fin-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>النوع</th>
                    <th>الفرع</th>
                    <th>صاحب العهدة</th>
                    <th>تاريخ الافتتاح</th>
                    <th>رصيد البداية</th>
                    <th>الرصيد الدفتري الحالي</th>
                  </tr>
                </thead>
                <tbody>
                  {openAccounts.slice(0, 12).map((acc) => {
                    const holderName = acc.holderId
                      ? staffMap.get(acc.holderId)?.name ?? `موظف #${acc.holderId}`
                      : "—";
                    return (
                      <tr key={acc.id}>
                        <td dir="ltr">
                          <strong>#{acc.id}</strong>
                        </td>
                        <td>
                          <span
                            className={`fin-badge ${
                              acc.kind === "VAULT" ? "fin-badge--approved" : "fin-badge--paid"
                            }`}
                          >
                            {acc.kind === "VAULT" ? "خزنة فرع" : "عهدة موظف"}
                          </span>
                        </td>
                        <td>{branchNameById.get(acc.branchId) ?? "الفرع"}</td>
                        <td>{holderName}</td>
                        <td dir="ltr">{acc.openingDate}</td>
                        <td dir="ltr">{formatMoney(acc.currentOpening)}</td>
                        <td dir="ltr">
                          <strong>{formatMoney(acc.balance)}</strong>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
