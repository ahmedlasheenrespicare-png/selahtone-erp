"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AppIcon } from "@/components/app-icon";

export type FinanceExpenseRow = {
  id: string;
  expenseDate: string;
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
}: {
  rows: FinanceExpenseRow[];
  branches: string[];
  canManage: boolean;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ExpenseFilter>("all");
  const [branchFilter, setBranchFilter] = useState("all");

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
      if (branchFilter !== "all" && r.branchName !== branchFilter) return false;
      if (q) {
        const hay = `${r.description} ${r.categorySnapshot} ${r.branchName} ${r.expenseDate} ${r.id}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, query, filter, branchFilter]);

  function badgeClass(status: string): string {
    if (status === "PENDING") return "fin-badge fin-badge--pending";
    if (status === "APPROVED") return "fin-badge fin-badge--approved";
    if (status === "PAID") return "fin-badge fin-badge--paid";
    return "fin-badge fin-badge--closed";
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

          {branches.length > 1 ? (
            <select
              className="fin-branch-select"
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              aria-label="تصفية حسب الفرع"
            >
              <option value="all">كل الفروع ({branches.length})</option>
              {branches.map((branch) => (
                <option key={branch} value={branch}>
                  {branch}
                </option>
              ))}
            </select>
          ) : null}
        </div>

        <div className="fin-toolbar__row">
          <div className="fin-filter-pills" role="tablist" aria-label="حالة المصروف">
            <button
              type="button"
              role="tab"
              aria-selected={filter === "all"}
              className={`fin-filter-pill${filter === "all" ? " is-active" : ""}`}
              onClick={() => setFilter("all")}
            >
              <span>الكل</span>
              <span className="fin-filter-pill__count">{counts.all}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filter === "PENDING"}
              className={`fin-filter-pill${filter === "PENDING" ? " is-active" : ""}`}
              onClick={() => setFilter("PENDING")}
            >
              <span>بانتظار الاعتماد</span>
              <span className="fin-filter-pill__count">{counts.pending}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filter === "APPROVED"}
              className={`fin-filter-pill${filter === "APPROVED" ? " is-active" : ""}`}
              onClick={() => setFilter("APPROVED")}
            >
              <span>معتمد للصرف</span>
              <span className="fin-filter-pill__count">{counts.approved}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filter === "PAID"}
              className={`fin-filter-pill${filter === "PAID" ? " is-active" : ""}`}
              onClick={() => setFilter("PAID")}
            >
              <span>مدفوع</span>
              <span className="fin-filter-pill__count">{counts.paid}</span>
            </button>
          </div>
        </div>
      </div>

      <div className="fin-panel">
        <div className="fin-panel__heading">
          <h2>كل المصروفات</h2>
          <p>المبلغ الظاهر هو المبلغ الفعال بعد أي تصحيح مؤكد.</p>
        </div>

        {filtered.length === 0 ? (
          <div className="fin-empty">لا توجد مصروفات تطابق معايير البحث أو التصفية الحالية.</div>
        ) : (
          <div className="fin-table-wrap">
            <table className="fin-table">
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>الفرع</th>
                  <th>البند</th>
                  <th>الوصف</th>
                  <th>المبلغ</th>
                  <th>الحالة</th>
                  {canManage ? <th>إجراء</th> : null}
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
