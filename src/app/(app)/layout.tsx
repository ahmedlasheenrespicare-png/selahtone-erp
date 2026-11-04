import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppIcon } from "@/components/app-icon";
import ColorModeToggle from "@/components/color-mode-toggle";
import { getSession, canSeeAllBranches } from "@/lib/auth";
import { financeEnabled } from "@/lib/finance/db";
import { inventoryEnabled } from "@/lib/feature-flags";
import {
  getWorkspaceClockSnapshot,
  resolveWorkspaceColorModeState,
  resolveWorkspaceDashboardBg,
  resolveWorkspaceTheme,
  WORKSPACE_COLOR_MODE_COOKIE,
  WORKSPACE_DASHBOARD_BG_COOKIE,
  WORKSPACE_THEME_COOKIE,
  WORKSPACE_TIMEZONE,
} from "@/lib/workspace-theme";
import { AppNavigation } from "./app-navigation";
import LogoutButton from "./logout-button";
import { WorkspaceThemeProvider } from "./workspace-theme-provider";
import "./workspace.css";
import "./design.css"; // طبقة التصميم الجديد — فوق أنماط الشاشات القائمة، بلا تغيير في بنيتها
import "./dark-mode.css"; // طبقة الوضع النهاري والليلي المتزامنة مع شروق النهار وحلول الليل
import "./red-duck-starfield.css"; // خلفية النجوم الليلية (red-duck-82) لثيم «الافتراضي» مع تفعيل الخلفية في الوضع الليلي فقط

const ROLE_LABEL: Record<string, string> = {
  MANAGER: "مدير الشركة",
  ACCOUNTANT: "المحاسب",
  CS_AGENT: "موظف الكاونتر",
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.mustChangePassword) redirect("/change-password");

  const cookieStore = await cookies();
  const now = new Date();
  const initialTheme = resolveWorkspaceTheme(cookieStore.get(WORKSPACE_THEME_COOKIE)?.value);
  const initialDashboardBg = resolveWorkspaceDashboardBg(
    cookieStore.get(WORKSPACE_DASHBOARD_BG_COOKIE)?.value,
  );
  const initialClock = getWorkspaceClockSnapshot(now, WORKSPACE_TIMEZONE);
  const colorState = resolveWorkspaceColorModeState(
    cookieStore.get(WORKSPACE_COLOR_MODE_COOKIE)?.value,
    now,
    WORKSPACE_TIMEZONE,
  );

  const roleLabel = ROLE_LABEL[session.role] ?? session.role;
  const branchLabel = session.branchName ?? "كل الفروع";

  return (
    <WorkspaceThemeProvider
      initialTheme={initialTheme}
      initialDashboardBg={initialDashboardBg}
      initialColorMode={colorState.colorMode}
      initialIsAutoTimeMode={colorState.isAutoTimeMode}
      initialClock={initialClock}
    >
      <a className="workspace-skip" href="#workspace-content">تخطي إلى المحتوى</a>
      <AppNavigation
        canViewAllBranches={canSeeAllBranches(session)}
        role={session.role}
        financeEnabled={financeEnabled()}
        menuScope={session.menuScope}
        inventoryEnabled={inventoryEnabled()}
        userName={session.name}
        roleLabel={roleLabel}
        branchLabel={branchLabel}
      />

      <div className="workspace-main">
        <div className="workspace-starfield" aria-hidden="true">
          <div className="workspace-starfield__stars workspace-starfield__stars--sm" />
          <div className="workspace-starfield__stars workspace-starfield__stars--md" />
          <div className="workspace-starfield__stars workspace-starfield__stars--lg" />
        </div>
        <header className="workspace-topbar">
          <div className="workspace-topbar__start">
            <div className="workspace-topbar__title">
              <span className="workspace-topbar__title-icon"><AppIcon name="dashboard" /></span>
              <span><small>نظام إدارة صلة تون</small><strong>مساحة العمل</strong></span>
            </div>
            <ColorModeToggle />
          </div>
          <div className="workspace-topbar__actions">
            <div className="workspace-user">
              <span className="workspace-user__avatar" aria-hidden="true">{Array.from(session.name)[0] ?? "ص"}</span>
              <span className="workspace-user__details">
                <strong>{session.name}</strong>
                <small>{roleLabel} <span aria-hidden="true">·</span> {branchLabel}</small>
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
    </WorkspaceThemeProvider>
  );
}
