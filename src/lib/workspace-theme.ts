export type WorkspaceThemeId = "wallet" | "wallet-selahtone";

export const DEFAULT_WORKSPACE_THEME: WorkspaceThemeId = "wallet";

export const WORKSPACE_THEME_COOKIE = "selahtone_theme";

export type WorkspaceThemeVariant = {
  id: WorkspaceThemeId;
  label: string;
  swatch: string;
  ring: string;
};

export type WorkspaceThemeGroup = {
  id: string;
  label: string;
  variants: readonly WorkspaceThemeVariant[];
};

export const WORKSPACE_THEME_GROUPS: readonly WorkspaceThemeGroup[] = [
  {
    id: "wallet-group",
    label: "الحافظة",
    variants: [
      { id: "wallet", label: "الافتراضي", swatch: "#1e341e", ring: "#9bd86a" },
      { id: "wallet-selahtone", label: "صلة تون", swatch: "#339fc1", ring: "#040b5b" },
    ],
  },
];

export const WORKSPACE_THEMES: readonly WorkspaceThemeVariant[] =
  WORKSPACE_THEME_GROUPS.flatMap((group) => group.variants);

export function resolveWorkspaceTheme(value: string | undefined | null): WorkspaceThemeId {
  if (WORKSPACE_THEMES.some((item) => item.id === value)) {
    return value as WorkspaceThemeId;
  }
  return DEFAULT_WORKSPACE_THEME;
}
