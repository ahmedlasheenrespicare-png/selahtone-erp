import { decimalString, latinDigits, positiveDatabaseId, type FieldErrors, type ValidationResult } from "./inventory-validation";
import { scaledInteger } from "./inventory-math";

export const PAYMENT_METHODS = ["CASH", "CARD", "BANK_TRANSFER", "WALLET"] as const;
export type PaymentMethod = typeof PAYMENT_METHODS[number];
export const MAX_SALE_LINES = 50;
export const MAX_SALE_SERIALS = 1000;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BAD_TEXT = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/u;

type UnknownRecord = Record<string, unknown>;
function object(value: unknown): UnknownRecord | null { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as UnknownRecord : null; }
function string(value: unknown): string { return typeof value === "string" ? value : ""; }
function requestId(value: unknown): string | null { const v = string(value).trim().toLowerCase(); return UUID_V4.test(v) ? v : null; }
function id(value: unknown): string | null { return positiveDatabaseId(string(value)); }
function method(value: unknown): PaymentMethod | null { return PAYMENT_METHODS.includes(value as PaymentMethod) ? value as PaymentMethod : null; }
function positiveDecimal(value: unknown, precision: number, scale: number): string | null {
  const v = decimalString(string(value), precision, scale);
  return v !== null && /[1-9]/.test(v) ? v : null;
}
function serialIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_SALE_SERIALS) return null;
  const ids = value.map(id);
  if (ids.some((item) => !item) || new Set(ids).size !== ids.length) return null;
  return (ids as string[]).sort((a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);
}
function sortIds<T>(array: T[], getId: (item: T) => string): T[] {
  return array.sort((a, b) => BigInt(getId(a)) < BigInt(getId(b)) ? -1 : BigInt(getId(a)) > BigInt(getId(b)) ? 1 : 0);
}

export type SaleLineInput = {
  productId: string; quantity: string; serialIds: string[];
  expectedUnitPrice: string; expectedTaxRateId: number; expectedTaxKind: string; expectedTaxRate: string;
};
export type SaleInput = {
  requestId: string; warehouseId: string; customerName: string; customerPhone: string;
  discount: string; initialPayment: string; method: PaymentMethod; lines: SaleLineInput[];
};

/** Validate untrusted client data. Server always reloads stock, prices and tax data. */
export function parseSaleInput(raw: unknown): ValidationResult<SaleInput> {
  const input = object(raw);
  if (!input) return { ok: false, errors: { form: "بيانات البيع غير صالحة." } };
  const errors: FieldErrors = {};
  const request = requestId(input.requestId);
  const warehouseId = id(input.warehouseId);
  if (!request) errors.form = "انتهت صلاحية النموذج. افتح نموذج بيع جديدًا.";
  if (!warehouseId) errors.warehouseId = "اختر مستودعًا متاحًا.";
  const customerName = string(input.customerName).normalize("NFKC").trim();
  const customerPhone = latinDigits(string(input.customerPhone).normalize("NFKC").trim());
  if (!customerName || customerName.length > 180 || BAD_TEXT.test(customerName)) errors.customerName = "أدخل اسم العميل، بحد أقصى 180 حرفًا ودون رموز تحكم.";
  if (!customerPhone || customerPhone.length > 30 || !/^\+?[0-9() -]+$/.test(customerPhone) || (customerPhone.match(/[0-9]/g)?.length ?? 0) < 5) errors.customerPhone = "أدخل رقم هاتف صالحًا للعميل.";
  const discount = decimalString(string(input.discount), 14, 2);
  const initialPayment = positiveDecimal(input.initialPayment, 14, 2);
  const paymentMethod = method(input.method);
  if (discount === null) errors.discount = "أدخل خصمًا غير سالب بحد أقصى منزلتين عشريتين.";
  if (initialPayment === null) errors.initialPayment = "أدخل دفعة أولى أكبر من صفر بحد أقصى منزلتين عشريتين.";
  if (!paymentMethod) errors.method = "اختر وسيلة دفع متاحة.";
  const lines: SaleLineInput[] = [];
  if (!Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > MAX_SALE_LINES) {
    errors.lines = `أضف من صنف واحد إلى ${MAX_SALE_LINES} صنفًا كحد أقصى.`;
  } else {
    for (const value of input.lines) {
      const line = object(value);
      const productId = id(line?.productId);
      const quantity = positiveDecimal(line?.quantity, 12, 2);
      const ids = serialIds(line?.serialIds);
      const expectedUnitPrice = decimalString(string(line?.expectedUnitPrice), 14, 2);
      const taxValue = line?.expectedTaxRateId;
      const taxText = positiveDatabaseId(typeof taxValue === "number" && Number.isSafeInteger(taxValue) ? String(taxValue) : string(taxValue));
      const expectedTaxRateId = taxText && BigInt(taxText) <= 2147483647n ? Number(taxText) : null;
      const expectedTaxKind = string(line?.expectedTaxKind);
      const expectedTaxRate = decimalString(string(line?.expectedTaxRate), 6, 3);
      if (!productId || !quantity || !ids || expectedUnitPrice === null || expectedTaxRateId === null || !["VAT", "SCHEDULE", "EXEMPT"].includes(expectedTaxKind) || expectedTaxRate === null) {
        errors.lines = "راجع الأصناف والكمية والسيريالات والضريبة قبل البيع.";
        break;
      }
      lines.push({ productId, quantity, serialIds: ids, expectedUnitPrice, expectedTaxRateId, expectedTaxKind, expectedTaxRate });
    }
  }
  if (new Set(lines.map((line) => line.productId)).size !== lines.length) errors.lines = "لا تكرر الصنف في الفاتورة؛ اجمع الكمية في بند واحد.";
  const allSerials = lines.flatMap((line) => line.serialIds);
  if (allSerials.length > MAX_SALE_SERIALS || new Set(allSerials).size !== allSerials.length) errors.lines = "السيريالات مكررة أو يتجاوز عددها الحد المسموح.";
  if (Object.keys(errors).length || !request || !warehouseId || discount === null || initialPayment === null || !paymentMethod) return { ok: false, errors };
  return { ok: true, value: { requestId: request, warehouseId, customerName, customerPhone, discount, initialPayment, method: paymentMethod, lines: sortIds(lines, (line) => line.productId) } };
}

export type MoneyMovementInput = { requestId: string; saleId: string; amount: string; method: PaymentMethod; actuallyPaid: boolean };
export function parseMoneyMovement(raw: unknown, refund: boolean): ValidationResult<MoneyMovementInput> {
  const input = object(raw);
  if (!input) return { ok: false, errors: { form: "بيانات العملية غير صالحة." } };
  const errors: FieldErrors = {};
  const request = requestId(input.requestId);
  const saleId = id(input.saleId);
  const amount = positiveDecimal(input.amount, 14, 2);
  const paymentMethod = method(input.method);
  const actuallyPaid = input.actuallyPaid === true;
  if (!request || !saleId) errors.form = "الطلب أو الفاتورة غير صالحين.";
  if (!amount) errors.amount = "أدخل مبلغًا أكبر من صفر بحد أقصى منزلتين عشريتين.";
  if (!paymentMethod) errors.method = "اختر وسيلة الدفع.";
  if (refund && !actuallyPaid) errors.actuallyPaid = "أكّد دفع المبلغ للعميل فعليًا قبل تسجيل الرد.";
  if (Object.keys(errors).length || !request || !saleId || !amount || !paymentMethod) return { ok: false, errors };
  return { ok: true, value: { requestId: request, saleId, amount, method: paymentMethod, actuallyPaid } };
}

export type ReturnLineInput = { saleLineId: string; quantity: string; serialIds: string[] };
export type ReturnInput = { requestId: string; saleId: string; cancel: boolean; accepted: true; lines: ReturnLineInput[] };
export function parseReturnInput(raw: unknown): ValidationResult<ReturnInput> {
  const input = object(raw);
  if (!input) return { ok: false, errors: { form: "بيانات المرتجع غير صالحة." } };
  const errors: FieldErrors = {};
  const request = requestId(input.requestId);
  const saleId = id(input.saleId);
  if (!request || !saleId || typeof input.cancel !== "boolean") errors.form = "الطلب أو الفاتورة غير صالحين.";
  const cancel = input.cancel === true;
  if (input.accepted !== true) errors.accepted = "أكّد قبول البنود المرتجعة قبل إعادتها للمخزون.";
  const lines: ReturnLineInput[] = [];
  if (!Array.isArray(input.lines) || input.lines.length > MAX_SALE_LINES || (cancel && input.lines.length > 0) || (!cancel && input.lines.length === 0)) {
    errors.lines = "اختر بنودًا للمرتجع، أو اختر الإلغاء الكامل دون تحديد بنود.";
  } else {
    for (const value of input.lines) {
      const line = object(value);
      const saleLineId = id(line?.saleLineId);
      const quantity = positiveDecimal(line?.quantity, 12, 2);
      const ids = serialIds(line?.serialIds);
      if (!saleLineId || !quantity || !ids) { errors.lines = "راجع كميات المرتجع والأرقام المختارة."; break; }
      lines.push({ saleLineId, quantity, serialIds: ids });
    }
  }
  if (new Set(lines.map((line) => line.saleLineId)).size !== lines.length) errors.lines = "لا تكرر البند في المرتجع.";
  const allSerials = lines.flatMap((line) => line.serialIds);
  if (allSerials.length > MAX_SALE_SERIALS || new Set(allSerials).size !== allSerials.length) errors.lines = "الأرقام التسلسلية مكررة أو يتجاوز عددها الحد المسموح.";
  if (Object.keys(errors).length || !request || !saleId) return { ok: false, errors };
  return { ok: true, value: { requestId: request, saleId, cancel, accepted: true, lines: sortIds(lines, (line) => line.saleLineId) } };
}

export type DiscountSettingInput = { requestId: string; basisPoints: number };
export function parseDiscountSetting(raw: unknown): ValidationResult<DiscountSettingInput> {
  const input = object(raw);
  const request = requestId(input?.requestId);
  const percent = decimalString(string(input?.percent), 5, 2);
  if (!request || percent === null) return { ok: false, errors: { percent: "أدخل نسبة من 0 إلى 100 حتى منزلتين عشريتين." } };
  const basisPoints = scaledInteger(percent, 2);
  if (basisPoints > 10000n) return { ok: false, errors: { percent: "أدخل نسبة من 0 إلى 100." } };
  return { ok: true, value: { requestId: request, basisPoints: Number(basisPoints) } };
}
