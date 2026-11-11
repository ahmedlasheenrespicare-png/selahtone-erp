import "server-only";
import { prisma } from "@/lib/prisma";
import { financePort, sqlError } from "./port";
import type { FinanceDatabase } from "./types";

/**
 * Staged finance access for the real application.
 *
 * The finance schema is NOT installed in production yet. While the
 * `FINANCE_ENABLED` flag is off, finance pages and financial operations remain
 * disabled. Directory administration still checks whether custody tables exist
 * and reads them when present, to avoid moving or suspending holders with open
 * accounts; partial/unreadable schema blocks those changes. Turning it on requires: a reviewed migration applied to the database,
 * a successful postflight comparison, and an explicit environment change that
 * is approved separately from any deploy.
 */
export function financeEnabled(): boolean {
  return process.env.FINANCE_ENABLED === "true";
}

export { sqlError };

/** A single SERIALIZABLE transaction; every error rolls the whole unit back. */
export const financeDb: FinanceDatabase = {
  serializable: async (work) => {
    try {
      return await prisma.$transaction((tx) => work(financePort(tx)), { isolationLevel: "Serializable", maxWait: 5000, timeout: 20000 });
    } catch (error) { return sqlError(error); }
  },
};

export { assertFinanceActor, financeDbForActor, financeDbForSession } from "./session-transaction";
export type { FinanceSession } from "./session-transaction";
