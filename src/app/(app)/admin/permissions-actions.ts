"use server";

import { revalidatePath } from "next/cache";
import { getAccessContext } from "@/lib/access-control-server";
import { isAdminRole } from "@/lib/admin-directory";
import { isEditableAccessKey, isSystemAdmin, parseAdminEmails } from "@/lib/access-control";
import { prisma } from "@/lib/prisma";
import type { AdminActionState } from "./admin-state";

export async function setPermissionAction(_previous: AdminActionState, form: FormData): Promise<AdminActionState> {
  const actor = await getAccessContext();
  if (!actor.session || !actor.isSystemAdmin || actor.session.mustChangePassword) {
    return { status: "error", message: "هذا الإجراء متاح للأدمن وحده." };
  }
  const kind = String(form.get("kind") ?? "");
  const subject = String(form.get("subject") ?? "");
  const key = String(form.get("key") ?? "");
  const value = String(form.get("value") ?? "");
  if ((kind !== "role" && kind !== "user") || !isEditableAccessKey(key) || !["inherit", "allow", "deny"].includes(value) ||
      (kind === "role" && !isAdminRole(subject)) || (kind === "user" && !/^[1-9]\d{0,18}$/.test(subject))) {
    return { status: "error", message: "اختيار غير صالح أو صلاحية لم يكتمل تطبيقها بعد." };
  }
  try {
    if (kind === "user") {
      const user = await prisma.user.findUnique({ where: { id: BigInt(subject) }, select: { id: true, email: true, roleCode: true } });
      if (!user) return { status: "error", message: "الحساب غير موجود." };
      if (value !== "inherit" && isSystemAdmin(user.roleCode, user.email, parseAdminEmails(process.env.ADMIN_EMAILS))) {
        return { status: "error", message: "حساب الأدمن مسموح دائمًا ولا يمكن تقييده." };
      }
    }
    if (value === "inherit") {
      await prisma.$executeRaw`DELETE FROM public.access_control WHERE subject_kind = ${kind} AND subject = ${subject} AND key = ${key}`;
    } else {
      await prisma.$executeRaw`INSERT INTO public.access_control (subject_kind, subject, key, allowed, updated_by, updated_at)
        VALUES (${kind}, ${subject}, ${key}, ${value === "allow"}, ${actor.session.id}, now())
        ON CONFLICT (subject_kind, subject, key) DO UPDATE SET allowed = EXCLUDED.allowed, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`;
    }
  } catch (error) {
    console.error("Access permission update failed", error instanceof Error ? error.name : "unknown");
    return { status: "error", message: "تعذّر حفظ الصلاحية؛ تحقق من جاهزية جدول الصلاحيات." };
  }
  console.info("Access permission changed", { actorId: actor.session.id, kind, subject, key, value });
  try {
    revalidatePath("/admin");
    revalidatePath("/", "layout");
  } catch {
    console.error("Access permission cache revalidation failed");
    return { status: "success", message: "حُفظت الصلاحية، لكن تعذّر تحديث العرض تلقائيًا؛ حدّث الصفحة." };
  }
  return { status: "success", message: "حُفظت الصلاحية. يسري الاستثناء بعد تحديث الصفحة." };
}
