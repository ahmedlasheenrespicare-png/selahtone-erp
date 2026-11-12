import type { DataColumn } from "@/components/data-driven/data-table";

export type OpenAccountSummaryRow = {
  id: string;
  kind: "VAULT" | "CUSTODY";
  kindLabel: string;
  branchName: string;
  holderName: string;
  openingDate: string;
  openingBalanceFormatted: string;
  balanceFormatted: string;
};

export const openAccountSummaryColumns: DataColumn<OpenAccountSummaryRow>[] = [
  { id: "account", header: "#", renderCell: (row) => <bdi dir="ltr"><strong>#{row.id}</strong></bdi> },
  {
    id: "kind", header: "النوع", renderCell: (row) => (
      <span className={`fin-badge ${row.kind === "VAULT" ? "fin-badge--approved" : "fin-badge--paid"}`}>{row.kindLabel}</span>
    ),
  },
  { id: "branch", header: "الفرع", renderCell: (row) => row.branchName },
  { id: "holder", header: "صاحب العهدة", renderCell: (row) => row.holderName },
  { id: "opening-date", header: "تاريخ الافتتاح", renderCell: (row) => <bdi dir="ltr">{row.openingDate}</bdi> },
  { id: "opening-balance", header: "رصيد البداية", renderCell: (row) => <bdi dir="ltr">{row.openingBalanceFormatted}</bdi> },
  { id: "balance", header: "الرصيد الدفتري الحالي", renderCell: (row) => <bdi dir="ltr"><strong>{row.balanceFormatted}</strong></bdi> },
];
