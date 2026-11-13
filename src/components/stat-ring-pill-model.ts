/**
 * نموذج عرض خفيف لحلقة النسبة. لا يقرأ بيانات ولا يغيّر حسابات المالية/المبيعات.
 * الفكرة البصرية مقتبسة من zeeshan_2112/gentle-treefrog-69 على Uiverse (MIT).
 */

export function normalizeStatRingPercent(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, Math.round(value * 10) / 10));
}

export function statRingAngleDegrees(value: number | null | undefined): number {
  const percent = normalizeStatRingPercent(value);
  return percent === null ? 0 : Math.round(percent * 36) / 10;
}

/**
 * نسبة التحصيل المعروضة في الحلقة.
 * نستخدم النسبة المحسوبة أصلًا في sales-stats، لكن نخفيها عندما لا يوجد مقام صالح.
 * هذا يمنع عرض 100% المضللة التي يعيدها المحرك الحالي عند غياب صافي المبيعات.
 */
export function collectionRingPercent(input: {
  invoiceCount: number;
  netSalesNum: number;
  collectionRatePct: number;
}): number | null {
  if (
    !Number.isFinite(input.invoiceCount) ||
    !Number.isFinite(input.netSalesNum) ||
    input.invoiceCount <= 0 ||
    input.netSalesNum <= 0
  ) {
    return null;
  }
  return normalizeStatRingPercent(input.collectionRatePct);
}

/**
 * نسبة المدفوع فعليًا من إجمالي مصروفات السجل المعروض، بدقة جزء من عشرة.
 * نحسبها من مجاميع القرش الصحيحة الموجودة بالصفحة، دون تعديل المحرك أو المجاميع.
 * السجل الفارغ أو الإجمالي غير الموجب حالة عرض بلا نسبة، وليست 0% أو 100%.
 */
export function expensePaidRingPercent(input: {
  expenseCount: number;
  totalCents: bigint;
  paidCents: bigint;
}): number | null {
  if (!Number.isSafeInteger(input.expenseCount) || input.expenseCount <= 0) return null;
  return amountShareRingPercent({ partCents: input.paidCents, totalCents: input.totalCents });
}

/**
 * نسبة المعلق للاعتماد أو الصرف من إجمالي مصروفات الفترة المعروضة.
 * البسط هو المعلق (بانتظار الاعتماد + معتمد بانتظار الصرف)، والمقام إجمالي المصروفات.
 * السجل الفارغ أو الإجمالي غير الموجب حالة عرض بلا نسبة، وليست 0% أو 100%.
 */
export function expenseWaitingRingPercent(input: {
  expenseCount: number;
  totalCents: bigint;
  waitingCents: bigint;
}): number | null {
  if (!Number.isSafeInteger(input.expenseCount) || input.expenseCount <= 0) return null;
  return amountShareRingPercent({ partCents: input.waitingCents, totalCents: input.totalCents });
}

/**
 * نسبة المتبقي على العملاء من صافي مبيعات الفترة (مبيعات الشهر مثلًا).
 * المقام هو صافي المبيعات المعروض في البطاقة نفسها، والبسط هو المتبقي المعروض بجانبه.
 * لا فواتير أو صافي غير موجب ⇒ لا نسبة (وليس 0% ولا 100%).
 */
export function outstandingShareRingPercent(input: {
  invoiceCount: number;
  netSalesCents: bigint;
  outstandingCents: bigint;
}): number | null {
  if (!Number.isSafeInteger(input.invoiceCount) || input.invoiceCount <= 0) return null;
  return amountShareRingPercent({
    partCents: input.outstandingCents,
    totalCents: input.netSalesCents,
  });
}

/**
 * حصة مبلغ من إجمالي مبلغ، بدقة جزء من عشرة.
 * لا تصلح إلا عندما يكون المقام موجبًا والبسط غير سالب؛ السجل الفارغ ليس 0% ولا 100%.
 * إذا تجاوز البسط الإجمالي (تصحيح/رد غير متماثل مثلًا) نعرض 100% كحد أقصى للحلقة.
 */
export function amountShareRingPercent(input: {
  partCents: bigint;
  totalCents: bigint;
}): number | null {
  if (input.totalCents <= 0n || input.partCents < 0n) return null;
  const part = input.partCents > input.totalCents ? input.totalCents : input.partCents;
  const tenths = (part * 1000n + input.totalCents / 2n) / input.totalCents;
  return normalizeStatRingPercent(Number(tenths) / 10);
}

/** حصة عدد من إجمالي عدد (مثل الفواتير النشطة من إجمالي الفواتير المعروضة). */
export function countShareRingPercent(input: {
  partCount: number;
  totalCount: number;
}): number | null {
  if (
    !Number.isSafeInteger(input.partCount) ||
    !Number.isSafeInteger(input.totalCount) ||
    input.totalCount <= 0 ||
    input.partCount < 0
  ) {
    return null;
  }
  const part = Math.min(input.partCount, input.totalCount);
  return normalizeStatRingPercent(Math.round((part / input.totalCount) * 1000) / 10);
}

/**
 * حصة النقدي من صافي تحصيلات اليوم.
 * نرفض الصافي غير الموجب أو النقدي السالب (مرتجعات نقدية تتجاوز التحصيل) بدل عرض نسبة مضللة.
 */
export function cashCollectionRingPercent(input: {
  cashCents: bigint;
  netCollectedCents: bigint;
}): number | null {
  if (
    input.netCollectedCents <= 0n ||
    input.cashCents < 0n ||
    input.cashCents > input.netCollectedCents
  ) {
    return null;
  }
  return amountShareRingPercent({ partCents: input.cashCents, totalCents: input.netCollectedCents });
}
