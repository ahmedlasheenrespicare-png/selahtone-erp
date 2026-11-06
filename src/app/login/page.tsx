import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSession, SESSION_COOKIE } from "@/lib/auth";
import { safeNextPath } from "@/lib/auth-validation";
import { LoginFrame } from "./login-frame";
import { LoginForm } from "./login-form";
import type { PreviewAccount } from "./preview-accounts";
import "./login.css";

/**
 * بوابة المعاينة فقط: PREVIEW_QUICK_LOGIN=true + PREVIEW_DEMO_PASSWORD تُظهر
 * أزرار دخول بنقرة للحسابات المزروعة. لا تُضبط في الإنتاج أبدًا.
 */
function previewAccounts(): PreviewAccount[] {
  if (process.env.PREVIEW_QUICK_LOGIN !== "true") return [];
  const password = process.env.PREVIEW_DEMO_PASSWORD;
  if (!password) return [];
  return [
    { key: "manager", label: "المدير", description: "كل الفروع والصلاحيات", email: "manager@selahtone.local", password },
    { key: "accountant", label: "المحاسب", description: "مالية ومراجعة بلا إدارة فروع", email: "accountant@selahtone.local", password },
    { key: "agent", label: "موظف العريش", description: "فرع العريش فقط", email: "arh@selahtone.local", password },
  ];
}

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
      <LoginForm next={next} logoutUnconfirmed={params.notice === "logout_unconfirmed"} previewAccounts={previewAccounts()} />
    </LoginFrame>
  );
}
