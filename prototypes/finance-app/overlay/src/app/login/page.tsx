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
      <div className="auth-message auth-message-warning" style={{ lineHeight: 1.8 }}>
        <strong>نسخة تجريبية عامة — بيانات وهمية فقط.</strong><br />
        تُحذف البيانات عند إعادة التشغيل؛ لا تدخل أي معلومات حقيقية.<br />
        المدير: <bdi dir="ltr">manager@example.test</bdi><br />
        المحاسب: <bdi dir="ltr">accountant@example.test</bdi><br />
        الموظف: <bdi dir="ltr">staff@example.test</bdi><br />
        موظف الفرع الموقوف: <bdi dir="ltr">staff-stop@example.test</bdi><br />
        كلمة مرور التجربة: <bdi dir="ltr">DemoOnly-2026!</bdi>
      </div>
      <LoginForm next={next} logoutUnconfirmed={params.notice === "logout_unconfirmed"} />
    </LoginFrame>
  );
}
