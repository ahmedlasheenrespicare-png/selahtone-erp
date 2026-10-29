import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_COST_TEN_THOUSANDTHS,
  MAX_MONEY_CENTS,
  MAX_QUANTITY_HUNDREDTHS,
  allocatePartialReturn,
  calculateInclusiveSale,
  customerPosition,
  distributeInvoiceDiscount,
  grossLineCents,
  inclusiveTax,
  roundDivide,
  staffDiscountAllowed,
  validateCollectionAmount,
  validateRefundAmount,
  weightedAverageCost,
} from "../src/lib/commerce-math";

test("integer currency and quantities round half up, reject invalid and overflowing input", () => {
  assert.equal(roundDivide(1n, 2n), 1n);
  assert.equal(roundDivide(1n, 3n), 0n);
  assert.equal(grossLineCents(125n, 500n), 625n);
  assert.equal(grossLineCents(50n, 1n), 1n);
  assert.throws(() => roundDivide(-1n, 2n));
  assert.throws(() => roundDivide(1n, 0n));
  assert.throws(() => grossLineCents(0n, 100n));
  assert.throws(() => grossLineCents(MAX_QUANTITY_HUNDREDTHS + 1n, 1n));
  assert.throws(() => grossLineCents(200n, MAX_MONEY_CENTS));
});

test("discount distribution is exact and never exceeds a line", () => {
  for (let a = 0; a <= 10; a++) for (let b = 0; b <= 10; b++) for (let c = 0; c <= 4; c++) {
    const gross = [BigInt(a), BigInt(b), BigInt(c)];
    const total = gross.reduce((sum, value) => sum + value, 0n);
    for (let discount = 0n; discount <= total; discount++) {
      const allocated = distributeInvoiceDiscount(gross, discount);
      assert.equal(allocated.reduce((sum, value) => sum + value, 0n), discount);
      allocated.forEach((value, index) => assert.ok(value >= 0n && value <= gross[index]));
      assert.deepEqual(allocated, distributeInvoiceDiscount(gross, discount));
    }
  }
  assert.deepEqual(distributeInvoiceDiscount([], 0n), []);
  assert.throws(() => distributeInvoiceDiscount([], 1n));
  assert.throws(() => distributeInvoiceDiscount([100n], 101n));
  assert.throws(() => distributeInvoiceDiscount([MAX_MONEY_CENTS, 1n], 0n));
});

test("inclusive prices retain the final amount; tax categories must be explicit", () => {
  const vat = { kind: "VAT" as const, rateThousandthPercent: 10_000n };
  assert.deepEqual(inclusiveTax(11_000n, vat), { baseCents: 10_000n, taxCents: 1_000n });
  assert.deepEqual(inclusiveTax(5_000n, { kind: "EXEMPT", rateThousandthPercent: 0n }), { baseCents: 5_000n, taxCents: 0n });
  assert.throws(() => inclusiveTax(100n, null), /غير محدد/);
  assert.throws(() => inclusiveTax(100n, { kind: "COMPOSITE", rateThousandthPercent: 5000n } as never), /منفصلتين/);
  assert.throws(() => inclusiveTax(100n, { kind: "EXEMPT", rateThousandthPercent: 1n } as never), /صفر/);
  assert.throws(() => inclusiveTax(100n, { kind: "VAT", rateThousandthPercent: 100_001n }), /النطاق/);

  const sale = calculateInclusiveSale([
    { quantityHundredths: 100n, unitPriceCents: 11_000n, tax: vat },
    { quantityHundredths: 200n, unitPriceCents: 1_000n, tax: { kind: "EXEMPT", rateThousandthPercent: 0n } },
  ], 1_300n);
  assert.equal(sale.subtotalCents, 13_000n);
  assert.equal(sale.discountCents, 1_300n);
  assert.equal(sale.finalCents, 11_700n);
  assert.equal(sale.taxCents, 900n);
  assert.equal(sale.baseCents, 10_800n);
  assert.equal(sale.lines[0].discountCents, 1_100n);
  assert.equal(sale.lines[1].discountCents, 200n);
  assert.throws(() => calculateInclusiveSale([{ quantityHundredths: 100n, unitPriceCents: 100n, tax: null }], 0n), /غير محدد/);
});

test("weighted average uses each warehouse's quantities and four-decimal costs", () => {
  const result = weightedAverageCost(1000n, 1_000_000n, 1000n, 1_200_000n);
  assert.deepEqual(result, { quantityHundredths: 2000n, costTenThousandths: 1_100_000n });
  assert.deepEqual(weightedAverageCost(0n, 9_999n, 100n, 50_001n), { quantityHundredths: 100n, costTenThousandths: 50_001n });
  assert.deepEqual(weightedAverageCost(100n, 1n, 100n, 2n), { quantityHundredths: 200n, costTenThousandths: 2n });
  assert.throws(() => weightedAverageCost(100n, 100n, 0n, 100n));
  assert.throws(() => weightedAverageCost(MAX_QUANTITY_HUNDREDTHS, 1n, 1n, 1n));
  assert.throws(() => weightedAverageCost(0n, 0n, 1n, MAX_COST_TEN_THOUSANDTHS + 1n));
});

test("repeated partial returns reconcile exactly without negative tax bases", () => {
  for (let quantity = 1n; quantity <= 12n; quantity++) for (let final = 0n; final <= 15n; final++) for (let tax = 0n; tax <= final; tax++) {
    let totalFinal = 0n;
    let totalTax = 0n;
    for (let previous = 0n; previous < quantity; previous++) {
      const part = allocatePartialReturn({ originalQuantityHundredths: quantity, previousReturnedHundredths: previous, returnQuantityHundredths: 1n, originalFinalCents: final, originalTaxCents: tax });
      assert.ok(part.finalCents >= 0n && part.taxCents >= 0n && part.taxCents <= part.finalCents);
      totalFinal += part.finalCents;
      totalTax += part.taxCents;
    }
    assert.equal(totalFinal, final);
    assert.equal(totalTax, tax);
  }
  assert.throws(() => allocatePartialReturn({ originalQuantityHundredths: 100n, previousReturnedHundredths: 90n, returnQuantityHundredths: 11n, originalFinalCents: 100n, originalTaxCents: 5n }), /تتجاوز/);
  assert.throws(() => allocatePartialReturn({ originalQuantityHundredths: 100n, previousReturnedHundredths: 0n, returnQuantityHundredths: 100n, originalFinalCents: 1n, originalTaxCents: 2n }), /ضريبة/);
});

test("returns offset outstanding amounts before creating a customer liability", () => {
  const first = customerPosition({ originalTotalCents: 10_000n, returnedCents: 4_000n, collectedCents: 3_000n, refundedCents: 0n });
  assert.equal(first.dueFromCustomerCents, 3_000n);
  assert.equal(first.dueToCustomerCents, 0n);
  const second = customerPosition({ originalTotalCents: 10_000n, returnedCents: 8_000n, collectedCents: 3_000n, refundedCents: 0n });
  assert.equal(second.dueFromCustomerCents, 0n);
  assert.equal(second.dueToCustomerCents, 1_000n);
  validateRefundAmount(second.dueToCustomerCents, 400n);
  const afterPartialRefund = customerPosition({ originalTotalCents: 10_000n, returnedCents: 8_000n, collectedCents: 3_000n, refundedCents: 400n });
  assert.equal(afterPartialRefund.dueToCustomerCents, 600n);
  assert.throws(() => validateRefundAmount(600n, 601n), /يزيد/);
  assert.throws(() => validateRefundAmount(600n, 0n), /أكبر من صفر/);
  assert.throws(() => validateCollectionAmount(1_000n, 1_001n), /يزيد/);
  assert.throws(() => validateCollectionAmount(1_000n, 0n), /أكبر من صفر/);
  assert.throws(() => customerPosition({ originalTotalCents: 100n, returnedCents: 101n, collectedCents: 0n, refundedCents: 0n }));
  assert.throws(() => customerPosition({ originalTotalCents: 100n, returnedCents: 0n, collectedCents: 101n, refundedCents: 0n }));
  assert.throws(() => customerPosition({ originalTotalCents: 100n, returnedCents: 0n, collectedCents: 20n, refundedCents: 21n }));
});

test("staff discount limit is exact at the five-percent boundary", () => {
  assert.equal(staffDiscountAllowed(60_400n, 3_020n, 500n), true);
  assert.equal(staffDiscountAllowed(60_400n, 3_021n, 500n), false);
  assert.equal(staffDiscountAllowed(1n, 1n, 500n), false);
  assert.equal(staffDiscountAllowed(100n, 101n, 10_000n), false);
  assert.throws(() => staffDiscountAllowed(100n, 0n, 10_001n));
});
