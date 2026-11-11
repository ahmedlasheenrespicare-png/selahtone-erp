/** Disposable end-to-end authorization test. Never connects to DATABASE_URL. */
import assert from "node:assert/strict";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const root = process.cwd();
const secret = "synthetic-access-http-only-secret-2026";
const password = "Synthetic-Access-Test-2026!";

function hidden(form: string): FormData {
  const data = new FormData();
  for (const [tag] of form.matchAll(/<input\b[^>]*>/g)) {
    if (!tag.includes('type="hidden"')) continue;
    const name = tag.match(/name="([^"]+)"/)?.[1];
    const value = tag.match(/value="([^"]*)"/)?.[1] ?? "";
    if (name) data.set(name, value.replaceAll("&quot;", '"').replaceAll("&amp;", "&"));
  }
  return data;
}
function forms(html: string): string[] { return [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)].map((m) => m[0]); }
async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("unable to select local test port");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}
async function waitForServer(base: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`test server exited: ${child.exitCode}`);
    try { if ((await fetch(`${base}/login`)).ok) return; } catch { /* booting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("test server did not become ready");
}

test("only the system admin can change valid permissions and role/account precedence survives HTTP", { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "selahtone-admin-access-http-")); let child: ChildProcess | undefined; let logs = "";
  try {
    execFileSync(process.execPath, [join(root, "scripts/local-pglite-preview.cjs")], { cwd: root, env: { ...process.env, PREVIEW_PGLITE_DIR: dir, PREVIEW_PASSWORD: password }, stdio: "pipe", timeout: 60_000 });
    const db = new PGlite(dir);
    try {
      await db.exec(readFileSync(join(root, "prisma/manual-access-control-upgrade.sql"), "utf8"));
      await db.exec(`INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
        SELECT 4,NULL,'MANAGER','مدير غير أدمن','manager-not-admin@selahtone.local',password_hash,'ACTIVE',false,'FULL',true,now() FROM users WHERE id=1;
        INSERT INTO access_control(subject_kind,subject,key,allowed) VALUES ('role','CS_AGENT','/retired#unknown',false);`);
    } finally { await db.close(); }
    const port = await reservePort(); const base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
      cwd: root, env: { ...process.env, DATABASE_URL: "", PRISMA_PGLITE_DIR: dir, AUTH_SECRET: secret, FINANCE_ENABLED: "false", INVENTORY_ENABLED: "true", ADMIN_EMAILS: "manager@selahtone.local" }, stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (data) => { logs = (logs + data).slice(-16000); }); child.stderr?.on("data", (data) => { logs = (logs + data).slice(-16000); });
    await waitForServer(base, child);
    async function get(path: string, cookie: string) { return fetch(`${base}${path}`, { headers: { cookie }, redirect: "manual" }); }
    async function login(email: string) {
      const form = forms(await (await fetch(`${base}/login?next=%2Fadmin`)).text())[0]; assert.ok(form);
      const data = hidden(form); data.set("email", email); data.set("password", password);
      const response = await fetch(`${base}/login?next=%2Fadmin`, { method: "POST", headers: { origin: base }, body: data, redirect: "manual" });
      assert.equal(response.status, 303); return response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
    }
    const admin = await login("manager@selahtone.local"), accountant = await login("accountant@selahtone.local"), agent = await login("arh@selahtone.local"), manager = await login("manager-not-admin@selahtone.local");
    // The in-service identity probe is admin-only, read-only and contains no
    // connection values. PGlite intentionally fails the selahtone_app identity
    // assertion; the diagnostic itself must still complete with a rollback.
    for (const cookie of [accountant, agent, manager]) {
      assert.equal((await get("/api/admin/finance-identity", cookie)).status, 403);
    }
    const identityResponse = await get("/api/admin/finance-identity", admin);
    const identityText = await identityResponse.text();
    assert.equal(identityResponse.status, 200, identityText);
    const identity = JSON.parse(identityText) as { status: string; rollbackObserved: boolean; financeEnabled: boolean };
    assert.equal(identity.status, "FAIL");
    assert.equal(identity.rollbackObserved, true);
    assert.equal(identity.financeEnabled, false);
    assert.doesNotMatch(identityText, /postgres(?:ql)?:\/\/|password|DATABASE_URL/i);
    for (const cookie of [accountant, agent, manager]) {
      assert.equal((await get("/api/admin/finance-controls", cookie)).status, 403);
    }
    const controlsResponse = await get("/api/admin/finance-controls", admin);
    const controlsText = await controlsResponse.text();
    assert.equal(controlsResponse.status, 200, controlsText);
    const controls = JSON.parse(controlsText) as {
      status: string; probeVersion: string; rollbackObserved: boolean; financeEnabled: boolean;
      controls: { migrationLedgerStatus: string; schemas: Array<{ tableNames: string[] }> };
    };
    assert.equal(controls.status, "OBSERVED_NOT_AN_ENFORCEMENT_TEST");
    assert.equal(controls.rollbackObserved, true);
    assert.equal(controls.financeEnabled, false);
    assert.equal(controls.probeVersion, "schema-inventory-v3-no-ledger");
    assert.equal(controls.controls.migrationLedgerStatus, "NOT_QUERIED");
    assert.ok(controls.controls.schemas.every((schema) => Array.isArray(schema.tableNames)));
    assert.doesNotMatch(controlsText, /postgres(?:ql)?:\/\/|password|DATABASE_URL/i);
    const adminPage = await (await get("/admin", admin)).text();
    const form = forms(adminPage).find((entry) => entry.includes('name="kind"')); assert.ok(form);
    assert.match(adminPage, /نتيجة قواعد الصلاحيات/); assert.match(adminPage, /قيود الدور أو حالة السجل أو تفعيل الوحدة/);
    async function save(cookie: string, kind: string, subject: string, key: string, value: string) {
      const data = hidden(form!); for (const [name, v] of Object.entries({ kind, subject, key, value })) data.set(name, v);
      const response = await fetch(`${base}/admin`, { method: "POST", headers: { cookie, origin: base }, body: data, redirect: "manual" });
      return { status: response.status, location: response.headers.get("location"), body: await response.text() };
    }
    const isDenied = (res: { status: number; location: string | null; body: string }) =>
      (res.status === 307 && !!res.location?.includes("/dashboard")) || res.body.includes("هذا الإجراء متاح للأدمن وحده");
    for (const cookie of [accountant, agent, manager]) {
      assert.equal((await get("/admin", cookie)).status, 307);
      assert.equal((await get("/setup", cookie)).status, 307);
      assert.ok(isDenied(await save(cookie, "role", "CS_AGENT", "/sales", "deny")), "non-admin changed permissions");
    }
    assert.equal((await get("/sales", agent)).status, 200, "unprivileged attempts or unknown stored key affected access");
    for (const [kind, subject, key, value, message] of [
      ["role", "CS_AGENT", "/does-not-exist", "deny", "اختيار غير صالح"],
      ["role", "CS_AGENT", "/dashboard", "deny", "اختيار غير صالح"],
      ["role", "ACCOUNTANT", "/dashboard#part-wallet", "deny", "اختيار غير صالح"],
      ["role", "SUPERUSER", "/sales", "deny", "اختيار غير صالح"],
      ["user", "999999", "/sales", "deny", "الحساب غير موجود"],
      ["user", "1", "/sales", "deny", "حساب الأدمن مسموح دائمًا"],
    ]) assert.ok((await save(admin, kind, subject, key, value)).body.includes(message), `${kind}/${subject}/${key}: invalid submission accepted`);
    async function set(kind: string, subject: string, key: string, value: string) { assert.match((await save(admin, kind, subject, key, value)).body, /حُفظت الصلاحية/); }
    await set("role", "CS_AGENT", "/sales", "deny");
    assert.equal((await get("/sales", agent)).status, 307);
    await set("user", "3", "/sales", "allow");
    assert.equal((await get("/sales", agent)).status, 200);
    await set("role", "CS_AGENT", "/sales", "allow");
    await set("user", "3", "/sales", "deny");
    assert.equal((await get("/sales", agent)).status, 307, "account deny should beat role allow");
    await set("user", "3", "/sales", "inherit");
    assert.equal((await get("/sales", agent)).status, 200, "inherit should restore role allow");
    await set("role", "MANAGER", "/sales", "deny");
    assert.equal((await get("/sales", manager)).status, 307);
    assert.equal((await get("/sales", admin)).status, 200, "system admin must bypass role denial");
    assert.equal((await get("/dashboard", agent)).status, 200);
    assert.equal((await get("/setup", admin)).status, 200);
  } catch (error) { throw new Error(`admin HTTP test failed; server log tail:\n${logs}`, { cause: error }); }
  finally {
    if (child && child.exitCode === null) {
      const exited = new Promise<void>((resolve) => child!.once("exit", () => resolve())); child.kill("SIGTERM");
      await Promise.race([exited, new Promise<void>((resolve) => { setTimeout(resolve, 5000).unref(); })]);
      if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; }
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
