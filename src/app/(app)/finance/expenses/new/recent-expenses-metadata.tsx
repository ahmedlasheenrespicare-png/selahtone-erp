import Link from "next/link";
import type { DataColumn } from "@/components/data-driven/data-table";

export type RecentExpenseRow = {
  id: string;
  expenseDate: string;
  branchName: string;
  categoryName: string;
  description: string;
  beneficiary: string | null;
  documentNumber: string | null;
  amountFormatted: string;
  statusLabel: string;
  statusTone: "pending" | "approved" | "paid";
};

export function createRecentExpenseColumns(canManage: boolean): DataColumn<RecentExpenseRow>[] {
  return [
    {
      id: "expense", header: "#", renderCell: (row) => (
        <bdi dir="ltr">{canManage ? <Link href={`/finance/expenses/${row.id}`}><strong>#{row.id}</strong></Link> : <strong>#{row.id}</strong>}</bdi>
      ),
    },
    { id: "date", header: "التاريخ", renderCell: (row) => <bdi dir="ltr">{row.expenseDate}</bdi> },
    ...(canManage ? [{ id: "branch", header: "الفرع", renderCell: (row: RecentExpenseRow) => row.branchName }] : []),
    { id: "category", header: "البند", renderCell: (row) => row.categoryName },
    {
      id: "description", header: "البيان والمستفيد", renderCell: (row) => (
        <>
          <strong>{row.description}</strong>
          {row.beneficiary || row.documentNumber ? (
            <div style={{ fontSize: 11.5, color: "var(--fn-muted)" }}>
              {row.beneficiary ?? ""}{row.beneficiary && row.documentNumber ? " · " : ""}{row.documentNumber ? `مستند: ${row.documentNumber}` : ""}
            </div>
          ) : null}
        </>
      ),
    },
    { id: "amount", header: "المبلغ", renderCell: (row) => <bdi dir="ltr"><strong>{row.amountFormatted}</strong></bdi> },
    {
      id: "status", header: "الحالة", renderCell: (row) => (
        <span className={`fin-badge fin-badge--${row.statusTone}`}>{row.statusLabel}</span>
      ),
    },
  ];
}
