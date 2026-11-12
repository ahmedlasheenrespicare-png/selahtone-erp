import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import DataTable from "../src/components/data-driven/data-table";
import {
  createSalesInvoiceColumns,
  salesInvoiceCsvColumns,
  salesInvoicePeriods,
  salesInvoiceSearch,
  salesInvoiceTabs,
  type SalesInvoiceRow,
} from "../src/app/(app)/sales/sales-invoices-metadata";
import {
  createInventoryProductColumns,
  createInventoryProductCsvColumns,
  inventoryProductSearch,
  inventoryStockCount,
  inventoryStockOptions,
  type InventoryProductRow,
} from "../src/app/(app)/inventory/inventory-products-metadata";
import {
  createSalesStatsItemColumns,
  createSalesStatsSortOptions,
  salesStatsItemKinds,
  salesStatsItemSearch,
  type SafeTopItem,
} from "../src/app/(app)/sales/stats/sales-stats-items-metadata";
import {
  salesStatsBranchColumns,
  salesStatsCategoryColumns,
  salesStatsStaffColumns,
  type SalesStatsBranchRow,
  type SalesStatsCategoryRow,
  type SalesStatsStaffRow,
} from "../src/app/(app)/sales/stats/sales-stats-tables-metadata";
import { csvHeaders, csvRows, filterRowsBySearch } from "../src/lib/data-driven-ui";

const invoice: SalesInvoiceRow = {
  id: "42",
  code: "ST-42",
  customerName: "أحمد علي",
  customerPhone: "01000000000",
  branchName: "القاهرة",
  originalFormatted: "1,000.00",
  dueFromCustomerFormatted: "250.00",
  dueToCustomerFormatted: "0.00",
  hasDueFromCustomer: true,
  hasDueToCustomer: false,
  statusLabel: "مؤكدة",
  statusKind: "confirmed",
  createdAtFormatted: "١١ نوفمبر ٢٠٢٦",
  createdAtIso: "2026-11-11T10:00:00.000Z",
  ageDays: 0,
  linesCount: 2,
};

const product: InventoryProductRow = {
  id: "9",
  sku: "HA-9",
  nameAr: "سماعة طبية",
  category: "HEARING_AID",
  categoryLabel: "سماعة طبية",
  taxCode: "VAT14",
  purchaseCostFormatted: "4,000.00",
  salePriceFormatted: "6,000.00",
  requiresSerial: true,
  isService: false,
  qtyUnits: 1,
  whereSummary: "CAI: 1",
};

const topItem: SafeTopItem = {
  key: "stock-1",
  name: "سماعة متقدمة",
  category: "سماعات",
  isStock: true,
  quantityFormatted: "2",
  quantityNum: 2,
  lines: 1,
  revenueFormatted: "12,000",
  revenueNum: 12000,
  sharePct: 80,
  costFormatted: "8,000",
  profitFormatted: "4,000",
  profitNum: 4000,
  marginPct: 33.3,
};

test("resource metadata defines the complete invoice table and action header", () => {
  const columns = createSalesInvoiceColumns(true);
  assert.deepEqual(columns.map((column) => column.id), [
    "invoice", "customer", "branch", "original", "due-from", "due-to", "status", "created-at", "details",
  ]);
  assert.equal(columns.at(-1)?.headerAriaLabel, "تفاصيل");
  assert.notEqual(columns.at(-1)?.renderCell(invoice, 0), false);
  assert.equal(createSalesInvoiceColumns(false).at(-1)?.renderCell(invoice, 0), false);
});

test("the shared renderer produces an accessible table from resource metadata", () => {
  const columns = [
    { id: "invoice", header: "الفاتورة", renderCell: (row: SalesInvoiceRow) => row.code },
    { id: "details", header: null, headerAriaLabel: "تفاصيل", renderCell: () => null },
  ];
  const markup = renderToStaticMarkup(React.createElement(DataTable<SalesInvoiceRow>, {
    rows: [invoice],
    columns,
    rowKey: (row: SalesInvoiceRow) => row.id,
    regionLabel: "جدول فواتير البيع",
    tableClassName: "inv-table sales-invoices-table",
  }));
  assert.equal((markup.match(/<th /g) ?? []).length, 2);
  assert.equal((markup.match(/scope="col"/g) ?? []).length, 2);
  assert.ok(markup.includes('role="region" aria-label="جدول فواتير البيع" tabindex="0"'));
  assert.ok(markup.includes('aria-label="تفاصيل"'));
  assert.ok(markup.includes("ST-42"));
  assert.ok(!markup.includes("sales-open-link"));
  assert.ok(!markup.includes("<a "));

  const emptyMarkup = renderToStaticMarkup(React.createElement(DataTable<SalesInvoiceRow>, {
    rows: [],
    columns,
    rowKey: (row: SalesInvoiceRow) => row.id,
    regionLabel: "جدول الأصناف وأرصدة المستودعات",
    regionClassName: "table-wrap",
    emptyState: React.createElement("p", { role: "status" }, "لا توجد نتائج"),
  }));
  assert.ok(emptyMarkup.includes('class="table-wrap"'));
  assert.ok(emptyMarkup.includes('colSpan="2"'));
  assert.ok(emptyMarkup.includes("لا توجد نتائج"));
});

test("search metadata matches any indexed field without changing the source rows", () => {
  const other = { ...invoice, id: "7", code: "ST-7", customerName: "منى", branchName: "أسيوط" };
  const rows = [invoice, other];
  assert.deepEqual(filterRowsBySearch(rows, "st-42", salesInvoiceSearch.text), [invoice]);
  assert.deepEqual(filterRowsBySearch(rows, "أسيوط", salesInvoiceSearch.text), [other]);
  assert.equal(filterRowsBySearch(rows, "  ", salesInvoiceSearch.text).length, 2);
  assert.equal(rows.length, 2);
});

test("status tabs own their counts, predicates, and conditional visibility", () => {
  const returned = { ...invoice, id: "43", statusKind: "partial_return" as const, hasDueFromCustomer: false };
  const refund = { ...invoice, id: "44", hasDueToCustomer: true, hasDueFromCustomer: false };
  const rows = [invoice, returned, refund];
  assert.deepEqual(salesInvoiceTabs.map((tab) => rows.filter(tab.matches).length), [3, 2, 1, 1, 1]);
  assert.equal(salesInvoiceTabs.find((tab) => tab.id === "due_to")?.isVisible?.([invoice]), false);
  assert.equal(salesInvoiceTabs.find((tab) => tab.id === "due_to")?.isVisible?.(rows), true);
});

test("period metadata filters by Cairo day, rolling week, and Cairo month", () => {
  const now = new Date("2026-11-11T12:00:00.000Z");
  const old = { ...invoice, createdAtIso: "2026-10-01T10:00:00.000Z" };
  const cairoNovember = { ...invoice, createdAtIso: "2026-10-31T22:30:00.000Z" };
  const matches = (id: string, row: SalesInvoiceRow) =>
    salesInvoicePeriods.find((period) => period.value === id)?.matches(row, now);
  assert.equal(matches("TODAY", invoice), true);
  assert.equal(matches("TODAY", old), false);
  assert.equal(matches("7D", invoice), true);
  assert.equal(matches("7D", old), false);
  assert.equal(matches("MONTH", cairoNovember), true);
  assert.equal(matches("MONTH", old), false);
  assert.equal(matches("TODAY", { ...old, createdAtIso: undefined }), true);
});

test("CSV metadata is the single source for headers and cell order", () => {
  assert.equal(salesInvoiceCsvColumns.length, 10);
  assert.deepEqual(csvHeaders(salesInvoiceCsvColumns).slice(0, 5), [
    "رقم الفاتورة", "اسم العميل", "هاتف العميل", "الفرع", "عدد البنود",
  ]);
  assert.deepEqual(csvRows([invoice], salesInvoiceCsvColumns)[0], [
    "ST-42", "أحمد علي", "01000000000", "القاهرة", 2,
    "1,000.00", "250.00", "0.00", "مؤكدة", "١١ نوفمبر ٢٠٢٦",
  ]);
});

test("inventory table and CSV metadata remove purchase cost without permission", () => {
  const visibleColumns = createInventoryProductColumns(false);
  const visibleCsv = createInventoryProductCsvColumns(false);
  assert.equal(visibleColumns.length, 7);
  assert.ok(!visibleColumns.some((column) => column.id === "purchase-cost"));
  assert.ok(!csvHeaders(visibleCsv).includes("سعر الشراء"));
  assert.ok(!csvRows([product], visibleCsv).flat().includes("4,000.00"));

  const authorizedCsv = createInventoryProductCsvColumns(true);
  assert.equal(createInventoryProductColumns(true).length, 8);
  assert.ok(csvHeaders(authorizedCsv).includes("سعر الشراء"));
  assert.ok(csvRows([product], authorizedCsv).flat().includes("4,000.00"));
});

test("inventory stock metadata excludes services and shares counts with predicates", () => {
  const service = { ...product, id: "10", isService: true, qtyUnits: 0, whereSummary: "" };
  const zero = { ...product, id: "11", qtyUnits: 0, whereSummary: "" };
  const full = { ...product, id: "12", qtyUnits: 8 };
  const rows = [product, service, zero, full];
  assert.equal(inventoryStockCount(rows, "LOW"), 1);
  assert.equal(inventoryStockCount(rows, "ZERO"), 1);
  assert.equal(inventoryStockCount(rows, "IN_STOCK"), 2);
  const zeroFilter = inventoryStockOptions.find((option) => option.value === "ZERO");
  assert.deepEqual(rows.filter(zeroFilter?.matches ?? (() => false)), [zero]);
});

test("inventory search metadata includes category and warehouse summaries", () => {
  assert.deepEqual(filterRowsBySearch([product], "cai", inventoryProductSearch.text), [product]);
  assert.deepEqual(filterRowsBySearch([product], "سماعة", inventoryProductSearch.text), [product]);
  assert.deepEqual(filterRowsBySearch([product], "ha-9 سماعة", inventoryProductSearch.text), [product]);
  assert.deepEqual(filterRowsBySearch([product], "غير موجود", inventoryProductSearch.text), []);
});

test("sales stats metadata removes profitability columns and sorting without permission", () => {
  assert.equal(createSalesStatsItemColumns(false).length, 6);
  assert.deepEqual(createSalesStatsSortOptions(false).map((option) => option.value), ["revenue", "quantity"]);
  const authorizedColumns = createSalesStatsItemColumns(true);
  assert.equal(authorizedColumns.length, 8);
  assert.ok(authorizedColumns.some((column) => column.id === "cost"));
  assert.ok(authorizedColumns.some((column) => column.id === "profit"));
  assert.deepEqual(createSalesStatsSortOptions(true).map((option) => option.value), ["revenue", "quantity", "profit"]);
  assert.equal(authorizedColumns[0].renderCell(topItem, 4), 5);
});

test("sales stats sorting metadata preserves revenue, quantity, and stock-profit rules", () => {
  const catalog = { ...topItem, key: "catalog-1", name: "ضبط سماعة", isStock: false,
    quantityNum: 5, revenueNum: 1000, profitNum: 9000, costFormatted: undefined, profitFormatted: undefined };
  const options = createSalesStatsSortOptions(true);
  assert.deepEqual([topItem, catalog].sort(options[0].compare).map((item) => item.key), ["stock-1", "catalog-1"]);
  assert.deepEqual([topItem, catalog].sort(options[1].compare).map((item) => item.key), ["catalog-1", "stock-1"]);
  assert.deepEqual([catalog, topItem].sort(options[2].compare).map((item) => item.key), ["stock-1", "catalog-1"]);
});

test("sales stats kind filters and search share the same item metadata", () => {
  const catalog = { ...topItem, key: "catalog-1", name: "ضبط سماعة", category: "خدمات", isStock: false };
  const rows = [topItem, catalog];
  assert.deepEqual(salesStatsItemKinds.map((kind) => rows.filter(kind.matches).length), [2, 1, 1]);
  assert.deepEqual(filterRowsBySearch(rows, "خدمات", salesStatsItemSearch.text), [catalog]);
  assert.deepEqual(filterRowsBySearch(rows, "متقدمة", salesStatsItemSearch.text), [topItem]);
});

test("sales stats comparison metadata defines every branch, staff, and category column", () => {
  assert.deepEqual(salesStatsBranchColumns.map((column) => column.id), ["branch", "invoices", "net-sales", "collection", "outstanding"]);
  assert.deepEqual(salesStatsStaffColumns.map((column) => column.id), ["staff", "branch", "invoices", "net-sales", "average"]);
  assert.deepEqual(salesStatsCategoryColumns.map((column) => column.id), ["category", "lines", "quantity", "revenue", "share"]);
});

test("sales stats comparison tables render their values and accessible regions", () => {
  const branch: SalesStatsBranchRow = {
    branchId: "1", branchName: "القاهرة", branchCode: "CAI", invoiceCount: 3,
    netSalesFormatted: "12,000", outstandingFormatted: "500", outstandingNum: 500,
    collectionRatePct: 75, sharePct: 60,
  };
  const staff: SalesStatsStaffRow = {
    userId: "2", staffName: "أحمد", branchName: "القاهرة", invoiceCount: 3,
    netSalesFormatted: "12,000", averageInvoiceFormatted: "4,000", collectionRatePct: 75,
  };
  const category: SalesStatsCategoryRow = { category: "سماعات", lines: 4, qty: 6, revenue: 12000, sharePct: 60 };
  const branchHtml = renderToStaticMarkup(React.createElement(DataTable<SalesStatsBranchRow>, {
    rows: [branch], columns: salesStatsBranchColumns, rowKey: (row) => row.branchId,
    regionLabel: "جدول مقارنة الفروع", tableClassName: "inv-table sales-stats-table",
  }));
  const staffHtml = renderToStaticMarkup(React.createElement(DataTable<SalesStatsStaffRow>, {
    rows: [staff], columns: salesStatsStaffColumns, rowKey: (row) => row.userId,
    regionLabel: "جدول أداء الموظفين", tableClassName: "inv-table sales-stats-table",
  }));
  const categoryHtml = renderToStaticMarkup(React.createElement(DataTable<SalesStatsCategoryRow>, {
    rows: [category], columns: salesStatsCategoryColumns, rowKey: (row) => row.category,
    regionLabel: "جدول تحليل التصنيفات", tableClassName: "inv-table sales-stats-table",
  }));
  assert.ok(branchHtml.includes('aria-label="جدول مقارنة الفروع"'));
  assert.ok(branchHtml.includes("CAI"));
  assert.ok(branchHtml.includes("sales-stats-due"));
  assert.ok(branchHtml.includes("75%"));
  assert.ok(staffHtml.includes("أحمد"));
  assert.ok(staffHtml.includes("4,000"));
  assert.equal((staffHtml.match(/<th /g) ?? []).length, 5);
  assert.ok(categoryHtml.includes("سماعات"));
  assert.ok(categoryHtml.includes("60%"));
  assert.equal((categoryHtml.match(/<th /g) ?? []).length, 5);
});
