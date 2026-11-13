"use client";

import type { ReactNode } from "react";
import { dataTableAriaSort, type DataTableSortDirection, type DataTableSortValue, type DataTableValueKind } from "./data-table-model";
import type { DataTableState } from "./use-data-table";
import "./data-table.css";

/**
 * جدول سجلات موحّد لكل الأقسام: رأس عمود قابل للنقر للفرز + ترقيم صفحات.
 * العرض فقط: لا جلب بيانات ولا حفظ، والصلاحيات تبقى في الصفحة التي تبني الخلايا.
 * الشكل يرث توكنز القسم المضيف (fin-* / sl-* / inv-*) عبر تمرير أسماء فئات الجدول كما هي.
 */
export type DataTableColumn<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T, index: number) => ReactNode;
  /** وجودها يجعل العمود قابلًا للفرز؛ غيابها يبقيه عمودًا ثابتًا (مثل عمود الإجراءات). */
  sortValue?: (row: T) => DataTableSortValue;
  kind?: DataTableValueKind;
  initialDirection?: DataTableSortDirection;
  /** نص صريح لزر الفرز لقارئ الشاشة، عندما يكون رأس العمود أيقونة أو نصًا مركّبًا. */
  sortLabel?: string;
  align?: "start" | "center" | "end";
  /** فئة الخلية: ثابتة أو دالة على الصف (مثل تلوين رصيد متبقٍ مقابل صفر). */
  className?: string | ((row: T, index: number) => string | undefined);
  headerClassName?: string;
};

const nf = new Intl.NumberFormat("ar-EG-u-nu-latn", { maximumFractionDigits: 0 });

export default function DataTable<T>({
  state,
  columns,
  rowKey,
  ariaLabel,
  caption,
  tableClassName,
  wrapClassName,
  className,
  rowClassName,
  emptyState,
  pageSizeOptions = [10, 25, 50, 100],
  allRowsOptionLabel = "كل النتائج",
  showPagination = true,
}: {
  state: DataTableState<T>;
  columns: ReadonlyArray<DataTableColumn<T>>;
  rowKey: (row: T, index: number) => string;
  ariaLabel: string;
  caption?: ReactNode;
  tableClassName?: string;
  wrapClassName?: string;
  className?: string;
  rowClassName?: (row: T, index: number) => string | undefined;
  emptyState?: ReactNode;
  pageSizeOptions?: readonly number[];
  allRowsOptionLabel?: string;
  showPagination?: boolean;
}) {
  const { sort, toggleSort, pageRows, page, pageCount, pageSize, total, from, to, setPage, setPageSize } = state;
  const rangeText = total === 0
    ? "لا سجلات مطابقة"
    : `عرض ${nf.format(from)}–${nf.format(to)} من ${nf.format(total)}`;

  return (
    <div className={className ? `data-table ${className}` : "data-table"}>
      <div
        className={wrapClassName ? `data-table__wrap ${wrapClassName}` : "data-table__wrap"}
        role="region"
        aria-label={ariaLabel}
        tabIndex={0}
      >
        <table className={tableClassName ? `data-table__table ${tableClassName}` : "data-table__table"}>
          {caption ? <caption>{caption}</caption> : null}
          <thead>
            <tr>
              {columns.map((column) => {
                const sortable = Boolean(column.sortValue);
                const ariaSort = sortable ? dataTableAriaSort(sort, column.key) : undefined;
                const alignClass = column.align ? ` data-table__cell--${column.align}` : "";
                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={ariaSort}
                    aria-label={column.sortLabel && !sortable ? column.sortLabel : undefined}
                    className={`${column.headerClassName ?? ""}${alignClass}${sortable ? " data-table__th--sortable" : ""}`.trim() || undefined}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        className="data-table__sort"
                        onClick={() => toggleSort(column.key, column.initialDirection)}
                        aria-label={`ترتيب حسب ${column.sortLabel ?? (typeof column.header === "string" ? column.header : column.key)}`}
                        data-direction={ariaSort === "none" ? "none" : sort?.direction}
                      >
                        <span className="data-table__sort-text">{column.header}</span>
                        <span className="data-table__sort-icon" aria-hidden="true" />
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr className="data-table__empty-row">
                <td colSpan={columns.length} className="data-table__empty-cell">
                  {emptyState ?? "لا توجد سجلات مطابقة."}
                </td>
              </tr>
            ) : (
              pageRows.map((row, index) => (
                <tr key={rowKey(row, index)} className={rowClassName?.(row, index)}>
                  {columns.map((column) => {
                    const rowIndex = (page - 1) * (pageSize > 0 ? pageSize : total) + index;
                    const cellClass = typeof column.className === "function"
                      ? column.className(row, rowIndex)
                      : column.className;
                    return (
                      <td
                        key={column.key}
                        className={`${cellClass ?? ""}${column.align ? ` data-table__cell--${column.align}` : ""}`.trim() || undefined}
                      >
                        {column.cell(row, rowIndex)}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showPagination ? (
        <div className="data-table__bar no-print">
          <p className="data-table__range" aria-live="polite">{rangeText}</p>

          <div className="data-table__controls">
            <label className="data-table__size">
              <span>صفوف بالصفحة</span>
              <select
                value={pageSize}
                onChange={(event) => setPageSize(Number(event.target.value))}
                aria-label="عدد الصفوف في الصفحة"
              >
                {pageSizeOptions.map((option) => (
                  <option key={option} value={option}>{nf.format(option)}</option>
                ))}
                <option value={0}>{allRowsOptionLabel}</option>
              </select>
            </label>

            <nav className="data-table__pager" aria-label={`تنقل صفحات ${ariaLabel}`}>
              <button
                type="button"
                className="data-table__page-btn"
                onClick={() => setPage(page - 1)}
                disabled={page <= 1}
                aria-label="الصفحة السابقة"
              >
                <span aria-hidden="true">›</span>
              </button>
              <span className="data-table__page-status">
                صفحة <bdi dir="ltr">{nf.format(page)}</bdi> من <bdi dir="ltr">{nf.format(pageCount)}</bdi>
              </span>
              <button
                type="button"
                className="data-table__page-btn"
                onClick={() => setPage(page + 1)}
                disabled={page >= pageCount}
                aria-label="الصفحة التالية"
              >
                <span aria-hidden="true">‹</span>
              </button>
            </nav>
          </div>
        </div>
      ) : null}

      {/* على الورق: لا نخفي القص صامتًا — نطبع نطاق الصفوف المعروض وعدد النتائج الكلي. */}
      {showPagination ? (
        <p className="data-table__print-note">{rangeText} — بترتيب الفرز المعروض على الشاشة.</p>
      ) : null}
    </div>
  );
}
