/** Disposable PostgreSQL only. Never reads DATABASE_URL or production data. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client, type PoolClient, type PoolConfig } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PrismaClient } from "@prisma/client";
import { CommitFailureSafePool } from "../src/lib/prisma-pg";
import { isRetryableTransactionConflict } from "../src/lib/transaction-retry";

const req = createRequire(join(process.cwd(), "package.json"));
// Prisma 6 generates an edge WASM loader whose default export is absent when
// Node imports the raw .wasm directly. Use its packaged base64 bytes instead.
for (const loader of ["wasm-worker-loader.mjs", "wasm-edge-light-loader.mjs"]) {
  writeFileSync(join(process.cwd(), "node_modules/.prisma/client", loader),
    `import { wasm } from "../../@prisma/client/runtime/query_engine_bg.postgresql.wasm-base64.js";\nexport default WebAssembly.compile(Buffer.from(wasm, "base64")).then(value => ({ default: value }));\n`);
}
const { PrismaClient: WasmClient } = req("@prisma/client/wasm") as {
  PrismaClient: new (options: { adapter: unknown }) => PrismaClient;
};

test("a deferred COMMIT failure releases its only pool connection and leaves no partial write", { timeout: 60_000 }, async () => {
  const bin = process.env.SYNTHETIC_POSTGRES_BIN;
  assert.ok(bin, "Set SYNTHETIC_POSTGRES_BIN to disposable local PostgreSQL binaries");
  const dir = mkdtempSync(join(tmpdir(), "selahtone-commit-lifecycle-"));
  const data = join(dir, "data");
  const ctl = (args: string[]) => execFileSync(join(bin, "pg_ctl"), args, { stdio: "pipe", timeout: 20_000 });
  let started = false;
  let admin: Client | undefined;
  let prisma: PrismaClient | undefined;
  let pool: CommitFailureSafePool | undefined;
  try {
    execFileSync(join(bin, "initdb"), ["-D", data, "-U", "postgres", "--no-locale", "--encoding=UTF8", "--auth=trust"], { stdio: "pipe", timeout: 20_000 });
    ctl(["-D", data, "-l", join(dir, "postgres.log"), "-o", `-k ${dir} -p 55441 -c listen_addresses=''`, "-w", "start"]);
    started = true;
    const config = { host: dir, port: 55441, user: "postgres", database: "postgres" };
    admin = new Client(config);
    await admin.connect();
    await admin.query(`CREATE TABLE commit_parent(id int PRIMARY KEY);
      CREATE TABLE commit_child(id int PRIMARY KEY, parent_id int,
        CONSTRAINT deferred_parent FOREIGN KEY(parent_id) REFERENCES commit_parent(id) DEFERRABLE INITIALLY DEFERRED)`);

    let cutCommitConnection = false;
    // pg's test-only verify hook installs a one-shot real socket termination
    // at the COMMIT boundary before CommitFailureSafePool wraps the client.
    const poolConfig = { ...config, max: 1, connectionTimeoutMillis: 2_000,
      verify(client: PoolClient, done: (error?: Error) => void) {
        const query = client.query.bind(client) as (...args: unknown[]) => Promise<unknown>;
        client.query = ((...args: unknown[]) => {
          const first = args[0];
          const sql = typeof first === "string" ? first : typeof first === "object" && first !== null && "text" in first ? first.text : "";
          if (cutCommitConnection && sql === "COMMIT") return query("SELECT pg_terminate_backend(pg_backend_pid())");
          return query(...args);
        }) as PoolClient["query"];
        done();
      },
    } as PoolConfig;
    pool = new CommitFailureSafePool(poolConfig);
    const adapter = new PrismaPg(pool);
    prisma = new WasmClient({ adapter });
    const error = await prisma.$transaction(async tx => {
      await tx.$executeRaw`INSERT INTO commit_child(id,parent_id) VALUES (1,999)`;
    }, { timeout: 10_000 }).then(() => null, (reason: unknown) => reason);
    assert.ok(error, "the deferred foreign key must fail at COMMIT");
    assert.equal(isRetryableTransactionConflict(error), false, "a constraint failure is never blindly replayed");
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual((await admin.query("SELECT count(*)::int AS n FROM commit_child")).rows[0], { n: 0 });
    // max=1 makes a leaked checkout deterministic: this query cannot succeed
    // until rollback/release (or connection destruction) has completed.
    assert.deepEqual(await prisma.$queryRaw<Array<{ value: number }>>`SELECT 1 AS value`, [{ value: 1 }]);
    assert.equal(pool?.waitingCount, 0);
    assert.equal(pool?.idleCount, 1, "a proven rolled-back session is clean and reusable");
    assert.equal(pool?.totalCount, 1);
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`INSERT INTO commit_parent(id) VALUES (1)`;
      await tx.$executeRaw`INSERT INTO commit_child(id,parent_id) VALUES (2,1)`;
    });
    assert.deepEqual((await admin.query("SELECT id,parent_id FROM commit_child ORDER BY id")).rows, [{ id: 2, parent_id: 1 }]);
    assert.equal(pool?.waitingCount, 0);

    cutCommitConnection = true;
    const transportError = await prisma.$transaction(async tx => {
      await tx.$executeRaw`INSERT INTO commit_child(id,parent_id) VALUES (3,1)`;
    }).then(() => null, (reason: unknown) => reason);
    cutCommitConnection = false;
    assert.ok(transportError, "socket termination at COMMIT must reach the caller");
    assert.equal(isRetryableTransactionConflict(transportError), false, "an unknown commit outcome is not blindly retried");
    // The terminated socket cannot prove a clean ROLLBACK, so the guard destroys
    // it and max=1 forces creation of a fresh physical connection here.
    assert.deepEqual(await prisma.$queryRaw<Array<{ value: number }>>`SELECT 1 AS value`, [{ value: 1 }]);
    assert.deepEqual((await admin.query("SELECT id,parent_id FROM commit_child ORDER BY id")).rows, [{ id: 2, parent_id: 1 }]);
    assert.equal(pool?.waitingCount, 0);
    assert.equal(pool?.totalCount, 1);
  } finally {
    if (prisma) await prisma.$disconnect();
    if (pool) await pool.end();
    if (admin) await admin.end();
    if (started) ctl(["-D", data, "-m", "immediate", "-w", "stop"]);
    rmSync(dir, { recursive: true, force: true });
  }
});
