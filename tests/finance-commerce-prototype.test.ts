/**
 * Laboratory experiment ONLY: intercepts actual commerce service writes in a
 * disposable in-memory fixture to explore one-transaction cash posting. The
 * interceptor is deliberately confined to this test and is not a product API.
 * It does NOT solve the legacy request hash / cutover / UI integration issues.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import type { PrismaClient } from "@prisma/client";
import { createCommerceSale, recordCommerceCollection, recordCommerceRefund, returnCommerceSale } from "../src/lib/commerce-operations";
import { FinanceProblem, type FinanceDatabase, type FinanceTransaction } from "../prototypes/finance-engine/types";
import { listAccounts, openAccount, postCashCollectionInTransaction, postCashRefundInTransaction } from "../prototypes/finance-engine/engine";

const root=process.cwd();
const read=(p:string)=>readFileSync(path.join(root,p),"utf8");
type Tx=Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
function sqlPort(tx:Tx):FinanceTransaction {
  return {query:async <T extends Record<string,unknown>>(sql:string,parameters:unknown[]=[])=>({rows:await tx.$queryRawUnsafe<T[]>(sql,...parameters)})};
}
function labDb(client:PrismaClient):FinanceDatabase {
  return {serializable:work=>client.$transaction(tx=>work(sqlPort(tx)),{isolationLevel:"Serializable",maxWait:5000,timeout:20000})};
}
/** A deliberately local-only probe, NOT a production integration strategy. */
function probeBridge(client:PrismaClient, choice: {accountId?:string;expectedBalance?:string;negativeAcknowledged?:boolean}):PrismaClient {
  return new Proxy(client,{
    get(target,key) {
      if(key==="$transaction") return (work:(tx:Tx)=>unknown,options:unknown)=>target.$transaction(async tx=>{
        const wrapped=new Proxy(tx,{
          get(transaction,prop) {
            if(prop!=="commerceCollection" && prop!=="commerceRefund") {
              const v=Reflect.get(transaction,prop);return typeof v==="function"?v.bind(transaction):v;
            }
            const delegate=Reflect.get(transaction,prop);
            return new Proxy(delegate,{
              get(model,method) {
                const v=Reflect.get(model,method);if(method!=="create")return typeof v==="function"?v.bind(model):v;
                return async (args:{data:{method:string;saleId:bigint;createdById:bigint;amount:unknown}})=>{
                  const created=await v.call(model,args) as {id:bigint};
                  // Only actual cash movements are routed to the lab ledger.
                  if(args.data.method==="CASH") {
                    if(!choice.accountId)throw new FinanceProblem("account_required","يجب اختيار الحساب النقدي في تجربة الربط.");
                    const sale=await transaction.commerceSale.findUniqueOrThrow({where:{id:args.data.saleId},select:{branchId:true}});
                    const common={branchId:sale.branchId.toString(),accountId:choice.accountId,amount:String(args.data.amount)};
                    if(prop==="commerceCollection") await postCashCollectionInTransaction(sqlPort(transaction),args.data.createdById.toString(),{...common,collectionId:created.id.toString()});
                    else {
                      if(choice.expectedBalance===undefined)throw new FinanceProblem("balance_review_required","يجب مراجعة الرصيد.");
                      await postCashRefundInTransaction(sqlPort(transaction),args.data.createdById.toString(),{...common,refundId:created.id.toString(),expectedBalance:choice.expectedBalance,negativeAcknowledged:choice.negativeAcknowledged===true});
                    }
                  }
                  return created;
                };
              },
            });
          },
        }) as Tx;
        return work(wrapped);
      },options as never);
      const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;
    },
  });
}
const req=()=>randomUUID();
const saleInput=(method="CASH")=>({requestId:req(),warehouseId:"1",customerName:"عميل وهمي",customerPhone:"01000000000",discount:"0",initialPayment:"10",method,lines:[{productId:"2",quantity:"2",serialIds:[],expectedUnitPrice:"20",expectedTaxRateId:3,expectedTaxKind:"EXEMPT",expectedTaxRate:"0"}]});
const movement=(saleId:string,amount:string,method:string,actuallyPaid=false)=>({requestId:req(),saleId,amount,method,actuallyPaid});

test("experiment: real commerce functions and finance lab share one disposable transaction",{timeout:120_000},async t=>{
  const tmp=mkdtempSync(path.join(os.tmpdir(),"selahtone-finance-commerce-"));let pg:PGlite|undefined,client:PrismaClient|undefined;
  try {
    // A separate engine-less Prisma test client with the WASM PGlite adapter;
    // the placeholder URLs are never used to open a network connection.
    symlinkSync(path.join(root,"node_modules"),path.join(tmp,"node_modules"),"dir");
    const original=read("prisma/schema.prisma");
    const schema=original.replace('provider = "prisma-client-js"','provider = "prisma-client-js"\n  output = "./client"\n  engineType = "client"');assert.notEqual(schema,original);
    const schemaPath=path.join(tmp,"schema.prisma");writeFileSync(schemaPath,schema);
    const env:NodeJS.ProcessEnv={PATH:process.env.PATH,HOME:tmp,TMPDIR:process.env.TMPDIR,NODE_ENV:"test",DATABASE_URL:"postgresql://fixture:fixture@127.0.0.1:5432/fixture",DIRECT_URL:"postgresql://fixture:fixture@127.0.0.1:5432/fixture",PRISMA_GENERATE_SKIP_AUTOINSTALL:"1",PRISMA_HIDE_UPDATE_MESSAGE:"1"};
    if(process.env.PRISMA_SCHEMA_ENGINE_BINARY)env.PRISMA_SCHEMA_ENGINE_BINARY=process.env.PRISMA_SCHEMA_ENGINE_BINARY;
    if(process.env.PRISMA_QUERY_ENGINE_LIBRARY)env.PRISMA_QUERY_ENGINE_LIBRARY=process.env.PRISMA_QUERY_ENGINE_LIBRARY;
    execFileSync(process.execPath,[path.join(root,"node_modules/prisma/build/index.js"),"generate",`--schema=${schemaPath}`],{cwd:root,env,stdio:"pipe",timeout:45_000});
    const {PrismaClient:TestClient}=createRequire(path.join(root,"package.json"))(path.join(tmp,"client")) as {PrismaClient:typeof PrismaClient};
    pg=new PGlite();
    await pg.exec(read("tests/fixtures/inventory-baseline.sql"));
    await pg.exec(read("prisma/manual-inventory-upgrade.sql"));await pg.exec(read("prisma/manual-receiving-upgrade.sql"));await pg.exec(read("prisma/manual-commerce-upgrade.sql"));
    await pg.exec(`INSERT INTO tax_rates(code,name_ar,rate,kind,effective_from,is_active) VALUES('LAB-EX','معفى وهمي',0,'EXEMPT','2000-01-01',TRUE);
      UPDATE products SET sale_price=20,tax_rate_id=3 WHERE id=2;
      INSERT INTO stock_levels(warehouse_id,product_id,qty_on_hand,avg_cost) VALUES(1,2,30,4);
      SET selahtone.finance_lab_test_only = 'yes';`);
    await pg.exec(read("prototypes/finance-engine/schema.test-only.sql"));
    await pg.exec(`INSERT INTO finance_lab.branches(id,name_ar,is_active) SELECT id,name_ar,is_active FROM public.branches;
      INSERT INTO finance_lab.users(id,branch_id,role_code,status,must_change_password,full_name)
      SELECT id,branch_id,role_code::text,status::text,must_change_password,full_name FROM public.users;`);
    client=new TestClient({adapter:new PrismaPGlite(pg) as never});const db=client,lab=labDb(db);
    const opening=(branchId:string,kind:"VAULT"|"CUSTODY",holderId:string|null,openingAmount:string)=>({requestId:req(),branchId,kind,holderId,openingAmount,openingDate:"2026-10-20",counted:true});
    const vault=(await openAccount(lab,"1",opening("1","VAULT",null,"100"),"2026-10-29")).id;
    const custody=(await openAccount(lab,"1",opening("1","CUSTODY","3","30"),"2026-10-29")).id;
    const otherVault=(await openAccount(lab,"1",opening("2","VAULT",null,"50"),"2026-10-29")).id;
    const balance=async(id:string)=>(await listAccounts(lab,"1")).find(a=>a.id===id)!.balance;
    const movementCount=async()=>Number((await pg!.query<{n:number}>("SELECT count(*)::int AS n FROM finance_lab.movements")).rows[0].n);
    let saleId="";

    await t.test("cash first payment posts once to actual custody; replay does not duplicate",async()=>{
      const request=saleInput(),bridged=probeBridge(db,{accountId:custody});
      const saved=await createCommerceSale(bridged,3n,request);saleId=saved.id;
      assert.equal(await balance(custody),"40.00");assert.equal(await balance(vault),"100.00");assert.equal(await movementCount(),1);
      assert.equal((await createCommerceSale(bridged,3n,request)).replayed,true);assert.equal(await movementCount(),1);
      // Known integration blocker: the deployed sales parser/hash has no cash
      // account field, so a changed choice on the same request replays silently.
      assert.equal((await createCommerceSale(probeBridge(db,{accountId:vault}),3n,request)).replayed,true);
      assert.equal(await balance(custody),"40.00");assert.equal(await balance(vault),"100.00");
    });
    await t.test("other payment methods do not touch physical cash; later cash goes to the selected vault",async()=>{
      const before=await movementCount();
      await recordCommerceCollection(probeBridge(db,{}),2n,movement(saleId,"5","WALLET"));
      assert.equal(await movementCount(),before);
      const input=movement(saleId,"5","CASH");const bridged=probeBridge(db,{accountId:vault});
      await recordCommerceCollection(bridged,3n,input);assert.equal((await recordCommerceCollection(bridged,3n,input)).replayed,true);
      // The legacy collection hash also omits this test-only account choice.
      assert.equal((await recordCommerceCollection(probeBridge(db,{accountId:custody}),3n,input)).replayed,true);
      assert.equal(await balance(vault),"105.00");assert.equal(await movementCount(),before+1);
      for(const method of ["CARD","BANK_TRANSFER","WALLET"])await createCommerceSale(probeBridge(db,{}),3n,saleInput(method));
      assert.equal(await balance(custody),"40.00");assert.equal(await balance(vault),"105.00");assert.equal(await movementCount(),before+1);
    });
    await t.test("invalid holder or a late ledger failure rolls back the sale and collection",async()=>{
      const beforeSales=await db.commerceSale.count(),beforeCollections=await db.commerceCollection.count(),beforeStock=(await db.stockLevel.findUniqueOrThrow({where:{warehouseId_productId:{warehouseId:1n,productId:2n}}})).qtyOnHand.toFixed(2);
      await assert.rejects(()=>createCommerceSale(probeBridge(db,{accountId:otherVault}),3n,saleInput()),(error:unknown)=>error instanceof FinanceProblem&&error.code==="forbidden");
      assert.equal(await db.commerceSale.count(),beforeSales);assert.equal(await db.commerceCollection.count(),beforeCollections);
      assert.equal((await db.stockLevel.findUniqueOrThrow({where:{warehouseId_productId:{warehouseId:1n,productId:2n}}})).qtyOnHand.toFixed(2),beforeStock);
      await pg!.exec(`CREATE FUNCTION finance_lab.reject_lab_collection() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='COLLECTION' THEN RAISE EXCEPTION 'late lab rejection'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER reject_lab_collection BEFORE INSERT ON finance_lab.movements FOR EACH ROW EXECUTE FUNCTION finance_lab.reject_lab_collection();`);
      try {
        await assert.rejects(()=>recordCommerceCollection(probeBridge(db,{accountId:custody}),3n,movement(saleId,"1","CASH")));
        assert.equal(await db.commerceCollection.count(),beforeCollections);assert.equal(await balance(custody),"40.00");
      } finally {await pg!.exec("DROP TRIGGER reject_lab_collection ON finance_lab.movements; DROP FUNCTION finance_lab.reject_lab_collection()");}
    });
    await t.test("return alone moves no cash; only actual cash refund debits the paying account",async()=>{
      const before=await movementCount();
      await returnCommerceSale(probeBridge(db,{}),1n,{requestId:req(),saleId,cancel:true,accepted:true,lines:[]});
      assert.equal(await movementCount(),before);assert.equal(await balance(custody),"40.00");
      const ref=movement(saleId,"5","CASH",true),bridged=probeBridge(db,{accountId:custody,expectedBalance:"40"});
      await recordCommerceRefund(bridged,2n,ref);assert.equal((await recordCommerceRefund(bridged,2n,ref)).replayed,true);
      // Refund request identity must also include the source-account choice.
      assert.equal((await recordCommerceRefund(probeBridge(db,{accountId:vault,expectedBalance:"105"}),2n,ref)).replayed,true);
      assert.equal(await balance(custody),"35.00");assert.equal(await movementCount(),before+1);
      await recordCommerceRefund(probeBridge(db,{}),1n,movement(saleId,"3","CARD",true));
      assert.equal(await balance(custody),"35.00");assert.equal(await movementCount(),before+1);
      const refunds=await db.commerceRefund.count();
      await assert.rejects(()=>recordCommerceRefund(probeBridge(db,{accountId:custody,expectedBalance:"99"}),2n,movement(saleId,"1","CASH",true)),(error:unknown)=>error instanceof FinanceProblem&&error.code==="balance_changed");
      await assert.rejects(()=>recordCommerceRefund(probeBridge(db,{accountId:custody,expectedBalance:"35"}),2n,movement(saleId,"1","CASH",false)));
      assert.equal(await db.commerceRefund.count(),refunds);assert.equal(await balance(custody),"35.00");
    });
  } finally {if(client)await client.$disconnect().catch(()=>{});if(pg)await pg.close();rmSync(tmp,{recursive:true,force:true});}
});
