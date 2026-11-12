"use client";

import { useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { AppIcon } from "@/components/app-icon";
import DataTable from "@/components/data-driven/data-table";
import { downloadCsvFile } from "@/lib/csv-export";
import { csvHeaders, csvRows, filterRowsBySearch } from "@/lib/data-driven-ui";
import { EditCategoryForm } from "./category-forms";

import {
  categoryAuditColumns,
  categoryAuditCsvColumns,
  categoryAuditFilters,
  categoryAuditSearch,
  categoryDirectorySearch,
  categoryFilters,
  categorySortOptions,
  createCategoryCsvColumns,
  createCategoryDirectoryColumns,
  sortCategoryDirectory,
  type AuditFilter,
  type CategoryAuditItem,
  type CategoryDirectoryItem,
  type CategoryFilter,
  type CategorySort,
} from "./categories-directory-metadata";

export type { CategoryAuditItem, CategoryDirectoryItem } from "./categories-directory-metadata";

type ActiveTab = "directory" | "audit";

type Props = {
  canEdit: boolean;
  canCreateExpense: boolean;
  canOpenExpenses: boolean;
  categories: CategoryDirectoryItem[];
  auditRows: CategoryAuditItem[];
  currentMonthLabel: string;
  prevMonthLabel: string;
  seedRequestId: string;
};

export default function CategoriesDirectoryView({
  canEdit,
  canCreateExpense,
  canOpenExpenses,
  categories,
  auditRows,
  currentMonthLabel,
  prevMonthLabel,
  seedRequestId,
}: Props) {
  const [tab, setTab] = useState<ActiveTab>("directory");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<CategoryFilter>("all");
  const [sortBy, setSortBy] = useState<CategorySort>("month_desc");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [auditQuery, setAuditQuery] = useState("");
  const [auditFilter, setAuditFilter] = useState<AuditFilter>("all");

  const existingNames = useMemo(
    () => categories.map((c) => c.name),
    [categories],
  );

  const counts = useMemo(() => Object.fromEntries(
    categoryFilters.map((item) => [item.id, categories.filter(item.matches).length]),
  ) as Record<CategoryFilter, number>, [categories]);

  const filteredCategories = useMemo(() => {
    const activeFilter = categoryFilters.find((item) => item.id === filter) ?? categoryFilters[0];
    const filtered = categories.filter(activeFilter.matches);
    return sortCategoryDirectory(filterRowsBySearch(filtered, query, categoryDirectorySearch.text), sortBy);
  }, [categories, query, filter, sortBy]);

  const auditCounts = useMemo(() => Object.fromEntries(
    categoryAuditFilters.map((item) => [item.id, auditRows.filter(item.matches).length]),
  ) as Record<AuditFilter, number>, [auditRows]);

  const filteredAudit = useMemo(() => {
    const activeFilter = categoryAuditFilters.find((item) => item.id === auditFilter) ?? categoryAuditFilters[0];
    return filterRowsBySearch(auditRows.filter(activeFilter.matches), auditQuery, categoryAuditSearch.text);
  }, [auditRows, auditQuery, auditFilter]);

  function handleCopyCode(cat: CategoryDirectoryItem) {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(cat.code).catch(() => {});
      setCopiedId(cat.id);
      setTimeout(() => {
        setCopiedId((prev) => (prev === cat.id ? null : prev));
      }, 1800);
    }
  }

  function jumpToCategoryAudit(categoryName: string) {
    setTab("audit");
    setAuditFilter("all");
    setAuditQuery(categoryName);
  }

  function handleMainTabKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    // قائمة RTL: الأيسر للتالي والأيمن للسابق (ترتيب القراءة العربية).
    const delta = event.key === "ArrowLeft" ? 1 : event.key === "ArrowRight" ? -1 : 0;
    if (delta === 0) return;
    event.preventDefault();
    const next = tab === "directory" ? "audit" : "directory";
    setTab(next);
    document.getElementById(`fin-cat-tab-${next}`)?.focus();
  }

  function handleExportCategoriesCsv() {
    const columns = createCategoryCsvColumns(currentMonthLabel, prevMonthLabel);
    downloadCsvFile(
      `selahtone-expense-categories-${new Date().toISOString().slice(0, 10)}.csv`,
      csvHeaders(columns), csvRows(filteredCategories, columns),
    );
  }

  function handleExportAuditCsv() {
    downloadCsvFile(
      `selahtone-category-audit-${new Date().toISOString().slice(0, 10)}.csv`,
      csvHeaders(categoryAuditCsvColumns), csvRows(filteredAudit, categoryAuditCsvColumns),
    );
  }

  return (
    <section id="categories-directory" aria-label="دليل البنود وسجل التدقيق">
      <div className="fin-toolbar no-print">
        <div className="fin-toolbar__row">
          <div className="fin-filter-pills" role="tablist" aria-label="عرض البنود أو سجل التعديلات" onKeyDown={handleMainTabKeyDown}>
            <button
              type="button"
              role="tab"
              id="fin-cat-tab-directory"
              aria-controls="fin-cat-directory-panel"
              tabIndex={tab === "directory" ? 0 : -1}
              aria-selected={tab === "directory"}
              className={`fin-filter-pill${tab === "directory" ? " is-active" : ""}`}
              onClick={() => setTab("directory")}
            >
              <span>دليل البنود والإنفاق</span>
              <span className="fin-filter-pill__count">{categories.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              id="fin-cat-tab-audit"
              aria-controls="fin-cat-audit-panel"
              tabIndex={tab === "audit" ? 0 : -1}
              aria-selected={tab === "audit"}
              className={`fin-filter-pill${tab === "audit" ? " is-active" : ""}`}
              onClick={() => setTab("audit")}
            >
              <span>سجل تعديلات البنود</span>
              <span className="fin-filter-pill__count">{auditRows.length}</span>
            </button>
          </div>
        </div>

        {tab === "directory" ? (
          <>
            <div className="fin-toolbar__row">
              <div className="fin-search-box">
                <svg
                  className="fin-search-box__icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <circle cx="11" cy="11" r="7" />
                  <line x1="20" y1="20" x2="16.3" y2="16.3" />
                </svg>
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={categoryDirectorySearch.placeholder}
                  aria-label="بحث في بنود المصروفات"
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

              <select
                className="fin-branch-select"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as CategorySort)}
                aria-label="ترتيب البنود"
              >
                {categorySortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>

              <button
                type="button"
                className="fin-button fin-button--secondary"
                onClick={handleExportCategoriesCsv}
                disabled={filteredCategories.length === 0}
              >
                <AppIcon name="download" />
                <span>تصدير CSV ({filteredCategories.length})</span>
              </button>
            </div>

            <div className="fin-toolbar__row">
              <div className="fin-filter-pills" role="group" aria-label="تصفية البنود">
                {categoryFilters.map((item) => (
                  <button key={item.id} type="button" aria-pressed={filter === item.id} className={`fin-filter-pill${filter === item.id ? " is-active" : ""}`} onClick={() => setFilter(item.id)}>
                    <span>{item.label}</span><span className="fin-filter-pill__count">{counts[item.id]}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="fin-toolbar__row">
              <div className="fin-search-box">
                <svg
                  className="fin-search-box__icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <circle cx="11" cy="11" r="7" />
                  <line x1="20" y1="20" x2="16.3" y2="16.3" />
                </svg>
                <input
                  type="search"
                  value={auditQuery}
                  onChange={(e) => setAuditQuery(e.target.value)}
                  placeholder={categoryAuditSearch.placeholder}
                  aria-label="بحث في سجل تعديلات البنود"
                />
                {auditQuery ? (
                  <button
                    type="button"
                    className="fin-search-box__clear"
                    onClick={() => setAuditQuery("")}
                    aria-label="مسح البحث"
                  >
                    <AppIcon name="close" />
                  </button>
                ) : null}
              </div>

              <button
                type="button"
                className="fin-button fin-button--secondary"
                onClick={handleExportAuditCsv}
                disabled={filteredAudit.length === 0}
              >
                <AppIcon name="download" />
                <span>تصدير سجل التدقيق CSV ({filteredAudit.length})</span>
              </button>
            </div>

            <div className="fin-toolbar__row">
              <div className="fin-filter-pills" role="group" aria-label="نوع التعديل">
                {categoryAuditFilters.map((item) => (
                  <button key={item.id} type="button" aria-pressed={auditFilter === item.id} className={`fin-filter-pill${auditFilter === item.id ? " is-active" : ""}`} onClick={() => setAuditFilter(item.id)}>
                    <span>{item.label}</span><span className="fin-filter-pill__count">{auditCounts[item.id]}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {tab === "directory" ? (
        <div className="fin-panel" role="tabpanel" id="fin-cat-directory-panel" aria-labelledby="fin-cat-tab-directory">
          <div className="fin-panel__heading">
            <h2>دليل البنود وتحليل الإنفاق الفعلي ({currentMonthLabel})</h2>
            <p>
              يُحتسب «المدفوع فعليًا» من المصروفات المصروفة (`PAID`) فقط، ويُعرض المعلّق تحت الإجراء منفصلًا دون خلط محاسبي.
            </p>
          </div>

          {filteredCategories.length === 0 ? (
            <div className="fin-empty">
              لا توجد بنود تطابق معايير البحث أو التصفية المحددة حاليًا.
            </div>
          ) : (
            <DataTable
              rows={filteredCategories}
              columns={createCategoryDirectoryColumns({
                currentMonthLabel, prevMonthLabel, editingId, copiedId, canEdit, canCreateExpense, canOpenExpenses,
                onCopyCode: handleCopyCode,
                onToggleEdit: (id) => setEditingId((previous) => previous === id ? null : id),
                onOpenAudit: jumpToCategoryAudit,
              })}
              rowKey={(item) => item.id}
              rowClassName={(item) => editingId === item.id ? "fin-cat-row--editing" : undefined}
              renderAfterRow={(item) => canEdit && editingId === item.id ? (
                <tr className="fin-cat-edit-row no-print">
                  <td colSpan={6}>
                    <EditCategoryForm requestId={seedRequestId} category={item} existingNames={existingNames} onCancel={() => setEditingId(null)} onSaved={() => setEditingId(null)} />
                  </td>
                </tr>
              ) : null}
              regionLabel="جدول مالي قابل للتمرير"
              regionClassName="fin-table-wrap"
              tableClassName="fin-table"
              caption="دليل البنود ومدفوعات الشهر مع مقارنة الشهر السابق"
            />
          )}
        </div>
      ) : (
        <div className="fin-panel" role="tabpanel" id="fin-cat-audit-panel" aria-labelledby="fin-cat-tab-audit">
          <div className="fin-panel__heading">
            <h2>سجل التدقيق وتعديلات بنود المصروفات</h2>
            <p>
              سجل رقابي غير قابل للحذف أو التعديل من جدول <code>finance.category_audit</code> يوثّق كل إنشاء أو تغيير مسمى أو إيقاف/تفعيل بسببه ومنفِّذه.
            </p>
          </div>

          {filteredAudit.length === 0 ? (
            <div className="fin-empty">
              {auditRows.length === 0
                ? "لا توجد تعديلات مسجّلة في سجل التدقيق بعد؛ سيُوثَّق هنا كل بند يُضاف أو يُعدَّل."
                : "لا توجد قيود تدقيق تطابق البحث أو التصفية الحالية."}
            </div>
          ) : (
            <DataTable
              rows={filteredAudit}
              columns={categoryAuditColumns}
              rowKey={(item) => item.id}
              regionLabel="جدول مالي قابل للتمرير"
              regionClassName="fin-table-wrap"
              tableClassName="fin-table"
              caption="سجل تدقيق بنود المصروفات — إنشاء وتعديل مسمى وإيقاف وتفعيل"
            />
          )}
        </div>
      )}
    </section>
  );
}
