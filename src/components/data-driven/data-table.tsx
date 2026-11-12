import React, { type ReactNode } from "react";

export type DataColumn<Row> = {
  id: string;
  header: ReactNode;
  headerAriaLabel?: string;
  renderCell: (row: Row) => ReactNode;
  cellClassName?: string | ((row: Row) => string | undefined);
};

type DataTableProps<Row> = {
  rows: readonly Row[];
  columns: readonly DataColumn<Row>[];
  rowKey: (row: Row) => string;
  rowClassName?: (row: Row) => string | undefined;
  regionLabel: string;
  tableClassName?: string;
};

/** A small, typed renderer: resources own metadata, not table markup. */
export default function DataTable<Row>({
  rows,
  columns,
  rowKey,
  rowClassName,
  regionLabel,
  tableClassName,
}: DataTableProps<Row>) {
  return (
    <div className="inv-table-wrap table-wrap" role="region" aria-label={regionLabel} tabIndex={0}>
      <table className={tableClassName}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.id} scope="col" aria-label={column.headerAriaLabel}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className={rowClassName?.(row)}>
              {columns.map((column) => (
                <td
                  key={column.id}
                  className={typeof column.cellClassName === "function"
                    ? column.cellClassName(row)
                    : column.cellClassName}
                >
                  {column.renderCell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
