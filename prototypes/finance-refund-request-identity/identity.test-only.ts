import { createHash } from "node:crypto";
import { positiveDatabaseId } from "../../src/lib/inventory-validation";
import type { MoneyMovementInput } from "../../src/lib/commerce-validation";

type Review = { checkpointRef: string; timing: "AFTER_REVIEWED_CHECKPOINT" };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Experimental request identity; no DB I/O. The base hash preserves the exact legacy shape. */
export function syntheticRefundIdentity(actorId: bigint, input: MoneyMovementInput, raw: unknown) {
  const baseHash = hash({ actorId: actorId.toString(), type: "REFUND", ...input });
  const object = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const hasReview = Object.hasOwn(object, "checkpointRef") || Object.hasOwn(object, "timing");
  const ref = typeof object.checkpointRef === "string" ? object.checkpointRef : "";
  // Reject non-canonical spellings rather than silently changing a reviewed identity.
  const checkpoint = ref === "OPENING" ? ref : positiveDatabaseId(ref);
  const canonical = checkpoint !== null && checkpoint === ref;
  const review: Review | null = canonical && object.timing === "AFTER_REVIEWED_CHECKPOINT"
    ? { checkpointRef: checkpoint!, timing: "AFTER_REVIEWED_CHECKPOINT" } : null;
  const reviewedHash = review ? hash({ actorId: actorId.toString(), type: "REFUND", ...input, refundCheckpointVersion: 1, review }) : null;
  return { baseHash, hasReview, review, reviewedHash };
}

/** Replay only the precise submitted version, never synthesize a review for legacy rows. */
export function syntheticRefundReplayMatches(
  existing: { createdById: bigint; requestHash: string }, actorId: bigint,
  identity: ReturnType<typeof syntheticRefundIdentity>,
): boolean {
  if (existing.createdById !== actorId) return false;
  const submittedHash = identity.hasReview ? identity.reviewedHash : identity.baseHash;
  return submittedHash !== null && existing.requestHash.trim() === submittedHash;
}
