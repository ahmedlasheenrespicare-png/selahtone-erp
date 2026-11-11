#!/usr/bin/env node
/**
 * TEST ONLY — read-only app-connection identity probe runner.
 * Reviewed 2026-11-05 under the user's explicit authorization, "review the text
 * first". Print ONLY the aggregate `app_connection_probe` JSON to stdout.
 *
 * Run this INSIDE the application's own runtime/environment (same DATABASE_URL
 * and pgbouncer path as the deployed app), never from SQL Editor and never with
 * DIRECT_URL. It never prints the connection string, host, password, or any
 * row data; on failure it prints a fixed code, not driver error text (which can
 * echo connection details). It refuses to run a probe text whose sha256 differs
 * from the reviewed version, and requires an explicit one-shot confirmation.
 *
 * Usage (inside the app environment, by the operator):
 *   FINANCE_IDENTITY_PROBE_CONFIRM="I reviewed the SQL" \
 *     node prototypes/finance-app-identity/run-app-connection-probe.mjs
 *
 * This is NOT a migration, NOT a deploy, and NOT proof of cash movement.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REVIEWED_SHA256 = "d960c559927eda3117b1793f5ff46249be81c2923b3e2233cfcb4f953b9d83eb";
const dir = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.join(dir, "app-connection-probe.test-only.sql");
const sql = readFileSync(sqlPath, "utf8");
const digest = createHash("sha256").update(sql).digest("hex");

function fail(code) { console.error(`APP_IDENTITY_PROBE_${code}`); process.exitCode = 1; }

if (digest !== REVIEWED_SHA256) { fail("TEXT_CHANGED_REVIEW_REQUIRED"); process.exit(1); }
if (process.env.FINANCE_IDENTITY_PROBE_CONFIRM !== "I reviewed the SQL") { fail("CONFIRMATION_REQUIRED"); process.exit(1); }
if (!process.env.DATABASE_URL) { fail("NO_APP_CONNECTION_IN_THIS_ENVIRONMENT"); process.exit(1); }
if (process.env.FINANCE_IDENTITY_PROBE_ALLOW_DIRECT === "yes") { fail("DIRECT_URL_IS_NOT_THE_APP_CONNECTION"); process.exit(1); }

// Refuse anything but the reviewed read-only statement shape. Strip quoted
// literals first: has_table_privilege(...,'INSERT') is a privilege NAME, not a
// writing statement. SET LOCAL inside the SQL already bounds the statement time
// without startup `options`, which a transaction pooler may reject.
const body = sql.split("\n").filter((line) => !line.trimStart().startsWith("--")).join("\n")
  .replace(/'(?:[^']|'')*'/g, "''");
if (!/^\s*BEGIN TRANSACTION READ ONLY;/i.test(body) || !/ROLLBACK;\s*$/i.test(body)) { fail("NOT_READ_ONLY_TRANSACTION"); process.exit(1); }
if (/\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|GRANT|REVOKE|TRUNCATE|COPY)\b/i.test(body)) { fail("WRITING_STATEMENT_FOUND"); process.exit(1); }

let pg;
try { pg = await import("pg"); } catch { fail("PG_DRIVER_UNAVAILABLE"); process.exit(1); }
// `pg` is a devDependency here; the operator must run this where it is present
// (or paste the reviewed SQL into a client using the very same DATABASE_URL).
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10_000 });
try {
  await client.connect();
  // A single simple query: BEGIN / SET LOCAL / SELECT / ROLLBACK. No parameters,
  // so the driver cannot reinterpret the reviewed text.
  const result = await client.query(sql);
  const list = Array.isArray(result) ? result : [result];
  const row = list.find((r) => r?.rows?.[0] && Object.hasOwn(r.rows[0], "app_connection_probe"))?.rows?.[0];
  if (!row) { fail("NO_RESULT"); process.exit(1); }
  const parsed = JSON.parse(String(row.app_connection_probe));
  if (parsed.probe_scope !== "APP_CONNECTION_ONLY" || parsed.read_only_transaction !== true || parsed.probe_version !== "1.1") {
    fail("UNEXPECTED_RESULT"); process.exit(1);
  }
  // Final fail-closed check: never echo a connection string or a secret.
  const output = JSON.stringify(parsed);
  if (/postgresql:\/\/|postgres:\/\/|sslmode|password|@/i.test(output)) { fail("UNSAFE_OUTPUT"); process.exit(1); }
  process.stdout.write(output + "\n");
} catch {
  // Deliberately discard driver error text: it can echo host/user from the URL.
  fail("QUERY_FAILED_NO_DETAILS");
} finally {
  await client.end().catch(() => {});
}
