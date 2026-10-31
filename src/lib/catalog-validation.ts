import { decimalString, latinDigits, positiveDatabaseId, type FieldErrors, type ValidationResult } from "./inventory-validation";
import { PAYMENT_METHODS, type PaymentMethod } from "./commerce-validation";

/**
 * تحقق مدخلات البيع بالأصناف الفنية، قبل أي وصول إلى قاعدة البيانات.
 *
 * الفرق الجوهري عن مسار البيع القديم: لا منتج ولا مستودع ولا سيريال ولا ضريبة.
 * الموظف يختار تصنيفًا ثم نوعًا، ويكتب الكمية والسعر بنفسه، ويملأ الحقول
 * النصية التي يطلبها النوع (مثل «نوع السماعة» و«بيان الحالة»).
 */
export const MAX_CATALOG_LINES = 50;
export const MAX_CATALOG_DETAILS = 20;
export const MAX_DETAIL_LENGTH = 300;
export const MAX_CATALOG_NAME = 120;
export const MAX_CATALOG_REASON = 300;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIELD_KEY = /^[a-z0-9_]{2,60}$/;
const CATEGORY_CODE = /^[A-Z0-9_]{2,40}$/;
const BAD_TEXT = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/u;

type UnknownRecord = Record<string, unknown>;
function object(value: unknown): UnknownRecord | null { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as UnknownRecord : null; }
function string(value: unknown): string { return typeof value === "string" ? value : ""; }
function requestId(value: unknown): string | null { const v = string(value).trim().toLowerCase(); return UUID_V4.test(v) ? v : null; }
function id(value: unknown): string | null { return positiveDatabaseId(string(value)); }
function method(value: unknown): PaymentMethod | null { return PAYMENT_METHODS.includes(value as PaymentMethod) ? value as PaymentMethod : null; }
function cleanText(value: unknown, max: number): string | null {
  const v = string(value).normalize("NFKC").trim();
  if (!v || v.length > max || BAD_TEXT.test(v)) return null;
  return v;
}
function detailText(value: unknown, max: number): string | null {
  const v = string(value).normalize("NFKC").trim();
  if (v.length > max || BAD_TEXT.test(v)) return null;
  return v;
}
function positiveDecimal(value: unknown, precision: number, scale: number): string | null {
  const v = decimalString(string(value), precision, scale);
  return v !== null && /[1-9]/.test(v) ? v : null;
}
function sortOrder(value: unknown): number | null {
  const v = value === undefined || value === null || value === "" ? 0 : Number(value);
  return Number.isSafeInteger(v) && v >= 0 && v <= 1_000_000 ? v : null;
}

export type CatalogDetailInput = { key: string; value: string };
export type CatalogSaleLineInput = { typeId: string; quantity: string; unitPrice: string; details: CatalogDetailInput[] };
export type CatalogSaleInput = {
  requestId: string; branchId: string; customerName: string; customerPhone: string;
  discount: string; initialPayment: string; method: PaymentMethod; lines: CatalogSaleLineInput[];
};

/** Validate untrusted client data. Server always reloads the catalog and prices. */
export function parseCatalogSaleInput(raw: unknown): ValidationResult<CatalogSaleInput> {
  const input = object(raw);
  if (!input) return { ok: false, errors: { form: "بيانات البيع غير صالحة." } };
  const errors: FieldErrors = {};
  const request = requestId(input.requestId);
  const branchId = id(input.branchId);
  if (!request) errors.form = "انتهت صلاحية النموذج. افتح نموذج بيع جديدًا.";
  if (!branchId) errors.branchId = "اختر الفرع.";
  const customerName = cleanText(input.customerName, 180);
  const customerPhone = latinDigits(string(input.customerPhone).normalize("NFKC").trim());
  if (!customerName) errors.customerName = "أدخل اسم العميل، بحد أقصى 180 حرفًا ودون رموز تحكم.";
  if (!customerPhone || customerPhone.length > 30 || !/^\+?[0-9() -]+$/.test(customerPhone) || (customerPhone.match(/[0-9]/g)?.length ?? 0) < 5) errors.customerPhone = "أدخل رقم هاتف صالحًا للعميل.";
  const discount = decimalString(string(input.discount), 14, 2);
  const initialPayment = positiveDecimal(input.initialPayment, 14, 2);
  const paymentMethod = method(input.method);
  if (discount === null) errors.discount = "أدخل خصمًا غير سالب بحد أقصى منزلتين عشريتين.";
  if (initialPayment === null) errors.initialPayment = "أدخل دفعة أولى أكبر من صفر بحد أقصى منزلتين عشريتين.";
  if (!paymentMethod) errors.method = "اختر وسيلة دفع متاحة.";

  const lines: CatalogSaleLineInput[] = [];
  if (!Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > MAX_CATALOG_LINES) {
    errors.lines = `أضف من بند واحد إلى ${MAX_CATALOG_LINES} بندًا كحد أقصى.`;
  } else {
    for (const value of input.lines) {
      const line = object(value);
      const typeId = id(line?.typeId);
      const quantity = positiveDecimal(line?.quantity, 12, 2);
      // سعر الوحدة يكتبه الموظف بنفسه: موجب وبحد أقصى منزلتين عشريتين.
      const unitPrice = positiveDecimal(line?.unitPrice, 14, 2);
      const details: CatalogDetailInput[] = [];
      const rawDetails = line?.details;
      if (!Array.isArray(rawDetails) || rawDetails.length > MAX_CATALOG_DETAILS) {
        errors.lines = "بيانات البند غير صالحة."; break;
      }
      let broken = false;
      for (const entry of rawDetails) {
        const item = object(entry);
        const key = string(item?.key).trim().toLowerCase();
        // قيمة الحقل قد تكون فارغة: الخادم هو من يقرر لزومها ويرد برسالة واضحة.
        const detailValue = detailText(item?.value, MAX_DETAIL_LENGTH);
        if (!FIELD_KEY.test(key) || detailValue === null) { broken = true; break; }
        details.push({ key, value: detailValue });
      }
      if (broken || !typeId || quantity === null || unitPrice === null) {
        errors.lines = "راجع الصنف والكمية والسعر والحقول المطلوبة قبل الحفظ."; break;
      }
      if (new Set(details.map((detail) => detail.key)).size !== details.length) { errors.lines = "حقل مكرر داخل البند."; break; }
      lines.push({ typeId, quantity, unitPrice, details });
    }
  }
  // تكرار النوع مسموح بكميات مختلفة: يجمعه الخادم في بند واحد لكل نوع.
  if (Object.keys(errors).length || !request || !branchId || discount === null || initialPayment === null || !paymentMethod) return { ok: false, errors };
  return { ok: true, value: { requestId: request, branchId, customerName: customerName!, customerPhone, discount, initialPayment, method: paymentMethod, lines } };
}

export type CatalogNameInput = { requestId: string; nameAr: string; sortOrder: number; code?: string };
export type CatalogIdInput = { requestId: string; id: string; nameAr?: string; sortOrder?: number };
export type CatalogActiveInput = { requestId: string; id: string; active: boolean; reason: string };
export type CatalogTypeCreateInput = { requestId: string; categoryId: string; nameAr: string; sortOrder: number };
export type CatalogFieldInput = {
  requestId: string; typeId: string; fieldKey: string; labelAr: string; isRequired: boolean; sortOrder: number;
};
export type CatalogFieldUpdateInput = {
  requestId: string; id: string; labelAr: string; isRequired: boolean; sortOrder: number;
};

/** إدارة الأصناف: كل تغيير بسبب واضح، والاسم مطلوب دائمًا. */
export function parseCatalogName(raw: unknown, withCode = false): ValidationResult<CatalogNameInput> {
  const input = object(raw);
  const request = requestId(input?.requestId);
  const nameAr = cleanText(input?.nameAr, MAX_CATALOG_NAME);
  const order = sortOrder(input?.sortOrder);
  const code = withCode ? string(input?.code).trim().toUpperCase() : undefined;
  if (!input || !request) return { ok: false, errors: { form: "انتهت صلاحية النموذج. أعد فتح الشاشة." } };
  if (!nameAr) return { ok: false, errors: { nameAr: `أدخل اسمًا بحد أقصى ${MAX_CATALOG_NAME} حرفًا.` } };
  if (order === null) return { ok: false, errors: { sortOrder: "ترتيب العرض غير صالح." } };
  if (withCode && !CATEGORY_CODE.test(code ?? "")) return { ok: false, errors: { code: "رمز التصنيف: حروف كبيرة وأرقام وشرطة سفلية فقط." } };
  return { ok: true, value: withCode ? { requestId: request, nameAr, sortOrder: order!, code } : { requestId: request, nameAr, sortOrder: order! } };
}

export function parseCatalogTypeCreate(raw: unknown): ValidationResult<CatalogTypeCreateInput> {
  const input = object(raw);
  const request = requestId(input?.requestId);
  const categoryId = id(input?.categoryId);
  const nameAr = cleanText(input?.nameAr, MAX_CATALOG_NAME);
  const order = sortOrder(input?.sortOrder);
  if (!request || !categoryId) return { ok: false, errors: { form: "انتهت صلاحية النموذج. أعد فتح الشاشة." } };
  if (!nameAr) return { ok: false, errors: { nameAr: `أدخل اسمًا بحد أقصى ${MAX_CATALOG_NAME} حرفًا.` } };
  if (order === null) return { ok: false, errors: { sortOrder: "ترتيب العرض غير صالح." } };
  return { ok: true, value: { requestId: request, categoryId, nameAr, sortOrder: order } };
}

export function parseCatalogId(raw: unknown): ValidationResult<CatalogIdInput> {
  const input = object(raw);
  const request = requestId(input?.requestId);
  const value = id(input?.id);
  const nameAr = cleanText(input?.nameAr, MAX_CATALOG_NAME);
  const order = sortOrder(input?.sortOrder);
  if (!request || !value) return { ok: false, errors: { form: "انتهت صلاحية النموذج. أعد فتح الشاشة." } };
  if (!nameAr) return { ok: false, errors: { nameAr: `أدخل اسمًا بحد أقصى ${MAX_CATALOG_NAME} حرفًا.` } };
  if (order === null) return { ok: false, errors: { sortOrder: "ترتيب العرض غير صالح." } };
  return { ok: true, value: { requestId: request, id: value, nameAr, sortOrder: order } };
}

export function parseCatalogActive(raw: unknown): ValidationResult<CatalogActiveInput> {
  const input = object(raw);
  const request = requestId(input?.requestId);
  const value = id(input?.id);
  const active = input?.active === true;
  const reason = cleanText(input?.reason, MAX_CATALOG_REASON);
  if (!request || !value) return { ok: false, errors: { form: "انتهت صلاحية النموذج. أعد فتح الشاشة." } };
  if (!reason) return { ok: false, errors: { reason: `اكتب سبب التغيير بحد أقصى ${MAX_CATALOG_REASON} حرفًا.` } };
  return { ok: true, value: { requestId: request, id: value, active, reason } };
}

export function parseCatalogField(raw: unknown): ValidationResult<CatalogFieldInput> {
  const input = object(raw);
  const request = requestId(input?.requestId);
  const typeId = id(input?.typeId);
  const fieldKey = string(input?.fieldKey).trim().toLowerCase();
  const labelAr = cleanText(input?.labelAr, MAX_CATALOG_NAME);
  const isRequired = input?.isRequired !== false;
  const order = sortOrder(input?.sortOrder);
  if (!request || !typeId) return { ok: false, errors: { form: "انتهت صلاحية النموذج. أعد فتح الشاشة." } };
  if (!FIELD_KEY.test(fieldKey)) return { ok: false, errors: { fieldKey: "مفتاح الحقل: حروف صغيرة وأرقام وشرطة سفلية فقط." } };
  if (!labelAr) return { ok: false, errors: { labelAr: `أدخل عنوان الحقل بحد أقصى ${MAX_CATALOG_NAME} حرفًا.` } };
  if (order === null) return { ok: false, errors: { sortOrder: "ترتيب العرض غير صالح." } };
  return { ok: true, value: { requestId: request, typeId, fieldKey, labelAr, isRequired, sortOrder: order } };
}

export function parseCatalogFieldUpdate(raw: unknown): ValidationResult<CatalogFieldUpdateInput> {
  const input = object(raw);
  const request = requestId(input?.requestId);
  const value = id(input?.id);
  const labelAr = cleanText(input?.labelAr, MAX_CATALOG_NAME);
  const isRequired = input?.isRequired !== false;
  const order = sortOrder(input?.sortOrder);
  if (!request || !value) return { ok: false, errors: { form: "انتهت صلاحية النموذج. أعد فتح الشاشة." } };
  if (!labelAr) return { ok: false, errors: { labelAr: `أدخل عنوان الحقل بحد أقصى ${MAX_CATALOG_NAME} حرفًا.` } };
  if (order === null) return { ok: false, errors: { sortOrder: "ترتيب العرض غير صالح." } };
  return { ok: true, value: { requestId: request, id: value, labelAr, isRequired, sortOrder: order } };
}
