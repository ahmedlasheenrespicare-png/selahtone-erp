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

test("expense operation permissions reject direct requests and preserve independent actions", { timeout: 180_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "selahtone-expense-guards-http-"));
  let child: ChildProcess | undefined;
  let logs = "";
  try {
    execFileSync(process.execPath, [join(root, "scripts/local-pglite-preview.cjs")], { cwd: root, env: { ...process.env, PREVIEW_PGLITE_DIR: dir, PREVIEW_PASSWORD: password }, stdio: "pipe", timeout: 60_000 });
    const db = new PGlite(dir);
    try {
      await db.exec(readFileSync(join(root, "prisma/manual-access-control-upgrade.sql"), "utf8"));
      await db.exec("SET selahtone.finance_release_candidate_test_only='yes'");
      for (const file of ["prototypes/finance-release/release-candidate.test-only.sql", "prisma/manual-settlement-upgrade.sql", "prisma/manual-custody-closure-upgrade.sql", "prisma/manual-custody-and-count-requests.sql"]) await db.exec(readFileSync(join(root, file), "utf8"));
      await db.exec(`INSERT INTO finance.accounts (branch_id,kind,holder_id,opening_amount,opening_date,opened_by)
        VALUES (1,'VAULT',NULL,1000,CURRENT_DATE,1);
        INSERT INTO finance.accounts (branch_id,kind,holder_id,opening_amount,opening_date,opened_by,closed_at,closed_by)
        VALUES (1,'CUSTODY',3,0,CURRENT_DATE - 1,1,now(),1);
        INSERT INTO finance.accounts (branch_id,kind,holder_id,opening_amount,opening_date,opened_by)
        VALUES (1,'CUSTODY',1,0,CURRENT_DATE - 1,1);
        INSERT INTO finance.expenses (branch_id,category_id,category_snapshot,amount,expense_date,description,status,requested_by,approved_by,approved_at)
        VALUES (1,1,'اختبار',11,CURRENT_DATE,'PENDINGCANARY','PENDING',3,NULL,NULL),
               (1,1,'اختبار',12,CURRENT_DATE,'APPROVEDCANARY','APPROVED',3,1,now()),
               (1,1,'اختبار',13,CURRENT_DATE,'PAIDCANARY','PAID',3,1,now()),
               (1,1,'اختبار',9,CURRENT_DATE,'MANAGEROWNCANARY','APPROVED',1,2,now()),
               (1,1,'اختبار',8,CURRENT_DATE,'ACCOUNTANTOWNCANARY','APPROVED',2,1,now());
        INSERT INTO finance.payments (expense_id,amount,method,account_id,payment_date,recorded_by,actually_paid)
        VALUES (3,13,'CARD',NULL,CURRENT_DATE,1,true);
        INSERT INTO public.users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
        SELECT n,1,'MANAGER','مدير اختبار '||n,'count-guard-'||n||'@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now()
        FROM users CROSS JOIN generate_series(4,5) n WHERE id=1;
        INSERT INTO finance.accounts (branch_id,kind,holder_id,opening_amount,opening_date,opened_by) VALUES
        (1,'CUSTODY',4,0,CURRENT_DATE-1,1),(1,'CUSTODY',5,0,CURRENT_DATE-1,1);
        INSERT INTO finance.expenses (branch_id,category_id,category_snapshot,amount,expense_date,description,status,requested_by,approved_by,approved_at) VALUES
        (1,1,'اختبار',14,CURRENT_DATE,'OPENCOUNTEXPENSE','APPROVED',4,1,now()),
        (1,1,'اختبار',15,CURRENT_DATE,'CONFIRMEDCOUNTEXPENSE','APPROVED',5,1,now()),
        (1,1,'اختبار',16,CURRENT_DATE,'OLDPAYMENTDATEEXPENSE','APPROVED',1,2,now());
        INSERT INTO finance.expenses (branch_id,category_id,category_snapshot,amount,expense_date,description,status,requested_by,approved_by,approved_at) VALUES
        (1,1,'اختبار',10,CURRENT_DATE,'HISTORICALCANARY','PAID',1,2,now()),
        (1,1,'اختبار',10,CURRENT_DATE,'TRANSFERCANARY','PAID',1,2,now()),
        (1,1,'اختبار',10,CURRENT_DATE,'WALLETCANARY','PAID',1,2,now());
        INSERT INTO finance.payments (expense_id,amount,method,account_id,payment_date,recorded_by,actually_paid,historical,included_in_opening) VALUES
        (9,10,'CASH',1,CURRENT_DATE,1,true,true,true),
        (10,10,'BANK_TRANSFER',NULL,CURRENT_DATE,1,true,false,false),
        (11,10,'WALLET',NULL,CURRENT_DATE,1,true,false,false);
        INSERT INTO finance.expense_reviews (expense_id,expense_revision,proposed_amount,reason,original_snapshot,status,created_by)
        VALUES (9,2,9,'OLD_OPEN_REVIEW_CANARY','{}','OPEN',1);
        INSERT INTO finance.expense_reviews (expense_id,expense_revision,reason,original_snapshot,status,created_by,resolved_by,resolved_at,resolution_reason)
        SELECT 9,1,'CLOSED_REVIEW_'||n,'{}','CLOSED',1,2,now(),'قرار اصطناعي' FROM generate_series(1,22) n;
        INSERT INTO finance.expense_reviews (expense_id,expense_revision,proposed_amount,reason,original_snapshot,status,created_by,resolved_by,resolved_at,resolution_reason)
        VALUES (10,1,8,'SENSITIVE_HISTORY_CANARY','{}','CORRECTED',1,2,now(),'SENSITIVE_RESOLUTION_CANARY');
        INSERT INTO finance.expense_corrections (expense_id,payment_id,review_id,before_amount,after_amount,reason,created_by)
        SELECT 10,p.id,r.id,10,8,'SENSITIVE_CORRECTION_CANARY',2 FROM finance.payments p,finance.expense_reviews r
        WHERE p.expense_id=10 AND r.expense_id=10 AND r.status='CORRECTED';
        -- Synthetic deliberately inconsistent legacy correction movement: the
        -- page must show the stored direction, not assume it validates payment.
        INSERT INTO finance.movements(kind,branch_id,source_id,destination_id,amount,expense_correction_id,actor_id)
        SELECT 'EXPENSE_CORRECTION',1,1,NULL,7.31,id,2 FROM finance.expense_corrections WHERE expense_id=10;
        INSERT INTO finance.expense_reviews (expense_id,expense_revision,reason,original_snapshot,status,created_by,resolved_by,resolved_at,resolution_reason)
        SELECT 11,1,'MOVEMENT_HISTORY_'||n,'{}','CORRECTED',1,2,now(),'synthetic' FROM generate_series(1,21) n;
        INSERT INTO finance.expense_corrections (expense_id,payment_id,review_id,before_amount,after_amount,reason,created_by)
        SELECT 11,p.id,r.id,10,8,'synthetic',2 FROM finance.payments p JOIN finance.expense_reviews r ON r.expense_id=p.expense_id
        WHERE p.expense_id=11 AND r.reason LIKE 'MOVEMENT_HISTORY_%' ORDER BY r.id;
        INSERT INTO finance.movements(kind,branch_id,source_id,destination_id,amount,expense_correction_id,actor_id)
        SELECT 'EXPENSE_CORRECTION',1,NULL,1,0.01,id,2 FROM finance.expense_corrections WHERE expense_id=11 ORDER BY id;
        INSERT INTO finance.cash_counts(account_id,counted_amount,observed_balance,difference,account_revision,counted_on,reason,status,created_by,resolved_by,resolved_at,resolution_reason) VALUES
        (4,0,0,0,0,CURRENT_DATE,'جرد مفتوح اصطناعي','OPEN',1,NULL,NULL,NULL),
        (5,0,0,0,0,CURRENT_DATE,'جرد مؤكد اصطناعي','CONFIRMED',1,1,now(),'تأكيد اصطناعي');`);
    } finally { await db.close(); }
    const port = await reservePort(); const base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
      cwd: root, env: { ...process.env, DATABASE_URL: "", PRISMA_PGLITE_DIR: dir, AUTH_SECRET: secret, FINANCE_ENABLED: "true", INVENTORY_ENABLED: "true", ADMIN_EMAILS: "manager@selahtone.local" }, stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (data) => { logs = (logs + data).slice(-16000); });
    child.stderr?.on("data", (data) => { logs = (logs + data).slice(-16000); });
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
    const admin = await login("manager@selahtone.local");
    const accountant = await login("accountant@selahtone.local");
    async function save(kind: "role" | "user", subject: string, key: string, value: "deny" | "allow" | "inherit") {
      const form = forms(await get("/admin", admin)).find((entry) => entry.includes('name="kind"')); assert.ok(form);
      const data = hidden(form); for (const [name, v] of Object.entries({ kind, subject, key, value })) data.set(name, v);
      const response = await fetch(`${base}/admin`, { method: "POST", headers: { cookie: admin, origin: base }, body: data });
      assert.match(await response.text(), /حُفظت الصلاحية/);
    }
    for (const id of [3, 10, 11]) {
      const page = await get(`/finance/expenses/${id}`, admin);
      assert.ok(page.includes("دفع غير نقدي — لا يحرّك النقد"));
      assert.ok(!page.includes("عهدة الموظف (بلا حركة آنية)"));
      assert.ok(page.includes("لا توجد آلية لتأكيد التصحيح هنا"));
    }
    const historical = await get("/finance/expenses/9", admin);
    assert.ok(historical.includes("دفع تاريخي — مسجّل كمشمول بالافتتاح، بلا حركة صرف جديدة"));
    assert.ok(!historical.includes("خصم فوري من حساب"));
    assert.ok(historical.includes("OLD_OPEN_REVIEW_CANARY"), "old open review must remain visible despite newer closed records");
    assert.ok(historical.includes("إصدار المصروف اختلف منذ الطلب"), "stale review revision must be visible");
    assert.ok(historical.includes("السجل هنا غير كامل"), "bounded history must disclose truncation");
    assert.ok(!historical.includes('name="proposedAmount"'), "open review must suppress the form");
    const history = await get("/finance/expenses/10", accountant);
    for (const value of ["SENSITIVE_HISTORY_CANARY", "SENSITIVE_RESOLUTION_CANARY", "SENSITIVE_CORRECTION_CANARY", "أُغلق دون تصحيح", "لا فرق دفتري مسجل"]) {
      // Closed status is demonstrated by expense 9; other values belong to 10.
      assert.ok((value === "أُغلق دون تصحيح" ? historical : history).includes(value), value);
    }
    assert.ok(history.includes("الحركات المسجّلة المرتبطة بتصحيحات هذا المصروف"));
    assert.ok(history.includes("7.31"));
    assert.ok(history.includes("من حساب #1"));
    assert.ok(history.includes("بلا وجهة حساب مسجلة"));
    assert.ok(history.includes("لا يثبت وجود حركة أو غيابها"));
    const manyMovements = await get("/finance/expenses/11", accountant);
    assert.ok(manyMovements.includes("تُعرض أحدث ٢٠ حركة مرتبطة فقط"));
    assert.ok(manyMovements.includes("إلى حساب #1"));
    assert.ok(manyMovements.includes("بلا مصدر حساب مسجل"));
    assert.ok(history.includes('name="proposedAmount"'), "a corrected review does not suppress a fresh review form");
    await save("role", "ACCOUNTANT", "/finance/expenses#review", "deny");
    const hiddenHistory = await get("/finance/expenses/10", accountant);
    for (const value of ["SENSITIVE_HISTORY_CANARY", "SENSITIVE_RESOLUTION_CANARY", "SENSITIVE_CORRECTION_CANARY", "7.31", "الحركات المسجّلة المرتبطة بتصحيحات هذا المصروف"]) assert.ok(!hiddenHistory.includes(value), `hidden sensitive data leaked: ${value}`);
    assert.ok((await get("/finance/expenses/10", admin)).includes("SENSITIVE_CORRECTION_CANARY"), "admin bypass includes correction evidence");
    await save("role", "ACCOUNTANT", "/finance/expenses#review", "inherit");
    const cases = [
      { id: "1", key: "/finance/expenses#approve", field: 'name="selfApproved"', marker: "PENDINGCANARY", values: { selfApproved: "yes" } },
      { id: "2", key: "/finance/expenses#pay", field: 'name="source"', marker: "APPROVEDCANARY", values: { actuallyPaid: "yes" } },
      { id: "3", key: "/finance/expenses#review", field: 'name="proposedAmount"', marker: "PAIDCANARY", values: { reason: "طلب اختبار اصطناعي", proposedAmount: "10" } },
    ];
    for (const entry of cases) {
      const path = `/finance/expenses/${entry.id}`;
      const original = await get(path, accountant); const form = forms(original).find((f) => f.includes(entry.field));
      assert.ok(form, `${entry.key}: baseline form missing`); assert.ok(original.includes(entry.marker));
      const post = async (revision: string) => {
        const data = hidden(form); data.set("requestId", randomUUID()); data.set("expectedRevision", revision);
        for (const [name, value] of Object.entries(entry.values)) data.set(name, value);
        return (await fetch(`${base}${path}`, { method: "POST", headers: { cookie: accountant, origin: base }, body: data })).text();
      };
      await save("role", "ACCOUNTANT", entry.key, "deny");
      const denied = await get(path, accountant);
      assert.ok(!denied.includes(entry.field), `${entry.key}: denied form visible`); assert.ok(denied.includes(entry.marker));
      for (const other of cases.filter((candidate) => candidate.id !== entry.id)) {
        assert.ok((await get(`/finance/expenses/${other.id}`, accountant)).includes(other.field), `${entry.key}: unrelated ${other.key} form hidden`);
      }
      assert.match(await post("1"), /معطّل بالصلاحيات/, `${entry.key}: direct request not denied`);
      await save("user", "2", entry.key, "allow");
      assert.ok((await get(path, accountant)).includes(entry.field), `${entry.key}: override form missing`);
      assert.match(await post("999"), /تغيّر السجل منذ عرضه/, `${entry.key}: override did not reach revision check`);
      await save("role", "ACCOUNTANT", "/finance#write", "deny");
      assert.ok(!(await get(path, accountant)).includes(entry.field));
      assert.match(await post("1"), /معطّل بالصلاحيات/, `${entry.key}: finance-wide lock must beat override`);
      await save("role", "MANAGER", entry.key, "deny");
      assert.ok((await get(path, admin)).includes(entry.field), `${entry.key}: admin bypass missing`);
      await save("role", "MANAGER", entry.key, "inherit");
      await save("role", "ACCOUNTANT", "/finance#write", "inherit");
      await save("user", "2", entry.key, "inherit");
      await save("role", "ACCOUNTANT", entry.key, "inherit");
      assert.ok((await get(path, accountant)).includes(entry.field), `${entry.key}: expense state changed during denied attempts`);
    }
    // A successful review becomes visible after refresh only to authorized
    // managers; its reason must not leak into denied HTML or RSC payloads.
    const reviewPath = "/finance/expenses/3";
    const reviewForm = forms(await get(reviewPath, accountant)).find((f) => f.includes('name="proposedAmount"')); assert.ok(reviewForm);
    const reviewData = hidden(reviewForm);
    reviewData.set("reason", "SENSITIVE_REVIEW_ONLY_CANARY"); reviewData.set("proposedAmount", "10");
    const reviewPost = () => fetch(`${base}${reviewPath}`, { method: "POST", headers: { cookie: accountant, origin: base }, body: reviewData });
    assert.ok((await (await reviewPost()).text()).includes("سُجّل طلب المراجعة"));
    assert.ok((await (await reviewPost()).text()).includes("سبق حفظ هذا الطلب"), "same request replays without a duplicate");
    const openReview = await get(reviewPath, accountant);
    assert.ok(openReview.includes("SENSITIVE_REVIEW_ONLY_CANARY"));
    assert.ok(openReview.includes("يوجد طلب مراجعة مفتوح"));
    assert.ok(!openReview.includes('name="proposedAmount"'), "open review hides a duplicate submission form");
    await save("role", "ACCOUNTANT", "/finance/expenses#review", "deny");
    const deniedReview = await get(reviewPath, accountant);
    assert.ok(!deniedReview.includes("SENSITIVE_REVIEW_ONLY_CANARY"), "restricted review reason leaked into the response");
    assert.ok(!deniedReview.includes("طلبات المراجعة المفتوحة"));
    assert.ok((await get(reviewPath, admin)).includes("SENSITIVE_REVIEW_ONLY_CANARY"), "admin bypass preserves review visibility");
    await save("user", "2", "/finance/expenses#review", "allow");
    assert.ok((await get(reviewPath, accountant)).includes("SENSITIVE_REVIEW_ONLY_CANARY"));
    await save("role", "ACCOUNTANT", "/finance#write", "deny");
    assert.ok(!(await get(reviewPath, accountant)).includes("SENSITIVE_REVIEW_ONLY_CANARY"), "finance-wide denial must also prevent review data query");
    await save("role", "ACCOUNTANT", "/finance#write", "inherit");
    await save("user", "2", "/finance/expenses#review", "inherit");
    await save("role", "ACCOUNTANT", "/finance/expenses#review", "inherit");

    // The author cannot close their own request, even with an action obtained
    // from a different account. Permission locks apply to direct POST as well.
    assert.ok(!forms(await get(reviewPath, accountant)).some(f => f.includes('name="reviewedNoChange"')));
    const closeForm = forms(await get(reviewPath, admin)).find(f => f.includes('name="reviewedNoChange"')); assert.ok(closeForm);
    const closeData = hidden(closeForm);
    closeData.set("reason", "فحص اصطناعي دون تغيير"); closeData.set("reviewedNoChange", "yes");
    const closePost = async (cookie: string) => (await fetch(`${base}${reviewPath}`, { method: "POST", headers: { cookie, origin: base }, body: closeData })).text();
    assert.ok((await closePost(accountant)).includes("يلزم مراجع آخر"));
    const shownRevision = closeData.get("expectedRevision"); assert.ok(typeof shownRevision === "string" && shownRevision);
    closeData.set("expectedRevision", "999");
    assert.ok((await closePost(admin)).includes("تغيّر السجل منذ عرضه"));
    assert.ok((await get(reviewPath, admin)).includes("SENSITIVE_REVIEW_ONLY_CANARY"));
    closeData.set("expectedRevision", shownRevision);
    const shownSnapshot = closeData.get("expectedReviewSnapshot"); assert.ok(typeof shownSnapshot === "string" && shownSnapshot.length === 64);
    closeData.set("expectedReviewSnapshot", "0".repeat(64));
    assert.ok((await closePost(admin)).includes("تغيّر طلب المراجعة منذ عرضه"));
    closeData.set("expectedReviewSnapshot", shownSnapshot);
    await save("role", "ACCOUNTANT", "/finance/expenses#review", "deny");
    assert.ok((await closePost(accountant)).includes("معطّل بالصلاحيات"));
    await save("role", "ACCOUNTANT", "/finance/expenses#review", "inherit");
    closeData.delete("reviewedNoChange");
    assert.ok((await closePost(admin)).includes("فحص الطلب واتخاذ قرار الإغلاق دون تصحيح"), "first execution requires acknowledgment");
    assert.ok((await get(reviewPath, admin)).includes("SENSITIVE_REVIEW_ONLY_CANARY"), "missing acknowledgment leaves review open");
    closeData.set("reviewedNoChange", "yes");
    assert.ok((await closePost(admin)).includes("أُغلق الطلب دون تصحيح"));
    assert.ok((await closePost(admin)).includes("سبق إغلاق الطلب"));
    closeData.set("reviewedNoChange", "no");
    assert.ok((await closePost(admin)).includes("استُخدم معرّف الطلب ببيانات مختلفة"), "changed acknowledgment conflicts with the saved new request");
    closeData.delete("reviewedNoChange");
    assert.ok((await closePost(admin)).includes("استُخدم معرّف الطلب ببيانات مختلفة"), "missing acknowledgment also conflicts");
    closeData.set("reviewedNoChange", "yes");
    assert.ok((await closePost(admin)).includes("سبق إغلاق الطلب"), "conflicts do not prevent authorized replay");
    const closedReview = await get(reviewPath, accountant);
    assert.ok(closedReview.includes("أُغلق دون تصحيح"));
    assert.ok(closedReview.includes("فحص اصطناعي دون تغيير"));
    assert.ok(closedReview.includes('name="proposedAmount"'));

    const path = "/finance/expenses/2";
    const payForm = forms(await get(path, accountant)).find((entry) => entry.includes('name="source"')); assert.ok(payForm);
    const payData = hidden(payForm);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
    for (const [name, value] of Object.entries({ requestId: randomUUID(), expectedRevision: "1", source: "ACCOUNT", method: "CASH", accountId: "2", paymentDate: today, actuallyPaid: "yes", openingOrder: "", includedInOpening: "no", afterCountId: "", afterCount: "no", expectedBalance: "0", negativeAcknowledged: "yes" })) payData.set(name, value);
    const paid = await fetch(`${base}${path}`, { method: "POST", headers: { cookie: accountant, origin: base }, body: payData });
    assert.ok((await paid.text()).includes("الحساب مقفل؛ لا يمكن صرف النقد منه"));
    assert.ok((await get(path, accountant)).includes('name="source"'), "rejected payment must leave expense approved");
    const onBehalf = hidden(payForm);
    for (const [name, value] of Object.entries({ requestId: randomUUID(), expectedRevision: "1", source: "HOLDER_CASH", method: "CASH", paymentDate: today, actuallyPaid: "yes" })) onBehalf.set(name, value);
    const onBehalfResult = await fetch(`${base}${path}`, { method: "POST", headers: { cookie: accountant, origin: base }, body: onBehalf });
    assert.ok((await onBehalfResult.text()).includes("تسجيل الصرف من نقد الموظف بالنيابة متوقف مؤقتًا"));
    assert.ok((await get(path, accountant)).includes('name="source"'), "rejected holder cash must leave expense approved");
    async function holderCash(pathname: string, cookie: string, paymentDate = today) {
      const page = await get(pathname, cookie);
      assert.ok(page.includes("مسجّل الصرف هو طالب المصروف"), "temporary restriction should be explained");
      assert.ok(page.includes("اختيار المصدر أو إقرار الصرف لا يثبت وقوع الدفع أو شمول تسوية سابقة"));
      const form = forms(page).find((f) => f.includes('name="source"')); assert.ok(form);
      const data = hidden(form);
      for (const [name, value] of Object.entries({ requestId: randomUUID(), expectedRevision: "1", source: "HOLDER_CASH", method: "CASH", paymentDate, actuallyPaid: "yes" })) data.set(name, value);
      return (await fetch(`${base}${pathname}`, { method: "POST", headers: { cookie, origin: base }, body: data })).text();
    }
    const openCountManager = await login("count-guard-4@selahtone.local");
    const confirmedCountManager = await login("count-guard-5@selahtone.local");
    assert.ok((await holderCash("/finance/expenses/6", openCountManager)).includes("يوجد جرد مفتوح للعهدة"));
    assert.ok((await holderCash("/finance/expenses/7", confirmedCountManager)).includes("تسجيل صرف جديد من نقد الموظف متوقف لوجود جرد مؤكد"));
    for (const [path, cookie] of [["/finance/expenses/6", openCountManager], ["/finance/expenses/7", confirmedCountManager]] as const) {
      const page = await get(path, cookie);
      assert.ok(page.includes('name="source"'), "blocked expense remains approved");
      assert.ok(page.includes("لا تغيّر المصدر لتجاوز المنع"));
    }
    assert.ok((await holderCash("/finance/expenses/8", admin, "2000-01-01")).includes("تاريخ الدفع أقدم من يوم مرجع العهدة"));
    assert.ok((await get("/finance/expenses/8", admin)).includes('name="source"'), "old-date refusal must leave expense approved");
    assert.ok((await holderCash("/finance/expenses/5", accountant)).includes("يلزم وجود عهدة مفتوحة للمسجّل"));
    assert.ok((await get("/finance/expenses/5", accountant)).includes('name="source"'));
    assert.ok((await holderCash("/finance/expenses/4", admin)).includes("سُجّل الصرف الفعلي للمصروف"));
    const paidHolder = await get("/finance/expenses/4", admin);
    assert.ok(!paidHolder.includes('name="source"'), "successful holder-cash payment should leave APPROVED state");
    assert.ok(paidHolder.includes("نقد الموظف — بلا حركة دفع فورية؛ أثر الفترة يحتاج تحققًا"));
    assert.ok(paidHolder.includes("تصحيح نقد الموظف متوقف للمراجعة اليدوية"));
    assert.ok(paidHolder.includes("بيانات الصرف المسجّلة — المصدر والطريقة والمسجّل"));
    assert.ok(paidHolder.includes("مسجّل الدفع"));
    assert.ok(!paidHolder.includes("من أين خرج المال وكيف ومَن صرفه"));
  } catch (error) { throw new Error(`expense HTTP test failed: ${String(error)}; server log tail:\n${logs}`, { cause: error }); }
  finally {
    if (child && child.exitCode === null) {
      const exited = new Promise<void>((resolve) => child!.once("exit", () => resolve()));
      child.kill("SIGTERM"); await Promise.race([exited, new Promise<void>((resolve) => { setTimeout(resolve, 5000).unref(); })]);
      if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; }
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
