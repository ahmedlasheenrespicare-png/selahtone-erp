/** Disposable end-to-end authorization test. Never connects to DATABASE_URL. */
import assert from "node:assert/strict";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
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

// This runs only with a disposable synthetic PGlite directory and a private loopback server.
for (const section of ["sales-collect-permission", "finance", "dashboard", "boundary", "holder-correction", "stale-settlement", "settlement-branch-mismatch", "settlement-confirm-prereqs", "settlement-closed-vault", "flow-failure", "flow-scope", "flow-disabled", "branch-name-collision", "branchless-expenses"] as const) test(`finance access HTTP: ${section}`, { timeout: 240_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "selahtone-finance-access-http-"));
  let child: ChildProcess | undefined;
  let logs = "";
  try {
    execFileSync(process.execPath, [join(root, "scripts/local-pglite-preview.cjs")], {
      cwd: root, env: { ...process.env, PREVIEW_PGLITE_DIR: dir, PREVIEW_PASSWORD: password }, stdio: "pipe", timeout: 60_000,
    });
    const db = new PGlite(dir);
    try {
      await db.exec(readFileSync(join(root, "prisma/manual-access-control-upgrade.sql"), "utf8"));
      await db.exec("SET selahtone.finance_release_candidate_test_only='yes'");
      for (const file of ["prototypes/finance-release/release-candidate.test-only.sql", "prisma/manual-settlement-upgrade.sql", "prisma/manual-custody-closure-upgrade.sql", "prisma/manual-custody-and-count-requests.sql"]) {
        await db.exec(readFileSync(join(root, file), "utf8"));
      }
      await db.exec(`UPDATE public.users SET can_cancel_sales = true WHERE id = 2;
        INSERT INTO finance.accounts (branch_id,kind,holder_id,opening_amount,opening_date,opened_by)
        VALUES (1,'VAULT',NULL,98765.43,DATE '2020-02-01',1),(1,'CUSTODY',3,10,CURRENT_DATE,1);
        INSERT INTO public.users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
        SELECT 4,1,'CS_AGENT','CLOSEDCASHCANARY','closed-cash@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3;
        INSERT INTO finance.accounts (branch_id,kind,holder_id,opening_amount,opening_date,opened_by,closed_at,closed_by)
        VALUES (1,'CUSTODY',4,0,CURRENT_DATE,1,now(),1);
        INSERT INTO finance.accounts (branch_id,kind,holder_id,opening_amount,opening_date,opened_by)
        VALUES (1,'CUSTODY',1,0,CURRENT_DATE,1);
        UPDATE commerce_sales SET created_by_id=4,total=9000 WHERE id=9;
        INSERT INTO finance.settlements (account_id,branch_id,requested_by,system_balance,counted_amount,sales_total,expenses_total,expected_amount,deviation,adjustment,reason)
        VALUES (2,1,3,10,10,0,0,10,0,0,'طلب اختبار اصطناعي'),(4,1,1,0,0,0,0,0,0,0,'طلب إقفال النقد التجريبي');
        INSERT INTO finance.cash_counts (account_id,counted_amount,observed_balance,difference,account_revision,counted_on,reason,created_by)
        VALUES (1,1000,1000,0,0,CURRENT_DATE,'جرد اختبار اصطناعي',2);
        UPDATE commerce_refunds SET amount=21900 WHERE id=10;
        UPDATE commerce_sales SET customer_name = 'SENSITIVECLIENTCANARY' || id::text,
          customer_phone = '0115550000' || id::text, created_at = now() WHERE id IN (1,2,3);`);
      if (section === "sales-collect-permission") {
        await db.exec(`INSERT INTO users(id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
          SELECT 5,branch_id,role_code,'محاسب اصطناعي آخر','collect-other@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=2`);
      }
      if (section === "branchless-expenses") {
        await db.exec(`INSERT INTO public.users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
          SELECT 5,NULL,'CS_AGENT','موظف بلا فرع','no-branch@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3;
          INSERT INTO finance.expenses(branch_id,category_id,category_snapshot,amount,expense_date,description,status,requested_by) VALUES
          (1,1,'بند اصطناعي',111.11,(now() AT TIME ZONE 'Africa/Cairo')::date,'BRANCHONEEXPENSECANARY','PENDING',3),
          (2,1,'بند اصطناعي',222.22,(now() AT TIME ZONE 'Africa/Cairo')::date,'BRANCHTWOEXPENSECANARY','PENDING',3);`);
      }
      if (section === "branch-name-collision") {
        await db.exec(`UPDATE branches SET name_ar='فرع متطابق' WHERE id IN (1,2);
          UPDATE commerce_collections SET created_at='2020-01-01T00:00:00Z';
          INSERT INTO public.users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
          SELECT 5,2,'CS_AGENT','حامل اختبار','same-name-custody@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3;
          INSERT INTO finance.accounts(branch_id,kind,holder_id,opening_amount,opening_date,opened_by) VALUES
          (2,'VAULT',NULL,22222.22,CURRENT_DATE,1),(2,'CUSTODY',5,33333.33,CURRENT_DATE,1);
          INSERT INTO finance.expenses(branch_id,category_id,category_snapshot,amount,expense_date,description,status,requested_by) VALUES
          (1,1,'بند اصطناعي',111.11,CURRENT_DATE,'مصروف فرع أول','PENDING',3),
          (2,1,'بند اصطناعي',222.22,CURRENT_DATE,'مصروف فرع ثان','PENDING',5);`);
      }
      if (section === "flow-scope") {
        await db.exec(`UPDATE commerce_collections SET created_at='2020-01-01T00:00:00Z' WHERE method='WALLET';
          UPDATE commerce_sales SET cancelled_at=now() WHERE id=9;
          INSERT INTO commerce_collections(request_id,request_hash,sale_id,amount,method,is_initial,created_by_id,created_at) VALUES
          ('a1111111-1111-4111-8111-111111111111',repeat('a',64),9,123456.78,'WALLET',false,3,now()),
          ('b1111111-1111-4111-8111-111111111111',repeat('b',64),9,654321.09,'WALLET',false,4,now());`);
      }
      if (section === "flow-failure") {
        await db.exec("ALTER TABLE finance.expense_corrections RENAME TO expense_corrections_unavailable");
      }
      if (section === "finance" || section === "stale-settlement") {
        // Valid matching snapshots are needed for the live confirm form.
        // The stale scenario explicitly removes one revision afterward.
        await db.exec(`UPDATE finance.accounts SET opened_at=now()-interval '2 days' WHERE id IN (2,4);
          UPDATE finance.settlements st SET account_revision=a.revision,created_at=now()+interval '1 day'
          FROM finance.accounts a WHERE st.account_id=a.id;
          UPDATE finance.settlements SET account_revision=NULL WHERE id=1;`);
      }
      if (section === "settlement-branch-mismatch") {
        await db.exec(`UPDATE finance.accounts SET opened_at=now()-interval '2 days' WHERE id IN (2,4);
          UPDATE finance.settlements st SET account_revision=a.revision,created_at=now()+interval '1 day'
          FROM finance.accounts a WHERE st.account_id=a.id;
          UPDATE finance.settlements SET branch_id=2 WHERE id=1;`);
      }
      if (section === "settlement-confirm-prereqs" || section === "settlement-closed-vault") {
        await db.exec(`INSERT INTO branches (id,code,name_ar,invoice_prefix,is_active) VALUES (100,'X3','فرع اصطناعي موقوف','X3',false);
          INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
          SELECT 5,2,'CS_AGENT','موظف اختبار','p5@test.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3;
          INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
          SELECT 6,100,'CS_AGENT','موظف اختبار','p6@test.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3;
          INSERT INTO finance.accounts(branch_id,kind,holder_id,opening_amount,opening_date,opened_by) VALUES
          (2,'CUSTODY',5,0,CURRENT_DATE,1),(100,'CUSTODY',6,0,CURRENT_DATE,1),(100,'VAULT',NULL,0,CURRENT_DATE,1);
          ${section === "settlement-closed-vault" ? "INSERT INTO finance.accounts(branch_id,kind,holder_id,opening_amount,opening_date,opened_by) VALUES (2,'VAULT',NULL,0,CURRENT_DATE,1); UPDATE finance.accounts SET closed_at=now(),closed_by=1 WHERE id=1;" : ""}
          UPDATE finance.accounts SET opened_at=now()-interval '2 days' WHERE closed_at IS NULL;
          INSERT INTO finance.settlements(account_id,branch_id,requested_by,system_balance,counted_amount,sales_total,expenses_total,expected_amount,deviation,adjustment,reason)
          VALUES (5,2,5,0,0,0,0,0,0,0,'NO_VAULT_CANARY'),(6,100,6,0,0,0,0,0,0,0,'INACTIVE_BRANCH_CANARY');
          UPDATE finance.settlements st SET account_revision=a.revision,created_at=now()+interval '1 day'
          FROM finance.accounts a WHERE st.account_id=a.id;`);
      }
      if (section === "holder-correction") {
        await db.exec(`UPDATE finance.accounts SET opened_at=now()-interval '1 day' WHERE id IN (2,4);
          INSERT INTO finance.expenses(branch_id,category_id,category_snapshot,amount,expense_date,description,status,requested_by,approved_by,approved_at)
          VALUES (1,1,'اختبار',10,CURRENT_DATE,'تصحيح اصطناعي','PAID',3,1,now());
          INSERT INTO finance.payments(expense_id,amount,method,source,account_id,payment_date,recorded_by,actually_paid)
          SELECT id,10,'CASH','HOLDER_CASH',NULL,CURRENT_DATE,3,true FROM finance.expenses WHERE description='تصحيح اصطناعي';
          INSERT INTO finance.expense_reviews(expense_id,expense_revision,reason,original_snapshot,status,created_by,resolved_by,resolved_at,resolution_reason)
          SELECT id,1,'مراجعة اصطناعية','{}','CORRECTED',1,2,now(),'تصحيح اصطناعي' FROM finance.expenses WHERE description='تصحيح اصطناعي';
          INSERT INTO finance.expense_corrections(expense_id,payment_id,review_id,before_amount,after_amount,reason,created_by)
          SELECT e.id,p.id,r.id,10,6,'تصحيح قديم اصطناعي',2 FROM finance.expenses e
            JOIN finance.payments p ON p.expense_id=e.id JOIN finance.expense_reviews r ON r.expense_id=e.id
          WHERE e.description='تصحيح اصطناعي';
          UPDATE finance.settlements st SET account_revision=a.revision,created_at=now()+interval '1 second'
          FROM finance.accounts a WHERE st.account_id=a.id;`);
      }
      if (section === "boundary") {
        const changed = await db.query(`UPDATE commerce_collections SET created_at=(SELECT opened_at FROM finance.accounts WHERE id=2)
          WHERE id=(SELECT c.id FROM commerce_collections c JOIN commerce_sales s ON s.id=c.sale_id WHERE s.branch_id=1 AND c.method='CASH' ORDER BY c.id LIMIT 1) RETURNING id`);
        assert.equal(changed.rows.length, 1, "synthetic boundary fixture missing");
      }
    } finally { await db.close(); }

    const port = await reservePort();
    const base = `http://127.0.0.1:${port}`;
    async function startTestServer() {
      child = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
        cwd: root,
        env: { ...process.env, DATABASE_URL: "", PRISMA_PGLITE_DIR: dir, AUTH_SECRET: secret, FINANCE_ENABLED: section === "flow-disabled" ? "false" : "true", INVENTORY_ENABLED: "true", ADMIN_EMAILS: "manager@selahtone.local", NEXT_EXIT_TIMEOUT_MS: "5000" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout?.on("data", (data) => { logs = (logs + data).slice(-16_000); });
      child.stderr?.on("data", (data) => { logs = (logs + data).slice(-16_000); });
      await waitForServer(base, child);
    }
    await startTestServer();

    async function login(email: string): Promise<string> {
      const response = await fetch(`${base}/login?next=%2Fadmin`);
      const form = forms(await response.text())[0];
      assert.ok(form, "login form missing");
      const data = hidden(form);
      data.set("email", email); data.set("password", password);
      const signedIn = await fetch(`${base}/login?next=%2Fadmin`, { method: "POST", headers: { origin: base }, body: data, redirect: "manual" });
      assert.equal(signedIn.status, 303);
      return signedIn.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    }
    const admin = await login("manager@selahtone.local");
    const accountant = await login("accountant@selahtone.local");
    const agent = await login("arh@selahtone.local");
    const closedUser = await login("closed-cash@selahtone.local");
    async function get(path: string, cookie: string) { return (await fetch(`${base}${path}`, { headers: { cookie } })).text(); }
    async function save(key: string, value: "deny" | "allow" | "inherit", kind: "role" | "user" = "role", subject = "ACCOUNTANT"): Promise<void> {
      const form = forms(await get("/admin", admin)).find((entry) => entry.includes('name="kind"'));
      assert.ok(form, "permission form missing");
      const data = hidden(form);
      for (const [name, v] of Object.entries({ kind, subject, key, value })) data.set(name, v);
      const response = await fetch(`${base}/admin`, { method: "POST", headers: { cookie: admin, origin: base }, body: data });
      assert.match(await response.text(), /حُفظت الصلاحية/);
    }
    if (section === "sales-collect-permission") {
      const path = "/sales/2";
      const form = forms(await get(path, accountant)).find(entry => entry.includes("تسجيل تحصيل"));
      assert.ok(form, "capture the allowed action before changing permission");
      const data = hidden(form);
      for (const [key,value] of Object.entries({requestId:randomUUID(),saleId:"2",amount:"1",method:"CARD",reviewed:"yes"})) data.set(key,value);
      const submit = async () => (await fetch(`${base}${path}`, {method:"POST",headers:{cookie:accountant,origin:base},body:data})).text();
      for (const key of ["/sales#collect", "/sales#write"]) {
        await save(key,"deny");
        assert.doesNotMatch(await get(path, accountant),/تسجيل تحصيل/, `${key}: form must be hidden`);
        assert.match(await submit(),/معطّل بالصلاحيات/, `${key}: captured action must be rejected`);
        await save(key,"inherit");
      }
      // Reusing the same request ID demonstrates that denied attempts did not
      // consume it; then permission denial also applies to a stored replay.
      assert.match(await submit(),/تم تسجيل التحصيل/);
      await save("/sales#collect","deny");
      assert.match(await submit(),/معطّل بالصلاحيات/);
      await save("/sales#collect","inherit");
      assert.match(await submit(),/سبق تسجيل هذا التحصيل/);

      const other = await login("collect-other@selahtone.local");
      data.set("requestId",randomUUID());
      await save("/sales#collect","deny","role","ACCOUNTANT");
      await save("/sales#collect","allow","user","2");
      assert.match(await get(path,accountant),/تسجيل تحصيل/, "explicit user allow overrides role deny for this operation");
      assert.doesNotMatch(await get(path,other),/تسجيل تحصيل/, "other accountant retains role denial");
      const otherResult = await fetch(`${base}${path}`, {method:"POST",headers:{cookie:other,origin:base},body:data});
      assert.match(await otherResult.text(),/معطّل بالصلاحيات/, "another user cannot use the captured action");
      await save("/sales#write","deny","role","ACCOUNTANT");
      assert.doesNotMatch(await get(path,accountant),/تسجيل تحصيل/, "action allow cannot override the page write lock");
      assert.match(await submit(),/معطّل بالصلاحيات/);
      await save("/sales#write","inherit","role","ACCOUNTANT");
      assert.match(await submit(),/تم تسجيل التحصيل/, "user exception works only with the parent write lock open");
      await save("/sales#collect","inherit","user","2");
      assert.match(await submit(),/معطّل بالصلاحيات/, "role deny is re-applied to the saved request");
      await save("/sales#collect","inherit","role","ACCOUNTANT");
      assert.match(await submit(),/سبق تسجيل هذا التحصيل/);
    }
    if (section === "branchless-expenses") {
      const branchless = await login("no-branch@selahtone.local");
      const html = await get("/finance/expenses/today", branchless);
      assert.match(html, /مصروفات اليوم/);
      assert.doesNotMatch(html, /BRANCHONEEXPENSECANARY|BRANCHTWOEXPENSECANARY/);
      const adminHtml = await get("/finance/expenses/today", admin);
      assert.match(adminHtml, /BRANCHONEEXPENSECANARY/);
      assert.match(adminHtml, /BRANCHTWOEXPENSECANARY/);
      const staffHtml = await get("/finance/expenses/today", agent);
      assert.match(staffHtml, /BRANCHONEEXPENSECANARY/);
      assert.doesNotMatch(staffHtml, /BRANCHTWOEXPENSECANARY/);
    }
    if (section === "branch-name-collision") {
      const main = await get("/dashboard?section=all", admin);
      const finance = await get("/finance", admin);
      assert.match(finance, /secondaryValue.{0,10}111\.11[\s\S]{0,220}خزنة 98,765\.43 \+ عهدة متوقعة 10\.00/);
      assert.match(finance, /secondaryValue.{0,10}222\.22[\s\S]{0,220}خزنة 22,222\.22 \+ عهدة متوقعة 33,333\.33/);
      const branchCards = main.split('<div class="dashboard-branch-card">');
      const firstCard = branchCards.find((card) => card.includes('<span dir="ltr">ARH</span>'));
      const secondCard = branchCards.find((card) => card.includes('<span dir="ltr">SHM</span>'));
      assert.ok(firstCard && secondCard);
      assert.match(firstCard, /المتوقَّع بالعهدة<\/span><strong><bdi dir="ltr">10<\/bdi>/);
      assert.match(secondCard, /المتوقَّع بالعهدة<\/span><strong><bdi dir="ltr">33,333\.33<\/bdi>/);
      for (const [name, html] of [["dashboard", main], ["finance", finance]] as const) {
        assert.match(html, /فرع متطابق · ARH/, `${name}: first branch must have a distinct code`);
        assert.match(html, /فرع متطابق · SHM/, `${name}: second branch must have a distinct code`);
        assert.match(html, /خزنة 98,765\.43 \+ عهدة متوقعة 10\.00/, `${name}: first branch values must not merge`);
        assert.match(html, /خزنة 22,222\.22 \+ عهدة متوقعة 33,333\.33/, `${name}: second branch values must not merge`);
        if (name === "dashboard") assert.match(html, /111\.11 ج\.م<\/bdi>[\s\S]{0,200}خزنة 98,765\.43 \+ عهدة متوقعة 10\.00/, `${name}: first branch expense must remain separate`);
        if (name === "dashboard") assert.match(html, /222\.22 ج\.م<\/bdi>[\s\S]{0,200}خزنة 22,222\.22 \+ عهدة متوقعة 33,333\.33/, `${name}: second branch expense must remain separate`);
        assert.doesNotMatch(html, /خزنة 120,987\.65 \+ عهدة متوقعة 33,343\.33/, `${name}: duplicate names must not combine balances`);
      }
      const first = main.match(/<span class="stat-grid__label">فرع متطابق<!-- --> · <!-- -->ARH<\/span>[\s\S]*?<\/div>/)?.[0];
      const second = main.match(/<span class="stat-grid__label">فرع متطابق<!-- --> · <!-- -->SHM<\/span>[\s\S]*?<\/div>/)?.[0];
      assert.ok(first && second); assert.match(first, />10<!-- -->/); assert.match(second, /33,333\.33/);
    }
    if (section === "flow-disabled") {
      for (const cookie of [admin, agent, accountant]) {
        const html = await get("/dashboard?section=all", cookie);
        assert.doesNotMatch(html, /الحركات المسجّلة هذا الشهر|تعذّرت قراءة الحركات المسجّلة/, "disabled finance must not serialize the card or its error");
      }
    }
    if (section === "flow-scope") {
      function card(html: string) {
        const match = html.match(/<section class="fin-panel" aria-label="الحركات المسجّلة هذا الشهر">[\s\S]*?<\/section>/);
        assert.ok(match, "recorded flow card missing");
        return match[0];
      }
      const own = card(await get("/dashboard?section=all", agent));
      assert.match(own, /123456\.78/); assert.doesNotMatch(own, /654321\.09/);
      const other = card(await get("/dashboard?section=all", closedUser));
      assert.match(other, /654321\.09/); assert.doesNotMatch(other, /123456\.78/);
      const manager = card(await get("/dashboard?section=all", admin));
      assert.match(manager, /777777\.87/, "management card aggregates both recorders");
      await save("/dashboard#recorded-flow", "deny", "role", "CS_AGENT");
      const denied = await get("/dashboard?section=all", agent);
      assert.doesNotMatch(denied, /الحركات المسجّلة هذا الشهر|123456\.78/, "denial must not serialize scoped card or canary");
      await save("/dashboard#recorded-flow", "allow", "user", "3");
      assert.match(card(await get("/dashboard?section=all", agent)), /123456\.78/, "account allow overrides role deny");
      assert.doesNotMatch(await get("/dashboard?section=all", closedUser), /الحركات المسجّلة هذا الشهر|654321\.09/, "other account remains denied");
      await save("/dashboard#invoice-details", "deny", "role", "CS_AGENT");
      assert.doesNotMatch(await get("/dashboard?section=all", agent), /الحركات المسجّلة هذا الشهر|123456\.78/, "card allow must not override denied source permission");
    }
    if (section === "flow-failure") {
      const dashboard = await get("/dashboard?section=all", accountant);
      assert.match(dashboard, /تعذّرت قراءة الحركات المسجّلة؛ لا تتوفر أرقام موثوقة الآن/);
      assert.doesNotMatch(dashboard, /لا توجد حركات مسجّلة في النطاق خلال الشهر حتى الآن/, "failure must not masquerade as empty data");
      assert.doesNotMatch(dashboard, /صافي النقد المحتفظ به/);
      await save("/dashboard#recorded-flow", "deny");
      const restricted = await get("/dashboard?section=all", accountant);
      assert.doesNotMatch(restricted, /الحركات المسجّلة هذا الشهر|تعذّرت قراءة الحركات المسجّلة/, "restricted actor must not receive data or failure state");
    }
    if (section === "holder-correction") {
      const countsPage = await get("/finance/counts", accountant);
      assert.match(countsPage, /لوجود تصحيح مرتبط بدفع نقد موظف عند حد الفترة أو بعده/);
      assert.match(countsPage, /قد يستمر أثر تصحيح مرتبط بدفع نقد موظف سُجّل قبل حد الفترة/);
      assert.match(countsPage, /الدفع الأقدم وحده لا يفعّل حراسة التصحيح الحالية/);
      const form = forms(countsPage).find(entry => entry.includes('name="actuallyCounted"')); assert.ok(form);
      const payload = hidden(form);
      for (const [key,value] of Object.entries({ requestId: randomUUID(), accountId: "2", expectedBalance: "0", countedAmount: "0", reason: "اختبار تصحيح", actuallyCounted: "yes" })) payload.set(key,value);
      const rejected = await fetch(`${base}/finance/counts`, { method: "POST", headers: { cookie: accountant, origin: base }, body: payload });
      assert.match(await rejected.text(), /يوجد تصحيح مرتبط بدفع نقد موظف/);
      assert.match(await get("/finance", accountant), /بعض مؤشرات العهد غير مؤكدة لوجود تصحيح/);
      assert.match(await get("/dashboard", agent), /بعض مؤشرات العهد غير مؤكدة لوجود تصحيح/);
      const mine = await get("/finance/mine", agent);
      assert.match(mine, /يوجد تصحيح مرتبط بدفع نقد موظف/);
      assert.match(mine, /طلب التسوية المعلق متوقف للمراجعة/);
      assert.doesNotMatch(mine, /لديك طلب تسوية معلق بانتظار اعتماد المدير/);
      const blockedDashboard = await get("/dashboard?section=all", agent);
      assert.match(blockedDashboard, /طلب التسوية المعلق متوقف للمراجعة/);
      assert.doesNotMatch(blockedDashboard, /لديك طلب تسوية معلق بانتظار اعتماد المدير/);
      const newSettlement = await get("/finance/settlements/new", agent);
      assert.match(newSettlement, /يوجد تصحيح مرتبط بدفع نقد موظف/);
      assert.match(newSettlement, /قد يستمر أثر تصحيح مرتبط بدفع نقد موظف سُجّل قبل حد الفترة/);
      assert.ok(!newSettlement.includes('name="countedAmount"'));
      const transfers = await get("/finance/transfers", accountant);
      assert.match(transfers, /يوجد تصحيح مرتبط بدفع نقد موظف عند الحد أو بعده/);
      assert.match(transfers, /السماح بالعملية لا يثبت خلو الأرقام من أثره/);
      const affected = forms(transfers).filter(form => form.includes('name="settlementId" value="1"'));
      assert.ok(affected.some(form => form.includes('aria-label="سبب الرفض"')));
      assert.ok(affected.every(form => !form.includes('name="transferDirection"')));
      await save("/finance/mine", "deny", "role", "CS_AGENT");
      assert.doesNotMatch(await get("/dashboard", agent), /بعض مؤشرات العهد غير مؤكدة لوجود تصحيح/);
    }
    if (section === "settlement-branch-mismatch") {
      const page = await get("/finance/transfers", accountant);
      assert.match(page, /فرع طلب التسوية لا يطابق فرع العهدة/);
      const formFor = (id: string) => forms(page).filter(form => form.includes(`name="settlementId" value="${id}"`));
      const bad = formFor("1"), good = formFor("2");
      const reject = bad.find(form => form.includes('aria-label="سبب الرفض"')); assert.ok(reject);
      assert.ok(bad.every(form => !form.includes('name="transferDirection"')), "mismatched request must not show confirmation");
      const goodConfirm = good.find(form => form.includes('name="transferDirection"')); assert.ok(goodConfirm, "unrelated request remains eligible");
      const payload = hidden(goodConfirm);
      for (const [key,value] of Object.entries({ requestId: randomUUID(), settlementId: "1", expectedBalance: "10", transferDirection: "TO_VAULT", transferAmount: "0", reason: "فحص فرع اصطناعي", actuallyTransferred: "yes" })) payload.set(key,value);
      const rejected = await fetch(`${base}/finance/transfers`, { method: "POST", headers: { cookie: accountant, origin: base }, body: payload });
      assert.match(await rejected.text(), /فرع طلب التسوية لا يطابق فرع العهدة/);
      const rejectPayload = hidden(reject); rejectPayload.set("requestId", randomUUID()); rejectPayload.set("reason", "رفض اختلاف الفرع");
      const decision = await fetch(`${base}/finance/transfers`, { method: "POST", headers: { cookie: accountant, origin: base }, body: rejectPayload });
      assert.match(await decision.text(), /رُفض طلب التسوية بسبب مدوّن، بلا أي أثر على النقد/);
    }
    if (section === "settlement-confirm-prereqs" || section === "settlement-closed-vault") {
      const page = await get("/finance/transfers", admin);
      const formsFor = (id: string) => forms(page).filter(form => form.includes(`name="settlementId" value="${id}"`));
      const expectRejectOnly = (id: string) => {
        const matched = formsFor(id);
        assert.ok(matched.some(form => form.includes('aria-label="سبب الرفض"')), `reject must remain for ${id}`);
        assert.ok(matched.every(form => !form.includes('name="transferDirection"')), `confirm must be hidden for ${id}`);
      };
      expectRejectOnly("2"); // requester is the logged-in manager
      expectRejectOnly("4"); // inactive branch even when it has a vault
      assert.match(page, /لا اعتماد ذاتي: من أنشأ طلب التسوية لا يعتمده/);
      assert.match(page, /الفرع غير نشط أو تعذّر العثور عليه/);
      const selectedValid = section === "settlement-confirm-prereqs" ? "1" : "3";
      const valid = formsFor(selectedValid).find(form => form.includes('name="transferDirection"')); assert.ok(valid, "unrelated eligible request should retain its form");
      const tryConfirm = async (id: string, expectedBalance: string) => {
        const payload = hidden(valid);
        for (const [key,value] of Object.entries({ requestId: randomUUID(), settlementId: id, expectedBalance, transferDirection: "TO_VAULT", transferAmount: "0", reason: "اختبار اصطناعي", actuallyTransferred: "yes" })) payload.set(key,value);
        return (await fetch(`${base}/finance/transfers`, { method: "POST", headers: { cookie: admin, origin: base }, body: payload })).text();
      };
      assert.match(await tryConfirm("2", "0"), /لا اعتماد ذاتي/);
      assert.match(await tryConfirm("4", "0"), /الفرع غير موجود أو غير نشط/);
      if (section === "settlement-confirm-prereqs") {
        expectRejectOnly("3"); // branch 2 has no vault
        assert.match(page, /لا توجد خزنة مفتوحة لفرع/);
        assert.match(await tryConfirm("3", "0"), /لا توجد خزنة مفتوحة لهذا الفرع/);
        const accountantPage = await get("/finance/transfers", accountant);
        assert.ok(forms(accountantPage).some(form => form.includes('name="settlementId" value="2"') && form.includes('name="transferDirection"')), "a different authorized manager can review the request");
      } else {
        expectRejectOnly("1"); // vault exists but was closed by synthetic legacy data
        assert.match(page, /لا توجد خزنة مفتوحة لفرع/);
        assert.match(await tryConfirm("1", "10"), /خزنة الفرع مقفلة/);
        const employeePage = await get("/finance/transfers", agent);
        assert.match(employeePage, /لا توجد خزنة مفتوحة لفرعك لتوريد النقد إليها/);
        assert.doesNotMatch(employeePage, /name="toId"/, "employee cannot submit a transfer to a closed vault");
      }
    }
    if (section === "stale-settlement") {
      const page = await get("/finance/transfers", accountant);
      assert.match(page, /تغيّرت مراجعة العهدة أو تعذّر التحقق منها/);
      const staleForms = forms(page).filter(form => form.includes('name="settlementId" value="1"'));
      const freshForms = forms(page).filter(form => form.includes('name="settlementId" value="2"'));
      assert.ok(staleForms.some(form => form.includes('aria-label="سبب الرفض"')), "stale request remains rejectable");
      assert.ok(staleForms.every(form => !form.includes('name="transferDirection"')), "stale request must not expose confirm form");
      const freshConfirm = freshForms.find(form => form.includes('name="transferDirection"')); assert.ok(freshConfirm, "unrelated fresh request should retain confirm form");
      const post = hidden(freshConfirm);
      for (const [key,value] of Object.entries({ requestId: randomUUID(), settlementId: "1", expectedBalance: "10", transferDirection: "TO_VAULT", transferAmount: "0", reason: "اختبار تقادم", actuallyTransferred: "yes" })) post.set(key,value);
      const rejected = await fetch(`${base}/finance/transfers`, { method: "POST", headers: { cookie: accountant, origin: base }, body: post });
      assert.match(await rejected.text(), /لا تتوفر مراجعة موثوقة للطلب القديم/);
      const mine = await get("/finance/mine", agent);
      assert.match(mine, /طلب التسوية المعلق متوقف عن الاعتماد احتياطًا/);
      assert.doesNotMatch(mine, /لديك طلب تسوية معلق بانتظار اعتماد المدير/);
      const dashboard = await get("/dashboard?section=all", agent);
      assert.match(dashboard, /طلب تسوية معلق يحتاج إعادة جرد/);
      assert.doesNotMatch(dashboard, /لديك طلب تسوية معلق بانتظار اعتماد المدير/);
    }
    if (section === "boundary") {
      const countsPage = await get("/finance/counts", accountant);
      assert.match(countsPage, /بعض العهد متوقفة للمراجعة/);
      const countForm = forms(countsPage).find(form => form.includes('name="actuallyCounted"')); assert.ok(countForm);
      const payload = hidden(countForm);
      for (const [key,value] of Object.entries({ requestId: randomUUID(), accountId: "2", expectedBalance: "0", countedAmount: "0", reason: "اختبار حد اصطناعي", actuallyCounted: "yes" })) payload.set(key,value);
      const rejected = await fetch(`${base}/finance/counts`, { method: "POST", headers: { cookie: accountant, origin: base }, body: payload });
      assert.match(await rejected.text(), /بنفس وقت بداية الفترة/);
      assert.match(await get("/dashboard", agent), /بعض مؤشرات العهد غير مؤكدة/);
      await save("/finance/mine", "deny", "role", "CS_AGENT");
      const restrictedDashboard = await get("/dashboard", agent);
      assert.doesNotMatch(restrictedDashboard, /بعض مؤشرات العهد غير مؤكدة/, "denied custody page must not reveal a boundary event");
      assert.match(restrictedDashboard, /مؤشرات العهد المعروضة تقديرية وقد لا تصلح للتسليم/, "restricted dashboard must not present an unqualified estimate");
      await save("/finance/mine", "inherit", "role", "CS_AGENT");
      assert.match(await get("/dashboard", admin), /بعض مؤشرات العهد غير مؤكدة/);
      assert.match(await get("/finance", accountant), /بعض مؤشرات العهد والسيولة غير مؤكدة/);
      const transfersPage = await get("/finance/transfers", accountant);
      assert.match(transfersPage, /فترة العهدة ملتبسة عند بداية الفترة/);
      const affectedForms = forms(transfersPage).filter(form => form.includes('name="settlementId" value="1"'));
      assert.ok(affectedForms.some(form => form.includes('aria-label="سبب الرفض"')), "rejection remains available for review");
      assert.ok(affectedForms.every(form => !form.includes('name="transferDirection"')), "ambiguous settlement must not offer confirmation");
      const minePage = await get("/finance/mine", agent);
      assert.match(minePage, /الأرقام أدناه غير مؤكدة/);
      const settlementPage = await get("/finance/settlements/new", agent);
      assert.match(settlementPage, /توقف طلب التسوية والجرد والإقفال للمراجعة/);
      assert.ok(!settlementPage.includes('name="countedAmount"'), "ambiguous period must not render the new settlement form");
    }
    if (section === "finance") {
    const financeDashboard = await get("/finance", accountant);
    assert.doesNotMatch(financeDashboard, /صافي السيولة بعد المصروفات/, "do not subtract registered expenses a second time from cash liquidity");
    assert.match(financeDashboard, /مصروفات الشهر المسجّلة تشمل حالات مختلفة ولا تُطرح منها مجددًا/);
    const mainDashboard = await get("/dashboard?section=all", accountant);
    assert.doesNotMatch(mainDashboard, /صافي النقد المحتفظ به|صافي النقد من كل|صافي السيولة المحتفظ بها بالشهر/, "mixed-source cash flow must not be serialized");
    assert.match(mainDashboard, /الحركات المسجّلة هذا الشهر/);
    assert.doesNotMatch(mainDashboard, /صافي السيولة بعد (?:مصروفات الشهر|المصروفات)/);
    assert.match(mainDashboard, /تشمل حالات مختلفة ولا تُطرح مجددًا من السيولة/);
    assert.match(await get("/finance/mine", agent), /لا تتوفر مراجعة موثوقة للطلب/, "legacy request must be flagged on the holder page");
    assert.match(await get("/finance/transfers", accountant), /تغيّرت مراجعة العهدة أو تعذّر التحقق منها/, "legacy request must be flagged for the decision maker");
    const cases = [
      { key: "/finance/transfers#transfer", field: 'name="fromId"', other: 'name="transferDirection"', values: { fromId: "1", toId: "2", amount: "1", expectedBalance: "1000", actuallyTransferred: "yes" } },
      { key: "/finance/transfers#confirm-settlement", field: 'name="transferDirection"', other: 'name="fromId"', values: { settlementId: "1", expectedBalance: "10", transferDirection: "TO_VAULT", transferAmount: "1", reason: "اختبار منع", actuallyTransferred: "yes" } },
      { key: "/finance/transfers#reject-settlement", field: 'aria-label="سبب الرفض"', other: 'name="transferDirection"', values: { settlementId: "1", reason: "اختبار منع" } },
    ];
    for (const entry of cases) {
      const form = forms(await get("/finance/transfers", accountant)).find((f) => f.includes(entry.field));
      assert.ok(form, `${entry.key}: baseline form missing`);
      await save(entry.key, "deny");
      const deniedPage = await get("/finance/transfers", accountant);
      assert.ok(!deniedPage.includes(entry.field), `${entry.key}: forbidden form visible`);
      assert.ok(deniedPage.includes(entry.other), `${entry.key}: unrelated form hidden`);
      const data = hidden(form);
      data.set("requestId", crypto.randomUUID());
      for (const [name, v] of Object.entries(entry.values)) data.set(name, v);
      const posted = await fetch(`${base}/finance/transfers`, { method: "POST", headers: { cookie: accountant, origin: base }, body: data });
      const result = await posted.text();
      assert.match(result, /معطّل بالصلاحيات/, `${entry.key}: direct request was not denied`);
      assert.match(result, /طلب اختبار اصطناعي/, `${entry.key}: settlement no longer visible`);
      await save(entry.key, "inherit");
    }

    async function submitCaptured(path: string, form: string, values: Record<string, string>): Promise<string> {
      const data = hidden(form);
      data.set("requestId", crypto.randomUUID());
      for (const [name, value] of Object.entries(values)) data.set(name, value);
      return (await fetch(`${base}${path}`, { method: "POST", headers: { cookie: accountant, origin: base }, body: data })).text();
    }
    // Later cash collection must be performed by the invoice creator under the
    // temporary safety bridge; other methods remain available to the accountant.
    const collectPath = "/sales/2";
    const collectForm = forms(await get(collectPath, accountant)).find((f) => f.includes("تسجيل تحصيل")); assert.ok(collectForm);
    assert.ok(collectForm.includes("مؤقتًا لا يمكن تسجيل التحصيل النقدي إلا بواسطة منشئ الفاتورة"));
    const deniedCash = await submitCaptured(collectPath, collectForm, { saleId: "2", amount: "1", method: "CASH", reviewed: "yes" });
    assert.ok(deniedCash.includes("التحصيل النقدي بالنيابة عن منشئ الفاتورة متوقف مؤقتًا"));
    assert.ok((await get(collectPath, accountant)).includes("تسجيل تحصيل"), "denial must leave invoice outstanding");
    const card = await submitCaptured(collectPath, collectForm, { saleId: "2", amount: "1", method: "CARD", reviewed: "yes" });
    assert.ok(card.includes("تم تسجيل التحصيل"), "noncash on-behalf collection should remain allowed");
    const closedPath = "/sales/9";
    const closedCollect = forms(await get(closedPath, closedUser)).find((f) => f.includes("تسجيل تحصيل")); assert.ok(closedCollect);
    const closedData = hidden(closedCollect);
    for (const [name, value] of Object.entries({ requestId: randomUUID(), saleId: "9", amount: "1", method: "CASH", reviewed: "yes" })) closedData.set(name, value);
    const closedResult = await fetch(`${base}${closedPath}`, { method: "POST", headers: { cookie: closedUser, origin: base }, body: closedData });
    assert.ok((await closedResult.text()).includes("يلزم وجود عهدة مفتوحة للمسجّل"));
    closedData.set("requestId", randomUUID()); closedData.set("method", "CARD");
    const closedCard = await fetch(`${base}${closedPath}`, { method: "POST", headers: { cookie: closedUser, origin: base }, body: closedData });
    assert.ok((await closedCard.text()).includes("تم تسجيل التحصيل"), "noncash remains allowed for closed custody");
    const ownCollect = forms(await get(collectPath, admin)).find((f) => f.includes("تسجيل تحصيل")); assert.ok(ownCollect);
    const ownData = hidden(ownCollect);
    for (const [name, value] of Object.entries({ requestId: randomUUID(), saleId: "2", amount: "1", method: "CASH", reviewed: "yes" })) ownData.set(name, value);
    const pendingReply = await fetch(`${base}${collectPath}`, { method: "POST", headers: { cookie: admin, origin: base }, body: ownData });
    assert.ok((await pendingReply.text()).includes("طلب تسوية أو جرد مفتوح لهذه العهدة"), "direct cash POST must reject an open settlement");
    const rejectPending = forms(await get("/finance/transfers", accountant)).find((f) => f.includes('name="settlementId" value="2"') && f.includes('aria-label="سبب الرفض"')); assert.ok(rejectPending);
    const rejected = await submitCaptured("/finance/transfers", rejectPending, { settlementId: "2", reason: "رفض طلب اصطناعي" });
    assert.ok(rejected.includes("رُفض طلب التسوية"), "the pending request should remain rejectable");
    const ownReply = await fetch(`${base}${collectPath}`, { method: "POST", headers: { cookie: admin, origin: base }, body: ownData });
    assert.ok((await ownReply.text()).includes("تم تسجيل التحصيل"));
    const ownReplay = await fetch(`${base}${collectPath}`, { method: "POST", headers: { cookie: admin, origin: base }, body: ownData });
    assert.ok((await ownReplay.text()).includes("سبق تسجيل هذا التحصيل"));

    const countCases: Array<{ key: string; field: string; other: string; values: Record<string, string> }> = [
      { key: "/finance/counts#request", field: 'name="actuallyCounted"', other: "جردٌ موجَّه إلى موظف", values: { accountId: "2", countedAmount: "10", expectedBalance: "10", reason: "اختبار منع الجرد", actuallyCounted: "yes" } },
      { key: "/finance/counts#request-holder", field: "جردٌ موجَّه إلى موظف", other: 'name="actuallyCounted"', values: { accountId: "2", reason: "اختبار منع الجرد الموجه" } },
      { key: "/finance/counts#confirm", field: 'name="stillCurrent"', other: "سبب إلغاء طلب الجرد", values: { countId: "1", reason: "اختبار منع التأكيد", stillCurrent: "yes" } },
    ];
    for (const entry of countCases) {
      const form = forms(await get("/finance/counts", accountant)).find((f) => f.includes(entry.field));
      assert.ok(form, `${entry.key}: baseline form missing`);
      await save(entry.key, "deny");
      const page = await get("/finance/counts", accountant);
      assert.ok(!page.includes(entry.field), `${entry.key}: forbidden form visible`);
      assert.ok(page.includes(entry.other), `${entry.key}: independent form absent`);
      const result = await submitCaptured("/finance/counts", form, entry.values);
      assert.match(result, /معطّل بالصلاحيات/, `${entry.key}: direct request was not denied`);
      assert.match(result, /جرد اختبار اصطناعي/, `${entry.key}: open count no longer visible`);
      await save(entry.key, "inherit");
    }

    // With confirmation forbidden the resolve form renders its independent cancel action.
    await save("/finance/counts#confirm", "deny");
    const cancelForm = forms(await get("/finance/counts", accountant)).find((f) => f.includes("سبب إلغاء طلب الجرد"));
    assert.ok(cancelForm, "cancel form missing");
    await save("/finance/counts#confirm", "inherit");
    await save("/finance/counts#cancel", "deny");
    const confirmPage = await get("/finance/counts", accountant);
    assert.ok(confirmPage.includes('name="stillCurrent"'), "confirmation must remain available");
    assert.ok(!confirmPage.includes("إلغاء الطلب بدلًا من ذلك"), "cancel switch must be hidden");
    const cancelResult = await submitCaptured("/finance/counts", cancelForm, { countId: "1", reason: "اختبار منع الإلغاء" });
    assert.match(cancelResult, /معطّل بالصلاحيات/, "direct count cancellation was not denied");
    assert.match(cancelResult, /جرد اختبار اصطناعي/, "open count no longer visible");
    await save("/finance/counts#cancel", "inherit");

    const requestForm = forms(await get("/finance/counts", accountant)).find((f) => f.includes('name="actuallyCounted"'));
    assert.ok(requestForm, "count request form missing");
    await save("/finance/counts#request", "deny");
    await save("/finance/counts#request", "allow", "user", "2");
    assert.ok((await get("/finance/counts", accountant)).includes('name="actuallyCounted"'), "user override should restore its specific action");
    await save("/finance#write", "deny");
    assert.ok(!(await get("/finance/counts", accountant)).includes('name="actuallyCounted"'), "global finance lock must beat action override");
    const globalResult = await submitCaptured("/finance/counts", requestForm, { accountId: "2", countedAmount: "10", expectedBalance: "10", reason: "اختبار القفل العام", actuallyCounted: "yes" });
    assert.match(globalResult, /معطّل بالصلاحيات/, "global finance lock must deny direct request");
    assert.ok((await get("/finance/counts", admin)).includes('name="actuallyCounted"'), "system admin remains unrestricted");
    await save("/finance/counts#request", "inherit", "user", "2");
    await save("/finance/counts#request", "inherit");
    await save("/finance#write", "inherit");

    // Account selector must not serialize a closed account into the refund form.
    assert.ok((await get("/finance", accountant)).includes("CLOSEDCASHCANARY"), "closed account fixture missing");
    const refundPage = await get("/sales/6", accountant);
    assert.ok(refundPage.includes("خزنة الفرع"), "refund selector should retain the open vault");
    assert.ok(refundPage.includes("98765.43") || refundPage.includes("98,765.43"), "distinct vault balance must be present before denial");
    assert.ok(!refundPage.includes("CLOSEDCASHCANARY"), "closed account leaked into refund selector");
    const refundForm = forms(refundPage).find((form) => form.includes("تسجيل رد مبلغ للعميل")); assert.ok(refundForm);
    const refundAttempt = await submitCaptured("/sales/6", refundForm, { saleId: "6", amount: "1", method: "CASH", accountId: "3", reviewed: "yes", actuallyPaid: "yes", negativeAcknowledged: "yes", checkpointRef: "OPENING", timing: "AFTER_REVIEWED_CHECKPOINT" });
    assert.ok(refundAttempt.includes("الحساب مقفل؛ لا يمكن رد النقد منه"), "direct refund must reject the closed account");
    const afterRejectedRefund = await get("/sales/6", accountant);
    assert.ok(afterRejectedRefund.includes("21,900"), "rejected refund must leave the prior refund unchanged");
    assert.equal((afterRejectedRefund.match(/رد مسجل بعد الدفع/g) ?? []).length, (refundPage.match(/رد مسجل بعد الدفع/g) ?? []).length, "rejected refund must not add a ledger entry");
    // Balance visibility is independent of the refund action; no balance values
    // are serialized, and blind cash refunds may not overdraw even via direct POST.
    await save("/sales#refund-balances", "deny");
    const blind = await get("/sales/6", accountant);
    assert.ok(blind.includes("خزنة الفرع") && blind.includes("تسجيل رد مبلغ للعميل"));
    assert.ok(!blind.includes("98765.43") && !blind.includes("98,765.43"), "balance leaked into HTML/RSC");
    assert.ok(blind.includes("2020-02-01"), "opening checkpoint date must be available even when balances are hidden");
    const blindRefund = forms(blind).find((form) => form.includes("تسجيل رد مبلغ للعميل")); assert.ok(blindRefund);
    for (const timing of ["UNKNOWN", "BEFORE_REVIEWED_CHECKPOINT", ""]) {
      const rejected = await submitCaptured("/sales/6", blindRefund, { saleId: "6", amount: "1", method: "CASH", accountId: "1", reviewed: "yes", actuallyPaid: "yes", checkpointRef: "OPENING", timing });
      assert.match(rejected, /متوقف للمراجعة/, "direct POST must not bypass timing review");
      assert.ok(!rejected.includes("98765.43") && !rejected.includes("98,765.43"), "blind rejection must not disclose balance");
    }
    const overdraft = await submitCaptured("/sales/6", blindRefund, { saleId: "6", amount: "20", method: "CASH", accountId: "2", reviewed: "yes", actuallyPaid: "yes", negativeAcknowledged: "yes" });
    assert.ok(overdraft.includes("لا يمكن تأكيد رصيد سالب دون صلاحية عرض الرصيد"), "direct blind refund must not force an overdraft");
    const blindNoAck = await submitCaptured("/sales/6", blindRefund, { saleId: "6", amount: "20", method: "CASH", accountId: "2", reviewed: "yes", actuallyPaid: "yes", negativeAcknowledged: "no", checkpointRef: "OPENING", timing: "AFTER_REVIEWED_CHECKPOINT" });
    assert.ok(blindNoAck.includes("تعذر الرد من الحساب المختار"));
    assert.ok(!blindNoAck.includes("سيصبح الرصيد سالبًا") && !blindNoAck.includes("98765.43"), "blind failure must not disclose a balance");
    await save("/sales#refund-balances", "allow", "user", "2");
    const visibleOverride = await get("/sales/6", accountant);
    assert.ok(visibleOverride.includes("98765.43") || visibleOverride.includes("98,765.43"));
    await save("/sales#refund-balances", "deny", "role", "MANAGER");
    const adminRefund = await get("/sales/6", admin);
    assert.ok(adminRefund.includes("98765.43") || adminRefund.includes("98,765.43"), "admin must bypass balance denial");
    await save("/sales#refund-balances", "inherit", "role", "MANAGER");
    await save("/sales#refund-balances", "inherit", "user", "2");
    const successData = hidden(blindRefund);
    for (const [name, value] of Object.entries({ requestId: randomUUID(), saleId: "6", amount: "1", method: "CASH", accountId: "1", reviewed: "yes", actuallyPaid: "yes", negativeAcknowledged: "no", checkpointRef: "OPENING", timing: "AFTER_REVIEWED_CHECKPOINT" })) successData.set(name, value);
    const blindSuccess = await (await fetch(`${base}/sales/6`, { method: "POST", headers: { cookie: accountant, origin: base }, body: successData })).text();
    assert.ok(blindSuccess.includes("تم تسجيل المبلغ الذي دُفع للعميل بالفعل"), "blind refund with sufficient funds should succeed");
    const blindReplay = await (await fetch(`${base}/sales/6`, { method: "POST", headers: { cookie: accountant, origin: base }, body: successData })).text();
    assert.ok(blindReplay.includes("سبق تسجيل هذا الرد"), "blind refund replay must not duplicate");
    await save("/sales#refund-balances", "inherit");
    // Report KPIs retain their values but not links to denied destination pages.
    const reportPath = "/finance/reports?period=month";
    const report = await get(reportPath, accountant);
    assert.ok(report.includes('href="/finance/expenses"') && report.includes('href="/finance/transfers#pending-settlements"'));
    await save("/finance/expenses", "deny");
    await save("/finance/transfers", "deny");
    await save("/finance", "deny");
    const reportDenied = await get(reportPath, accountant);
    // Page permissions are independent: denying the finance page does not remove
    // the balance needed by an independently allowed sales refund form.
    assert.ok((await get("/sales/6", accountant)).includes("خزنة الفرع"));
    assert.ok(reportDenied.includes("تقارير المالية"));
    assert.ok(!reportDenied.includes('href="/finance/expenses"'));
    assert.ok(!reportDenied.includes('href="/finance/transfers#pending-settlements"'));
    assert.ok(!reportDenied.includes('class="fin-back no-print" href="/finance"') && !reportDenied.includes('href="/finance" class="fin-back no-print"'));
    const adminReport = await get(reportPath, admin);
    assert.ok(adminReport.includes('href="/finance/expenses"') && adminReport.includes('href="/finance/transfers#pending-settlements"'));
    await save("/finance", "allow", "user", "2");
    await save("/finance/expenses", "allow", "user", "2");
    await save("/finance/transfers", "allow", "user", "2");
    const reportOverride = await get(reportPath, accountant);
    assert.ok(reportOverride.includes('href="/finance/expenses"') && reportOverride.includes('href="/finance/transfers#pending-settlements"'));
    assert.ok(reportOverride.includes("العودة إلى المالية"));
    await save("/finance", "inherit", "user", "2"); await save("/finance/expenses", "inherit", "user", "2"); await save("/finance/transfers", "inherit", "user", "2");
    await save("/finance/expenses", "inherit"); await save("/finance/transfers", "inherit"); await save("/finance", "inherit");
    // The accountant has the legacy can_cancel_sales flag set in the synthetic fixture.
    // Even explicit access-control allows must not override the engine's role policy.
    await save("/sales#return", "allow", "user", "2");
    await save("/sales#cancel", "allow", "user", "2");
    const salePath = "/sales/2";
    const managerForm = forms(await get(salePath, admin)).find((form) => form.includes('name="return-mode"'));
    assert.ok(managerForm, "manager return form missing");
    assert.ok(!(await get(salePath, accountant)).includes('name="return-mode"'), "accountant return form must remain hidden");
    for (const cancel of [false, true]) {
      const data = hidden(managerForm);
      data.set("reviewed", "yes");
      data.set("payload", JSON.stringify({ requestId: randomUUID(), saleId: "2", cancel, accepted: true,
        lines: cancel ? [] : [{ saleLineId: "1", quantity: "1", serialIds: [] }] }));
      const response = await fetch(`${base}${salePath}`, { method: "POST", headers: { cookie: accountant, origin: base }, body: data });
      assert.match(await response.text(), /ليس لديك صلاحية لتنفيذ العملية في هذا الفرع/, `accountant ${cancel ? "cancellation" : "return"} must be denied by engine`);
    }
    await save("/sales#return", "inherit", "user", "2");
    await save("/sales#cancel", "inherit", "user", "2");

    }
    if (section === "dashboard") {
    for (const cookie of [agent, admin]) {
      const overview = await get("/dashboard?section=all", cookie);
      assert.doesNotMatch(overview, /صافي النقد المحتفظ به|صافي النقد من كل|صافي السيولة المحتفظ بها بالشهر/, "mixed-source indicator must not serialize for any tested role");
      assert.match(overview, /الحركات المسجّلة هذا الشهر/);
    }
    assert.doesNotMatch(await get("/dashboard", agent), /بعض مؤشرات العهد غير مؤكدة/, "non-boundary fixture must not report ambiguity");
    await save("/dashboard#recorded-flow", "deny", "role", "CS_AGENT");
    assert.doesNotMatch(await get("/dashboard?section=all", agent), /الحركات المسجّلة هذا الشهر/, "denied card must not serialize recorded flow");
    assert.match(await get("/dashboard?section=all", admin), /الحركات المسجّلة هذا الشهر/, "system admin bypass");
    await save("/dashboard#recorded-flow", "inherit", "role", "CS_AGENT");
    for (const key of ["/dashboard#expense-details", "/dashboard#invoice-details", "/sales", "/finance/expenses"]) {
      await save(key, "deny", "role", "CS_AGENT");
      assert.doesNotMatch(await get("/dashboard?section=all", agent), /الحركات المسجّلة هذا الشهر/, `${key} must block the combined card`);
      await save(key, "inherit", "role", "CS_AGENT");
    }
    await save("/finance/mine", "deny", "role", "CS_AGENT");
    const normalRestricted = await get("/dashboard", agent);
    assert.match(normalRestricted, /مؤشرات العهد المعروضة تقديرية وقد لا تصلح للتسليم/);
    assert.doesNotMatch(normalRestricted, /الحركات المسجّلة هذا الشهر/);
    assert.doesNotMatch(normalRestricted, /بعض مؤشرات العهد غير مؤكدة/);
    await save("/finance/mine", "inherit", "role", "CS_AGENT");
    await save("/finance", "deny");
    assert.match(await get("/dashboard", accountant), /مؤشرات العهد المعروضة تقديرية وقد لا تصلح للتسليم/);
    assert.doesNotMatch(await get("/dashboard", admin), /مؤشرات العهد المعروضة تقديرية وقد لا تصلح للتسليم/);
    await save("/finance", "inherit");
    const invoiceKey = "/dashboard#invoice-details";
    const customerMarkers = ["SENSITIVECLIENTCANARY1", "SENSITIVECLIENTCANARY2", "01155500001", "01155500002"];
    assert.ok((await get("/dashboard", agent)).includes(customerMarkers[0]), "synthetic invoice must appear before denial");
    await save(invoiceKey, "deny", "role", "CS_AGENT");
    for (const query of ["", "?section=all", "?section=monthly-sales", "?section=collections", "?section=aging-radar", "?section=live-feed", "?q=55500001"]) {
      const result = await get(`/dashboard${query}`, agent);
      for (const marker of customerMarkers) assert.ok(!result.includes(marker), `${query}: invoice marker leaked into HTML/RSC`);
    }
    assert.ok((await get("/sales", agent)).includes(customerMarkers[0]), "dashboard restriction must not silently restrict sales pages");
    assert.ok((await get("/dashboard", admin)).includes(customerMarkers[0]), "system admin bypass missing");
    await save(invoiceKey, "allow", "user", "3");
    assert.ok((await get("/dashboard", agent)).includes(customerMarkers[0]), "account override should restore invoice details");
    await save(invoiceKey, "deny");
    const accountantDashboard = await get("/dashboard?section=all", accountant);
    for (const marker of customerMarkers) assert.ok(!accountantDashboard.includes(marker), "accountant dashboard leaked invoice marker");
    await save(invoiceKey, "inherit", "user", "3");
    await save(invoiceKey, "inherit", "role", "CS_AGENT");
    await save(invoiceKey, "inherit");

    const todayBefore = await get("/sales/today", agent);
    assert.match(todayBefore, /href="\/sales\/\d+/, "today must initially link to invoices");
    await save("/sales", "deny", "role", "CS_AGENT");
    const todayDenied = await get("/sales/today", agent);
    assert.doesNotMatch(todayDenied, /href="\/sales\/\d+/, "invoice links must be hidden when invoice page is denied");
    assert.match(todayDenied, /جدول فواتير اليوم/, "today listing remains readable");
    for (const query of ["", "?section=all", "?section=aging-radar", "?section=pulse", "?q=55500001"]) {
      assert.doesNotMatch(await get(`/dashboard${query}`, agent), /href="\/sales\/\d+/, `${query}: dashboard invoice link should be hidden`);
    }
    await save("/sales", "allow", "user", "3");
    assert.match(await get("/sales/today", agent), /href="\/sales\/\d+/, "account override should restore invoice links");
    await save("/sales", "inherit", "user", "3");
    await save("/sales", "inherit", "role", "CS_AGENT");
    for (const key of ["/sales/new", "/sales/new#write"]) {
      await save(key, "deny", "role", "CS_AGENT");
      for (const path of ["/sales", "/sales/today"]) assert.doesNotMatch(await get(path, agent), /href="\/sales\/new"/, `${path}: new sale link should be hidden for ${key}`);
      await save(key, "inherit", "role", "CS_AGENT");
    }
    }
  } catch (error) {
    throw new Error(`disposable HTTP test failed: ${error instanceof Error ? error.stack : String(error)}; server log tail:\n${logs}`, { cause: error });
  } finally {
    if (child && child.exitCode === null) {
      const exited = new Promise<void>((resolve) => child!.once("exit", () => resolve()));
      child.kill("SIGTERM");
      await Promise.race([exited, new Promise<void>((resolve) => { setTimeout(resolve, 5000).unref(); })]);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await exited;
      }
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
