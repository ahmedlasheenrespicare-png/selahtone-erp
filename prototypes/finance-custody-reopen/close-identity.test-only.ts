/**
 * Pure synthetic close-request identity experiment. Not a command, an
 * authorization mechanism, or a production integration. Callers must normalize
 * the original inputs exactly like closeAccount, authorize current access,
 * require the reviewed identity on new writes and compare the reviewed
 * account snapshot under lock in the same SERIALIZABLE transaction.
 */
import { createHash } from "node:crypto";

type CloseInput = { requestId: string; accountId: string; reason: string | null };
type ReviewedAccount = { id: string; branchId: string; kind: "VAULT" | "CUSTODY"; holderId: string | null; closed: boolean };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** A comparison fingerprint, not proof of review, physical custody or history. */
export function syntheticCloseAccountSnapshot(account: ReviewedAccount): string {
  return hash(["close-account-v1", account.id, account.branchId, account.kind, account.holderId, account.closed]);
}

/** Revision must be a canonical nonnegative integer from the account row. */
export function syntheticCloseAccountSnapshotV2(account: ReviewedAccount & {revision:string}): string {
  if (!/^(0|[1-9]\d{0,18})$/.test(account.revision)) throw new Error("invalid synthetic account revision");
  return hash(["close-account-v2", account.id, account.branchId, account.kind, account.holderId, account.closed, account.revision]);
}

export function syntheticCloseRequestIdentity(actorId: string, input: CloseInput, raw: unknown) {
  // Exact current engine CLOSE_ACCOUNT digest payload shape and property order.
  const legacyHash = hash({ actorId, action: "CLOSE_ACCOUNT", payload: input });
  const object = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const hasSnapshot = Object.hasOwn(object, "expectedAccountSnapshot");
  const hasVersion = Object.hasOwn(object, "reviewVersion");
  const snapshot = object.expectedAccountSnapshot;
  const validSnapshot = hasSnapshot && typeof snapshot === "string" && /^[a-f0-9]{64}$/.test(snapshot);
  const version = hasVersion ? object.reviewVersion === 2 ? 2 : null : 1;
  const reviewedHash = validSnapshot && version !== null
    ? hash({ actorId, action: "CLOSE_ACCOUNT", payload: version === 2
      ? { ...input, reviewVersion: 2, expectedAccountSnapshot: snapshot }
      : { ...input, expectedAccountSnapshot: snapshot } })
    : null;
  return { legacyHash, hasSnapshot, hasReview: hasSnapshot || hasVersion, version, reviewedHash };
}

/** Hash comparison only; current authorization and locked state remain separate. */
export function syntheticCloseReplayMatches(
  existing: { actorId: string; action: string; requestHash: string },
  actorId: string,
  identity: ReturnType<typeof syntheticCloseRequestIdentity>,
): boolean {
  if (existing.actorId !== actorId || existing.action !== "CLOSE_ACCOUNT") return false;
  const submitted = identity.hasReview ? identity.reviewedHash : identity.legacyHash;
  return submitted !== null && existing.requestHash.trim() === submitted;
}
