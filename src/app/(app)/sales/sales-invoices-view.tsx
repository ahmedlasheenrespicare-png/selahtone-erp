"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AppIcon } from "@/components/app-icon";
import DataTable, { type DataTableColumn } from "@/components/data-table/data-table";
import { useDataTable } from "@/components/data-table/use-data-table";
import { downloadCsvFile } from "@/lib/csv-export";

export type SalesInvoiceStatusKind = "confirmed" | "partial_return" | "full_return" | "cancelled";

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

type FilterTab = "all" | "confirmed" | "due_from" | "due_to" | "returns";
type PeriodFilter = "ALL" | "TODAY" | "7D" | "MONTH";

export default function SalesInvoicesView({
  rows,
  branches,
  canOpenInvoice,
}: {
  rows: SalesInvoiceRow[];
  branches: string[];
  canOpenInvoice: boolean;
}) {
  const [query, setQuery] = useState("");
  const [branchFilter, setBranchFilter] = useState("ALL");
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>("ALL");
  const [activeTab, setActiveTab] = useState<FilterTab>("all");

  const counts = useMemo(() => {
    return {
      all: rows.length,
      confirmed: rows.filter((r) => r.statusKind === "confirmed").length,
      due_from: rows.filter((r) => r.hasDueFromCustomer).length,
      due_to: rows.filter((r) => r.hasDueToCustomer).length,
      returns: rows.filter((r) => r.statusKind !== "confirmed").length,
    };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const now = new Date();
    const cairoToday = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Cairo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    const cairoYearMonth = cairoToday.slice(0, 7);

    return rows.filter((row) => {
      if (branchFilter !== "ALL" && row.branchName !== branchFilter) return false;
      if (periodFilter !== "ALL" && row.createdAtIso) {
        const d = new Date(row.createdAtIso);
        const rowDate = new Intl.DateTimeFormat("en-CA", {
          timeZone: "Africa/Cairo",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(d);
        if (periodFilter === "TODAY" && rowDate !== cairoToday) return false;
        if (periodFilter === "7D" && now.getTime() - d.getTime() > 7 * 24 * 60 * 60 * 1000) {
          return false;
        }
        if (periodFilter === "MONTH" && !rowDate.startsWith(cairoYearMonth)) return false;
      }
      if (activeTab === "confirmed" && row.statusKind !== "confirmed") return false;
      if (activeTab === "due_from" && !row.hasDueFromCustomer) return false;
      if (activeTab === "due_to" && !row.hasDueToCustomer) return false;
      if (activeTab === "returns" && row.statusKind === "confirmed") return false;
      if (!q) return true;
      return (
        row.code.toLowerCase().includes(q) ||
        row.id.includes(q) ||
        row.customerName.toLowerCase().includes(q) ||
        row.customerPhone.toLowerCase().includes(q) ||
        row.branchName.toLowerCase().includes(q)
      );
    });
  }, [rows, query, branchFilter, periodFilter, activeTab]);

  // أعمدة موحّدة: الفرز على القرش الخام والتاريخ الحقيقي، والعرض بنفس الخلايا السابقة.
  const columns: Array<DataTableColumn<SalesInvoiceRow>> = [
    {
      key: "code",
      header: "الفاتورة",
      sortValue: (sale) => sale.code,
      cell: (sale) => (
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
      key: "customerName",
      header: "العميل",
      sortValue: (sale) => sale.customerName,
      cell: (sale) => (
        <div className="sales-customer-cell">
          <span className="sales-customer-cell__avatar" aria-hidden="true">
            {Array.from(sale.customerName.trim())[0] ?? "ع"}
          </span>
          <div>
            <strong>{sale.customerName}</strong>
            <span className="sales-customer-cell__phone">
              <bdi dir="ltr">{sale.customerPhone}</bdi>
            </span>
          </div>
        </div>
      ),
    },
    {
      key: "branchName",
      header: "الفرع",
      sortValue: (sale) => sale.branchName,
      cell: (sale) => <span className="sales-branch-pill">{sale.branchName}</span>,
    },
    {
      key: "original",
      header: "الإجمالي الأصلي",
      kind: "cents",
      initialDirection: "desc",
      sortValue: (sale) => sale.originalCents,
      className: "sales-money-cell is-strong",
      cell: (sale) => (
        <>
          <bdi dir="ltr">{sale.originalFormatted}</bdi> <small>ج.م</small>
        </>
      ),
    },
    {
      key: "dueFrom",
      header: "المتبقي على العميل",
      kind: "cents",
      initialDirection: "desc",
      sortValue: (sale) => sale.dueFromCustomerCents,
      className: (sale) => `sales-money-cell${sale.hasDueFromCustomer ? " is-due-from" : " is-zero"}`,
      cell: (sale) => (
        <>
          <bdi dir="ltr">{sale.dueFromCustomerFormatted}</bdi> <small>ج.م</small>
          {sale.hasDueFromCustomer && typeof sale.ageDays === "number" ? (
            <span
              className={`sales-age-pill${
                sale.ageDays >= 15 ? " is-danger" : sale.ageDays >= 7 ? " is-warn" : ""
              }`}
            >
              {sale.ageDays === 0 ? "اليوم" : `منذ ${sale.ageDays} ي`}
            </span>
          ) : null}
        </>
      ),
    },
    {
      key: "dueTo",
      header: "مستحق للعميل",
      kind: "cents",
      initialDirection: "desc",
      sortValue: (sale) => sale.dueToCustomerCents,
      className: (sale) => `sales-money-cell${sale.hasDueToCustomer ? " is-due-to" : " is-zero"}`,
      cell: (sale) => (
        <>
          <bdi dir="ltr">{sale.dueToCustomerFormatted}</bdi> <small>ج.م</small>
        </>
      ),
    },
    {
      key: "status",
      header: "الحالة",
      sortValue: (sale) => sale.statusLabel,
      cell: (sale) => (
        <span
          className={`sale-chip ${
            sale.statusKind === "cancelled"
              ? "sale-chip--neutral"
              : sale.statusKind !== "confirmed"
                ? "sale-chip--warning"
                : "sale-chip--confirmed"
          }`}
        >
          <span className="sale-chip__dot" aria-hidden="true" />
          {sale.statusLabel}
        </span>
      ),
    },
    {
      key: "createdAt",
      header: "التاريخ",
      kind: "date",
      initialDirection: "desc",
      sortValue: (sale) => sale.createdAtIso,
      className: "sales-date-cell",
      cell: (sale) => sale.createdAtFormatted,
    },
    {
      key: "open",
      header: "",
      sortLabel: "تفاصيل",
      className: "sales-open-cell",
      cell: (sale) => (
        <>
          {canOpenInvoice && <Link href={`/sales/${sale.id}`} className="sales-open-link" aria-label={`فتح فاتورة ${sale.code}`}>
            <span>عرض</span>
            <AppIcon name="arrow" />
          </Link>}
        </>
      ),
    },
  ];

  const table = useDataTable({ rows: filtered, columns, initialPageSize: 25, resetKey: [query, branchFilter, periodFilter, activeTab].join("\u0000") });

  function handleExportCsv(): void {
    downloadCsvFile(
      `selahtone-invoices-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        "رقم الفاتورة",
        "اسم العميل",
        "هاتف العميل",
        "الفرع",
        "عدد البنود",
        "الإجمالي الأصلي (ج.م)",
        "المتبقي على العميل (ج.م)",
        "مستحق للعميل (ج.م)",
        "الحالة",
        "التاريخ",
      ],
      // التصدير يشمل كل النتائج المطابقة للتصفية بترتيب الفرز الظاهر، لا الصفحة المعروضة وحدها.
      table.sortedRows.map((r) => [
        r.code,
        r.customerName,
        r.customerPhone,
        r.branchName,
        r.linesCount,
        r.originalFormatted,
        r.dueFromCustomerFormatted,
        r.dueToCustomerFormatted,
        r.statusLabel,
        r.createdAtFormatted,
      ]),
    );
  }

  const tabs: Array<{ id: FilterTab; label: string; count: number }> = [
    { id: "all", label: "الكل", count: counts.all },
    { id: "confirmed", label: "مؤكدة", count: counts.confirmed },
    { id: "due_from", label: "عليها متبقٍ", count: counts.due_from },
    ...(counts.due_to > 0 ? [{ id: "due_to" as const, label: "مستحق للعميل", count: counts.due_to }] : []),
    { id: "returns", label: "مرتجعات وملغاة", count: counts.returns },
  ];

  return (
    <section className="sales-board" aria-label="سجل الفواتير">
      <div className="sales-toolbar">
        <div className="sales-toolbar__filters" role="tablist" aria-label="تصفية الفواتير حسب الحالة">
          {tabs.map((tab) => {
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={selected}
                className={`sales-filter-pill${selected ? " is-active" : ""}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <span>{tab.label}</span>
                <b className="sales-filter-pill__count">{tab.count}</b>
              </button>
            );
          })}
        </div>

        <div className="sales-toolbar__controls">
          <label className="sales-branch-select" aria-label="تصفية حسب الفترة">
            <AppIcon name="calendar" />
            <select
              value={periodFilter}
              onChange={(e) => setPeriodFilter(e.target.value as PeriodFilter)}
            >
              <option value="ALL">كل الفترات</option>
              <option value="TODAY">اليوم</option>
              <option value="7D">آخر ٧ أيام</option>
              <option value="MONTH">هذا الشهر</option>
            </select>
          </label>

          {branches.length > 1 ? (
            <label className="sales-branch-select" aria-label="تصفية حسب الفرع">
              <AppIcon name="branch" />
              <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
                <option value="ALL">كل الفروع ({branches.length})</option>
                {branches.map((branch) => (
                  <option key={branch} value={branch}>
                    {branch}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <div className="sales-search-box">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ابحث برقم الفاتورة أو اسم العميل أو الهاتف…"
              aria-label="البحث في الفواتير"
            />
            {query ? (
              <button
                type="button"
                className="sales-search-box__clear"
                onClick={() => setQuery("")}
                aria-label="مسح البحث"
              >
                <AppIcon name="close" />
              </button>
            ) : null}
          </div>

          <button
            type="button"
            className="inv-button inv-button--secondary sales-export-btn"
            onClick={handleExportCsv}
            disabled={filtered.length === 0}
            title="تصدير الفواتير المعروضة بصيغة CSV"
          >
            <AppIcon name="download" />
            <span>تصدير CSV ({filtered.length})</span>
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="inv-panel sales-empty-filter">
          <p>لا توجد فواتير مطابقة لخيارات البحث أو التصفية الحالية.</p>
          <button
            type="button"
            className="inv-button inv-button--secondary"
            onClick={() => {
              setQuery("");
              setBranchFilter("ALL");
              setPeriodFilter("ALL");
              setActiveTab("all");
            }}
          >
            إعادة ضبط التصفية
          </button>
        </div>
      ) : (
        <div className="sales-table-card">
          <DataTable
            state={table}
            columns={columns}
            rowKey={(sale) => sale.id}
            rowClassName={(sale) => (sale.statusKind === "cancelled" ? "is-cancelled-row" : undefined)}
            ariaLabel="جدول فواتير البيع"
            wrapClassName="inv-table-wrap table-wrap"
            tableClassName="inv-table sales-invoices-table"
          />
        </div>
      )}
    </section>
  );
}
