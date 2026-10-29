/**
 * Pure arithmetic for the planned commerce workflows.
 * Money is integer piastres, quantities are hundredths, and costs are ten-thousandths
 * of an Egyptian pound. No database or real payment provider is accessed here.
 *
 * Tax treatment is illustrative until the company's accountant confirms rates,
 * inclusivity and rounding. A missing or unsupported tax category must never be
 * silently treated as an exemption.
 */

export const MAX_MONEY_CENTS = 99_999_999_999_999n; // DECIMAL(14,2)
export const MAX_QUANTITY_HUNDREDTHS = 999_999_999_999n; // DECIMAL(12,2)
export const MAX_COST_TEN_THOUSANDTHS = 99_999_999_999_999n; // DECIMAL(14,4)
export const RATE_SCALE = 100_000n; // 100.000% in thousandths of one percentage point
export const DISCOUNT_BASIS = 10_000n; // 100.00% in basis points

export class CommerceMathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommerceMathError";
  }
}

function assertNonNegative(value: bigint, maximum: bigint, name: string): void {
  if (value < 0n || value > maximum) throw new CommerceMathError(`${name} خارج النطاق المسموح.`);
}

/** Nonnegative half-up rounding. Never use JavaScript floating-point for money. */
export function roundDivide(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n) throw new CommerceMathError("لا يمكن تقريب قيمة سالبة أو القسمة على صفر.");
  return (numerator * 2n + denominator) / (denominator * 2n);
}

/** Gross line price before a discount, with a two-decimal quantity and price. */
export function grossLineCents(quantityHundredths: bigint, unitPriceCents: bigint): bigint {
  assertNonNegative(quantityHundredths, MAX_QUANTITY_HUNDREDTHS, "الكمية");
  assertNonNegative(unitPriceCents, MAX_MONEY_CENTS, "سعر الوحدة");
  if (!quantityHundredths) throw new CommerceMathError("الكمية يجب أن تكون أكبر من صفر.");
  const result = roundDivide(quantityHundredths * unitPriceCents, 100n);
  assertNonNegative(result, MAX_MONEY_CENTS, "إجمالي البند");
  return result;
}

/**
 * Largest-remainder distribution with deterministic tie-breaking. Every piastre is
 * allocated once, and no line gets a discount larger than its gross value.
 */
export function distributeInvoiceDiscount(grossValues: readonly bigint[], discount: bigint): bigint[] {
  if (!grossValues.length) {
    if (discount !== 0n) throw new CommerceMathError("لا يمكن خصم فاتورة بلا أصناف.");
    return [];
  }
  for (const gross of grossValues) assertNonNegative(gross, MAX_MONEY_CENTS, "قيمة البند");
  assertNonNegative(discount, MAX_MONEY_CENTS, "الخصم");
  const total = grossValues.reduce((sum, gross) => sum + gross, 0n);
  assertNonNegative(total, MAX_MONEY_CENTS, "إجمالي الفاتورة");
  if (discount > total) throw new CommerceMathError("الخصم لا يمكن أن يزيد على قيمة الفاتورة.");
  if (total === 0n) return grossValues.map(() => 0n);
  const allocation = grossValues.map((gross, index) => {
    const product = discount * gross;
    return { index, amount: product / total, remainder: product % total };
  });
  let unallocated = discount - allocation.reduce((sum, line) => sum + line.amount, 0n);
  const order = [...allocation].sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1);
  for (let index = 0; unallocated > 0n; index++, unallocated--) {
    // The number of unallocated piastres is always smaller than the number of lines.
    const line = order[index];
    if (!line || line.amount >= grossValues[line.index]) throw new CommerceMathError("تعذر توزيع الخصم بأمان.");
    line.amount++;
  }
  return allocation.map((line) => line.amount);
}

export type ReviewedTax =
  | { kind: "EXEMPT"; rateThousandthPercent: 0n }
  | { kind: "VAT" | "SCHEDULE"; rateThousandthPercent: bigint };

/** Extract one explicit, non-compound tax from a final, tax-inclusive amount. */
export function inclusiveTax(netCents: bigint, tax: ReviewedTax | null): { baseCents: bigint; taxCents: bigint } {
  assertNonNegative(netCents, MAX_MONEY_CENTS, "قيمة البند");
  if (!tax) throw new CommerceMathError("معدل ضريبة الصنف غير محدد ويجب مراجعته.");
  if (tax.kind === "EXEMPT") {
    if (tax.rateThousandthPercent !== 0n) throw new CommerceMathError("المعدل المعفى يجب أن يساوي صفرًا.");
    return { baseCents: netCents, taxCents: 0n };
  }
  if (tax.kind !== "VAT" && tax.kind !== "SCHEDULE") throw new CommerceMathError("نوع الضريبة يحتاج معالجة ومراجعة منفصلتين.");
  if (tax.rateThousandthPercent < 0n || tax.rateThousandthPercent > RATE_SCALE) {
    throw new CommerceMathError("معدل الضريبة خارج النطاق المسموح.");
  }
  const taxCents = roundDivide(netCents * tax.rateThousandthPercent, RATE_SCALE + tax.rateThousandthPercent);
  return { baseCents: netCents - taxCents, taxCents };
}

export type SaleLineInput = {
  quantityHundredths: bigint;
  unitPriceCents: bigint;
  tax: ReviewedTax | null;
};
export type CalculatedSaleLine = SaleLineInput & {
  grossCents: bigint;
  discountCents: bigint;
  finalCents: bigint;
  baseCents: bigint;
  taxCents: bigint;
};
export type CalculatedSale = {
  lines: CalculatedSaleLine[];
  subtotalCents: bigint;
  discountCents: bigint;
  finalCents: bigint;
  baseCents: bigint;
  taxCents: bigint;
};

/** Prices are final; the returned tax amount is already included, never added again. */
export function calculateInclusiveSale(lines: readonly SaleLineInput[], discountCents: bigint): CalculatedSale {
  if (!lines.length) throw new CommerceMathError("أضف صنفًا واحدًا على الأقل.");
  const gross = lines.map((line) => grossLineCents(line.quantityHundredths, line.unitPriceCents));
  const subtotalCents = gross.reduce((sum, value) => sum + value, 0n);
  assertNonNegative(subtotalCents, MAX_MONEY_CENTS, "إجمالي الفاتورة");
  const allocations = distributeInvoiceDiscount(gross, discountCents);
  const computed = lines.map((line, index): CalculatedSaleLine => {
    const finalCents = gross[index] - allocations[index];
    const tax = inclusiveTax(finalCents, line.tax);
    return { ...line, grossCents: gross[index], discountCents: allocations[index], finalCents, ...tax };
  });
  const finalCents = computed.reduce((sum, line) => sum + line.finalCents, 0n);
  const taxCents = computed.reduce((sum, line) => sum + line.taxCents, 0n);
  const baseCents = computed.reduce((sum, line) => sum + line.baseCents, 0n);
  if (finalCents + discountCents !== subtotalCents || baseCents + taxCents !== finalCents) {
    throw new CommerceMathError("تعذر مطابقة إجماليات الفاتورة.");
  }
  return { lines: computed, subtotalCents, discountCents, finalCents, baseCents, taxCents };
}

/**
 * Compute a new weighted average at the existing cost precision (four decimals).
 * The caller must perform stock, serial and receipt updates in one transaction.
 */
export function weightedAverageCost(
  currentQuantityHundredths: bigint,
  currentCostTenThousandths: bigint,
  receivedQuantityHundredths: bigint,
  receivedCostTenThousandths: bigint,
): { quantityHundredths: bigint; costTenThousandths: bigint } {
  assertNonNegative(currentQuantityHundredths, MAX_QUANTITY_HUNDREDTHS, "الكمية الحالية");
  assertNonNegative(receivedQuantityHundredths, MAX_QUANTITY_HUNDREDTHS, "الكمية الواردة");
  assertNonNegative(currentCostTenThousandths, MAX_COST_TEN_THOUSANDTHS, "التكلفة الحالية");
  assertNonNegative(receivedCostTenThousandths, MAX_COST_TEN_THOUSANDTHS, "تكلفة الوارد");
  if (receivedQuantityHundredths === 0n) throw new CommerceMathError("الكمية الواردة يجب أن تكون أكبر من صفر.");
  const quantityHundredths = currentQuantityHundredths + receivedQuantityHundredths;
  assertNonNegative(quantityHundredths, MAX_QUANTITY_HUNDREDTHS, "إجمالي الكمية");
  const totalCost = currentQuantityHundredths * currentCostTenThousandths + receivedQuantityHundredths * receivedCostTenThousandths;
  const costTenThousandths = roundDivide(totalCost, quantityHundredths);
  assertNonNegative(costTenThousandths, MAX_COST_TEN_THOUSANDTHS, "متوسط التكلفة");
  return { quantityHundredths, costTenThousandths };
}

export type ReturnedLineSnapshot = {
  originalQuantityHundredths: bigint;
  previousReturnedHundredths: bigint;
  returnQuantityHundredths: bigint;
  originalFinalCents: bigint;
  originalTaxCents: bigint;
};

/**
 * Partial returns use cumulative rounding against immutable sale snapshots.
 * This makes repeated returns sum to the original line exactly, including tax.
 */
export function allocatePartialReturn(snapshot: ReturnedLineSnapshot): { finalCents: bigint; taxCents: bigint } {
  const { originalQuantityHundredths: quantity, previousReturnedHundredths: previous, returnQuantityHundredths: added, originalFinalCents: final, originalTaxCents: tax } = snapshot;
  assertNonNegative(quantity, MAX_QUANTITY_HUNDREDTHS, "الكمية الأصلية");
  assertNonNegative(previous, MAX_QUANTITY_HUNDREDTHS, "الكمية المرتجعة سابقًا");
  assertNonNegative(added, MAX_QUANTITY_HUNDREDTHS, "كمية المرتجع");
  assertNonNegative(final, MAX_MONEY_CENTS, "القيمة الأصلية");
  assertNonNegative(tax, MAX_MONEY_CENTS, "الضريبة الأصلية");
  if (!quantity || !added || previous + added > quantity) throw new CommerceMathError("كمية المرتجع تتجاوز المتاح في الفاتورة.");
  if (tax > final) throw new CommerceMathError("ضريبة البند لا يمكن أن تزيد على قيمته النهائية.");
  // Allocate the non-tax base and the included tax separately. Subtracting rounded
  // cumulative totals directly can otherwise make a tiny return's tax exceed its
  // total by one piastre. Both components stay nonnegative and sum exactly on a
  // full return; interim values may differ by a piastre from naive gross rounding.
  const base = final - tax;
  const beforeBase = roundDivide(base * previous, quantity);
  const afterBase = roundDivide(base * (previous + added), quantity);
  const beforeTax = roundDivide(tax * previous, quantity);
  const afterTax = roundDivide(tax * (previous + added), quantity);
  const taxCents = afterTax - beforeTax;
  return { finalCents: afterBase - beforeBase + taxCents, taxCents };
}

/**
 * A refund owed to a customer is a liability, not proof that money was returned.
 * Recorded refunds are manual facts after actual payment, never transfers from here.
 */
export function customerPosition(input: { originalTotalCents: bigint; returnedCents: bigint; collectedCents: bigint; refundedCents: bigint }): {
  remainingSaleCents: bigint; netCollectedCents: bigint; dueFromCustomerCents: bigint; dueToCustomerCents: bigint;
} {
  for (const value of Object.values(input)) assertNonNegative(value, MAX_MONEY_CENTS, "المبلغ");
  if (input.returnedCents > input.originalTotalCents) throw new CommerceMathError("قيمة المرتجع تزيد على الفاتورة الأصلية.");
  if (input.collectedCents > input.originalTotalCents) throw new CommerceMathError("المبلغ المحصّل لا يمكن أن يتجاوز الفاتورة الأصلية.");
  if (input.refundedCents > input.collectedCents) throw new CommerceMathError("المبلغ المعاد لا يمكن أن يتجاوز المحصّل.");
  const remainingSaleCents = input.originalTotalCents - input.returnedCents;
  const netCollectedCents = input.collectedCents - input.refundedCents;
  return {
    remainingSaleCents,
    netCollectedCents,
    dueFromCustomerCents: remainingSaleCents > netCollectedCents ? remainingSaleCents - netCollectedCents : 0n,
    dueToCustomerCents: netCollectedCents > remainingSaleCents ? netCollectedCents - remainingSaleCents : 0n,
  };
}

/** Validate a first payment or later collection without sending or moving money. */
export function validateCollectionAmount(dueFromCustomerCents: bigint, amountCents: bigint): void {
  assertNonNegative(dueFromCustomerCents, MAX_MONEY_CENTS, "المتبقي على العميل");
  assertNonNegative(amountCents, MAX_MONEY_CENTS, "مبلغ التحصيل");
  if (amountCents === 0n) throw new CommerceMathError("يجب تسجيل مبلغ أكبر من صفر.");
  if (amountCents > dueFromCustomerCents) throw new CommerceMathError("مبلغ التحصيل لا يمكن أن يزيد على المتبقي.");
}

/** A recorded refund must be positive and no greater than the current liability. */
export function validateRefundAmount(dueToCustomerCents: bigint, amountCents: bigint): void {
  assertNonNegative(dueToCustomerCents, MAX_MONEY_CENTS, "المستحق للعميل");
  assertNonNegative(amountCents, MAX_MONEY_CENTS, "مبلغ الرد");
  if (amountCents === 0n) throw new CommerceMathError("يجب تسجيل مبلغ رد أكبر من صفر.");
  if (amountCents > dueToCustomerCents) throw new CommerceMathError("مبلغ الرد لا يمكن أن يزيد على المستحق للعميل.");
}

/** Staff limits are computed from the invoice's pre-discount final prices. */
export function staffDiscountAllowed(subtotalCents: bigint, discountCents: bigint, limitBasisPoints: bigint): boolean {
  assertNonNegative(subtotalCents, MAX_MONEY_CENTS, "إجمالي الفاتورة");
  assertNonNegative(discountCents, MAX_MONEY_CENTS, "الخصم");
  if (limitBasisPoints < 0n || limitBasisPoints > DISCOUNT_BASIS) throw new CommerceMathError("حد الخصم غير صالح.");
  return discountCents <= subtotalCents && discountCents * DISCOUNT_BASIS <= subtotalCents * limitBasisPoints;
}
