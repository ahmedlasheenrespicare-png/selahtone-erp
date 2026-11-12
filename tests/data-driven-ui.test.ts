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

test("resource metadata defines the complete invoice table and action header", () => {
  const columns = createSalesInvoiceColumns(true);
  assert.deepEqual(columns.map((column) => column.id), [
    "invoice", "customer", "branch", "original", "due-from", "due-to", "status", "created-at", "details",
  ]);
  assert.equal(columns.at(-1)?.headerAriaLabel, "تفاصيل");
  assert.notEqual(columns.at(-1)?.renderCell(invoice), false);
  assert.equal(createSalesInvoiceColumns(false).at(-1)?.renderCell(invoice), false);
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
