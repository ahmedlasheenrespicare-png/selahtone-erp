export const PRODUCT_CATEGORIES = ["HEARING_AID", "ACCESSORY", "SPARE_PART", "SERVICE"] as const;
export type ProductCategoryInput = (typeof PRODUCT_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<ProductCategoryInput, string> = {
  HEARING_AID: "سماعة طبية",
  ACCESSORY: "مستلزم",
  SPARE_PART: "قطعة غيار",
  SERVICE: "خدمة",
};

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BAD_TEXT = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/u;
const MAX_I64 = 9223372036854775807n;
export const MAX_SERIALS_PER_OPENING = 1000;

export type FieldErrors = Record<string, string>;
export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors };

export type ProductInputRaw = {
  requestId: string;
  sku: string;
  nameAr: string;
  category: string;
  brand: string;
  model: string;
  purchaseCost: string;
  salePrice: string;
  taxRateId: string;
  isSerialized: boolean;
};

export type ProductInput = {
  requestId: string;
  sku: string | null;
  nameAr: string;
  category: ProductCategoryInput;
  brand: string | null;
  model: string | null;
  purchaseCost: string;
  salePrice: string;
  taxRateId: number | null;
  isSerialized: boolean;
};

export function productSku(input: ProductInput): string {
  return input.sku ?? `ST-${input.requestId.replace(/-/g, "").slice(0, 20).toUpperCase()}`;
}

export type OpeningInputRaw = {
  requestId: string;
  productId: string;
  warehouseId: string;
  quantity: string;
  unitCost: string;
  serialNumbers: string;
};

export type OpeningInput = {
  requestId: string;
  productId: string;
  warehouseId: string;
  quantity: string;
  unitCost: string;
  serials: { number: string; key: string }[];
};

export function latinDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

/** Return an exact decimal string without converting money or quantities to floating point. */
export function decimalString(input: string, precision: number, scale: number): string | null {
  const value = latinDigits(input.trim()).replace(/٫/g, ".");
  if (value.length > precision + 12 || !/^\d+(?:\.\d+)?$/.test(value)) return null;
  let [whole, fraction = ""] = value.split(".");
  whole = whole.replace(/^0+(?=\d)/, "");
  if (whole.length > precision - scale || fraction.length > scale) return null;
  fraction = fraction.replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

// PostgreSQL LIKE treats %, _ and backslash specially; user searches should be literal.
export function escapeLikeLiteral(input: string): string {
  return input.replace(/[\\%_]/g, "\\$&");
}

export function positiveDatabaseId(input: string): string | null {
  const value = latinDigits(input.trim());
  if (!/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > MAX_I64) return null;
  return value;
}

function cleanText(input: string): string {
  return input.normalize("NFKC").trim();
}

function validText(value: string, maxLength: number): boolean {
  return value.length <= maxLength && !BAD_TEXT.test(value);
}

export function parseProductInput(raw: ProductInputRaw): ValidationResult<ProductInput> {
  const errors: FieldErrors = {};
  const requestId = raw.requestId.trim().toLowerCase();
  if (!UUID_V4.test(requestId)) errors.form = "انتهت صلاحية نموذج الإدخال. افتح نموذجًا جديدًا.";

  const sku = latinDigits(cleanText(raw.sku)).toUpperCase();
  if (sku && !/^[A-Z0-9][A-Z0-9._/-]{0,39}$/.test(sku)) {
    errors.sku = "استخدم حتى 40 حرفًا إنجليزيًا أو رقمًا، ويمكن استخدام - أو / أو . أو _.";
  }
  const nameAr = cleanText(raw.nameAr);
  if (!nameAr || !validText(nameAr, 180)) errors.nameAr = "أدخل اسم الصنف، بحد أقصى 180 حرفًا ودون رموز تحكم.";

  const category = PRODUCT_CATEGORIES.includes(raw.category as ProductCategoryInput)
    ? (raw.category as ProductCategoryInput)
    : null;
  if (!category) errors.category = "اختر تصنيف الصنف.";
  const brand = cleanText(raw.brand);
  const model = cleanText(raw.model);
  if (!validText(brand, 80)) errors.brand = "العلامة التجارية يجب ألا تتجاوز 80 حرفًا.";
  if (!validText(model, 80)) errors.model = "الموديل يجب ألا يتجاوز 80 حرفًا.";

  const purchaseCost = decimalString(raw.purchaseCost, 14, 2);
  const salePrice = decimalString(raw.salePrice, 14, 2);
  if (purchaseCost === null) errors.purchaseCost = "أدخل تكلفة شراء غير سالبة، حتى منزلتين عشريتين.";
  if (salePrice === null) errors.salePrice = "أدخل سعر بيع غير سالب، حتى منزلتين عشريتين.";

  const taxText = latinDigits(raw.taxRateId.trim());
  const taxRateId = taxText === "" ? null : (/^[1-9]\d{0,9}$/.test(taxText) && Number(taxText) <= 2147483647 ? Number(taxText) : NaN);
  if (taxRateId !== null && !Number.isInteger(taxRateId)) errors.taxRateId = "اختر معدل ضريبة صحيحًا أو اتركه غير محدد.";
  if (category === "SERVICE" && raw.isSerialized) errors.isSerialized = "الخدمة لا تُسجّل لها أرقام تسلسلية في المخزون.";

  if (Object.keys(errors).length || !category || purchaseCost === null || salePrice === null) return { ok: false, errors };
  return {
    ok: true,
    value: {
      requestId,
      sku: sku || null,
      nameAr,
      category,
      brand: brand || null,
      model: model || null,
      purchaseCost,
      salePrice,
      taxRateId,
      isSerialized: category === "HEARING_AID" || (category !== "SERVICE" && raw.isSerialized),
    },
  };
}

export function parseOpeningInput(raw: OpeningInputRaw, needsSerials: boolean): ValidationResult<OpeningInput> {
  const errors: FieldErrors = {};
  const requestId = raw.requestId.trim().toLowerCase();
  if (!UUID_V4.test(requestId)) errors.form = "انتهت صلاحية نموذج الإدخال. افتح نموذجًا جديدًا.";
  const productId = positiveDatabaseId(raw.productId);
  const warehouseId = positiveDatabaseId(raw.warehouseId);
  if (!productId) errors.productId = "اختر صنفًا متاحًا.";
  if (!warehouseId) errors.warehouseId = "اختر مستودعًا متاحًا.";
  const quantity = decimalString(raw.quantity, 12, 2);
  const unitCost = decimalString(raw.unitCost, 14, 4);
  if (quantity === null || !/[1-9]/.test(quantity)) errors.quantity = "أدخل كمية أكبر من صفر، حتى منزلتين عشريتين.";
  if (unitCost === null) errors.unitCost = "أدخل تكلفة وحدة غير سالبة، حتى أربع منازل عشرية.";

  const serials: { number: string; key: string }[] = [];
  if (raw.serialNumbers.length > MAX_SERIALS_PER_OPENING * 83) {
    errors.serialNumbers = `يمكن تسجيل حتى ${MAX_SERIALS_PER_OPENING} رقم في الرصيد الواحد.`;
  } else {
    for (const line of raw.serialNumbers.split(/\r?\n/)) {
      const number = cleanText(line);
      if (!number) continue;
      const key = latinDigits(number).toUpperCase();
      if (!validText(number, 80) || !validText(key, 80)) {
        errors.serialNumbers = "كل رقم تسلسلي يجب ألا يتجاوز 80 حرفًا وألا يحتوي رموز تحكم.";
        break;
      }
      serials.push({ number, key });
      if (serials.length > MAX_SERIALS_PER_OPENING) {
        errors.serialNumbers = `يمكن تسجيل حتى ${MAX_SERIALS_PER_OPENING} رقم في الرصيد الواحد.`;
        break;
      }
    }
  }

  if (new Set(serials.map((serial) => serial.key)).size !== serials.length) {
    errors.serialNumbers = "يوجد رقم تسلسلي مكرر في القائمة، حتى مع اختلاف حالة الأحرف.";
  }
  if (!needsSerials && serials.length) errors.serialNumbers = "هذا الصنف لا يتطلب أرقامًا تسلسلية؛ امسح الأرقام المدخلة.";
  if (needsSerials && quantity !== null && /[1-9]/.test(quantity)) {
    if (quantity.includes(".")) {
      errors.quantity = "كمية الصنف ذي الأرقام التسلسلية يجب أن تكون عددًا صحيحًا.";
    } else if (BigInt(quantity) > BigInt(MAX_SERIALS_PER_OPENING)) {
      errors.quantity = `يمكن تسجيل حتى ${MAX_SERIALS_PER_OPENING} جهاز في الرصيد الواحد.`;
    } else if (BigInt(quantity) !== BigInt(serials.length) && !errors.serialNumbers) {
      errors.serialNumbers = "أدخل رقمًا تسلسليًا واحدًا لكل جهاز، كل رقم في سطر.";
    }
  }

  if (Object.keys(errors).length || !productId || !warehouseId || quantity === null || unitCost === null) return { ok: false, errors };
  return { ok: true, value: { requestId, productId, warehouseId, quantity, unitCost, serials } };
}
