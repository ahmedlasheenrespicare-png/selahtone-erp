/** Disposable finance RELEASE CANDIDATE tests. No DATABASE_URL, no seed, no network.
 * They install an experimental schema on a throwaway database that mimics the
 * audited production shape (7 legacy categories) and verify the legacy rows are
 * untouched, the script is replayable, and a late failure rolls everything back.
 * This is a review draft, NOT an approved migration and NOT a release decision. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";

const root = process.cwd(), read = (f: string) => readFileSync(path.join(root, f), "utf8");
const candidate = read("prototypes/finance-release/release-candidate.test-only.sql");
const preflight = read("prisma/manual-finance-release-preflight.sql");
const postflight = read("prisma/manual-finance-release-postflight.sql");
const baselineFiles = ["tests/fixtures/inventory-baseline.sql", "prisma/manual-inventory-upgrade.sql",
  "prisma/manual-receiving-upgrade.sql", "prisma/manual-commerce-upgrade.sql", "tests/fixtures/finance-legacy-categories.sql"];
// Legacy rows exist here even though the production audit saw zero at its moment:
// preservation must hold if any row appears before the release is applied.
const legacyRows = `INSERT INTO public.expenses(branch_id,category_id,amount,expense_date,status,requested_by)
   VALUES(1,1,125.50,'2026-01-05','APPROVED',1),(2,3,40.00,'2026-02-11','DRAFT',2);
 INSERT INTO public.journal_entries(entry_no,entry_date,source_type,source_id) VALUES('TEST-1','2026-01-05','EXPENSE',1);`;
type Digest = { categories: string; expenses: number; journals: number; categoryDigest: string; expenseDigest: string; journalDigest: string };
async function digests(query: (sql: string) => Promise<Array<Record<string, unknown>>>): Promise<Digest> {
  const rows = await query(`SELECT
   (SELECT count(*)::int FROM public.expense_categories) AS categories,
   (SELECT count(*)::int FROM public.expenses) AS expenses,
   (SELECT count(*)::int FROM public.journal_entries) AS journals,
   (SELECT md5(COALESCE(string_agg(id||'|'||code||'|'||name_ar||'|'||is_active::text,'#' ORDER BY id),'')) FROM public.expense_categories) AS "categoryDigest",
   (SELECT md5(COALESCE(string_agg(id||'|'||branch_id||'|'||category_id||'|'||amount::text||'|'||expense_date||'|'||status,'#' ORDER BY id),'')) FROM public.expenses) AS "expenseDigest",
   (SELECT md5(COALESCE(string_agg(id||'|'||entry_no||'|'||entry_date||'|'||source_type||'|'||source_id,'#' ORDER BY id),'')) FROM public.journal_entries) AS "journalDigest"`);
  return rows[0] as unknown as Digest;
}
/** The stamped checksum must equal sha256 of the file with the literal zeroed. */
function stampedChecksum(): string {
  const found = /-- sha256: ([0-9a-f]{64})/.exec(candidate);
  assert.ok(found, "the candidate file must carry a sha256 comment");
  const zeros = "0".repeat(64);
  assert.equal(createHash("sha256").update(candidate.split(found[1]).join(zeros)).digest("hex"), found[1],
    "candidate checksum is stale; re-stamp after editing the script");
  return found[1];
}
async function pgliteFixture(): Promise<PGlite> {
  const pg = new PGlite();
  for (const f of baselineFiles) await pg.exec(read(f));
  await pg.exec(legacyRows);
  return pg;
}
async function applyPglite(pg: PGlite, script = candidate): Promise<void> {
  await pg.exec("SET selahtone.finance_release_candidate_test_only='yes'");
  await pg.exec(script);
}

test("candidate refuses any database without the explicit disposable opt-in", async () => {
  const pg = await pgliteFixture();
  try {
    await assert.rejects(() => pg.exec(candidate), /opted-in disposable database/);
    const ns = await pg.query<{ value: string | null }>("SELECT to_regnamespace('finance')::text AS value");
    assert.equal(ns.rows[0].value, null);
    assert.equal((await pg.query<{ value: string | null }>("SELECT to_regnamespace('finance_release')::text AS value")).rows[0].value, null);
  } finally { await pg.close(); }
});

test("candidate refuses a database missing the audited baseline", async () => {
  const pg = new PGlite();
  try {
    await pg.exec("CREATE TABLE public.branches(id bigint PRIMARY KEY); CREATE TABLE public.users(id bigint PRIMARY KEY);");
    await pg.exec("SET selahtone.finance_release_candidate_test_only='yes'");
    await assert.rejects(() => pg.exec(candidate), /baseline object missing/);
    assert.equal((await pg.query<{ value: string | null }>("SELECT to_regnamespace('finance')::text AS value")).rows[0].value, null);
  } finally { await pg.close(); }
});

test("candidate installs a reviewable schema and never touches legacy rows", { timeout: 120_000 }, async t => {
  const pg = await pgliteFixture();
  try {
    const before = await digests(sql => pg.query(sql).then(r => r.rows as Array<Record<string, unknown>>));
    assert.equal(before.categories, 7); assert.equal(before.expenses, 2); assert.equal(before.journals, 1);
    await applyPglite(pg);
    const after = await digests(sql => pg.query(sql).then(r => r.rows as Array<Record<string, unknown>>));
    assert.deepEqual(after, before);
    const tables = (await pg.query<{ name: string }>("SELECT relname::text AS name FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='finance' AND c.relkind='r'")).rows.map(r => r.name);
    for (const expected of ["accounts", "cash_counts", "expenses", "payments", "expense_reviews", "expense_corrections", "opening_corrections", "historical_commerce", "reconciliation_cases", "reconciliation_notes", "movements", "requests", "audit_events"]) {
      assert.ok(tables.includes(expected), `missing finance.${expected}`);
    }
    // Attachments stay out until a storage design and its tests are approved.
    assert.ok(!tables.includes("expense_attachments") && !tables.includes("attachment_quota"));
    const ledger = (await pg.query<{ name: string; checksum: string }>("SELECT name,checksum FROM finance_release.migrations")).rows;
    assert.deepEqual(ledger, [{ name: "finance_release_candidate", checksum: stampedChecksum() }]);
    const deferred = (await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='finance' AND NOT t.tgisinternal AND t.tgdeferrable")).rows[0];
    assert.equal(deferred.n, 0, "deferred COMMIT checks stay out until the connection lifecycle is tested");
    const foreign = (await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM pg_catalog.pg_constraint con JOIN pg_catalog.pg_class src ON src.oid=con.conrelid
      JOIN pg_catalog.pg_namespace ns ON ns.oid=src.relnamespace WHERE con.contype='f' AND ns.nspname='finance'`)).rows[0];
    assert.ok(foreign.n > 10, "the candidate must reference the real public tables");

    await t.test("reapplying the same script is a no-op and a modified script is refused", async () => {
      const first = (await pg.query<{ applied_at: string }>("SELECT applied_at::text FROM finance_release.migrations")).rows[0];
      await applyPglite(pg);
      const second = (await pg.query<{ applied_at: string; n: number }>("SELECT applied_at::text,(SELECT count(*)::int FROM finance_release.migrations) AS n FROM finance_release.migrations")).rows[0];
      assert.equal(second.n, 1); assert.equal(second.applied_at, first.applied_at);
      const modified = candidate.split(stampedChecksum()).join("f".repeat(64));
      await assert.rejects(() => applyPglite(pg, modified), /checksum changed/);
      assert.deepEqual(await digests(sql => pg.query(sql).then(r => r.rows as Array<Record<string, unknown>>)), before);
    });

    await t.test("preflight and postflight are read-only and agree on the legacy snapshot", async () => {
      const before = await pg.query("SELECT to_jsonb(e) AS value FROM public.expenses e ORDER BY id");
      const pre = await pg.exec(preflight);
      assert.equal(pre.length, 3);
      const report = JSON.parse((pre[1].rows[0] as { finance_release_preflight: string }).finance_release_preflight) as {
        inspection_role_only: boolean; missing_required_objects: string[]; legacy_counts: { expense_categories: number; expenses: number };
        legacy_digests: { expense_categories: string; expenses: string }; conflicting_public_names: Array<{ name: string }>; finance_namespaces: string[] };
      assert.equal(report.inspection_role_only, true);
      assert.deepEqual(report.missing_required_objects, []);
      assert.equal(report.legacy_counts.expense_categories, 7); assert.equal(report.legacy_counts.expenses, 2);
      assert.equal(report.legacy_digests.expenses, before.rows.length > 0 ? (await digests(sql => pg.query(sql).then(r => r.rows as Array<Record<string, unknown>>))).expenseDigest : "");
      assert.deepEqual(report.conflicting_public_names, []);
      assert.ok(report.finance_namespaces.includes("finance"));
      const post = await pg.exec(postflight);
      assert.equal(post.length, 3);
      const after = JSON.parse((post[1].rows[0] as { finance_release_postflight: string }).finance_release_postflight) as {
        finance_table_count: number; finance_deferred_triggers: number; legacy_user_triggers: number;
        legacy_counts: { expense_categories: number; expenses: number }; legacy_digests: { expenses: string };
        finance_row_counts: Record<string, number>; migration_ledger: Array<{ name: string }> };
      assert.equal(after.legacy_counts.expenses, 2); assert.equal(after.legacy_counts.expense_categories, 7);
      assert.equal(after.legacy_digests.expenses, report.legacy_digests.expenses);
      assert.equal(after.legacy_user_triggers, 0, "the candidate must not add triggers to legacy tables");
      assert.equal(after.finance_deferred_triggers, 0);
      assert.equal(after.finance_row_counts.expenses, 0, "a fresh install starts with no finance rows");
      assert.deepEqual(after.migration_ledger.map(x => x.name), ["finance_release_candidate"]);
      assert.deepEqual(await pg.query("SELECT to_jsonb(e) AS value FROM public.expenses e ORDER BY id"), before);
      // A read-only script cannot write even if it is run again.
      await assert.rejects(() => pg.exec(preflight.replace("ROLLBACK;", "INSERT INTO public.expenses(branch_id,category_id,amount,expense_date,status,requested_by) VALUES(1,1,1,'2026-03-01','DRAFT',1); ROLLBACK;")), /read-only/);
    });

    await t.test("a late failure inside the candidate leaves no partial schema behind", async () => {
      const fresh = await pgliteFixture();
      try {
        const before = await digests(sql => fresh.query(sql).then(r => r.rows as Array<Record<string, unknown>>));
        const broken = candidate.replace("-- Record the applied script.", "SELECT 1/0;\n-- Record the applied script.");
        assert.notEqual(broken, candidate);
        await assert.rejects(() => fresh.transaction(async tx => {
          await tx.exec("SET selahtone.finance_release_candidate_test_only='yes'");
          await tx.exec(broken);
        }), /division by zero/);
        assert.equal((await fresh.query<{ value: string | null }>("SELECT to_regnamespace('finance')::text AS value")).rows[0].value, null);
        assert.equal((await fresh.query<{ value: string | null }>("SELECT to_regnamespace('finance_release')::text AS value")).rows[0].value, null);
        assert.deepEqual(await digests(sql => fresh.query(sql).then(r => r.rows as Array<Record<string, unknown>>)), before);
      } finally { await fresh.close(); }
    });
  } finally { await pg.close(); }
});

const pgBin = process.env.FINANCE_TEST_PG_BIN;
test("release candidate behaves the same on isolated native PostgreSQL", { timeout: 180_000, skip: !pgBin }, async t => {
  if (!pgBin || !path.isAbsolute(pgBin) || !existsSync(path.join(pgBin, "initdb")) || !existsSync(path.join(pgBin, "postgres"))) throw new Error("FINANCE_TEST_PG_BIN must name a local PostgreSQL bin directory");
  if (process.getuid?.() === 0) { t.skip("initdb requires an unprivileged system user"); return; }
  const tmp = mkdtempSync(path.join(os.tmpdir(), "selahtone-release-candidate-")), data = path.join(tmp, "data"), socket = path.join(tmp, "socket");
  mkdirSync(socket, { mode: 0o700 });
  let server: ChildProcess | undefined, pool: Pool | undefined;
  try {
    execFileSync(path.join(pgBin, "initdb"), ["-D", data, "--no-locale", "--encoding=UTF8", "--auth-local=trust", "--auth-host=reject", "--username=finance_rc_test"], { env: process.env, stdio: "pipe", timeout: 30_000 });
    server = spawn(path.join(pgBin, "postgres"), ["-D", data, "-k", socket, "-h", "", "-p", "55437", "-c", "unix_socket_permissions=0700"], { stdio: ["ignore", "ignore", "pipe"], env: process.env });
    await new Promise<void>((resolve, reject) => {
      let logs = "", done = false;
      const timer = setTimeout(() => { if (!done) { done = true; reject(new Error("temporary PostgreSQL did not start")); } }, 30_000);
      server!.stderr?.on("data", chunk => { logs = (logs + String(chunk)).slice(-4000); if (!done && logs.includes("database system is ready to accept connections")) { done = true; clearTimeout(timer); resolve(); } });
      server!.once("error", error => { if (!done) { done = true; clearTimeout(timer); reject(error); } });
      server!.once("exit", code => { if (!done) { done = true; clearTimeout(timer); reject(new Error(`PostgreSQL exited ${code}: ${logs}`)); } });
    });
    pool = new Pool({ host: socket, port: 55437, user: "finance_rc_test", database: "postgres", max: 4, connectionTimeoutMillis: 5000 });
    const setup = await pool.connect();
    try {
      assert.equal((await setup.query("SELECT current_setting('listen_addresses') AS listen")).rows[0].listen, "");
      for (const f of baselineFiles) await setup.query(read(f));
      await setup.query(legacyRows);
    } finally { setup.release(); }
    const query = async (sql: string) => (await pool!.query(sql)).rows as Array<Record<string, unknown>>;
    const before = await digests(query);
    assert.equal(before.categories, 7); assert.equal(before.expenses, 2); assert.equal(before.journals, 1);

    await t.test("atomic install, replay safety and read-only checks", async () => {
      await pool!.query("BEGIN");
      try {
        await pool!.query("SET LOCAL selahtone.finance_release_candidate_test_only='yes'");
        await pool!.query(candidate);
        await pool!.query("COMMIT");
      } catch (error) { await pool!.query("ROLLBACK").catch(() => {}); throw error; }
      assert.deepEqual(await digests(query), before);
      const ledger = (await pool!.query("SELECT name,checksum FROM finance_release.migrations")).rows;
      assert.deepEqual(ledger, [{ name: "finance_release_candidate", checksum: stampedChecksum() }]);
      await pool!.query("SET selahtone.finance_release_candidate_test_only='yes'");
      await pool!.query(candidate); // replay
      assert.equal(Number((await pool!.query("SELECT count(*) AS n FROM finance_release.migrations")).rows[0].n), 1);
      const pre = await pool!.query(preflight) as unknown as Array<{ rows: Array<{ finance_release_preflight: string }> }>;
      assert.equal(pre.length, 3);
      const report = JSON.parse(pre[1].rows[0].finance_release_preflight) as { legacy_counts: { expense_categories: number; expenses: number }; legacy_digests: { expenses: string } };
      assert.equal(report.legacy_counts.expense_categories, 7); assert.equal(report.legacy_counts.expenses, 2);
      const post = await pool!.query(postflight) as unknown as Array<{ rows: Array<{ finance_release_postflight: string }> }>;
      const after = JSON.parse(post[1].rows[0].finance_release_postflight) as { legacy_digests: { expenses: string }; finance_row_counts: Record<string, number>; legacy_user_triggers: number };
      assert.equal(after.legacy_digests.expenses, report.legacy_digests.expenses);
      assert.equal(after.legacy_user_triggers, 0);
      assert.equal(after.finance_row_counts.movements, 0);
    });
    await t.test("a late failure rolls the whole candidate back on a fresh PostgreSQL database", async () => {
      // A separate database proves an aborted install leaves nothing behind,
      // because the main database already carries the successful install.
      const name = "finance_rc_fail";
      await pool!.query(`DROP DATABASE IF EXISTS ${name}`);
      await pool!.query(`CREATE DATABASE ${name}`);
      const other = new Pool({ host: socket, port: 55437, user: "finance_rc_test", database: name, max: 2, connectionTimeoutMillis: 5000 });
      try {
        const setup = await other.connect();
        try { for (const f of baselineFiles) await setup.query(read(f)); await setup.query(legacyRows); }
        finally { setup.release(); }
        const broken = candidate.replace("-- Record the applied script.", "SELECT 1/0;\n-- Record the applied script.");
        assert.notEqual(broken, candidate);
        await other.query("BEGIN");
        try {
          await other.query("SET LOCAL selahtone.finance_release_candidate_test_only='yes'");
          await assert.rejects(() => other.query(broken), /division by zero/);
        } finally { await other.query("ROLLBACK"); }
        assert.equal((await other.query("SELECT to_regnamespace('finance')::text AS value")).rows[0].value, null);
        assert.equal((await other.query("SELECT to_regnamespace('finance_release')::text AS value")).rows[0].value, null);
        const check = await digests(sql => other.query(sql).then(r => r.rows as Array<Record<string, unknown>>));
        assert.equal(check.categories, before.categories); assert.equal(check.expenses, before.expenses);
        assert.equal(check.expenseDigest, before.expenseDigest);
      } finally { await other.end().catch(() => {}); }
      await pool!.query(`DROP DATABASE ${name}`);
    });
  } finally {
    if (pool) await pool.end().catch(() => {});
    if (server && server.exitCode === null && server.signalCode === null) {
      const exited = new Promise<void>(resolve => server!.once("exit", () => resolve()));
      server.kill("SIGTERM");
      let timer: NodeJS.Timeout | undefined;
      const clean = await Promise.race([exited.then(() => true), new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 5000); })]);
      if (timer) clearTimeout(timer);
      if (!clean) { server.kill("SIGKILL"); await exited; }
    }
    rmSync(tmp, { recursive: true, force: true });
  }
});
