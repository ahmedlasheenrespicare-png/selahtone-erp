import Link from "next/link";
import { redirect } from "next/navigation";
import { AppIcon } from "@/components/app-icon";
import { getSession, canSeeAllBranches } from "@/lib/auth";
import { AppNavigation } from "./app-navigation";
import LogoutButton from "./logout-button";
import "./workspace.css";

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
    <div className="workspace-shell">
      <a className="workspace-skip" href="#workspace-content">تخطي إلى المحتوى</a>
      <AppNavigation canViewAllBranches={canSeeAllBranches(session)} />

      <div className="workspace-main">
        <header className="workspace-topbar">
          <div className="workspace-topbar__title">
            <span className="workspace-topbar__title-icon"><AppIcon name="dashboard" /></span>
            <span><small>نظام إدارة صلة تون</small><strong>مساحة العمل</strong></span>
          </div>
          <div className="workspace-topbar__actions">
            <div className="workspace-user">
              <span className="workspace-user__avatar" aria-hidden="true">{Array.from(session.name)[0] ?? "ص"}</span>
              <span className="workspace-user__details">
                <strong>{session.name}</strong>
                <small>{ROLE_LABEL[session.role] ?? session.role} <span aria-hidden="true">·</span> {session.branchName ?? "كل الفروع"}</small>
              </span>
            </div>
            <Link href="/change-password" className="workspace-account-link" title="تغيير كلمة المرور" aria-label="تغيير كلمة المرور">
              <AppIcon name="lock" /><span>كلمة المرور</span>
            </Link>
            <LogoutButton />
          </div>
        </header>

        <main id="workspace-content" className="workspace-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
