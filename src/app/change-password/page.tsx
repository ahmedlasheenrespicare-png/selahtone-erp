import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { safeNextPath } from "@/lib/auth-validation";
import { AuthFrame } from "@/app/login/auth-frame";
import { ChangePasswordForm } from "./change-password-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "تغيير كلمة المرور | صلة تون" };

export default async function ChangePasswordPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const next = safeNextPath((await searchParams).next);
  return (
    <AuthFrame eyebrow="أمان الحساب" title="تغيير كلمة المرور" description="اختر كلمة مرور لا تستخدمها في أي حساب آخر.">
      <ChangePasswordForm next={next} required={session.mustChangePassword} />
    </AuthFrame>
  );
}
