import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildReceiptShareSummary,
  buildTypePriceHints,
  computePaymentPresetCents,
  evaluateLiveDiscountStatus,
  formatCartFieldEntries,
  normalizeCounterWhatsAppPhone,
} from "../src/lib/counter-sale-helpers";

test("formatCartFieldEntries maps internal field keys to Arabic labels in catalog order", () => {
  const entries = formatCartFieldEntries(
    [
      { key: "ear_side", label: "جهة الأذن" },
      { key: "device_model", label: "موديل السماعة" },
    ],
    {
      device_model: "BTE Power",
      ear_side: "اليمنى",
      empty_field: "   ",
    },
  );

  assert.deepEqual(entries, [
    { key: "ear_side", label: "جهة الأذن", value: "اليمنى" },
    { key: "device_model", label: "موديل السماعة", value: "BTE Power" },
  ]);
});

test("buildTypePriceHints computes latest and modal reference prices per catalog type", () => {
  const hints = buildTypePriceHints([
    { catalogTypeId: "10", unitPriceFixed: "7200.00", unitPriceCents: 720000n },
    { catalogTypeId: "10", unitPriceFixed: "6500.00", unitPriceCents: 650000n },
    { catalogTypeId: "10", unitPriceFixed: "6500.00", unitPriceCents: 650000n },
    { catalogTypeId: "22", unitPriceFixed: "350.50", unitPriceCents: 35050n },
  ]);

  assert.equal(hints["10"]?.latestPrice, "7200");
  assert.equal(hints["10"]?.latestFormatted, "7,200.00");
  assert.equal(hints["10"]?.commonPrice, "6500");
  assert.equal(hints["10"]?.commonFormatted, "6,500.00");
  assert.equal(hints["10"]?.sampleCount, 3);

  assert.equal(hints["22"]?.latestPrice, "350.5");
  assert.equal(hints["22"]?.commonFormatted, "350.50");
});

test("computePaymentPresetCents calculates exact 100%, 50% and 25% presets safely", () => {
  assert.equal(computePaymentPresetCents(100000n, 10000), 100000n);
  assert.equal(computePaymentPresetCents(100000n, 5000), 50000n);
  assert.equal(computePaymentPresetCents(100000n, 2500), 25000n);
  // Tiny positive total never drops to 0 cents
  assert.equal(computePaymentPresetCents(2n, 2500), 1n);
  assert.equal(computePaymentPresetCents(0n, 10000), 0n);
});

test("evaluateLiveDiscountStatus flags discounts exceeding role ceiling immediately", () => {
  const ok = evaluateLiveDiscountStatus(200000n, 10000n, 500); // 5% on 2,000 EGP = 100 EGP
  assert.equal(ok.withinLimit, true);
  assert.equal(ok.maxAllowedCents, 10000n);
  assert.equal(ok.excessCents, 0n);
  assert.equal(ok.effectivePercentLabel, "5");

  const over = evaluateLiveDiscountStatus(200000n, 15000n, 500); // 150 EGP > 100 EGP
  assert.equal(over.withinLimit, false);
  assert.equal(over.excessCents, 5000n);
  assert.equal(over.ceilingPercentLabel, "5");
});

test("buildReceiptShareSummary and normalizeCounterWhatsAppPhone format clean customer receipt", () => {
  const text = buildReceiptShareSummary({
    invoiceId: "48",
    branchName: "فرع العريش",
    customerName: "محمود سامي",
    itemsSummary: ["سماعة طبية × 1"],
    totalCents: 650000n,
    paidCents: 400000n,
    method: "CASH",
  });

  assert.ok(text.includes("ST-48"));
  assert.ok(text.includes("فرع العريش"));
  assert.ok(text.includes("6,500.00 ج.م"));
  assert.ok(text.includes("2,500.00 ج.م"));
  assert.equal(normalizeCounterWhatsAppPhone("01012345678"), "201012345678");
});
