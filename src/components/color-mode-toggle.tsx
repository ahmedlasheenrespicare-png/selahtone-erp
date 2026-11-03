"use client";

import { AppIcon } from "@/components/app-icon";
import { useWorkspaceTheme } from "@/app/(app)/workspace-theme-provider";

export default function ColorModeToggle() {
  const { resolvedColorMode, toggleColorMode } = useWorkspaceTheme();
  const isDark = resolvedColorMode === "dark";
  const nextLabel = isDark ? "التبديل إلى الوضع النهاري" : "التبديل إلى الوضع الليلي";

  return (
    <button
      type="button"
      className="workspace-account-link workspace-color-mode-btn"
      onClick={toggleColorMode}
      title={nextLabel}
      aria-label={nextLabel}
      aria-pressed={isDark}
    >
      <AppIcon name={isDark ? "sun" : "moon"} />
      <span>{isDark ? "نهاري" : "ليلي"}</span>
    </button>
  );
}
