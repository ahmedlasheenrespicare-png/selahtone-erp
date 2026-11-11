/** Disposable end-to-end authorization test. Never connects to DATABASE_URL. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
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

test("settlement estimate disclosures reach employee and reviewer", { timeout: 150_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "selahtone-period-notice-http-"));
  let child: ChildProcess | undefined; let logs="";
  try {
    execFileSync(process.execPath,[join(root,"scripts/local-pglite-preview.cjs")],{cwd:root,env:{...process.env,PREVIEW_PGLITE_DIR:dir,PREVIEW_PASSWORD:password},stdio:"pipe",timeout:60_000});
    const db=new PGlite(dir);
    try {
      await db.exec(readFileSync(join(root,"prisma/manual-access-control-upgrade.sql"),"utf8"));
      await db.exec("SET selahtone.finance_release_candidate_test_only='yes'");
      for(const file of ["prototypes/finance-release/release-candidate.test-only.sql","prisma/manual-settlement-upgrade.sql","prisma/manual-custody-closure-upgrade.sql","prisma/manual-custody-and-count-requests.sql"]) await db.exec(readFileSync(join(root,file),"utf8"));
      await db.exec(`INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
        SELECT 4,branch_id,role_code,'موظف اختبار','staff-period@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3;
        INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
        SELECT 5,branch_id,role_code,'موظف آخر','other-period@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3;
        INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
        SELECT 6,2,role_code,'موظف منقول اصطناعي','moved-period@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3;
        INSERT INTO finance.accounts (branch_id,kind,holder_id,opening_amount,opening_date,opened_by,opened_at)
        VALUES (1,'VAULT',NULL,100,CURRENT_DATE,1,now()-interval '1 day'),(1,'CUSTODY',3,10,CURRENT_DATE,1,now()-interval '1 day'),(1,'CUSTODY',4,20,CURRENT_DATE,1,now()-interval '1 day'),(1,'CUSTODY',5,30,CURRENT_DATE,1,now()-interval '1 day'),(1,'CUSTODY',6,40,CURRENT_DATE,1,now()-interval '1 day');
        INSERT INTO finance.settlements (account_id,branch_id,requested_by,system_balance,counted_amount,sales_total,expenses_total,expected_amount,deviation,adjustment,reason,account_revision)
        VALUES (2,1,3,10,10,0,0,10,0,0,'REVIEWCANARY',0),(4,1,5,30,30,0,0,30,0,0,'OTHERCANARY',0);
        -- Seed times based on the local day can be in the future; keep unrelated
        -- demo collections before account opening so this test is time-independent.
        UPDATE commerce_collections SET created_at=now()-interval '2 days' WHERE method='CASH';
        -- An intentionally inconsistent legacy scenario: this open request predates
        -- a later confirmed boundary, with a mismatch before that boundary. It
        -- must not be mistaken for proof that the request history is clean.
        UPDATE finance.settlements SET created_at=now()-interval '4 minutes' WHERE reason='OTHERCANARY';
        INSERT INTO finance.settlements(account_id,branch_id,requested_by,system_balance,counted_amount,sales_total,expenses_total,expected_amount,deviation,adjustment,reason,account_revision,status,created_at,resolved_by,resolved_at,resolution_reason,transfer_amount,transfer_direction)
        VALUES (4,1,5,30,30,0,0,30,0,0,'OLD_BOUNDARY',0,'CONFIRMED',now()-interval '3 minutes',1,now()-interval '2 minutes','اختبار اصطناعي',0,'TO_VAULT');
        UPDATE commerce_sales SET created_by_id=5 WHERE id=2;
        INSERT INTO commerce_collections(id,request_id,request_hash,sale_id,amount,method,is_initial,created_by_id,created_at)
        VALUES(998,'99999999-9999-4999-8999-999999999998',repeat('f',64),2,1,'CASH',false,1,now()-interval '3 minutes');
        UPDATE commerce_sales SET created_by_id=3 WHERE id=1;
        INSERT INTO commerce_collections(id,request_id,request_hash,sale_id,amount,method,is_initial,created_by_id,created_at)
        VALUES(999,'99999999-9999-4999-8999-999999999999',repeat('e',64),1,1,'CASH',false,4,now()-interval '1 minute');
        -- External/legacy inconsistent move: ordinary directory code blocks it
        -- while a custody is open. Preserve the original branch on the request.
        INSERT INTO finance.settlements (account_id,branch_id,requested_by,system_balance,counted_amount,sales_total,expenses_total,expected_amount,deviation,adjustment,reason,account_revision)
        VALUES(5,1,6,40,40,0,0,40,0,0,'MOVEDCANARY',0);
        -- Closed old custody and new-branch custody emulate legacy data only;
        -- the production reopen constraint and directory policy are unchanged.
        UPDATE finance.accounts SET closed_at=now()-interval '1 hour',closed_by=1 WHERE id=5;
        INSERT INTO finance.accounts(branch_id,kind,holder_id,opening_amount,opening_date,opened_by,opened_at)
        VALUES(2,'CUSTODY',6,0,CURRENT_DATE,1,now()-interval '30 minutes');`);
      const movedId="77777777-7777-4777-8777-777777777777";
      const movedPayload={requestId:movedId,accountId:"5",countedAmount:"40",expectedBalance:"40",reason:"جرد قديم اصطناعي",actuallyCounted:true};
      const hash=createHash("sha256").update(JSON.stringify({actorId:"6",action:"SETTLEMENT_CREATE",payload:movedPayload})).digest("hex");
      await db.query(`INSERT INTO finance.requests(request_id,request_hash,actor_id,action,result_id)
        SELECT $1::uuid,$2,6,'SETTLEMENT_CREATE',id FROM finance.settlements WHERE reason='MOVEDCANARY'`,[movedId,hash]);
      await db.query(`INSERT INTO finance.request_results(request_id,action,actor_id,result_table,result_id)
        SELECT $1::uuid,'SETTLEMENT_CREATE',6,'finance.settlements',id FROM finance.settlements WHERE reason='MOVEDCANARY'`,[movedId]);
    } finally {await db.close();}
    const port=await reservePort(),base=`http://127.0.0.1:${port}`;
    child=spawn(process.execPath,[join(root,"node_modules/next/dist/bin/next"),"dev","--hostname","127.0.0.1","--port",String(port)],{cwd:root,env:{...process.env,DATABASE_URL:"",PRISMA_PGLITE_DIR:dir,AUTH_SECRET:secret,FINANCE_ENABLED:"true",INVENTORY_ENABLED:"true",ADMIN_EMAILS:"manager@selahtone.local"},stdio:["ignore","pipe","pipe"]});
    child.stdout?.on("data",data=>{logs=(logs+data).slice(-16000)}); child.stderr?.on("data",data=>{logs=(logs+data).slice(-16000)});
    await waitForServer(base,child);
    async function login(email:string) {
      const form=forms(await (await fetch(`${base}/login?next=%2Fadmin`)).text())[0];assert.ok(form);
      const data=hidden(form);data.set("email",email);data.set("password",password);
      const response=await fetch(`${base}/login?next=%2Fadmin`,{method:"POST",headers:{origin:base},body:data,redirect:"manual"});
      assert.equal(response.status,303);return response.headers.getSetCookie().map(cookie=>cookie.split(";")[0]).join("; ");
    }
    async function get(path:string,cookie:string) {const response=await fetch(`${base}${path}`,{headers:{cookie},redirect:"manual"});assert.equal(response.status,200,path);return response.text();}
    const staff=await login("staff-period@selahtone.local"),owner=await login("arh@selahtone.local"),admin=await login("manager@selahtone.local"),moved=await login("moved-period@selahtone.local");
    const notice="قد تختلف هوية المحصّل عن منشئ الفاتورة";
    const mismatch="توجد سجلات عند حد الفترة الحالية أو بعده قد يختلف فيها المسجّل";
    assert.ok((await get("/finance/mine",owner)).includes(mismatch));
    const mine=await get("/finance/mine",staff);assert.ok(mine.includes(notice));assert.ok(mine.includes(mismatch));
    const staffDashboard=await get("/dashboard",staff);
    assert.ok(staffDashboard.includes(notice));assert.ok(staffDashboard.includes(mismatch));
    assert.ok(staffDashboard.includes("مؤشر الفترة التقديري"));assert.ok(!staffDashboard.includes("المستحق للخزنة"));
    const managerFinance=await get("/finance",admin);
    assert.ok(managerFinance.includes(notice));assert.ok(managerFinance.includes(mismatch));assert.ok(managerFinance.includes("مجموع مؤشرات عُهَد الموظفين"));assert.ok(!managerFinance.includes("المستحق للخزنة"));
    const managerDashboard=await get("/dashboard",admin);
    assert.ok(managerDashboard.includes(notice));assert.ok(managerDashboard.includes(mismatch));assert.ok(managerDashboard.includes("مؤشر عُهَد الفروع"));assert.ok(!managerDashboard.includes("المستحق للخزنة"));
    const list=await get("/finance/settlements",staff);assert.ok(list.includes(notice));assert.ok(list.includes(mismatch));
    assert.ok(list.includes("عند الاعتماد قد يُسجّل تعديل دفتري أو تحويل غير صفري"));
    assert.ok(list.includes("السجل لا يثبت انتقال النقد فعليًا"));
    assert.ok(!list.includes("الاعتماد وحده يحرّكهما"));
    // The difference column is asserted after the first request is created below;
    // an empty archive does not render that table header.
    assert.ok(list.includes("مؤشر الفترة التقديري"));
    assert.ok(!list.includes("الإجمالي المتوقع"));assert.ok(!list.includes("المتوقَّع بيده"));
    const request=await get("/finance/settlements/new",staff);
    assert.ok(request.includes(notice));assert.ok(request.includes(mismatch));assert.ok(request.includes("المعدود ناقص الرصيد الدفتري — ليس مبلغ التحويل"));
    assert.ok(request.includes("اكتب ما عددته بالفعل كاملًا، لا قيمة المؤشر"));assert.ok(!request.includes("فاكتب ١٤٥٠"));
    assert.ok(request.includes("التحويل المُدخل إن كان غير صفر"));assert.ok(request.includes("التسجيل والإقرار لا يثبتان انتقال النقد فعليًا"));
    assert.ok(!request.includes("يسجّل التحويل الفعلي"));
    assert.ok(request.includes("مؤشر الفترة التقديري"));assert.ok(request.includes("الفرق عن المؤشر"));
    assert.ok(!request.includes("الإجمالي المتوقع"));assert.ok(!request.includes("الفرق عن المتوقَّع بيدك"));
    const help=await get("/finance/help",staff);
    assert.ok(help.includes("قد لا تُنشأ حركة"));assert.ok(!help.includes("يتحوّل إلى حركة فقط عند اعتماد الإدارة"));
    assert.ok(help.includes("مؤشر الفترة التقديري"));assert.ok(help.includes("لا يثبت السجل انتقال نقد"));
    assert.ok(help.includes("الإقرار تسجيل للمسؤولية لا يثبت الانتقال المادي"));
    assert.ok(!help.includes("الإجمالي المتوقع"));assert.ok(!help.includes("تحرّر الفرق حركة تسوية"));
    assert.ok(help.includes("اتجاه لا يطابق التعديل الدفتري"));assert.ok(help.includes("لا يثبت تسجيل البيع وحده المؤشر"));
    assert.ok(!help.includes("استدم طلب التسوية"));assert.ok(!help.includes("انحراف يستحيل معه الاعتماد"));
    const counts=await get("/finance/counts",admin);
    assert.ok(counts.includes("تعديلًا دفتريًا"));assert.ok(counts.includes("لا يثبت ذلك انتقال نقد"));
    assert.ok(!counts.includes("الفرق لا يؤثر على الرصيد إلا بتأكيد تسوية منفصل"));
    const reports=await get("/finance/reports",admin);
    assert.ok(reports.includes("إجمالي الفرق المطلق عن المؤشر"));assert.ok(!reports.includes("إجمالي الانحراف المطلق"));
    const decision=await get("/finance/transfers",admin);
    assert.ok(decision.includes("REVIEWCANARY"));assert.ok(decision.includes(notice));assert.ok(decision.includes(mismatch));assert.ok(decision.includes("يمكن تغييره بما فيه الصفر"));
    assert.ok(decision.includes("مؤشر الفترة التقديري"));assert.ok(decision.includes("الفرق عن المؤشر"));assert.ok(!decision.includes("انحراف عن المتوقع"));
    function cardPrefix(marker:string) {
      const index=decision.lastIndexOf(marker);assert.ok(index>=0,marker);
      const start=decision.lastIndexOf('<div class="fin-page__section">',index);assert.ok(start>=0,marker);
      return decision.slice(start,index);
    }
    assert.ok(cardPrefix("REVIEWCANARY").includes(mismatch));
    assert.ok(!cardPrefix("OTHERCANARY").includes(mismatch),"older mismatch is outside the current boundary");
    assert.ok(cardPrefix("OTHERCANARY").includes("وليس لقطة محفوظة لفترة الطلب"),"absence of the current hint must not certify request history");
    assert.ok(cardPrefix("OTHERCANARY").includes("السجل وحده لا يثبت تغير النقد الفعلي"),"stale request warning must not infer physical cash movement");
    const confirm=forms(decision).find(entry=>entry.includes('name="settlementId" value="1"') && entry.includes('name="transferAmount"'));assert.ok(confirm,"warning must not hide the confirm form");
    const form=forms(request).find(entry=>entry.includes('name="expectedBalance"'));assert.ok(form);
    const data=hidden(form);
    for(const [key,value] of Object.entries({requestId:randomUUID(),accountId:"3",expectedBalance:"20",countedAmount:"20",reason:"جرد اصطناعي",actuallyCounted:"yes"})) data.set(key,value);
    const post=async()=>fetch(`${base}/finance/settlements/new`,{method:"POST",headers:{cookie:staff,origin:base},body:data,redirect:"manual"});
    const first=await post();assert.equal(first.status,200);assert.ok((await first.text()).includes("سُجّل طلب التسوية وهو بانتظار اعتماد المدير"));
    const replay=await post();assert.equal(replay.status,200);assert.ok((await replay.text()).includes("سبق تسجيل هذا الطلب"));
    assert.ok((await get("/finance/settlements",staff)).includes("الفرق عن المؤشر"));
    const movedData=hidden(form);
    for(const [key,value] of Object.entries({requestId:"77777777-7777-4777-8777-777777777777",accountId:"5",expectedBalance:"40",countedAmount:"40",reason:"جرد قديم اصطناعي",actuallyCounted:"yes"})) movedData.set(key,value);
    const movedReplay=await fetch(`${base}/finance/settlements/new`,{method:"POST",headers:{cookie:moved,origin:base},body:movedData,redirect:"manual"});
    assert.equal(movedReplay.status,200);assert.ok((await movedReplay.text()).includes("لا يمكن إعادة عرض طلب التسوية خارج نطاق العهدة المصرّح بها"));
    const movedList=await get("/finance/settlements",moved);
    const cancelForm=forms(movedList).find(entry=>entry.includes('name="settlementId" value="4"'));assert.ok(cancelForm);
    const cancelData=hidden(cancelForm);cancelData.set("requestId",randomUUID());cancelData.set("reason","إلغاء اصطناعي بعد النقل");
    const cancelPost=async()=>fetch(`${base}/finance/settlements`,{method:"POST",headers:{cookie:moved,origin:base},body:cancelData,redirect:"manual"});
    const canceled=await cancelPost();assert.equal(canceled.status,200);assert.ok((await canceled.text()).includes("أُلغي طلب التسوية، بلا أي أثر على النقد"));
    const cancelReplay=await cancelPost();assert.equal(cancelReplay.status,200);assert.ok((await cancelReplay.text()).includes("سبق حفظ هذا القرار"));
    const confirmData=hidden(confirm);
    for(const [key,value] of Object.entries({requestId:randomUUID(),settlementId:"1",expectedBalance:"10",transferAmount:"0",transferDirection:"TO_VAULT",reason:"مراجعة اصطناعية",actuallyTransferred:"yes"})) confirmData.set(key,value);
    const confirmPost=async()=>fetch(`${base}/finance/transfers`,{method:"POST",headers:{cookie:admin,origin:base},body:confirmData,redirect:"manual"});
    const confirmed=await confirmPost();assert.equal(confirmed.status,200);assert.ok((await confirmed.text()).includes("اعتُمدت التسوية وسُجّل مبلغ التحويل"));
    const confirmReplay=await confirmPost();assert.equal(confirmReplay.status,200);assert.ok((await confirmReplay.text()).includes("سبق حفظ هذا الطلب"));

    // Close Next's PGlite connection before inspecting the disposable database.
    // Response messages alone do not prove that replay avoided a second write.
    child.kill("SIGTERM"); await new Promise<void>(resolve=>child!.once("exit",()=>resolve())); child=undefined;
    const persisted=new PGlite(dir);
    try {
      const movedState=(await persisted.query<{status:string;requests:number;audits:number;movements:number}>(`SELECT
        (SELECT status FROM finance.settlements WHERE id=4) AS status,
        (SELECT count(*)::int FROM finance.requests WHERE action='SETTLEMENT_CANCEL' AND result_id=4) AS requests,
        (SELECT count(*)::int FROM finance.audit_events WHERE entity_type='SETTLEMENT' AND entity_id=4 AND action='CANCEL') AS audits,
        (SELECT count(*)::int FROM finance.movements WHERE source_id=5 OR destination_id=5) AS movements`)).rows[0];
      assert.deepEqual(movedState,{status:"CANCELLED",requests:1,audits:1,movements:0});
      const saved=(await persisted.query<{settlements:number;requests:number;movements:number}>(`SELECT
        (SELECT count(*)::int FROM finance.settlements WHERE reason='جرد اصطناعي') AS settlements,
        (SELECT count(*)::int FROM finance.requests WHERE request_id=$1::uuid AND action='SETTLEMENT_CREATE') AS requests,
        (SELECT count(*)::int FROM finance.movements WHERE source_id=3 OR destination_id=3) AS movements`,[data.get("requestId")])).rows[0];
      assert.deepEqual(saved,{settlements:1,requests:1,movements:0});
    } finally {await persisted.close();}
  } catch(error) {throw new Error(`period notice HTTP test failed: ${(error instanceof Error ? error.stack : String(error))}; server log tail:\n${logs}`);}
  finally {if(child) {child.kill("SIGTERM"); await new Promise<void>(resolve=>child!.once("exit",()=>resolve()));} rmSync(dir,{recursive:true,force:true});}
});
