import { z } from "zod";

// bcrypt لا يستخدم أكثر من 72 بايت من كلمة المرور، بما فيها أحرف UTF-8.
export const MAX_PASSWORD_BYTES = 72;
export const MIN_NEW_PASSWORD_LENGTH = 12;

export function passwordByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export const emailSchema = z.string()
  .trim()
  .max(160, "البريد الإلكتروني أطول من المسموح.")
  .email("أدخل بريدًا إلكترونيًا صحيحًا.")
  .transform((value) => value.toLowerCase());

const currentPasswordSchema = z.string()
  .min(1, "أدخل كلمة المرور.")
  .refine((value) => passwordByteLength(value) <= MAX_PASSWORD_BYTES, "كلمة المرور أطول من المسموح (72 بايت).");

export const newPasswordSchema = z.string()
  .refine((value) => Array.from(value).length >= MIN_NEW_PASSWORD_LENGTH, "استخدم 12 حرفًا على الأقل.")
  .refine((value) => passwordByteLength(value) <= MAX_PASSWORD_BYTES, "كلمة المرور أطول من المسموح (72 بايت).");

export const loginSchema = z.object({
  email: emailSchema,
  password: currentPasswordSchema,
  remember: z.boolean(),
});

export const changePasswordSchema = z.object({
  currentPassword: currentPasswordSchema,
  newPassword: newPasswordSchema,
  confirmPassword: z.string(),
}).superRefine((values, context) => {
  if (values.newPassword !== values.confirmPassword) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["confirmPassword"], message: "كلمتا المرور غير متطابقتين." });
  }
  if (values.currentPassword === values.newPassword && values.currentPassword) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["newPassword"], message: "اختر كلمة مرور مختلفة عن الحالية." });
  }
});

/** لا نسمح بالخروج إلى موقع آخر أو بمسارات ملتبسة/حلقات إعادة التوجيه. */
export function safeNextPath(value: unknown, fallback = "/dashboard"): string {
  if (typeof value !== "string" || value.length > 2048 || !value.startsWith("/") || value.startsWith("//")) return fallback;
  if (/[\\\u0000-\u001f\u007f]/.test(value) || /%2f|%5c/i.test(value)) return fallback;
  // نرفض الترميز المزدوج في المسار حتى لا تحوّله طبقة وسيطة إلى / أو \\.
  if (/%25/i.test(value.split(/[?#]/, 1)[0])) return fallback;

  try {
    const base = "https://selahtone.invalid";
    const url = new URL(value, base);
    // مثل /a/..//evil.example يتحول بعد التطبيع إلى //evil.example.
    if (url.origin !== base || url.pathname.startsWith("//")) return fallback;
    const path = url.pathname.replace(/\/+$/, "").toLowerCase();
    if (path === "/login" || path === "/change-password" || path === "/api" || path.startsWith("/api/")) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
