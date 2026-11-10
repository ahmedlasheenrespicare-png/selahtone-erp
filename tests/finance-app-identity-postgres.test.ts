/**
 * TEST ONLY. Re-checks the two identity facts on a real disposable PostgreSQL
 * cluster, because the documented neondb_owner / pg_write_all_data situation
 * is a managed-PostgreSQL fact, not a PGlite artefact. Never opens DATABASE_URL.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Pool } from "pg";

const probe = readFileSync("prototypes/finance-app-identity/app-connection-probe.test-only.sql", "utf8");
const bin = process.env.FINANCE_TEST_PG_BIN;

function launch(binary: string, data: string, socket: string, port: number): Promise<ChildProcess> {
  const child = spawn(path.join(binary, "postgres"), ["-D", data, "-k", socket, "-h", "", "-p", String(port), "-c", "unix_socket_permissions=0700"], { stdio: ["ignore", "ignore", "pipe"], env: process.env });
  return new Promise((resolve, reject) => {
    let logs = "", settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; child.kill("SIGKILL"); reject(new Error("disposable PostgreSQL did not start")); } }, 30_000);
    child.stderr?.on("data", (part) => {
      logs = (logs + String(part)).slice(-5000);
      if (!settled && logs.includes("database system is ready to accept connections")) { settled = true; clearTimeout(timer); resolve(child); }
    });
    child.once("error", (error) => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
    child.once("exit", (code) => { if (!settled) { settled = true; clearTimeout(timer); reject(new Error(`PostgreSQL exited ${code}: ${logs}`)); } });
  });
}
async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGTERM");
  const clean = await Promise.race([exited.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5000))]);
  if (!clean) { child.kill("SIGKILL"); await exited; }
}

type ProbeResult = {
  current_user: string;
  session_user: string;
  inherits_write_all_data: boolean;
  inherited_roles: string[];
  finance_objects: Array<{ table_name: string; can_delete: boolean; can_truncate: boolean; rls_active: boolean }>;
};

/** SET ROLE adds an extra empty result, so locate the SELECT by column name. */
function pick(results: unknown): ProbeResult {
  const list = (Array.isArray(results) ? results : [results]) as Array<{ rows?: Array<Record<string, unknown>> }>;
  const found = list.find((r) => r?.rows?.[0]?.app_connection_probe !== undefined);
  assert(found, "probe SELECT result present");
  return JSON.parse(String(found.rows![0].app_connection_probe)) as ProbeResult;
}

test("on real PostgreSQL, an inherited write-all-data role defeats REVOKE while a scoped role is restricted", { timeout: 180_000, skip: !bin }, async (t) => {
  if (!bin || !path.isAbsolute(bin) || !existsSync(path.join(bin, "postgres")) || !existsSync(path.join(bin, "initdb"))) throw new Error("FINANCE_TEST_PG_BIN must be a local PostgreSQL bin directory");
  if (typeof process.getuid === "function" && process.getuid() === 0) { t.skip("initdb requires an unprivileged OS user"); return; }
  const tmp = mkdtempSync(path.join(os.tmpdir(), "selahtone-identity-")), data = path.join(tmp, "data"), socket = path.join(tmp, "socket");
  mkdirSync(socket, { mode: 0o700 });
  const port = 55439;
  let server: ChildProcess | undefined, admin: Pool | undefined;
  try {
    execFileSync(path.join(bin, "initdb"), ["-D", data, "--no-locale", "--encoding=UTF8", "--auth-local=trust", "--auth-host=reject", "--username=identity_admin_test"], { env: process.env, stdio: "pipe", timeout: 30_000 });
    server = await launch(bin, data, socket, port);
    admin = new Pool({ host: socket, port, database: "postgres", user: "identity_admin_test", max: 4, connectionTimeoutMillis: 5000 });
    await admin.query(`CREATE SCHEMA finance;
      CREATE TABLE finance.movements(id bigint PRIMARY KEY, description text);
      INSERT INTO finance.movements VALUES(1,'SECRET_FOR_TEST');
      CREATE ROLE app_broad NOLOGIN;
      CREATE ROLE app_scoped NOLOGIN;
      GRANT USAGE ON SCHEMA finance TO app_broad, app_scoped;
      GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON finance.movements TO app_broad, app_scoped;
      GRANT pg_write_all_data TO app_broad;`);
    // Reproduce the exact documented state: ACL revoked, yet inherited role wins.
    await admin.query("REVOKE DELETE, TRUNCATE ON finance.movements FROM app_broad, app_scoped;");

    // NOLOGIN roles cannot open their own connection; SET ROLE keeps the same
    // session but changes current_user, which also demonstrates the pooler gap.
    const broadResult = pick(await admin.query("SET ROLE app_broad; " + probe + " RESET ROLE;"));
    assert.equal(broadResult.current_user, "app_broad");
    assert.equal(broadResult.session_user, "identity_admin_test");
    assert.equal(broadResult.inherits_write_all_data, true);
    assert(broadResult.inherited_roles.includes("pg_write_all_data"));
    assert.equal(broadResult.finance_objects[0].can_delete, true, "REVOKE has no effect on the inherited role");

    const scopedResult = pick(await admin.query("SET ROLE app_scoped; " + probe + " RESET ROLE;"));
    assert.equal(scopedResult.current_user, "app_scoped");
    assert.equal(scopedResult.inherits_write_all_data, false);
    assert.equal(scopedResult.finance_objects[0].can_delete, false, "a scoped role IS restricted by REVOKE");

    // Actual writes confirm the probe is not reporting a theoretical privilege.
    await admin.query("SET ROLE app_broad; DELETE FROM finance.movements WHERE id=1; RESET ROLE;");
    assert.equal((await admin.query<{ n: number }>("SELECT count(*)::int AS n FROM finance.movements")).rows[0].n, 0);
    assert(!JSON.stringify(broadResult).includes("SECRET_FOR_TEST"), "probe must not leak row data");
  } finally {
    if (admin) await admin.end().catch(() => {});
    if (server) await stop(server);
    rmSync(tmp, { recursive: true, force: true });
  }
});
