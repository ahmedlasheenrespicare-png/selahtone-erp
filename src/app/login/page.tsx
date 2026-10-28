import { redirect } from "next/navigation";
import { login, getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function loginAction(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  // لا نستخدم throw هنا حتى لا يظهر خطأ تقني للمستخدم
  const result = await login(email, password);
  if (!result.ok) {
    redirect(`/login?error=${encodeURIComponent(result.error)}`);
  }
  redirect("/dashboard");
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getSession();
  if (session) redirect("/dashboard");

  const { error } = await searchParams;

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <div style={{
            width: 42, height: 42, borderRadius: 12, background: "#0f2f4d", color: "#7fd3c2",
            display: "grid", placeItems: "center", fontWeight: 800, fontSize: 18,
          }}>ص</div>
          <div>
            <h1>صلة تون</h1>
            <p className="sub" style={{ margin: 0 }}>نظام الإيرادات والمصروفات</p>
          </div>
        </div>

        {error && <div className="alert alert-err">{error}</div>}

        <form action={loginAction}>
          <div className="field">
            <label htmlFor="email">البريد الإلكتروني</label>
            <input id="email" name="email" type="email" required autoComplete="username"
                   placeholder="manager@selahtone.local" dir="ltr" />
          </div>
          <div className="field">
            <label htmlFor="password">كلمة المرور</label>
            <input id="password" name="password" type="password" required autoComplete="current-password"
                   placeholder="••••••••" dir="ltr" />
          </div>
          <button className="btn" type="submit">دخول</button>
        </form>

        <div className="login-help">
          <b>حسابات البداية</b> (بعد تشغيل <code>npm run db:seed</code>):<br />
          مدير: <span dir="ltr">manager@selahtone.local</span><br />
          محاسب: <span dir="ltr">accountant@selahtone.local</span><br />
          كاونتر العريش: <span dir="ltr">arh@selahtone.local</span><br />
          كلمة المرور: <code>Sel@2026!</code> — غيّرها بعد أول دخول.
        </div>
      </div>
    </div>
  );
}
