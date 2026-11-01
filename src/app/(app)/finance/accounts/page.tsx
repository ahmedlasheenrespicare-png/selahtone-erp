import { randomUUID } from "node:crypto";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { requireMenuScopeAccess } from "@/lib/menu-scope-guard";
import { assertFinanceActor, financeDb, financeEnabled } from "@/lib/finance/db";
import { listAccounts, listCustodyRequests } from "@/lib/finance/engine";
import { cairoDate } from "@/lib/finance/validation";
import { prisma } from "@/lib/prisma";
import AccountForm, { type BranchOption, type StaffOption } from "./account-form";
import { CustodyRequestDecision } from "./custody-request-decision";

export const dynamic = "force-dynamic";

export default async function FinanceAccountsPage() {
  const session = await getSession();
  await requireMenuScopeAccess("/finance/accounts");
  if (!session) redirect("/login");
  if (session.mustChangePassword) redirect("/change-password");
  if (!financeEnabled()) redirect("/dashboard");
  const canManage = session.role === "MANAGER" || session.role === "ACCOUNTANT";

  const [branches, staff, accounts] = await Promise.all([
    prisma.branch.findMany({ where: { isActive: true }, orderBy: { code: "asc" }, select: { id: true, nameAr: true, code: true } }),
    prisma.user.findMany({
      where: { status: "ACTIVE", roleCode: "CS_AGENT", branchId: { not: null } },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, branchId: true },
    }),
    financeDb.serializable(async (tx) => {
      await assertFinanceActor(tx, { id: session.id, role: session.role, branchId: session.branchId });
      return listAccounts({ serializable: (work) => work(tx) }, session.id);
    }),
  ]);

  if (!canManage) {
    return (
      <div className="fin-page">
        <Link href="/finance" className="fin-back">العودة إلى المالية</Link>
        <div className="fin-alert fin-alert--error">فتح الحسابات النقدية متاح للمدير والمحاسب فقط.</div>
      </div>
    );
  }

  const branchOptions: BranchOption[] = branches.map((branch) => ({ id: branch.id.toString(), name: branch.nameAr, code: branch.code }));
  const staffOptions: StaffOption[] = staff
    .filter((member) => member.branchId !== null)
    .map((member) => ({ id: member.id.toString(), name: member.fullName, branchId: member.branchId!.toString() }));

  // طلبات العهدة: بابٌ يقرعه الموظف، ونجيبه نحن هنا
  const staffNames = new Map(staff.map((member) => [member.id.toString(), member.fullName]));
  const pendingRequests = await financeDb.serializable(async (tx) => {
    await assertFinanceActor(tx, { id: session.id, role: session.role, branchId: session.branchId });
    return listCustodyRequests({ serializable: (work) => work(tx) }, session.id, "PENDING");
  });
  const today = cairoDate();
  const custodyRequests = pendingRequests.map((item) => ({
    id: String(item.id),
    amount: String(item.amount),
    reason: String(item.reason),
    requesterName: staffNames.get(String(item.requesterId)) ?? "موظف",
    createdAt: String(item.createdAt),
  }));

  return (
    <div className="fin-page">
      {custodyRequests.length > 0 ? (
        <div className="fin-form-stack">
          <div className="fin-alert fin-alert--warning" role="status">
            {custodyRequests.length === 1 ? "طلب عهدة واحد" : `${custodyRequests.length} طلبات عهدة`} بانتظار قرارك.
          </div>
          {custodyRequests.map((item) => (
            <CustodyRequestDecision key={item.id} request={item} today={today} />
          ))}
        </div>
      ) : null}

      <Link href="/finance" className="fin-back">العودة إلى المالية</Link>
      <div className="fin-heading">
        <div>
          <p className="fin-heading__eyebrow">جرد فعلي</p>
          <h1>فتح حساب نقدي</h1>
          <p>الرصيد يُسجَّل بعد جرد فعلي فقط. الصفر مقبول إن كان هذا هو الواقع، ولا يُفترض رصيد تلقائيًا.</p>
        </div>
      </div>

      {!branchOptions.length ? (
        <div className="fin-panel fin-empty">لا يوجد فرع نشط؛ أضف فرعًا نشطًا قبل فتح حساب نقدي.</div>
      ) : (
        <AccountForm
          requestId={randomUUID()}
          today={cairoDate()}
          branches={branchOptions}
          staff={staffOptions}
          vaultBranches={accounts.filter((account) => account.kind === "VAULT").map((account) => account.branchId)}
          custodyStaff={accounts.filter((account) => account.kind === "CUSTODY").map((account) => account.holderId ?? "")}
        />
      )}
    </div>
  );
}
