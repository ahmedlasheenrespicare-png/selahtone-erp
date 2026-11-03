"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  DEFAULT_DASHBOARD_BG_MAP,
  DEFAULT_WORKSPACE_COLOR_MODE,
  DEFAULT_WORKSPACE_THEME,
  getWorkspaceClockSnapshot,
  serializeWorkspaceColorModeCookie,
  serializeWorkspaceDashboardBg,
  WORKSPACE_COLOR_MODE_COOKIE,
  WORKSPACE_DASHBOARD_BG_COOKIE,
  WORKSPACE_THEME_COOKIE,
  WORKSPACE_TIMEZONE,
  type WorkspaceClockSnapshot,
  type WorkspaceColorMode,
  type WorkspaceDashboardBgMap,
  type WorkspaceThemeId,
} from "@/lib/workspace-theme";

type WorkspaceThemeContextValue = {
  theme: WorkspaceThemeId;
  setTheme: (next: WorkspaceThemeId) => void;
  dashboardBgByTheme: WorkspaceDashboardBgMap;
  isDashboardBgEnabled: boolean;
  setThemeDashboardBg: (targetTheme: WorkspaceThemeId, enabled: boolean) => void;
  colorMode: WorkspaceColorMode;
  isAutoTimeMode: boolean;
  clock: WorkspaceClockSnapshot;
  setColorMode: (next: WorkspaceColorMode) => void;
  toggleColorMode: () => void;
  enableAutoTimeMode: () => void;
};

const FALLBACK_CLOCK: WorkspaceClockSnapshot = {
  hour: 12,
  minute: 0,
  isDaylight: true,
  autoColorMode: "light",
  skyPhase: "day",
  orbitDeg: 0,
  periodKey: "2026-01-01-day",
  timeFormatted: "12:00",
  dateFormatted: "",
  isoDate: "2026-01-01",
  msUntilNextBoundary: 21_600_000,
};

const WorkspaceThemeContext = createContext<WorkspaceThemeContextValue>({
  theme: DEFAULT_WORKSPACE_THEME,
  setTheme: () => {},
  dashboardBgByTheme: DEFAULT_DASHBOARD_BG_MAP,
  isDashboardBgEnabled: false,
  setThemeDashboardBg: () => {},
  colorMode: DEFAULT_WORKSPACE_COLOR_MODE,
  isAutoTimeMode: true,
  clock: FALLBACK_CLOCK,
  setColorMode: () => {},
  toggleColorMode: () => {},
  enableAutoTimeMode: () => {},
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
  initialIsAutoTimeMode = true,
  initialClock,
  children,
}: {
  initialTheme?: WorkspaceThemeId;
  initialDashboardBg?: WorkspaceDashboardBgMap;
  initialColorMode?: WorkspaceColorMode;
  initialIsAutoTimeMode?: boolean;
  initialClock?: WorkspaceClockSnapshot;
  children: React.ReactNode;
}) {
  const [theme, setThemeState] = useState<WorkspaceThemeId>(initialTheme);
  const [dashboardBgByTheme, setDashboardBgByTheme] =
    useState<WorkspaceDashboardBgMap>(initialDashboardBg);
  const [colorMode, setColorModeState] = useState<WorkspaceColorMode>(initialColorMode);
  const [isAutoTimeMode, setIsAutoTimeMode] = useState<boolean>(initialIsAutoTimeMode);
  const [clock, setClock] = useState<WorkspaceClockSnapshot>(
    () => initialClock ?? getWorkspaceClockSnapshot(new Date(), WORKSPACE_TIMEZONE),
  );

  const periodKeyRef = useRef<string>(clock.periodKey);
  const isAutoRef = useRef<boolean>(initialIsAutoTimeMode);
  isAutoRef.current = isAutoTimeMode;

  const syncWithClock = useCallback(() => {
    const nextClock = getWorkspaceClockSnapshot(new Date(), WORKSPACE_TIMEZONE);
    setClock((prev) => {
      if (
        prev.timeFormatted === nextClock.timeFormatted &&
        prev.periodKey === nextClock.periodKey &&
        prev.skyPhase === nextClock.skyPhase &&
        prev.orbitDeg === nextClock.orbitDeg &&
        prev.isoDate === nextClock.isoDate
      ) {
        return prev;
      }
      return nextClock;
    });

    // عند حلول الليل (18:00) أو حلول النهار (06:00) يتحوّل النظام تلقائيًا للوضع الموافق للوقت الجديد
    if (nextClock.periodKey !== periodKeyRef.current) {
      periodKeyRef.current = nextClock.periodKey;
      isAutoRef.current = true;
      setIsAutoTimeMode(true);
      setColorModeState(nextClock.autoColorMode);
      writeWorkspaceCookie(WORKSPACE_COLOR_MODE_COOKIE, "auto");
      return;
    }

    if (isAutoRef.current) {
      setColorModeState(nextClock.autoColorMode);
    }
  }, []);

  useEffect(() => {
    syncWithClock();

    const intervalId = window.setInterval(syncWithClock, 30_000);
    let boundaryTimeoutId: number | undefined;

    const scheduleBoundary = () => {
      const snap = getWorkspaceClockSnapshot(new Date(), WORKSPACE_TIMEZONE);
      boundaryTimeoutId = window.setTimeout(() => {
        syncWithClock();
        scheduleBoundary();
      }, snap.msUntilNextBoundary + 350);
    };
    scheduleBoundary();

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        syncWithClock();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", syncWithClock);

    return () => {
      window.clearInterval(intervalId);
      if (boundaryTimeoutId !== undefined) {
        window.clearTimeout(boundaryTimeoutId);
      }
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", syncWithClock);
    };
  }, [syncWithClock]);

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

  const applyColorChoice = useCallback((next: WorkspaceColorMode) => {
    const snap = getWorkspaceClockSnapshot(new Date(), WORKSPACE_TIMEZONE);
    periodKeyRef.current = snap.periodKey;
    setClock(snap);
    setColorModeState(next);
    const cookieVal = serializeWorkspaceColorModeCookie(next, snap);
    const autoNow = cookieVal === "auto";
    isAutoRef.current = autoNow;
    setIsAutoTimeMode(autoNow);
    writeWorkspaceCookie(WORKSPACE_COLOR_MODE_COOKIE, cookieVal);
  }, []);

  const setColorMode = useCallback(
    (next: WorkspaceColorMode) => {
      applyColorChoice(next);
    },
    [applyColorChoice],
  );

  const toggleColorMode = useCallback(() => {
    setColorModeState((current) => {
      const next: WorkspaceColorMode = current === "dark" ? "light" : "dark";
      const snap = getWorkspaceClockSnapshot(new Date(), WORKSPACE_TIMEZONE);
      periodKeyRef.current = snap.periodKey;
      setClock(snap);
      const cookieVal = serializeWorkspaceColorModeCookie(next, snap);
      const autoNow = cookieVal === "auto";
      isAutoRef.current = autoNow;
      setIsAutoTimeMode(autoNow);
      writeWorkspaceCookie(WORKSPACE_COLOR_MODE_COOKIE, cookieVal);
      return next;
    });
  }, []);

  const enableAutoTimeMode = useCallback(() => {
    const snap = getWorkspaceClockSnapshot(new Date(), WORKSPACE_TIMEZONE);
    periodKeyRef.current = snap.periodKey;
    isAutoRef.current = true;
    setClock(snap);
    setIsAutoTimeMode(true);
    setColorModeState(snap.autoColorMode);
    writeWorkspaceCookie(WORKSPACE_COLOR_MODE_COOKIE, "auto");
  }, []);

  const isDashboardBgEnabled = Boolean(dashboardBgByTheme[theme]);

  return (
    <WorkspaceThemeContext.Provider
      value={{
        theme,
        setTheme,
        dashboardBgByTheme,
        isDashboardBgEnabled,
        setThemeDashboardBg,
        colorMode,
        isAutoTimeMode,
        clock,
        setColorMode,
        toggleColorMode,
        enableAutoTimeMode,
      }}
    >
      <div
        className="workspace-shell"
        data-theme={theme}
        data-color-mode={colorMode}
        data-sky-phase={colorMode === "dark" ? "night" : clock.skyPhase === "night" ? "day" : clock.skyPhase}
        data-design="new"
        data-dashboard-bg={isDashboardBgEnabled ? "on" : "off"}
      >
        {children}
      </div>
    </WorkspaceThemeContext.Provider>
  );
}
