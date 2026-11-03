import Link from "next/link";
import DashboardWallet, { type WalletPocketItem } from "@/app/(app)/dashboard/dashboard-wallet";
import { AppIcon } from "@/components/app-icon";
import { displayMoney } from "@/lib/commerce-display";
import { listExpenses } from "@/lib/finance/engine";
import { prisma } from "@/lib/prisma";
import { financePage, financeRead } from "../page-context";
import { formatMoney } from "../format";
import FinanceExpensesView, { type FinanceExpenseRow } from "./finance-expenses-view";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  PENDING: "بانتظار الاعتماد",
  APPROVED: "معتمد",
  PAID: "مدفوع",
};

function moneyToCents(raw: string): bigint {
  const trimmed = raw.trim();
  const negative = trimmed.startsWith("-");
  const [whole = "0", fraction = ""] = trimmed.replace(/^-/, "").split(".");
  const cents = BigInt(whole || "0") * 100n + BigInt((fraction + "00").slice(0, 2) || "0");
  return negative ? -cents : cents;
}

export default async function ExpensesPage() {
  const { session, canManage } = await financePage();

  const [expenses, branches] = await Promise.all([
    financeRead(session, (tx) => listExpenses({ serializable: (work) => work(tx) }, session.id)),
    prisma.branch.findMany({ select: { id: true, nameAr: true } }),
  ]);
  const branchNames = new Map(branches.map((branch) => [branch.id.toString(), branch.nameAr]));

  let totalCents = 0n;
  let paidCents = 0n;
  let pendingCount = 0;
  let approvedCount = 0;
  let paidCount = 0;
  const branchSet = new Set<string>();

  const rows: FinanceExpenseRow[] = expenses.map((expense) => {
    const branchName = branchNames.get(expense.branchId) ?? "الفرع";
    const cents = moneyToCents(expense.amount);
    totalCents += cents;
    if (expense.status === "PENDING") pendingCount += 1;
    else if (expense.status === "APPROVED") approvedCount += 1;
    else if (expense.status === "PAID") {
      paidCount += 1;
      paidCents += cents;
    }
    branchSet.add(branchName);

    return {
      id: expense.id,
      expenseDate: expense.expenseDate,
      branchName,
      categorySnapshot: expense.categorySnapshot,
      description: expense.description,
      amountFormatted: formatMoney(expense.amount),
      status: expense.status,
      statusLabel: STATUS_LABEL[expense.status] ?? expense.status,
    };
  });

  const latestExpenses = rows.slice(0, 12);

  const pocketItems: WalletPocketItem[] = [
    {
      key: "total-expenses",
      label: "إجمالي المصروفات",
      value: `${displayMoney(totalCents)} ج.م`,
      kind: "money",
    },
    {
      key: "paid-expenses",
      label: "المدفوع فعليًا",
      value: `${displayMoney(paidCents)} ج.م`,
      kind: "money",
    },
    ...(pendingCount > 0
      ? [
          {
            key: "pending-approval",
            label: "للاعتماد",
            value: String(pendingCount),
            kind: "count" as const,
          },
        ]
      : []),
    ...(approvedCount > 0
      ? [
          {
            key: "pending-pay",
            label: "للصرف",
            value: String(approvedCount),
            kind: "count" as const,
          },
        ]
      : []),
  ];

  return (
    <div className="fin-page">
      <Link href={canManage ? "/finance" : "/finance/mine"} className="fin-back">
        <AppIcon name="arrow" />
        <span>{canManage ? "العودة إلى المالية" : "العودة إلى عهدتي"}</span>
      </Link>

      <div className="fin-heading">
        <div>
          <p className="fin-heading__eyebrow">
            <span className="fin-eyebrow-dot" aria-hidden="true" />
            المصروفات والاعتمادات
          </p>
          <h1>{canManage ? "سجل المصروفات" : "مصروفاتي"}</h1>
          <p>
            {canManage
              ? "التسجيل والاعتماد والصرف الفعلي ثلاث خطوات منفصلة. الاعتماد الذاتي جائز مع حفظ المُدخل والمعتمد."
              : "هذه المصروفات التي سجلتها أنت فقط مع حالتها أمام الإدارة. الاعتماد والصرف للمدير والمحاسب."}
          </p>
        </div>
        <div className="fin-actions">
          <Link className="fin-button" href="/finance/expenses/new">
            <span className="fin-button__plus" aria-hidden="true">+</span>
            <span>تسجيل مصروف</span>
          </Link>
        </div>
      </div>

      {latestExpenses.length > 0 && (
        <section className="fin-wallet-section" aria-label="حافظة أحدث المصروفات">
          <div className="fin-wallet-header">
            <div className="fin-wallet-header__title">
              <span className="fin-wallet-header__icon" aria-hidden="true">
                <AppIcon name="expenses" />
              </span>
              <h2>حافظة أحدث المصروفات</h2>
            </div>
            <span className="fin-wallet-header__pill">
              أحدث {latestExpenses.length} {latestExpenses.length === 1 ? "مصروف" : "مصروفات"} · تقليب أفقي
            </span>
          </div>

          <DashboardWallet
            balanceValue={`${displayMoney(totalCents)} ج.م`}
            balanceLabel="إجمالي المصروفات"
            pocketItems={pocketItems}
            hint="اسحب البطاقات أفقيًا لتقليب أحدث المصروفات، ومرّر على الجيب لإظهار الإجماليات"
          >
            {latestExpenses.map((expense) => (
              <article key={expense.id} className="stat-card">
                <div className="stat-card__head">
                  <h3>{expense.description}</h3>
                  <p>
                    {expense.branchName} · <bdi dir="ltr">{expense.expenseDate}</bdi> · بند {expense.categorySnapshot}
                  </p>
                  <span className="stat-card__badge">{expense.statusLabel}</span>
                </div>

                <div className="stat-card__body">
                  <div className="fin-wallet-pills">
                    <span className="fin-wallet-pill">{expense.categorySnapshot}</span>
                    <span className="fin-wallet-pill">{expense.branchName}</span>
                  </div>

                  <div className="stat-grid">
                    <div className="stat-grid__item">
                      <span className="stat-grid__label">المبلغ الفعال</span>
                      <strong className="stat-grid__value">
                        <bdi dir="ltr">{expense.amountFormatted}</bdi> <small>ج.م</small>
                      </strong>
                    </div>

                    <div className="stat-grid__item">
                      <span className="stat-grid__label">الحالة الحالية</span>
                      <strong className="stat-grid__value">
                        <small>{expense.statusLabel}</small>
                      </strong>
                    </div>

                    {canManage ? (
                      <Link
                        href={`/finance/expenses/${expense.id}`}
                        className="stat-grid__item is-link fin-wallet-action-link"
                      >
                        <span className="stat-grid__label">
                          مراجعة بيانات المصروف أو الاعتماد وتسجيل الصرف الفعلي
                        </span>
                        <strong className="stat-grid__value">فتح تفاصيل المصروف</strong>
                        <AppIcon name="arrow" className="stat-grid__arrow" />
                      </Link>
                    ) : (
                      <Link
                        href="/finance/expenses/new"
                        className="stat-grid__item is-link fin-wallet-action-link"
                      >
                        <span className="stat-grid__label">إضافة بند مصروف جديد بانتظار الاعتماد</span>
                        <strong className="stat-grid__value">تسجيل مصروف جديد</strong>
                        <AppIcon name="arrow" className="stat-grid__arrow" />
                      </Link>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </DashboardWallet>
        </section>
      )}

      <section className="fin-kpi-strip" aria-label="ملخص المصروفات">
        <article className="fin-kpi-card is-accent">
          <span className="fin-kpi-card__icon" aria-hidden="true">
            <AppIcon name="expenses" />
          </span>
          <div className="fin-kpi-card__body">
            <span className="fin-kpi-card__label">إجمالي المصروفات</span>
            <strong className="fin-kpi-card__value">
              <bdi dir="ltr">{displayMoney(totalCents)}</bdi> <small>ج.م</small>
            </strong>
            <small className="fin-kpi-card__sub">{rows.length} مصروف في السجل</small>
          </div>
        </article>

        <article className={`fin-kpi-card${pendingCount > 0 ? " is-alert" : ""}`}>
          <span className="fin-kpi-card__icon" aria-hidden="true">
            <AppIcon name="receipt" />
          </span>
          <div className="fin-kpi-card__body">
            <span className="fin-kpi-card__label">بانتظار الاعتماد</span>
            <strong className="fin-kpi-card__value">{pendingCount}</strong>
            <small className="fin-kpi-card__sub">يعتمدها المدير أو المحاسب</small>
          </div>
        </article>

        <article className={`fin-kpi-card${approvedCount > 0 ? " is-alert" : ""}`}>
          <span className="fin-kpi-card__icon" aria-hidden="true">
            <AppIcon name="cash" />
          </span>
          <div className="fin-kpi-card__body">
            <span className="fin-kpi-card__label">معتمد بانتظار الصرف</span>
            <strong className="fin-kpi-card__value">{approvedCount}</strong>
            <small className="fin-kpi-card__sub">جاهز لتسجيل الصرف الفعلي</small>
          </div>
        </article>

        <article className="fin-kpi-card">
          <span className="fin-kpi-card__icon" aria-hidden="true">
            <AppIcon name="check" />
          </span>
          <div className="fin-kpi-card__body">
            <span className="fin-kpi-card__label">مدفوع فعليًا</span>
            <strong className="fin-kpi-card__value">
              <bdi dir="ltr">{displayMoney(paidCents)}</bdi> <small>ج.م</small>
            </strong>
            <small className="fin-kpi-card__sub">عدد المصروفات المدفوعة: {paidCount}</small>
          </div>
        </article>
      </section>

      {rows.length === 0 ? (
        <div className="fin-panel fin-empty fin-empty-state">
          <span className="fin-empty-state__icon" aria-hidden="true">
            <AppIcon name="expenses" />
          </span>
          <h2>لا توجد مصروفات مسجلة بعد</h2>
          <p>ابدأ بتسجيل أول مصروف ليظهر هنا مع حالة الاعتماد والصرف الفعلي.</p>
          <Link className="fin-button" href="/finance/expenses/new">
            <span className="fin-button__plus" aria-hidden="true">+</span>
            <span>تسجيل مصروف</span>
          </Link>
        </div>
      ) : (
        <>
          <div className="fin-directory-heading">
            <h2>سجل المصروفات الكامل</h2>
            <span>بحث فوري بالوصف أو البند وتصفية بحالة الاعتماد والصرف والفرع</span>
          </div>
          <FinanceExpensesView rows={rows} branches={Array.from(branchSet)} canManage={canManage} />
        </>
      )}
    </div>
  );
}
