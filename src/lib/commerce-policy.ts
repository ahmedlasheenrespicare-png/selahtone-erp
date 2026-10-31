/**
 * Agreed commerce authorization policy for a future server implementation.
 * The caller MUST reload the actor, branch and warehouse from the database inside
 * the transaction; never trust a role or branch supplied by the browser.
 */
export type CommerceRole = "MANAGER" | "ACCOUNTANT" | "CS_AGENT";
export type CommerceActor = {
  role: CommerceRole;
  status: "ACTIVE" | "SUSPENDED";
  mustChangePassword: boolean;
  branchId: bigint | null;
  /// صلاحية إلغاء البيع: يسحبها المدير من أي محاسب بلا حذف الحساب.
  canCancelSales: boolean;
};
export type CommerceAction =
  | "VIEW_SALE"
  | "CREATE_SALE"
  | "RECORD_COLLECTION"
  | "RETURN_OR_CANCEL"
  | "RECORD_REFUND"
  | "RECEIVE_STOCK"
  | "CONFIGURE_DISCOUNT";

const accountantActions = new Set<CommerceAction>(["VIEW_SALE", "RECORD_COLLECTION", "RECORD_REFUND", "RETURN_OR_CANCEL"]);
const staffActions = new Set<CommerceAction>(["VIEW_SALE", "CREATE_SALE", "RECORD_COLLECTION", "RECEIVE_STOCK"]);
const allActions = new Set<CommerceAction>([...accountantActions, ...staffActions, "RETURN_OR_CANCEL", "CONFIGURE_DISCOUNT"]);

/** Fail closed for unauthenticated, suspended, password-reset and branchless staff. */
export function canPerformCommerce(
  actor: CommerceActor | null,
  action: CommerceAction,
  resourceBranchId: bigint | null,
  resourceBranchActive: boolean,
): boolean {
  if (!actor || actor.status !== "ACTIVE" || actor.mustChangePassword || !allActions.has(action)) return false;
  if (action === "CONFIGURE_DISCOUNT") return actor.role === "MANAGER";
  if (typeof resourceBranchId !== "bigint" || resourceBranchId <= 0n || typeof resourceBranchActive !== "boolean") return false;
  // New sales and receipts require an active branch. Historical obligations must
  // remain visible and settleable even if a branch was later deactivated.
  if (!resourceBranchActive && (action === "CREATE_SALE" || action === "RECEIVE_STOCK")) return false;
  if (actor.role === "MANAGER") return true;
  if (actor.role === "ACCOUNTANT") {
    if (!accountantActions.has(action)) return false;
    // إلغاء البيع صلاحية يملكها المحاسب افتراضيًا، ويسحبها المدير متى شاء.
    return action !== "RETURN_OR_CANCEL" || actor.canCancelSales;
  }
  if (actor.role === "CS_AGENT") return actor.branchId !== null && actor.branchId === resourceBranchId && staffActions.has(action);
  return false;
}
