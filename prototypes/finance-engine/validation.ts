import { decimalString, latinDigits, positiveDatabaseId } from "../../src/lib/inventory-validation";
import { scaledInteger } from "../../src/lib/inventory-math";
import { FinanceProblem, type AccountKind, type Method } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BAD_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/u;
const METHODS: Method[] = ["CASH", "CARD", "BANK_TRANSFER", "WALLET"];
export type Input = Record<string, unknown>;
function fail(message: string): never { throw new FinanceProblem("invalid_input", message); }
export function inputObject(value: unknown): Input {
  if (typeof value !== "object" || !value || Array.isArray(value)) return fail("بيانات العملية غير صالحة.");
  return value as Input;
}
export function identifier(value: unknown, label = "المعرّف"): string {
  const id = typeof value === "string" ? positiveDatabaseId(value) : null;
  return id ?? fail(`${label} غير صالح.`);
}
export function optionalIdentifier(value: unknown, label = "المعرّف"): string | null {
  return value === null || value === undefined || value === "" ? null : identifier(value, label);
}
export function requestId(value: unknown): string {
  const id = typeof value === "string" ? value.trim().toLowerCase() : "";
  return UUID.test(id) ? id : fail("معرّف الطلب غير صالح؛ افتح نموذجًا جديدًا.");
}
export function text(value: unknown, label: string, max: number, required = false): string | null {
  if ((value === null || value === undefined || value === "") && !required) return null;
  if (typeof value !== "string") return fail(`${label} غير صالح.`);
  const v = value.normalize("NFKC").trim();
  if ((required && !v) || v.length > max || BAD_TEXT.test(v)) return fail(`أدخل ${label} صحيحًا بحد أقصى ${max} حرفًا.`);
  return v || null;
}
export function money(value: unknown, label: string, allowZero = false): string {
  const result = typeof value === "string" ? decimalString(value, 14, 2) : null;
  if (result === null || (!allowZero && scaledInteger(result, 2) === 0n)) return fail(`${label}: أدخل مبلغًا ${allowZero ? "غير سالب" : "أكبر من صفر"} بحد أقصى منزلتين عشريتين.`);
  return result;
}
export function optionalMoney(value: unknown, label: string): string | null {
  return value === null || value === undefined || (typeof value === "string" && !value.trim()) ? null : money(value, label, true);
}
export function signedMoney(value: unknown, label: string): string {
  if (typeof value !== "string") return fail(`${label} غير صالح.`);
  const v = latinDigits(value.trim()).replace(/٫/g, ".").replace(/^−/, "-");
  const negative = v.startsWith("-");
  const amount = decimalString(negative ? v.slice(1) : v, 22, 2);
  if (amount === null) return fail(`${label} غير صالح.`);
  return negative && scaledInteger(amount, 2) !== 0n ? `-${amount}` : amount;
}
export function exactCents(value: string): bigint { return scaledInteger(value, 2); }
export function date(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return fail(`${label} غير صالح.`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) return fail(`${label} غير صالح.`);
  return value;
}
export function revision(value: unknown): number {
  if (typeof value !== "string" || !/^[1-9]\d{0,8}$/.test(value)) return fail("إصدار السجل غير صالح؛ افتح الصفحة من جديد.");
  return Number(value);
}
/** Canonical snapshot of the open invoice cases and their note revisions.
 * The UI freezes it at review time; it is not evidence that facts are true. */
export function caseSnapshot(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string" || value.length > 8192) return fail("قائمة الحالات المراجَعة غير صالحة؛ افتح الفاتورة مجددًا.");
  const parts=value.split(",");
  if (parts.length > 200) return fail("عدد الحالات المعلقة كبير؛ راجعها وأغلق ما انتهى منها أولًا.");
  const entries=parts.map(part=>{
    const pieces=part.split(":");
    if (pieces.length!==2) return fail("قائمة الحالات المراجَعة غير صالحة.");
    return { id:identifier(pieces[0],"الحالة"), version:revision(pieces[1]) };
  });
  if (new Set(entries.map(e=>e.id)).size!==entries.length) return fail("تكررت حالة في قائمة المراجعة.");
  return entries.sort((a,b)=>BigInt(a.id)<BigInt(b.id)?-1:BigInt(a.id)>BigInt(b.id)?1:0).map(e=>`${e.id}:${e.version}`).join(",");
}
export function method(value: unknown): Method {
  return METHODS.includes(value as Method) ? value as Method : fail("اختر وسيلة دفع صالحة.");
}
export function kind(value: unknown): AccountKind {
  return value === "VAULT" || value === "CUSTODY" ? value : fail("اختر نوع الحساب النقدي.");
}
export function confirmation(value: unknown, label: string): true {
  return value === true ? true : fail(`أكد ${label} أولًا.`);
}
export function flag(value: unknown): boolean {
  if (value !== undefined && typeof value !== "boolean") return fail("قيمة التأكيد غير صالحة.");
  return value === true;
}
export function openingOrder(value: unknown): "BEFORE" | "AFTER" | null {
  if (value === undefined || value === null || value === "") return null;
  return value === "BEFORE" || value === "AFTER" ? value : fail("حدد هل الدفع قبل الجرد أم بعده.");
}
export function formatCents(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? "-" : ""}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, "0")}`;
}
export function cairoDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (key: string) => parts.find((part) => part.type === key)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
