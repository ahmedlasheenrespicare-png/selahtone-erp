/**
 * TEST-ONLY experiment for a disposable local PostgreSQL cutover fixture.
 *
 * PrismaPg 6.19.3 can leave a PoolClient checked out when deferred COMMIT
 * fails. Each call below owns an entire one-connection pool and Prisma client;
 * a leftover checkout is destroyed after the transaction settles. This is not
 * a production connection manager: it opens a new pool per operation, relies
 * on pg Pool's acquire/release events, and does not resolve ambiguous COMMITs.
 * Never point it at a business database or use it in the deployed application.
 */
import { realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PrismaClient } from "@prisma/client";

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
type Options = { isolationLevel?: "ReadCommitted" | "RepeatableRead" | "Serializable"; maxWait?: number; timeout?: number };
export type CleanupObservation = { checkedOutAfterTransaction: number; destroyed: number; totalAfterClose: number };
type ClientFactory = (adapter: PrismaPg) => PrismaClient;

/** Conservative test-only result: the callback completed but Prisma did not
 * confirm COMMIT. Do not automatically retry with a new request identifier. */
export class FixtureCommitOutcomeUnknown extends Error {
  constructor(cause: unknown) { super("FINANCE_FIXTURE_COMMIT_OUTCOME_UNKNOWN", { cause }); this.name = "FixtureCommitOutcomeUnknown"; }
}

/** Only the Unix socket created under the test's disposable temp directory is
 * accepted. This heuristic is an extra test guard, not a security boundary. */
function checkSocket(socket: string, port: number): string {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("test-only local port required");
  const resolved = realpathSync(socket), temp = realpathSync(os.tmpdir());
  const relative = path.relative(temp, resolved), parts = relative.split(path.sep);
  if (parts.length !== 2 || !/^selahtone-cutover-[A-Za-z0-9]+$/.test(parts[0]) || parts[1] !== "socket") {
    throw new Error("only a freshly created cutover fixture socket is allowed");
  }
  return resolved;
}

export async function ownedFixtureTransaction<T>(
  socket: string, port: number, createClient: ClientFactory, work: (tx: Tx) => Promise<T>,
  options: Options = { isolationLevel: "Serializable", maxWait: 5000, timeout: 20000 },
  observe?: (value: CleanupObservation) => void,
): Promise<T> {
  const host = checkSocket(socket, port);
  const pool = new Pool({ host, port, database: "postgres", user: "cutover_new_test", application_name: "finance-owned-cutover-test", max: 1, connectionTimeoutMillis: 5000 });
  const leased = new Set<PoolClient>();
  pool.on("acquire", (client: PoolClient) => { leased.add(client); });
  pool.on("release", (_error: Error | undefined, client: PoolClient) => { leased.delete(client); });
  // The pg pool still handles and removes broken idle connections. Install a
  // listener so a lost socket cannot become an unhandled process-level error.
  pool.on("error", () => {});
  let client: PrismaClient | undefined, result: T | undefined, primary: unknown, failed = false, callbackCompleted = false;
  let checkedOutAfterTransaction = 0, destroyed = 0;
  const cleanupErrors: unknown[] = [];
  try {
    // Never inherit DATABASE_URL; assert the fixture role and no TCP listener.
    const local = (await pool.query<{ listen: string; login: string; db: string }>(
      "SELECT current_setting('listen_addresses') AS listen, session_user::text AS login, current_database() AS db",
    )).rows[0];
    if (!local || local.listen !== "" || local.login !== "cutover_new_test" || local.db !== "postgres") {
      throw new Error("not the required isolated cutover fixture");
    }
    client = createClient(new PrismaPg(pool));
    result = await client.$transaction(async tx => {
      const value = await work(tx);callbackCompleted = true;return value;
    }, options as never);
  } catch (error) {
    failed = true;primary = callbackCompleted ? new FixtureCommitOutcomeUnknown(error) : error;
  }
  finally {
    checkedOutAfterTransaction = leased.size;
    // max=1 and an owned pool ensure this cannot release another request's
    // connection. Destroy instead of returning a possibly broken socket.
    for (const connection of [...leased]) {
      try { connection.release(true); destroyed++; } catch (error) { cleanupErrors.push(error); }
    }
    try { if (client) await client.$disconnect(); } catch (error) { cleanupErrors.push(error); }
    try { await pool.end(); } catch (error) { cleanupErrors.push(error); }
    try { observe?.({ checkedOutAfterTransaction, destroyed, totalAfterClose: pool.totalCount }); } catch (error) { cleanupErrors.push(error); }
  }
  if (cleanupErrors.length) throw new AggregateError(failed ? [primary,...cleanupErrors] : cleanupErrors,"disposable transaction cleanup failed");
  if (failed) throw primary;
  return result as T;
}
