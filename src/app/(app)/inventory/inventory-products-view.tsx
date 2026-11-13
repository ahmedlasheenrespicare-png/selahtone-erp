"use client";

import { useMemo, useState } from "react";
import { AppIcon } from "@/components/app-icon";
import DataTable from "@/components/data-driven/data-table";
import { downloadCsvFile } from "@/lib/csv-export";
import { csvHeaders, csvRows, filterRowsBySearch } from "@/lib/data-driven-ui";
import {
  createInventoryProductColumns,
  createInventoryProductCsvColumns,
  inventoryCategoryOptions,
  inventoryProductSearch,
  inventoryStockCount,
  inventoryStockOptions,
  type InventoryProductRow,
  type InventoryStockFilter,
} from "./inventory-products-metadata";

export type { InventoryProductRow } from "./inventory-products-metadata";

export default function InventoryProductsView({
  rows,
  canSeeCost,
}: {
  rows: InventoryProductRow[];
  canSeeCost: boolean;
}) {
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [stockFilter, setStockFilter] = useState<InventoryStockFilter>("ALL");
  const [exportMessage, setExportMessage] = useState("");

  const columns = useMemo(() => createInventoryProductColumns(canSeeCost), [canSeeCost]);
  const exportColumns = useMemo(() => createInventoryProductCsvColumns(canSeeCost), [canSeeCost]);
  const lowCount = useMemo(() => inventoryStockCount(rows, "LOW"), [rows]);
  const zeroCount = useMemo(() => inventoryStockCount(rows, "ZERO"), [rows]);

  const filtered = useMemo(() => {
    const stock = inventoryStockOptions.find((item) => item.value === stockFilter) ?? inventoryStockOptions[0];
    const selected = rows.filter((row) =>
      (categoryFilter === "ALL" || row.category === categoryFilter) && stock.matches(row),
    );
    return filterRowsBySearch(selected, query, inventoryProductSearch.text);
  }, [rows, query, categoryFilter, stockFilter]);

  function resetFilters(): void {
    setQuery("");
    setCategoryFilter("ALL");
    setStockFilter("ALL");
  }

  function handleExportCsv(): void {
    downloadCsvFile(
      `selahtone-inventory-${new Date().toISOString().slice(0, 10)}.csv`,
      csvHeaders(exportColumns),
      csvRows(filtered, exportColumns),
    );
    setExportMessage(`تم بدء تنزيل ملف CSV ويضم ${filtered.length} صنف.`);
  }

  return (
    <div className="card">
      <div className="inv-card-head">
        <h2>
          الأصناف ومعدل الضريبة <span className="pill" role="status" aria-live="polite" aria-atomic="true">{filtered.length} / {rows.length} صنف</span>
        </h2>
        <button
          type="button"
          className="inv-button inv-button--secondary"
          onClick={handleExportCsv}
          disabled={filtered.length === 0}
        >
          <AppIcon name="download" />
          <span>تصدير CSV</span>
        </button>
      </div>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{exportMessage}</p>

      {(zeroCount > 0 || lowCount > 0) ? (
        <div className="alert alert-warn" role="status">
          <strong>مؤشر نواقص المخزون:</strong>{" "}
          {zeroCount > 0 ? `${zeroCount} صنف مخزني نفد رصيده (0)` : ""}
          {zeroCount > 0 && lowCount > 0 ? " · " : ""}
          {lowCount > 0 ? `${lowCount} صنف برصيد منخفض (٢ أو أقل)` : ""}.
        </div>
      ) : null}

      <div className="admin-filter-bar" role="region" aria-label="تصفية الأصناف">
        <input
          type="search"
          className="admin-filter-bar__search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={inventoryProductSearch.placeholder}
          aria-label={inventoryProductSearch.ariaLabel}
        />
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          aria-label="تصفية حسب التصنيف"
        >
          {inventoryCategoryOptions.map((category) => (
            <option key={category.value} value={category.value}>{category.label}</option>
          ))}
        </select>
        <select
          value={stockFilter}
          onChange={(e) => setStockFilter(e.target.value as InventoryStockFilter)}
          aria-label="حالة الرصيد"
        >
          {inventoryStockOptions.map((stock) => (
            <option key={stock.value} value={stock.value}>
              {stock.label}{stock.value === "LOW" ? ` (${lowCount})` : stock.value === "ZERO" ? ` (${zeroCount})` : ""}
            </option>
          ))}
        </select>
      </div>

      <DataTable
        rows={filtered}
        columns={columns}
        rowKey={(product) => product.id}
        regionLabel="جدول الأصناف وأرصدة المستودعات"
        regionClassName="table-wrap"
        emptyState={
          <>
            <p role="status">لا توجد أصناف تطابق البحث أو التصفية المختارة.</p>
            <button type="button" className="inv-button inv-button--secondary" onClick={resetFilters}>مسح البحث والفلاتر</button>
          </>
        }
      />
    </div>
  );
}
