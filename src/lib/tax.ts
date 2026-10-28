/**
 * ============================================================
 *  محرك الضريبة — صلة تون
 *  يدعم: مكوّن واحد (14% / 5% / 0%) أو مكوّنات مركّبة (14% ثم 8% = 22% تراكمي)
 *  كل المبالغ تُقرّب لخانتين عشريتين في كل خطوة (مطابق للممارسة المحاسبية)
 * ============================================================
 */

export type TaxComponent = {
  /** كود المعدل كما في جدول tax_rates — VAT14 / VAT5 / EXEMPT / COMP8 ... */
  code: string;
  /** النسبة ككسر عشري (0.14 يعني 14%) */
  rate: number;
  /** true = يُحسب على الوعاء بعد إضافة المكوّن السابق (تراكمي) */
  compoundOnPrevious?: boolean;
};

export type TaxDetailLine = {
  code: string;
  rate: number;
  base: number;
  amount: number;
};

export type TaxResult = {
  /** إجمالي الضريبة */
  total: number;
  /** تفصيل كل مكوّن — يُحفظ صفًا لكل مكوّن في invoice_taxes */
  detail: TaxDetailLine[];
  /** كمية المكوّنات */
  components: number;
};

/** تقريب آمن لخانتين عشريتين (يتجنب أخطاء الفاصلة العائمة) */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** تقريب نقدي: 1234.565 → 1234.57 */
export function money(value: number): string {
  return round2(value).toFixed(2);
}

/**
 * حساب ضريبة على مبلغ أساس واحد (بند فاتورة).
 * @example lineTax(18500, [{code:'VAT14', rate:0.14}]) → 2590
 * @example lineTax(18500, [{code:'VAT14', rate:0.14}, {code:'COMP8', rate:0.08, compoundOnPrevious:true}]) → 4277.20
 */
export function lineTax(base: number, components: TaxComponent[]): TaxResult {
  if (base < 0) throw new Error("المبلغ الأساس لا يمكن أن يكون سالبًا");
  if (!components.length) return { total: 0, detail: [], components: 0 };

  const baseAmount = round2(base);
  let taxSoFar = 0;
  let total = 0;
  const detail: TaxDetailLine[] = [];

  for (const component of components) {
    if (component.rate < 0 || component.rate > 1) {
      throw new Error(`نسبة ضريبة غير صالحة للمكوّن ${component.code}`);
    }
    // الوعاء الفعلي لهذا المكوّن:
    //   - عادي: المبلغ الأساس
    //   - compoundOnPrevious=true: المبلغ الأساس + الضرائب السابقة (حساب تراكمي)
    const effectiveBase = component.compoundOnPrevious
      ? round2(baseAmount + taxSoFar)
      : baseAmount;

    const amount = round2(effectiveBase * component.rate);
    taxSoFar = round2(taxSoFar + amount);
    total = taxSoFar;

    detail.push({
      code: component.code,
      rate: component.rate,
      base: effectiveBase,
      amount,
    });
  }

  return { total, detail, components: components.length };
}

export type InvoiceLineInput = {
  description: string;
  qty: number;
  unitPrice: number;
  /** خصم على مستوى البند */
  discount?: number;
  components: TaxComponent[];
};

export type InvoiceTotals = {
  subtotal: number;
  discount: number;
  taxableBase: number;
  taxTotal: number;
  total: number;
  /** إجمالي الضريبة لكل مكوّن عبر كل البنود — جاهز للحفظ في invoice_taxes */
  taxByComponent: { code: string; rate: number; base: number; amount: number }[];
};

/**
 * حساب إجماليات فاتورة كاملة.
 * الخطوات: جمع البنود → خصم البند → توزيع خصم الفاتورة نسبيًا → ضريبة كل بند → التجميع.
 * @param invoiceDiscount خصم إجمالي على الفاتورة (يوزّع نسبيًا قبل الضريبة)
 */
export function invoiceTotals(
  lines: InvoiceLineInput[],
  invoiceDiscount = 0,
): InvoiceTotals {
  if (lines.length === 0) {
    return { subtotal: 0, discount: 0, taxableBase: 0, taxTotal: 0, total: 0, taxByComponent: [] };
  }

  // 1) قيمة كل بند قبل أي خصم
  const gross = lines.map((l) => round2(l.qty * l.unitPrice));
  const subtotal = round2(gross.reduce((a, b) => a + b, 0));

  // 2) خصومات البنود
  const lineDiscounts = lines.map((l, i) => {
    const d = round2(l.discount ?? 0);
    if (d < 0 || d > gross[i]) throw new Error(`خصم غير صالح في البند: ${l.description}`);
    return d;
  });
  const lineDiscountTotal = round2(lineDiscounts.reduce((a, b) => a + b, 0));

  // 3) توزيع خصم الفاتورة نسبيًا على صافي كل بند (آخر بند يستوعب فرق التقريب)
  const netAfterLineDiscount = gross.map((g, i) => round2(g - lineDiscounts[i]));
  const denominator = round2(netAfterLineDiscount.reduce((a, b) => a + b, 0));
  let distributed = 0;

  const taxByComponent = new Map<string, { code: string; rate: number; base: number; amount: number }>();
  let taxTotal = 0;
  let taxableBase = 0;

  lines.forEach((line, i) => {
    let share = 0;
    if (invoiceDiscount > 0 && denominator > 0) {
      share =
        i === lines.length - 1
          ? round2(invoiceDiscount - distributed)
          : round2((invoiceDiscount * netAfterLineDiscount[i]) / denominator);
      distributed = round2(distributed + share);
    }
    if (share > netAfterLineDiscount[i]) share = netAfterLineDiscount[i];

    const base = round2(netAfterLineDiscount[i] - share);
    taxableBase = round2(taxableBase + base);

    const { total: lineTaxTotal, detail } = lineTax(base, line.components);
    taxTotal = round2(taxTotal + lineTaxTotal);

    for (const d of detail) {
      const key = `${d.code}|${d.rate}`;
      const acc = taxByComponent.get(key) ?? { code: d.code, rate: d.rate, base: 0, amount: 0 };
      acc.base = round2(acc.base + d.base);
      acc.amount = round2(acc.amount + d.amount);
      taxByComponent.set(key, acc);
    }
  });

  const discount = round2(lineDiscountTotal + invoiceDiscount);
  const total = round2(taxableBase + taxTotal);

  return {
    subtotal,
    discount,
    taxableBase,
    taxTotal,
    total,
    taxByComponent: [...taxByComponent.values()].sort((a, b) => a.rate - b.rate),
  };
}
