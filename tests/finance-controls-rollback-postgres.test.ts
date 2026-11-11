/** Full controls upgrade/rollback rehearsal on an isolated native PostgreSQL.
 * Never reads DATABASE_URL or connects to an existing database. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client } from "pg";

const upgrade = readFileSync("prisma/manual-finance-controls-upgrade.sql", "utf8");
const rollback = readFileSync("prisma/manual-finance-controls-rollback.sql", "utf8");
const baselineTables = ["accounts","audit_events","cash_counts","category_audit","category_requests","category_revisions",
  "custody_requests","expense_corrections","expense_reviews","expenses","historical_commerce","movements",
  "opening_corrections","payments","reconciliation_cases","reconciliation_notes","requests","settlements"];

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
async function run(client: Client, sql: string): Promise<void> {
  try { for (const statement of splitStatements(sql)) await client.query(statement); }
  catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
}
async function apply(client: Client, script = upgrade): Promise<void> {
  await client.query("SET SESSION AUTHORIZATION finance_release_operator");
  try { await run(client, script.replaceAll("neondb_owner", "finance_release_operator")); }
  finally { await client.query("RESET ROLE; SET SESSION AUTHORIZATION postgres"); }
}

/** Canonical logical state, not pg_dump timestamps or ACL text ordering. */
async function fingerprint(client: Client): Promise<unknown> {
  const schemas = `SELECT n.nspname AS name,pg_get_userbyid(n.nspowner)::text AS owner FROM pg_namespace n WHERE n.nspname IN('finance','finance_release') ORDER BY 1`;
  const objects = `SELECT n.nspname AS schema,c.relname AS name,c.relkind::text AS kind,pg_get_userbyid(c.relowner)::text AS owner,c.relrowsecurity AS rls,c.relforcerowsecurity AS forced FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE (n.nspname IN('finance','finance_release') OR (n.nspname='public' AND c.relname='users')) ORDER BY 1,2,3`;
  const columns = `SELECT n.nspname AS schema,c.relname AS table,a.attname AS column,a.atttypid::regtype::text AS type,a.attnotnull AS required,pg_get_expr(d.adbin,d.adrelid) AS default FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE (n.nspname IN('finance','finance_release') OR (n.nspname='public' AND c.relname='users')) AND a.attnum>0 AND NOT a.attisdropped ORDER BY 1,2,3`;
  const constraints = `SELECT n.nspname AS schema,c.relname AS table,con.conname AS name,con.contype::text AS kind,pg_get_constraintdef(con.oid,true) AS definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE (n.nspname IN('finance','finance_release') OR (n.nspname='public' AND c.relname='users')) ORDER BY 1,2,3,4`;
  const indexes = `SELECT schemaname AS schema,tablename AS table,indexname AS name,indexdef AS definition FROM pg_indexes WHERE (schemaname IN('finance','finance_release') OR (schemaname='public' AND tablename='users')) ORDER BY 1,2,3`;
  const functions = `SELECT n.nspname AS schema,p.proname AS name,pg_get_function_identity_arguments(p.oid) AS arguments,pg_get_userbyid(p.proowner)::text AS owner,p.prosrc AS body FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('finance','finance_release') ORDER BY 1,2,3`;
  const triggers = `SELECT n.nspname AS schema,c.relname AS table,t.tgname AS name,pg_get_triggerdef(t.oid,true) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE (n.nspname IN('finance','finance_release') OR (n.nspname='public' AND c.relname='users')) AND NOT t.tgisinternal ORDER BY 1,2,3`;
  const policies = `SELECT n.nspname AS schema,c.relname AS table,p.polname AS name,p.polcmd::text AS command,pg_get_expr(p.polqual,p.polrelid) AS qualifier,pg_get_expr(p.polwithcheck,p.polrelid) AS check FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE (n.nspname IN('finance','finance_release') OR (n.nspname='public' AND c.relname='users')) ORDER BY 1,2,3`;
  const tableGrants = `SELECT n.nspname AS schema,c.relname AS table,grantee.rolname::text AS grantee,a.privilege_type::text AS privilege,a.is_grantable AS grantable FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a JOIN pg_roles grantee ON grantee.oid=a.grantee WHERE (n.nspname IN('finance','finance_release') OR (n.nspname='public' AND c.relname='users')) ORDER BY 1,2,3,4`;
  const schemaGrants = `SELECT n.nspname AS schema,grantee.rolname::text AS grantee,a.privilege_type::text AS privilege,a.is_grantable AS grantable FROM pg_namespace n CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl,acldefault('n',n.nspowner))) a JOIN pg_roles grantee ON grantee.oid=a.grantee WHERE n.nspname IN('finance','finance_release') ORDER BY 1,2,3`;
  const ledger = `SELECT name,checksum,applied_by::text AS applied_by FROM finance_release.migrations ORDER BY name`;
  const rows = `SELECT id,marker FROM finance.requests ORDER BY id`;
  const userRows = `SELECT id FROM public.users ORDER BY id`;
  const result: Record<string, unknown> = {};
  for (const [name, sql] of Object.entries({ schemas, objects, columns, constraints, indexes, functions, triggers, policies, tableGrants, schemaGrants, ledger, rows, userRows })) {
    result[name] = (await client.query(sql)).rows;
  }
  return result;
}

const bin = process.env.FINANCE_TEST_PG_BIN;
test("controls release candidate restores the exact logical state twice on native PostgreSQL", { timeout: 120_000, skip: !bin }, async () => {
  assert.ok(bin, "FINANCE_TEST_PG_BIN is required for the disposable native rehearsal");
  const dir = mkdtempSync(join(tmpdir(), "selahtone-controls-rehearsal-")), data = join(dir, "data");
  const ctl = (args: string[]) => execFileSync(join(bin, "pg_ctl"), args, { stdio: "pipe", timeout: 20_000 });
  let started = false, client: Client | undefined;
  try {
    execFileSync(join(bin, "initdb"), ["-D", data, "-U", "postgres", "--no-locale", "--encoding=UTF8", "--auth=trust"], { stdio: "pipe", timeout: 20_000 });
    ctl(["-D", data, "-l", join(dir, "postgres.log"), "-o", `-k ${dir} -p 55443 -c listen_addresses=''`, "-w", "start"]); started = true;
    client = new Client({ host: dir, port: 55443, user: "postgres", database: "postgres" }); await client.connect();
    await client.query("CREATE ROLE selahtone_app LOGIN; CREATE ROLE selahtone_finance_admin NOLOGIN; CREATE ROLE finance_intruder LOGIN; CREATE ROLE finance_release_operator INHERIT LOGIN");
    await client.query("GRANT selahtone_finance_admin TO postgres,finance_release_operator; GRANT selahtone_app TO finance_release_operator WITH ADMIN OPTION, INHERIT FALSE, SET FALSE");
    await client.query("CREATE SCHEMA finance; CREATE SCHEMA finance_release");
    for (const table of baselineTables) await client.query(`CREATE TABLE finance.${table}(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, marker text)`);
    await client.query("CREATE TABLE finance_release.migrations(name text PRIMARY KEY,checksum char(64) NOT NULL,applied_at timestamptz NOT NULL DEFAULT now(),applied_by name NOT NULL DEFAULT session_user)");
    await client.query("CREATE TABLE public.users(id bigint PRIMARY KEY); INSERT INTO public.users VALUES(1); INSERT INTO finance.requests OVERRIDING SYSTEM VALUE VALUES(1,'original')");
    for (const table of baselineTables) await client.query(`ALTER TABLE finance.${table} OWNER TO selahtone_finance_admin`);
    await client.query("ALTER SCHEMA finance OWNER TO finance_release_operator; ALTER SCHEMA finance_release OWNER TO finance_release_operator; ALTER TABLE finance_release.migrations OWNER TO finance_release_operator");
    await client.query("GRANT USAGE ON SCHEMA finance TO selahtone_app,finance_intruder; GRANT SELECT ON public.users TO selahtone_app; GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA finance TO selahtone_app; GRANT ALL ON ALL TABLES IN SCHEMA finance TO finance_intruder");
    await client.query("ALTER TABLE public.users OWNER TO finance_release_operator; GRANT USAGE,CREATE ON SCHEMA finance TO finance_release_operator");

    const before = await fingerprint(client);
    for (let cycle = 1; cycle <= 2; cycle++) {
      await apply(client);
      assert.equal((await client.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='finance' AND c.relkind='r' AND c.relrowsecurity")).rows[0].n, 19);
      await apply(client, rollback);
      assert.deepEqual(await fingerprint(client), before, `rollback cycle ${cycle} must restore every logical object and grant`);
    }
  } finally {
    if (client) await client.end();
    if (started) ctl(["-D", data, "-m", "immediate", "-w", "stop"]);
    rmSync(dir, { recursive: true, force: true });
  }
});
