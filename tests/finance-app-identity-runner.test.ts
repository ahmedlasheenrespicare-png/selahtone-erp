/**
 * TEST ONLY. Verifies the app-connection probe RUNNER on a disposable local
 * PostgreSQL cluster reached through a DATABASE_URL-shaped connection, plus its
 * fail-closed gates. It never opens a real/production connection and never
 * prints any connection value. No production code is changed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const runner = path.join(root, "prototypes/finance-app-identity/run-app-connection-probe.mjs");
const sqlPath = path.join(root, "prototypes/finance-app-identity/app-connection-probe.test-only.sql");
const bin = process.env.FINANCE_TEST_PG_BIN;
const CONFIRM = "I reviewed the SQL";

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
/** NODE_ENV is required by this repo's ProcessEnv augmentation. */
function env(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "test", ...extra } as NodeJS.ProcessEnv;
}
function run(environment: NodeJS.ProcessEnv): { code: number; out: string; err: string } {
  try {
    const out = execFileSync(process.execPath, [runner], { cwd: root, env: environment, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 });
    return { code: 0, out, err: "" };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: e.stdout ?? "", err: e.stderr ?? "" };
  }
}

test("runner refuses to run without explicit review confirmation or an app connection", () => {
  const noConfirm = run(env({ DATABASE_URL: "postgresql://unused.invalid/db" }));
  assert.equal(noConfirm.code, 1);
  assert.match(noConfirm.err, /CONFIRMATION_REQUIRED/);
  assert.equal(noConfirm.out, "", "nothing is printed before confirmation");
  const noUrl = run(env({ FINANCE_IDENTITY_PROBE_CONFIRM: CONFIRM }));
  assert.equal(noUrl.code, 1);
  assert.match(noUrl.err, /NO_APP_CONNECTION_IN_THIS_ENVIRONMENT/);
  const direct = run(env({ DATABASE_URL: "postgresql://unused.invalid/db", FINANCE_IDENTITY_PROBE_CONFIRM: CONFIRM, FINANCE_IDENTITY_PROBE_ALLOW_DIRECT: "yes" }));
  assert.equal(direct.code, 1);
  assert.match(direct.err, /DIRECT_URL_IS_NOT_THE_APP_CONNECTION/);
});

test("runner refuses a modified probe text (reviewed sha256 pin)", () => {
  // Copy the reviewed SQL, change one byte, and point the runner's pin at the
  // original: it must fail closed. Restore immediately in finally.
  const { readFileSync, writeFileSync } = require("node:fs") as typeof import("node:fs");
  const original = readFileSync(sqlPath, "utf8");
  try {
    writeFileSync(sqlPath, original + "\n-- changed after review\n");
    const result = run(env({ DATABASE_URL: "postgresql://unused.invalid/db", FINANCE_IDENTITY_PROBE_CONFIRM: CONFIRM }));
    assert.equal(result.code, 1);
    assert.match(result.err, /TEXT_CHANGED_REVIEW_REQUIRED/);
  } finally { writeFileSync(sqlPath, original); }
});

test("runner prints only the aggregate probe over a DATABASE_URL-shaped connection", { timeout: 180_000, skip: !bin }, async (t) => {
  if (!bin || !path.isAbsolute(bin) || !existsSync(path.join(bin, "postgres")) || !existsSync(path.join(bin, "initdb"))) throw new Error("FINANCE_TEST_PG_BIN must be a local PostgreSQL bin directory");
  if (typeof process.getuid === "function" && process.getuid() === 0) { t.skip("initdb requires an unprivileged OS user"); return; }
  const tmp = mkdtempSync(path.join(os.tmpdir(), "selahtone-runner-")), data = path.join(tmp, "data"), socket = path.join(tmp, "socket");
  mkdirSync(socket, { mode: 0o700 });
  const port = 55441;
  let server: ChildProcess | undefined;
  try {
    execFileSync(path.join(bin, "initdb"), ["-D", data, "--no-locale", "--encoding=UTF8", "--auth-local=trust", "--auth-host=reject", "--username=runner_admin_test"], { env: process.env, stdio: "pipe", timeout: 30_000 });
    server = await launch(bin, data, socket, port);
    // A URL-shaped connection, like the app's DATABASE_URL, but entirely local.
    const url = `postgresql://runner_admin_test:TEST_ONLY_SENTINEL@/postgres?host=${encodeURIComponent(socket)}&port=${port}`;
    const result = run(env({ DATABASE_URL: url, FINANCE_IDENTITY_PROBE_CONFIRM: CONFIRM, LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH }));
    assert.equal(result.code, 0, result.err);
    const parsed = JSON.parse(result.out.trim());
    assert.equal(parsed.probe_scope, "APP_CONNECTION_ONLY");
    assert.equal(parsed.probe_version, "1.1");
    assert.equal(parsed.read_only_transaction, true);
    assert.equal(parsed.current_user, "runner_admin_test");
    assert.equal(parsed.finance_schema_present, false);
    // The connection string and its sentinel password must never be echoed.
    assert(!result.out.includes("TEST_ONLY_SENTINEL"));
    assert(!result.out.includes("postgresql://"));
    assert(!result.out.includes(socket));
    assert(!result.err.includes("TEST_ONLY_SENTINEL"));
  } finally {
    if (server) await stop(server);
    rmSync(tmp, { recursive: true, force: true });
  }
});
