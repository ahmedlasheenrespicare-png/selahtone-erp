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

test("opening cash accounts obeys write, operation, role and page guards over HTTP", { timeout: 180_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "selahtone-account-open-http-")); let child: ChildProcess | undefined; let logs = "";
  try {
    execFileSync(process.execPath, [join(root, "scripts/local-pglite-preview.cjs")], { cwd: root, env: { ...process.env, PREVIEW_PGLITE_DIR: dir, PREVIEW_PASSWORD: password }, stdio: "pipe", timeout: 60_000 });
    const db = new PGlite(dir);
    try {
      await db.exec(readFileSync(join(root, "prisma/manual-access-control-upgrade.sql"), "utf8"));
      await db.exec("SET selahtone.finance_release_candidate_test_only='yes'");
      for (const file of ["prototypes/finance-release/release-candidate.test-only.sql", "prisma/manual-settlement-upgrade.sql", "prisma/manual-custody-closure-upgrade.sql", "prisma/manual-custody-and-count-requests.sql"]) await db.exec(readFileSync(join(root, file), "utf8"));
      await db.exec(`UPDATE users SET branch_id=1 WHERE id=2;
        INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
        SELECT 4,NULL,'MANAGER','مدير غير أدمن','restricted-manager@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=1;
        INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
        SELECT 5,1,'CS_AGENT','موظف اختبار ثان','staff2@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3;
        INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
        SELECT 6,1,'CS_AGENT','موظف اختبار ثالث','staff3@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3;
        INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
        SELECT 7,1,'CS_AGENT','موظف اختبار رابع','staff4@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3;
        INSERT INTO finance.accounts (branch_id,kind,holder_id,opening_amount,opening_date,opened_by,closed_at,closed_by)
        VALUES (1,'CUSTODY',3,0,CURRENT_DATE,1,now(),1), (1,'CUSTODY',5,0,CURRENT_DATE,1,NULL,NULL), (1,'CUSTODY',6,0,CURRENT_DATE,1,NULL,NULL), (1,'CUSTODY',7,10,CURRENT_DATE,1,NULL,NULL);
        INSERT INTO finance.cash_counts (account_id,counted_amount,observed_balance,difference,account_revision,counted_on,reason,created_by)
        VALUES (2,0,0,0,0,CURRENT_DATE,'جرد مفتوح تجريبي',1);
        INSERT INTO finance.custody_requests (branch_id,requester_id,requested_amount,reason) VALUES (1,3,12,'OPENREQUESTCANARY');`);
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
    const admin = await login("manager@selahtone.local"), accountant = await login("accountant@selahtone.local"), staff = await login("arh@selahtone.local"), manager = await login("restricted-manager@selahtone.local");
    async function save(kind: "role" | "user", subject: string, key: string, value: "deny" | "allow" | "inherit") {
      const form = forms(await get("/admin", admin)).find((entry) => entry.includes('name="kind"')); assert.ok(form);
      const data = hidden(form); for (const [name, v] of Object.entries({ kind, subject, key, value })) data.set(name, v);
      assert.match(await (await fetch(`${base}/admin`, { method: "POST", headers: { cookie: admin, origin: base }, body: data })).text(), /حُفظت الصلاحية/);
    }
    const path = "/finance/accounts", key = "/finance/accounts#open";
    const initial = await get(path, accountant); const form = forms(initial).find((f) => f.includes('name="openingAmount"')); assert.ok(form);
    assert.ok(initial.includes('name="requestDbId"'), "independent custody decision form missing");
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
    async function post(cookie: string, requestId: string, counted = "yes") {
      const data = hidden(form!);
      for (const [name, value] of Object.entries({ requestId, branchId: "1", kind: "VAULT", holderId: "", openingAmount: "350.25", openingDate: today, counted })) data.set(name, value);
      const res = await fetch(`${base}${path}`, { method: "POST", headers: { cookie, origin: base }, body: data, redirect: "manual" });
      return { status: res.status, location: res.headers.get("location"), body: await res.text() };
    }
    await save("role", "ACCOUNTANT", key, "deny");
    const denied = await get(path, accountant);
    assert.ok(!forms(denied).some((f) => f.includes('name="openingAmount"')));
    assert.ok(denied.includes('name="requestDbId"') && denied.includes("OPENREQUESTCANARY"), "independent decision should stay available");
    assert.match((await post(accountant, randomUUID())).body, /معطّل بالصلاحيات/);
    await save("user", "2", key, "allow");
    assert.ok(forms(await get(path, accountant)).some((f) => f.includes('name="openingAmount"')));
    assert.match((await post(accountant, "invalid-uuid")).body, /معرّف الطلب غير صالح/);
    for (const parent of ["/finance#write", "/finance/accounts#write"]) {
      await save("role", "ACCOUNTANT", parent, "deny");
      assert.ok(!forms(await get(path, accountant)).some((f) => f.includes('name="openingAmount"')));
      assert.match((await post(accountant, randomUUID())).body, /معطّل بالصلاحيات/);
      await save("role", "ACCOUNTANT", parent, "inherit");
    }
    await save("role", "ACCOUNTANT", path, "deny");
    const locked = await post(accountant, randomUUID());
    assert.ok((locked.status === 307 && locked.location?.includes("/dashboard")) || locked.body.includes("معطّل بالصلاحيات"));
    await save("role", "ACCOUNTANT", path, "inherit");
    await save("role", "MANAGER", key, "deny");
    assert.ok(!forms(await get(path, manager)).some((f) => f.includes('name="openingAmount"')));
    assert.match((await post(manager, randomUUID())).body, /معطّل بالصلاحيات/);
    assert.ok(forms(await get(path, admin)).some((f) => f.includes('name="openingAmount"')), "admin bypass missing");
    assert.match((await post(admin, "invalid-uuid")).body, /معرّف الطلب غير صالح/);
    await save("user", "3", key, "allow");
    assert.match((await post(staff, randomUUID())).body, /إدارة الحسابات النقدية متاحة للمدير والمحاسب فقط/);
    assert.match((await post(accountant, randomUUID(), "no")).body, /أكد الجرد الفعلي أولًا/);
    const requestId = randomUUID();
    assert.match((await post(accountant, requestId)).body, /فُتح الحساب بالرصيد الفعلي بعد تأكيد الجرد/);
    assert.match((await post(accountant, requestId)).body, /سبق حفظ هذا الطلب؛ لم يُفتح حساب مكرر/);
    assert.match(await get(path, accountant), /350\.25/);
    assert.ok((await get(path, accountant)).includes("OPENREQUESTCANARY"), "opening vault should not decide the custody request");
    const transfer = forms(await get("/finance/transfers", accountant)).find((f) => f.includes('name="fromId"')); assert.ok(transfer);
    for (const [fromId, toId, expectedBalance] of [["5", "1", "350.25"], ["1", "5", "0"]]) {
      const data = hidden(transfer); for (const [name, value] of Object.entries({ requestId: randomUUID(), fromId, toId, expectedBalance, amount: "10", actuallyTransferred: "yes", negativeAcknowledged: "yes" })) data.set(name, value);
      const result = await fetch(`${base}/finance/transfers`, { method: "POST", headers: { cookie: accountant, origin: base }, body: data });
      assert.ok((await result.text()).includes("لا يمكن تحويل النقد من عهدة مقفلة أو إليها"), "closed account transfer should be rejected");
    }
    assert.match(await get(path, accountant), /350\.25/, "rejected transfers must leave vault balance unchanged");
    // Fund and empty custody 3, preserving the exact requests for later replay.
    async function postTransfer(values: Record<string, string>, cookie = accountant) {
      const data = hidden(transfer!);
      for (const [name, value] of Object.entries(values)) data.set(name, value);
      return (await fetch(`${base}/finance/transfers`, { method: "POST", headers: { cookie, origin: base }, body: data })).text();
    }
    const forward = { requestId: randomUUID(), fromId: "5", toId: "3", expectedBalance: "350.25", amount: "1", actuallyTransferred: "yes", negativeAcknowledged: "no" };
    const backward = { requestId: randomUUID(), fromId: "3", toId: "5", expectedBalance: "1", amount: "1", actuallyTransferred: "yes", negativeAcknowledged: "no" };
    assert.match(await postTransfer(forward), /سُجّل التسليم الفعلي بين الحسابين/);
    assert.match(await postTransfer(backward), /سُجّل التسليم الفعلي بين الحسابين/);

    // The closure form is rendered inside a closed details disclosure; HTTP still
    // exercises the real server action rather than trusting the visible button.
    const financePath = "/finance", closeKey = "/finance#close-custody";
    const closeForm = forms(await get(financePath, accountant)).find((f) => f.includes('name="accountId" value="2"') && f.includes("تأكيد الإقفال"));
    assert.ok(closeForm?.includes("قد يستمر أثر تصحيح مرتبط بدفع نقد موظف سُجّل قبل حد الفترة"));
    assert.ok(closeForm?.includes("الدفع الأقدم وحده لا يفعّل حراسة التصحيح الحالية"));
    assert.ok(closeForm, "zero-balance open custody should expose a closure action");
    async function postClose(cookie: string, accountId: string, requestId: string) {
      const data = hidden(closeForm!);
      for (const [name, value] of Object.entries({ accountId, requestId, reason: "اختبار إقفال اصطناعي" })) data.set(name, value);
      const res = await fetch(`${base}${financePath}`, { method: "POST", headers: { cookie, origin: base }, body: data, redirect: "manual" });
      return { status: res.status, location: res.headers.get("location"), body: await res.text() };
    }
    await save("role", "ACCOUNTANT", closeKey, "deny");
    assert.ok(!forms(await get(financePath, accountant)).some((f) => f.includes("تأكيد الإقفال")));
    assert.match((await postClose(accountant, "3", randomUUID())).body, /معطّل بالصلاحيات/);
    await save("user", "2", closeKey, "allow");
    assert.ok(forms(await get(financePath, accountant)).some((f) => f.includes("تأكيد الإقفال")));
    await save("role", "ACCOUNTANT", "/finance#write", "deny");
    assert.match((await postClose(accountant, "3", randomUUID())).body, /معطّل بالصلاحيات/);
    await save("role", "ACCOUNTANT", "/finance#write", "inherit");
    await save("role", "ACCOUNTANT", financePath, "deny");
    const lockedClose = await postClose(accountant, "3", randomUUID());
    assert.ok((lockedClose.status === 307 && lockedClose.location?.includes("/dashboard")) || lockedClose.body.includes("معطّل بالصلاحيات"));
    await save("role", "ACCOUNTANT", financePath, "inherit");
    await save("role", "MANAGER", closeKey, "deny");
    assert.match((await postClose(manager, "3", randomUUID())).body, /معطّل بالصلاحيات/);
    assert.ok(forms(await get(financePath, admin)).some((f) => f.includes("تأكيد الإقفال")), "admin should bypass rule denial");
    await save("user", "3", closeKey, "allow");
    const staffClose = await postClose(staff, "3", randomUUID());
    assert.equal(staffClose.status, 200); // Staff page does not mount the form, so no action-state message is rendered.
    assert.ok(!forms(staffClose.body).some((f) => f.includes("تأكيد الإقفال")));
    assert.match((await postClose(accountant, "2", randomUUID())).body, /طلب تسوية أو جرد مفتوح/);
    assert.match((await postClose(accountant, "5", randomUUID())).body, /خزنة الفرع لا تُقفل/);
    assert.match((await postClose(accountant, "4", randomUUID())).body, /لا تُقفل العهدة وفي ذمتها/);
    const closeId = randomUUID();
    assert.match((await postClose(accountant, "3", closeId)).body, /أُقفلت العهدة/);
    assert.match((await postClose(accountant, "3", closeId)).body, /سبق حفظ هذا الطلب؛ لم يُقفل الحساب مرتين/);
    assert.match(await postTransfer(forward), /سبق حفظ هذا الطلب؛ لم تُسجَّل حركة مكررة/, "replay remains available after destination closure");
    assert.match(await postTransfer(backward), /سبق حفظ هذا الطلب؛ لم تُسجَّل حركة مكررة/, "replay remains available after source closure");
    assert.match(await postTransfer({ ...forward, amount: "2" }), /استُخدم معرّف الطلب ببيانات مختلفة/, "a changed request is not a replay");
    assert.match(await postTransfer({ ...forward, requestId: randomUUID() }), /لا يمكن تحويل النقد من عهدة مقفلة أو إليها/, "a new transfer remains blocked");
    assert.match(await postTransfer(forward, admin), /استُخدم معرّف الطلب ببيانات مختلفة/, "another actor cannot replay the request");
    await save("role", "ACCOUNTANT", "/finance/transfers#transfer", "deny");
    assert.match(await postTransfer(forward), /معطّل بالصلاحيات/, "revoked permission still blocks replay");
    await save("role", "ACCOUNTANT", "/finance/transfers#transfer", "inherit");
    assert.match(await get(path, accountant), /350\.25/, "replay and rejected requests do not change the vault");
    assert.match((await postClose(accountant, "3", randomUUID())).body, /هذه العهدة مقفلة بالفعل/);
    const afterClose = await get(financePath, accountant);
    assert.ok(!forms(afterClose).some((f) => f.includes('name="accountId" value="3"') && f.includes("تأكيد الإقفال")));
    assert.ok(forms(afterClose).some((f) => f.includes('name="accountId" value="2"') && f.includes("تأكيد الإقفال")), "failed close must leave account open");
    assert.ok(!forms(afterClose).some((f) => f.includes('name="accountId" value="4"') && f.includes("تأكيد الإقفال")), "nonzero custody must not show close form");

  } catch (error) { throw new Error(`account opening HTTP test failed: ${error instanceof Error ? error.stack : String(error)}; server log tail:\n${logs}`, { cause: error }); }
  finally {
    if (child && child.exitCode === null) {
      const exited = new Promise<void>((resolve) => child!.once("exit", () => resolve())); child.kill("SIGTERM");
      await Promise.race([exited, new Promise<void>((resolve) => { setTimeout(resolve, 5000).unref(); })]);
      if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; }
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
