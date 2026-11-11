/**
 * TEST ONLY. Reproduces, on a disposable database, the two facts that make
 * "app identity & privileges" the top readiness blocker:
 *
 *  1. The existing release audit declares inspection_role_only=true: it reports
 *     the SQL Editor role, not the role the deployed app connects with.
 *  2. REVOKE DELETE/TRUNCATE is ineffective when the login inherits a
 *     predefined write-all-data role (the documented neondb_owner situation).
 *
 * The probe under test is read-only, leaks no secrets, and only reports role
 * identity plus explicitly selected pg_roles flags (never rolpassword).
 * Nothing here touches production, DATABASE_URL, or any real data.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const probe = readFileSync("prototypes/finance-app-identity/app-connection-probe.test-only.sql", "utf8");
const audit = readFileSync("prisma/manual-finance-release-audit.sql", "utf8");

type Probe = {
  probe_scope: string;
  probe_version: string;
  read_only_transaction: boolean;
  current_user: string;
  session_user: string;
  role_flags: Record<string, boolean>;
  inherited_roles: string[];
  inherits_write_all_data: boolean;
  inherits_read_all_data: boolean;
  can_create_schema: boolean;
  finance_schema_present: boolean;
  finance_schema_owned_by_current_user: boolean | null;
  can_create_in_finance: boolean | null;
  finance_object_count: number;
  finance_objects: Array<{
    table_name: string; owned_by_current_user: boolean;
    can_select: boolean; can_insert: boolean; can_update: boolean;
    can_delete: boolean; can_truncate: boolean; rls_active: boolean;
  }>;
  limitations: string[];
};

async function runProbe(pg: PGlite): Promise<Probe> {
  const results = await pg.exec(probe);
  assert.equal(results.length, 4, "BEGIN / SET LOCAL / SELECT / ROLLBACK");
  const found = results.find((r) => r.rows?.[0] && "app_connection_probe" in (r.rows[0] as object));
  assert(found, "probe SELECT result present");
  const row = found.rows[0] as { app_connection_probe: string };
  return JSON.parse(row.app_connection_probe) as Probe;
}

const SECRETS = ["CUSTOMER_SECRET_FOR_TEST", "EXPENSE_SECRET_FOR_TEST", "01099999999", "9182.31", "HASHED_PASSWORD_FOR_TEST"];

async function fixture(pg: PGlite): Promise<void> {
  await pg.exec(`
    CREATE SCHEMA finance;
    CREATE TABLE finance.movements(id bigint PRIMARY KEY, description text, amount numeric);
    CREATE TABLE finance.accounts(id bigint PRIMARY KEY, holder text);
    INSERT INTO finance.movements VALUES(1,'EXPENSE_SECRET_FOR_TEST',9182.31);
    INSERT INTO finance.accounts VALUES(1,'CUSTOMER_SECRET_FOR_TEST');
    CREATE TABLE public.commerce_sales(id bigint PRIMARY KEY, customer_phone text);
    INSERT INTO public.commerce_sales VALUES(1,'01099999999');
    CREATE ROLE app_broad NOLOGIN;
    CREATE ROLE app_scoped NOLOGIN;
    GRANT USAGE ON SCHEMA finance TO app_broad, app_scoped;
    GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON finance.movements, finance.accounts TO app_broad, app_scoped;
    GRANT pg_write_all_data TO app_broad;
  `);
}

test("app-connection probe is read-only, aggregate-only, and never reports SQL Editor scope as app identity", async () => {
  const pg = new PGlite();
  try {
    await fixture(pg);
    const before = await pg.query<{ id: bigint }>("SELECT id FROM finance.movements");
    const result = await runProbe(pg);
    assert.equal(result.probe_scope, "APP_CONNECTION_ONLY");
    assert.equal(result.probe_version, "1.1");
    assert.equal(result.read_only_transaction, true, "the transaction is genuinely READ ONLY");
    assert.equal(result.finance_schema_present, true);
    assert.equal(result.finance_object_count, 2);
    assert(result.finance_objects.every((o) => typeof o.owned_by_current_user === "boolean" && !o.rls_active));
    // The historical audit explicitly disclaims app identity; the new probe must not.
    assert.match(audit, /'inspection_role_only',true/);
    assert.equal("inspection_role_only" in result, false, "probe must not claim SQL Editor scope");
    assert.doesNotMatch(probe, /'inspection_role_only'\s*,\s*true/);
    // Check the executable statement, not the comments that explain these choices.
    const body = probe.split("\n").filter((line) => !line.trimStart().startsWith("--")).join("\n");
    assert.doesNotMatch(body, /to_jsonb\(pg_roles|rolpassword|rolconfig|conninfo|inet_server/);
    assert(!JSON.stringify(result).includes("rolpassword"));
    // Review 1.1: no database/schema names or connection values in the output.
    assert(!("current_database" in result) && !("current_schema" in result));
    // "postgres" may legitimately be a ROLE name (current_user); what must be
    // absent is anything that looks like a connection string or a host/port.
    const serializedResult = JSON.stringify(result);
    assert(!serializedResult.includes("postgresql://") && !serializedResult.includes("@"));
    assert(!serializedResult.includes("sslmode") && !serializedResult.includes("password"));
    for (const key of Object.keys(result)) assert(!/database|host|port|conninfo|dsn/i.test(key));
    assert.match(probe, /SET LOCAL statement_timeout/);
    assert.doesNotMatch(probe, /SET statement_timeout/);
    assert(result.limitations.includes("PG_HAS_ROLE_SHOWS_MEMBERSHIP_NOT_EFFECTIVE_PRIVILEGE_USE_HAS_TABLE_PRIVILEGE"));
    const serialized = JSON.stringify(result);
    for (const secret of SECRETS) assert(!serialized.includes(secret), `leaked ${secret}`);
    assert(!serialized.includes("HASH") && !serialized.includes("********"));
    assert.deepEqual((await pg.query<{ id: bigint }>("SELECT id FROM finance.movements")).rows, before.rows);
    assert(result.limitations.includes("ACL_REVOKE_IS_INEFFECTIVE_WHEN_A_WRITE_ALL_DATA_ROLE_IS_INHERITED"));
  } finally { await pg.close(); }
});

test("REVOKE is ineffective for an inherited write-all-data role but effective for a scoped role", async () => {
  const pg = new PGlite();
  try {
    await fixture(pg);
    await pg.exec("REVOKE DELETE, TRUNCATE ON finance.movements, finance.accounts FROM app_broad, app_scoped;");

    await pg.exec("SET ROLE app_broad;");
    const broad = await runProbe(pg);
    assert.equal(broad.current_user, "app_broad");
    assert.equal(broad.inherits_write_all_data, true);
    assert(broad.inherited_roles.includes("pg_write_all_data"));
    const broadTable = broad.finance_objects.find((o) => o.table_name === "movements")!;
    assert.equal(broadTable.can_delete, true, "ACL still reports DELETE after REVOKE");
    // TRUNCATE is a separate privilege: pg_write_all_data does not imply it.
    assert.equal(broadTable.can_truncate, false);
    // Actual write succeeds: the audit must not claim the role is restricted.
    await pg.query("DELETE FROM finance.movements WHERE id = 1");
    assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM finance.movements")).rows[0].n, 0);
    await pg.exec("RESET ROLE;");

    await pg.exec("SET ROLE app_scoped;");
    const scoped = await runProbe(pg);
    assert.equal(scoped.current_user, "app_scoped");
    assert.equal(scoped.inherits_write_all_data, false);
    assert(!scoped.inherited_roles.includes("pg_write_all_data"));
    assert.equal(scoped.finance_objects.find((o) => o.table_name === "accounts")!.can_delete, false);
    await assert.rejects(() => pg.query("DELETE FROM finance.accounts WHERE id = 1"), /permission denied/);
    await pg.exec("RESET ROLE;");
  } finally { await pg.close(); }
});

test("session_user is not a trustworthy app identity under SET ROLE / a pooler", async () => {
  const pg = new PGlite();
  try {
    await fixture(pg);
    await pg.exec("SET ROLE app_scoped;");
    const result = await runProbe(pg);
    assert.equal(result.current_user, "app_scoped");
    assert.equal(result.session_user, "postgres");
    assert.notEqual(result.current_user, result.session_user);
    assert(result.limitations.includes("SESSION_USER_IS_NOT_A_TRUSTED_APP_IDENTITY_UNDER_A_POOLER"));
    await pg.exec("RESET ROLE;");
  } finally { await pg.close(); }
});

test("probe works when the finance schema is absent and reports no phantom ownership", async () => {
  const pg = new PGlite();
  try {
    const result = await runProbe(pg);
    assert.equal(result.finance_schema_present, false);
    assert.equal(result.finance_schema_owned_by_current_user, null);
    assert.equal(result.can_create_in_finance, null);
    assert.equal(result.finance_object_count, 0);
    assert.deepEqual(result.finance_objects, []);
  } finally { await pg.close(); }
});

test("RLS state is reported per table, for the connection that actually runs the probe", async () => {
  const pg = new PGlite();
  try {
    await fixture(pg);
    await pg.exec(`ALTER TABLE finance.movements ENABLE ROW LEVEL SECURITY;
      CREATE POLICY hide_movements ON finance.movements FOR SELECT TO app_scoped USING (false);
      SET ROLE app_scoped;`);
    const result = await runProbe(pg);
    assert.equal(result.finance_objects.find((o) => o.table_name === "movements")!.rls_active, true);
    assert.equal(result.finance_objects.find((o) => o.table_name === "accounts")!.rls_active, false);
    await pg.exec("RESET ROLE;");
  } finally { await pg.close(); }
});
