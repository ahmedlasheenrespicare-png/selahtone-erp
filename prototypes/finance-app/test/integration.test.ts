/** Run only from the launcher-created disposable copy. Never uses DATABASE_URL.
 * It tests the actual laboratory commerce service, not the older interceptor. */
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import type { PrismaClient } from "@prisma/client";
import { PrismaClient as TestClient } from "../.finance-client";
import { createCommerceSale, recordCommerceCollection, recordCommerceRefund, recordHistoricalCollection, recordHistoricalRefund, returnCommerceSale } from "../src/lib/commerce-operations";
import { assertFinanceActor, financeTx, sqlError } from "../src/lib/finance-bridge";
import { readFictionalAttachment } from "../src/lib/finance-attachment-form";
import { InventoryProblem } from "../src/lib/inventory-operations";
import { addCategory, addExpenseAttachment, createExpense, getExpenseAttachment, listExpenseAttachments, listAccounts, openAccount, approveExpense, payExpense, requestPaidExpenseReview, confirmPaidExpenseCorrection, closePaidExpenseReview, requestCashCount, confirmCashCount, listCashCounts, listExpenses, listPaidExpenseReviews, listExpenseCorrections, correctOpeningBalance, listOpeningCorrections, createReconciliationCase, addReconciliationNote, closeReconciliationCase, listReconciliationCases, listReconciliationNotes } from "../prototypes/finance-engine/engine";
import { FinanceProblem, type FinanceDatabase } from "../prototypes/finance-engine/types";
import { cairoDate } from "../prototypes/finance-engine/validation";

test("multipart parser requires exactly one fictional file and enforces its byte limit", async () => {
  const file = new File(["%PDF-1.4"],"demo.pdf",{type:"application/pdf"});
  const data = new FormData();data.append("attachment",file);
  assert.deepEqual(await readFictionalAttachment(data),{name:"demo.pdf",mediaType:"application/pdf",bytes:new TextEncoder().encode("%PDF-1.4")});
  const none=new FormData(),text=new FormData(),two=new FormData(),large=new FormData();
  text.append("attachment","not a file");two.append("attachment",file);two.append("attachment",file);
  large.append("attachment",new File([new Uint8Array(5_000_001)],"too-large.pdf",{type:"application/pdf"}));
  for(const invalid of [none,text,two,large]) await assert.rejects(()=>readFictionalAttachment(invalid),(e:unknown)=>e instanceof FinanceProblem && e.code==="invalid_attachment");
});

const read = (file: string) => readFileSync(file, "utf8");
const req = () => randomUUID();
const saleInput = (method = "CASH", cashAccountId = "2", initialPayment = "10") => ({ requestId: req(), warehouseId: "1", customerName: "عميل وهمي", customerPhone: "01000000000", discount: "0", initialPayment, method, cashAccountId: method === "CASH" ? cashAccountId : "", cashCheckpointRef:method === "CASH" ? "OPENING" : "", afterCheckpoint:method === "CASH", lines: [{ productId: "2", quantity: "2", serialIds: [], expectedUnitPrice: "20", expectedTaxRateId: 3, expectedTaxKind: "EXEMPT", expectedTaxRate: "0" }] });
const movement = (saleId: string, amount: string, method: string, accountId = "", actuallyPaid = false, expectedBalance = "", negativeAcknowledged = false) => ({ requestId: req(), saleId, amount, method, cashAccountId: accountId, actuallyPaid, expectedBalance, negativeAcknowledged, cashCheckpointRef:method === "CASH" ? "OPENING" : "", afterCheckpoint:method === "CASH" });
const financeDb = (client: PrismaClient): FinanceDatabase => ({ serializable: async (work) => {
  try { return await client.$transaction(tx => work(financeTx(tx)), { isolationLevel: "Serializable", maxWait: 5000, timeout: 20000 }); } catch (error) { return sqlError(error); }
} });
const files = ["tests/fixtures/inventory-baseline.sql", "prisma/manual-inventory-upgrade.sql", "prisma/manual-receiving-upgrade.sql", "prisma/manual-commerce-upgrade.sql"];
type RunSql = (sql: string) => Promise<unknown>;
async function initialize(exec: RunSql) {
  for (const f of files) await exec(read(f));
  await exec(`INSERT INTO tax_rates(code,name_ar,rate,kind,effective_from,is_active) VALUES('LAB-EX','معفى وهمي',0,'EXEMPT','2000-01-01',TRUE);
    UPDATE products SET sale_price=20,tax_rate_id=3 WHERE id=2;
    INSERT INTO users(branch_id,role_code,full_name,email,password_hash,status,must_change_password) VALUES (1,'CS_AGENT','موظف آخر وهمي','other-staff@example.test','fixture','ACTIVE',false);
    INSERT INTO stock_levels(warehouse_id,product_id,qty_on_hand,avg_cost) VALUES(1,2,100,4);
    SET selahtone.finance_lab_test_only = 'yes';`);
  await exec(read("prototypes/finance-engine/schema.test-only.sql"));
  await exec(`INSERT INTO finance_lab.branches(id,name_ar,is_active) SELECT id,name_ar,is_active FROM public.branches;
    INSERT INTO finance_lab.users(id,branch_id,role_code,status,must_change_password,full_name)
    SELECT id,branch_id,role_code::text,status::text,must_change_password,full_name FROM public.users;`);
}
function gate() {
  let arrivals = 0, release!: () => void, timer: NodeJS.Timeout | undefined;
  const ready = new Promise<void>((resolve, reject) => { release = resolve; timer = setTimeout(() => reject(new Error("both transactions did not reach the concurrency gate")), 8000); });
  return {
    wait: async () => { if (arrivals >= 2) return; arrivals++; if (arrivals === 2) { if (timer) clearTimeout(timer); release(); } await ready; },
    reached: () => assert.equal(arrivals, 2),
    cancel: () => { if (timer) clearTimeout(timer); release(); },
  };
}
/** Intercept only test transactions to force real overlap. Production/lab code
 * itself remains unchanged. Gate stays open on serializable retries. */
function raceDb(client: PrismaClient, g: ReturnType<typeof gate>, target: "sale-create" | "sale-lock" | "account-lock" | "branch-lock" | "case-lock" | "sale-any-lock"): PrismaClient {
  return new Proxy(client, { get(db, property) {
    if (property !== "$transaction") { const v = Reflect.get(db, property); return typeof v === "function" ? v.bind(db) : v; }
    return (work: (tx: unknown) => unknown, options: unknown) => db.$transaction(async tx => {
      const wrapped = new Proxy(tx, { get(transaction, key) {
        const v = Reflect.get(transaction, key);
        if (target === "sale-create" && key === "commerceSale") return new Proxy(v, { get(delegate, method) {
          const original = Reflect.get(delegate, method);
          if (method === "create") return async (...args: unknown[]) => { await g.wait(); return original.apply(delegate, args); };
          return typeof original === "function" ? original.bind(delegate) : original;
        } });
        if ((target === "sale-lock" || target === "sale-any-lock") && key === "$queryRaw") return async (...args: unknown[]) => {
          const sql = Array.isArray(args[0]) ? args[0].join("?") : String(args[0]);
          if (sql.includes('FROM "commerce_sales"') && sql.includes("FOR UPDATE")) await g.wait();
          return v.apply(transaction, args);
        };
        if ((target === "account-lock" || target === "branch-lock" || target === "case-lock" || target === "sale-any-lock") && key === "$queryRawUnsafe") return async (...args: unknown[]) => {
          const sql=String(args[0]);
          if ((target === "account-lock" && sql.includes("FROM finance_lab.accounts WHERE id=$1::bigint FOR UPDATE")) ||
              (target === "branch-lock" && sql.includes("FROM public.branches p JOIN finance_lab.branches")) ||
              (target === "case-lock" && sql.includes("FROM finance_lab.reconciliation_cases") && sql.includes("FOR UPDATE")) ||
              (target === "sale-any-lock" && sql.includes("FROM public.commerce_sales") && sql.includes("FOR UPDATE"))) await g.wait();
          return v.apply(transaction, args);
        };
        return typeof v === "function" ? v.bind(transaction) : v;
      } });
      return work(wrapped);
    }, options as never);
  } }) as PrismaClient;
}
async function scenario(t: TestContext, client: PrismaClient, exec: RunSql, native: boolean) {
  const db = financeDb(client);
  const opening = (branchId: string, kind: "VAULT" | "CUSTODY", holderId: string | null, openingAmount: string) => ({ requestId: req(), branchId, kind, holderId, openingAmount, openingDate: "2020-01-01", counted: true });
  const vault = (await openAccount(db,"1",opening("1","VAULT",null,"100"))).id;
  const custody = (await openAccount(db,"1",opening("1","CUSTODY","3","30"))).id;
  const other = (await openAccount(db,"1",opening("2","VAULT",null,"50"))).id;
  const colleague = (await openAccount(db,"1",opening("1","CUSTODY","5","25"))).id;
  assert.deepEqual([vault,custody,other,colleague],["1","2","3","4"]);
  const balance = async (id: string) => (await listAccounts(db,"1")).find(a => a.id === id)!.balance;
  const count = async () => Number((await client.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM finance_lab.movements`)[0].n);
  const qty = async () => (await client.stockLevel.findUniqueOrThrow({where:{warehouseId_productId:{warehouseId:1n,productId:2n}}})).qtyOnHand.toFixed(2);
  let saleId = "";
  const firstRequest = saleInput("CASH",custody);
  await t.test("Prisma lab bridge saves and reads fictional attachment bytes with role checks", async () => {
    const category = await addCategory(db,"1",{requestId:req(),name:"مرفقات وهمية"});
    const expense = await createExpense(db,"1",{requestId:req(),branchId:"1",categoryId:category.id,amount:"10",expenseDate:"2026-10-20",description:"مصروف وهمي للمرفق",beneficiary:"",documentNumber:"",taxAmount:""});
    const file={name:"dummy.png",mediaType:"image/png",bytes:new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x01])}, input={requestId:req(),expenseId:expense.id};
    const saved=await addExpenseAttachment(db,"1",input,file); assert.equal((await addExpenseAttachment(db,"1",input,file)).replayed,true);
    const loaded=await getExpenseAttachment(db,"2",expense.id);assert.equal(loaded?.id,saved.id);assert.deepEqual(loaded?.bytes,file.bytes);
    assert.equal((await listExpenseAttachments(db,"2")).filter(a=>a.expenseId===expense.id).length,1);
    for(const operation of [()=>getExpenseAttachment(db,"3",expense.id),()=>listExpenseAttachments(db,"3"),()=>addExpenseAttachment(db,"3",{requestId:req(),expenseId:expense.id},file)])
      await assert.rejects(operation,(error:unknown)=>error instanceof FinanceProblem && error.code==="forbidden");
    await assert.rejects(()=>addExpenseAttachment(db,"2",{requestId:req(),expenseId:expense.id},file),(error:unknown)=>error instanceof FinanceProblem && error.code==="attachment_exists");
  });
  await t.test("first cash collection is atomic and request identity includes the selected holder", async () => {
    const input = firstRequest; const saved = await createCommerceSale(client,3n,input); saleId = saved.id;
    assert.equal(await balance(custody),"40.00"); assert.equal(await count(),1);
    assert.equal((await createCommerceSale(client,3n,input)).replayed,true);
    await assert.rejects(() => createCommerceSale(client,3n,{...input,cashAccountId:vault}), InventoryProblem);
    assert.equal(await balance(custody),"40.00"); assert.equal(await balance(vault),"100.00"); assert.equal(await count(),1);
  });
  await t.test("later cash collection is bound to its account; other methods never move cash", async () => {
    const before = await count(); await recordCommerceCollection(client,2n,movement(saleId,"5","WALLET"));
    const input = movement(saleId,"5","CASH",vault); await recordCommerceCollection(client,3n,input);
    assert.equal((await recordCommerceCollection(client,3n,input)).replayed,true);
    await assert.rejects(() => recordCommerceCollection(client,3n,{...input,cashAccountId:custody}), InventoryProblem);
    for (const method of ["CARD","BANK_TRANSFER","WALLET"]) await createCommerceSale(client,3n,saleInput(method));
    assert.equal(await count(),before+1); assert.equal(await balance(vault),"105.00");
  });
  await t.test("forbidden account and a deliberately failed last ledger write roll back sale, stock and collection", async () => {
    const sales = await client.commerceSale.count(), collections = await client.commerceCollection.count(), stock = await qty(), before = await count();
    await assert.rejects(() => createCommerceSale(client,3n,saleInput("CASH",other)), (e: unknown) => e instanceof FinanceProblem && e.code === "forbidden");
    await assert.rejects(() => createCommerceSale(client,3n,saleInput("CASH",colleague)), (e: unknown) => e instanceof FinanceProblem && e.code === "forbidden");
    assert.equal(await client.commerceSale.count(),sales); assert.equal(await client.commerceCollection.count(),collections); assert.equal(await qty(),stock); assert.equal(await count(),before);
    await exec(`CREATE FUNCTION finance_lab.reject_movement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'deliberate late lab failure'; END $$;
      CREATE TRIGGER reject_movement BEFORE INSERT ON finance_lab.movements FOR EACH ROW EXECUTE FUNCTION finance_lab.reject_movement()`);
    try {
      await assert.rejects(() => createCommerceSale(client,3n,saleInput("CASH",custody)));
      await assert.rejects(() => recordCommerceCollection(client,3n,movement(saleId,"1","CASH",custody)));
      assert.equal(await client.commerceSale.count(),sales); assert.equal(await client.commerceCollection.count(),collections); assert.equal(await qty(),stock); assert.equal(await count(),before);
    } finally { await exec("DROP TRIGGER reject_movement ON finance_lab.movements; DROP FUNCTION finance_lab.reject_movement()"); }
  });
  await t.test("identity divergence between real session records and lab stand-ins fails closed", async () => {
    const sales = await client.commerceSale.count(), stock = await qty(), before = await count();
    await exec("UPDATE users SET role_code='MANAGER' WHERE id=3");
    try {
      await assert.rejects(() => client.$transaction(tx => assertFinanceActor(tx,"3",{role:"CS_AGENT",branchId:"1"})), (e: unknown) => e instanceof FinanceProblem && e.code === "forbidden");
      await assert.rejects(() => createCommerceSale(client,3n,saleInput("CASH",vault)), (e: unknown) => e instanceof FinanceProblem && e.code === "forbidden");
      await assert.rejects(() => createCommerceSale(client,3n,firstRequest), (e: unknown) => e instanceof FinanceProblem && e.code === "forbidden");
      assert.equal(await client.commerceSale.count(),sales); assert.equal(await qty(),stock); assert.equal(await count(),before);
    } finally { await exec("UPDATE users SET role_code='CS_AGENT' WHERE id=3"); }
  });
  await t.test("return itself has no cash effect, actual refund debits its holder, and retries cannot change account", async () => {
    const before = await count(); await returnCommerceSale(client,1n,{ requestId:req(),saleId,cancel:true,accepted:true,lines:[] });
    assert.equal(await count(),before); assert.equal(await balance(custody),"40.00");
    const input = movement(saleId,"5","CASH",custody,true,"40"); await recordCommerceRefund(client,2n,input);
    assert.equal((await recordCommerceRefund(client,2n,input)).replayed,true);
    await assert.rejects(() => recordCommerceRefund(client,2n,{...input,cashAccountId:vault,expectedBalance:"105"}), InventoryProblem);
    await recordCommerceRefund(client,1n,movement(saleId,"3","CARD","",true));
    await assert.rejects(() => recordCommerceRefund(client,2n,movement(saleId,"1","CASH",custody,true,"99")), (e: unknown) => e instanceof FinanceProblem && e.code === "balance_changed");
    assert.equal(await count(),before+1); assert.equal(await balance(custody),"35.00");
  });
  await t.test("negative cash refund requires explicit acknowledgment", async () => {
    const s = (await createCommerceSale(client,3n,saleInput("CARD","","40"))).id;
    await returnCommerceSale(client,1n,{requestId:req(),saleId:s,cancel:true,accepted:true,lines:[]});
    const no = movement(s,"36","CASH",custody,true,"35",false); await assert.rejects(() => recordCommerceRefund(client,2n,no), (e: unknown) => e instanceof FinanceProblem && e.code === "negative_warning");
    assert.equal(await balance(custody),"35.00"); await recordCommerceRefund(client,2n,{...no,requestId:req(),negativeAcknowledged:true}); assert.equal(await balance(custody),"-1.00");
  });
  await t.test("only managers/accountants settle existing inactive-branch invoices; cash is atomic and branch-bound", async () => {
    const due=(await createCommerceSale(client,3n,saleInput("CARD","","10"))).id;
    const staffPrevious=movement(due,"1","CARD");await recordCommerceCollection(client,3n,staffPrevious);
    const credit=(await createCommerceSale(client,3n,saleInput("CARD","","40"))).id;
    await returnCommerceSale(client,1n,{requestId:req(),saleId:credit,cancel:true,accepted:true,lines:[]});
    const beforeCash=await count(), beforeCollections=await client.commerceCollection.count(), beforeRefunds=await client.commerceRefund.count();
    const vaultStart=await balance(vault), custodyStart=await balance(custody);
    await exec("UPDATE branches SET is_active=false WHERE id=1; UPDATE finance_lab.branches SET is_active=false WHERE id=1");
    try {
      // Neither a new sale nor a new/replayed employee collection is allowed.
      for(const actor of [1n,3n]) await assert.rejects(()=>createCommerceSale(client,actor,saleInput("CARD")),InventoryProblem);
      for(const method of ["CASH","CARD","BANK_TRANSFER","WALLET"]) await assert.rejects(()=>recordCommerceCollection(client,3n,movement(due,"1",method,method==="CASH"?vault:"")),InventoryProblem);
      await assert.rejects(()=>recordCommerceCollection(client,3n,staffPrevious),InventoryProblem);
      await assert.rejects(()=>recordCommerceRefund(client,3n,movement(credit,"1","CARD","",true)),InventoryProblem);
      assert.equal(await client.commerceCollection.count(),beforeCollections);assert.equal(await client.commerceRefund.count(),beforeRefunds);assert.equal(await count(),beforeCash);
      // A mismatched holder, a nonactual refund, stale identity, or divergent
      // duplicate branch state cannot create partial settlement records.
      await assert.rejects(()=>recordCommerceCollection(client,1n,movement(due,"1","CASH",other)),(e:unknown)=>e instanceof FinanceProblem && e.code==="forbidden");
      await assert.rejects(()=>recordCommerceRefund(client,2n,movement(credit,"1","CASH",other,true,"50")),(e:unknown)=>e instanceof FinanceProblem && e.code==="account_branch");
      await assert.rejects(()=>recordCommerceRefund(client,2n,movement(credit,"1","CARD","",false)),InventoryProblem);
      await exec("UPDATE finance_lab.branches SET is_active=true WHERE id=1");
      try {
        await assert.rejects(()=>recordCommerceCollection(client,2n,movement(due,"1","CARD")),(e:unknown)=>e instanceof FinanceProblem && e.code==="branch_state_mismatch");
        await assert.rejects(()=>recordCommerceRefund(client,2n,movement(credit,"1","WALLET","",true)),(e:unknown)=>e instanceof FinanceProblem && e.code==="branch_state_mismatch");
      } finally { await exec("UPDATE finance_lab.branches SET is_active=false WHERE id=1"); }
      await exec("UPDATE finance_lab.users SET role_code='CS_AGENT' WHERE id=2");
      try { await assert.rejects(()=>recordCommerceCollection(client,2n,movement(due,"1","CARD")),(e:unknown)=>e instanceof FinanceProblem && e.code==="forbidden"); }
      finally { await exec("UPDATE finance_lab.users SET role_code='ACCOUNTANT' WHERE id=2"); }
      assert.equal(await client.commerceCollection.count(),beforeCollections);assert.equal(await client.commerceRefund.count(),beforeRefunds);assert.equal(await count(),beforeCash);
      const cashIn=movement(due,"5","CASH",vault);await recordCommerceCollection(client,1n,cashIn);assert.equal((await recordCommerceCollection(client,1n,cashIn)).replayed,true);
      await assert.rejects(()=>recordCommerceCollection(client,1n,{...cashIn,cashAccountId:custody}),InventoryProblem);
      await recordCommerceCollection(client,2n,movement(due,"2","CASH",custody));
      assert.equal(await balance(vault),(Number(vaultStart)+5).toFixed(2));assert.equal(await balance(custody),(Number(custodyStart)+2).toFixed(2));assert.equal(await count(),beforeCash+2);
      const cashBeforeNoncash=await count();
      for(const [actor,method] of [[1n,"CARD"],[2n,"BANK_TRANSFER"],[1n,"WALLET"]] as const) await recordCommerceCollection(client,actor,movement(due,"1",method));
      assert.equal(await count(),cashBeforeNoncash);
      const cashOut=movement(credit,"3","CASH",vault,true,await balance(vault));await recordCommerceRefund(client,2n,cashOut);assert.equal((await recordCommerceRefund(client,2n,cashOut)).replayed,true);
      await recordCommerceRefund(client,1n,movement(credit,"1","CASH",custody,true,await balance(custody)));
      assert.equal(await balance(vault),(Number(vaultStart)+2).toFixed(2));assert.equal(await balance(custody),(Number(custodyStart)+1).toFixed(2));
      const cashBeforeRefunds=await count();
      for(const [actor,method] of [[1n,"CARD"],[2n,"BANK_TRANSFER"],[1n,"WALLET"]] as const) await recordCommerceRefund(client,actor,movement(credit,"1",method,"",true));
      assert.equal(await count(),cashBeforeRefunds);
      // The collection row, holder balance and idempotency roll back together
      // even when the last cash-ledger write fails after branch deactivation.
      const late=movement(due,"1","CASH",vault), saved=await client.commerceCollection.count(), savedRefunds=await client.commerceRefund.count(), movements=await count(), priorBalance=await balance(vault);
      const lateRefund=movement(credit,"1","CASH",vault,true,priorBalance);
      await exec(`CREATE FUNCTION finance_lab.reject_stopped_movement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'late inactive-branch failure'; END $$;
        CREATE TRIGGER reject_stopped_movement BEFORE INSERT ON finance_lab.movements FOR EACH ROW EXECUTE FUNCTION finance_lab.reject_stopped_movement()`);
      try { await assert.rejects(()=>recordCommerceCollection(client,1n,late));await assert.rejects(()=>recordCommerceRefund(client,2n,lateRefund)); }
      finally { await exec("DROP TRIGGER reject_stopped_movement ON finance_lab.movements; DROP FUNCTION finance_lab.reject_stopped_movement()"); }
      assert.equal(await client.commerceCollection.count(),saved);assert.equal(await client.commerceRefund.count(),savedRefunds);assert.equal(await count(),movements);assert.equal(await balance(vault),priorBalance);
      await recordCommerceRefund(client,2n,lateRefund);assert.equal((await recordCommerceRefund(client,2n,lateRefund)).replayed,true);
      await recordCommerceCollection(client,1n,late);assert.equal((await recordCommerceCollection(client,1n,late)).replayed,true);
      assert.equal(await count(),movements+2);
    } finally { await exec("UPDATE branches SET is_active=true WHERE id=1; UPDATE finance_lab.branches SET is_active=true WHERE id=1"); }
    // Once active again, the normal branch-employee collection policy applies.
    await recordCommerceCollection(client,3n,movement(due,"1","CARD"));
  });
  let labCountId="", labCategory="";
  await t.test("Prisma bridge confirms counted cash and a same-day paid correction without rewriting payment", async () => {
    assert.equal(await balance(other),"50.00");
    const raw={requestId:req(),accountId:other,expectedBalance:"50",countedAmount:"45",reason:"جرد وهمي عبر الجسر",actuallyCounted:true};
    await assert.rejects(()=>requestCashCount(db,"3",raw),(e:unknown)=>e instanceof FinanceProblem && e.code==="forbidden");
    const c=await requestCashCount(db,"1",raw);labCountId=c.id;assert.equal(await balance(other),"50.00");
    const confirm={requestId:req(),countId:c.id,reason:"تأكيد جرد وهمي",stillCurrent:true};await confirmCashCount(db,"2",confirm);assert.equal((await confirmCashCount(db,"2",confirm)).replayed,true);assert.equal(await balance(other),"45.00");
    await assert.rejects(()=>listCashCounts(db,"3"),(e:unknown)=>e instanceof FinanceProblem && e.code==="forbidden");
    labCategory=(await addCategory(db,"1",{requestId:req(),name:"تصحيح وهمي عبر الجسر"})).id;
    const expense=await createExpense(db,"1",{requestId:req(),branchId:"2",categoryId:labCategory,amount:"10",expenseDate:"2020-01-02",description:"دفع بعد جرد وهمي",taxAmount:""});
    await approveExpense(db,"1",{requestId:req(),expenseId:expense.id,expectedRevision:"1"});
    await payExpense(db,"1",{requestId:req(),expenseId:expense.id,expectedRevision:"2",method:"CASH",accountId:other,paymentDate:cairoDate(),actuallyPaid:true,expectedBalance:"45",afterCountId:c.id,afterCount:true});
    const review=await requestPaidExpenseReview(db,"1",{requestId:req(),expenseId:expense.id,expectedRevision:"3",reason:"تدقيق وهمي",proposedAmount:"8"});
    const fix={requestId:req(),reviewId:review.id,confirmedAmount:"8",expectedBalance:"35",reason:"تحقق وهمي",verifiedPayment:true,noPriorSettlement:true};
    await confirmPaidExpenseCorrection(db,"2",fix);assert.equal((await confirmPaidExpenseCorrection(db,"2",fix)).replayed,true);assert.equal(await balance(other),"37.00");
    const saved=(await listExpenses(db,"1")).find(e=>e.id===expense.id)!;assert.equal(saved.originalAmount,"10.00");assert.equal(saved.paymentAmount,"10.00");assert.equal(saved.amount,"8.00");assert.equal(saved.paymentAfterCountId,c.id);
    const history=(await listExpenseCorrections(db,"2")).find(x=>x.expenseId===expense.id)!;assert.equal(history.balanceBefore,"35.00");assert.equal(history.balanceAfter,"37.00");
    const second=await requestPaidExpenseReview(db,"1",{requestId:req(),expenseId:expense.id,expectedRevision:"4",reason:"فحص ثانٍ",proposedAmount:"7"});
    const before=await count();await exec("UPDATE public.branches SET is_active=false WHERE id=2");
    try {
      await assert.rejects(()=>requestCashCount(db,"1",{requestId:req(),accountId:other,expectedBalance:"37",countedAmount:"37",reason:"حالة فرع غير متطابقة",actuallyCounted:true}),(e:unknown)=>e instanceof FinanceProblem && e.code==="branch_state_mismatch");
      await assert.rejects(()=>confirmPaidExpenseCorrection(db,"1",{requestId:req(),reviewId:second.id,confirmedAmount:"7",expectedBalance:"37",reason:"تحقق وهمي",verifiedPayment:true,noPriorSettlement:true}),(e:unknown)=>e instanceof FinanceProblem && e.code==="branch_state_mismatch");
    } finally {await exec("UPDATE public.branches SET is_active=true WHERE id=2");}
    assert.equal(await count(),before);assert.equal(await balance(other),"37.00");assert.ok((await listPaidExpenseReviews(db,"1")).some(x=>x.id===second.id));
    const close={requestId:req(),reviewId:second.id,reason:"لا تصحيح بعد الفحص"};await closePaidExpenseReview(db,"2",close);assert.equal((await closePaidExpenseReview(db,"2",close)).replayed,true);
    assert.equal(await count(),before);assert.equal(await balance(other),"37.00");assert.equal((await listExpenses(db,"1")).find(e=>e.id===expense.id)!.amount,"8.00");
  });
  await t.test("historical collections and refunds update only the invoice after reviewed checkpoint", async () => {
    await exec("INSERT INTO stock_levels(warehouse_id,product_id,qty_on_hand,avg_cost) VALUES(2,2,100,4)");
    const branchTwo=(pay:string)=>({...saleInput("CARD","",pay),warehouseId:"2"});
    const due=(await createCommerceSale(client,1n,branchTwo("10"))).id;
    const credit=(await createCommerceSale(client,1n,branchTwo("40"))).id;
    await returnCommerceSale(client,1n,{requestId:req(),saleId:credit,cancel:true,accepted:true,lines:[]});
    const history=(saleId:string,refund:boolean,extra:Record<string,unknown>={})=>({requestId:req(),saleId,amount:"5",method:"CASH",actuallyPaid:refund,cashAccountId:other,actualDate:cairoDate(),checkpointType:"COUNT",checkpointCountId:labCountId,handler:"موظف وهمي",reason:"تحقق من سجل وهمي",verifiedActual:true,beforeCheckpoint:true,includedInCheckpoint:true,notPreviouslyRecorded:true,...extra});
    const original=await balance(other), movements=await count(), collections=await client.commerceCollection.count(), refunds=await client.commerceRefund.count();
    const incoming=history(due,false),outgoing=history(credit,true);
    await assert.rejects(()=>recordHistoricalCollection(client,3n,incoming));
    await assert.rejects(()=>recordHistoricalCollection(client,1n,{...incoming,notPreviouslyRecorded:false}),(e:unknown)=>e instanceof FinanceProblem && e.code==="invalid_input");
    await assert.rejects(()=>recordHistoricalCollection(client,1n,{...incoming,cashAccountId:vault}),(e:unknown)=>e instanceof FinanceProblem && e.code==="account_branch");
    await assert.rejects(()=>recordHistoricalCollection(client,1n,{...incoming,checkpointCountId:"999"}),(e:unknown)=>e instanceof FinanceProblem && e.code==="checkpoint_unavailable");
    await assert.rejects(()=>recordHistoricalCollection(client,1n,{...incoming,method:"CARD"}),(e:unknown)=>e instanceof FinanceProblem && e.code==="invalid_input");
    await assert.rejects(()=>recordHistoricalRefund(client,2n,{...outgoing,actuallyPaid:false}),InventoryProblem);
    // A stale normal form cannot treat a payment made before the count as new.
    await assert.rejects(()=>recordCommerceCollection(client,1n,movement(due,"1","CASH",other)),(e:unknown)=>e instanceof FinanceProblem && e.code==="checkpoint_changed");
    assert.equal(await client.commerceCollection.count(),collections);assert.equal(await client.commerceRefund.count(),refunds);assert.equal(await count(),movements);
    const saved=await recordHistoricalCollection(client,1n,incoming);assert.equal((await recordHistoricalCollection(client,1n,incoming)).replayed,true);
    await assert.rejects(()=>recordHistoricalCollection(client,1n,{...incoming,handler:"اسم آخر"}),InventoryProblem);
    const savedRefund=await recordHistoricalRefund(client,2n,outgoing);assert.equal((await recordHistoricalRefund(client,2n,outgoing)).replayed,true);
    assert.equal(await client.commerceCollection.count(),collections+1);assert.equal(await client.commerceRefund.count(),refunds+1);
    assert.equal(await balance(other),original);assert.equal(await count(),movements);
    const rows=await client.$queryRaw<Array<{kind:string;id:string;actual:string;countId:string;handler:string}>>`SELECT event_type AS kind,event_id::text AS id,actual_date::text AS actual,checkpoint_count_id::text AS "countId",handler FROM finance_lab.historical_commerce WHERE sale_id IN (${BigInt(due)},${BigInt(credit)}) ORDER BY id`;
    assert.equal(rows.length,2);assert(rows.some(r=>r.kind==="COLLECTION"&&r.id===saved.id&&r.countId===labCountId));assert(rows.some(r=>r.kind==="REFUND"&&r.id===savedRefund.id&&r.countId===labCountId));
    const afterIncoming=await client.commerceCollection.count();
    await exec(`CREATE FUNCTION finance_lab.reject_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'late historical audit failure'; END $$;
      CREATE TRIGGER reject_history BEFORE INSERT ON finance_lab.historical_commerce FOR EACH ROW EXECUTE FUNCTION finance_lab.reject_history()`);
    try {await assert.rejects(()=>recordHistoricalCollection(client,1n,history(due,false)));}
    finally {await exec("DROP TRIGGER reject_history ON finance_lab.historical_commerce; DROP FUNCTION finance_lab.reject_history()");}
    assert.equal(await client.commerceCollection.count(),afterIncoming);assert.equal(await balance(other),original);assert.equal(await count(),movements);
    // Management may record history of existing invoices when a branch is stopped.
    await exec("UPDATE public.branches SET is_active=false WHERE id=2; UPDATE finance_lab.branches SET is_active=false WHERE id=2");
    try {
      const old=history(due,false,{checkpointType:"OPENING",checkpointCountId:null,actualDate:"2019-12-31"});
      await recordHistoricalCollection(client,2n,old);assert.equal((await recordHistoricalCollection(client,2n,old)).replayed,true);
      assert.equal(await balance(other),original);assert.equal(await count(),movements);
      await assert.rejects(()=>createCommerceSale(client,1n,branchTwo("10")),InventoryProblem);
    } finally {await exec("UPDATE public.branches SET is_active=true WHERE id=2; UPDATE finance_lab.branches SET is_active=true WHERE id=2");}
    // A normal operation AFTER the confirmed checkpoint saves which checkpoint
    // was reviewed. Use an equal cash refund to restore this test account.
    const now=await recordCommerceCollection(client,1n,{...movement(due,"1","CASH",other),cashCheckpointRef:labCountId});
    const after=await balance(other);
    const out=await recordCommerceRefund(client,2n,{...movement(credit,"1","CASH",other,true,after),cashCheckpointRef:labCountId});
    assert.equal(await balance(other),original);
    const checkpoints=await client.$queryRaw<Array<{ref:string;countId:string;opening:boolean}>>`SELECT external_ref AS ref,after_cash_count_id::text AS "countId",after_opening AS opening FROM finance_lab.movements WHERE external_ref IN (${`collection:${now.id}`},${`refund:${out.id}`})`;
    assert.equal(checkpoints.length,2);assert(checkpoints.every(c=>c.countId===labCountId&&!c.opening));
  });
  await t.test("opening correction through Prisma retains the anchor and refuses branch-state mismatch", async () => {
    const current=await balance(vault),input={requestId:req(),accountId:vault,expectedOpening:"100",correctedOpening:"90",expectedBalance:current,verifiedOpening:true,noPriorSettlement:true,reason:"مراجعة افتتاح وهمية"};
    await assert.rejects(()=>correctOpeningBalance(db,"3",input),(e:unknown)=>e instanceof FinanceProblem&&e.code==="forbidden");
    await exec("UPDATE public.branches SET is_active=false WHERE id=1");
    try {await assert.rejects(()=>correctOpeningBalance(db,"1",input),(e:unknown)=>e instanceof FinanceProblem&&e.code==="branch_state_mismatch");}
    finally {await exec("UPDATE public.branches SET is_active=true WHERE id=1");}
    const saved=await correctOpeningBalance(db,"2",input);assert.equal((await correctOpeningBalance(db,"2",input)).replayed,true);
    assert.equal((await listOpeningCorrections(db,"1")).find(c=>c.id===saved.id)!.resolution,"BOOK");
    assert.equal((await listAccounts(db,"1")).find(a=>a.id===vault)!.recordedOpening,"100.00");
    assert.equal((await listAccounts(db,"1")).find(a=>a.id===vault)!.currentOpening,"90.00");
  });
  await t.test("pending cases survive reads and resolve only with a verified linked action or no-change closure",async()=>{
    const before=await count(),old=await balance(other);
    const report={requestId:req(),kind:"OPENING",branchId:"2",accountId:other,proposedAmount:"49",reason:"اشتباه وهمي في رصيد البداية"};
    await assert.rejects(()=>createReconciliationCase(db,"3",report),(e:unknown)=>e instanceof FinanceProblem&&e.code==="forbidden");
    const case1=await createReconciliationCase(db,"1",report);assert.equal((await createReconciliationCase(db,"1",report)).replayed,true);
    await assert.rejects(()=>createReconciliationCase(db,"2",{...report,requestId:req()}),(e:unknown)=>e instanceof FinanceProblem&&e.code==="case_exists");
    const note={requestId:req(),caseId:case1.id,note:"بانتظار مراجعة المستند الوهمي"};await addReconciliationNote(db,"2",note);assert.equal((await addReconciliationNote(db,"2",note)).replayed,true);
    assert.equal((await listReconciliationNotes(db,"1")).find(n=>n.caseId===case1.id)?.note,note.note);assert.equal(await count(),before);assert.equal(await balance(other),old);
    const fix={requestId:req(),accountId:other,expectedOpening:"50",correctedOpening:"49",expectedBalance:old,verifiedOpening:true,noPriorSettlement:false,countCovered:true,coveredCountId:labCountId,reason:"الجرد الوهمي عالج الفرق",pendingCaseId:case1.id,expectedCaseRevision:"2",caseReviewed:true};
    await assert.rejects(()=>correctOpeningBalance(db,"1",{...fix,pendingCaseId:null}),(e:unknown)=>e instanceof FinanceProblem&&e.code==="case_review_required");
    await assert.rejects(()=>correctOpeningBalance(db,"1",{...fix,expectedCaseRevision:"1"}),(e:unknown)=>e instanceof FinanceProblem&&e.code==="case_changed");
    assert.equal(await balance(other),old);assert.equal(await count(),before);
    const done=await correctOpeningBalance(db,"2",fix);assert.equal((await correctOpeningBalance(db,"2",fix)).replayed,true);
    const row=(await listReconciliationCases(db,"1")).find(c=>c.id===case1.id)!;assert.equal(row.status,"CONFIRMED");assert.equal(row.openingCorrectionId,done.id);
    assert.equal(await count(),before);assert.equal(await balance(other),old);
    const c2=await createReconciliationCase(db,"1",{...report,requestId:req(),proposedAmount:""});
    await assert.rejects(()=>closeReconciliationCase(db,"1",{requestId:req(),caseId:c2.id,expectedRevision:"1",reason:"لم ينته الفحص",verifiedNoChange:false}),(e:unknown)=>e instanceof FinanceProblem&&e.code==="invalid_input");
    const closing={requestId:req(),caseId:c2.id,expectedRevision:"1",reason:"المستند الوهمي صحيح",verifiedNoChange:true};await closeReconciliationCase(db,"2",closing);assert.equal((await closeReconciliationCase(db,"2",closing)).replayed,true);
    assert.equal((await listReconciliationCases(db,"1")).find(c=>c.id===c2.id)?.status,"CLOSED");assert.equal(await count(),before);assert.equal(await balance(other),old);
  });
  await t.test("stopped-branch historical claim is private, scope checked and linked atomically to the invoice",async()=>{
    const due=(await createCommerceSale(client,3n,saleInput("CARD"))).id;
    const input={requestId:req(),kind:"COLLECTION",branchId:"1",saleId:due,reason:"تحصيل وهمي يحتاج بحثًا",accountId:"",proposedAmount:"10",possibleDate:"2019-12-31",possibleHandler:""};
    const invoice=await client.commerceSale.findUniqueOrThrow({where:{id:BigInt(due)}}),cash=await balance(vault),movements=await count(),collections=await client.commerceCollection.count();
    await assert.rejects(()=>createReconciliationCase(db,"1",{...input,branchId:"2"}),(e:unknown)=>e instanceof FinanceProblem&&e.code==="sale_branch");
    await assert.rejects(()=>createReconciliationCase(db,"1",{...input,accountId:other}),(e:unknown)=>e instanceof FinanceProblem&&e.code==="account_branch");
    await exec("UPDATE public.branches SET is_active=false WHERE id=1; UPDATE finance_lab.branches SET is_active=false WHERE id=1");
    try {
      await assert.rejects(()=>createReconciliationCase(db,"3",input),(e:unknown)=>e instanceof FinanceProblem&&e.code==="forbidden");
      const item=await createReconciliationCase(db,"2",input);assert.equal((await createReconciliationCase(db,"2",input)).replayed,true);
      await assert.rejects(()=>listReconciliationCases(db,"3",due),(e:unknown)=>e instanceof FinanceProblem&&e.code==="forbidden");
      const sameInvoice=await client.commerceSale.findUniqueOrThrow({where:{id:BigInt(due)}});assert.equal(sameInvoice.revision,invoice.revision);
      assert.equal(await count(),movements);assert.equal(await balance(vault),cash);assert.equal(await client.commerceCollection.count(),collections);
      const historic={requestId:req(),saleId:due,amount:"5",method:"CASH",actuallyPaid:false,cashAccountId:vault,actualDate:"2019-12-31",checkpointType:"OPENING",checkpointCountId:null,handler:"موظف وهمي",reason:"بعد مراجعة وهمية",verifiedActual:true,beforeCheckpoint:true,includedInCheckpoint:true,notPreviouslyRecorded:true,caseSnapshot:`${item.id}:1`};
      await assert.rejects(()=>recordHistoricalCollection(client,2n,historic),(e:unknown)=>e instanceof FinanceProblem&&e.code==="case_review_required");
      await assert.rejects(()=>recordHistoricalCollection(client,2n,{...historic,pendingCaseId:item.id,caseReviewed:false}),(e:unknown)=>e instanceof FinanceProblem&&e.code==="case_review_required");
      await addReconciliationNote(db,"1",{requestId:req(),caseId:item.id,note:"ملاحظة لاحقة تتطلب مراجعة مجددة"});
      await assert.rejects(()=>recordHistoricalCollection(client,2n,{...historic,pendingCaseId:item.id,caseReviewed:true}),(e:unknown)=>e instanceof FinanceProblem&&e.code==="cases_changed");
      assert.equal(await client.commerceCollection.count(),collections);
      const refreshed={...historic,caseSnapshot:`${item.id}:2`};
      await exec(`CREATE FUNCTION finance_lab.reject_case_confirm() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity_type='RECON_CASE' AND NEW.action='CONFIRM' THEN RAISE EXCEPTION 'case confirm failure'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER reject_case_confirm BEFORE INSERT ON finance_lab.audit_events FOR EACH ROW EXECUTE FUNCTION finance_lab.reject_case_confirm()`);
      try {await assert.rejects(()=>recordHistoricalCollection(client,2n,{...refreshed,pendingCaseId:item.id,caseReviewed:true}));}
      finally {await exec("DROP TRIGGER reject_case_confirm ON finance_lab.audit_events; DROP FUNCTION finance_lab.reject_case_confirm()");}
      assert.equal(await client.commerceCollection.count(),collections);assert.equal((await listReconciliationCases(db,"1",due))[0].status,"OPEN");
      const confirmed={...refreshed,pendingCaseId:item.id,caseReviewed:true};const result=await recordHistoricalCollection(client,2n,confirmed);assert.equal((await recordHistoricalCollection(client,2n,confirmed)).replayed,true);
      const row=(await listReconciliationCases(db,"1",due))[0];assert.equal(row.status,"CONFIRMED");assert(row.historicalId);assert.equal(row.proposedAmount,"10.00");
      assert.equal(await client.commerceCollection.count(),collections+1);assert.equal(await count(),movements);assert.equal(await balance(vault),cash);
    }finally{await exec("UPDATE public.branches SET is_active=true WHERE id=1; UPDATE finance_lab.branches SET is_active=true WHERE id=1");}
  });
  await t.test("pending refunds and genuinely distinct historical payments do not settle a different claim",async()=>{
    const due=(await createCommerceSale(client,3n,saleInput("CARD"))).id;
    const credit=(await createCommerceSale(client,3n,saleInput("CARD","","40"))).id;
    await returnCommerceSale(client,1n,{requestId:req(),saleId:credit,cancel:true,accepted:true,lines:[]});
    const make=(saleId:string,kind:"COLLECTION"|"REFUND")=>({requestId:req(),kind,branchId:"1",saleId,reason:"حالة وهمية منفصلة"});
    const a=await createReconciliationCase(db,"1",make(due,"COLLECTION")),b=await createReconciliationCase(db,"1",make(credit,"REFUND"));
    const event=(saleId:string)=>({requestId:req(),saleId,amount:"2",method:"CASH",actuallyPaid:true,cashAccountId:vault,actualDate:"2019-12-31",checkpointType:"OPENING",checkpointCountId:null,handler:"موظف وهمي",reason:"تدقيق وهمي",verifiedActual:true,beforeCheckpoint:true,includedInCheckpoint:true,notPreviouslyRecorded:true});
    const countBefore=await count(),cashBefore=await balance(vault);
    await recordHistoricalCollection(client,2n,{...event(due),actuallyPaid:false,distinctFromPending:true,caseSnapshot:`${a.id}:1`});
    assert.equal((await listReconciliationCases(db,"1",due)).find(c=>c.id===a.id)?.status,"OPEN");
    await assert.rejects(()=>recordHistoricalRefund(client,2n,{...event(credit),pendingCaseId:a.id,caseReviewed:true,caseSnapshot:`${b.id}:1`}),(e:unknown)=>e instanceof FinanceProblem&&e.code==="case_review_required");
    const input={...event(credit),pendingCaseId:b.id,caseReviewed:true,caseSnapshot:`${b.id}:1`};const saved=await recordHistoricalRefund(client,2n,input);assert.equal((await recordHistoricalRefund(client,2n,input)).replayed,true);
    const row=(await listReconciliationCases(db,"1",credit)).find(c=>c.id===b.id)!;assert.equal(row.status,"CONFIRMED");assert(row.historicalId);
    assert.equal(await count(),countBefore);assert.equal(await balance(vault),cashBefore);
    await closeReconciliationCase(db,"1",{requestId:req(),caseId:a.id,expectedRevision:"1",reason:"تمت مراجعة حالة أخرى",verifiedNoChange:true});
  });
  await t.test("more than nine reviewed invoice cases use numeric order and remain pending for a distinct event",async()=>{
    const due=(await createCommerceSale(client,3n,saleInput("CARD"))).id,ids:string[]=[];
    for(let i=0;i<12;i++) ids.push((await createReconciliationCase(db,"1",{requestId:req(),kind:"COLLECTION",branchId:"1",saleId:due,reason:`بلاغ وهمي رقم ${i}`})).id);
    const before=await count(),cash=await balance(vault);
    const input={requestId:req(),saleId:due,amount:"1",method:"CASH",actuallyPaid:false,cashAccountId:vault,actualDate:"2019-12-31",checkpointType:"OPENING",checkpointCountId:null,handler:"موظف وهمي",reason:"تدقيق واقعة مختلفة",verifiedActual:true,beforeCheckpoint:true,includedInCheckpoint:true,notPreviouslyRecorded:true,distinctFromPending:true,caseSnapshot:ids.map(id=>`${id}:1`).reverse().join(",")};
    await recordHistoricalCollection(client,2n,input);assert.equal((await listReconciliationCases(db,"1",due)).filter(c=>c.status==="OPEN").length,12);
    assert.equal(await count(),before);assert.equal(await balance(vault),cash);
    for(const id of ids)await closeReconciliationCase(db,"1",{requestId:req(),caseId:id,expectedRevision:"1",reason:"أغلقت بعد التحقق",verifiedNoChange:true});
  });
  if (!native) return;
  await t.test("simultaneous identical case reports are idempotent and distinct opening cases cannot both remain open",async()=>{
    const report={requestId:req(),kind:"OPENING",branchId:"2",accountId:other,reason:"بلاغ متزامن وهمي"},g=gate();
    try {const racing=financeDb(raceDb(client,g,"account-lock"));const result=await Promise.all([createReconciliationCase(racing,"1",report),createReconciliationCase(racing,"1",report)]);
      g.reached();assert.equal(result[0].id,result[1].id);assert.equal(result.filter(x=>x.replayed).length,1);
      const rows=(await listReconciliationCases(db,"1")).filter(c=>c.kind==="OPENING"&&c.accountId===other&&c.status==="OPEN");assert.equal(rows.length,1);
      await closeReconciliationCase(db,"2",{requestId:req(),caseId:rows[0].id,expectedRevision:"1",reason:"أغلق بعد الفحص",verifiedNoChange:true});
    }finally{g.cancel();}
    const g2=gate();try {const racing=financeDb(raceDb(client,g2,"account-lock")), result=await Promise.allSettled([
        createReconciliationCase(racing,"1",{...report,requestId:req()}),createReconciliationCase(racing,"2",{...report,requestId:req()}),
      ]);g2.reached();assert.equal(result.filter(x=>x.status==="fulfilled").length,1);
      const failure=result.find((x):x is PromiseRejectedResult=>x.status==="rejected")!;assert(failure.reason instanceof FinanceProblem && ["case_exists","duplicate"].includes(failure.reason.code));
      assert.equal((await listReconciliationCases(db,"1")).filter(c=>c.kind==="OPENING"&&c.accountId===other&&c.status==="OPEN").length,1);
      const open=(await listReconciliationCases(db,"1")).find(c=>c.kind==="OPENING"&&c.accountId===other&&c.status==="OPEN")!;
      await closeReconciliationCase(db,"1",{requestId:req(),caseId:open.id,expectedRevision:"1",reason:"إغلاق وهمي",verifiedNoChange:true});
    }finally{g2.cancel();}
  });
  await t.test("case creation racing an unlinked opening correction preserves the earlier reviewed order",async()=>{
    const before=await count(),old=await balance(other),g=gate();
    try {const racing=financeDb(raceDb(client,g,"account-lock")),result=await Promise.allSettled([
      createReconciliationCase(racing,"1",{requestId:req(),kind:"OPENING",branchId:"2",accountId:other,reason:"إبلاغ متزامن مع التصحيح"}),
      correctOpeningBalance(racing,"2",{requestId:req(),accountId:other,expectedOpening:"49",correctedOpening:"48",expectedBalance:old,verifiedOpening:true,noPriorSettlement:false,countCovered:true,coveredCountId:labCountId,reason:"تصحيح متزامن"}),
    ]);g.reached();assert.equal(result[0].status,"fulfilled");const row=(await listReconciliationCases(db,"1")).find(c=>c.kind==="OPENING"&&c.accountId===other&&c.status==="OPEN")!;assert(row);
      if(result[1].status==="fulfilled") assert.equal(row.openingSnapshot,"48.00");
      else {assert(result[1].reason instanceof FinanceProblem && result[1].reason.code==="case_review_required");assert.equal(row.openingSnapshot,"49.00");}
      assert.equal(await count(),before);assert.equal(await balance(other),old);
      await closeReconciliationCase(db,"1",{requestId:req(),caseId:row.id,expectedRevision:"1",reason:"إغلاق وهمي",verifiedNoChange:true});
    }finally{g.cancel();}
  });
  await t.test("claim creation and unlinked historical registration serialize on the same invoice",async()=>{
    const due=(await createCommerceSale(client,3n,saleInput("CARD"))).id,before=await client.commerceCollection.count(),cash=await count(),g=gate();
    try {const racing=raceDb(client,g,"sale-any-lock"),result=await Promise.allSettled([
      createReconciliationCase(financeDb(racing),"1",{requestId:req(),kind:"COLLECTION",branchId:"1",saleId:due,reason:"بلاغ متزامن مع تسجيل قديم"}),
      recordHistoricalCollection(racing,2n,{requestId:req(),saleId:due,amount:"2",method:"CASH",actuallyPaid:false,cashAccountId:vault,actualDate:"2019-12-31",checkpointType:"OPENING",checkpointCountId:null,handler:"موظف وهمي",reason:"تدقيق وهمي",verifiedActual:true,beforeCheckpoint:true,includedInCheckpoint:true,notPreviouslyRecorded:true}),
    ]);g.reached();assert.equal(result[0].status,"fulfilled");const row=(await listReconciliationCases(db,"1",due))[0];assert.equal(row.status,"OPEN");
      if(result[1].status==="fulfilled") assert.equal(await client.commerceCollection.count(),before+1);
      else {assert(result[1].reason instanceof FinanceProblem && result[1].reason.code==="case_review_required");assert.equal(await client.commerceCollection.count(),before);}
      assert.equal(await count(),cash);await closeReconciliationCase(db,"1",{requestId:req(),caseId:row.id,expectedRevision:"1",reason:"إغلاق وهمي",verifiedNoChange:true});
    }finally{g.cancel();}
  });
  await t.test("a new note racing closure cannot be skipped by an old case review",async()=>{
    const item=await createReconciliationCase(db,"1",{requestId:req(),kind:"OPENING",branchId:"2",accountId:other,reason:"مراجعة ملاحظة متزامنة"}),g=gate(),old=await balance(other),cash=await count();
    try {const racing=financeDb(raceDb(client,g,"case-lock")),result=await Promise.allSettled([
      addReconciliationNote(racing,"1",{requestId:req(),caseId:item.id,note:"مستند جديد"}),
      closeReconciliationCase(racing,"2",{requestId:req(),caseId:item.id,expectedRevision:"1",reason:"إغلاق بعد المراجعة القديمة",verifiedNoChange:true}),
    ]);g.reached();assert.equal(result.filter(x=>x.status==="fulfilled").length,1);
      const row=(await listReconciliationCases(db,"1")).find(c=>c.id===item.id)!;
      const failure=result.find((r):r is PromiseRejectedResult=>r.status==="rejected")!;
      assert(failure.reason instanceof FinanceProblem && ["case_changed","case_resolved"].includes(failure.reason.code));
      if(row.status==="OPEN") {assert.equal(row.revision,2);assert.equal(failure.reason.code,"case_changed");await closeReconciliationCase(db,"1",{requestId:req(),caseId:row.id,expectedRevision:"2",reason:"راجعنا الملاحظة الجديدة",verifiedNoChange:true});}
      else assert.equal(row.status,"CLOSED");
      assert.equal(await count(),cash);assert.equal(await balance(other),old);
    }finally{g.cancel();}
  });
  await t.test("a new invoice claim invalidates a previously reviewed distinct-event snapshot",async()=>{
    const due=(await createCommerceSale(client,3n,saleInput("CARD"))).id;
    const first=await createReconciliationCase(db,"1",{requestId:req(),kind:"COLLECTION",branchId:"1",saleId:due,reason:"الحالة الأولى"});
    const before=await client.commerceCollection.count(),cash=await count(),g=gate();
    try {const racing=raceDb(client,g,"sale-any-lock"),result=await Promise.allSettled([
      createReconciliationCase(financeDb(racing),"1",{requestId:req(),kind:"COLLECTION",branchId:"1",saleId:due,reason:"بلاغ جديد متزامن"}),
      recordHistoricalCollection(racing,2n,{requestId:req(),saleId:due,amount:"2",method:"CASH",actuallyPaid:false,cashAccountId:vault,actualDate:"2019-12-31",checkpointType:"OPENING",checkpointCountId:null,handler:"موظف وهمي",reason:"تدقيق وهمي",verifiedActual:true,beforeCheckpoint:true,includedInCheckpoint:true,notPreviouslyRecorded:true,distinctFromPending:true,caseSnapshot:`${first.id}:1`}),
    ]);g.reached();assert.equal(result[0].status,"fulfilled");
      if(result[1].status==="fulfilled") assert.equal(await client.commerceCollection.count(),before+1);
      else {assert(result[1].reason instanceof FinanceProblem && result[1].reason.code==="cases_changed");assert.equal(await client.commerceCollection.count(),before);}
      assert.equal(await count(),cash);
      for(const row of await listReconciliationCases(db,"1",due)) if(row.status==="OPEN") await closeReconciliationCase(db,"1",{requestId:req(),caseId:row.id,expectedRevision:String(row.revision),reason:"إغلاق بعد مراجعة وهمية",verifiedNoChange:true});
    }finally{g.cancel();}
  });
  await t.test("opening-case confirmation racing closure cannot resolve twice",async()=>{
    const item=await createReconciliationCase(db,"1",{requestId:req(),kind:"OPENING",branchId:"1",accountId:vault,reason:"سباق معالجة"});
    const old=await balance(vault),movements=await count(),g=gate();
    try {const racing=financeDb(raceDb(client,g,"case-lock")),result=await Promise.allSettled([
      correctOpeningBalance(racing,"1",{requestId:req(),accountId:vault,expectedOpening:"90",correctedOpening:"89",expectedBalance:old,verifiedOpening:true,noPriorSettlement:true,reason:"تصحيح وهمي",pendingCaseId:item.id,expectedCaseRevision:"1",caseReviewed:true}),
      closeReconciliationCase(racing,"2",{requestId:req(),caseId:item.id,expectedRevision:"1",reason:"إغلاق بعد الفحص",verifiedNoChange:true}),
    ]);g.reached();assert.equal(result.filter(x=>x.status==="fulfilled").length,1);
      const row=(await listReconciliationCases(db,"1")).find(c=>c.id===item.id)!;assert(["CONFIRMED","CLOSED"].includes(row.status));
      assert.equal(await count(),movements+(row.status==="CONFIRMED"?1:0));
      assert.equal(await balance(vault),(Number(old)-(row.status==="CONFIRMED"?1:0)).toFixed(2));
    }finally{g.cancel();}
  });
  await t.test("historical case cannot be both closed and confirmed, and identical retries commit one invoice row",async()=>{
    const due=(await createCommerceSale(client,3n,saleInput("CARD"))).id;
    const report=()=>({requestId:req(),kind:"COLLECTION",branchId:"1",saleId:due,reason:"بلاغ تاريخي متزامن"});
    const event=(caseId:string)=>({requestId:req(),saleId:due,amount:"2",method:"CASH",actuallyPaid:false,cashAccountId:vault,actualDate:"2019-12-31",checkpointType:"OPENING",checkpointCountId:null,handler:"موظف وهمي",reason:"تحقق وهمي",verifiedActual:true,beforeCheckpoint:true,includedInCheckpoint:true,notPreviouslyRecorded:true,pendingCaseId:caseId,caseReviewed:true,caseSnapshot:`${caseId}:1`});
    const one=await createReconciliationCase(db,"1",report()),before=await client.commerceCollection.count(),cash=await count(),g=gate();
    try {const racing=raceDb(client,g,"case-lock"),result=await Promise.allSettled([
      recordHistoricalCollection(racing,1n,event(one.id)),closeReconciliationCase(financeDb(racing),"2",{requestId:req(),caseId:one.id,expectedRevision:"1",reason:"إغلاق وهمي",verifiedNoChange:true}),
    ]);g.reached();assert.equal(result.filter(x=>x.status==="fulfilled").length,1);
      const row=(await listReconciliationCases(db,"1",due)).find(c=>c.id===one.id)!;assert(["CONFIRMED","CLOSED"].includes(row.status));
      assert.equal(await client.commerceCollection.count(),before+(row.status==="CONFIRMED"?1:0));assert.equal(await count(),cash);
    }finally{g.cancel();}
    const two=await createReconciliationCase(db,"1",report()),same=event(two.id),beforeRetry=await client.commerceCollection.count(),g2=gate();
    try {const racing=raceDb(client,g2,"sale-lock"),result=await Promise.all([recordHistoricalCollection(racing,1n,same),recordHistoricalCollection(racing,1n,same)]);
      g2.reached();assert.equal(result[0].id,result[1].id);assert.equal(result.filter(r=>r.replayed).length,1);
      assert.equal(await client.commerceCollection.count(),beforeRetry+1);assert.equal((await listReconciliationCases(db,"1",due)).find(c=>c.id===two.id)?.status,"CONFIRMED");assert.equal(await count(),cash);
    }finally{g2.cancel();}
  });
  await t.test("PostgreSQL count and opening correction cannot double adjust",async()=>{
    const c=await requestCashCount(db,"1",{requestId:req(),accountId:colleague,expectedBalance:"25",countedAmount:"20",reason:"جرد متزامن",actuallyCounted:true});
    const g=gate();try {
      const racing=financeDb(raceDb(client,g,"account-lock"));
      const result=await Promise.allSettled([
        confirmCashCount(racing,"1",{requestId:req(),countId:c.id,reason:"تأكيد متزامن",stillCurrent:true}),
        correctOpeningBalance(racing,"2",{requestId:req(),accountId:colleague,expectedOpening:"25",correctedOpening:"23",expectedBalance:"25",verifiedOpening:true,noPriorSettlement:true,reason:"تصحيح افتتاح متزامن"}),
      ]);
      g.reached();assert.equal(result.filter(x=>x.status==="fulfilled").length,1);
      const failure=result.find((x):x is PromiseRejectedResult=>x.status==="rejected")!;
      assert(failure.reason instanceof FinanceProblem && ["count_stale","count_overlap","balance_changed"].includes(failure.reason.code));
      assert(["20.00","23.00"].includes(await balance(colleague)));
    } finally {g.cancel();}
  });
  await t.test("PostgreSQL count versus ordinary collection rechecks the checkpoint atomically",async()=>{
    const due=(await createCommerceSale(client,3n,saleInput("CARD"))).id,previous=await balance(custody);
    const c=await requestCashCount(db,"1",{requestId:req(),accountId:custody,expectedBalance:previous,countedAmount:"0",reason:"سباق تحصيل وجرد",actuallyCounted:true});
    const input=movement(due,"1","CASH",custody),g=gate();try{
      const racing=raceDb(client,g,"account-lock"),result=await Promise.allSettled([
        confirmCashCount(financeDb(racing),"1",{requestId:req(),countId:c.id,reason:"مراجعة",stillCurrent:true}),
        recordCommerceCollection(racing,3n,input),
      ]);
      g.reached();assert.equal(result.filter(x=>x.status==="fulfilled").length,1);
      const failure=result.find((x):x is PromiseRejectedResult=>x.status==="rejected")!;
      assert(failure.reason instanceof FinanceProblem && ["count_stale","checkpoint_changed"].includes(failure.reason.code));
    }finally{g.cancel();}
  });
  await t.test("concurrent historical collection retries create one invoice record and no cash movement",async()=>{
    const due=(await createCommerceSale(client,3n,saleInput("CARD"))).id, before=await count(), collections=await client.commerceCollection.count();
    const input={requestId:req(),saleId:due,amount:"2",method:"CASH",actuallyPaid:false,cashAccountId:vault,actualDate:"2019-12-31",checkpointType:"OPENING",checkpointCountId:null,handler:"موظف وهمي",reason:"تحقق وهمي",verifiedActual:true,beforeCheckpoint:true,includedInCheckpoint:true,notPreviouslyRecorded:true};
    const g=gate();try{
      const racing=raceDb(client,g,"sale-lock"),result=await Promise.all([recordHistoricalCollection(racing,1n,input),recordHistoricalCollection(racing,1n,input)]);
      g.reached();assert.equal(result[0].id,result[1].id);assert.equal(result.filter(x=>x.replayed).length,1);
      assert.equal(await count(),before);assert.equal(await client.commerceCollection.count(),collections+1);
    }finally{g.cancel();}
  });
  await t.test("Prisma/PostgreSQL count versus correction commits only the safe ordered result", async () => {
    const expense=await createExpense(db,"1",{requestId:req(),branchId:"2",categoryId:labCategory,amount:"10",expenseDate:"2020-01-02",description:"سباق وهمي",taxAmount:""});
    await approveExpense(db,"1",{requestId:req(),expenseId:expense.id,expectedRevision:"1"});
    await payExpense(db,"1",{requestId:req(),expenseId:expense.id,expectedRevision:"2",method:"CASH",accountId:other,paymentDate:cairoDate(),actuallyPaid:true,expectedBalance:"37",afterCountId:labCountId,afterCount:true});
    const review=await requestPaidExpenseReview(db,"1",{requestId:req(),expenseId:expense.id,expectedRevision:"3",reason:"تدقيق متزامن",proposedAmount:"8"});
    const c=await requestCashCount(db,"1",{requestId:req(),accountId:other,expectedBalance:"27",countedAmount:"25",reason:"جرد متزامن",actuallyCounted:true});
    const g=gate();try {
      const racing=financeDb(raceDb(client,g,"account-lock"));
      const result=await Promise.allSettled([
        confirmCashCount(racing,"1",{requestId:req(),countId:c.id,reason:"تأكيد متزامن",stillCurrent:true}),
        confirmPaidExpenseCorrection(racing,"2",{requestId:req(),reviewId:review.id,confirmedAmount:"8",expectedBalance:"27",reason:"تصحيح متزامن",verifiedPayment:true,noPriorSettlement:true}),
      ]);
      g.reached();assert.equal(result.filter(x=>x.status==="fulfilled").length,1);
      const failure=result.find((x):x is PromiseRejectedResult=>x.status==="rejected")!;
      assert(failure.reason instanceof FinanceProblem && ["count_stale","count_overlap"].includes(failure.reason.code));
      assert(["25.00","29.00"].includes(await balance(other)));
    }finally{g.cancel();}
  });
  await t.test("simultaneous inactive-branch collection retries commit once", async () => {
    const due=(await createCommerceSale(client,3n,saleInput("CARD"))).id, input=movement(due,"2","CASH",vault), before=await count(), g=gate();
    await exec("UPDATE branches SET is_active=false WHERE id=1; UPDATE finance_lab.branches SET is_active=false WHERE id=1");
    try {
      const racing=raceDb(client,g,"sale-lock"), result=await Promise.all([recordCommerceCollection(racing,2n,input),recordCommerceCollection(racing,2n,input)]);
      g.reached();assert.equal(result[0].id,result[1].id);assert.equal(result.filter(r=>r.replayed).length,1);assert.equal(await count(),before+1);
    } finally { g.cancel();await exec("UPDATE branches SET is_active=true WHERE id=1; UPDATE finance_lab.branches SET is_active=true WHERE id=1"); }
  });
  await t.test("inactive-branch refunds are idempotent and compete safely for reviewed cash", async () => {
    const first=(await createCommerceSale(client,3n,saleInput("CARD","","40"))).id,second=(await createCommerceSale(client,3n,saleInput("CARD","","40"))).id;
    for(const id of [first,second])await returnCommerceSale(client,1n,{requestId:req(),saleId:id,cancel:true,accepted:true,lines:[]});
    await exec("UPDATE branches SET is_active=false WHERE id=1; UPDATE finance_lab.branches SET is_active=false WHERE id=1");
    let g=gate();
    try {
      const duplicate=movement(first,"2","CASH",vault,true,await balance(vault)),before=await count(),beforeRefunds=await client.commerceRefund.count();
      let racing=raceDb(client,g,"sale-lock");const same=await Promise.all([recordCommerceRefund(racing,2n,duplicate),recordCommerceRefund(racing,2n,duplicate)]);
      g.reached();assert.equal(same[0].id,same[1].id);assert.equal(same.filter(r=>r.replayed).length,1);
      assert.equal(await count(),before+1);assert.equal(await client.commerceRefund.count(),beforeRefunds+1);g.cancel();
      const reviewed=await balance(vault),beforeRace=await count();g=gate();racing=raceDb(client,g,"account-lock");
      const competed=await Promise.allSettled([recordCommerceRefund(racing,1n,movement(first,"5","CASH",vault,true,reviewed)),recordCommerceRefund(racing,2n,movement(second,"5","CASH",vault,true,reviewed))]);
      g.reached();assert.equal(competed.filter(r=>r.status==="fulfilled").length,1);
      const rejected=competed.find((r):r is PromiseRejectedResult=>r.status==="rejected")!;
      assert(rejected.reason instanceof FinanceProblem && rejected.reason.code==="balance_changed");assert.equal(await count(),beforeRace+1);
    } finally { g.cancel();await exec("UPDATE branches SET is_active=true WHERE id=1; UPDATE finance_lab.branches SET is_active=true WHERE id=1"); }
  });
  await t.test("stopping a branch during staff collection forces a retry and denies the stale attempt", async () => {
    const due=(await createCommerceSale(client,3n,saleInput("CARD"))).id, before=await count(), collections=await client.commerceCollection.count();
    let entered!:()=>void, release!:()=>void, arrivals=0;
    const arrived=new Promise<void>(resolve=>{entered=resolve;}), blocked=new Promise<void>(resolve=>{release=resolve;});
    const hold={ wait:async()=>{if(arrivals++)return;entered();await blocked;}, reached:()=>assert.equal(arrivals,1), cancel:()=>release() };
    const racing=raceDb(client,hold,"branch-lock");
    // Attach rejection handling immediately; the gate pauses before the row
    // lock so the separate deactivation can commit while this snapshot is old.
    const attempt=recordCommerceCollection(racing,3n,movement(due,"1","CASH",vault)).then(()=>null,error=>error as unknown);
    let timer:NodeJS.Timeout|undefined;
    try {
      await Promise.race([arrived,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error("branch gate not reached")),8000);})]);
      if(timer)clearTimeout(timer);
      await exec("UPDATE branches SET is_active=false WHERE id=1; UPDATE finance_lab.branches SET is_active=false WHERE id=1");
      hold.cancel();const error=await attempt;hold.reached();assert(error instanceof InventoryProblem);
      assert.equal(await client.commerceCollection.count(),collections);assert.equal(await count(),before);
    } finally { if(timer)clearTimeout(timer);hold.cancel();await exec("UPDATE branches SET is_active=true WHERE id=1; UPDATE finance_lab.branches SET is_active=true WHERE id=1"); }
  });
  await t.test("two truly concurrent identical sales commit once and replay consistently", async () => {
    const before = await count(), sales = await client.commerceSale.count(), stock = await qty(), input = saleInput("CASH",vault), g = gate();
    try {
      const racing = raceDb(client,g,"sale-create"); const result = await Promise.all([createCommerceSale(racing,3n,input),createCommerceSale(racing,3n,input)]);
      g.reached(); assert.equal(result[0].id,result[1].id); assert.equal(result.filter(r=>r.replayed).length,1);
      assert.equal(await client.commerceSale.count(),sales+1); assert.equal(await count(),before+1); assert.equal(await qty(),(Number(stock)-2).toFixed(2));
    } finally { g.cancel(); }
  });
  await t.test("two concurrent identical collections commit one movement", async () => {
    const s = (await createCommerceSale(client,3n,saleInput("CARD"))).id, before = await count(), input = movement(s,"5","CASH",vault), g = gate();
    try {
      const racing = raceDb(client,g,"sale-lock"); const settled = await Promise.allSettled([recordCommerceCollection(racing,3n,input),recordCommerceCollection(racing,3n,input)]);
      const results = settled.map(r=>{if(r.status === "rejected") throw r.reason; return r.value;});
      g.reached(); assert.equal(results[0].id,results[1].id); assert.equal(results.filter(r=>r.replayed).length,1); assert.equal(await count(),before+1);
    } finally { g.cancel(); }
  });
  await t.test("two concurrent identical refunds record one payment and one cash movement", async () => {
    const s = (await createCommerceSale(client,3n,saleInput("CARD","","40"))).id;
    await returnCommerceSale(client,1n,{requestId:req(),saleId:s,cancel:true,accepted:true,lines:[]});
    const before = await count(), refunds = await client.commerceRefund.count(), current = await balance(vault);
    const input = movement(s,"5","CASH",vault,true,current), g = gate();
    try {
      const racing = raceDb(client,g,"sale-lock");
      const result = await Promise.all([recordCommerceRefund(racing,2n,input),recordCommerceRefund(racing,2n,input)]);
      g.reached(); assert.equal(result[0].id,result[1].id); assert.equal(result.filter(r=>r.replayed).length,1);
      assert.equal(await client.commerceRefund.count(),refunds+1); assert.equal(await count(),before+1);
    } finally { g.cancel(); }
  });
  await t.test("concurrent refunds using the same reviewed balance cannot silently overspend", async () => {
    const s1 = (await createCommerceSale(client,3n,saleInput("CARD","","40"))).id, s2 = (await createCommerceSale(client,3n,saleInput("CARD","","40"))).id;
    for (const s of [s1,s2]) await returnCommerceSale(client,1n,{requestId:req(),saleId:s,cancel:true,accepted:true,lines:[]});
    const current = await balance(vault), before = await count(), g = gate();
    try {
      const racing = raceDb(client,g,"account-lock"); const results = await Promise.allSettled([recordCommerceRefund(racing,2n,movement(s1,"10","CASH",vault,true,current)),recordCommerceRefund(racing,1n,movement(s2,"10","CASH",vault,true,current))]);
      g.reached(); assert.equal(results.filter(r=>r.status === "fulfilled").length,1);
      const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected")!;
      assert(failed.reason instanceof FinanceProblem && failed.reason.code === "balance_changed"); assert.equal(await count(),before+1);
    } finally { g.cancel(); }
  });
}

test("launcher removes external database and authentication environment", () => {
  assert.equal(process.env.DATABASE_URL, "postgresql://unused.invalid/finance_lab");
  assert.equal(process.env.DIRECT_URL, "postgresql://unused.invalid/finance_lab");
  assert.notEqual(process.env.AUTH_SECRET, "DO-NOT-INHERIT-TEST-ONLY");
  assert.equal(process.env.FINANCE_LAB_CANARY, undefined);
});

test("disposable PGlite: actual lab commerce and finance share atomic transactions", {timeout:120_000}, async t => {
  assert.equal(process.env.FINANCE_LAB_ONLY,"disposable-in-memory");
  const pg = new PGlite(); let client: PrismaClient | undefined;
  try {
    await initialize(sql => pg.exec(sql)); client = new TestClient({adapter:new PrismaPGlite(pg) as never}) as unknown as PrismaClient;
    await scenario(t,client,sql => pg.exec(sql),false);
  } finally { if (client) await client.$disconnect(); await pg.close(); }
});
const pgBin = process.env.FINANCE_TEST_PG_BIN;
test("disposable PostgreSQL: actual lab commerce serializes concurrent transactions", {timeout:180_000,skip:!pgBin}, async t => {
  if (!pgBin || !path.isAbsolute(pgBin) || !existsSync(path.join(pgBin,"initdb")) || !existsSync(path.join(pgBin,"postgres"))) throw new Error("FINANCE_TEST_PG_BIN must name a local PostgreSQL bin directory");
  if (process.getuid?.() === 0) { t.skip("initdb requires an unprivileged user"); return; }
  const root = mkdtempSync(path.join(os.tmpdir(),"selahtone-finance-app-native-")), data = path.join(root,"data"), socket = path.join(root,"socket"); mkdirSync(socket,{mode:0o700});
  let child: ChildProcess | undefined, pool: Pool | undefined, client: PrismaClient | undefined;
  try {
    execFileSync(path.join(pgBin,"initdb"),["-D",data,"--no-locale","--encoding=UTF8","--auth-local=trust","--auth-host=reject","--username=finance_lab_test"],{env:process.env,stdio:"pipe",timeout:30_000});
    child = spawn(path.join(pgBin,"postgres"),["-D",data,"-k",socket,"-h","","-p","55433","-c","unix_socket_permissions=0700"],{env:process.env,stdio:["ignore","ignore","pipe"]});
    const handle = child;
    await new Promise<void>((resolve,reject)=>{
      let logs = "", done = false; const timer = setTimeout(()=>{ if (!done) { done = true; reject(new Error("temporary PostgreSQL startup timed out")); } },30_000);
      handle.stderr?.on("data",chunk=>{ logs += String(chunk); if (!done && logs.includes("database system is ready to accept connections")) { done=true; clearTimeout(timer); resolve(); } });
      handle.once("error",error=>{ if (!done) { done=true; clearTimeout(timer); reject(error); } });
      handle.once("exit",code=>{ if (!done) { done=true; clearTimeout(timer); reject(new Error(`temporary PostgreSQL exited ${code}: ${logs.slice(-2000)}`)); } });
    });
    pool = new Pool({host:socket,port:55433,user:"finance_lab_test",database:"postgres",max:8,connectionTimeoutMillis:5000});
    const setup = await pool.connect(); try { const check = await setup.query("SELECT current_setting('listen_addresses') AS listen"); assert.equal(check.rows[0].listen,""); await initialize(sql => setup.query(sql)); } finally { setup.release(); }
    client = new TestClient({adapter:new PrismaPg(pool) as never}) as unknown as PrismaClient;
    await scenario(t,client,sql => pool!.query(sql),true);
  } finally {
    if (client) await client.$disconnect().catch(()=>{}); if (pool) await pool.end();
    if (child && child.exitCode === null && child.signalCode === null) { const exited = new Promise<void>(resolve=>child!.once("exit",()=>resolve())); child.kill("SIGTERM"); await exited; }
    rmSync(root,{recursive:true,force:true});
  }
});
