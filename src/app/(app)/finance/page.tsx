import { PeriodSourceWarning } from "./period-source-warning";
import { PeriodEstimateNotice } from "./period-estimate-notice";
import { writeAllowedForKeys } from "@/lib/access-control";
import Link from "next/link";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import DashboardWallet, { type WalletPocketItem } from "@/app/(app)/dashboard/dashboard-wallet";
import { AppIcon } from "@/components/app-icon";
import { FinEmptyState } from "@/components/finance/fin-empty-state";
import { FinKpiStrip } from "@/components/finance/fin-kpi-strip";
import PantherSpotlightCard, {
  type PantherChartPoint,
  type PantherChartSeries,
} from "@/components/panther-spotlight-card";
import { getSession } from "@/lib/auth";
import { displayMoney } from "@/lib/commerce-display";
import { getAccessContext, requirePageAccess } from "@/lib/access-control-server";
import { assertFinanceActor, financeDb, financeEnabled } from "@/lib/finance/db";
import { listAccounts, listExpenses } from "@/lib/finance/engine";
import { loadCashSummary } from "@/lib/finance/dashboard";
import { cairoDate } from "@/lib/finance/validation";
import { prisma } from "@/lib/prisma";
import FinanceAccountsView, { type FinanceAccountRow } from "./finance-accounts-view";
import FinanceCashLayers, { type CashLayerLinks } from "./finance-cash-layers";
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
  await requirePageAccess("/finance");
  const access = await getAccessContext();
  const canCloseCustody = writeAllowedForKeys(access.hidden, "/finance#close-custody");
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
    prisma.branch.findMany({
      select: { id: true, nameAr: true, isActive: true, code: true },
      orderBy: { code: "asc" },
    }),
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
  const branchIdsWithAccounts = new Set(accounts.map((account) => account.branchId));
  const accountBranches = branches
    .filter((branch) => branchIdsWithAccounts.has(branch.id.toString()))
    .map((branch) => ({ id: branch.id.toString(), label: `${branch.nameAr} · ${branch.code}` }));
  const accountBranchLabels = new Map(accountBranches.map((branch) => [branch.id, branch.label]));

  const rows: FinanceAccountRow[] = accounts.map((account) => {
    const branchName = accountBranchLabels.get(account.branchId) ?? `فرع ${account.branchId}`;
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
    return {
      id: account.id,
      title: account.kind === "CUSTODY" ? `عهدة · ${holderName}` : `خزنة · ${branchName}`,
      subtitle:
        account.kind === "CUSTODY"
          ? `${branchName} · جرد البداية ${account.openingDate}`
          : `خزنة فرع رئيسية · جرد البداية ${account.openingDate}`,
      branchId: account.branchId,
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

  const walletAccounts = rows;
  const pendingActionExpenses = summary ? summary.pendingExpenses + summary.approvedUnpaid : 0;

  const EXPENSE_STATUS_AR: Record<string, string> = {
    PENDING: "بانتظار الاعتماد",
    APPROVED: "معتمد",
    PAID: "مدفوع",
  };

  // بناء السلاسل التفاعلية الحقيقية لـ «الميزان النقدي ومصروفات الشهر»
  const financeSpotlightSeries: PantherChartSeries[] = [];
  if (canManage && summary) {
    const vaultByBranch = new Map<string, bigint>();
    for (const acc of accounts) {
      if (!acc.closedAt && acc.kind === "VAULT") {
        vaultByBranch.set(acc.branchId, (vaultByBranch.get(acc.branchId) ?? 0n) + moneyToCents(acc.balance));
      }
    }
    const custodyByBranch = new Map<string, bigint>();
    for (const c of summary.custodies) {
      custodyByBranch.set(
        c.branchId,
        (custodyByBranch.get(c.branchId) ?? 0n) + moneyToCents(c.expected),
      );
    }
    const monthExpByBranch = new Map<string, bigint>();
    const monthExpensesChrono = expenses
      .filter((exp) => String(exp.expenseDate).startsWith(currentMonthPrefix))
      .slice()
      .sort((a, b) => {
        const dateCmp = String(a.expenseDate).localeCompare(String(b.expenseDate));
        return dateCmp !== 0 ? dateCmp : Number(a.id) - Number(b.id);
      });

    for (const exp of monthExpensesChrono) {
      monthExpByBranch.set(exp.branchId, (monthExpByBranch.get(exp.branchId) ?? 0n) + moneyToCents(exp.amount));
    }

    const orderedBranches = branches
      .filter(
        (b) =>
          b.isActive ||
          (vaultByBranch.get(b.id.toString()) ?? 0n) > 0n ||
          (custodyByBranch.get(b.id.toString()) ?? 0n) > 0n ||
          (monthExpByBranch.get(b.id.toString()) ?? 0n) > 0n,
      );
    if (orderedBranches.length > 0) {
      financeSpotlightSeries.push({
        id: "branch-balance",
        label: "ميزان الفروع",
        points: orderedBranches.map((branch) => {
          const branchId = branch.id.toString();
          const vCents = vaultByBranch.get(branchId) ?? 0n;
          const cCents = custodyByBranch.get(branchId) ?? 0n;
          const liqCents = vCents + cCents;
          const eCents = monthExpByBranch.get(branchId) ?? 0n;
          return {
            label: `${branch.nameAr} · ${branch.code}`,
            shortLabel: `${branch.nameAr.replace(/^فرع\s+/, "")} · ${branch.code}`,
            value: Number(liqCents) / 100,
            formattedValue: `${displayMoney(liqCents)} ج.م`,
            secondaryValue: Number(eCents) / 100,
            secondaryLabel: "مصروفات الشهر",
            secondaryFormatted: `${displayMoney(eCents)} ج.م`,
            detail: `خزنة ${displayMoney(vCents)} + عهدة متوقعة ${displayMoney(cCents)} ج.م`,
          };
        }),
      });
    }

    if (monthExpensesChrono.length === 0) {
      financeSpotlightSeries.push({
        id: "month-expenses",
        label: "مصروفات الشهر",
        points: [
          {
            label: "بداية الشهر",
            shortLabel: "البداية",
            value: 0,
            formattedValue: "0 ج.م",
            secondaryValue: 0,
            secondaryLabel: "المدفوع",
            secondaryFormatted: "0 ج.م",
            detail: "لا مصروفات مسجلة في الشهر الحالي",
          },
          {
            label: "الآن",
            shortLabel: "الآن",
            value: 0,
            formattedValue: "0 ج.م",
            secondaryValue: 0,
            secondaryLabel: "المدفوع",
            secondaryFormatted: "0 ج.م",
            detail: "إجمالي مصروفات الشهر 0 ج.م",
          },
        ],
      });
    } else if (monthExpensesChrono.length <= 14) {
      let cumAll = 0n;
      let cumPaid = 0n;
      const expPoints: PantherChartPoint[] = [
        {
          label: "بداية الشهر",
          shortLabel: "٠",
          value: 0,
          formattedValue: "0 ج.م",
          secondaryValue: 0,
          secondaryLabel: "المدفوع",
          secondaryFormatted: "0 ج.م",
          detail: "بداية مصروفات الشهر الحالي",
        },
      ];
      for (const exp of monthExpensesChrono) {
        const amt = moneyToCents(exp.amount);
        cumAll += amt;
        if (exp.status === "PAID") cumPaid += amt;
        const bName = branchNames.get(exp.branchId) ?? "الفرع";
        const stLabel = EXPENSE_STATUS_AR[exp.status] ?? exp.status;
        expPoints.push({
          label: `${exp.categorySnapshot} · ${bName}`,
          shortLabel: `#${exp.id}`,
          value: Number(cumAll) / 100,
          formattedValue: `${displayMoney(cumAll)} ج.م`,
          secondaryValue: Number(cumPaid) / 100,
          secondaryLabel: "المسجّل مدفوعًا",
          secondaryFormatted: `${displayMoney(cumPaid)} ج.م`,
          detail: `بند ${displayMoney(amt)} ج.م (${stLabel}) — ${exp.description}`,
        });
      }
      financeSpotlightSeries.push({
        id: "month-expenses",
        label: "مصروفات الشهر",
        points: expPoints,
      });
    } else {
      const byDay = new Map<string, { all: bigint; paid: bigint; count: number }>();
      for (const exp of monthExpensesChrono) {
        const dKey = String(exp.expenseDate);
        const cur = byDay.get(dKey) ?? { all: 0n, paid: 0n, count: 0 };
        const amt = moneyToCents(exp.amount);
        cur.all += amt;
        if (exp.status === "PAID") cur.paid += amt;
        cur.count += 1;
        byDay.set(dKey, cur);
      }
      let cumAll = 0n;
      let cumPaid = 0n;
      const expPoints: PantherChartPoint[] = [
        {
          label: "بداية الشهر",
          shortLabel: "٠",
          value: 0,
          formattedValue: "0 ج.م",
          secondaryValue: 0,
          secondaryLabel: "المدفوع",
          secondaryFormatted: "0 ج.م",
        },
      ];
      for (const [dKey, info] of byDay.entries()) {
        cumAll += info.all;
        cumPaid += info.paid;
        expPoints.push({
          label: `يوم ${dKey}`,
          shortLabel: dKey.slice(5),
          value: Number(cumAll) / 100,
          formattedValue: `${displayMoney(cumAll)} ج.م`,
          secondaryValue: Number(cumPaid) / 100,
          secondaryLabel: "المسجّل مدفوعًا",
          secondaryFormatted: `${displayMoney(cumPaid)} ج.م`,
          detail: `مصروفات اليوم ${displayMoney(info.all)} ج.م (${info.count} بند)`,
        });
      }
      financeSpotlightSeries.push({
        id: "month-expenses",
        label: "مصروفات الشهر",
        points: expPoints,
      });
    }

    const expectedCustodyCents = moneyToCents(summary.totalExpected);
    const totalLiquidityCents = vaultTotalCents + expectedCustodyCents;
    financeSpotlightSeries.unshift({
      id: "liquidity-mix",
      label: "توزيع السيولة",
      chartVariant: "donut",
      points: [
        {
          label: "أرصدة الخزائن المفتوحة",
          shortLabel: "الخزائن",
          value: Number(vaultTotalCents) / 100,
          formattedValue: `${displayMoney(vaultTotalCents)} ج.م`,
          detail: `موزعة على ${openVaultCount} خزنة فرع نشطة`,
          tone: "accent",
        },
        {
          label: "مؤشر العُهَد المفتوحة",
          shortLabel: "العُهَد",
          value: Number(expectedCustodyCents) / 100,
          formattedValue: `${displayMoney(expectedCustodyCents)} ج.م`,
          detail: `عبر ${openCustodyCount} عهدة موظف مفتوحة`,
          tone: "alt",
        },
      ],
    });
    financeSpotlightSeries.push({
      id: "cash-equation",
      label: "السيولة والمصروفات المسجّلة",
      points: [
        {
          label: "أرصدة الخزائن",
          shortLabel: "الخزائن",
          value: Number(vaultTotalCents) / 100,
          formattedValue: `${displayMoney(vaultTotalCents)} ج.م`,
          detail: `موزعة على ${openVaultCount} خزنة فرع نشطة`,
        },
        {
          label: "مؤشر العُهَد",
          shortLabel: "العُهَد",
          value: Number(expectedCustodyCents) / 100,
          formattedValue: `${displayMoney(expectedCustodyCents)} ج.م`,
          detail: `عبر ${openCustodyCount} عهدة موظف مفتوحة`,
        },
        {
          label: "مجموع دفتري ومؤشر تقديري",
          shortLabel: "الإجمالي",
          value: Number(totalLiquidityCents) / 100,
          formattedValue: `${displayMoney(totalLiquidityCents)} ج.م`,
          detail: "أرصدة الخزائن الدفترية + مؤشر العُهَد التقديري",
        },
        {
          label: "مصروفات الشهر المسجّلة بجميع حالاتها",
          shortLabel: "المصروفات",
          value: Number(monthExpensesCents) / 100,
          formattedValue: `${displayMoney(monthExpensesCents)} ج.م`,
          detail: `${monthExpensesCount} بند مسجّل بحالات مختلفة؛ لا يُطرح مجددًا من السيولة`,
        },
      ],
    });
  }

  const pocketItems: WalletPocketItem[] = [
    {
      key: "vault-total",
      label: "إجمالي الخزائن",
      value: `${displayMoney(vaultTotalCents)} ج.م`,
      kind: "money",
    },
    {
      key: "custody-total",
      label: summary ? "مؤشر العُهَد" : "رصيد العهدة",
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
      {summary && <PeriodEstimateNotice />}
      {summary?.sourceRecorderMismatch && <PeriodSourceWarning />}
      {summary?.multipleCustodies && <div className="fin-alert fin-alert--warning" role="alert">يوجد صاحب له أكثر من عهدة مفتوحة في النطاق المعروض؛ قد تتكرر مؤشرات الفترة ولا يعتمد الإجمالي للتسليم. يتوقف الجرد والتسوية والإقفال للعهد المتأثرة للمراجعة.</div>}
      {summary?.holderCorrectionInPeriod && <div className="fin-alert fin-alert--warning" role="alert">بعض مؤشرات العهد غير مؤكدة لوجود تصحيح مرتبط بدفع نقد موظف عند حد الفترة أو بعده في الفرع؛ توقفت الإجراءات المتأثرة للمراجعة، ولا تعتمد الإجماليات للتسليم.</div>}
      {summary?.boundaryAmbiguous && <div className="fin-alert fin-alert--warning" role="alert">بعض مؤشرات العهد والسيولة غير مؤكدة لوجود عملية نقدية عند حد الفترة؛ توقفت الإجراءات المتأثرة للمراجعة، ولا تعتمد الإجماليات المعروضة للتسليم.</div>}
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
                <Link className="fin-button fin-button--secondary" href="/finance/reports">
                  <AppIcon name="reports" />
                  <span>التقارير</span>
                </Link>
                <Link className="fin-button fin-button--secondary" href="/finance/help">
                  <span>الدليل</span>
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
                <Link className="fin-button fin-button--secondary" href="/finance/reports">
                  <AppIcon name="reports" />
                  <span>التقارير</span>
                </Link>
                <Link className="fin-button fin-button--secondary" href="/finance/help">
                  <span>الدليل</span>
                </Link>
              </>
            )}
          </div>
        ) : null}
      </div>

      {canManage ? (
        <FinanceCashLayers
          links={
            {
              invoice: access.isAllowed("/sales") ? "/sales" : undefined,
              collection: access.isAllowed("/sales") ? "/sales" : undefined,
              custody: access.isAllowed("/finance/accounts")
                ? "/finance/accounts"
                : access.isAllowed("/finance/mine")
                  ? "/finance/mine"
                  : undefined,
              vault: access.isAllowed("/finance/accounts") ? "/finance/accounts" : undefined,
              settlement: access.isAllowed("/finance/settlements") ? "/finance/settlements" : undefined,
            } satisfies CashLayerLinks
          }
        />
      ) : null}

      {(walletAccounts.length > 0 || (canManage && summary)) && (
        <div className="dashboard-cards-grid" aria-label="حافظة الخزائن والعُهَد والميزان النقدي">
          {walletAccounts.length > 0 ? (
            <div className="dashboard-cards-grid__wallet">
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
            </div>
          ) : null}

          {canManage && summary ? (
            <div className="dashboard-cards-grid__item">
              <PantherSpotlightCard
                layout="wallet"
                icon="balanceScale"
                chartVariant="donut"
                title="الميزان النقدي ومصروفات الشهر"
                subtitle="السيولة تقديرية · مصروفات الشهر المسجّلة تشمل حالات مختلفة ولا تُطرح منها مجددًا"
                pill={`${openVaultCount + openCustodyCount} حساب نشط`}
                primary={{
                  label: "مجموع أرصدة الخزائن ومؤشر العُهَد",
                  value: displayMoney(vaultTotalCents + moneyToCents(summary.totalExpected)),
                  unit: "ج.م",
                  delta: `خزائن ${displayMoney(vaultTotalCents)} · عُهَد متوقّعة ${formatMoney(summary.totalExpected)} ج.م`,
                  tone: "positive",
                }}
                secondary={{
                  label: "مصروفات الشهر المسجّلة بجميع حالاتها",
                  value: displayMoney(monthExpensesCents),
                  unit: "ج.م",
                  delta:
                    pendingActionExpenses > 0
                      ? `${pendingActionExpenses} مصروف بانتظار إجراء (${summary.pendingExpenses} اعتماد · ${summary.approvedUnpaid} صرف)`
                      : `${monthExpensesCount} مصروف مسجّل هذا الشهر · لا معلقات`,
                  tone: pendingActionExpenses > 0 ? "negative" : "positive",
                }}
                series={financeSpotlightSeries}
                actionHref="/finance/expenses"
                actionLabel="مراجعة المصروفات والاعتمادات"
              />
            </div>
          ) : null}
        </div>
      )}

      {canManage && summary ? (
        <FinKpiStrip
          label="ملخص السيولة والمعلقات"
          items={[
            {
              icon: "warehouse",
              label: "إجمالي رصيد الخزائن",
              value: (
                <>
                  <bdi dir="ltr">{displayMoney(vaultTotalCents)}</bdi> <small>ج.م</small>
                </>
              ),
              sub: `موزّعة على ${openVaultCount} خزنة فرع نشطة`,
              tone: "accent",
            },
            {
              icon: "cash",
              label: "مجموع مؤشرات عُهَد الموظفين",
              value: (
                <>
                  <bdi dir="ltr">{formatMoney(summary.totalExpected)}</bdi> <small>ج.م</small>
                </>
              ),
              sub: `عبر ${openCustodyCount} عهدة مفتوحة (الرصيد الدفتري ${displayMoney(custodyBookTotalCents)} ج.م)`,
            },
            {
              icon: "expenses",
              label: "مصروفات بانتظار إجراء",
              value: String(pendingActionExpenses),
              sub: `${summary.pendingExpenses} بانتظار الاعتماد · ${summary.approvedUnpaid} بانتظار الصرف`,
              tone: pendingActionExpenses > 0 ? "alert" : "default",
              href: "/finance/expenses",
            },
            {
              icon: "check",
              label: "طلبات تسوية معلقة",
              value: String(summary.pendingSettlements),
              sub:
                summary.pendingSettlements > 0
                  ? "اضغط للمراجعة والاعتماد في شاشة التسليم"
                  : "لا توجد طلبات تسوية معلقة حاليًا",
              tone: summary.pendingSettlements > 0 ? "alert" : "default",
              href: "/finance/transfers",
            },
          ]}
        />
      ) : null}

      {rows.length === 0 ? (
        <FinEmptyState icon="cash" title="لا يوجد حساب نقدي مفتوح بعد">
          <p>يُفتح الحساب بجرد فعلي مسجّل للرصيد من قِبل المدير أو المحاسب.</p>
          {canManage ? (
            <Link className="fin-button" href="/finance/accounts">
              <span className="fin-button__plus" aria-hidden="true">+</span>
              <span>فتح حساب بجرد فعلي</span>
            </Link>
          ) : null}
        </FinEmptyState>
      ) : (
        <>
          <div className="fin-directory-heading">
            <h2>سجل الحسابات النقدية الكامل</h2>
            <span>بحث فوري بالفرع أو الموظف وتصفية بين الخزائن والعُهَد</span>
          </div>
          <FinanceAccountsView rows={rows} branches={accountBranches} canManage={canManage} canCloseCustody={canCloseCustody} />
        </>
      )}
    </div>
  );
}
