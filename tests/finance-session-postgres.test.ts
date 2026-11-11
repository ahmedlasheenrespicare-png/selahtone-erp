/** Isolated PostgreSQL cluster; no DATABASE_URL and no real data. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PrismaClient } from "@prisma/client";
import { accessTableLockTestOnly } from "../prototypes/finance-access-atomicity/table-lock.test-only";
import { updateDirectoryUser } from "../src/lib/admin-directory-operations";
import { openAccount } from "../src/lib/finance/engine";
import { financePort } from "../src/lib/finance/port";
import { financeDbForSession } from "../src/lib/finance/session-transaction";
import type { FinanceDatabase, FinanceTransaction } from "../src/lib/finance/types";

const root=process.cwd(), req=createRequire(join(root,"package.json"));
const read=(p:string)=>readFileSync(join(root,p),"utf8");
const {PrismaClient:WasmClient}=req("@prisma/client/wasm") as {PrismaClient:new (options:{adapter:unknown})=>PrismaClient};
function gate() {let release!:()=>void,signal!:()=>void;return {wait:new Promise<void>(r=>{release=r;}),entered:new Promise<void>(r=>{signal=r;}),release:()=>release(),signal:()=>signal()};}
async function waitForSessionLock(client:Client, table="auth_sessions") {
  const end=Date.now()+8000;
  while(Date.now()<end) {
    await client.query("SELECT pg_stat_clear_snapshot()");
    if((await client.query(`SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()
      AND wait_event_type='Lock' AND query ILIKE $1 LIMIT 1`,[`%${table}%`])).rows.length) return;
    await new Promise(r=>setTimeout(r,25));
  }
  throw new Error(`${table} lock was not reached`);
}

test("finance session, directory and experimental access races on disposable PostgreSQL", {timeout:120_000}, async()=>{
  const bin=process.env.SYNTHETIC_POSTGRES_BIN;assert.ok(bin,"Set SYNTHETIC_POSTGRES_BIN to disposable local PostgreSQL binaries");
  const dir=mkdtempSync(join(tmpdir(),"selahtone-session-pg-")),data=join(dir,"data"),log=join(dir,"postgres.log");
  const ctl=(args:string[])=>execFileSync(join(bin,"pg_ctl"),args,{stdio:"pipe",timeout:30000});
  let started=false,admin:Client|undefined,revoker:Client|undefined,prisma:PrismaClient|undefined;
  try {
    execFileSync(join(bin,"initdb"),["-D",data,"-U","postgres","--no-locale","--encoding=UTF8","--auth=trust"],{stdio:"pipe",timeout:30000});
    ctl(["-D",data,"-l",log,"-o",`-k ${dir} -p 55439 -c listen_addresses=''`,"-w","start"]);started=true;
    const config={host:dir,port:55439,user:"postgres",database:"postgres"};
    admin=new Client(config);revoker=new Client(config);await admin.connect();await revoker.connect();
    const {buildDdl}=req("./scripts/local-pglite-ddl.cjs") as {buildDdl:()=>string};
    await admin.query(buildDdl());await admin.query(read("scripts/local-pglite-seed.sql").replaceAll("__PREVIEW_BCRYPT__","synthetic"));
    await admin.query("SET selahtone.finance_release_candidate_test_only='yes'");
    for(const f of ["prototypes/finance-release/release-candidate.test-only.sql","prisma/manual-settlement-upgrade.sql","prisma/manual-custody-closure-upgrade.sql"]) await admin.query(read(f));
    prisma=new WasmClient({adapter:new PrismaPg(config)});
    const db:FinanceDatabase={serializable:work=>prisma!.$transaction(tx=>work(financePort(tx)),{isolationLevel:"Serializable",timeout:20000})};
    const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Cairo"}).format(new Date());
    const input=(branchId:string)=>({requestId:randomUUID(),branchId,kind:"VAULT",holderId:null,openingAmount:"0",openingDate:today,counted:true});
    const actor={id:"1",role:"MANAGER",branchId:null,email:"manager@selahtone.local"};
    const sid1=randomUUID(),sid2=randomUUID(),sid3=randomUUID(),sid4=randomUUID();
    await admin.query("INSERT INTO auth_sessions(id,user_id,expires_at) VALUES ($1,1,now()+interval '1 hour'),($2,1,now()+interval '1 hour'),($3,1,now()+interval '1 hour'),($4,1,clock_timestamp()+interval '3 seconds')",[sid1,sid2,sid3,sid4]);
    // Deleting first: writer must wait, retry if needed, then fail without writing.
    const first=input("1");
    await revoker.query("BEGIN");await revoker.query("DELETE FROM auth_sessions WHERE id=$1",[sid1]);
    const denied=openAccount(financeDbForSession(db,{...actor,sessionId:sid1},"/finance/accounts#open"),"1",first,today).then(value=>({value}),error=>({error}));
    try {await waitForSessionLock(admin);} finally {await revoker.query("COMMIT");}
    const outcome=await denied;assert.ok("error" in outcome);assert.match(String(outcome.error),/انتهت الجلسة أو أُلغيت/);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.accounts WHERE branch_id=1")).rows[0].n,0);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.requests WHERE request_id=$1::uuid",[first.requestId])).rows[0].n,0);
    assert.equal((await openAccount(financeDbForSession(db,{...actor,sessionId:sid2},"/finance/accounts#open"),"1",first,today)).replayed,false);
    // Writer first: its row lock blocks revocation until the write commits.
    const g=gate();let once=false;
    const gated:FinanceDatabase={serializable:work=>prisma!.$transaction(async tx=>{
      const port=financePort(tx);
      const wrapped:FinanceTransaction={...port,query:async <T extends Record<string,unknown>>(sql:string,params?:unknown[])=>{
        const result=await port.query<T>(sql,params);
        if(!once&&sql.includes("FROM public.auth_sessions")&&sql.includes("FOR SHARE")){once=true;g.signal();await g.wait;}
        return result;
      }};
      return work(wrapped);
    },{isolationLevel:"Serializable",timeout:20000})};
    const second=input("2"),session2={...actor,sessionId:sid2};
    const writing=openAccount(financeDbForSession(gated,session2,"/finance/accounts#open"),"1",second,today);
    await g.entered;
    const removing=revoker.query("DELETE FROM auth_sessions WHERE id=$1",[sid2]);
    try {await waitForSessionLock(admin);} finally {g.release();}
    const saved=await writing;await removing;
    assert.equal(saved.replayed,false);
    await assert.rejects(()=>openAccount(financeDbForSession(db,session2,"/finance/accounts#open"),"1",second,today),/انتهت الجلسة أو أُلغيت/);
    assert.deepEqual(await openAccount(financeDbForSession(db,{...actor,sessionId:sid3},"/finance/accounts#open"),"1",second,today),{id:saved.id,replayed:true});
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.accounts WHERE branch_id=2")).rows[0].n,1);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.requests WHERE request_id=$1::uuid",[second.requestId])).rows[0].n,1);
    // An active session can expire while the write waits for its row lock.
    await admin.query("UPDATE auth_sessions SET expires_at=clock_timestamp()+interval '1 second' WHERE id=$1",[sid4]);
    await revoker.query("BEGIN");await revoker.query("SELECT id FROM auth_sessions WHERE id=$1 FOR UPDATE",[sid4]);
    const third=input("3");
    const expired=openAccount(financeDbForSession(db,{...actor,sessionId:sid4},"/finance/accounts#open"),"1",third,today).then(value=>({value}),error=>({error}));
    try {await waitForSessionLock(admin);await revoker.query("SELECT pg_sleep(1.2)");} finally {await revoker.query("COMMIT");}
    const expiredResult=await expired;assert.ok("error" in expiredResult);assert.match(String(expiredResult.error),/انتهت الجلسة أو أُلغيت/);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.accounts WHERE branch_id=3")).rows[0].n,0);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.requests WHERE request_id=$1::uuid",[third.requestId])).rows[0].n,0);

    // The system-admin bypass uses email as well as role; a directory email
    // change must not leave an old authenticated access decision usable.
    const original=await prisma.user.findUniqueOrThrow({where:{id:1n},select:{fullName:true,email:true,phone:true,roleCode:true,branchId:true,status:true}});
    const changedEmail="changed-manager@selahtone.local";
    const directoryInput={userId:1n,actorRole:"MANAGER" as const,expected:original,data:{...original,email:changedEmail},financeOn:true};
    const before=gate();let directoryPaused=false;
    const directory=new Proxy(prisma,{get(target,key,receiver){
      if(key!=="$transaction")return Reflect.get(target,key,receiver);
      return (work:(tx:unknown)=>Promise<unknown>,options:unknown)=>target.$transaction(async tx=>{
        const wrapped=new Proxy(tx,{get(obj,prop,recv){
          if(prop!=="$queryRawUnsafe")return Reflect.get(obj,prop,recv);
          return async(sql:string,...params:unknown[])=>{
            const result=await tx.$queryRawUnsafe(sql,...params);
            if(!directoryPaused&&sql.includes("FROM public.users WHERE id=$1::bigint FOR UPDATE")){directoryPaused=true;before.signal();await before.wait;}
            return result;
          };
        }});
        return work(wrapped);
      },options as never);
    }}) as PrismaClient;
    const change=updateDirectoryUser(directory,directoryInput);
    await before.entered;
    const emailOld={...actor,sessionId:sid3};
    const stale=openAccount(financeDbForSession(db,emailOld,"/finance/accounts#open"),"1",third,today).then(value=>({value}),error=>({error}));
    try {await waitForSessionLock(admin,"users");} finally {before.release();}
    await change;
    const staleResult=await stale;assert.ok("error" in staleResult);assert.match(String(staleResult.error),/تعذّر التحقق من صلاحية الحساب/);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.requests WHERE request_id=$1::uuid",[third.requestId])).rows[0].n,0);
    const emailNew={...emailOld,email:changedEmail};
    const emailSaved=await openAccount(financeDbForSession(db,emailNew,"/finance/accounts#open"),"1",third,today);
    assert.equal(emailSaved.replayed,false);
    await assert.rejects(()=>openAccount(financeDbForSession(db,emailOld,"/finance/accounts#open"),"1",third,today),/تعذّر التحقق من صلاحية الحساب/);
    assert.deepEqual(await openAccount(financeDbForSession(db,emailNew,"/finance/accounts#open"),"1",third,today),{id:emailSaved.id,replayed:true});

    await admin.query(`INSERT INTO branches(id,code,name_ar,invoice_prefix,opening_date,is_active,created_at) VALUES(4,'PG4','فرع اصطناعي','PG4',CURRENT_DATE,true,now())`);
    const after=gate();let actorPaused=false;
    const gatedUser:FinanceDatabase={serializable:work=>prisma!.$transaction(async tx=>{
      const port=financePort(tx);
      const wrapped:FinanceTransaction={...port,query:async <T extends Record<string,unknown>>(sql:string,params?:unknown[])=>{
        const result=await port.query<T>(sql,params);
        if(!actorPaused&&sql.includes('must_change_password AS "mustChange"')&&sql.includes("FOR SHARE")){actorPaused=true;after.signal();await after.wait;}
        return result;
      }};
      return work(wrapped);
    },{isolationLevel:"Serializable",timeout:20000})};
    const fourth=input("4");
    const writingFirst=openAccount(financeDbForSession(gatedUser,emailNew,"/finance/accounts#open"),"1",fourth,today);
    await after.entered;
    const changeBack=updateDirectoryUser(prisma,{...directoryInput,expected:{...original,email:changedEmail},data:original});
    try {await waitForSessionLock(admin,"users");} finally {after.release();}
    const fourthSaved=await writingFirst;await changeBack;
    assert.equal(fourthSaved.replayed,false);
    await assert.rejects(()=>openAccount(financeDbForSession(db,emailNew,"/finance/accounts#open"),"1",fourth,today),/تعذّر التحقق من صلاحية الحساب/);
    assert.deepEqual(await openAccount(financeDbForSession(db,emailOld,"/finance/accounts#open"),"1",fourth,today),{id:fourthSaved.id,replayed:true});
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.accounts WHERE branch_id=4")).rows[0].n,1);

    // Test-only access barrier, never wired into the HTTP actions. Locking the
    // table BEFORE reading the actor avoids taking an old serializable snapshot.
    await admin.query(read("prisma/manual-access-control-upgrade.sql"));
    await admin.query(`INSERT INTO branches(id,code,name_ar,invoice_prefix,opening_date,is_active,created_at) VALUES
      (5,'PG5','فرع صلاحية أول','PG5',CURRENT_DATE,true,now()),(6,'PG6','فرع صلاحية ثان','PG6',CURRENT_DATE,true,now())`);
    const accountantSession=randomUUID();
    await admin.query("INSERT INTO auth_sessions(id,user_id,expires_at) VALUES($1,2,now()+interval '1 hour')",[accountantSession]);
    const accountant={id:"2",role:"ACCOUNTANT",branchId:null,email:"accountant@selahtone.local",sessionId:accountantSession};
    const action="/finance/accounts#open";
    const firstAccess=input("5");
    await revoker.query("BEGIN");
    await revoker.query(`INSERT INTO access_control(subject_kind,subject,key,allowed) VALUES('role','ACCOUNTANT',$1,false)`,[action]);
    const accessDenied=openAccount(accessTableLockTestOnly(db,accountant,action),"2",firstAccess,today).then(value=>({value}),error=>({error}));
    try {await waitForSessionLock(admin,"access_control");} finally {await revoker.query("COMMIT");}
    const accessOutcome=await accessDenied;assert.ok("error" in accessOutcome);assert.match(String(accessOutcome.error),/معطلة بالصلاحيات/);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.accounts WHERE branch_id=5")).rows[0].n,0);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.requests WHERE request_id=$1::uuid",[firstAccess.requestId])).rows[0].n,0);
    // A per-user exception overrides the role denial, as in the real policy.
    await admin.query(`INSERT INTO access_control(subject_kind,subject,key,allowed) VALUES('user','2',$1,true)`,[action]);
    assert.equal((await openAccount(accessTableLockTestOnly(db,accountant,action),"2",firstAccess,today)).replayed,false);
    await admin.query(`INSERT INTO access_control(subject_kind,subject,key,allowed) VALUES('role','ACCOUNTANT','/finance#write',false)`);
    await assert.rejects(()=>openAccount(accessTableLockTestOnly(db,accountant,action),"2",firstAccess,today),/معطلة بالصلاحيات/);
    await admin.query(`DELETE FROM access_control WHERE key='/finance#write'`);
    assert.deepEqual(await openAccount(accessTableLockTestOnly(db,accountant,action),"2",firstAccess,today),{id:(await admin.query<{id:string}>("SELECT result_id::text AS id FROM finance.requests WHERE request_id=$1::uuid",[firstAccess.requestId])).rows[0].id,replayed:true});
    assert.throws(()=>accessTableLockTestOnly(db,accountant,"/finance/unknown#write"),/مفتاح صلاحية غير معروف/);
    await admin.query(`DELETE FROM access_control WHERE key=$1`,[action]);
    const accessGate=gate();let accessPaused=false;
    const gatedAccess:FinanceDatabase={serializable:work=>prisma!.$transaction(async tx=>{
      const port=financePort(tx);
      const wrapped:FinanceTransaction={...port,query:async <T extends Record<string,unknown>>(sql:string,params?:unknown[])=>{
        const result=await port.query<T>(sql,params);
        if(!accessPaused&&sql.startsWith("LOCK TABLE public.access_control")){accessPaused=true;accessGate.signal();await accessGate.wait;}
        return result;
      }};
      return work(wrapped);
    },{isolationLevel:"Serializable",timeout:20000})};
    const secondAccess=input("6");
    const accessWriting=openAccount(accessTableLockTestOnly(gatedAccess,accountant,action),"2",secondAccess,today);
    await accessGate.entered;
    const accessRevoking=revoker.query(`INSERT INTO access_control(subject_kind,subject,key,allowed) VALUES('role','ACCOUNTANT',$1,false)`,[action]);
    try {await waitForSessionLock(admin,"access_control");} finally {accessGate.release();}
    const accessSaved=await accessWriting;await accessRevoking;
    assert.equal(accessSaved.replayed,false);
    await assert.rejects(()=>openAccount(accessTableLockTestOnly(db,accountant,action),"2",secondAccess,today),/معطلة بالصلاحيات/);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.accounts WHERE branch_id=6")).rows[0].n,1);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.requests WHERE request_id=$1::uuid",[secondAccess.requestId])).rows[0].n,1);
    // This coarse candidate holds the table even for a session already revoked:
    // an unrelated permission change must wait until authorization fails.
    const invalidGate=gate();let invalidPaused=false;
    const gatedInvalid:FinanceDatabase={serializable:work=>prisma!.$transaction(async tx=>{
      const port=financePort(tx);
      const wrapped:FinanceTransaction={...port,query:async <T extends Record<string,unknown>>(sql:string,params?:unknown[])=>{
        const result=await port.query<T>(sql,params);
        if(!invalidPaused&&sql.startsWith("LOCK TABLE public.access_control")){invalidPaused=true;invalidGate.signal();await invalidGate.wait;}
        return result;
      }};return work(wrapped);
    },{isolationLevel:"Serializable",timeout:20000})};
    const rejected=openAccount(accessTableLockTestOnly(gatedInvalid,{...accountant,sessionId:"revoked-synthetic"},action),"2",input("5"),today).then(value=>({value}),error=>({error}));
    await invalidGate.entered;
    const unrelated=revoker.query(`INSERT INTO access_control(subject_kind,subject,key,allowed) VALUES('role','CS_AGENT','/sales/new',false)`);
    try {await waitForSessionLock(admin,"access_control");} finally {invalidGate.release();}
    const rejectedResult=await rejected;assert.ok("error" in rejectedResult);assert.match(String(rejectedResult.error),/انتهت الجلسة أو أُلغيت/);await unrelated;

    // A lower-privilege application role with SELECT only cannot necessarily
    // acquire this SHARE table lock. This does not inspect any real database.
    await admin.query("CREATE ROLE finance_access_reader_test NOLOGIN; GRANT USAGE ON SCHEMA public TO finance_access_reader_test; GRANT SELECT ON public.access_control TO finance_access_reader_test");
    await revoker.query("BEGIN");
    try {
      await revoker.query("SET LOCAL ROLE finance_access_reader_test");
      await assert.rejects(()=>revoker!.query("LOCK TABLE public.access_control IN SHARE MODE"),(e:unknown)=>typeof e==="object"&&e!==null&&"code" in e&&e.code==="42501");
    } finally {await revoker.query("ROLLBACK");}

    // Counterexample: locking the user first starts a snapshot. Taking the
    // table lock afterwards cannot refresh it, even if a denial committed in
    // between; an unrelated synthetic write may still commit afterward.
    await admin.query(`DELETE FROM access_control WHERE subject_kind='role' AND subject='ACCOUNTANT' AND key=$1`,[action]);
    await admin.query("CREATE TABLE public.access_snapshot_writes_test_only(id integer PRIMARY KEY)");
    const staleConnection=new Client(config);await staleConnection.connect();
    try {
      await staleConnection.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      await staleConnection.query("SELECT id FROM public.users WHERE id=2 FOR SHARE");
      await admin.query(`INSERT INTO access_control(subject_kind,subject,key,allowed) VALUES('role','ACCOUNTANT',$1,false)`,[action]);
      await staleConnection.query("LOCK TABLE public.access_control IN SHARE MODE");
      const staleRules=await staleConnection.query("SELECT allowed FROM access_control WHERE subject_kind='role' AND subject='ACCOUNTANT' AND key=$1",[action]);
      assert.equal(staleRules.rows.length,0);
      await staleConnection.query("INSERT INTO public.access_snapshot_writes_test_only(id) VALUES (1)");
      await staleConnection.query("COMMIT");
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM public.access_snapshot_writes_test_only")).rows[0].n,1);
      assert.equal((await admin.query<{allowed:boolean}>(`SELECT allowed FROM access_control WHERE subject_kind='role' AND subject='ACCOUNTANT' AND key=$1`,[action])).rows[0].allowed,false);
    } finally {await staleConnection.end();}

    // Missing store fails the experimental non-admin boundary closed.
    await admin.query("DROP TABLE public.access_control");
    await assert.rejects(()=>openAccount(accessTableLockTestOnly(db,accountant,action),"2",firstAccess,today));
  } finally {
    if(prisma) await prisma.$disconnect();if(revoker) await revoker.end();if(admin) await admin.end();
    if(started) ctl(["-D",data,"-m","immediate","-w","stop"]);rmSync(dir,{recursive:true,force:true});
  }
});
