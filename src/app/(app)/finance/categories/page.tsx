import { randomUUID } from "node:crypto";
import Link from "next/link";
import { AppIcon } from "@/components/app-icon";
import { displayMoney } from "@/lib/commerce-display";
import { listAppCategories } from "@/lib/finance/app-categories";
import { listExpenses } from "@/lib/finance/engine";
import { cairoDate } from "@/lib/finance/validation";
import { financePage, financeRead } from "../page-context";
import { requireMenuScopeAccess } from "@/lib/menu-scope-guard";
import { CreateCategoryForm, EditCategoryForm, type CategoryOption } from "./category-forms";

export const dynamic = "force-dynamic";

function moneyToCents(raw: string): bigint {
  const trimmed = raw.trim();
  const negative = trimmed.startsWith("-");
  const [whole = "0", fraction = ""] = trimmed.replace(/^-/, "").split(".");
  const cents = BigInt(whole || "0") * 100n + BigInt((fraction + "00").slice(0, 2) || "0");
  return negative ? -cents : cents;
}

/** Management of the EXISTING expense categories: add, edit, deactivate.
 * Nothing is copied or deleted, and every edit keeps a reason and an audit row. */
export default async function CategoriesPage() {
  const { session, canManage } = await financePage();
  await requireMenuScopeAccess("/finance/categories");
  if (!canManage) {
    return (
      <div className="fin-page">
        <Link href="/finance" className="fin-back">العودة إلى المالية</Link>
        <div className="fin-alert fin-alert--error">إدارة بنود المصروفات متاحة للمدير والمحاسب فقط.</div>
      </div>
    );
  }

  const [categories, expenses] = await Promise.all([
    financeRead(session, (tx) => listAppCategories({ serializable: (work) => work(tx) }, session.id)),
    financeRead(session, (tx) => listExpenses({ serializable: (work) => work(tx) }, session.id)).catch(() => []),
  ]);

  const currentMonthPrefix = cairoDate().slice(0, 7);
  const statsByCatId = new Map<string, { monthCents: bigint; totalCents: bigint; count: number }>();
  const statsByCatName = new Map<string, { monthCents: bigint; totalCents: bigint; count: number }>();
  let grandMonthCents = 0n;

  for (const exp of expenses) {
    const cents = moneyToCents(String(exp.amount));
    const isCurrentMonth = String(exp.expenseDate).startsWith(currentMonthPrefix);
    if (isCurrentMonth) grandMonthCents += cents;

    const catIdKey = String(exp.categoryId ?? "");
    if (catIdKey) {
      const s = statsByCatId.get(catIdKey) ?? { monthCents: 0n, totalCents: 0n, count: 0 };
      s.totalCents += cents;
      if (isCurrentMonth) s.monthCents += cents;
      s.count += 1;
      statsByCatId.set(catIdKey, s);
    }

    const nameKey = String(exp.categorySnapshot ?? "");
    if (nameKey) {
      const s = statsByCatName.get(nameKey) ?? { monthCents: 0n, totalCents: 0n, count: 0 };
      s.totalCents += cents;
      if (isCurrentMonth) s.monthCents += cents;
      s.count += 1;
      statsByCatName.set(nameKey, s);
    }
  }

  const options: CategoryOption[] = categories.map((category) => ({
    id: category.id,
    code: category.code,
    name: category.name,
    active: category.active,
    revision: category.revision,
    snapshot: category.snapshot,
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
            البنود المحاسبية
          </p>
          <h1>بنود المصروفات</h1>
          <p>البنود الحالية تُستخدم كما هي. التعديل يحفظ السبب والنسخة السابقة، والإيقاف يمنع المصروفات الجديدة فقط.</p>
        </div>
      </div>

      <div className="fin-panel" style={{ marginBottom: 18 }}>
        <div className="fin-panel__heading">
          <h2>إضافة بند</h2>
          <p>الاسم فريد. الرمز يُولَّد تلقائيًا ولا يُعاد استخدامه.</p>
        </div>
        <div className="fin-panel__body">
          <CreateCategoryForm requestId={randomUUID()} />
        </div>
      </div>

      <div className="fin-panel">
        <div className="fin-panel__heading">
          <h2>كل البنود وتحليل الإنفاق ({currentMonthPrefix})</h2>
          <p>
            {options.filter((category) => category.active).length} نشط من {options.length} · إجمالي إنفاق الشهر الحالي:{" "}
            <strong><bdi dir="ltr">{displayMoney(grandMonthCents)}</bdi> ج.م</strong>
          </p>
        </div>
        <div className="fin-table-wrap">
          <table className="fin-table">
            <thead>
              <tr>
                <th>البند</th>
                <th>الرمز</th>
                <th>صرف الشهر الحالي</th>
                <th>إجمالي السجل</th>
                <th>الحالة</th>
                <th>الإصدار</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {options.map((category) => {
                const stat =
                  statsByCatId.get(category.id) ??
                  statsByCatName.get(category.name) ?? {
                    monthCents: 0n,
                    totalCents: 0n,
                    count: 0,
                  };
                const sharePct =
                  grandMonthCents > 0n
                    ? Math.round((Number(stat.monthCents) / Number(grandMonthCents)) * 100)
                    : 0;
                return (
                  <tr key={category.id}>
                    <td><strong>{category.name}</strong></td>
                    <td><span className="fin-code-pill">{category.code}</span></td>
                    <td>
                      <div className="fin-cat-spend">
                        <strong><bdi dir="ltr">{displayMoney(stat.monthCents)}</bdi> ج.م</strong>
                        {grandMonthCents > 0n ? (
                          <div className="fin-cat-share-bar" aria-label={`نسبة البند ${sharePct}%`}>
                            <span style={{ width: `${Math.max(sharePct, stat.monthCents > 0n ? 4 : 0)}%` }} />
                          </div>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <span><bdi dir="ltr">{displayMoney(stat.totalCents)}</bdi> ج.م</span>
                      <small className="fin-field__hint" style={{ display: "block" }}>
                        {stat.count} عملية
                      </small>
                    </td>
                    <td>
                      <span className={`fin-badge ${category.active ? "fin-badge--active" : "fin-badge--closed"}`}>
                        {category.active ? "نشط" : "موقوف"}
                      </span>
                    </td>
                    <td>{category.revision}</td>
                    <td>
                      <details>
                        <summary className="fin-button fin-button--text">تعديل</summary>
                        <div style={{ padding: "12px 4px" }}>
                          <EditCategoryForm requestId={randomUUID()} category={category} />
                        </div>
                      </details>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
