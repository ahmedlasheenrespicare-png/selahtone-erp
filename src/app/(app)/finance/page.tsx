import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { assertFinanceActor, financeDb, financeEnabled } from "@/lib/finance/db";
import { listAccounts } from "@/lib/finance/engine";

/**
 * Staged finance page. While the finance schema is not installed, the route
 * quietly redirects to the dashboard and no finance query runs, so the deployed
 * application behaves exactly as before. It becomes reachable only after the
 * reviewed migration is applied and FINANCE_ENABLED is switched on.
 */
export default async function FinancePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.mustChangePassword) redirect("/change-password");
  if (!financeEnabled()) redirect("/dashboard");

  const accounts = await financeDb.serializable(async (tx) => {
    await assertFinanceActor(tx, { id: session.id, role: session.role, branchId: session.branchId });
    return listAccounts({ serializable: (work) => work(tx) }, session.id);
  });

  return (
    <section className="workspace-card">
      <h1>المالية</h1>
      <p className="workspace-muted">الحسابات النقدية الظاهرة لك فقط، وكل حركة تُسجَّل باسمك ووقتها.</p>
      {accounts.length === 0 ? (
        <p>لا توجد حسابات نقدية مفتوحة بعد. يُفتح الحساب بجرد فعلي مسجل.</p>
      ) : (
        <ul>
          {accounts.map((account) => (
            <li key={account.id}>
              {account.kind === "VAULT" ? "خزنة الفرع" : "عهدة"} · الرصيد {account.balance} · تاريخ الجرد {account.openingDate}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
