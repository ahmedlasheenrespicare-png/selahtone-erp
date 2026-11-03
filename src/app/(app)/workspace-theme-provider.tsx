"use client";

import { createContext, useCallback, useContext, useState } from "react";
import {
  DEFAULT_DASHBOARD_BG_MAP,
  DEFAULT_WORKSPACE_THEME,
  serializeWorkspaceDashboardBg,
  WORKSPACE_DASHBOARD_BG_COOKIE,
  WORKSPACE_THEME_COOKIE,
  type WorkspaceDashboardBgMap,
  type WorkspaceThemeId,
} from "@/lib/workspace-theme";

type WorkspaceThemeContextValue = {
  theme: WorkspaceThemeId;
  setTheme: (next: WorkspaceThemeId) => void;
  dashboardBgByTheme: WorkspaceDashboardBgMap;
  isDashboardBgEnabled: boolean;
  setThemeDashboardBg: (targetTheme: WorkspaceThemeId, enabled: boolean) => void;
};

const WorkspaceThemeContext = createContext<WorkspaceThemeContextValue>({
  theme: DEFAULT_WORKSPACE_THEME,
  setTheme: () => {},
  dashboardBgByTheme: DEFAULT_DASHBOARD_BG_MAP,
  isDashboardBgEnabled: false,
  setThemeDashboardBg: () => {},
});

function writeWorkspaceCookie(name: string, value: string): void {
  if (typeof document === "undefined") return;
  const isHttps = typeof window !== "undefined" && window.location.protocol === "https:";
  const attrs = isHttps
    ? "Path=/; Max-Age=31536000; SameSite=None; Secure; Partitioned"
    : "Path=/; Max-Age=31536000; SameSite=Lax";
  document.cookie = `${name}=${encodeURIComponent(value)}; ${attrs}`;
}

export function useWorkspaceTheme(): WorkspaceThemeContextValue {
  return useContext(WorkspaceThemeContext);
}

export function WorkspaceThemeProvider({
  initialTheme = DEFAULT_WORKSPACE_THEME,
  initialDashboardBg = DEFAULT_DASHBOARD_BG_MAP,
  children,
}: {
  initialTheme?: WorkspaceThemeId;
  initialDashboardBg?: WorkspaceDashboardBgMap;
  children: React.ReactNode;
}) {
  const [theme, setThemeState] = useState<WorkspaceThemeId>(initialTheme);
  const [dashboardBgByTheme, setDashboardBgByTheme] =
    useState<WorkspaceDashboardBgMap>(initialDashboardBg);

  const setTheme = useCallback((next: WorkspaceThemeId) => {
    setThemeState(next);
    writeWorkspaceCookie(WORKSPACE_THEME_COOKIE, next);
  }, []);

  const setThemeDashboardBg = useCallback(
    (targetTheme: WorkspaceThemeId, enabled: boolean) => {
      setDashboardBgByTheme((prev) => {
        const updated: WorkspaceDashboardBgMap = {
          ...prev,
          [targetTheme]: enabled,
        };
        writeWorkspaceCookie(
          WORKSPACE_DASHBOARD_BG_COOKIE,
          serializeWorkspaceDashboardBg(updated),
        );
        return updated;
      });
      setThemeState((currentTheme) => {
        if (currentTheme !== targetTheme) {
          writeWorkspaceCookie(WORKSPACE_THEME_COOKIE, targetTheme);
          return targetTheme;
        }
        return currentTheme;
      });
    },
    [],
  );

  const isDashboardBgEnabled = Boolean(dashboardBgByTheme[theme]);

  return (
    <WorkspaceThemeContext.Provider
      value={{
        theme,
        setTheme,
        dashboardBgByTheme,
        isDashboardBgEnabled,
        setThemeDashboardBg,
      }}
    >
      <div
        className="workspace-shell"
        data-theme={theme}
        data-dashboard-bg={isDashboardBgEnabled ? "on" : "off"}
      >
        {children}
      </div>
    </WorkspaceThemeContext.Provider>
  );
}
