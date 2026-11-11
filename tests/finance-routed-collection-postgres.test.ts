/**
 * Disposable local PostgreSQL only. Never reads DATABASE_URL or connects to an
 * existing server. It checks ONE laboratory requirement: a cash collection
 * whose destination is decided after a shared branch marker must see a custody
 * that finished opening before that decision, even when the collection
 * transaction started earlier. Replay must not re-route or repeat the effect.
 *
 * This is a prototype of the branch-marker experiment, NOT application code,
 * NOT a migration, NOT proof of physical cash and NOT evidence that all
 * writers, lock orders or historical data are safe.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PrismaClient } from "@prisma/client";
import { openAccount } from "../src/lib/finance/engine";
import { branchOpenCustodyTestOnly } from "../prototypes/finance-collection-policy/branch-barrier.test-only";
import { branchRoutedCollectionTestOnly } from "../prototypes/finance-collection-policy/routed-collection.test-only";
import { financePort } from "../src/lib/finance/port";
import { isRetryableTransactionConflict } from "../src/lib/transaction-retry";
import type { FinanceDatabase, FinanceTransaction } from "../src/lib/finance/types";

const root = process.cwd(), req = createRequire(join(root, "package.json"));
const read = (f: string) => readFileSync(join(root, f), "utf8");
const { PrismaClient: WasmClient } = req("@prisma/client/wasm") as { PrismaClient: new (options: { adapter: unknown }) => PrismaClient };

function gate() {
  let release!: () => void, reached!: () => void;
  return { wait: new Promise<void>(r => { release = r; }), entered: new Promise<void>(r => { reached = r; }), release: () => release(), signal: () => reached() };
}
function ordinaryFinance(db: PrismaClient): FinanceDatabase {
  return { serializable: work => db.$transaction(tx => work(financePort(tx)), { isolationLevel: "Serializable", timeout: 20000 }) };
}
function gatedFinance(db: PrismaClient, g: ReturnType<typeof gate>): FinanceDatabase {
  let paused = false;
  return { serializable: work => db.$transaction(async tx => {
    const port = financePort(tx);
    const wrapped: FinanceTransaction = { ...port, query: async <T extends Record<string, unknown>>(sql: string, params?: unknown[]) => {
      const result = await port.query<T>(sql, params);
      if (!paused && sql.includes("UPDATE finance.branch_source_barriers_test_only")) { paused = true; g.signal(); await g.wait; }
      return result;
    } };
    return work(wrapped);
  }, { isolationLevel: "Serializable", timeout: 20000 }) };
}
async function waitForLock(client: Client): Promise<void> {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    await client.query("SELECT pg_stat_clear_snapshot()");
    const { rows } = await client.query(`SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()
      AND wait_event_type='Lock' AND query ILIKE '%finance.branch_source_barriers_test_only%' LIMIT 1`);
    if (rows.length) return;
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error("concurrent transaction did not reach the branch marker lock");
}

test("routed collection sees a custody opened before its destination decision; replay never re-routes", { timeout: 180_000 }, async () => {
  const bin = process.env.SYNTHETIC_POSTGRES_BIN;
  assert.ok(bin, "Set SYNTHETIC_POSTGRES_BIN to disposable PostgreSQL binaries");
  const dir = mkdtempSync(join(tmpdir(), "selahtone-routed-pg-"));
  const data = join(dir, "data"), log = join(dir, "postgres.log");
  const ctl = (args: string[]) => execFileSync(join(bin, "pg_ctl"), args, { stdio: "pipe", timeout: 30000 });
  let started = false; let cleanupAdmin: Client | undefined; let cleanupPrisma: PrismaClient | undefined;
  const oldFlag = process.env.FINANCE_ENABLED;
  process.env.FINANCE_ENABLED = "true";
  try {
    execFileSync(join(bin, "initdb"), ["-D", data, "-U", "postgres", "--no-locale", "--encoding=UTF8", "--auth=trust"], { stdio: "pipe", timeout: 30000 });
    ctl(["-D", data, "-l", log, "-o", `-k ${dir} -p 55441 -c listen_addresses=''`, "-w", "start"]); started = true;
    const config = { host: dir, port: 55441, user: "postgres", database: "postgres" };
    const admin: Client = new Client(config); await admin.connect(); cleanupAdmin = admin;
    const { buildDdl } = req("./scripts/local-pglite-ddl.cjs") as { buildDdl: () => string };
    await admin.query(buildDdl());
    await admin.query(read("scripts/local-pglite-seed.sql").replaceAll("__PREVIEW_BCRYPT__", "synthetic"));
    await admin.query("SET selahtone.finance_release_candidate_test_only='yes'");
    for (const f of ["prototypes/finance-release/release-candidate.test-only.sql", "prisma/manual-settlement-upgrade.sql",
      "prisma/manual-custody-closure-upgrade.sql", "prisma/manual-custody-and-count-requests.sql"]) await admin.query(read(f));
    await admin.query("SET selahtone.collection_policy_test_only='yes'");
    await admin.query(read("prototypes/finance-collection-policy/allocations.test-only.sql"));
    await admin.query("CREATE TABLE finance.branch_source_barriers_test_only(branch_id bigint PRIMARY KEY REFERENCES public.branches(id),revision bigint NOT NULL DEFAULT 0)");
    const prisma: PrismaClient = new WasmClient({ adapter: new PrismaPg(config) }); cleanupPrisma = prisma;
    const db = ordinaryFinance(prisma);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());

    for (const [branch, first] of [["450", "open"], ["451", "collection"]] as const) {
      await admin.query(`INSERT INTO branches(id,code,name_ar,city,phone,invoice_prefix,opening_date,is_active,created_at)
        VALUES($1::bigint,$2,'فرع توجيه ديناميكي','تجربة','000',$2,CURRENT_DATE,true,now())`, [branch, `RT${branch}`]);
      await admin.query(`INSERT INTO users(id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
        SELECT $1::bigint,$1::bigint,role_code,'مدير توجيه',$2,password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=1`, [branch, `pg-routed-${branch}@selahtone.local`]);
      const vault = await openAccount(db, "1", { requestId: randomUUID(), branchId: branch, kind: "VAULT", holderId: null, openingAmount: "0", openingDate: today, counted: true }, today);
      await admin.query("INSERT INTO finance.branch_source_barriers_test_only(branch_id) VALUES($1::bigint)", [branch]);
      const sale = (await admin.query<{ id: string }>(`INSERT INTO commerce_sales(request_id,request_hash,branch_id,warehouse_id,customer_name,customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,created_by_id)
        SELECT $1::uuid,repeat('c',64),$2::bigint,warehouse_id,'توجيه ديناميكي',customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,$2::bigint FROM commerce_sales WHERE id=2 RETURNING id::text`, [randomUUID(), branch])).rows[0].id;
      const openInput = { requestId: randomUUID(), branchId: branch, kind: "CUSTODY" as const, holderId: branch, openingAmount: "0", openingDate: today, counted: true };
      const input = { requestId: randomUUID(), saleId: sale, amount: "1", method: "CASH", actuallyPaid: false, vaultReceived: true };
      const conflicts: unknown[] = [];
      const retry = async <T>(work: () => Promise<T>): Promise<T> => {
        for (let attempts = 1; ; attempts++) try { return await work(); }
        catch (error) { if (attempts < 5 && isRetryableTransactionConflict(error)) { conflicts.push(error); continue; } throw error; }
      };
      const opening = (port: FinanceDatabase) => retry(() => branchOpenCustodyTestOnly(port, "1", openInput, today));
      const collecting = (port: FinanceDatabase) => retry(() => branchRoutedCollectionTestOnly(port, BigInt(branch), input));
      const g = gate();
      const gatePort = gatedFinance(prisma, g);
      const firstOp = (first === "open" ? opening(gatePort) : collecting(gatePort)).then(value => ({ value }), error => ({ error }));
      await g.entered;
      const secondOp = (first === "open" ? collecting(db) : opening(db)).then(value => ({ value }), error => ({ error }));
      try { await waitForLock(admin!); } finally { g.release(); }
      const winner = await firstOp, after = await secondOp;
      assert.ok("value" in winner, `first operation failed: ${JSON.stringify(winner)}`);
      assert.ok("value" in after, `second operation failed: ${JSON.stringify(after)}`);
      assert.ok(conflicts.some(error => typeof error === "object" && error !== null && "code" in error
        && ["P2034", "40001", "40P01", "P2010"].includes(String(error.code))),
      "a whole-transaction serialization/deadlock retry must occur in both orders");

      const countAllocation = (treatment: string) => admin.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM finance.collection_allocations_test_only WHERE collection_id=(SELECT id FROM commerce_collections WHERE request_id=$1::uuid) AND treatment=$2`, [input.requestId, treatment]);
      const countVaultMovements = () => admin.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM finance.movements WHERE destination_id=$1::bigint AND kind='COLLECTION'`, [vault.id]);
      const revision = async () => (await admin.query<{ revision: string }>("SELECT revision::text AS revision FROM finance.branch_source_barriers_test_only WHERE branch_id=$1::bigint", [branch])).rows[0].revision;
      const savedRevision = await revision();

      if (first === "open") {
        // The older collection transaction retried and now sees the new custody.
        assert.equal(after.value.replayed, false);
        assert.equal((await countAllocation("CUSTODY_PENDING")).rows[0].n, 1);
        const custody = (await admin.query<{ id: string }>("SELECT id::text AS id FROM finance.accounts WHERE branch_id=$1::bigint AND kind='CUSTODY' AND closed_at IS NULL", [branch])).rows[0].id;
        assert.equal(custody, winner.value.id);
        assert.equal((await admin.query<{ n: number }>("SELECT count(*)::int AS n FROM finance.collection_allocations_test_only WHERE collection_id=(SELECT id FROM commerce_collections WHERE request_id=$1::uuid) AND account_id=$2::bigint AND treatment='CUSTODY_PENDING' AND movement_id IS NULL", [input.requestId, custody])).rows[0].n, 1);
        assert.equal((await countVaultMovements()).rows[0].n, 0, "no vault movement may be posted after the custody is visible");
        assert.deepEqual(await collecting(db), { id: after.value.id, replayed: true });
        assert.deepEqual(await branchRoutedCollectionTestOnly(db, BigInt(branch), { ...input, vaultReceived: false }),
          { id: after.value.id, replayed: true });
      } else {
        // Destination was decided before the opening completed, so the vault
        // route stands; a later custody must not change the saved decision.
        assert.equal(winner.value.replayed, false);
        assert.equal((await countAllocation("VAULT_MOVEMENT")).rows[0].n, 1);
        assert.equal((await countAllocation("CUSTODY_PENDING")).rows[0].n, 0);
        assert.equal((await countVaultMovements()).rows[0].n, 1);
        assert.deepEqual(await collecting(db), { id: winner.value.id, replayed: true });
        assert.deepEqual(await opening(db), { id: after.value.id, replayed: true });
        await assert.rejects(() => branchRoutedCollectionTestOnly(db, BigInt(branch), { ...input, vaultReceived: false }),
          (error: unknown) => error instanceof Error && "code" in error && error.code === "vault_receipt_required",
          "a saved vault route must not replay without the operator's receipt attestation");
      }
      assert.equal((await admin.query<{ n: number }>("SELECT count(*)::int AS n FROM commerce_collections WHERE request_id=$1::uuid", [input.requestId])).rows[0].n, 1);
      assert.equal((await admin.query<{ n: number }>("SELECT count(*)::int AS n FROM finance.collection_allocations_test_only WHERE collection_id=(SELECT id FROM commerce_collections WHERE request_id=$1::uuid)", [input.requestId])).rows[0].n, 1);
      assert.equal((await countVaultMovements()).rows[0].n, first === "open" ? 0 : 1);
      assert.equal(await revision(), savedRevision, "replay must not touch the branch marker");
    }
  } finally {
    if (cleanupPrisma) await cleanupPrisma.$disconnect().catch(() => {});
    if (cleanupAdmin) await cleanupAdmin.end().catch(() => {});
    if (started) ctl(["-D", data, "-m", "fast", "-w", "stop"]);
    if (oldFlag === undefined) delete process.env.FINANCE_ENABLED; else process.env.FINANCE_ENABLED = oldFlag;
    rmSync(dir, { recursive: true, force: true });
  }
});
