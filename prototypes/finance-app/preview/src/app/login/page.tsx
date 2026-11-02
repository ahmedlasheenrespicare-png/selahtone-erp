import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSession, SESSION_COOKIE } from "@/lib/auth";
import { safeNextPath } from "@/lib/auth-validation";
import { LoginFrame } from "./login-frame";
import { LoginForm } from "./login-form";
import { demoQuickLoginAction } from "./demo-actions";
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
  if ((await cookies()).has(SESSION_COOKIE)) redirect(`/api/session/clear?next=${encodeURIComponent(next)}`);

  return (
    <LoginFrame>
      <div className="auth-message auth-message-warning" style={{ lineHeight: 1.8 }}>
        <strong>نسخة تجريبية عامة — بيانات وهمية فقط.</strong><br />
        تُحذف البيانات عند إعادة التشغيل؛ لا تدخل أي معلومات حقيقية.<br />
        المدير: <bdi dir="ltr">manager@example.test</bdi><br />
        المحاسب: <bdi dir="ltr">accountant@example.test</bdi><br />
        الموظف: <bdi dir="ltr">staff@example.test</bdi><br />
        كلمة مرور التجربة: <bdi dir="ltr">DemoOnly-2026!</bdi>

        <form action={demoQuickLoginAction} style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "12px" }}>
          <input type="hidden" name="next" value={next} />
          <button
            type="submit"
            name="demoRole"
            value="manager"
            className="auth-submit"
            style={{ width: "auto", flex: "1 1 auto", minHeight: "38px", padding: "8px 12px", fontSize: "0.85rem" }}
          >
            دخول سريع كمدير
          </button>
          <button
            type="submit"
            name="demoRole"
            value="accountant"
            className="auth-submit"
            style={{ width: "auto", flex: "1 1 auto", minHeight: "38px", padding: "8px 12px", fontSize: "0.85rem", background: "#234a78" }}
          >
            محاسب
          </button>
          <button
            type="submit"
            name="demoRole"
            value="staff"
            className="auth-submit"
            style={{ width: "auto", flex: "1 1 auto", minHeight: "38px", padding: "8px 12px", fontSize: "0.85rem", background: "#2f5f48" }}
          >
            موظف فرع
          </button>
        </form>
      </div>
      <LoginForm next={next} logoutUnconfirmed={params.notice === "logout_unconfirmed"} />
    </LoginFrame>
  );
}
