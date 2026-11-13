"use client";

import { useMemo, useState } from "react";
import { AppIcon } from "@/components/app-icon";
import DataTable from "@/components/data-table/data-table";
import { useDataTable } from "@/components/data-table/use-data-table";
import { downloadCsvFile } from "@/lib/csv-export";
import { csvHeaders, csvRows, filterRowsBySearch } from "@/lib/data-driven-ui";
import {
  createSalesInvoiceColumns,
  salesInvoiceCsvColumns,
  salesInvoicePeriods,
  salesInvoiceSearch,
  salesInvoiceTabs,
  type SalesInvoiceFilterTab,
  type SalesInvoicePeriod,
  type SalesInvoiceRow,
} from "./sales-invoices-metadata";

export type { SalesInvoiceRow, SalesInvoiceStatusKind } from "./sales-invoices-metadata";

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
  const [periodFilter, setPeriodFilter] = useState<SalesInvoicePeriod>("ALL");
  const [activeTab, setActiveTab] = useState<SalesInvoiceFilterTab>("all");
  const [exportMessage, setExportMessage] = useState("");

  const columns = useMemo(() => createSalesInvoiceColumns(canOpenInvoice), [canOpenInvoice]);
  const counts = useMemo(() => Object.fromEntries(
    salesInvoiceTabs.map((tab) => [tab.id, rows.filter(tab.matches).length]),
  ) as Record<SalesInvoiceFilterTab, number>, [rows]);
  const tabs = useMemo(() => salesInvoiceTabs
    .filter((tab) => tab.isVisible?.(rows) ?? true)
    .map((tab) => ({ ...tab, count: counts[tab.id] })), [rows, counts]);

  const filtered = useMemo(() => {
    const now = new Date();
    const tab = salesInvoiceTabs.find((item) => item.id === activeTab) ?? salesInvoiceTabs[0];
    const period = salesInvoicePeriods.find((item) => item.value === periodFilter) ?? salesInvoicePeriods[0];
    const selected = rows.filter((row) =>
      (branchFilter === "ALL" || row.branchName === branchFilter) &&
      period.matches(row, now) &&
      tab.matches(row),
    );
    return filterRowsBySearch(selected, query, salesInvoiceSearch.text);
  }, [rows, query, branchFilter, periodFilter, activeTab]);

  // الفرز والترقيم فوق نفس أعمدة الـMetadata؛ تغيير أي مرشّح يعيد الصفحة الأولى.
  const table = useDataTable({ rows: filtered, columns, initialPageSize: 25, resetKey: [query, branchFilter, periodFilter, activeTab].join("\u0000") });

  function handleExportCsv(): void {
    downloadCsvFile(
      `selahtone-invoices-${new Date().toISOString().slice(0, 10)}.csv`,
      csvHeaders(salesInvoiceCsvColumns),
      // التصدير يشمل كل النتائج المطابقة للتصفية بترتيب الفرز الظاهر، لا الصفحة المعروضة وحدها.
      csvRows(table.sortedRows, salesInvoiceCsvColumns),
    );
    setExportMessage(`تم بدء تنزيل ملف CSV ويضم ${table.sortedRows.length} فاتورة.`);
  }

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
              onChange={(e) => setPeriodFilter(e.target.value as SalesInvoicePeriod)}
            >
              {salesInvoicePeriods.map((period) => (
                <option key={period.value} value={period.value}>{period.label}</option>
              ))}
            </select>
          </label>

          {branches.length > 1 ? (
            <label className="sales-branch-select" aria-label="تصفية حسب الفرع">
              <AppIcon name="branch" />
              <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
                <option value="ALL">كل الفروع ({branches.length})</option>
                {branches.map((branch) => (
                  <option key={branch} value={branch}>{branch}</option>
                ))}
              </select>
            </label>
          ) : null}

          <div className="sales-search-box">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={salesInvoiceSearch.placeholder}
              aria-label={salesInvoiceSearch.ariaLabel}
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
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">عدد الفواتير المطابقة: {filtered.length}</p>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{exportMessage}</p>

      {filtered.length === 0 ? (
        <div className="inv-panel sales-empty-filter" role="status">
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
