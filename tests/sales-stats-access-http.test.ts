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

test("sales statistics cost and profit are removed from HTML and serialized props when denied", { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "selahtone-sales-stats-access-")); let child: ChildProcess | undefined; let logs = "";
  try {
    execFileSync(process.execPath, [join(root, "scripts/local-pglite-preview.cjs")], { cwd: root, env: { ...process.env, PREVIEW_PGLITE_DIR: dir, PREVIEW_PASSWORD: password }, stdio: "pipe", timeout: 60_000 });
    const db = new PGlite(dir);
    try {
      await db.exec(readFileSync(join(root, "prisma/manual-access-control-upgrade.sql"), "utf8"));
      await db.exec(`UPDATE commerce_sale_lines SET unit_cost = NULL;
        UPDATE commerce_sale_lines SET unit_cost = 123456.78, name_snapshot = 'SYNTHETICSTOCKCANARY' WHERE id = 1;
        INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
        SELECT 4,NULL,'MANAGER','مدير غير أدمن','restricted-manager@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=1;`);
    } finally { await db.close(); }
    const port = await reservePort(); const base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
      cwd: root, env: { ...process.env, DATABASE_URL: "", PRISMA_PGLITE_DIR: dir, AUTH_SECRET: secret, FINANCE_ENABLED: "false", INVENTORY_ENABLED: "true", ADMIN_EMAILS: "manager@selahtone.local" }, stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (data) => { logs = (logs + data).slice(-16000); }); child.stderr?.on("data", (data) => { logs = (logs + data).slice(-16000); });
    await waitForServer(base, child);
    async function get(path: string, cookie: string) { const response = await fetch(`${base}${path}`, { headers: { cookie }, redirect: "manual" }); assert.equal(response.status, 200, path); return response.text(); }
    async function login(email: string) {
      const form = forms(await (await fetch(`${base}/login?next=%2Fadmin`)).text())[0]; assert.ok(form);
      const data = hidden(form); data.set("email", email); data.set("password", password);
      const response = await fetch(`${base}/login?next=%2Fadmin`, { method: "POST", headers: { origin: base }, body: data, redirect: "manual" });
      assert.equal(response.status, 303); return response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
    }
    const admin = await login("manager@selahtone.local"), manager = await login("restricted-manager@selahtone.local");
    async function save(kind: "role" | "user", subject: string, key: string, value: "deny" | "allow" | "inherit") {
      const form = forms(await get("/admin", admin)).find((entry) => entry.includes('name="kind"')); assert.ok(form);
      const data = hidden(form); for (const [name, v] of Object.entries({ kind, subject, key, value })) data.set(name, v);
      assert.match(await (await fetch(`${base}/admin`, { method: "POST", headers: { cookie: admin, origin: base }, body: data })).text(), /حُفظت الصلاحية/);
    }
    const path = "/sales/stats?period=today&branch=1", marker = "123,456.78", key = "/sales/stats#profitability";
    const baseline = await get(path, manager);
    assert.ok(baseline.includes(marker), "baseline cost missing");
    assert.ok(baseline.includes("104,706.78"), "baseline per-item profit missing");
    assert.ok(baseline.includes("profitNum"), "baseline profit payload missing");
    assert.ok(baseline.includes("الأعلى ربحًا"), "baseline profit sort missing");
    await save("role", "MANAGER", key, "deny");
    for (const query of ["?period=today&branch=1", "?period=month", "?period=all&branch=1"]) {
      const page = await get(`/sales/stats${query}`, manager);
      assert.ok(!page.includes(marker), `${query}: cost value leaked`);
      assert.ok(!page.includes("104,706.78") && !page.includes("104706.78"), `${query}: profit value leaked`);
      for (const name of ["costFormatted", "profitFormatted", "profitNum", "marginPct", "stockProfitFormatted", "stockMarginPct"]) assert.ok(!page.includes(name), `${query}: ${name} serialized`);
      assert.ok(!page.includes("الأعلى ربحًا")); assert.ok(!page.includes("الربح والهامش"));
      assert.ok(page.includes("صافي المبيعات")); assert.ok(page.includes("أكثر الأصناف مبيعًا"));
    }
    assert.ok((await get(path, admin)).includes(marker), "admin bypass missing");
    assert.ok((await get("/dashboard?section=all", manager)).includes(marker), "stats permission must not hide dashboard profitability");
    await save("user", "4", key, "allow");
    assert.ok((await get(path, manager)).includes(marker), "account override missing");
    await save("role", "MANAGER", "/sales/stats", "deny");
    const denied = await fetch(`${base}${path}`, { headers: { cookie: manager }, redirect: "manual" });
    assert.equal(denied.status, 307, "page denial must override element allowance");
    assert.ok((await get(path, admin)).includes(marker), "admin should bypass page denial");
  } catch (error) { throw new Error(`sales stats HTTP test failed: ${String(error)}; server log tail:\n${logs}`, { cause: error }); }
  finally {
    if (child && child.exitCode === null) {
      const exited = new Promise<void>((resolve) => child!.once("exit", () => resolve())); child.kill("SIGTERM");
      await Promise.race([exited, new Promise<void>((resolve) => { setTimeout(resolve, 5000).unref(); })]);
      if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; }
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
