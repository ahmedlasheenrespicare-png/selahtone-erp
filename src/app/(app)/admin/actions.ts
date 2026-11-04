"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { Prisma, type RoleCode, type UserStatus } from "@prisma/client";

import {
  canSeeAllBranches,
  hashPassword,
  requireSession,
  type SessionUser,
} from "@/lib/auth";
import { emailSchema, newPasswordSchema } from "@/lib/auth-validation";
import { financeDb, financeEnabled } from "@/lib/finance/db";
import { isMenuScope, type MenuScope } from "@/lib/menu-scope";
import { prisma } from "@/lib/prisma";
import {
  branchInputError,
  canManageBranchStructure,
  canManageTargetUser,
  isAdminRole,
  isIdentifier,
  normalizeBranchCode,
  normalizeInvoicePrefix,
  normalizeName,
  normalizePhone,
  phoneInputError,
  userInputError,
  type AdminRole,
} from "@/lib/admin-directory";
import type { AdminActionState } from "./admin-state";

/**
 * Branch and user administration with strict role-hierarchy enforcement:
 * - MANAGER: full governance over branches, managers, accountants, staff & security.
 * - ACCOUNTANT: may manage branch staff (CS_AGENT) only — never branches, managers, or fellow accountants.
 * Every action re-reads the actor and target from the database, checks open financial
 * custodies before branch transfer or suspension, hashes passwords with bcrypt, and never logs secrets.
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
function sha256Hex(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}
function unexpected(error: unknown): AdminActionState {
  const code =
    error instanceof Prisma.PrismaClientKnownRequestError
      ? error.code
      : "unexpected";
  console.error("Admin operation failed:", code);
  return {
    status: "error",
    message: "تعذّر التأكد من نتيجة العملية. راجع الصفحة قبل تكرار الطلب.",
  };
}
function duplicateValue(error: unknown): AdminActionState | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return null;
  }
  const target = Array.isArray(error.meta?.target)
    ? error.meta.target.map(String).join(",")
    : String(error.meta?.target ?? "");
  if (target.includes("email")) return fail("هذا البريد الإلكتروني مستخدم بالفعل لحساب آخر.");
  if (target.includes("invoice_prefix")) return fail("بادئة الفواتير مستخدمة بالفعل لفرع آخر.");
  if (target.includes("code")) return fail("هذا الكود مستخدم بالفعل.");
  return fail("القيمة المدخلة مكررة.");
}

type Guard = { session: SessionUser } | { state: AdminActionState };

async function requireAdmin(): Promise<Guard> {
  const session = await requireSession();
  if (!canSeeAllBranches(session)) {
    return { state: fail("إدارة الفروع والمستخدمين متاحة للمدير والمحاسب فقط.") };
  }
  return { session };
}

async function requireManagerOnly(): Promise<Guard> {
  const session = await requireSession();
  if (!canManageBranchStructure(session.role)) {
    return {
      state: fail("هذا الإجراء الإداري متاح للمدير العام فقط."),
    };
  }
  return { session };
}

function revalidateDirectory(): void {
  for (const path of [
    "/admin",
    "/dashboard",
    "/setup",
    "/finance/accounts",
    "/finance/transfers",
  ]) {
    try {
      revalidatePath(path);
    } catch {
      console.error("Admin cache revalidation failed");
    }
  }
}

async function findOpenCustodyForUser(userId: bigint): Promise<string | null> {
  if (!financeEnabled()) return null;
  try {
    const res = await financeDb.serializable((tx) =>
      tx.query<{ id: string }>(
        `SELECT id::text AS id
           FROM finance.accounts
          WHERE kind = 'CUSTODY'
            AND holder_id = $1::bigint
            AND closed_at IS NULL
          ORDER BY id ASC
          LIMIT 1`,
        [userId.toString()],
      ),
    );
    return res.rows[0]?.id ?? null;
  } catch {
    return null;
  }
}

export async function createBranchAction(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const guard = await requireManagerOnly();
  if ("state" in guard) return guard.state;
  const input = {
    code: text(formData, "code"),
    nameAr: text(formData, "nameAr"),
    city: text(formData, "city"),
    phone: text(formData, "phone"),
    invoicePrefix: text(formData, "invoicePrefix"),
  };
  const invalid = branchInputError(input);
  if (invalid) return fail(invalid);
  const code = normalizeBranchCode(input.code);
  const nameAr = normalizeName(input.nameAr);
  const city = normalizeName(input.city);
  const phone = normalizePhone(input.phone);
  const invoicePrefix = normalizeInvoicePrefix(input.invoicePrefix);
  try {
    await prisma.$transaction(async (tx) => {
      const branch = await tx.branch.create({
        data: {
          code,
          nameAr,
          city: city || null,
          phone: phone || null,
          invoicePrefix,
        },
      });
      await tx.warehouse.create({
        data: {
          code: `${code}-W1`,
          nameAr: `${nameAr} — المستودع الرئيسي`,
          branchId: branch.id,
          isDefault: true,
          holdsStock: true,
        },
      });
    });
  } catch (error) {
    return duplicateValue(error) ?? unexpected(error);
  }
  revalidateDirectory();
  return {
    status: "success",
    message: `أُضيف الفرع «${nameAr}» بالكود ${code} ومعه المستودع الافتراضي ${code}-W1.`,
  };
}

export async function renameBranchAction(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const guard = await requireManagerOnly();
  if ("state" in guard) return guard.state;
  const branchId = rowId(text(formData, "branchId"));
  if (branchId === null) return fail("الفرع المحدد غير صحيح.");
  const nameAr = normalizeName(text(formData, "nameAr"));
  const city = normalizeName(text(formData, "city"));
  const phone = normalizePhone(text(formData, "phone"));
  if (nameAr.length < 2 || nameAr.length > 120) {
    return fail("اسم الفرع: من حرفين إلى 120 حرفًا.");
  }
  if (city.length > 80) return fail("المدينة: 80 حرفًا على الأكثر.");
  const phoneErr = phoneInputError(phone);
  if (phoneErr) return fail(phoneErr);
  try {
    await prisma.branch.update({
      where: { id: branchId },
      data: { nameAr, city: city || null, phone: phone || null },
    });
  } catch (error) {
    return unexpected(error);
  }
  revalidateDirectory();
  return {
    status: "success",
    message: `حُدِّثت بيانات الفرع «${nameAr}» بنجاح. الأكواد وبادئات الفواتير محفوظة دون تغيير.`,
  };
}

export async function setBranchActiveAction(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const guard = await requireManagerOnly();
  if ("state" in guard) return guard.state;
  const branchId = rowId(text(formData, "branchId"));
  if (branchId === null) return fail("الفرع المحدد غير صحيح.");
  const active = flag(formData, "active");
  if (!flag(formData, "confirmed")) return fail("أكّد الإجراء قبل التنفيذ.");
  if (!active) {
    const activeUsers = await prisma.user.count({
      where: { branchId, status: "ACTIVE" as UserStatus },
    });
    if (activeUsers > 0) {
      return fail(
        `انقل الموظفين النشطين (${activeUsers}) أو أوقف حساباتهم قبل إيقاف الفرع.`,
      );
    }
    if (financeEnabled()) {
      const openCustodies = await financeDb
        .serializable((tx) =>
          tx.query<{ cnt: string }>(
            `SELECT COUNT(*)::text AS cnt
               FROM finance.accounts
              WHERE branch_id = $1::bigint
                AND kind = 'CUSTODY'
                AND closed_at IS NULL`,
            [branchId.toString()],
          ),
        )
        .catch(() => ({ rows: [{ cnt: "0" }] }));
      const cnt = Number(openCustodies.rows[0]?.cnt ?? 0);
      if (cnt > 0) {
        return fail(
          `يوجد بالفرع ${cnt} عهدة نقدية مفتوحة لم تُقفل بعد؛ صفِّ العُهَد وأقفلها من «الحسابات النقدية» قبل إيقاف الفرع.`,
        );
      }
    }
  }
  try {
    await prisma.$transaction([
      prisma.branch.update({
        where: { id: branchId },
        data: { isActive: active },
      }),
      prisma.warehouse.updateMany({
        where: { branchId },
        data: { isActive: active },
      }),
    ]);
  } catch (error) {
    return unexpected(error);
  }
  revalidateDirectory();
  return {
    status: "success",
    message: active
      ? "أُعيد تفعيل الفرع ومستودعاته للتشغيل."
      : "أُوقف الفرع ومستودعاته: لا مبيعات جديدة فيه، وتبقى تسوية فواتيره السابقة للمدير والمحاسب فقط.",
  };
}

export async function createUserAction(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const guard = await requireAdmin();
  if ("state" in guard) return guard.state;
  const input = {
    fullName: text(formData, "fullName"),
    email: text(formData, "email"),
    phone: text(formData, "phone"),
    password: text(formData, "password"),
    role: text(formData, "role"),
    branchId: text(formData, "branchId"),
  };
  const invalid = userInputError(input, { requirePassword: true });
  if (invalid) return fail(invalid);
  if (!isAdminRole(input.role)) return fail("الدور غير معروف.");
  const role: AdminRole = input.role;

  if (!canManageTargetUser(guard.session.role, role)) {
    return fail(
      "المحاسب يملك صلاحية إنشاء حسابات موظفي الفروع فقط؛ حسابات الإدارة والمحاسبة للمدير العام.",
    );
  }

  const branchId = input.branchId.trim() === "" ? null : rowId(input.branchId);
  if (role === "CS_AGENT") {
    if (branchId === null) return fail("موظف الفرع يجب أن يكون منسوبًا إلى فرع.");
    const branch = await prisma.branch.findFirst({
      where: { id: branchId, isActive: true },
      select: { id: true },
    });
    if (!branch) return fail("الفرع المختار غير موجود أو غير نشط.");
  } else if (branchId !== null) {
    const branch = await prisma.branch.findFirst({
      where: { id: branchId, isActive: true },
      select: { id: true },
    });
    if (!branch) return fail("الفرع المختار غير موجود أو غير نشط.");
  }

  const email = emailSchema.parse(input.email);
  const phone = normalizePhone(input.phone);
  const passwordHash = await hashPassword(input.password);
  const scopeRaw = text(formData, "menuScope");
  const menuScope: MenuScope =
    role !== "CS_AGENT" && isMenuScope(scopeRaw) ? scopeRaw : "FULL";
  const canCancelSales =
    role === "ACCOUNTANT" && guard.session.role === "MANAGER"
      ? flag(formData, "canCancelSales")
      : true;

  try {
    await prisma.user.create({
      data: {
        fullName: normalizeName(input.fullName),
        email,
        phone: phone || null,
        passwordHash,
        roleCode: role as RoleCode,
        branchId,
        status: "ACTIVE" as UserStatus,
        mustChangePassword: flag(formData, "mustChange"),
        menuScope,
        canCancelSales,
      },
    });
  } catch (error) {
    return duplicateValue(error) ?? unexpected(error);
  }
  revalidateDirectory();
  return {
    status: "success",
    message: `أُنشئ حساب «${normalizeName(input.fullName)}» بنجاح.${
      flag(formData, "mustChange")
        ? " سيُطلب منه تغيير كلمة المرور عند أول دخول."
        : ""
    }`,
  };
}

export async function updateUserAction(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const guard = await requireAdmin();
  if ("state" in guard) return guard.state;
  const userId = rowId(text(formData, "userId"));
  if (userId === null) return fail("المستخدم المحدد غير صحيح.");
  if (userId.toString() === guard.session.id) {
    return fail("لا يمكنك تغيير دورك أو حالتك من هذه الشاشة.");
  }

  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      roleCode: true,
      branchId: true,
      status: true,
      canCancelSales: true,
    },
  });
  if (!existing) return fail("المستخدم غير موجود.");

  if (!canManageTargetUser(guard.session.role, existing.roleCode)) {
    return fail("إدارة حسابات المديرين والمحاسبين متاحة للمدير العام فقط.");
  }

  const rawFullName = text(formData, "fullName") || existing.fullName;
  const rawEmail = text(formData, "email") || existing.email;
  const rawPhone =
    formData.has("phone") ? text(formData, "phone") : existing.phone ?? "";

  const input = {
    fullName: rawFullName,
    email: rawEmail,
    phone: rawPhone,
    role: text(formData, "role"),
    branchId: text(formData, "branchId"),
  };
  const invalid = userInputError(input, { requirePassword: false });
  if (invalid) return fail(invalid);
  if (!isAdminRole(input.role)) return fail("الدور غير معروف.");
  const role: AdminRole = input.role;

  if (!canManageTargetUser(guard.session.role, role)) {
    return fail(
      "ترقية الحساب إلى دور إداري أو محاسبي متاحة للمدير العام فقط.",
    );
  }

  const branchId = input.branchId.trim() === "" ? null : rowId(input.branchId);
  if (role === "CS_AGENT" && branchId === null) {
    return fail("موظف الفرع يجب أن يكون منسوبًا إلى فرع.");
  }
  if (branchId !== null) {
    const branch = await prisma.branch.findFirst({
      where: { id: branchId, isActive: true },
      select: { id: true },
    });
    if (!branch) return fail("الفرع المختار غير موجود أو غير نشط.");
  }

  const status: UserStatus = flag(formData, "active") ? "ACTIVE" : "SUSPENDED";
  const branchChanged =
    (existing.branchId?.toString() ?? null) !== (branchId?.toString() ?? null);
  const suspending = status === "SUSPENDED" && existing.status === "ACTIVE";

  if (branchChanged || suspending) {
    const openCustodyId = await findOpenCustodyForUser(userId);
    if (openCustodyId) {
      return fail(
        `لا يمكن ${
          suspending ? "إيقاف حساب الموظف" : "نقل الموظف إلى فرع آخر"
        } وفي ذمّته عهدة نقدية مفتوحة (#${openCustodyId}). صفِّ العهدة وأقفلها من «الحسابات النقدية» أولًا.`,
      );
    }
  }

  const scopeRaw = text(formData, "menuScope");
  const menuScope: MenuScope =
    role !== "CS_AGENT" && isMenuScope(scopeRaw) ? scopeRaw : "FULL";
  const canCancelSales =
    role === "ACCOUNTANT"
      ? guard.session.role === "MANAGER"
        ? flag(formData, "canCancelSales")
        : existing.canCancelSales
      : true;

  const email = emailSchema.parse(rawEmail);
  const phone = normalizePhone(rawPhone);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          fullName: normalizeName(rawFullName),
          email,
          phone: phone || null,
          roleCode: role as RoleCode,
          branchId,
          status,
          menuScope,
          canCancelSales,
        },
      });
      if (status === "SUSPENDED") {
        await tx.authSession.deleteMany({ where: { userId } });
      }
    });
  } catch (error) {
    return duplicateValue(error) ?? unexpected(error);
  }
  revalidateDirectory();
  return {
    status: "success",
    message:
      status === "SUSPENDED"
        ? "حُدِّثت بيانات المستخدم وأُوقف الحساب وأُنهيت جلساته النشطة فورًا."
        : "حُدِّثت بيانات المستخدم وصلاحياته بنجاح.",
  };
}

export async function resetPasswordAction(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const guard = await requireAdmin();
  if ("state" in guard) return guard.state;
  const userId = rowId(text(formData, "userId"));
  if (userId === null) return fail("المستخدم المحدد غير صحيح.");

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, roleCode: true },
  });
  if (!target) return fail("المستخدم غير موجود.");
  if (!canManageTargetUser(guard.session.role, target.roleCode)) {
    return fail("تصفير كلمة مرور المديرين والمحاسبين متاح للمدير العام فقط.");
  }

  const password = newPasswordSchema.safeParse(text(formData, "newPassword"));
  if (!password.success) {
    return fail(password.error.issues[0]?.message ?? "كلمة المرور غير مقبولة.");
  }
  const passwordHash = await hashPassword(password.data);
  try {
    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { passwordHash, mustChangePassword: true },
      }),
      prisma.authSession.deleteMany({ where: { userId } }),
      prisma.loginAttempt.create({
        data: {
          identifierHash: sha256Hex(target.email),
          userId,
          result: "PASSWORD_RESET",
        },
      }),
    ]);
  } catch (error) {
    return unexpected(error);
  }
  revalidateDirectory();
  return {
    status: "success",
    message:
      "حُدِّثت كلمة المرور المؤقتة، وأُنهيت جلسات المستخدم السابقة، وسُجّل الإجراء في سجل الأمان.",
  };
}

export async function revokeUserSessionsAction(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const guard = await requireAdmin();
  if ("state" in guard) return guard.state;
  const userId = rowId(text(formData, "userId"));
  if (userId === null) return fail("المستخدم المحدد غير صحيح.");
  if (userId.toString() === guard.session.id) {
    return fail(
      "لتسجيل الخروج من جلستك الحالية استخدم زر الخروج، أو غيّر كلمة مرورك لإنهاء الأجهزة الأخرى.",
    );
  }

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, roleCode: true },
  });
  if (!target) return fail("المستخدم غير موجود.");
  if (!canManageTargetUser(guard.session.role, target.roleCode)) {
    return fail("إنهاء جلسات المديرين والمحاسبين متاح للمدير العام فقط.");
  }

  try {
    const deleted = await prisma.authSession.deleteMany({ where: { userId } });
    revalidateDirectory();
    return {
      status: "success",
      message:
        deleted.count > 0
          ? `أُنهيت ${deleted.count} جلسة نشطة لهذا المستخدم فورًا.`
          : "لا توجد جلسات نشطة مسجّلة لهذا المستخدم حاليًا.",
    };
  } catch (error) {
    return unexpected(error);
  }
}

export async function purgeInactiveSessionsAction(
  _previous: AdminActionState,
): Promise<AdminActionState> {
  const guard = await requireManagerOnly();
  if ("state" in guard) return guard.state;
  try {
    const now = new Date();
    const deleted = await prisma.authSession.deleteMany({
      where: {
        OR: [
          { expiresAt: { lte: now } },
          { user: { status: "SUSPENDED" } },
        ],
      },
    });
    revalidateDirectory();
    return {
      status: "success",
      message:
        deleted.count > 0
          ? `تم تطهير ${deleted.count} جلسة منتهية الصلاحية أو عائدة لحسابات موقوفة.`
          : "سجل الجلسات نظيف بالفعل — لا توجد جلسات منتهية أو معلّقة.",
    };
  } catch (error) {
    return unexpected(error);
  }
}
