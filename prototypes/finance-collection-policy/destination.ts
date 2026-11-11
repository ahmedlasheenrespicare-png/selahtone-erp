/** Experimental pure policy. NOT wired to sales or finance writes.
 * Callers must reload the actor and lock/validate the chosen account in the
 * same transaction as the collection; this function cannot provide that lock.
 */
export type Collector = { id: string; role: "MANAGER" | "ACCOUNTANT" | "CS_AGENT"; branchId: string | null; active: boolean; mustChangePassword: boolean };
export type CashAccount = { id: string; branchId: string; kind: "VAULT" | "CUSTODY"; holderId: string | null; closed: boolean };
export type Destination = { ok: true; accountId: string; kind: "VAULT" | "CUSTODY" } | { ok: false; reason: "forbidden" | "no_custody" | "no_vault" | "ambiguous" };

export function chooseCashDestination(actor: Collector, branchId: string, accounts: readonly CashAccount[]): Destination {
  if (!actor.active || actor.mustChangePassword || (actor.role === "CS_AGENT" && actor.branchId !== branchId)) return { ok: false, reason: "forbidden" };
  const open = accounts.filter((account) => account.branchId === branchId && !account.closed);
  const own = open.filter((account) => account.kind === "CUSTODY" && account.holderId === actor.id);
  if (own.length > 1) return { ok: false, reason: "ambiguous" };
  if (own.length === 1) return { ok: true, accountId: own[0].id, kind: "CUSTODY" };
  if (actor.role === "CS_AGENT") return { ok: false, reason: "no_custody" };
  const vaults = open.filter((account) => account.kind === "VAULT" && account.holderId === null);
  if (vaults.length > 1) return { ok: false, reason: "ambiguous" };
  if (!vaults.length) return { ok: false, reason: "no_vault" };
  return { ok: true, accountId: vaults[0].id, kind: "VAULT" };
}
