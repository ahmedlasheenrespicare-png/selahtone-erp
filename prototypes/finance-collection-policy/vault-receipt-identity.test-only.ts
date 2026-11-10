/**
 * Disposable identity experiment, NOT a production command or permission.
 * Applies only to a later collection's normalized payload. The caller must
 * authorize the actor and branch and must require `reviewedHash` for any NEW
 * vault write; matching an old base hash is replay only, never an attestation.
 * This does not cover initial-sale request identities or authenticate history.
 */
import { createHash } from "node:crypto";
import type { MoneyMovementInput } from "../../src/lib/commerce-validation";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function vaultReceiptIdentityTestOnly(actorId: bigint, input: MoneyMovementInput, raw: unknown) {
  // Preserve the existing later-collection hash shape, including key order.
  const baseHash = hash({ actorId: actorId.toString(), type: "COLLECTION", ...input });
  const object = typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? raw as Record<string, unknown> : {};
  const hasReceipt = Object.hasOwn(object, "vaultReceived");
  const acknowledged = hasReceipt && object.vaultReceived === true;
  const reviewedHash = acknowledged
    ? hash({ actorId: actorId.toString(), type: "COLLECTION", ...input, vaultReceiptVersion: 1, vaultReceived: true })
    : null;
  return { baseHash, hasReceipt, acknowledged, reviewedHash };
}

/** Identity match only. The caller is responsible for current authorization. */
export function vaultReceiptReplayMatchesTestOnly(
  existing: { createdById: bigint; requestHash: string }, actorId: bigint,
  identity: ReturnType<typeof vaultReceiptIdentityTestOnly>,
): boolean {
  if (existing.createdById !== actorId) return false;
  const submitted = identity.hasReceipt ? identity.reviewedHash : identity.baseHash;
  return submitted !== null && existing.requestHash.trim() === submitted;
}
