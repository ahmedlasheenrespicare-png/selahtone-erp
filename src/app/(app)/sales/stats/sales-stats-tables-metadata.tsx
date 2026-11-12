import React from "react";
import type { DataColumn } from "@/components/data-driven/data-table";

const nf = new Intl.NumberFormat("ar-EG-u-nu-latn", { maximumFractionDigits: 2 });

export type SalesStatsBranchRow = {
  branchId: string;
  branchName: string;
  branchCode: string;
  invoiceCount: number;
  netSalesFormatted: string;
  outstandingFormatted: string;
  outstandingNum: number;
  collectionRatePct: number;
  sharePct: number;
};

export type SalesStatsStaffRow = {
  userId: string;
  staffName: string;
  branchName: string;
  invoiceCount: number;
  netSalesFormatted: string;
  averageInvoiceFormatted: string;
  collectionRatePct: number;
};

export type SalesStatsCategoryRow = {
  category: string;
  lines: number;
  qty: number;
  revenue: number;
  sharePct: number;
};

function ShareBar({ value, minimum }: { value: number; minimum: number }) {
  return (
    <div className="sales-stats-share">
      <span><bdi dir="ltr">{nf.format(value)}%</bdi></span>
      <div className="sales-stats-bar" aria-hidden="true">
        <span style={{ width: `${Math.min(100, Math.max(minimum, value))}%` }} />
      </div>
    </div>
  );
}

export const salesStatsBranchColumns: DataColumn<SalesStatsBranchRow>[] = [
  {
    id: "branch",
    header: "الفرع",
    renderCell: (branch) => (
      <div className="sales-stats-branch-cell">
        <strong>{branch.branchName}</strong>
        <small dir="ltr">{branch.branchCode}</small>
      </div>
    ),
  },
  { id: "invoices", header: "الفواتير", renderCell: (branch) => nf.format(branch.invoiceCount) },
  {
    id: "net-sales",
    header: "صافي المبيعات",
    renderCell: (branch) => (
      <>
        <strong><bdi dir="ltr">{branch.netSalesFormatted}</bdi> ج.م</strong>
        <small className="sales-stats-cell-sub">حصة <bdi dir="ltr">{nf.format(branch.sharePct)}%</bdi></small>
      </>
    ),
  },
  {
    id: "collection",
    header: "التحصيل",
    renderCell: (branch) => <ShareBar value={branch.collectionRatePct} minimum={4} />,
  },
  {
    id: "outstanding",
    header: "المتبقي",
    renderCell: (branch) => (
      <span className={branch.outstandingNum > 0 ? "sales-stats-due" : ""}>
        <bdi dir="ltr">{branch.outstandingFormatted}</bdi> ج.م
      </span>
    ),
  },
];

export const salesStatsStaffColumns: DataColumn<SalesStatsStaffRow>[] = [
  { id: "staff", header: "الموظف", renderCell: (staff) => <strong>{staff.staffName}</strong> },
  { id: "branch", header: "الفرع", renderCell: (staff) => staff.branchName },
  { id: "invoices", header: "الفواتير", renderCell: (staff) => nf.format(staff.invoiceCount) },
  {
    id: "net-sales",
    header: "صافي المبيعات",
    renderCell: (staff) => (
      <>
        <strong><bdi dir="ltr">{staff.netSalesFormatted}</bdi> ج.م</strong>
        <small className="sales-stats-cell-sub">تحصيل <bdi dir="ltr">{nf.format(staff.collectionRatePct)}%</bdi></small>
      </>
    ),
  },
  {
    id: "average",
    header: "متوسط الفاتورة",
    renderCell: (staff) => <><bdi dir="ltr">{staff.averageInvoiceFormatted}</bdi> ج.م</>,
  },
];

export const salesStatsCategoryColumns: DataColumn<SalesStatsCategoryRow>[] = [
  { id: "category", header: "التصنيف", renderCell: (category) => <strong>{category.category}</strong> },
  { id: "lines", header: "عدد البنود", renderCell: (category) => nf.format(category.lines) },
  { id: "quantity", header: "إجمالي الكمية", renderCell: (category) => nf.format(category.qty) },
  {
    id: "revenue",
    header: "صافي الإيراد",
    renderCell: (category) => <strong><bdi dir="ltr">{nf.format(category.revenue)}</bdi> ج.م</strong>,
  },
  {
    id: "share",
    header: "الحصة من الإيراد",
    renderCell: (category) => <ShareBar value={category.sharePct} minimum={4} />,
  },
];
