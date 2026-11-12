import React, { Fragment, type ReactNode } from "react";

export type DataColumn<Row> = {
  id: string;
  header: ReactNode;
  headerAriaLabel?: string;
  headerClassName?: string;
  renderCell: (row: Row, index: number) => ReactNode;
  cellClassName?: string | ((row: Row) => string | undefined);
  cellColSpan?: (row: Row) => number | undefined;
  cellHidden?: (row: Row) => boolean;
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
}: DataTableProps<Row>) {
  return (
    <div className={regionClassName} role="region" aria-label={regionLabel} tabIndex={0}>
      <table className={tableClassName}>
        {caption ? <caption>{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.id} scope="col" aria-label={column.headerAriaLabel} className={column.headerClassName}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && emptyState ? (
            <tr><td colSpan={columns.length} className="muted">{emptyState}</td></tr>
          ) : rows.map((row, index) => (
            <Fragment key={rowKey(row)}>
              <tr className={rowClassName?.(row)}>
                {columns.filter((column) => !column.cellHidden?.(row)).map((column) => (
                  <td
                    key={column.id}
                    colSpan={column.cellColSpan?.(row)}
                    className={typeof column.cellClassName === "function"
                      ? column.cellClassName(row)
                      : column.cellClassName}
                  >
                    {column.renderCell(row, index)}
                  </td>
                ))}
              </tr>
              {renderAfterRow?.(row)}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
