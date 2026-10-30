/** Cutover laboratory ONLY. Creates a local throwaway cluster, never DATABASE_URL. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PrismaClient } from "@prisma/client";
import { createCommerceSale,recordCommerceCollection,recordCommerceRefund,returnCommerceSale } from "../src/lib/commerce-operations";

const root=process.cwd(),read=(f:string)=>readFileSync(path.join(root,f),"utf8");
const cutover=read("prototypes/finance-cutover/schema.test-only.sql");
const files=["tests/fixtures/inventory-baseline.sql","prisma/manual-inventory-upgrade.sql","prisma/manual-receiving-upgrade.sql","prisma/manual-commerce-upgrade.sql","tests/fixtures/finance-legacy-categories.sql","tests/fixtures/finance-cutover.sql"];
const request=()=>randomUUID();
const saleInput=(initialPayment="10",method="CASH")=>({requestId:request(),warehouseId:"1",customerName:"عميل اختبار وهمي",customerPhone:"01000000000",discount:"0",initialPayment,method,
 lines:[{productId:"2",quantity:"2",serialIds:[],expectedUnitPrice:"20",expectedTaxRateId:3,expectedTaxKind:"EXEMPT",expectedTaxRate:"0"}]});
const collect=(saleId:string)=>({requestId:request(),saleId,amount:"1",method:"CASH",actuallyPaid:false});
const refund=(saleId:string)=>({requestId:request(),saleId,amount:"1",method:"CASH",actuallyPaid:true});
const returned=(saleId:string)=>({requestId:request(),saleId,cancel:true,accepted:true,lines:[]});
/** A deliberately incomplete test wrapper: authorizes the OLD code but does not
 * add ledger postings. The deferred database invariant must still reject cash. */
function authorizeLegacyCode(client:PrismaClient):PrismaClient{
 return new Proxy(client,{get(db,key){
  if(key!=="$transaction"){const value=Reflect.get(db,key);return typeof value==="function"?value.bind(db):value;}
  return (work:(tx:unknown)=>unknown,options:unknown)=>db.$transaction(async tx=>{
   await tx.$executeRawUnsafe("SELECT finance_cutover_test.begin_new_transaction()");
   const result=await work(tx);
   // Force expected validation errors inside the callback. Deferred COMMIT
   // failure with PrismaPg 6.19.3 leaked pooled connections in this fixture;
   // this is not a general solution for serialization or connection failures.
   await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");return result;
  },options as never);
 }}) as PrismaClient;
}
async function rejectsText(action:()=>Promise<unknown>,expression:RegExp){await assert.rejects(action,(e:unknown)=>{
 const match=expression.test(String(e))||expression.test(JSON.stringify(e,Object.getOwnPropertyNames(e??{})));
 if(!match)console.error("Unexpected rejection:",e);return match;
},`expected ${expression}`);}

test("cutover fixture refuses setup without an explicit disposable-database opt-in",async()=>{
 const pg=new PGlite();try{
  await assert.rejects(()=>pg.exec(cutover),/opted-in disposable database/);
  const row=(await pg.query<{value:string|null}>("SELECT to_regnamespace('finance_cutover_test')::text AS value")).rows[0];assert.equal(row.value,null);
 }finally{await pg.close();}
});

function launch(bin:string,data:string,socket:string):Promise<ChildProcess>{
 const child=spawn(path.join(bin,"postgres"),["-D",data,"-k",socket,"-h","","-p","55435","-c","unix_socket_permissions=0700"],{stdio:["ignore","ignore","pipe"],env:process.env});
 return new Promise((resolve,reject)=>{let logs="",settled=false;
  const timer=setTimeout(()=>{if(!settled){settled=true;child.kill("SIGKILL");reject(new Error("disposable PostgreSQL did not start"));}},30_000);
  child.stderr?.on("data",data=>{logs=(logs+String(data)).slice(-5000);if(!settled&&logs.includes("database system is ready to accept connections")){settled=true;clearTimeout(timer);resolve(child);}});
  child.once("error",error=>{if(!settled){settled=true;clearTimeout(timer);reject(error);}});
  child.once("exit",code=>{if(!settled){settled=true;clearTimeout(timer);reject(new Error(`disposable PostgreSQL exited ${code}: ${logs}`));}});
 });
}
async function stop(child:ChildProcess):Promise<void>{
 if(child.exitCode!==null||child.signalCode!==null)return;
 const exited=new Promise<void>(resolve=>child.once("exit",()=>resolve()));child.kill("SIGTERM");let timer:NodeJS.Timeout|undefined;
 const clean=await Promise.race([exited.then(()=>true),new Promise<boolean>(resolve=>{timer=setTimeout(()=>resolve(false),5000);})]);
 if(timer)clearTimeout(timer);if(!clean){child.kill("SIGKILL");await exited;}
}
async function waitForBlock(pool:Pool,blocked:number,blocker:number):Promise<void>{
 const deadline=Date.now()+8000;
 while(Date.now()<deadline){
  const row=(await pool.query<{blocked:boolean}>("SELECT $2::int = ANY(pg_blocking_pids($1::int)) AS blocked",[blocked,blocker])).rows[0];
  if(row.blocked)return;
  await new Promise(resolve=>setTimeout(resolve,25));
 }
 throw new Error(`expected backend ${blocked} to wait on backend ${blocker}`);
}
async function transition(admin:Pool|PoolClient,id:string,rev:number,from:string,to:string,reason="تحويل تجريبي"){
 return (await admin.query<{applied_revision:number;current_revision:number;current_phase:string;replayed:boolean}>(
  "SELECT * FROM finance_cutover_test.transition($1::uuid,$2::int,$3::text,$4::text,$5::text)",[id,rev,from,to,reason])).rows[0];
}
async function counts(admin:Pool){return (await admin.query(`SELECT
 (SELECT count(*)::int FROM public.commerce_sales) AS sales,
 (SELECT count(*)::int FROM public.commerce_collections) AS collections,
 (SELECT count(*)::int FROM public.commerce_returns) AS returns,
 (SELECT count(*)::int FROM public.commerce_refunds) AS refunds,
 (SELECT qty_on_hand::text FROM public.stock_levels WHERE warehouse_id=1 AND product_id=2) AS stock,
 (SELECT count(*)::int FROM finance_cutover_fixture.movements) AS movements,
 (SELECT count(*)::int FROM finance_cutover_fixture.historical) AS historical`)).rows[0];}
async function collection(c:PoolClient,saleId:string,method="CASH",amount="1"):Promise<string>{
 return String((await c.query(`INSERT INTO public.commerce_collections(request_id,request_hash,sale_id,amount,method,is_initial,created_by_id)
  VALUES($1::uuid,$2,$3::bigint,$4::numeric,$5,FALSE,1) RETURNING id`,[request(),"c".repeat(64),saleId,amount,method])).rows[0].id);
}
async function refundEvent(c:PoolClient,saleId:string,method="CASH",amount="1"):Promise<string>{
 return String((await c.query(`INSERT INTO public.commerce_refunds(request_id,request_hash,sale_id,amount,method,created_by_id)
  VALUES($1::uuid,$2,$3::bigint,$4::numeric,$5,2) RETURNING id`,[request(),"d".repeat(64),saleId,amount,method])).rows[0].id);
}
async function cashMovement(c:PoolClient,kind:"COLLECTION"|"REFUND",eventId:string,accountId:string,checkpointId:string,amount="1"):Promise<void>{
 await c.query(`INSERT INTO finance_cutover_fixture.movements(collection_id,refund_id,account_id,checkpoint_id,amount,direction,after_checkpoint)
  VALUES($1::bigint,$2::bigint,$3::bigint,$4::bigint,$5::numeric,$6,TRUE)`,
  [kind==="COLLECTION"?eventId:null,kind==="REFUND"?eventId:null,accountId,checkpointId,amount,kind==="COLLECTION"?"IN":"OUT"]);
}
async function historical(c:PoolClient,kind:"COLLECTION"|"REFUND",eventId:string,accountId:string,checkpointId:string,
 amount="1",actualDate="2019-12-31",sameDayBefore=false,confirmedBy="2"):Promise<void>{
 await c.query(`INSERT INTO finance_cutover_fixture.historical(collection_id,refund_id,account_id,checkpoint_id,amount,actual_date,
  included_in_checkpoint,same_day_before,handler,reason,confirmed_by)
  VALUES($1::bigint,$2::bigint,$3::bigint,$4::bigint,$5::numeric,$6::date,TRUE,$7,'حائز تجريبي','مراجعة تجريبية',$8::bigint)`,
  [kind==="COLLECTION"?eventId:null,kind==="REFUND"?eventId:null,accountId,checkpointId,amount,actualDate,sameDayBefore,confirmedBy]);
}
async function inNewTransaction<T>(pool:Pool,work:(client:PoolClient)=>Promise<T>):Promise<T>{
 const c=await pool.connect();let failed=false;
 try{await c.query("BEGIN ISOLATION LEVEL SERIALIZABLE");await c.query("SELECT finance_cutover_test.begin_new_transaction()");
  const result=await work(c);await c.query("COMMIT");return result;
 }catch(error){failed=true;await c.query("ROLLBACK").catch(()=>{});throw error;}
 finally{c.release(failed);}
}
function temporaryPrisma(tmp:string):typeof PrismaClient{
 const output=path.join(tmp,"client"),schemaPath=path.join(tmp,"schema.prisma");
 symlinkSync(path.join(root,"node_modules"),path.join(tmp,"node_modules"),"dir");
 const original=read("prisma/schema.prisma");
 const schema=original.replace('provider = "prisma-client-js"','provider = "prisma-client-js"\n  output = "./client"\n  engineType = "client"');
 assert.notEqual(schema,original);writeFileSync(schemaPath,schema);
 const env:NodeJS.ProcessEnv={PATH:process.env.PATH,HOME:tmp,TMPDIR:tmp,NODE_ENV:"test",DATABASE_URL:"postgresql://unused.invalid/fixture",DIRECT_URL:"postgresql://unused.invalid/fixture",
  PRISMA_GENERATE_SKIP_AUTOINSTALL:"1",PRISMA_HIDE_UPDATE_MESSAGE:"1",PRISMA_SCHEMA_ENGINE_BINARY:"/usr/bin/true",PRISMA_QUERY_ENGINE_LIBRARY:"/usr/bin/true"};
 execFileSync(process.execPath,[path.join(root,"node_modules/prisma/build/index.js"),"generate",`--schema=${schemaPath}`],{cwd:root,env,stdio:"pipe",timeout:60_000});
 return (createRequire(path.join(root,"package.json"))(output) as {PrismaClient:typeof PrismaClient}).PrismaClient;
}
const pgBin=process.env.FINANCE_TEST_PG_BIN;
test("database cutover lab closes and reopens safely under concurrent real commerce writes",{timeout:180_000,skip:!pgBin},async t=>{
 if(!pgBin||!path.isAbsolute(pgBin)||!existsSync(path.join(pgBin,"postgres"))||!existsSync(path.join(pgBin,"initdb")))throw new Error("FINANCE_TEST_PG_BIN must be a local PostgreSQL bin directory");
 if(typeof process.getuid==="function"&&process.getuid()===0){t.skip("initdb requires an unprivileged OS user");return;}
 const tmp=mkdtempSync(path.join(os.tmpdir(),"selahtone-cutover-")),data=path.join(tmp,"data"),socket=path.join(tmp,"socket");mkdirSync(socket,{mode:0o700});
 let server:ChildProcess|undefined,admin:Pool|undefined,legacy:Pool|undefined,next:Pool|undefined,oldApp:PrismaClient|undefined,newRoleOldCode:PrismaClient|undefined;
 try{
  execFileSync(path.join(pgBin,"initdb"),["-D",data,"--no-locale","--encoding=UTF8","--auth-local=trust","--auth-host=reject","--username=cutover_admin_test"],{env:process.env,stdio:"pipe",timeout:30_000});
  server=await launch(pgBin,data,socket);
  const config={host:socket,port:55435,database:"postgres",max:8,connectionTimeoutMillis:5000};
  admin=new Pool({...config,user:"cutover_admin_test"});
  const setup=await admin.connect();try{
   assert.equal((await setup.query("SHOW listen_addresses")).rows[0].listen_addresses,"");
   for(const f of files)await setup.query(read(f));
   await setup.query(`INSERT INTO public.tax_rates(code,name_ar,rate,kind,effective_from,is_active) VALUES('CUTOVER-EX','ضريبة وهمية',0,'EXEMPT','2000-01-01',TRUE);
    UPDATE public.products SET sale_price=20,tax_rate_id=3 WHERE id=2;
    INSERT INTO public.stock_levels(warehouse_id,product_id,qty_on_hand,avg_cost) VALUES(1,2,100,4);
    CREATE ROLE cutover_legacy_test LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS;
    CREATE ROLE cutover_new_test LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS;
    REVOKE CREATE ON SCHEMA public FROM PUBLIC;
    GRANT USAGE ON SCHEMA public,finance_cutover_fixture TO cutover_legacy_test,cutover_new_test;
    GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public,finance_cutover_fixture TO cutover_legacy_test,cutover_new_test;
    REVOKE INSERT,UPDATE,DELETE ON public.users,public.branches FROM cutover_legacy_test,cutover_new_test;
    GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public,finance_cutover_fixture TO cutover_legacy_test,cutover_new_test;`);
  }finally{setup.release();}
  legacy=new Pool({...config,user:"cutover_legacy_test"});next=new Pool({...config,user:"cutover_new_test"});
  const Client=temporaryPrisma(tmp);
  oldApp=new Client({adapter:new PrismaPg(legacy) as never}) as PrismaClient;
  newRoleOldCode=new Client({adapter:new PrismaPg(next) as never}) as PrismaClient;

  await t.test("bad roles or a missing protected table make installation fail atomically",async()=>{
   const c=await admin!.connect();try{
    await c.query("BEGIN");await c.query("ALTER ROLE cutover_legacy_test SUPERUSER");await c.query("SET LOCAL selahtone.finance_cutover_test_only='yes'");
    await rejectsText(()=>c.query(cutover),/restricted fixture login roles/);await c.query("ROLLBACK");
    assert.equal((await c.query("SELECT to_regnamespace('finance_cutover_test') AS ns")).rows[0].ns,null);
    await c.query("BEGIN");await c.query("GRANT cutover_new_test TO cutover_legacy_test");await c.query("SET LOCAL selahtone.finance_cutover_test_only='yes'");
    await rejectsText(()=>c.query(cutover),/restricted fixture login roles/);await c.query("ROLLBACK");
    await c.query("BEGIN");await c.query("ALTER TABLE finance_cutover_fixture.audit_events RENAME TO deliberately_missing");await c.query("SET LOCAL selahtone.finance_cutover_test_only='yes'");
    await rejectsText(()=>c.query(cutover),/fixture object missing/);await c.query("ROLLBACK");
    assert.equal((await c.query("SELECT to_regnamespace('finance_cutover_test') AS ns")).rows[0].ns,null);
    assert.equal(Number((await c.query(`SELECT count(*) AS n FROM pg_trigger WHERE tgname='finance_cutover_test_guard' AND NOT tgisinternal`)).rows[0].n),0);
    assert((await c.query("SELECT to_regclass('finance_cutover_fixture.audit_events') AS name")).rows[0].name);
   }finally{await c.query("ROLLBACK").catch(()=>{});c.release();}
  });
  await t.test("install waits for a pre-existing writer; protected commerce tables are complete in the fixture",async()=>{
   const writer=await legacy!.connect(),installer=await admin!.connect();let open=true;
   try{
    await writer.query("BEGIN");await writer.query("UPDATE public.commerce_sales SET revision=revision WHERE false");
    const writerPid=(await writer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    await installer.query("BEGIN");await installer.query("SET LOCAL selahtone.finance_cutover_test_only='yes'");
    const installerPid=(await installer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const installing=installer.query(cutover);await waitForBlock(admin!,installerPid,writerPid);
    await writer.query("COMMIT");open=false;await installing;await installer.query("COMMIT");
    const missing=await admin!.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relkind='r' AND c.relname LIKE 'commerce\\_%' ESCAPE '\\' AND NOT EXISTS
     (SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND t.tgname='finance_cutover_test_guard' AND NOT t.tgisinternal)`);
    assert.deepEqual(missing.rows,[]);
    assert.equal(Number((await admin!.query("SELECT count(*) AS n FROM pg_trigger WHERE tgname='finance_cutover_test_guard' AND NOT tgisinternal")).rows[0].n),26);
   }finally{if(open)await writer.query("ROLLBACK").catch(()=>{});await installer.query("ROLLBACK").catch(()=>{});writer.release();installer.release();}
  });
  let dueSale="",refundSale="",accountId="",openingCheckpoint="";
  await t.test("legacy sale and return continue normally before the frozen phase",async()=>{
   assert.equal((await legacy!.query("SELECT session_user AS role")).rows[0].role,"cutover_legacy_test");
   const first=await createCommerceSale(oldApp!,3n,saleInput());dueSale=first.id;
   const second=await createCommerceSale(oldApp!,1n,saleInput("40"));refundSale=second.id;
   await returnCommerceSale(oldApp!,1n,returned(refundSale));
   const c=await counts(admin!);assert.equal(c.sales,2);assert.equal(c.collections,2);assert.equal(c.returns,1);assert.equal(c.stock,"98.00");assert.equal(c.movements,0);
   await rejectsText(()=>next!.query("SELECT finance_cutover_test.begin_new_transaction()"),/FINANCE_CUTOVER_BLOCKED/);
  });
  await t.test("control is private, app logins cannot switch role, disable guards or change phases",async()=>{
   await rejectsText(()=>legacy!.query("SET ROLE cutover_new_test"),/permission denied|must be a member/);
   await rejectsText(()=>legacy!.query("ALTER TABLE public.commerce_sales DISABLE TRIGGER finance_cutover_test_guard"),/must be owner|permission denied/);
   await rejectsText(()=>next!.query("SET session_replication_role = 'replica'"),/permission denied|superuser/i);
   await rejectsText(()=>legacy!.query("SELECT * FROM finance_cutover_test.control"),/permission denied/);
   await rejectsText(()=>next!.query("SELECT * FROM finance_cutover_test.control"),/permission denied/);
   await rejectsText(()=>next!.query("INSERT INTO finance_cutover_test.transaction_permits VALUES(pg_current_xact_id(),pg_backend_pid(),session_user)"),/permission denied/);
   await rejectsText(()=>next!.query("UPDATE public.users SET role_code='MANAGER' WHERE id=3"),/permission denied/);
   await rejectsText(()=>legacy!.query("UPDATE public.branches SET is_active=TRUE WHERE id=1"),/permission denied/);
   await rejectsText(()=>transition(next!,request(),1,"LEGACY","FROZEN"),/permission denied/);
  });
  await t.test("a failed audit write rolls back the phase transition",async()=>{
   await admin!.query(`CREATE FUNCTION finance_cutover_test.reject_transition() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$;
    CREATE TRIGGER reject_transition BEFORE INSERT ON finance_cutover_test.transitions FOR EACH ROW EXECUTE FUNCTION finance_cutover_test.reject_transition()`);
   try{
    await rejectsText(()=>transition(admin!,request(),1,"LEGACY","FROZEN"),/synthetic audit failure/);
    const row=(await admin!.query("SELECT phase,revision,ever_new FROM finance_cutover_test.control")).rows[0];
    assert.deepEqual(row,{phase:"LEGACY",revision:1,ever_new:false});
   }finally{await admin!.query("DROP TRIGGER reject_transition ON finance_cutover_test.transitions; DROP FUNCTION finance_cutover_test.reject_transition()");}
  });
  const firstFreeze=request();
  await t.test("freeze waits for an in-flight legacy transaction and identical retries switch only once",async()=>{
   const writer=await legacy!.connect(),stale=await legacy!.connect(),a=await admin!.connect(),b=await admin!.connect();let writerOpen=true,staleOpen=true;
   try{
    await stale.query("BEGIN ISOLATION LEVEL SERIALIZABLE");await stale.query("SELECT count(*) FROM public.branches");
    await writer.query("BEGIN");await writer.query("UPDATE public.stock_levels SET qty_on_hand=qty_on_hand WHERE warehouse_id=1 AND product_id=2");
    const writerPid=(await writer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const aPid=(await a.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const one=transition(a,firstFreeze,1,"LEGACY","FROZEN"),two=transition(b,firstFreeze,1,"LEGACY","FROZEN");
    await waitForBlock(admin!,aPid,writerPid);await writer.query("COMMIT");writerOpen=false;
    const results=await Promise.all([one,two]);assert.equal(results.filter(x=>x.replayed).length,1);
    assert(results.every(x=>x.applied_revision===2&&x.current_phase==="FROZEN"));
    await rejectsText(()=>stale.query("UPDATE public.commerce_settings SET staff_discount_bps=staff_discount_bps WHERE FALSE"),/FINANCE_CUTOVER_BLOCKED|could not serialize/);
    await stale.query("ROLLBACK");staleOpen=false;
    assert.equal(Number((await admin!.query("SELECT count(*) AS n FROM finance_cutover_test.transitions WHERE request_id=$1",[firstFreeze])).rows[0].n),1);
   }finally{if(writerOpen)await writer.query("ROLLBACK").catch(()=>{});if(staleOpen)await stale.query("ROLLBACK").catch(()=>{});writer.release();stale.release();a.release();b.release();}
  });
  await t.test("frozen mode blocks direct writes, even zero-row updates and truncate, and cannot be spoofed",async()=>{
   const guarded=await admin!.query<{schema_name:string;table_name:string}>(`SELECT n.nspname AS schema_name,c.relname AS table_name
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE t.tgname='finance_cutover_test_guard' AND NOT t.tgisinternal ORDER BY 1,2`);
   for(const item of guarded.rows){
    // Both identifiers came from the database fixture, not user input.
    const relation=`"${item.schema_name.replaceAll('"','""')}"."${item.table_name.replaceAll('"','""')}"`;
    await rejectsText(()=>legacy!.query(`DELETE FROM ${relation} WHERE FALSE`),/FINANCE_CUTOVER_BLOCKED/);
   }
   await admin!.query("GRANT TRUNCATE ON public.commerce_sales TO cutover_legacy_test");
   try{await rejectsText(()=>legacy!.query("TRUNCATE public.commerce_sales"),/FINANCE_CUTOVER_BLOCKED|cannot truncate/);}
   finally{await admin!.query("REVOKE TRUNCATE ON public.commerce_sales FROM cutover_legacy_test");}
   const c=await next!.connect();try{
    await c.query("BEGIN");await c.query("SELECT set_config('finance_cutover_test.authorized','true',true)");
    await rejectsText(()=>c.query("UPDATE public.commerce_sales SET revision=revision WHERE FALSE"),/FINANCE_CUTOVER_BLOCKED/);await c.query("ROLLBACK");
   }finally{await c.query("ROLLBACK").catch(()=>{});c.release();}
   await rejectsText(()=>next!.query("SELECT finance_cutover_test.begin_new_transaction()"),/FINANCE_CUTOVER_BLOCKED/);
  });
  await t.test("the actual legacy commerce functions cannot write during freeze; stock and invoice stay unchanged",async()=>{
   const before=await counts(admin!);
   await rejectsText(()=>createCommerceSale(oldApp!,3n,saleInput()),/FINANCE_CUTOVER_BLOCKED/);
   await rejectsText(()=>recordCommerceCollection(oldApp!,3n,collect(dueSale)),/FINANCE_CUTOVER_BLOCKED/);
   await rejectsText(()=>returnCommerceSale(oldApp!,1n,returned(dueSale)),/FINANCE_CUTOVER_BLOCKED/);
   await rejectsText(()=>recordCommerceRefund(oldApp!,2n,refund(refundSale)),/FINANCE_CUTOVER_BLOCKED/);
   assert.deepEqual(await counts(admin!),before);
  });
  await t.test("audited early rollback works only before NEW; replay exposes the CURRENT phase",async()=>{
   await rejectsText(()=>transition(admin!,firstFreeze,1,"LEGACY","FROZEN","سبب مختلف"),/FINANCE_CUTOVER_REQUEST_CONFLICT/);
   await rejectsText(()=>transition(admin!,request(),1,"LEGACY","NEW"),/FINANCE_CUTOVER_STALE/);
   const back=await transition(admin!,request(),2,"FROZEN","LEGACY","إلغاء تجريبي قبل التفعيل");assert.equal(back.current_revision,3);
   const replayed=await transition(admin!,firstFreeze,1,"LEGACY","FROZEN");
   assert.deepEqual(replayed,{applied_revision:2,current_revision:3,current_phase:"LEGACY",replayed:true});
   await recordCommerceCollection(oldApp!,3n,collect(dueSale));
   const row=(await admin!.query("SELECT phase,revision,ever_new FROM finance_cutover_test.control")).rows[0];assert.deepEqual(row,{phase:"LEGACY",revision:3,ever_new:false});
  });
  await t.test("after activation the old code is blocked even if connected with the new database login",async()=>{
   assert.equal((await transition(admin!,request(),3,"LEGACY","FROZEN")).current_revision,4);
   assert.equal((await transition(admin!,request(),4,"FROZEN","NEW")).current_revision,5);
   const before=await counts(admin!);
   await rejectsText(()=>createCommerceSale(oldApp!,3n,saleInput()),/FINANCE_CUTOVER_BLOCKED/);
   await rejectsText(()=>createCommerceSale(newRoleOldCode!,3n,saleInput()),/FINANCE_CUTOVER_BLOCKED/);
   assert.deepEqual(await counts(admin!),before);
   // Calling the authorizer in autocommit cannot authorize a later transaction.
   await next!.query("SELECT finance_cutover_test.begin_new_transaction()");
   await rejectsText(()=>next!.query("UPDATE public.commerce_sales SET revision=revision WHERE FALSE"),/FINANCE_CUTOVER_BLOCKED/);
   assert.equal(Number((await admin!.query("SELECT count(*) AS n FROM finance_cutover_test.transaction_permits")).rows[0].n),0);
  });
  await t.test("the new login's permit is per transaction, savepoint-aware, and cannot be copied or forged",async()=>{
   const c=await next!.connect();try{
    await c.query("BEGIN");await c.query("SAVEPOINT before_permit");await c.query("SELECT finance_cutover_test.begin_new_transaction()");
    await c.query("ROLLBACK TO SAVEPOINT before_permit");
    await rejectsText(()=>c.query("UPDATE public.commerce_sales SET revision=revision WHERE FALSE"),/FINANCE_CUTOVER_BLOCKED/);await c.query("ROLLBACK");
    await c.query("BEGIN");await c.query("SELECT finance_cutover_test.begin_new_transaction()");await c.query("SELECT finance_cutover_test.begin_new_transaction()");
    const account=await c.query(`INSERT INTO finance_cutover_fixture.accounts(label,branch_id,opening_amount,opening_date,counted_by,counted)
      VALUES('حساب افتتاح وهمي',1,100,'2020-01-01',1,TRUE) RETURNING id`);accountId=String(account.rows[0].id);
    const checkpoint=await c.query(`INSERT INTO finance_cutover_fixture.checkpoints(account_id,kind,counted_on,observed_amount,confirmed_by)
      VALUES($1::bigint,'OPENING','2020-01-01',100,1) RETURNING id`,[accountId]);openingCheckpoint=String(checkpoint.rows[0].id);
    await c.query("COMMIT");
    assert.equal(Number((await admin!.query("SELECT count(*) AS n FROM finance_cutover_test.transaction_permits")).rows[0].n),0);
    await rejectsText(()=>c.query("INSERT INTO finance_cutover_fixture.accounts(label) VALUES('لا يُحفظ')"),/FINANCE_CUTOVER_BLOCKED/);
   }finally{await c.query("ROLLBACK").catch(()=>{});c.release();}
  });
  await t.test("a permit alone cannot let old code commit unlinked cash; noncash needs no cash movement",async()=>{
   const authorized=authorizeLegacyCode(newRoleOldCode!),before=await counts(admin!),cashRequest=saleInput();
   await rejectsText(()=>createCommerceSale(authorized,3n,cashRequest),/FINANCE_CASH_LINK_REQUIRED/);
   await rejectsText(()=>createCommerceSale(authorized,3n,cashRequest),/FINANCE_CASH_LINK_REQUIRED/);
   await rejectsText(()=>recordCommerceCollection(authorized,3n,collect(dueSale)),/FINANCE_CASH_LINK_REQUIRED/);
   await rejectsText(()=>recordCommerceRefund(authorized,2n,refund(refundSale)),/FINANCE_CASH_LINK_REQUIRED/);
   assert.deepEqual(await counts(admin!),before);
   const cardRequest=saleInput("10","CARD"),cashless=await createCommerceSale(authorized,3n,cardRequest);assert(cashless.id);
   assert.equal((await createCommerceSale(authorized,3n,cardRequest)).id,cashless.id);
   const after=await counts(admin!);assert.equal(after.sales,before.sales+1);assert.equal(after.collections,before.collections+1);
   assert.equal(after.movements,before.movements);assert.equal(after.historical,before.historical);
  });
  await t.test("documents the PrismaPg 6.19.3 deferred-COMMIT error connection leak",async()=>{
   // Isolate the known failure in a dedicated pool; explicitly release only
   // its checked-out fixture clients so this regression never hangs cleanup.
   const pool=new Pool({...config,user:"cutover_new_test",max:2});const checkedOut=new Set<PoolClient>();
   pool.on("acquire",(c:PoolClient)=>checkedOut.add(c));pool.on("release",(_e:Error|undefined,c:PoolClient)=>checkedOut.delete(c));
   const client=new Client({adapter:new PrismaPg(pool) as never}) as PrismaClient;const before=await counts(admin!);
   try{
    await rejectsText(()=>client.$transaction(async tx=>{
     await tx.$executeRawUnsafe("SELECT finance_cutover_test.begin_new_transaction()");
     await tx.$executeRawUnsafe(`INSERT INTO public.commerce_collections(request_id,request_hash,sale_id,amount,method,is_initial,created_by_id)
      VALUES($1::uuid,$2,$3::bigint,1,'CASH',FALSE,1)`,request(),"e".repeat(64),BigInt(dueSale));
     // Intentionally DO NOT force deferred constraints here: COMMIT must fail.
    },{isolationLevel:"Serializable"}),/FINANCE_CASH_LINK_REQUIRED/);
    assert.deepEqual(await counts(admin!),before);
    assert.equal(checkedOut.size,1,"known adapter behavior changed; re-evaluate this release blocker");
    assert.equal(pool.idleCount,0);
   }finally{
    for(const c of checkedOut)c.release(true);await client.$disconnect().catch(()=>{});await pool.end();
   }
  });
  await t.test("simulated new cash registration and ledger move are atomic on failure",async()=>{
   const c=await next!.connect(),before=await counts(admin!);try{
    await c.query("BEGIN");await c.query("SELECT finance_cutover_test.begin_new_transaction()");
    const result=await c.query(`INSERT INTO public.commerce_collections(request_id,request_hash,sale_id,amount,method,is_initial,created_by_id)
      VALUES($1::uuid,$2,$3::bigint,1,'CASH',FALSE,1) RETURNING id`,[request(),"a".repeat(64),dueSale]);
    await rejectsText(()=>c.query(`INSERT INTO finance_cutover_fixture.movements(collection_id,account_id,checkpoint_id,amount,direction,after_checkpoint)
      VALUES($1::bigint,$2::bigint,$3::bigint,-1,'IN',TRUE)`,[result.rows[0].id,accountId,openingCheckpoint]),/check constraint/);
    await c.query("ROLLBACK");assert.deepEqual(await counts(admin!),before);
    await c.query("BEGIN");await c.query("SELECT finance_cutover_test.begin_new_transaction()");
    const saved=await c.query(`INSERT INTO public.commerce_collections(request_id,request_hash,sale_id,amount,method,is_initial,created_by_id)
      VALUES($1::uuid,$2,$3::bigint,1,'CASH',FALSE,1) RETURNING id`,[request(),"b".repeat(64),dueSale]);
    await c.query(`INSERT INTO finance_cutover_fixture.movements(collection_id,account_id,checkpoint_id,amount,direction,after_checkpoint)
      VALUES($1::bigint,$2::bigint,$3::bigint,1,'IN',TRUE)`,[saved.rows[0].id,accountId,openingCheckpoint]);await c.query("COMMIT");
    const after=await counts(admin!);assert.equal(after.collections,before.collections+1);assert.equal(after.movements,before.movements+1);
   }finally{await c.query("ROLLBACK").catch(()=>{});c.release();}
  });
  let otherAccount="",otherCheckpoint="";
  await t.test("opening and counts require active management, a matching confirmed opening, and ordered counts",async()=>{
   const before=await counts(admin!);
   for(const actor of [3,4])await rejectsText(()=>inNewTransaction(next!,async c=>{
    await c.query("INSERT INTO finance_cutover_fixture.accounts(branch_id,label,counted_by) VALUES(1,'bad actor',$1)",[actor]);
   }),/FINANCE_MANAGER_REQUIRED/);
   await rejectsText(()=>inNewTransaction(next!,async c=>{
    await c.query("INSERT INTO finance_cutover_fixture.accounts(branch_id,label,counted_by) VALUES(1,'missing opening',1)");
   }),/FINANCE_OPENING_CHECKPOINT_REQUIRED/);
   await rejectsText(()=>inNewTransaction(next!,async c=>{
    const id=(await c.query("INSERT INTO finance_cutover_fixture.accounts(label,opening_amount) VALUES('mismatch',10) RETURNING id")).rows[0].id;
    await c.query(`INSERT INTO finance_cutover_fixture.checkpoints(account_id,kind,counted_on,observed_amount,confirmed_by)
     VALUES($1,'OPENING','2020-01-01',9,1)`,[id]);
   }),/FINANCE_CHECKPOINT_INVALID/);
   await rejectsText(()=>inNewTransaction(next!,async c=>{
    await c.query(`INSERT INTO finance_cutover_fixture.checkpoints(account_id,kind,counted_on,observed_amount,confirmed_by)
     VALUES($1,'COUNT','2020-01-02',10,3)`,[accountId]);
   }),/FINANCE_MANAGER_REQUIRED/);
   await rejectsText(()=>inNewTransaction(next!,async c=>{
    await c.query(`INSERT INTO finance_cutover_fixture.checkpoints(account_id,kind,counted_on,observed_amount,confirmed_by)
     VALUES($1,'COUNT','2019-12-31',10,1)`,[accountId]);
   }),/FINANCE_CHECKPOINT_INVALID/);
   assert.deepEqual(await counts(admin!),before);
   const other=await inNewTransaction(next!,async c=>{
    const a=(await c.query(`INSERT INTO finance_cutover_fixture.accounts(branch_id,label,opening_amount,opening_date,counted_by)
      VALUES(2,'حساب فرع آخر',70,'2020-01-01',2) RETURNING id`)).rows[0].id;
    const cp=(await c.query(`INSERT INTO finance_cutover_fixture.checkpoints(account_id,kind,counted_on,observed_amount,confirmed_by)
      VALUES($1,'OPENING','2020-01-01',70,1) RETURNING id`,[a])).rows[0].id;return [a,cp];
   });otherAccount=String(other[0]);otherCheckpoint=String(other[1]);
  });
  await t.test("deferred checks reject unlinked, wrong, duplicate and noncash postings atomically",async()=>{
   const before=await counts(admin!);
   await rejectsText(()=>inNewTransaction(next!,async c=>{await collection(c,dueSale);}),/FINANCE_CASH_LINK_REQUIRED/);
   await rejectsText(()=>inNewTransaction(next!,async c=>{await refundEvent(c,refundSale);}),/FINANCE_CASH_LINK_REQUIRED/);
   await rejectsText(()=>inNewTransaction(next!,async c=>{
    const id=await collection(c,dueSale,"CASH","5");await cashMovement(c,"COLLECTION",id,accountId,openingCheckpoint,"4");
   }),/FINANCE_CASH_MOVEMENT_INVALID/);
   await rejectsText(()=>inNewTransaction(next!,async c=>{
    const id=await refundEvent(c,refundSale,"CASH","5");await cashMovement(c,"REFUND",id,accountId,openingCheckpoint,"4");
   }),/FINANCE_CASH_MOVEMENT_INVALID/);
   await rejectsText(()=>inNewTransaction(next!,async c=>{
    const id=await collection(c,dueSale);await cashMovement(c,"COLLECTION",id,otherAccount,otherCheckpoint);
   }),/FINANCE_CASH_ACCOUNT_INVALID/);
   await rejectsText(()=>inNewTransaction(next!,async c=>{
    const id=await collection(c,dueSale);await cashMovement(c,"COLLECTION",id,accountId,otherCheckpoint);
   }),/FINANCE_CASH_ACCOUNT_INVALID/);
   await rejectsText(()=>inNewTransaction(next!,async c=>{
    const id=await collection(c,dueSale,"CARD");await cashMovement(c,"COLLECTION",id,accountId,openingCheckpoint);
   }),/FINANCE_NONCASH_LEDGER_INVALID/);
   await rejectsText(()=>inNewTransaction(next!,async c=>{
    const id=await refundEvent(c,refundSale,"BANK_TRANSFER");await historical(c,"REFUND",id,accountId,openingCheckpoint);
   }),/FINANCE_NONCASH_LEDGER_INVALID/);
   await rejectsText(()=>inNewTransaction(next!,async c=>{
    const id=await collection(c,dueSale);await cashMovement(c,"COLLECTION",id,accountId,openingCheckpoint);
    await historical(c,"COLLECTION",id,accountId,openingCheckpoint);
   }),/FINANCE_CASH_LINK_REQUIRED/);
   await rejectsText(()=>inNewTransaction(next!,async c=>{
    const id=await collection(c,dueSale);await c.query(`INSERT INTO finance_cutover_fixture.movements
     (collection_id,account_id,checkpoint_id,amount,direction,after_checkpoint) VALUES($1,$2,$3,1,'IN',FALSE)`,[id,accountId,openingCheckpoint]);
   }),/check constraint/);
   assert.deepEqual(await counts(admin!),before);
  });
  await t.test("historical confirmation waits for a concurrent user suspension and refuses the stale actor",async()=>{
   const before=await counts(admin!),changer=await admin!.connect(),worker=await next!.connect();let pending:Promise<void>|undefined;
   try{
    await changer.query("BEGIN");await changer.query("UPDATE public.users SET status='SUSPENDED' WHERE id=2");
    await worker.query("BEGIN ISOLATION LEVEL READ COMMITTED");await worker.query("SELECT finance_cutover_test.begin_new_transaction()");
    const id=await collection(worker,dueSale),workerPid=(await worker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const changerPid=(await changer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    pending=historical(worker,"COLLECTION",id,accountId,openingCheckpoint);void pending.catch(()=>{});
    await waitForBlock(admin!,workerPid,changerPid);await changer.query("COMMIT");
    await rejectsText(()=>pending!,/FINANCE_MANAGER_REQUIRED/);await worker.query("ROLLBACK");
    assert.deepEqual(await counts(admin!),before);
   }finally{
    await changer.query("ROLLBACK").catch(()=>{});await worker.query("ROLLBACK").catch(()=>{});changer.release();worker.release();
    await admin!.query("UPDATE public.users SET status='ACTIVE' WHERE id=2");
   }
  });
  await t.test("historical cash needs management confirmation, matching amount and branch, and explicit same-day ordering",async()=>{
   const before=await counts(admin!);
   for(const actor of [3,4])await rejectsText(()=>inNewTransaction(next!,async c=>{
    const id=await collection(c,dueSale);await historical(c,"COLLECTION",id,accountId,openingCheckpoint,"1","2019-12-31",false,String(actor));
   }),/FINANCE_MANAGER_REQUIRED/);
   for(const [date,sameDay] of [["2020-01-01",false],["2020-01-02",true]] as const)
    await rejectsText(()=>inNewTransaction(next!,async c=>{
     const id=await collection(c,dueSale);await historical(c,"COLLECTION",id,accountId,openingCheckpoint,"1",date,sameDay);
    }),/FINANCE_HISTORICAL_LINK_INVALID/);
   await rejectsText(()=>inNewTransaction(next!,async c=>{
    const id=await collection(c,dueSale,"CASH","5");await historical(c,"COLLECTION",id,accountId,openingCheckpoint,"4");
   }),/FINANCE_HISTORICAL_LINK_INVALID/);
   await rejectsText(()=>inNewTransaction(next!,async c=>{
    const id=await refundEvent(c,refundSale);await historical(c,"REFUND",id,otherAccount,otherCheckpoint);
   }),/FINANCE_CASH_ACCOUNT_INVALID/);
   assert.deepEqual(await counts(admin!),before);
   await inNewTransaction(next!,async c=>{
    const a=await collection(c,dueSale);await historical(c,"COLLECTION",a,accountId,openingCheckpoint);
    const b=await refundEvent(c,refundSale);await historical(c,"REFUND",b,accountId,openingCheckpoint,"1","2020-01-01",true,"1");
   });
   const after=await counts(admin!);assert.equal(after.collections,before.collections+1);assert.equal(after.refunds,before.refunds+1);
   assert.equal(after.movements,before.movements);assert.equal(after.historical,before.historical+2);
  });
  await t.test("confirmed cash evidence, accounts and counts cannot be rewritten or truncated in NEW",async()=>{
   const before=await counts(admin!);
   const existing=(await admin!.query("SELECT collection_id FROM finance_cutover_fixture.movements LIMIT 1")).rows[0].collection_id;
   const statements:[string,unknown[]][]=[
    ["UPDATE public.commerce_collections SET amount=2 WHERE id=$1",[existing]],
    ["DELETE FROM public.commerce_collections WHERE id=$1",[existing]],
    ["UPDATE finance_cutover_fixture.movements SET amount=2 WHERE collection_id=$1",[existing]],
    ["DELETE FROM finance_cutover_fixture.historical WHERE id=(SELECT min(id) FROM finance_cutover_fixture.historical)",[]],
    ["UPDATE finance_cutover_fixture.accounts SET branch_id=2 WHERE id=$1",[accountId]],
    ["UPDATE public.commerce_sales SET branch_id=2 WHERE id=$1",[dueSale]],
    ["DELETE FROM finance_cutover_fixture.checkpoints WHERE id=$1",[openingCheckpoint]],
   ];
   for(const [sql,params] of statements)await rejectsText(()=>inNewTransaction(next!,async c=>{await c.query(sql,params);}),/FINANCE_CASH_EVIDENCE_IMMUTABLE/);
   await admin!.query("GRANT TRUNCATE ON finance_cutover_fixture.movements TO cutover_new_test");
   try{await rejectsText(()=>inNewTransaction(next!,async c=>{await c.query("TRUNCATE finance_cutover_fixture.movements");}),/FINANCE_CUTOVER_BLOCKED/);}
   finally{await admin!.query("REVOKE TRUNCATE ON finance_cutover_fixture.movements FROM cutover_new_test");}
   assert.deepEqual(await counts(admin!),before);
  });
  await t.test("concurrent ordinary versus historical posting for one old event can commit only once",async()=>{
   for(const [isolation,sale,amount] of [["SERIALIZABLE",dueSale,"10"],["READ COMMITTED",refundSale,"40"]] as const){
    const oldId=String((await admin!.query(`SELECT id FROM public.commerce_collections WHERE sale_id=$1::bigint AND is_initial AND method='CASH'`,[sale])).rows[0].id);
    const a=await next!.connect(),b=await next!.connect();
    try{
     for(const c of [a,b]){await c.query(`BEGIN ISOLATION LEVEL ${isolation}`);await c.query("SELECT finance_cutover_test.begin_new_transaction()");}
     await cashMovement(a,"COLLECTION",oldId,accountId,openingCheckpoint,amount);
     await historical(b,"COLLECTION",oldId,accountId,openingCheckpoint,amount);
     const outcome=await Promise.allSettled([a.query("COMMIT"),b.query("COMMIT")]);
     assert.equal(outcome.filter(x=>x.status==="fulfilled").length,1,isolation);
     const rejected=outcome.find(x=>x.status==="rejected") as PromiseRejectedResult;
     assert.match(String(rejected.reason),/could not serialize|FINANCE_CASH_LINK_REQUIRED|deadlock detected/i);
     const saved=(await admin!.query(`SELECT
      (SELECT count(*)::int FROM finance_cutover_fixture.movements WHERE collection_id=$1::bigint) AS m,
      (SELECT count(*)::int FROM finance_cutover_fixture.historical WHERE collection_id=$1::bigint) AS h`,[oldId])).rows[0];
     assert.equal(saved.m+saved.h,1);
    }finally{await a.query("ROLLBACK").catch(()=>{});await b.query("ROLLBACK").catch(()=>{});a.release();b.release();}
   }
  });
  await t.test("a newer checkpoint invalidates an ordinary posting even when its count races commit",async()=>{
   const latest=String(await inNewTransaction(next!,async c=>(await c.query(`INSERT INTO finance_cutover_fixture.checkpoints
    (account_id,kind,counted_on,observed_amount,confirmed_by) VALUES($1,'COUNT','2020-01-02',100,1) RETURNING id`,[accountId])).rows[0].id));
   const before=await counts(admin!);
   await rejectsText(()=>inNewTransaction(next!,async c=>{
    const id=await collection(c,dueSale);await cashMovement(c,"COLLECTION",id,accountId,openingCheckpoint);
   }),/FINANCE_CASH_MOVEMENT_INVALID/);
   assert.deepEqual(await counts(admin!),before);
   await inNewTransaction(next!,async c=>{const id=await refundEvent(c,refundSale);await cashMovement(c,"REFUND",id,accountId,latest);});
   const afterValid=await counts(admin!);
   const money=await next!.connect(),count=await next!.connect();let pending:Promise<unknown>|undefined;
   try{
    for(const c of [money,count]){await c.query("BEGIN ISOLATION LEVEL SERIALIZABLE");await c.query("SELECT finance_cutover_test.begin_new_transaction()");}
    const id=await collection(money,dueSale);await cashMovement(money,"COLLECTION",id,accountId,latest);
    await count.query(`INSERT INTO finance_cutover_fixture.checkpoints(account_id,kind,counted_on,observed_amount,confirmed_by)
     VALUES($1,'COUNT','2020-01-03',100,2)`,[accountId]);
    const moneyPid=(await money.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const countPid=(await count.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    pending=money.query("COMMIT");
    // Install a rejection observer immediately while checking the lock graph.
    void pending.catch(()=>{});await waitForBlock(admin!,moneyPid,countPid);
    await count.query("COMMIT");await rejectsText(()=>pending!,/could not serialize|FINANCE_CASH_MOVEMENT_INVALID/i);
    assert.deepEqual(await counts(admin!),afterValid);
   }finally{await count.query("ROLLBACK").catch(()=>{});await money.query("ROLLBACK").catch(()=>{});count.release();money.release();}
  });
  await t.test("checkpoint racing cash under READ COMMITTED is rechecked after the lock wait",async()=>{
   const latest=String((await admin!.query(`SELECT id FROM finance_cutover_fixture.checkpoints WHERE account_id=$1 ORDER BY id DESC LIMIT 1`,[accountId])).rows[0].id);
   const before=await counts(admin!),money=await next!.connect(),count=await next!.connect();let pending:Promise<unknown>|undefined;
   try{
    for(const c of [money,count]){await c.query("BEGIN ISOLATION LEVEL READ COMMITTED");await c.query("SELECT finance_cutover_test.begin_new_transaction()");}
    const id=await collection(money,dueSale);await cashMovement(money,"COLLECTION",id,accountId,latest);
    await count.query(`INSERT INTO finance_cutover_fixture.checkpoints(account_id,kind,counted_on,observed_amount,confirmed_by)
     VALUES($1,'COUNT','2020-01-04',100,2)`,[accountId]);
    const moneyPid=(await money.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const countPid=(await count.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    pending=money.query("COMMIT");void pending.catch(()=>{});await waitForBlock(admin!,moneyPid,countPid);
    await count.query("COMMIT");await rejectsText(()=>pending!,/FINANCE_CASH_MOVEMENT_INVALID/);
    assert.deepEqual(await counts(admin!),before);
   }finally{await count.query("ROLLBACK").catch(()=>{});await money.query("ROLLBACK").catch(()=>{});count.release();money.release();}
  });
  await t.test("freeze waits for an authorized NEW transaction and never returns to the old version after activation",async()=>{
   const writer=await next!.connect(),manager=await admin!.connect();let open=true;
   try{
    await writer.query("BEGIN");await writer.query("SELECT finance_cutover_test.begin_new_transaction()");
    await writer.query("INSERT INTO finance_cutover_fixture.audit_events(note) VALUES('حدث وهمي')");
    const writerPid=(await writer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const managerPid=(await manager.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const frozen=transition(manager,request(),5,"NEW","FROZEN","إيقاف للتحقق");
    await waitForBlock(admin!,managerPid,writerPid);await writer.query("COMMIT");open=false;
    assert.equal((await frozen).current_revision,6);
    await rejectsText(()=>transition(admin!,request(),6,"FROZEN","LEGACY"),/FINANCE_CUTOVER_INVALID_TRANSITION/);
    await rejectsText(()=>next!.query("SELECT finance_cutover_test.begin_new_transaction()"),/FINANCE_CUTOVER_BLOCKED/);
    assert.equal((await transition(admin!,request(),6,"FROZEN","NEW","استئناف التجربة")).current_revision,7);
   }finally{if(open)await writer.query("ROLLBACK").catch(()=>{});writer.release();manager.release();}
  });
 }finally{
  if(oldApp)await oldApp.$disconnect().catch(()=>{});if(newRoleOldCode)await newRoleOldCode.$disconnect().catch(()=>{});
  if(legacy)await legacy.end();if(next)await next.end();if(admin)await admin.end();if(server)await stop(server);rmSync(tmp,{recursive:true,force:true});
 }
});
