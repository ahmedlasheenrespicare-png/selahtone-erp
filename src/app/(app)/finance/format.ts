/** Shared display helpers for finance screens. No database access, safe on both sides.
 * Amounts arrive as PostgreSQL numeric text; formatting is display-only and never
 * feeds an amount back into a command. */
export function formatMoney(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  return parsed.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function accountLabel(kind: string): string {
  return kind === "VAULT" ? "خزنة الفرع" : "عهدة موظف";
}
export function statusLabel(kind: unknown): string {
  return kind === "VAULT" ? "خزنة" : "عهدة";
}
