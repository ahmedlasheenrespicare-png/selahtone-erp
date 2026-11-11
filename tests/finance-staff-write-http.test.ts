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

test("staff custody, count and settlement permissions reject direct requests", { timeout: 240_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "selahtone-staff-finance-http-"));
  let child: ChildProcess | undefined; let logs = "";
  try {
    execFileSync(process.execPath, [join(root, "scripts/local-pglite-preview.cjs")], { cwd: root, env: { ...process.env, PREVIEW_PGLITE_DIR: dir, PREVIEW_PASSWORD: password }, stdio: "pipe", timeout: 60_000 });
    const db = new PGlite(dir);
    try {
      await db.exec(readFileSync(join(root, "prisma/manual-access-control-upgrade.sql"), "utf8"));
      await db.exec("SET selahtone.finance_release_candidate_test_only='yes'");
      for (const file of ["prototypes/finance-release/release-candidate.test-only.sql", "prisma/manual-settlement-upgrade.sql", "prisma/manual-custody-closure-upgrade.sql", "prisma/manual-custody-and-count-requests.sql"]) await db.exec(readFileSync(join(root, file), "utf8"));
      await db.exec(`UPDATE users SET branch_id=1 WHERE id=2;
        INSERT INTO branches(id,code,name_ar,invoice_prefix,opening_date,is_active,created_at) VALUES (99,'INA99','فرع متوقف اصطناعي','IN99',CURRENT_DATE,false,now());
        INSERT INTO users(id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
        SELECT 99,99,role_code,'موظف فرع متوقف','inactive-custody@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3;
        INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
        SELECT 4,branch_id,role_code,'موظف اختبار ثان','staff-two@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3;
        INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
        SELECT 5,branch_id,role_code,'موظف اختبار ثالث','staff-three@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3;
        INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
        SELECT 6,NULL,role_code,'محاسب بلا فرع','accountant-no-branch@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=2;
        INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
        SELECT 7,2,role_code,'موظف فرع ثان','staff-branch2@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3;
        INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
        SELECT 8,2,role_code,'محاسب فرع ثان','accountant-branch2@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=2;
        INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
        SELECT 9,2,role_code,'موظف فرع ثان آخر','staff-branch2-other@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3;
        INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
        SELECT 10,branch_id,role_code,'موظف عهدة مقفلة','staff-closed@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3;
        INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
        SELECT 11,branch_id,role_code,'موظف تسوية صالحة','staff-valid-settlement@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3;
        INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
        SELECT 12,branch_id,role_code,'موظف دون طلب','staff-no-request@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3;
        INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
        SELECT 13,branch_id,role_code,'موظف عهدة مقفلة دون طلب','staff-closed-no-request@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3;
        INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
        SELECT 14,branch_id,role_code,'موظف طلب موقوف اصطناعي','staff-suspended-pending@selahtone.local',password_hash,'SUSPENDED',false,'FULL',false,now() FROM users WHERE id=3;
        INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
        SELECT 15,1,role_code,'موظف نقل اصطناعي','staff-moved-count@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3;
        INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
        SELECT 16,1,role_code,'موظف عهد متعددة اصطناعي','staff-ambiguous-custody@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3;
        INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
        SELECT 18,2,role_code,'موظف عهدة صفرية اصطناعي','staff-zero@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3;
        INSERT INTO finance.accounts (branch_id,kind,holder_id,opening_amount,opening_date,opened_by)
        VALUES (1,'VAULT',NULL,1000,CURRENT_DATE,1),(1,'CUSTODY',3,10,CURRENT_DATE,1),(1,'CUSTODY',4,20,CURRENT_DATE,1);
        INSERT INTO finance.accounts (branch_id,kind,holder_id,opening_amount,opening_date,opened_by,closed_at,closed_by)
        VALUES (1,'CUSTODY',10,0,CURRENT_DATE,1,now(),1);
        INSERT INTO finance.accounts (branch_id,kind,holder_id,opening_amount,opening_date,opened_by,opened_at)
        VALUES (1,'CUSTODY',11,0,CURRENT_DATE-1,1,now()-interval '1 day');
        INSERT INTO finance.accounts (branch_id,kind,holder_id,opening_amount,opening_date,opened_by,closed_at,closed_by)
        VALUES (1,'CUSTODY',13,0,CURRENT_DATE,1,now(),1);
        INSERT INTO finance.accounts (branch_id,kind,holder_id,opening_amount,opening_date,opened_by)
        VALUES (2,'CUSTODY',15,0,CURRENT_DATE,1);
        INSERT INTO finance.accounts (branch_id,kind,holder_id,opening_amount,opening_date,opened_by)
        VALUES (1,'CUSTODY',16,35791,CURRENT_DATE,1),(2,'CUSTODY',16,98765,CURRENT_DATE,1);
        INSERT INTO finance.accounts (branch_id,kind,holder_id,opening_amount,opening_date,opened_by)
        VALUES (2,'CUSTODY',18,0,CURRENT_DATE,1);
        INSERT INTO finance.settlements (account_id,branch_id,requested_by,system_balance,counted_amount,sales_total,expenses_total,expected_amount,deviation,adjustment,reason)
        VALUES (2,1,3,10,10,0,0,10,0,0,'SETTLEMENTCANARY'),(4,1,10,0,10,0,0,0,10,10,'CLOSEDSETTLEMENTCANARY');
        INSERT INTO finance.settlements (account_id,branch_id,requested_by,system_balance,counted_amount,sales_total,expenses_total,expected_amount,deviation,adjustment,reason,account_revision)
        VALUES (5,1,11,0,0,0,0,0,0,0,'VALIDSETTLEMENTCANARY',0);
        INSERT INTO finance.cash_counts (account_id,counted_amount,observed_balance,difference,account_revision,counted_on,reason,created_by,requested_by,request_reason)
        VALUES (2,0,0,0,0,CURRENT_DATE,'COUNTCANARY',2,2,'COUNTCANARY'),(4,0,0,0,0,CURRENT_DATE,'CLOSEDCOUNTCANARY',2,2,'CLOSEDCOUNTCANARY'),(1,1000,1000,0,0,CURRENT_DATE,'DIRECTCOUNTCANARY',2,NULL,NULL),(7,0,0,0,0,CURRENT_DATE,'CROSSBRANCHCOUNT',2,2,'CROSSBRANCHCOUNT'),(8,0,0,0,0,CURRENT_DATE,'AMBIGUOUSCOUNTCANARY',2,2,'AMBIGUOUSCOUNTCANARY');
        INSERT INTO finance.custody_requests (branch_id,requester_id,requested_amount,reason) VALUES (1,5,30,'CUSTODYCANARY'),(2,7,40,'BRANCH2CANARY'),(2,9,50,'BRANCH2APPROVECANARY'),(1,10,5,'CLOSEDCUSTODYREQUESTCANARY'),(1,3,7,'ACTIVEACCOUNTREQUESTCANARY'),(99,99,7,'INACTIVEREQUESTCANARY'),(1,14,8,'SUSPENDEDREQUESTCANARY');
        -- Keep one synthetic settlement genuinely confirmable under the current
        -- conservative revision/timestamp guards; the test exercises the form.
        UPDATE finance.settlements st SET account_revision=a.revision, created_at=now()+interval '1 day'
        FROM finance.accounts a WHERE st.account_id=a.id;`);
    } finally { await db.close(); }
    const port = await reservePort(); const base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
      cwd: root, env: { ...process.env, DATABASE_URL: "", PRISMA_PGLITE_DIR: dir, AUTH_SECRET: secret, FINANCE_ENABLED: "true", INVENTORY_ENABLED: "true", ADMIN_EMAILS: "manager@selahtone.local" }, stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (data) => { logs = (logs + data).slice(-16000); }); child.stderr?.on("data", (data) => { logs = (logs + data).slice(-16000); });
    await waitForServer(base, child);
    async function get(path: string, cookie: string) {
      const response = await fetch(`${base}${path}`, { headers: { cookie }, redirect: "manual" });
      assert.equal(response.status, 200, path); return response.text();
    }
    async function login(email: string) {
      const form = forms(await (await fetch(`${base}/login?next=%2Fadmin`)).text())[0]; assert.ok(form);
      const data = hidden(form); data.set("email", email); data.set("password", password);
      const response = await fetch(`${base}/login?next=%2Fadmin`, { method: "POST", headers: { origin: base }, body: data, redirect: "manual" });
      assert.equal(response.status, 303); return response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
    }
    const admin = await login("manager@selahtone.local"), accountant = await login("accountant@selahtone.local"), staff = await login("arh@selahtone.local"), staffTwo = await login("staff-two@selahtone.local"), staffThree = await login("staff-three@selahtone.local");
    async function save(kind: "role" | "user", subject: string, key: string, value: "deny" | "allow" | "inherit") {
      const form = forms(await get("/admin", admin)).find((entry) => entry.includes('name="kind"')); assert.ok(form);
      const data = hidden(form); for (const [name, v] of Object.entries({ kind, subject, key, value })) data.set(name, v);
      assert.match(await (await fetch(`${base}/admin`, { method: "POST", headers: { cookie: admin, origin: base }, body: data })).text(), /حُفظت الصلاحية/);
    }
    const staffNoRequest = await login("staff-no-request@selahtone.local");
    const noCustodyDashboard = await get("/dashboard", staffNoRequest);
    assert.ok(noCustodyDashboard.includes("ملخص المهام المالية غير متاح"));
    assert.ok(!noCustodyDashboard.includes("لا مهام معلّقة على عهدتك الآن"));
    assert.ok(!noCustodyDashboard.includes("كل شيء محدّث ومعتمد"));
    assert.match(noCustodyDashboard, /مهام عهدتك اليوم<\/span><span class="stat-grid__value">—<\/span>/, "unavailable custody summary must not render zero tasks");
    const pendingWithOpenAccount = await get("/finance/mine", staff);
    assert.ok(pendingWithOpenAccount.includes("لديك طلب عهدة معلّق"), "a direct opening must not hide the employee's unresolved request");
    const pendingCustodyPage = await get("/finance/mine", staffThree);
    assert.ok(pendingCustodyPage.includes("لديك طلب عهدة معلّق"));
    assert.ok(!forms(pendingCustodyPage).some(f => f.includes('name="amount"') && f.includes('name="reason"')));
    await save("role", "CS_AGENT", "/finance/mine#request-custody", "deny");
    assert.ok(!(await get("/finance/mine", staffThree)).includes("لديك طلب عهدة معلّق"), "pending request status must not appear when its action is denied");
    await save("role", "CS_AGENT", "/finance/mine#request-custody", "inherit");
    const accountantNoBranch = await login("accountant-no-branch@selahtone.local");
    const accountantBranchTwo = await login("accountant-branch2@selahtone.local");
    const zeroAccountantDashboard = await get("/dashboard", accountantBranchTwo);
    assert.match(zeroAccountantDashboard, /مهام تنتظر التنفيذ<\/span><span class="stat-grid__value">0[\s\S]*?<small>مهام<\/small>/, "a real zero accountant task count remains visible");
    assert.ok(!zeroAccountantDashboard.includes("ملخص المهام المالية غير متاح"));
    const zeroEmployeeDashboard = await get("/dashboard", await login("staff-zero@selahtone.local"));
    assert.match(zeroEmployeeDashboard, /مهام عهدتك اليوم<\/span><span class="stat-grid__value">0[\s\S]*?<small>مهام<\/small>/, "a real zero employee task count remains visible");
    assert.ok(!zeroEmployeeDashboard.includes("ملخص المهام المالية غير متاح"));
    await save("user", "2", "/finance/expenses", "deny");
    const accountantPartialTasks = await get("/dashboard", accountant);
    assert.match(accountantPartialTasks, /مهام تنتظر التنفيذ<\/span><span class="stat-grid__value">—<\/span>/);
    assert.ok(accountantPartialTasks.includes("بعض مصادر المهام غير متاحة بصلاحيات حسابك"));
    assert.ok(accountantPartialTasks.includes("الإجراءات أدناه ليست قائمة كاملة"), "permitted settlement actions remain available but are labelled partial");
    await save("user", "2", "/finance/expenses", "inherit");
    await save("user", "3", "/finance/mine", "deny");
    const employeePartialTasks = await get("/dashboard", staff);
    assert.match(employeePartialTasks, /مهام عهدتك اليوم<\/span><span class="stat-grid__value">—<\/span>/);
    assert.ok(employeePartialTasks.includes("بعض مصادر المهام غير متاحة بصلاحيات حسابك"));
    assert.ok(!employeePartialTasks.includes("لديك طلب تسوية معلق بانتظار اعتماد المدير"));
    await save("user", "3", "/finance/mine", "inherit");
    const branchlessAccounts = await get("/finance/accounts", accountantNoBranch);
    assert.ok(branchlessAccounts.includes("لا يوجد فرع محدد لحسابك؛ لا يمكنك البت في الطلبات"));
    assert.ok(!branchlessAccounts.includes("INACTIVEREQUESTCANARY"));
    assert.ok(!(await get("/finance/accounts", accountant)).includes("INACTIVEREQUESTCANARY"));
    assert.ok((await get("/finance/accounts", accountant)).includes("CUSTODYCANARY"), "same-branch accountant should see pending request");
    assert.ok((await get("/finance/accounts", admin)).includes("CUSTODYCANARY"), "manager should see pending request");
    assert.ok(!(await get("/finance/accounts", accountantNoBranch)).includes("CUSTODYCANARY"), "branchless accountant must not see requests");
    assert.ok(!(await get("/finance/accounts", accountant)).includes("BRANCH2CANARY"));
    assert.ok((await get("/finance/accounts", accountantBranchTwo)).includes("BRANCH2CANARY"));
    assert.ok(!(await get("/finance/accounts", accountantBranchTwo)).includes("CUSTODYCANARY"));
    assert.ok((await get("/finance/accounts", admin)).includes("BRANCH2CANARY"));
    const staffSettlementOverview = await get("/finance/settlements", staffTwo);
    assert.ok(staffSettlementOverview.includes('href="/finance/settlements/new"'));
    assert.ok(staffSettlementOverview.includes("قد تختلف هوية المحصّل عن منشئ الفاتورة"));
    assert.ok((await get("/finance/mine", staffTwo)).includes("لا يثبت المؤشر أو الإقرار حيازة النقد"));
    await save("role", "CS_AGENT", "/finance/settlements/new#request", "deny");
    assert.ok(!(await get("/finance/settlements", staffTwo)).includes('href="/finance/settlements/new"'));
    await save("user", "4", "/finance/settlements/new#request", "allow");
    assert.ok((await get("/finance/settlements", staffTwo)).includes('href="/finance/settlements/new"'));
    await save("role", "CS_AGENT", "/finance/settlements/new#write", "deny");
    assert.ok(!(await get("/finance/settlements", staffTwo)).includes('href="/finance/settlements/new"'));
    await save("role", "CS_AGENT", "/finance/settlements/new#write", "inherit");
    await save("user", "4", "/finance/settlements/new#request", "inherit");
    await save("role", "CS_AGENT", "/finance/settlements/new#request", "inherit");
    const cases = [
      { path: "/finance/mine", cookie: staffNoRequest, role: "CS_AGENT", user: "12", key: "/finance/mine#request-custody", field: 'name="amount"', values: { amount: "30", reason: "اختبار طلب العهدة" } },
      { path: "/finance/accounts", cookie: accountant, role: "ACCOUNTANT", user: "2", key: "/finance/accounts#decide-custody", field: 'name="requestDbId"', values: { requestDbId: "1", decision: "REJECT", reason: "اختبار قرار العهدة" } },
      { path: "/finance/mine", cookie: staff, role: "CS_AGENT", user: "3", key: "/finance/mine#submit-count", field: 'name="countId"', values: { countId: "1", countedAmount: "10", actuallyCounted: "yes" } },
      { path: "/finance/settlements/new", cookie: staffTwo, role: "CS_AGENT", user: "4", key: "/finance/settlements/new#request", field: 'name="expectedBalance"', values: { accountId: "3", expectedBalance: "20", countedAmount: "20", reason: "اختبار طلب التسوية", actuallyCounted: "yes" } },
      { path: "/finance/settlements", cookie: staff, role: "CS_AGENT", user: "3", key: "/finance/settlements#cancel", field: 'name="settlementId"', values: { settlementId: "1", reason: "اختبار إلغاء التسوية" } },
    ];
    for (const entry of cases) {
      const initial = await get(entry.path, entry.cookie); const form = forms(initial).find((f) => f.includes(entry.field)); assert.ok(form, `${entry.key}: baseline form missing`);
      const post = async (requestId: string) => {
        const data = hidden(form); data.set("requestId", requestId);
        for (const [name, value] of Object.entries(entry.values)) data.set(name, value);
        const response = await fetch(`${base}${entry.path}`, { method: "POST", headers: { cookie: entry.cookie, origin: base }, body: data, redirect: "manual" });
        assert.equal(response.status, 200); return response.text();
      };
      await save("role", entry.role, entry.key, "deny");
      assert.ok(!(await get(entry.path, entry.cookie)).includes(entry.field), `${entry.key}: denied form visible`);
      if (entry.key === "/finance/accounts#decide-custody") {
        const deniedPage = await get(entry.path, entry.cookie);
        assert.ok(!deniedPage.includes("CUSTODYCANARY"));
        assert.ok(!deniedPage.includes("طلبات عهدة فرعك بانتظار القرار"));
      }
      assert.match(await post(randomUUID()), /معطّل بالصلاحيات/, `${entry.key}: direct request not denied`);
      await save("user", entry.user, entry.key, "allow");
      assert.ok((await get(entry.path, entry.cookie)).includes(entry.field), `${entry.key}: override form missing`);
      assert.match(await post("not-a-uuid"), /معرّف الطلب غير صالح/, `${entry.key}: override did not reach validation`);
      await save("role", entry.role, "/finance#write", "deny");
      assert.ok(!(await get(entry.path, entry.cookie)).includes(entry.field));
      assert.match(await post(randomUUID()), /معطّل بالصلاحيات/, `${entry.key}: finance lock must beat override`);
      if (entry.role === "ACCOUNTANT") {
        await save("role", "MANAGER", entry.key, "deny");
        assert.ok((await get(entry.path, admin)).includes(entry.field), "admin bypass missing");
        await save("role", "MANAGER", entry.key, "inherit");
      }
      await save("role", entry.role, "/finance#write", "inherit"); await save("user", entry.user, entry.key, "inherit"); await save("role", entry.role, entry.key, "inherit");
      assert.ok((await get(entry.path, entry.cookie)).includes(entry.field), `${entry.key}: state changed during denied/invalid requests`);
    }
    const staffInactive = await login("inactive-custody@selahtone.local");
    const inactivePage = await get("/finance/mine", staffInactive);
    assert.ok(inactivePage.includes("طلب عهدة جديدة متوقف"));
    assert.ok(!forms(inactivePage).some(f => f.includes('name="amount"') && f.includes('name="reason"')));
    const inactiveForm = forms(await get("/finance/mine", staffNoRequest)).find(f => f.includes('name="amount"') && f.includes('name="reason"'));
    assert.ok(inactiveForm, "use another actor's action to test direct rejection");
    const inactiveData = hidden(inactiveForm);
    inactiveData.set("requestId", randomUUID()); inactiveData.set("amount", "20"); inactiveData.set("reason", "اختبار فرع متوقف");
    assert.match(await (await fetch(`${base}/finance/mine`, { method: "POST", headers: { cookie: staffInactive, origin: base }, body: inactiveData })).text(), /الفرع غير موجود أو غير نشط/);

    const staffClosed = await login("staff-closed@selahtone.local");
    const closedMine = await get("/finance/mine", staffClosed);
    assert.ok(!closedMine.includes("CLOSEDCOUNTCANARY"));
    assert.ok(closedMine.includes("عهدتك السابقة في هذا الفرع مقفلة"));
    assert.ok(closedMine.includes("سجل العهدة المقفلة"));
    assert.ok(!closedMine.includes("المتوقَّع بيدك الآن"));
    assert.ok(!forms(closedMine).some(f => f.includes('name="amount"') && f.includes('name="reason"')));
    const countForm = forms(await get("/finance/mine", staff)).find((f) => f.includes('name="countId"')); assert.ok(countForm);
    const ambiguousHolder = await login("staff-ambiguous-custody@selahtone.local");
    const ambiguousPage = await get("/finance/mine", ambiguousHolder);
    assert.ok(ambiguousPage.includes("تعذّر التحقق من عهدة نقدية واحدة مطابقة لفرعك"));
    assert.ok(!ambiguousPage.includes("AMBIGUOUSCOUNTCANARY"));
    assert.ok(!forms(ambiguousPage).some(f => f.includes('name="countId"')));
    assert.ok(!ambiguousPage.includes("المتوقَّع بيدك الآن"));
    const ambiguousDirectCount = hidden(countForm); ambiguousDirectCount.set("requestId", randomUUID()); ambiguousDirectCount.set("countId", "5"); ambiguousDirectCount.set("countedAmount", "0"); ambiguousDirectCount.set("actuallyCounted", "yes");
    assert.match(await (await fetch(`${base}/finance/mine`, { method: "POST", headers: { cookie: ambiguousHolder, origin: base }, body: ambiguousDirectCount })).text(), /أكثر من عهدة مفتوحة لصاحب الحساب/);
    const ambiguousSettlement = await get("/finance/settlements/new", ambiguousHolder);
    assert.ok(ambiguousSettlement.includes("توجد أكثر من عهدة مفتوحة باسمك"));
    assert.ok(!forms(ambiguousSettlement).some(f => f.includes('name="expectedBalance"')));
    assert.ok((await get("/finance/settlements", ambiguousHolder)).includes("توجد أكثر من عهدة مفتوحة باسمك"));
    assert.ok((await get("/finance", admin)).includes("يوجد صاحب له أكثر من عهدة مفتوحة في النطاق المعروض"));
    assert.ok((await get("/dashboard", admin)).includes("يوجد صاحب له أكثر من عهدة مفتوحة في النطاق المعروض"));
    const ambiguousDashboard = await get("/dashboard", ambiguousHolder);
    assert.ok(ambiguousDashboard.includes("ملخص المهام المالية غير متاح"));
    assert.ok(!ambiguousDashboard.includes("لا مهام معلّقة على عهدتك الآن"));
    assert.ok(!ambiguousDashboard.includes("98,765"), "another branch balance must not be selected");
    assert.ok(!ambiguousDashboard.includes("35,791"), "ambiguous custody must not generate expected cash");
    const movedCounter = await login("staff-moved-count@selahtone.local");
    const movedPage = await get("/finance/mine", movedCounter);
    assert.ok(!movedPage.includes("CROSSBRANCHCOUNT"));
    assert.ok(!forms(movedPage).some(f => f.includes('name="countId"')));
    const movedData = hidden(countForm); movedData.set("requestId", randomUUID()); movedData.set("countId", "4"); movedData.set("countedAmount", "0"); movedData.set("actuallyCounted", "yes");
    assert.match(await (await fetch(`${base}/finance/mine`, { method: "POST", headers: { cookie: movedCounter, origin: base }, body: movedData })).text(), /عهدتك في فرعك الحالي/);
    const countData = hidden(countForm);
    for (const [name, value] of Object.entries({ requestId: randomUUID(), countId: "2", countedAmount: "10", actuallyCounted: "yes" })) countData.set(name, value);
    const countPost = await fetch(`${base}/finance/mine`, { method: "POST", headers: { cookie: staffClosed, origin: base }, body: countData });
    assert.ok((await countPost.text()).includes("العهدة مقفلة؛ لا يمكن تسجيل الجرد عليها"));
    const countsPage = await get("/finance/counts", accountant);
    assert.ok(countsPage.includes("الحساب مقفل؛ لا يمكن تأكيد الجرد"));
    const countForms = forms(countsPage);
    assert.ok(countForms.some((f) => f.includes('name="countId" value="2"') && f.includes("سبب إلغاء طلب الجرد")));
    assert.ok(!countForms.some((f) => f.includes('name="countId" value="2"') && f.includes('name="stillCurrent"')));
    assert.ok(countsPage.includes("ينتظر الجرد الموجّه تسجيل الموظف قبل التأكيد"));
    assert.ok(!countForms.some((f) => f.includes('name="countId" value="1"') && f.includes('name="stillCurrent"')));
    const confirmCount = countForms.find((f) => f.includes('name="countId" value="3"') && f.includes('name="stillCurrent"')); assert.ok(confirmCount);
    const earlyData = hidden(confirmCount);
    for (const [name, value] of Object.entries({ requestId: randomUUID(), countId: "1", reason: "تأكيد مبكر", stillCurrent: "yes" })) earlyData.set(name, value);
    const earlyPost = await fetch(`${base}/finance/counts`, { method: "POST", headers: { cookie: accountant, origin: base }, body: earlyData });
    assert.ok((await earlyPost.text()).includes("الجرد الموجّه ينتظر تسجيل الموظف"));
    const submitCountData = hidden(countForm);
    for (const [name, value] of Object.entries({ requestId: randomUUID(), countId: "1", countedAmount: "10", actuallyCounted: "yes" })) submitCountData.set(name, value);
    const submittedCount = await fetch(`${base}/finance/mine`, { method: "POST", headers: { cookie: staff, origin: base }, body: submitCountData });
    assert.ok((await submittedCount.text()).includes("سُجّل"), "holder must be able to submit the count");
    const submittedPage = await get("/finance/counts", accountant);
    assert.ok(forms(submittedPage).some((f) => f.includes('name="countId" value="1"') && f.includes('name="stillCurrent"')), "submitted count should become confirmable");
    const confirmCountData = hidden(confirmCount);
    for (const [name, value] of Object.entries({ requestId: randomUUID(), countId: "2", reason: "تأكيد اختبار", stillCurrent: "yes" })) confirmCountData.set(name, value);
    const confirmCountPost = await fetch(`${base}/finance/counts`, { method: "POST", headers: { cookie: accountant, origin: base }, body: confirmCountData });
    assert.ok((await confirmCountPost.text()).includes("الحساب مقفل؛ لا يمكن تأكيد جرد عليه"));
    const closedPage = await get("/finance/settlements/new", staffClosed);
    assert.ok(closedPage.includes("لا توجد عهدة مفتوحة باسمك"));
    assert.ok(!closedPage.includes('name="expectedBalance"'));
    const requestPage = await get("/finance/settlements/new", staffTwo);
    assert.ok(requestPage.includes("قد تختلف هوية المحصّل عن منشئ الفاتورة"));
    assert.ok(requestPage.includes("المعدود ناقص الرصيد الدفتري — ليس مبلغ التحويل"));
    assert.ok(requestPage.includes("اكتب ما عددته بالفعل كاملًا، لا قيمة المؤشر"));
    assert.ok(!requestPage.includes("فاكتب ١٤٥٠"));
    const requestForm = forms(requestPage).find((f) => f.includes('name="expectedBalance"')); assert.ok(requestForm);
    const closedRequest = hidden(requestForm);
    for (const [name, value] of Object.entries({ requestId: randomUUID(), accountId: "4", expectedBalance: "0", countedAmount: "0", reason: "طلب مقفل", actuallyCounted: "yes" })) closedRequest.set(name, value);
    const closedPost = await fetch(`${base}/finance/settlements/new`, { method: "POST", headers: { cookie: staffClosed, origin: base }, body: closedRequest });
    assert.ok((await closedPost.text()).includes("العهدة مقفلة؛ لا يمكن إنشاء أو اعتماد تسوية عليها"));
    const transfers = await get("/finance/transfers", accountant);
    assert.ok(transfers.includes("قد تختلف هوية المحصّل عن منشئ الفاتورة"));
    assert.ok(transfers.includes("يمكن تغييره بما فيه الصفر"));
    assert.ok(transfers.includes("العهدة مقفلة؛ لا يمكن اعتماد الطلب"));
    const decisions = forms(transfers);
    assert.ok(!decisions.some((f) => f.includes('name="settlementId" value="2"') && f.includes('name="transferAmount"')));
    assert.ok(decisions.some((f) => f.includes('name="settlementId" value="2"') && f.includes('سبب الرفض')));
    const confirm = decisions.find((f) => f.includes('name="settlementId" value="3"') && f.includes('name="transferAmount"')); assert.ok(confirm);
    const confirmData = hidden(confirm);
    for (const [name, value] of Object.entries({ requestId: randomUUID(), settlementId: "2", expectedBalance: "0", transferAmount: "10", transferDirection: "TO_VAULT", reason: "اعتماد اختبار", actuallyTransferred: "yes" })) confirmData.set(name, value);
    const confirmPost = await fetch(`${base}/finance/transfers`, { method: "POST", headers: { cookie: accountant, origin: base }, body: confirmData });
    assert.ok((await confirmPost.text()).includes("العهدة مقفلة؛ لا يمكن إنشاء أو اعتماد تسوية عليها"));
    const closedHistory = await get("/finance/settlements", staffClosed);
    assert.ok(closedHistory.includes("سجل الطلبات"));
    const closedCancel = forms(closedHistory).find((f) => f.includes('name="settlementId" value="2"')); assert.ok(closedCancel);
    const closedCancelData = hidden(closedCancel); closedCancelData.set("requestId", randomUUID()); closedCancelData.set("reason", "إلغاء تسوية مقفلة");
    assert.ok((await (await fetch(`${base}/finance/settlements`, { method: "POST", headers: { cookie: staffClosed, origin: base }, body: closedCancelData })).text()).includes("أُلغي طلب التسوية، بلا أي أثر على النقد"));
    const settlementPage = await get("/finance/settlements", staff);
    const cancel = forms(settlementPage).find((f) => f.includes('name="settlementId"')); assert.ok(cancel);
    assert.ok(cancel.includes('name="reason"'), "cancellation form must submit its reason");
    const data = hidden(cancel); data.set("requestId", randomUUID()); data.set("reason", "سبب اختبار إلغاء التسوية");
    const response = await fetch(`${base}/finance/settlements`, { method: "POST", headers: { cookie: staff, origin: base }, body: data });
    assert.match(await response.text(), /أُلغي طلب التسوية، بلا أي أثر على النقد/);
    assert.ok(!(await get("/finance/settlements", staff)).includes('name="settlementId"'), "cancelled request remains open");
    const staffClosedNoRequest = await login("staff-closed-no-request@selahtone.local");
    const eligibleClosedPage = await get("/finance/mine", staffClosedNoRequest);
    assert.ok(eligibleClosedPage.includes("تقديمه لا يفتح عهدة"));
    assert.ok(eligibleClosedPage.includes("القيد الحالي قد يمنع اعتماد عهدة بديلة"));
    const closedRequestForm = forms(eligibleClosedPage).find(f => f.includes('name="amount"') && f.includes('name="reason"')); assert.ok(closedRequestForm);
    const closedRequestData = hidden(closedRequestForm); closedRequestData.set("requestId", randomUUID()); closedRequestData.set("amount", "25"); closedRequestData.set("reason", "CLOSEDNEWREQUESTCANARY");
    assert.match(await (await fetch(`${base}/finance/mine`, { method: "POST", headers: { cookie: staffClosedNoRequest, origin: base }, body: closedRequestData })).text(), /سُجّل طلب العهدة/);
    const pendingClosedPage = await get("/finance/mine", staffClosedNoRequest);
    assert.ok(pendingClosedPage.includes("لديك طلب عهدة معلّق"));
    assert.ok(!forms(pendingClosedPage).some(f => f.includes('name="amount"') && f.includes('name="reason"')));
    assert.ok((await get("/finance/accounts", admin)).includes("CLOSEDNEWREQUESTCANARY"));
    const allDecisions = forms(await get("/finance/accounts", admin));
    const decision1 = allDecisions.find((f) => f.includes('name="requestDbId" value="1"'));
    const decision2 = allDecisions.find((f) => f.includes('name="requestDbId" value="2"'));
    const decision3 = allDecisions.find((f) => f.includes('name="requestDbId" value="3"')); assert.ok(decision1); assert.ok(decision2); assert.ok(decision3);
    const decision4 = allDecisions.find((f) => f.includes('name="requestDbId" value="4"')); assert.ok(decision4);
    const decision5 = allDecisions.find((f) => f.includes('name="requestDbId" value="5"')); assert.ok(decision5);
    const decision6 = allDecisions.find((f) => f.includes('name="requestDbId" value="6"')); assert.ok(decision6);
    const decision7 = allDecisions.find((f) => f.includes('name="requestDbId" value="7"')); assert.ok(decision7);
    const decision8 = allDecisions.find((f) => f.includes('name="requestDbId" value="8"')); assert.ok(decision8);
    assert.ok(decision7.includes("موظف طلب موقوف اصطناعي"));
    assert.ok(decision7.includes("مقدم الطلب غير نشط أو ليس في فرع الطلب"));
    assert.ok(decision6.includes("موظف فرع متوقف"));
    assert.ok(decision6.includes("فرع متوقف اصطناعي"));
    assert.ok(decision6.includes("فرع غير نشط"));
    assert.ok(decision6.includes("فرع الطلب غير نشط أو تعذّر التحقق منه"));
    assert.ok(decision6.includes("يظل الرفض بسبب متاحًا"));
    assert.ok(decision4.includes("توجد عهدة مسجّلة لهذا الموظف في فرع الطلب"));
    assert.ok(decision5.includes("توجد عهدة مسجّلة لهذا الموظف في فرع الطلب"));
    assert.ok(decision5.includes("يظل رفض الطلب بسبب متاحًا"));
    assert.ok(decision8.includes("توجد عهدة مسجّلة لهذا الموظف في فرع الطلب"));
    assert.ok(!decision1.includes("توجد عهدة مسجّلة لهذا الموظف في فرع الطلب"));
    const branchTwoForms = forms(await get("/finance/accounts", accountantBranchTwo));
    assert.ok(!branchTwoForms.some(f => f.includes("CLOSEDCUSTODYREQUESTCANARY") || f.includes("CLOSEDNEWREQUESTCANARY")));
    assert.ok(!branchTwoForms.some(f => f.includes("توجد عهدة مسجّلة لهذا الموظف في فرع الطلب")));
    async function decide(cookie: string, form: string, decision: "APPROVE" | "REJECT", overrideDate?: string) {
      const data = hidden(form); data.set("requestId", randomUUID()); data.set("decision", decision); data.set("reason", "اختبار قرار اصطناعي"); data.set("counted", "yes");
      if (overrideDate !== undefined) data.set("openingDate", overrideDate);
      return (await fetch(`${base}/finance/accounts`, { method: "POST", headers: { cookie, origin: base }, body: data })).text();
    }
    assert.match(await decide(admin, decision6, "APPROVE"), /الفرع غير موجود أو غير نشط/);
    assert.ok((await get("/finance/accounts", admin)).includes("INACTIVEREQUESTCANARY"));
    assert.match(await decide(admin, decision6, "REJECT", ""), /رُفض طلب العهدة بسبب مدوّن/);
    assert.ok(!(await get("/finance/accounts", admin)).includes("INACTIVEREQUESTCANARY"));
    assert.match(await decide(accountant, decision7, "APPROVE"), /مقدم الطلب غير نشط أو لم يعد في فرع الطلب/);
    assert.match(await decide(accountant, decision7, "REJECT", ""), /رُفض طلب العهدة بسبب مدوّن/);
    const duplicateResponse = await decide(accountant, decision4, "APPROVE");
    assert.match(duplicateResponse, /تعارض قيد/);
    assert.ok((await get("/finance/accounts", admin)).includes("CLOSEDCUSTODYREQUESTCANARY"));
    assert.match(await decide(accountant, decision4, "REJECT", ""), /رُفض طلب العهدة بسبب مدوّن/);
    assert.ok(!(await get("/finance/accounts", admin)).includes("CLOSEDCUSTODYREQUESTCANARY"));
    for (const operation of ["APPROVE", "REJECT"] as const) {
      assert.match(await decide(accountantNoBranch, decision1, operation), /البتّ في طلب العهدة متاح للمحاسب في فرعه فقط/);
      assert.match(await decide(accountant, decision2, operation), /البتّ في طلب العهدة متاح للمحاسب في فرعه فقط/);
      assert.match(await decide(accountantBranchTwo, decision1, operation), /البتّ في طلب العهدة متاح للمحاسب في فرعه فقط/);
    }
    await save("role", "ACCOUNTANT", "/finance/accounts#decide-custody", "deny");
    await save("user", "2", "/finance/accounts#decide-custody", "allow");
    assert.match(await decide(accountant, decision2, "REJECT"), /البتّ في طلب العهدة متاح للمحاسب في فرعه فقط/, "allow override must not bypass branch scope");
    await save("user", "2", "/finance/accounts#decide-custody", "inherit");
    await save("role", "ACCOUNTANT", "/finance/accounts#decide-custody", "inherit");
    assert.ok((await get("/finance/accounts", admin)).includes("CUSTODYCANARY"));
    assert.ok((await get("/finance/accounts", admin)).includes("BRANCH2CANARY"));
    const staleFormData = hidden(decision3); staleFormData.set("requestId", randomUUID()); staleFormData.set("decision", "APPROVE"); staleFormData.set("reason", "اعتماد من عرض قديم"); staleFormData.set("counted", "yes"); staleFormData.set("expectedSnapshot", "0".repeat(64));
    assert.match(await (await fetch(`${base}/finance/accounts`, { method: "POST", headers: { cookie: accountantBranchTwo, origin: base }, body: staleFormData })).text(), /تغيّر طلب العهدة منذ عرضه/);
    staleFormData.set("requestId", randomUUID()); staleFormData.delete("expectedSnapshot");
    assert.match(await (await fetch(`${base}/finance/accounts`, { method: "POST", headers: { cookie: accountantBranchTwo, origin: base }, body: staleFormData })).text(), /بيانات الطلب المعروضة غير مكتملة/);
    assert.ok((await get("/finance/accounts", admin)).includes("BRANCH2APPROVECANARY"));
    assert.match(await decide(accountantBranchTwo, decision3, "APPROVE", "2999-01-01"), /بتاريخ مستقبلي/);
    assert.ok((await get("/finance/accounts", admin)).includes("BRANCH2APPROVECANARY"));
    assert.match(await decide(accountantBranchTwo, decision3, "APPROVE"), /اعتُمد طلب العهدة وفُتحت العهدة/);
    assert.ok(!(await get("/finance/accounts", admin)).includes("BRANCH2APPROVECANARY"));
    assert.match(await decide(accountant, decision1, "REJECT", ""), /رُفض طلب العهدة بسبب مدوّن/);
    assert.ok(!(await get("/finance/accounts", admin)).includes("CUSTODYCANARY"));
    assert.match(await decide(admin, decision2, "APPROVE"), /اعتُمد طلب العهدة وفُتحت العهدة/);
    assert.ok(!(await get("/finance/accounts", admin)).includes("BRANCH2CANARY"));
  } catch (error) { throw new Error(`staff finance HTTP test failed: ${String(error)}; server log tail:\n${logs}`, { cause: error }); }
  finally {
    if (child && child.exitCode === null) {
      const exited = new Promise<void>((resolve) => child!.once("exit", () => resolve())); child.kill("SIGTERM");
      await Promise.race([exited, new Promise<void>((resolve) => { setTimeout(resolve, 5000).unref(); })]);
      if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; }
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test("accountant dashboard distinguishes a failed finance summary from zero", { timeout: 90_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "selahtone-finance-summary-failure-"));
  let child: ChildProcess | undefined; let logs = "";
  try {
    execFileSync(process.execPath, [join(root, "scripts/local-pglite-preview.cjs")], { cwd: root, env: { ...process.env, PREVIEW_PGLITE_DIR: dir, PREVIEW_PASSWORD: password }, stdio: "pipe", timeout: 60_000 });
    const db = new PGlite(dir);
    try {
      await db.exec(readFileSync(join(root, "prisma/manual-access-control-upgrade.sql"), "utf8"));
      await db.exec("SET selahtone.finance_release_candidate_test_only='yes'");
      for (const file of ["prototypes/finance-release/release-candidate.test-only.sql", "prisma/manual-settlement-upgrade.sql", "prisma/manual-custody-closure-upgrade.sql", "prisma/manual-custody-and-count-requests.sql"]) await db.exec(readFileSync(join(root, file), "utf8"));
      // Deliberately break a column used by the summary, in this disposable DB only.
      await db.exec("ALTER TABLE finance.accounts RENAME COLUMN opening_amount TO synthetic_missing_opening_amount");
    } finally { await db.close(); }
    const port = await reservePort(); const base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
      cwd: root, env: { ...process.env, DATABASE_URL: "", PRISMA_PGLITE_DIR: dir, AUTH_SECRET: secret, FINANCE_ENABLED: "true", INVENTORY_ENABLED: "true", ADMIN_EMAILS: "manager@selahtone.local" }, stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", data => { logs = (logs + data).slice(-24000); });
    child.stderr?.on("data", data => { logs = (logs + data).slice(-24000); });
    await waitForServer(base, child);
    const form = forms(await (await fetch(`${base}/login?next=%2Fadmin`)).text())[0]; assert.ok(form);
    const data = hidden(form); data.set("email", "accountant@selahtone.local"); data.set("password", password);
    const loginResponse = await fetch(`${base}/login?next=%2Fadmin`, { method: "POST", headers: { origin: base }, body: data, redirect: "manual" });
    assert.equal(loginResponse.status, 303);
    const cookie = loginResponse.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
    const response = await fetch(`${base}/dashboard`, { headers: { cookie }, redirect: "manual" });
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(logs, /dashboard: cash summary failed/, "the summary query must actually fail");
    assert.match(logs, /dashboard: finance spotlights failed/, "derived finance inputs must actually fail");
    assert.ok(html.includes("بعض مؤشرات الكفاءة والربحية المركبة غير متاحة"));
    assert.ok(!html.includes("مؤشر الكفاءة التشغيلية الشامل"));
    assert.ok(!html.includes("مؤشر تقييم وكفاءة الفروع"));
    assert.ok(!html.includes("الربحية وصافي التشغيل"));
    assert.ok(!html.includes('id="governance-slide-title"'));
    assert.match(html, /مهام تنتظر التنفيذ<\/span><span class="stat-grid__value">—<\/span>/);
    assert.ok(html.includes("ملخص المهام المالية غير متاح"));
    assert.ok(!html.includes("كل شيء محدّث ومعتمد"));
  } catch (error) { throw new Error(`synthetic summary failure test: ${String(error)}; server log tail:\n${logs}`, { cause: error }); }
  finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>(resolve => child!.once("exit", () => resolve())); child.kill("SIGTERM");
      await Promise.race([exited, new Promise<void>(resolve => { setTimeout(resolve, 5000).unref(); })]);
      if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; }
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test("disabled finance is identified on accountant dashboard", { timeout: 90_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "selahtone-finance-disabled-"));
  let child: ChildProcess | undefined; let logs = "";
  try {
    execFileSync(process.execPath, [join(root, "scripts/local-pglite-preview.cjs")], { cwd: root, env: { ...process.env, PREVIEW_PGLITE_DIR: dir, PREVIEW_PASSWORD: password }, stdio: "pipe", timeout: 60_000 });
    const db = new PGlite(dir);
    try { await db.exec(readFileSync(join(root, "prisma/manual-access-control-upgrade.sql"), "utf8")); } finally { await db.close(); }
    const port = await reservePort(); const base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
      cwd: root, env: { ...process.env, DATABASE_URL: "", PRISMA_PGLITE_DIR: dir, AUTH_SECRET: secret, FINANCE_ENABLED: "false", INVENTORY_ENABLED: "true", ADMIN_EMAILS: "manager@selahtone.local" }, stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", data => { logs = (logs + data).slice(-16000); });
    child.stderr?.on("data", data => { logs = (logs + data).slice(-16000); });
    await waitForServer(base, child);
    const form = forms(await (await fetch(`${base}/login?next=%2Fadmin`)).text())[0]; assert.ok(form);
    const data = hidden(form); data.set("email", "accountant@selahtone.local"); data.set("password", password);
    const loginResponse = await fetch(`${base}/login?next=%2Fadmin`, { method: "POST", headers: { origin: base }, body: data, redirect: "manual" });
    assert.equal(loginResponse.status, 303);
    const cookie = loginResponse.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
    const response = await fetch(`${base}/dashboard`, { headers: { cookie }, redirect: "manual" });
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /مهام تنتظر التنفيذ<\/span><span class="stat-grid__value">—<\/span>/);
    assert.ok(html.includes("المالية غير مفعّلة؛ لا تتوفر مهامها هنا."));
    assert.ok(html.includes("بعض مؤشرات الكفاءة والربحية المركبة غير متاحة"));
    assert.ok(!html.includes("مؤشر الكفاءة التشغيلية الشامل"));
    assert.ok(!html.includes("الربحية وصافي التشغيل"));
    assert.ok(!html.includes('id="governance-slide-title"'));
    assert.ok(!html.includes("ملخص المهام المالية غير متاح"));
  } catch (error) { throw new Error(`disabled finance test: ${String(error)}; server log tail:\n${logs}`, { cause: error }); }
  finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>(resolve => child!.once("exit", () => resolve())); child.kill("SIGTERM");
      await Promise.race([exited, new Promise<void>(resolve => { setTimeout(resolve, 5000).unref(); })]);
      if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; }
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test("custody balances on the dashboard respect their source pages", { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "selahtone-custody-dashboard-access-"));
  let child: ChildProcess | undefined; let logs = "";
  try {
    execFileSync(process.execPath, [join(root, "scripts/local-pglite-preview.cjs")], { cwd: root, env: { ...process.env, PREVIEW_PGLITE_DIR: dir, PREVIEW_PASSWORD: password }, stdio: "pipe", timeout: 60_000 });
    const db = new PGlite(dir);
    try {
      await db.exec(readFileSync(join(root, "prisma/manual-access-control-upgrade.sql"), "utf8"));
      await db.exec("SET selahtone.finance_release_candidate_test_only='yes'");
      for (const file of ["prototypes/finance-release/release-candidate.test-only.sql", "prisma/manual-settlement-upgrade.sql", "prisma/manual-custody-closure-upgrade.sql", "prisma/manual-custody-and-count-requests.sql"]) await db.exec(readFileSync(join(root, file), "utf8"));
      await db.exec(`INSERT INTO finance.accounts (branch_id,kind,holder_id,opening_amount,opening_date,opened_by) VALUES (1,'CUSTODY',3,73182,CURRENT_DATE,1);
        INSERT INTO finance.settlements (account_id,branch_id,requested_by,system_balance,counted_amount,sales_total,expenses_total,expected_amount,deviation,adjustment,reason)
        SELECT id,1,3,73182,73183,0,0,73182,1,1,'SYNTHETIC_VARIANCE' FROM finance.accounts WHERE branch_id=1 AND kind='CUSTODY' AND holder_id=3;
        INSERT INTO branches(id,code,name_ar,invoice_prefix,opening_date,is_active,created_at) VALUES (99,'CLEAN99','فرع اصطناعي خال','CL99',CURRENT_DATE,true,now());
        INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
        SELECT 99,99,role_code,'محاسب فرع اصطناعي','clean-accountant@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=2;
        INSERT INTO finance.expenses(branch_id,category_id,category_snapshot,amount,expense_date,description,status,requested_by,approved_by,approved_at)
        SELECT 99,id,'مصروف نطاق اصطناعي',4242,CURRENT_DATE,'تمييز نطاق الربحية','APPROVED',99,1,now() FROM public.expense_categories LIMIT 1;`);
    } finally { await db.close(); }
    const port = await reservePort(); const base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
      cwd: root, env: { ...process.env, DATABASE_URL: "", PRISMA_PGLITE_DIR: dir, AUTH_SECRET: secret, FINANCE_ENABLED: "true", INVENTORY_ENABLED: "true", ADMIN_EMAILS: "manager@selahtone.local" }, stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", data => { logs = (logs + data).slice(-16000); });
    child.stderr?.on("data", data => { logs = (logs + data).slice(-16000); });
    await waitForServer(base, child);
    async function get(path: string, cookie: string) {
      const response = await fetch(`${base}${path}`, { headers: { cookie }, redirect: "manual" });
      assert.equal(response.status, 200); return response.text();
    }
    async function login(email: string) {
      const form = forms(await (await fetch(`${base}/login?next=%2Fadmin`)).text())[0]; assert.ok(form);
      const data = hidden(form); data.set("email", email); data.set("password", password);
      const response = await fetch(`${base}/login?next=%2Fadmin`, { method: "POST", headers: { origin: base }, body: data, redirect: "manual" });
      assert.equal(response.status, 303); return response.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
    }
    const admin = await login("manager@selahtone.local"), employee = await login("arh@selahtone.local"), accountant = await login("accountant@selahtone.local");
    async function save(subject: string, key: string, value: "deny" | "inherit") {
      const form = forms(await get("/admin", admin)).find(entry => entry.includes('name="kind"')); assert.ok(form);
      const data = hidden(form); for (const [name, val] of Object.entries({ kind: "user", subject, key, value })) data.set(name, val);
      assert.match(await (await fetch(`${base}/admin`, { method: "POST", headers: { cookie: admin, origin: base }, body: data })).text(), /حُفظت الصلاحية/);
    }
    const allowed = await get("/dashboard?section=all", employee);
    assert.ok(allowed.includes("73,182"), "synthetic employee balance must be visible when allowed");
    assert.ok(allowed.includes("مؤشر الكفاءة التشغيلية الشامل"));
    await save("3", "/finance/mine", "deny");
    const denied = await get("/dashboard?section=all", employee);
    assert.ok(!denied.includes("73,182"), "balance must not appear in rendered HTML or serialized slots");
    assert.ok(!denied.includes('id="cash-title"'));
    assert.ok(!denied.includes("مؤشر الكفاءة التشغيلية الشامل"));
    assert.ok(!denied.includes("مؤشر تقييم وكفاءة الفروع"));
    await save("3", "/finance/mine", "inherit");
    const accountantAllowed = await get("/dashboard?section=all", accountant);
    assert.ok(accountantAllowed.includes('id="summary-title"'));
    assert.ok(accountantAllowed.includes("مؤشر الكفاءة التشغيلية الشامل"));
    assert.ok(accountantAllowed.includes("مؤشر تقييم وكفاءة الفروع"));
    assert.ok(accountantAllowed.includes("الربحية وصافي التشغيل"));
    assert.ok(accountantAllowed.includes("طلب تسوية مفتوح أو تسوية مؤكدة هذا الشهر بفارق مسجّل"));
    assert.ok(accountantAllowed.includes("لا يثبت النقد الفعلي"));
    assert.ok(!accountantAllowed.includes("بفرق جرد فعلي هذا الشهر"));
    const cleanAccountant = await login("clean-accountant@selahtone.local");
    const cleanDashboard = await get("/dashboard?section=all&branch=99", cleanAccountant);
    assert.ok(cleanDashboard.includes("لا يثبت ذلك سلامة جميع العمليات أو النقد"));
    assert.ok(cleanDashboard.includes("فحوص المبيعات والتسويات ضمن نطاق اللوحة المعروض"));
    assert.ok(cleanDashboard.includes("مؤشر الكفاءة التشغيلية الشامل"));
    assert.ok(cleanDashboard.includes("مؤشر تقييم وكفاءة الفروع"));
    assert.ok(cleanDashboard.includes("الربحية وصافي التشغيل"));
    assert.ok(cleanDashboard.includes("4,242"), "synthetic branch expense is present in the aligned scope");
    const mixedScopeDashboard = await get("/dashboard?section=all", cleanAccountant);
    assert.ok(mixedScopeDashboard.includes("تنبيهات التسويات ضمن فرع حسابك، بينما فحوص المبيعات ضمن نطاق اللوحة المختار"));
    assert.ok(mixedScopeDashboard.includes("ملخصات العهد والمصروفات الشهرية المالية تخص فرع حسابك"));
    assert.ok(!mixedScopeDashboard.includes("مؤشر الكفاءة التشغيلية الشامل"));
    assert.ok(!mixedScopeDashboard.includes("مؤشر تقييم وكفاءة الفروع"));
    assert.ok(!mixedScopeDashboard.includes("الربحية وصافي التشغيل"));
    const otherBranchDashboard = await get("/dashboard?section=all&branch=1", cleanAccountant);
    assert.ok(otherBranchDashboard.includes("ملخصات العهد والمصروفات الشهرية المالية تخص فرع حسابك"));
    assert.ok(!otherBranchDashboard.includes("الربحية وصافي التشغيل"));
    assert.ok(!otherBranchDashboard.includes("مؤشر الكفاءة التشغيلية الشامل"));
    assert.ok(!accountantAllowed.includes("ضوابط التشغيل سليمة اليوم"));
    assert.ok(cleanDashboard.includes("مسجّل مدفوعًا"));
    assert.ok(!accountantAllowed.includes("جميع مصروفات الشهر مسدّدة"));
    await save("2", "/finance/expenses", "deny");
    const restrictedExpenses = await get("/dashboard?section=all", accountant);
    assert.ok(restrictedExpenses.includes("بعض مؤشرات الكفاءة والربحية المركبة غير متاحة"));
    assert.ok(!restrictedExpenses.includes("مؤشر الكفاءة التشغيلية الشامل"));
    assert.ok(!restrictedExpenses.includes("مؤشر تقييم وكفاءة الفروع"));
    assert.ok(!restrictedExpenses.includes("الربحية وصافي التشغيل"));
    await save("2", "/finance/expenses", "inherit");
    await save("2", "/finance/transfers", "deny");
    const restrictedSettlements = await get("/dashboard?section=all", accountant);
    assert.ok(!restrictedSettlements.includes('id="governance-slide-title"'));
    assert.ok(!restrictedSettlements.includes("مؤشر الكفاءة التشغيلية الشامل"));
    assert.ok(restrictedSettlements.includes("الربحية وصافي التشغيل"), "profitability does not depend on settlement access");
    await save("2", "/finance/transfers", "inherit");
    await save("2", "/finance", "deny");
    const deniedSummary = await get("/dashboard?section=all", accountant);
    assert.ok(!deniedSummary.includes('id="summary-title"'));
    assert.ok(!deniedSummary.includes("الميزان النقدي"));
    assert.ok(deniedSummary.includes("73,182"), "independently permitted settlement activity remains visible");
    await save("2", "/finance", "inherit");
    await save("2", "/finance/accounts", "deny");
    const deniedAccounts = await get("/dashboard?section=all", accountant);
    assert.ok(deniedAccounts.includes('id="summary-title"'), "independent finance summary permission remains usable");
    assert.ok(!deniedAccounts.includes("الميزان النقدي"), "account-derived spotlight is hidden");
  } catch (error) { throw new Error(`custody dashboard permission test: ${String(error)}; server log tail:\n${logs}`, { cause: error }); }
  finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>(resolve => child!.once("exit", () => resolve())); child.kill("SIGTERM");
      await Promise.race([exited, new Promise<void>(resolve => { setTimeout(resolve, 5000).unref(); })]);
      if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; }
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
