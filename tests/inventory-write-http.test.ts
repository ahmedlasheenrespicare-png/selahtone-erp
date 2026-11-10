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

test("inventory writes deny direct submissions when page or write permission is denied", { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "selahtone-inventory-guards-http-"));
  let child: ChildProcess | undefined;
  let logs = "";
  try {
    execFileSync(process.execPath, [join(root, "scripts/local-pglite-preview.cjs")], {
      cwd: root, env: { ...process.env, PREVIEW_PGLITE_DIR: dir, PREVIEW_PASSWORD: password }, stdio: "pipe", timeout: 60_000,
    });
    const db = new PGlite(dir);
    try { await db.exec(readFileSync(join(root, "prisma/manual-access-control-upgrade.sql"), "utf8")); }
    finally { await db.close(); }
    const port = await reservePort();
    const base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
      cwd: root, env: { ...process.env, DATABASE_URL: "", PRISMA_PGLITE_DIR: dir, AUTH_SECRET: secret, FINANCE_ENABLED: "false", INVENTORY_ENABLED: "true", ADMIN_EMAILS: "manager@selahtone.local" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (data) => { logs = (logs + data).slice(-16000); });
    child.stderr?.on("data", (data) => { logs = (logs + data).slice(-16000); });
    await waitForServer(base, child);
    async function get(path: string, cookie: string) {
      const response = await fetch(`${base}${path}`, { headers: { cookie }, redirect: "manual" });
      return { status: response.status, text: await response.text() };
    }
    async function login(email: string) {
      const form = forms(await (await fetch(`${base}/login?next=%2Fadmin`)).text())[0];
      assert.ok(form);
      const data = hidden(form); data.set("email", email); data.set("password", password);
      const response = await fetch(`${base}/login?next=%2Fadmin`, { method: "POST", headers: { origin: base }, body: data, redirect: "manual" });
      assert.equal(response.status, 303);
      return response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
    }
    const admin = await login("manager@selahtone.local");
    const accountant = await login("accountant@selahtone.local");
    const agent = await login("arh@selahtone.local");
    async function save(kind: "role" | "user", subject: string, key: string, value: "deny" | "allow" | "inherit") {
      const form = forms((await get("/admin", admin)).text).find((entry) => entry.includes('name="kind"'));
      assert.ok(form);
      const data = hidden(form);
      for (const [name, v] of Object.entries({ kind, subject, key, value })) data.set(name, v);
      const response = await fetch(`${base}/admin`, { method: "POST", headers: { cookie: admin, origin: base }, body: data });
      assert.match(await response.text(), /حُفظت الصلاحية/);
    }
    const cases = [
      { path: "/inventory/new", role: "ACCOUNTANT", userId: "2", cookie: accountant,
        values: { sku: "HTTPWRITEFORBIDDEN", nameAr: "صنف اختبار ممنوع", category: "ACCESSORY", purchaseCost: "1", salePrice: "2", taxRateId: "1", isSerialized: "no" } },
      { path: "/inventory/opening", role: "ACCOUNTANT", userId: "2", cookie: accountant,
        values: { productId: "2", warehouseId: "2", quantity: "1", unitCost: "1", serialNumbers: "" } },
      { path: "/inventory/receipts/new", role: "CS_AGENT", userId: "3", cookie: agent,
        values: { productId: "2", warehouseId: "1", quantity: "1", unitCost: "1", serialNumbers: "", sourceReference: "HTTPRECEIPTFORBIDDEN" } },
    ];
    for (const entry of cases) {
      const baseline = await get(entry.path, entry.cookie);
      assert.equal(baseline.status, 200);
      const form = forms(baseline.text).find((f) => f.includes('class="inv-form-layout"'));
      assert.ok(form, `${entry.path}: baseline form missing`);
      const post = async () => {
        const data = hidden(form); data.set("reviewed", "yes");
        for (const [name, value] of Object.entries(entry.values)) data.set(name, value);
        const response = await fetch(`${base}${entry.path}`, { method: "POST", headers: { cookie: entry.cookie, origin: base }, body: data, redirect: "manual" });
        return { status: response.status, location: response.headers.get("location"), text: await response.text() };
      };
      await save("role", entry.role, `${entry.path}#write`, "deny");
      const denied = await get(entry.path, entry.cookie);
      assert.equal(denied.status, 200);
      assert.ok(!denied.text.includes('class="inv-form-layout"'), `${entry.path}: denied form visible`);
      assert.match((await post()).text, /معطّل بالصلاحيات/, `${entry.path}: direct write was not denied`);
      assert.ok(!(await get("/inventory", entry.cookie)).text.includes(`href="${entry.path}"`), `${entry.path}: forbidden write link visible on inventory`);
      if (entry.path === "/inventory/receipts/new") {
        assert.ok(!(await get("/inventory/receipts", entry.cookie)).text.includes(`href="${entry.path}"`), "forbidden receipt link visible on receipt history");
      }
      await save("user", entry.userId, `${entry.path}#write`, "allow");
      assert.ok((await get(entry.path, entry.cookie)).text.includes('class="inv-form-layout"'), `${entry.path}: account write override missing`);
      assert.ok((await get("/inventory", entry.cookie)).text.includes(`href="${entry.path}"`), `${entry.path}: account override should restore action link`);
      await save("role", entry.role, entry.path, "deny");
      const blockedPost = await post();
      assert.ok((blockedPost.status === 307 && blockedPost.location?.includes("/dashboard")) || blockedPost.text.includes("معطّل بالصلاحيات"), `${entry.path}: page lock must override write exception`);
      const blockedPage = await get(entry.path, entry.cookie);
      assert.ok(blockedPage.status === 307 || blockedPage.text.includes("NEXT_REDIRECT"), `${entry.path}: page lock did not redirect`);
      await save("role", "MANAGER", `${entry.path}#write`, "deny");
      assert.ok((await get(entry.path, admin)).text.includes('class="inv-form-layout"'), `${entry.path}: system admin bypass missing`);
      await save("role", "MANAGER", `${entry.path}#write`, "inherit");
      await save("role", entry.role, entry.path, "inherit");
      await save("user", entry.userId, `${entry.path}#write`, "inherit");
      await save("role", entry.role, `${entry.path}#write`, "inherit");
    }
    assert.ok(!(await get("/inventory", admin)).text.includes("HTTPWRITEFORBIDDEN"), "denied product should not appear");
    assert.ok(!(await get("/inventory/receipts", admin)).text.includes("HTTPRECEIPTFORBIDDEN"), "denied receipt should not appear");
  } catch (error) {
    throw new Error(`inventory guard HTTP test failed; server log tail:\n${logs}`, { cause: error });
  } finally {
    if (child && child.exitCode === null) {
      const exited = new Promise<void>((resolve) => child!.once("exit", () => resolve()));
      child.kill("SIGTERM");
      await Promise.race([exited, new Promise<void>((resolve) => { setTimeout(resolve, 5000).unref(); })]);
      if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; }
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
