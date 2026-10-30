"use server";

import { revalidatePath } from "next/cache";
import { Prisma, type RoleCode, type UserStatus } from "@prisma/client";

import { canSeeAllBranches, hashPassword, requireSession, type SessionUser } from "@/lib/auth";
import { emailSchema, newPasswordSchema } from "@/lib/auth-validation";
import { isMenuScope, type MenuScope } from "@/lib/menu-scope";
import { prisma } from "@/lib/prisma";
import {
  branchInputError,
  isAdminRole,
  isIdentifier,
  normalizeBranchCode,
  normalizeInvoicePrefix,
  normalizeName,
  userInputError,
  type AdminRole,
} from "@/lib/admin-directory";
import type { AdminActionState } from "./admin-state";

/**
 * Branch and user administration for managers and accountants only.
 * Every action re-reads the actor's role from the database through the session
 * helper; nothing here trusts the browser. Passwords are hashed with bcrypt and
 * never logged, and error handlers report a code only.
 */

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}
function flag(formData: FormData, key: string): boolean {
  return text(formData, key) === "yes";
}
function rowId(value: string): bigint | null {
  return isIdentifier(value) ? BigInt(value.trim()) : null;
}
function fail(message: string): AdminActionState {
  return { status: "error", message };
}
function unexpected(error: unknown): AdminActionState {
  const code = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : "unexpected";
  console.error("Admin operation failed:", code);
  return { status: "error", message: "تعذّر التأكد من نتيجة العملية. راجع الصفحة قبل تكرار الطلب." };
}
function duplicateValue(error: unknown): AdminActionState | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return null;
  const target = Array.isArray(error.meta?.target) ? error.meta.target.map(String).join(",") : String(error.meta?.target ?? "");
  if (target.includes("email")) return fail("هذا البريد الإلكتروني مستخدم بالفعل.");
  if (target.includes("invoice_prefix")) return fail("بادئة الفواتير مستخدمة بالفعل.");
  if (target.includes("code")) return fail("هذا الكود مستخدم بالفعل.");
  return fail("القيمة المدخلة مكررة.");
}

type Guard = { session: SessionUser } | { state: AdminActionState };
async function requireAdmin(): Promise<Guard> {
  const session = await requireSession();
  if (!canSeeAllBranches(session)) return { state: fail("إدارة الفروع والمستخدمين متاحة للمدير والمحاسب فقط.") };
  return { session };
}

function revalidateDirectory(): void {
  for (const path of ["/admin", "/dashboard", "/setup", "/finance/accounts"]) {
    try {
      revalidatePath(path);
    } catch {
      console.error("Admin cache revalidation failed");
    }
  }
}

export async function createBranchAction(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const guard = await requireAdmin();
  if ("state" in guard) return guard.state;
  const input = {
    code: text(formData, "code"),
    nameAr: text(formData, "nameAr"),
    city: text(formData, "city"),
    invoicePrefix: text(formData, "invoicePrefix"),
  };
  const invalid = branchInputError(input);
  if (invalid) return fail(invalid);
  const code = normalizeBranchCode(input.code);
  const nameAr = normalizeName(input.nameAr);
  const city = normalizeName(input.city);
  const invoicePrefix = normalizeInvoicePrefix(input.invoicePrefix);
  try {
    await prisma.$transaction(async (tx) => {
      const branch = await tx.branch.create({ data: { code, nameAr, city: city || null, invoicePrefix } });
      // كل فرع جديد يحصل على مستودع افتراضي، مثل ما ينشئه ملف البذور.
      await tx.warehouse.create({
        data: { code: `${code}-W1`, nameAr: `${nameAr} — المستودع الرئيسي`, branchId: branch.id, isDefault: true, holdsStock: true },
      });
    });
  } catch (error) {
    return duplicateValue(error) ?? unexpected(error);
  }
  revalidateDirectory();
  return { status: "success", message: `أُضيف الفرع «${nameAr}» بالكود ${code} ومعه المستودع الافتراضي ${code}-W1.` };
}

export async function renameBranchAction(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const guard = await requireAdmin();
  if ("state" in guard) return guard.state;
  const branchId = rowId(text(formData, "branchId"));
  if (branchId === null) return fail("الفرع المحدد غير صحيح.");
  const nameAr = normalizeName(text(formData, "nameAr"));
  const city = normalizeName(text(formData, "city"));
  if (nameAr.length < 2 || nameAr.length > 120) return fail("اسم الفرع: من حرفين إلى 120 حرفًا.");
  if (city.length > 80) return fail("المدينة: 80 حرفًا على الأكثر.");
  try {
    await prisma.branch.update({ where: { id: branchId }, data: { nameAr, city: city || null } });
  } catch (error) {
    return unexpected(error);
  }
  revalidateDirectory();
  return { status: "success", message: `حُدِّث اسم الفرع إلى «${nameAr}». الأكواد وبادئات الفواتير لم تتغير.` };
}

export async function setBranchActiveAction(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const guard = await requireAdmin();
  if ("state" in guard) return guard.state;
  const branchId = rowId(text(formData, "branchId"));
  if (branchId === null) return fail("الفرع المحدد غير صحيح.");
  const active = flag(formData, "active");
  if (!flag(formData, "confirmed")) return fail("أكّد الإجراء قبل التنفيذ.");
  if (!active) {
    const activeUsers = await prisma.user.count({ where: { branchId, status: "ACTIVE" as UserStatus } });
    if (activeUsers > 0) return fail(`انقل الموظفين النشطين (${activeUsers}) أو أوقفهم قبل إيقاف الفرع.`);
  }
  try {
    await prisma.$transaction([
      prisma.branch.update({ where: { id: branchId }, data: { isActive: active } }),
      prisma.warehouse.updateMany({ where: { branchId }, data: { isActive: active } }),
    ]);
  } catch (error) {
    return unexpected(error);
  }
  revalidateDirectory();
  return {
    status: "success",
    message: active
      ? "أُعيد تفعيل الفرع ومستودعاته."
      : "أُوقف الفرع ومستودعاته: لا مبيعات جديدة فيه، وتسوية فواتيره السابقة تبقى للمدير والمحاسب فقط.",
  };
}

export async function createUserAction(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const guard = await requireAdmin();
  if ("state" in guard) return guard.state;
  const input = {
    fullName: text(formData, "fullName"),
    email: text(formData, "email"),
    password: text(formData, "password"),
    role: text(formData, "role"),
    branchId: text(formData, "branchId"),
  };
  const invalid = userInputError(input, { requirePassword: true });
  if (invalid) return fail(invalid);
  if (!isAdminRole(input.role)) return fail("الدور غير معروف.");
  const role: AdminRole = input.role;
  const branchId = input.branchId.trim() === "" ? null : rowId(input.branchId);
  if (role === "CS_AGENT") {
    if (branchId === null) return fail("موظف الفرع يجب أن يكون منسوبًا إلى فرع.");
    const branch = await prisma.branch.findFirst({ where: { id: branchId, isActive: true }, select: { id: true } });
    if (!branch) return fail("الفرع المختار غير موجود أو غير نشط.");
  }
  const email = emailSchema.parse(input.email);
  const passwordHash = await hashPassword(input.password);
  // النطاق المختصر لحسابات الإدارة فقط؛ موظف الفرع يبقى بنطاقه الكامل.
  const scopeRaw = text(formData, "menuScope");
  const menuScope: MenuScope = role !== "CS_AGENT" && isMenuScope(scopeRaw) ? scopeRaw : "FULL";
  try {
    await prisma.user.create({
      data: {
        fullName: normalizeName(input.fullName),
        email,
        passwordHash,
        roleCode: role as RoleCode,
        branchId,
        status: "ACTIVE" as UserStatus,
        mustChangePassword: flag(formData, "mustChange"),
        menuScope,
      },
    });
  } catch (error) {
    return duplicateValue(error) ?? unexpected(error);
  }
  revalidateDirectory();
  return { status: "success", message: `أُنشئ المستخدم «${normalizeName(input.fullName)}».${flag(formData, "mustChange") ? " سيُطلب تغيير كلمة المرور عند أول دخول." : ""}` };
}

export async function updateUserAction(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const guard = await requireAdmin();
  if ("state" in guard) return guard.state;
  const userId = rowId(text(formData, "userId"));
  if (userId === null) return fail("المستخدم المحدد غير صحيح.");
  if (userId.toString() === guard.session.id) return fail("لا يمكنك تغيير دورك أو حالتك من هذه الشاشة.");
  const input = {
    fullName: text(formData, "fullName") || "مستخدم",
    email: text(formData, "email") || "user@example.com",
    role: text(formData, "role"),
    branchId: text(formData, "branchId"),
  };
  const invalid = userInputError(input, { requirePassword: false });
  if (invalid) return fail(invalid);
  if (!isAdminRole(input.role)) return fail("الدور غير معروف.");
  const role: AdminRole = input.role;
  const branchId = input.branchId.trim() === "" ? null : rowId(input.branchId);
  if (role === "CS_AGENT" && branchId === null) return fail("موظف الفرع يجب أن يكون منسوبًا إلى فرع.");
  if (branchId !== null) {
    const branch = await prisma.branch.findFirst({ where: { id: branchId, isActive: true }, select: { id: true } });
    if (!branch) return fail("الفرع المختار غير موجود أو غير نشط.");
  }
  const status: UserStatus = flag(formData, "active") ? "ACTIVE" : "SUSPENDED";
  const scopeRaw = text(formData, "menuScope");
  const menuScope: MenuScope = role !== "CS_AGENT" && isMenuScope(scopeRaw) ? scopeRaw : "FULL";
  try {
    await prisma.user.update({ where: { id: userId }, data: { roleCode: role as RoleCode, branchId, status, menuScope } });
  } catch (error) {
    return unexpected(error);
  }
  revalidateDirectory();
  return { status: "success", message: "حُدِّثت بيانات المستخدم (الدور والفرع والحالة)." };
}

export async function resetPasswordAction(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const guard = await requireAdmin();
  if ("state" in guard) return guard.state;
  const userId = rowId(text(formData, "userId"));
  if (userId === null) return fail("المستخدم المحدد غير صحيح.");
  const password = newPasswordSchema.safeParse(text(formData, "newPassword"));
  if (!password.success) return fail(password.error.issues[0]?.message ?? "كلمة المرور غير مقبولة.");
  const passwordHash = await hashPassword(password.data);
  try {
    await prisma.$transaction([
      prisma.user.update({ where: { id: userId }, data: { passwordHash, mustChangePassword: true } }),
      prisma.authSession.deleteMany({ where: { userId } }),
    ]);
  } catch (error) {
    return unexpected(error);
  }
  revalidateDirectory();
  return { status: "success", message: "حُدِّثت كلمة المرور، وأُنهيت جلسات المستخدم السابقة، وسيُطلب تغييرها عند أول دخول." };
}
