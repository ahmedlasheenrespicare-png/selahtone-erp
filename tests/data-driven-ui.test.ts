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
import {
  createFinanceExpenseColumns,
  financeExpenseCsvColumns,
  financeExpenseSearch,
  financeExpenseTabs,
  type FinanceExpenseRow,
} from "../src/app/(app)/finance/expenses/finance-expenses-metadata";
import {
  createTransferLedgerColumns,
  settlementArchiveColumns,
  settlementArchiveCsvColumns,
  settlementArchiveFilters,
  settlementArchiveSearch,
  transferLedgerCsvColumns,
  transferLedgerFilters,
  transferLedgerSearch,
  visibleTransferLedgerFilters,
  type ArchivedSettlementRow,
  type TransferLedgerRow,
} from "../src/app/(app)/finance/transfers/transfers-ledger-metadata";
import {
  createInventoryReceiptColumns,
  inventorySerialColumns,
  type InventoryReceiptRow,
  type InventorySerialRow,
} from "../src/app/(app)/inventory/inventory-registers-metadata";
import {
  custodyMovementColumns,
  custodyMovementFilters,
  custodyMovementSearch,
  type CustodyMovementItem,
} from "../src/app/(app)/finance/mine/custody-activity-metadata";
import { csvHeaders, csvRows, filterRowsBySearch } from "../src/lib/data-driven-ui";

Object.assign(globalThis, { React });

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

const expense: FinanceExpenseRow = {
  id: "17",
  expenseDate: "2026-11-12",
  branchId: "1",
  branchName: "القاهرة · CAI",
  categorySnapshot: "صيانة",
  description: "إصلاح جهاز",
  amountFormatted: "750.00",
  status: "PENDING",
  statusLabel: "بانتظار الاعتماد",
};

const transfer: TransferLedgerRow = {
  id: "21",
  branchId: "1",
  branchName: "القاهرة · CAI",
  fromLabel: "عهدة أحمد",
  toLabel: "خزنة الفرع",
  direction: "TO_VAULT",
  amount: "1000.00",
  amountFormatted: "1,000.00",
  settlementId: "8",
  actorName: "منى",
  timestampFormatted: "١٢ نوفمبر ٢٠٢٦",
  dateKey: "2026-11-12",
};

const settlement: ArchivedSettlementRow = {
  id: "8",
  branchId: "1",
  branchName: "القاهرة · CAI",
  holderName: "أحمد",
  createdAtDate: "2026-11-12",
  resolvedAtFormatted: "١٢ نوفمبر ٢٠٢٦",
  expectedAmountFormatted: "1,000.00 ج.م",
  countedAmountFormatted: "900.00 ج.م",
  adjustmentFormatted: "-100.00 ج.م",
  transferSummary: "بلا أثر مالي",
  status: "REJECTED",
  statusLabel: "مرفوضة",
  resolvedByName: "منى",
  reasonText: "فرق يحتاج مراجعة",
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

test("finance expense metadata guards detail actions and preserves CSV order", () => {
  assert.equal(createFinanceExpenseColumns(false).length, 6);
  assert.equal(createFinanceExpenseColumns(true).length, 7);
  assert.ok(!createFinanceExpenseColumns(false).some((column) => column.id === "action"));
  assert.deepEqual(csvHeaders(financeExpenseCsvColumns), [
    "رقم المصروف", "التاريخ", "الفرع", "البند", "الوصف", "المبلغ (ج.م)", "الحالة",
  ]);
  assert.deepEqual(csvRows([expense], financeExpenseCsvColumns)[0], [
    "17", "2026-11-12", "القاهرة · CAI", "صيانة", "إصلاح جهاز", "750.00", "بانتظار الاعتماد",
  ]);
});

test("finance expense tabs and combined search use shared metadata", () => {
  const paid = { ...expense, id: "18", status: "PAID" };
  const rows = [expense, paid];
  assert.deepEqual(financeExpenseTabs.map((tab) => rows.filter(tab.matches).length), [2, 1, 0, 1]);
  assert.deepEqual(filterRowsBySearch(rows, "صيانة القاهرة", financeExpenseSearch.text), rows);
  assert.deepEqual(filterRowsBySearch(rows, "18", financeExpenseSearch.text), [paid]);
});

test("finance expense table keeps its caption and management-only action column", () => {
  const render = (canManage: boolean) => renderToStaticMarkup(React.createElement(DataTable<FinanceExpenseRow>, {
    rows: [expense], columns: createFinanceExpenseColumns(canManage), rowKey: (row) => row.id,
    regionLabel: "جدول مالي قابل للتمرير", regionClassName: "fin-table-wrap", tableClassName: "fin-table",
    caption: "سجل المصروفات المعروض حسب حالة التصفية — المبلغ الفعّال بعد أي تصحيح",
  }));
  const staffHtml = render(false);
  assert.ok(staffHtml.includes('class="fin-table-wrap"'));
  assert.ok(staffHtml.includes("<caption>سجل المصروفات"));
  assert.equal((staffHtml.match(/<th /g) ?? []).length, 6);
  assert.ok(!staffHtml.includes("تفاصيل"));
  const managerHtml = render(true);
  assert.equal((managerHtml.match(/<th /g) ?? []).length, 7);
  assert.ok(managerHtml.includes('href="/finance/expenses/17"'));
  assert.ok(managerHtml.includes("تفاصيل"));
});

test("transfer ledger metadata preserves movement and settlement filters and permissions", () => {
  assert.equal(transferLedgerFilters[0].matches(transfer), true);
  assert.equal(transferLedgerFilters[1].matches(transfer), true);
  assert.equal(transferLedgerFilters[2].matches(transfer), false);
  assert.equal(transferLedgerFilters[3].matches(transfer), false);
  assert.equal(transferLedgerFilters[4].matches(transfer), true);
  assert.equal(visibleTransferLedgerFilters(true).length, 5);
  assert.equal(visibleTransferLedgerFilters(false).some((filter) => filter.id === "TO_CUSTODY"), false);
  assert.equal(settlementArchiveFilters[1].matches(settlement), false);
  assert.equal(settlementArchiveFilters[2].matches(settlement), true);
  assert.equal(settlementArchiveFilters[3].matches(settlement), false);
  assert.equal(settlementArchiveColumns.length, 9);
  assert.equal(createTransferLedgerColumns(() => {}).length, 9);
});

test("transfer ledger search and CSV keep movement references and voucher details", () => {
  assert.equal(filterRowsBySearch([transfer], "21", transferLedgerSearch.text).length, 1);
  assert.equal(filterRowsBySearch([transfer], "خزنة", transferLedgerSearch.text).length, 1);
  assert.equal(filterRowsBySearch([transfer], "لا يوجد", transferLedgerSearch.text).length, 0);
  assert.deepEqual(csvHeaders(transferLedgerCsvColumns), ["رقم السند", "التوقيت", "الفرع", "الاتجاه", "من (المسلِّم)", "إلى (المستلِم)", "أصل الحركة", "المنفِّذ", "المبلغ (ج.م)"]);
  assert.deepEqual(csvRows([transfer], transferLedgerCsvColumns), [["#21", "١٢ نوفمبر ٢٠٢٦", "القاهرة · CAI", "توريد للخزنة", "عهدة أحمد", "خزنة الفرع", "تسوية عهدة #8", "منى", "1,000.00"]]);
});

test("settlement archive search and CSV preserve decisions and custody totals", () => {
  assert.equal(filterRowsBySearch([settlement], "8", settlementArchiveSearch.text).length, 1);
  assert.equal(filterRowsBySearch([settlement], "فرق يحتاج", settlementArchiveSearch.text).length, 1);
  assert.equal(filterRowsBySearch([settlement], "معتمدة", settlementArchiveSearch.text).length, 0);
  assert.deepEqual(csvHeaders(settlementArchiveCsvColumns), ["رقم التسوية", "تاريخ الطلب", "الفرع", "الموظف", "المتوقع (ج.م)", "المعدود (ج.م)", "الفرق عن المؤشر (ج.م)", "التحويل المنفذ", "القرار", "متخذ القرار", "السبب / البيان"]);
  assert.deepEqual(csvRows([settlement], settlementArchiveCsvColumns), [["#8", "2026-11-12", "القاهرة · CAI", "أحمد", "1,000.00 ج.م", "900.00 ج.م", "-100.00 ج.م", "بلا أثر مالي", "مرفوضة", "منى", "فرق يحتاج مراجعة"]]);
});

test("transfer and settlement tables preserve captions, amounts, and no-print voucher action", () => {
  const transferHtml = renderToStaticMarkup(React.createElement(DataTable<TransferLedgerRow>, {
    rows: [transfer], columns: createTransferLedgerColumns(() => {}), rowKey: (row) => row.id,
    regionLabel: "جدول مالي قابل للتمرير", regionClassName: "fin-table-wrap", tableClassName: "fin-table",
    caption: "سجل الحركات النقدية — مسار الأموال والسندات المرافقة",
  }));
  assert.equal((transferHtml.match(/<th /g) ?? []).length, 9);
  assert.ok(transferHtml.includes("<caption>سجل الحركات النقدية"));
  assert.ok(transferHtml.includes('<th scope="col" class="no-print">سند</th>'));
  assert.ok(transferHtml.includes('title="طباعة سند التسليم الرسمي رقم #21"'));
  assert.ok(transferHtml.includes('<bdi dir="ltr">#8</bdi>'));
  assert.ok(transferHtml.includes("1,000.00"));
  const archiveHtml = renderToStaticMarkup(React.createElement(DataTable<ArchivedSettlementRow>, {
    rows: [settlement], columns: settlementArchiveColumns, rowKey: (row) => row.id,
    regionLabel: "جدول مالي قابل للتمرير", regionClassName: "fin-table-wrap", tableClassName: "fin-table",
    caption: "طلبات التسوية — مؤشر الفترة والمعدود والفرق عنه والقرار النهائي",
  }));
  assert.equal((archiveHtml.match(/<th /g) ?? []).length, 9);
  assert.ok(archiveHtml.includes("<caption>طلبات التسوية"));
  assert.ok(archiveHtml.includes("مرفوضة"));
  assert.ok(archiveHtml.includes("-100.00 ج.م"));
  assert.ok(archiveHtml.includes("فرق يحتاج مراجعة"));
});

test("inventory register metadata guards receipt cost and preserves every serial column", () => {
  assert.equal(createInventoryReceiptColumns(false).length, 8);
  assert.equal(createInventoryReceiptColumns(true).length, 9);
  assert.ok(!createInventoryReceiptColumns(false).some((column) => column.id === "unit-cost"));
  assert.deepEqual(inventorySerialColumns.map((column) => column.id), ["serial", "product", "branch", "warehouse", "status", "created-at"]);
});

test("inventory receipt and serial tables render accessible regions and source fallbacks", () => {
  const receipt: InventoryReceiptRow = {
    id: "31", productName: "سماعة", sku: "SKU-31", branchName: "القاهرة", warehouseName: "الرئيسي",
    quantityFormatted: "2.00", unitCostFormatted: "500.0000", serialCount: 2,
    sourceReference: null, createdByName: "أحمد", createdAtFormatted: "١٢ نوفمبر ٢٠٢٦",
  };
  const serial: InventorySerialRow = {
    id: "41", serialNumber: "SN-41", productName: null, sku: null, branchName: null,
    warehouseName: null, isSold: true, createdAtFormatted: "١٢ نوفمبر ٢٠٢٦",
  };
  const receiptHtml = renderToStaticMarkup(React.createElement(DataTable<InventoryReceiptRow>, {
    rows: [receipt], columns: createInventoryReceiptColumns(true), rowKey: (row) => row.id,
    regionLabel: "جدول التوريدات", regionClassName: "inv-table-wrap table-wrap", tableClassName: "inv-table",
  }));
  assert.equal((receiptHtml.match(/<th /g) ?? []).length, 9);
  assert.ok(receiptHtml.includes('aria-label="جدول التوريدات"'));
  assert.ok(receiptHtml.includes("500.0000"));
  assert.ok(receiptHtml.includes("SKU-31"));
  assert.ok(receiptHtml.includes("—"));
  const serialHtml = renderToStaticMarkup(React.createElement(DataTable<InventorySerialRow>, {
    rows: [serial], columns: inventorySerialColumns, rowKey: (row) => row.id,
    regionLabel: "جدول الأرقام التسلسلية", regionClassName: "inv-table-wrap", tableClassName: "inv-table",
  }));
  assert.equal((serialHtml.match(/<th /g) ?? []).length, 6);
  assert.ok(serialHtml.includes('aria-label="جدول الأرقام التسلسلية"'));
  assert.ok(serialHtml.includes("SN-41"));
  assert.ok(serialHtml.includes("مصدر غير معروف"));
  assert.ok(serialHtml.includes("مباع"));
});

test("custody movement metadata shares direction predicates and combined search", () => {
  const incoming: CustodyMovementItem = { id: "1", recordedAt: "١٢ نوفمبر", kindLabel: "تغذية عهدة", direction: "IN", formattedAmount: "1,000.00" };
  const outgoing: CustodyMovementItem = { id: "2", recordedAt: "١٣ نوفمبر", kindLabel: "مصروف", direction: "OUT", formattedAmount: "250.00" };
  const rows = [incoming, outgoing];
  assert.deepEqual(custodyMovementFilters.map((filter) => rows.filter(filter.matches).length), [2, 1, 1]);
  assert.deepEqual(filterRowsBySearch(rows, "مصروف 250.00", custodyMovementSearch.text), [outgoing]);
  assert.deepEqual(filterRowsBySearch(rows, "غير موجود", custodyMovementSearch.text), []);
  assert.equal(custodyMovementColumns.length, 4);
});

test("custody movement table preserves caption and signed financial amounts", () => {
  const outgoing: CustodyMovementItem = { id: "2", recordedAt: "١٣ نوفمبر", kindLabel: "مصروف", direction: "OUT", formattedAmount: "250.00" };
  const html = renderToStaticMarkup(React.createElement(DataTable<CustodyMovementItem>, {
    rows: [outgoing], columns: custodyMovementColumns, rowKey: (row) => row.id,
    regionLabel: "جدول مالي قابل للتمرير", regionClassName: "fin-table-wrap", tableClassName: "fin-table",
    caption: "حركة عهدتي — الوارد والصادر بالتاريخ والمبلغ",
  }));
  assert.equal((html.match(/<th /g) ?? []).length, 4);
  assert.ok(html.includes("<caption>حركة عهدتي"));
  assert.ok(html.includes("fin-badge fin-badge--out"));
  assert.ok(html.includes("fin-money fin-money--negative"));
  assert.ok(html.includes("-250.00"));
  assert.ok(html.includes('aria-label="جدول مالي قابل للتمرير"'));
});
