/** Synthetic-only tests for the reviewed controls candidate and its rollback.
 * They never use DATABASE_URL and do not claim a production enforcement test. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const upgrade = readFileSync("prisma/manual-finance-controls-upgrade.sql", "utf8");
const rollback = readFileSync("prisma/manual-finance-controls-rollback.sql", "utf8");
const zeros = "0".repeat(64);
const baselineTables = ["accounts","audit_events","cash_counts","category_audit","category_requests","category_revisions",
  "custody_requests","expense_corrections","expense_reviews","expenses","historical_commerce","movements",
  "opening_corrections","payments","reconciliation_cases","reconciliation_notes","requests","settlements"];
const appendOnly = ["movements","requests","request_results","audit_events","category_audit","category_requests",
  "expense_corrections","opening_corrections","historical_commerce","reconciliation_notes"];

function checksum(file: string): string {
  const match = /-- sha256: ([0-9a-f]{64})/.exec(file); assert.ok(match);
  assert.equal(createHash("sha256").update(file.split(match[1]).join(zeros)).digest("hex"), match[1]);
  return match[1];
}
function splitStatements(sql: string): string[] {
  const out: string[] = []; let buffer = "", i = 0, tag: string | null = null;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "-" && sql[i + 1] === "-") { const nl = sql.indexOf("\n", i); i = nl < 0 ? sql.length : nl; continue; }
    if (tag) { if (sql.startsWith(tag, i)) { buffer += tag; i += tag.length; tag = null; } else { buffer += c; i++; } continue; }
    if (c === "$") { const m = /^\$[A-Za-z_0-9]*\$/.exec(sql.slice(i)); if (m) { tag = m[0]; buffer += tag; i += tag.length; continue; } }
    if (c === "'") { const start = i++; while (i < sql.length) { if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue; } if (sql[i++] === "'") break; } buffer += sql.slice(start, i); continue; }
    if (c === ";") { if (buffer.trim()) out.push(buffer.trim()); buffer = ""; i++; continue; }
    buffer += c; i++;
  }
  if (buffer.trim()) out.push(buffer.trim()); return out;
}
async function run(pg: PGlite, sql: string): Promise<void> {
  try { for (const statement of splitStatements(sql)) await pg.exec(statement); }
  catch (error) { await pg.exec("ROLLBACK").catch(() => undefined); throw error; }
}
async function fixture(): Promise<PGlite> {
  const pg = new PGlite();
  await pg.exec("CREATE ROLE selahtone_app LOGIN; CREATE ROLE selahtone_finance_admin NOLOGIN; CREATE ROLE finance_intruder LOGIN; CREATE ROLE finance_release_operator INHERIT LOGIN;");
  const current = (await pg.query<{ user: string }>("SELECT current_user AS user")).rows[0].user;
  await pg.exec(`GRANT selahtone_finance_admin TO ${current},finance_release_operator`);
  await pg.exec("CREATE SCHEMA finance; CREATE SCHEMA finance_release;");
  for (const table of baselineTables) await pg.exec(`CREATE TABLE finance.${table}(id bigint PRIMARY KEY)`);
  await pg.exec("CREATE TABLE finance_release.migrations(name text PRIMARY KEY,checksum char(64) NOT NULL,applied_at timestamptz NOT NULL DEFAULT now(),applied_by name NOT NULL DEFAULT session_user)");
  await pg.exec("CREATE TABLE public.users(id bigint PRIMARY KEY); INSERT INTO public.users VALUES(1); INSERT INTO finance.requests VALUES(1)");
  for (const table of baselineTables) await pg.exec(`ALTER TABLE finance.${table} OWNER TO selahtone_finance_admin`);
  await pg.exec("ALTER SCHEMA finance OWNER TO finance_release_operator; ALTER SCHEMA finance_release OWNER TO finance_release_operator; ALTER TABLE finance_release.migrations OWNER TO finance_release_operator");
  await pg.exec("GRANT USAGE ON SCHEMA finance TO selahtone_app,finance_intruder");
  await pg.exec("GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA finance TO selahtone_app");
  await pg.exec("GRANT ALL ON ALL TABLES IN SCHEMA finance TO finance_intruder");
  await pg.exec("ALTER TABLE public.users OWNER TO finance_release_operator; GRANT USAGE,CREATE ON SCHEMA finance TO finance_release_operator");
  return pg;
}
/** Execute with the observed non-superuser SQL-editor identity: it owns
 * public.users, inherits finance admin, and has both USAGE and CREATE. */
async function apply(pg: PGlite, script = upgrade): Promise<void> {
  await pg.exec("SET SESSION AUTHORIZATION finance_release_operator");
  try { await run(pg, script.replaceAll("neondb_owner", "finance_release_operator")); }
  finally { await pg.exec("RESET ROLE; SET SESSION AUTHORIZATION postgres"); }
}
async function controls(pg: PGlite) {
  return (await pg.query<{ tables: number; rls: number; forced: number; policies: number; triggers: number }>(`SELECT
   (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='finance' AND c.relkind='r') AS tables,
   (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='finance' AND c.relkind='r' AND c.relrowsecurity) AS rls,
   (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='finance' AND c.relkind='r' AND c.relforcerowsecurity) AS forced,
   (SELECT count(*)::int FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='finance') AS policies,
   (SELECT count(*)::int FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='finance' AND NOT t.tgisinternal) AS triggers`)).rows[0];
}

test("checksums pin both reviewed files", () => {
  assert.equal(checksum(upgrade).length, 64); assert.equal(checksum(rollback).length, 64);
  assert.ok(rollback.includes(`-- upgrade_sha256: ${checksum(upgrade)}`));
  assert.equal(upgrade.match(/^ GRANT USAGE ON SCHEMA finance TO selahtone_finance_admin;$/m)?.length, 1);
  assert.equal(upgrade.match(/^ REVOKE USAGE ON SCHEMA finance FROM selahtone_finance_admin;$/m)?.length, 1);
  assert.equal(upgrade.match(/^SET LOCAL ROLE selahtone_finance_admin;/gm)?.length, 1);
  assert.equal(upgrade.match(/^RESET ROLE;/gm)?.length, 1);
  assert.doesNotMatch(upgrade, /ALTER TABLE finance\.request_results OWNER/);
});

test("default deny, one allowed app path, and every append-only trigger are exercised", { timeout: 120_000 }, async () => {
  const pg = await fixture();
  try {
    await pg.exec("SET SESSION AUTHORIZATION finance_release_operator");
    const beforeGrants = await pg.query<{ usage: boolean; create: boolean }>("SELECT has_schema_privilege(current_user,'finance','USAGE') AS usage,has_schema_privilege(current_user,'finance','CREATE') AS create");
    assert.deepEqual(beforeGrants.rows[0], { usage: true, create: true });
    await pg.exec("SET SESSION AUTHORIZATION postgres");
    await apply(pg);
    assert.deepEqual(await controls(pg), { tables: 19, rls: 19, forced: 0, policies: 19, triggers: appendOnly.length });
    assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance.requests")).rows[0].n, 1, "existing rows survive");
    assert.equal((await pg.query<{ owner: string }>("SELECT pg_get_userbyid(relowner)::text AS owner FROM pg_class WHERE oid='finance.request_results'::regclass")).rows[0].owner, "selahtone_finance_admin");
    assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid='finance.request_results'::regclass AND contype='f' AND confrelid='public.users'::regclass")).rows[0].n, 1);
    assert.equal((await pg.query<{ allowed: boolean }>("SELECT has_table_privilege('selahtone_finance_admin','public.users','REFERENCES') AS allowed")).rows[0].allowed, false, "temporary REFERENCES must be revoked");
    assert.equal((await pg.query<{ allowed: boolean }>("SELECT has_schema_privilege('selahtone_finance_admin','finance','CREATE') AS allowed")).rows[0].allowed, false, "temporary schema CREATE must be revoked");
    assert.equal((await pg.query<{ allowed: boolean }>("SELECT has_schema_privilege('selahtone_finance_admin','finance','USAGE') AS allowed")).rows[0].allowed, false, "temporary schema USAGE must be revoked");
    assert.equal((await pg.query<{ allowed: boolean }>("SELECT has_schema_privilege('selahtone_finance_admin','finance_release','USAGE') AS allowed")).rows[0].allowed, false, "temporary ledger schema USAGE must be revoked");
    await pg.exec("SET SESSION AUTHORIZATION finance_release_operator");
    const operatorGrants = await pg.query<{ usage: boolean; create: boolean }>("SELECT has_schema_privilege(current_user,'finance','USAGE') AS usage,has_schema_privilege(current_user,'finance','CREATE') AS create");
    assert.deepEqual(operatorGrants.rows[0], { usage: true, create: true }, "existing schema privileges must remain untouched");
    await pg.exec("SET SESSION AUTHORIZATION postgres");

    await pg.exec("SET ROLE selahtone_app");
    for (const table of [...baselineTables, "request_results"]) await pg.query(`SELECT count(*) FROM finance.${table}`);
    await pg.exec("INSERT INTO finance.request_results(request_id,action,actor_id,result_table,result_id) VALUES('11111111-1111-4111-8111-111111111111','TEST',1,'requests',1)");
    for (const table of appendOnly) {
      const column = table === "request_results" ? "request_id" : "id";
      await assert.rejects(() => pg.exec(`UPDATE finance.${table} SET ${column}=${column} WHERE false`), new RegExp(`FINANCE_APPEND_ONLY_IMMUTABLE`), table);
    }
    await assert.rejects(() => pg.exec("UPDATE finance.request_results SET action='EDITED'"), /FINANCE_APPEND_ONLY_IMMUTABLE/);
    await assert.rejects(() => pg.exec("DELETE FROM finance.request_results"), /FINANCE_APPEND_ONLY_IMMUTABLE|permission denied/);
    await pg.exec("RESET ROLE");

    await pg.exec("SET ROLE finance_intruder");
    await assert.rejects(() => pg.query("SELECT * FROM finance.request_results"), /row-level security|permission denied/);
    await assert.rejects(() => pg.exec("INSERT INTO finance.request_results(request_id,action,actor_id,result_table,result_id) VALUES('22222222-2222-4222-8222-222222222222','TEST',1,'requests',1)"), /row-level security|permission denied/);
    await pg.exec("RESET ROLE");

    await assert.rejects(() => apply(pg), /already applied|request_results already exists/);
    await assert.rejects(() => apply(pg, rollback), /request results exist/);
    assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance.request_results")).rows[0].n, 1);
  } finally { await pg.close(); }
});

test("rollback restores the observed 18-table control state without touching existing rows", { timeout: 120_000 }, async () => {
  const pg = await fixture();
  try {
    await apply(pg); await apply(pg, rollback);
    assert.deepEqual(await controls(pg), { tables: 18, rls: 0, forced: 0, policies: 0, triggers: 0 });
    assert.equal((await pg.query<{ value: string | null }>("SELECT to_regclass('finance.request_results')::text AS value")).rows[0].value, null);
    assert.equal((await pg.query<{ value: string | null }>("SELECT to_regprocedure('finance.append_only_guard()')::text AS value")).rows[0].value, null);
    assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance.requests")).rows[0].n, 1);
    assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance_release.migrations WHERE name='finance_controls_upgrade'")).rows[0].n, 0);
  } finally { await pg.close(); }
});

test("DDL failure names its stage and leaves no partial objects", async () => {
  const pg = await fixture();
  try {
    await pg.exec("ALTER TABLE public.users OWNER TO postgres; REVOKE ALL ON public.users FROM finance_release_operator");
    await assert.rejects(() => apply(pg), /FINANCE_STAGE_(TEMP_ADMIN_GRANTS|CREATE_REQUEST_RESULTS)/);
    assert.equal((await pg.query<{ value: string | null }>("SELECT to_regclass('finance.request_results')::text AS value")).rows[0].value, null);
    assert.deepEqual(await controls(pg), { tables: 18, rls: 0, forced: 0, policies: 0, triggers: 0 });
  } finally { await pg.close(); }
});

test("candidate refuses a different schema before creating anything", async () => {
  const pg = await fixture();
  try {
    await pg.exec("DROP TABLE finance.settlements");
    await assert.rejects(() => apply(pg), /expected the observed 18-table schema/);
    assert.equal((await pg.query<{ value: string | null }>("SELECT to_regclass('finance.request_results')::text AS value")).rows[0].value, null);
    assert.deepEqual(await controls(pg), { tables: 17, rls: 0, forced: 0, policies: 0, triggers: 0 });
  } finally { await pg.close(); }
});
