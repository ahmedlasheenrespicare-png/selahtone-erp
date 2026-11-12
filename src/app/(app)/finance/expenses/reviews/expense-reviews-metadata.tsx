import Link from "next/link";
import type { DataColumn } from "@/components/data-driven/data-table";

export type ExpenseReviewQueueRow = {
  id: string;
  expenseId: string;
  branchLabel: string;
  expenseStatusLabel: string;
  revisionMismatch: boolean;
  reason: string;
  proposedAmountLabel: string;
  paymentEvidenceLabel: string;
  createdBy: string;
  createdAt: string;
};

export const expenseReviewQueueColumns: DataColumn<ExpenseReviewQueueRow>[] = [
  {
    id: "review",
    header: "الطلب والمصروف",
    renderCell: (row) => <>طلب #{row.id} · <Link href={`/finance/expenses/${row.expenseId}`}>مصروف #{row.expenseId}</Link></>,
  },
  {
    id: "branch-status",
    header: "الفرع والحالة",
    renderCell: (row) => <>{row.branchLabel} · {row.expenseStatusLabel}{row.revisionMismatch ? " · إصدار الطلب لا يطابق المصروف الحالي" : ""}</>,
  },
  { id: "reason", header: "السبب والمقترح", renderCell: (row) => `${row.reason} · ${row.proposedAmountLabel}` },
  { id: "payment", header: "بيانات الدفع المسجلة", renderCell: (row) => row.paymentEvidenceLabel },
  { id: "created", header: "التسجيل", renderCell: (row) => `مسجّل #${row.createdBy} · ${row.createdAt}` },
];
