"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import {
  DEFAULT_DASHBOARD_BG_MAP,
  DEFAULT_WORKSPACE_COLOR_MODE,
  DEFAULT_WORKSPACE_THEME,
  serializeWorkspaceDashboardBg,
  WORKSPACE_COLOR_MODE_COOKIE,
  WORKSPACE_DASHBOARD_BG_COOKIE,
  WORKSPACE_THEME_COOKIE,
  type WorkspaceColorModePreference,
  type WorkspaceDashboardBgMap,
  type WorkspaceResolvedColorMode,
  type WorkspaceThemeId,
} from "@/lib/workspace-theme";

type WorkspaceThemeContextValue = {
  theme: WorkspaceThemeId;
  setTheme: (next: WorkspaceThemeId) => void;
  dashboardBgByTheme: WorkspaceDashboardBgMap;
  isDashboardBgEnabled: boolean;
  setThemeDashboardBg: (targetTheme: WorkspaceThemeId, enabled: boolean) => void;
  colorModePreference: WorkspaceColorModePreference;
  resolvedColorMode: WorkspaceResolvedColorMode;
  setColorModePreference: (next: WorkspaceColorModePreference) => void;
  toggleColorMode: () => void;
};

const WorkspaceThemeContext = createContext<WorkspaceThemeContextValue>({
  theme: DEFAULT_WORKSPACE_THEME,
  setTheme: () => {},
  dashboardBgByTheme: DEFAULT_DASHBOARD_BG_MAP,
  isDashboardBgEnabled: false,
  setThemeDashboardBg: () => {},
  colorModePreference: DEFAULT_WORKSPACE_COLOR_MODE,
  resolvedColorMode: "light",
  setColorModePreference: () => {},
  toggleColorMode: () => {},
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
  initialColorMode = DEFAULT_WORKSPACE_COLOR_MODE,
  children,
}: {
  initialTheme?: WorkspaceThemeId;
  initialDashboardBg?: WorkspaceDashboardBgMap;
  initialColorMode?: WorkspaceColorModePreference;
  children: React.ReactNode;
}) {
  const [theme, setThemeState] = useState<WorkspaceThemeId>(initialTheme);
  const [dashboardBgByTheme, setDashboardBgByTheme] =
    useState<WorkspaceDashboardBgMap>(initialDashboardBg);
  const [colorModePreference, setColorModePreferenceState] =
    useState<WorkspaceColorModePreference>(initialColorMode);
  const [systemIsDark, setSystemIsDark] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setSystemIsDark(mq.matches);
    const onChange = (event: MediaQueryListEvent) => setSystemIsDark(event.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

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

  const setColorModePreference = useCallback((next: WorkspaceColorModePreference) => {
    setColorModePreferenceState(next);
    writeWorkspaceCookie(WORKSPACE_COLOR_MODE_COOKIE, next);
  }, []);

  const toggleColorMode = useCallback(() => {
    setColorModePreferenceState((currentPref) => {
      const currentDark =
        currentPref === "system"
          ? typeof window !== "undefined" &&
            typeof window.matchMedia === "function" &&
            window.matchMedia("(prefers-color-scheme: dark)").matches
          : currentPref === "dark";
      const next: WorkspaceColorModePreference = currentDark ? "light" : "dark";
      writeWorkspaceCookie(WORKSPACE_COLOR_MODE_COOKIE, next);
      return next;
    });
  }, []);

  const isDashboardBgEnabled = Boolean(dashboardBgByTheme[theme]);
  const resolvedColorMode: WorkspaceResolvedColorMode =
    colorModePreference === "system" ? (systemIsDark ? "dark" : "light") : colorModePreference;

  return (
    <WorkspaceThemeContext.Provider
      value={{
        theme,
        setTheme,
        dashboardBgByTheme,
        isDashboardBgEnabled,
        setThemeDashboardBg,
        colorModePreference,
        resolvedColorMode,
        setColorModePreference,
        toggleColorMode,
      }}
    >
      <div
        className="workspace-shell"
        data-theme={theme}
        data-dashboard-bg={isDashboardBgEnabled ? "on" : "off"}
        data-color-mode={colorModePreference}
      >
        {children}
      </div>
    </WorkspaceThemeContext.Provider>
  );
}
