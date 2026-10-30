/**
 * Per-account menu scope. A manager or an accountant may be given a LIMITED
 * scope: they keep their role, but the app itself refuses every screen outside
 * their short list, so hiding an entry in the sidebar is never the only guard.
 */

export type MenuScope = "FULL" | "LIMITED";

export const MENU_SCOPES: readonly MenuScope[] = ["FULL", "LIMITED"] as const;

export const MENU_SCOPE_LABELS: Record<MenuScope, string> = {
  FULL: "قائمة كاملة (حسب الدور)",
  LIMITED: "قائمة مختصرة: لوحة القيادة، المبيعات والفواتير، المصروفات",
};

export function isMenuScope(value: string): value is MenuScope {
  return value === "FULL" || value === "LIMITED";
}

/** Prefixes a LIMITED account may open. Everything else goes to the dashboard. */
const LIMITED_PREFIXES: readonly string[] = ["/dashboard", "/sales", "/finance/expenses"];

export function isPathAllowedForScope(scope: MenuScope, pathname: string | null | undefined): boolean {
  if (scope === "FULL") return true;
  const path = typeof pathname === "string" ? pathname : "";
  if (path === "" || path === "/") return true;
  // مسارات API لها حمايتها الخاصة ولا تُعرض في القائمة.
  if (path === "/api" || path.startsWith("/api/")) return true;
  return LIMITED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
