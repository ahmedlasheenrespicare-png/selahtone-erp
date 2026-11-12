import type { DataColumn } from "@/components/data-driven/data-table";
import type { DataCsvColumn } from "@/lib/data-driven-ui";

export type CashCountHistoryRow = {
  id: string;
  accountLabel: string;
  countedOn: string;
  observedBalanceFormatted: string;
  countedAmountFormatted: string;
  differenceFormatted: string;
  statusLabel: string;
  reason: string;
};

export const cashCountHistoryColumns: DataColumn<CashCountHistoryRow>[] = [
  { id: "count", header: "الجرد", renderCell: (row) => row.id },
  { id: "account", header: "الحساب", renderCell: (row) => row.accountLabel },
  { id: "date", header: "التاريخ", renderCell: (row) => row.countedOn },
  { id: "observed", header: "الدفتري", renderCell: (row) => row.observedBalanceFormatted },
  { id: "counted", header: "المعدود", renderCell: (row) => row.countedAmountFormatted },
  { id: "difference", header: "الفرق عن المرجع", renderCell: (row) => row.differenceFormatted },
  { id: "status", header: "الحالة", renderCell: (row) => row.statusLabel },
  { id: "reason", header: "السبب", renderCell: (row) => row.reason },
];

export const cashCountHistoryCsvColumns: DataCsvColumn<CashCountHistoryRow>[] = [
  { header: "الجرد", value: (row) => `#${row.id}` },
  { header: "الحساب", value: (row) => row.accountLabel },
  { header: "التاريخ", value: (row) => row.countedOn },
  { header: "الدفتري", value: (row) => row.observedBalanceFormatted },
  { header: "المعدود", value: (row) => row.countedAmountFormatted },
  { header: "الفرق عن المرجع", value: (row) => row.differenceFormatted },
  { header: "الحالة", value: (row) => row.statusLabel },
  { header: "السبب", value: (row) => row.reason },
];
