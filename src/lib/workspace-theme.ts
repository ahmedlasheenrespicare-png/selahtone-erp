export type WorkspaceThemeId = "wallet";

export type WorkspaceThemeOption = {
  id: WorkspaceThemeId;
  label: string;
};

export const DEFAULT_WORKSPACE_THEME: WorkspaceThemeId = "wallet";
export const WORKSPACE_THEME_COOKIE = "selahtone_theme";

export const WORKSPACE_THEMES: readonly WorkspaceThemeOption[] = [
  { id: "wallet", label: "الحافظة" },
];

export function resolveWorkspaceTheme(value: string | undefined | null): WorkspaceThemeId {
  if (value && WORKSPACE_THEMES.some((item) => item.id === value)) {
    return value as WorkspaceThemeId;
  }
  return DEFAULT_WORKSPACE_THEME;
}
