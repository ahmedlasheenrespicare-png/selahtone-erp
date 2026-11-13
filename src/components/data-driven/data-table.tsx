import React, { Fragment, type ReactNode } from "react";
import {
  dataTableAriaSort,
  type DataTableSort,
  type DataTableSortDirection,
  type DataTableSortValue,
  type DataTableValueKind,
} from "../data-table/data-table-model";

export type DataColumn<Row> = {
  id: string;
  header: ReactNode;
  headerAriaLabel?: string;
  headerClassName?: string;
  renderCell: (row: Row, index: number) => ReactNode;
  cellClassName?: string | ((row: Row) => string | undefined);
  cellColSpan?: (row: Row) => number | undefined;
  cellHidden?: (row: Row) => boolean;
  cellAsRowHeader?: boolean;
  /**
   * وجودها يجعل العمود قابلًا للفرز متى مرّرت الشاشة `onSort`؛ وغيابها يبقيه عمودًا
   * ثابتًا (عمود الإجراءات مثلًا). الفرز يقرأ قيمة خامّة (قرش/تاريخ/نص) لا النص المنسّق.
   */
  sortValue?: (row: Row) => DataTableSortValue;
  sortKind?: DataTableValueKind;
  initialSortDirection?: DataTableSortDirection;
  /** نص صريح لزر الفرز لقارئ الشاشة حين يكون الرأس أيقونة أو نصًا مركّبًا. */
  sortLabel?: string;
};

type DataTableProps<Row> = {
  rows: readonly Row[];
  columns: readonly DataColumn<Row>[];
  rowKey: (row: Row) => string;
  rowClassName?: (row: Row) => string | undefined;
  renderAfterRow?: (row: Row) => ReactNode;
  regionLabel: string;
  regionClassName?: string;
  tableClassName?: string;
  caption?: ReactNode;
  emptyState?: ReactNode;
  showColumnHeaders?: boolean;
  /** الفرز اختياري: بلا `onSort` يبقى الجدول عرضًا ثابتًا كما كان (ومنه جداول الخادم). */
  sort?: DataTableSort;
  onSort?: (key: string, initialDirection?: DataTableSortDirection) => void;
  emptyRowClassName?: string;
  emptyCellClassName?: string;
};

/** A small, typed renderer: resources own metadata, not table markup. */
export default function DataTable<Row>({
  rows,
  columns,
  rowKey,
  rowClassName,
  renderAfterRow,
  regionLabel,
  regionClassName = "inv-table-wrap table-wrap",
  tableClassName,
  caption,
  emptyState,
  showColumnHeaders = true,
  sort = null,
  onSort,
  emptyRowClassName,
  emptyCellClassName = "muted",
}: DataTableProps<Row>) {
  return (
    <div className={regionClassName} role="region" aria-label={regionLabel} tabIndex={0}>
      <table className={tableClassName}>
        {caption ? <caption>{caption}</caption> : null}
        {showColumnHeaders ? <thead>
          <tr>
            {columns.map((column) => {
              const sortable = Boolean(onSort && column.sortValue);
              const ariaSort = sortable ? dataTableAriaSort(sort, column.id) : undefined;
              return (
                <th
                  key={column.id}
                  scope="col"
                  aria-sort={ariaSort}
                  aria-label={column.headerAriaLabel}
                  className={`${column.headerClassName ?? ""}${sortable ? " data-table__th--sortable" : ""}`.trim() || undefined}
                >
                  {sortable ? (
                    <button
                      type="button"
                      className="data-table__sort"
                      onClick={() => onSort?.(column.id, column.initialSortDirection)}
                      aria-label={`ترتيب حسب ${column.sortLabel ?? (typeof column.header === "string" ? column.header : column.id)}`}
                      data-direction={ariaSort === "none" ? "none" : sort?.direction}
                    >
                      <span className="data-table__sort-text">{column.header}</span>
                      <span className="data-table__sort-icon" aria-hidden="true" />
                    </button>
                  ) : column.header}
                </th>
              );
            })}
          </tr>
        </thead> : null}
        <tbody>
          {rows.length === 0 && emptyState ? (
            <tr className={emptyRowClassName}><td colSpan={columns.length} className={emptyCellClassName}>{emptyState}</td></tr>
          ) : rows.map((row, index) => (
            <Fragment key={rowKey(row)}>
              <tr className={rowClassName?.(row)}>
                {columns.filter((column) => !column.cellHidden?.(row)).map((column) => {
                  const Cell = column.cellAsRowHeader ? "th" : "td";
                  return <Cell
                    key={column.id}
                    scope={column.cellAsRowHeader ? "row" : undefined}
                    colSpan={column.cellColSpan?.(row)}
                    className={typeof column.cellClassName === "function"
                      ? column.cellClassName(row)
                      : column.cellClassName}
                  >
                    {column.renderCell(row, index)}
                  </Cell>;
                })}
              </tr>
              {renderAfterRow?.(row)}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
