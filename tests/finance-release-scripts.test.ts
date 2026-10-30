/** Disposable tests for the MANUAL production scripts (upgrade + rollback).
 * No DATABASE_URL, no seed, no network. They prove the scripts install what the
 * reviewed candidate installs, are replayable, refuse edited text, leave legacy
 * rows alone, and that the rollback refuses to destroy recorded finance data.
 * Running these tests is NOT a release decision and touches nothing shared. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { Pool, type PoolClient } from "pg";

const root = process.cwd(), read = (f: string) => readFileSync(path.join(root, f), "utf8");
const candidate = read("prototypes/finance-release/release-candidate.test-only.sql");
const upgrade = read("prisma/manual-finance-release-upgrade.sql");
const rollback = read("prisma/manual-finance-release-rollback.sql");
const postflight = read("prisma/manual-finance-release-postflight.sql");
const baselineFiles = ["tests/fixtures/inventory-baseline.sql", "prisma/manual-inventory-upgrade.sql",
  "prisma/manual-receiving-upgrade.sql", "prisma/manual-commerce-upgrade.sql", "tests/fixtures/finance-legacy-categories.sql"];
const expectedTables = ["accounts", "expenses", "payments", "expense_reviews", "cash_counts", "opening_corrections",
  "historical_commerce", "reconciliation_cases", "reconciliation_notes", "expense_corrections", "movements",
  "requests", "audit_events", "category_revisions", "category_audit", "category_requests"];
const zeros = "0".repeat(64);

type Row = Record<string, unknown>;
const legacyRows = `INSERT INTO public.expenses(branch_id,category_id,amount,expense_date,status,requested_by)
   VALUES(1,1,125.50,'2026-01-05','APPROVED',1),(2,3,40.00,'2026-02-11','DRAFT',2);
 INSERT INTO public.journal_entries(entry_no,entry_date,source_type,source_id) VALUES('TEST-1','2026-01-05','EXPENSE',1);`;

function stampedChecksum(file: string, label: string): string {
  const found = /-- sha256: ([0-9a-f]{64})/.exec(file);
  assert.ok(found, `${label} must carry a sha256 comment`);
  assert.equal(createHash("sha256").update(file.split(found[1]).join(zeros)).digest("hex"), found[1],
    `${label} checksum is stale; rebuild with tools/build-release-scripts.mjs`);
  return found[1];
}
async function fixture(): Promise<PGlite> {
  const pg = new PGlite();
  for (const f of baselineFiles) await pg.exec(read(f));
  await pg.exec(legacyRows);
  return pg;
}
const one = async (pg: PGlite, sql: string): Promise<Row> => (await pg.query<Row>(sql)).rows[0];

/** Splits a script into top-level statements so the FIRST error can be seen.
 * PGlite keeps executing after an error inside BEGIN…COMMIT, so a batch run
 * only ever surfaces “current transaction is aborted” and hides the real cause. */
function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = "", i = 0, tag: string | null = null;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "-" && sql[i + 1] === "-") { const nl = sql.indexOf("\n", i); i = nl < 0 ? sql.length : nl; continue; }
    if (tag) {
      if (sql.startsWith(tag, i)) { buf += tag; i += tag.length; tag = null; }
      else { buf += c; i += 1; }
      continue;
    }
    if (c === "$") { const m = /^\$[A-Za-z_0-9]*\$/.exec(sql.slice(i)); if (m) { tag = m[0]; buf += m[0]; i += m[0].length; continue; } }
    if (c === "'") { const start = i; i += 1; while (i < sql.length) { if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue; } if (sql[i] === "'") { i += 1; break; } i += 1; } buf += sql.slice(start, i); continue; }
    if (c === ";") { if (buf.trim()) out.push(buf.trim()); buf = ""; i += 1; continue; }
    buf += c; i += 1;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}
/** Runs a script statement by statement; on failure it rolls back and rethrows the real error. */
async function runScript(pg: PGlite, sql: string): Promise<void> {
  try {
    for (const statement of splitStatements(sql)) await pg.exec(statement);
  } catch (error) {
    await pg.exec("ROLLBACK;").catch(() => undefined);
    throw error;
  }
}
async function expectRefusal(pg: PGlite, sql: string, pattern: RegExp): Promise<void> {
  await assert.rejects(() => runScript(pg, sql), pattern);
}
async function publicTables(pg: PGlite): Promise<string[]> {
  const rows = await pg.query<{ name: string }>("SELECT c.relname::text AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY 1");
  return rows.rows.map(r => r.name);
}
async function financeTables(pg: PGlite): Promise<string[]> {
  const rows = await pg.query<{ name: string }>("SELECT c.relname::text AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='finance' AND c.relkind='r' ORDER BY 1");
  return rows.rows.map(r => r.name);
}

test("the upgrade script is the reviewed candidate minus the disposable guard", () => {
  const start = candidate.indexOf("CREATE SCHEMA IF NOT EXISTS finance;");
  const end = candidate.indexOf("-- Record the applied script.");
  assert.ok(start > 0 && end > start, "candidate layout changed");
  const body = candidate.slice(start, end).trimEnd().replace(/[0-9a-f]{64}/g, zeros);
  assert.ok(upgrade.includes(body), "the upgrade script drifted from the candidate; rebuild it");
  assert.ok(!upgrade.includes("finance_release_candidate_test_only"), "the disposable opt-in guard must not reach production");
  assert.ok(!upgrade.includes("'finance_release_candidate'"), "the production script must use its own migration name");
  assert.match(upgrade, /^BEGIN;\n/m);
  assert.match(upgrade, /\nCOMMIT;\n?$/);
});

test("the rollback script refuses to run against any script other than the upgrade", () => {
  assert.match(rollback, /DROP SCHEMA finance CASCADE;/);
  assert.match(rollback, /DROP SCHEMA finance_release CASCADE;/);
  assert.ok(!rollback.includes("DROP TABLE public."), "the rollback must never touch public objects");
  assert.match(rollback, /name='finance_release_upgrade'/);
});

test("upgrade installs every expected table and records itself", { timeout: 120_000 }, async () => {
  const pg = await fixture();
  try {
    const before = await publicTables(pg);
    await runScript(pg, upgrade);
    assert.deepEqual(await financeTables(pg), [...expectedTables].sort());
    const ledger = await one(pg, "SELECT name, checksum FROM finance_release.migrations");
    assert.equal(ledger.name, "finance_release_upgrade");
    assert.equal(ledger.checksum, stampedChecksum(upgrade, "upgrade script"));
    assert.deepEqual(await publicTables(pg), before, "the upgrade must not create public tables");
    assert.equal((await one(pg, "SELECT count(*)::int AS n FROM public.expenses")).n, 2);
    assert.equal((await one(pg, "SELECT count(*)::int AS n FROM public.journal_entries")).n, 1);
    assert.equal((await one(pg, "SELECT count(*)::int AS n FROM public.expense_categories")).n, 7);
  } finally { await pg.close(); }
});

test("replaying the same upgrade is a no-op, editing it is refused", { timeout: 120_000 }, async () => {
  const pg = await fixture();
  try {
    await runScript(pg, upgrade);
    const first = await one(pg, "SELECT checksum FROM finance_release.migrations WHERE name='finance_release_upgrade'");
    await runScript(pg, upgrade);
    assert.deepEqual(await one(pg, "SELECT checksum FROM finance_release.migrations WHERE name='finance_release_upgrade'"), first);
    assert.equal((await one(pg, "SELECT count(*)::int AS n FROM finance_release.migrations")).n, 1);
    // A rebuilt file carries a different embedded checksum, so the database must
    // refuse it instead of silently diverging from the reviewed script.
    const digest = stampedChecksum(upgrade, "upgrade script");
    const edited = upgrade.split(digest).join("f".repeat(64));
    assert.notEqual(edited, upgrade, "the edit must change the file for this test to mean anything");
    await expectRefusal(pg, edited, /changed after it was applied/);
    assert.deepEqual(await one(pg, "SELECT checksum FROM finance_release.migrations WHERE name='finance_release_upgrade'"), first);
  } finally { await pg.close(); }
});

test("upgrade refuses a database that does not match the audited baseline", { timeout: 120_000 }, async () => {
  const pg = new PGlite();
  try {
    await pg.exec("CREATE TABLE public.branches(id bigint PRIMARY KEY); CREATE TABLE public.users(id bigint PRIMARY KEY);");
    await expectRefusal(pg, upgrade, /baseline object missing/);
    assert.equal((await one(pg, "SELECT to_regnamespace('finance')::text AS value")).value, null);
  } finally { await pg.close(); }
});

test("upgrade refuses when a public table already uses a reserved finance name", { timeout: 120_000 }, async () => {
  const pg = await fixture();
  try {
    await pg.exec("CREATE TABLE public.accounts(id int);");
    await expectRefusal(pg, upgrade, /conflicting public objects/);
    assert.equal((await one(pg, "SELECT to_regnamespace('finance')::text AS value")).value, null);
  } finally { await pg.close(); }
});

test("the postflight check agrees with the ledger after the upgrade", { timeout: 120_000 }, async () => {
  const pg = await fixture();
  try {
    await runScript(pg, upgrade);
    const results = await pg.exec(postflight);
    const withRows = results.filter(r => (r.rows?.length ?? 0) > 0);
    assert.equal(withRows.length, 1, "the postflight check must return exactly one report row");
    const row = withRows[0].rows[0] as Row;
    const report = JSON.parse(String(row.finance_release_postflight)) as {
      migration_ledger: Array<{ name: string; checksum: string }>;
      finance_table_count: number;
      finance_row_counts: Record<string, number>;
      legacy_counts: Record<string, number>;
    };
    assert.deepEqual(report.migration_ledger.map(r => r.name), ["finance_release_upgrade"]);
    assert.equal(report.finance_table_count, expectedTables.length);
    assert.equal(Object.values(report.finance_row_counts).reduce((a, b) => a + b, 0), 0);
    assert.equal(report.legacy_counts.expense_categories, 7);
  } finally { await pg.close(); }
});

test("rollback refuses while any finance data is recorded, then works once empty", { timeout: 120_000 }, async () => {
  const pg = await fixture();
  try {
    await runScript(pg, upgrade);
    await runScript(pg, `INSERT INTO finance.accounts(branch_id,kind,opening_amount,opening_date,opened_by)
                     VALUES(1,'VAULT',0,'2026-10-01',1);`);
    await expectRefusal(pg, rollback, /بيانات مالية مسجلة/);
    assert.ok((await one(pg, "SELECT to_regnamespace('finance')::text AS value")).value, "nothing may be dropped when data exists");
    await runScript(pg, "DELETE FROM finance.accounts;");
    await runScript(pg, rollback);
    assert.equal((await one(pg, "SELECT to_regnamespace('finance')::text AS value")).value, null);
    assert.equal((await one(pg, "SELECT to_regnamespace('finance_release')::text AS value")).value, null);
    assert.equal((await one(pg, "SELECT count(*)::int AS n FROM public.expense_categories")).n, 7, "legacy rows survive the rollback");
    await runScript(pg, upgrade); // the database is back to a clean post-upgrade state
    assert.deepEqual(await financeTables(pg), [...expectedTables].sort());
  } finally { await pg.close(); }
});

test("rollback refuses on a database that was never upgraded", async () => {
  const pg = await fixture();
  try {
    await expectRefusal(pg, rollback, /لا شيء للرجوع عنه|لا يوجد سجل ترقية/);
  } finally { await pg.close(); }
});

/** The production scripts are also verified on isolated native PostgreSQL when
 * FINANCE_TEST_PG_BIN points at a local bin directory (opt-in, nothing shared). */
const pgBin = process.env.FINANCE_TEST_PG_BIN;
test("the same upgrade and rollback behave identically on isolated native PostgreSQL",
  { timeout: 240_000, skip: !pgBin }, async t => {
  if (!pgBin || !path.isAbsolute(pgBin)) throw new Error("FINANCE_TEST_PG_BIN must be an absolute path");
  if (process.getuid?.() === 0) { t.skip("initdb requires an unprivileged system user"); return; }
  const tmp = mkdtempSync(path.join(os.tmpdir(), "selahtone-release-scripts-"));
  const data = path.join(tmp, "data"), socket = path.join(tmp, "socket");
  mkdirSync(socket, { mode: 0o700 });
  let pool: Pool | undefined, server: ReturnType<typeof spawn> | undefined;
  try {
    execFileSync(path.join(pgBin, "initdb"), ["-D", data, "--no-locale", "--encoding=UTF8",
      "--auth-local=trust", "--auth-host=reject", "--username=finance_scripts_test"],
      { env: process.env, stdio: "pipe", timeout: 60_000 });
    server = spawn(path.join(pgBin, "postgres"),
      ["-D", data, "-k", socket, "-h", "", "-p", "55441", "-c", "unix_socket_permissions=0700"],
      { stdio: ["ignore", "ignore", "pipe"], env: process.env });
    await new Promise<void>((resolve, reject) => {
      let logs = "", done = false;
      const timer = setTimeout(() => { if (!done) { done = true; reject(new Error("temporary PostgreSQL did not start")); } }, 60_000);
      server!.stderr?.on("data", chunk => {
        logs = (logs + String(chunk)).slice(-4000);
        if (!done && logs.includes("database system is ready to accept connections")) { done = true; clearTimeout(timer); resolve(); }
      });
      server!.once("error", error => { if (!done) { done = true; clearTimeout(timer); reject(error); } });
      server!.once("exit", code => { if (!done) { done = true; clearTimeout(timer); reject(new Error(`PostgreSQL exited ${code}: ${logs}`)); } });
    });
    pool = new Pool({ host: socket, port: 55441, user: "finance_scripts_test", database: "postgres", max: 2, connectionTimeoutMillis: 5000 });
    const client = await pool.connect();
    const run = async (sql: string) => {
      try { for (const statement of splitStatements(sql)) await client.query(statement); }
      catch (error) { await client.query("ROLLBACK;").catch(() => undefined); throw error; }
    };
    try {
      for (const f of baselineFiles) await client.query(read(f));
      await client.query(legacyRows);
      await run(upgrade);
      const tables = (await client.query("SELECT c.relname::text AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='finance' AND c.relkind='r' ORDER BY 1")).rows.map((r: Row) => r.name);
      assert.deepEqual(tables, [...expectedTables].sort());
      const ledger = (await client.query("SELECT name, checksum FROM finance_release.migrations")).rows[0] as Row;
      assert.equal(ledger.name, "finance_release_upgrade");
      assert.equal(ledger.checksum, stampedChecksum(upgrade, "upgrade script"));
      await run(upgrade); // replay
      assert.equal(Number((await client.query("SELECT count(*) AS n FROM finance_release.migrations")).rows[0].n), 1);
      await client.query("INSERT INTO finance.accounts(branch_id,kind,opening_amount,opening_date,opened_by) VALUES(1,'VAULT',0,'2026-10-01',1)");
      await assert.rejects(() => run(rollback), /بيانات مالية مسجلة/);
      await client.query("DELETE FROM finance.accounts");
      await run(rollback);
      const left = (await client.query("SELECT to_regnamespace('finance')::text AS a, to_regnamespace('finance_release')::text AS b")).rows[0] as Row;
      assert.equal(left.a, null); assert.equal(left.b, null);
      assert.equal(Number((await client.query("SELECT count(*) AS n FROM public.expense_categories")).rows[0].n), 7);
      await run(upgrade); // clean post-upgrade state is reachable again
    } finally { client.release(); }
  } finally {
    await pool?.end().catch(() => undefined);
    server?.kill("SIGTERM");
    await new Promise<void>(resolve => { server?.once("exit", () => resolve()); setTimeout(resolve, 5000); });
    server?.kill("SIGKILL");
    rmSync(tmp, { recursive: true, force: true });
  }
});
