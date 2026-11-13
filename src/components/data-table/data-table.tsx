"use client";

import type { ReactNode } from "react";
import DataDrivenDataTable, { type DataColumn } from "@/components/data-driven/data-table";
import type { DataTableState } from "./use-data-table";
import "./data-table.css";

/**
 * طبقة السلوك فوق مُصيّر الجدول المدفوع بالـMetadata (`data-driven/data-table`):
 * رأس عمود قابل للنقر للفرز + ترقيم صفحات + ملاحظة نطاق عند الطباعة.
 *
 * لا يوجد هنا ماركأب جدول ثانٍ: الأعمدة تبقى ملكًا لملفات الـMetadata، والمصيّر
 * واحد لكل الأقسام. هذه الطبقة للعرض فقط: لا جلب بيانات ولا حفظ، والصلاحيات تبقى
 * في الصفحة التي تبني الأعمدة. الشكل يرث توكنز القسم المضيف (fin-* / sl-* / inv-*).
 */
export type DataTableColumn<T> = DataColumn<T>;

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
  rowKey: (row: T) => string;
  ariaLabel: string;
  caption?: ReactNode;
  tableClassName?: string;
  wrapClassName?: string;
  className?: string;
  rowClassName?: (row: T) => string | undefined;
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
      <DataDrivenDataTable
        rows={pageRows}
        columns={columns}
        rowKey={rowKey}
        rowClassName={rowClassName}
        regionLabel={ariaLabel}
        regionClassName={wrapClassName ? `data-table__wrap ${wrapClassName}` : "data-table__wrap"}
        tableClassName={tableClassName ? `data-table__table ${tableClassName}` : "data-table__table"}
        caption={caption}
        emptyState={emptyState ?? "لا توجد سجلات مطابقة."}
        emptyRowClassName="data-table__empty-row"
        emptyCellClassName="data-table__empty-cell"
        sort={sort}
        onSort={toggleSort}
      />

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
