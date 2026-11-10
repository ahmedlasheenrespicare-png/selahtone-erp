import assert from "node:assert/strict";
import test from "node:test";
import { buildSalesStatsCsv, type CsvExportPayload } from "../src/app/(app)/sales/stats/sales-stats-interactive";

const base: CsvExportPayload = {
  periodLabel: "اليوم", branchLabel: "الفرع", generatedAt: "2026-11-07",
  invoiceCount: 1, cancelledCount: 0, subtotalFormatted: "200", discountFormatted: "0",
  returnedFormatted: "0", netSalesFormatted: "200", netCollectedFormatted: "150",
  collectionRatePct: 75, outstandingFormatted: "50", catalogRevenueFormatted: "0",
  paymentMethods: [], branchPerformance: [], staffPerformance: [],
  topItems: [{ key: "1", name: "صنف اختباري", category: "أجهزة", isStock: true,
    quantityFormatted: "1", quantityNum: 1, lines: 1, revenueFormatted: "200", revenueNum: 200, sharePct: 100 }],
};

test("CSV retains sales but removes cost and profitability columns when not authorized", () => {
  const csv = buildSalesStatsCsv(base);
  assert.match(csv, /صنف اختباري/); assert.match(csv, /صافي الإيراد/);
  assert.doesNotMatch(csv, /التكلفة \(ج.م\)|الربح الصافي|هامش الربح|ربح الأصناف المخزونية/);
  const headers = csv.split("\r\n").find((line) => line.startsWith("أكثر الأصناف مبيعًا"));
  const row = csv.split("\r\n").find((line) => line.startsWith("صنف اختباري"));
  assert.equal(headers?.split(",").length, 6); assert.equal(row?.split(",").length, 6);
});

test("CSV includes cost and profitability when authorized", () => {
  const csv = buildSalesStatsCsv({ ...base, profitability: { stockProfitFormatted: "80", stockMarginPct: 40 },
    topItems: [{ ...base.topItems[0], costFormatted: "120", profitFormatted: "80", profitNum: 80, marginPct: 40 }] });
  assert.match(csv, /التكلفة \(ج.م\)/); assert.match(csv, /ربح الأصناف المخزونية/);
  assert.match(csv, /صنف اختباري,مخزوني,أجهزة,1,200,100%,120,80,40%/);
});
