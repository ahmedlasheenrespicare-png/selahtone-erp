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

test("inventory and receipt pages remove restricted cost values from HTML and RSC", { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "selahtone-inventory-access-http-"));
  let child: ChildProcess | undefined;
  let logs = "";
  try {
    execFileSync(process.execPath, [join(root, "scripts/local-pglite-preview.cjs")], {
      cwd: root, env: { ...process.env, PREVIEW_PGLITE_DIR: dir, PREVIEW_PASSWORD: password }, stdio: "pipe", timeout: 60_000,
    });
    const db = new PGlite(dir);
    try {
      await db.exec(readFileSync(join(root, "prisma/manual-access-control-upgrade.sql"), "utf8"));
      await db.exec(`UPDATE products SET purchase_cost = 98765.43 WHERE id = (SELECT min(id) FROM products);
        UPDATE commerce_sale_lines SET unit_cost = NULL;
        UPDATE commerce_sale_lines SET unit_cost = 123456.78 WHERE id = 1;
        UPDATE stock_levels SET avg_cost = 0;
        UPDATE stock_levels SET avg_cost = 87654.32, qty_on_hand = 1 WHERE id = (SELECT min(id) FROM stock_levels);
        INSERT INTO users (id, branch_id, role_code, full_name, email, password_hash, status, must_change_password, menu_scope, can_cancel_sales, created_at)
        SELECT 4, NULL, 'MANAGER', 'مدير اختبار غير أدمن', 'restricted-manager@selahtone.local', password_hash, 'ACTIVE', false, 'FULL', true, now() FROM users WHERE id = 1;
        INSERT INTO inventory_receipts (request_id, request_hash, warehouse_id, product_id, quantity, unit_cost, source_reference, created_by_id)
        VALUES ('1d411c9d-dc3c-4d66-884a-4b6842f430aa', repeat('a',64), 1, 1, 2, 54321.9876, 'SYNTHETICRECEIPTCANARY', 1);`);
    } finally { await db.close(); }
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
      assert.equal(response.status, 200, path);
      return response.text();
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
    const manager = await login("restricted-manager@selahtone.local");
    async function save(kind: "role" | "user", subject: string, value: "deny" | "allow" | "inherit", key = "/inventory#cost-details") {
      const form = forms(await get("/admin", admin)).find((entry) => entry.includes('name="kind"'));
      assert.ok(form);
      const data = hidden(form);
      for (const [name, v] of Object.entries({ kind, subject, key, value })) data.set(name, v);
      const response = await fetch(`${base}/admin`, { method: "POST", headers: { cookie: admin, origin: base }, body: data });
      assert.match(await response.text(), /حُفظت الصلاحية/);
    }
    const markers = ["98,765.43", "87,654.32"];
    const before = await get("/inventory", accountant);
    for (const marker of markers) assert.ok(before.includes(marker), `${marker}: baseline cost missing`);
    await save("role", "ACCOUNTANT", "deny");
    const after = await get("/inventory", accountant);
    for (const marker of markers) assert.ok(!after.includes(marker), `${marker}: cost leaked into HTML/RSC`);
    assert.match(after, /المخزون والمستودعات/);
    assert.match(after, /إضافة صنف/);
    assert.match(after, /محاسب\/مدير/);
    assert.doesNotMatch(after, /سعر الشراء/);
    await save("user", "2", "allow");
    const override = await get("/inventory", accountant);
    for (const marker of markers) assert.ok(override.includes(marker), `${marker}: account override missing`);
    await save("role", "MANAGER", "deny");
    const bypass = await get("/inventory", admin);
    for (const marker of markers) assert.ok(bypass.includes(marker), `${marker}: admin bypass missing`);

    const dashboardCostKey = "/dashboard#stock-value";
    const stockMarker = "87,654.32";
    for (const actor of [{ cookie: manager, role: "MANAGER", userId: "4" }, { cookie: accountant, role: "ACCOUNTANT", userId: "2" }]) {
      assert.ok((await get("/dashboard?section=all", actor.cookie)).includes(stockMarker), `${actor.role}: stock value baseline missing`);
      await save("role", actor.role, "deny", dashboardCostKey);
      for (const query of ["", "?section=all", "?section=pulse", "?section=all&branch=1"]) {
        const result = await get(`/dashboard${query}`, actor.cookie);
        assert.ok(!result.includes(stockMarker), `${actor.role} ${query}: dashboard stock value leaked in HTML/RSC`);
      }
      // Also exercise the unlinked stock-card branch when inventory itself is denied.
      await save("role", actor.role, "deny", "/inventory");
      assert.ok(!(await get("/dashboard?section=all", actor.cookie)).includes(stockMarker), `${actor.role}: fallback stock card leaked`);
      await save("role", actor.role, "inherit", "/inventory");
      await save("user", actor.userId, "allow", dashboardCostKey);
      assert.ok((await get("/dashboard?section=all", actor.cookie)).includes(stockMarker), `${actor.role}: dashboard value account override missing`);
      await save("user", actor.userId, "inherit", dashboardCostKey);
    }
    assert.ok((await get("/dashboard?section=all", admin)).includes(stockMarker), "dashboard stock value admin bypass missing");
    assert.ok((await get("/inventory", accountant)).includes(markers[1]), "dashboard permission must not alter inventory page");

    const profitKey = "/dashboard#profitability";
    const profitMarker = "123,456.78";
    for (const actor of [{ cookie: manager, role: "MANAGER", userId: "4" }, { cookie: accountant, role: "ACCOUNTANT", userId: "2" }]) {
      const baseline = await get("/dashboard?section=all", actor.cookie);
      assert.ok(baseline.includes(profitMarker), `${actor.role}: profitability cost baseline missing`);
      await save("role", actor.role, "deny", profitKey);
      for (const query of ["", "?section=all", "?section=profitability", "?section=all&branch=1"]) {
        const result = await get(`/dashboard${query}`, actor.cookie);
        assert.ok(!result.includes(profitMarker), `${actor.role} ${query}: profitability cost leaked in HTML/RSC`);
        assert.ok(!result.includes("الربحية وصافي التشغيل"), `${actor.role} ${query}: profitability section remains`);
      }
      await save("user", actor.userId, "allow", profitKey);
      assert.ok((await get("/dashboard?section=all", actor.cookie)).includes(profitMarker), `${actor.role}: profitability override missing`);
      await save("user", actor.userId, "inherit", profitKey);
    }
    assert.ok((await get("/dashboard?section=all", admin)).includes(profitMarker), "profitability admin bypass missing");
    await save("role", "CS_AGENT", "deny", profitKey);
    assert.ok((await get("/dashboard?section=all", agent)).includes("حركة الأصناف والسيريالات"), "employee inventory activity should remain independent");

    const receiptKey = "/inventory/receipts#unit-cost";
    const receiptMarker = "54321.9876";
    const initialReceipt = await get("/inventory/receipts", agent);
    assert.ok(initialReceipt.includes(receiptMarker), "synthetic receipt cost missing at baseline");
    assert.ok(initialReceipt.includes("SYNTHETICRECEIPTCANARY"));
    await save("role", "CS_AGENT", "deny", receiptKey);
    const hiddenReceipt = await get("/inventory/receipts", agent);
    assert.ok(!hiddenReceipt.includes(receiptMarker), "receipt cost leaked into HTML/RSC");
    assert.doesNotMatch(hiddenReceipt, /تكلفة الوحدة/);
    assert.ok(hiddenReceipt.includes("SYNTHETICRECEIPTCANARY"), "unrelated receipt data should remain");
    await save("user", "3", "allow", receiptKey);
    assert.ok((await get("/inventory/receipts", agent)).includes(receiptMarker), "receipt cost account override missing");
    await save("role", "MANAGER", "deny", receiptKey);
    assert.ok((await get("/inventory/receipts", admin)).includes(receiptMarker), "receipt cost admin bypass missing");
    await save("role", "ACCOUNTANT", "deny", receiptKey);
    const hiddenAccountant = await get("/inventory/receipts", accountant);
    assert.ok(!hiddenAccountant.includes(receiptMarker), "accountant receipt cost leaked");
    assert.ok(hiddenAccountant.includes("SYNTHETICRECEIPTCANARY"));
    assert.ok((await get("/inventory", accountant)).includes(markers[0]), "receipt cost restriction must not silently change inventory page access");

    const hintMarker = "98765.43";
    for (const scenario of [
      { key: "/inventory/opening#purchase-cost-hint", path: "/inventory/opening?productId=1", cookie: accountant, role: "ACCOUNTANT", userId: "2" },
      { key: "/inventory/receipts/new#purchase-cost-hint", path: "/inventory/receipts/new", cookie: agent, role: "CS_AGENT", userId: "3" },
    ]) {
      const baseline = await get(scenario.path, scenario.cookie);
      assert.ok(baseline.includes(hintMarker), `${scenario.key}: baseline hint data missing`);
      await save("role", scenario.role, "deny", scenario.key);
      const result = await get(scenario.path, scenario.cookie);
      assert.ok(!result.includes(hintMarker), `${scenario.key}: hint value leaked into HTML/RSC`);
      assert.ok(result.includes('name="unitCost"'), `${scenario.key}: user-entered unit cost input should remain`);
      await save("user", scenario.userId, "allow", scenario.key);
      assert.ok((await get(scenario.path, scenario.cookie)).includes(hintMarker), `${scenario.key}: account override missing`);
      await save("role", "MANAGER", "deny", scenario.key);
      assert.ok((await get(scenario.path, admin)).includes(hintMarker), `${scenario.key}: admin bypass missing`);
    }
  } catch (error) {
    throw new Error(`inventory HTTP test failed; server log tail:\n${logs}`, { cause: error });
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
