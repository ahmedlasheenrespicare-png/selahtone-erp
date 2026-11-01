import Link from "next/link";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { requireMenuScopeAccess } from "@/lib/menu-scope-guard";
import { assertFinanceActor, financeDb, financeEnabled } from "@/lib/finance/db";
import { listAccounts } from "@/lib/finance/engine";
import { loadCashSummary } from "@/lib/finance/dashboard";
import { prisma } from "@/lib/prisma";
import { accountLabel, formatMoney } from "./format";
import { CustodyCloseForm } from "./custody-close-form";

/**
 * Staged finance hub. While the finance schema is not installed the route
 * quietly redirects to the dashboard and no finance query runs, so the deployed
 * application behaves exactly as before. It becomes reachable only after the
 * reviewed migration is applied and FINANCE_ENABLED is switched on.
 */
export const dynamic = "force-dynamic";

export default async function FinancePage() {
  const session = await getSession();
  await requireMenuScopeAccess("/finance");
  if (!session) redirect("/login");
  if (session.mustChangePassword) redirect("/change-password");
  if (!financeEnabled()) redirect("/dashboard");

  const [accounts, branches, holders] = await Promise.all([
    financeDb.serializable(async (tx) => {
      await assertFinanceActor(tx, { id: session.id, role: session.role, branchId: session.branchId });
      return listAccounts({ serializable: (work) => work(tx) }, session.id);
    }),
    prisma.branch.findMany({ select: { id: true, nameAr: true } }),
    prisma.user.findMany({ where: { roleCode: "CS_AGENT" }, select: { id: true, fullName: true } }),
  ]);
  const canManage = session.role === "MANAGER" || session.role === "ACCOUNTANT";
  const isAccountant = session.role === "ACCOUNTANT";
  // الأزرار بلا أعداد تجعل المدير يفتح كل شاشة ليسأل: هل فيها ما ينتظرني؟
  const summary = canManage ? await loadCashSummary(session) : null;
  const branchNames = new Map(branches.map((branch) => [branch.id.toString(), branch.nameAr]));
  const holderNames = new Map(holders.map((holder) => [holder.id.toString(), holder.fullName]));

  return (
    <div className="fin-page">
      <div className="fin-heading">
        <div>
          <p className="fin-heading__eyebrow">المالية</p>
          <h1>الحسابات النقدية</h1>
          <p>
            {canManage
              ? "خزنة كل فرع وعهد موظفيه. كل حركة تُسجَّل باسم من نفّذها ووقتها."
              : "عهدة الموظف وحركاته فقط؛ المصروفات وتفاصيلها لا تظهر هنا."}
          </p>
        </div>
        {canManage ? (
          // المدير يعتمد والمحاسب يصرف: فترتيب الأزرار يتبع ما يفعله كلٌّ منهما
          // أولًا، والعدد يجنّبه فتح شاشة فارغة.
          <div className="fin-actions">
            {isAccountant ? (
              <>
                <Link className="fin-button" href="/finance/settlements">
                  التسويات{summary && summary.pendingSettlements > 0 ? ` (${summary.pendingSettlements})` : ""}
                </Link>
                <Link className="fin-button" href="/finance/expenses">
                  المصروفات{summary && summary.approvedUnpaid > 0 ? ` (${summary.approvedUnpaid} بانتظار الصرف)` : ""}
                </Link>
                <Link className="fin-button fin-button--secondary" href="/finance/transfers">تسليم نقد</Link>
                <Link className="fin-button fin-button--secondary" href="/finance/accounts">فتح حساب بجرد فعلي</Link>
              </>
            ) : (
              <>
                <Link className="fin-button" href="/finance/expenses">
                  المصروفات{summary && summary.pendingExpenses > 0 ? ` (${summary.pendingExpenses} بانتظار الاعتماد)` : ""}
                </Link>
                <Link className="fin-button" href="/finance/settlements">
                  التسويات{summary && summary.pendingSettlements > 0 ? ` (${summary.pendingSettlements})` : ""}
                </Link>
                <Link className="fin-button fin-button--secondary" href="/finance/accounts">فتح حساب بجرد فعلي</Link>
                <Link className="fin-button fin-button--secondary" href="/finance/counts">الجرد</Link>
                <Link className="fin-button fin-button--secondary" href="/finance/transfers">تسليم نقد</Link>
                <Link className="fin-button fin-button--secondary" href="/finance/categories">البنود</Link>
              </>
            )}
          </div>
        ) : null}
      </div>

      {accounts.length === 0 ? (
        <div className="fin-panel fin-empty">
          لا يوجد حساب نقدي مفتوح بعد. يُفتح الحساب بجرد فعلي مسجّل للرصيد.
        </div>
      ) : (
        <div className="fin-panel">
          <div className="fin-panel__heading">
            <h2>الأرصدة الحالية</h2>
            <p>
              الرصيد = رصيد الجرد المسجَّل + الحركات اللاحقة. السالب مسموح مع تنبيه. وهو <strong>غير</strong> «المتوقَّع بيد الموظف»
              الذي تحسبه التسوية، لأن المتوقَّع يضيف مبيعات الفترة ويخصم مصروفاتها.
            </p>
          </div>
          <div className="fin-table-wrap">
            <table className="fin-table">
              <thead>
                <tr>
                  <th>الحساب</th>
                  <th>النوع</th>
                  <th>تاريخ الجرد</th>
                  <th>رصيد الجرد</th>
                  <th>الرصيد الحالي</th>
                  {canManage ? <th>إجراء</th> : null}
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.id}>
                    <td>
                      {account.kind === "CUSTODY"
                        ? `عهدة · ${(account.holderId && holderNames.get(account.holderId)) || "موظف"}`
                        : `خزنة · ${branchNames.get(account.branchId) ?? "الفرع"}`}
                    </td>
                    <td>{accountLabel(account.kind)}</td>
                    <td>{account.openingDate}</td>
                    <td>{formatMoney(account.recordedOpening)}</td>
                    <td>
                      {formatMoney(account.balance)}
                      {account.closedAt ? <span className="fin-field__hint"> · مقفلة</span> : null}
                    </td>
                    {canManage ? (
                      <td>
                        {/* لا تُقفل إلا عهدة صُفّيت: فالإقفال تسجيل لحالة لا حركة
                            مال، وعهدة في ذمتها نقد تُصفّى بتسوية أولًا. */}
                        {account.kind === "CUSTODY" && !account.closedAt && Number(account.balance) === 0 ? (
                          <CustodyCloseForm
                            requestId={randomUUID()}
                            accountId={account.id}
                            holderName={(account.holderId && holderNames.get(account.holderId)) || "الموظف"}
                          />
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
