/**
 * Synthetic test harness only. Never imported by the application. These
 * adapters intercept real service transactions so experimental allocation runs
 * inside the SAME transaction. They are not a proposed production hook.
 */
import type { PrismaClient } from "@prisma/client";
import { financePort } from "../../src/lib/finance/port";
import type { FinanceDatabase, FinanceTransaction } from "../../src/lib/finance/types";
import { allocateTestCollection } from "./allocate.test-only";
import { allocateTestHolderPayment, attachAfterRealConfirmationTestOnly } from "./period.test-only";

export function testCollectionService(db: PrismaClient, actorId: string, failAfterAllocation = false): PrismaClient {
  return new Proxy(db, { get(target, key, receiver) {
    if (key !== "$transaction") return Reflect.get(target, key, receiver);
    return (work: (tx: unknown) => Promise<unknown>, options: unknown) => target.$transaction(async tx => {
      const collections = new Proxy(tx.commerceCollection, { get(delegate, prop, recv) {
        if (prop !== "create") return Reflect.get(delegate, prop, recv);
        return async (args: { data: { method: string } }) => {
          const result = await delegate.create(args as never) as { id: bigint };
          if (args.data.method === "CASH") {
            await allocateTestCollection(financePort(tx), actorId, result.id.toString());
            if (failAfterAllocation) throw new Error("synthetic failure after allocation");
          }
          return result;
        };
      } });
      const wrapped = new Proxy(tx, { get(obj, prop, recv) {
        if (prop === "commerceCollection") return collections;
        return Reflect.get(obj, prop, recv);
      } });
      return work(wrapped);
    }, options as never);
  } }) as PrismaClient;
}

export function testHolderPaymentService(db: FinanceDatabase, actorId: string, failAfterAllocation = false): FinanceDatabase {
  return { serializable: work => db.serializable(tx => {
    const wrapped: FinanceTransaction = { ...tx, query: async <T extends Record<string, unknown>>(sql: string, params?: unknown[]) => {
      const result = await tx.query<T>(sql, params);
      if (sql.includes("INSERT INTO finance.payments(") && params?.[11] === "HOLDER_CASH") {
        await allocateTestHolderPayment(tx, actorId, String(result.rows[0].id));
        if (failAfterAllocation) throw new Error("synthetic failure after allocation");
      }
      return result;
    } };
    return work(wrapped);
  }) };
}

/** Wrap the real confirmation; the hook cannot run on replay or old records. */
export function testRealSettlementWithPeriod(db: FinanceDatabase, input: { accountId: string; actorId: string; collectionIds: string[]; paymentIds: string[]; reviewedHash: string; failAfterAllocation?: boolean }): FinanceDatabase {
  return { serializable: work => db.serializable(tx => {
    const wrapped: FinanceTransaction = { ...tx, query: async <T extends Record<string, unknown>>(sql: string, params?: unknown[]) => {
      const result = await tx.query<T>(sql, params);
      if (sql.includes("UPDATE finance.settlements SET status='CONFIRMED'")) {
        await attachAfterRealConfirmationTestOnly(tx, input.accountId, String(params?.[6]), input.actorId, input.collectionIds, input.paymentIds, input.reviewedHash);
        if (input.failAfterAllocation) throw new Error("synthetic failure after settlement allocation");
      }
      return result;
    } };
    return work(wrapped);
  }) };
}

/** Experiment only: checks after a tentative engine write in the same tx.
 * Only use with a custody account and the exact tested engine SQL shapes. */
export function testCountClosePeriodGuard(db: FinanceDatabase, accountId: string): FinanceDatabase {
  return { serializable: work => db.serializable(tx => {
    const wrapped: FinanceTransaction = { ...tx, query: async <T extends Record<string, unknown>>(sql: string, params?: unknown[]) => {
      const result = await tx.query<T>(sql, params);
      const isCount = sql.includes("INSERT INTO finance.cash_counts(account_id,counted_amount") ||
        sql.includes("UPDATE finance.cash_counts SET counted_amount=") || sql.includes("UPDATE finance.cash_counts SET status='CONFIRMED'");
      const isClose = sql.includes("UPDATE finance.accounts SET closed_at=CURRENT_TIMESTAMP");
      if (isCount || isClose) {
        let touchedAccount: string;
        if (isClose || sql.includes("INSERT INTO finance.cash_counts(account_id,counted_amount")) {
          touchedAccount = String(params?.[0]);
        } else {
          const countId = sql.includes("UPDATE finance.cash_counts SET counted_amount=") ? params?.[6] : params?.[2];
          const found = await tx.query<{ accountId: string }>("SELECT account_id::text AS \"accountId\" FROM finance.cash_counts WHERE id=$1::bigint", [countId]);
          touchedAccount = found.rows[0]?.accountId ?? "";
        }
        if (touchedAccount !== accountId) throw new Error("test-only interceptor bound to the wrong account");
        const { checkCountClosePeriodTestOnly } = await import("./count-close-guard.test-only");
        await checkCountClosePeriodTestOnly(tx, accountId, isClose);
      }
      return result;
    } };
    return work(wrapped);
  }) };
}
