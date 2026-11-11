/** Synthetic experiment only: never import from application code. */
import type { PrismaClient } from "@prisma/client";
import { assertAfterLatestCheckpointInTransaction } from "../../src/lib/finance/engine";
import { financePort } from "../../src/lib/finance/port";
import { checkSyntheticRefundTiming, type RefundTiming } from "./policy.test-only";

/**
 * Wrap the real service transaction for a single synthetic reviewed refund.
 * The caller supplies an alleged review, not proof of a physical payment.
 * This intercepts specific Prisma/SQL shapes and is NOT a production adapter.
 */
export function testRefundCheckpoint(db: PrismaClient, review: {
  actorId: string; branchId: string; saleId: string; accountId: string;
  checkpointRef: string; afterCheckpoint: boolean; timing: RefundTiming;
}): PrismaClient {
  return new Proxy(db, { get(target, key, receiver) {
    if (key !== "$transaction") return Reflect.get(target, key, receiver);
    return (work: (tx: unknown) => Promise<unknown>, options: unknown) => target.$transaction(async tx => {
      let createdRefund: string | null = null;
      let recordedMovement = false;
      const refunds = new Proxy(tx.commerceRefund, { get(delegate, prop, recv) {
        if (prop !== "create") return Reflect.get(delegate, prop, recv);
        return async (args: { data: { saleId: bigint; method: string; createdById: bigint } }) => {
          if (args.data.method !== "CASH" || args.data.saleId.toString() !== review.saleId || args.data.createdById.toString() !== review.actorId)
            throw new Error("test refund review does not match the real source");
          checkSyntheticRefundTiming(review.timing);
          const result = await delegate.create(args as never) as { id: bigint };
          createdRefund = result.id.toString();
          await assertAfterLatestCheckpointInTransaction(financePort(tx), review.actorId, {
            branchId: review.branchId, accountId: review.accountId, checkpointRef: review.checkpointRef,
            afterCheckpoint: review.afterCheckpoint, refund: true,
          });
          return result;
        };
      } });
      const wrapped = new Proxy(tx, { get(obj, prop, recv) {
        if (prop === "commerceRefund") return refunds;
        if (prop !== "$queryRawUnsafe") return Reflect.get(obj, prop, recv);
        return async (sql: string, ...params: unknown[]) => {
          const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(sql, ...params);
          if (sql.includes("INSERT INTO finance.movements(kind,branch_id,source_id,amount,external_ref,actor_id,after_cash_count_id,after_opening)")) {
            if (!createdRefund || recordedMovement || String(params[0]) !== review.branchId || String(params[1]) !== review.accountId ||
                String(params[3]) !== `refund:${createdRefund}` || String(params[4]) !== review.actorId || !rows[0]?.id)
              throw new Error("test refund movement does not match the review");
            recordedMovement = true;
            await financePort(tx).query("UPDATE finance.movements SET after_cash_count_id=$2::bigint,after_opening=$3::boolean WHERE id=$1::bigint", [
              rows[0].id, review.checkpointRef === "OPENING" ? null : review.checkpointRef, review.checkpointRef === "OPENING",
            ]);
          }
          return rows;
        };
      } });
      const result = await work(wrapped);
      if (createdRefund && !recordedMovement) throw new Error("test refund movement was not observed");
      return result;
    }, options as never);
  } }) as PrismaClient;
}
