import type { AccountScope, Actor } from "./types";

export function activeActor(actor: Actor | null): actor is Actor {
  return Boolean(actor && actor.status === "ACTIVE" && !actor.mustChangePassword && ["MANAGER", "ACCOUNTANT", "CS_AGENT"].includes(actor.role));
}
export function canManageFinance(actor: Actor | null): boolean {
  return activeActor(actor) && (actor.role === "MANAGER" || actor.role === "ACCOUNTANT");
}
export function canViewAccount(actor: Actor | null, account: AccountScope): boolean {
  if (!activeActor(actor)) return false;
  if (canManageFinance(actor)) return true;
  return actor.role === "CS_AGENT" && actor.branchId === account.branchId && account.kind === "CUSTODY" && account.holderId === actor.id;
}
/** For a cash collection, a staff member may choose only the branch vault or their own custody. */
export function canCollectTo(actor: Actor | null, branchId: string, account: AccountScope): boolean {
  if (!activeActor(actor) || account.branchId !== branchId) return false;
  if (canManageFinance(actor)) return true;
  return actor.role === "CS_AGENT" && actor.branchId === branchId && (account.kind === "VAULT" || (account.kind === "CUSTODY" && account.holderId === actor.id));
}
