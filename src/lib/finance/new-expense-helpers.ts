import { displayMoney } from "@/lib/commerce-display";
import { latinDigits } from "@/lib/inventory-validation";
import { scaledInteger } from "@/lib/inventory-math";

export type ExpenseDuplicateSample = {
  id: string;
  branchId: string;
  categoryName: string;
  expenseDate: string;
  amount: string;
  description: string;
  beneficiary?: string | null;
  documentNumber?: string | null;
};

export type DuplicateCheckResult =
  | {
      kind: "DOCUMENT";
      matched: ExpenseDuplicateSample;
    }
  | {
      kind: "SAME_DAY_AMOUNT";
      matched: ExpenseDuplicateSample;
    }
  | null;

export type BeneficiarySuggestion = {
  name: string;
  count: number;
  lastCategoryName: string;
};

/**
 * يطبّع مدخلات المبالغ (تحويل الأرقام العربية والهندية والفواصل وعلامة الكسر العشري العربية)
 * بحيث يعمل الإدخال من الجوال والحاسوب بسلاسة تامة.
 */
export function normalizeMoneyInput(raw: string): string {
  return latinDigits(raw)
    .replace(/٫/g, ".")
    .replace(/[,\s٬]/g, "")
    .trim();
}

export function parsePositiveMoneyCents(raw: string): bigint | null {
  const clean = normalizeMoneyInput(raw);
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  try {
    const cents = scaledInteger(clean, 2);
    return cents > 0n ? cents : null;
  } catch {
    return null;
  }
}

export function parseOptionalMoneyCents(
  raw: string,
): { empty: true; cents: 0n } | { empty: false; cents: bigint } | null {
  const clean = normalizeMoneyInput(raw);
  if (clean === "") return { empty: true, cents: 0n };
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  try {
    const cents = scaledInteger(clean, 2);
    return cents >= 0n ? { empty: false, cents } : null;
  } catch {
    return null;
  }
}

export function centsToInputString(cents: bigint): string {
  if (cents <= 0n) return "0";
  const whole = cents / 100n;
  const frac = cents % 100n;
  return frac === 0n
    ? whole.toString()
    : `${whole.toString()}.${frac.toString().padStart(2, "0")}`;
}

/**
 * يستخرج قيمة الضريبة المشمولة داخل المبلغ الإجمالي (مثل 14% ض.ق.م أو 5% ضريبة جدول)
 * بالتقريب المحاسبي القياسي لأقرب قرش، دون فرض أي حساب آلي إجباري.
 */
export function calculateInclusiveTaxExtract(
  grossCents: bigint,
  ratePercent: 14 | 5,
): {
  taxCents: bigint;
  netBeforeTaxCents: bigint;
  taxInputString: string;
  netFormatted: string;
  taxFormatted: string;
} {
  if (grossCents <= 0n) {
    return {
      taxCents: 0n,
      netBeforeTaxCents: 0n,
      taxInputString: "0",
      netFormatted: "0.00",
      taxFormatted: "0.00",
    };
  }
  const rateBig = BigInt(ratePercent);
  const denom = 100n + rateBig;
  // tax = round(gross * rate / (100 + rate))
  const numerator = grossCents * rateBig;
  const taxCents = (numerator + denom / 2n) / denom;
  const netBeforeTaxCents = grossCents > taxCents ? grossCents - taxCents : 0n;

  return {
    taxCents,
    netBeforeTaxCents,
    taxInputString: centsToInputString(taxCents),
    netFormatted: displayMoney(netBeforeTaxCents),
    taxFormatted: displayMoney(taxCents),
  };
}

/**
 * كاشف تكرار مزدوج:
 * ١) تطابق رقم المستند (الأعلى خطورة لمنع صرف نفس الفاتورة مرتين).
 * ٢) تطابق الفرع والتاريخ والمبلغ في نفس اليوم.
 */
export function detectExpenseDuplicateRisk(
  candidate: {
    branchId: string;
    categoryName: string;
    expenseDate: string;
    amountCents: bigint | null;
    documentNumber: string;
  },
  existingHints: readonly ExpenseDuplicateSample[],
): DuplicateCheckResult {
  const docNormalized = latinDigits(candidate.documentNumber)
    .trim()
    .toLowerCase();

  if (docNormalized.length >= 2) {
    const docMatch = existingHints.find((h) => {
      if (!h.documentNumber) return false;
      return (
        latinDigits(h.documentNumber).trim().toLowerCase() === docNormalized
      );
    });
    if (docMatch) {
      return { kind: "DOCUMENT", matched: docMatch };
    }
  }

  if (
    candidate.amountCents !== null &&
    candidate.amountCents > 0n &&
    candidate.branchId &&
    candidate.expenseDate
  ) {
    const sameDayMatch = existingHints.find((h) => {
      if (h.branchId !== candidate.branchId) return false;
      if (h.expenseDate !== candidate.expenseDate) return false;
      const hintCents = parsePositiveMoneyCents(h.amount);
      if (hintCents === null || hintCents !== candidate.amountCents) return false;
      if (
        candidate.categoryName &&
        h.categoryName &&
        h.categoryName !== candidate.categoryName
      ) {
        return false;
      }
      return true;
    });
    if (sameDayMatch) {
      return { kind: "SAME_DAY_AMOUNT", matched: sameDayMatch };
    }
  }

  return null;
}

/**
 * يقترح قوالب وصف سريعة تتكيّف تلقائيًا مع بند المصروف المختار.
 */
export function suggestCategoryTemplates(categoryName: string): string[] {
  const name = categoryName.trim();
  if (/إيجار|مرافق|كهرباء|مياه|غاز/.test(name)) {
    return [
      "إيجار مقر الفرع الشهري",
      "فاتورة كهرباء الفرع",
      "فاتورة مياه ومرافق الفرع",
      "باقة إنترنت واتصالات الفرع",
    ];
  }
  if (/انتقال|شحن|نقل|مواصلات|بريد/.test(name)) {
    return [
      "شحن أجهزة ومستلزمات للفرع",
      "بوليصة شحن صيانة سماعات",
      "انتقالات ومشاوير تشغيلية للفرع",
      "توصيل طلبات عملاء",
    ];
  }
  if (/مستلزمات|تشغيل|نظافة|ضيافة|قرطاسية|مطبوعات/.test(name)) {
    return [
      "مستلزمات طبية وتشغيلية للكاونتر",
      "أدوات نظافة وضيافة الفرع",
      "قرطاسية ومطبوعات وإيصالات",
      "أحبار طباعة وورق فواتير",
    ];
  }
  if (/صيانة|إصلاح|أعطال/.test(name)) {
    return [
      "صيانة تكييف وإضاءة الفرع",
      "صيانة أجهزة ومعدات الفحص",
      "أعمال إصلاح وكهرباء بالفرع",
    ];
  }
  return [
    "شحن ونقل بضائع للفرع",
    "فاتورة كهرباء / مرافق الفرع",
    "أدوات نظافة ومستلزمات ضيافة",
    "قرطاسية ومطبوعات فواتير",
    "صيانة وتشغيل الفرع",
    "باقة إنترنت واتصالات الفرع",
  ];
}

/**
 * يستخرج قائمة المستفيدين المتكررين من سجل المصروفات السابق للتعبئة بنقرة واحدة.
 */
export function extractFrequentBeneficiaries(
  existingHints: readonly ExpenseDuplicateSample[],
  branchId?: string,
): BeneficiarySuggestion[] {
  const map = new Map<
    string,
    { name: string; count: number; lastCategoryName: string }
  >();

  for (const h of existingHints) {
    if (branchId && h.branchId !== branchId) continue;
    const raw = (h.beneficiary ?? "").trim();
    if (raw.length < 2) continue;
    const key = raw.toLowerCase();
    const prev = map.get(key);
    if (prev) {
      prev.count += 1;
    } else {
      map.set(key, {
        name: raw,
        count: 1,
        lastCategoryName: h.categoryName,
      });
    }
  }

  return Array.from(map.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

/**
 * يزيح تاريخًا بصيغة YYYY-MM-DD بعدد أيام محدد (مثل -1 للحصول على تاريخ أمس).
 */
export function shiftIsoDateDays(isoDate: string, deltaDays: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate;
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  if (!Number.isFinite(d.getTime())) return isoDate;
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}
