"use server";

import { redirect } from "next/navigation";
import { login } from "@/lib/auth";
import { loginSchema, safeNextPath } from "@/lib/auth-validation";
import type { LoginFormState } from "./login-state";

export async function loginAction(_previous: LoginFormState, data: FormData): Promise<LoginFormState> {
  const next = safeNextPath(data.get("next"));
  const parsed = loginSchema.safeParse({
    email: data.get("email"),
    password: data.get("password"),
    remember: data.get("remember") === "on",
  });
  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    return { errors: { email: errors.email?.[0], password: errors.password?.[0] } };
  }

  let destination: string;
  try {
    const result = await login(parsed.data.email, parsed.data.password, parsed.data.remember);
    if (!result.ok) {
      return {
        message: result.reason === "locked"
          ? "محاولات كثيرة. انتظر 15 دقيقة ثم حاول مرة أخرى."
          : "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
      };
    }
    destination = result.mustChangePassword ? `/change-password?next=${encodeURIComponent(next)}` : next;
  } catch (error) {
    console.error("Login unavailable:", error);
    return { message: "تعذّر تسجيل الدخول حاليًا. حاول مرة أخرى أو تواصل مع مسؤول النظام." };
  }
  // redirect يرمي استثناءً داخليًا في Next.js، لذلك يجب أن يبقى خارج catch.
  redirect(destination);
}
