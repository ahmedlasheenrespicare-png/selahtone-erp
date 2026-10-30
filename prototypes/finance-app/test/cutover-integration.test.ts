/**
 * Launched only from a temporary copy by run.mjs --test-cutover. It uses the
 * actual finance LAB engine and LAB commerce bridge, never production or Neon.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import type { PrismaClient } from "@prisma/client";
import { PrismaClient as TestClient } from "../.finance-client";
import { createCommerceSale, recordCommerceCollection, recordCommerceRefund, recordHistoricalCollection, recordHistoricalRefund, returnCommerceSale } from "../src/lib/commerce-operations";
import { financeTx, sqlError } from "../src/lib/finance-bridge";
import { InventoryProblem } from "../src/lib/inventory-operations";
import { addCategory, openAccount, listAccounts, createExpense, approveExpense, payExpense, transferCash, requestCashCount, confirmCashCount } from "../prototypes/finance-engine/engine";
import { FinanceProblem, type FinanceDatabase } from "../prototypes/finance-engine/types";
import { cairoDate } from "../prototypes/finance-engine/validation";
import { FixtureCommitOutcomeUnknown, ownedFixtureTransaction, type CleanupObservation } from "../prototypes/finance-cutover/owned-prisma.test-only";

const read=(file:string)=>readFileSync(file,"utf8"), req=()=>randomUUID(), port=55436;
const cutover=read("prototypes/finance-cutover/schema.test-only.sql"), bridge=read("prototypes/finance-cutover/lab-bridge.test-only.sql");
const fixtures=["tests/fixtures/inventory-baseline.sql","prisma/manual-inventory-upgrade.sql","prisma/manual-receiving-upgrade.sql","prisma/manual-commerce-upgrade.sql","tests/fixtures/finance-legacy-categories.sql","tests/fixtures/finance-cutover.sql"];
const saleInput=(method="CARD",account="",payment="10")=>({requestId:req(),warehouseId:"1",customerName:"عميل مختبر وهمي",customerPhone:"01000000000",discount:"0",initialPayment:payment,method,
 cashAccountId:method==="CASH"?account:"",cashCheckpointRef:method==="CASH"?"OPENING":"",afterCheckpoint:method==="CASH",
 lines:[{productId:"2",quantity:"2",serialIds:[],expectedUnitPrice:"20",expectedTaxRateId:3,expectedTaxKind:"EXEMPT",expectedTaxRate:"0"}]});
const money=(saleId:string,amount:string,method:string,account="",actuallyPaid=false,expectedBalance="",checkpoint="OPENING")=>({requestId:req(),saleId,amount,method,cashAccountId:account,actuallyPaid,expectedBalance,negativeAcknowledged:false,
 cashCheckpointRef:method==="CASH"?checkpoint:"",afterCheckpoint:method==="CASH"});
const opening=(kind:"VAULT"|"CUSTODY",holderId:string|null,amount:string)=>({requestId:req(),branchId:"1",kind,holderId,openingAmount:amount,openingDate:"2026-10-20",counted:true});
const dbPort=(client:PrismaClient):FinanceDatabase=>({serializable:async work=>{
 try{return await client.$transaction(tx=>work(financeTx(tx)),{isolationLevel:"Serializable",maxWait:5000,timeout:20000});}catch(error){return sqlError(error);}
}});
function clientFor(pool:Pool):PrismaClient{return new TestClient({adapter:new PrismaPg(pool) as never}) as unknown as PrismaClient;}
function startPostgres(bin:string,data:string,socket:string):Promise<ChildProcess>{
 const child=spawn(path.join(bin,"postgres"),["-D",data,"-k",socket,"-h","","-p",String(port),"-c","unix_socket_permissions=0700"],{stdio:["ignore","ignore","pipe"],env:process.env});
 return new Promise((resolve,reject)=>{let logs="",done=false;const timer=setTimeout(()=>{if(!done){done=true;child.kill("SIGKILL");reject(new Error("temporary PostgreSQL did not start"));}},30_000);
  child.stderr?.on("data",part=>{logs=(logs+String(part)).slice(-4000);if(!done&&logs.includes("database system is ready to accept connections")){done=true;clearTimeout(timer);resolve(child);}});
  child.once("error",e=>{if(!done){done=true;clearTimeout(timer);reject(e);}});child.once("exit",c=>{if(!done){done=true;clearTimeout(timer);reject(new Error(`PostgreSQL exited ${c}: ${logs}`));}});
 });
}
async function stopPostgres(child:ChildProcess):Promise<void>{
 if(child.exitCode!==null||child.signalCode!==null)return;const ended=new Promise<void>(r=>child.once("exit",()=>r()));child.kill("SIGTERM");
 let timer:NodeJS.Timeout|undefined;const ok=await Promise.race([ended.then(()=>true),new Promise<boolean>(r=>{timer=setTimeout(()=>r(false),5000);})]);
 if(timer)clearTimeout(timer);if(!ok){child.kill("SIGKILL");await ended;}
}
async function waitFor(admin:Pool,sql:string,args:unknown[]):Promise<void>{
 const deadline=Date.now()+8000;while(Date.now()<deadline){if((await admin.query<{ready:boolean}>(sql,args)).rows[0]?.ready)return;await new Promise(r=>setTimeout(r,20));}
 throw new Error("the expected local transaction state was not reached");
}
async function rejectsMessage(fn:()=>Promise<unknown>,pattern:RegExp){await assert.rejects(fn,(error:unknown)=>{
 const match=pattern.test(String(error))||pattern.test(JSON.stringify(error,Object.getOwnPropertyNames(error??{})));
 if(!match)console.error("Unexpected rejection:",error);return match;
},`expected ${pattern}`);}
async function rejectsUnknownCommit(fn:()=>Promise<unknown>,cause:RegExp){await assert.rejects(fn,(error:unknown)=>
 error instanceof FixtureCommitOutcomeUnknown&&cause.test(String(error.cause)),`expected unknown commit with cause ${cause}`);}

/** Only this test proxy grants the cutover permit. Each interactive transaction
 * gets its own disposable 1-connection pool; no shared app connection is owned. */
function scopedClient(base:PrismaClient,socket:string,observations:CleanupObservation[]){
 let loseAfterCommit=false;
 const client=new Proxy(base,{get(target,key){
  if(key!=="$transaction"){const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;}
  return async (work:(tx:unknown)=>Promise<unknown>,options:unknown)=>{
   const result=await ownedFixtureTransaction(socket,port,adapter=>new TestClient({adapter:adapter as never}) as unknown as PrismaClient,
    async tx=>{await tx.$executeRawUnsafe("SELECT finance_cutover_test.begin_new_transaction()");return work(tx);},
    options as never,value=>observations.push(value));
   // Simulates losing an application response AFTER an acknowledged commit. It
   // does not simulate a network failure during PostgreSQL COMMIT itself.
   if(loseAfterCommit){loseAfterCommit=false;throw new Error("SIMULATED_LOST_RESPONSE_AFTER_COMMIT");}return result;
  };
 }}) as PrismaClient;
 return {client,loseNextResponse:()=>{loseAfterCommit=true;}};
}

test("lab bridge refuses installation without separate test opt-ins",async()=>{
 const pg=new PGlite();try{
  await assert.rejects(()=>pg.exec(bridge),/separately opted-in disposable database/);
  assert.equal((await pg.query<{ns:string|null}>("SELECT to_regnamespace('finance_cutover_test')::text AS ns")).rows[0].ns,null);
 }finally{await pg.close();}
});

const pgBin=process.env.FINANCE_TEST_PG_BIN;
test("disposable PostgreSQL: cutover guard and actual finance LAB operations",{timeout:180_000,skip:!pgBin},async t=>{
 if(!pgBin||!path.isAbsolute(pgBin)||!existsSync(path.join(pgBin,"initdb"))||!existsSync(path.join(pgBin,"postgres")))throw new Error("FINANCE_TEST_PG_BIN must name a local PostgreSQL bin directory");
 if(process.getuid?.()===0){t.skip("initdb requires an unprivileged system user");return;}
 const tmp=mkdtempSync(path.join(os.tmpdir(),"selahtone-cutover-")),data=path.join(tmp,"data"),socket=path.join(tmp,"socket");mkdirSync(socket,{mode:0o700});
 let child:ChildProcess|undefined,admin:Pool|undefined,legacy:Pool|undefined,next:Pool|undefined,legacyClient:PrismaClient|undefined,base:PrismaClient|undefined;
 try{
  execFileSync(path.join(pgBin,"initdb"),["-D",data,"--no-locale","--encoding=UTF8","--auth-local=trust","--auth-host=reject","--username=cutover_admin_test"],{env:process.env,stdio:"pipe",timeout:30_000});
  child=await startPostgres(pgBin,data,socket);
  const config={host:socket,port,database:"postgres",max:8,connectionTimeoutMillis:5000};admin=new Pool({...config,user:"cutover_admin_test"});
  const setup=await admin.connect();try{
   assert.equal((await setup.query("SHOW listen_addresses")).rows[0].listen_addresses,"");
   for(const file of fixtures)await setup.query(read(file));
   await setup.query(`INSERT INTO public.tax_rates(code,name_ar,rate,kind,effective_from,is_active) VALUES('CUTOVER-LAB-EX','ضريبة وهمية',0,'EXEMPT','2000-01-01',TRUE);
    UPDATE public.products SET sale_price=20,tax_rate_id=3 WHERE id=2;
    INSERT INTO public.stock_levels(warehouse_id,product_id,qty_on_hand,avg_cost) VALUES(1,2,100,4);
    SET selahtone.finance_lab_test_only='yes';`);
   await setup.query(read("prototypes/finance-engine/schema.test-only.sql"));
   await setup.query(`INSERT INTO finance_lab.branches(id,name_ar,is_active) SELECT id,name_ar,is_active FROM public.branches;
    INSERT INTO finance_lab.users(id,branch_id,role_code,status,must_change_password,full_name)
    SELECT id,branch_id,role_code::text,status::text,must_change_password,full_name FROM public.users;
    CREATE ROLE cutover_legacy_test LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS;
    CREATE ROLE cutover_new_test LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS;
    REVOKE CREATE ON SCHEMA public FROM PUBLIC;
    GRANT USAGE ON SCHEMA public,finance_cutover_fixture,finance_lab TO cutover_legacy_test,cutover_new_test;
    GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public,finance_cutover_fixture,finance_lab TO cutover_legacy_test,cutover_new_test;
    REVOKE INSERT,UPDATE,DELETE ON public.users,public.branches,finance_lab.users,finance_lab.branches FROM cutover_legacy_test,cutover_new_test;
    GRANT UPDATE(last_login_at) ON public.users TO cutover_legacy_test,cutover_new_test;
    GRANT UPDATE(phone) ON public.branches TO cutover_legacy_test,cutover_new_test;
    GRANT UPDATE(full_name) ON finance_lab.users TO cutover_legacy_test,cutover_new_test;
    GRANT UPDATE(name_ar) ON finance_lab.branches TO cutover_legacy_test,cutover_new_test;
    GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public,finance_cutover_fixture,finance_lab TO cutover_legacy_test,cutover_new_test;`);
   await setup.query("BEGIN");await setup.query("SET LOCAL selahtone.finance_cutover_test_only='yes'; SET LOCAL selahtone.finance_cutover_lab_test_only='yes'");
   await setup.query(cutover);await setup.query(bridge);await setup.query("COMMIT");
  }finally{await setup.query("ROLLBACK").catch(()=>{});setup.release();}
  legacy=new Pool({...config,user:"cutover_legacy_test"});next=new Pool({...config,user:"cutover_new_test"});legacyClient=clientFor(legacy);base=clientFor(next);
  const stats:CleanupObservation[]=[],scoped=scopedClient(base,socket,stats),app=scoped.client,finance=dbPort(app);
  const balance=async(id:string)=>(await listAccounts(finance,"1")).find(a=>a.id===id)!.balance;
  const snapshot=async()=> (await admin!.query(`SELECT
   (SELECT count(*)::int FROM public.commerce_sales) AS sales,(SELECT count(*)::int FROM public.commerce_collections) AS collections,
   (SELECT count(*)::int FROM public.commerce_refunds) AS refunds,(SELECT count(*)::int FROM finance_lab.movements) AS movements,
   (SELECT count(*)::int FROM finance_lab.historical_commerce) AS historical,(SELECT count(*)::int FROM finance_lab.payments) AS payments,
   (SELECT qty_on_hand::text FROM public.stock_levels WHERE warehouse_id=1 AND product_id=2) AS stock`)).rows[0];
  const transition=async(revision:number,from:string,to:string)=>admin!.query("SELECT * FROM finance_cutover_test.transition($1::uuid,$2,$3,$4,'انتقال تجريبي')",[req(),revision,from,to]);
  let due="",credit="",vault="",custody="",countId="",cashSale="";

  await t.test("legacy works before freeze; freeze blocks the real LAB commerce and finance paths",async()=>{
   due=(await createCommerceSale(legacyClient!,3n,saleInput())).id;
   credit=(await createCommerceSale(legacyClient!,1n,saleInput("CARD","","40"))).id;
   await returnCommerceSale(legacyClient!,1n,{requestId:req(),saleId:credit,cancel:true,accepted:true,lines:[]});
   await transition(1,"LEGACY","FROZEN");const before=await snapshot();
   await assert.rejects(()=>createCommerceSale(legacyClient!,3n,saleInput()));
   await assert.rejects(()=>openAccount(dbPort(legacyClient!),"1",opening("VAULT",null,"100"),"2026-10-29"));
   assert.deepEqual(await snapshot(),before);
   assert.equal(Number((await admin!.query("SELECT count(*) FROM pg_trigger WHERE tgname='finance_cutover_lab_guard' AND NOT tgisinternal")).rows[0].count),18);
   await transition(2,"FROZEN","NEW");
   await assert.rejects(()=>createCommerceSale(base!,3n,saleInput()));
  });
  await t.test("owned pools reclaim repeated deferred-COMMIT failures and leave all data unchanged",async()=>{
   const before=await snapshot(),start=stats.length;
   for(let i=0;i<10;i++)await rejectsUnknownCommit(()=>app.$transaction(async tx=>{
    await tx.commerceCollection.create({data:{requestId:req(),requestHash:"a".repeat(64),saleId:BigInt(due),amount:"1",method:"CASH",isInitial:false,createdById:2n}});
   }),/FINANCE_LAB_CASH_LINK_REQUIRED/);
   assert.deepEqual(await snapshot(),before);const trials=stats.slice(start);assert.equal(trials.length,10);
   assert(trials.every(x=>x.checkedOutAfterTransaction===1&&x.destroyed===1&&x.totalAfterClose===0));
   await waitFor(admin!,"SELECT NOT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=$1) AS ready",["finance-owned-cutover-test"]);
  });
  await t.test("a terminated backend during deferred COMMIT is destroyed; a fresh transaction still works",async()=>{
   await admin!.query(`CREATE FUNCTION finance_lab.wait_during_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(30);RETURN NULL;END $$;
    CREATE CONSTRAINT TRIGGER wait_during_commit AFTER INSERT ON finance_lab.audit_events DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW WHEN (NEW.action='WAIT_COMMIT') EXECUTE FUNCTION finance_lab.wait_during_commit()`);
   let tellPid!:(pid:number)=>void;const pidReady=new Promise<number>(r=>{tellPid=r;});const before=await snapshot(),start=stats.length;
   try{
    const work=app.$transaction(async tx=>{
     const row=await tx.$queryRawUnsafe<Array<{pid:number}>>("SELECT pg_backend_pid() AS pid");tellPid(row[0].pid);
     await tx.$executeRawUnsafe(`INSERT INTO finance_lab.audit_events(entity_type,entity_id,action,actor_id) VALUES('TEST',1,'WAIT_COMMIT',1)`);
    });
    void work.catch(()=>{});const pid=await Promise.race([pidReady,work.then(()=>{throw new Error("transaction unexpectedly finished");})]);
    await waitFor(admin!,"SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND wait_event='PgSleep') AS ready",[pid]);
    await admin!.query("SELECT pg_terminate_backend($1)",[pid]);await assert.rejects(()=>work,(e:unknown)=>e instanceof FixtureCommitOutcomeUnknown);
    assert.equal(stats.length,start+1);assert.equal(stats[start].totalAfterClose,0);
    assert.deepEqual(await snapshot(),before);
    assert.equal(Number((await admin!.query("SELECT count(*) FROM finance_lab.audit_events WHERE action='WAIT_COMMIT'")).rows[0].count),0);
    await app.$transaction(async tx=>{await tx.$executeRawUnsafe("SELECT 1");});
    assert.equal(stats.at(-1)?.totalAfterClose,0);
   }finally{await admin!.query("DROP TRIGGER wait_during_commit ON finance_lab.audit_events; DROP FUNCTION finance_lab.wait_during_commit()");}
  });
  await t.test("real engine opens management-only accounts and sale/collection/refund use the right cash holders",async()=>{
   await assert.rejects(()=>openAccount(finance,"3",opening("VAULT",null,"100"),"2026-10-29"),(e:unknown)=>e instanceof FinanceProblem&&e.code==="forbidden");
   vault=(await openAccount(finance,"1",opening("VAULT",null,"100"),"2026-10-29")).id;
   custody=(await openAccount(finance,"2",opening("CUSTODY","3","30"),"2026-10-29")).id;
   const request=saleInput("CASH",custody),created=await createCommerceSale(app,3n,request);cashSale=created.id;
   assert.equal(await balance(custody),"40.00");assert.equal((await createCommerceSale(app,3n,request)).replayed,true);
   await assert.rejects(()=>createCommerceSale(app,3n,{...request,cashAccountId:vault}),InventoryProblem);
   await recordCommerceCollection(app,3n,money(due,"2","CASH",vault));assert.equal(await balance(vault),"102.00");
   const before=await snapshot();await recordCommerceCollection(app,3n,money(due,"3","CARD"));assert.equal((await snapshot()).movements,before.movements);
   await recordCommerceRefund(app,2n,money(credit,"4","CASH",vault,true,"102"));assert.equal(await balance(vault),"98.00");
   const rows=(await admin!.query(`SELECT kind,external_ref,after_opening,after_cash_count_id FROM finance_lab.movements WHERE kind IN ('COLLECTION','REFUND') ORDER BY id`)).rows;
   assert.equal(rows.length,3);assert(rows.every(r=>r.after_opening&&r.after_cash_count_id===null));
  });
  await t.test("same-day historical collection and refund retain attestations, update the invoice and never move cash twice",async()=>{
   const historical=(saleId:string,refund:boolean)=>({requestId:req(),saleId,amount:"1",method:"CASH",actuallyPaid:refund,cashAccountId:vault,
    actualDate:"2026-10-20",checkpointType:"OPENING",checkpointCountId:null,handler:"حائز وهمي",reason:"مراجعة وهمية",verifiedActual:true,beforeCheckpoint:true,includedInCheckpoint:true,notPreviouslyRecorded:true});
   const incoming=historical(due,false),outgoing=historical(credit,true),before=await snapshot(),start=await balance(vault);
   await assert.rejects(()=>recordHistoricalCollection(app,3n,incoming));
   const first=await recordHistoricalCollection(app,1n,incoming);assert.equal((await recordHistoricalCollection(app,1n,incoming)).replayed,true);
   await recordHistoricalRefund(app,2n,outgoing);
   assert.equal(await balance(vault),start);const after=await snapshot();assert.equal(after.movements,before.movements);assert.equal(after.historical,before.historical+2);
   const entries=(await admin!.query(`SELECT event_type,verified_actual,before_checkpoint,included_in_checkpoint,not_previously_recorded FROM finance_lab.historical_commerce ORDER BY id`)).rows;
   assert.equal(entries.length,2);assert(entries.every(x=>x.verified_actual&&x.before_checkpoint&&x.included_in_checkpoint&&x.not_previously_recorded));
   assert.equal(first.replayed,false);
  });
  await t.test("expense cash, historical cash and noncash use the engine and preserve actual-payment attestations",async()=>{
   const category=(await addCategory(finance,"1",{requestId:req(),name:"بند وهمي"})).id;
   const draft=async(amount:string)=>{const d=await createExpense(finance,"1",{requestId:req(),branchId:"1",categoryId:category,amount,expenseDate:"2026-10-21",description:"مصروف مختبر",beneficiary:"",documentNumber:"",taxAmount:""});
    await approveExpense(finance,"1",{requestId:req(),expenseId:d.id,expectedRevision:"1"});return d.id;};
   const current=await balance(vault),cash=await draft("15"),before=await snapshot();
   const cashResult=await payExpense(finance,"2",{requestId:req(),expenseId:cash,expectedRevision:"2",method:"CASH",accountId:vault,paymentDate:"2026-10-21",actuallyPaid:true,expectedBalance:current,negativeAcknowledged:false},"2026-10-29");
   assert.equal((await snapshot()).movements,before.movements+1);assert.equal(await balance(vault),"83.00");
   const historical=await draft("7"),prior=await snapshot();
   const historyResult=await payExpense(finance,"1",{requestId:req(),expenseId:historical,expectedRevision:"2",method:"CASH",accountId:vault,paymentDate:"2026-10-20",openingOrder:"BEFORE",includedInOpening:true,actuallyPaid:true},"2026-10-29");
   assert.equal(await balance(vault),"83.00");assert.equal((await snapshot()).movements,prior.movements);
   const card=await draft("8");await payExpense(finance,"2",{requestId:req(),expenseId:card,expectedRevision:"2",method:"CARD",accountId:null,paymentDate:"2026-10-21",actuallyPaid:true},"2026-10-29");
   assert.equal((await snapshot()).movements,prior.movements);const rows=(await admin!.query(`SELECT id::text,actually_paid,historical,included_in_opening FROM finance_lab.payments ORDER BY id`)).rows;
   assert.equal(rows.length,3);assert(rows.every(p=>p.actually_paid));assert(rows.find(p=>p.id===historyResult.id)?.included_in_opening);assert(!rows.find(p=>p.id===cashResult.id)?.historical);
   const bypass=await draft("9"),snap=await snapshot();
   await rejectsUnknownCommit(()=>app.$transaction(async tx=>{
    await tx.$executeRawUnsafe(`INSERT INTO finance_lab.payments(expense_id,amount,method,account_id,payment_date,recorded_by,actually_paid,historical,included_in_opening)
     VALUES($1::bigint,9,'CASH',$2::bigint,'2026-10-21',1,TRUE,FALSE,FALSE)`,BigInt(bypass),BigInt(vault));
    await tx.$executeRawUnsafe("UPDATE finance_lab.expenses SET status='PAID',revision=revision+1 WHERE id=$1::bigint",BigInt(bypass));
   }),/FINANCE_LAB_PAYMENT_INVALID/);
   assert.deepEqual(await snapshot(),snap);assert.equal((await admin!.query("SELECT status FROM finance_lab.expenses WHERE id=$1::bigint",[bypass])).rows[0].status,"APPROVED");
  });
  await t.test("transfer and two-step count work under the gate, and the next cash event must use that count",async()=>{
   const before=await balance(vault),cashBefore=await balance(custody);
   await transferCash(finance,"1",{requestId:req(),fromId:vault,toId:custody,amount:"3",expectedBalance:before,actuallyTransferred:true,negativeAcknowledged:false});
   assert.equal(await balance(vault),"80.00");assert.equal(await balance(custody),(Number(cashBefore)+3).toFixed(2));
   const count=(await requestCashCount(finance,"1",{requestId:req(),accountId:vault,expectedBalance:"80",countedAmount:"82",reason:"جرد وهمي",actuallyCounted:true},"2026-10-29")).id;
   assert.equal(await balance(vault),"80.00");
   await confirmCashCount(finance,"1",{requestId:req(),countId:count,reason:"تأكيد وهمي",stillCurrent:true});countId=count;assert.equal(await balance(vault),"82.00");
   const snap=await snapshot();await assert.rejects(()=>recordCommerceCollection(app,3n,money(due,"1","CASH",vault)),(e:unknown)=>e instanceof FinanceProblem&&e.code==="checkpoint_changed");
   assert.deepEqual(await snapshot(),snap);
   await recordCommerceCollection(app,3n,money(due,"1","CASH",vault,false,"",countId));assert.equal(await balance(vault),"83.00");
  });
  await t.test("a lost response after commit is retried with the SAME sale request without a second movement",async()=>{
   const input=saleInput("CASH",custody),before=await snapshot(),initial=await balance(custody);
   scoped.loseNextResponse();await rejectsMessage(()=>createCommerceSale(app,3n,input),/SIMULATED_LOST_RESPONSE_AFTER_COMMIT/);
   const committed=await snapshot(),after=await balance(custody);assert.equal(committed.sales,before.sales+1);assert.equal(committed.movements,before.movements+1);
   assert.equal(after,(Number(initial)+10).toFixed(2));
   const again=await createCommerceSale(app,3n,input);assert.equal(again.replayed,true);assert.deepEqual(await snapshot(),committed);assert.equal(await balance(custody),after);
   await assert.rejects(()=>createCommerceSale(app,3n,{...input,cashAccountId:vault}),InventoryProblem);
  });
  await t.test("confirmed evidence is append-only and the activated gate cannot return to the legacy app",async()=>{
   const before=await snapshot();
   await rejectsMessage(()=>app.$transaction(async tx=>{await tx.$executeRawUnsafe("UPDATE finance_lab.movements SET amount=2 WHERE external_ref=$1",`collection:${(await admin!.query("SELECT id FROM public.commerce_collections WHERE sale_id=$1 AND is_initial",[cashSale])).rows[0].id}`);}),/IMMUTABLE/);
   await rejectsMessage(()=>app.$transaction(async tx=>{await tx.$executeRawUnsafe("UPDATE finance_lab.accounts SET opening_amount=1 WHERE id=$1::bigint",BigInt(vault));}),/FINANCE_LAB_IMMUTABLE/);
   await rejectsMessage(()=>app.$transaction(async tx=>{await tx.$executeRawUnsafe("UPDATE finance_lab.cash_counts SET counted_amount=1 WHERE id=$1::bigint",BigInt(countId));}),/FINANCE_LAB_IMMUTABLE/);
   await rejectsMessage(()=>app.$transaction(async tx=>{await tx.$executeRawUnsafe("UPDATE finance_lab.historical_commerce SET amount=2 WHERE id=(SELECT min(id) FROM finance_lab.historical_commerce)");}),/IMMUTABLE/);
   assert.deepEqual(await snapshot(),before);await transition(3,"NEW","FROZEN");
   await assert.rejects(()=>createCommerceSale(app,3n,saleInput()));
   await assert.rejects(()=>transition(4,"FROZEN","LEGACY"));await transition(4,"FROZEN","NEW");
  });
  assert(stats.length>20);assert(stats.every(x=>x.totalAfterClose===0));
 }finally{
  if(legacyClient)await legacyClient.$disconnect().catch(()=>{});if(base)await base.$disconnect().catch(()=>{});
  if(legacy)await legacy.end();if(next)await next.end();if(admin)await admin.end();if(child)await stopPostgres(child);rmSync(tmp,{recursive:true,force:true});
 }
});
