"use client";

import Link from "next/link";
import { useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { AppIcon } from "@/components/app-icon";
import { downloadCsvFile } from "@/lib/csv-export";

export type FinanceExpenseRow = {
  id: string;
  expenseDate: string;
  branchId: string;
  branchName: string;
  categorySnapshot: string;
  description: string;
  amountFormatted: string;
  status: string;
  statusLabel: string;
};

type ExpenseFilter = "all" | "PENDING" | "APPROVED" | "PAID";

export default function FinanceExpensesView({
  rows,
  branches,
  canManage,
  initialCategory = "all",
}: {
  rows: FinanceExpenseRow[];
  branches: Array<{ id: string; label: string }>;
  canManage: boolean;
  initialCategory?: string;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ExpenseFilter>("all");
  const [branchFilter, setBranchFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState(() =>
    rows.some((r) => r.categorySnapshot === initialCategory) ? initialCategory : "all",
  );

  const categories = useMemo(() => {
    return Array.from(new Set(rows.map((r) => r.categorySnapshot))).sort((a, b) =>
      a.localeCompare(b, "ar"),
    );
  }, [rows]);

  const counts = useMemo(() => {
    let pending = 0;
    let approved = 0;
    let paid = 0;
    for (const r of rows) {
      if (r.status === "PENDING") pending += 1;
      else if (r.status === "APPROVED") approved += 1;
      else if (r.status === "PAID") paid += 1;
    }
    return { all: rows.length, pending, approved, paid };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter !== "all" && r.status !== filter) return false;
      if (branchFilter !== "all" && r.branchId !== branchFilter) return false;
      if (categoryFilter !== "all" && r.categorySnapshot !== categoryFilter) return false;
      if (q) {
        const hay = `${r.description} ${r.categorySnapshot} ${r.branchName} ${r.expenseDate} ${r.id}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, query, filter, branchFilter, categoryFilter]);

  function badgeClass(status: string): string {
    if (status === "PENDING") return "fin-badge fin-badge--pending";
    if (status === "APPROVED") return "fin-badge fin-badge--approved";
    if (status === "PAID") return "fin-badge fin-badge--paid";
    return "fin-badge fin-badge--closed";
  }

  const tabOrder: Array<ExpenseFilter> = ["all", "PENDING", "APPROVED", "PAID"];
  function handleTabListKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    // قائمة العرض RTL: السهم الأيسر ينقل إلى التبويب التالي (ترتيب القراءة)، والأيمن إلى السابق.
    const delta =
      event.key === "ArrowLeft" ? 1 : event.key === "ArrowRight" ? -1 : 0;
    if (delta !== 0) {
      event.preventDefault();
      const current = tabOrder.indexOf(filter);
      const next = tabOrder[(current + delta + tabOrder.length) % tabOrder.length];
      setFilter(next);
      document.getElementById(`fin-tab-${next.toLowerCase()}`)?.focus();
    }
  }

  function handleExportCsv(): void {
    downloadCsvFile(
      `selahtone-expenses-${new Date().toISOString().slice(0, 10)}.csv`,
      ["رقم المصروف", "التاريخ", "الفرع", "البند", "الوصف", "المبلغ (ج.م)", "الحالة"],
      filtered.map((r) => [
        r.id,
        r.expenseDate,
        r.branchName,
        r.categorySnapshot,
        r.description,
        r.amountFormatted,
        r.statusLabel,
      ]),
    );
  }

  return (
    <>
      <div className="fin-toolbar" role="region" aria-label="تصفية سجل المصروفات">
        <div className="fin-toolbar__row">
          <div className="fin-search-box">
            <svg className="fin-search-box__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <line x1="20" y1="20" x2="16.3" y2="16.3" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ابحث بالوصف أو البند أو الفرع أو التاريخ…"
              aria-label="بحث في المصروفات"
            />
            {query ? (
              <button
                type="button"
                className="fin-search-box__clear"
                onClick={() => setQuery("")}
                aria-label="مسح البحث"
              >
                <AppIcon name="close" />
              </button>
            ) : null}
          </div>

          {categories.length > 1 ? (
            <select
              className="fin-branch-select"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              aria-label="تصفية حسب البند"
            >
              <option value="all">كل البنود ({categories.length})</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          ) : null}

          {branches.length > 1 ? (
            <select
              className="fin-branch-select"
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              aria-label="تصفية حسب الفرع"
            >
              <option value="all">كل الفروع ({branches.length})</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.label}
                </option>
              ))}
            </select>
          ) : null}

          <button
            type="button"
            className="fin-button fin-button--secondary"
            onClick={handleExportCsv}
            disabled={filtered.length === 0}
          >
            <AppIcon name="download" />
            <span>تصدير CSV ({filtered.length})</span>
          </button>
        </div>

        <div className="fin-toolbar__row">
          <div className="fin-filter-pills" role="tablist" aria-label="حالة المصروف" onKeyDown={handleTabListKeyDown}>
            <button
              type="button"
              role="tab"
              id="fin-tab-all"
              aria-controls="fin-expenses-panel"
              aria-selected={filter === "all"}
              tabIndex={filter === "all" ? 0 : -1}
              className={`fin-filter-pill${filter === "all" ? " is-active" : ""}`}
              onClick={() => setFilter("all")}
            >
              <span>الكل</span>
              <span className="fin-filter-pill__count">{counts.all}</span>
            </button>
            <button
              type="button"
              role="tab"
              id="fin-tab-pending"
              aria-controls="fin-expenses-panel"
              aria-selected={filter === "PENDING"}
              tabIndex={filter === "PENDING" ? 0 : -1}
              className={`fin-filter-pill${filter === "PENDING" ? " is-active" : ""}`}
              onClick={() => setFilter("PENDING")}
            >
              <span>بانتظار الاعتماد</span>
              <span className="fin-filter-pill__count">{counts.pending}</span>
            </button>
            <button
              type="button"
              role="tab"
              id="fin-tab-approved"
              aria-controls="fin-expenses-panel"
              aria-selected={filter === "APPROVED"}
              tabIndex={filter === "APPROVED" ? 0 : -1}
              className={`fin-filter-pill${filter === "APPROVED" ? " is-active" : ""}`}
              onClick={() => setFilter("APPROVED")}
            >
              <span>معتمد للصرف</span>
              <span className="fin-filter-pill__count">{counts.approved}</span>
            </button>
            <button
              type="button"
              role="tab"
              id="fin-tab-paid"
              aria-controls="fin-expenses-panel"
              aria-selected={filter === "PAID"}
              tabIndex={filter === "PAID" ? 0 : -1}
              className={`fin-filter-pill${filter === "PAID" ? " is-active" : ""}`}
              onClick={() => setFilter("PAID")}
            >
              <span>مدفوع</span>
              <span className="fin-filter-pill__count">{counts.paid}</span>
            </button>
          </div>
        </div>
      </div>

      <div className="fin-panel" role="tabpanel" id="fin-expenses-panel" aria-labelledby={`fin-tab-${filter.toLowerCase()}`}>
        <div className="fin-panel__heading">
          <h2>كل المصروفات</h2>
          <p>المبلغ الظاهر هو المبلغ الفعال بعد أي تصحيح مؤكد.</p>
        </div>

        {filtered.length === 0 ? (
          <div className="fin-empty">لا توجد مصروفات تطابق معايير البحث أو التصفية الحالية.</div>
        ) : (
          <div className="fin-table-wrap">
            <table className="fin-table">
              <caption>سجل المصروفات المعروض حسب حالة التصفية — المبلغ الفعّال بعد أي تصحيح</caption>
              <thead>
                <tr>
                  <th scope="col">التاريخ</th>
                  <th scope="col">الفرع</th>
                  <th scope="col">البند</th>
                  <th scope="col">الوصف</th>
                  <th scope="col">المبلغ</th>
                  <th scope="col">الحالة</th>
                  {canManage ? <th scope="col">إجراء</th> : null}
                </tr>
              </thead>
              <tbody>
                {filtered.map((expense) => (
                  <tr key={expense.id}>
                    <td>
                      <bdi dir="ltr">{expense.expenseDate}</bdi>
                    </td>
                    <td>{expense.branchName}</td>
                    <td>
                      <span className="fin-badge fin-badge--vault">{expense.categorySnapshot}</span>
                    </td>
                    <td>{expense.description}</td>
                    <td>
                      <span className="fin-money">
                        <bdi dir="ltr">{expense.amountFormatted}</bdi> ج.م
                      </span>
                    </td>
                    <td>
                      <span className={badgeClass(expense.status)}>{expense.statusLabel}</span>
                    </td>
                    {canManage ? (
                      <td>
                        <Link className="fin-button fin-button--text" href={`/finance/expenses/${expense.id}`}>
                          <span>تفاصيل</span>
                        </Link>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
