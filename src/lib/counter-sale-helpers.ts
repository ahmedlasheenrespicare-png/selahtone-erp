import { displayMoney, METHOD_LABELS } from "./commerce-display";
import type { PaymentMethod } from "./commerce-validation";

export type CatalogFieldMeta = {
  key: string;
  label: string;
};

export type FormattedCartFieldEntry = {
  key: string;
  label: string;
  value: string;
};

export type TypePriceHint = {
  typeId: string;
  latestPrice: string;
  latestFormatted: string;
  commonPrice: string;
  commonFormatted: string;
  sampleCount: number;
};

export type HistoricalCatalogLineSample = {
  catalogTypeId: string;
  unitPriceFixed: string;
  unitPriceCents: bigint;
};

export type LiveDiscountVerdict = {
  withinLimit: boolean;
  effectivePercentLabel: string;
  ceilingPercentLabel: string;
  maxAllowedCents: bigint;
  excessCents: bigint;
};

/**
 * يحوّل قيم حقول الصنف المضافة للسلة إلى عناوينها العربية المعتمدة في شجرة الأصناف
 * بدلًا من إظهار المفاتيح البرمجية الإنجليزية (مثل ear_side).
 */
export function formatCartFieldEntries(
  fields: readonly CatalogFieldMeta[],
  values: Record<string, string>,
): FormattedCartFieldEntry[] {
  const labelByKey = new Map(fields.map((f) => [f.key, f.label]));
  const result: FormattedCartFieldEntry[] = [];
  const seen = new Set<string>();

  for (const field of fields) {
    const val = (values[field.key] ?? "").trim();
    if (val) {
      result.push({ key: field.key, label: field.label, value: val });
      seen.add(field.key);
    }
  }

  for (const [key, raw] of Object.entries(values)) {
    if (seen.has(key)) continue;
    const val = (raw ?? "").trim();
    if (!val) continue;
    result.push({
      key,
      label: labelByKey.get(key) ?? key,
      value: val,
    });
  }

  return result;
}

/**
 * يستخرج التسعير الاسترشادي (آخر سعر بيع + السعر الأكثر تكرارًا) لكل نوع صنف
 * من آخر مبيعات الفرع لمساعدة موظف الكاونتر على الإدخال السريع وتفادي الأصفار الناقصة.
 */
export function buildTypePriceHints(
  samples: readonly HistoricalCatalogLineSample[],
): Record<string, TypePriceHint> {
  const grouped = new Map<
    string,
    {
      latestFixed: string;
      latestCents: bigint;
      count: number;
      freq: Map<string, { count: number; cents: bigint }>;
    }
  >();

  for (const row of samples) {
    if (!row.catalogTypeId || row.unitPriceCents <= 0n) continue;
    const normalizedInput = trimTrailingZeros(row.unitPriceFixed);
    const existing = grouped.get(row.catalogTypeId);
    if (!existing) {
      const freq = new Map<string, { count: number; cents: bigint }>();
      freq.set(normalizedInput, { count: 1, cents: row.unitPriceCents });
      grouped.set(row.catalogTypeId, {
        latestFixed: normalizedInput,
        latestCents: row.unitPriceCents,
        count: 1,
        freq,
      });
    } else {
      existing.count += 1;
      const bucket = existing.freq.get(normalizedInput);
      if (bucket) {
        bucket.count += 1;
      } else {
        existing.freq.set(normalizedInput, { count: 1, cents: row.unitPriceCents });
      }
    }
  }

  const out: Record<string, TypePriceHint> = {};
  for (const [typeId, info] of grouped.entries()) {
    let commonFixed = info.latestFixed;
    let commonCents = info.latestCents;
    let bestFreq = 0;

    for (const [priceStr, entry] of info.freq.entries()) {
      if (entry.count > bestFreq) {
        bestFreq = entry.count;
        commonFixed = priceStr;
        commonCents = entry.cents;
      }
    }

    out[typeId] = {
      typeId,
      latestPrice: info.latestFixed,
      latestFormatted: displayMoney(info.latestCents),
      commonPrice: commonFixed,
      commonFormatted: displayMoney(commonCents),
      sampleCount: info.count,
    };
  }

  return out;
}

function trimTrailingZeros(fixed: string): string {
  const trimmed = fixed.trim();
  if (trimmed.endsWith(".00")) return trimmed.slice(0, -3);
  return trimmed.replace(/(\.\d*[1-9])0+$/, "$1");
}

/**
 * يحسب مبلغ الدفعة الأولى السريعة بنسبة مئوية (100%، 50%، 25%) بدقة القروش
 * مع ضمان عدم النزول عن قرش واحد متى كان إجمالي الفاتورة موجبًا.
 */
export function computePaymentPresetCents(
  totalCents: bigint,
  ratioBps: 10000 | 5000 | 2500,
): bigint {
  if (totalCents <= 0n) return 0n;
  if (ratioBps === 10000) return totalCents;
  const computed = (totalCents * BigInt(ratioBps)) / 10000n;
  return computed > 0n ? computed : 1n;
}

/**
 * يفحص الخصم لحظيًا أثناء الكتابة مقابل السقف المسموح لدور المستخدم (نقاط أساس bps).
 */
export function evaluateLiveDiscountStatus(
  subtotalCents: bigint,
  discountCents: bigint,
  ceilingBps: number,
): LiveDiscountVerdict {
  const safeCeiling = BigInt(Math.max(0, Math.min(10000, Math.trunc(ceilingBps))));
  const maxAllowedCents =
    subtotalCents > 0n ? (subtotalCents * safeCeiling) / 10000n : 0n;
  const withinLimit =
    discountCents <= 0n ||
    (subtotalCents > 0n && discountCents * 10000n <= subtotalCents * safeCeiling);
  const excessCents =
    discountCents > maxAllowedCents ? discountCents - maxAllowedCents : 0n;

  const effectiveBps =
    subtotalCents > 0n && discountCents > 0n
      ? Number((discountCents * 10000n) / subtotalCents)
      : 0;

  return {
    withinLimit,
    effectivePercentLabel: formatBpsPercent(effectiveBps),
    ceilingPercentLabel: formatBpsPercent(Number(safeCeiling)),
    maxAllowedCents,
    excessCents,
  };
}

function formatBpsPercent(bps: number): string {
  const pct = (bps / 100).toFixed(1);
  return pct.endsWith(".0") ? pct.slice(0, -2) : pct;
}

/**
 * يبني نص ملخص الإيصال الداخلي جاهزًا للنسخ أو المشاركة عبر واتساب عقب الحفظ مباشرةً.
 */
export function buildReceiptShareSummary(params: {
  invoiceId: string;
  branchName?: string;
  customerName: string;
  itemsSummary: string[];
  totalCents: bigint;
  paidCents: bigint;
  method: PaymentMethod;
}): string {
  const remaining =
    params.totalCents > params.paidCents
      ? params.totalCents - params.paidCents
      : 0n;
  const methodLabel = METHOD_LABELS[params.method] ?? "نقدي";
  const headerBranch = params.branchName ? ` (${params.branchName})` : "";

  const lines = [
    `أهلًا ${params.customerName.trim()}،`,
    `إيصال صلة تون للخدمات السمعية${headerBranch} — رقم ST-${params.invoiceId}:`,
    ...(params.itemsSummary.length > 0
      ? [`• الأصناف: ${params.itemsSummary.join(" | ")}`]
      : []),
    `• صافي الفاتورة: ${displayMoney(params.totalCents)} ج.م`,
    `• المسدّد (${methodLabel}): ${displayMoney(params.paidCents)} ج.م`,
    remaining > 0n
      ? `• المتبقي للسداد: ${displayMoney(remaining)} ج.م`
      : "• الحالة: مسدّدة بالكامل، شكرًا لثقتكم.",
  ];

  return lines.join("\n");
}

export function normalizeCounterWhatsAppPhone(raw: string): string | null {
  const digits = raw.replace(/\D+/g, "");
  if (digits.length < 9) return null;
  if (digits.startsWith("00")) return digits.slice(2);
  if (digits.startsWith("01") && digits.length === 11) return `2${digits}`;
  if (digits.startsWith("1") && digits.length === 10) return `20${digits}`;
  return digits;
}
