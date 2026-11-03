import Link from "next/link";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import DashboardWallet, { type WalletPocketItem } from "@/app/(app)/dashboard/dashboard-wallet";
import { AppIcon } from "@/components/app-icon";
import PantherSpotlightCard from "@/components/panther-spotlight-card";
import { getSession } from "@/lib/auth";
import { displayMoney } from "@/lib/commerce-display";
import { requireMenuScopeAccess } from "@/lib/menu-scope-guard";
import { assertFinanceActor, financeDb, financeEnabled } from "@/lib/finance/db";
import { listAccounts, listExpenses } from "@/lib/finance/engine";
import { loadCashSummary } from "@/lib/finance/dashboard";
import { cairoDate } from "@/lib/finance/validation";
import { prisma } from "@/lib/prisma";
import FinanceAccountsView, { type FinanceAccountRow } from "./finance-accounts-view";
import { accountLabel, formatMoney } from "./format";

export const dynamic = "force-dynamic";

function moneyToCents(raw: string): bigint {
  const trimmed = raw.trim();
  const negative = trimmed.startsWith("-");
  const [whole = "0", fraction = ""] = trimmed.replace(/^-/, "").split(".");
  const cents = BigInt(whole || "0") * 100n + BigInt((fraction + "00").slice(0, 2) || "0");
  return negative ? -cents : cents;
}

export default async function FinancePage() {
  const session = await getSession();
  await requireMenuScopeAccess("/finance");
  if (!session) redirect("/login");
  if (session.mustChangePassword) redirect("/change-password");
  if (!financeEnabled()) redirect("/dashboard");

  const canManage = session.role === "MANAGER" || session.role === "ACCOUNTANT";
  const isAccountant = session.role === "ACCOUNTANT";
  const [{ accounts, expenses }, branches, holders] = await Promise.all([
    financeDb.serializable(async (tx) => {
      await assertFinanceActor(tx, { id: session.id, role: session.role, branchId: session.branchId });
      const loadedAccounts = await listAccounts({ serializable: (work) => work(tx) }, session.id);
      const loadedExpenses = canManage
        ? await listExpenses({ serializable: (work) => work(tx) }, session.id)
        : [];
      return { accounts: loadedAccounts, expenses: loadedExpenses };
    }),
    prisma.branch.findMany({ select: { id: true, nameAr: true } }),
    prisma.user.findMany({ where: { roleCode: "CS_AGENT" }, select: { id: true, fullName: true } }),
  ]);
  const summary = canManage ? await loadCashSummary(session) : null;
  const currentMonthPrefix = cairoDate().slice(0, 7);
  let monthExpensesCents = 0n;
  let monthExpensesCount = 0;
  for (const exp of expenses) {
    if (String(exp.expenseDate).startsWith(currentMonthPrefix)) {
      monthExpensesCents += moneyToCents(exp.amount);
      monthExpensesCount += 1;
    }
  }
  const branchNames = new Map(branches.map((branch) => [branch.id.toString(), branch.nameAr]));
  const holderNames = new Map(holders.map((holder) => [holder.id.toString(), holder.fullName]));

  let vaultTotalCents = 0n;
  let custodyBookTotalCents = 0n;
  let openVaultCount = 0;
  let openCustodyCount = 0;
  const branchSet = new Set<string>();

  const rows: FinanceAccountRow[] = accounts.map((account) => {
    const branchName = branchNames.get(account.branchId) ?? "الفرع";
    const holderName = (account.holderId && holderNames.get(account.holderId)) || "موظف";
    const isClosed = Boolean(account.closedAt);
    const balanceCents = moneyToCents(account.balance);

    if (!isClosed) {
      if (account.kind === "VAULT") {
        vaultTotalCents += balanceCents;
        openVaultCount += 1;
      } else {
        custodyBookTotalCents += balanceCents;
        openCustodyCount += 1;
      }
    }
    branchSet.add(branchName);

    return {
      id: account.id,
      title: account.kind === "CUSTODY" ? `عهدة · ${holderName}` : `خزنة · ${branchName}`,
      subtitle:
        account.kind === "CUSTODY"
          ? `${branchName} · جرد البداية ${account.openingDate}`
          : `خزنة فرع رئيسية · جرد البداية ${account.openingDate}`,
      branchName,
      kind: account.kind === "VAULT" ? "VAULT" : "CUSTODY",
      kindLabel: accountLabel(account.kind),
      openingDate: account.openingDate,
      recordedOpeningFormatted: formatMoney(account.recordedOpening),
      balanceFormatted: formatMoney(account.balance),
      isNegative: balanceCents < 0n,
      isClosed,
      canClose: canManage && account.kind === "CUSTODY" && !isClosed && Number(account.balance) === 0,
      closeRequestId: randomUUID(),
      holderName,
    };
  });

  const walletAccounts = rows.slice(0, 12);
  const pendingActionExpenses = summary ? summary.pendingExpenses + summary.approvedUnpaid : 0;

  const pocketItems: WalletPocketItem[] = [
    {
      key: "vault-total",
      label: "إجمالي الخزائن",
      value: `${displayMoney(vaultTotalCents)} ج.م`,
      kind: "money",
    },
    {
      key: "custody-total",
      label: summary ? "المستحق للخزنة" : "رصيد العهدة",
      value: `${summary ? formatMoney(summary.totalExpected) : displayMoney(custodyBookTotalCents)} ج.م`,
      kind: "money",
    },
    ...(summary && summary.pendingSettlements > 0
      ? [
          {
            key: "pending-settlements",
            label: "تسويات",
            value: String(summary.pendingSettlements),
            kind: "count" as const,
          },
        ]
      : []),
    ...(pendingActionExpenses > 0
      ? [
          {
            key: "pending-expenses",
            label: "مصروفات",
            value: String(pendingActionExpenses),
            kind: "count" as const,
          },
        ]
      : []),
  ];

  return (
    <div className="fin-page">
      <div className="fin-heading">
        <div>
          <p className="fin-heading__eyebrow">
            <span className="fin-eyebrow-dot" aria-hidden="true" />
            المالية والخزائن
          </p>
          <h1>الحسابات النقدية</h1>
          <p>
            {canManage
              ? "خزنة كل فرع وعهد موظفيه. كل حركة تُسجَّل باسم من نفّذها ووقتها."
              : "عهدة الموظف وحركاته فقط؛ المصروفات وتفاصيلها لا تظهر هنا."}
          </p>
        </div>
        {canManage ? (
          <div className="fin-actions">
            {isAccountant ? (
              <>
                <Link className="fin-button" href="/finance/settlements">
                  <AppIcon name="cash" />
                  <span>التسويات</span>
                  {summary && summary.pendingSettlements > 0 ? (
                    <span className="fin-button__count">{summary.pendingSettlements}</span>
                  ) : null}
                </Link>
                <Link className="fin-button" href="/finance/expenses">
                  <AppIcon name="expenses" />
                  <span>المصروفات</span>
                  {summary && summary.approvedUnpaid > 0 ? (
                    <span className="fin-button__count">{summary.approvedUnpaid} للصرف</span>
                  ) : null}
                </Link>
                <Link className="fin-button fin-button--secondary" href="/finance/transfers">
                  <span>تسليم نقد</span>
                </Link>
                <Link className="fin-button fin-button--secondary" href="/finance/accounts">
                  <span className="fin-button__plus" aria-hidden="true">+</span>
                  <span>فتح حساب بجرد فعلي</span>
                </Link>
              </>
            ) : (
              <>
                <Link className="fin-button" href="/finance/expenses">
                  <AppIcon name="expenses" />
                  <span>المصروفات</span>
                  {summary && summary.pendingExpenses > 0 ? (
                    <span className="fin-button__count">{summary.pendingExpenses} للاعتماد</span>
                  ) : null}
                </Link>
                <Link className="fin-button" href="/finance/settlements">
                  <AppIcon name="cash" />
                  <span>التسويات</span>
                  {summary && summary.pendingSettlements > 0 ? (
                    <span className="fin-button__count">{summary.pendingSettlements}</span>
                  ) : null}
                </Link>
                <Link className="fin-button fin-button--secondary" href="/finance/accounts">
                  <span className="fin-button__plus" aria-hidden="true">+</span>
                  <span>فتح حساب بجرد فعلي</span>
                </Link>
                <Link className="fin-button fin-button--secondary" href="/finance/counts">
                  <span>الجرد</span>
                </Link>
                <Link className="fin-button fin-button--secondary" href="/finance/transfers">
                  <span>تسليم نقد</span>
                </Link>
                <Link className="fin-button fin-button--secondary" href="/finance/categories">
                  <span>البنود</span>
                </Link>
              </>
            )}
          </div>
        ) : null}
      </div>

      {walletAccounts.length > 0 && (
        <section className="fin-wallet-section" aria-label="حافظة الحسابات النقدية">
          <div className="fin-wallet-header">
            <div className="fin-wallet-header__title">
              <span className="fin-wallet-header__icon" aria-hidden="true">
                <AppIcon name="cash" />
              </span>
              <h2>حافظة الخزائن والعُهَد</h2>
            </div>
            <span className="fin-wallet-header__pill">
              {walletAccounts.length} {walletAccounts.length === 1 ? "حساب نقدي" : "حسابات نقدية"} · تقليب أفقي
            </span>
          </div>

          <DashboardWallet
            balanceValue={`${displayMoney(vaultTotalCents)} ج.م`}
            balanceLabel="إجمالي الخزائن"
            pocketItems={pocketItems}
            hint="اسحب البطاقات أفقيًا لتقليب الخزائن والعُهَد، ومرّر على الجيب لإظهار إجماليات المالية"
          >
            {walletAccounts.map((account) => (
              <article key={account.id} className="stat-card">
                <div className="stat-card__head">
                  <h3>{account.title}</h3>
                  <p>
                    {account.branchName} · تاريخ الجرد <bdi dir="ltr">{account.openingDate}</bdi>
                  </p>
                  <span className="stat-card__badge">
                    {account.isClosed ? "مقفلة" : account.kindLabel}
                  </span>
                </div>

                <div className="stat-card__body">
                  <div className="fin-wallet-pills">
                    <span className="fin-wallet-pill">{account.branchName}</span>
                    <span className="fin-wallet-pill">{account.kindLabel}</span>
                    <span className="fin-wallet-pill">
                      {account.isClosed
                        ? "عهدة مقفلة"
                        : account.isNegative
                          ? "رصيد سالب — راجعه"
                          : "مفتوح ونشط"}
                    </span>
                  </div>

                  <div className="stat-grid">
                    <div className="stat-grid__item">
                      <span className="stat-grid__label">الرصيد الدفتري الحالي</span>
                      <strong className="stat-grid__value">
                        <bdi dir="ltr">{account.balanceFormatted}</bdi> <small>ج.م</small>
                      </strong>
                    </div>

                    <div className="stat-grid__item">
                      <span className="stat-grid__label">رصيد الجرد الافتتاحي</span>
                      <strong className="stat-grid__value">
                        <bdi dir="ltr">{account.recordedOpeningFormatted}</bdi> <small>ج.م</small>
                      </strong>
                    </div>

                    <Link
                      href={canManage ? "/finance/transfers" : "/finance/mine"}
                      className="stat-grid__item is-link fin-wallet-action-link"
                    >
                      <span className="stat-grid__label">
                        {canManage
                          ? "تسليم نقد بين الخزنة والعهدة أو مراجعة التسويات المعلقة"
                          : "عرض عهدتي النقدية وحركاتها وطلبات التسوية"}
                      </span>
                      <strong className="stat-grid__value">
                        {canManage ? "تسليم نقد والتسويات" : "فتح عهدتي النقدية"}
                      </strong>
                      <AppIcon name="arrow" className="stat-grid__arrow" />
                    </Link>
                  </div>
                </div>
              </article>
            ))}
          </DashboardWallet>
        </section>
      )}

      {canManage && summary ? (
        <>
          <PantherSpotlightCard
            title="الميزان النقدي ومصروفات الشهر"
            subtitle="محدّث الآن · إجمالي السيولة مقابل مصروفات الشهر الحالي"
            pill={`${openVaultCount + openCustodyCount} حساب نشط`}
            primary={{
              label: "إجمالي السيولة بالخزائن والعُهَد",
              value: displayMoney(vaultTotalCents + moneyToCents(summary.totalExpected)),
              unit: "ج.م",
              delta: `خزائن ${displayMoney(vaultTotalCents)} · عُهَد متوقّعة ${formatMoney(summary.totalExpected)} ج.م`,
              tone: "positive",
            }}
            secondary={{
              label: "مصروفات الشهر الحالي",
              value: displayMoney(monthExpensesCents),
              unit: "ج.م",
              delta:
                pendingActionExpenses > 0
                  ? `${pendingActionExpenses} مصروف بانتظار إجراء (${summary.pendingExpenses} اعتماد · ${summary.approvedUnpaid} صرف)`
                  : `${monthExpensesCount} مصروف مسجّل هذا الشهر · لا معلقات`,
              tone: pendingActionExpenses > 0 ? "negative" : "positive",
            }}
            actionHref="/finance/expenses"
            actionLabel="مراجعة المصروفات والاعتمادات"
          />

        <section className="fin-kpi-strip" aria-label="ملخص السيولة والمعلقات">
          <article className="fin-kpi-card is-accent">
            <span className="fin-kpi-card__icon" aria-hidden="true">
              <AppIcon name="warehouse" />
            </span>
            <div className="fin-kpi-card__body">
              <span className="fin-kpi-card__label">إجمالي رصيد الخزائن</span>
              <strong className="fin-kpi-card__value">
                <bdi dir="ltr">{displayMoney(vaultTotalCents)}</bdi> <small>ج.م</small>
              </strong>
              <small className="fin-kpi-card__sub">موزّعة على {openVaultCount} خزنة فرع نشطة</small>
            </div>
          </article>

          <article className="fin-kpi-card">
            <span className="fin-kpi-card__icon" aria-hidden="true">
              <AppIcon name="cash" />
            </span>
            <div className="fin-kpi-card__body">
              <span className="fin-kpi-card__label">المستحق للخزنة بيد الموظفين</span>
              <strong className="fin-kpi-card__value">
                <bdi dir="ltr">{formatMoney(summary.totalExpected)}</bdi> <small>ج.م</small>
              </strong>
              <small className="fin-kpi-card__sub">
                عبر {openCustodyCount} عهدة مفتوحة (الرصيد الدفتري {displayMoney(custodyBookTotalCents)} ج.م)
              </small>
            </div>
          </article>

          <Link
            href="/finance/expenses"
            className={`fin-kpi-card${pendingActionExpenses > 0 ? " is-alert" : ""}`}
          >
            <span className="fin-kpi-card__icon" aria-hidden="true">
              <AppIcon name="expenses" />
            </span>
            <div className="fin-kpi-card__body">
              <span className="fin-kpi-card__label">مصروفات بانتظار إجراء</span>
              <strong className="fin-kpi-card__value">{pendingActionExpenses}</strong>
              <small className="fin-kpi-card__sub">
                {summary.pendingExpenses} بانتظار الاعتماد · {summary.approvedUnpaid} بانتظار الصرف
              </small>
            </div>
          </Link>

          <Link
            href="/finance/transfers"
            className={`fin-kpi-card${summary.pendingSettlements > 0 ? " is-alert" : ""}`}
          >
            <span className="fin-kpi-card__icon" aria-hidden="true">
              <AppIcon name="check" />
            </span>
            <div className="fin-kpi-card__body">
              <span className="fin-kpi-card__label">طلبات تسوية معلقة</span>
              <strong className="fin-kpi-card__value">{summary.pendingSettlements}</strong>
              <small className="fin-kpi-card__sub">
                {summary.pendingSettlements > 0
                  ? "اضغط للمراجعة والاعتماد في شاشة التسليم"
                  : "لا توجد طلبات تسوية معلقة حاليًا"}
              </small>
            </div>
          </Link>
        </section>
        </>
      ) : null}

      {rows.length === 0 ? (
        <div className="fin-panel fin-empty fin-empty-state">
          <span className="fin-empty-state__icon" aria-hidden="true">
            <AppIcon name="cash" />
          </span>
          <h2>لا يوجد حساب نقدي مفتوح بعد</h2>
          <p>يُفتح الحساب بجرد فعلي مسجّل للرصيد من قِبل المدير أو المحاسب.</p>
          {canManage ? (
            <Link className="fin-button" href="/finance/accounts">
              <span className="fin-button__plus" aria-hidden="true">+</span>
              <span>فتح حساب بجرد فعلي</span>
            </Link>
          ) : null}
        </div>
      ) : (
        <>
          <div className="fin-directory-heading">
            <h2>سجل الحسابات النقدية الكامل</h2>
            <span>بحث فوري بالفرع أو الموظف وتصفية بين الخزائن والعُهَد</span>
          </div>
          <FinanceAccountsView rows={rows} branches={Array.from(branchSet)} canManage={canManage} />
        </>
      )}
    </div>
  );
}
