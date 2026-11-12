import Link from "next/link";
import React from "react";
import type { DataColumn } from "@/components/data-driven/data-table";
import type { DataCsvColumn, DataFilterTab } from "@/lib/data-driven-ui";

export type FinanceExpenseRow = {
  id: string;
  expenseDate: string;
  branchId: string;
  branchName: string;
  categorySnapshot: string;
  description: string;
  amountFormatted: string;
  status: string;
  statusLabel: string;
};

export type FinanceExpenseFilter = "all" | "PENDING" | "APPROVED" | "PAID";

export const financeExpenseSearch = {
  ariaLabel: "بحث في المصروفات",
  placeholder: "ابحث بالوصف أو البند أو الفرع أو التاريخ…",
  text: (expense: FinanceExpenseRow): readonly string[] => [[
    expense.description,
    expense.categorySnapshot,
    expense.branchName,
    expense.expenseDate,
    expense.id,
  ].join(" ")],
};

export const financeExpenseTabs: Array<DataFilterTab<FinanceExpenseRow, FinanceExpenseFilter>> = [
  { id: "all", label: "الكل", matches: () => true },
  { id: "PENDING", label: "بانتظار الاعتماد", matches: (expense) => expense.status === "PENDING" },
  { id: "APPROVED", label: "معتمد للصرف", matches: (expense) => expense.status === "APPROVED" },
  { id: "PAID", label: "مدفوع", matches: (expense) => expense.status === "PAID" },
];

export const financeExpenseCsvColumns: DataCsvColumn<FinanceExpenseRow>[] = [
  { header: "رقم المصروف", value: (expense) => expense.id },
  { header: "التاريخ", value: (expense) => expense.expenseDate },
  { header: "الفرع", value: (expense) => expense.branchName },
  { header: "البند", value: (expense) => expense.categorySnapshot },
  { header: "الوصف", value: (expense) => expense.description },
  { header: "المبلغ (ج.م)", value: (expense) => expense.amountFormatted },
  { header: "الحالة", value: (expense) => expense.statusLabel },
];

function badgeClass(status: string): string {
  if (status === "PENDING") return "fin-badge fin-badge--pending";
  if (status === "APPROVED") return "fin-badge fin-badge--approved";
  if (status === "PAID") return "fin-badge fin-badge--paid";
  return "fin-badge fin-badge--closed";
}

export function createFinanceExpenseColumns(canManage: boolean): DataColumn<FinanceExpenseRow>[] {
  return [
    {
      id: "date",
      header: "التاريخ",
      renderCell: (expense) => <bdi dir="ltr">{expense.expenseDate}</bdi>,
    },
    { id: "branch", header: "الفرع", renderCell: (expense) => expense.branchName },
    {
      id: "category",
      header: "البند",
      renderCell: (expense) => <span className="fin-badge fin-badge--vault">{expense.categorySnapshot}</span>,
    },
    { id: "description", header: "الوصف", renderCell: (expense) => expense.description },
    {
      id: "amount",
      header: "المبلغ",
      renderCell: (expense) => <span className="fin-money"><bdi dir="ltr">{expense.amountFormatted}</bdi> ج.م</span>,
    },
    {
      id: "status",
      header: "الحالة",
      renderCell: (expense) => <span className={badgeClass(expense.status)}>{expense.statusLabel}</span>,
    },
    ...(canManage ? [{
      id: "action",
      header: "إجراء",
      renderCell: (expense: FinanceExpenseRow) => (
        <Link className="fin-button fin-button--text" href={`/finance/expenses/${expense.id}`}>
          <span>تفاصيل</span>
        </Link>
      ),
    }] : []),
  ];
}
