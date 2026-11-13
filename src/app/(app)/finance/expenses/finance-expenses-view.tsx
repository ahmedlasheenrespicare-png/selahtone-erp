"use client";

import Link from "next/link";
import { useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { AppIcon } from "@/components/app-icon";
import DataTable, { type DataTableColumn } from "@/components/data-table/data-table";
import { useDataTable } from "@/components/data-table/use-data-table";
import { downloadCsvFile } from "@/lib/csv-export";

export type FinanceExpenseRow = {
  id: string;
  expenseDate: string;
  branchId: string;
  branchName: string;
  categorySnapshot: string;
  description: string;
  amountFormatted: string;
  /** المبلغ الفعّال بالقرش (نصًا) للفرز الرقمي؛ لا يغيّر المبلغ المعروض ولا المجاميع. */
  amountCents: string;
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

  // أعمدة موحّدة: الفرز يعمل على القيم الخام (قرش/تاريخ/نص)، والعرض يبقى كما كان.
  const columns: Array<DataTableColumn<FinanceExpenseRow>> = [
    {
      key: "expenseDate",
      header: "التاريخ",
      kind: "date",
      initialDirection: "desc",
      sortValue: (row) => row.expenseDate,
      cell: (row) => <bdi dir="ltr">{row.expenseDate}</bdi>,
    },
    {
      key: "branchName",
      header: "الفرع",
      sortValue: (row) => row.branchName,
      cell: (row) => row.branchName,
    },
    {
      key: "categorySnapshot",
      header: "البند",
      sortValue: (row) => row.categorySnapshot,
      cell: (row) => <span className="fin-badge fin-badge--vault">{row.categorySnapshot}</span>,
    },
    {
      key: "description",
      header: "الوصف",
      sortValue: (row) => row.description,
      cell: (row) => row.description,
    },
    {
      key: "amount",
      header: "المبلغ",
      kind: "cents",
      initialDirection: "desc",
      sortValue: (row) => row.amountCents,
      cell: (row) => (
        <span className="fin-money">
          <bdi dir="ltr">{row.amountFormatted}</bdi> ج.م
        </span>
      ),
    },
    {
      key: "status",
      header: "الحالة",
      sortValue: (row) => row.statusLabel,
      cell: (row) => <span className={badgeClass(row.status)}>{row.statusLabel}</span>,
    },
    ...(canManage
      ? [{
          key: "action",
          header: "إجراء",
          cell: (row: FinanceExpenseRow) => (
            <Link className="fin-button fin-button--text" href={`/finance/expenses/${row.id}`}>
              <span>تفاصيل</span>
            </Link>
          ),
        }]
      : []),
  ];

  const table = useDataTable({ rows: filtered, columns, initialPageSize: 25, resetKey: [query, filter, branchFilter, categoryFilter].join("\u0000") });

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
      // التصدير يشمل كل النتائج المطابقة للتصفية بترتيب الفرز الظاهر، لا الصفحة المعروضة وحدها.
      table.sortedRows.map((r) => [
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
          <DataTable
            state={table}
            columns={columns}
            rowKey={(expense) => expense.id}
            ariaLabel="سجل المصروفات"
            caption="سجل المصروفات المعروض حسب حالة التصفية — المبلغ الفعّال بعد أي تصحيح"
            wrapClassName="fin-table-wrap"
            tableClassName="fin-table"
          />
        )}
      </div>
    </>
  );
}
