/**
 * TEST ONLY. Verifies the single-file portable probe: the embedded SQL is
 * byte-identical to the reviewed file, the gates are fail-closed, and it
 * prints only the aggregate over a DATABASE_URL-shaped connection to a
 * disposable local PostgreSQL. No production connection is ever opened.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const standalone = path.join(root, "prototypes/finance-app-identity/app-identity-probe-standalone.mjs");
const sqlPath = path.join(root, "prototypes/finance-app-identity/app-connection-probe.test-only.sql");
const PIN = "d960c559927eda3117b1793f5ff46249be81c2923b3e2233cfcb4f953b9d83eb";
const bin = process.env.FINANCE_TEST_PG_BIN;
const CONFIRM = "I reviewed the SQL";

function env(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "test", ...extra } as NodeJS.ProcessEnv;
}
function runWithScript(script: string, environment: NodeJS.ProcessEnv): { code: number; out: string; err: string } {
  try {
    const out = execFileSync(process.execPath, [script], { cwd: root, env: environment, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 });
    return { code: 0, out, err: "" };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: e.stdout ?? "", err: e.stderr ?? "" };
  }
}
function run(environment: NodeJS.ProcessEnv): { code: number; out: string; err: string } {
  return runWithScript(standalone, environment);
}
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

test("the embedded SQL is byte-identical to the reviewed file and matches the pin", () => {
  const source = readFileSync(standalone, "utf8");
  const sql = readFileSync(sqlPath, "utf8");
  const match = source.match(/const SQL = ("[\s\S]*?");\n\nconst REVIEWED_SQL_SHA256/);
  assert(match, "SQL literal is embedded");
  const embedded = JSON.parse(match[1]) as string;
  assert.equal(embedded, sql);
  assert.equal(createHash("sha256").update(embedded).digest("hex"), PIN);
  assert.equal(createHash("sha256").update(sql).digest("hex"), PIN);
  assert.match(source, /BEGIN TRANSACTION READ ONLY/i);
});

test("gates refuse to run without confirmation, without a URL, or with DIRECT_URL", () => {
  const noConfirm = run(env({ DATABASE_URL: "postgresql://unused.invalid/db" }));
  assert.equal(noConfirm.code, 1);
  assert.match(noConfirm.err, /CONFIRMATION_REQUIRED/);
  assert.equal(noConfirm.out, "");
  const noUrl = run(env({ FINANCE_IDENTITY_PROBE_CONFIRM: CONFIRM }));
  assert.match(noUrl.err, /NO_APP_CONNECTION_IN_THIS_ENVIRONMENT/);
  const direct = run(env({ DATABASE_URL: "postgresql://unused.invalid/db", FINANCE_IDENTITY_PROBE_CONFIRM: CONFIRM, FINANCE_IDENTITY_PROBE_ALLOW_DIRECT: "yes" }));
  assert.match(direct.err, /DIRECT_URL_IS_NOT_THE_APP_CONNECTION/);
});

test("prints only the aggregate over a DATABASE_URL-shaped pooled URL", { timeout: 180_000, skip: !bin }, async (t) => {
  if (!bin || !path.isAbsolute(bin) || !existsSync(path.join(bin, "postgres")) || !existsSync(path.join(bin, "initdb"))) throw new Error("FINANCE_TEST_PG_BIN must be a local PostgreSQL bin directory");
  if (typeof process.getuid === "function" && process.getuid() === 0) { t.skip("initdb requires an unprivileged OS user"); return; }
  const tmp = mkdtempSync(path.join(os.tmpdir(), "selahtone-standalone-")), data = path.join(tmp, "data"), socket = path.join(tmp, "socket");
  mkdirSync(socket, { mode: 0o700 });
  const port = 55442;
  let server: ChildProcess | undefined;
  try {
    execFileSync(path.join(bin, "initdb"), ["-D", data, "--no-locale", "--encoding=UTF8", "--auth-local=trust", "--auth-host=reject", "--username=standalone_admin_test"], { env: process.env, stdio: "pipe", timeout: 30_000 });
    server = await launch(bin, data, socket, port);
    // Mirrors the app's URL shape: pgbouncer=true is ignored by node-postgres.
    const url = `postgresql://standalone_admin_test:TEST_ONLY_SENTINEL@/postgres?host=${encodeURIComponent(socket)}&port=${port}&sslmode=disable&pgbouncer=true&connect_timeout=15`;
    const result = run(env({ DATABASE_URL: url, FINANCE_IDENTITY_PROBE_CONFIRM: CONFIRM, LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH }));
    assert.equal(result.code, 0, result.err);
    const parsed = JSON.parse(result.out.trim());
    assert.equal(parsed.probe_scope, "APP_CONNECTION_ONLY");
    assert.equal(parsed.probe_version, "1.1");
    assert.equal(parsed.read_only_transaction, true);
    assert.equal(parsed.current_user, "standalone_admin_test");
    assert(!result.out.includes("TEST_ONLY_SENTINEL"));
    assert(!result.out.includes("postgresql://"));
    assert(!result.err.includes("TEST_ONLY_SENTINEL"));
  } finally {
    if (server) await stop(server);
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("ESM fallback resolves pg from PG_MODULE_PATH when run outside the repo", () => {
  // Simulates a paid Render Shell: the standalone file is copied to an
  // isolated directory with NO node_modules of its own. ESM import of `pg`
  // must fail there, and the explicit module directory must take over.
  const tmp = mkdtempSync(path.join(os.tmpdir(), "selahtone-pg-fallback-"));
  const copied = path.join(tmp, "app-identity-probe-standalone.mjs");
  try {
    copyFileSync(standalone, copied);
    const base = { DATABASE_URL: "postgresql://u:p@invalid.invalid/db", FINANCE_IDENTITY_PROBE_CONFIRM: CONFIRM };
    const without = runWithScript(copied, env(base));
    assert.equal(without.code, 1);
    assert.match(without.err, /PG_DRIVER_UNAVAILABLE/, "without PG_MODULE_PATH the driver is genuinely absent");
    const withAlt = runWithScript(copied, env({ ...base, PG_MODULE_PATH: path.join(root, "node_modules") }));
    assert.equal(withAlt.code, 1);
    assert.match(withAlt.err, /QUERY_FAILED_NO_DETAILS/, "pg resolved from PG_MODULE_PATH; failure is now the bogus host, not a missing driver");
    assert.doesNotMatch(withAlt.err, /PG_DRIVER_UNAVAILABLE/);
    assert(!withAlt.err.includes("invalid.invalid"), "driver error text is never echoed");
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("the compressed payload and the macOS setup script reproduce the canonical probe exactly", () => {
  const payload = readFileSync(path.join(root, "prototypes/finance-app-identity/probe-payload.b64"), "utf8").trim();
  const decoded = gunzipSync(Buffer.from(payload, "base64"));
  assert.equal(decoded.length, readFileSync(standalone).length);
  assert(decoded.equals(readFileSync(standalone)), "decompressed payload is byte-identical to the standalone file");
  assert.equal(createHash("sha256").update(decoded.toString("utf8")).digest("hex"), createHash("sha256").update(readFileSync(standalone, "utf8")).digest("hex"));
  const setup = readFileSync(path.join(root, "prototypes/finance-app-identity/install-and-run-on-mac.sh"), "utf8");
  assert(setup.includes(payload), "setup script embeds the reviewed payload");
  assert.match(setup, /base64 -D \| gunzip/, "macOS decode flag");
  assert.match(setup, /read -r -s DATABASE_URL/, "URL is read without echo");
  assert(!setup.includes("echo \"$DATABASE_URL\""));
  const paste = readFileSync(path.join(root, "prototypes/finance-app-identity/PASTE-IN-TERMINAL.txt"), "utf8");
  assert(paste.includes(payload), "the paste command carries the exact reviewed payload");
  assert.match(paste, /base64 -D \| gunzip/, "macOS decode flag in the paste command");
  assert.match(paste, /read -r -s DATABASE_URL/, "URL is read silently in the paste command");
  assert.match(paste, /FINANCE_IDENTITY_PROBE_CONFIRM="I reviewed the SQL"/, "confirmation gate present");
  assert.match(paste, /node app-identity-probe-standalone\.mjs/, "runs the canonical probe");
  assert.doesNotMatch(paste, /postgresql:\/\//, "no connection string is embedded");
});
