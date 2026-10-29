import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSession, SESSION_COOKIE } from "@/lib/auth";
import { safeNextPath } from "@/lib/auth-validation";
import { LoginFrame } from "./login-frame";
import { LoginForm } from "./login-form";
import "./login.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "تسجيل الدخول | صلة تون" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; notice?: string }>;
}) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  const session = await getSession();
  if (session) redirect(session.mustChangePassword ? `/change-password?next=${encodeURIComponent(next)}` : next);
  // المكوّن الخادمي لا يستطيع حذف الكوكي؛ المسار يحذفه بعد التأكد أنه غير صالح.
  if ((await cookies()).has(SESSION_COOKIE)) redirect(`/api/session/clear?next=${encodeURIComponent(next)}`);

  return (
    <LoginFrame>
      <LoginForm next={next} logoutUnconfirmed={params.notice === "logout_unconfirmed"} />
    </LoginFrame>
  );
}
