import { emailSchema, newPasswordSchema } from "./auth-validation";

/**
 * Pure rules for the branch/user directory screens. They are kept out of the
 * server action so they can be tested without a database or a session, and so
 * the action stays a thin, auditable wrapper around them.
 */

export type AdminRole = "MANAGER" | "ACCOUNTANT" | "CS_AGENT";

export const ADMIN_ROLES: readonly AdminRole[] = ["MANAGER", "ACCOUNTANT", "CS_AGENT"] as const;

export const ROLE_LABELS: Record<AdminRole, string> = {
  MANAGER: "مدير",
  ACCOUNTANT: "محاسب",
  CS_AGENT: "موظف فرع",
};

export function isAdminRole(value: string): value is AdminRole {
  return (ADMIN_ROLES as readonly string[]).includes(value);
}

/**
 * حوكمة الصلاحيات الصارمة في شاشة الإدارة:
 * - المدير العام (MANAGER) وحده ينشئ الفروع أو يعيد تسميتها أو يوقفها/يفعّلها.
 * - المدير العام يدير جميع الأدوار (MANAGER / ACCOUNTANT / CS_AGENT).
 * - المحاسب (ACCOUNTANT) يستطيع إدارة حسابات موظفي الفروع (CS_AGENT) فقط،
 *   ولا يملك إنشاء أو تعديل أو تصفير كلمة مرور أو إنهاء جلسات مدير أو محاسب آخر.
 */
export function canManageBranchStructure(actorRole: string): boolean {
  return actorRole === "MANAGER";
}

export function canManageTargetUser(actorRole: string, targetRole: string): boolean {
  if (actorRole === "MANAGER") return isAdminRole(targetRole);
  if (actorRole === "ACCOUNTANT") return targetRole === "CS_AGENT";
  return false;
}

export function assignableRolesForActor(actorRole: string): readonly AdminRole[] {
  if (actorRole === "MANAGER") return ADMIN_ROLES;
  if (actorRole === "ACCOUNTANT") return ["CS_AGENT"];
  return [];
}

export function normalizeBranchCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function normalizeInvoicePrefix(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function normalizeName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export function normalizePhone(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export function phoneInputError(raw?: string | null): string | null {
  const cleaned = normalizePhone(raw ?? "");
  if (!cleaned) return null;
  if (cleaned.length > 30) return "رقم الهاتف: 30 خانة على الأكثر.";
  if (!/^[0-9+\-() ]{6,30}$/.test(cleaned)) {
    return "رقم الهاتف: استخدم الأرقام وعلامات (+ - ) فقط (6 خانات على الأقل).";
  }
  return null;
}

export type BranchInput = {
  code: string;
  nameAr: string;
  city: string;
  invoicePrefix: string;
  phone?: string;
};

export function branchInputError(input: BranchInput): string | null {
  const code = normalizeBranchCode(input.code);
  if (!/^[A-Z0-9]{2,8}$/.test(code)) return "كود الفرع: حرفان إلى ثمانية، من الحروف الإنجليزية الكبيرة أو الأرقام فقط.";
  const name = normalizeName(input.nameAr);
  if (name.length < 2 || name.length > 120) return "اسم الفرع: من حرفين إلى 120 حرفًا.";
  if (normalizeName(input.city).length > 80) return "المدينة: 80 حرفًا على الأكثر.";
  const phoneErr = phoneInputError(input.phone);
  if (phoneErr) return phoneErr;
  const prefix = normalizeInvoicePrefix(input.invoicePrefix);
  if (!/^[A-Z0-9]{1,6}$/.test(prefix)) return "بادئة الفاتورة: حرف إلى ستة، من الحروف الإنجليزية الكبيرة أو الأرقام فقط.";
  return null;
}

export type UserInput = {
  fullName: string;
  email: string;
  password?: string;
  role: string;
  branchId: string;
  phone?: string;
};

/** `requirePassword` is false when editing an existing user without touching the password. */
export function userInputError(input: UserInput, options: { requirePassword: boolean }): string | null {
  const name = normalizeName(input.fullName);
  if (name.length < 3 || name.length > 120) return "الاسم: من ثلاثة أحرف إلى 120 حرفًا.";
  const email = emailSchema.safeParse(input.email);
  if (!email.success) return email.error.issues[0]?.message ?? "أدخل بريدًا إلكترونيًا صحيحًا.";
  const phoneErr = phoneInputError(input.phone);
  if (phoneErr) return phoneErr;
  if (options.requirePassword) {
    const password = newPasswordSchema.safeParse(input.password ?? "");
    if (!password.success) return password.error.issues[0]?.message ?? "كلمة المرور غير مقبولة.";
  }
  if (!isAdminRole(input.role)) return "الدور غير معروف.";
  if (input.role === "CS_AGENT" && !isIdentifier(input.branchId)) {
    return "موظف الفرع يجب أن يكون منسوبًا إلى فرع.";
  }
  if (input.role !== "CS_AGENT" && input.branchId.trim() !== "" && !isIdentifier(input.branchId)) {
    return "الفرع المختار غير صحيح.";
  }
  return null;
}

export function isIdentifier(value: string): boolean {
  return /^[1-9]\d{0,18}$/.test(value.trim());
}
