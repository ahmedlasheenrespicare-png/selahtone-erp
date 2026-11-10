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

test("catalog operations are independently guarded and field edit saves its label", { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "selahtone-catalog-guards-http-")); let child: ChildProcess | undefined; let logs = "";
  try {
    execFileSync(process.execPath, [join(root, "scripts/local-pglite-preview.cjs")], { cwd: root, env: { ...process.env, PREVIEW_PGLITE_DIR: dir, PREVIEW_PASSWORD: password }, stdio: "pipe", timeout: 60_000 });
    const db = new PGlite(dir);
    try {
      await db.exec(readFileSync(join(root, "prisma/manual-access-control-upgrade.sql"), "utf8"));
      await db.exec(`INSERT INTO users (id, branch_id, role_code, full_name, email, password_hash, status, must_change_password, menu_scope, can_cancel_sales, created_at)
        SELECT 4,NULL,'MANAGER','مدير كتالوج اصطناعي','catalog-manager@selahtone.local',password_hash,'ACTIVE',false,'FULL',true,now() FROM users WHERE id=1;
        INSERT INTO sales_item_categories (code,name_ar,sort_order,is_active,created_at,updated_at) VALUES ('SYNTHCAT','تصنيف اصطناعي',0,true,now(),now());
        INSERT INTO sales_item_types (category_id,name_ar,sort_order,is_active,created_at,updated_at) VALUES ((SELECT id FROM sales_item_categories WHERE code='SYNTHCAT'),'نوع اصطناعي',0,true,now(),now());
        INSERT INTO sales_item_fields (type_id,field_key,label_ar,is_required,sort_order,is_active,created_at,updated_at) VALUES ((SELECT id FROM sales_item_types WHERE name_ar='نوع اصطناعي'),'synthetic_field','حقل اصطناعي',true,0,true,now(),now());`);
    } finally { await db.close(); }
    const port = await reservePort(); const base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
      cwd: root, env: { ...process.env, DATABASE_URL: "", PRISMA_PGLITE_DIR: dir, AUTH_SECRET: secret, FINANCE_ENABLED: "false", INVENTORY_ENABLED: "true", ADMIN_EMAILS: "manager@selahtone.local" }, stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (data) => { logs = (logs + data).slice(-16000); });
    child.stderr?.on("data", (data) => { logs = (logs + data).slice(-16000); });
    await waitForServer(base, child);
    async function get(path: string, cookie: string) { const response = await fetch(`${base}${path}`, { headers: { cookie }, redirect: "manual" }); assert.equal(response.status, 200, path); return response.text(); }
    async function login(email: string) {
      const form = forms(await (await fetch(`${base}/login?next=%2Fadmin`)).text())[0]; assert.ok(form);
      const data = hidden(form); data.set("email", email); data.set("password", password);
      const response = await fetch(`${base}/login?next=%2Fadmin`, { method: "POST", headers: { origin: base }, body: data, redirect: "manual" });
      assert.equal(response.status, 303); return response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
    }
    const admin = await login("manager@selahtone.local"); const manager = await login("catalog-manager@selahtone.local");
    async function save(kind: "role" | "user", subject: string, key: string, value: "deny" | "allow" | "inherit") {
      const form = forms(await get("/admin", admin)).find((entry) => entry.includes('name="kind"')); assert.ok(form);
      const data = hidden(form); for (const [name, v] of Object.entries({ kind, subject, key, value })) data.set(name, v);
      const response = await fetch(`${base}/admin`, { method: "POST", headers: { cookie: admin, origin: base }, body: data }); assert.match(await response.text(), /حُفظت الصلاحية/);
    }
    const cases = [
      { name: "create-category", marker: 'id="cat-code"' }, { name: "edit-category", marker: "حفظ التصنيف" },
      { name: "change-category-status", marker: "سبب تغيير حالة تصنيف تصنيف اصطناعي" },
      { name: "create-type", marker: 'id="type-name"' }, { name: "edit-type", marker: "حفظ النوع" },
      { name: "change-type-status", marker: "سبب تغيير حالة نوع نوع اصطناعي" },
      { name: "create-field", marker: 'id="field-key"' }, { name: "edit-field", marker: "حفظ الحقل" },
      { name: "change-field-status", marker: "سبب تغيير حالة حقل حقل اصطناعي" },
    ];
    const path = "/sales/catalog";
    for (const entry of cases) {
      const key = `/sales/catalog#${entry.name}`;
      const before = await get(path, manager); const form = forms(before).find((f) => f.includes(entry.marker));
      assert.ok(form, `${key}: baseline form missing`);
      const post = async () => {
        const data = hidden(form); data.set("requestId", randomUUID()); data.set("reviewed", "yes");
        for (const [name, value] of Object.entries({ code: "FORBIDDENCAT", nameAr: "اسم اختبار ممنوع", labelAr: "عنوان اختبار ممنوع", categoryId: "1", typeId: "1", fieldKey: "forbidden_field", isRequired: "yes", sortOrder: "0", reason: "اختبار منع", active: "no" })) data.set(name, value);
        return (await fetch(`${base}${path}`, { method: "POST", headers: { cookie: manager, origin: base }, body: data })).text();
      };
      await save("role", "MANAGER", key, "deny");
      const denied = await get(path, manager); assert.ok(!denied.includes(entry.marker), `${key}: denied form visible`);
      const other = cases.find((c) => c.name !== entry.name)!;
      assert.ok(denied.includes(other.marker), `${key}: unrelated form hidden`);
      assert.match(await post(), /معطّل بالصلاحيات/, `${key}: direct POST not denied`);
      assert.ok((await get(path, admin)).includes(entry.marker), `${key}: admin bypass missing`);
      await save("user", "4", key, "allow"); assert.ok((await get(path, manager)).includes(entry.marker), `${key}: account override missing`);
      await save("user", "4", key, "inherit"); await save("role", "MANAGER", key, "inherit");
    }
    // Capture the rendered input name as a browser would, then submit an actual
    // successful change to a synthetic record (no permission override remains).
    const fieldForm = forms(await get(path, manager)).find((f) => f.includes("حفظ الحقل")); assert.ok(fieldForm);
    assert.match(fieldForm, /name="labelAr"/); assert.doesNotMatch(fieldForm, /name="nameAr"/);
    const data = hidden(fieldForm); data.set("requestId", randomUUID()); data.set("reviewed", "yes");
    data.set("labelAr", "عنوان اصطناعي معدل"); data.set("sortOrder", "3"); data.set("isRequired", "yes");
    const saved = await fetch(`${base}${path}`, { method: "POST", headers: { cookie: manager, origin: base }, body: data });
    assert.match(await saved.text(), /تم تعديل الحقل/);
    assert.ok((await get(path, manager)).includes("عنوان اصطناعي معدل"), "saved field label missing after reload");
  } catch (error) { throw new Error(`catalog HTTP test failed; server log tail:\n${logs}`, { cause: error }); }
  finally {
    if (child && child.exitCode === null) {
      const exited = new Promise<void>((resolve) => child!.once("exit", () => resolve())); child.kill("SIGTERM");
      await Promise.race([exited, new Promise<void>((resolve) => { setTimeout(resolve, 5000).unref(); })]);
      if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; }
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
