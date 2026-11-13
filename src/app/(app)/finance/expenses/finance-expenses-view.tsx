"use client";

import { useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { AppIcon } from "@/components/app-icon";
import DataTable from "@/components/data-table/data-table";
import { useDataTable } from "@/components/data-table/use-data-table";
import { downloadCsvFile } from "@/lib/csv-export";
import { csvHeaders, csvRows, filterRowsBySearch } from "@/lib/data-driven-ui";
import {
  createFinanceExpenseColumns,
  financeExpenseCsvColumns,
  financeExpenseSearch,
  financeExpenseTabs,
  type FinanceExpenseFilter,
  type FinanceExpenseRow,
} from "./finance-expenses-metadata";

export type { FinanceExpenseRow } from "./finance-expenses-metadata";

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
  const [filter, setFilter] = useState<FinanceExpenseFilter>("all");
  const [branchFilter, setBranchFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState(() =>
    rows.some((row) => row.categorySnapshot === initialCategory) ? initialCategory : "all",
  );

  const columns = useMemo(() => createFinanceExpenseColumns(canManage), [canManage]);
  const categories = useMemo(() => Array.from(new Set(rows.map((row) => row.categorySnapshot)))
    .sort((a, b) => a.localeCompare(b, "ar")), [rows]);
  const counts = useMemo(() => Object.fromEntries(
    financeExpenseTabs.map((tab) => [tab.id, rows.filter(tab.matches).length]),
  ) as Record<FinanceExpenseFilter, number>, [rows]);

  const filtered = useMemo(() => {
    const tab = financeExpenseTabs.find((item) => item.id === filter) ?? financeExpenseTabs[0];
    const selected = rows.filter((row) =>
      tab.matches(row) &&
      (branchFilter === "all" || row.branchId === branchFilter) &&
      (categoryFilter === "all" || row.categorySnapshot === categoryFilter),
    );
    return filterRowsBySearch(selected, query, financeExpenseSearch.text);
  }, [rows, query, filter, branchFilter, categoryFilter]);

  // الفرز والترقيم فوق نفس أعمدة الـMetadata؛ تغيير أي مرشّح يعيد الصفحة الأولى.
  const table = useDataTable({ rows: filtered, columns, initialPageSize: 25, resetKey: [query, filter, branchFilter, categoryFilter].join("\u0000") });
  const tabOrder = financeExpenseTabs.map((tab) => tab.id);
  function handleTabListKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    // قائمة العرض RTL: السهم الأيسر ينقل إلى التبويب التالي (ترتيب القراءة)، والأيمن إلى السابق.
    const delta = event.key === "ArrowLeft" ? 1 : event.key === "ArrowRight" ? -1 : 0;
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
      csvHeaders(financeExpenseCsvColumns),
      // التصدير يشمل كل النتائج المطابقة للتصفية بترتيب الفرز الظاهر، لا الصفحة المعروضة وحدها.
      csvRows(table.sortedRows, financeExpenseCsvColumns),
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
              placeholder={financeExpenseSearch.placeholder}
              aria-label={financeExpenseSearch.ariaLabel}
            />
            {query ? (
              <button type="button" className="fin-search-box__clear" onClick={() => setQuery("")} aria-label="مسح البحث">
                <AppIcon name="close" />
              </button>
            ) : null}
          </div>

          {categories.length > 1 ? (
            <select className="fin-branch-select" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="تصفية حسب البند">
              <option value="all">كل البنود ({categories.length})</option>
              {categories.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
          ) : null}

          {branches.length > 1 ? (
            <select className="fin-branch-select" value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} aria-label="تصفية حسب الفرع">
              <option value="all">كل الفروع ({branches.length})</option>
              {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.label}</option>)}
            </select>
          ) : null}

          <button type="button" className="fin-button fin-button--secondary" onClick={handleExportCsv} disabled={filtered.length === 0}>
            <AppIcon name="download" />
            <span>تصدير CSV ({filtered.length})</span>
          </button>
        </div>

        <div className="fin-toolbar__row">
          <div className="fin-filter-pills" role="tablist" aria-label="حالة المصروف" onKeyDown={handleTabListKeyDown}>
            {financeExpenseTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`fin-tab-${tab.id.toLowerCase()}`}
                aria-controls="fin-expenses-panel"
                aria-selected={filter === tab.id}
                tabIndex={filter === tab.id ? 0 : -1}
                className={`fin-filter-pill${filter === tab.id ? " is-active" : ""}`}
                onClick={() => setFilter(tab.id)}
              >
                <span>{tab.label}</span>
                <span className="fin-filter-pill__count">{counts[tab.id]}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="fin-panel" role="tabpanel" id="fin-expenses-panel" aria-labelledby={`fin-tab-${filter.toLowerCase()}`}>
        <div className="fin-panel__heading">
          <h2>كل المصروفات</h2>
          <p>المبلغ الظاهر هو المبلغ الفعال بعد أي تصحيح مؤكد.</p>
        </div>

        {filtered.length === 0 ? (
          <div className="fin-empty" role="status">لا توجد مصروفات تطابق معايير البحث أو التصفية الحالية.</div>
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
