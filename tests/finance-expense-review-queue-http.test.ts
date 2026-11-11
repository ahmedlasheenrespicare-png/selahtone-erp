/** Disposable synthetic review queue HTTP test. Never connects to DATABASE_URL. */
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

test("review queue paginates and gates sensitive content server-side", { timeout: 240_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "selahtone-review-queue-http-"));
  let child: ChildProcess | undefined; let logs = "";
  try {
    execFileSync(process.execPath, [join(root, "scripts/local-pglite-preview.cjs")], { cwd: root, env: { ...process.env, PREVIEW_PGLITE_DIR: dir, PREVIEW_PASSWORD: password }, stdio: "pipe", timeout: 60_000 });
    const db = new PGlite(dir);
    try {
      await db.exec(readFileSync(join(root, "prisma/manual-access-control-upgrade.sql"), "utf8"));
      await db.exec("SET selahtone.finance_release_candidate_test_only='yes'");
      for (const file of ["prototypes/finance-release/release-candidate.test-only.sql", "prisma/manual-settlement-upgrade.sql", "prisma/manual-custody-closure-upgrade.sql", "prisma/manual-custody-and-count-requests.sql"]) await db.exec(readFileSync(join(root, file), "utf8"));
      await db.exec(`INSERT INTO finance.expenses(branch_id,category_id,category_snapshot,amount,expense_date,description,status,requested_by,approved_by,approved_at)
        SELECT CASE WHEN n%2=0 THEN 1 ELSE 2 END,1,'اختبار',10,CURRENT_DATE,'QUEUE_EXPENSE_'||n,'PAID',3,1,now() FROM generate_series(1,27) n;
        INSERT INTO finance.expense_reviews(expense_id,expense_revision,proposed_amount,reason,original_snapshot,status,created_by)
        SELECT id,1,NULL,'QUEUE_SECRET_'||lpad(substring(description from '[0-9]+$'),2,'0')||'_END','{}','OPEN',1
        FROM finance.expenses WHERE description LIKE 'QUEUE_EXPENSE_%' ORDER BY id;`);
    } finally { await db.close(); }
    const port = await reservePort(), base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
      cwd: root, env: { ...process.env, DATABASE_URL: "", PRISMA_PGLITE_DIR: dir, AUTH_SECRET: secret, FINANCE_ENABLED: "true", INVENTORY_ENABLED: "true", ADMIN_EMAILS: "manager@selahtone.local" }, stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", data => { logs = (logs + data).slice(-16000); });
    child.stderr?.on("data", data => { logs = (logs + data).slice(-16000); });
    await waitForServer(base, child);
    const get = async (path: string, cookie: string) => (await fetch(`${base}${path}`, { headers: { cookie }, redirect: "manual" })).text();
    async function login(email: string) {
      const form = forms(await (await fetch(`${base}/login?next=%2Fadmin`)).text())[0]; assert.ok(form);
      const data = hidden(form); data.set("email", email); data.set("password", password);
      const response = await fetch(`${base}/login?next=%2Fadmin`, { method: "POST", headers: { origin: base }, body: data, redirect: "manual" });
      assert.equal(response.status, 303); return response.headers.getSetCookie().map(cookie => cookie.split(";")[0]).join("; ");
    }
    const admin = await login("manager@selahtone.local"), accountant = await login("accountant@selahtone.local"), employee = await login("arh@selahtone.local");
    async function save(key: string, value: "deny" | "allow" | "inherit", kind: "user" | "role" = "role", subject = "ACCOUNTANT") {
      const form = forms(await get("/admin", admin)).find(f => f.includes('name="kind"')); assert.ok(form);
      const data = hidden(form); for (const [name, v] of Object.entries({ kind, subject, key, value })) data.set(name, v);
      assert.match(await (await fetch(`${base}/admin`, { method: "POST", headers: { cookie: admin, origin: base }, body: data })).text(), /حُفظت الصلاحية/);
    }
    const path = "/finance/expenses/reviews";
    assert.match(await get("/finance/expenses", accountant), /طلبات المراجعة المفتوحة/);
    const first = await get(path, accountant);
    assert.match(first, /QUEUE_SECRET_27_END/); assert.doesNotMatch(first, /QUEUE_SECRET_01_END/);
    assert.match(first, /لا يوجد دفع مسجّل — يحتاج مراجعة/);
    assert.match(first, /افتح المصروف لمراجعة الطلب/);
    assert.match(first, /غير منشئه إغلاقه دون تغيير بعد الفحص وبسبب إلزامي/);
    assert.match(first, /الإغلاق لا يثبت الدفع أو التسوية ولا يرفع حراسة التصحيح/);
    assert.doesNotMatch(first, /لا توجد هنا آلية لإغلاق الطلب/);
    const next = first.match(/href="(\/finance\/expenses\/reviews\?before=\d+)"/)?.[1]; assert.ok(next);
    const older = await get(next, accountant); assert.match(older, /QUEUE_SECRET_01_END/); assert.doesNotMatch(older, /QUEUE_SECRET_27_END/);
    assert.match(older, /العودة إلى أحدث الطلبات/);
    const invalid = await get(`${path}?before=999999999999999999999999`, accountant);
    assert.match(invalid, /مؤشر الصفحة غير صالح/); assert.doesNotMatch(invalid, /QUEUE_SECRET_/);
    assert.doesNotMatch(await get(path, employee), /QUEUE_SECRET_/, "staff must not receive review content");
    await save("/finance/expenses#review", "deny");
    assert.doesNotMatch(await get(path, accountant), /QUEUE_SECRET_/, "denial must omit data from full HTML and RSC response");
    assert.doesNotMatch(await get("/finance/expenses", accountant), /href="\/finance\/expenses\/reviews"/);
    assert.match(await get(path, admin), /QUEUE_SECRET_27_END/, "admin bypass applies");
    await save("/finance/expenses#review", "allow", "user", "2");
    assert.match(await get(path, accountant), /QUEUE_SECRET_27_END/, "account override works");
    await save("/finance#write", "deny");
    assert.doesNotMatch(await get(path, accountant), /QUEUE_SECRET_/, "global write lock also hides the queue");
  } catch (error) { throw new Error(`review queue HTTP test failed: ${String(error)}; server log tail:\n${logs}`, { cause: error }); }
  finally {
    if (child && child.exitCode === null) {
      const exited = new Promise<void>(resolve => child!.once("exit", () => resolve()));
      child.kill("SIGTERM"); await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 5000))]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
