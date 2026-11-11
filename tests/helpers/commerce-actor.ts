import type { TransactionActor } from "../../src/lib/transaction-access";

/** Synthetic identities only; fixtures create matching auth_sessions rows. */
export function actor(id: bigint): TransactionActor {
  return { id, sessionId: `synthetic-commerce-session-${id.toString()}` };
}
