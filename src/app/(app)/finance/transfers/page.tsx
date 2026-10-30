import { randomUUID } from "node:crypto";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { assertFinanceActor, financeDb, financeEnabled } from "@/lib/finance/db";
import { listAccounts } from "@/lib/finance/engine";
import { prisma } from "@/lib/prisma";
import TransferForm, { type AccountOption } from "./transfer-form";

export const dynamic = "force-dynamic";

export default async function FinanceTransfersPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.mustChangePassword) redirect("/change-password");
  if (!financeEnabled()) redirect("/dashboard");
  const canManage = session.role === "MANAGER" || session.role === "ACCOUNTANT";

  const [branches, users, accounts] = await Promise.all([
    prisma.branch.findMany({ select: { id: true, nameAr: true } }),
    prisma.user.findMany({ where: { roleCode: "CS_AGENT" }, select: { id: true, fullName: true } }),
    financeDb.serializable(async (tx) => {
      await assertFinanceActor(tx, { id: session.id, role: session.role, branchId: session.branchId });
      return listAccounts({ serializable: (work) => work(tx) }, session.id);
    }),
  ]);
  const branchNames = new Map(branches.map((branch) => [branch.id.toString(), branch.nameAr]));
  const userNames = new Map(users.map((user) => [user.id.toString(), user.fullName]));

  if (!canManage) {
    return (
      <div className="fin-page">
        <Link href="/finance" className="fin-back">العودة إلى المالية</Link>
        <div className="fin-alert fin-alert--error">تسجيل التسليم النقدي متاح للمدير والمحاسب فقط.</div>
      </div>
    );
  }

  const options: AccountOption[] = accounts.map((account) => ({
    id: account.id,
    kind: account.kind,
    branchId: account.branchId,
    branchName: branchNames.get(account.branchId) ?? "فرع",
    holderName: account.holderId ? userNames.get(account.holderId) ?? "موظف" : null,
    balance: account.balance,
  }));

  return (
    <div className="fin-page">
      <Link href="/finance" className="fin-back">العودة إلى المالية</Link>
      <div className="fin-heading">
        <div>
          <p className="fin-heading__eyebrow">تسليم فعلي</p>
          <h1>تسليم نقد بين الحسابات</h1>
          <p>خطوة واحدة بين خزنة الفرع وعهدة موظف في الفرع نفسه. التسليم بين فرعين غير مسموح.</p>
        </div>
      </div>

      {options.length < 2 ? (
        <div className="fin-panel fin-empty">
          يحتاج التسليم إلى حسابين مفتوحين على الأقل في الفرع نفسه (خزنة الفرع وعهدة موظف).
          <div className="fin-actions" style={{ justifyContent: "center", marginTop: 14 }}>
            <Link className="fin-button" href="/finance/accounts">فتح حساب بجرد فعلي</Link>
            <Link className="fin-button fin-button--secondary" href="/finance">العودة إلى المالية</Link>
          </div>
        </div>
      ) : (
        <TransferForm requestId={randomUUID()} accounts={options} />
      )}
    </div>
  );
}
