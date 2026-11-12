import type { ReactNode } from "react";
import type { DataColumn } from "@/components/data-driven/data-table";

export type EmployeeSettlementRow = {
  id: string;
  createdOn: string;
  systemBalanceFormatted: string;
  salesFormatted: string;
  expensesFormatted: string;
  expectedFormatted: string;
  countedFormatted: string;
  deviationFormatted: string;
  statusLabel: string;
  statusTone: "pending" | "paid" | "closed";
  isOpen: boolean;
};

export function createEmployeeSettlementColumns(options: {
  canCancel: boolean;
  renderCancelAction: (row: EmployeeSettlementRow) => ReactNode;
}): DataColumn<EmployeeSettlementRow>[] {
  return [
    { id: "date", header: "التاريخ", renderCell: (row) => row.createdOn },
    { id: "system", header: "الرصيد النظامي", renderCell: (row) => row.systemBalanceFormatted },
    { id: "sales", header: "المبيعات", renderCell: (row) => row.salesFormatted },
    { id: "expenses", header: "المصروفات", renderCell: (row) => row.expensesFormatted },
    { id: "expected", header: "مؤشر الفترة", renderCell: (row) => row.expectedFormatted },
    { id: "counted", header: "المعدود", renderCell: (row) => row.countedFormatted },
    { id: "deviation", header: "الفرق عن المؤشر", renderCell: (row) => row.deviationFormatted },
    {
      id: "status", header: "الحالة", renderCell: (row) => (
        <span className={`fin-badge fin-badge--${row.statusTone}`}>{row.statusLabel}</span>
      ),
    },
    {
      id: "action", header: "إجراء", renderCell: (row) => (
        row.isOpen && options.canCancel ? options.renderCancelAction(row) : <span className="fin-field__hint">—</span>
      ),
    },
  ];
}
