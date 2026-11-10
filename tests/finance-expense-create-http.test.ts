/** Disposable end-to-end authorization test. Never connects to DATABASE_URL. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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

test("expense creation guards and links obey page and write permissions", { timeout: 180_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "selahtone-expense-create-http-")); let child: ChildProcess | undefined; let logs = "";
  try {
    execFileSync(process.execPath, [join(root, "scripts/local-pglite-preview.cjs")], { cwd: root, env: { ...process.env, PREVIEW_PGLITE_DIR: dir, PREVIEW_PASSWORD: password }, stdio: "pipe", timeout: 60_000 });
    const db = new PGlite(dir);
    try {
      await db.exec(readFileSync(join(root, "prisma/manual-access-control-upgrade.sql"), "utf8"));
      await db.exec("SET selahtone.finance_release_candidate_test_only='yes'");
      for (const file of ["prototypes/finance-release/release-candidate.test-only.sql", "prisma/manual-settlement-upgrade.sql", "prisma/manual-custody-closure-upgrade.sql", "prisma/manual-custody-and-count-requests.sql"]) await db.exec(readFileSync(join(root, file), "utf8"));
      await db.exec(`INSERT INTO finance.expenses (branch_id,category_id,category_snapshot,amount,expense_date,description,status,requested_by)
        VALUES (1,1,'إيجار الفروع',11,CURRENT_DATE,'EXPENSELINKCANARY','PENDING',3);`);
    } finally { await db.close(); }
    const port = await reservePort(); const base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
      cwd: root, env: { ...process.env, DATABASE_URL: "", PRISMA_PGLITE_DIR: dir, AUTH_SECRET: secret, FINANCE_ENABLED: "true", INVENTORY_ENABLED: "true", ADMIN_EMAILS: "manager@selahtone.local" }, stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (data) => { logs = (logs + data).slice(-16000); }); child.stderr?.on("data", (data) => { logs = (logs + data).slice(-16000); });
    await waitForServer(base, child);
    async function get(path: string, cookie: string) { const res = await fetch(`${base}${path}`, { headers: { cookie }, redirect: "manual" }); assert.equal(res.status, 200, path); return res.text(); }
    async function login(email: string) {
      const form = forms(await (await fetch(`${base}/login?next=%2Fadmin`)).text())[0]; assert.ok(form);
      const data = hidden(form); data.set("email", email); data.set("password", password);
      const res = await fetch(`${base}/login?next=%2Fadmin`, { method: "POST", headers: { origin: base }, body: data, redirect: "manual" });
      assert.equal(res.status, 303); return res.headers.getSetCookie().map((v) => v.split(";")[0]).join("; ");
    }
    const admin = await login("manager@selahtone.local"), accountant = await login("accountant@selahtone.local"), agent = await login("arh@selahtone.local");
    async function save(kind: "role" | "user", subject: string, key: string, value: "deny" | "allow" | "inherit") {
      const form = forms(await get("/admin", admin)).find((entry) => entry.includes('name="kind"')); assert.ok(form);
      const data = hidden(form); for (const [name, v] of Object.entries({ kind, subject, key, value })) data.set(name, v);
      assert.match(await (await fetch(`${base}/admin`, { method: "POST", headers: { cookie: admin, origin: base }, body: data })).text(), /حُفظت الصلاحية/);
    }
    const path = "/finance/expenses/new", write = `${path}#write`;
    const form = forms(await get(path, agent)).find((f) => f.includes('name="description"')); assert.ok(form, "baseline creation form missing");
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
    async function post(cookie: string, requestId: string, branchId: string, description: string) {
      const data = hidden(form!);
      for (const [name, value] of Object.entries({ requestId, branchId, description, categoryId: "1", amount: "29.50", expenseDate: today })) data.set(name, value);
      const response = await fetch(`${base}${path}`, { method: "POST", headers: { cookie, origin: base }, body: data, redirect: "manual" });
      return { status: response.status, location: response.headers.get("location"), body: await response.text() };
    }
    const pages = ["/finance/expenses", "/finance/expenses/today", "/finance/categories"];
    for (const p of pages) assert.ok((await get(p, accountant)).includes('href="/finance/expenses/new'), `${p}: baseline link missing`);
    await save("role", "ACCOUNTANT", write, "deny");
    for (const p of pages) {
      const text = await get(p, accountant);
      assert.ok(!text.includes('href="/finance/expenses/new'), `${p}: blocked write link visible`);
      assert.ok(text.includes(p.includes("categories") ? "بنود المصروفات" : "EXPENSELINKCANARY"), `${p}: content removed`);
    }
    assert.ok(!forms(await get(path, accountant)).some((f) => f.includes('name="description"')));
    assert.match((await post(accountant, randomUUID(), "1", "DENIEDACCOUNTANT")).body, /معطّل بالصلاحيات/);
    await save("user", "2", write, "allow");
    for (const p of pages) assert.ok((await get(p, accountant)).includes('href="/finance/expenses/new'), `${p}: user override did not restore link`);
    assert.match((await post(accountant, "not-a-uuid", "1", "OVERRIDEVALIDATION")).body, /معرّف الطلب غير صالح/);
    await save("role", "ACCOUNTANT", "/finance#write", "deny");
    for (const p of pages) assert.ok(!(await get(p, accountant)).includes('href="/finance/expenses/new'), `${p}: finance lock ignored`);
    assert.match((await post(accountant, randomUUID(), "1", "DENIEDFINANCE")).body, /معطّل بالصلاحيات/);
    await save("role", "ACCOUNTANT", "/finance#write", "inherit");
    await save("user", "2", write, "inherit"); await save("role", "ACCOUNTANT", write, "inherit");
    await save("role", "ACCOUNTANT", "/finance/expenses/new", "deny");
    for (const p of pages) assert.ok(!(await get(p, accountant)).includes('href="/finance/expenses/new'), `${p}: destination denial ignored`);
    const pageDenied = await post(accountant, randomUUID(), "1", "DENIEDPAGE");
    assert.ok((pageDenied.status === 307 && pageDenied.location?.includes("/dashboard")) || pageDenied.body.includes("معطّل بالصلاحيات"), "page denial must block direct action");
    await save("role", "ACCOUNTANT", "/finance/expenses/new", "inherit");
    await save("role", "ACCOUNTANT", "/finance/expenses", "deny");
    const todayPage = await get("/finance/expenses/today", accountant);
    assert.ok(todayPage.includes("EXPENSELINKCANARY"));
    assert.ok(!todayPage.includes('href="/finance/expenses/1"'), "today detail link survived parent denial");
    assert.ok(!todayPage.includes('href="/finance/expenses"'), "ledger link survived parent denial");
    const categoriesPage = await get("/finance/categories", accountant);
    assert.ok(!categoriesPage.includes('href="/finance/expenses?category='), "category expense link survived parent denial");
    await save("user", "2", "/finance/expenses", "allow");
    assert.ok((await get("/finance/expenses/today", accountant)).includes('href="/finance/expenses/1"'));
    assert.ok((await get("/finance/categories", accountant)).includes('href="/finance/expenses?category='));
    await save("user", "2", "/finance/expenses", "inherit"); await save("role", "ACCOUNTANT", "/finance/expenses", "inherit");
    await save("role", "CS_AGENT", write, "deny");
    assert.ok(!(await get("/dashboard", agent)).includes('href="/finance/expenses/new'), "dashboard expense shortcut or navigation ignored write lock");
    assert.ok(!(await get("/finance/expenses", agent)).includes('href="/finance/expenses/new'), "staff expense page ignored write lock");
    assert.match((await post(agent, randomUUID(), "1", "DENIEDSTAFF")).body, /معطّل بالصلاحيات/);
    await save("user", "3", write, "allow");
    assert.ok((await get("/dashboard", agent)).includes('href="/finance/expenses/new'), "dashboard shortcut was not restored by override");
    await save("role", "CS_AGENT", "/sales/new#write", "deny");
    assert.ok(!(await get("/dashboard", agent)).includes('href="/sales/new"'), "dashboard sale shortcut ignored write lock");
    await save("user", "3", "/sales/new#write", "allow");
    assert.ok((await get("/dashboard", agent)).includes('href="/sales/new"'), "dashboard sale shortcut was not restored by override");
    assert.match((await post(agent, randomUUID(), "2", "WRONGBRANCHCANARY")).body, /فرعه فقط/);
    assert.match((await post(agent, randomUUID(), "1", "SYNTHETICSUCCESSCANARY")).body, /سُجّل المصروف بانتظار الاعتماد/);
    const ledger = await get("/finance/expenses", agent);
    assert.ok(ledger.includes("SYNTHETICSUCCESSCANARY")); assert.ok(!ledger.includes("WRONGBRANCHCANARY"));
    await save("role", "MANAGER", write, "deny");
    assert.ok(forms(await get(path, admin)).some((f) => f.includes('name="description"')), "admin bypass missing");
    assert.match((await post(admin, "not-a-uuid", "1", "ADMINVALIDATION")).body, /معرّف الطلب غير صالح/, "admin bypass should reach validation");
  } catch (error) { throw new Error(`expense creation HTTP test failed: ${error instanceof Error ? error.stack : String(error)}; server log tail:\n${logs}`, { cause: error }); }
  finally {
    if (child && child.exitCode === null) {
      const exited = new Promise<void>((resolve) => child!.once("exit", () => resolve())); child.kill("SIGTERM");
      await Promise.race([exited, new Promise<void>((resolve) => { setTimeout(resolve, 5000).unref(); })]);
      if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; }
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
