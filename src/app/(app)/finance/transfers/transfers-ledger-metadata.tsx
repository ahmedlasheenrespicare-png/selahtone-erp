import React from "react";
import { AppIcon } from "@/components/app-icon";
import type { DataColumn } from "@/components/data-driven/data-table";
import type { DataCsvColumn, DataFilterTab } from "@/lib/data-driven-ui";
import { formatMoney } from "../format";

export type TransferLedgerRow = {
  id: string;
  branchId: string;
  branchName: string;
  fromLabel: string;
  toLabel: string;
  direction: "TO_VAULT" | "TO_CUSTODY";
  amount: string;
  amountFormatted: string;
  settlementId: string | null;
  actorName: string;
  timestampFormatted: string;
  dateKey: string;
};

export type ArchivedSettlementRow = {
  id: string;
  branchId: string;
  branchName: string;
  holderName: string;
  createdAtDate: string;
  resolvedAtFormatted: string;
  expectedAmountFormatted: string;
  countedAmountFormatted: string;
  adjustmentFormatted: string;
  transferSummary: string;
  status: "CONFIRMED" | "REJECTED" | "CANCELLED";
  statusLabel: string;
  resolvedByName: string;
  reasonText: string;
};

export type TransferLedgerFilter = "all" | "TO_VAULT" | "TO_CUSTODY" | "DIRECT" | "SETTLEMENT";
export type ArchiveStatusFilter = "all" | "CONFIRMED" | "REJECTED" | "CANCELLED";

export const transferLedgerSearch = {
  placeholder: "ابحث برقم السند أو الموظف أو المنفّذ أو الفرع…",
  text: (row: TransferLedgerRow): readonly string[] => [[
    row.id, row.branchName, row.fromLabel, row.toLabel, row.actorName, row.settlementId ?? "", row.dateKey,
  ].join(" ")],
};

export const settlementArchiveSearch = {
  placeholder: "ابحث برقم التسوية أو الموظف أو متخذ القرار…",
  text: (row: ArchivedSettlementRow): readonly string[] => [[
    row.id, row.branchName, row.holderName, row.resolvedByName, row.reasonText, row.createdAtDate,
  ].join(" ")],
};

export const transferLedgerFilters: Array<DataFilterTab<TransferLedgerRow, TransferLedgerFilter>> = [
  { id: "all", label: "الكل", matches: () => true },
  { id: "TO_VAULT", label: "توريد للخزنة", matches: (row) => row.direction === "TO_VAULT" },
  { id: "TO_CUSTODY", label: "تغذية عهدة", matches: (row) => row.direction === "TO_CUSTODY" },
  { id: "DIRECT", label: "تسليم مباشر", matches: (row) => row.settlementId === null },
  { id: "SETTLEMENT", label: "ناتج عن تسوية", matches: (row) => row.settlementId !== null },
];

export function visibleTransferLedgerFilters(canManage: boolean) {
  return transferLedgerFilters.filter((filter) => canManage || filter.id !== "TO_CUSTODY");
}

export const settlementArchiveFilters: Array<DataFilterTab<ArchivedSettlementRow, ArchiveStatusFilter>> = [
  { id: "all", label: "الكل", matches: () => true },
  { id: "CONFIRMED", label: "معتمدة", matches: (row) => row.status === "CONFIRMED" },
  { id: "REJECTED", label: "مرفوضة", matches: (row) => row.status === "REJECTED" },
  { id: "CANCELLED", label: "مُلغاة", matches: (row) => row.status === "CANCELLED" },
];

export const transferLedgerCsvColumns: DataCsvColumn<TransferLedgerRow>[] = [
  { header: "رقم السند", value: (row) => `#${row.id}` },
  { header: "التوقيت", value: (row) => row.timestampFormatted },
  { header: "الفرع", value: (row) => row.branchName },
  { header: "الاتجاه", value: (row) => row.direction === "TO_VAULT" ? "توريد للخزنة" : "تغذية عهدة" },
  { header: "من (المسلِّم)", value: (row) => row.fromLabel },
  { header: "إلى (المستلِم)", value: (row) => row.toLabel },
  { header: "أصل الحركة", value: (row) => row.settlementId ? `تسوية عهدة #${row.settlementId}` : "تسليم مباشر" },
  { header: "المنفِّذ", value: (row) => row.actorName },
  { header: "المبلغ (ج.م)", value: (row) => row.amountFormatted },
];

export const settlementArchiveCsvColumns: DataCsvColumn<ArchivedSettlementRow>[] = [
  { header: "رقم التسوية", value: (row) => `#${row.id}` },
  { header: "تاريخ الطلب", value: (row) => row.createdAtDate },
  { header: "الفرع", value: (row) => row.branchName },
  { header: "الموظف", value: (row) => row.holderName },
  { header: "المتوقع (ج.م)", value: (row) => row.expectedAmountFormatted },
  { header: "المعدود (ج.م)", value: (row) => row.countedAmountFormatted },
  { header: "الفرق عن المؤشر (ج.م)", value: (row) => row.adjustmentFormatted },
  { header: "التحويل المنفذ", value: (row) => row.transferSummary },
  { header: "القرار", value: (row) => row.statusLabel },
  { header: "متخذ القرار", value: (row) => row.resolvedByName },
  { header: "السبب / البيان", value: (row) => row.reasonText },
];

export function createTransferLedgerColumns(
  onPrint: (row: TransferLedgerRow) => void,
): DataColumn<TransferLedgerRow>[] {
  return [
    { id: "voucher", header: "رقم السند", renderCell: (row) => <bdi dir="ltr">#{row.id}</bdi> },
    { id: "timestamp", header: "التوقيت", renderCell: (row) => <bdi dir="ltr">{row.timestampFormatted}</bdi> },
    { id: "branch", header: "الفرع", renderCell: (row) => row.branchName },
    { id: "from", header: "من (المسلِّم)", renderCell: (row) => row.fromLabel },
    { id: "to", header: "إلى (المستلِم)", renderCell: (row) => row.toLabel },
    {
      id: "kind",
      header: "نوع الحركة",
      renderCell: (row) => row.settlementId ? (
        <span className="fin-badge fin-badge--approved">تسوية <bdi dir="ltr">#{row.settlementId}</bdi></span>
      ) : row.direction === "TO_VAULT" ? (
        <span className="fin-badge fin-badge--paid">توريد للخزنة</span>
      ) : <span className="fin-badge fin-badge--vault">تغذية عهدة</span>,
    },
    { id: "actor", header: "المنفِّذ", renderCell: (row) => row.actorName },
    {
      id: "amount",
      header: "المبلغ",
      renderCell: (row) => <strong className="fin-money"><bdi dir="ltr">{formatMoney(row.amount)}</bdi></strong>,
    },
    {
      id: "print",
      header: "سند",
      headerClassName: "no-print",
      cellClassName: "no-print",
      renderCell: (row) => (
        <button type="button" className="fin-voucher-print-btn" onClick={() => onPrint(row)} title={`طباعة سند التسليم الرسمي رقم #${row.id}`}>
          <AppIcon name="printer" />
          <span>طباعة سند</span>
        </button>
      ),
    },
  ];
}

export const settlementArchiveColumns: DataColumn<ArchivedSettlementRow>[] = [
  { id: "request", header: "رقم الطلب", renderCell: (row) => <bdi dir="ltr">#{row.id}</bdi> },
  { id: "resolved-at", header: "تاريخ البتّ", renderCell: (row) => <bdi dir="ltr">{row.resolvedAtFormatted}</bdi> },
  {
    id: "branch-holder",
    header: "الفرع والموظف",
    renderCell: (row) => <><strong>{row.branchName}</strong> · {row.holderName}</>,
  },
  { id: "expected", header: "مؤشر الفترة", renderCell: (row) => <bdi dir="ltr">{row.expectedAmountFormatted}</bdi> },
  { id: "counted", header: "المعدود", renderCell: (row) => <bdi dir="ltr">{row.countedAmountFormatted}</bdi> },
  { id: "adjustment", header: "الفرق عن المؤشر", renderCell: (row) => <bdi dir="ltr">{row.adjustmentFormatted}</bdi> },
  { id: "transfer", header: "التحويل المنفَّذ", renderCell: (row) => row.transferSummary },
  {
    id: "status",
    header: "الحالة",
    renderCell: (row) => (
      <span className={`fin-badge ${row.status === "CONFIRMED" ? "fin-badge--paid" : row.status === "REJECTED" ? "fin-badge--danger" : "fin-badge--closed"}`}>
        {row.statusLabel}
      </span>
    ),
  },
  {
    id: "decision",
    header: "متّخذ القرار والسبب",
    renderCell: (row) => <><strong>{row.resolvedByName}</strong>{row.reasonText ? ` — ${row.reasonText}` : ""}</>,
  },
];
