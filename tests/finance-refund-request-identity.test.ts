import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { syntheticRefundIdentity, syntheticRefundReplayMatches } from "../prototypes/finance-refund-request-identity/identity.test-only";
import type { MoneyMovementInput } from "../src/lib/commerce-validation";

const input: MoneyMovementInput = { requestId: "synthetic", saleId: "12", amount: "6.00", method: "CASH", actuallyPaid: true, accountId: "5", negativeAcknowledged: false };
const review = { checkpointRef: "7", timing: "AFTER_REVIEWED_CHECKPOINT" };
const identity = (raw: unknown, value = input, actor = 1n) => syntheticRefundIdentity(actor, value, raw);
const prior = (requestHash: string, createdById = 1n) => ({ requestHash, createdById });

test("legacy retries replay without inventing a checkpoint; new writes must have a review", () => {
  const legacy = identity({});
  const exactOldHash = createHash("sha256").update(JSON.stringify({ actorId: "1", type: "REFUND", ...input })).digest("hex");
  assert.equal(legacy.baseHash, exactOldHash);
  assert.equal(legacy.review, null);
  assert.equal(syntheticRefundReplayMatches(prior(exactOldHash), 1n, legacy), true);
  assert.equal(syntheticRefundReplayMatches(prior(exactOldHash), 1n, identity(review)), false);
  assert.equal(syntheticRefundReplayMatches(prior(exactOldHash, 2n), 1n, legacy), false);
  assert.equal(syntheticRefundReplayMatches(prior(exactOldHash), 1n, identity({}, { ...input, amount: "7.00" })), false);
});

test("new request identity binds actor, amount, account, checkpoint and timing", () => {
  const reviewed = identity(review);
  assert.ok(reviewed.reviewedHash);
  const existing = prior(reviewed.reviewedHash);
  assert.equal(syntheticRefundReplayMatches(existing, 1n, identity(review)), true);
  for (const altered of [
    identity({ ...review, checkpointRef: "8" }),
    identity({ ...review, checkpointRef: "OPENING" }),
    identity({ ...review, timing: "UNKNOWN" }),
    identity({ ...review, timing: "BEFORE_REVIEWED_CHECKPOINT" }),
    identity({ checkpointRef: "7" }), identity({}),
    identity(review, { ...input, accountId: "6" }),
    identity(review, { ...input, amount: "5.00" }),
    identity(review, input, 2n),
  ]) assert.equal(syntheticRefundReplayMatches(existing, 1n, altered), false);
});

test("malformed and noncanonical checkpoint input fails closed", () => {
  for (const ref of ["", "00", "01", " 7", "7 ", "9223372036854775808", "7 OR true", 7, null]) {
    const candidate = identity({ ...review, checkpointRef: ref });
    assert.equal(candidate.review, null);
    assert.equal(candidate.reviewedHash, null);
    assert.equal(syntheticRefundReplayMatches(prior(candidate.baseHash), 1n, candidate), false);
  }
  assert.equal(identity({ ...review, checkpointRef: "OPENING" }).review?.checkpointRef, "OPENING");
  assert.equal(identity({ ...review, checkpointRef: "9223372036854775807" }).review?.checkpointRef, "9223372036854775807");
});
