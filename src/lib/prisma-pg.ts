import { PrismaPg } from "@prisma/adapter-pg";
import { Pool, type PoolClient, type PoolConfig } from "pg";

type ConnectCallback = (error: Error | undefined, client: PoolClient | undefined, done: (release?: Error | boolean) => void) => void;
type Query = (...args: unknown[]) => unknown;
type Release = (error?: Error | boolean) => void;
type CommitState = { query: Query; release: Release; released: boolean };
const stateKey = Symbol("selahtone.commitFailureState");
type ProtectedClient = PoolClient & { [stateKey]?: CommitState };

function isTransportFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error && typeof error.code === "string" ? error.code : "";
  const message = "message" in error && typeof error.message === "string" ? error.message : "";
  return ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "57P01", "08006", "08003"].includes(code)
    || /connection (?:terminated|closed)|terminating connection/i.test(message);
}

function isCommitStatement(value: unknown): boolean {
  const sql = typeof value === "string" ? value
    : typeof value === "object" && value !== null && "text" in value && typeof value.text === "string" ? value.text
      : undefined;
  return sql?.trim().replace(/;$/, "").toUpperCase() === "COMMIT";
}

/**
 * Prisma 6 sends COMMIT through the adapter, while PgTransaction.commit()
 * only releases the client. If COMMIT itself fails, that release is never
 * reached in @prisma/adapter-pg 6.19.3.
 *
 * Recover on that same physical session exactly once. A successful ROLLBACK
 * proves a deferred-constraint failure clean. If transport is broken, the
 * rollback fails and release(error) destroys the client with an unknown
 * outcome. Neither path blindly replays the write.
 */
export class CommitFailureSafePool extends Pool {
  override connect(): Promise<PoolClient>;
  override connect(callback: ConnectCallback): void;
  override connect(callback?: ConnectCallback): Promise<PoolClient> | void {
    if (!callback) return super.connect().then(client => this.protect(client));
    super.connect((error, client, done) => {
      if (error || !client) return callback(error, client, done);
      callback(undefined, this.protect(client), client.release);
    });
  }

  private protect(client: ProtectedClient): PoolClient {
    // pg resets release() on every acquisition but retains query(). Keep one
    // query wrapper and refresh only the per-checkout release/state; nesting
    // wrappers would retain stale release closures from earlier borrowers.
    const state: CommitState = client[stateKey] ?? {
      query: client.query.bind(client) as Query,
      release: client.release.bind(client),
      released: false,
    };
    client[stateKey] = state;
    state.release = client.release.bind(client);
    state.released = false;

    client.release = (error?: Error | boolean) => {
      if (state.released) return;
      state.released = true;
      state.release(error);
    };

    if (client.query.name !== "guardedCommitQuery") {
      client.query = function guardedCommitQuery(...args: unknown[]) {
        if (!isCommitStatement(args[0])) return state.query(...args);

        const recover = (error: unknown) => {
          if (state.released) return;
          state.released = true; // Prisma's later rollback() must not release early.
          const reason = error instanceof Error ? error : new Error("COMMIT failed; discard the connection");
          // Finish pg's rejected-query bookkeeping before queueing recovery.
          setImmediate(() => {
            if (isTransportFailure(error)) {
              state.release(reason);
              return;
            }
            Promise.resolve(state.query("ROLLBACK")).then(
              () => state.release(),
              () => state.release(reason),
            ).catch(() => state.release(reason));
          });
        };
        const last = args.at(-1);
        if (typeof last === "function") {
          args[args.length - 1] = (...callbackArgs: unknown[]) => {
            if (callbackArgs[0]) recover(callbackArgs[0]);
            (last as (...values: unknown[]) => void)(...callbackArgs);
          };
        }

        try {
          const result = state.query(...args);
          if (result && typeof result === "object" && "then" in result && typeof result.then === "function") {
            return (result as Promise<unknown>).catch((error: unknown) => {
              recover(error);
              throw error;
            });
          }
          return result;
        } catch (error) {
          recover(error);
          throw error;
        }
      } as PoolClient["query"];
    }

    return client;
  }
}

/** Always construct PrismaPg with COMMIT-failure cleanup, never a raw config. */
export function createCommitSafePrismaPg(config: PoolConfig, options?: ConstructorParameters<typeof PrismaPg>[1]): PrismaPg {
  // This factory owns its pool, unlike callers that pass an existing Pool to
  // PrismaPg themselves. Disconnecting Prisma must therefore close idle clients.
  return new PrismaPg(new CommitFailureSafePool(config), { ...options, disposeExternalPool: options?.disposeExternalPool ?? true });
}
