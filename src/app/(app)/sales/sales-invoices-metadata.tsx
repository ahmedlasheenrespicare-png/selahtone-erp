import Link from "next/link";
import React from "react";
import { AppIcon } from "@/components/app-icon";
import type { DataColumn } from "@/components/data-driven/data-table";
import type {
  DataCsvColumn,
  DataFilterTab,
  DataSelectOption,
} from "@/lib/data-driven-ui";

export type SalesInvoiceStatusKind = "confirmed" | "partial_return" | "full_return" | "cancelled";
export type SalesInvoiceFilterTab = "all" | "confirmed" | "due_from" | "due_to" | "returns";
export type SalesInvoicePeriod = "ALL" | "TODAY" | "7D" | "MONTH";

export type SalesInvoiceRow = {
  id: string;
  code: string;
  customerName: string;
  customerPhone: string;
  branchName: string;
  originalFormatted: string;
  dueFromCustomerFormatted: string;
  dueToCustomerFormatted: string;
  /** قيم خام بالقرش (نصية) للفرز الرقمي الصحيح؛ العرض يبقى بالنصوص المنسّقة أعلاه. */
  originalCents: string;
  dueFromCustomerCents: string;
  dueToCustomerCents: string;
  hasDueFromCustomer: boolean;
  hasDueToCustomer: boolean;
  statusLabel: string;
  statusKind: SalesInvoiceStatusKind;
  createdAtFormatted: string;
  createdAtIso?: string;
  ageDays?: number;
  linesCount: number;
};

export const salesInvoiceSearch = {
  ariaLabel: "البحث في الفواتير",
  placeholder: "ابحث برقم الفاتورة أو اسم العميل أو الهاتف…",
  text: (sale: SalesInvoiceRow): readonly string[] => [
    sale.code,
    sale.id,
    sale.customerName,
    sale.customerPhone,
    sale.branchName,
  ],
};

export const salesInvoiceTabs: Array<DataFilterTab<SalesInvoiceRow, SalesInvoiceFilterTab>> = [
  { id: "all", label: "الكل", matches: () => true },
  { id: "confirmed", label: "مؤكدة", matches: (sale) => sale.statusKind === "confirmed" },
  { id: "due_from", label: "عليها متبقٍ", matches: (sale) => sale.hasDueFromCustomer },
  {
    id: "due_to",
    label: "مستحق للعميل",
    matches: (sale) => sale.hasDueToCustomer,
    isVisible: (rows) => rows.some((sale) => sale.hasDueToCustomer),
  },
  { id: "returns", label: "مرتجعات وملغاة", matches: (sale) => sale.statusKind !== "confirmed" },
];

function cairoDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function invoiceDate(sale: SalesInvoiceRow): Date | null {
  return sale.createdAtIso ? new Date(sale.createdAtIso) : null;
}

export type SalesInvoicePeriodOption = DataSelectOption<SalesInvoicePeriod> & {
  matches: (sale: SalesInvoiceRow, now: Date) => boolean;
};

export const salesInvoicePeriods: SalesInvoicePeriodOption[] = [
  { value: "ALL", label: "كل الفترات", matches: () => true },
  {
    value: "TODAY",
    label: "اليوم",
    matches: (sale, now) => {
      const date = invoiceDate(sale);
      return date === null || cairoDate(date) === cairoDate(now);
    },
  },
  {
    value: "7D",
    label: "آخر ٧ أيام",
    matches: (sale, now) => {
      const date = invoiceDate(sale);
      return date === null || now.getTime() - date.getTime() <= 7 * 24 * 60 * 60 * 1000;
    },
  },
  {
    value: "MONTH",
    label: "هذا الشهر",
    matches: (sale, now) => {
      const date = invoiceDate(sale);
      return date === null || cairoDate(date).slice(0, 7) === cairoDate(now).slice(0, 7);
    },
  },
];

export const salesInvoiceCsvColumns: DataCsvColumn<SalesInvoiceRow>[] = [
  { header: "رقم الفاتورة", value: (sale) => sale.code },
  { header: "اسم العميل", value: (sale) => sale.customerName },
  { header: "هاتف العميل", value: (sale) => sale.customerPhone },
  { header: "الفرع", value: (sale) => sale.branchName },
  { header: "عدد البنود", value: (sale) => sale.linesCount },
  { header: "الإجمالي الأصلي (ج.م)", value: (sale) => sale.originalFormatted },
  { header: "المتبقي على العميل (ج.م)", value: (sale) => sale.dueFromCustomerFormatted },
  { header: "مستحق للعميل (ج.م)", value: (sale) => sale.dueToCustomerFormatted },
  { header: "الحالة", value: (sale) => sale.statusLabel },
  { header: "التاريخ", value: (sale) => sale.createdAtFormatted },
];

function statusChipClass(sale: SalesInvoiceRow): string {
  return sale.statusKind === "cancelled"
    ? "sale-chip--neutral"
    : sale.statusKind !== "confirmed"
      ? "sale-chip--warning"
      : "sale-chip--confirmed";
}

export function createSalesInvoiceColumns(canOpenInvoice: boolean): DataColumn<SalesInvoiceRow>[] {
  return [
    {
      id: "invoice",
      header: "الفاتورة",
      sortValue: (sale) => sale.code,
      renderCell: (sale) => (
        <>
          {canOpenInvoice ? <Link href={`/sales/${sale.id}`} className="sales-invoice-badge">
            <AppIcon name="receipt" />
            <bdi dir="ltr">{sale.code}</bdi>
          </Link> : <span className="sales-invoice-badge"><AppIcon name="receipt" /><bdi dir="ltr">{sale.code}</bdi></span>}
          <small className="sales-lines-hint">{sale.linesCount} {sale.linesCount === 1 ? "بند" : "بنود"}</small>
        </>
      ),
    },
    {
      id: "customer",
      header: "العميل",
      sortValue: (sale) => sale.customerName,
      renderCell: (sale) => (
        <div className="sales-customer-cell">
          <span className="sales-customer-cell__avatar" aria-hidden="true">
            {Array.from(sale.customerName.trim())[0] ?? "ع"}
          </span>
          <div>
            <strong>{sale.customerName}</strong>
            <span className="sales-customer-cell__phone"><bdi dir="ltr">{sale.customerPhone}</bdi></span>
          </div>
        </div>
      ),
    },
    {
      id: "branch",
      header: "الفرع",
      sortValue: (sale) => sale.branchName,
      renderCell: (sale) => <span className="sales-branch-pill">{sale.branchName}</span>,
    },
    {
      id: "original",
      header: "الإجمالي الأصلي",
      sortKind: "cents",
      initialSortDirection: "desc",
      sortValue: (sale) => sale.originalCents,
      cellClassName: "sales-money-cell is-strong",
      renderCell: (sale) => <><bdi dir="ltr">{sale.originalFormatted}</bdi> <small>ج.م</small></>,
    },
    {
      id: "due-from",
      header: "المتبقي على العميل",
      sortKind: "cents",
      initialSortDirection: "desc",
      sortValue: (sale) => sale.dueFromCustomerCents,
      cellClassName: (sale) => `sales-money-cell${sale.hasDueFromCustomer ? " is-due-from" : " is-zero"}`,
      renderCell: (sale) => (
        <>
          <bdi dir="ltr">{sale.dueFromCustomerFormatted}</bdi> <small>ج.م</small>
          {sale.hasDueFromCustomer && typeof sale.ageDays === "number" ? (
            <span className={`sales-age-pill${sale.ageDays >= 15 ? " is-danger" : sale.ageDays >= 7 ? " is-warn" : ""}`}>
              {sale.ageDays === 0 ? "اليوم" : `منذ ${sale.ageDays} ي`}
            </span>
          ) : null}
        </>
      ),
    },
    {
      id: "due-to",
      header: "مستحق للعميل",
      sortKind: "cents",
      initialSortDirection: "desc",
      sortValue: (sale) => sale.dueToCustomerCents,
      cellClassName: (sale) => `sales-money-cell${sale.hasDueToCustomer ? " is-due-to" : " is-zero"}`,
      renderCell: (sale) => <><bdi dir="ltr">{sale.dueToCustomerFormatted}</bdi> <small>ج.م</small></>,
    },
    {
      id: "status",
      header: "الحالة",
      sortValue: (sale) => sale.statusLabel,
      renderCell: (sale) => (
        <span className={`sale-chip ${statusChipClass(sale)}`}>
          <span className="sale-chip__dot" aria-hidden="true" />
          {sale.statusLabel}
        </span>
      ),
    },
    {
      id: "created-at",
      header: "التاريخ",
      sortKind: "date",
      initialSortDirection: "desc",
      sortValue: (sale) => sale.createdAtIso,
      cellClassName: "sales-date-cell",
      renderCell: (sale) => sale.createdAtFormatted,
    },
    {
      id: "details",
      header: null,
      headerAriaLabel: "تفاصيل",
      cellClassName: "sales-open-cell",
      renderCell: (sale) => canOpenInvoice && (
        <Link href={`/sales/${sale.id}`} className="sales-open-link" aria-label={`فتح فاتورة ${sale.code}`}>
          <span>عرض</span>
          <AppIcon name="arrow" />
        </Link>
      ),
    },
  ];
}
