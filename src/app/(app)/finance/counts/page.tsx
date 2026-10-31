import { randomUUID } from "node:crypto";
import Link from "next/link";
import { listAccounts, listCashCounts, settlementOverview } from "@/lib/finance/engine";
import { prisma } from "@/lib/prisma";
import { accountLabel, formatMoney } from "../format";
import { financePage, financeRead } from "../page-context";
import { requireMenuScopeAccess } from "@/lib/menu-scope-guard";
import { CountRequestForm, CountResolveForm, type CountAccountOption } from "./count-forms";

export const dynamic = "force-dynamic";
const STATUS_LABEL: Record<string, string> = { OPEN: "معلق", CONFIRMED: "مؤكد", CANCELLED: "ملغى" };

export default async function CountsPage() {
  const { session, canManage } = await financePage();
  await requireMenuScopeAccess("/finance/counts");
  if (!canManage) {
    return (
      <div className="fin-page">
        <Link href="/finance" className="fin-back">العودة إلى المالية</Link>
        <div className="fin-alert fin-alert--error">الجرد وتأكيد التسوية متاحان للمدير والمحاسب فقط.</div>
      </div>
    );
  }

  const [accounts, counts, branches, users] = await Promise.all([
    financeRead(session, (tx) => listAccounts({ serializable: (work) => work(tx) }, session.id)),
    financeRead(session, (tx) => listCashCounts({ serializable: (work) => work(tx) }, session.id)),
    prisma.branch.findMany({ select: { id: true, nameAr: true } }),
    prisma.user.findMany({ select: { id: true, fullName: true } }),
  ]);
  const branchNames = new Map(branches.map((branch) => [branch.id.toString(), branch.nameAr]));
  const userNames = new Map(users.map((user) => [user.id.toString(), user.fullName]));
  // العهدة وحدها تُسوّى: مبيعات الفترة ومصروفاتها من نقد الموظف تدخل في
  // «المتوقَّع بيده» الذي يُقاس عليه الجرد، ولا تدخل في رصيد خزنة الفرع.
  const expectedByAccount = new Map<string, string>();
  for (const account of accounts) {
    if (account.kind !== "CUSTODY") continue;
    const overview = await financeRead(session, (tx) => settlementOverview({ serializable: (work) => work(tx) }, session.id, account.id));
    if (overview.account) expectedByAccount.set(account.id, overview.expected);
  }
  const accountOptions: CountAccountOption[] = accounts.map((account) => ({
    id: account.id,
    kind: account.kind,
    branchName: branchNames.get(account.branchId) ?? "الفرع",
    holderName: account.holderId ? userNames.get(account.holderId) ?? "موظف" : null,
    balance: account.balance,
    expected: expectedByAccount.get(account.id) ?? account.balance,
  }));
  const accountLabelById = new Map(accountOptions.map((account) => [account.id, `${account.branchName} · ${accountLabel(account.kind)}${account.holderName ? ` · ${account.holderName}` : ""}`]));
  const open = counts.filter((count) => count.status === "OPEN");
  const history = counts.filter((count) => count.status !== "OPEN").reverse();

  return (
    <div className="fin-page">
      <Link href="/finance" className="fin-back">العودة إلى المالية</Link>
      <div className="fin-heading">
        <div>
          <p className="fin-heading__eyebrow">جرد فعلي</p>
          <h1>جرد النقد وتسوية الفرق</h1>
          <p>الجرد يُسجَّل أولًا كملاحظة. الفرق لا يؤثر على الرصيد إلا بتأكيد تسوية منفصل بسبب موثق.</p>
        </div>
      </div>

      {open.length > 0 ? (
        <div className="fin-panel" style={{ marginBottom: 18 }}>
          <div className="fin-panel__heading">
            <h2>طلبات جرد معلقة</h2>
            <p>يجوز أن يؤكد التسوية من سجّل الجرد نفسه، بعد إقرار أن المعدود ما زال فعليًا.</p>
          </div>
          <div className="fin-panel__body">
            <div className="fin-form-stack">
              {open.map((count) => (
                <div key={count.id} className="fin-panel">
                  <div className="fin-panel__heading">
                    <h2>جرد رقم {count.id}</h2>
                    <p>
                      {accountLabelById.get(count.accountId) ?? "الحساب"} · المتوقَّع في اليد {formatMoney(count.observedBalance)} ·
                      معدود {formatMoney(count.countedAmount)} · الفرق {formatMoney(count.difference)}
                    </p>
                    <p>السبب: {count.reason} · بتاريخ {count.countedOn}</p>
                  </div>
                  <div className="fin-panel__body">
                    <CountResolveForm requestId={randomUUID()} countId={count.id} difference={count.difference} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <div className="fin-panel" style={{ marginBottom: 18 }}>
        <div className="fin-panel__heading">
          <h2>تسجيل جرد جديد</h2>
          <p>حساب واحد في كل مرة، ولا يُفتح جرد جديد على حساب فيه جرد معلق.</p>
        </div>
        <div className="fin-panel__body">
          {accountOptions.length === 0 ? (
            <div className="fin-alert fin-alert--warning">لا يوجد حساب نقدي مفتوح؛ افتح حسابًا بجرد فعلي أولًا.</div>
          ) : (
            <CountRequestForm requestId={randomUUID()} accounts={accountOptions} />
          )}
        </div>
      </div>

      <div className="fin-panel">
        <div className="fin-panel__heading">
          <h2>سجل الجرد</h2>
          <p>كل جرد محفوظ بحالته ومن أكّده وسببه.</p>
        </div>
        {history.length === 0 ? (
          <div className="fin-panel__body"><p>لا يوجد جرد مُسوًّى بعد.</p></div>
        ) : (
          <div className="fin-table-wrap">
            <table className="fin-table">
              <thead>
                <tr>
                  <th>الجرد</th>
                  <th>الحساب</th>
                  <th>التاريخ</th>
                  <th>الدفتري</th>
                  <th>المعدود</th>
                  <th>الفرق</th>
                  <th>الحالة</th>
                  <th>السبب</th>
                </tr>
              </thead>
              <tbody>
                {history.map((count) => (
                  <tr key={count.id}>
                    <td>{count.id}</td>
                    <td>{accountLabelById.get(count.accountId) ?? "الحساب"}</td>
                    <td>{count.countedOn}</td>
                    <td>{formatMoney(count.observedBalance)}</td>
                    <td>{formatMoney(count.countedAmount)}</td>
                    <td>{formatMoney(count.difference)}</td>
                    <td>{STATUS_LABEL[count.status] ?? count.status}</td>
                    <td>{count.resolutionReason ?? count.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
