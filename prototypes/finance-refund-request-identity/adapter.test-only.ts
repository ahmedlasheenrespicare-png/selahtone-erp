/** Isolated transaction interceptor for synthetic tests only, not production. */
import type { PrismaClient } from "@prisma/client";
import { parseMoneyMovement } from "../../src/lib/commerce-validation";
import { syntheticRefundIdentity, syntheticRefundReplayMatches } from "./identity.test-only";

/**
 * Demonstrates storing/replaying versioned identities through the real service.
 * Intercepts Prisma delegate calls and verifies their arguments. This is not a
 * production implementation or proof of real unique-constraint race handling.
 */
export function testRefundIdentity(db: PrismaClient, actorId: bigint, raw: unknown, snapshot?: { accountId: string; checkpointRef: string }): PrismaClient {
  const parsed = parseMoneyMovement(raw, true);
  if (!parsed.ok || parsed.value.method !== "CASH" || !parsed.value.accountId) throw new Error("test requires a valid cash refund");
  const input = parsed.value;
  const identity = syntheticRefundIdentity(actorId, input, raw);
  const replayResult = <T extends { createdById: bigint; requestHash: string }>(row: T | null): T | null => {
    if (!row) return null;
    return { ...row, requestHash: syntheticRefundReplayMatches(row, actorId, identity) ? identity.baseHash : "synthetic-mismatch" };
  };
  return new Proxy(db, { get(target, key, receiver) {
    if (key === "commerceRefund") {
      const delegate = target.commerceRefund;
      return new Proxy(delegate, { get(object, prop, recv) {
        if (prop !== "findUnique") return Reflect.get(object, prop, recv);
        return async (args: { where: { requestId: string } }) => {
          if (args.where.requestId !== input.requestId) throw new Error("unexpected synthetic request lookup");
          return replayResult(await delegate.findUnique(args));
        };
      } });
    }
    if (key !== "$transaction") return Reflect.get(target, key, receiver);
    return (work: (tx: unknown) => Promise<unknown>, options: unknown) => target.$transaction(async tx => {
      const delegate = tx.commerceRefund;
      const refunds = new Proxy(delegate, { get(object, prop, recv) {
        if (prop === "findUnique") return async (args: { where: { requestId: string } }) => {
          if (args.where.requestId !== input.requestId) throw new Error("unexpected synthetic request lookup");
          const row = await delegate.findUnique(args);
          // The unmodified service compares the legacy hash. Only in this test,
          // a verified reviewed identity is represented as its legacy equivalent.
          return replayResult(row);
        };
        if (prop === "create") return async (args: { data: { requestId: string; requestHash: string; saleId: bigint; amount: string; method: string; createdById: bigint } }) => {
          const data = args.data;
          if (!identity.review || !identity.reviewedHash) throw new Error("الرد متوقف للمراجعة؛ لم يُسجّل رد أو حركة نقدية.");
          if (!snapshot || snapshot.accountId !== input.accountId || snapshot.checkpointRef !== identity.review.checkpointRef)
            throw new Error("synthetic identity does not match checkpoint review");
          if (data.requestId !== input.requestId || data.requestHash !== identity.baseHash || data.saleId.toString() !== input.saleId ||
              data.amount !== input.amount || data.method !== input.method || data.createdById !== actorId)
            throw new Error("synthetic identity does not match source refund");
          return delegate.create({ ...args, data: { ...data, requestHash: identity.reviewedHash } } as never);
        };
        return Reflect.get(object, prop, recv);
      } });
      const wrapped = new Proxy(tx, { get(object, prop, recv) { return prop === "commerceRefund" ? refunds : Reflect.get(object, prop, recv); } });
      return work(wrapped);
    }, options as never);
  } }) as PrismaClient;
}
