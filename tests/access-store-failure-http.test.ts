/** Disposable PGlite/Next outage and recovery test; never uses a real DATABASE_URL. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const root = process.cwd(), password = "Synthetic-Access-Test-2026!", secret = "synthetic-store-failure-only-secret";
function forms(html: string): string[] { return [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)].map(m => m[0]); }
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
async function port(): Promise<number> {
  const server = createServer(); await new Promise<void>((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("no port");
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); return address.port;
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>(resolve => child.once("exit", () => resolve())); child.kill("SIGTERM");
  await Promise.race([exited, new Promise<void>(resolve => { setTimeout(resolve, 5000).unref(); })]);
  if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; }
}

test("store outage denies non-admin data and direct writes, preserves admin and restores rules after repair", { timeout: 180_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "selahtone-access-outage-http-")); let child: ChildProcess | undefined; let logs = "";
  try {
    execFileSync(process.execPath, [join(root, "scripts/local-pglite-preview.cjs")], { cwd: root, env: { ...process.env, PREVIEW_PGLITE_DIR: dir, PREVIEW_PASSWORD: password }, stdio: "pipe", timeout: 60_000 });
    let db = new PGlite(dir);
    try {
      await db.exec("SET selahtone.finance_release_candidate_test_only='yes'");
      for (const file of ["prototypes/finance-release/release-candidate.test-only.sql", "prisma/manual-settlement-upgrade.sql", "prisma/manual-custody-closure-upgrade.sql", "prisma/manual-custody-and-count-requests.sql"]) {
        await db.exec(readFileSync(join(root, file), "utf8"));
      }
      await db.exec(`UPDATE commerce_sales SET customer_name = 'OUTAGE_CUSTOMER_CANARY' || id::text, customer_phone = '0115550000' || id::text, created_at = now() WHERE id IN (1,2,3);
        INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
        SELECT 4,NULL,'MANAGER','مدير غير أدمن','manager-not-admin@selahtone.local',password_hash,'ACTIVE',false,'FULL',true,now() FROM users WHERE id=1;
        UPDATE products SET name_ar='OUTAGE_PRODUCT_CANARY' WHERE id=(SELECT min(id) FROM products);`);
      // Outage is a real failed read, not a simulated hidden key.
      await db.exec(`DROP TABLE IF EXISTS public.access_control`);
    } finally { await db.close(); }
    const base = `http://127.0.0.1:${await port()}`;
    async function start() {
      child = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", new URL(base).port], {
        cwd: root, env: { ...process.env, DATABASE_URL: "", PRISMA_PGLITE_DIR: dir, AUTH_SECRET: secret, FINANCE_ENABLED: "true", INVENTORY_ENABLED: "true", ADMIN_EMAILS: "manager@selahtone.local" }, stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout?.on("data", data => { logs = (logs + data).slice(-20000); }); child.stderr?.on("data", data => { logs = (logs + data).slice(-20000); });
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}`);
        try { if ((await fetch(`${base}/login`)).ok) return; } catch { /* booting */ }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      throw new Error("server did not start");
    }
    await start();
    async function get(path: string, cookie: string) { return fetch(`${base}${path}`, { headers: { cookie }, redirect: "manual" }); }
    async function login(email: string) {
      const form = forms(await (await fetch(`${base}/login?next=%2Fdashboard`)).text())[0]; assert.ok(form);
      const data = hidden(form); data.set("email", email); data.set("password", password);
      const response = await fetch(`${base}/login?next=%2Fdashboard`, { method: "POST", headers: { origin: base }, body: data, redirect: "manual" });
      assert.equal(response.status, 303); return response.headers.getSetCookie().map(cookie => cookie.split(";")[0]).join("; ");
    }
    const admin = await login("manager@selahtone.local"), manager = await login("manager-not-admin@selahtone.local"), accountant = await login("accountant@selahtone.local"), agent = await login("arh@selahtone.local");
    const adminPage = await (await get("/admin", admin)).text();
    assert.match(adminPage, /تعذرت قراءة جدول الصلاحيات/); assert.match(adminPage, /حالة القواعد غير معروفة/);
    assert.equal((await get("/sales", admin)).status, 200);
    const adminDashboard = await (await get("/dashboard", admin)).text();
    assert.match(adminDashboard, /OUTAGE_CUSTOMER_CANARY1/, "outage fixture is visible to the admin");
    assert.match(adminDashboard, /الحركات المسجّلة هذا الشهر/, "admin can still inspect the card to repair permissions");
    const collectPath = "/sales/2";
    const collectForm = forms(await (await get(collectPath,admin)).text()).find(entry => entry.includes("تسجيل تحصيل"));
    assert.ok(collectForm,"the system admin can capture a collection action during the outage");
    const collectionRequest = randomUUID();
    const collectData = hidden(collectForm);
    for (const [key,value] of Object.entries({requestId:collectionRequest,saleId:"2",amount:"1",method:"CARD",reviewed:"yes"})) collectData.set(key,value);
    const postCollect = (cookie: string) => fetch(`${base}${collectPath}`, {method:"POST",headers:{cookie,origin:base},body:collectData,redirect:"manual"});
    const blockedCollection = await postCollect(accountant);
    assert.equal(blockedCollection.status,307,"non-admin captured sales action is redirected when the access store fails");
    const settingHtml = await (await get("/sales/settings", admin)).text();
    const form = forms(settingHtml).find(entry => entry.includes('name="requestId"')); assert.ok(form, "admin form is available in outage");
    for (const cookie of [manager, accountant, agent]) {
      for (const path of ["/sales", "/inventory", "/sales/settings", "/finance/accounts"]) {
        const response = await get(path, cookie); const body = await response.text();
        assert.ok((response.status === 307 && response.headers.get("location")?.includes("/dashboard")) || (response.status === 200 && /NEXT_REDIRECT|url=\/dashboard/i.test(body)), `${path}: redirect expected, got ${response.status}`);
        assert.doesNotMatch(body, /OUTAGE_PRODUCT_CANARY|OUTAGE_CUSTOMER_CANARY/);
      }
      const dash = await get("/dashboard?section=all", cookie); assert.equal(dash.status, 200);
      const body = await dash.text(); assert.match(body, /لوحة القيادة غير متاحة مؤقتًا/); assert.doesNotMatch(body, /OUTAGE_PRODUCT_CANARY|OUTAGE_CUSTOMER_CANARY|0115550000|مؤشرات الأداء|أحدث الفواتير|الحركات المسجّلة هذا الشهر/);
      assert.equal((await get("/admin", cookie)).status, 307);
      assert.equal((await get("/api/commerce/available-serials?warehouseId=1&productId=1", cookie)).status, 403);
    }
    const apiAdmin = await get("/api/commerce/available-serials", admin);
    assert.match(await apiAdmin.text(), /راجع بحث السيريال/, "admin reaches API validation rather than access denial");
    async function postSetting(cookie: string, requestId: string) {
      const data = hidden(form!); data.set("requestId", requestId); data.set("reviewed", "yes"); data.set("percent", "6"); data.set("managerPercent", "25");
      return fetch(`${base}/sales/settings`, { method: "POST", headers: { cookie, origin: base }, body: data, redirect: "manual" });
    }
    const managerPost = await postSetting(manager, "11111111-1111-4111-8111-111111111111");
    assert.equal(managerPost.status, 307, "non-admin action response is redirected away from blocked page");
    const adminPost = await postSetting(admin, "22222222-2222-4222-8222-222222222222");
    assert.match(await adminPost.text(), /تم تحديث حد خصم الموظف|سبق حفظ هذا التغيير/, "admin direct POST stays available");
    await stop(child!); child = undefined;
    db = new PGlite(dir);
    try {
      const blockedRows = await db.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_collections WHERE request_id=$1::uuid",[collectionRequest]);
      assert.equal(blockedRows.rows[0].n,0,"the denied collection was not recorded");
      const changes = await db.query<{ request_id: string }>(`SELECT request_id::text FROM commerce_settings_changes WHERE request_id IN ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222')`);
      assert.deepEqual(changes.rows.map(row => row.request_id), ["22222222-2222-4222-8222-222222222222"], "only the admin write was committed");
      await db.exec(readFileSync(join(root, "prisma/manual-access-control-upgrade.sql"), "utf8"));
      await db.exec(`INSERT INTO access_control(subject_kind,subject,key,allowed) VALUES ('role','CS_AGENT','/sales',false)`);
    } finally { await db.close(); }
    await start();
    assert.equal((await get("/sales", manager)).status, 200, "access resumes after repair");
    assert.equal((await get("/sales", agent)).status, 307, "restored deny rules are enforced");
    const restoredDashboard = await (await get("/dashboard?section=all", manager)).text();
    assert.match(restoredDashboard, /OUTAGE_CUSTOMER_CANARY1/, "normal dashboard data returns after repair");
    assert.doesNotMatch(restoredDashboard, /لوحة القيادة غير متاحة مؤقتًا/);
    assert.doesNotMatch(restoredDashboard, /أُغلق الوصول المقيّد مؤقتًا/);
    // The prior denial did not consume the request. This newly empty synthetic
    // rules table is not a restoration of any pre-outage permissions.
    const afterRepair = await postCollect(accountant);
    assert.match(await afterRepair.text(),/تم تسجيل التحصيل/);
    const replay = await postCollect(accountant);
    assert.match(await replay.text(),/سبق تسجيل هذا التحصيل/);
  } catch (error) { throw new Error(`outage HTTP test failed: ${error instanceof Error ? error.stack : String(error)}; log tail:\n${logs}`, { cause: error }); }
  finally { if (child) await stop(child); rmSync(dir, { recursive: true, force: true }); }
});
