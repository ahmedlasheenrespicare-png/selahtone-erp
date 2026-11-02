"use client";

import { createContext, useCallback, useContext, useState } from "react";
import {
  DEFAULT_WORKSPACE_THEME,
  WORKSPACE_THEME_COOKIE,
  type WorkspaceThemeId,
} from "@/lib/workspace-theme";

type WorkspaceThemeContextValue = {
  theme: WorkspaceThemeId;
  setTheme: (next: WorkspaceThemeId) => void;
};

const WorkspaceThemeContext = createContext<WorkspaceThemeContextValue>({
  theme: DEFAULT_WORKSPACE_THEME,
  setTheme: () => {},
});

export function useWorkspaceTheme(): WorkspaceThemeContextValue {
  return useContext(WorkspaceThemeContext);
}

export function WorkspaceThemeProvider({
  initialTheme = DEFAULT_WORKSPACE_THEME,
  children,
}: {
  initialTheme?: WorkspaceThemeId;
  children: React.ReactNode;
}) {
  const [theme, setThemeState] = useState<WorkspaceThemeId>(initialTheme);

  const setTheme = useCallback((next: WorkspaceThemeId) => {
    setThemeState(next);
    if (typeof document !== "undefined") {
      const isHttps = typeof window !== "undefined" && window.location.protocol === "https:";
      const attrs = isHttps
        ? "Path=/; Max-Age=31536000; SameSite=None; Secure; Partitioned"
        : "Path=/; Max-Age=31536000; SameSite=Lax";
      document.cookie = `${WORKSPACE_THEME_COOKIE}=${encodeURIComponent(next)}; ${attrs}`;
    }
  }, []);

  return (
    <WorkspaceThemeContext.Provider value={{ theme, setTheme }}>
      <div className="workspace-shell" data-theme={theme}>
        {children}
      </div>
    </WorkspaceThemeContext.Provider>
  );
}
