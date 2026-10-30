/**
 * Optional multi-connection PostgreSQL test. It starts its OWN disposable cluster
 * in a fresh temp directory, listens on a private Unix socket only, never reads
 * DATABASE_URL, and shuts the cluster down before returning.
 * Set FINANCE_TEST_PG_BIN to a local PostgreSQL bin directory to enable it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { FinanceProblem, type FinanceDatabase, type FinanceTransaction } from "../prototypes/finance-engine/types";
import { addExpenseAttachment, getExpenseAttachment, listExpenseAttachments, openAccount, addCategory, createExpense, approveExpense, payExpense, requestPaidExpenseReview, confirmPaidExpenseCorrection, closePaidExpenseReview, requestCashCount, confirmCashCount, cancelCashCount, listCashCounts, transferCash, listAccounts, listPaidExpenseReviews } from "../prototypes/finance-engine/engine";

const pgBin=process.env.FINANCE_TEST_PG_BIN;
const schema=readFileSync("prototypes/finance-engine/schema.test-only.sql","utf8");
const request=()=>randomUUID();
const today="2026-10-29";
function startPostgres(bin: string, data: string, socket: string): Promise<ChildProcess> {
  const processHandle=spawn(path.join(bin,"postgres"),["-D",data,"-k",socket,"-h","","-p","55432","-c","unix_socket_permissions=0700"],{stdio:["ignore","ignore","pipe"],env:process.env});
  return new Promise((resolve,reject)=>{
    let logs="";let settled=false;
    const timeout=setTimeout(()=>{if(!settled){settled=true;processHandle.kill("SIGKILL");reject(new Error("temporary PostgreSQL did not start"));}},30_000);
    processHandle.stderr?.on("data",chunk=>{logs=(logs+String(chunk)).slice(-5000);if(!settled && logs.includes("database system is ready to accept connections")){settled=true;clearTimeout(timeout);resolve(processHandle);}});
    processHandle.once("error",error=>{if(!settled){settled=true;clearTimeout(timeout);reject(error);}});
    processHandle.once("exit",code=>{if(!settled){settled=true;clearTimeout(timeout);reject(new Error(`temporary PostgreSQL exited (${code}): ${logs}`));}});
  });
}
async function stopPostgres(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited=new Promise<void>(resolve=>child.once("exit",()=>resolve()));
  child.kill("SIGTERM");
  let timeout:NodeJS.Timeout|undefined;
  const clean=await Promise.race([exited.then(()=>true),new Promise<boolean>(resolve=>{timeout=setTimeout(()=>resolve(false),5000);})]);
  if(timeout)clearTimeout(timeout);
  if(!clean){child.kill("SIGKILL");await exited;}
}
function adapter(pool: Pool, beforeQuery?: (sql:string)=>Promise<void>): FinanceDatabase {
  return { serializable: async work=>{
    const client=await pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      const tx: FinanceTransaction={query:async(sql,parameters=[])=>{if(beforeQuery)await beforeQuery(sql);return {rows:(await client.query(sql,parameters)).rows};}};
      const output=await work(tx);await client.query("COMMIT");return output;
    } catch(error) { await client.query("ROLLBACK").catch(()=>{});throw error; }
    finally {client.release();}
  }};
}
function opening(kind:"VAULT"|"CUSTODY",holderId:string|null,openingAmount:string){return {requestId:request(),branchId:"1",kind,holderId,openingAmount,openingDate:"2026-10-20",counted:true};}
function draft(categoryId:string,amount:string){return {requestId:request(),branchId:"1",categoryId,amount,expenseDate:"2026-10-21",description:"اختبار تزامن وهمي",beneficiary:"",documentNumber:"",taxAmount:""};}
function code(e:unknown): string | undefined {return e instanceof FinanceProblem ? e.code : undefined;}
// Force the first two transactions to overlap immediately before their first
// lock. Once released, the gate remains open for serialization retries.
function overlapOn(fragment:string) {
  let arrivals=0;let release!:()=>void;let gate:Promise<void>|undefined;let timeout:NodeJS.Timeout|undefined;
  return {
    beforeQuery:async(sql:string)=>{
      if(arrivals>=2 || !sql.includes(fragment))return;
      if(!gate)gate=new Promise<void>((resolve,reject)=>{release=resolve;timeout=setTimeout(()=>reject(new Error("concurrent transaction did not reach the test gate")),5000);});
      arrivals++;if(arrivals===2){if(timeout)clearTimeout(timeout);release();}await gate;
    },
    assertReached:()=>assert.equal(arrivals,2,"both concurrent transactions must reach the lock gate"),
  };
}

test("real PostgreSQL serializable transactions prevent duplicate and stale finance writes",{timeout:120_000,skip:!pgBin},async t=>{
  if (!pgBin || !path.isAbsolute(pgBin) || !existsSync(path.join(pgBin,"initdb")) || !existsSync(path.join(pgBin,"postgres"))) throw new Error("FINANCE_TEST_PG_BIN must be an absolute local PostgreSQL bin directory");
  if (typeof process.getuid === "function" && process.getuid()===0) {t.skip("initdb requires an unprivileged OS user");return;}
  const tmp=mkdtempSync(path.join(os.tmpdir(),"selahtone-finance-native-"));const data=path.join(tmp,"data"),socket=path.join(tmp,"socket");mkdirSync(socket,{mode:0o700});
  let server:ChildProcess|undefined,pool:Pool|undefined;
  try {
    execFileSync(path.join(pgBin,"initdb"),["-D",data,"--no-locale","--encoding=UTF8","--auth-local=trust","--auth-host=reject","--username=finance_lab_test"],{env:process.env,stdio:"pipe",timeout:30_000});
    server=await startPostgres(pgBin,data,socket);
    pool=new Pool({host:socket,port:55432,user:"finance_lab_test",database:"postgres",max:8,connectionTimeoutMillis:5000});
    const init=await pool.connect();
    try {
      const settings=await init.query<{listen:string}>("SELECT current_setting('listen_addresses') AS listen");assert.equal(settings.rows[0].listen,"");
      await init.query("SET selahtone.finance_lab_test_only = 'yes'");await init.query(schema);
      await init.query(`INSERT INTO finance_lab.branches(id,name_ar) VALUES(1,'فرع اختبار');
        INSERT INTO finance_lab.users(id,branch_id,role_code,status,full_name) VALUES(1,NULL,'MANAGER','ACTIVE','مدير'),(2,NULL,'ACCOUNTANT','ACTIVE','محاسب'),(3,1,'CS_AGENT','ACTIVE','موظف أ'),(4,1,'CS_AGENT','ACTIVE','موظف ب')`);
    } finally {init.release();}
    const db=adapter(pool),oneOpening=opening("VAULT",null,"1000"),openingGate=overlapOn("FROM finance_lab.requests WHERE request_id");
    const racingOpening=adapter(pool,openingGate.beforeQuery);
    const [first,again]=await Promise.all([openAccount(racingOpening,"1",oneOpening,today),openAccount(racingOpening,"1",oneOpening,today)]);
    openingGate.assertReached();assert.equal(first.id,again.id);assert.equal(Number(first.replayed)+Number(again.replayed),1);
    const vault=first.id,c1=(await openAccount(db,"1",opening("CUSTODY","3","100"),today)).id,c2=(await openAccount(db,"2",opening("CUSTODY","4","100"),today)).id;
    const category=(await addCategory(db,"1",{requestId:request(),name:"صيانة وهمية"})).id;
    let paidExpenseId="";
    await t.test("two distinct concurrent transfers cannot both rely on an obsolete balance",async()=>{
      const input={fromId:vault,amount:"700",expectedBalance:"1000",actuallyTransferred:true,negativeAcknowledged:false};
      const gate=overlapOn("FROM finance_lab.accounts WHERE id=$1::bigint FOR UPDATE"),racing=adapter(pool!,gate.beforeQuery);
      const results=await Promise.allSettled([transferCash(racing,"1",{...input,requestId:request(),toId:c1}),transferCash(racing,"2",{...input,requestId:request(),toId:c2})]);
      gate.assertReached();assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
      const failure=results.find((r):r is PromiseRejectedResult=>r.status==="rejected")!;assert.equal(code(failure.reason),"balance_changed");
      const accounts=await listAccounts(db,"1");assert.equal(accounts.find(a=>a.id===vault)!.balance,"300.00");
      assert.equal(accounts.reduce((sum,a)=>sum+BigInt(a.balance.replace(".","")),0n),120_000n);
      assert.equal(Number((await pool!.query("SELECT count(*) AS n FROM finance_lab.movements WHERE kind='TRANSFER'")).rows[0].n),1);
    });
    await t.test("simultaneous identical transfer retries commit one movement",async()=>{
      const same={requestId:request(),fromId:vault,toId:c1,amount:"100",expectedBalance:"300",actuallyTransferred:true,negativeAcknowledged:false};
      const gate=overlapOn("FROM finance_lab.accounts WHERE id=$1::bigint FOR UPDATE"),racing=adapter(pool!,gate.beforeQuery);
      const results=await Promise.all([transferCash(racing,"1",same),transferCash(racing,"1",same)]);
      gate.assertReached();assert.equal(results[0].id,results[1].id);assert.equal(results.filter(r=>r.replayed).length,1);
      assert.equal((await listAccounts(db,"1")).find(a=>a.id===vault)!.balance,"200.00");
      assert.equal(Number((await pool!.query("SELECT count(*) AS n FROM finance_lab.movements WHERE kind='TRANSFER'")).rows[0].n),2);
    });
    await t.test("different cash expenses compete for the same reviewed balance without a silent overdraft",async()=>{
      const a=await createExpense(db,"1",draft(category,"150")),b=await createExpense(db,"2",draft(category,"150"));
      await approveExpense(db,"1",{requestId:request(),expenseId:a.id,expectedRevision:"1"});
      await approveExpense(db,"2",{requestId:request(),expenseId:b.id,expectedRevision:"1"});
      const common={expectedRevision:"2",method:"CASH",accountId:vault,paymentDate:"2026-10-21",actuallyPaid:true,expectedBalance:"200",negativeAcknowledged:false};
      const gate=overlapOn("FROM finance_lab.accounts WHERE id=$1::bigint FOR UPDATE"),racing=adapter(pool!,gate.beforeQuery);
      const results=await Promise.allSettled([payExpense(racing,"1",{...common,requestId:request(),expenseId:a.id},today),payExpense(racing,"2",{...common,requestId:request(),expenseId:b.id},today)]);
      gate.assertReached();assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
      const fail=results.find((r):r is PromiseRejectedResult=>r.status==="rejected")!;assert.equal(code(fail.reason),"balance_changed");
      assert.equal((await listAccounts(db,"1")).find(x=>x.id===vault)!.balance,"50.00");
      const saved=await pool!.query("SELECT status,count(*) AS n FROM finance_lab.expenses WHERE id=ANY($1::bigint[]) GROUP BY status",[[a.id,b.id]]);
      assert.deepEqual(Object.fromEntries(saved.rows.map(r=>[r.status,Number(r.n)])),{APPROVED:1,PAID:1});
      assert.equal(Number((await pool!.query("SELECT count(*) AS n FROM finance_lab.payments WHERE expense_id=ANY($1::bigint[])",[[a.id,b.id]])).rows[0].n),1);
    });
    await t.test("same approved expense cannot be paid twice across competing requests",async()=>{
      const item=await createExpense(db,"1",draft(category,"30"));paidExpenseId=item.id;await approveExpense(db,"1",{requestId:request(),expenseId:item.id,expectedRevision:"1"});
      const base={expenseId:item.id,expectedRevision:"2",method:"CASH",accountId:vault,paymentDate:"2026-10-21",actuallyPaid:true,expectedBalance:"50",negativeAcknowledged:false};
      const gate=overlapOn("FROM finance_lab.expenses WHERE id=$1::bigint FOR UPDATE"),racing=adapter(pool!,gate.beforeQuery);
      const out=await Promise.allSettled([payExpense(racing,"1",{...base,requestId:request()},today),payExpense(racing,"2",{...base,requestId:request()},today)]);
      gate.assertReached();assert.equal(out.filter(r=>r.status==="fulfilled").length,1);assert.equal(code((out.find(r=>r.status==="rejected") as PromiseRejectedResult).reason),"revision_changed");
      assert.equal((await listAccounts(db,"1")).find(x=>x.id===vault)!.balance,"20.00");
      assert.equal(Number((await pool!.query("SELECT count(*) AS n FROM finance_lab.payments WHERE expense_id=$1::bigint",[item.id])).rows[0].n),1);
    });
    await t.test("concurrent manual-review retries create one case and do not change the paid expense or balance",async()=>{
      assert.ok(paidExpenseId);const before=(await pool!.query("SELECT to_jsonb(e) AS expense FROM finance_lab.expenses e WHERE id=$1::bigint",[paidExpenseId])).rows[0].expense;
      const movementCount=Number((await pool!.query("SELECT count(*) AS n FROM finance_lab.movements")).rows[0].n);
      const same={requestId:request(),expenseId:paidExpenseId,expectedRevision:"3",reason:"مراجعة مبلغ وهمي",proposedAmount:"25"};
      const gate=overlapOn("FROM finance_lab.expenses WHERE id=$1::bigint FOR UPDATE"),racing=adapter(pool!,gate.beforeQuery);
      const result=await Promise.all([requestPaidExpenseReview(racing,"1",same),requestPaidExpenseReview(racing,"1",same)]);
      gate.assertReached();assert.equal(result[0].id,result[1].id);assert.equal(result.filter(r=>r.replayed).length,1);
      const reviews=await listPaidExpenseReviews(db,"2");assert.equal(reviews.length,1);assert.equal(reviews[0].proposedAmount,"25.00");
      const after=(await pool!.query("SELECT to_jsonb(e) AS expense FROM finance_lab.expenses e WHERE id=$1::bigint",[paidExpenseId])).rows[0].expense;
      assert.deepEqual(after,before);assert.equal((await listAccounts(db,"1")).find(x=>x.id===vault)!.balance,"20.00");
      assert.equal(Number((await pool!.query("SELECT count(*) AS n FROM finance_lab.movements")).rows[0].n),movementCount);
    });
    await t.test("concurrent identical attachment retries save one file and one audit",async()=>{
      const item=await createExpense(db,"1",draft(category,"10"));
      const file={name:"dummy.png",mediaType:"image/png",bytes:new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x01])};
      const same={requestId:request(),expenseId:item.id};const gate=overlapOn("FROM finance_lab.expenses WHERE id=$1::bigint FOR UPDATE"),racing=adapter(pool!,gate.beforeQuery);
      const result=await Promise.all([addExpenseAttachment(racing,"1",same,file),addExpenseAttachment(racing,"1",same,file)]);
      gate.assertReached();assert.equal(result[0].id,result[1].id);assert.equal(result.filter(r=>r.replayed).length,1);
      assert.deepEqual((await getExpenseAttachment(db,"2",item.id))?.bytes,file.bytes);
      assert.equal((await listExpenseAttachments(db,"1")).filter(a=>a.expenseId===item.id).length,1);
      assert.equal(Number((await pool!.query("SELECT count(*) AS n FROM finance_lab.audit_events WHERE entity_type='EXPENSE' AND entity_id=$1::bigint AND action='ATTACH'",[item.id])).rows[0].n),1);
    });
    await t.test("competing attachments cannot overwrite the first file or consume quota twice",async()=>{
      const item=await createExpense(db,"1",draft(category,"10"));
      const png={name:"one.png",mediaType:"image/png",bytes:new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])};
      const pdf={name:"two.pdf",mediaType:"application/pdf",bytes:new Uint8Array([0x25,0x50,0x44,0x46,0x2d,0x31])};
      const before=(await pool!.query("SELECT used_bytes,used_count FROM finance_lab.attachment_quota")).rows[0];
      const gate=overlapOn("FROM finance_lab.expenses WHERE id=$1::bigint FOR UPDATE"),racing=adapter(pool!,gate.beforeQuery);
      const out=await Promise.allSettled([addExpenseAttachment(racing,"1",{requestId:request(),expenseId:item.id},png),addExpenseAttachment(racing,"2",{requestId:request(),expenseId:item.id},pdf)]);
      gate.assertReached();assert.equal(out.filter(r=>r.status==="fulfilled").length,1);
      assert.equal(code((out.find(r=>r.status==="rejected") as PromiseRejectedResult).reason),"attachment_exists");
      const saved=await getExpenseAttachment(db,"1",item.id);assert(saved);
      const after=(await pool!.query("SELECT used_bytes,used_count FROM finance_lab.attachment_quota")).rows[0];
      assert.equal(after.used_count,before.used_count+1);assert.equal(after.used_bytes,before.used_bytes+saved.size);
    });
    await t.test("a concurrent reused request with changed file bytes is rejected",async()=>{
      const item=await createExpense(db,"1",draft(category,"10"));const same={requestId:request(),expenseId:item.id};
      const file={name:"same.png",mediaType:"image/png",bytes:new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x01])};
      const changed={...file,bytes:new Uint8Array([...file.bytes,0x02])};
      const gate=overlapOn("FROM finance_lab.expenses WHERE id=$1::bigint FOR UPDATE"),racing=adapter(pool!,gate.beforeQuery);
      const out=await Promise.allSettled([addExpenseAttachment(racing,"1",same,file),addExpenseAttachment(racing,"1",same,changed)]);
      gate.assertReached();assert.equal(out.filter(r=>r.status==="fulfilled").length,1);
      assert.equal(code((out.find(r=>r.status==="rejected") as PromiseRejectedResult).reason),"request_conflict");
      assert.equal((await listExpenseAttachments(db,"1")).filter(a=>a.expenseId===item.id).length,1);
      assert.equal(Number((await pool!.query("SELECT count(*) AS n FROM finance_lab.requests WHERE request_id=$1::uuid",[same.requestId])).rows[0].n),1);
    });
    await t.test("two distinct uploads contend safely for the final space in the demo quota",async()=>{
      const first=await createExpense(db,"1",draft(category,"10")),second=await createExpense(db,"2",draft(category,"10"));
      const file={name:"quota.png",mediaType:"image/png",bytes:new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])};
      // Synthetic quota occupancy; no real files or external storage involved.
      await pool!.query("UPDATE finance_lab.attachment_quota SET used_bytes=19999992 WHERE singleton=1");
      const gate=overlapOn("UPDATE finance_lab.attachment_quota SET"),racing=adapter(pool!,gate.beforeQuery);
      const out=await Promise.allSettled([addExpenseAttachment(racing,"1",{requestId:request(),expenseId:first.id},file),addExpenseAttachment(racing,"2",{requestId:request(),expenseId:second.id},file)]);
      gate.assertReached();assert.equal(out.filter(r=>r.status==="fulfilled").length,1);
      assert.equal(code((out.find(r=>r.status==="rejected") as PromiseRejectedResult).reason),"attachment_quota");
      assert.equal((await pool!.query("SELECT used_bytes FROM finance_lab.attachment_quota")).rows[0].used_bytes,20000000);
      assert.equal(Number((await pool!.query("SELECT count(*) AS n FROM finance_lab.expense_attachments WHERE expense_id=ANY($1::bigint[])",[[first.id,second.id]])).rows[0].n),1);
    });
    await t.test("different concurrent review requests leave only one open case",async()=>{
      const item=await createExpense(db,"1",draft(category,"10"));await approveExpense(db,"1",{requestId:request(),expenseId:item.id,expectedRevision:"1"});
      await payExpense(db,"1",{requestId:request(),expenseId:item.id,expectedRevision:"2",method:"CARD",accountId:null,paymentDate:"2026-10-21",actuallyPaid:true,expectedBalance:null},today);
      const base={expenseId:item.id,expectedRevision:"3",reason:"مراجعة يدوية للاختبار",proposedAmount:"8"};
      const gate=overlapOn("FROM finance_lab.expenses WHERE id=$1::bigint FOR UPDATE"),racing=adapter(pool!,gate.beforeQuery);
      const out=await Promise.allSettled([requestPaidExpenseReview(racing,"1",{...base,requestId:request()}),requestPaidExpenseReview(racing,"2",{...base,requestId:request()})]);
      gate.assertReached();assert.equal(out.filter(r=>r.status==="fulfilled").length,1);
      assert.equal(code((out.find(r=>r.status==="rejected") as PromiseRejectedResult).reason),"review_exists");
      assert.equal((await listPaidExpenseReviews(db,"1")).filter(r=>r.expenseId===item.id).length,1);
      assert.equal((await listAccounts(db,"1")).find(x=>x.id===vault)!.balance,"20.00");
    });
    // New accounts isolate these interleavings from the earlier native tests.
    const branchVault=async (branchId:string,amount="100")=>{
      await pool!.query("INSERT INTO finance_lab.branches(id,name_ar) VALUES($1::bigint,'فرع تزامن وهمي')",[branchId]);
      return (await openAccount(db,"1",{requestId:request(),branchId,kind:"VAULT",holderId:null,openingAmount:amount,openingDate:"2026-10-20",counted:true},today)).id;
    };
    const rawCount=(accountId:string,expectedBalance:string,countedAmount:string)=>({requestId:request(),accountId,expectedBalance,countedAmount,reason:"جرد متزامن",actuallyCounted:true});
    const rawConfirm=(countId:string)=>({requestId:request(),countId,reason:"تأكيد جرد متزامن",stillCurrent:true});
    const rawCorrection=(reviewId:string,confirmedAmount:string,expectedBalance:string)=>({requestId:request(),reviewId,confirmedAmount,expectedBalance,reason:"تصحيح متزامن",verifiedPayment:true,noPriorSettlement:true});
    const branchExpense=async(branchId:string,amount:string)=>{
      const item=await createExpense(db,"1",{...draft(category,amount),branchId});
      await approveExpense(db,"1",{requestId:request(),expenseId:item.id,expectedRevision:"1"});return item.id;
    };
    const payAt=async(expenseId:string,accountId:string,expectedBalance:string)=>payExpense(db,"1",{requestId:request(),expenseId,expectedRevision:"2",method:"CASH",accountId,paymentDate:"2026-10-21",actuallyPaid:true,expectedBalance},today);
    const reviewAt=async(expenseId:string)=>requestPaidExpenseReview(db,"1",{requestId:request(),expenseId,expectedRevision:"3",reason:"تدقيق الدفع الوهمي",proposedAmount:"10"});
    await t.test("concurrent count creation and confirmation retry only once; competing confirmations never double settle",async()=>{
      const a=await branchVault("2"),same=rawCount(a,"100","90");
      let gate=overlapOn("FROM finance_lab.accounts WHERE id=$1::bigint FOR UPDATE"),racing=adapter(pool!,gate.beforeQuery);
      const opened=await Promise.all([requestCashCount(racing,"1",same,today),requestCashCount(racing,"1",same,today)]);
      gate.assertReached();assert.equal(opened[0].id,opened[1].id);assert.equal(opened.filter(x=>x.replayed).length,1);
      assert.equal((await listAccounts(db,"1")).find(x=>x.id===a)!.balance,"100.00");
      const yes=rawConfirm(opened[0].id);gate=overlapOn("FROM finance_lab.accounts WHERE id=$1::bigint FOR UPDATE");racing=adapter(pool!,gate.beforeQuery);
      const confirmed=await Promise.all([confirmCashCount(racing,"1",yes),confirmCashCount(racing,"1",yes)]);
      gate.assertReached();assert.equal(confirmed[0].id,confirmed[1].id);assert.equal(confirmed.filter(x=>x.replayed).length,1);
      assert.equal((await listAccounts(db,"1")).find(x=>x.id===a)!.balance,"90.00");
      const next=await requestCashCount(db,"1",rawCount(a,"90","80"),today);
      gate=overlapOn("FROM finance_lab.accounts WHERE id=$1::bigint FOR UPDATE");racing=adapter(pool!,gate.beforeQuery);
      const results=await Promise.allSettled([confirmCashCount(racing,"1",rawConfirm(next.id)),confirmCashCount(racing,"2",rawConfirm(next.id))]);
      gate.assertReached();assert.equal(results.filter(x=>x.status==="fulfilled").length,1);assert.equal(code((results.find(x=>x.status==="rejected") as PromiseRejectedResult).reason),"count_closed");
      assert.equal((await listAccounts(db,"1")).find(x=>x.id===a)!.balance,"80.00");
      assert.equal(Number((await pool!.query("SELECT count(*) AS n FROM finance_lab.movements WHERE cash_count_id=$1::bigint",[next.id])).rows[0].n),1);
    });
    await t.test("a transfer racing count confirmation commits one and invalidates the other",async()=>{
      const a=(await listAccounts(db,"1")).find(x=>x.branchId==="2")!.id;
      await pool!.query("INSERT INTO finance_lab.users(id,branch_id,role_code,status,full_name) VALUES(5,2,'CS_AGENT','ACTIVE','عهدة وهمية')");
      const b=(await openAccount(db,"1",{requestId:request(),branchId:"2",kind:"CUSTODY",holderId:"5",openingAmount:"0",openingDate:"2026-10-20",counted:true},today)).id;
      const count=await requestCashCount(db,"1",rawCount(a,"80","70"),today);
      const gate=overlapOn("FROM finance_lab.accounts WHERE id=$1::bigint FOR UPDATE"),racing=adapter(pool!,gate.beforeQuery);
      const results=await Promise.allSettled([confirmCashCount(racing,"1",rawConfirm(count.id)),transferCash(racing,"2",{requestId:request(),fromId:a,toId:b,amount:"10",expectedBalance:"80",actuallyTransferred:true})]);
      gate.assertReached();assert.equal(results.filter(x=>x.status==="fulfilled").length,1);assert.ok(["count_stale","balance_changed"].includes(code((results.find(x=>x.status==="rejected") as PromiseRejectedResult).reason)!));
      assert.equal((await listAccounts(db,"1")).find(x=>x.id===a)!.balance,"70.00");
      const row=(await listCashCounts(db,"1")).find(x=>x.id===count.id)!;
      if(row.status==="OPEN") await cancelCashCount(db,"1",{requestId:request(),countId:count.id,reason:"حدث تسليم بعد الجرد"});
    });
    await t.test("a count racing a paid correction cannot both book the same ambiguous difference",async()=>{
      const a=await branchVault("3"),expenseId=await branchExpense("3","20");await payAt(expenseId,a,"100");
      const review=await reviewAt(expenseId),count=await requestCashCount(db,"1",rawCount(a,"80","85"),today);
      const gate=overlapOn("FROM finance_lab.accounts WHERE id=$1::bigint FOR UPDATE"),racing=adapter(pool!,gate.beforeQuery);
      const out=await Promise.allSettled([confirmCashCount(racing,"1",rawConfirm(count.id)),confirmPaidExpenseCorrection(racing,"2",rawCorrection(review.id,"10","80"))]);
      gate.assertReached();assert.equal(out.filter(x=>x.status==="fulfilled").length,1);const reason=code((out.find(x=>x.status==="rejected") as PromiseRejectedResult).reason);
      assert.ok(["count_stale","count_overlap"].includes(reason!),String(reason));
      const n=Number((await pool!.query("SELECT count(*) AS n FROM finance_lab.movements WHERE (cash_count_id=$1::bigint OR expense_correction_id IN (SELECT id FROM finance_lab.expense_corrections WHERE review_id=$2::bigint))",[count.id,review.id])).rows[0].n);assert.equal(n,1);
      const balance=(await listAccounts(db,"1")).find(x=>x.id===a)!.balance;assert.ok(balance==="85.00"||balance==="90.00");
    });
    await t.test("duplicate concurrent paid-correction confirmations create one immutable correction",async()=>{
      const a=await branchVault("4"),expenseId=await branchExpense("4","20");await payAt(expenseId,a,"100");const review=await reviewAt(expenseId),same=rawCorrection(review.id,"10","80");
      const gate=overlapOn("FROM finance_lab.expenses WHERE id=$1::bigint FOR UPDATE"),racing=adapter(pool!,gate.beforeQuery);
      const out=await Promise.all([confirmPaidExpenseCorrection(racing,"1",same),confirmPaidExpenseCorrection(racing,"1",same)]);
      gate.assertReached();assert.equal(out[0].id,out[1].id);assert.equal(out.filter(x=>x.replayed).length,1);
      assert.equal((await listAccounts(db,"1")).find(x=>x.id===a)!.balance,"90.00");
      assert.equal(Number((await pool!.query("SELECT count(*) AS n FROM finance_lab.expense_corrections WHERE review_id=$1::bigint",[review.id])).rows[0].n),1);
      assert.equal(Number((await pool!.query("SELECT count(*) AS n FROM finance_lab.movements WHERE expense_correction_id=$1::bigint",[out[0].id])).rows[0].n),1);
    });
    await t.test("concurrent closure and paid correction cannot both resolve the same review",async()=>{
      const a=await branchVault("6"),expenseId=await branchExpense("6","20");await payAt(expenseId,a,"100");const review=await reviewAt(expenseId);
      const gate=overlapOn("FROM finance_lab.expenses WHERE id=$1::bigint FOR UPDATE"),racing=adapter(pool!,gate.beforeQuery);
      const out=await Promise.allSettled([confirmPaidExpenseCorrection(racing,"1",rawCorrection(review.id,"10","80")),closePaidExpenseReview(racing,"2",{requestId:request(),reviewId:review.id,reason:"إغلاق دون تعديل بعد الفحص"})]);
      gate.assertReached();assert.equal(out.filter(x=>x.status==="fulfilled").length,1);assert.equal(code((out.find(x=>x.status==="rejected") as PromiseRejectedResult).reason),"review_closed");
      const status=(await pool!.query("SELECT status FROM finance_lab.expense_reviews WHERE id=$1::bigint",[review.id])).rows[0].status;
      const corrections=Number((await pool!.query("SELECT count(*) AS n FROM finance_lab.expense_corrections WHERE review_id=$1::bigint",[review.id])).rows[0].n);
      assert.equal(corrections,status==="CORRECTED"?1:0);assert.equal((await listAccounts(db,"1")).find(x=>x.id===a)!.balance,status==="CORRECTED"?"90.00":"80.00");
    });
    await t.test("a late-recorded actual payment racing a newer count cannot be double debited",async()=>{
      const a=await branchVault("5"),expenseId=await branchExpense("5","20"),count=await requestCashCount(db,"1",rawCount(a,"100","100"),today);
      const payment={requestId:request(),expenseId,expectedRevision:"2",method:"CASH",accountId:a,paymentDate:"2026-10-28",actuallyPaid:true,expectedBalance:"100"};
      const gate=overlapOn("FROM finance_lab.accounts WHERE id=$1::bigint FOR UPDATE"),racing=adapter(pool!,gate.beforeQuery);
      const out=await Promise.allSettled([confirmCashCount(racing,"1",rawConfirm(count.id)),payExpense(racing,"2",payment,today)]);
      gate.assertReached();assert.equal(out.filter(x=>x.status==="fulfilled").length,1);assert.ok(["count_stale","count_overlap"].includes(code((out.find(x=>x.status==="rejected") as PromiseRejectedResult).reason)!));
      assert.ok(["80.00","100.00"].includes((await listAccounts(db,"1")).find(x=>x.id===a)!.balance));
    });
  } finally {if(pool)await pool.end();if(server)await stopPostgres(server);rmSync(tmp,{recursive:true,force:true});}
});
