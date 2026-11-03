export type WorkspaceThemeId = "wallet" | "wallet-selahtone";

export const DEFAULT_WORKSPACE_THEME: WorkspaceThemeId = "wallet";

export const WORKSPACE_THEME_COOKIE = "selahtone_theme";
export const WORKSPACE_DASHBOARD_BG_COOKIE = "selahtone_dashboard_bg";

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

export type WorkspaceDashboardBgMap = Record<WorkspaceThemeId, boolean>;

export const DEFAULT_DASHBOARD_BG_MAP: WorkspaceDashboardBgMap = {
  wallet: false,
  "wallet-selahtone": false,
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

export function resolveWorkspaceDashboardBg(
  value: string | undefined | null,
): WorkspaceDashboardBgMap {
  const next: WorkspaceDashboardBgMap = { ...DEFAULT_DASHBOARD_BG_MAP };
  if (!value || value === "none") {
    return next;
  }
  for (const raw of value.split(",")) {
    const id = raw.trim();
    if (WORKSPACE_THEMES.some((item) => item.id === id)) {
      next[id as WorkspaceThemeId] = true;
    }
  }
  return next;
}

export function serializeWorkspaceDashboardBg(map: WorkspaceDashboardBgMap): string {
  const enabled = WORKSPACE_THEMES.map((item) => item.id).filter((id) => map[id]);
  return enabled.length > 0 ? enabled.join(",") : "none";
}
