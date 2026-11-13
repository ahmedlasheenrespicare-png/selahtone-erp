import { writeAllowedForKeys } from "@/lib/access-control";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { AppIcon } from "@/components/app-icon";
import DataTable from "@/components/data-driven/data-table";
import { csvRows } from "@/lib/data-driven-ui";
import { listAccounts, listCashCounts, settlementOverview } from "@/lib/finance/engine";
import { prisma } from "@/lib/prisma";
import { accountLabel, formatMoney } from "../format";
import { financePage, financeRead } from "../page-context";
import { getAccessContext, requirePageAccess } from "@/lib/access-control-server";
import { CountRequestForm, CountResolveForm, type CountAccountOption } from "./count-forms";
import { FinCsvButton } from "@/components/finance/fin-csv-button";
import { OlderCorrectionNotice } from "../older-correction-notice";
import { RequestCountFromHolderForm } from "./holder-count-request";
import { cashCountHistoryColumns, cashCountHistoryCsvColumns, type CashCountHistoryRow } from "./count-history-metadata";

export const dynamic = "force-dynamic";
const STATUS_LABEL: Record<string, string> = { OPEN: "معلق", CONFIRMED: "مؤكد", CANCELLED: "ملغى" };

export default async function CountsPage() {
  const { session, canManage } = await financePage();
  await requirePageAccess("/finance/counts");
  const access = await getAccessContext();
  const canRequest = writeAllowedForKeys(access.hidden, "/finance/counts#request");
  const canConfirm = writeAllowedForKeys(access.hidden, "/finance/counts#confirm");
  const canCancel = writeAllowedForKeys(access.hidden, "/finance/counts#cancel");
  const canRequestHolder = writeAllowedForKeys(access.hidden, "/finance/counts#request-holder");
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
  const boundaryAccounts = new Set<string>();
  for (const account of accounts) {
    if (account.kind !== "CUSTODY" || account.closedAt) continue;
    const overview = await financeRead(session, (tx) => settlementOverview({ serializable: (work) => work(tx) }, session.id, account.id));
    if (!overview.account || overview.boundaryAmbiguous || overview.holderCorrectionInPeriod) boundaryAccounts.add(account.id);
    else expectedByAccount.set(account.id, overview.expected);
  }
  const allAccountOptions: CountAccountOption[] = accounts.map((account) => ({
    id: account.id,
    kind: account.kind,
    branchName: branchNames.get(account.branchId) ?? "الفرع",
    holderName: account.holderId ? userNames.get(account.holderId) ?? "موظف" : null,
    balance: account.balance,
    expected: expectedByAccount.get(account.id) ?? account.balance,
  }));
  const openAccountIds = new Set(accounts.filter((account) => !account.closedAt).map((account) => account.id));
  const accountOptions = allAccountOptions.filter((account) => openAccountIds.has(account.id) && !boundaryAccounts.has(account.id));
  const accountLabelById = new Map(allAccountOptions.map((account) => [account.id, `${account.branchName} · ${accountLabel(account.kind)}${account.holderName ? ` · ${account.holderName}` : ""}`]));
  const open = counts.filter((count) => count.status === "OPEN");
  const history = counts.filter((count) => count.status !== "OPEN").reverse();
  const historyRows: CashCountHistoryRow[] = history.map((count) => ({
    id: count.id,
    accountLabel: accountLabelById.get(count.accountId) ?? "الحساب",
    countedOn: count.countedOn,
    observedBalanceFormatted: formatMoney(count.observedBalance),
    countedAmountFormatted: formatMoney(count.countedAmount),
    differenceFormatted: formatMoney(count.difference),
    statusLabel: STATUS_LABEL[count.status] ?? count.status,
    reason: count.resolutionReason ?? count.reason,
  }));

  return (
    <div className="fin-page">
      <Link href="/finance" className="fin-back">
        <AppIcon name="arrow" />
        <span>العودة إلى المالية</span>
      </Link>
      <div className="fin-heading">
        <div>
          <p className="fin-heading__eyebrow">
            <span className="fin-eyebrow-dot" aria-hidden="true" />
            جرد فعلي
          </p>
          <h1>جرد النقد وتسوية الفرق</h1>
          <p>الجرد يُسجَّل أولًا كملاحظة ولا يغيّر الرصيد. التأكيد المنفصل بسبب وإقرار يسجّل تعديلًا دفتريًا بالفرق المُقرّ به إن كان غير صفر؛ لا يثبت ذلك انتقال نقد أو صحة المعدود.</p>
        </div>
        {open.length > 0 ? (
          <div className="fin-actions">
            <span className="fin-badge fin-badge--pending">{open.length} جرد معلق</span>
          </div>
        ) : null}
      </div>

      <OlderCorrectionNotice />
      {boundaryAccounts.size > 0 && <div className="fin-alert fin-alert--warning">بعض العهد متوقفة للمراجعة لوجود تحصيل أو صرف نقدي في الفرع بنفس وقت بداية الفترة، أو لوجود تصحيح مرتبط بدفع نقد موظف عند حد الفترة أو بعده، أو لتعذر تحديد الفترة. لا تُعرض للجرد الجديد؛ تظل طلبات الإلغاء متاحة.</div>}
      {open.length > 0 ? (
        <div className="fin-panel" style={{ marginBottom: 18 }}>
          <div className="fin-panel__heading">
            <h2>طلبات جرد معلقة</h2>
            <p>التأكيد من سجل الجرد نفسه بعد سبب وإقرار بأن المعدود ما زال فعليًا؛ يُسجّل تعديل دفتري بالفرق المسجّل إن كان غير صفر، ولا يثبت السجل نقل النقد.</p>
          </div>
          <div className="fin-panel__body">
            <div className="fin-form-stack">
              {open.map((count) => (
                <div key={count.id} className="fin-panel">
                  <div className="fin-panel__heading">
                    <h2>جرد رقم {count.id}</h2>
                    <p>
                      {accountLabelById.get(count.accountId) ?? "الحساب"} · {count.requestedBy && !count.counterId ? "بانتظار تسجيل الموظف" : <>المرجع المسجّل {formatMoney(count.observedBalance)} · معدود {formatMoney(count.countedAmount)} · الفرق عنه {formatMoney(count.difference)}</>}
                    </p>
                    <p>السبب: {count.reason} · بتاريخ {count.countedOn}</p>
                  </div>
                  <div className="fin-panel__body">
                    {count.requestedBy && !count.counterId ? <p className="fin-alert fin-alert--warning">ينتظر الجرد الموجّه تسجيل الموظف قبل التأكيد.</p> : null}
                    {!openAccountIds.has(count.accountId) ? <p className="fin-alert fin-alert--warning">الحساب مقفل؛ لا يمكن تأكيد الجرد، ويمكن إلغاؤه بسبب.</p> : null}
                    {boundaryAccounts.has(count.accountId) ? <p className="fin-alert fin-alert--warning">فترة العهدة ملتبسة؛ يتوقف التأكيد للمراجعة ويمكن الإلغاء.</p> : null}
                    {canConfirm || canCancel ? <CountResolveForm requestId={randomUUID()} countId={count.id} difference={count.difference} canConfirm={canConfirm && openAccountIds.has(count.accountId) && !boundaryAccounts.has(count.accountId) && (!count.requestedBy || !!count.counterId)} canCancel={canCancel} /> : null}
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
            <div className="fin-alert fin-alert--warning">لا يوجد حساب متاح للجرد؛ راجع الحسابات المفتوحة أو الحالات المتوقفة للمراجعة.</div>
          ) : (
            <>
              {canRequest ? <CountRequestForm requestId={randomUUID()} accounts={accountOptions} /> : null}
              {canRequestHolder ? <RequestCountFromHolderForm requestId={randomUUID()} accounts={accountOptions} /> : null}
            </>
          )}
        </div>
      </div>

      <div className="fin-panel">
        <div className="fin-panel__heading fin-panel__heading--split">
          <div>
            <h2>سجل الجرد</h2>
            <p>كل جرد محفوظ بحالته ومن أكّده وسببه.</p>
          </div>
          <FinCsvButton
            filename={`selahtone-cash-counts-${new Date().toISOString().slice(0, 10)}.csv`}
            label="تصدير سجل الجرد"
            headers={cashCountHistoryCsvColumns.map((column) => column.header)}
            rows={csvRows(historyRows, cashCountHistoryCsvColumns)}
          />
        </div>
        {history.length === 0 ? (
          <div className="fin-panel__body"><p>لا يوجد جرد مُسوًّى بعد.</p></div>
        ) : (
<DataTable rows={historyRows} columns={cashCountHistoryColumns} rowKey={(row) => row.id}
            regionLabel="جدول مالي قابل للتمرير" regionClassName="fin-table-wrap" tableClassName="fin-table"
            caption="سجل الجرد بحالته ومن أكّده وسببه" />
        )}
      </div>
    </div>
  );
}
