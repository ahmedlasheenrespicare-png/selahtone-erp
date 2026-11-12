import type { DataColumn } from "@/components/data-driven/data-table";

export type ExpenseInformationRow = { id: string; label: string; value: string };
export const expenseInformationColumns: DataColumn<ExpenseInformationRow>[] = [
  { id: "label", header: "البيان", renderCell: (row) => row.label, cellAsRowHeader: true },
  { id: "value", header: "القيمة", renderCell: (row) => row.value },
];

export type ExpensePaymentDetailRow = {
  id: string;
  amountFormatted: string;
  sourceLabel: string;
  accountLabel: string;
  methodLabel: string;
  paymentDate: string;
  recordedByLabel: string;
};

export const expensePaymentColumns: DataColumn<ExpensePaymentDetailRow>[] = [
  { id: "amount", header: "المبلغ", renderCell: (row) => row.amountFormatted },
  { id: "source", header: "المصدر", renderCell: (row) => row.sourceLabel },
  { id: "account", header: "الحساب", renderCell: (row) => row.accountLabel },
  { id: "method", header: "الطريقة", renderCell: (row) => row.methodLabel },
  { id: "date", header: "التاريخ", renderCell: (row) => row.paymentDate },
  { id: "actor", header: "مسجّل الدفع", renderCell: (row) => row.recordedByLabel },
];

export type OpenExpenseReviewRow = {
  id: string;
  reason: string;
  proposedAmountLabel: string;
  createdByLabel: string;
  createdAt: string;
  revisionMismatch: boolean;
};

export const openExpenseReviewColumns: DataColumn<OpenExpenseReviewRow>[] = [
  { id: "review", header: "الطلب", renderCell: (row) => <>#{row.id}{row.revisionMismatch ? <div>تنبيه: إصدار المصروف اختلف منذ الطلب؛ راجع الوضع الحالي قبل القرار.</div> : null}</> },
  { id: "reason", header: "السبب", renderCell: (row) => row.reason },
  { id: "proposed", header: "المبلغ المقترح", renderCell: (row) => row.proposedAmountLabel },
  { id: "creator", header: "المسجّل", renderCell: (row) => row.createdByLabel },
  { id: "created-at", header: "وقت التسجيل", renderCell: (row) => row.createdAt },
];

export type ExpenseReviewHistoryRow = {
  id: string;
  statusLabel: string;
  reasonAndAmount: string;
  createdLabel: string;
  decisionLabel: string;
};

export const expenseReviewHistoryColumns: DataColumn<ExpenseReviewHistoryRow>[] = [
  { id: "review", header: "الطلب", renderCell: (row) => `#${row.id}` },
  { id: "status", header: "الحالة", renderCell: (row) => row.statusLabel },
  { id: "reason", header: "سبب الطلب والمبلغ المقترح", renderCell: (row) => row.reasonAndAmount },
  { id: "created", header: "التسجيل", renderCell: (row) => row.createdLabel },
  { id: "decision", header: "قرار المراجعة المسجل", renderCell: (row) => row.decisionLabel },
];

export type ExpenseCorrectionRow = {
  id: string;
  reviewId: string;
  paymentId: string;
  beforeAmountFormatted: string;
  afterAmountFormatted: string;
  accountAndDifferenceLabel: string;
  reasonAndCreatedLabel: string;
};

export const expenseCorrectionColumns: DataColumn<ExpenseCorrectionRow>[] = [
  { id: "correction", header: "التصحيح والمراجعة والدفع", renderCell: (row) => `#${row.id} · مراجعة #${row.reviewId} · دفع #${row.paymentId}` },
  { id: "before", header: "المبلغ السابق", renderCell: (row) => row.beforeAmountFormatted },
  { id: "after", header: "المبلغ المسجل بعد التصحيح", renderCell: (row) => row.afterAmountFormatted },
  { id: "difference", header: "الحساب والفرق الدفتري المسجل", renderCell: (row) => row.accountAndDifferenceLabel },
  { id: "reason", header: "السبب والتسجيل", renderCell: (row) => row.reasonAndCreatedLabel },
];

export type ExpenseCorrectionMovementRow = {
  id: string;
  correctionId: string;
  kind: string;
  branchId: string;
  sourceAndDestinationLabel: string;
  amountFormatted: string;
  actorAndCreatedLabel: string;
};

export const expenseCorrectionMovementColumns: DataColumn<ExpenseCorrectionMovementRow>[] = [
  { id: "movement", header: "الحركة والتصحيح", renderCell: (row) => `#${row.id} · تصحيح #${row.correctionId}` },
  { id: "kind", header: "النوع والفرع", renderCell: (row) => `${row.kind} · فرع #${row.branchId}` },
  { id: "accounts", header: "المصدر والوجهة المسجلان", renderCell: (row) => row.sourceAndDestinationLabel },
  { id: "amount", header: "المبلغ", renderCell: (row) => row.amountFormatted },
  { id: "actor", header: "المسجّل والوقت", renderCell: (row) => row.actorAndCreatedLabel },
];
