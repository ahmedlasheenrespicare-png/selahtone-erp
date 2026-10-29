"use server";

import { redirect } from "next/navigation";
import { changePassword, getSession } from "@/lib/auth";
import { changePasswordSchema, safeNextPath } from "@/lib/auth-validation";
import type { ChangePasswordState } from "./change-password-state";

export async function changePasswordAction(_previous: ChangePasswordState, data: FormData): Promise<ChangePasswordState> {
  const session = await getSession();
  if (!session) redirect("/login");
  const parsed = changePasswordSchema.safeParse({
    currentPassword: data.get("currentPassword"),
    newPassword: data.get("newPassword"),
    confirmPassword: data.get("confirmPassword"),
  });
  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    return { errors: {
      currentPassword: errors.currentPassword?.[0],
      newPassword: errors.newPassword?.[0],
      confirmPassword: errors.confirmPassword?.[0],
    } };
  }

  try {
    const result = await changePassword(session, parsed.data.currentPassword, parsed.data.newPassword);
    if (!result.ok) {
      return { message: result.reason === "locked"
        ? "محاولات كثيرة. انتظر 15 دقيقة ثم حاول مرة أخرى."
        : "كلمة المرور الحالية غير صحيحة أو لم يعد الحساب نشطًا." };
    }
  } catch (error) {
    console.error("Password change unavailable:", error);
    return { message: "تعذّر تغيير كلمة المرور حاليًا. حاول مرة أخرى أو تواصل مع مسؤول النظام." };
  }
  redirect(safeNextPath(data.get("next")));
}
