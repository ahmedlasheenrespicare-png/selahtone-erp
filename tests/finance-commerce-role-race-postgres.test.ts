/** Synthetic PostgreSQL race against the actual catalog sale and directory services. */
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
import { updateDirectoryUser } from "../src/lib/admin-directory-operations";
import { createCatalogSale } from "../src/lib/catalog-sales";
import { openAccount } from "../src/lib/finance/engine";
import { financePort } from "../src/lib/finance/port";
import type { FinanceDatabase } from "../src/lib/finance/types";
import { actor } from "./helpers/commerce-actor";

const root=process.cwd(), require=createRequire(join(root,"package.json"));
const { PrismaClient: WasmClient }=require("@prisma/client/wasm") as { PrismaClient:new (options:{adapter:unknown})=>PrismaClient };
const read=(p:string)=>readFileSync(join(root,p),"utf8");

test("catalog cash sale and directory role change in two controlled PostgreSQL interleavings", {timeout:120_000}, async()=>{
  const bin=process.env.SYNTHETIC_POSTGRES_BIN;assert.ok(bin,"set SYNTHETIC_POSTGRES_BIN to disposable PostgreSQL binaries");
  const dir=mkdtempSync(join(tmpdir(),"commerce-role-race-")),data=join(dir,"data"),log=join(dir,"postgres.log");
  const ctl=(args:string[])=>execFileSync(join(bin,"pg_ctl"),args,{stdio:"pipe",timeout:30000});
  const oldFinance=process.env.FINANCE_ENABLED;process.env.FINANCE_ENABLED="true";
  let started=false,admin:Client|undefined,prisma:PrismaClient|undefined;
  try {
    execFileSync(join(bin,"initdb"),["-D",data,"-U","postgres","--no-locale","--encoding=UTF8","--auth=trust"],{stdio:"pipe",timeout:30000});
    ctl(["-D",data,"-l",log,"-o",`-k ${dir} -p 55441 -c listen_addresses=''`,"-w","start"]);started=true;
    const config={host:dir,port:55441,user:"postgres",database:"postgres"};admin=new Client(config);await admin.connect();
    const {buildDdl}=require("./scripts/local-pglite-ddl.cjs") as {buildDdl:()=>string};
    await admin.query(buildDdl());await admin.query(read("scripts/local-pglite-seed.sql").replaceAll("__PREVIEW_BCRYPT__","synthetic"));await admin.query(read("tests/fixtures/commerce-auth-sessions.sql"));
    await admin.query("SET selahtone.finance_release_candidate_test_only='yes'");
    for(const f of ["prototypes/finance-release/release-candidate.test-only.sql","prisma/manual-settlement-upgrade.sql","prisma/manual-custody-closure-upgrade.sql","prisma/manual-custody-and-count-requests.sql"]) await admin.query(read(f));
    prisma=new WasmClient({adapter:new PrismaPg(config)});
    const db:FinanceDatabase={serializable:work=>prisma!.$transaction(tx=>work(financePort(tx)),{isolationLevel:"Serializable",timeout:20000})};
    const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Cairo"}).format(new Date());
    const account=await openAccount(db,"1",{requestId:randomUUID(),branchId:"1",kind:"CUSTODY",holderId:"3",openingAmount:"0",openingDate:today,counted:true},today);
    const category=(await admin.query<{id:string}>("INSERT INTO sales_item_categories(code,name_ar) VALUES ('ROLE_RACE','فئة اختبار') RETURNING id::text")).rows[0].id;
    const item=(await admin.query<{id:string}>("INSERT INTO sales_item_types(category_id,name_ar) VALUES ($1,'صنف اختبار') RETURNING id::text",[category])).rows[0].id;
    const input={requestId:randomUUID(),branchId:"1",customerName:"عميل اصطناعي",customerPhone:"01000000000",discount:"0",initialPayment:"7",method:"CASH",lines:[{typeId:item,quantity:"1",unitPrice:"100",details:[]}]};
    const original=await prisma.user.findUniqueOrThrow({where:{id:3n},select:{fullName:true,email:true,phone:true,roleCode:true,branchId:true,status:true}});
    let release!:()=>void,signal!:()=>void;
    const gate=new Promise<void>(r=>{release=r}),entered=new Promise<void>(r=>{signal=r});let paused=false;
    let attempts=0;
    const gated=new Proxy(prisma,{get(target,key,receiver){
      if(key!=="$transaction")return Reflect.get(target,key,receiver);
      return async (work:(tx:unknown)=>Promise<unknown>,options:unknown)=>{attempts++;try{return await target.$transaction(async tx=>{
        const wrapped=new Proxy(tx,{get(obj,prop,recv){
          if(prop!=="user")return Reflect.get(obj,prop,recv);
          const delegate=tx.user;
          return new Proxy(delegate,{get(d,k,r){
            if(k!=="findUnique")return Reflect.get(d,k,r);
            return async (args:Parameters<typeof delegate.findUnique>[0])=>{
              const result=await delegate.findUnique(args);
              if(!paused){paused=true;signal();await gate;}
              return result;
            };
          }});
        }});
        return work(wrapped);
      },options as never);}catch(e){throw e;}};
    }}) as PrismaClient;
    const pending=createCatalogSale(gated, actor(3n) ,input).then(value=>({value}),error=>({error}));
    await entered;
    try {
      await updateDirectoryUser(prisma,{userId:3n,actorRole:"MANAGER",expected:original,data:{...original,roleCode:"ACCOUNTANT"},financeOn:true});
    } finally {release();}
    const result=await pending;
    // The foreign-key check at sale insertion encounters the updated user row
    // under SERIALIZABLE, so this particular interleaving retries authorization.
    assert.ok("error" in result);
    assert.match(String(result.error),/ليس لديك صلاحية/);
    assert.ok(attempts>=2, "the conflicting first transaction must be retried");
    assert.equal((await prisma.user.findUniqueOrThrow({where:{id:3n}})).roleCode,"ACCOUNTANT");
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_sales WHERE request_id=$1::uuid",[input.requestId])).rows[0].n,0);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_collections WHERE request_id=$1::uuid",[input.requestId])).rows[0].n,0);
    assert.equal((await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.accounts WHERE id=$1::bigint",[account.id])).rows[0].revision,"0");
    const changed=await prisma.user.findUniqueOrThrow({where:{id:3n},select:{fullName:true,email:true,phone:true,roleCode:true,branchId:true,status:true}});
    await updateDirectoryUser(prisma,{userId:3n,actorRole:"MANAGER",expected:changed,data:original,financeOn:true});

    // Sale first: pause after the actual collection insert. The directory's
    // explicit user FOR UPDATE must wait for the transaction holding FK locks.
    let releaseSecond!:()=>void,signalSecond!:()=>void;
    const gateSecond=new Promise<void>(r=>{releaseSecond=r}),enteredSecond=new Promise<void>(r=>{signalSecond=r});let secondPaused=false;
    const gatedSecond=new Proxy(prisma,{get(target,key,receiver){
      if(key!=="$transaction")return Reflect.get(target,key,receiver);
      return async (work:(tx:unknown)=>Promise<unknown>,options:unknown)=>target.$transaction(async tx=>{
        const wrapped=new Proxy(tx,{get(obj,prop,recv){
          if(prop!=="commerceCollection")return Reflect.get(obj,prop,recv);
          const delegate=tx.commerceCollection;
          return new Proxy(delegate,{get(d,k,r){
            if(k!=="create")return Reflect.get(d,k,r);
            return async (args:Parameters<typeof delegate.create>[0])=>{
              const value=await delegate.create(args);
              if(!secondPaused){secondPaused=true;signalSecond();await gateSecond;}
              return value;
            };
          }});
        }});
        return work(wrapped);
      },options as never);
    }}) as PrismaClient;
    const second={...input,requestId:randomUUID()};
    const writing=createCatalogSale(gatedSecond, actor(3n) ,second);
    await enteredSecond;
    const changing=updateDirectoryUser(prisma,{userId:3n,actorRole:"MANAGER",expected:original,data:{...original,roleCode:"ACCOUNTANT"},financeOn:true});
    try {
      const deadline=Date.now()+8000;let waiting=false;
      while(Date.now()<deadline){
        const rows=await admin.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query ILIKE '%users%' LIMIT 1");
        if(rows.rows.length){waiting=true;break;}
        await new Promise(r=>setTimeout(r,25));
      }
      assert.ok(waiting,"directory update must wait on user lock");
    } finally {releaseSecond();}
    const saved=await writing;await changing;
    assert.equal(saved.replayed,false);
    assert.equal((await prisma.user.findUniqueOrThrow({where:{id:3n}})).roleCode,"ACCOUNTANT");
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_sales WHERE request_id=$1::uuid",[second.requestId])).rows[0].n,1);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_collections WHERE request_id=$1::uuid",[second.requestId])).rows[0].n,1);
    assert.equal((await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.accounts WHERE id=$1::bigint",[account.id])).rows[0].revision,"1");
    await assert.rejects(()=>createCatalogSale(prisma!, actor(3n) ,second),/ليس لديك صلاحية/);
  } finally {
    if(prisma)await prisma.$disconnect();if(admin)await admin.end();
    if(started)ctl(["-D",data,"-m","immediate","-w","stop"]);
    rmSync(dir,{recursive:true,force:true});
    if(oldFinance===undefined)delete process.env.FINANCE_ENABLED;else process.env.FINANCE_ENABLED=oldFinance;
  }
});
