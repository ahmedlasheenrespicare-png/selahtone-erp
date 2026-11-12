import type { DataColumn } from "@/components/data-driven/data-table";

export type ReportSettlementRow = { id: string; label: string; value: string; money?: boolean };
export const reportSettlementColumns: DataColumn<ReportSettlementRow>[] = [
  { id: "metric", header: "المؤشر", renderCell: (row) => row.label, cellAsRowHeader: true },
  {
    id: "value", header: "القيمة", renderCell: (row) => row.money
      ? <span className="fin-money"><bdi dir="ltr">{row.value}</bdi> ج.م</span>
      : row.value,
  },
];

export type ReportCategoryRow = {
  id: string;
  name: string;
  count: number;
  totalFormatted: string;
  sharePct: number;
};

export const reportCategoryColumns: DataColumn<ReportCategoryRow>[] = [
  { id: "category", header: "البند", renderCell: (row) => row.name },
  { id: "count", header: "العمليات", renderCell: (row) => row.count },
  {
    id: "total", header: "المدفوع الفعال", renderCell: (row) => (
      <span className="fin-money"><bdi dir="ltr">{row.totalFormatted}</bdi> ج.م</span>
    ),
  },
  {
    id: "share", header: "الحصة من الفترة", renderCell: (row) => (
      <div className="fin-cat-spend__line">
        <strong className="fin-money">{row.sharePct}%</strong>
        <span className="fin-cat-share-bar" role="presentation" aria-hidden="true">
          <span style={{ width: `${Math.max(row.sharePct, 4)}%` }} />
        </span>
      </div>
    ),
  },
];

export type ReportBranchRow = {
  id: string;
  name: string;
  count: number;
  totalFormatted: string;
  shareLabel: string;
};

export const reportBranchColumns: DataColumn<ReportBranchRow>[] = [
  { id: "branch", header: "الفرع", renderCell: (row) => row.name },
  { id: "count", header: "العمليات", renderCell: (row) => row.count },
  {
    id: "total", header: "المدفوع الفعال", renderCell: (row) => (
      <span className="fin-money"><bdi dir="ltr">{row.totalFormatted}</bdi> ج.م</span>
    ),
  },
  { id: "share", header: "الحصة من الفترة", renderCell: (row) => row.shareLabel },
];
