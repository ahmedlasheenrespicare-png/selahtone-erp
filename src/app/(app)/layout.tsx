import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, canSeeAllBranches } from "@/lib/auth";
import LogoutButton from "./logout-button";

const ROLE_LABEL: Record<string, string> = {
  MANAGER: "مدير الشركة",
  ACCOUNTANT: "المحاسب",
  CS_AGENT: "موظف الكاونتر",
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.mustChangePassword) redirect("/change-password");

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="logo">
          <div className="mark">ص</div>
          <div>
            صلة تون
            <small>نظام الإيرادات والمصروفات</small>
          </div>
        </div>

        <ul className="nav">
          <li><Link href="/dashboard">لوحة القيادة</Link></li>
          <li><Link href="/inventory">المخزون والمستودعات</Link></li>
          {canSeeAllBranches(session) && (
            <>
              <li><Link href="/setup">التحقق من الإعداد</Link></li>
              <li><span className="soon">المصروفات</span></li>
              <li><span className="soon">العهد النقدية</span></li>
              <li><span className="soon">التقارير الضريبية</span></li>
            </>
          )}
          {!canSeeAllBranches(session) && (
            <>
              <li><span className="soon">كاونتر البيع</span></li>
              <li><span className="soon">عهدتي</span></li>
              <li><span className="soon">إيرادي اليومي</span></li>
            </>
          )}
        </ul>
      </aside>

      <main className="main">
        <div className="topbar">
          <div>
            <h1>صلة تون</h1>
            <div className="sub">
              {session.branchName ? `الفرع: ${session.branchName}` : "كل الفروع"}
            </div>
          </div>
          <div className="spacer" />
          <div className="user-chip">
            <span className="avatar">{session.name.charAt(0)}</span>
            <span>
              {session.name}
              <span className="role"> · {ROLE_LABEL[session.role] ?? session.role}</span>
            </span>
          </div>
          <Link href="/change-password" className="account-link">تغيير كلمة المرور</Link>
          <LogoutButton />
        </div>

        {children}
      </main>
    </div>
  );
}
