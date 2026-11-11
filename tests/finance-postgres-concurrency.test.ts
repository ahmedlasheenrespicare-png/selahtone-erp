import { preauthorizedApprovalTestOnly } from "../prototypes/finance-collection-policy/preauthorized-approval.test-only";
import { branchApproveCustodyTestOnly, branchCollectionTestOnly, branchOpenCustodyTestOnly, branchSettlementTestOnly, branchVaultCollectionTestOnly } from "../prototypes/finance-collection-policy/branch-barrier.test-only";
import { cancellationEarlyBarrierTestOnly, collectEarlyBarrierTestOnly, confirmationEarlyBarrierTestOnly, settlementEarlyBarrierTestOnly } from "../prototypes/finance-collection-policy/early-replay-barrier.test-only";
import { guardSyntheticReplacementOpen } from "../prototypes/finance-custody-reopen/open-boundary-guard.test-only";
import { observeSyntheticAccountConstraints, observeSyntheticAccountColumns } from "../prototypes/finance-custody-uniqueness/constraint-observation.test-only";
import { observeSyntheticAccountIndexes } from "../prototypes/finance-custody-uniqueness/index-observation.test-only";
import { auditSyntheticOpenCustodies } from "../prototypes/finance-custody-uniqueness/audit.test-only";
import { custodyRequestSnapshot } from "../src/lib/finance/custody-request-snapshot";
import { syntheticCloseAccountSnapshot, syntheticCloseAccountSnapshotV2, syntheticCloseRequestIdentity } from "../prototypes/finance-custody-reopen/close-identity.test-only";
import { readSyntheticClosePendingSnapshot, syntheticClosePendingSnapshot } from "../prototypes/finance-custody-reopen/pending-snapshot.test-only";
import { reviewedCloseTestOnly } from "../prototypes/finance-custody-reopen/reviewed-close.test-only";
import { inspectSyntheticCloseEvidence, inspectSyntheticCloseEvidenceMultiStatementUnsafe } from "../prototypes/finance-custody-reopen/close-evidence-audit.test-only";
/** Disposable local PostgreSQL only. Never reads DATABASE_URL or connects to an existing server. */
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
import { createDirectoryUser, setDirectoryBranchActive, setDirectoryUserStatus, updateDirectoryUser } from "../src/lib/admin-directory-operations";
import { changeStaffDiscountLimit, createCommerceSale, recordCommerceCollection, recordCommerceRefund, returnCommerceSale } from "../src/lib/commerce-operations";
import { approveExpense, cancelCashCount, cancelSettlement, closeAccount, confirmCashCount, confirmSettlement, createExpense, openAccount, payExpense, confirmPaidExpenseCorrection, listOpenExpenseReviewQueue, requestPaidExpenseReview, requestCashCount, requestCountFromHolder, requestCustody, decideCustodyRequest, requestSettlement, settlementOverview, submitHolderCount, transferCash } from "../src/lib/finance/engine";
import { requestAllocatedSettlementTestOnly, confirmAllocatedSettlementTestOnly } from "../prototypes/finance-collection-policy/reviewed-settlement.test-only";
import { auditTestOnlyPeriod } from "../prototypes/finance-cutover-period-audit/audit.test-only";
import { auditTestOnlyReceipts } from "../prototypes/finance-cutover-period-audit/receipt-audit.test-only";
import { auditSyntheticRefunds } from "../prototypes/finance-refund-audit/audit.test-only";
import { testCollectionService, testCountClosePeriodGuard, testHolderPaymentService, testRealSettlementWithPeriod } from "../prototypes/finance-collection-policy/runtime-adapters.test-only";
import { allocateTestCollection, pendingTestCollections } from "../prototypes/finance-collection-policy/allocate.test-only";
import { allocateTestHolderPayment, captureRevisionCheckedTestPeriod, captureTestPeriod, reviewTestPeriod } from "../prototypes/finance-collection-policy/period.test-only";
import { recordVaultCollectionTestOnly, recordCustodyCollectionTestOnly } from "../prototypes/finance-collection-policy/vault-collection-command.test-only";
import { vaultReceiptIdentityTestOnly } from "../prototypes/finance-collection-policy/vault-receipt-identity.test-only";
import { receiveInventoryStock } from "../src/lib/receiving-operations";
import { createInventoryOpening, createInventoryProduct } from "../src/lib/inventory-operations";
import { parseProductInput } from "../src/lib/inventory-validation";
import { parseMoneyMovement, parseSaleInput } from "../src/lib/commerce-validation";
import { createCatalogSale, createSalesCategory, createSalesType } from "../src/lib/catalog-sales";
import { parseCatalogSaleInput } from "../src/lib/catalog-validation";
import { vaultInitialIdentityTestOnly } from "../prototypes/finance-collection-policy/vault-initial-identity.test-only";
import { financePort } from "../src/lib/finance/port";
import { financeDbForActor } from "../src/lib/finance/session-transaction";
import { isRetryableTransactionConflict } from "../src/lib/transaction-retry";
import { SETTLEMENT_STALE_SQL } from "../src/lib/finance/settlement-staleness-sql";
import { RECORDED_FLOW_SQL } from "../src/lib/finance/recorded-flow-sql";
import { TRANSFER_MONTH_SQL } from "../src/lib/finance/transfers-overview-sql";
import { CUSTODY_EXPECTATION_SQL } from "../src/lib/finance/custody-summary-sql";
import { auditSyntheticUnmatchedReviews } from "../prototypes/finance-holder-checkpoint-audit/unmatched-reviews.test-only";
import { auditSyntheticHolderCorrections } from "../prototypes/finance-holder-checkpoint-audit/corrections.test-only";
import { auditSyntheticHolderCheckpoints } from "../prototypes/finance-holder-checkpoint-audit/audit.test-only";
import type { FinanceDatabase, FinanceTransaction } from "../src/lib/finance/types";

const root = process.cwd(), req = createRequire(join(root, "package.json"));
const read = (f: string) => readFileSync(join(root, f), "utf8");
const { PrismaClient: WasmClient } = req("@prisma/client/wasm") as { PrismaClient: new (options: { adapter: unknown }) => PrismaClient };
function gate() { let release!: () => void, reached!: () => void; return { wait: new Promise<void>(r => { release = r; }), entered: new Promise<void>(r => { reached = r; }), release: () => release(), signal: () => reached() }; }

/** Pause exactly once immediately after the finance account row lock. */
function gatedFinance(db: PrismaClient, g: ReturnType<typeof gate>, lockMatch = "FROM finance.accounts WHERE id=$1::bigint FOR UPDATE"): FinanceDatabase {
  let paused = false;
  return { serializable: work => db.$transaction(async tx => {
    const port = financePort(tx);
    const wrapped: FinanceTransaction = { ...port, query: async <T extends Record<string, unknown>>(sql: string, params?: unknown[]) => {
      const result = await port.query<T>(sql, params);
      if (!paused && sql.includes(lockMatch)) { paused = true; g.signal(); await g.wait; }
      return result;
    } };
    return work(wrapped);
  }, { isolationLevel: "Serializable", timeout: 20000 }) };
}
function ordinaryFinance(db: PrismaClient): FinanceDatabase {
  return { serializable: work => db.$transaction(tx => work(financePort(tx)), { isolationLevel: "Serializable", timeout: 20000 }) };
}
/** Pause the actual collection service after its account lock, without altering its transaction code. */
function gatedCommerce(db: PrismaClient, g: ReturnType<typeof gate>): PrismaClient {
  let paused = false;
  return new Proxy(db, { get(target, key, receiver) {
    if (key !== "$transaction") return Reflect.get(target, key, receiver);
    return (work: (tx: unknown) => Promise<unknown>, options: unknown) => target.$transaction(async tx => {
      const wrapped = new Proxy(tx, { get(obj, prop, recv) {
        if (prop !== "$queryRawUnsafe") return Reflect.get(obj, prop, recv);
        return async (sql: string, ...params: unknown[]) => {
          const result = await tx.$queryRawUnsafe(sql, ...params);
          if (!paused && sql.includes("FROM finance.accounts WHERE branch_id=") && sql.includes("FOR UPDATE")) { paused = true; g.signal(); await g.wait; }
          return result;
        };
      } });
      return work(wrapped);
    }, options as never);
  } }) as PrismaClient;
}

/** Pause once after the real commerce service locks an invoice row. */
function gatedSale(db: PrismaClient, g: ReturnType<typeof gate>): PrismaClient {
  let paused = false;
  return new Proxy(db, { get(target, key, receiver) {
    if (key !== "$transaction") return Reflect.get(target, key, receiver);
    return (work: (tx: unknown) => Promise<unknown>, options: unknown) => target.$transaction(async tx => {
      const wrapped = new Proxy(tx, { get(obj, prop, recv) {
        if (prop !== "$queryRaw") return Reflect.get(obj, prop, recv);
        return async (strings: TemplateStringsArray, ...values: unknown[]) => {
          const result = await tx.$queryRaw(strings, ...values);
          const sql = strings.join("?");
          if (!paused && sql.includes('"commerce_sales"') && sql.includes("FOR UPDATE")) {
            paused = true; g.signal(); await g.wait;
          }
          return result;
        };
      } });
      return work(wrapped);
    }, options as never);
  } }) as PrismaClient;
}

/** Pause a real commerce transaction after the finance account row is locked. */
function gatedRefundAccount(db: PrismaClient, g: ReturnType<typeof gate>): PrismaClient {
  let paused = false;
  return new Proxy(db, { get(target, key, receiver) {
    if (key !== "$transaction") return Reflect.get(target, key, receiver);
    return (work: (tx: unknown) => Promise<unknown>, options: unknown) => target.$transaction(async tx => {
      const wrapped = new Proxy(tx, { get(obj, prop, recv) {
        if (prop !== "$queryRawUnsafe") return Reflect.get(obj, prop, recv);
        return async (sql: string, ...values: unknown[]) => {
          const result = await tx.$queryRawUnsafe(sql, ...values);
          if (!paused && sql.includes("FROM finance.accounts WHERE id=$1::bigint FOR UPDATE")) {
            paused = true; g.signal(); await g.wait;
          }
          return result;
        };
      } });
      return work(wrapped);
    }, options as never);
  } }) as PrismaClient;
}

/** Pause a real return after it releases the serial but before stock restoration. */
function gatedReturnedSerial(db: PrismaClient, g: ReturnType<typeof gate>): PrismaClient {
  let paused = false;
  return new Proxy(db, { get(target, key, receiver) {
    if (key !== "$transaction") return Reflect.get(target, key, receiver);
    return (work: (tx: unknown) => Promise<unknown>, options: unknown) => target.$transaction(async tx => {
      const wrapped = new Proxy(tx, { get(obj, prop, recv) {
        if (prop !== "inventorySerial") return Reflect.get(obj, prop, recv);
        const serials = Reflect.get(obj, prop, recv);
        return new Proxy(serials, { get(model, method, mr) {
          if (method !== "updateMany") return Reflect.get(model, method, mr);
          return async (...args: Parameters<typeof tx.inventorySerial.updateMany>) => {
            const result = await tx.inventorySerial.updateMany(...args);
            if (!paused) { paused = true; g.signal(); await g.wait; }
            return result;
          };
        } });
      } });
      return work(wrapped);
    }, options as never);
  } }) as PrismaClient;
}

/** Wrap only test transactions to gate or fail a particular raw SQL query. */
function interceptedDirectory(db: PrismaClient, match: string, g?: ReturnType<typeof gate>, fail = false): PrismaClient {
  let used = false;
  return new Proxy(db, { get(target, key, receiver) {
    if (key !== "$transaction") return Reflect.get(target, key, receiver);
    return (work: (tx: unknown) => Promise<unknown>, options: unknown) => target.$transaction(async tx => {
      const wrapped = new Proxy(tx, { get(obj, prop, recv) {
        if (prop !== "$queryRawUnsafe") return Reflect.get(obj, prop, recv);
        return async (sql: string, ...params: unknown[]) => {
          if (sql.includes(match) && fail) throw Object.assign(new Error("synthetic missing finance schema"), { code: "42P01" });
          const result = await tx.$queryRawUnsafe(sql, ...params);
          if (!used && sql.includes(match) && g) { used = true; g.signal(); await g.wait; }
          return result;
        };
      } });
      return work(wrapped);
    }, options as never);
  } }) as PrismaClient;
}

async function waitForLock(client: Client, table: "accounts" | "settlements" | "branch_source_barriers_test_only" | "source_order_barriers_test_only" | "expenses" | "users" | "branches" | "commerce_sales" | "commerce_collections" | "payments" | "stock_levels" | "custody_requests" | "route_barriers_test_only"): Promise<void> {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    await client.query("SELECT pg_stat_clear_snapshot()");
    const { rows } = await client.query(`SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query ILIKE $1 LIMIT 1`, [table === "commerce_sales" || table === "commerce_collections" || table === "stock_levels" ? `%${table}%` : `%${table === "users" || table === "branches" ? "public" : "finance"}.${table}%`]);
    if (rows.length) return;
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error(`concurrent transaction did not reach ${table} lock`);
}

/** Inject one driver-shaped error after work but before commit, on disposable data. */
function abortOnceAfterWork(prisma:PrismaClient,sqlState:string) {
  let attempts=0;
  const db:PrismaClient=new Proxy(prisma,{get(target,key,receiver) {
    if(key!=="$transaction")return Reflect.get(target,key,receiver);
    return (work:(tx:unknown)=>Promise<unknown>,options:unknown)=>{
      attempts++;
      const inject=attempts===1;
      return target.$transaction(async tx=>{
        const result=await work(tx);
        if(inject)throw Object.assign(new Error("synthetic transaction abort"),{code:"P2010",meta:{code:sqlState}});
        return result;
      },options as never);
    };
  }}) as PrismaClient;
  return {db,attempts:()=>attempts};
}

/** Test current inventory duplicate recovery on a disposable PostgreSQL fixture. */
async function checkInventoryDuplicateRecovery(admin:Client,prisma:PrismaClient,warehouseId:string):Promise<void> {
  // Repeat the inventory duplicate-recovery authorization test on the
  // disposable PostgreSQL cluster, not only the PGlite adapter.
  const parsedInventoryProduct=parseProductInput({requestId:randomUUID(),sku:"PG-REPLAY-412",nameAr:"صنف صلاحية اصطناعي",category:"ACCESSORY",brand:"تجربة",model:"A",purchaseCost:"10",salePrice:"20",taxRateId:"3",isSerialized:false});
  assert.ok(parsedInventoryProduct.ok);
  const inventoryProductInput=parsedInventoryProduct.value;
  const savedInventoryProduct=await createInventoryProduct(prisma,1n,inventoryProductInput);
  const inventoryOpeningInput={requestId:randomUUID(),productId:savedInventoryProduct.id,warehouseId:warehouseId,quantity:"2",unitCost:"10",serialNumbers:""};
  const savedInventoryOpening=await createInventoryOpening(prisma,1n,inventoryOpeningInput);
  for(const kind of ["product","opening"] as const) for(const mode of ["active","suspended","changed"] as const) {
    let inject=true;
    const duplicateInventory:PrismaClient=new Proxy(prisma,{get(target,key,receiver) {
      if(key!=="$transaction")return Reflect.get(target,key,receiver);
      return async (work:(tx:unknown)=>Promise<unknown>,options:unknown)=>{
        if(!inject)return target.$transaction(work as never,options as never);
        inject=false;
        try {
          return await target.$transaction(async tx=>{
            const wrapped=new Proxy(tx,{get(obj,prop,recv) {
              if(prop!==(kind==="product"?"inventoryProductCreation":"inventoryOpening"))return Reflect.get(obj,prop,recv);
              const delegate=Reflect.get(obj,prop,recv) as {findUnique:(args:unknown)=>Promise<unknown>};
              return new Proxy(delegate,{get(d,k,r) {
                if(k!=="findUnique")return Reflect.get(d,k,r);
                return async (args:unknown)=>{await delegate.findUnique(args);throw Object.assign(new Error("synthetic unique"),{code:"P2002"});};
              }});
            }});
            return work(wrapped);
          },options as never);
        } catch(error) {
          if(mode==="suspended")await admin!.query("UPDATE users SET status='SUSPENDED' WHERE id=1");
          throw error;
        }
      };
    }}) as PrismaClient;
    const productInput=mode==="changed"?{...inventoryProductInput,nameAr:"اسم مختلف"}:inventoryProductInput;
    const openingInput=mode==="changed"?{...inventoryOpeningInput,unitCost:"11"}:inventoryOpeningInput;
    const run=()=>kind==="product"?createInventoryProduct(duplicateInventory,1n,productInput):createInventoryOpening(duplicateInventory,1n,openingInput);
    try {
      if(mode==="suspended")await assert.rejects(run,/المحاسب فقط/);
      else if(mode==="changed")await assert.rejects(run,/بيانات مختلفة/);
      else assert.deepEqual(await run(),{id:kind==="product"?savedInventoryProduct.id:savedInventoryOpening.id,replayed:true});
    } finally {if(mode==="suspended")await admin.query("UPDATE users SET status='ACTIVE' WHERE id=1");}
  }
  assert.equal((await admin.query<{qty:string}>("SELECT qty_on_hand::text AS qty FROM stock_levels WHERE warehouse_id=$1::bigint AND product_id=$2::bigint",[warehouseId,savedInventoryProduct.id])).rows[0].qty,"2.00");
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM inventory_openings WHERE request_id=$1::uuid",[inventoryOpeningInput.requestId])).rows[0].n,1);
  const retryProduct={...inventoryProductInput,requestId:randomUUID(),sku:"PG-RETRY-412"};
  const productRetry=abortOnceAfterWork(prisma,"40P01");
  const retriedProduct=await createInventoryProduct(productRetry.db,1n,retryProduct);
  assert.equal(productRetry.attempts(),2);assert.equal(retriedProduct.replayed,false);
  assert.deepEqual(await createInventoryProduct(prisma,1n,retryProduct),{id:retriedProduct.id,replayed:true});
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM inventory_product_creations WHERE request_id=$1::uuid",[retryProduct.requestId])).rows[0].n,1);
  const retryOpening={requestId:randomUUID(),productId:retriedProduct.id,warehouseId,quantity:"1",unitCost:"10",serialNumbers:""};
  const openingRetry=abortOnceAfterWork(prisma,"40001");
  const retriedOpening=await createInventoryOpening(openingRetry.db,1n,retryOpening);
  assert.equal(openingRetry.attempts(),2);assert.equal(retriedOpening.replayed,false);
  assert.deepEqual(await createInventoryOpening(prisma,1n,retryOpening),{id:retriedOpening.id,replayed:true});
  assert.equal((await admin.query<{qty:string}>("SELECT qty_on_hand::text AS qty FROM stock_levels WHERE warehouse_id=$1::bigint AND product_id=$2::bigint",[warehouseId,retriedProduct.id])).rows[0].qty,"1.00");
}

/** Test-only P2002 interleavings for the real receiving service. */
async function checkReceivingDuplicateRecovery(admin:Client,prisma:PrismaClient,warehouseId:string):Promise<void> {
  const receipt={requestId:randomUUID(),productId:"2",warehouseId,quantity:"1",unitCost:"30",serialNumbers:"",sourceReference:"توريد اصطناعي"};
  const before=(await admin.query<{qty:string}>("SELECT qty_on_hand::text AS qty FROM stock_levels WHERE warehouse_id=$1::bigint AND product_id=2",[warehouseId])).rows[0].qty;
  const saved=await receiveInventoryStock(prisma,410n,receipt);
  assert.equal(saved.replayed,false);
  for(const mode of ["active","suspended","transferred","productStopped","changed"] as const) {
    let inject=true;
    const duplicate:PrismaClient=new Proxy(prisma,{get(target,key,receiver) {
      if(key!=="$transaction")return Reflect.get(target,key,receiver);
      return async (work:(tx:unknown)=>Promise<unknown>,options:unknown)=>{
        if(!inject)return target.$transaction(work as never,options as never);
        inject=false;
        try {
          return await target.$transaction(async tx=>{
            const wrapped=new Proxy(tx,{get(obj,prop,recv) {
              if(prop!=="inventoryReceipt")return Reflect.get(obj,prop,recv);
              const delegate=tx.inventoryReceipt;
              return new Proxy(delegate,{get(d,k,r) {
                if(k!=="findUnique")return Reflect.get(d,k,r);
                return async (...args:Parameters<typeof delegate.findUnique>)=>{await delegate.findUnique(...args);throw Object.assign(new Error("synthetic unique"),{code:"P2002"});};
              }});
            }});
            return work(wrapped);
          },options as never);
        } catch(error) {
          if(mode==="suspended")await admin.query("UPDATE users SET status='SUSPENDED' WHERE id=410");
          if(mode==="transferred")await admin.query("UPDATE users SET branch_id=1 WHERE id=410");
          if(mode==="productStopped")await admin.query("UPDATE products SET is_active=false WHERE id=2");
          throw error;
        }
      };
    }}) as PrismaClient;
    const input=mode==="changed"?{...receipt,unitCost:"31"}:receipt;
    try {
      if(mode==="active")assert.deepEqual(await receiveInventoryStock(duplicate,410n,input),{id:saved.id,replayed:true});
      else await assert.rejects(()=>receiveInventoryStock(duplicate,410n,input),mode==="suspended"?/موظف الفرع فقط/:mode==="transferred"?/مستودعات فرعه/:mode==="productStopped"?/الصنف غير متاح/:/بيانات مختلفة/);
    } finally {
      if(mode==="suspended")await admin.query("UPDATE users SET status='ACTIVE' WHERE id=410");
      if(mode==="transferred")await admin.query("UPDATE users SET branch_id=410 WHERE id=410");
      if(mode==="productStopped")await admin.query("UPDATE products SET is_active=true WHERE id=2");
    }
  }
  const finalQty=(await admin.query<{qty:string}>("SELECT qty_on_hand::text AS qty FROM stock_levels WHERE warehouse_id=$1::bigint AND product_id=2",[warehouseId])).rows[0].qty;
  assert.equal(Number(finalQty),Number(before)+1);
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM inventory_receipts WHERE request_id=$1::uuid",[receipt.requestId])).rows[0].n,1);
  const retryReceipt={...receipt,requestId:randomUUID()};
  const retry=abortOnceAfterWork(prisma,"40001");
  const retried=await receiveInventoryStock(retry.db,410n,retryReceipt);
  assert.equal(retry.attempts(),2);assert.equal(retried.replayed,false);
  assert.deepEqual(await receiveInventoryStock(prisma,410n,retryReceipt),{id:retried.id,replayed:true});
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM inventory_receipts WHERE request_id=$1::uuid",[retryReceipt.requestId])).rows[0].n,1);
  const noRetryReceipt={...receipt,requestId:randomUUID()};
  const noRetry=abortOnceAfterWork(prisma,"23514");
  await assert.rejects(()=>receiveInventoryStock(noRetry.db,410n,noRetryReceipt),/synthetic transaction abort/);
  assert.equal(noRetry.attempts(),1);
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM inventory_receipts WHERE request_id=$1::uuid",[noRetryReceipt.requestId])).rows[0].n,0);
  assert.equal(Number((await admin.query<{qty:string}>("SELECT qty_on_hand::text AS qty FROM stock_levels WHERE warehouse_id=$1::bigint AND product_id=2",[warehouseId])).rows[0].qty),Number(before)+2);
}

async function checkSettlementCancellationSnapshot(admin:Client,db:FinanceDatabase,today:string):Promise<void> {
  // A settlement cancellation is likewise not represented by account
  // revision. The single-statement experimental reader is not a close guard.
  await admin.query(`INSERT INTO branches(id,code,name_ar,city,phone,invoice_prefix,opening_date,is_active,created_at)
    VALUES(413,'SYN413','فرع تسوية اصطناعي','تجربة','000','SYN413',CURRENT_DATE,true,now())`);
  await admin.query(`INSERT INTO users(id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
    SELECT n,413,role_code,'حامل تسوية اصطناعي',concat('pg-close-settle-',n,'@selahtone.local'),password_hash,'ACTIVE',false,'FULL',false,now() FROM users CROSS JOIN (VALUES(413),(414)) AS v(n) WHERE id=1`);
  const settlementAccount=await openAccount(db,"1",{requestId:randomUUID(),branchId:"413",kind:"CUSTODY",holderId:"413",openingAmount:"0",openingDate:today,counted:true},today);
  const isolatedAccount=await openAccount(db,"1",{requestId:randomUUID(),branchId:"413",kind:"CUSTODY",holderId:"414",openingAmount:"0",openingDate:today,counted:true},today);
  const settlementInput={requestId:randomUUID(),accountId:settlementAccount.id,countedAmount:"0",expectedBalance:"0",reason:"تسوية اصطناعية قبل الإقفال",actuallyCounted:true};
  const pendingSettlement=await requestSettlement(db,"413",settlementInput);
  const settlementRevision=(await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.accounts WHERE id=$1::bigint",[settlementAccount.id])).rows[0].revision;
  const settlementIdentity=syntheticCloseAccountSnapshotV2({id:settlementAccount.id,branchId:"413",kind:"CUSTODY",holderId:"413",closed:false,revision:settlementRevision});
  const settlementPending=syntheticClosePendingSnapshot(settlementIdentity,[],[pendingSettlement.id]);
  const readSettlementPending=()=>db.serializable(tx=>readSyntheticClosePendingSnapshot(tx,settlementAccount.id));
  assert.equal(await readSettlementPending(),settlementPending);
  const otherCount=await requestCountFromHolder(db,"1",{requestId:randomUUID(),accountId:isolatedAccount.id,reason:"جرد حساب آخر"});
  assert.equal(await readSettlementPending(),settlementPending);
  const settlementClose={requestId:randomUUID(),accountId:settlementAccount.id,reason:"إقفال بعد إلغاء تسوية اصطناعي",reviewVersion:2,expectedAccountSnapshot:settlementIdentity};
  await assert.rejects(()=>reviewedCloseTestOnly(db,"1",settlementClose),/طلب تسوية أو جرد مفتوح/);
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.requests WHERE request_id=$1::uuid",[settlementClose.requestId])).rows[0].n,0);
  const cancelSettlementInput={requestId:randomUUID(),settlementId:pendingSettlement.id,reason:"إلغاء تسوية اصطناعي"};
  assert.equal((await cancelSettlement(db,"413",cancelSettlementInput)).replayed,false);
  assert.equal((await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.accounts WHERE id=$1::bigint",[settlementAccount.id])).rows[0].revision,settlementRevision);
  assert.equal(await readSettlementPending(),syntheticClosePendingSnapshot(settlementIdentity,[],[]));
  assert.notEqual(await readSettlementPending(),settlementPending);
  assert.equal((await reviewedCloseTestOnly(db,"1",settlementClose)).replayed,false);
  assert.deepEqual(await reviewedCloseTestOnly(db,"1",settlementClose),{id:settlementAccount.id,replayed:true});
  assert.deepEqual(await cancelSettlement(db,"413",cancelSettlementInput),{id:pendingSettlement.id,replayed:true});
  assert.deepEqual(await requestSettlement(db,"413",settlementInput),{id:pendingSettlement.id,replayed:true});
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE source_id=$1::bigint OR destination_id=$1::bigint",[settlementAccount.id])).rows[0].n,0);
  await cancelCashCount(db,"1",{requestId:randomUUID(),countId:otherCount.id,reason:"إلغاء جرد اصطناعي"});
 }

/** Test-only source drift in a real count transaction, on disposable data. */
async function checkCountPendingSourceDrift(admin:Client,db:FinanceDatabase,accountId:string,collectionId:string,paymentId:string,today:string):Promise<void> {
  const original=await db.serializable(tx=>reviewTestPeriod(tx,accountId));
  const snapshot=async()=> (await admin.query<{revision:string;counts:number;movements:number;audits:number}>(`SELECT a.revision::text AS revision,
    (SELECT count(*)::int FROM finance.cash_counts WHERE account_id=a.id) AS counts,
    (SELECT count(*)::int FROM finance.movements WHERE source_id=a.id OR destination_id=a.id) AS movements,
    (SELECT count(*)::int FROM finance.audit_events WHERE entity_type='CASH_COUNT') AS audits
    FROM finance.accounts a WHERE a.id=$1::bigint`,[accountId])).rows[0];
  for(const type of ["collection","payment"] as const) {
    const requestId=randomUUID(), before=await snapshot();
    await assert.rejects(()=>db.serializable(async tx=>{
      if(type==="collection")await tx.query("UPDATE public.commerce_collections SET created_by_id=1 WHERE id=$1::bigint",[collectionId]);
      else await tx.query("UPDATE finance.payments SET recorded_by=1 WHERE id=$1::bigint",[paymentId]);
      assert.deepEqual(await reviewTestPeriod(tx,accountId),original,"ID/amount fingerprint cannot see recorder changes");
      const joined:FinanceDatabase={serializable:work=>work(tx)};
      await requestCashCount(testCountClosePeriodGuard(joined,accountId),"1",{requestId,accountId,expectedBalance:"120",countedAmount:"118",reason:"مصدر بند اصطناعي",actuallyCounted:true},today);
    }),type==="collection"?/مصدر التحصيل المخصص غير متسق/:/مصدر الصرف المخصص غير متسق/);
    assert.deepEqual(await snapshot(),before);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.requests WHERE request_id=$1::uuid",[requestId])).rows[0].n,0);
    assert.equal((await admin.query<{recorder:string}>(type==="collection"?"SELECT created_by_id::text AS recorder FROM public.commerce_collections WHERE id=$1::bigint":"SELECT recorded_by::text AS recorder FROM finance.payments WHERE id=$1::bigint",[type==="collection"?collectionId:paymentId])).rows[0].recorder,"79");
    assert.deepEqual(await db.serializable(tx=>reviewTestPeriod(tx,accountId)),original);
  }
}

/** Two selected lock orders with deliberately uncoordinated SQL writers. */
async function checkCountSourceRace(admin:Client,prisma:PrismaClient,db:FinanceDatabase,accountId:string,collectionId:string,paymentId:string,today:string):Promise<void> {
  for(const type of ["collection","payment"] as const) {
    const itemId=type==="collection"?collectionId:paymentId;
    const table=type==="collection"?"commerce_collections":"payments";
    const change=type==="collection"?"UPDATE commerce_collections SET created_by_id=$2::bigint WHERE id=$1::bigint":"UPDATE finance.payments SET recorded_by=$2::bigint WHERE id=$1::bigint";
    const lock=type==="collection"?"ORDER BY a.collection_id FOR UPDATE OF a,c,sale":"ORDER BY a.payment_id FOR UPDATE OF a,p,expense";
    const error=type==="collection"?/مصدر التحصيل المخصص غير متسق/:/مصدر الصرف المخصص غير متسق/;
    const count={requestId:randomUUID(),accountId,expectedBalance:"120",countedAmount:"118",reason:"سباق مصدر اصطناعي",actuallyCounted:true};
    await admin.query("BEGIN");
    try {
      await admin.query(change,[itemId,"1"]);
      const after=requestCashCount(testCountClosePeriodGuard(db,accountId),"1",count,today).then(value=>({value}),error=>({error}));
      try {await waitForLock(admin,table);} finally {await admin.query("COMMIT");}
      const result=await after;
      assert.ok("error" in result); assert.match(String(result.error),error);
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.requests WHERE request_id=$1::uuid",[count.requestId])).rows[0].n,0);
    } finally {await admin.query(change,[itemId,"79"]);}
    const g=gate();
    const gated=testCountClosePeriodGuard(gatedFinance(prisma,g,lock),accountId);
    const first=requestCashCount(gated,"1",count,today);
    await g.entered;
    const later=Promise.resolve(prisma.$executeRawUnsafe(change,itemId,"1"));
    try {await waitForLock(admin,table);} finally {g.release();}
    const saved=await first; assert.equal(saved.replayed,false);
    try {
      await later;
      assert.deepEqual(await requestCashCount(testCountClosePeriodGuard(db,accountId),"1",count,today),{id:saved.id,replayed:true});
    } finally {await admin.query(change,[itemId,"79"]);}
    await cancelCashCount(db,"1",{requestId:randomUUID(),countId:saved.id,reason:"إلغاء جرد اصطناعي بعد الاختبار"});
  }
}

/** Direct candidate custody command, never called by application services. */
async function checkCustodyCommand(admin:Client,db:FinanceDatabase,accountId:string,saleId:string,today:string):Promise<void> {
  const input={requestId:randomUUID(),saleId,amount:"3",method:"CASH",actuallyPaid:false};
  const state=async()=> (await admin.query<{revision:string;saleRevision:string;movements:number;allocations:number}>(`SELECT a.revision::text AS revision,(SELECT revision::text FROM commerce_sales WHERE id=$2::bigint) AS "saleRevision",
    (SELECT count(*)::int FROM finance.movements WHERE source_id=a.id OR destination_id=a.id) AS movements,
    (SELECT count(*)::int FROM finance.collection_allocations_test_only WHERE account_id=a.id) AS allocations FROM finance.accounts a WHERE a.id=$1::bigint`,[accountId,saleId])).rows[0];
  const before=await state();
  const saved=await db.serializable(tx=>recordCustodyCollectionTestOnly(tx,79n,input));
  assert.equal(saved.replayed,false);
  assert.deepEqual(await db.serializable(tx=>recordCustodyCollectionTestOnly(tx,79n,input)),{id:saved.id,replayed:true});
  const after=await state();
  assert.equal(BigInt(after.revision),BigInt(before.revision)+1n);
  assert.equal(BigInt(after.saleRevision),BigInt(before.saleRevision)+1n);
  assert.equal(after.movements,before.movements);assert.equal(after.allocations,before.allocations+1);
  assert.equal((await admin.query<{treatment:string;movement:string|null}>("SELECT treatment,movement_id::text AS movement FROM finance.collection_allocations_test_only WHERE collection_id=$1::bigint",[saved.id])).rows[0].treatment,"CUSTODY_PENDING");
  await assert.rejects(()=>db.serializable(tx=>recordCustodyCollectionTestOnly(tx,79n,{...input,amount:"4"})),/مختلفة/);
  const count=await requestCashCount(db,"1",{requestId:randomUUID(),accountId,expectedBalance:"123",countedAmount:"123",reason:"جرد معلق اصطناعي",actuallyCounted:true},today);
  const blocked={...input,requestId:randomUUID()}, beforeBlock=await state();
  await assert.rejects(()=>db.serializable(tx=>recordCustodyCollectionTestOnly(tx,79n,blocked)),/طلب جرد أو تسوية مفتوح/);
  assert.deepEqual(await state(),beforeBlock);
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_collections WHERE request_id=$1::uuid",[blocked.requestId])).rows[0].n,0);
  assert.deepEqual(await db.serializable(tx=>recordCustodyCollectionTestOnly(tx,79n,input)),{id:saved.id,replayed:true});
  await cancelCashCount(db,"1",{requestId:randomUUID(),countId:count.id,reason:"إلغاء جرد اصطناعي"});
  assert.equal((await db.serializable(tx=>recordCustodyCollectionTestOnly(tx,79n,blocked))).replayed,false);
}

/** Disposable selected races for the *candidate*, not the application command. */
async function checkCustodyCommandRaces(admin:Client,prisma:PrismaClient,db:FinanceDatabase,today:string):Promise<void> {
  await admin.query(`INSERT INTO branches(id,code,name_ar,city,phone,invoice_prefix,opening_date,is_active,created_at)
    VALUES(415,'SYN415','فرع تزامن عهدة اصطناعي','تجربة','000','SYN415',CURRENT_DATE,true,now())`);
  await admin.query(`INSERT INTO users(id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
    SELECT n,415,role_code,'حامل تزامن اصطناعي',concat('pg-custody-command-',n,'@selahtone.local'),password_hash,'ACTIVE',false,'FULL',false,now() FROM users CROSS JOIN generate_series(415,418) n WHERE id=3`);
  for(const [holder,operation,first] of [["415","count","operation"],["416","count","collection"],["417","settlement","operation"],["418","settlement","collection"]] as const) {
    const account=await openAccount(db,"1",{requestId:randomUUID(),branchId:"415",kind:"CUSTODY",holderId:holder,openingAmount:"0",openingDate:today,counted:true},today);
    await admin.query("UPDATE finance.accounts SET opened_at=now()-interval '1 day' WHERE id=$1::bigint",[account.id]);
    const sale=(await admin.query<{id:string}>(`INSERT INTO commerce_sales(request_id,request_hash,branch_id,warehouse_id,customer_name,customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,created_by_id)
      SELECT $1::uuid,repeat('c',64),415,warehouse_id,'تزامن اصطناعي',customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,$2::bigint FROM commerce_sales WHERE id=2 RETURNING id::text`,[randomUUID(),holder])).rows[0].id;
    const collection={requestId:randomUUID(),saleId:sale,amount:"8",method:"CASH",actuallyPaid:false};
    const request={requestId:randomUUID(),accountId:account.id,expectedBalance:"0",countedAmount:"0",reason:"تداخل اصطناعي",actuallyCounted:true};
    const gateLock=gate();
    const candidate=async (port:FinanceDatabase)=>{let attempts=0;for (;;) {try {attempts++;return await port.serializable(tx=>recordCustodyCollectionTestOnly(tx,BigInt(holder),collection));}catch(e){if(attempts<4 && isRetryableTransactionConflict(e))continue;throw e;}}};
    const operationCall=(port:FinanceDatabase)=>operation==="count"?requestCashCount(port,"1",request,today):requestSettlement(port,holder,request);
    let savedCollection:{id:string;replayed:boolean}|null=null;
    let savedOperation:{id:string;replayed:boolean}|null=null;
    if(first==="operation") {
      const pending=operationCall(gatedFinance(prisma,gateLock));
      await gateLock.entered;
      const after=candidate(db).then(value=>({value}),error=>({error}));
      try {await waitForLock(admin,"accounts");} finally {gateLock.release();}
      savedOperation=await pending;
      const result=await after;assert.ok("error" in result);assert.match(String(result.error),/طلب جرد أو تسوية مفتوح/);
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_collections WHERE request_id=$1::uuid",[collection.requestId])).rows[0].n,0);
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.collection_allocations_test_only WHERE account_id=$1::bigint",[account.id])).rows[0].n,0);
    } else {
      const pending=candidate(gatedFinance(prisma,gateLock));
      await gateLock.entered;
      const after=operationCall(db).then(value=>({value}),error=>({error}));
      try {await waitForLock(admin,"accounts");} finally {gateLock.release();}
      savedCollection=await pending;
      const result=await after;
      if(operation==="count") {assert.ok("error" in result);assert.match(String(result.error),/تغير الرصيد المتوقع/);}
      else {assert.ok("value" in result);savedOperation=result.value;
        assert.equal((await admin.query<{sales:string}>("SELECT sales_total::text AS sales FROM finance.settlements WHERE id=$1::bigint",[savedOperation.id])).rows[0].sales,"8.00");}
      assert.deepEqual(await candidate(db),{id:savedCollection.id,replayed:true});
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.collection_allocations_test_only WHERE account_id=$1::bigint AND settlement_id IS NULL",[account.id])).rows[0].n,1);
    }
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE source_id=$1::bigint OR destination_id=$1::bigint",[account.id])).rows[0].n,0);
    if(savedOperation) {
      if(operation==="count")await cancelCashCount(db,"1",{requestId:randomUUID(),countId:savedOperation.id,reason:"إلغاء اصطناعي"});
      else await cancelSettlement(db,holder,{requestId:randomUUID(),settlementId:savedOperation.id,reason:"إلغاء اصطناعي"});
    }
    if(first==="operation")assert.equal((await candidate(db)).replayed,false,"rejected request remains reusable after cancellation");
  }
}

/** Characterize why the candidate cannot be integrated against the old period formula. */
async function checkDirectCustodyProxyMismatch(admin:Client,prisma:PrismaClient,db:FinanceDatabase,today:string):Promise<void> {
  await admin.query(`INSERT INTO branches(id,code,name_ar,city,phone,invoice_prefix,opening_date,is_active,created_at)
    VALUES(419,'SYN419','فرع اختلاف إسناد اصطناعي','تجربة','000','SYN419',CURRENT_DATE,true,now())`);
  await admin.query(`INSERT INTO users(id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
    SELECT n,419,role_code,'موظف إسناد اصطناعي',concat('pg-direct-proxy-',n,'@selahtone.local'),password_hash,'ACTIVE',false,'FULL',false,now() FROM users CROSS JOIN (VALUES(419),(420)) AS v(n) WHERE id=3`);
  const vault=await openAccount(db,"1",{requestId:randomUUID(),branchId:"419",kind:"VAULT",holderId:null,openingAmount:"0",openingDate:today,counted:true},today);
  const account=await openAccount(db,"1",{requestId:randomUUID(),branchId:"419",kind:"CUSTODY",holderId:"419",openingAmount:"0",openingDate:today,counted:true},today);
  await admin.query("UPDATE finance.accounts SET opened_at=now()-interval '1 day' WHERE id=$1::bigint",[account.id]);
  const sale=(await admin.query<{id:string}>(`INSERT INTO commerce_sales(request_id,request_hash,branch_id,warehouse_id,customer_name,customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,created_by_id)
    SELECT $1::uuid,repeat('d',64),419,warehouse_id,'اختلاف إسناد اصطناعي',customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,420 FROM commerce_sales WHERE id=2 RETURNING id::text`,[randomUUID()])).rows[0].id;
  const collectionInput={requestId:randomUUID(),saleId:sale,amount:"8",method:"CASH",actuallyPaid:false};
  const collection=await db.serializable(tx=>recordCustodyCollectionTestOnly(tx,419n,collectionInput));
  const review=await db.serializable(tx=>reviewTestPeriod(tx,account.id));
  assert.deepEqual(review.collections.map(item=>[item.id,item.amount]),[[collection.id,"8.00"]]);
  const overview=await settlementOverview(db,"419",account.id);
  assert.equal(overview.sales,"0.00");assert.equal(overview.expected,"0.00");
  const legacyRequest={requestId:randomUUID(),accountId:account.id,expectedBalance:"0",countedAmount:"8",reason:"اختلاف مصدر اصطناعي",actuallyCounted:true};
  const request=await requestSettlement(db,"419",legacyRequest);
  assert.deepEqual((await admin.query<{sales:string;expected:string;adjustment:string}>("SELECT sales_total::text AS sales,expected_amount::text AS expected,adjustment::text AS adjustment FROM finance.settlements WHERE id=$1::bigint",[request.id])).rows[0],{sales:"0.00",expected:"0.00",adjustment:"8.00"});
  const decision={requestId:randomUUID(),settlementId:request.id,expectedBalance:"0",transferAmount:"0",transferDirection:"TO_VAULT",reason:"مراجعة اصطناعية",actuallyTransferred:true};
  const state=async()=> (await admin.query<{status:string;accountRev:string;vaultRev:string;movements:number;receipts:number;requests:number;audits:number;pending:number}>(`SELECT s.status,a.revision::text AS "accountRev",v.revision::text AS "vaultRev",
    (SELECT count(*)::int FROM finance.movements WHERE settlement_id=s.id) AS movements,
    (SELECT count(*)::int FROM finance.settlement_allocation_receipts_test_only WHERE settlement_id=s.id) AS receipts,
    (SELECT count(*)::int FROM finance.requests WHERE request_id=$3::uuid) AS requests,
    (SELECT count(*)::int FROM finance.audit_events WHERE entity_type='SETTLEMENT' AND entity_id=s.id) AS audits,
    (SELECT count(*)::int FROM finance.collection_allocations_test_only WHERE account_id=a.id AND settlement_id IS NULL) AS pending
    FROM finance.settlements s JOIN finance.accounts a ON a.id=s.account_id JOIN finance.accounts v ON v.id=$2::bigint WHERE s.id=$1::bigint`,[request.id,vault.id,decision.requestId])).rows[0];
  const before=await state();
  let reached=false;
  await assert.rejects(()=>db.serializable(async tx=>{
    const joined:FinanceDatabase={serializable:work=>work(tx)};
    assert.equal((await confirmSettlement(joined,"1",decision)).replayed,false);
    assert.equal((await tx.query<{status:string}>("SELECT status FROM finance.settlements WHERE id=$1::bigint",[request.id])).rows[0].status,"CONFIRMED");
    assert.equal((await tx.query<{n:number}>("SELECT count(*)::int AS n FROM finance.collection_allocations_test_only WHERE account_id=$1::bigint AND settlement_id IS NULL",[account.id])).rows[0].n,1);
    reached=true;throw new Error("rollback synthetic unsafe confirmation");
  }),/rollback synthetic unsafe confirmation/);
  assert.ok(reached);assert.deepEqual(await state(),before);
  const hook={accountId:account.id,actorId:"1",collectionIds:[collection.id],paymentIds:[],reviewedHash:review.hash};
  await assert.rejects(()=>confirmSettlement(testRealSettlementWithPeriod(db,hook),"1",decision),/العناصر المخصصة لا تطابق عناصر معادلة التسوية الحالية/);
  assert.deepEqual(await state(),before);
  assert.deepEqual(await db.serializable(tx=>recordCustodyCollectionTestOnly(tx,419n,collectionInput)),{id:collection.id,replayed:true});
  await cancelSettlement(db,"419",{requestId:randomUUID(),settlementId:request.id,reason:"إلغاء طلب اصطناعي للمراجعة"});
  // Experimental alternative: refuse unknown sources before substituting the
  // pending formula in the real service. No claim is made about old history.
  const alternate={requestId:randomUUID(),accountId:account.id,expectedBalance:"0",countedAmount:"8",reason:"صيغة تخصيص اصطناعية",actuallyCounted:true};
  const requestReview={collectionIds:[collection.id],paymentIds:[],reviewedHash:review.hash};
  await assert.rejects(()=>requestAllocatedSettlementTestOnly(db,"419",legacyRequest,account.id,requestReview),/مراجعة الطلب غير موجودة/);
  assert.deepEqual(await requestSettlement(db,"419",legacyRequest),{id:request.id,replayed:true});
  const orphan=(await admin.query<{id:string}>(`INSERT INTO commerce_collections(request_id,request_hash,sale_id,amount,method,is_initial,created_by_id)
    VALUES($1::uuid,repeat('e',64),$2::bigint,1,'CASH',false,420) RETURNING id::text`,[randomUUID(),sale])).rows[0].id;
  await assert.rejects(()=>requestAllocatedSettlementTestOnly(db,"419",alternate,account.id,requestReview),/مصادر نقدية بلا تخصيص/);
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.requests WHERE request_id=$1::uuid",[alternate.requestId])).rows[0].n,0);
  assert.deepEqual(await db.serializable(tx=>reviewTestPeriod(tx,account.id)),review);
  // Removing the deliberately injected source is fixture cleanup, not a repair
  // recommendation. It must never be applied to real or unresolved records.
  await admin.query("DELETE FROM commerce_collections WHERE id=$1::bigint",[orphan]);
  const revisionBeforeRequest=(await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.accounts WHERE id=$1::bigint",[account.id])).rows[0].revision;
  await assert.rejects(()=>db.serializable(async tx=>{
    await tx.query("UPDATE commerce_collections SET amount=9 WHERE id=$1::bigint",[collection.id]);
    const joined:FinanceDatabase={serializable:work=>work(tx)};
    await requestAllocatedSettlementTestOnly(joined,"419",alternate,account.id,requestReview);
  }),/تغيّرت عناصر المراجعة قبل إنشاء الطلب/);
  assert.deepEqual(await db.serializable(tx=>reviewTestPeriod(tx,account.id)),review);
  assert.equal((await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.accounts WHERE id=$1::bigint",[account.id])).rows[0].revision,revisionBeforeRequest);
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.requests WHERE request_id=$1::uuid",[alternate.requestId])).rows[0].n,0);
  // Synthetic query failures after the tentative insert must escape the joined
  // engine command, roll back the outer transaction and retain their code.
  // An actual SQL abort leaves that transaction unusable, so retrying inside it
  // would be incorrect even though this injection is not a real race.
  for(const code of ["40001","40P01","23505"]) {
    let attempts=0;
    const fault:FinanceDatabase={serializable:work=>db.serializable(tx=>{
      attempts++;
      const port:FinanceTransaction={...tx,query:async <T extends Record<string,unknown>>(sql:string,params?:unknown[])=>{
        const result=await tx.query<T>(sql,params);
        if(sql.includes("INSERT INTO finance.settlements"))throw Object.assign(new Error("synthetic outer abort"),{code});
        return result;
      }};
      return work(port);
    })};
    await assert.rejects(()=>requestAllocatedSettlementTestOnly(fault,"419",alternate,account.id,requestReview),(error:unknown)=>typeof error==="object" && error!==null && "code" in error && error.code===code);
    assert.equal(attempts,1);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.requests WHERE request_id=$1::uuid",[alternate.requestId])).rows[0].n,0);
    assert.equal((await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.accounts WHERE id=$1::bigint",[account.id])).rows[0].revision,revisionBeforeRequest);
    assert.deepEqual(await db.serializable(tx=>reviewTestPeriod(tx,account.id)),review);
  }
  const requestGate=gate();
  const firstRequest=requestAllocatedSettlementTestOnly(gatedFinance(prisma,requestGate),"419",alternate,account.id,requestReview);
  await requestGate.entered;
  let duplicateAttempts=0;
  const duplicateRequest=(async()=>{for(;;) {
    try {duplicateAttempts++;return await requestAllocatedSettlementTestOnly(db,"419",alternate,account.id,requestReview);}
    catch(error) {if(duplicateAttempts<4 && isRetryableTransactionConflict(error))continue;throw error;}
  }})();
  try {await waitForLock(admin,"accounts");} finally {requestGate.release();}
  const next=await firstRequest;
  assert.equal(next.replayed,false);
  assert.deepEqual(await duplicateRequest,{id:next.id,replayed:true});
  assert.ok(duplicateAttempts>=2,"the test harness must retry the entire aborted transaction");
  assert.deepEqual(await requestAllocatedSettlementTestOnly(db,"419",alternate,account.id,requestReview),{id:next.id,replayed:true});
  const changedReview={...requestReview,reviewedHash:"f".repeat(64)};
  await assert.rejects(()=>requestAllocatedSettlementTestOnly(db,"419",alternate,account.id,changedReview),/مراجعة الطلب غير موجودة أو لا تطابق/);
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.settlement_request_reviews_test_only WHERE settlement_id=$1::bigint",[next.id])).rows[0].n,1);
  assert.deepEqual((await admin.query<{sales:string;expected:string;adjustment:string}>("SELECT sales_total::text AS sales,expected_amount::text AS expected,adjustment::text AS adjustment FROM finance.settlements WHERE id=$1::bigint",[next.id])).rows[0],{sales:"8.00",expected:"8.00",adjustment:"8.00"});
  const confirmed={...decision,requestId:randomUUID(),settlementId:next.id};
  const capture=requestReview;
  const confirmOrphan=(await admin.query<{id:string}>(`INSERT INTO commerce_collections(request_id,request_hash,sale_id,amount,method,is_initial,created_by_id,created_at)
    VALUES($1::uuid,repeat('e',64),$2::bigint,1,'CASH',false,420,now()-interval '2 days') RETURNING id::text`,[randomUUID(),sale])).rows[0].id;
  await assert.rejects(()=>confirmAllocatedSettlementTestOnly(db,"1",confirmed,account.id,capture),/مصادر نقدية بلا تخصيص/);
  assert.equal((await admin.query<{status:string}>("SELECT status FROM finance.settlements WHERE id=$1::bigint",[next.id])).rows[0].status,"OPEN");
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE settlement_id=$1::bigint",[next.id])).rows[0].n,0);
  await admin.query("DELETE FROM commerce_collections WHERE id=$1::bigint",[confirmOrphan]);
  await assert.rejects(()=>db.serializable(async tx=>{
    await tx.query("UPDATE commerce_collections SET amount=9 WHERE id=$1::bigint",[collection.id]);
    const joined:FinanceDatabase={serializable:work=>work(tx)};
    await confirmAllocatedSettlementTestOnly(joined,"1",confirmed,account.id,capture);
  }),/تغيّرت عناصر الفترة/);
  assert.deepEqual(await db.serializable(tx=>reviewTestPeriod(tx,account.id)),review);
  assert.equal((await admin.query<{status:string}>("SELECT status FROM finance.settlements WHERE id=$1::bigint",[next.id])).rows[0].status,"OPEN");
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.requests WHERE request_id=$1::uuid",[confirmed.requestId])).rows[0].n,0);
  // ID/amount evidence alone cannot notice a changed recorder. Force a source
  // mismatch without changing the review hash, and verify the current-source
  // guard refuses confirmation atomically. The bypass write is rolled back.
  await assert.rejects(()=>db.serializable(async tx=>{
    await tx.query("UPDATE commerce_collections SET created_by_id=420 WHERE id=$1::bigint",[collection.id]);
    assert.deepEqual(await reviewTestPeriod(tx,account.id),review);
    const joined:FinanceDatabase={serializable:work=>work(tx)};
    await confirmAllocatedSettlementTestOnly(joined,"1",confirmed,account.id,capture);
  }),/مصدر التحصيل المخصص غير متسق/);
  assert.equal((await admin.query<{recorder:string}>("SELECT created_by_id::text AS recorder FROM commerce_collections WHERE id=$1::bigint",[collection.id])).rows[0].recorder,"419");
  assert.equal((await admin.query<{status:string}>("SELECT status FROM finance.settlements WHERE id=$1::bigint",[next.id])).rows[0].status,"OPEN");
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.requests WHERE request_id=$1::uuid",[confirmed.requestId])).rows[0].n,0);
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE settlement_id=$1::bigint",[next.id])).rows[0].n,0);
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.settlement_allocation_receipts_test_only WHERE settlement_id=$1::bigint",[next.id])).rows[0].n,0);
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.collection_allocations_test_only WHERE collection_id=$1::bigint AND settlement_id IS NULL",[collection.id])).rows[0].n,1);
  const beforeConfirmRevision=(await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.accounts WHERE id=$1::bigint",[account.id])).rows[0].revision;
  for(const code of ["40001","23505"]) {
    let attempts=0;
    const fault:FinanceDatabase={serializable:work=>db.serializable(tx=>{
      attempts++;
      const port:FinanceTransaction={...tx,query:async <T extends Record<string,unknown>>(sql:string,params?:unknown[])=>{
        const result=await tx.query<T>(sql,params);
        if(sql.includes("UPDATE finance.settlements SET status='CONFIRMED'"))throw Object.assign(new Error("synthetic outer abort"),{code});
        return result;
      }};
      return work(port);
    })};
    await assert.rejects(()=>confirmAllocatedSettlementTestOnly(fault,"1",confirmed,account.id,capture),(error:unknown)=>typeof error==="object" && error!==null && "code" in error && error.code===code);
    assert.equal(attempts,1);
    assert.equal((await admin.query<{status:string}>("SELECT status FROM finance.settlements WHERE id=$1::bigint",[next.id])).rows[0].status,"OPEN");
    assert.equal((await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.accounts WHERE id=$1::bigint",[account.id])).rows[0].revision,beforeConfirmRevision);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE settlement_id=$1::bigint",[next.id])).rows[0].n,0);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.settlement_allocation_receipts_test_only WHERE settlement_id=$1::bigint",[next.id])).rows[0].n,0);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.requests WHERE request_id=$1::uuid",[confirmed.requestId])).rows[0].n,0);
  }
  // Two identical approvals must not attach membership or post movements twice.
  // As with the request race, only this disposable harness retries the entire
  // outer transaction after a recognized serialization/deadlock abort.
  const confirmationGate=gate();
  const firstConfirmation=confirmAllocatedSettlementTestOnly(gatedFinance(prisma,confirmationGate,"FROM finance.settlements s WHERE s.id=$1::bigint FOR UPDATE"),"1",confirmed,account.id,capture);
  await confirmationGate.entered;
  let confirmationAttempts=0;
  const duplicateConfirmation=(async()=>{for(;;) {
    try {confirmationAttempts++;return await confirmAllocatedSettlementTestOnly(db,"1",confirmed,account.id,capture);}
    catch(error) {if(confirmationAttempts<4 && isRetryableTransactionConflict(error))continue;throw error;}
  }})();
  try {await waitForLock(admin,"settlements");} finally {confirmationGate.release();}
  assert.equal((await firstConfirmation).replayed,false);
  assert.deepEqual(await duplicateConfirmation,{id:next.id,replayed:true});
  assert.ok(confirmationAttempts>=2,"the test harness must retry the entire aborted confirmation transaction");
  assert.deepEqual(await confirmAllocatedSettlementTestOnly(db,"1",confirmed,account.id,capture),{id:next.id,replayed:true});
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.collection_allocations_test_only WHERE collection_id=$1::bigint AND settlement_id=$2::bigint",[collection.id,next.id])).rows[0].n,1);
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.settlement_allocation_receipts_test_only WHERE settlement_id=$1::bigint",[next.id])).rows[0].n,1);
  assert.deepEqual((await admin.query<{kind:string;amount:string;destination:string}>("SELECT kind,amount::text AS amount,destination_id::text AS destination FROM finance.movements WHERE settlement_id=$1::bigint",[next.id])).rows,[{kind:"SETTLEMENT",amount:"8.00",destination:account.id}]);
  const later=await db.serializable(tx=>recordCustodyCollectionTestOnly(tx,419n,{...collectionInput,requestId:randomUUID(),amount:"2"}));
  assert.deepEqual(await confirmAllocatedSettlementTestOnly(db,"1",confirmed,account.id,capture),{id:next.id,replayed:true});
  await assert.rejects(()=>confirmAllocatedSettlementTestOnly(db,"1",confirmed,account.id,changedReview),/مراجعة الطلب غير موجودة أو لا تطابق/);
  assert.deepEqual(await requestAllocatedSettlementTestOnly(db,"419",alternate,account.id,requestReview),{id:next.id,replayed:true});
  await admin.query("UPDATE users SET status='SUSPENDED' WHERE id=419");
  try {await assert.rejects(()=>requestAllocatedSettlementTestOnly(db,"419",alternate,account.id,requestReview),/غير نشط/);}
  finally {await admin.query("UPDATE users SET status='ACTIVE' WHERE id=419");}
  const laterReview=await db.serializable(tx=>reviewTestPeriod(tx,account.id));
  assert.deepEqual(laterReview.collections.map(item=>item.id),[later.id]);

  // Competing *different* approval keys for the same later request: only one
  // decision may commit; the other must not be mistaken for an identical replay.
  const laterEvidence={collectionIds:[later.id],paymentIds:[],reviewedHash:laterReview.hash};
  const laterRequest=await requestAllocatedSettlementTestOnly(db,"419",{requestId:randomUUID(),accountId:account.id,expectedBalance:"8",countedAmount:"10",reason:"طلب اصطناعي ثان",actuallyCounted:true},account.id,laterEvidence);
  const winningDecision={requestId:randomUUID(),settlementId:laterRequest.id,expectedBalance:"8",transferAmount:"0",transferDirection:"TO_VAULT",reason:"قرار أول",actuallyTransferred:true};
  const losingDecision={...winningDecision,requestId:randomUUID(),reason:"قرار منافس"};
  const decisionGate=gate();
  const winnerDecision=confirmAllocatedSettlementTestOnly(gatedFinance(prisma,decisionGate,"FROM finance.settlements s WHERE s.id=$1::bigint FOR UPDATE"),"1",winningDecision,account.id,laterEvidence);
  await decisionGate.entered;
  let competingAttempts=0;
  const loserDecision=(async()=>{for(;;) {
    try {competingAttempts++;return await confirmAllocatedSettlementTestOnly(db,"1",losingDecision,account.id,laterEvidence);}
    catch(error) {if(competingAttempts<4 && isRetryableTransactionConflict(error))continue;throw error;}
  }})().then(value=>({value}),error=>({error}));
  try {await waitForLock(admin,"settlements");} finally {decisionGate.release();}
  assert.equal((await winnerDecision).replayed,false);
  const losingResult=await loserDecision;
  assert.ok("error" in losingResult);
  assert.match(String(losingResult.error),/طلب التسوية ليس مفتوحًا/);
  assert.ok(competingAttempts>=2);
  assert.deepEqual(await confirmAllocatedSettlementTestOnly(db,"1",winningDecision,account.id,laterEvidence),{id:laterRequest.id,replayed:true});
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.requests WHERE request_id=$1::uuid",[losingDecision.requestId])).rows[0].n,0);
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.settlement_allocation_receipts_test_only WHERE settlement_id=$1::bigint",[laterRequest.id])).rows[0].n,1);
  assert.deepEqual((await admin.query<{kind:string;amount:string;destination:string}>("SELECT kind,amount::text AS amount,destination_id::text AS destination FROM finance.movements WHERE settlement_id=$1::bigint",[laterRequest.id])).rows,[{kind:"SETTLEMENT",amount:"2.00",destination:account.id}]);
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.collection_allocations_test_only WHERE collection_id=$1::bigint AND settlement_id=$2::bigint",[later.id,laterRequest.id])).rows[0].n,1);

  // Cancellation and experimental confirmation contend on the same settlement
  // row. Exercise both orders, retaining the source when cancellation wins.
  const last=await db.serializable(tx=>recordCustodyCollectionTestOnly(tx,419n,{...collectionInput,requestId:randomUUID(),amount:"1"}));
  const lastReview=await db.serializable(tx=>reviewTestPeriod(tx,account.id));
  const lastEvidence={collectionIds:[last.id],paymentIds:[],reviewedHash:lastReview.hash};
  const createLastRequest=()=>requestAllocatedSettlementTestOnly(db,"419",{requestId:randomUUID(),accountId:account.id,expectedBalance:"10",countedAmount:"11",reason:"تداخل إلغاء واعتماد",actuallyCounted:true},account.id,lastEvidence);
  const cancelled=await createLastRequest();
  const cancelInput={requestId:randomUUID(),settlementId:cancelled.id,reason:"إلغاء اصطناعي"};
  const cancelledConfirm={requestId:randomUUID(),settlementId:cancelled.id,expectedBalance:"10",transferAmount:"0",transferDirection:"TO_VAULT",reason:"اعتماد منافس",actuallyTransferred:true};
  const cancelGate=gate();
  const cancellation=cancelSettlement(gatedFinance(prisma,cancelGate,"FROM finance.settlements s WHERE s.id=$1::bigint FOR UPDATE"),"419",cancelInput);
  await cancelGate.entered;
  let confirmAfterCancelAttempts=0;
  const confirmAfterCancel=(async()=>{for(;;) {
    try {confirmAfterCancelAttempts++;return await confirmAllocatedSettlementTestOnly(db,"1",cancelledConfirm,account.id,lastEvidence);}
    catch(error) {if(confirmAfterCancelAttempts<4 && isRetryableTransactionConflict(error))continue;throw error;}
  }})().then(value=>({value}),error=>({error}));
  try {await waitForLock(admin,"settlements");} finally {cancelGate.release();}
  assert.equal((await cancellation).replayed,false);
  const cancelledResult=await confirmAfterCancel;
  assert.ok("error" in cancelledResult);assert.match(String(cancelledResult.error),/طلب التسوية ليس مفتوحًا/);
  assert.ok(confirmAfterCancelAttempts>=2);
  assert.deepEqual(await cancelSettlement(db,"419",cancelInput),{id:cancelled.id,replayed:true});
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.collection_allocations_test_only WHERE collection_id=$1::bigint AND settlement_id IS NULL",[last.id])).rows[0].n,1);
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE settlement_id=$1::bigint",[cancelled.id])).rows[0].n,0);
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.settlement_allocation_receipts_test_only WHERE settlement_id=$1::bigint",[cancelled.id])).rows[0].n,0);
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.requests WHERE request_id=$1::uuid",[cancelledConfirm.requestId])).rows[0].n,0);
  const afterCancel=await createLastRequest();
  const winningConfirm={...cancelledConfirm,requestId:randomUUID(),settlementId:afterCancel.id};
  const losingCancel={...cancelInput,requestId:randomUUID(),settlementId:afterCancel.id};
  const confirmGate=gate();
  const confirmation=confirmAllocatedSettlementTestOnly(gatedFinance(prisma,confirmGate,"FROM finance.settlements s WHERE s.id=$1::bigint FOR UPDATE"),"1",winningConfirm,account.id,lastEvidence);
  await confirmGate.entered;
  const cancelAfterConfirm=cancelSettlement(db,"419",losingCancel).then(value=>({value}),error=>({error}));
  try {await waitForLock(admin,"settlements");} finally {confirmGate.release();}
  assert.equal((await confirmation).replayed,false);
  const confirmedResult=await cancelAfterConfirm;
  assert.ok("error" in confirmedResult);assert.match(String(confirmedResult.error),/طلب التسوية ليس مفتوحًا/);
  assert.deepEqual(await confirmAllocatedSettlementTestOnly(db,"1",winningConfirm,account.id,lastEvidence),{id:afterCancel.id,replayed:true});
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.requests WHERE request_id=$1::uuid",[losingCancel.requestId])).rows[0].n,0);
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.collection_allocations_test_only WHERE collection_id=$1::bigint AND settlement_id=$2::bigint",[last.id,afterCancel.id])).rows[0].n,1);
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.settlement_allocation_receipts_test_only WHERE settlement_id=$1::bigint",[afterCancel.id])).rows[0].n,1);
  assert.deepEqual((await admin.query<{kind:string;amount:string}>("SELECT kind,amount::text AS amount FROM finance.movements WHERE settlement_id=$1::bigint",[afterCancel.id])).rows,[{kind:"SETTLEMENT",amount:"1.00"}]);

  // Membership capture and the real adjustment plus a partial handover must
  // commit atomically. The signed statement is not proof of physical receipt.
  const partialCollection=await db.serializable(tx=>recordCustodyCollectionTestOnly(tx,419n,{...collectionInput,requestId:randomUUID(),amount:"3"}));
  const partialReview=await db.serializable(tx=>reviewTestPeriod(tx,account.id));
  const partialEvidence={collectionIds:[partialCollection.id],paymentIds:[],reviewedHash:partialReview.hash};
  const partialRequest=await requestAllocatedSettlementTestOnly(db,"419",{requestId:randomUUID(),accountId:account.id,expectedBalance:"11",countedAmount:"14",reason:"تحويل جزئي اصطناعي",actuallyCounted:true},account.id,partialEvidence);
  const partialConfirm={requestId:randomUUID(),settlementId:partialRequest.id,expectedBalance:"11",transferAmount:"2",transferDirection:"TO_VAULT",reason:"تحويل جزئي بعد مراجعة",actuallyTransferred:true};
  let injected=false;
  const failAfterTransfer:FinanceDatabase={serializable:work=>db.serializable(tx=>{
    const port:FinanceTransaction={...tx,query:async <T extends Record<string,unknown>>(sql:string,params?:unknown[])=>{
      const result=await tx.query<T>(sql,params);
      if(sql.includes("INSERT INTO finance.movements") && sql.includes("'TRANSFER'")) {injected=true;throw new Error("synthetic failure after partial transfer");}
      return result;
    }};
    return work(port);
  })};
  const partialBefore=(await admin.query<{custody:string;vault:string}>("SELECT a.revision::text AS custody,v.revision::text AS vault FROM finance.accounts a,finance.accounts v WHERE a.id=$1::bigint AND v.id=$2::bigint",[account.id,vault.id])).rows[0];
  await assert.rejects(()=>confirmAllocatedSettlementTestOnly(failAfterTransfer,"1",partialConfirm,account.id,partialEvidence),/synthetic failure after partial transfer/);
  assert.ok(injected);
  assert.deepEqual((await admin.query<{custody:string;vault:string}>("SELECT a.revision::text AS custody,v.revision::text AS vault FROM finance.accounts a,finance.accounts v WHERE a.id=$1::bigint AND v.id=$2::bigint",[account.id,vault.id])).rows[0],partialBefore);
  assert.equal((await admin.query<{status:string}>("SELECT status FROM finance.settlements WHERE id=$1::bigint",[partialRequest.id])).rows[0].status,"OPEN");
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE settlement_id=$1::bigint",[partialRequest.id])).rows[0].n,0);
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.settlement_allocation_receipts_test_only WHERE settlement_id=$1::bigint",[partialRequest.id])).rows[0].n,0);
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.requests WHERE request_id=$1::uuid",[partialConfirm.requestId])).rows[0].n,0);
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.collection_allocations_test_only WHERE collection_id=$1::bigint AND settlement_id IS NULL",[partialCollection.id])).rows[0].n,1);
  assert.equal((await confirmAllocatedSettlementTestOnly(db,"1",partialConfirm,account.id,partialEvidence)).replayed,false);
  const partialMovements=await admin.query<{kind:string;amount:string;source:string|null;destination:string|null}>(`SELECT kind,amount::text AS amount,source_id::text AS source,destination_id::text AS destination FROM finance.movements WHERE settlement_id=$1::bigint ORDER BY id`,[partialRequest.id]);
  assert.deepEqual(partialMovements.rows,[{kind:"SETTLEMENT",amount:"3.00",source:null,destination:account.id},{kind:"TRANSFER",amount:"2.00",source:account.id,destination:vault.id}]);
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.settlement_allocation_receipts_test_only WHERE settlement_id=$1::bigint",[partialRequest.id])).rows[0].n,1);
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.collection_allocations_test_only WHERE collection_id=$1::bigint AND settlement_id=$2::bigint",[partialCollection.id,partialRequest.id])).rows[0].n,1);
  const partialAfter=(await admin.query<{custody:string;vault:string}>("SELECT a.revision::text AS custody,v.revision::text AS vault FROM finance.accounts a,finance.accounts v WHERE a.id=$1::bigint AND v.id=$2::bigint",[account.id,vault.id])).rows[0];
  assert.deepEqual(await confirmAllocatedSettlementTestOnly(db,"1",partialConfirm,account.id,partialEvidence),{id:partialRequest.id,replayed:true});
  assert.deepEqual((await admin.query<{custody:string;vault:string}>("SELECT a.revision::text AS custody,v.revision::text AS vault FROM finance.accounts a,finance.accounts v WHERE a.id=$1::bigint AND v.id=$2::bigint",[account.id,vault.id])).rows[0],partialAfter);
  assert.deepEqual((await admin.query<{kind:string;amount:string;source:string|null;destination:string|null}>(`SELECT kind,amount::text AS amount,source_id::text AS source,destination_id::text AS destination FROM finance.movements WHERE settlement_id=$1::bigint ORDER BY id`,[partialRequest.id])).rows,partialMovements.rows);

  // A mixed period must subtract the attributed employee-cash payment as well
  // as add the collection, without posting a movement at payment time.
  const mixedExpense=await createExpense(db,"419",{requestId:randomUUID(),branchId:"419",categoryId:"1",amount:"2",expenseDate:today,description:"مصروف إسناد اصطناعي"});
  await approveExpense(db,"1",{requestId:randomUUID(),expenseId:mixedExpense.id,expectedRevision:"1"});
  const mixedPayInput={requestId:randomUUID(),expenseId:mixedExpense.id,expectedRevision:"2",method:"CASH",accountId:null,paymentDate:today,actuallyPaid:true,source:"HOLDER_CASH"};
  const mixedPayment=await payExpense(testHolderPaymentService(db,"419"),"419",mixedPayInput,today);
  assert.deepEqual(await payExpense(testHolderPaymentService(db,"419"),"419",mixedPayInput,today),{id:mixedPayment.id,replayed:true});
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE expense_payment_id=$1::bigint",[mixedPayment.id])).rows[0].n,0);
  const mixedCollection=await db.serializable(tx=>recordCustodyCollectionTestOnly(tx,419n,{...collectionInput,requestId:randomUUID(),amount:"5"}));
  const mixedReview=await db.serializable(tx=>reviewTestPeriod(tx,account.id));
  assert.deepEqual(mixedReview.collections.map(x=>[x.id,x.amount]),[[mixedCollection.id,"5.00"]]);
  assert.deepEqual(mixedReview.payments.map(x=>[x.id,x.amount]),[[mixedPayment.id,"2.00"]]);
  const mixedEvidence={collectionIds:[mixedCollection.id],paymentIds:[mixedPayment.id],reviewedHash:mixedReview.hash};
  const mixedRequest=await requestAllocatedSettlementTestOnly(db,"419",{requestId:randomUUID(),accountId:account.id,expectedBalance:"12",countedAmount:"15",reason:"تسوية بنود مختلطة",actuallyCounted:true},account.id,mixedEvidence);
  assert.deepEqual((await admin.query<{sales:string;expenses:string;expected:string;adjustment:string}>(`SELECT sales_total::text AS sales,expenses_total::text AS expenses,expected_amount::text AS expected,adjustment::text AS adjustment FROM finance.settlements WHERE id=$1::bigint`,[mixedRequest.id])).rows[0],{sales:"5.00",expenses:"2.00",expected:"15.00",adjustment:"3.00"});
  const mixedConfirm={requestId:randomUUID(),settlementId:mixedRequest.id,expectedBalance:"12",transferAmount:"0",transferDirection:"TO_VAULT",reason:"اعتماد بنود مختلطة",actuallyTransferred:true};
  await assert.rejects(()=>db.serializable(async tx=>{
    await tx.query("UPDATE finance.payments SET recorded_by=420 WHERE id=$1::bigint",[mixedPayment.id]);
    assert.deepEqual(await reviewTestPeriod(tx,account.id),mixedReview);
    const joined:FinanceDatabase={serializable:work=>work(tx)};
    await confirmAllocatedSettlementTestOnly(joined,"1",mixedConfirm,account.id,mixedEvidence);
  }),/مصدر الصرف المخصص غير متسق/);
  assert.equal((await admin.query<{status:string}>("SELECT status FROM finance.settlements WHERE id=$1::bigint",[mixedRequest.id])).rows[0].status,"OPEN");
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE settlement_id=$1::bigint",[mixedRequest.id])).rows[0].n,0);
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.settlement_allocation_receipts_test_only WHERE settlement_id=$1::bigint",[mixedRequest.id])).rows[0].n,0);
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.requests WHERE request_id=$1::uuid",[mixedConfirm.requestId])).rows[0].n,0);
  assert.equal((await confirmAllocatedSettlementTestOnly(db,"1",mixedConfirm,account.id,mixedEvidence)).replayed,false);
  assert.deepEqual(await confirmAllocatedSettlementTestOnly(db,"1",mixedConfirm,account.id,mixedEvidence),{id:mixedRequest.id,replayed:true});
  assert.deepEqual((await admin.query<{kind:string;amount:string}>("SELECT kind,amount::text AS amount FROM finance.movements WHERE settlement_id=$1::bigint",[mixedRequest.id])).rows,[{kind:"SETTLEMENT",amount:"3.00"}]);
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.collection_allocations_test_only WHERE collection_id=$1::bigint AND settlement_id=$2::bigint",[mixedCollection.id,mixedRequest.id])).rows[0].n,1);
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.holder_payment_allocations_test_only WHERE payment_id=$1::bigint AND settlement_id=$2::bigint",[mixedPayment.id,mixedRequest.id])).rows[0].n,1);
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.settlement_allocation_receipts_test_only WHERE settlement_id=$1::bigint",[mixedRequest.id])).rows[0].n,1);
  const mixedRemaining=await db.serializable(tx=>reviewTestPeriod(tx,account.id));
  assert.deepEqual(mixedRemaining.collections,[]);assert.deepEqual(mixedRemaining.payments,[]);

  // Replay checks the saved request evidence, not source history. Demonstrate
  // that a later recorder-only fixture change is invisible to replay but
  // detectable by a separate, read-only current-consistency inventory.
  const mixedAudit=()=>prisma.$transaction(async tx=>{
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    await tx.$executeRawUnsafe("SET LOCAL selahtone.cutover_period_audit_test_only='yes'");
    return auditTestOnlyReceipts(financePort(tx),account.id);
  },{isolationLevel:"Serializable",timeout:20000});
  assert.deepEqual((await mixedAudit()).reviews.find(row=>row.settlementId===mixedRequest.id)?.issues,[]);
  const revisionAfterMixed=(await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.accounts WHERE id=$1::bigint",[account.id])).rows[0].revision;
  await admin.query("UPDATE finance.payments SET recorded_by=420 WHERE id=$1::bigint",[mixedPayment.id]);
  try {
    assert.deepEqual(await confirmAllocatedSettlementTestOnly(db,"1",mixedConfirm,account.id,mixedEvidence),{id:mixedRequest.id,replayed:true});
    const changed=(await mixedAudit()).reviews.find(row=>row.settlementId===mixedRequest.id);
    assert.ok(changed);
    assert.ok(changed.issues.includes("invalid_payment_allocation"));
    assert.ok(!changed.issues.includes("snapshot_mismatch"));
    assert.equal((await admin.query<{recorder:string}>("SELECT recorded_by::text AS recorder FROM finance.payments WHERE id=$1::bigint",[mixedPayment.id])).rows[0].recorder,"420");
    assert.equal((await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.accounts WHERE id=$1::bigint",[account.id])).rows[0].revision,revisionAfterMixed);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE settlement_id=$1::bigint",[mixedRequest.id])).rows[0].n,1);
  } finally {await admin.query("UPDATE finance.payments SET recorded_by=419 WHERE id=$1::bigint",[mixedPayment.id]);}
  assert.deepEqual((await mixedAudit()).reviews.find(row=>row.settlementId===mixedRequest.id)?.issues,[]);

  // Holder-cash payment is not prohibited merely because a settlement request
  // is open. A new allocated payment must instead stale that request; after
  // cancellation, a fresh review can include it once. This is not a physical
  // ordering guarantee or a proposed policy change.
  const lateExpense=await createExpense(db,"419",{requestId:randomUUID(),branchId:"419",categoryId:"1",amount:"1",expenseDate:today,description:"صرف بعد طلب اصطناعي"});
  await approveExpense(db,"1",{requestId:randomUUID(),expenseId:lateExpense.id,expectedRevision:"1"});
  const emptyReview=await db.serializable(tx=>reviewTestPeriod(tx,account.id));
  assert.deepEqual(emptyReview.collections,[]);assert.deepEqual(emptyReview.payments,[]);
  const emptyEvidence={collectionIds:[],paymentIds:[],reviewedHash:emptyReview.hash};
  const staleRequest=await requestAllocatedSettlementTestOnly(db,"419",{requestId:randomUUID(),accountId:account.id,expectedBalance:"15",countedAmount:"15",reason:"طلب قبل صرف لاحق",actuallyCounted:true},account.id,emptyEvidence);
  const latePayInput={requestId:randomUUID(),expenseId:lateExpense.id,expectedRevision:"2",method:"CASH",accountId:null,paymentDate:today,actuallyPaid:true,source:"HOLDER_CASH"};
  const latePayment=await payExpense(testHolderPaymentService(db,"419"),"419",latePayInput,today);
  assert.deepEqual(await payExpense(testHolderPaymentService(db,"419"),"419",latePayInput,today),{id:latePayment.id,replayed:true});
  const staleConfirm={requestId:randomUUID(),settlementId:staleRequest.id,expectedBalance:"15",transferAmount:"0",transferDirection:"TO_VAULT",reason:"اعتماد مراجعة قديمة",actuallyTransferred:true};
  await assert.rejects(()=>confirmAllocatedSettlementTestOnly(db,"1",staleConfirm,account.id,emptyEvidence),/تغيّرت العهدة منذ طلب التسوية/);
  assert.equal((await admin.query<{status:string}>("SELECT status FROM finance.settlements WHERE id=$1::bigint",[staleRequest.id])).rows[0].status,"OPEN");
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.requests WHERE request_id=$1::uuid",[staleConfirm.requestId])).rows[0].n,0);
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE settlement_id=$1::bigint OR expense_payment_id=$2::bigint",[staleRequest.id,latePayment.id])).rows[0].n,0);
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.settlement_allocation_receipts_test_only WHERE settlement_id=$1::bigint",[staleRequest.id])).rows[0].n,0);
  await cancelSettlement(db,"419",{requestId:randomUUID(),settlementId:staleRequest.id,reason:"إعادة مراجعة الصرف"});
  const renewedReview=await db.serializable(tx=>reviewTestPeriod(tx,account.id));
  assert.deepEqual(renewedReview.payments.map(x=>[x.id,x.amount]),[[latePayment.id,"1.00"]]);
  const renewedEvidence={collectionIds:[],paymentIds:[latePayment.id],reviewedHash:renewedReview.hash};
  const renewedRequest=await requestAllocatedSettlementTestOnly(db,"419",{requestId:randomUUID(),accountId:account.id,expectedBalance:"15",countedAmount:"14",reason:"مراجعة الصرف اللاحق",actuallyCounted:true},account.id,renewedEvidence);
  assert.deepEqual((await admin.query<{sales:string;expenses:string;expected:string;adjustment:string}>("SELECT sales_total::text AS sales,expenses_total::text AS expenses,expected_amount::text AS expected,adjustment::text AS adjustment FROM finance.settlements WHERE id=$1::bigint",[renewedRequest.id])).rows[0],{sales:"0.00",expenses:"1.00",expected:"14.00",adjustment:"-1.00"});
  const renewedConfirm={...staleConfirm,requestId:randomUUID(),settlementId:renewedRequest.id,transferDirection:"TO_CUSTODY",reason:"اعتماد بعد إعادة المراجعة"};
  assert.equal((await confirmAllocatedSettlementTestOnly(db,"1",renewedConfirm,account.id,renewedEvidence)).replayed,false);
  assert.deepEqual(await confirmAllocatedSettlementTestOnly(db,"1",renewedConfirm,account.id,renewedEvidence),{id:renewedRequest.id,replayed:true});
  assert.deepEqual((await admin.query<{kind:string;amount:string;source:string|null;destination:string|null}>("SELECT kind,amount::text AS amount,source_id::text AS source,destination_id::text AS destination FROM finance.movements WHERE settlement_id=$1::bigint",[renewedRequest.id])).rows,[{kind:"SETTLEMENT",amount:"1.00",source:account.id,destination:null}]);
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.holder_payment_allocations_test_only WHERE payment_id=$1::bigint AND settlement_id=$2::bigint",[latePayment.id,renewedRequest.id])).rows[0].n,1);
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.settlement_allocation_receipts_test_only WHERE settlement_id=$1::bigint",[renewedRequest.id])).rows[0].n,1);

  // The test collection command locks sale then custody, whereas the test
  // settlement formula locks custody then the sale behind pending sources.
  // Deliberately form this cycle and observe whole-transaction retry, not a
  // claim that retry constitutes a complete lock-order protocol.
  const cycleSource=await db.serializable(tx=>recordCustodyCollectionTestOnly(tx,419n,{...collectionInput,requestId:randomUUID(),amount:"1"}));
  const cycleReview=await db.serializable(tx=>reviewTestPeriod(tx,account.id));
  const cycleEvidence={collectionIds:[cycleSource.id],paymentIds:[],reviewedHash:cycleReview.hash};
  const cycleRequest={requestId:randomUUID(),accountId:account.id,expectedBalance:"14",countedAmount:"15",reason:"تداخل أقفال اصطناعي",actuallyCounted:true};
  const cycleCollection={...collectionInput,requestId:randomUUID(),amount:"1"};
  const saleGate=gate(),accountGate=gate();
  let collectionRetries=0,settlementRetries=0; const cycleConflicts:unknown[]=[];
  const saleLocked=gatedFinance(prisma,saleGate,"FROM public.commerce_sales s JOIN public.branches b");
  const collectionCycle=(async()=>{for(;;){try {collectionRetries++;return await saleLocked.serializable(tx=>recordCustodyCollectionTestOnly(tx,419n,cycleCollection));}
    catch(error){if(isRetryableTransactionConflict(error) && collectionRetries<4){cycleConflicts.push(error);continue;}throw error;}
  }})().then(value=>({value}),error=>({error}));
  await saleGate.entered;
  const accountLocked=gatedFinance(prisma,accountGate);
  const settlementCycle=(async()=>{for(;;){try {settlementRetries++;return await requestAllocatedSettlementTestOnly(accountLocked,"419",cycleRequest,account.id,cycleEvidence);}
    catch(error){if(isRetryableTransactionConflict(error) && settlementRetries<4){cycleConflicts.push(error);continue;}throw error;}
  }})().then(value=>({value}),error=>({error}));
  await accountGate.entered;
  accountGate.release();
  try {await waitForLock(admin,"commerce_sales");} finally {saleGate.release();}
  const cycleCollectionResult=await collectionCycle,cycleSettlementResult=await settlementCycle;
  assert.ok(cycleConflicts.some(error=>typeof error==="object" && error!==null && "code" in error && error.code==="40P01"),`a real deadlock is expected in the selected lock cycle: collection=${collectionRetries}, settlement=${settlementRetries}, errors=${JSON.stringify(cycleConflicts)}`);
  assert.notEqual("value" in cycleCollectionResult,"value" in cycleSettlementResult);
  if ("value" in cycleCollectionResult) {
    assert.ok("error" in cycleSettlementResult);
    assert.match(String(cycleSettlementResult.error),/تغيّرت عناصر المراجعة/);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.requests WHERE request_id=$1::uuid",[cycleRequest.requestId])).rows[0].n,0);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.collection_allocations_test_only WHERE account_id=$1::bigint AND settlement_id IS NULL",[account.id])).rows[0].n,2);
  } else {
    assert.ok("error" in cycleCollectionResult && "value" in cycleSettlementResult);
    assert.match(String(cycleCollectionResult.error),/طلب جرد أو تسوية مفتوح/);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_collections WHERE request_id=$1::uuid",[cycleCollection.requestId])).rows[0].n,0);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.settlement_request_reviews_test_only WHERE settlement_id=$1::bigint",[cycleSettlementResult.value.id])).rows[0].n,1);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.collection_allocations_test_only WHERE account_id=$1::bigint AND settlement_id IS NULL",[account.id])).rows[0].n,1);
  }
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE expense_payment_id=$1::bigint",[latePayment.id])).rows[0].n,0);
}


/** Selected lock-cycle mitigation experiment, not a proposed app adapter. */
async function checkSyntheticSourceBarrier(admin:Client,prisma:PrismaClient,db:FinanceDatabase,today:string):Promise<void> {
  await admin.query(`CREATE TABLE finance.source_order_barriers_test_only(account_id bigint PRIMARY KEY REFERENCES finance.accounts(id),revision bigint NOT NULL DEFAULT 0)`);
  for(const [branch,first] of [["421","collection"],["422","settlement"]] as const) {
    await admin.query(`INSERT INTO branches(id,code,name_ar,city,phone,invoice_prefix,opening_date,is_active,created_at)
      VALUES($1::bigint,$2,'فرع حاجز مصدر اصطناعي','تجربة','000',$2,CURRENT_DATE,true,now())`,[branch,`SYN${branch}`]);
    await admin.query(`INSERT INTO users(id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT $1::bigint,$1::bigint,role_code,'موظف حاجز مصدر اصطناعي',$2,password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3`,[branch,`pg-source-barrier-${branch}@selahtone.local`]);
    const account=await openAccount(db,"1",{requestId:randomUUID(),branchId:branch,kind:"CUSTODY",holderId:branch,openingAmount:"0",openingDate:today,counted:true},today);
    await admin.query("INSERT INTO finance.source_order_barriers_test_only(account_id) VALUES($1::bigint)",[account.id]);
    const sale=(await admin.query<{id:string}>(`INSERT INTO commerce_sales(request_id,request_hash,branch_id,warehouse_id,customer_name,customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,created_by_id)
      SELECT $1::uuid,repeat('b',64),$2::bigint,warehouse_id,'حاجز مصدر اصطناعي',customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,$2::bigint FROM commerce_sales WHERE id=2 RETURNING id::text`,[randomUUID(),branch])).rows[0].id;
    const collection={requestId:randomUUID(),saleId:sale,amount:"1",method:"CASH",actuallyPaid:false};
    const original=await db.serializable(tx=>recordCustodyCollectionTestOnly(tx,BigInt(branch),collection));
    const review=await db.serializable(tx=>reviewTestPeriod(tx,account.id));
    const evidence={collectionIds:[original.id],paymentIds:[],reviewedHash:review.hash};
    const request={requestId:randomUUID(),accountId:account.id,expectedBalance:"0",countedAmount:"1",reason:"حاجز مصدر اصطناعي",actuallyCounted:true};
    const competing={...collection,requestId:randomUUID()};
    // Writes the marker before any engine authorization or replay. This is a
    // deliberately crude test wrapper, not acceptable app replay semantics.
    const wrapped=(base:FinanceDatabase):FinanceDatabase=>({serializable:work=>base.serializable(async tx=>{
      const row=await tx.query<{revision:string}>("UPDATE finance.source_order_barriers_test_only SET revision=revision+1 WHERE account_id=$1::bigint RETURNING revision::text AS revision",[account.id]);
      if(row.rows.length!==1)throw new Error("missing synthetic source barrier");
      return work(tx);
    })});
    const markerGate=gate(), conflicts:unknown[]=[];
    const retry=async <T>(work:()=>Promise<T>):Promise<T>=>{for(let attempts=1;;attempts++)try{return await work();}catch(error){if(attempts<4 && isRetryableTransactionConflict(error)){conflicts.push(error);continue;}throw error;}};
    const collect=(port:FinanceDatabase)=>retry(()=>wrapped(port).serializable(tx=>recordCustodyCollectionTestOnly(tx,BigInt(branch),competing)));
    const settle=(port:FinanceDatabase)=>retry(()=>requestAllocatedSettlementTestOnly(wrapped(port),branch,request,account.id,evidence));
    const gated=gatedFinance(prisma,markerGate,"UPDATE finance.source_order_barriers_test_only");
    const firstWork=(first==="collection"?collect(gated):settle(gated)).then(value=>({value}),error=>({error}));
    await markerGate.entered;
    const secondWork=(first==="collection"?settle(db):collect(db)).then(value=>({value}),error=>({error}));
    try {await waitForLock(admin,"source_order_barriers_test_only");} finally {markerGate.release();}
    const firstResult=await firstWork,secondResult=await secondWork;
    assert.ok("value" in firstResult);assert.ok("error" in secondResult);
    assert.ok(conflicts.length>=1,"waiting old snapshot must be retried after marker write");
    assert.ok(conflicts.every(error=>!(typeof error==="object" && error!==null && "code" in error && error.code==="40P01")));
    if(first==="collection") {
      assert.match(String(secondResult.error),/تغيّرت عناصر المراجعة/);
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.requests WHERE request_id=$1::uuid",[request.requestId])).rows[0].n,0);
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.collection_allocations_test_only WHERE account_id=$1::bigint AND settlement_id IS NULL",[account.id])).rows[0].n,2);
    } else {
      assert.match(String(secondResult.error),/طلب جرد أو تسوية مفتوح/);
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_collections WHERE request_id=$1::uuid",[competing.requestId])).rows[0].n,0);
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.settlement_request_reviews_test_only WHERE settlement_id=$1::bigint",[firstResult.value.id])).rows[0].n,1);
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.collection_allocations_test_only WHERE account_id=$1::bigint AND settlement_id IS NULL",[account.id])).rows[0].n,1);
    }
    // Explicitly expose the replay downside: this crude marker is written even
    // for a replay, so the experiment cannot be adopted unchanged.
    const before=(await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.source_order_barriers_test_only WHERE account_id=$1::bigint",[account.id])).rows[0].revision;
    const replay=first==="collection"?await collect(db):await settle(db);
    assert.deepEqual(replay,{id:firstResult.value.id,replayed:true});
    const after=(await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.source_order_barriers_test_only WHERE account_id=$1::bigint",[account.id])).rows[0].revision;
    assert.equal(BigInt(after),BigInt(before)+1n);
    await admin.query("DELETE FROM finance.source_order_barriers_test_only WHERE account_id=$1::bigint",[account.id]);
    try {
      await assert.rejects(()=>first==="collection"?collect(db):settle(db),/missing synthetic source barrier/);
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE source_id=$1::bigint OR destination_id=$1::bigint",[account.id])).rows[0].n,0);
    } finally {await admin.query("INSERT INTO finance.source_order_barriers_test_only(account_id,revision) VALUES($1::bigint,$2::bigint)",[account.id,after]);}
  }

  // Counterexample: moving the marker past replay preserves replay semantics,
  // but collection has already locked its sale. It can deadlock with a
  // settlement that holds the marker and custody while it seeks that sale.
  await admin.query(`INSERT INTO branches(id,code,name_ar,city,phone,invoice_prefix,opening_date,is_active,created_at)
    VALUES(423,'SYN423','فرع حاجز متأخر','تجربة','000','SYN423',CURRENT_DATE,true,now())`);
  await admin.query(`INSERT INTO users(id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
    SELECT 423,423,role_code,'موظف حاجز متأخر','pg-source-barrier-423@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3`);
  const account=await openAccount(db,"1",{requestId:randomUUID(),branchId:"423",kind:"CUSTODY",holderId:"423",openingAmount:"0",openingDate:today,counted:true},today);
  await admin.query("INSERT INTO finance.source_order_barriers_test_only(account_id) VALUES($1::bigint)",[account.id]);
  const sale=(await admin.query<{id:string}>(`INSERT INTO commerce_sales(request_id,request_hash,branch_id,warehouse_id,customer_name,customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,created_by_id)
    SELECT $1::uuid,repeat('b',64),423,warehouse_id,'حاجز متأخر',customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,423 FROM commerce_sales WHERE id=2 RETURNING id::text`,[randomUUID()])).rows[0].id;
  const originalInput={requestId:randomUUID(),saleId:sale,amount:"1",method:"CASH",actuallyPaid:false};
  const original=await db.serializable(tx=>recordCustodyCollectionTestOnly(tx,423n,originalInput));
  const review=await db.serializable(tx=>reviewTestPeriod(tx,account.id));
  const evidence={collectionIds:[original.id],paymentIds:[],reviewedHash:review.hash};
  const request={requestId:randomUUID(),accountId:account.id,expectedBalance:"0",countedAmount:"1",reason:"حاجز متأخر",actuallyCounted:true};
  const nextCollection={...originalInput,requestId:randomUUID()};
  const mark=async(tx:FinanceTransaction)=>{
    const rows=await tx.query<{revision:string}>("UPDATE finance.source_order_barriers_test_only SET revision=revision+1 WHERE account_id=$1::bigint RETURNING revision::text AS revision",[account.id]);
    if(rows.rows.length!==1)throw new Error("missing synthetic source barrier");
  };
  const lateSettlement=(base:FinanceDatabase):FinanceDatabase=>({serializable:work=>base.serializable(tx=>{
    let marked=false;
    const port:FinanceTransaction={...tx,query:async <T extends Record<string,unknown>>(sql:string,params?:unknown[])=>{
      if(!marked && sql.includes("FROM finance.accounts WHERE id=$1::bigint FOR UPDATE")){marked=true;await mark(tx);}
      return tx.query<T>(sql,params);
    }};
    return work(port);
  })});
  const saleGate=gate(),custodyGate=gate(),conflicts:unknown[]=[];
  const retry=async<T>(work:()=>Promise<T>):Promise<T>=>{for(let attempts=1;;attempts++)try{return await work();}catch(error){if(attempts<4 && isRetryableTransactionConflict(error)){conflicts.push(error);continue;}throw error;}};
  const collectionDb=gatedFinance(prisma,saleGate,"FROM public.commerce_sales s JOIN public.branches b");
  const collectionWork=retry(()=>collectionDb.serializable(tx=>recordCustodyCollectionTestOnly(tx,423n,nextCollection,async hookTx=>mark(hookTx)))).then(value=>({value}),error=>({error}));
  await saleGate.entered;
  const requestDb=lateSettlement(gatedFinance(prisma,custodyGate));
  const requestWork=retry(()=>requestAllocatedSettlementTestOnly(requestDb,"423",request,account.id,evidence)).then(value=>({value}),error=>({error}));
  await custodyGate.entered;
  saleGate.release();
  try {await waitForLock(admin,"source_order_barriers_test_only");} finally {custodyGate.release();}
  const collected=await collectionWork,requested=await requestWork;
  assert.ok(conflicts.some(error=>typeof error==="object" && error!==null && "code" in error && error.code==="40P01"),"late marker does not remove the actual deadlock");
  assert.notEqual("value" in collected,"value" in requested);
  if("value" in collected) {assert.ok("error" in requested);assert.match(String(requested.error),/تغيّرت عناصر المراجعة/);}
  else {assert.ok("error" in collected && "value" in requested);assert.match(String(collected.error),/طلب جرد أو تسوية مفتوح/);}
  const markerBefore=(await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.source_order_barriers_test_only WHERE account_id=$1::bigint",[account.id])).rows[0].revision;
  const replay="value" in collected
    ? await db.serializable(tx=>recordCustodyCollectionTestOnly(tx,423n,nextCollection,async hookTx=>mark(hookTx)))
    : await requestAllocatedSettlementTestOnly(lateSettlement(db),"423",request,account.id,evidence);
  assert.equal(replay.replayed,true);
  assert.equal((await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.source_order_barriers_test_only WHERE account_id=$1::bigint",[account.id])).rows[0].revision,markerBefore);

  for(const [branch,first] of [["424","collection"],["425","settlement"]] as const) {
    await admin.query(`INSERT INTO branches(id,code,name_ar,city,phone,invoice_prefix,opening_date,is_active,created_at)
      VALUES($1::bigint,$2,'فرع فحص سابق اصطناعي','تجربة','000',$2,CURRENT_DATE,true,now())`,[branch,`SYN${branch}`]);
    await admin.query(`INSERT INTO users(id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT $1::bigint,$1::bigint,role_code,'موظف فحص سابق اصطناعي',$2,password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3`,[branch,`pg-early-barrier-${branch}@selahtone.local`]);
    const custody=await openAccount(db,"1",{requestId:randomUUID(),branchId:branch,kind:"CUSTODY",holderId:branch,openingAmount:"0",openingDate:today,counted:true},today);
    await admin.query("INSERT INTO finance.source_order_barriers_test_only(account_id) VALUES($1::bigint)",[custody.id]);
    const invoice=(await admin.query<{id:string}>(`INSERT INTO commerce_sales(request_id,request_hash,branch_id,warehouse_id,customer_name,customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,created_by_id)
      SELECT $1::uuid,repeat('b',64),$2::bigint,warehouse_id,'فحص سابق اصطناعي',customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,$2::bigint FROM commerce_sales WHERE id=2 RETURNING id::text`,[randomUUID(),branch])).rows[0].id;
    const input={requestId:randomUUID(),saleId:invoice,amount:"1",method:"CASH",actuallyPaid:false};
    const seed=await collectEarlyBarrierTestOnly(db,BigInt(branch),custody.id,input);
    const preview=await db.serializable(tx=>reviewTestPeriod(tx,custody.id));
    const reviewInput={collectionIds:[seed.id],paymentIds:[],reviewedHash:preview.hash};
    const reqInput={requestId:randomUUID(),accountId:custody.id,expectedBalance:"0",countedAmount:"1",reason:"فحص سابق اصطناعي",actuallyCounted:true};
    const nextInput={...input,requestId:randomUUID()};
    const earlyGate=gate(),earlyConflicts:unknown[]=[];
    const retryEarly=async<T>(work:()=>Promise<T>):Promise<T>=>{for(let attempts=1;;attempts++)try{return await work();}catch(error){if(attempts<4 && isRetryableTransactionConflict(error)){earlyConflicts.push(error);continue;}throw error;}};
    const collectEarly=(port:FinanceDatabase)=>retryEarly(()=>collectEarlyBarrierTestOnly(port,BigInt(branch),custody.id,nextInput));
    const requestEarly=(port:FinanceDatabase)=>retryEarly(()=>settlementEarlyBarrierTestOnly(port,branch,reqInput,reviewInput));
    const gatedEarly=gatedFinance(prisma,earlyGate,"UPDATE finance.source_order_barriers_test_only");
    const firstOp=(first==="collection"?collectEarly(gatedEarly):requestEarly(gatedEarly)).then(value=>({value}),error=>({error}));
    await earlyGate.entered;
    const secondOp=(first==="collection"?requestEarly(db):collectEarly(db)).then(value=>({value}),error=>({error}));
    try {await waitForLock(admin,"source_order_barriers_test_only");} finally {earlyGate.release();}
    const won=await firstOp,lost=await secondOp;
    assert.ok("value" in won && "error" in lost);
    assert.match(String(lost.error),first==="collection"?/تغيّرت عناصر المراجعة/:/طلب جرد أو تسوية مفتوح/);
    assert.ok(earlyConflicts.length>=1);
    assert.ok(earlyConflicts.every(error=>!(typeof error==="object" && error!==null && "code" in error && error.code==="40P01")));
    const before=(await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.source_order_barriers_test_only WHERE account_id=$1::bigint",[custody.id])).rows[0].revision;
    // Replay remains authorized and must not wait on a held marker row.
    await admin.query("BEGIN");await admin.query("UPDATE finance.source_order_barriers_test_only SET revision=revision+1 WHERE account_id=$1::bigint",[custody.id]);
    try {
      const replay=await Promise.race([first==="collection"?collectEarly(db):requestEarly(db),new Promise<never>((_,reject)=>{const timer=setTimeout(()=>reject(new Error("early replay waited on marker")),5000);timer.unref();})]);
      assert.deepEqual(replay,{id:won.value.id,replayed:true});
    } finally {await admin.query("ROLLBACK");}
    assert.equal((await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.source_order_barriers_test_only WHERE account_id=$1::bigint",[custody.id])).rows[0].revision,before);
    if(first==="collection") {
      const wrongInput={...input,requestId:randomUUID()};
      const otherBefore=(await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.source_order_barriers_test_only WHERE account_id=$1::bigint",[account.id])).rows[0].revision;
      await assert.rejects(()=>collectEarlyBarrierTestOnly(db,BigInt(branch),account.id,wrongInput),/العهدة لا تطابق الحاجز/);
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_collections WHERE request_id=$1::uuid",[wrongInput.requestId])).rows[0].n,0);
      assert.equal((await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.source_order_barriers_test_only WHERE account_id=$1::bigint",[account.id])).rows[0].revision,otherBefore);
      await assert.rejects(()=>collectEarlyBarrierTestOnly(db,BigInt(branch),custody.id,{...nextInput,amount:"2"}),/بيانات مختلفة/);
    } else {
      await assert.rejects(()=>settlementEarlyBarrierTestOnly(db,branch,{...reqInput,countedAmount:"2"},reviewInput),/بيانات مختلفة/);
    }
    await admin.query("UPDATE users SET status='SUSPENDED' WHERE id=$1::bigint",[branch]);
    try {await assert.rejects(()=>first==="collection"?collectEarly(db):requestEarly(db),/غير مخوّل|غير نشط/);}
    finally {await admin.query("UPDATE users SET status='ACTIVE' WHERE id=$1::bigint",[branch]);}
    await admin.query("DELETE FROM finance.source_order_barriers_test_only WHERE account_id=$1::bigint",[custody.id]);
    try {
      assert.deepEqual(first==="collection"?await collectEarly(db):await requestEarly(db),{id:won.value.id,replayed:true});
      await assert.rejects(()=>collectEarlyBarrierTestOnly(db,BigInt(branch),custody.id,{...input,requestId:randomUUID()}),/حاجز المصدر غير متاح/);
    } finally {await admin.query("INSERT INTO finance.source_order_barriers_test_only(account_id,revision) VALUES($1::bigint,$2::bigint)",[custody.id,before]);}
  }

  // Different account markers do not serialize a shared idempotency key.
  // Concurrent SERIALIZABLE preflight reads can abort one contender before
  // it receives a uniqueness error. A fresh transaction must still recheck
  // the request identity and authorization.
  const cross=(await admin.query<{branch:string;account:string;invoice:string}>(`SELECT a.branch_id::text AS branch,a.id::text AS account,
    (SELECT s.id::text FROM commerce_sales s WHERE s.branch_id=a.branch_id ORDER BY s.id DESC LIMIT 1) AS invoice
    FROM finance.accounts a WHERE a.kind='CUSTODY' AND a.holder_id IN (424,425) ORDER BY a.holder_id`)).rows;
  assert.equal(cross.length,2);
  const shared=randomUUID();
  const aInput={requestId:shared,saleId:cross[0].invoice,amount:"1",method:"CASH",actuallyPaid:false};
  const bInput={...aInput,saleId:cross[1].invoice};
  const beforeCross=(await admin.query<{marker:string;saleRevision:string}>(`SELECT m.revision::text AS marker,s.revision::text AS "saleRevision" FROM finance.source_order_barriers_test_only m,commerce_sales s WHERE m.account_id=$1::bigint AND s.id=$2::bigint`,[cross[1].account,cross[1].invoice])).rows[0];
  const insertGate=gate();
  const firstCross=collectEarlyBarrierTestOnly(gatedFinance(prisma,insertGate,"INSERT INTO public.commerce_collections"),424n,cross[0].account,aInput);
  await insertGate.entered;
  const secondCross=collectEarlyBarrierTestOnly(db,425n,cross[1].account,bInput).then(value=>({value}),error=>({error}));
  try {await waitForLock(admin,"commerce_collections");} finally {insertGate.release();}
  const savedCross=await firstCross;
  const conflictCross=await secondCross;
  assert.ok("error" in conflictCross);
  assert.ok(isRetryableTransactionConflict(conflictCross.error) || (typeof conflictCross.error==="object" && conflictCross.error!==null && "code" in conflictCross.error && conflictCross.error.code==="23505"),`expected transaction or uniqueness conflict, got ${String(conflictCross.error)}`);
  assert.deepEqual((await admin.query<{marker:string;saleRevision:string}>(`SELECT m.revision::text AS marker,s.revision::text AS "saleRevision" FROM finance.source_order_barriers_test_only m,commerce_sales s WHERE m.account_id=$1::bigint AND s.id=$2::bigint`,[cross[1].account,cross[1].invoice])).rows[0],beforeCross);
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_collections WHERE request_id=$1::uuid",[shared])).rows[0].n,1);
  await assert.rejects(()=>collectEarlyBarrierTestOnly(db,425n,cross[1].account,bInput),/بيانات مختلفة/);
  assert.deepEqual(await collectEarlyBarrierTestOnly(db,424n,cross[0].account,aInput),{id:savedCross.id,replayed:true});

  // READ COMMITTED is intentionally used solely to characterize the unique
  // index conflict; it is not the isolation level of the finance application.
  const readCommitted:FinanceDatabase={serializable:work=>prisma.$transaction(tx=>work(financePort(tx)),{isolationLevel:"ReadCommitted",timeout:20000})};
  const uniqueInput={...aInput,requestId:randomUUID()},uniqueOther={...bInput,requestId:uniqueInput.requestId};
  const beforeUnique=(await admin.query<{marker:string;saleRevision:string}>(`SELECT m.revision::text AS marker,s.revision::text AS "saleRevision" FROM finance.source_order_barriers_test_only m,commerce_sales s WHERE m.account_id=$1::bigint AND s.id=$2::bigint`,[cross[1].account,cross[1].invoice])).rows[0];
  const uniqueGate=gate();let uniquePaused=false;
  const delayedReadCommitted:FinanceDatabase={serializable:work=>readCommitted.serializable(tx=>{
    const port:FinanceTransaction={...tx,query:async<T extends Record<string,unknown>>(sql:string,params?:unknown[])=>{
      const result=await tx.query<T>(sql,params);
      if(!uniquePaused && sql.includes("INSERT INTO public.commerce_collections")){uniquePaused=true;uniqueGate.signal();await uniqueGate.wait;}
      return result;
    }};
    return work(port);
  })};
  const uniqueWinner=collectEarlyBarrierTestOnly(delayedReadCommitted,424n,cross[0].account,uniqueInput);
  await uniqueGate.entered;
  const uniqueLoser=collectEarlyBarrierTestOnly(readCommitted,425n,cross[1].account,uniqueOther).then(value=>({value}),error=>({error}));
  try {await waitForLock(admin,"commerce_collections");} finally {uniqueGate.release();}
  const uniqueSaved=await uniqueWinner, uniqueResult=await uniqueLoser;
  assert.ok("error" in uniqueResult);
  assert.ok(typeof uniqueResult.error==="object" && uniqueResult.error!==null && "code" in uniqueResult.error && uniqueResult.error.code==="23505",`expected SQLSTATE 23505, got ${String(uniqueResult.error)}`);
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_collections WHERE request_id=$1::uuid",[uniqueInput.requestId])).rows[0].n,1);
  assert.deepEqual((await admin.query<{marker:string;saleRevision:string}>(`SELECT m.revision::text AS marker,s.revision::text AS "saleRevision" FROM finance.source_order_barriers_test_only m,commerce_sales s WHERE m.account_id=$1::bigint AND s.id=$2::bigint`,[cross[1].account,cross[1].invoice])).rows[0],beforeUnique);
  await admin.query("UPDATE users SET status='SUSPENDED' WHERE id=425");
  try {await assert.rejects(()=>collectEarlyBarrierTestOnly(readCommitted,425n,cross[1].account,uniqueOther),/غير مخوّل/);}
  finally {await admin.query("UPDATE users SET status='ACTIVE' WHERE id=425");}
  await assert.rejects(()=>collectEarlyBarrierTestOnly(readCommitted,425n,cross[1].account,uniqueOther),/بيانات مختلفة/);
  assert.deepEqual(await collectEarlyBarrierTestOnly(readCommitted,424n,cross[0].account,uniqueInput),{id:uniqueSaved.id,replayed:true});

  // An unwrapped writer can bypass the early marker. Re-form the actual
  // invoice/account lock cycle against the supposedly coordinated settlement.
  const unguardedReview=await db.serializable(tx=>reviewTestPeriod(tx,cross[0].account));
  assert.ok(unguardedReview.collections.every(item=>item.amount==="1.00"));
  const unguardedEvidence={collectionIds:unguardedReview.collections.map(item=>item.id),paymentIds:[],reviewedHash:unguardedReview.hash};
  const unguardedRequest={requestId:randomUUID(),accountId:cross[0].account,expectedBalance:"0",countedAmount:String(unguardedReview.collections.length),reason:"كاتب يتجاوز الحاجز",actuallyCounted:true};
  const unguardedInput={...aInput,requestId:randomUUID()};
  const bypassSaleGate=gate(),guardedAccountGate=gate(),bypassConflicts:unknown[]=[];
  const retryBypass=async<T>(work:()=>Promise<T>):Promise<T>=>{for(let attempts=1;;attempts++)try{return await work();}catch(error){if(attempts<4 && isRetryableTransactionConflict(error)){bypassConflicts.push(error);continue;}throw error;}};
  const unguardedDb=gatedFinance(prisma,bypassSaleGate,"FROM public.commerce_sales s JOIN public.branches b");
  const bypassWriter=retryBypass(()=>unguardedDb.serializable(tx=>recordCustodyCollectionTestOnly(tx,424n,unguardedInput))).then(value=>({value}),error=>({error}));
  await bypassSaleGate.entered;
  const guardedDb=gatedFinance(prisma,guardedAccountGate);
  const guardedRequest=retryBypass(()=>settlementEarlyBarrierTestOnly(guardedDb,"424",unguardedRequest,unguardedEvidence)).then(value=>({value}),error=>({error}));
  await guardedAccountGate.entered;
  guardedAccountGate.release();
  try {await waitForLock(admin,"commerce_sales");} finally {bypassSaleGate.release();}
  const bypassResult=await bypassWriter,guardedResult=await guardedRequest;
  assert.ok(bypassConflicts.some(error=>typeof error==="object" && error!==null && "code" in error && error.code==="40P01"),"a nonparticipant defeats the synthetic lock barrier");
  assert.notEqual("value" in bypassResult,"value" in guardedResult);
  if("value" in bypassResult) {
    assert.ok("error" in guardedResult);assert.match(String(guardedResult.error),/تغيّرت عناصر المراجعة/);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.requests WHERE request_id=$1::uuid",[unguardedRequest.requestId])).rows[0].n,0);
  } else {
    assert.ok("error" in bypassResult && "value" in guardedResult);assert.match(String(bypassResult.error),/طلب جرد أو تسوية مفتوح/);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_collections WHERE request_id=$1::uuid",[unguardedInput.requestId])).rows[0].n,0);
  }
}

/** Wrong marker identity may create lock cycles before the late scope check. */
async function checkWrongSyntheticMarkerCycle(admin:Client,prisma:PrismaClient,db:FinanceDatabase,today:string):Promise<void> {
  const ids:string[]=[];
  for(const branch of ["432","433"]) {
    await admin.query(`INSERT INTO branches(id,code,name_ar,city,phone,invoice_prefix,opening_date,is_active,created_at)
      VALUES($1::bigint,$2,'فرع حاجز خاطئ اصطناعي','تجربة','000',$2,CURRENT_DATE,true,now())`,[branch,`SYN${branch}`]);
    await admin.query(`INSERT INTO users(id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT $1::bigint,$1::bigint,role_code,'موظف حاجز خاطئ',$2,password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3`,[branch,`pg-wrong-barrier-${branch}@selahtone.local`]);
    const account=await openAccount(db,"1",{requestId:randomUUID(),branchId:branch,kind:"CUSTODY",holderId:branch,openingAmount:"0",openingDate:today,counted:true},today);
    ids.push(account.id);
    await admin.query("INSERT INTO finance.source_order_barriers_test_only(account_id) VALUES($1::bigint)",[account.id]);
  }
  const sale=(await admin.query<{id:string}>(`INSERT INTO commerce_sales(request_id,request_hash,branch_id,warehouse_id,customer_name,customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,created_by_id)
    SELECT $1::uuid,repeat('a',64),432,warehouse_id,'حاجز غير مطابق',customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,432 FROM commerce_sales WHERE id=2 RETURNING id::text`,[randomUUID()])).rows[0].id;
  const input={requestId:randomUUID(),saleId:sale,amount:"1",method:"CASH",actuallyPaid:false};
  const original=await collectEarlyBarrierTestOnly(db,432n,ids[0],input);
  const review=await db.serializable(tx=>reviewTestPeriod(tx,ids[0]));
  const evidence={collectionIds:[original.id],paymentIds:[],reviewedHash:review.hash};
  const request={requestId:randomUUID(),accountId:ids[0],expectedBalance:"0",countedAmount:"1",reason:"اختبار حاجز غير مطابق",actuallyCounted:true};
  const wrong={...input,requestId:randomUUID()};
  const before=(await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.source_order_barriers_test_only WHERE account_id=$1::bigint",[ids[1]])).rows[0].revision;
  const saleGate=gate(),accountGate=gate(),conflicts:unknown[]=[];
  const retry=async<T>(work:()=>Promise<T>):Promise<T>=>{for(let attempts=1;;attempts++)try{return await work();}catch(error){if(attempts<4 && isRetryableTransactionConflict(error)){conflicts.push(error);continue;}throw error;}};
  const wrongPort=gatedFinance(prisma,saleGate,"FROM public.commerce_sales s JOIN public.branches b");
  const wrongWriter=retry(()=>collectEarlyBarrierTestOnly(wrongPort,432n,ids[1],wrong)).then(value=>({value}),error=>({error}));
  await saleGate.entered;
  const requestPort=gatedFinance(prisma,accountGate);
  const settlement=retry(()=>settlementEarlyBarrierTestOnly(requestPort,"432",request,evidence)).then(value=>({value}),error=>({error}));
  await accountGate.entered;
  accountGate.release();
  try {await waitForLock(admin,"commerce_sales");} finally {saleGate.release();}
  const failed=await wrongWriter,saved=await settlement;
  assert.ok(conflicts.some(error=>typeof error==="object" && error!==null && "code" in error && error.code==="40P01"));
  assert.ok("error" in failed && "value" in saved);
  assert.match(String(failed.error),/العهدة لا تطابق الحاجز|طلب جرد أو تسوية مفتوح/);
  assert.equal((await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.source_order_barriers_test_only WHERE account_id=$1::bigint",[ids[1]])).rows[0].revision,before);
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_collections WHERE request_id=$1::uuid",[wrong.requestId])).rows[0].n,0);
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.settlement_request_reviews_test_only WHERE settlement_id=$1::bigint",[saved.value.id])).rows[0].n,1);
  assert.deepEqual(await settlementEarlyBarrierTestOnly(db,"432",request,evidence),{id:saved.value.id,replayed:true});
}

/** Coarse branch marker avoids an externally supplied custody marker key. */
async function checkSyntheticBranchBarrier(admin:Client,prisma:PrismaClient,db:FinanceDatabase,today:string):Promise<void> {
  await admin.query("CREATE TABLE finance.branch_source_barriers_test_only(branch_id bigint PRIMARY KEY REFERENCES public.branches(id),revision bigint NOT NULL DEFAULT 0)");
  for(const [branch,first] of [["434","collection"],["435","settlement"]] as const) {
    await admin.query(`INSERT INTO branches(id,code,name_ar,city,phone,invoice_prefix,opening_date,is_active,created_at)
      VALUES($1::bigint,$2,'فرع حاجز عام اصطناعي','تجربة','000',$2,CURRENT_DATE,true,now())`,[branch,`SYN${branch}`]);
    await admin.query(`INSERT INTO users(id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT $1::bigint,$1::bigint,role_code,'موظف حاجز فرع',$2,password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3`,[branch,`pg-branch-marker-${branch}@selahtone.local`]);
    const account=await openAccount(db,"1",{requestId:randomUUID(),branchId:branch,kind:"CUSTODY",holderId:branch,openingAmount:"0",openingDate:today,counted:true},today);
    await admin.query("INSERT INTO finance.branch_source_barriers_test_only(branch_id) VALUES($1::bigint)",[branch]);
    const sale=(await admin.query<{id:string}>(`INSERT INTO commerce_sales(request_id,request_hash,branch_id,warehouse_id,customer_name,customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,created_by_id)
      SELECT $1::uuid,repeat('b',64),$2::bigint,warehouse_id,'حاجز فرع',customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,$2::bigint FROM commerce_sales WHERE id=2 RETURNING id::text`,[randomUUID(),branch])).rows[0].id;
    const seedInput={requestId:randomUUID(),saleId:sale,amount:"1",method:"CASH",actuallyPaid:false};
    const seed=await branchCollectionTestOnly(db,BigInt(branch),seedInput);
    const preview=await db.serializable(tx=>reviewTestPeriod(tx,account.id));
    const evidence={collectionIds:[seed.id],paymentIds:[],reviewedHash:preview.hash};
    const request={requestId:randomUUID(),accountId:account.id,expectedBalance:"0",countedAmount:"1",reason:"حاجز فرع اصطناعي",actuallyCounted:true};
    const next={...seedInput,requestId:randomUUID()};
    const g=gate(),conflicts:unknown[]=[];
    const retry=async<T>(work:()=>Promise<T>):Promise<T>=>{for(let attempts=1;;attempts++)try{return await work();}catch(error){if(attempts<4 && isRetryableTransactionConflict(error)){conflicts.push(error);continue;}throw error;}};
    const collect=(port:FinanceDatabase)=>retry(()=>branchCollectionTestOnly(port,BigInt(branch),next));
    const settle=(port:FinanceDatabase)=>retry(()=>branchSettlementTestOnly(port,branch,request,evidence));
    const gated=gatedFinance(prisma,g,"UPDATE finance.branch_source_barriers_test_only");
    const firstOp=(first==="collection"?collect(gated):settle(gated)).then(value=>({value}),error=>({error}));
    await g.entered;
    const secondOp=(first==="collection"?settle(db):collect(db)).then(value=>({value}),error=>({error}));
    try {await waitForLock(admin,"branch_source_barriers_test_only");} finally {g.release();}
    const won=await firstOp,lost=await secondOp;
    assert.ok("value" in won && "error" in lost);
    assert.match(String(lost.error),first==="collection"?/تغيّرت عناصر المراجعة/:/طلب جرد أو تسوية مفتوح/);
    assert.ok(conflicts.length>=1);
    assert.ok(conflicts.every(error=>!(typeof error==="object" && error!==null && "code" in error && error.code==="40P01")));
    const before=(await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.branch_source_barriers_test_only WHERE branch_id=$1::bigint",[branch])).rows[0].revision;
    await admin.query("BEGIN");await admin.query("UPDATE finance.branch_source_barriers_test_only SET revision=revision+1 WHERE branch_id=$1::bigint",[branch]);
    try {
      const replay=await Promise.race([first==="collection"?collect(db):settle(db),new Promise<never>((_,reject)=>{const timer=setTimeout(()=>reject(new Error("branch replay waited on marker")),5000);timer.unref();})]);
      assert.deepEqual(replay,{id:won.value.id,replayed:true});
    } finally {await admin.query("ROLLBACK");}
    assert.equal((await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.branch_source_barriers_test_only WHERE branch_id=$1::bigint",[branch])).rows[0].revision,before);
    await admin.query("DELETE FROM finance.branch_source_barriers_test_only WHERE branch_id=$1::bigint",[branch]);
    try {
      assert.deepEqual(first==="collection"?await collect(db):await settle(db),{id:won.value.id,replayed:true});
      await assert.rejects(()=>branchCollectionTestOnly(db,BigInt(branch),{...seedInput,requestId:randomUUID()}),/حاجز الفرع غير متاح/);
    } finally {await admin.query("INSERT INTO finance.branch_source_barriers_test_only(branch_id,revision) VALUES($1::bigint,$2::bigint)",[branch,before]);}
  }
  // A direct writer moves the invoice after the unlocked branch hint. The
  // experiment must not commit under the stale branch marker or old actor scope.
  const sale=(await admin.query<{id:string}>(`INSERT INTO commerce_sales(request_id,request_hash,branch_id,warehouse_id,customer_name,customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,created_by_id)
    SELECT $1::uuid,repeat('b',64),434,warehouse_id,'تغيير فرع اصطناعي',customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,434 FROM commerce_sales WHERE id=2 RETURNING id::text`,[randomUUID()])).rows[0].id;
  const input={requestId:randomUUID(),saleId:sale,amount:"1",method:"CASH",actuallyPaid:false};
  const before=(await admin.query<{branch:string;revision:string}>("SELECT branch_id::text AS branch,revision::text AS revision FROM finance.branch_source_barriers_test_only WHERE branch_id IN (434,435) ORDER BY branch_id")).rows;
  const hintGate=gate();let attempts=0;
  const gated=gatedFinance(prisma,hintGate,"SELECT branch_id::text AS branch FROM public.commerce_sales WHERE id=$1::bigint");
  const pending=(async()=>{for(;;)try{attempts++;return await branchCollectionTestOnly(gated,434n,input);}catch(error){if(attempts<4 && isRetryableTransactionConflict(error))continue;throw error;}})().then(value=>({value}),error=>({error}));
  await hintGate.entered;
  try {await admin.query("UPDATE commerce_sales SET branch_id=435 WHERE id=$1::bigint",[sale]);} finally {hintGate.release();}
  try {
    const result=await pending;assert.ok("error" in result);assert.match(String(result.error),/غير مخوّل/);assert.ok(attempts>=2);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_collections WHERE request_id=$1::uuid",[input.requestId])).rows[0].n,0);
    assert.deepEqual((await admin.query<{branch:string;revision:string}>("SELECT branch_id::text AS branch,revision::text AS revision FROM finance.branch_source_barriers_test_only WHERE branch_id IN (434,435) ORDER BY branch_id")).rows,before);
  } finally {await admin.query("UPDATE commerce_sales SET branch_id=434 WHERE id=$1::bigint",[sale]);}

  // A branch marker also serializes independent custodies. In this chosen
  // interleaving another branch should not need that same marker.
  await admin.query(`INSERT INTO branches(id,code,name_ar,city,phone,invoice_prefix,opening_date,is_active,created_at)
    VALUES(436,'SYN436','فرع مستقل اصطناعي','تجربة','000','SYN436',CURRENT_DATE,true,now())`);
  await admin.query(`INSERT INTO users(id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
    SELECT v.id,v.branch_id,role_code,'موظف مستقل',v.email,password_hash,'ACTIVE',false,'FULL',false,now()
      FROM users CROSS JOIN (VALUES (437,434,'pg-branch-second-437@selahtone.local'),(436,436,'pg-branch-independent-436@selahtone.local')) v(id,branch_id,email) WHERE users.id=3`);
  const secondAccount=await openAccount(db,"1",{requestId:randomUUID(),branchId:"434",kind:"CUSTODY",holderId:"437",openingAmount:"0",openingDate:today,counted:true},today);
  const otherAccount=await openAccount(db,"1",{requestId:randomUUID(),branchId:"436",kind:"CUSTODY",holderId:"436",openingAmount:"0",openingDate:today,counted:true},today);
  await admin.query("INSERT INTO finance.branch_source_barriers_test_only(branch_id) VALUES (436)");
  const makeInvoice=async(branch:string,actor:string)=>(await admin.query<{id:string}>(`INSERT INTO commerce_sales(request_id,request_hash,branch_id,warehouse_id,customer_name,customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,created_by_id)
    SELECT $1::uuid,repeat('b',64),$2::bigint,warehouse_id,'عهدة مستقلة اصطناعية',customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,$3::bigint FROM commerce_sales WHERE id=2 RETURNING id::text`,[randomUUID(),branch,actor])).rows[0].id;
  const firstInvoice=await makeInvoice("434","434"),secondInvoice=await makeInvoice("434","437"),otherInvoice=await makeInvoice("436","436");
  const firstInput={requestId:randomUUID(),saleId:firstInvoice,amount:"1",method:"CASH",actuallyPaid:false};
  const secondInput={...firstInput,requestId:randomUUID(),saleId:secondInvoice};
  const otherInput={...firstInput,requestId:randomUUID(),saleId:otherInvoice};
  const coarsenessGate=gate();let firstAttempts=0;
  const firstPort=gatedFinance(prisma,coarsenessGate,"UPDATE finance.branch_source_barriers_test_only");
  const firstCollection=(async()=>{for(;;)try{firstAttempts++;return await branchCollectionTestOnly(firstPort,434n,firstInput);}catch(error){if(firstAttempts<4 && isRetryableTransactionConflict(error))continue;throw error;}})().then(value=>({value}),error=>({error}));
  await coarsenessGate.entered;
  let secondAttempts=0;
  const secondCollection=(async()=>{for(;;)try{secondAttempts++;return await branchCollectionTestOnly(db,437n,secondInput);}catch(error){if(secondAttempts<4 && isRetryableTransactionConflict(error))continue;throw error;}})().then(value=>({value}),error=>({error}));
  try {
    await waitForLock(admin,"branch_source_barriers_test_only");
    const independent=await Promise.race([branchCollectionTestOnly(db,436n,otherInput),new Promise<never>((_,reject)=>{const timer=setTimeout(()=>reject(new Error("independent branch waited on marker")),5000);timer.unref();})]).catch(async error=>{const active=await admin.query("SELECT wait_event_type,wait_event,query FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()");throw new Error(`independent collection failed: ${String(error)} ${JSON.stringify(active.rows)}`);});
    assert.equal(independent.replayed,false);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.collection_allocations_test_only WHERE collection_id=$1::bigint AND account_id=$2::bigint AND settlement_id IS NULL",[independent.id,otherAccount.id])).rows[0].n,1);
  } finally {coarsenessGate.release();}
  const firstSaved=await firstCollection,secondSaved=await secondCollection;
  assert.ok("value" in firstSaved && "value" in secondSaved,JSON.stringify({firstSaved,secondSaved}));
  assert.equal(firstSaved.value.replayed,false);assert.equal(secondSaved.value.replayed,false);assert.ok(firstAttempts+secondAttempts>=3);
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.collection_allocations_test_only WHERE collection_id=$1::bigint AND account_id=$2::bigint AND settlement_id IS NULL",[secondSaved.value.id,secondAccount.id])).rows[0].n,1);
  assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE source_id IN ($1::bigint,$2::bigint) OR destination_id IN ($1::bigint,$2::bigint)",[secondAccount.id,otherAccount.id])).rows[0].n,0);
}

/** The branch marker is a routing experiment, not a production integration. */
async function checkBranchRoutingOpening(admin:Client,prisma:PrismaClient,db:FinanceDatabase,today:string):Promise<void> {
  for(const [branch,first] of [["438","open"],["439","collection"]] as const) {
    await admin.query(`INSERT INTO branches(id,code,name_ar,city,phone,invoice_prefix,opening_date,is_active,created_at)
      VALUES($1::bigint,$2,'فرع توجيه اصطناعي','تجربة','000',$2,CURRENT_DATE,true,now())`,[branch,`SYN${branch}`]);
    await admin.query(`INSERT INTO users(id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT $1::bigint,$1::bigint,role_code,'مدير توجيه اصطناعي',$2,password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=1`,[branch,`pg-branch-routing-${branch}@selahtone.local`]);
    const vault=await openAccount(db,"1",{requestId:randomUUID(),branchId:branch,kind:"VAULT",holderId:null,openingAmount:"0",openingDate:today,counted:true},today);
    await admin.query("INSERT INTO finance.branch_source_barriers_test_only(branch_id) VALUES($1::bigint)",[branch]);
    const sale=(await admin.query<{id:string}>(`INSERT INTO commerce_sales(request_id,request_hash,branch_id,warehouse_id,customer_name,customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,created_by_id)
      SELECT $1::uuid,repeat('a',64),$2::bigint,warehouse_id,'توجيه فرع اصطناعي',customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,$2::bigint FROM commerce_sales WHERE id=2 RETURNING id::text`,[randomUUID(),branch])).rows[0].id;
    const openInput={requestId:randomUUID(),branchId:branch,kind:"CUSTODY" as const,holderId:branch,openingAmount:"0",openingDate:today,counted:true};
    const vaultInput={requestId:randomUUID(),saleId:sale,amount:"1",method:"CASH",actuallyPaid:false,vaultReceived:true};
    const g=gate(),conflicts:unknown[]=[];
    const retry=async<T>(work:()=>Promise<T>):Promise<T>=>{for(let attempts=1;;attempts++)try{return await work();}catch(error){if(attempts<4 && isRetryableTransactionConflict(error)){conflicts.push(error);continue;}throw error;}};
    const opening=(port:FinanceDatabase)=>retry(()=>branchOpenCustodyTestOnly(port,"1",openInput,today));
    const collecting=(port:FinanceDatabase)=>retry(()=>branchVaultCollectionTestOnly(port,BigInt(branch),vaultInput));
    const gatePort=gatedFinance(prisma,g,"UPDATE finance.branch_source_barriers_test_only");
    const firstOp=(first==="open"?opening(gatePort):collecting(gatePort)).then(value=>({value}),error=>({error}));
    await g.entered;
    const secondOp=(first==="open"?collecting(db):opening(db)).then(value=>({value}),error=>({error}));
    try {await waitForLock(admin,"branch_source_barriers_test_only");} finally {g.release();}
    const winner=await firstOp,after=await secondOp;
    assert.ok("value" in winner);assert.ok(conflicts.length>=1);
    assert.ok(conflicts.every(error=>!(typeof error==="object" && error!==null && "code" in error && error.code==="40P01")));
    if(first==="open") {
      assert.ok("error" in after);assert.match(String(after.error),/الوجهة المختارة ليست خزنة/);
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_collections WHERE request_id=$1::uuid",[vaultInput.requestId])).rows[0].n,0);
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE destination_id=$1::bigint",[vault.id])).rows[0].n,0);
      const custodyInput={requestId:vaultInput.requestId,saleId:sale,amount:"1",method:"CASH",actuallyPaid:false};
      const pending=await branchCollectionTestOnly(db,BigInt(branch),custodyInput);
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.collection_allocations_test_only WHERE collection_id=$1::bigint AND account_id=$2::bigint AND treatment='CUSTODY_PENDING' AND movement_id IS NULL",[pending.id,winner.value.id])).rows[0].n,1);
    } else {
      assert.ok("value" in after);assert.equal(after.value.replayed,false);
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE destination_id=$1::bigint AND external_ref=$2",[vault.id,`collection:${winner.value.id}`])).rows[0].n,1);
      assert.deepEqual(await collecting(db),{id:winner.value.id,replayed:true});
      assert.deepEqual(await opening(db),{id:after.value.id,replayed:true});
    }
    const revision=(await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.branch_source_barriers_test_only WHERE branch_id=$1::bigint",[branch])).rows[0].revision;
    await admin.query("BEGIN");await admin.query("UPDATE finance.branch_source_barriers_test_only SET revision=revision+1 WHERE branch_id=$1::bigint",[branch]);
    try {
      const replay=await Promise.race([first==="open"?opening(db):collecting(db),new Promise<never>((_,reject)=>{const timer=setTimeout(()=>reject(new Error("routing replay waited on marker")),5000);timer.unref();})]);
      assert.deepEqual(replay,{id:winner.value.id,replayed:true});
    } finally {await admin.query("ROLLBACK");}
    assert.equal((await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.branch_source_barriers_test_only WHERE branch_id=$1::bigint",[branch])).rows[0].revision,revision);
  }
}

/** Branch marker with approval of a previously requested custody. */
async function checkBranchRoutingApproval(admin:Client,prisma:PrismaClient,db:FinanceDatabase,today:string):Promise<void> {
  for(const [branch,first] of [["440","approval"],["441","collection"]] as const) {
    await admin.query(`INSERT INTO branches(id,code,name_ar,city,phone,invoice_prefix,opening_date,is_active,created_at)
      VALUES($1::bigint,$2,'فرع اعتماد توجيه','تجربة','000',$2,CURRENT_DATE,true,now())`,[branch,`SYN${branch}`]);
    await admin.query(`INSERT INTO users(id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT $1::bigint,$1::bigint,role_code,'موظف اعتماد توجيه',$2,password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3`,[branch,`pg-branch-approval-${branch}@selahtone.local`]);
    const vault=await openAccount(db,"1",{requestId:randomUUID(),branchId:branch,kind:"VAULT",holderId:null,openingAmount:"0",openingDate:today,counted:true},today);
    const request=await requestCustody(db,branch,{requestId:randomUUID(),amount:"10",reason:"طلب اعتماد توجيه اصطناعي"});
    const person=await prisma.user.findUniqueOrThrow({where:{id:BigInt(branch)},select:{fullName:true,email:true,phone:true,roleCode:true,branchId:true,status:true}});
    await updateDirectoryUser(prisma,{userId:BigInt(branch),actorRole:"MANAGER",financeOn:true,expected:person,data:{...person,roleCode:"MANAGER"}});
    const snapshot=custodyRequestSnapshot((await admin.query<{id:string;branchId:string;requesterId:string;amount:string;reason:string}>(`SELECT id::text AS id,branch_id::text AS "branchId",requester_id::text AS "requesterId",requested_amount::text AS amount,reason FROM finance.custody_requests WHERE id=$1::bigint`,[request.id])).rows[0]);
    const approval={requestId:randomUUID(),requestId2:request.id,decision:"APPROVE" as const,reason:"اعتماد توجيه اصطناعي",openingDate:today,counted:true,expectedSnapshot:snapshot};
    await admin.query("INSERT INTO finance.branch_source_barriers_test_only(branch_id) VALUES($1::bigint)",[branch]);
    const sale=(await admin.query<{id:string}>(`INSERT INTO commerce_sales(request_id,request_hash,branch_id,warehouse_id,customer_name,customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,created_by_id)
      SELECT $1::uuid,repeat('a',64),$2::bigint,warehouse_id,'فاتورة اعتماد توجيه',customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,$2::bigint FROM commerce_sales WHERE id=2 RETURNING id::text`,[randomUUID(),branch])).rows[0].id;
    const input={requestId:randomUUID(),saleId:sale,amount:"1",method:"CASH",actuallyPaid:false,vaultReceived:true};
    await assert.rejects(()=>branchApproveCustodyTestOnly(db,"1",{...approval,requestId:randomUUID(),expectedSnapshot:"0".repeat(64)},today),/تغيّر طلب العهدة/);
    assert.equal((await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.branch_source_barriers_test_only WHERE branch_id=$1::bigint",[branch])).rows[0].revision,"0");
    const g=gate(),conflicts:unknown[]=[];
    const retry=async<T>(work:()=>Promise<T>):Promise<T>=>{for(let attempts=1;;attempts++)try{return await work();}catch(error){if(attempts<4 && isRetryableTransactionConflict(error)){conflicts.push(error);continue;}throw error;}};
    const approve=(port:FinanceDatabase)=>retry(()=>branchApproveCustodyTestOnly(port,"1",approval,today));
    const collect=(port:FinanceDatabase)=>retry(()=>branchVaultCollectionTestOnly(port,BigInt(branch),input));
    const gatePort=gatedFinance(prisma,g,"UPDATE finance.branch_source_barriers_test_only");
    const firstOp=(first==="approval"?approve(gatePort):collect(gatePort)).then(value=>({value}),error=>({error}));
    await g.entered;
    const secondOp=(first==="approval"?collect(db):approve(db)).then(value=>({value}),error=>({error}));
    try {await waitForLock(admin,"branch_source_barriers_test_only");} finally {g.release();}
    const winner=await firstOp,after=await secondOp;
    assert.ok("value" in winner);assert.ok(conflicts.length>=1);
    if(first==="approval") {
      assert.ok("error" in after);assert.match(String(after.error),/الوجهة المختارة ليست خزنة/);
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_collections WHERE request_id=$1::uuid",[input.requestId])).rows[0].n,0);
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE destination_id=$1::bigint",[vault.id])).rows[0].n,0);
      const pending=await branchCollectionTestOnly(db,BigInt(branch),{requestId:input.requestId,saleId:sale,amount:"1",method:"CASH",actuallyPaid:false});
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.collection_allocations_test_only WHERE collection_id=$1::bigint AND account_id=$2::bigint AND treatment='CUSTODY_PENDING' AND movement_id IS NULL",[pending.id,winner.value.id])).rows[0].n,1);
      assert.deepEqual(await approve(db),{id:winner.value.id,replayed:true});
    } else {
      assert.ok("value" in after);assert.equal(after.value.replayed,false);
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE destination_id=$1::bigint AND external_ref=$2",[vault.id,`collection:${winner.value.id}`])).rows[0].n,1);
      assert.deepEqual(await collect(db),{id:winner.value.id,replayed:true});
      assert.deepEqual(await approve(db),{id:after.value.id,replayed:true});
    }
    assert.equal((await admin.query<{status:string}>("SELECT status FROM finance.custody_requests WHERE id=$1::bigint",[request.id])).rows[0].status,"APPROVED");
    const before=(await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.branch_source_barriers_test_only WHERE branch_id=$1::bigint",[branch])).rows[0].revision;
    await admin.query("BEGIN");await admin.query("UPDATE finance.branch_source_barriers_test_only SET revision=revision+1 WHERE branch_id=$1::bigint",[branch]);
    try {
      const replay=await Promise.race([approve(db),new Promise<never>((_,reject)=>{const timer=setTimeout(()=>reject(new Error("approval replay waited on marker")),5000);timer.unref();})]);
      assert.equal(replay.replayed,true);
    } finally {await admin.query("ROLLBACK");}
    assert.equal((await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.branch_source_barriers_test_only WHERE branch_id=$1::bigint",[branch])).rows[0].revision,before);
  }
}

/** Compare pre-marker authorization in a synthetic approval path. */
async function checkBranchApprovalPreauthorization(admin:Client,prisma:PrismaClient,db:FinanceDatabase,today:string):Promise<void> {
  for(const [branch,prechecked] of [["442",false],["443",true]] as const) {
    await admin.query(`INSERT INTO branches(id,code,name_ar,city,phone,invoice_prefix,opening_date,is_active,created_at)
      VALUES($1::bigint,$2,'فرع صلاحية حاجز','تجربة','000',$2,CURRENT_DATE,true,now())`,[branch,`SYN${branch}`]);
    await admin.query(`INSERT INTO users(id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT $1::bigint,$1::bigint,role_code,'موظف طلب صلاحية',$2,password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3`,[branch,`pg-branch-auth-${branch}@selahtone.local`]);
    const requested=await requestCustody(db,branch,{requestId:randomUUID(),amount:"1",reason:"طلب صلاحية اصطناعي"});
    const snapshot=custodyRequestSnapshot((await admin.query<{id:string;branchId:string;requesterId:string;amount:string;reason:string}>(`SELECT id::text AS id,branch_id::text AS "branchId",requester_id::text AS "requesterId",requested_amount::text AS amount,reason FROM finance.custody_requests WHERE id=$1::bigint`,[requested.id])).rows[0]);
    const valid={requestId:randomUUID(),requestId2:requested.id,decision:"APPROVE" as const,reason:"اعتماد صلاحية اصطناعي",openingDate:today,counted:true,expectedSnapshot:snapshot};
    await admin.query("INSERT INTO finance.branch_source_barriers_test_only(branch_id) VALUES($1::bigint)",[branch]);
    if(!prechecked) {
      // An active non-manager gets the marker before the real engine rejects.
      const g=gate();
      const invalid=branchApproveCustodyTestOnly(gatedFinance(prisma,g,"UPDATE finance.branch_source_barriers_test_only"),"3",{...valid,requestId:randomUUID()},today).then(value=>({value}),error=>({error}));
      await g.entered;
      const authorised=branchApproveCustodyTestOnly(db,"1",valid,today).then(value=>({value}),error=>({error}));
      try {await waitForLock(admin,"branch_source_barriers_test_only");} finally {g.release();}
      const denied=await invalid, approved=await authorised;
      assert.ok("error" in denied && "value" in approved);assert.match(String(denied.error),/للمدير والمحاسب/);
      assert.equal(approved.value.replayed,false);
      assert.equal((await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.branch_source_barriers_test_only WHERE branch_id=$1::bigint",[branch])).rows[0].revision,"1");
    } else {
      // A coarse precheck locks and checks the actor and accountant scope first;
      // the engine still performs its full checks inside the same transaction.
      await admin.query("BEGIN");await admin.query("UPDATE finance.branch_source_barriers_test_only SET revision=revision+1 WHERE branch_id=$1::bigint",[branch]);
      try {
        for(const actor of ["3","2"]) {
          const reject=preauthorizedApprovalTestOnly(db,actor,{...valid,requestId:randomUUID()},today);
          await assert.rejects(()=>Promise.race([reject,new Promise<never>((_,fail)=>{const timer=setTimeout(()=>fail(new Error("unauthorized precheck waited on branch marker")),5000);timer.unref();})]),/لا تملك صلاحية/);
        }
      } finally {await admin.query("ROLLBACK");}
      assert.equal((await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.branch_source_barriers_test_only WHERE branch_id=$1::bigint",[branch])).rows[0].revision,"0");
      await assert.rejects(()=>preauthorizedApprovalTestOnly(db,"1",{...valid,requestId:randomUUID(),expectedSnapshot:"0".repeat(64)},today),/تغيّر طلب العهدة/);
      assert.equal((await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.branch_source_barriers_test_only WHERE branch_id=$1::bigint",[branch])).rows[0].revision,"0");
      const saved=await preauthorizedApprovalTestOnly(db,"1",valid,today);
      assert.equal(saved.replayed,false);
      const revision=(await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.branch_source_barriers_test_only WHERE branch_id=$1::bigint",[branch])).rows[0].revision;
      await admin.query("BEGIN");await admin.query("UPDATE finance.branch_source_barriers_test_only SET revision=revision+1 WHERE branch_id=$1::bigint",[branch]);
      try {
        const replay=await Promise.race([preauthorizedApprovalTestOnly(db,"1",valid,today),new Promise<never>((_,reject)=>{const timer=setTimeout(()=>reject(new Error("approval replay waited on branch marker")),5000);timer.unref();})]);
        assert.deepEqual(replay,{id:saved.id,replayed:true});
      } finally {await admin.query("ROLLBACK");}
      assert.equal((await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.branch_source_barriers_test_only WHERE branch_id=$1::bigint",[branch])).rows[0].revision,revision);
      await admin.query("UPDATE users SET status='SUSPENDED' WHERE id=1");
      try {await assert.rejects(()=>preauthorizedApprovalTestOnly(db,"1",valid,today),/لا تملك صلاحية/);} finally {await admin.query("UPDATE users SET status='ACTIVE' WHERE id=1");}
    }
  }
}

/** Actor-row orders for the duplicated precheck; direct updates are bypasses. */
async function checkApprovalActorRace(admin:Client,prisma:PrismaClient,db:FinanceDatabase,today:string):Promise<void> {
  for(const [branch,manager,first] of [["444","446","suspension"],["445","447","approval"]] as const) {
    await admin.query(`INSERT INTO branches(id,code,name_ar,city,phone,invoice_prefix,opening_date,is_active,created_at)
      VALUES($1::bigint,$2,'فرع صلاحية متزامنة','تجربة','000',$2,CURRENT_DATE,true,now())`,[branch,`SYN${branch}`]);
    await admin.query(`INSERT INTO users(id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT $1::bigint,$1::bigint,role_code,'طالب صلاحية متزامنة',$2,password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3`,[branch,`pg-actor-request-${branch}@selahtone.local`]);
    await admin.query(`INSERT INTO users(id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT $1::bigint,$2::bigint,role_code,'مدير صلاحية متزامنة',$3,password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=1`,[manager,branch,`pg-actor-manager-${manager}@selahtone.local`]);
    const requested=await requestCustody(db,branch,{requestId:randomUUID(),amount:"1",reason:"طلب حالة اصطناعي"});
    const snapshot=custodyRequestSnapshot((await admin.query<{id:string;branchId:string;requesterId:string;amount:string;reason:string}>(`SELECT id::text AS id,branch_id::text AS "branchId",requester_id::text AS "requesterId",requested_amount::text AS amount,reason FROM finance.custody_requests WHERE id=$1::bigint`,[requested.id])).rows[0]);
    const approval={requestId:randomUUID(),requestId2:requested.id,decision:"APPROVE" as const,reason:"اعتماد حالة اصطناعي",openingDate:today,counted:true,expectedSnapshot:snapshot};
    await admin.query("INSERT INTO finance.branch_source_barriers_test_only(branch_id) VALUES($1::bigint)",[branch]);
    if(first==="suspension") {
      await admin.query("BEGIN");await admin.query("UPDATE users SET status='SUSPENDED' WHERE id=$1::bigint",[manager]);
      let attempts=0;
      const pending=(async()=>{for(;;)try{attempts++;return await preauthorizedApprovalTestOnly(db,manager,approval,today);}catch(error){if(attempts<4 && isRetryableTransactionConflict(error))continue;throw error;}})().then(value=>({value}),error=>({error}));
      try {await waitForLock(admin,"users");} finally {await admin.query("COMMIT");}
      const denied=await pending;
      assert.ok("error" in denied);assert.match(String(denied.error),/لا تملك صلاحية/);assert.ok(attempts>=2);
      assert.equal((await admin.query<{status:string}>("SELECT status FROM finance.custody_requests WHERE id=$1::bigint",[requested.id])).rows[0].status,"PENDING");
      assert.equal((await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.branch_source_barriers_test_only WHERE branch_id=$1::bigint",[branch])).rows[0].revision,"0");
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.requests WHERE request_id=$1::uuid",[approval.requestId])).rows[0].n,0);
    } else {
      const g=gate();
      const gated=gatedFinance(prisma,g,'must_change_password AS "mustChangePassword" FROM public.users WHERE id=$1::bigint FOR SHARE');
      const pending=preauthorizedApprovalTestOnly(gated,manager,approval,today);
      await g.entered;
      // Prisma raw promises are lazy: start the update before observing locks.
      const suspend=Promise.resolve(prisma.$executeRawUnsafe("UPDATE public.users SET status='SUSPENDED' WHERE id=$1::bigint",manager));
      try {await waitForLock(admin,"users");} finally {g.release();}
      const saved=await pending;await suspend;
      assert.equal(saved.replayed,false);
      assert.equal((await admin.query<{status:string}>("SELECT status FROM finance.custody_requests WHERE id=$1::bigint",[requested.id])).rows[0].status,"APPROVED");
      await assert.rejects(()=>preauthorizedApprovalTestOnly(db,manager,approval,today),/لا تملك صلاحية/);
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.requests WHERE request_id=$1::uuid",[approval.requestId])).rows[0].n,1);
      assert.equal((await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.branch_source_barriers_test_only WHERE branch_id=$1::bigint",[branch])).rows[0].revision,"1");
    }
  }
}

/** Test the real directory status service against the experimental precheck. */
async function checkApprovalDirectoryRace(admin:Client,prisma:PrismaClient,db:FinanceDatabase,today:string):Promise<void> {
  for(const [branch,manager,first] of [["448","450","suspension"],["449","451","approval"]] as const) {
    await admin.query(`INSERT INTO branches(id,code,name_ar,city,phone,invoice_prefix,opening_date,is_active,created_at)
      VALUES($1::bigint,$2,'فرع دليل وصلاحية','تجربة','000',$2,CURRENT_DATE,true,now())`,[branch,`SYN${branch}`]);
    await admin.query(`INSERT INTO users(id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT $1::bigint,$1::bigint,role_code,'طالب دليل اصطناعي',$2,password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3`,[branch,`pg-dir-holder-${branch}@selahtone.local`]);
    await admin.query(`INSERT INTO users(id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT $1::bigint,$2::bigint,role_code,'مدير دليل اصطناعي',$3,password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=1`,[manager,branch,`pg-dir-manager-${manager}@selahtone.local`]);
    await prisma.authSession.create({data:{id:randomUUID(),userId:BigInt(manager),expiresAt:new Date(Date.now()+3_600_000)}});
    const requested=await requestCustody(db,branch,{requestId:randomUUID(),amount:"1",reason:"طلب دليل اصطناعي"});
    const snapshot=custodyRequestSnapshot((await admin.query<{id:string;branchId:string;requesterId:string;amount:string;reason:string}>(`SELECT id::text AS id,branch_id::text AS "branchId",requester_id::text AS "requesterId",requested_amount::text AS amount,reason FROM finance.custody_requests WHERE id=$1::bigint`,[requested.id])).rows[0]);
    const approval={requestId:randomUUID(),requestId2:requested.id,decision:"APPROVE" as const,reason:"اعتماد دليل اصطناعي",openingDate:today,counted:true,expectedSnapshot:snapshot};
    await admin.query("INSERT INTO finance.branch_source_barriers_test_only(branch_id) VALUES($1::bigint)",[branch]);
    const original=await prisma.user.findUniqueOrThrow({where:{id:BigInt(manager)},select:{fullName:true,email:true,phone:true,roleCode:true,branchId:true,status:true}});
    const directoryInput={userId:BigInt(manager),actorRole:"MANAGER" as const,expected:original,data:{...original,status:"SUSPENDED" as const},financeOn:true};
    if(first==="suspension") {
      const g=gate();
      const stopping=updateDirectoryUser(interceptedDirectory(prisma,"FROM public.users WHERE id=$1::bigint FOR UPDATE",g),directoryInput);
      await g.entered;
      let attempts=0;
      const pending=(async()=>{for(;;)try{attempts++;return await preauthorizedApprovalTestOnly(db,manager,approval,today);}catch(error){if(attempts<4 && isRetryableTransactionConflict(error))continue;throw error;}})().then(value=>({value}),error=>({error}));
      try {await waitForLock(admin,"users");} finally {g.release();}
      await stopping;
      const denied=await pending;
      assert.ok("error" in denied);assert.match(String(denied.error),/لا تملك صلاحية/);assert.ok(attempts>=2);
      assert.equal((await admin.query<{status:string}>("SELECT status FROM finance.custody_requests WHERE id=$1::bigint",[requested.id])).rows[0].status,"PENDING");
      assert.equal((await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.branch_source_barriers_test_only WHERE branch_id=$1::bigint",[branch])).rows[0].revision,"0");
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.requests WHERE request_id=$1::uuid",[approval.requestId])).rows[0].n,0);
    } else {
      const g=gate();
      const gated=gatedFinance(prisma,g,'must_change_password AS "mustChangePassword" FROM public.users WHERE id=$1::bigint FOR SHARE');
      const pending=preauthorizedApprovalTestOnly(gated,manager,approval,today);
      await g.entered;
      const stopping=updateDirectoryUser(prisma,directoryInput);
      try {await waitForLock(admin,"users");} finally {g.release();}
      const saved=await pending;await stopping;
      assert.equal(saved.replayed,false);
      assert.equal((await admin.query<{status:string}>("SELECT status FROM finance.custody_requests WHERE id=$1::bigint",[requested.id])).rows[0].status,"APPROVED");
      await assert.rejects(()=>preauthorizedApprovalTestOnly(db,manager,approval,today),/لا تملك صلاحية/);
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.requests WHERE request_id=$1::uuid",[approval.requestId])).rows[0].n,1);
      assert.equal((await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.branch_source_barriers_test_only WHERE branch_id=$1::bigint",[branch])).rows[0].revision,"1");
    }
    assert.equal((await prisma.user.findUniqueOrThrow({where:{id:BigInt(manager)}})).status,"SUSPENDED");
    assert.equal(await prisma.authSession.count({where:{userId:BigInt(manager)}}),0);
  }
}

/** The holder, not the approving manager, races the experimental wrapper. */
async function checkApprovalHolderDirectoryRace(admin:Client,prisma:PrismaClient,db:FinanceDatabase,today:string):Promise<void> {
  for(const [branch,first] of [["452","suspension"],["453","approval"]] as const) {
    await admin.query(`INSERT INTO branches(id,code,name_ar,city,phone,invoice_prefix,opening_date,is_active,created_at)
      VALUES($1::bigint,$2,'فرع تداخل الحامل','تجربة','000',$2,CURRENT_DATE,true,now())`,[branch,`SYN${branch}`]);
    await admin.query(`INSERT INTO users(id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT $1::bigint,$1::bigint,role_code,'حامل اصطناعي',$2,password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3`,[branch,`pg-approval-holder-${branch}@selahtone.local`]);
    const holder=BigInt(branch);
    await prisma.authSession.create({data:{id:randomUUID(),userId:holder,expiresAt:new Date(Date.now()+3_600_000)}});
    const requested=await requestCustody(db,branch,{requestId:randomUUID(),amount:"1",reason:"طلب تداخل الحامل"});
    const row=(await admin.query<{id:string;branchId:string;requesterId:string;amount:string;reason:string}>(`SELECT id::text AS id,branch_id::text AS "branchId",requester_id::text AS "requesterId",requested_amount::text AS amount,reason FROM finance.custody_requests WHERE id=$1::bigint`,[requested.id])).rows[0];
    const approval={requestId:randomUUID(),requestId2:requested.id,decision:"APPROVE" as const,reason:"اعتماد اصطناعي",openingDate:today,counted:true,expectedSnapshot:custodyRequestSnapshot(row)};
    await admin.query("INSERT INTO finance.branch_source_barriers_test_only(branch_id) VALUES($1::bigint)",[branch]);
    const original=await prisma.user.findUniqueOrThrow({where:{id:holder},select:{fullName:true,email:true,phone:true,roleCode:true,branchId:true,status:true}});
    const input={userId:holder,actorRole:"MANAGER" as const,expected:original,data:{...original,status:"SUSPENDED" as const},financeOn:true};
    if(first==="suspension") {
      const g=gate();
      const stopping=updateDirectoryUser(interceptedDirectory(prisma,"FROM public.users WHERE id=$1::bigint FOR UPDATE",g),input);
      await g.entered;
      let attempts=0;
      const pending=(async()=>{for(;;)try{attempts++;return await preauthorizedApprovalTestOnly(db,"1",approval,today);}catch(error){if(attempts<4 && isRetryableTransactionConflict(error))continue;throw error;}})().then(value=>({value}),error=>({error}));
      try {await waitForLock(admin,"users");} finally {g.release();}
      await stopping;
      const result=await pending;
      assert.ok("error" in result);assert.match(String(result.error),/مقدم الطلب غير نشط/);assert.ok(attempts>=2);
      assert.equal((await prisma.user.findUniqueOrThrow({where:{id:holder}})).status,"SUSPENDED");
      assert.equal(await prisma.authSession.count({where:{userId:holder}}),0);
      assert.equal((await admin.query<{status:string}>("SELECT status FROM finance.custody_requests WHERE id=$1::bigint",[requested.id])).rows[0].status,"PENDING");
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.accounts WHERE kind='CUSTODY' AND holder_id=$1::bigint",[branch])).rows[0].n,0);
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.requests WHERE request_id=$1::uuid",[approval.requestId])).rows[0].n,0);
      assert.equal((await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.branch_source_barriers_test_only WHERE branch_id=$1::bigint",[branch])).rows[0].revision,"0");
      // Suspending the holder does not prevent a manager rejecting the request.
      const reject={requestId:randomUUID(),requestId2:requested.id,decision:"REJECT",reason:"إغلاق الطلب بعد التعليق"};
      assert.equal((await decideCustodyRequest(db,"1",reject,today)).replayed,false);
      assert.equal((await decideCustodyRequest(db,"1",reject,today)).replayed,true);
    } else {
      const g=gate();
      const pending=preauthorizedApprovalTestOnly(gatedFinance(prisma,g,"FROM public.users\n      WHERE id=$1::bigint AND branch_id=$2::bigint"),"1",approval,today);
      await g.entered;
      const stopping=updateDirectoryUser(prisma,input).then(value=>({value}),error=>({error}));
      try {await waitForLock(admin,"users");} finally {g.release();}
      const saved=await pending;
      const result=await stopping;
      assert.ok("error" in result);assert.match(String(result.error),/عهدة نقدية مفتوحة/);
      assert.equal((await prisma.user.findUniqueOrThrow({where:{id:holder}})).status,"ACTIVE");
      assert.equal(await prisma.authSession.count({where:{userId:holder}}),1);
      const request=(await admin.query<{status:string;accountId:string}>(`SELECT status,account_id::text AS "accountId" FROM finance.custody_requests WHERE id=$1::bigint`,[requested.id])).rows[0];
      assert.equal(request.status,"APPROVED");assert.equal(request.accountId,saved.id);
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.accounts WHERE kind='CUSTODY' AND holder_id=$1::bigint AND closed_at IS NULL",[branch])).rows[0].n,1);
      assert.deepEqual(await preauthorizedApprovalTestOnly(db,"1",approval,today),{id:saved.id,replayed:true});
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.requests WHERE request_id=$1::uuid",[approval.requestId])).rows[0].n,1);
      assert.equal((await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.branch_source_barriers_test_only WHERE branch_id=$1::bigint",[branch])).rows[0].revision,"1");
    }
  }
}

/** The production write wrapper rechecks the attributes used by the action's access decision. */
async function checkFinanceSessionDirectoryRace(admin:Client,prisma:PrismaClient,db:FinanceDatabase,today:string):Promise<void> {
  for(const [branch,first] of [["454","role"],["455","write"]] as const) {
    await admin.query(`INSERT INTO branches(id,code,name_ar,city,phone,invoice_prefix,opening_date,is_active,created_at)
      VALUES($1::bigint,$2,'فرع جلسة اصطناعي','تجربة','000',$2,CURRENT_DATE,true,now())`,[branch,`SYN${branch}`]);
    await admin.query(`INSERT INTO users(id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT $1::bigint,$1::bigint,role_code,'مدير جلسة اصطناعي',$2,password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=1`,[branch,`pg-finance-session-${branch}@selahtone.local`]);
    const id=BigInt(branch),session={id:branch,role:"MANAGER",branchId:branch};
    const original=await prisma.user.findUniqueOrThrow({where:{id},select:{fullName:true,email:true,phone:true,roleCode:true,branchId:true,status:true}});
    const update={userId:id,actorRole:"MANAGER" as const,expected:original,data:{...original,roleCode:"ACCOUNTANT" as const},financeOn:true};
    const input={requestId:randomUUID(),branchId:branch,kind:"VAULT",holderId:null,openingAmount:"0",openingDate:today,counted:true};
    if(first==="role") {
      const g=gate();
      const change=updateDirectoryUser(interceptedDirectory(prisma,"FROM public.users WHERE id=$1::bigint FOR UPDATE",g),update);
      await g.entered;
      const pending=openAccount(financeDbForActor(db,session),branch,input,today).then(value=>({value}),error=>({error}));
      try {await waitForLock(admin,"users");} finally {g.release();}
      await change;
      const result=await pending;
      assert.ok("error" in result);assert.match(String(result.error),/تعذّر التحقق من صلاحية الحساب/);
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.accounts WHERE branch_id=$1::bigint",[branch])).rows[0].n,0);
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.requests WHERE request_id=$1::uuid",[input.requestId])).rows[0].n,0);
      // A newly authenticated accountant can execute the still-unused request.
      assert.equal((await openAccount(financeDbForActor(db,{...session,role:"ACCOUNTANT"}),branch,input,today)).replayed,false);
    } else {
      const g=gate();
      const wrapped=financeDbForActor(gatedFinance(prisma,g,'must_change_password AS "mustChange" FROM public.users WHERE id=$1::bigint FOR SHARE'),session);
      const pending=openAccount(wrapped,branch,input,today);
      await g.entered;
      const change=updateDirectoryUser(prisma,update);
      try {await waitForLock(admin,"users");} finally {g.release();}
      const saved=await pending;await change;
      assert.equal(saved.replayed,false);
      await assert.rejects(()=>openAccount(financeDbForActor(db,session),branch,input,today),/تعذّر التحقق من صلاحية الحساب/);
      assert.deepEqual(await openAccount(financeDbForActor(db,{...session,role:"ACCOUNTANT"}),branch,input,today),{id:saved.id,replayed:true});
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.accounts WHERE branch_id=$1::bigint",[branch])).rows[0].n,1);
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.requests WHERE request_id=$1::uuid",[input.requestId])).rows[0].n,1);
    }
  }
}

/** Confirmation and new collection with the same experimental early marker. */
async function checkSyntheticConfirmationBarrier(admin:Client,prisma:PrismaClient,db:FinanceDatabase,today:string):Promise<void> {
  for(const [branch,first] of [["426","confirmation"],["427","collection"]] as const) {
    await admin.query(`INSERT INTO branches(id,code,name_ar,city,phone,invoice_prefix,opening_date,is_active,created_at)
      VALUES($1::bigint,$2,'فرع اعتماد حاجز اصطناعي','تجربة','000',$2,CURRENT_DATE,true,now())`,[branch,`SYN${branch}`]);
    await admin.query(`INSERT INTO users(id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT $1::bigint,$1::bigint,role_code,'موظف اعتماد حاجز اصطناعي',$2,password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3`,[branch,`pg-confirm-barrier-${branch}@selahtone.local`]);
    await openAccount(db,"1",{requestId:randomUUID(),branchId:branch,kind:"VAULT",holderId:null,openingAmount:"0",openingDate:today,counted:true},today);
    const account=await openAccount(db,"1",{requestId:randomUUID(),branchId:branch,kind:"CUSTODY",holderId:branch,openingAmount:"0",openingDate:today,counted:true},today);
    await admin.query("INSERT INTO finance.source_order_barriers_test_only(account_id) VALUES($1::bigint)",[account.id]);
    const sale=(await admin.query<{id:string}>(`INSERT INTO commerce_sales(request_id,request_hash,branch_id,warehouse_id,customer_name,customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,created_by_id)
      SELECT $1::uuid,repeat('d',64),$2::bigint,warehouse_id,'اعتماد حاجز اصطناعي',customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,$2::bigint FROM commerce_sales WHERE id=2 RETURNING id::text`,[randomUUID(),branch])).rows[0].id;
    const collection={requestId:randomUUID(),saleId:sale,amount:"1",method:"CASH",actuallyPaid:false};
    const seed=await collectEarlyBarrierTestOnly(db,BigInt(branch),account.id,collection);
    const review=await db.serializable(tx=>reviewTestPeriod(tx,account.id));
    const evidence={collectionIds:[seed.id],paymentIds:[],reviewedHash:review.hash};
    const request=await settlementEarlyBarrierTestOnly(db,branch,{requestId:randomUUID(),accountId:account.id,expectedBalance:"0",countedAmount:"1",reason:"طلب اعتماد حاجز",actuallyCounted:true},evidence);
    const confirmation={requestId:randomUUID(),settlementId:request.id,expectedBalance:"0",transferAmount:"0",transferDirection:"TO_VAULT",reason:"اعتماد حاجز",actuallyTransferred:true};
    const competing={...collection,requestId:randomUUID()};
    const gateMarker=gate(),conflicts:unknown[]=[];
    const retry=async<T>(work:()=>Promise<T>):Promise<T>=>{for(let attempts=1;;attempts++)try{return await work();}catch(error){if(attempts<4 && isRetryableTransactionConflict(error)){conflicts.push(error);continue;}throw error;}};
    const confirm=(port:FinanceDatabase)=>retry(()=>confirmationEarlyBarrierTestOnly(port,"1",account.id,confirmation,evidence));
    const collect=(port:FinanceDatabase)=>retry(()=>collectEarlyBarrierTestOnly(port,BigInt(branch),account.id,competing));
    const gated=gatedFinance(prisma,gateMarker,"UPDATE finance.source_order_barriers_test_only");
    const firstOp=(first==="confirmation"?confirm(gated):collect(gated)).then(value=>({value}),error=>({error}));
    await gateMarker.entered;
    const secondOp=(first==="confirmation"?collect(db):confirm(db)).then(value=>({value}),error=>({error}));
    try {await waitForLock(admin,"source_order_barriers_test_only");} finally {gateMarker.release();}
    const primary=await firstOp,secondary=await secondOp;
    assert.ok(conflicts.every(error=>!(typeof error==="object" && error!==null && "code" in error && error.code==="40P01")));
    if(first==="confirmation") {
      assert.ok("value" in primary && "value" in secondary);
      assert.ok(conflicts.length>=1);
      assert.equal(primary.value.replayed,false);assert.equal(secondary.value.replayed,false);
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.collection_allocations_test_only WHERE collection_id=$1::bigint AND settlement_id IS NULL",[secondary.value.id])).rows[0].n,1);
    } else {
      assert.ok("error" in primary && "value" in secondary);
      assert.match(String(primary.error),/طلب جرد أو تسوية مفتوح/);
      assert.equal(secondary.value.replayed,false);
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_collections WHERE request_id=$1::uuid",[competing.requestId])).rows[0].n,0);
    }
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.collection_allocations_test_only WHERE collection_id=$1::bigint AND settlement_id=$2::bigint",[seed.id,request.id])).rows[0].n,1);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.settlement_allocation_receipts_test_only WHERE settlement_id=$1::bigint",[request.id])).rows[0].n,1);
    assert.deepEqual((await admin.query<{kind:string;amount:string}>("SELECT kind,amount::text AS amount FROM finance.movements WHERE settlement_id=$1::bigint",[request.id])).rows,[{kind:"SETTLEMENT",amount:"1.00"}]);
    const revision=(await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.source_order_barriers_test_only WHERE account_id=$1::bigint",[account.id])).rows[0].revision;
    await admin.query("BEGIN");await admin.query("UPDATE finance.source_order_barriers_test_only SET revision=revision+1 WHERE account_id=$1::bigint",[account.id]);
    try {
      const replay=await Promise.race([confirm(db),new Promise<never>((_,reject)=>{const timer=setTimeout(()=>reject(new Error("confirmation replay waited on marker")),5000);timer.unref();})]);
      assert.deepEqual(replay,{id:request.id,replayed:true});
    } finally {await admin.query("ROLLBACK");}
    assert.equal((await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.source_order_barriers_test_only WHERE account_id=$1::bigint",[account.id])).rows[0].revision,revision);
    await assert.rejects(()=>confirmationEarlyBarrierTestOnly(db,"1",account.id,confirmation,{...evidence,reviewedHash:"f".repeat(64)}),/مراجعة الطلب غير موجودة أو لا تطابق/);
    await admin.query("UPDATE users SET status='SUSPENDED' WHERE id=1");
    try {await assert.rejects(()=>confirm(db),/غير نشط/);} finally {await admin.query("UPDATE users SET status='ACTIVE' WHERE id=1");}
    await admin.query("DELETE FROM finance.source_order_barriers_test_only WHERE account_id=$1::bigint",[account.id]);
    try {
      assert.deepEqual(await confirm(db),{id:request.id,replayed:true});
      await assert.rejects(()=>confirmationEarlyBarrierTestOnly(db,"1",account.id,{...confirmation,requestId:randomUUID()},evidence),/حاجز المصدر غير متاح/);
    } finally {await admin.query("INSERT INTO finance.source_order_barriers_test_only(account_id,revision) VALUES($1::bigint,$2::bigint)",[account.id,revision]);}
    assert.deepEqual(await confirm(db),{id:request.id,replayed:true});
  }
}

/** Cancellation must not be blocked in the real app by this lab marker. */
async function checkSyntheticCancellationBarrier(admin:Client,prisma:PrismaClient,db:FinanceDatabase,today:string):Promise<void> {
  for(const [branch,first,cancelMarked] of [["428","cancel",true],["429","confirm",true],["430","cancel",false],["431","confirm",false]] as const) {
    await admin.query(`INSERT INTO branches(id,code,name_ar,city,phone,invoice_prefix,opening_date,is_active,created_at)
      VALUES($1::bigint,$2,'فرع إلغاء حاجز اصطناعي','تجربة','000',$2,CURRENT_DATE,true,now())`,[branch,`SYN${branch}`]);
    await admin.query(`INSERT INTO users(id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT $1::bigint,$1::bigint,role_code,'موظف إلغاء حاجز اصطناعي',$2,password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3`,[branch,`pg-cancel-barrier-${branch}@selahtone.local`]);
    await openAccount(db,"1",{requestId:randomUUID(),branchId:branch,kind:"VAULT",holderId:null,openingAmount:"0",openingDate:today,counted:true},today);
    const account=await openAccount(db,"1",{requestId:randomUUID(),branchId:branch,kind:"CUSTODY",holderId:branch,openingAmount:"0",openingDate:today,counted:true},today);
    await admin.query("INSERT INTO finance.source_order_barriers_test_only(account_id) VALUES($1::bigint)",[account.id]);
    const sale=(await admin.query<{id:string}>(`INSERT INTO commerce_sales(request_id,request_hash,branch_id,warehouse_id,customer_name,customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,created_by_id)
      SELECT $1::uuid,repeat('d',64),$2::bigint,warehouse_id,'إلغاء حاجز اصطناعي',customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,$2::bigint FROM commerce_sales WHERE id=2 RETURNING id::text`,[randomUUID(),branch])).rows[0].id;
    const collection=await collectEarlyBarrierTestOnly(db,BigInt(branch),account.id,{requestId:randomUUID(),saleId:sale,amount:"1",method:"CASH",actuallyPaid:false});
    const period=await db.serializable(tx=>reviewTestPeriod(tx,account.id));
    const evidence={collectionIds:[collection.id],paymentIds:[],reviewedHash:period.hash};
    const request=await settlementEarlyBarrierTestOnly(db,branch,{requestId:randomUUID(),accountId:account.id,expectedBalance:"0",countedAmount:"1",reason:"طلب إلغاء حاجز",actuallyCounted:true},evidence);
    const cancel={requestId:randomUUID(),settlementId:request.id,reason:"إلغاء اصطناعي"};
    const confirm={requestId:randomUUID(),settlementId:request.id,expectedBalance:"0",transferAmount:"0",transferDirection:"TO_VAULT",reason:"اعتماد اصطناعي",actuallyTransferred:true};
    const g=gate(),conflicts:unknown[]=[];
    const retry=async<T>(work:()=>Promise<T>):Promise<T>=>{for(let attempts=1;;attempts++)try{return await work();}catch(error){if(attempts<4 && isRetryableTransactionConflict(error)){conflicts.push(error);continue;}throw error;}};
    const cancelling=(port:FinanceDatabase)=>cancelMarked
      ? retry(()=>cancellationEarlyBarrierTestOnly(port,branch,account.id,cancel))
      : cancelSettlement(port,branch,cancel);
    const confirming=(port:FinanceDatabase)=>retry(()=>confirmationEarlyBarrierTestOnly(port,"1",account.id,confirm,evidence));
    const gated=gatedFinance(prisma,g,cancelMarked?"UPDATE finance.source_order_barriers_test_only":"FROM finance.settlements s WHERE s.id=$1::bigint FOR UPDATE");
    const firstOp=(first==="cancel"?cancelling(gated):confirming(gated)).then(value=>({value}),error=>({error}));
    await g.entered;
    const secondOp=(first==="cancel"?confirming(db):cancelling(db)).then(value=>({value}),error=>({error}));
    try {await waitForLock(admin,cancelMarked?"source_order_barriers_test_only":"settlements");} finally {g.release();}
    const won=await firstOp,lost=await secondOp;
    assert.ok("value" in won && "error" in lost);
    assert.match(String(lost.error),/طلب التسوية ليس مفتوحًا/);
    if(cancelMarked || first==="cancel") assert.ok(conflicts.length>=1);
    assert.ok(conflicts.every(error=>!(typeof error==="object" && error!==null && "code" in error && error.code==="40P01")));
    assert.equal((await admin.query<{status:string}>("SELECT status FROM finance.settlements WHERE id=$1::bigint",[request.id])).rows[0].status,first==="cancel"?"CANCELLED":"CONFIRMED");
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE settlement_id=$1::bigint",[request.id])).rows[0].n,first==="cancel"?0:1);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.settlement_allocation_receipts_test_only WHERE settlement_id=$1::bigint",[request.id])).rows[0].n,first==="cancel"?0:1);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.collection_allocations_test_only WHERE collection_id=$1::bigint AND settlement_id IS NULL",[collection.id])).rows[0].n,first==="cancel"?1:0);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.requests WHERE request_id=$1::uuid",[first==="cancel"?confirm.requestId:cancel.requestId])).rows[0].n,0);
    const marker=(await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.source_order_barriers_test_only WHERE account_id=$1::bigint",[account.id])).rows[0].revision;
    await admin.query("DELETE FROM finance.source_order_barriers_test_only WHERE account_id=$1::bigint",[account.id]);
    try {
      assert.deepEqual(first==="cancel"?await cancelling(db):await confirming(db),{id:request.id,replayed:true});
      if(first==="cancel" && cancelMarked) {
        // Shows why cancellation cannot depend on an optional lab marker:
        // the same still-open request remains cancellable in the real service.
        const next=await requestAllocatedSettlementTestOnly(db,branch,{requestId:randomUUID(),accountId:account.id,expectedBalance:"0",countedAmount:"1",reason:"إلغاء دون حاجز",actuallyCounted:true},account.id,evidence);
        const nextCancel={requestId:randomUUID(),settlementId:next.id,reason:"إلغاء دون حاجز"};
        await assert.rejects(()=>cancellationEarlyBarrierTestOnly(db,branch,account.id,nextCancel),/حاجز المصدر غير متاح/);
        assert.equal((await admin.query<{status:string}>("SELECT status FROM finance.settlements WHERE id=$1::bigint",[next.id])).rows[0].status,"OPEN");
        assert.equal((await cancelSettlement(db,branch,nextCancel)).replayed,false);
        assert.deepEqual(await cancelSettlement(db,branch,nextCancel),{id:next.id,replayed:true});
      }
      if(first==="cancel" && !cancelMarked) {
        // Create the request first, then simulate an external duplicate open
        // custody in another branch. Cancellation must remain available with a
        // reason even without the synthetic marker; this is not remediation.
        const duplicateRequest=await requestAllocatedSettlementTestOnly(db,branch,{requestId:randomUUID(),accountId:account.id,expectedBalance:"0",countedAmount:"1",reason:"طلب قبل تعارض اصطناعي",actuallyCounted:true},account.id,evidence);
        const duplicate=(await admin.query<{id:string}>(`INSERT INTO finance.accounts(branch_id,kind,holder_id,opening_amount,opening_date,opened_by)
          VALUES(1,'CUSTODY',$1::bigint,0,CURRENT_DATE,1) RETURNING id::text`,[branch])).rows[0].id;
        try {
          assert.equal((await settlementOverview(db,branch,account.id)).multipleCustodies,true);
          const cancelDuplicate={requestId:randomUUID(),settlementId:duplicateRequest.id,reason:"إلغاء طلب عند تعارض عهد"};
          assert.equal((await cancelSettlement(db,branch,cancelDuplicate)).replayed,false);
          assert.deepEqual(await cancelSettlement(db,branch,cancelDuplicate),{id:duplicateRequest.id,replayed:true});
          assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.collection_allocations_test_only WHERE collection_id=$1::bigint AND settlement_id IS NULL",[collection.id])).rows[0].n,1);
          assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE settlement_id=$1::bigint",[duplicateRequest.id])).rows[0].n,0);
        } finally {await admin.query("DELETE FROM finance.accounts WHERE id=$1::bigint",[duplicate]);}
      }
    } finally {await admin.query("INSERT INTO finance.source_order_barriers_test_only(account_id,revision) VALUES($1::bigint,$2::bigint)",[account.id,marker]);}
  }
}

test("real PostgreSQL exercises cash collection and holder-expense races", { timeout: 120_000 }, async () => {
  const bin = process.env.SYNTHETIC_POSTGRES_BIN;
  assert.ok(bin, "Set SYNTHETIC_POSTGRES_BIN to local PostgreSQL binaries; this test creates a new isolated cluster");
  const dir = mkdtempSync(join(tmpdir(), "selahtone-pg-race-")); const data = join(dir, "data"), log = join(dir, "postgres.log");
  const ctl = (args: string[]) => execFileSync(join(bin, "pg_ctl"), args, { stdio: "pipe", timeout: 30000 });
  let started = false; let admin: Client | undefined; let prisma: PrismaClient | undefined;
  const oldFlag = process.env.FINANCE_ENABLED; process.env.FINANCE_ENABLED = "true";
  const oldStockFlag = process.env.SALES_STOCK_DECOUPLED; process.env.SALES_STOCK_DECOUPLED = "false";
  try {
    execFileSync(join(bin, "initdb"), ["-D", data, "-U", "postgres", "--no-locale", "--encoding=UTF8", "--auth=trust"], { stdio: "pipe", timeout: 30000 });
    // No TCP listener; unique socket directory and throwaway cluster prevent any production access.
    ctl(["-D", data, "-l", log, "-o", `-k ${dir} -p 55439 -c listen_addresses=''`, "-w", "start"]); started = true;
    const config = { host: dir, port: 55439, user: "postgres", database: "postgres" };
    admin = new Client(config); await admin.connect();
    const { buildDdl } = req("./scripts/local-pglite-ddl.cjs") as { buildDdl: () => string };
    await admin.query(buildDdl());
    await admin.query(read("scripts/local-pglite-seed.sql").replaceAll("__PREVIEW_BCRYPT__", "synthetic"));
    await admin.query("SET selahtone.finance_release_candidate_test_only='yes'");
    for (const f of ["prototypes/finance-release/release-candidate.test-only.sql", "prisma/manual-settlement-upgrade.sql", "prisma/manual-custody-closure-upgrade.sql", "prisma/manual-custody-and-count-requests.sql"]) await admin.query(read(f));
    await admin.query("UPDATE commerce_sales SET created_by_id=3 WHERE id=2; UPDATE commerce_sales SET total=9000 WHERE id=9; UPDATE commerce_collections SET created_at=now()-interval '10 days'");
    prisma = new WasmClient({ adapter: new PrismaPg(config) });
    const db = ordinaryFinance(prisma);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
    const custody = await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "CUSTODY", holderId: "3", openingAmount: "0", openingDate: today, counted: true }, today);
    await admin.query("UPDATE finance.accounts SET opened_at=now()-interval '1 day' WHERE id=$1::bigint", [custody.id]);
    const settlement = () => ({ requestId: randomUUID(), accountId: custody.id, countedAmount: "0", expectedBalance: "0", reason: "اختبار تزامن", actuallyCounted: true });
    const collection = () => ({ requestId: randomUUID(), saleId: "2", amount: "10", method: "CASH", actuallyPaid: false });
    // Settlement owns the account; the collection has an older snapshot and waits.
    const first = gate();
    const pendingSettlement = requestSettlement(gatedFinance(prisma, first), "3", settlement());
    await first.entered;
    const rejectedInput = collection();
    const rejectedPayment = recordCommerceCollection(prisma, 3n, rejectedInput);
    await waitForLock(admin, "accounts"); first.release();
    const created = await pendingSettlement;
    await assert.rejects(rejectedPayment, /طلب تسوية أو جرد مفتوح/);
    assert.equal((await admin.query<{ n: string }>("SELECT count(*)::text AS n FROM commerce_collections WHERE request_id=$1::uuid", [rejectedInput.requestId])).rows[0].n, "0");
    await cancelSettlement(db, "3", { requestId: randomUUID(), settlementId: created.id, reason: "إلغاء اختبار" });
    // Collection owns the account; request waits with its own older snapshot.
    const second = gate();
    const acceptedPayment = recordCommerceCollection(gatedCommerce(prisma, second), 3n, collection());
    await second.entered;
    const laterSettlement = requestSettlement(db, "3", settlement());
    await waitForLock(admin, "accounts"); second.release();
    await acceptedPayment; const requested = await laterSettlement;
    const row = await admin.query<{ sales_total: string }>("SELECT sales_total::text FROM finance.settlements WHERE id=$1::bigint", [requested.id]);
    assert.equal(row.rows[0].sales_total, "10.00", "the retried settlement must include the committed collection");
    assert.equal((await settlementOverview(db, "3", custody.id)).sales, "10.00");
    await cancelSettlement(db, "3", { requestId: randomUUID(), settlementId: requested.id, reason: "إلغاء اختبار" });
    // Both kinds of new count prevent a stale collection snapshot from committing.
    for (const directed of [false, true]) {
      const g = gate();
      const opening = directed
        ? requestCountFromHolder(gatedFinance(prisma, g), "1", { requestId: randomUUID(), accountId: custody.id, reason: "جرد موجه" })
        : requestCashCount(gatedFinance(prisma, g), "1", { requestId: randomUUID(), accountId: custody.id, expectedBalance: "10", countedAmount: "10", reason: "جرد مباشر", actuallyCounted: true }, today);
      await g.entered;
      const blocked = recordCommerceCollection(prisma, 3n, collection());
      await waitForLock(admin, "accounts"); g.release();
      const count = await opening;
      await assert.rejects(blocked, /طلب تسوية أو جرد مفتوح/);
      await cancelCashCount(db, "1", { requestId: randomUUID(), countId: count.id, reason: "إلغاء الجرد" });
    }
    // A count begun before a concurrent committed collection is retried and
    // rejects the obsolete expected amount instead of saving it.
    const countRace = gate();
    const paymentFirst = recordCommerceCollection(gatedCommerce(prisma, countRace), 3n, collection());
    await countRace.entered;
    const staleCount = requestCashCount(db, "1", { requestId: randomUUID(), accountId: custody.id, expectedBalance: "10", countedAmount: "10", reason: "جرد قديم", actuallyCounted: true }, today);
    await waitForLock(admin, "accounts"); countRace.release();
    await paymentFirst;
    await assert.rejects(staleCount, /تغير الرصيد المتوقع في اليد/);
    assert.equal((await settlementOverview(db, "3", custody.id)).sales, "20.00");

    // Collection first versus a directed count request. Unlike a direct count,
    // the request has no reference amount; holder submission must observe the
    // committed collection after retry and replay must not duplicate it.
    const directedRace = gate();
    const directedCollectionInput = collection();
    const directedCollection = recordCommerceCollection(gatedCommerce(prisma, directedRace), 3n, directedCollectionInput);
    await directedRace.entered;
    const directedInput = { requestId: randomUUID(), accountId: custody.id, reason: "جرد موجّه بعد تحصيل" };
    const directedRequest = requestCountFromHolder(db, "1", directedInput);
    try { await waitForLock(admin, "accounts"); } finally { directedRace.release(); }
    await directedCollection;
    const directedCount = await directedRequest;
    assert.equal((await recordCommerceCollection(prisma, 3n, directedCollectionInput)).replayed, true);
    assert.equal((await requestCountFromHolder(db, "1", directedInput)).replayed, true);
    const directedSubmit = { requestId: randomUUID(), countId: directedCount.id, countedAmount: "30", actuallyCounted: true };
    await submitHolderCount(db, "3", directedSubmit);
    assert.equal((await submitHolderCount(db, "3", directedSubmit)).replayed, true);
    assert.deepEqual((await admin.query<{ observed: string; difference: string }>("SELECT observed_balance::text AS observed,difference::text AS difference FROM finance.cash_counts WHERE id=$1::bigint", [directedCount.id])).rows[0], { observed: "30.00", difference: "0.00" });
    assert.equal((await admin.query<{ n: string }>("SELECT count(*)::text AS n FROM commerce_collections WHERE request_id=$1::uuid", [directedCollectionInput.requestId])).rows[0].n, "1");
    await cancelCashCount(db, "1", { requestId: randomUUID(), countId: directedCount.id, reason: "إلغاء اختبار الجرد الموجّه" });

    // Two deliveries of one collection request can overlap before commit.
    // Same payload replays once; a changed payload cannot reuse the token.
    for (const changed of [false, true]) {
      const input = collection();
      const before: string = (await admin.query<{ revision: string }>("SELECT revision::text AS revision FROM finance.accounts WHERE id=$1::bigint", [custody.id])).rows[0].revision;
      const saleRevision: number = (await prisma.commerceSale.findUniqueOrThrow({ where: { id: 2n }, select: { revision: true } })).revision;
      const g = gate();
      const firstDelivery = recordCommerceCollection(gatedCommerce(prisma, g), 3n, input);
      await g.entered;
      const secondDelivery = recordCommerceCollection(prisma, 3n, changed ? { ...input, amount: "11" } : input);
      // Attach the rejection handler before releasing the winner.
      const outcome = secondDelivery.then(value => ({ value }), error => ({ error }));
      try { await waitForLock(admin, "commerce_sales"); } finally { g.release(); }
      const winner = await firstDelivery;
      const secondResult = await outcome;
      assert.equal(winner.replayed, false);
      if (changed) {
        assert.ok("error" in secondResult);
        assert.match(String(secondResult.error), /استُخدم هذا الطلب مسبقًا ببيانات مختلفة/);
      } else {
        assert.ok("value" in secondResult, `duplicate delivery error: ${"error" in secondResult ? String(secondResult.error) : "unknown"}`);
        assert.deepEqual(secondResult.value, { id: winner.id, replayed: true });
      }
      assert.equal((await admin.query<{ n: string }>("SELECT count(*)::text AS n FROM commerce_collections WHERE request_id=$1::uuid", [input.requestId])).rows[0].n, "1");
      const after: string = (await admin.query<{ revision: string }>("SELECT revision::text AS revision FROM finance.accounts WHERE id=$1::bigint", [custody.id])).rows[0].revision;
      assert.equal(BigInt(after), BigInt(before) + 1n, "replay must not increment custody revision");
      assert.equal((await prisma.commerceSale.findUniqueOrThrow({ where: { id: 2n }, select: { revision: true } })).revision, saleRevision + 1, "replay or rejected duplicate must not increment sale revision");
    }

    // Distinct requests compete for a small unpaid invoice. The later snapshot
    // must retry after the invoice revision write and reject over-collection.
    const limitedSale: string = (await admin.query<{ id: string }>(`INSERT INTO commerce_sales(request_id,request_hash,branch_id,warehouse_id,customer_name,customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,created_by_id)
      VALUES ($1::uuid,repeat('d',64),1,1,'فاتورة حد اصطناعي','01000000000',15,0,15,0,15,0,3) RETURNING id::text`, [randomUUID()])).rows[0].id;
    const firstInput = { ...collection(), saleId: limitedSale };
    const secondInput = { ...collection(), saleId: limitedSale };
    const limitGate = gate();
    const limitedWinner = recordCommerceCollection(gatedCommerce(prisma, limitGate), 3n, firstInput);
    await limitGate.entered;
    const limitedLoser = recordCommerceCollection(prisma, 3n, secondInput).then(value => ({ value }), error => ({ error }));
    try { await waitForLock(admin, "commerce_sales"); } finally { limitGate.release(); }
    await limitedWinner;
    const limitedOutcome = await limitedLoser;
    assert.ok("error" in limitedOutcome);
    assert.match(String(limitedOutcome.error), /يزيد/);
    const limitedState = (await admin.query<{ n: string; amount: string; revision: number }>(`SELECT count(c.id)::text AS n,COALESCE(sum(c.amount),0)::text AS amount,s.revision
      FROM commerce_sales s LEFT JOIN commerce_collections c ON c.sale_id=s.id WHERE s.id=$1::bigint GROUP BY s.revision`, [limitedSale])).rows[0];
    assert.deepEqual(limitedState, { n: "1", amount: "10.00", revision: 1 });

    // The two initial-sale services also retry the normalized SQL conflict.
    const cat = await admin.query<{ id: string }>("INSERT INTO sales_item_categories(code,name_ar) VALUES ('CONCURRENT','اختبار') RETURNING id::text");
    const item = await admin.query<{ id: string }>("INSERT INTO sales_item_types(category_id,name_ar) VALUES ($1::bigint,'اختبار') RETURNING id::text", [cat.rows[0].id]);
    const base = { requestId: randomUUID(), branchId: "1", customerName: "عميل اصطناعي", customerPhone: "01000000000", discount: "0", initialPayment: "7", method: "CASH", lines: [{ typeId: item.rows[0].id, quantity: "1", unitPrice: "100", details: [] }] };
    const stock = { requestId: randomUUID(), warehouseId: "1", customerName: "عميل اصطناعي", customerPhone: "01000000000", discount: "0", initialPayment: "5", method: "CASH", lines: [{ productId: "4", quantity: "1", serialIds: [], expectedUnitPrice: "150", expectedTaxRateId: "3", expectedTaxKind: "VAT", expectedTaxRate: "14" }] };
    // Force a failure after the stock decrement using a nonexistent serial.
    // The invoice, initial collection, stock write and custody invalidation
    // must all roll back together; this exercises the current real service.
    const missingSerialSale={...stock,requestId:randomUUID(),lines:[{productId:"1",quantity:"1",serialIds:["999999999"],expectedUnitPrice:"18500",expectedTaxRateId:"2",expectedTaxKind:"SCHEDULE",expectedTaxRate:"5"}]};
    const stockBeforeFailure: {qty:string;cost:string}=(await admin.query<{qty:string;cost:string}>("SELECT qty_on_hand::text AS qty,avg_cost::text AS cost FROM stock_levels WHERE warehouse_id=1 AND product_id=1")).rows[0];
    const revisionBeforeFailure: string=(await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.accounts WHERE id=$1::bigint",[custody.id])).rows[0].revision;
    let stockDecrements=0;
    const observedStockDb: PrismaClient=new Proxy(prisma, {get(target,key,receiver) {
      if (key!=="$transaction") return Reflect.get(target,key,receiver);
      return (work:(tx:unknown)=>Promise<unknown>,options:unknown)=>target.$transaction(async tx=>{
        const observed=new Proxy(tx,{get(obj,prop,recv) {
          if(prop!=="$queryRaw") return Reflect.get(obj,prop,recv);
          return async (strings:TemplateStringsArray,...values:unknown[])=>{
            const result=await tx.$queryRaw(strings,...values);
            if(strings.join("?").includes('UPDATE "stock_levels"')) { assert.ok(Array.isArray(result) && result.length===1); stockDecrements++; }
            return result;
          };
        }});
        return work(observed);
      },options as never);
    }}) as PrismaClient;
    await assert.rejects(()=>createCommerceSale(observedStockDb,3n,missingSerialSale),/سيريال/);
    assert.equal(stockDecrements,1,"the attempted stock decrement ran before serial validation failed");
    assert.deepEqual((await admin.query<{qty:string;cost:string}>("SELECT qty_on_hand::text AS qty,avg_cost::text AS cost FROM stock_levels WHERE warehouse_id=1 AND product_id=1")).rows[0],stockBeforeFailure);
    assert.equal((await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.accounts WHERE id=$1::bigint",[custody.id])).rows[0].revision,revisionBeforeFailure);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_sales WHERE request_id=$1::uuid",[missingSerialSale.requestId])).rows[0].n,0);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_collections WHERE request_id=$1::uuid",[missingSerialSale.requestId])).rows[0].n,0);
    for (const sale of [() => createCatalogSale(prisma!, 3n, base), () => createCommerceSale(prisma!, 3n, stock)]) {
      const g = gate(); const request = requestCountFromHolder(gatedFinance(prisma, g), "1", { requestId: randomUUID(), accountId: custody.id, reason: "جرد موجه" });
      await g.entered; const rejected = sale();
      await waitForLock(admin, "accounts"); g.release(); const count = await request;
      await assert.rejects(rejected, /طلب تسوية أو جرد مفتوح/);
      await cancelCashCount(db, "1", { requestId: randomUUID(), countId: count.id, reason: "إلغاء الجرد" });
    }
    const rejectedCounts = await admin.query<{ n: string }>("SELECT count(*)::text AS n FROM commerce_sales WHERE request_id IN ($1::uuid,$2::uuid)", [base.requestId, stock.requestId]);
    assert.equal(rejectedCounts.rows[0].n, "0", "blocked initial sales leave no invoice");

    // Initial-sale replay on an isolated branch, with a real inventory item
    // and a catalog item. No laboratory vault/attribution adapter is involved.
    await admin.query(`INSERT INTO branches(id,code,name_ar,city,phone,invoice_prefix,opening_date,is_active,created_at)
      VALUES(410,'SYN410','فرع بيع أولي اصطناعي','تجربة','000','SY410',CURRENT_DATE,true,now())`);
    await admin.query(`INSERT INTO users(id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT 410,410,role_code,'موظف بيع اصطناعي','pg-initial-sale-410@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3`);
    const replayWarehouse: string=(await admin.query<{id:string}>(`INSERT INTO warehouses(branch_id,code,name_ar,is_default,holds_stock,is_active)
      VALUES(410,'SYN410W','مخزن اصطناعي',true,true,true) RETURNING id::text AS id`)).rows[0].id;
    await admin.query("INSERT INTO stock_levels(warehouse_id,product_id,qty_on_hand,avg_cost,updated_at) VALUES($1::bigint,2,5,30,now())",[replayWarehouse]);
    const replayCustody=await openAccount(db,"1",{requestId:randomUUID(),branchId:"410",kind:"CUSTODY",holderId:"410",openingAmount:"0",openingDate:today,counted:true},today);
    const catalogInitial={...base,requestId:randomUUID(),branchId:"410"};
    const inventoryInitial={...stock,requestId:randomUUID(),warehouseId:replayWarehouse,lines:[{productId:"2",quantity:"1",serialIds:[],expectedUnitPrice:"45",expectedTaxRateId:"3",expectedTaxKind:"VAT",expectedTaxRate:"14"}]};
    // Inject failures after the real initial-collection insert or after the
    // account revision update. This probes atomicity, not production behavior.
    let injectedCollections=0, injectedRevisions=0;
    let injectionPoint:"collection"|"revision"="collection";
    const failAfterInitialCollection: PrismaClient=new Proxy(prisma,{get(target,key,receiver) {
      if(key!=="$transaction") return Reflect.get(target,key,receiver);
      return (work:(tx:unknown)=>Promise<unknown>,options:unknown)=>target.$transaction(async tx=>{
        const wrapped=new Proxy(tx,{get(obj,prop,recv) {
          if(prop==="$queryRawUnsafe") return async (sql:string,...params:unknown[])=>{
            const result=await tx.$queryRawUnsafe(sql,...params);
            if(injectionPoint==="revision" && sql.includes("UPDATE finance.accounts SET revision=revision+1")) {
              injectedRevisions++; throw new Error("synthetic after custody revision");
            }
            return result;
          };
          if(prop!=="commerceCollection") return Reflect.get(obj,prop,recv);
          const delegate=tx.commerceCollection;
          return new Proxy(delegate,{get(d,k,r) {
            if(k!=="create") return Reflect.get(d,k,r);
            return async (...args: Parameters<typeof delegate.create>)=>{
              const result=await delegate.create(...args);
              if(injectionPoint==="collection") {injectedCollections++; throw new Error("synthetic after initial collection");}
              return result;
            };
          }});
        }});
        return work(wrapped);
      },options as never);
    }}) as PrismaClient;
    const revisionBeforeInjected: string=(await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.accounts WHERE id=$1::bigint",[replayCustody.id])).rows[0].revision;
    const rolledBackRequests: Array<{kind:"catalog"|"stock";body:typeof catalogInitial|typeof inventoryInitial}>=[];
    for (const point of ["collection","revision"] as const) {
      injectionPoint=point;
      for (const [kind,body] of [["catalog",{...catalogInitial,requestId:randomUUID()}],["stock",{...inventoryInitial,requestId:randomUUID()}]] as const) {
        const run=()=>kind==="catalog" ? createCatalogSale(failAfterInitialCollection,410n,body) : createCommerceSale(failAfterInitialCollection,410n,body);
        await assert.rejects(run,point==="collection" ? /synthetic after initial collection/ : /synthetic after custody revision/);
        rolledBackRequests.push({kind,body});
        assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_sales WHERE request_id=$1::uuid",[body.requestId])).rows[0].n,0);
        assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_collections WHERE request_id=$1::uuid",[body.requestId])).rows[0].n,0);
      }
    }
    assert.equal(injectedCollections,2); assert.equal(injectedRevisions,2);
    assert.equal((await admin.query<{qty:string}>("SELECT qty_on_hand::text AS qty FROM stock_levels WHERE warehouse_id=$1::bigint AND product_id=2",[replayWarehouse])).rows[0].qty,"5.00");
    assert.equal((await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.accounts WHERE id=$1::bigint",[replayCustody.id])).rows[0].revision,revisionBeforeInjected);
    const createdCatalog=await createCatalogSale(prisma,410n,catalogInitial);
    const createdInventory=await createCommerceSale(prisma,410n,inventoryInitial);
    assert.equal(createdCatalog.replayed,false); assert.equal(createdInventory.replayed,false);
    // Base identity must exactly match the current real services' saved sale
    // and initial collection hashes; the reviewed identity is not persisted.
    const parsedCatalogInitial=parseCatalogSaleInput(catalogInitial), parsedInventoryInitial=parseSaleInput(inventoryInitial);
    assert.ok(parsedCatalogInitial.ok);assert.ok(parsedInventoryInitial.ok);
    for(const [id,identity] of [[createdCatalog.id,vaultInitialIdentityTestOnly(410n,{kind:"CATALOG",input:parsedCatalogInitial.value},{})],[createdInventory.id,vaultInitialIdentityTestOnly(410n,{kind:"STOCK",input:parsedInventoryInitial.value},{})]] as const) {
      const hashes:{sale:string;collection:string}=(await admin.query<{sale:string;collection:string}>(`SELECT trim(s.request_hash) AS sale,trim(c.request_hash) AS collection
        FROM commerce_sales s JOIN commerce_collections c ON c.sale_id=s.id AND c.is_initial=true WHERE s.id=$1::bigint`,[id])).rows[0];
      assert.deepEqual(hashes,{sale:identity.baseHash,collection:identity.baseHash});
    }
    assert.equal((await admin.query<{qty:string}>("SELECT qty_on_hand::text AS qty FROM stock_levels WHERE warehouse_id=$1::bigint AND product_id=2",[replayWarehouse])).rows[0].qty,"4.00");
    const replayOpenCount=await requestCountFromHolder(db,"1",{requestId:randomUUID(),accountId:replayCustody.id,reason:"جرد لاختبار الإعادة"});
    const beforeInitialReplays: string=(await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.accounts WHERE id=$1::bigint",[replayCustody.id])).rows[0].revision;
    assert.deepEqual(await createCatalogSale(prisma,410n,catalogInitial),{id:createdCatalog.id,replayed:true});
    assert.deepEqual(await createCommerceSale(prisma,410n,inventoryInitial),{id:createdInventory.id,replayed:true});
    await assert.rejects(()=>createCatalogSale(prisma!,410n,{...catalogInitial,initialPayment:"8"}),/بيانات مختلفة/);
    await assert.rejects(()=>createCommerceSale(prisma!,410n,{...inventoryInitial,initialPayment:"6"}),/بيانات مختلفة/);
    await assert.rejects(()=>createCatalogSale(prisma!,410n,{...catalogInitial,requestId:randomUUID()}),/طلب تسوية أو جرد مفتوح/);
    await assert.rejects(()=>createCommerceSale(prisma!,410n,{...inventoryInitial,requestId:randomUUID()}),/طلب تسوية أو جرد مفتوح/);
    assert.equal((await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.accounts WHERE id=$1::bigint",[replayCustody.id])).rows[0].revision,beforeInitialReplays);
    assert.equal((await admin.query<{qty:string}>("SELECT qty_on_hand::text AS qty FROM stock_levels WHERE warehouse_id=$1::bigint AND product_id=2",[replayWarehouse])).rows[0].qty,"4.00");
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_collections WHERE sale_id IN ($1::bigint,$2::bigint)",[createdCatalog.id,createdInventory.id])).rows[0].n,2);
    await admin.query("UPDATE users SET status='SUSPENDED' WHERE id=410");
    await assert.rejects(()=>createCatalogSale(prisma!,410n,catalogInitial),/صلاحية/);
    await assert.rejects(()=>createCommerceSale(prisma!,410n,inventoryInitial),/صلاحية/);
    await admin.query("UPDATE users SET status='ACTIVE' WHERE id=410");
    await cancelCashCount(db,"1",{requestId:randomUUID(),countId:replayOpenCount.id,reason:"إلغاء جرد اختبار"});
    for (const {kind,body} of rolledBackRequests) {
      const run=()=>kind==="catalog" ? createCatalogSale(prisma!,410n,body) : createCommerceSale(prisma!,410n,body);
      const saved=await run(); assert.equal(saved.replayed,false);
      assert.deepEqual(await run(),{id:saved.id,replayed:true});
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_collections WHERE request_id=$1::uuid",[body.requestId])).rows[0].n,1);
    }
    assert.equal((await admin.query<{qty:string}>("SELECT qty_on_hand::text AS qty FROM stock_levels WHERE warehouse_id=$1::bigint AND product_id=2",[replayWarehouse])).rows[0].qty,"2.00");

    // Concurrent duplicate initial payments: pause the winner after its real
    // collection insert while it holds custody; the competing sale must retry.
    for (const [kind,changed] of [["catalog",false],["catalog",true],["stock",false],["stock",true]] as const) {
      const body=kind==="catalog" ? {...catalogInitial,requestId:randomUUID()} : {...inventoryInitial,requestId:randomUUID()};
      const competitor=changed ? {...body,initialPayment:kind==="catalog"?"8":"6"} : body;
      const beforeRev: string=(await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.accounts WHERE id=$1::bigint",[replayCustody.id])).rows[0].revision;
      const beforeQty: string=(await admin.query<{qty:string}>("SELECT qty_on_hand::text AS qty FROM stock_levels WHERE warehouse_id=$1::bigint AND product_id=2",[replayWarehouse])).rows[0].qty;
      const entered=gate(); let paused=false;
      const gatedInitial: PrismaClient=new Proxy(prisma,{get(target,key,receiver) {
        if(key!=="$transaction") return Reflect.get(target,key,receiver);
        return (work:(tx:unknown)=>Promise<unknown>,options:unknown)=>target.$transaction(async tx=>{
          const wrapped=new Proxy(tx,{get(obj,prop,recv) {
            if(prop!=="commerceCollection") return Reflect.get(obj,prop,recv);
            const delegate=tx.commerceCollection;
            return new Proxy(delegate,{get(d,k,r) {
              if(k!=="create") return Reflect.get(d,k,r);
              return async (...args:Parameters<typeof delegate.create>)=>{
                const result=await delegate.create(...args);
                if(!paused) {paused=true;entered.signal();await entered.wait;}
                return result;
              };
            }});
          }});
          return work(wrapped);
        },options as never);
      }}) as PrismaClient;
      const run=(client:PrismaClient,input:unknown)=>kind==="catalog" ? createCatalogSale(client,410n,input) : createCommerceSale(client,410n,input);
      const first=run(gatedInitial,body); await entered.entered;
      const second:Promise<{value:{id:string;replayed:boolean}}|{error:unknown}>=run(prisma,competitor).then(value=>({value}),error=>({error}));
      try {await waitForLock(admin,"accounts");} finally {entered.release();}
      const saved=await first;
      const result:{value:{id:string;replayed:boolean}}|{error:unknown}=await second;
      assert.equal(saved.replayed,false);
      if(changed) {assert.ok("error" in result);assert.match(String(result.error),/بيانات مختلفة/);}
      else {assert.ok("value" in result);assert.deepEqual(result.value,{id:saved.id,replayed:true});}
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_sales WHERE request_id=$1::uuid",[body.requestId])).rows[0].n,1);
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_collections WHERE request_id=$1::uuid",[body.requestId])).rows[0].n,1);
      assert.equal(BigInt((await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.accounts WHERE id=$1::bigint",[replayCustody.id])).rows[0].revision),BigInt(beforeRev)+1n);
      const afterQty: string=(await admin.query<{qty:string}>("SELECT qty_on_hand::text AS qty FROM stock_levels WHERE warehouse_id=$1::bigint AND product_id=2",[replayWarehouse])).rows[0].qty;
      assert.equal(Number(afterQty),Number(beforeQty)-(kind==="stock" ? 1 : 0));
    }

    // Two different cashiers, two custody rows, one last stock unit: the
    // inventory lock, not a shared custody lock, must prevent overselling.
    await admin.query(`INSERT INTO users(id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT 411,410,role_code,'موظف ثان اصطناعي','pg-initial-sale-411@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3`);
    const secondCustody=await openAccount(db,"1",{requestId:randomUUID(),branchId:"410",kind:"CUSTODY",holderId:"411",openingAmount:"0",openingDate:today,counted:true},today);
    // Synthetic replenishment only; not an inventory service or real stock event.
    await admin.query("UPDATE stock_levels SET qty_on_hand=1 WHERE warehouse_id=$1::bigint AND product_id=2",[replayWarehouse]);
    const winnerInput={...inventoryInitial,requestId:randomUUID()};
    const loserInput={...inventoryInitial,requestId:randomUUID()};
    const revisionsBeforeRace=(await admin.query<{id:string;revision:string}>("SELECT id::text AS id,revision::text AS revision FROM finance.accounts WHERE id IN ($1::bigint,$2::bigint) ORDER BY id",[replayCustody.id,secondCustody.id])).rows;
    const stockGate=gate(); let stockPaused=false;
    const lockedStockSale: PrismaClient=new Proxy(prisma,{get(target,key,receiver) {
      if(key!=="$transaction") return Reflect.get(target,key,receiver);
      return (work:(tx:unknown)=>Promise<unknown>,options:unknown)=>target.$transaction(async tx=>{
        const wrapped=new Proxy(tx,{get(obj,prop,recv) {
          if(prop!=="$queryRaw") return Reflect.get(obj,prop,recv);
          return async (strings:TemplateStringsArray,...values:unknown[])=>{
            const result=await tx.$queryRaw(strings,...values);
            if(!stockPaused && strings.join("?").includes('UPDATE "stock_levels"')) {
              assert.ok(Array.isArray(result) && result.length===1);stockPaused=true;stockGate.signal();await stockGate.wait;
            }
            return result;
          };
        }});
        return work(wrapped);
      },options as never);
    }}) as PrismaClient;
    const stockWinner=createCommerceSale(lockedStockSale,410n,winnerInput); await stockGate.entered;
    const stockLoser:Promise<{value:{id:string;replayed:boolean}}|{error:unknown}>=createCommerceSale(prisma,411n,loserInput).then(value=>({value}),error=>({error}));
    try {await waitForLock(admin,"stock_levels");} finally {stockGate.release();}
    const winningSale=await stockWinner;
    const losingSale:{value:{id:string;replayed:boolean}}|{error:unknown}=await stockLoser;
    assert.ok("error" in losingSale);assert.match(String(losingSale.error),/الكمية المتاحة/);
    assert.equal((await admin.query<{qty:string}>("SELECT qty_on_hand::text AS qty FROM stock_levels WHERE warehouse_id=$1::bigint AND product_id=2",[replayWarehouse])).rows[0].qty,"0.00");
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_sales WHERE request_id=$1::uuid",[loserInput.requestId])).rows[0].n,0);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_collections WHERE request_id=$1::uuid",[loserInput.requestId])).rows[0].n,0);
    const revisionsAfterRace=(await admin.query<{id:string;revision:string}>("SELECT id::text AS id,revision::text AS revision FROM finance.accounts WHERE id IN ($1::bigint,$2::bigint) ORDER BY id",[replayCustody.id,secondCustody.id])).rows;
    for(const before of revisionsBeforeRace) {
      const after=revisionsAfterRace.find(row=>row.id===before.id)!;
      assert.equal(BigInt(after.revision),BigInt(before.revision)+(before.id===replayCustody.id?1n:0n));
    }
    assert.deepEqual(await createCommerceSale(prisma,410n,winnerInput),{id:winningSale.id,replayed:true});
    await assert.rejects(()=>createCommerceSale(prisma!,411n,loserInput),/الكمية المتاحة/);

    // Reversed input line order is normalized by the real sale parser; both
    // transactions contend on the same first stock row rather than deadlocking.
    await admin.query("UPDATE stock_levels SET qty_on_hand=2 WHERE warehouse_id=$1::bigint AND product_id=2",[replayWarehouse]);
    await admin.query("INSERT INTO stock_levels(warehouse_id,product_id,qty_on_hand,avg_cost,updated_at) VALUES($1::bigint,3,2,80,now())",[replayWarehouse]);
    const line2=inventoryInitial.lines[0];
    const line3={productId:"3",quantity:"1",serialIds:[],expectedUnitPrice:"600",expectedTaxRateId:"3",expectedTaxKind:"VAT",expectedTaxRate:"14"};
    const oppositeA={...inventoryInitial,requestId:randomUUID(),lines:[line2,line3]};
    const oppositeB={...inventoryInitial,requestId:randomUUID(),lines:[line3,line2]};
    const orderedGate=gate();let orderedPaused=false, attemptsB=0;
    const orderedDb:PrismaClient=new Proxy(prisma,{get(target,key,receiver) {
      if(key!=="$transaction") return Reflect.get(target,key,receiver);
      return (work:(tx:unknown)=>Promise<unknown>,options:unknown)=>target.$transaction(async tx=>{
        const wrapped=new Proxy(tx,{get(obj,prop,recv) {
          if(prop!=="$queryRaw") return Reflect.get(obj,prop,recv);
          return async (strings:TemplateStringsArray,...values:unknown[])=>{
            const result=await tx.$queryRaw(strings,...values);
            if(!orderedPaused && strings.join("?").includes('UPDATE "stock_levels"')) {
              assert.ok(Array.isArray(result) && result.length===1);
              assert.ok(values.some(value=>value===2n),"first locked product is the lower ID");
              orderedPaused=true;orderedGate.signal();await orderedGate.wait;
            }
            return result;
          };
        }});
        return work(wrapped);
      },options as never);
    }}) as PrismaClient;
    const countedDb:PrismaClient=new Proxy(prisma,{get(target,key,receiver) {
      if(key!=="$transaction") return Reflect.get(target,key,receiver);
      return (work:(tx:unknown)=>Promise<unknown>,options:unknown)=>{attemptsB++;return target.$transaction(work as never,options as never);};
    }}) as PrismaClient;
    const orderedFirst=createCommerceSale(orderedDb,410n,oppositeA);await orderedGate.entered;
    const orderedSecond=createCommerceSale(countedDb,411n,oppositeB);
    try {await waitForLock(admin,"stock_levels");} finally {orderedGate.release();}
    const [orderedSavedA,orderedSavedB]=await Promise.all([orderedFirst,orderedSecond]);
    assert.ok(attemptsB>=2,"the waiting sale retries its old serializable snapshot");
    assert.equal(orderedSavedA.replayed,false);assert.equal(orderedSavedB.replayed,false);
    const remainingStock=(await admin.query<{product:string;qty:string}>("SELECT product_id::text AS product,qty_on_hand::text AS qty FROM stock_levels WHERE warehouse_id=$1::bigint AND product_id IN (2,3) ORDER BY product_id",[replayWarehouse])).rows;
    assert.deepEqual(remainingStock,[{product:"2",qty:"0.00"},{product:"3",qty:"0.00"}]);
    for(const input of [oppositeA,oppositeB]) {
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_sales WHERE request_id=$1::uuid",[input.requestId])).rows[0].n,1);
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_collections WHERE request_id=$1::uuid",[input.requestId])).rows[0].n,1);
    }
    const revAfterOrdered=(await admin.query<{id:string;revision:string}>("SELECT id::text AS id,revision::text AS revision FROM finance.accounts WHERE id IN ($1::bigint,$2::bigint) ORDER BY id",[replayCustody.id,secondCustody.id])).rows;
    assert.deepEqual(await createCommerceSale(prisma,410n,oppositeA),{id:orderedSavedA.id,replayed:true});
    assert.deepEqual(await createCommerceSale(prisma,410n,{...oppositeA,lines:[line3,line2]}),{id:orderedSavedA.id,replayed:true},"reordering lines preserves request identity");
    assert.deepEqual(await createCommerceSale(prisma,411n,oppositeB),{id:orderedSavedB.id,replayed:true});
    assert.deepEqual(await createCommerceSale(prisma,411n,{...oppositeB,lines:[line2,line3]}),{id:orderedSavedB.id,replayed:true});
    await assert.rejects(()=>createCommerceSale(prisma!,410n,{...oppositeA,lines:[line2,{...line3,quantity:"2"}]}),/بيانات مختلفة/);
    assert.deepEqual((await admin.query<{id:string;revision:string}>("SELECT id::text AS id,revision::text AS revision FROM finance.accounts WHERE id IN ($1::bigint,$2::bigint) ORDER BY id",[replayCustody.id,secondCustody.id])).rows,revAfterOrdered);
    assert.deepEqual((await admin.query<{product:string;qty:string}>("SELECT product_id::text AS product,qty_on_hand::text AS qty FROM stock_levels WHERE warehouse_id=$1::bigint AND product_id IN (2,3) ORDER BY product_id",[replayWarehouse])).rows,remainingStock);

    // Branch access is checked on replay as well. Direct SQL deliberately
    // creates this otherwise guarded synthetic state; it is not an admin path.
    await admin.query("UPDATE branches SET is_active=false WHERE id=410");
    await assert.rejects(()=>createCatalogSale(prisma!,410n,catalogInitial),/غير نشط|صلاحية/);
    await assert.rejects(()=>createCommerceSale(prisma!,410n,inventoryInitial),/غير نشط|صلاحية/);
    await admin.query("UPDATE branches SET is_active=true WHERE id=410");
    assert.deepEqual(await createCatalogSale(prisma,410n,catalogInitial),{id:createdCatalog.id,replayed:true});
    assert.deepEqual(await createCommerceSale(prisma,410n,inventoryInitial),{id:createdInventory.id,replayed:true});
    // Existing sale parsers discard the experimental receipt field. Supplying
    // it to a current old request is therefore not a recorded acknowledgement.
    const extraCatalog={...catalogInitial,vaultReceived:true},extraInventory={...inventoryInitial,vaultReceived:true};
    const parsedExtraCatalog=parseCatalogSaleInput(extraCatalog),parsedExtraInventory=parseSaleInput(extraInventory);
    assert.ok(parsedExtraCatalog.ok);assert.ok(parsedExtraInventory.ok);
    assert.equal(Object.hasOwn(parsedExtraCatalog.value,"vaultReceived"),false);
    assert.equal(Object.hasOwn(parsedExtraInventory.value,"vaultReceived"),false);
    assert.deepEqual(await createCatalogSale(prisma,410n,extraCatalog),{id:createdCatalog.id,replayed:true});
    assert.deepEqual(await createCommerceSale(prisma,410n,extraInventory),{id:createdInventory.id,replayed:true});
    // Both sale paths share the same request namespace; a request already
    // saved by the other path is a conflict, not a cross-path replay.
    await assert.rejects(()=>createCatalogSale(prisma!,410n,{...catalogInitial,requestId:inventoryInitial.requestId}),/بيانات مختلفة/);
    await assert.rejects(()=>createCommerceSale(prisma!,410n,{...inventoryInitial,requestId:catalogInitial.requestId}),/بيانات مختلفة/);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_collections WHERE sale_id IN ($1::bigint,$2::bigint)",[createdCatalog.id,createdInventory.id])).rows[0].n,2);
    assert.deepEqual((await admin.query<{id:string;revision:string}>("SELECT id::text AS id,revision::text AS revision FROM finance.accounts WHERE id IN ($1::bigint,$2::bigint) ORDER BY id",[replayCustody.id,secondCustody.id])).rows,revAfterOrdered);

    // The two sale routes also compete for one global request ID across
    // different actors/custodies. A duplicate insert must never create the
    // losing invoice, payment, stock decrement or custody revision.
    for(const winnerKind of ["catalog","stock"] as const) {
      await admin.query("UPDATE stock_levels SET qty_on_hand=1 WHERE warehouse_id=$1::bigint AND product_id=2",[replayWarehouse]);
      const sharedId=randomUUID();
      const catalogBody={...catalogInitial,requestId:sharedId};
      const stockBody={...inventoryInitial,requestId:sharedId};
      const winnerActor=410n,loserActor=411n;
      const revisionsBefore:Array<{id:string;revision:string}>=(await admin.query<{id:string;revision:string}>("SELECT id::text AS id,revision::text AS revision FROM finance.accounts WHERE id IN ($1::bigint,$2::bigint) ORDER BY id",[replayCustody.id,secondCustody.id])).rows;
      const uniqueGate=gate();let uniquePaused=false;
      const uniqueWinner:PrismaClient=new Proxy(prisma,{get(target,key,receiver) {
        if(key!=="$transaction") return Reflect.get(target,key,receiver);
        return (work:(tx:unknown)=>Promise<unknown>,options:unknown)=>target.$transaction(async tx=>{
          const wrapped=new Proxy(tx,{get(obj,prop,recv) {
            if(prop!=="commerceCollection") return Reflect.get(obj,prop,recv);
            const delegate=tx.commerceCollection;
            return new Proxy(delegate,{get(d,k,r) {
              if(k!=="create") return Reflect.get(d,k,r);
              return async (...args:Parameters<typeof delegate.create>)=>{
                const result=await delegate.create(...args);
                if(!uniquePaused){uniquePaused=true;uniqueGate.signal();await uniqueGate.wait;}
                return result;
              };
            }});
          }});
          return work(wrapped);
        },options as never);
      }}) as PrismaClient;
      const winner=winnerKind==="catalog"?createCatalogSale(uniqueWinner,winnerActor,catalogBody):createCommerceSale(uniqueWinner,winnerActor,stockBody);
      await uniqueGate.entered;
      const loser:Promise<{value:{id:string;replayed:boolean}}|{error:unknown}>=(winnerKind==="catalog"?createCommerceSale(prisma,loserActor,stockBody):createCatalogSale(prisma,loserActor,catalogBody)).then(value=>({value}),error=>({error}));
      try {await waitForLock(admin,"commerce_sales");} finally {uniqueGate.release();}
      const saved=await winner;
      const outcome:{value:{id:string;replayed:boolean}}|{error:unknown}=await loser;
      assert.ok("error" in outcome);assert.match(String(outcome.error),/بيانات مختلفة/);
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_sales WHERE request_id=$1::uuid",[sharedId])).rows[0].n,1);
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_collections WHERE request_id=$1::uuid",[sharedId])).rows[0].n,1);
      assert.equal((await admin.query<{qty:string}>("SELECT qty_on_hand::text AS qty FROM stock_levels WHERE warehouse_id=$1::bigint AND product_id=2",[replayWarehouse])).rows[0].qty,winnerKind==="stock"?"0.00":"1.00");
      const revisionsAfter:Array<{id:string;revision:string}>=(await admin.query<{id:string;revision:string}>("SELECT id::text AS id,revision::text AS revision FROM finance.accounts WHERE id IN ($1::bigint,$2::bigint) ORDER BY id",[replayCustody.id,secondCustody.id])).rows;
      for(const before of revisionsBefore) assert.equal(BigInt(revisionsAfter.find(row=>row.id===before.id)!.revision),BigInt(before.revision)+(before.id===replayCustody.id?1n:0n));
      assert.deepEqual(await (winnerKind==="catalog"?createCatalogSale(prisma,winnerActor,catalogBody):createCommerceSale(prisma,winnerActor,stockBody)),{id:saved.id,replayed:true});
    }

    // Observe selected ordering in the real initial-sale services. This trace
    // deliberately ignores uninstrumented reads/locks and is not a full lock map.
    await admin.query("UPDATE stock_levels SET qty_on_hand=2 WHERE warehouse_id=$1::bigint AND product_id=2",[replayWarehouse]);
    for(const kind of ["catalog","stock"] as const) {
      const events:string[]=[];
      const traced:PrismaClient=new Proxy(prisma,{get(target,key,receiver) {
        if(key!=="$transaction") return Reflect.get(target,key,receiver);
        return (work:(tx:unknown)=>Promise<unknown>,options:unknown)=>target.$transaction(async tx=>{
          const wrapped=new Proxy(tx,{get(obj,prop,recv) {
            if(prop==="$queryRawUnsafe") return async (sql:string,...params:unknown[])=>{
              if(sql.includes("FROM finance.accounts WHERE branch_id=") && sql.includes("FOR UPDATE"))events.push("custody_lock");
              if(sql.includes("UPDATE finance.accounts SET revision=revision+1"))events.push("revision_update");
              return tx.$queryRawUnsafe(sql,...params);
            };
            if(prop==="$queryRaw") return async (sql:TemplateStringsArray,...params:unknown[])=>{
              if(sql.join("?").includes('UPDATE "stock_levels"')) events.push("stock_update");
              return tx.$queryRaw(sql,...params);
            };
            if(prop==="commerceSale") {
              const delegate=tx.commerceSale;
              return new Proxy(delegate,{get(d,k,r) {
                if(k==="findUnique") return async (...args:Parameters<typeof delegate.findUnique>)=>{events.push("sale_lookup");return delegate.findUnique(...args);};
                if(k==="create") return async (...args:Parameters<typeof delegate.create>)=>{events.push("sale_create");return delegate.create(...args);};
                return Reflect.get(d,k,r);
              }});
            }
            if(prop==="commerceCollection") {
              const delegate=tx.commerceCollection;
              return new Proxy(delegate,{get(d,k,r) {
                if(k==="create") return async (...args:Parameters<typeof delegate.create>)=>{events.push("collection_create");return delegate.create(...args);};
                return Reflect.get(d,k,r);
              }});
            }
            return Reflect.get(obj,prop,recv);
          }});
          return work(wrapped);
        },options as never);
      }}) as PrismaClient;
      const body=kind==="catalog"?{...catalogInitial,requestId:randomUUID()}:{...inventoryInitial,requestId:randomUUID()};
      const run=()=>kind==="catalog"?createCatalogSale(traced,410n,body):createCommerceSale(traced,410n,body);
      const saved=await run();
      assert.deepEqual(events,kind==="stock"?["sale_lookup","custody_lock","sale_create","stock_update","collection_create","revision_update"]:["sale_lookup","custody_lock","sale_create","collection_create","revision_update"]);
      events.length=0;
      assert.deepEqual(await run(),{id:saved.id,replayed:true});
      assert.deepEqual(events,["sale_lookup"],"saved replay bypasses these new-write locks and effects after current authorization");
    }

    // Trace selected current-service stages of a LATER collection separately:
    // unlike initial sale, replay still locks the existing invoice first.
    const collectTrace:string[]=[];
    const tracedCollection:PrismaClient=new Proxy(prisma,{get(target,key,receiver) {
      if(key!=="$transaction") return Reflect.get(target,key,receiver);
      return (work:(tx:unknown)=>Promise<unknown>,options:unknown)=>target.$transaction(async tx=>{
        const wrapped=new Proxy(tx,{get(obj,prop,recv) {
          if(prop==="$queryRaw") return async (sql:TemplateStringsArray,...params:unknown[])=>{
            if(sql.join("?").includes('FROM "commerce_sales"') && sql.join("?").includes("FOR UPDATE"))collectTrace.push("invoice_lock");
            return tx.$queryRaw(sql,...params);
          };
          if(prop==="$queryRawUnsafe") return async (sql:string,...params:unknown[])=>{
            if(sql.includes("FROM finance.accounts WHERE branch_id=") && sql.includes("FOR UPDATE"))collectTrace.push("custody_lock");
            if(sql.includes("UPDATE finance.accounts SET revision=revision+1"))collectTrace.push("custody_revision");
            return tx.$queryRawUnsafe(sql,...params);
          };
          if(prop==="commerceSale") {
            const delegate=tx.commerceSale;
            return new Proxy(delegate,{get(d,k,r) {
              if(k==="update") return async (...args:Parameters<typeof delegate.update>)=>{collectTrace.push("invoice_revision");return delegate.update(...args);};
              return Reflect.get(d,k,r);
            }});
          }
          if(prop==="commerceCollection") {
            const delegate=tx.commerceCollection;
            return new Proxy(delegate,{get(d,k,r) {
              if(k==="findUnique") return async (...args:Parameters<typeof delegate.findUnique>)=>{collectTrace.push("collection_lookup");return delegate.findUnique(...args);};
              if(k==="create") return async (...args:Parameters<typeof delegate.create>)=>{collectTrace.push("collection_create");return delegate.create(...args);};
              return Reflect.get(d,k,r);
            }});
          }
          return Reflect.get(obj,prop,recv);
        }});
        return work(wrapped);
      },options as never);
    }}) as PrismaClient;
    const laterInput={requestId:randomUUID(),saleId:createdCatalog.id,amount:"5",method:"CASH",actuallyPaid:false};
    const laterSaved=await recordCommerceCollection(tracedCollection,410n,laterInput);
    assert.deepEqual(collectTrace,["invoice_lock","collection_lookup","invoice_revision","custody_lock","collection_create","custody_revision"]);
    collectTrace.length=0;
    assert.deepEqual(await recordCommerceCollection(tracedCollection,410n,laterInput),{id:laterSaved.id,replayed:true});
    assert.deepEqual(collectTrace,["invoice_lock","collection_lookup"]);

    // Simulate a duplicate-key conflict after the original transaction has
    // authorized, then suspend the actor before the duplicate fallback reads
    // the saved request. This deliberately uses synthetic fault injection and
    // a direct fixture mutation, not a supported directory suspension path.
    for(const kind of ["catalog","stock","collection"] as const) for(const mode of ["active","suspended"] as const) {
      let inject=true;
      const conflictDb:PrismaClient=new Proxy(prisma,{get(target,key,receiver) {
        if(key!=="$transaction") return Reflect.get(target,key,receiver);
        return async (work:(tx:unknown)=>Promise<unknown>,options:unknown)=>{
          if(!inject) return target.$transaction(work as never,options as never);
          inject=false;
          try {
            return await target.$transaction(async tx=>{
              const wrapped=new Proxy(tx,{get(obj,prop,recv) {
                const wanted=kind==="collection"?"commerceCollection":"commerceSale";
                if(prop!==wanted) return Reflect.get(obj,prop,recv);
                const delegate=kind==="collection"?tx.commerceCollection:tx.commerceSale;
                return new Proxy(delegate,{get(d,k,r) {
                  if(k!=="findUnique") return Reflect.get(d,k,r);
                  return async (args:never)=>{if(kind==="collection") await tx.commerceCollection.findUnique(args); else await tx.commerceSale.findUnique(args);throw Object.assign(new Error("synthetic duplicate"),{code:"P2002"});};
                }});
              }});
              return work(wrapped);
            },options as never);
          } catch(error) {
            if(mode==="suspended") await admin!.query("UPDATE users SET status='SUSPENDED' WHERE id=410");
            throw error;
          }
        };
      }}) as PrismaClient;
      const run=()=>kind==="catalog"?createCatalogSale(conflictDb,410n,catalogInitial):kind==="stock"?createCommerceSale(conflictDb,410n,inventoryInitial):recordCommerceCollection(conflictDb,410n,laterInput);
      try {
        if(mode==="suspended") await assert.rejects(run,/صلاحية/);
        else {
          const id=kind==="catalog"?createdCatalog.id:kind==="stock"?createdInventory.id:laterSaved.id;
          assert.deepEqual(await run(),{id,replayed:true},"authorized duplicate recovery remains idempotent");
        }
      } finally {if(mode==="suspended") await admin.query("UPDATE users SET status='ACTIVE' WHERE id=410");}
    }

    await checkInventoryDuplicateRecovery(admin,prisma,replayWarehouse);
    await checkReceivingDuplicateRecovery(admin,prisma,replayWarehouse);

    // Real return/refund service races on freshly created synthetic invoices.
    // The service line is non-stock, so this specifically checks invoice and
    // money serialization, not serial-number or inventory-lock concurrency.
    const newServiceInvoice = async () => {
      const made = await createCommerceSale(prisma!, 3n, { ...stock, requestId: randomUUID(), method: "CARD", initialPayment: "10" });
      const line = await prisma!.commerceSaleLine.findFirstOrThrow({ where: { saleId: BigInt(made.id) }, select: { id: true } });
      return { saleId: made.id, lineId: line.id.toString() };
    };
    const makeReturn = ({ saleId, lineId }: { saleId: string; lineId: string }) => ({ requestId: randomUUID(), saleId, cancel: false, accepted: true, lines: [{ saleLineId: lineId, quantity: "1", serialIds: [] }] });
    const replayInvoice = await newServiceInvoice();
    const replayInput = makeReturn(replayInvoice);
    const returnGate = gate();
    const firstReturn = returnCommerceSale(gatedSale(prisma, returnGate), 1n, replayInput);
    await returnGate.entered;
    const secondReturn = returnCommerceSale(prisma, 1n, replayInput).then(value => ({ value }), error => ({ error }));
    try { await waitForLock(admin, "commerce_sales"); } finally { returnGate.release(); }
    const returnWinner = await firstReturn;
    const returnReplay = await secondReturn;
    assert.ok("value" in returnReplay, `concurrent return replay failed: ${"error" in returnReplay ? String(returnReplay.error) : "unknown"}`);
    assert.deepEqual(returnReplay.value, { id: returnWinner.id, replayed: true });
    assert.equal(await prisma.commerceReturn.count({ where: { saleId: BigInt(replayInvoice.saleId) } }), 1);
    assert.equal((await prisma.commerceSale.findUniqueOrThrow({ where: { id: BigInt(replayInvoice.saleId) }, select: { revision: true } })).revision, 1);

    const contestedInvoice = await newServiceInvoice();
    const contestedInput = makeReturn(contestedInvoice);
    const contestGate = gate();
    const firstContested = returnCommerceSale(gatedSale(prisma, contestGate), 1n, contestedInput);
    await contestGate.entered;
    const secondContested = returnCommerceSale(prisma, 1n, { ...contestedInput, requestId: randomUUID() }).then(value => ({ value }), error => ({ error }));
    try { await waitForLock(admin, "commerce_sales"); } finally { contestGate.release(); }
    await firstContested;
    const contestedResult = await secondContested;
    assert.ok("error" in contestedResult, "a second full return must be rejected");
    assert.match(String(contestedResult.error), /كمية المرتجع تتجاوز المتاح/);
    assert.equal(await prisma.commerceReturn.count({ where: { saleId: BigInt(contestedInvoice.saleId) } }), 1);
    assert.equal(await prisma.commerceReturnLine.count({ where: { saleLineId: BigInt(contestedInvoice.lineId) } }), 1);
    assert.equal((await prisma.commerceSale.findUniqueOrThrow({ where: { id: BigInt(contestedInvoice.saleId) }, select: { revision: true } })).revision, 1);

    const replayRefundInput = { requestId: randomUUID(), saleId: replayInvoice.saleId, amount: "6", method: "CARD", actuallyPaid: true };
    const replayRefundGate = gate();
    const firstReplayRefund = recordCommerceRefund(gatedSale(prisma, replayRefundGate), 1n, replayRefundInput);
    await replayRefundGate.entered;
    const secondReplayRefund = recordCommerceRefund(prisma, 1n, replayRefundInput).then(value => ({ value }), error => ({ error }));
    try { await waitForLock(admin, "commerce_sales"); } finally { replayRefundGate.release(); }
    const savedRefund = await firstReplayRefund;
    const replayRefund = await secondReplayRefund;
    assert.ok("value" in replayRefund, `concurrent refund replay failed: ${"error" in replayRefund ? String(replayRefund.error) : "unknown"}`);
    assert.deepEqual(replayRefund.value, { id: savedRefund.id, replayed: true });
    assert.equal(await prisma.commerceRefund.count({ where: { saleId: BigInt(replayInvoice.saleId) } }), 1);
    assert.equal((await prisma.commerceSale.findUniqueOrThrow({ where: { id: BigInt(replayInvoice.saleId) }, select: { revision: true } })).revision, 2);

    // Exercise duplicate recovery for refunds, returns, discount settings and
    // catalog admin after current access changes. P2002 and suspension are
    // deliberately injected in disposable fixtures, not a real admin action.
    const currentDiscount=(await admin.query<{staff:number;manager:number}>("SELECT staff_discount_bps AS staff,manager_discount_bps AS manager FROM commerce_settings WHERE id=1")).rows[0];
    const savedDiscountInput={requestId:randomUUID(),percent:String(currentDiscount.staff/100),managerPercent:String(currentDiscount.manager/100)};
    const savedDiscount=await changeStaffDiscountLimit(prisma,1n,savedDiscountInput);
    const categoryInput={requestId:randomUUID(),code:"CONFLICT_TEST",nameAr:"تصنيف تعارض اصطناعي",sortOrder:5};
    const savedCategory=await createSalesCategory(prisma,1n,categoryInput);
    for(const kind of ["return","refund","discount","catalogAdmin","catalogOther","catalogChanged"] as const) for(const mode of ["active","suspended"] as const) {
      let inject=true;
      const duplicateDb:PrismaClient=new Proxy(prisma,{get(target,key,receiver) {
        if(key!=="$transaction") return Reflect.get(target,key,receiver);
        return async (work:(tx:unknown)=>Promise<unknown>,options:unknown)=>{
          if(!inject) return target.$transaction(work as never,options as never);
          inject=false;
          try {
            return await target.$transaction(async tx=>{
              const name=kind==="return"?"commerceReturn":kind==="refund"?"commerceRefund":kind==="discount"?"commerceSettingsChange":"salesCatalogAudit";
              const wrapped=new Proxy(tx,{get(obj,prop,recv) {
                if(prop!==name) return Reflect.get(obj,prop,recv);
                const delegate=Reflect.get(obj,prop,recv) as {findUnique:(args:unknown)=>Promise<unknown>};
                return new Proxy(delegate,{get(d,k,r) {
                  if(k!=="findUnique") return Reflect.get(d,k,r);
                  return async (args:unknown)=>{await delegate.findUnique(args);throw Object.assign(new Error("synthetic duplicate"),{code:"P2002"});};
                }});
              }});
              return work(wrapped);
            },options as never);
          } catch(error) {
            if(mode==="suspended") await admin!.query("UPDATE users SET status='SUSPENDED' WHERE id=1");
            throw error;
          }
        };
      }}) as PrismaClient;
      const run=()=>kind==="return"?returnCommerceSale(duplicateDb,1n,replayInput):kind==="refund"?recordCommerceRefund(duplicateDb,1n,replayRefundInput):kind==="discount"?changeStaffDiscountLimit(duplicateDb,1n,savedDiscountInput):kind==="catalogOther"?createSalesType(duplicateDb,1n,{requestId:categoryInput.requestId,categoryId:savedCategory.id,nameAr:"صنف اصطناعي",sortOrder:1}):createSalesCategory(duplicateDb,1n,kind==="catalogChanged"?{...categoryInput,nameAr:"اسم مختلف"}:categoryInput);
      try {
        if(mode==="suspended") await assert.rejects(run,/صلاحية|للمدير/);
        else if(kind==="catalogOther") await assert.rejects(run,/عملية مختلفة/);
        else if(kind==="catalogChanged") await assert.rejects(run,/بيانات مختلفة/);
        else {
          const id=kind==="return"?returnWinner.id:kind==="refund"?savedRefund.id:kind==="discount"?savedDiscount.id:savedCategory.id;
          assert.deepEqual(await run(),{id,replayed:true});
        }
      } finally {if(mode==="suspended") await admin.query("UPDATE users SET status='ACTIVE' WHERE id=1");}
    }

    const refundInput = { requestId: randomUUID(), saleId: contestedInvoice.saleId, amount: "6", method: "CARD", actuallyPaid: true };
    const refundGate = gate();
    const firstRefund = recordCommerceRefund(gatedSale(prisma, refundGate), 1n, refundInput);
    await refundGate.entered;
    const excessRefund = recordCommerceRefund(prisma, 1n, { ...refundInput, requestId: randomUUID() }).then(value => ({ value }), error => ({ error }));
    try { await waitForLock(admin, "commerce_sales"); } finally { refundGate.release(); }
    const refundWinner = await firstRefund;
    const excessOutcome = await excessRefund;
    assert.ok("error" in excessOutcome);
    assert.match(String(excessOutcome.error), /يزيد/);
    assert.deepEqual(await recordCommerceRefund(prisma, 1n, refundInput), { id: refundWinner.id, replayed: true });
    assert.equal(await prisma.commerceRefund.count({ where: { saleId: BigInt(contestedInvoice.saleId) } }), 1);
    assert.equal((await prisma.commerceSale.findUniqueOrThrow({ where: { id: BigInt(contestedInvoice.saleId) }, select: { revision: true } })).revision, 2);

    // Collection versus a full return: the invoice lock must serialize the
    // customer-position calculation in both orders. These are card collections,
    // not a test of allocation or cash movements.
    for (const returnFirst of [true, false]) {
      const invoice = await newServiceInvoice();
      const returnInput = makeReturn(invoice);
      const collectInput = { requestId: randomUUID(), saleId: invoice.saleId, amount: "20", method: "CARD", actuallyPaid: false };
      const g = gate();
      const leader = returnFirst
        ? returnCommerceSale(gatedSale(prisma, g), 1n, returnInput)
        : recordCommerceCollection(gatedSale(prisma, g), 3n, collectInput);
      await g.entered;
      const follower = (returnFirst
        ? recordCommerceCollection(prisma, 3n, collectInput)
        : returnCommerceSale(prisma, 1n, returnInput)).then(value => ({ value }), error => ({ error }));
      try { await waitForLock(admin, "commerce_sales"); } finally { g.release(); }
      await leader;
      const result = await follower;
      if (returnFirst) {
        assert.ok("error" in result);
        assert.match(String(result.error), /يزيد/);
        assert.equal(await prisma.commerceCollection.count({ where: { requestId: collectInput.requestId } }), 0);
      } else {
        assert.ok("value" in result, `return after collection failed: ${"error" in result ? String(result.error) : "unknown"}`);
        assert.equal(await prisma.commerceCollection.count({ where: { requestId: collectInput.requestId } }), 1);
      }
      assert.equal(await prisma.commerceReturn.count({ where: { saleId: BigInt(invoice.saleId) } }), 1);
      assert.equal((await prisma.commerceSale.findUniqueOrThrow({ where: { id: BigInt(invoice.saleId) }, select: { revision: true } })).revision, returnFirst ? 1 : 2);
    }

    // Cash refunds on different invoices compete for one account. The later
    // transaction must re-read its balance after the first debit; without
    // explicit negative acknowledgement it cannot spend the same cash twice.
    await admin.query(`INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT 40,1,role_code,'موظف رد اصطناعي','pg-cash-refund@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3`);
    const refundAccount = await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "CUSTODY", holderId: "40", openingAmount: "10", openingDate: today, counted: true }, today);
    const cashInvoiceA = await newServiceInvoice(), cashInvoiceB = await newServiceInvoice();
    await returnCommerceSale(prisma, 1n, makeReturn(cashInvoiceA));
    await returnCommerceSale(prisma, 1n, makeReturn(cashInvoiceB));
    const cashRefundA = { requestId: randomUUID(), saleId: cashInvoiceA.saleId, amount: "6", method: "CASH", actuallyPaid: true, accountId: refundAccount.id, negativeAcknowledged: false, checkpointRef: "OPENING", timing: "AFTER_REVIEWED_CHECKPOINT" };
    const cashRefundB = { ...cashRefundA, requestId: randomUUID(), saleId: cashInvoiceB.saleId };
    const refundAccountGate = gate();
    const paidFirst = recordCommerceRefund(gatedRefundAccount(prisma, refundAccountGate), 1n, cashRefundA);
    await refundAccountGate.entered;
    const paidSecond = recordCommerceRefund(prisma, 1n, cashRefundB).then(value => ({ value }), error => ({ error }));
    try { await waitForLock(admin, "accounts"); } finally { refundAccountGate.release(); }
    const cashSaved = await paidFirst;
    const cashBlocked = await paidSecond;
    assert.ok("error" in cashBlocked);
    assert.match(String(cashBlocked.error), /سيصبح الرصيد سالبًا/);
    assert.equal(await prisma.commerceRefund.count({ where: { requestId: cashRefundB.requestId } }), 0);
    assert.equal((await prisma.commerceSale.findUniqueOrThrow({ where: { id: BigInt(cashInvoiceB.saleId) }, select: { revision: true } })).revision, 1, "failed debit rolls back refund and sale revision");
    const cashState = async () => (await admin!.query<{ balance: string; revision: string; movements: string }>(`SELECT (a.opening_amount + COALESCE((SELECT sum(CASE WHEN destination_id=a.id THEN amount ELSE -amount END) FROM finance.movements WHERE source_id=a.id OR destination_id=a.id),0))::text AS balance,
      a.revision::text AS revision,(SELECT count(*)::text FROM finance.movements WHERE source_id=a.id AND kind='REFUND') AS movements FROM finance.accounts a WHERE a.id=$1::bigint`, [refundAccount.id])).rows[0];
    assert.deepEqual(await cashState(), { balance: "4.00", revision: "1", movements: "1" });
    assert.deepEqual(await recordCommerceRefund(prisma, 1n, cashRefundA), { id: cashSaved.id, replayed: true });
    assert.deepEqual(await cashState(), { balance: "4.00", revision: "1", movements: "1" });

    // Concurrent deliveries of the same cash-refund request do not duplicate
    // either the refund or its linked account movement.
    const cashRefundC = { ...cashRefundB, requestId: randomUUID(), amount: "2" };
    const duplicateCashGate = gate();
    const cashLeader = recordCommerceRefund(gatedRefundAccount(prisma, duplicateCashGate), 1n, cashRefundC);
    await duplicateCashGate.entered;
    const cashFollower = recordCommerceRefund(prisma, 1n, cashRefundC).then(value => ({ value }), error => ({ error }));
    try { await waitForLock(admin, "commerce_sales"); } finally { duplicateCashGate.release(); }
    const cashWinner = await cashLeader;
    const cashReplay = await cashFollower;
    assert.ok("value" in cashReplay, `cash refund replay failed: ${"error" in cashReplay ? String(cashReplay.error) : "unknown"}`);
    assert.deepEqual(cashReplay.value, { id: cashWinner.id, replayed: true });
    assert.equal(await prisma.commerceRefund.count({ where: { requestId: cashRefundC.requestId } }), 1);
    assert.deepEqual(await cashState(), { balance: "2.00", revision: "2", movements: "2" });
    assert.equal((await admin.query<{ n: string }>("SELECT count(*)::text AS n FROM finance.movements WHERE kind='REFUND' AND external_ref=$1", [`refund:${cashWinner.id}`])).rows[0].n, "1");

    // Cash refund versus direct count: the refund path currently permits a
    // debit while a count is open; revision makes the observation stale. If
    // the refund commits first, an older expected balance cannot be saved.
    await admin.query(`INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT n,1,role_code,'موظف رد وجرد '||n,'pg-refund-count-'||n||'@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users CROSS JOIN generate_series(41,42) n WHERE id=3`);
    for (const holder of ["41", "42"]) {
      const account = await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "CUSTODY", holderId: holder, openingAmount: "10", openingDate: today, counted: true }, today);
      const invoice = await newServiceInvoice();
      await returnCommerceSale(prisma, 1n, makeReturn(invoice));
      const refund = { requestId: randomUUID(), saleId: invoice.saleId, amount: "6", method: "CASH", actuallyPaid: true, accountId: account.id, negativeAcknowledged: false, checkpointRef: "OPENING", timing: "AFTER_REVIEWED_CHECKPOINT" };
      const countInput = { requestId: randomUUID(), accountId: account.id, expectedBalance: "10", countedAmount: "10", reason: "جرد ورد نقدي اصطناعي", actuallyCounted: true };
      const g = gate();
      if (holder === "41") {
        const counting = requestCashCount(gatedFinance(prisma, g), "1", countInput, today);
        await g.entered;
        const refunding = recordCommerceRefund(prisma, 1n, refund);
        try { await waitForLock(admin, "accounts"); } finally { g.release(); }
        const count = await counting;
        await refunding;
        await assert.rejects(() => confirmCashCount(db, "1", { requestId: randomUUID(), countId: count.id, reason: "تأكيد جرد قديم", stillCurrent: true }), /حدثت حركة أو تحصيل أو مصروف بعد الجرد/);
        assert.equal((await admin.query<{ status: string }>("SELECT status FROM finance.cash_counts WHERE id=$1::bigint", [count.id])).rows[0].status, "OPEN");
        assert.equal((await admin.query<{ n: string }>("SELECT count(*)::text AS n FROM finance.movements WHERE cash_count_id=$1::bigint", [count.id])).rows[0].n, "0");
        await cancelCashCount(db, "1", { requestId: randomUUID(), countId: count.id, reason: "إلغاء جرد قديم" });
      } else {
        const refunding = recordCommerceRefund(gatedRefundAccount(prisma, g), 1n, refund);
        await g.entered;
        const counting = requestCashCount(db, "1", countInput, today).then(value => ({ value }), error => ({ error }));
        try { await waitForLock(admin, "accounts"); } finally { g.release(); }
        await refunding;
        const countResult = await counting;
        assert.ok("error" in countResult);
        assert.match(String(countResult.error), /تغير الرصيد المتوقع في اليد/);
        assert.equal((await admin.query<{ n: string }>("SELECT count(*)::text AS n FROM finance.cash_counts WHERE account_id=$1::bigint", [account.id])).rows[0].n, "0");
        assert.equal((await admin.query<{ n: string }>("SELECT count(*)::text AS n FROM finance.requests WHERE request_id=$1::uuid", [countInput.requestId])).rows[0].n, "0");
      }
      assert.equal(await prisma.commerceRefund.count({ where: { requestId: refund.requestId } }), 1);
      assert.equal((await admin.query<{ n: string }>("SELECT count(*)::text AS n FROM finance.movements WHERE kind='REFUND' AND source_id=$1::bigint", [account.id])).rows[0].n, "1");
    }

    // Cash refund and closure share the account lock. Explicit negative
    // acknowledgement is part of these inputs, not an implicit permission.
    await admin.query(`INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT n,1,role_code,'موظف رد وإقفال '||n,'pg-refund-close-'||n||'@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users CROSS JOIN generate_series(43,44) n WHERE id=3`);
    for (const holder of ["43", "44"]) {
      const account = await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "CUSTODY", holderId: holder, openingAmount: "0", openingDate: today, counted: true }, today);
      const invoice = await newServiceInvoice();
      await returnCommerceSale(prisma, 1n, makeReturn(invoice));
      const refund = { requestId: randomUUID(), saleId: invoice.saleId, amount: "6", method: "CASH", actuallyPaid: true, accountId: account.id, negativeAcknowledged: true, checkpointRef: "OPENING", timing: "AFTER_REVIEWED_CHECKPOINT" };
      const close = { requestId: randomUUID(), accountId: account.id, reason: "إقفال ورد نقدي اصطناعي" };
      const g = gate();
      if (holder === "43") {
        const closing = closeAccount(gatedFinance(prisma, g), "1", close);
        await g.entered;
        const refunding = recordCommerceRefund(prisma, 1n, refund).then(value => ({ value }), error => ({ error }));
        try { await waitForLock(admin, "accounts"); } finally { g.release(); }
        await closing;
        const result = await refunding;
        assert.ok("error" in result);
        assert.match(String(result.error), /الحساب مقفل/);
        assert.equal(await prisma.commerceRefund.count({ where: { requestId: refund.requestId } }), 0);
        assert.equal((await prisma.commerceSale.findUniqueOrThrow({ where: { id: BigInt(invoice.saleId) }, select: { revision: true } })).revision, 1);
        const state: { closed: boolean; movements: string } = (await admin.query<{ closed: boolean; movements: string }>(`SELECT closed_at IS NOT NULL AS closed,(SELECT count(*)::text FROM finance.movements WHERE source_id=a.id) AS movements FROM finance.accounts a WHERE id=$1::bigint`, [account.id])).rows[0];
        assert.deepEqual(state, { closed: true, movements: "0" });
        assert.equal((await closeAccount(db, "1", close)).replayed, true);
      } else {
        const refunding = recordCommerceRefund(gatedRefundAccount(prisma, g), 1n, refund);
        await g.entered;
        const closing = closeAccount(db, "1", close).then(value => ({ value }), error => ({ error }));
        try { await waitForLock(admin, "accounts"); } finally { g.release(); }
        const saved = await refunding;
        const result = await closing;
        assert.ok("error" in result);
        assert.match(String(result.error), /لا تُقفل العهدة وفي ذمتها/);
        const state: { closed: boolean; balance: string; movements: string } = (await admin.query<{ closed: boolean; balance: string; movements: string }>(`SELECT closed_at IS NOT NULL AS closed,(a.opening_amount + COALESCE((SELECT sum(CASE WHEN destination_id=a.id THEN amount ELSE -amount END) FROM finance.movements WHERE source_id=a.id OR destination_id=a.id),0))::text AS balance,(SELECT count(*)::text FROM finance.movements WHERE source_id=a.id) AS movements FROM finance.accounts a WHERE id=$1::bigint`, [account.id])).rows[0];
        assert.deepEqual(state, { closed: false, balance: "-6.00", movements: "1" });
        assert.deepEqual(await recordCommerceRefund(prisma, 1n, refund), { id: saved.id, replayed: true });
        assert.equal((await admin.query<{ n: string }>("SELECT count(*)::text AS n FROM finance.requests WHERE request_id=$1::uuid", [close.requestId])).rows[0].n, "0");
      }
    }

    // Diagnostic only: synthetic pre-upgrade rows may lack checkpoint evidence.
    // The audit cannot infer when cash physically changed hands.
    await admin.query(`INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT 45,1,role_code,'موظف نقطة مراجعة اصطناعية','pg-refund-checkpoint@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3`);
    const checkpointAccount = await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "CUSTODY", holderId: "45", openingAmount: "10", openingDate: today, counted: true }, today);
    const checkpointCount = await requestCashCount(db, "1", { requestId: randomUUID(), accountId: checkpointAccount.id, expectedBalance: "10", countedAmount: "10", reason: "نقطة مراجعة اصطناعية", actuallyCounted: true }, today);
    await confirmCashCount(db, "1", { requestId: randomUUID(), countId: checkpointCount.id, reason: "تأكيد نقطة المراجعة", stillCurrent: true });
    const checkpointInvoice = await newServiceInvoice();
    await returnCommerceSale(prisma, 1n, makeReturn(checkpointInvoice));
    // Simulate a pre-upgrade event solely inside the disposable database.
    const legacyRequest = randomUUID();
    const unreviewed = await admin.query<{ id: string }>(`INSERT INTO commerce_refunds(request_id,request_hash,sale_id,amount,method,created_by_id) VALUES($1::uuid,repeat('a',64),$2::bigint,6,'CASH',1) RETURNING id::text`, [legacyRequest, checkpointInvoice.saleId]).then(result => ({ id: result.rows[0].id }));
    await admin.query(`INSERT INTO finance.movements(kind,branch_id,source_id,amount,external_ref,actor_id,after_opening) VALUES('REFUND',1,$1::bigint,6,$2,1,false)`, [checkpointAccount.id, `refund:${unreviewed.id}`]);
    const checkpointMovement = (await admin.query<{ count_id: string | null; after_opening: boolean }>("SELECT after_cash_count_id::text AS count_id,after_opening FROM finance.movements WHERE kind='REFUND' AND external_ref=$1", [`refund:${unreviewed.id}`])).rows[0];
    assert.deepEqual(checkpointMovement, { count_id: null, after_opening: false }, "synthetic legacy movement has no reviewed checkpoint");
    assert.equal((await admin.query<{ status: string }>("SELECT status FROM finance.cash_counts WHERE id=$1::bigint", [checkpointCount.id])).rows[0].status, "CONFIRMED");
    const evidenceBefore = (await admin.query<{ revision: string; movements: string; refunds: string }>(`SELECT revision::text AS revision,(SELECT count(*)::text FROM finance.movements) AS movements,(SELECT count(*)::text FROM commerce_refunds) AS refunds FROM finance.accounts WHERE id=$1::bigint`, [checkpointAccount.id])).rows[0];
    const refundEvidence = await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      return auditSyntheticRefunds(financePort(tx), "1");
    }, { isolationLevel: "Serializable", timeout: 20000 });
    const diagnostic = refundEvidence.refunds.find(row => row.refundId === unreviewed.id);
    assert.ok(diagnostic?.findings.includes("CHECKPOINT_UNATTESTED"));
    assert.deepEqual((await admin.query<{ revision: string; movements: string; refunds: string }>(`SELECT revision::text AS revision,(SELECT count(*)::text FROM finance.movements) AS movements,(SELECT count(*)::text FROM commerce_refunds) AS refunds FROM finance.accounts WHERE id=$1::bigint`, [checkpointAccount.id])).rows[0], evidenceBefore);

    // Real service checkpoint guard with count confirmation and refund
    // transactions, in both account-lock orders on a disposable database.
    await admin.query(`INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT n,1,role_code,'موظف تحقق رد '||n,'pg-checkpoint-race-'||n||'@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users CROSS JOIN generate_series(46,47) n WHERE id=3`);
    for (const holder of ["46", "47"]) {
      const account = await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "CUSTODY", holderId: holder, openingAmount: "100", openingDate: today, counted: true }, today);
      const count = await requestCashCount(db, "1", { requestId: randomUUID(), accountId: account.id, expectedBalance: "100", countedAmount: "100", reason: "جرد مرجع اصطناعي", actuallyCounted: true }, today);
      const confirm = { requestId: randomUUID(), countId: count.id, reason: "اعتماد مرجع اصطناعي", stillCurrent: true };
      const invoice = await newServiceInvoice();
      await returnCommerceSale(prisma, 1n, makeReturn(invoice));
      const refund = { requestId: randomUUID(), saleId: invoice.saleId, amount: "6", method: "CASH", actuallyPaid: true, accountId: account.id, negativeAcknowledged: false, checkpointRef: "OPENING", timing: "AFTER_REVIEWED_CHECKPOINT" };
      const review = { actorId: "1", branchId: "1", saleId: invoice.saleId, accountId: account.id, checkpointRef: "OPENING", afterCheckpoint: true, timing: "AFTER_REVIEWED_CHECKPOINT" as const };
      const g = gate();
      if (holder === "46") {
        const confirming = confirmCashCount(gatedFinance(prisma, g), "1", confirm);
        await g.entered;
        const refunding = recordCommerceRefund(prisma, 1n, refund).then(value => ({ value }), error => ({ error }));
        try { await waitForLock(admin, "accounts"); } finally { g.release(); }
        await confirming;
        const result = await refunding;
        assert.ok("error" in result);
        assert.match(String(result.error), /تغيّر آخر جرد/);
        assert.equal(await prisma.commerceRefund.count({ where: { requestId: refund.requestId } }), 0);
        assert.equal((await prisma.commerceSale.findUniqueOrThrow({ where: { id: BigInt(invoice.saleId) }, select: { revision: true } })).revision, 1);
        assert.equal((await admin.query<{ n: string }>("SELECT count(*)::text AS n FROM finance.movements WHERE source_id=$1::bigint AND kind='REFUND'", [account.id])).rows[0].n, "0");
        const afterReview = { ...review, checkpointRef: count.id };
        const saved = await recordCommerceRefund(prisma, 1n, { ...refund, checkpointRef: afterReview.checkpointRef });
        assert.deepEqual((await admin.query<{ count_id: string | null; after_opening: boolean }>("SELECT after_cash_count_id::text AS count_id,after_opening FROM finance.movements WHERE external_ref=$1", [`refund:${saved.id}`])).rows[0], { count_id: count.id, after_opening: false });
      } else {
        const refunding = recordCommerceRefund(gatedRefundAccount(prisma, g), 1n, refund);
        await g.entered;
        const confirming = confirmCashCount(db, "1", confirm).then(value => ({ value }), error => ({ error }));
        try { await waitForLock(admin, "accounts"); } finally { g.release(); }
        const saved = await refunding;
        const result = await confirming;
        assert.ok("error" in result);
        assert.match(String(result.error), /حدثت حركة أو تحصيل أو مصروف بعد الجرد/);
        assert.deepEqual((await admin.query<{ count_id: string | null; after_opening: boolean }>("SELECT after_cash_count_id::text AS count_id,after_opening FROM finance.movements WHERE external_ref=$1", [`refund:${saved.id}`])).rows[0], { count_id: null, after_opening: true });
        assert.equal((await admin.query<{ status: string }>("SELECT status FROM finance.cash_counts WHERE id=$1::bigint", [count.id])).rows[0].status, "OPEN");
        assert.equal((await admin.query<{ n: string }>("SELECT count(*)::text AS n FROM finance.requests WHERE request_id=$1::uuid", [confirm.requestId])).rows[0].n, "0");
        await cancelCashCount(db, "1", { requestId: randomUUID(), countId: count.id, reason: "إلغاء جرد قديم" });

        // Versioned identity, duplicate same request; not proof of P2002 handling.
        const identityInvoice = await newServiceInvoice();
        await returnCommerceSale(prisma, 1n, makeReturn(identityInvoice));
        const body = { requestId: randomUUID(), saleId: identityInvoice.saleId, amount: "6", method: "CASH", actuallyPaid: true, accountId: account.id, negativeAcknowledged: false, checkpointRef: "OPENING", timing: "AFTER_REVIEWED_CHECKPOINT" };
        const snapshot = { ...review, saleId: identityInvoice.saleId };
        const makeService = (client: PrismaClient) => client;
        const duplicateGate = gate();
        const leader = recordCommerceRefund(makeService(gatedSale(prisma, duplicateGate)), 1n, body);
        await duplicateGate.entered;
        const follower: Promise<{ value: { id: string; replayed: boolean } } | { error: unknown }> = recordCommerceRefund(makeService(prisma), 1n, body).then(value => ({ value }), (error: unknown) => ({ error }));
        try { await waitForLock(admin, "commerce_sales"); } finally { duplicateGate.release(); }
        const savedIdentity = await leader;
        const duplicate = await follower;
        assert.ok("value" in duplicate, `versioned replay failed: ${"error" in duplicate ? String(duplicate.error) : ""}`);
        assert.deepEqual(duplicate.value, { id: savedIdentity.id, replayed: true });
        assert.equal(await prisma.commerceRefund.count({ where: { requestId: body.requestId } }), 1);
        assert.equal((await admin.query<{ n: string }>("SELECT count(*)::text AS n FROM finance.movements WHERE external_ref=$1", [`refund:${savedIdentity.id}`])).rows[0].n, "1");
      }
    }

    // A real stock sale and return with a synthetic serial. Gate the return
    // after updating the serial but before committing and restoring stock. A
    // resale sees the committed sold state and must roll back safely.
    const openingId: string = (await admin.query<{ id: string }>(`INSERT INTO inventory_openings(request_id,request_hash,warehouse_id,product_id,quantity,unit_cost,created_by_id)
      VALUES($1::uuid,repeat('c',64),1,1,1,11000,1) RETURNING id::text`, [randomUUID()])).rows[0].id;
    const serialId: string = (await admin.query<{ id: string }>(`INSERT INTO inventory_serials(opening_id,serial_number,serial_key) VALUES($1::bigint,'PG-RETURN-01','PG-RETURN-01') RETURNING id::text`, [openingId])).rows[0].id;
    const stockBefore = (await admin.query<{ qty: string; cost: string }>("SELECT qty_on_hand::text AS qty,avg_cost::text AS cost FROM stock_levels WHERE warehouse_id=1 AND product_id=1")).rows[0];
    const stockSaleInput = { requestId: randomUUID(), warehouseId: "1", customerName: "عميل مخزون اصطناعي", customerPhone: "01000000000", discount: "0", initialPayment: "10", method: "CARD", lines: [{ productId: "1", quantity: "1", serialIds: [serialId], expectedUnitPrice: "18500", expectedTaxRateId: "2", expectedTaxKind: "SCHEDULE", expectedTaxRate: "5" }] };
    const firstStockSale = await createCommerceSale(prisma, 3n, stockSaleInput);
    const soldLine = await prisma.commerceSaleLine.findFirstOrThrow({ where: { saleId: BigInt(firstStockSale.id) }, select: { id: true } });
    const returnStockInput = { requestId: randomUUID(), saleId: firstStockSale.id, cancel: false, accepted: true, lines: [{ saleLineId: soldLine.id.toString(), quantity: "1", serialIds: [serialId] }] };
    assert.equal((await admin.query<{ qty: string }>("SELECT qty_on_hand::text AS qty FROM stock_levels WHERE warehouse_id=1 AND product_id=1")).rows[0].qty, (Number(stockBefore.qty) - 1).toFixed(2));
    const serialGate = gate();
    const returningStock = returnCommerceSale(gatedReturnedSerial(prisma, serialGate), 1n, returnStockInput).then(value => ({ value }), error => ({ error }));
    await serialGate.entered;
    const resaleInput = { ...stockSaleInput, requestId: randomUUID() };
    const resellingStock = createCommerceSale(prisma, 3n, resaleInput).then(value => ({ value }), error => ({ error }));
    let resaleOutcome: Awaited<typeof resellingStock>;
    try { resaleOutcome = await resellingStock; } finally { serialGate.release(); }
    const returnOutcome = await returningStock;
    assert.ok("value" in returnOutcome, `return failed after contention: ${"error" in returnOutcome ? String(returnOutcome.error) : "unknown"}`);
    assert.ok("error" in resaleOutcome);
    assert.match(String(resaleOutcome.error), /سيريالات/);
    assert.equal(await prisma.commerceReturn.count({ where: { requestId: returnStockInput.requestId } }), 1);
    assert.equal(await prisma.commerceSale.count({ where: { requestId: resaleInput.requestId } }), 0);
    const stockRestored = (await admin.query<{ qty: string; cost: string }>("SELECT qty_on_hand::text AS qty,avg_cost::text AS cost FROM stock_levels WHERE warehouse_id=1 AND product_id=1")).rows[0];
    assert.deepEqual(stockRestored, stockBefore);
    assert.equal((await prisma.inventorySerial.findUniqueOrThrow({ where: { id: BigInt(serialId) }, select: { currentSaleLineId: true } })).currentSaleLineId, null);
    // A new attempt with the same token after rollback may now sell the serial.
    const resold = await createCommerceSale(prisma, 3n, resaleInput);
    const newLine = await prisma.commerceSaleLine.findFirstOrThrow({ where: { saleId: BigInt(resold.id) }, select: { id: true } });
    assert.equal((await prisma.inventorySerial.findUniqueOrThrow({ where: { id: BigInt(serialId) }, select: { currentSaleLineId: true } })).currentSaleLineId, newLine.id);
    const stockAfter = (await admin.query<{ qty: string; cost: string }>("SELECT qty_on_hand::text AS qty,avg_cost::text AS cost FROM stock_levels WHERE warehouse_id=1 AND product_id=1")).rows[0];
    assert.equal(stockAfter.qty, (Number(stockBefore.qty) - 1).toFixed(2));
    assert.equal(stockAfter.cost, stockBefore.cost);
    assert.equal(await prisma.commerceSale.count({ where: { requestId: resaleInput.requestId } }), 1);
    assert.equal(await prisma.commerceReturnSerial.count({ where: { saleLineSerial: { serialId: BigInt(serialId) } } }), 1);
    assert.equal((await returnCommerceSale(prisma, 1n, returnStockInput)).replayed, true);
    assert.equal((await admin.query<{ qty: string }>("SELECT qty_on_hand::text AS qty FROM stock_levels WHERE warehouse_id=1 AND product_id=1")).rows[0].qty, stockAfter.qty);

    // Two deliveries of the return on the resold item must not restore stock
    // twice or create two links to its sale-line serial.
    const secondReturnInput = { ...returnStockInput, requestId: randomUUID(), saleId: resold.id, lines: [{ saleLineId: newLine.id.toString(), quantity: "1", serialIds: [serialId] }] };
    const duplicateReturnGate = gate();
    const returnLeader = returnCommerceSale(gatedSale(prisma, duplicateReturnGate), 1n, secondReturnInput);
    await duplicateReturnGate.entered;
    const returnFollower = returnCommerceSale(prisma, 1n, secondReturnInput).then(value => ({ value }), error => ({ error }));
    try { await waitForLock(admin, "commerce_sales"); } finally { duplicateReturnGate.release(); }
    const newReturned = await returnLeader;
    const repeatedReturn = await returnFollower;
    assert.ok("value" in repeatedReturn, `stock return replay failed: ${"error" in repeatedReturn ? String(repeatedReturn.error) : "unknown"}`);
    assert.deepEqual(repeatedReturn.value, { id: newReturned.id, replayed: true });
    assert.equal(await prisma.commerceReturn.count({ where: { requestId: secondReturnInput.requestId } }), 1);
    assert.equal(await prisma.commerceReturnSerial.count({ where: { saleLineSerial: { serialId: BigInt(serialId) } } }), 2);
    assert.equal((await prisma.inventorySerial.findUniqueOrThrow({ where: { id: BigInt(serialId) }, select: { currentSaleLineId: true } })).currentSaleLineId, null);
    assert.deepEqual((await admin.query<{ qty: string; cost: string }>("SELECT qty_on_hand::text AS qty,avg_cost::text AS cost FROM stock_levels WHERE warehouse_id=1 AND product_id=1")).rows[0], stockBefore);
    assert.equal((await prisma.commerceSale.findUniqueOrThrow({ where: { id: BigInt(resold.id) }, select: { revision: true } })).revision, 1);

    // Closing first wins against a waiting collector. The inverse order must
    // leave the custody open and reject closing its unsettled cash.
    await admin.query("UPDATE users SET branch_id=1 WHERE id=1");
    const managerCustody = await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "CUSTODY", holderId: "1", openingAmount: "0", openingDate: today, counted: true }, today);
    const managerPayment = { ...collection(), saleId: "9" };
    const closeGate = gate();
    const closing = closeAccount(gatedFinance(prisma, closeGate), "1", { requestId: randomUUID(), accountId: managerCustody.id, reason: "إقفال اختبار" });
    await closeGate.entered;
    const tooLate = recordCommerceCollection(prisma, 1n, managerPayment);
    await waitForLock(admin, "accounts"); closeGate.release();
    await closing; await assert.rejects(tooLate, /يلزم وجود عهدة مفتوحة/);
    assert.equal((await admin.query<{ n: string }>("SELECT count(*)::text AS n FROM commerce_collections WHERE request_id=$1::uuid", [managerPayment.requestId])).rows[0].n, "0");
    await admin.query(`INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT 4,1,role_code,'موظف اصطناعي','pg-test@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3;
      UPDATE commerce_sales SET created_by_id=4,total=19750 WHERE id=1`);
    const otherCustody = await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "CUSTODY", holderId: "4", openingAmount: "0", openingDate: today, counted: true }, today);
    const collectGate = gate();
    const firstCash = recordCommerceCollection(gatedCommerce(prisma, collectGate), 4n, { ...collection(), saleId: "1" });
    await collectGate.entered;
    const delayedClose = closeAccount(db, "1", { requestId: randomUUID(), accountId: otherCustody.id, reason: "إقفال اختبار" });
    await waitForLock(admin, "accounts"); collectGate.release();
    await firstCash; await assert.rejects(delayedClose, /تحصيلات أو مصروفات غير مسوّاة/);
    const open = await admin.query<{ closed: boolean }>("SELECT closed_at IS NOT NULL AS closed FROM finance.accounts WHERE id=$1::bigint", [otherCustody.id]);
    assert.equal(open.rows[0].closed, false);

    // Simulate Prisma reporting a transaction conflict at the boundary, not
    // through financePort. The first transaction must roll back completely.
    let attempts = 0;
    const conflictDb: FinanceDatabase = { serializable: work => prisma!.$transaction(async tx => {
      attempts++;
      const result = await work(financePort(tx));
      if (attempts === 1) throw Object.assign(new Error("injected commit conflict"), { code: "P2034" });
      return result;
    }, { isolationLevel: "Serializable", timeout: 20000 }) };
    const retryId = randomUUID();
    const retried = await requestCountFromHolder(conflictDb, "1", { requestId: retryId, accountId: custody.id, reason: "إعادة محاولة" });
    assert.equal(attempts, 2);
    assert.equal((await admin.query<{ n: string }>("SELECT count(*)::text AS n FROM finance.requests WHERE request_id=$1::uuid", [retryId])).rows[0].n, "1");
    assert.equal((await admin.query<{ n: string }>("SELECT count(*)::text AS n FROM finance.cash_counts WHERE account_id=$1::bigint AND status='OPEN'", [custody.id])).rows[0].n, "1");
    await cancelCashCount(db, "1", { requestId: randomUUID(), countId: retried.id, reason: "إلغاء الاختبار" });
    // Boundary errors can arrive directly from an adapter rather than the SQL
    // port; verify the whole real command rolls back before it is retried.
    for(const pgCode of ["40001","40P01"]) {
      const injected=abortOnceAfterWork(prisma,pgCode);
      const boundary:FinanceDatabase=ordinaryFinance(injected.db);
      const input={requestId:randomUUID(),accountId:custody.id,reason:"تعارض اصطناعي عند حدود المعاملة"};
      const result=await requestCountFromHolder(boundary,"1",input);
      assert.equal(injected.attempts(),2);
      assert.deepEqual(await requestCountFromHolder(db,"1",input),{id:result.id,replayed:true});
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.requests WHERE request_id=$1::uuid",[input.requestId])).rows[0].n,1);
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.cash_counts WHERE account_id=$1::bigint AND status='OPEN'",[custody.id])).rows[0].n,1);
      await cancelCashCount(db,"1",{requestId:randomUUID(),countId:result.id,reason:"إلغاء جرد اصطناعي"});
    }

    // A payment transaction starts *before* zero-value settlement confirmation,
    // but waits on the expense row until after confirmation commits. PostgreSQL
    // CURRENT_TIMESTAMP is the transaction start, not the insertion time.
    await admin.query(`INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT 5,1,role_code,'موظف مصروف اصطناعي','pg-expense@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3`);
    const expenseVault = await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "VAULT", holderId: null, openingAmount: "100", openingDate: today, counted: true }, today);
    const expenseCustody = await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "CUSTODY", holderId: "5", openingAmount: "0", openingDate: today, counted: true }, today);
    const oldDateExpense = await createExpense(db, "5", { requestId: randomUUID(), branchId: "1", categoryId: "1", amount: "2", expenseDate: today, description: "مصروف بتاريخ أقدم اصطناعي" });
    await approveExpense(db, "1", { requestId: randomUUID(), expenseId: oldDateExpense.id, expectedRevision: "1" });
    const oldDateInput = { requestId: randomUUID(), expenseId: oldDateExpense.id, expectedRevision: "2", method: "CASH", accountId: null, paymentDate: "2020-01-01", actuallyPaid: true, source: "HOLDER_CASH" };
    await assert.rejects(() => payExpense(db, "5", oldDateInput, today), /أقدم من يوم مرجع العهدة/);
    assert.equal((await admin.query<{ n: string }>("SELECT count(*)::text AS n FROM finance.payments WHERE expense_id=$1::bigint", [oldDateExpense.id])).rows[0].n, "0");
    assert.equal((await admin.query<{ n: string }>("SELECT count(*)::text AS n FROM finance.requests WHERE request_id=$1::uuid", [oldDateInput.requestId])).rows[0].n, "0");
    const draft = await createExpense(db, "5", { requestId: randomUUID(), branchId: "1", categoryId: "1", amount: "12", expenseDate: today, description: "مصروف تزامن اصطناعي" });
    await approveExpense(db, "1", { requestId: randomUUID(), expenseId: draft.id, expectedRevision: "1" });
    const emptySettlement = await requestSettlement(db, "5", { requestId: randomUUID(), accountId: expenseCustody.id, expectedBalance: "0", countedAmount: "0", reason: "تسوية صفرية", actuallyCounted: true });
    // Synthetic legacy mismatch: the settlement branch differs from the
    // locked custody's branch, which must block even a zero-transfer confirm.
    await admin.query("UPDATE finance.settlements SET branch_id=2 WHERE id=$1::bigint", [emptySettlement.id]);
    const wrongBranchRequest = randomUUID();
    await assert.rejects(() => confirmSettlement(db, "1", { requestId: wrongBranchRequest, settlementId: emptySettlement.id, expectedBalance: "0", transferAmount: "0", transferDirection: "TO_VAULT", reason: "اختبار اصطناعي", actuallyTransferred: true }), /فرع طلب التسوية لا يطابق فرع العهدة/);
    assert.equal((await admin.query<{ n: string }>("SELECT count(*)::text AS n FROM finance.requests WHERE request_id=$1::uuid", [wrongBranchRequest])).rows[0].n, "0");
    assert.equal((await admin.query<{ status: string; branch: string }>("SELECT status,branch_id::text AS branch FROM finance.settlements WHERE id=$1::bigint", [emptySettlement.id])).rows[0].status, "OPEN");
    await admin.query("UPDATE finance.settlements SET branch_id=1 WHERE id=$1::bigint", [emptySettlement.id]);
    // A vault marked closed by synthetic legacy data is not a valid target,
    // even for a zero-transfer settlement. The same row is locked first.
    await admin.query("UPDATE finance.accounts SET closed_at=now(),closed_by=1 WHERE id=$1::bigint", [expenseVault.id]);
    const closedVaultRequest = randomUUID();
    await assert.rejects(() => confirmSettlement(db, "1", { requestId: closedVaultRequest, settlementId: emptySettlement.id, expectedBalance: "0", transferAmount: "0", transferDirection: "TO_VAULT", reason: "اختبار اصطناعي", actuallyTransferred: true }), /خزنة الفرع مقفلة/);
    assert.equal((await admin.query<{ n: string }>("SELECT count(*)::text AS n FROM finance.requests WHERE request_id=$1::uuid", [closedVaultRequest])).rows[0].n, "0");
    assert.equal((await admin.query<{ status: string }>("SELECT status FROM finance.settlements WHERE id=$1::bigint", [emptySettlement.id])).rows[0].status, "OPEN");
    await admin.query("UPDATE finance.accounts SET closed_at=NULL,closed_by=NULL WHERE id=$1::bigint", [expenseVault.id]);
    const displayStale = async () => (await admin!.query<{ stale: boolean }>(`SELECT ${SETTLEMENT_STALE_SQL} AS stale FROM finance.settlements st JOIN finance.accounts a ON a.id=st.account_id WHERE st.id=$1::bigint`, [emptySettlement.id])).rows[0].stale;
    assert.equal(await displayStale(), false, "matching revision and no later event");
    await admin.query("BEGIN");
    await admin.query("UPDATE finance.accounts SET revision=revision+1 WHERE id=$1::bigint", [expenseCustody.id]);
    assert.equal(await displayStale(), true, "changed revision is stale independent of timestamps");
    await admin.query("UPDATE finance.settlements SET account_revision=NULL WHERE id=$1::bigint", [emptySettlement.id]);
    assert.equal(await displayStale(), true, "missing legacy revision is stale");
    await admin.query("ROLLBACK");
    assert.equal(await displayStale(), false, "test writes rolled back");
    await admin.query("BEGIN");
    await admin.query("SELECT id FROM finance.expenses WHERE id=$1::bigint FOR UPDATE", [draft.id]);
    let paymentAttempts = 0;
    const trackedFinance: FinanceDatabase = { serializable: work => { paymentAttempts++; return db.serializable(work); } };
    const expensePayment = payExpense(trackedFinance, "5", { requestId: randomUUID(), expenseId: draft.id, expectedRevision: "2", method: "CASH", accountId: null, paymentDate: today, actuallyPaid: true, source: "HOLDER_CASH" }, today);
    await waitForLock(admin, "expenses");
    const versionBeforeConfirm = (await admin.query<{ revision: string }>("SELECT revision::text AS revision FROM finance.accounts WHERE id=$1::bigint", [expenseCustody.id])).rows[0].revision;
    await confirmSettlement(db, "1", { requestId: randomUUID(), settlementId: emptySettlement.id, expectedBalance: "0", transferAmount: "0", transferDirection: "TO_VAULT", reason: "اعتماد اختبار", actuallyTransferred: true });
    const versionAfterConfirm = (await admin.query<{ revision: string }>("SELECT revision::text AS revision FROM finance.accounts WHERE id=$1::bigint", [expenseCustody.id])).rows[0].revision;
    assert.equal(BigInt(versionAfterConfirm), BigInt(versionBeforeConfirm) + 1n, "zero-movement confirmation still advances custody revision");
    await admin.query("COMMIT");
    await expensePayment;
    await assert.rejects(() => payExpense(db, "5", oldDateInput, today), /أقدم من يوم مرجع العهدة/);
    assert.equal((await admin.query<{ n: string }>("SELECT count(*)::text AS n FROM finance.payments WHERE expense_id=$1::bigint", [oldDateExpense.id])).rows[0].n, "0");
    assert.ok(paymentAttempts >= 2, "serialization conflict must force a fresh payment transaction");
    const expenseOverview = await settlementOverview(db, "5", expenseCustody.id);
    assert.equal(expenseOverview.expenses, "12.00", "a payment committed after confirmation must belong to the next period");
    const checkpointEvidence = await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      await tx.$executeRawUnsafe("SET LOCAL selahtone.holder_checkpoint_audit_test_only='yes'");
      return auditSyntheticHolderCheckpoints(financePort(tx), "1", "0", 100);
    }, { isolationLevel: "Serializable", timeout: 20000 });
    const checkpointRow = checkpointEvidence.rows.find(row => row.expenseId === draft.id && row.accountId === expenseCustody.id && row.referenceType === "SETTLEMENT" && row.referenceId === emptySettlement.id);
    assert.ok(checkpointRow, "the synthetic inventory must enumerate the real service's settlement checkpoint");
    assert.equal(checkpointRow.dateSame, true);
    assert.equal(checkpointRow.recordedAfter, true);

    const holderReview = await requestPaidExpenseReview(db, "1", { requestId: randomUUID(), expenseId: draft.id, expectedRevision: "3", reason: "مراجعة اصطناعية", proposedAmount: "10" });
    const reviewQueue = await listOpenExpenseReviewQueue(db, "1", null);
    const queued = reviewQueue.rows.find(row => row.id === holderReview.id);
    assert.equal(queued?.expenseId, draft.id);
    assert.equal(queued?.hasHolderCash, true);
    assert.equal(queued?.hasPayment, true);
    const correctionEvidence = await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      await tx.$executeRawUnsafe("SET LOCAL selahtone.holder_checkpoint_audit_test_only='yes'");
      return auditSyntheticHolderCorrections(financePort(tx), "1", "0", 100);
    }, { isolationLevel: "Serializable", timeout: 20000 });
    const reviewEvidence = correctionEvidence.rows.find(row => row.expenseId === draft.id && row.kind === "REVIEW" && row.evidence.reviewId === holderReview.id);
    assert.equal(reviewEvidence?.evidence.snapshotSource, "HOLDER_CASH");
    assert.equal(reviewEvidence?.evidence.status, "OPEN");
    assert.ok(!correctionEvidence.rows.some(row => row.expenseId === draft.id && row.kind === "CORRECTION"));

    // Legacy-style correction inserted only in this disposable database. This
    // tests the PostgreSQL query and guard, not a concurrent external writer.
    await admin.query(`UPDATE finance.expense_reviews SET status='CORRECTED',resolved_by=2,resolved_at=now(),resolution_reason='تصحيح اصطناعي' WHERE id=$1::bigint`, [holderReview.id]);
    await admin.query(`INSERT INTO finance.expense_corrections(expense_id,payment_id,review_id,before_amount,after_amount,reason,created_by)
      SELECT expense_id,id,$2::bigint,12,10,'تصحيح قديم اصطناعي',2 FROM finance.payments WHERE expense_id=$1::bigint`, [draft.id,holderReview.id]);
    assert.equal((await settlementOverview(db, "5", expenseCustody.id)).holderCorrectionInPeriod, true);
    const correctionFlag = (await admin.query<{ found: boolean }>(`SELECT holder_correction_in_period AS found FROM (${CUSTODY_EXPECTATION_SQL}) x WHERE x.id=$2::bigint`, ["1",expenseCustody.id])).rows[0];
    assert.equal(correctionFlag.found, true);
    const blockedCorrectionRequest = randomUUID();
    await assert.rejects(() => requestSettlement(db, "5", { requestId: blockedCorrectionRequest, accountId: expenseCustody.id, expectedBalance: "0", countedAmount: "0", reason: "جرد اصطناعي", actuallyCounted: true }), /يوجد تصحيح مرتبط بدفع نقد موظف/);
    assert.equal((await admin.query<{ n: string }>("SELECT count(*)::text AS n FROM finance.requests WHERE request_id=$1::uuid", [blockedCorrectionRequest])).rows[0].n, "0");
    await admin.query("DELETE FROM finance.expense_corrections WHERE review_id=$1::bigint", [holderReview.id]);
    await admin.query("UPDATE finance.expense_reviews SET status='OPEN',resolved_by=NULL,resolved_at=NULL,resolution_reason=NULL WHERE id=$1::bigint", [holderReview.id]);
    const cardExpense = await createExpense(db, "5", { requestId: randomUUID(), branchId: "1", categoryId: "1", amount: "9", expenseDate: today, description: "بطاقة اصطناعية للجرد" });
    await approveExpense(db, "1", { requestId: randomUUID(), expenseId: cardExpense.id, expectedRevision: "1" });
    await payExpense(db, "1", { requestId: randomUUID(), expenseId: cardExpense.id, expectedRevision: "2", method: "CARD", source: "ACCOUNT", paymentDate: today, actuallyPaid: true }, today);
    const cardReview = await requestPaidExpenseReview(db, "1", { requestId: randomUUID(), expenseId: cardExpense.id, expectedRevision: "3", reason: "مراجعة بطاقة اصطناعية", proposedAmount: "8" });
    const cardCorrection = await confirmPaidExpenseCorrection(db, "2", { requestId: randomUUID(), reviewId: cardReview.id, confirmedAmount: "8", reason: "تصحيح بطاقة اصطناعي", verifiedPayment: true, noPriorSettlement: true });
    const unmatchedEvidence = await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      await tx.$executeRawUnsafe("SET LOCAL selahtone.holder_checkpoint_audit_test_only='yes'");
      return auditSyntheticUnmatchedReviews(financePort(tx), "1", "0", 100);
    }, { isolationLevel: "Serializable", timeout: 20000 });
    const cardRows = unmatchedEvidence.rows.filter(row => row.expenseId === cardExpense.id);
    assert.deepEqual(cardRows.map(row => row.kind), ["CORRECTION", "EXPENSE", "PAYMENT", "REVIEW"]);
    assert.equal(cardRows.find(row => row.kind === "CORRECTION")?.evidence.correctionId, cardCorrection.id);
    assert.equal(cardRows.find(row => row.kind === "PAYMENT")?.evidence.method, "CARD");
    assert.ok(!unmatchedEvidence.rows.some(row => row.expenseId === draft.id), "holder payments are inventoried by the companion scanner");


    // Boundary audit only: force an indistinguishable timestamp to demonstrate
    // why strict timestamp windows are not a reliable historical allocation.
    // This is intentionally synthetic, not a proposed production fix.
    await admin.query("UPDATE commerce_sales SET created_by_id=5 WHERE id=9");
    const tieId = randomUUID();
    await admin.query(`INSERT INTO commerce_collections(request_id,request_hash,sale_id,amount,method,is_initial,created_by_id,created_at)
      SELECT $1::uuid,repeat('d',64),9,1,'CASH',false,5,resolved_at FROM finance.settlements WHERE id=$2::bigint`, [tieId, emptySettlement.id]);
    const same = await admin.query<{ equal: boolean }>(`SELECT c.created_at=s.resolved_at AS equal FROM commerce_collections c,finance.settlements s WHERE c.request_id=$1::uuid AND s.id=$2::bigint`, [tieId, emptySettlement.id]);
    assert.equal(same.rows[0].equal, true);
    assert.equal((await settlementOverview(db, "5", expenseCustody.id)).sales, "0.00", "equal timestamps expose an unresolved allocation ambiguity");

    await admin.query(`INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT 6,1,role_code,'موظف آخر اصطناعي','pg-expense2@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3`);
    const c2 = await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "CUSTODY", holderId: "6", openingAmount: "0", openingDate: today, counted: true }, today);
    const draft2 = await createExpense(db, "6", { requestId: randomUUID(), branchId: "1", categoryId: "1", amount: "15", expenseDate: today, description: "مصروف تزامن ثان" });
    await approveExpense(db, "1", { requestId: randomUUID(), expenseId: draft2.id, expectedRevision: "1" });
    const s2 = await requestSettlement(db, "6", { requestId: randomUUID(), accountId: c2.id, expectedBalance: "0", countedAmount: "0", reason: "تسوية اختبار", actuallyCounted: true });
    const payGate = gate();
    const cashPayment = payExpense(gatedFinance(prisma, payGate, "WHERE branch_id=$1::bigint AND holder_id=$2::bigint AND kind='CUSTODY' AND closed_at IS NULL ORDER BY id FOR UPDATE"), "6", { requestId: randomUUID(), expenseId: draft2.id, expectedRevision: "2", method: "CASH", accountId: null, paymentDate: today, actuallyPaid: true, source: "HOLDER_CASH" }, today);
    await payGate.entered;
    const staleConfirm = confirmSettlement(db, "1", { requestId: randomUUID(), settlementId: s2.id, expectedBalance: "0", transferAmount: "0", transferDirection: "TO_VAULT", reason: "اعتماد قديم", actuallyTransferred: true });
    await waitForLock(admin, "accounts"); payGate.release();
    await cashPayment;
    await assert.rejects(staleConfirm, /تغيّرت العهدة منذ طلب التسوية/);
    assert.equal((await settlementOverview(db, "6", c2.id)).expenses, "15.00");
    await cancelSettlement(db, "6", { requestId: randomUUID(), settlementId: s2.id, reason: "إلغاء الطلب القديم" });

    // Same two commit orders for HOLDER_CASH versus account closure.
    await admin.query(`INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT 7,1,role_code,'موظف إقفال اصطناعي','pg-close1@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3;
      INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT 8,1,role_code,'موظف إقفال آخر','pg-close2@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3`);
    for (const holder of ["7", "8"]) {
      const account = await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "CUSTODY", holderId: holder, openingAmount: "0", openingDate: today, counted: true }, today);
      const expense = await createExpense(db, holder, { requestId: randomUUID(), branchId: "1", categoryId: "1", amount: "8", expenseDate: today, description: "مصروف وإقفال متزامنان" });
      await approveExpense(db, "1", { requestId: randomUUID(), expenseId: expense.id, expectedRevision: "1" });
      const payment = { requestId: randomUUID(), expenseId: expense.id, expectedRevision: "2", method: "CASH", accountId: null, paymentDate: today, actuallyPaid: true, source: "HOLDER_CASH" };
      const close = { requestId: randomUUID(), accountId: account.id, reason: "اختبار إقفال" };
      const g = gate();
      if (holder === "7") {
        const closingFirst = closeAccount(gatedFinance(prisma, g), "1", close);
        await g.entered;
        const blockedPay = payExpense(db, holder, payment, today);
        await waitForLock(admin, "accounts"); g.release();
        await closingFirst;
        await assert.rejects(blockedPay, /عهدة المسجّل مقفلة/);
        assert.equal((await admin.query<{ n: string }>("SELECT count(*)::text AS n FROM finance.payments WHERE expense_id=$1::bigint", [expense.id])).rows[0].n, "0");
      } else {
        const payingFirst = payExpense(gatedFinance(prisma, g, "WHERE branch_id=$1::bigint AND holder_id=$2::bigint AND kind='CUSTODY' AND closed_at IS NULL ORDER BY id FOR UPDATE"), holder, payment, today);
        await g.entered;
        const blockedClose = closeAccount(db, "1", close);
        await waitForLock(admin, "accounts"); g.release();
        await payingFirst;
        await assert.rejects(blockedClose, /تحصيلات أو مصروفات غير مسوّاة/);
        assert.equal((await settlementOverview(db, holder, account.id)).expenses, "8.00");
      }
    }


    // Experimental candidate only: synthetic status, no real cash posting.
    await admin.query("SET selahtone.collection_policy_test_only='yes'");
    await admin.query(read("prototypes/finance-collection-policy/allocations.test-only.sql"));
    // Both initial-sale paths wrapped with the test-only allocation hook.
    // Fixtures for branch 410 and its independent custody are above.
    await admin.query("UPDATE stock_levels SET qty_on_hand=3 WHERE warehouse_id=$1::bigint AND product_id=2",[replayWarehouse]);
    const labVault410=await openAccount(db,"1",{requestId:randomUUID(),branchId:"410",kind:"VAULT",holderId:null,openingAmount:"0",openingDate:today,counted:true},today);
    const pendingBeforeInitial=await db.serializable(tx=>pendingTestCollections(tx,replayCustody.id));
    const initialRevisionBefore: string=(await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.accounts WHERE id=$1::bigint",[replayCustody.id])).rows[0].revision;
    for(const [kind,body] of [["catalog",{...catalogInitial,requestId:randomUUID()}],["stock",{...inventoryInitial,requestId:randomUUID()}]] as const) {
      const failDb=testCollectionService(prisma,"410",true);
      const run=()=>kind==="catalog"?createCatalogSale(failDb,410n,body):createCommerceSale(failDb,410n,body);
      await assert.rejects(run,/synthetic failure after allocation/);
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_sales WHERE request_id=$1::uuid",[body.requestId])).rows[0].n,0);
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_collections WHERE request_id=$1::uuid",[body.requestId])).rows[0].n,0);
    }
    assert.equal(await db.serializable(tx=>pendingTestCollections(tx,replayCustody.id)),pendingBeforeInitial);
    assert.equal((await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.accounts WHERE id=$1::bigint",[replayCustody.id])).rows[0].revision,initialRevisionBefore);
    assert.equal((await admin.query<{qty:string}>("SELECT qty_on_hand::text AS qty FROM stock_levels WHERE warehouse_id=$1::bigint AND product_id=2",[replayWarehouse])).rows[0].qty,"3.00");
    // Existing real-service safeguard rejects a manager without custody before
    // the hook can select the vault, even though a vault exists in the branch.
    for(const [kind,body] of [["catalog",{...catalogInitial,requestId:randomUUID()}],["stock",{...inventoryInitial,requestId:randomUUID()}]] as const) {
      const run=()=>kind==="catalog"?createCatalogSale(testCollectionService(prisma!,"1"),1n,body):createCommerceSale(testCollectionService(prisma!,"1"),1n,body);
      await assert.rejects(run,/يلزم وجود عهدة مفتوحة/);
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_sales WHERE request_id=$1::uuid",[body.requestId])).rows[0].n,0);
    }
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE source_id=$1::bigint OR destination_id=$1::bigint",[labVault410.id])).rows[0].n,0);
    for(const [kind,body] of [["catalog",{...catalogInitial,requestId:randomUUID()}],["stock",{...inventoryInitial,requestId:randomUUID()}]] as const) {
      const run=()=>kind==="catalog"?createCatalogSale(testCollectionService(prisma!,"410"),410n,body):createCommerceSale(testCollectionService(prisma!,"410"),410n,body);
      const saved=await run();assert.equal(saved.replayed,false);
      assert.deepEqual(await run(),{id:saved.id,replayed:true});
      const assignments:Array<{accountId:string;treatment:string;movementId:string|null}>=(await admin.query<{accountId:string;treatment:string;movementId:string|null}>(`SELECT a.account_id::text AS "accountId",a.treatment,a.movement_id::text AS "movementId"
        FROM finance.collection_allocations_test_only a JOIN commerce_collections c ON c.id=a.collection_id WHERE c.request_id=$1::uuid`,[body.requestId])).rows;
      assert.deepEqual(assignments,[{accountId:replayCustody.id,treatment:"CUSTODY_PENDING",movementId:null}]);
    }
    assert.equal(await db.serializable(tx=>pendingTestCollections(tx,replayCustody.id)),"12.00");
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE source_id=$1::bigint OR destination_id=$1::bigint",[replayCustody.id])).rows[0].n,0);
    assert.equal((await admin.query<{qty:string}>("SELECT qty_on_hand::text AS qty FROM stock_levels WHERE warehouse_id=$1::bigint AND product_id=2",[replayWarehouse])).rows[0].qty,"2.00");
    await admin.query(`INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT 9,1,role_code,'موظف فترة اختبار','pg-period@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3`);
    const ca = await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "CUSTODY", holderId: "9", openingAmount: "0", openingDate: today, counted: true }, today);
    const labSale = (await admin.query<{ id: string }>(`INSERT INTO commerce_sales(request_id,request_hash,branch_id,warehouse_id,customer_name,customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,created_by_id)
      SELECT $1::uuid,repeat('e',64),branch_id,warehouse_id,'عميل اصطناعي',customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,9 FROM commerce_sales WHERE id=2 RETURNING id::text`, [randomUUID()])).rows[0].id;
    const createAssigned = async (port: FinanceTransaction, request: string, amount: string) => {
      const result = await port.query<{ id: string }>(`INSERT INTO commerce_collections(request_id,request_hash,sale_id,amount,method,is_initial,created_by_id) VALUES($1::uuid,repeat('f',64),$2::bigint,$3::numeric,'CASH',false,9) RETURNING id::text`, [request,labSale,amount]);
      await allocateTestCollection(port, "9", result.rows[0].id);
      return result.rows[0].id;
    };
    const one = await db.serializable(tx => createAssigned(tx, randomUUID(), "5"));
    const newCandidate = async (sales: string) => (await admin!.query<{ id: string }>(`INSERT INTO finance.settlements(account_id,branch_id,requested_by,system_balance,counted_amount,sales_total,expenses_total,expected_amount,deviation,adjustment,reason)
      VALUES($1::bigint,1,9,0,0,$2::numeric,0,$2::numeric,0,0,'تسوية اصطناعية') RETURNING id::text`, [ca.id,sales])).rows[0].id;
    const s3 = await newCandidate("5");
    const review = await db.serializable(tx => reviewTestPeriod(tx, ca.id));
    const race1 = gate();
    const captureFirst = gatedFinance(prisma, race1).serializable(tx => captureTestPeriod(tx, ca.id, s3, "1", [one], [], review.hash));
    await race1.entered;
    const req2 = randomUUID();
    const delayedAssignment = db.serializable(tx => createAssigned(tx, req2, "7")).then(value => ({value}), error => ({error}));
    await waitForLock(admin, "accounts"); race1.release();
    await captureFirst;
    const assignmentOutcome = await delayedAssignment;
    assert.ok("error" in assignmentOutcome);
    const assignmentError: unknown = assignmentOutcome.error;
    assert.ok(typeof assignmentError === "object" && assignmentError !== null && "code" in assignmentError && assignmentError.code === "40001");
    assert.equal((await admin.query<{ n: string }>("SELECT count(*)::text AS n FROM commerce_collections WHERE request_id=$1::uuid", [req2])).rows[0].n, "0");
    const two = await db.serializable(tx => createAssigned(tx, req2, "7"));
    assert.equal(await db.serializable(tx => pendingTestCollections(tx, ca.id)), "7.00");
    const s4 = await newCandidate("7");
    const review2 = await db.serializable(tx => reviewTestPeriod(tx, ca.id));
    const race2 = gate();
    const assigningFirst = gatedFinance(prisma, race2, "FROM finance.accounts WHERE id=$1::bigint FOR UPDATE").serializable(tx => createAssigned(tx, randomUUID(), "2"));
    await race2.entered;
    let labAttempts = 0;
    const retryCapture = async () => {
      for (;;) {
        try { labAttempts++; return await db.serializable(tx => captureTestPeriod(tx, ca.id, s4, "1", [two], [], review2.hash)); }
        catch (e) { if (labAttempts < 3 && typeof e === "object" && e !== null && "code" in e && e.code === "40001") continue; throw e; }
      }
    };
    const staleCapture = retryCapture();
    await waitForLock(admin, "accounts"); race2.release();
    await assigningFirst;
    await assert.rejects(staleCapture, /تغيّرت عناصر الفترة/);
    assert.ok(labAttempts >= 2);
    assert.equal(await db.serializable(tx => pendingTestCollections(tx, ca.id)), "9.00");
    assert.equal((await admin.query<{ status: string }>("SELECT status FROM finance.settlements WHERE id=$1::bigint", [s4])).rows[0].status, "OPEN");
    // Experimental holder payment and allocation in the SAME synthetic
    // transaction; no application service is integrated by this exercise.
    const draftLab = async (amount: string) => {
      const expense = await createExpense(db, "9", { requestId: randomUUID(), branchId: "1", categoryId: "1", amount, expenseDate: today, description: "مصروف فترة اصطناعي" });
      await approveExpense(db, "1", { requestId: randomUUID(), expenseId: expense.id, expectedRevision: "1" });
      return expense.id;
    };
    const insertLabPayment = async (tx: FinanceTransaction, expenseId: string, amount: string) => {
      const r = await tx.query<{ id: string }>(`INSERT INTO finance.payments(expense_id,amount,method,account_id,payment_date,recorded_by,actually_paid,source)
        VALUES($1::bigint,$2::numeric,'CASH',NULL,$3::date,9,true,'HOLDER_CASH') RETURNING id::text`, [expenseId,amount,today]);
      await allocateTestHolderPayment(tx, "9", r.rows[0].id);
      await tx.query("UPDATE finance.expenses SET status='PAID',revision=revision+1 WHERE id=$1::bigint", [expenseId]);
      return r.rows[0].id;
    };
    const e1 = await draftLab("3");
    await admin.query("UPDATE finance.settlements SET sales_total=9,expected_amount=9 WHERE id=$1::bigint", [s4]);
    const periodBeforePayment = await db.serializable(tx => reviewTestPeriod(tx, ca.id));
    const g3 = gate();
    const captureBeforePay = gatedFinance(prisma, g3).serializable(tx => captureTestPeriod(tx, ca.id, s4, "1", periodBeforePayment.collections.map(r => r.id), [], periodBeforePayment.hash));
    await g3.entered;
    const delayedPay = db.serializable(tx => insertLabPayment(tx, e1, "3"));
    await waitForLock(admin, "accounts"); g3.release();
    await captureBeforePay;
    await assert.rejects(delayedPay, (e: unknown) => typeof e === "object" && e !== null && "code" in e && e.code === "40001");
    assert.equal((await admin.query<{ n: string }>("SELECT count(*)::text AS n FROM finance.payments WHERE expense_id=$1::bigint", [e1])).rows[0].n, "0");
    const payOne = await db.serializable(tx => insertLabPayment(tx, e1, "3"));
    const s5 = (await admin.query<{ id: string }>(`INSERT INTO finance.settlements(account_id,branch_id,requested_by,system_balance,counted_amount,sales_total,expenses_total,expected_amount,deviation,adjustment,reason)
      VALUES($1::bigint,1,9,0,0,0,3,-3,0,0,'تسوية مصروف اصطناعية') RETURNING id::text`, [ca.id])).rows[0].id;
    const reviewPay = await db.serializable(tx => reviewTestPeriod(tx, ca.id));
    const e2 = await draftLab("4");
    const g4 = gate();
    const payingBeforeCapture = gatedFinance(prisma, g4, "FROM finance.accounts WHERE branch_id=$1::bigint").serializable(tx => insertLabPayment(tx, e2, "4"));
    await g4.entered;
    let payCaptureAttempts = 0;
    const retryPayCapture = async () => {
      for (;;) {
        try { payCaptureAttempts++; return await db.serializable(tx => captureTestPeriod(tx, ca.id, s5, "1", [], [payOne], reviewPay.hash)); }
        catch (e) { if (payCaptureAttempts < 3 && typeof e === "object" && e !== null && "code" in e && e.code === "40001") continue; throw e; }
      }
    };
    const stalePaymentCapture = retryPayCapture();
    await waitForLock(admin, "accounts"); g4.release();
    await payingBeforeCapture;
    await assert.rejects(stalePaymentCapture, /تغيّرت عناصر الفترة/);
    assert.ok(payCaptureAttempts >= 2);
    const laterPayments = await db.serializable(tx => reviewTestPeriod(tx, ca.id));
    assert.equal(laterPayments.payments.length, 2, "both payment IDs remain pending after stale review");
    assert.equal((await admin.query<{ status: string }>("SELECT status FROM finance.settlements WHERE id=$1::bigint", [s5])).rows[0].status, "OPEN");

    // Real payExpense, wrapped only by a disposable experimental allocator in
    // the same transaction, against the synthetic period capture. The real
    // confirmation/settlement engine is deliberately NOT replaced here.
    await admin.query(`INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT 16,1,role_code,'موظف دمج اصطناعي','pg-runtime-period@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3`);
    const runtimeAccount = await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "CUSTODY", holderId: "16", openingAmount: "0", openingDate: today, counted: true }, today);
    await admin.query("UPDATE finance.accounts SET opened_at=now()-interval '1 day' WHERE id=$1::bigint", [runtimeAccount.id]);
    const runtimeDraft = async (amount: string) => {
      const e = await createExpense(db, "16", { requestId: randomUUID(), branchId: "1", categoryId: "1", amount, expenseDate: today, description: "صرف حقيقي في تجربة اصطناعية" });
      await approveExpense(db, "1", { requestId: randomUUID(), expenseId: e.id, expectedRevision: "1" });
      return { requestId: randomUUID(), expenseId: e.id, expectedRevision: "2", method: "CASH", accountId: null, paymentDate: today, actuallyPaid: true, source: "HOLDER_CASH" };
    };
    const runtimePayment1 = await runtimeDraft("3");
    await payExpense(testHolderPaymentService(db, "16"), "16", runtimePayment1, today);
    const runtimeRequest = () => ({ requestId: randomUUID(), accountId: runtimeAccount.id, expectedBalance: "0", countedAmount: "0", reason: "تسوية تجربة اصطناعية", actuallyCounted: true });
    const runtimeSettlement1 = await requestSettlement(db, "16", runtimeRequest());
    const runtimeReview1 = await db.serializable(tx => reviewTestPeriod(tx, runtimeAccount.id));
    assert.deepEqual(runtimeReview1.payments.map(x => x.amount), ["3.00"]);
    const runtimePayment2 = await runtimeDraft("4");
    const runtimeGate1 = gate();
    const runtimeCaptureFirst = gatedFinance(prisma, runtimeGate1).serializable(tx => captureTestPeriod(tx, runtimeAccount.id, runtimeSettlement1.id, "1", [], runtimeReview1.payments.map(p => p.id), runtimeReview1.hash));
    await runtimeGate1.entered;
    const realPayAfterCapture = payExpense(testHolderPaymentService(db, "16"), "16", runtimePayment2, today);
    try { await waitForLock(admin, "accounts"); } finally { runtimeGate1.release(); }
    await runtimeCaptureFirst;
    await realPayAfterCapture;
    assert.equal((await payExpense(testHolderPaymentService(db, "16"), "16", runtimePayment2, today)).replayed, true);
    const runtimeReview2 = await db.serializable(tx => reviewTestPeriod(tx, runtimeAccount.id));
    assert.deepEqual(runtimeReview2.payments.map(x => x.amount), ["4.00"]);
    const runtimeSettlement2 = await requestSettlement(db, "16", runtimeRequest());
    const runtimePayment3 = await runtimeDraft("5");
    const runtimeGate2 = gate();
    const realPayFirst = payExpense(testHolderPaymentService(gatedFinance(prisma, runtimeGate2, "WHERE branch_id=$1::bigint AND holder_id=$2::bigint AND kind='CUSTODY' AND closed_at IS NULL ORDER BY id FOR UPDATE"), "16"), "16", runtimePayment3, today);
    await runtimeGate2.entered;
    let captureRetries = 0;
    const recapture = async () => {
      for (;;) {
        try { captureRetries++; return await db.serializable(tx => captureTestPeriod(tx, runtimeAccount.id, runtimeSettlement2.id, "1", [], runtimeReview2.payments.map(p => p.id), runtimeReview2.hash)); }
        catch (e) { if (captureRetries < 3 && typeof e === "object" && e !== null && "code" in e && e.code === "40001") continue; throw e; }
      }
    };
    const staleRuntimeCapture = recapture();
    try { await waitForLock(admin, "accounts"); } finally { runtimeGate2.release(); }
    await realPayFirst;
    await assert.rejects(staleRuntimeCapture, /تغيّرت عناصر الفترة/);
    assert.ok(captureRetries >= 2);
    const remainingRuntime = await db.serializable(tx => reviewTestPeriod(tx, runtimeAccount.id));
    assert.deepEqual(remainingRuntime.payments.map(p => p.amount), ["4.00", "5.00"]);
    assert.equal((await admin.query<{ status: string }>("SELECT status FROM finance.settlements WHERE id=$1::bigint", [runtimeSettlement2.id])).rows[0].status, "OPEN");

    // A collection for an existing custody must not wait for the unrelated
    // vault lock. The production cash guard already owns the custody; grabbing
    // the vault afterward would invert transfer's vault-then-custody ordering.
    await admin.query(`INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT 17,1,role_code,'موظف أقفال اصطناعي','pg-lock-order@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3`);
    const lockAccount = await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "CUSTODY", holderId: "17", openingAmount: "0", openingDate: today, counted: true }, today);
    const lockSale = (await admin.query<{ id: string }>(`INSERT INTO commerce_sales(request_id,request_hash,branch_id,warehouse_id,customer_name,customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,created_by_id)
      SELECT $1::uuid,repeat('a',64),branch_id,warehouse_id,'فاتورة أقفال اصطناعية',customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,17 FROM commerce_sales WHERE id=2 RETURNING id::text`, [randomUUID()])).rows[0].id;
    const vaultId = (await admin.query<{ id: string }>("SELECT id::text FROM finance.accounts WHERE branch_id=1 AND kind='VAULT'")).rows[0].id;
    const timed = new Proxy(prisma, { get(target, key, receiver) {
      if (key !== "$transaction") return Reflect.get(target, key, receiver);
      return (work: (tx: unknown) => Promise<unknown>, options: unknown) => target.$transaction(async tx => {
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout='2s'");
        return work(tx);
      }, options as never);
    } }) as PrismaClient;
    const lockCollection = { requestId: randomUUID(), saleId: lockSale, amount: "6", method: "CASH", actuallyPaid: false };
    await admin.query("BEGIN");
    try {
      await admin.query("SELECT id FROM finance.accounts WHERE id=$1::bigint FOR UPDATE", [vaultId]);
      const collected = await recordCommerceCollection(testCollectionService(timed, "17"), 17n, lockCollection);
      assert.equal(collected.replayed, false);
    } finally { await admin.query("ROLLBACK"); }
    assert.equal((await db.serializable(tx => reviewTestPeriod(tx, lockAccount.id))).collections.length, 1);

    // Transfer locks the earlier vault first; collection owns the custody.
    // With the old all-candidates lock this forms a lock-order inversion.
    assert.ok(BigInt(vaultId) < BigInt(lockAccount.id));
    const vaultBalance = (await admin.query<{ balance: string }>(`SELECT (a.opening_amount+COALESCE((SELECT SUM(CASE WHEN destination_id=a.id THEN amount ELSE -amount END) FROM finance.movements WHERE source_id=a.id OR destination_id=a.id),0))::text AS balance FROM finance.accounts a WHERE a.id=$1::bigint`, [vaultId])).rows[0].balance;
    const transferInput = { requestId: randomUUID(), fromId: vaultId, toId: lockAccount.id, amount: "1", expectedBalance: vaultBalance, actuallyTransferred: true, negativeAcknowledged: false };
    const transferGate = gate(), collectionGate = gate();
    const transferring = transferCash(gatedFinance(prisma, transferGate), "1", transferInput);
    await transferGate.entered;
    const newCollection = { ...lockCollection, requestId: randomUUID(), amount: "7" };
    const collecting = recordCommerceCollection(testCollectionService(gatedCommerce(timed, collectionGate), "17"), 17n, newCollection);
    await collectionGate.entered;
    collectionGate.release();
    try {
      // Must finish without the vault, while transfer is explicitly paused.
      assert.equal((await collecting).replayed, false);
    } finally { transferGate.release(); }
    await transferring;
    assert.equal((await transferCash(db, "1", transferInput)).replayed, true);
    assert.equal((await recordCommerceCollection(testCollectionService(prisma, "17"), 17n, newCollection)).replayed, true);
    const assigned17 = await db.serializable(tx => reviewTestPeriod(tx, lockAccount.id));
    assert.deepEqual(assigned17.collections.map(row => row.amount), ["6.00", "7.00"]);
    assert.equal((await admin.query<{ n: string }>("SELECT count(*)::text AS n FROM finance.movements WHERE kind='TRANSFER' AND destination_id=$1::bigint", [lockAccount.id])).rows[0].n, "1");

    // Real confirmSettlement including real movements plus test-only period
    // attachment against real holder-cash payment, in both commit orders.
    await admin.query(`INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT 18,1,role_code,'موظف اعتماد اصطناعي','pg-real-confirm@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3`);
    const realAccount = await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "CUSTODY", holderId: "18", openingAmount: "0", openingDate: today, counted: true }, today);
    await admin.query("UPDATE finance.accounts SET opened_at=now()-interval '1 day' WHERE id=$1::bigint", [realAccount.id]);
    const realSale = (await admin.query<{ id: string }>(`INSERT INTO commerce_sales(request_id,request_hash,branch_id,warehouse_id,customer_name,customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,created_by_id)
      SELECT $1::uuid,repeat('a',64),branch_id,warehouse_id,'فاتورة اعتماد اصطناعية',customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,18 FROM commerce_sales WHERE id=2 RETURNING id::text`, [randomUUID()])).rows[0].id;
    await recordCommerceCollection(testCollectionService(prisma, "18"), 18n, { requestId: randomUUID(), saleId: realSale, amount: "10", method: "CASH", actuallyPaid: false });
    const realDraft = async (amount: string) => {
      const e = await createExpense(db, "18", { requestId: randomUUID(), branchId: "1", categoryId: "1", amount, expenseDate: today, description: "مصروف اعتماد اصطناعي" });
      await approveExpense(db, "1", { requestId: randomUUID(), expenseId: e.id, expectedRevision: "1" });
      return { requestId: randomUUID(), expenseId: e.id, expectedRevision: "2", method: "CASH", accountId: null, paymentDate: today, actuallyPaid: true, source: "HOLDER_CASH" };
    };
    await payExpense(testHolderPaymentService(db, "18"), "18", await realDraft("3"), today);
    const payAfterConfirm = await realDraft("4");
    const realRequest1 = await requestSettlement(db, "18", { requestId: randomUUID(), accountId: realAccount.id, expectedBalance: "0", countedAmount: "7", reason: "طلب حقيقي اصطناعي", actuallyCounted: true });
    const realReview1 = await db.serializable(tx => reviewTestPeriod(tx, realAccount.id));
    const realHook = (review: typeof realReview1) => ({ accountId: realAccount.id, actorId: "1", collectionIds: review.collections.map(c => c.id), paymentIds: review.payments.map(p => p.id), reviewedHash: review.hash });
    const realDecision1 = { requestId: randomUUID(), settlementId: realRequest1.id, expectedBalance: "0", transferAmount: "7", transferDirection: "TO_VAULT", reason: "اعتماد حقيقي اصطناعي", actuallyTransferred: true };
    const realConfirmGate = gate();
    const confirmWithCapture = confirmSettlement(testRealSettlementWithPeriod(gatedFinance(prisma, realConfirmGate), realHook(realReview1)), "1", realDecision1);
    await realConfirmGate.entered;
    const delayedRealPayment = payExpense(testHolderPaymentService(db, "18"), "18", payAfterConfirm, today);
    try { await waitForLock(admin, "accounts"); } finally { realConfirmGate.release(); }
    await confirmWithCapture; await delayedRealPayment;
    assert.equal((await confirmSettlement(testRealSettlementWithPeriod(db, realHook(realReview1)), "1", realDecision1)).replayed, true);
    assert.equal((await admin.query<{ n: string }>("SELECT count(*)::text AS n FROM finance.movements WHERE settlement_id=$1::bigint", [realRequest1.id])).rows[0].n, "2");
    const realReview2 = await db.serializable(tx => reviewTestPeriod(tx, realAccount.id));
    assert.deepEqual(realReview2.payments.map(p => p.amount), ["4.00"]);
    const payBeforeConfirm = await realDraft("5");
    const realRequest2 = await requestSettlement(db, "18", { requestId: randomUUID(), accountId: realAccount.id, expectedBalance: "0", countedAmount: "0", reason: "طلب حقيقي ثان", actuallyCounted: true });
    const realPayGate = gate();
    const realPaymentFirst = payExpense(testHolderPaymentService(gatedFinance(prisma, realPayGate, "WHERE branch_id=$1::bigint AND holder_id=$2::bigint AND kind='CUSTODY' AND closed_at IS NULL ORDER BY id FOR UPDATE"), "18"), "18", payBeforeConfirm, today);
    await realPayGate.entered;
    const realStaleConfirmation = confirmSettlement(testRealSettlementWithPeriod(db, realHook(realReview2)), "1", { ...realDecision1, requestId: randomUUID(), settlementId: realRequest2.id, transferAmount: "0" });
    try { await waitForLock(admin, "accounts"); } finally { realPayGate.release(); }
    await realPaymentFirst;
    await assert.rejects(realStaleConfirmation, /تغيّرت العهدة منذ طلب التسوية/);
    assert.equal((await admin.query<{ status: string }>("SELECT status FROM finance.settlements WHERE id=$1::bigint", [realRequest2.id])).rows[0].status, "OPEN");
    assert.equal((await admin.query<{ n: string }>("SELECT count(*)::text AS n FROM finance.movements WHERE settlement_id=$1::bigint", [realRequest2.id])).rows[0].n, "0");
    assert.deepEqual((await db.serializable(tx => reviewTestPeriod(tx, realAccount.id))).payments.map(p => p.amount), ["4.00", "5.00"]);

    // Real cash refund vs real confirmation with the test-only allocation hook.
    // The hook is not an application integration; both lock orders use separate
    // synthetic holders, and the receipt cannot itself capture refund evidence.
    await admin.query(`INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT n,1,role_code,'موظف رد وتسوية اصطناعي '||n,'pg-period-refund-'||n||'@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now()
      FROM users CROSS JOIN generate_series(70,71) n WHERE id=3`);
    for (const holder of ["70", "71"]) {
      const refundCustody = await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "CUSTODY", holderId: holder, openingAmount: "20", openingDate: today, counted: true }, today);
      await admin.query("UPDATE finance.accounts SET opened_at=now()-interval '1 day' WHERE id=$1::bigint", [refundCustody.id]);
      const sold = await createCommerceSale(testCollectionService(prisma, holder), BigInt(holder), { ...stock, requestId: randomUUID(), initialPayment: "10", method: "CASH" });
      const soldLine = await prisma.commerceSaleLine.findFirstOrThrow({ where: { saleId: BigInt(sold.id) }, select: { id: true } });
      await returnCommerceSale(prisma, 1n, { requestId: randomUUID(), saleId: sold.id, cancel: false, accepted: true, lines: [{ saleLineId: String(soldLine.id), quantity: "1", serialIds: [] }] });
      const reviewed = await db.serializable(tx => reviewTestPeriod(tx, refundCustody.id));
      assert.deepEqual(reviewed.collections.map(x => x.amount), ["10.00"]);
      const req = await requestSettlement(db, holder, { requestId: randomUUID(), accountId: refundCustody.id, expectedBalance: "20", countedAmount: "30", reason: "تسوية ورد متزامنان اصطناعيًا", actuallyCounted: true });
      const hook = { accountId: refundCustody.id, actorId: "1", collectionIds: reviewed.collections.map(x => x.id), paymentIds: [], reviewedHash: reviewed.hash };
      const decision = { requestId: randomUUID(), settlementId: req.id, expectedBalance: "20", transferAmount: "0", transferDirection: "TO_VAULT", reason: "تأكيد اصطناعي مع تحويل صفر", actuallyTransferred: true };
      const refund = { requestId: randomUUID(), saleId: sold.id, amount: "4", method: "CASH", actuallyPaid: true, accountId: refundCustody.id, negativeAcknowledged: false, checkpointRef: "OPENING", timing: "AFTER_REVIEWED_CHECKPOINT" };
      const lock = gate();
      if (holder === "70") {
        const confirmed = confirmSettlement(testRealSettlementWithPeriod(gatedFinance(prisma, lock), hook), "1", decision);
        await lock.entered;
        const delayedRefund = recordCommerceRefund(prisma, 1n, refund);
        try { await waitForLock(admin, "accounts"); } finally { lock.release(); }
        assert.equal((await confirmed).replayed, false);
        const saved = await delayedRefund;
        assert.equal(saved.replayed, false);
        assert.deepEqual(await recordCommerceRefund(prisma, 1n, refund), { id: saved.id, replayed: true });
        assert.equal((await confirmSettlement(testRealSettlementWithPeriod(db, hook), "1", decision)).replayed, true);
        assert.equal((await db.serializable(tx => reviewTestPeriod(tx, refundCustody.id))).collections.length, 0);
        assert.equal((await admin.query<{n:string}>("SELECT count(*)::text AS n FROM finance.settlement_allocation_receipts_test_only WHERE settlement_id=$1::bigint", [req.id])).rows[0].n, "1");
      } else {
        const refundFirst = recordCommerceRefund(gatedRefundAccount(prisma, lock), 1n, refund);
        await lock.entered;
        const staleConfirmation = confirmSettlement(testRealSettlementWithPeriod(db, hook), "1", decision).then(value => ({ value }), error => ({ error }));
        try { await waitForLock(admin, "accounts"); } finally { lock.release(); }
        const saved = await refundFirst;
        const failed = await staleConfirmation;
        assert.ok("error" in failed);
        assert.match(String(failed.error), /تغيّرت العهدة منذ طلب التسوية/);
        assert.deepEqual(await recordCommerceRefund(prisma, 1n, refund), { id: saved.id, replayed: true });
        assert.deepEqual(await db.serializable(tx => reviewTestPeriod(tx, refundCustody.id)), reviewed, "refund movement is not in the experimental period hash");
        assert.equal((await admin.query<{status:string}>("SELECT status FROM finance.settlements WHERE id=$1::bigint", [req.id])).rows[0].status, "OPEN");
        assert.equal((await admin.query<{n:string}>("SELECT count(*)::text AS n FROM finance.settlement_allocation_receipts_test_only WHERE settlement_id=$1::bigint", [req.id])).rows[0].n, "0");
        assert.equal((await admin.query<{n:string}>("SELECT count(*)::text AS n FROM finance.requests WHERE request_id=$1::uuid", [decision.requestId])).rows[0].n, "0");
      }
      const movements: { n: string; amount: string } = (await admin.query<{n:string;amount:string}>("SELECT count(*)::text AS n,COALESCE(sum(amount),0)::text AS amount FROM finance.movements WHERE kind='REFUND' AND source_id=$1::bigint", [refundCustody.id])).rows[0];
      assert.deepEqual(movements, { n: "1", amount: "4.00" });
      const book: { balance: string; settlementMovements: string } = (await admin.query<{balance:string;settlementMovements:string}>(`SELECT
        (a.opening_amount+COALESCE((SELECT SUM(CASE WHEN destination_id=a.id THEN amount ELSE -amount END) FROM finance.movements WHERE source_id=a.id OR destination_id=a.id),0))::text AS balance,
        (SELECT count(*)::text FROM finance.movements WHERE settlement_id=$2::bigint) AS "settlementMovements"
        FROM finance.accounts a WHERE a.id=$1::bigint`, [refundCustody.id, req.id])).rows[0];
      assert.deepEqual(book, holder === "70" ? { balance: "26.00", settlementMovements: "1" } : { balance: "16.00", settlementMovements: "0" });
    }

    // The revision-checked *standalone* laboratory capture is not the real
    // settlement engine. Test its two account-lock orders against real refunds.
    await admin.query(`INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT n,1,role_code,'موظف مقارنة نسخة اصطناعي '||n,'pg-revision-probe-'||n||'@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now()
      FROM users CROSS JOIN generate_series(74,75) n WHERE id=3`);
    for (const holder of ["74", "75"]) {
      const account = await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "CUSTODY", holderId: holder, openingAmount: "20", openingDate: today, counted: true }, today);
      await admin.query("UPDATE finance.accounts SET opened_at=now()-interval '1 day' WHERE id=$1::bigint", [account.id]);
      const sale = await createCommerceSale(testCollectionService(prisma, holder), BigInt(holder), { ...stock, requestId: randomUUID(), initialPayment: "10", method: "CASH" });
      const line = await prisma.commerceSaleLine.findFirstOrThrow({ where: { saleId: BigInt(sale.id) }, select: { id: true } });
      await returnCommerceSale(prisma, 1n, { requestId: randomUUID(), saleId: sale.id, cancel: false, accepted: true, lines: [{ saleLineId: String(line.id), quantity: "1", serialIds: [] }] });
      const reviewed = await db.serializable(tx => reviewTestPeriod(tx, account.id));
      const request = await requestSettlement(db, holder, { requestId: randomUUID(), accountId: account.id, expectedBalance: "20", countedAmount: "30", reason: "مقارنة نسخة تجريبية", actuallyCounted: true });
      const refund = { requestId: randomUUID(), saleId: sale.id, amount: "4", method: "CASH", actuallyPaid: true, accountId: account.id, negativeAcknowledged: false, checkpointRef: "OPENING", timing: "AFTER_REVIEWED_CHECKPOINT" };
      const capture = (tx: FinanceTransaction) => captureRevisionCheckedTestPeriod(tx, account.id, request.id, "1", reviewed.collections.map(x => x.id), [], reviewed.hash);
      const lock = gate();
      if (holder === "74") {
        const first: Promise<{replayed:boolean}> = gatedFinance(prisma, lock).serializable(capture);
        await lock.entered;
        const after = recordCommerceRefund(prisma, 1n, refund);
        try { await waitForLock(admin, "accounts"); } finally { lock.release(); }
        assert.equal((await first).replayed, false);
        const saved = await after;
        assert.deepEqual(await recordCommerceRefund(prisma, 1n, refund), { id: saved.id, replayed: true });
        assert.equal((await db.serializable(capture)).replayed, true, "the lab receipt replays after the refund bumped the account revision");
        assert.equal((await db.serializable(tx => reviewTestPeriod(tx, account.id))).collections.length, 0);
      } else {
        const first = recordCommerceRefund(gatedRefundAccount(prisma, lock), 1n, refund);
        await lock.entered;
        let attempts = 0;
        const retryCapture = async () => {
          for (;;) {
            try { attempts++; return await db.serializable(capture); }
            catch (e) { if (attempts < 3 && typeof e === "object" && e !== null && "code" in e && e.code === "40001") continue; throw e; }
          }
        };
        const after = retryCapture().then(value => ({ value }), error => ({ error }));
        try { await waitForLock(admin, "accounts"); } finally { lock.release(); }
        const saved = await first;
        const failed = await after;
        assert.ok("error" in failed);
        assert.match(String(failed.error), /تغيّرت نسخة العهدة/);
        assert.ok(attempts >= 2, "serialization retry is test-harness behavior");
        assert.deepEqual(await recordCommerceRefund(prisma, 1n, refund), { id: saved.id, replayed: true });
        assert.deepEqual(await db.serializable(tx => reviewTestPeriod(tx, account.id)), reviewed);
      }
      const state: {status:string;receipts:string;refunds:string;settlementMoves:string} = (await admin.query<{status:string;receipts:string;refunds:string;settlementMoves:string}>(`SELECT s.status,
        (SELECT count(*)::text FROM finance.settlement_allocation_receipts_test_only WHERE settlement_id=s.id) AS receipts,
        (SELECT count(*)::text FROM finance.movements WHERE kind='REFUND' AND source_id=s.account_id) AS refunds,
        (SELECT count(*)::text FROM finance.movements WHERE settlement_id=s.id) AS "settlementMoves"
        FROM finance.settlements s WHERE id=$1::bigint`, [request.id])).rows[0];
      assert.deepEqual(state, holder === "74" ? {status:"CONFIRMED",receipts:"1",refunds:"1",settlementMoves:"0"} : {status:"OPEN",receipts:"0",refunds:"1",settlementMoves:"0"});
    }

    // Selected races against a deliberately non-cooperating synthetic writer.
    // Locking the collection row protects the interceptor's current check,
    // not source history or later mutations; no application writer is implied.
    await admin.query(`INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT n,1,role_code,'موظف مصدر اصطناعي '||n,'pg-source-race-'||n||'@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now()
      FROM users CROSS JOIN generate_series(77,78) n WHERE id=3`);
    for (const holder of ["77", "78"]) {
      const account = await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "CUSTODY", holderId: holder, openingAmount: "0", openingDate: today, counted: true }, today);
      await admin.query("UPDATE finance.accounts SET opened_at=now()-interval '1 day' WHERE id=$1::bigint", [account.id]);
      await createCommerceSale(testCollectionService(prisma, holder), BigInt(holder), { ...stock, requestId: randomUUID(), initialPayment: "10", method: "CASH" });
      const review = await db.serializable(tx => reviewTestPeriod(tx, account.id));
      assert.deepEqual(review.collections.map(x => x.amount), ["10.00"]);
      const collectionId = review.collections[0].id;
      const request = await requestSettlement(db, holder, { requestId: randomUUID(), accountId: account.id, expectedBalance: "0", countedAmount: "10", reason: "تزامن مصدر اصطناعي", actuallyCounted: true });
      const decision = { requestId: randomUUID(), settlementId: request.id, expectedBalance: "0", transferAmount: "0", transferDirection: "TO_VAULT", reason: "تأكيد مصدر اصطناعي", actuallyTransferred: true };
      const hook = { accountId: account.id, actorId: "1", collectionIds: [collectionId], paymentIds: [], reviewedHash: review.hash };
      if (holder === "77") {
        // Direct writer commits a recorder change while confirmation waits.
        await admin.query("BEGIN");
        await admin.query("UPDATE commerce_collections SET created_by_id=1 WHERE id=$1::bigint", [collectionId]);
        const pending = confirmSettlement(testRealSettlementWithPeriod(db, hook), "1", decision).then(value => ({ value }), error => ({ error }));
        try { await waitForLock(admin, "commerce_collections"); } finally { await admin.query("COMMIT"); }
        const outcome = await pending;
        assert.ok("error" in outcome);
        assert.match(String(outcome.error), /مصدر التحصيل المخصص غير متسق/);
        assert.equal((await admin.query<{status:string}>("SELECT status FROM finance.settlements WHERE id=$1::bigint", [request.id])).rows[0].status, "OPEN");
        assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE settlement_id=$1::bigint", [request.id])).rows[0].n, 0);
        assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.settlement_allocation_receipts_test_only WHERE settlement_id=$1::bigint", [request.id])).rows[0].n, 0);
        assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.requests WHERE request_id=$1::uuid", [decision.requestId])).rows[0].n, 0);
        assert.deepEqual(await db.serializable(tx => reviewTestPeriod(tx, account.id)), review);
        // Fixture repair only; reuse of the unstored request ID proves no
        // confirmation was persisted by the failed attempt.
        await admin.query("UPDATE commerce_collections SET created_by_id=$2::bigint WHERE id=$1::bigint", [collectionId,holder]);
        assert.equal((await confirmSettlement(testRealSettlementWithPeriod(db, hook), "1", decision)).replayed, false);
      } else {
        // The interceptor owns the collection row until confirmation commits.
        const lock = gate();
        const confirming = confirmSettlement(testRealSettlementWithPeriod(gatedFinance(prisma, lock, "ORDER BY a.collection_id FOR UPDATE OF a,c,sale"), hook), "1", decision);
        await lock.entered;
        const writer: Promise<number> = Promise.resolve(prisma.$executeRawUnsafe("UPDATE commerce_collections SET created_by_id=1 WHERE id=$1::bigint", collectionId));
        try { await waitForLock(admin, "commerce_collections"); } finally { lock.release(); }
        assert.equal((await confirming).replayed, false);
        assert.equal(await writer, 1);
        assert.equal((await admin.query<{recorder:string}>("SELECT created_by_id::text AS recorder FROM commerce_collections WHERE id=$1::bigint", [collectionId])).rows[0].recorder, "1");
        const driftReport = await prisma.$transaction(async tx => {
          await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
          await tx.$queryRawUnsafe("SELECT set_config('selahtone.cutover_period_audit_test_only','yes',true)");
          return auditTestOnlyReceipts(financePort(tx), account.id);
        }, { isolationLevel: "Serializable", timeout: 20000 });
        const driftReceipt = driftReport.reviews.find(item => item.settlementId === request.id);
        assert.ok(driftReceipt);
        assert.ok(driftReceipt.issues.includes("invalid_collection_allocation"));
        assert.ok(!driftReceipt.issues.includes("snapshot_mismatch"), "the fingerprint itself omits recorder identity");
        // Existing command replay does not rerun the interceptor and cannot
        // certify source fields against a later direct write.
        assert.equal((await confirmSettlement(testRealSettlementWithPeriod(db, hook), "1", decision)).replayed, true);
        await admin.query("UPDATE commerce_collections SET created_by_id=$2::bigint WHERE id=$1::bigint", [collectionId,holder]);
      }
      assert.equal((await confirmSettlement(testRealSettlementWithPeriod(db, hook), "1", decision)).replayed, true);
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE settlement_id=$1::bigint", [request.id])).rows[0].n, 1);
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.settlement_allocation_receipts_test_only WHERE settlement_id=$1::bigint", [request.id])).rows[0].n, 1);
    }

    // A separate-source refund: the collection belongs to the synthetic
    // custody while the refund debits the vault. Confirm and refund share the
    // vault lock, but a vault movement alone is not a custody movement.
    await admin.query(`INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT n,1,role_code,'موظف رد من خزنة اصطناعي '||n,'pg-vault-period-'||n||'@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now()
      FROM users CROSS JOIN generate_series(72,73) n WHERE id=3`);
    const vaultBook = async (): Promise<string> => (await admin!.query<{balance:string}>(`SELECT
      (a.opening_amount+COALESCE((SELECT SUM(CASE WHEN destination_id=a.id THEN amount ELSE -amount END) FROM finance.movements WHERE source_id=a.id OR destination_id=a.id),0))::text AS balance
      FROM finance.accounts a WHERE a.id=$1::bigint`, [vaultId])).rows[0].balance;
    for (const holder of ["72", "73"]) {
      const selectedCustody = await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "CUSTODY", holderId: holder, openingAmount: "20", openingDate: today, counted: true }, today);
      await admin.query("UPDATE finance.accounts SET opened_at=now()-interval '1 day' WHERE id=$1::bigint", [selectedCustody.id]);
      const invoice = await createCommerceSale(testCollectionService(prisma, holder), BigInt(holder), { ...stock, requestId: randomUUID(), initialPayment: "10", method: "CASH" });
      const line = await prisma.commerceSaleLine.findFirstOrThrow({ where: { saleId: BigInt(invoice.id) }, select: { id: true } });
      await returnCommerceSale(prisma, 1n, { requestId: randomUUID(), saleId: invoice.id, cancel: false, accepted: true, lines: [{ saleLineId: String(line.id), quantity: "1", serialIds: [] }] });
      const reviewed = await db.serializable(tx => reviewTestPeriod(tx, selectedCustody.id));
      assert.deepEqual(reviewed.collections.map(x => x.amount), ["10.00"]);
      const req = await requestSettlement(db, holder, { requestId: randomUUID(), accountId: selectedCustody.id, expectedBalance: "20", countedAmount: "30", reason: "تسوية اصطناعية ورد من خزنة", actuallyCounted: true });
      const hook = { accountId: selectedCustody.id, actorId: "1", collectionIds: reviewed.collections.map(x => x.id), paymentIds: [], reviewedHash: reviewed.hash };
      const decision = { requestId: randomUUID(), settlementId: req.id, expectedBalance: "20", transferAmount: "0", transferDirection: "TO_VAULT", reason: "تأكيد اصطناعي مع تحويل صفر", actuallyTransferred: true };
      const lastCount: string | undefined = (await admin.query<{id:string}>("SELECT id::text AS id FROM finance.cash_counts WHERE account_id=$1::bigint AND status='CONFIRMED' ORDER BY id DESC LIMIT 1", [vaultId])).rows[0]?.id;
      const refund: { requestId: string; saleId: string; amount: string; method: string; actuallyPaid: boolean; accountId: string; negativeAcknowledged: boolean; checkpointRef: string; timing: string } = { requestId: randomUUID(), saleId: invoice.id, amount: "4", method: "CASH", actuallyPaid: true, accountId: vaultId, negativeAcknowledged: false, checkpointRef: lastCount ?? "OPENING", timing: "AFTER_REVIEWED_CHECKPOINT" };
      const vaultBefore = await vaultBook();
      const lock = gate();
      let savedRefund: {id:string;replayed:boolean};
      if (holder === "72") {
        const vaultFirst = recordCommerceRefund(gatedRefundAccount(prisma, lock), 1n, refund);
        await lock.entered;
        const confirmAfter = confirmSettlement(testRealSettlementWithPeriod(db, hook), "1", decision);
        try { await waitForLock(admin, "accounts"); } finally { lock.release(); }
        savedRefund = await vaultFirst;
        assert.equal((await confirmAfter).replayed, false);
      } else {
        const confirmFirst = confirmSettlement(testRealSettlementWithPeriod(gatedFinance(prisma, lock, "FROM finance.accounts WHERE branch_id=$1::bigint AND kind='VAULT' FOR UPDATE"), hook), "1", decision);
        await lock.entered;
        const vaultAfter = recordCommerceRefund(prisma, 1n, refund);
        try { await waitForLock(admin, "accounts"); } finally { lock.release(); }
        assert.equal((await confirmFirst).replayed, false);
        savedRefund = await vaultAfter;
      }
      assert.equal(savedRefund.replayed, false);
      assert.deepEqual(await recordCommerceRefund(prisma, 1n, refund), { id: savedRefund.id, replayed: true });
      assert.equal((await confirmSettlement(testRealSettlementWithPeriod(db, hook), "1", decision)).replayed, true);
      assert.equal((await db.serializable(tx => reviewTestPeriod(tx, selectedCustody.id))).collections.length, 0);
      const state: {status:string;refunds:string;settlementMoves:string;receipts:string;custodyBalance:string} = (await admin.query<{status:string;refunds:string;settlementMoves:string;receipts:string;custodyBalance:string}>(`SELECT s.status,
        (SELECT count(*)::text FROM finance.movements WHERE kind='REFUND' AND source_id=$3::bigint AND external_ref=$4) AS refunds,
        (SELECT count(*)::text FROM finance.movements WHERE settlement_id=s.id) AS "settlementMoves",
        (SELECT count(*)::text FROM finance.settlement_allocation_receipts_test_only WHERE settlement_id=s.id) AS receipts,
        (a.opening_amount+COALESCE((SELECT SUM(CASE WHEN destination_id=a.id THEN amount ELSE -amount END) FROM finance.movements WHERE source_id=a.id OR destination_id=a.id),0))::text AS "custodyBalance"
        FROM finance.settlements s JOIN finance.accounts a ON a.id=s.account_id WHERE s.id=$1::bigint AND a.id=$2::bigint`, [req.id,selectedCustody.id,vaultId,`refund:${savedRefund.id}`])).rows[0];
      assert.deepEqual(state, { status: "CONFIRMED", refunds: "1", settlementMoves: "1", receipts: "1", custodyBalance: "30.00" });
      assert.equal(Number(await vaultBook()), Number(vaultBefore) - 4, "only the vault refund changes its balance when handover is zero");
    }

    // Equal totals with different collection IDs: the experimental transition
    // cross-check must abort the real confirmation transaction in PostgreSQL.
    // These rows deliberately model divergent legacy attribution, not history.
    await admin.query(`INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT 76,1,role_code,'موظف اختلاف فترة اصطناعي','pg-period-cross@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3`);
    const crossoverAccount = await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "CUSTODY", holderId: "76", openingAmount: "0", openingDate: today, counted: true }, today);
    await admin.query("UPDATE finance.accounts SET opened_at=now()-interval '1 day' WHERE id=$1::bigint", [crossoverAccount.id]);
    const crossSale = async (creator: string): Promise<string> => (await admin!.query<{id:string}>(`INSERT INTO commerce_sales(request_id,request_hash,branch_id,warehouse_id,customer_name,customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,created_by_id)
      SELECT $1::uuid,repeat('a',64),branch_id,warehouse_id,'اختلاف فترة اصطناعي',customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,$2::bigint FROM commerce_sales WHERE id=2 RETURNING id::text`, [randomUUID(),creator])).rows[0].id;
    const foreign = await crossSale("1"), own = await crossSale("76");
    const crossCollection = async (saleId: string, recorder: string): Promise<string> => (await admin!.query<{id:string}>(`INSERT INTO commerce_collections(request_id,request_hash,sale_id,amount,method,is_initial,created_by_id)
      VALUES($1::uuid,repeat('b',64),$2::bigint,10,'CASH',false,$3::bigint) RETURNING id::text`, [randomUUID(),saleId,recorder])).rows[0].id;
    const assignedId = await crossCollection(foreign, "76");
    const oldFormulaId = await crossCollection(own, "1");
    await db.serializable(tx => allocateTestCollection(tx, "76", assignedId));
    const crossReview = await db.serializable(tx => reviewTestPeriod(tx, crossoverAccount.id));
    assert.deepEqual(crossReview.collections.map(x => [x.id, x.amount]), [[assignedId, "10.00"]]);
    const crossOld = await admin.query<{id:string;amount:string}>(`SELECT c.id::text AS id,c.amount::text AS amount FROM commerce_collections c JOIN commerce_sales s ON s.id=c.sale_id JOIN finance.accounts a ON a.id=$1::bigint
      WHERE s.branch_id=a.branch_id AND s.created_by_id=a.holder_id AND c.method='CASH' AND c.created_at>a.opened_at ORDER BY c.id`, [crossoverAccount.id]);
    assert.deepEqual(crossOld.rows, [{id:oldFormulaId,amount:"10.00"}]);
    assert.notEqual(assignedId, oldFormulaId);
    const crossRequest = await requestSettlement(db, "76", { requestId: randomUUID(), accountId: crossoverAccount.id, expectedBalance: "0", countedAmount: "10", reason: "اختلاف عناصر اصطناعي", actuallyCounted: true });
    const crossDecision = { requestId: randomUUID(), settlementId: crossRequest.id, expectedBalance: "0", transferAmount: "10", transferDirection: "TO_VAULT", reason: "اختبار تطابق العناصر", actuallyTransferred: true };
    const crossHook = { accountId: crossoverAccount.id, actorId: "1", collectionIds: [assignedId], paymentIds: [], reviewedHash: crossReview.hash };
    const crossState = async () => (await admin!.query(`SELECT s.status,a.revision::text AS custody_revision,v.revision::text AS vault_revision,
      (SELECT count(*)::int FROM finance.movements) AS movements,
      (SELECT count(*)::int FROM finance.audit_events) AS audits,
      (SELECT count(*)::int FROM finance.requests WHERE request_id=$3::uuid) AS requests,
      (SELECT count(*)::int FROM finance.settlement_allocation_receipts_test_only WHERE settlement_id=s.id) AS receipts,
      (SELECT count(*)::int FROM finance.collection_allocations_test_only WHERE collection_id=$4::bigint AND settlement_id IS NULL) AS pending
      FROM finance.settlements s JOIN finance.accounts a ON a.id=s.account_id JOIN finance.accounts v ON v.id=$2::bigint WHERE s.id=$1::bigint`, [crossRequest.id,vaultId,crossDecision.requestId,assignedId])).rows[0];
    const beforeCross = await crossState();
    assert.equal(beforeCross.status, "OPEN");
    assert.equal(beforeCross.pending, 1);
    assert.equal(beforeCross.requests, 0);
    assert.equal(beforeCross.receipts, 0);
    await assert.rejects(() => db.serializable(async tx => {
      await tx.query("UPDATE commerce_collections SET created_by_id=1 WHERE id=$1::bigint", [assignedId]);
      assert.deepEqual(await reviewTestPeriod(tx, crossoverAccount.id), crossReview, "the ID/amount fingerprint does not contain the recorder");
      const joined: FinanceDatabase = { serializable: work => work(tx) };
      await confirmSettlement(testRealSettlementWithPeriod(joined, crossHook), "1", crossDecision);
    }), /مصدر التحصيل المخصص غير متسق/);
    assert.equal((await admin.query<{recorder:string}>("SELECT created_by_id::text AS recorder FROM commerce_collections WHERE id=$1::bigint", [assignedId])).rows[0].recorder, "76");
    assert.deepEqual(await crossState(), beforeCross, "source inconsistency rolls back the confirmation and the deliberately changed recorder");
    await assert.rejects(() => confirmSettlement(testRealSettlementWithPeriod(db, crossHook), "1", crossDecision), /العناصر المخصصة لا تطابق عناصر معادلة التسوية الحالية/);
    assert.deepEqual(await crossState(), beforeCross, "the injected mismatch rolls back status, revisions, movements, audit, command and receipt");
    assert.deepEqual(await db.serializable(tx => reviewTestPeriod(tx, crossoverAccount.id)), crossReview);

    // Exact pending-item contract example, on PostgreSQL with the real
    // commerce/finance services and the experimental membership hook only.
    await admin.query(`INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT 79,1,role_code,'موظف عقد معلق اصطناعي','pg-pending-contract@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3`);
    const pendingAccount = await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "CUSTODY", holderId: "79", openingAmount: "100", openingDate: today, counted: true }, today);
    await admin.query("UPDATE finance.accounts SET opened_at=now()-interval '1 day' WHERE id=$1::bigint", [pendingAccount.id]);
    const pendingSale: string = (await admin.query<{id:string}>(`INSERT INTO commerce_sales(request_id,request_hash,branch_id,warehouse_id,customer_name,customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,created_by_id)
      SELECT $1::uuid,repeat('a',64),branch_id,warehouse_id,'عقد معلق اصطناعي',customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,79 FROM commerce_sales WHERE id=2 RETURNING id::text`, [randomUUID()])).rows[0].id;
    const pendingCollectionInput = { requestId: randomUUID(), saleId: pendingSale, amount: "30", method: "CASH", actuallyPaid: false };
    const pendingCollection = await recordCommerceCollection(testCollectionService(prisma, "79"), 79n, pendingCollectionInput);
    const pendingExpense = await createExpense(db, "79", { requestId: randomUUID(), branchId: "1", categoryId: "1", amount: "10", expenseDate: today, description: "مصروف عقد معلق اصطناعي" });
    await approveExpense(db, "1", { requestId: randomUUID(), expenseId: pendingExpense.id, expectedRevision: "1" });
    const pendingPaymentInput = { requestId: randomUUID(), expenseId: pendingExpense.id, expectedRevision: "2", method: "CASH", accountId: null, paymentDate: today, actuallyPaid: true, source: "HOLDER_CASH" };
    const pendingPayment = await payExpense(testHolderPaymentService(db, "79"), "79", pendingPaymentInput, today);
    const pendingContractReview = await db.serializable(tx => reviewTestPeriod(tx, pendingAccount.id));
    assert.deepEqual(pendingContractReview.collections.map(x => [x.id,x.amount]), [[pendingCollection.id,"30.00"]]);
    assert.deepEqual(pendingContractReview.payments.map(x => [x.id,x.amount]), [[pendingPayment.id,"10.00"]]);
    const pendingBefore = await settlementOverview(db, "79", pendingAccount.id);
    assert.equal(pendingBefore.account?.balance,"100.00"); assert.equal(pendingBefore.sales,"30.00"); assert.equal(pendingBefore.expenses,"10.00"); assert.equal(pendingBefore.expected,"120.00");
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE source_id=$1::bigint OR destination_id=$1::bigint", [pendingAccount.id])).rows[0].n, 0);
    await checkCountPendingSourceDrift(admin,db,pendingAccount.id,pendingCollection.id,pendingPayment.id,today);
    await checkCountSourceRace(admin,prisma,db,pendingAccount.id,pendingCollection.id,pendingPayment.id,today);
    const pendingRequestInput = { requestId: randomUUID(), accountId: pendingAccount.id, expectedBalance: "100", countedAmount: "118", reason: "طلب عقد معلق اصطناعي", actuallyCounted: true };
    const pendingCancelled = await requestSettlement(db, "79", pendingRequestInput);
    const cancelPending = { requestId: randomUUID(), settlementId: pendingCancelled.id, reason: "إلغاء مراجعة اصطناعية" };
    assert.equal((await cancelSettlement(db, "79", cancelPending)).replayed, false);
    assert.equal((await cancelSettlement(db, "79", cancelPending)).replayed, true);
    assert.deepEqual(await db.serializable(tx => reviewTestPeriod(tx, pendingAccount.id)), pendingContractReview);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.settlement_allocation_receipts_test_only WHERE settlement_id=$1::bigint", [pendingCancelled.id])).rows[0].n, 0);
    const pendingRequest = await requestSettlement(db, "79", { ...pendingRequestInput, requestId: randomUUID() });
    const pendingValues: {sales:string;expenses:string;expected:string;deviation:string;adjustment:string} = (await admin.query<{sales:string;expenses:string;expected:string;deviation:string;adjustment:string}>("SELECT sales_total::text AS sales,expenses_total::text AS expenses,expected_amount::text AS expected,deviation::text AS deviation,adjustment::text AS adjustment FROM finance.settlements WHERE id=$1::bigint", [pendingRequest.id])).rows[0];
    assert.deepEqual(pendingValues,{sales:"30.00",expenses:"10.00",expected:"120.00",deviation:"-2.00",adjustment:"18.00"});
    const pendingHook = { accountId: pendingAccount.id, actorId: "1", collectionIds: [pendingCollection.id], paymentIds: [pendingPayment.id], reviewedHash: pendingContractReview.hash };
    const pendingDecision = { requestId: randomUUID(), settlementId: pendingRequest.id, expectedBalance: "100", transferAmount: "5", transferDirection: "TO_VAULT", reason: "تحويل جزئي عقد اصطناعي", actuallyTransferred: true };
    const beforeContractVault: string = await vaultBook();
    assert.equal((await confirmSettlement(testRealSettlementWithPeriod(db, pendingHook), "1", pendingDecision)).replayed, false);
    const pendingMoves = await admin.query<{kind:string;amount:string;source:string|null;destination:string|null}>("SELECT kind,amount::text AS amount,source_id::text AS source,destination_id::text AS destination FROM finance.movements WHERE settlement_id=$1::bigint ORDER BY id", [pendingRequest.id]);
    assert.deepEqual(pendingMoves.rows,[{kind:"SETTLEMENT",amount:"18.00",source:null,destination:pendingAccount.id},{kind:"TRANSFER",amount:"5.00",source:pendingAccount.id,destination:vaultId}]);
    const vaultDelta = await admin.query<{matches:boolean}>("SELECT $1::numeric=$2::numeric+5 AS matches", [await vaultBook(),beforeContractVault]);
    assert.equal(vaultDelta.rows[0].matches,true);
    const pendingAfter = await settlementOverview(db, "79", pendingAccount.id);
    assert.equal(pendingAfter.account?.balance,"113.00"); assert.equal(pendingAfter.sales,"0.00"); assert.equal(pendingAfter.expenses,"0.00"); assert.equal(pendingAfter.expected,"113.00");
    assert.equal((await confirmSettlement(testRealSettlementWithPeriod(db, pendingHook), "1", pendingDecision)).replayed, true);
    assert.equal((await recordCommerceCollection(testCollectionService(prisma, "79"), 79n, pendingCollectionInput)).replayed, true);
    assert.equal((await payExpense(testHolderPaymentService(db, "79"), "79", pendingPaymentInput, today)).replayed, true);
    const laterPending = await recordCommerceCollection(testCollectionService(prisma, "79"), 79n, { ...pendingCollectionInput, requestId: randomUUID(), amount: "7" });
    const laterContractReview = await db.serializable(tx => reviewTestPeriod(tx, pendingAccount.id));
    assert.deepEqual(laterContractReview.collections.map(x => [x.id,x.amount]), [[laterPending.id,"7.00"]]);
    assert.equal((await confirmSettlement(testRealSettlementWithPeriod(db, pendingHook), "1", pendingDecision)).replayed, true);
    assert.deepEqual(await db.serializable(tx => reviewTestPeriod(tx, pendingAccount.id)),laterContractReview);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE source_id=$1::bigint OR destination_id=$1::bigint", [pendingAccount.id])).rows[0].n, 2);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.settlement_allocation_receipts_test_only WHERE settlement_id=$1::bigint", [pendingRequest.id])).rows[0].n, 1);
    const pendingNext = await settlementOverview(db, "79", pendingAccount.id);
    assert.equal(pendingNext.account?.balance,"113.00"); assert.equal(pendingNext.sales,"7.00"); assert.equal(pendingNext.expected,"120.00");
    await checkCustodyCommand(admin,db,pendingAccount.id,pendingSale,today);
    await checkCustodyCommandRaces(admin,prisma,db,today);
    await checkDirectCustodyProxyMismatch(admin,prisma,db,today);
    await checkSyntheticSourceBarrier(admin,prisma,db,today);
    await checkWrongSyntheticMarkerCycle(admin,prisma,db,today);
    await checkSyntheticBranchBarrier(admin,prisma,db,today);
    await checkBranchRoutingOpening(admin,prisma,db,today);
    await checkBranchRoutingApproval(admin,prisma,db,today);
    await checkBranchApprovalPreauthorization(admin,prisma,db,today);
    await checkApprovalActorRace(admin,prisma,db,today);
    await checkApprovalDirectoryRace(admin,prisma,db,today);
    await checkApprovalHolderDirectoryRace(admin,prisma,db,today);
    await checkFinanceSessionDirectoryRace(admin,prisma,db,today);
    await checkSyntheticConfirmationBarrier(admin,prisma,db,today);
    await checkSyntheticCancellationBarrier(admin,prisma,db,today);

    // Standalone experimental direct-vault path, NOT real sale integration.
    // Missing attestation must abort the synthetic source and movement together.
    await admin.query("INSERT INTO branches (id,code,name_ar,city,phone,invoice_prefix,opening_date,is_active,created_at) VALUES (80,'SYN80','فرع خزنة تجريبي','تجربة','000','SYN80',CURRENT_DATE,true,now())");
    const isolatedVault = await openAccount(db, "1", { requestId: randomUUID(), branchId: "80", kind: "VAULT", holderId: null, openingAmount: "100", openingDate: today, counted: true }, today);
    const isolatedVaultBook = async (): Promise<string> => (await admin!.query<{balance:string}>(`SELECT
      (a.opening_amount+COALESCE((SELECT SUM(CASE WHEN destination_id=a.id THEN amount ELSE -amount END) FROM finance.movements WHERE source_id=a.id OR destination_id=a.id),0))::text AS balance
      FROM finance.accounts a WHERE a.id=$1::bigint`, [isolatedVault.id])).rows[0].balance;
    const vaultSale: string = (await admin.query<{id:string}>(`INSERT INTO commerce_sales(request_id,request_hash,branch_id,warehouse_id,customer_name,customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,created_by_id)
      SELECT $1::uuid,repeat('a',64),80,warehouse_id,'تحصيل خزنة اصطناعي',customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,1 FROM commerce_sales WHERE id=2 RETURNING id::text`, [randomUUID()])).rows[0].id;
    const vaultBeforeAttestation: string = await isolatedVaultBook();
    const vaultRevision: string = (await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.accounts WHERE id=$1::bigint", [isolatedVault.id])).rows[0].revision;
    const rejectedVaultRequest = randomUUID();
    await assert.rejects(() => prisma!.$transaction(async tx => {
      const collection = await tx.commerceCollection.create({ data: { requestId: rejectedVaultRequest, requestHash: "c".repeat(64), saleId: BigInt(vaultSale), amount: "19", method: "CASH", isInitial: false, createdById: 1n } });
      await allocateTestCollection(financePort(tx), "1", String(collection.id));
    }, { isolationLevel: "Serializable", timeout: 20000 }), /يلزم إقرار استلام الخزنة/);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_collections WHERE request_id=$1::uuid", [rejectedVaultRequest])).rows[0].n, 0);
    assert.equal(await isolatedVaultBook(), vaultBeforeAttestation);
    assert.equal((await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.accounts WHERE id=$1::bigint", [isolatedVault.id])).rows[0].revision, vaultRevision);
    const syntheticVault = await prisma.$transaction(async tx => {
      const collection = await tx.commerceCollection.create({ data: { requestId: randomUUID(), requestHash: "d".repeat(64), saleId: BigInt(vaultSale), amount: "19", method: "CASH", isInitial: false, createdById: 1n } });
      const id = String(collection.id);
      const initial = await allocateTestCollection(financePort(tx), "1", id, { vaultReceived: true });
      const replay = await allocateTestCollection(financePort(tx), "1", id);
      assert.equal(initial.replayed, false); assert.equal(replay.replayed, true);
      assert.equal(initial.accountId, isolatedVault.id); assert.equal(initial.treatment, "VAULT_MOVEMENT");
      return id;
    }, { isolationLevel: "Serializable", timeout: 20000 });
    assert.equal((await db.serializable(tx => allocateTestCollection(tx, "1", syntheticVault))).replayed, true);
    const vaultEvidence = await admin.query<{attested:boolean;count:string;amount:string;destination:string;afterCount:string|null;afterOpening:boolean}>(`SELECT a.vault_received_attested AS attested,
      (SELECT count(*)::text FROM finance.movements WHERE kind='COLLECTION' AND external_ref=$2) AS count,
      m.amount::text AS amount,m.destination_id::text AS destination,m.after_cash_count_id::text AS "afterCount",m.after_opening AS "afterOpening"
      FROM finance.collection_allocations_test_only a JOIN finance.movements m ON m.id=a.movement_id WHERE a.collection_id=$1::bigint`, [syntheticVault, `collection:${syntheticVault}`]);
    assert.deepEqual(vaultEvidence.rows[0], {attested:true,count:"1",amount:"19.00",destination:isolatedVault.id,afterCount:null,afterOpening:false}, "the lab model does not establish a checkpoint");
    assert.equal((await admin.query<{matches:boolean}>("SELECT $1::numeric=$2::numeric+19 AS matches", [await isolatedVaultBook(),vaultBeforeAttestation])).rows[0].matches,true);
    assert.equal((await admin.query<{matches:boolean}>("SELECT revision=$2::bigint+1 AS matches FROM finance.accounts WHERE id=$1::bigint", [isolatedVault.id,vaultRevision])).rows[0].matches,true);

    const isolatedCount = await requestCashCount(db, "1", { requestId: randomUUID(), accountId: isolatedVault.id, expectedBalance: "119", countedAmount: "119", reason: "جرد خزنة تجريبي", actuallyCounted: true }, today);
    const tryBlockedVault = async () => {
      const id = randomUUID();
      await assert.rejects(() => prisma!.$transaction(async tx => {
        const collection = await tx.commerceCollection.create({ data: { requestId: id, requestHash: "e".repeat(64), saleId: BigInt(vaultSale), amount: "8", method: "CASH", isInitial: false, createdById: 1n } });
        await allocateTestCollection(financePort(tx), "1", String(collection.id), { vaultReceived: true });
      }, { isolationLevel: "Serializable", timeout: 20000 }), /جرد مفتوح أو جرد مؤكد/);
      assert.equal((await admin!.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_collections WHERE request_id=$1::uuid", [id])).rows[0].n, 0);
      assert.equal(await isolatedVaultBook(), "119.00");
      assert.equal((await db.serializable(tx => allocateTestCollection(tx, "1", syntheticVault))).replayed, true);
    };
    await tryBlockedVault();
    await confirmCashCount(db, "1", { requestId: randomUUID(), countId: isolatedCount.id, reason: "تأكيد جرد تجريبي", stillCurrent: true });
    await tryBlockedVault();
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE destination_id=$1::bigint AND kind='COLLECTION'", [isolatedVault.id])).rows[0].n, 1);

    // Two selected lock orders for the test-only direct-vault allocator and
    // the real count request; these use separate disposable branch fixtures.
    for (const branch of ["81", "82"]) {
      await admin.query("INSERT INTO branches (id,code,name_ar,city,phone,invoice_prefix,opening_date,is_active,created_at) VALUES ($1::bigint,$2,'فرع سباق اصطناعي','تجربة','000',$2,CURRENT_DATE,true,now())", [branch,`SYN${branch}`]);
      const raceVault = await openAccount(db, "1", { requestId: randomUUID(), branchId: branch, kind: "VAULT", holderId: null, openingAmount: "100", openingDate: today, counted: true }, today);
      const raceSale: string = (await admin.query<{id:string}>(`INSERT INTO commerce_sales(request_id,request_hash,branch_id,warehouse_id,customer_name,customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,created_by_id)
        SELECT $1::uuid,repeat('a',64),$2::bigint,warehouse_id,'سباق خزنة اصطناعي',customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,1 FROM commerce_sales WHERE id=2 RETURNING id::text`, [randomUUID(),branch])).rows[0].id;
      const collectionRequest = randomUUID();
      const assign = async (tx: FinanceTransaction): Promise<string> => {
        const row = await tx.query<{id:string}>(`INSERT INTO commerce_collections(request_id,request_hash,sale_id,amount,method,is_initial,created_by_id)
          VALUES($1::uuid,repeat('f',64),$2::bigint,19,'CASH',false,1) RETURNING id::text`, [collectionRequest,raceSale]);
        await allocateTestCollection(tx,"1",row.rows[0].id,{vaultReceived:true});
        return row.rows[0].id;
      };
      const countInput = { requestId: randomUUID(), accountId: raceVault.id, expectedBalance: "100", countedAmount: "100", reason: "سباق جرد خزنة اصطناعي", actuallyCounted: true };
      const lock = gate();
      if (branch === "81") {
        const first = requestCashCount(gatedFinance(prisma, lock),"1",countInput,today);
        await lock.entered;
        let attempts = 0;
        const retryAssign = async (): Promise<string> => {
          for (;;) {
            try { attempts++; return await db.serializable(assign); }
            catch (error) { if (attempts < 3 && typeof error === "object" && error !== null && "code" in error && error.code === "40001") continue; throw error; }
          }
        };
        const delayed = retryAssign().then(value => ({value}),error => ({error}));
        try { await waitForLock(admin,"accounts"); } finally { lock.release(); }
        const counted = await first;
        const rejected = await delayed;
        assert.ok("error" in rejected); assert.match(String(rejected.error),/جرد مفتوح أو جرد مؤكد/);
        assert.ok(attempts >= 2, "the test harness retries the serialization abort");
        assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_collections WHERE request_id=$1::uuid", [collectionRequest])).rows[0].n,0);
        assert.equal((await admin.query<{status:string}>("SELECT status FROM finance.cash_counts WHERE id=$1::bigint", [counted.id])).rows[0].status,"OPEN");
        assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE destination_id=$1::bigint", [raceVault.id])).rows[0].n,0);
      } else {
        const first: Promise<string> = gatedFinance(prisma, lock).serializable(assign);
        await lock.entered;
        const delayed = requestCashCount(db,"1",countInput,today).then(value => ({value}),error => ({error}));
        try { await waitForLock(admin,"accounts"); } finally { lock.release(); }
        const allocated: string = await first;
        const rejected = await delayed;
        assert.ok("error" in rejected); assert.match(String(rejected.error),/تغير الرصيد المتوقع/);
        assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.requests WHERE request_id=$1::uuid", [countInput.requestId])).rows[0].n,0);
        assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.cash_counts WHERE account_id=$1::bigint", [raceVault.id])).rows[0].n,0);
        assert.equal((await db.serializable(tx => allocateTestCollection(tx,"1",allocated))).replayed,true);
        assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE destination_id=$1::bigint AND kind='COLLECTION'", [raceVault.id])).rows[0].n,1);
        const refreshed = await requestCashCount(db,"1",{ ...countInput, requestId: randomUUID(), expectedBalance:"119", countedAmount:"119" },today);
        assert.equal((await admin.query<{status:string}>("SELECT status FROM finance.cash_counts WHERE id=$1::bigint", [refreshed.id])).rows[0].status,"OPEN");
      }
    }

    // Composite laboratory command: receipt identity + source + vault movement
    // under one transaction, including duplicate attempts and count blocking.
    await admin.query("INSERT INTO branches (id,code,name_ar,city,phone,invoice_prefix,opening_date,is_active,created_at) VALUES (83,'SYN83','فرع أمر خزنة اصطناعي','تجربة','000','SYN83',CURRENT_DATE,true,now())");
    const commandVault = await openAccount(db,"1",{requestId:randomUUID(),branchId:"83",kind:"VAULT",holderId:null,openingAmount:"100",openingDate:today,counted:true},today);
    const commandSale: string = (await admin.query<{id:string}>(`INSERT INTO commerce_sales(request_id,request_hash,branch_id,warehouse_id,customer_name,customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,created_by_id)
      SELECT $1::uuid,repeat('a',64),83,warehouse_id,'فاتورة أمر اصطناعي',customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,1 FROM commerce_sales WHERE id=2 RETURNING id::text`, [randomUUID()])).rows[0].id;
    await admin.query("UPDATE commerce_sales SET total=30 WHERE id=$1::bigint", [commandSale]);
    const rawCommand = { requestId: randomUUID(),saleId:commandSale,amount:"19",method:"CASH",actuallyPaid:false,vaultReceived:true };
    const withoutReceipt = { requestId: randomUUID(),saleId:commandSale,amount:"19",method:"CASH",actuallyPaid:false };
    await assert.rejects(() => db.serializable(tx => recordVaultCollectionTestOnly(tx,1n,withoutReceipt)), /يلزم إقرار استلام الخزنة/);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_collections WHERE request_id=$1::uuid", [withoutReceipt.requestId])).rows[0].n,0);
    const commandSaved = await db.serializable(tx => recordVaultCollectionTestOnly(tx,1n,rawCommand));
    assert.equal(commandSaved.replayed,false);
    assert.deepEqual(await db.serializable(tx => recordVaultCollectionTestOnly(tx,1n,rawCommand)),{id:commandSaved.id,replayed:true});
    await assert.rejects(() => db.serializable(tx => recordVaultCollectionTestOnly(tx,1n,{...rawCommand,amount:"20"})),/طلب اصطناعي مسجل ببيانات مختلفة/);
    const concurrentRaw = {...rawCommand,requestId:randomUUID(),amount:"4"};
    const commandGate = gate();
    const commandFirst = gatedFinance(prisma,commandGate).serializable(tx => recordVaultCollectionTestOnly(tx,1n,concurrentRaw));
    await commandGate.entered;
    let commandAttempts = 0;
    const retryCommand = async () => {
      for (;;) {
        try { commandAttempts++; return await db.serializable(tx => recordVaultCollectionTestOnly(tx,1n,concurrentRaw)); }
        catch (error) { if (commandAttempts < 3 && typeof error === "object" && error !== null && "code" in error && error.code === "40001") continue; throw error; }
      }
    };
    const commandSecond = retryCommand();
    try { await waitForLock(admin,"commerce_sales"); } finally { commandGate.release(); }
    const commandWinner = await commandFirst, repeated = await commandSecond;
    assert.equal(commandWinner.replayed,false); assert.deepEqual(repeated,{id:commandWinner.id,replayed:true});
    assert.ok(commandAttempts >= 2,"test harness retries the serialized loser");
    const commandState = await admin.query<{sources:number;allocations:number;movements:number;attested:number}>(`SELECT
      (SELECT count(*)::int FROM commerce_collections WHERE request_id IN ($1::uuid,$2::uuid)) AS sources,
      (SELECT count(*)::int FROM finance.collection_allocations_test_only WHERE collection_id IN ($3::bigint,$4::bigint)) AS allocations,
      (SELECT count(*)::int FROM finance.movements WHERE destination_id=$5::bigint AND kind='COLLECTION') AS movements,
      (SELECT count(*)::int FROM finance.collection_allocations_test_only WHERE collection_id IN ($3::bigint,$4::bigint) AND vault_received_attested IS TRUE) AS attested`, [rawCommand.requestId,concurrentRaw.requestId,commandSaved.id,commandWinner.id,commandVault.id]);
    assert.deepEqual(commandState.rows[0],{sources:2,allocations:2,movements:2,attested:2});
    const legacyCommand = { requestId: randomUUID(),saleId:commandSale,amount:"3",method:"CASH",actuallyPaid:false };
    const legacyParsed = parseMoneyMovement(legacyCommand,false); assert.ok(legacyParsed.ok);
    const legacyHash = vaultReceiptIdentityTestOnly(1n,legacyParsed.value,legacyCommand).baseHash;
    const legacyRow = await admin.query<{id:string}>(`INSERT INTO commerce_collections(request_id,request_hash,sale_id,amount,method,is_initial,created_by_id)
      VALUES($1::uuid,$2,$3::bigint,3,'CASH',false,1) RETURNING id::text`, [legacyCommand.requestId,legacyHash,commandSale]);
    assert.deepEqual(await db.serializable(tx => recordVaultCollectionTestOnly(tx,1n,legacyCommand)),{id:legacyRow.rows[0].id,replayed:true});
    await assert.rejects(() => db.serializable(tx => recordVaultCollectionTestOnly(tx,1n,{...legacyCommand,vaultReceived:true})),/طلب اصطناعي مسجل ببيانات مختلفة/);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.collection_allocations_test_only WHERE collection_id=$1::bigint", [legacyRow.rows[0].id])).rows[0].n,0,"legacy replay cannot invent an allocation or receipt");
    // Thirty total, with 19 + 4 + legacy 3 already recorded, leaves four.
    // Exceeding it must roll back the tentative invoice revision as well.
    const beforeOverpay = (await admin.query<{revision:string}>("SELECT revision::text AS revision FROM commerce_sales WHERE id=$1::bigint", [commandSale])).rows[0].revision;
    const overpay = {...rawCommand,requestId:randomUUID(),amount:"5"};
    await assert.rejects(() => db.serializable(tx => recordVaultCollectionTestOnly(tx,1n,overpay)),/مبلغ التحصيل لا يمكن أن يزيد على المتبقي/);
    assert.equal((await admin.query<{revision:string}>("SELECT revision::text AS revision FROM commerce_sales WHERE id=$1::bigint", [commandSale])).rows[0].revision,beforeOverpay);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_collections WHERE request_id=$1::uuid", [overpay.requestId])).rows[0].n,0);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE destination_id=$1::bigint AND kind='COLLECTION'", [commandVault.id])).rows[0].n,2);
    // Distinct concurrent requests cannot each spend the same outstanding
    // amount. The lab retry is outside the command, not production behavior.
    const quotaSale: string = (await admin.query<{id:string}>(`INSERT INTO commerce_sales(request_id,request_hash,branch_id,warehouse_id,customer_name,customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,created_by_id)
      SELECT $1::uuid,repeat('a',64),83,warehouse_id,'فاتورة حد تجريبية',customer_phone,subtotal,discount,taxable_base,tax_total,10,revision,1 FROM commerce_sales WHERE id=2 RETURNING id::text`, [randomUUID()])).rows[0].id;
    const quotaOne = {...rawCommand,requestId:randomUUID(),saleId:quotaSale,amount:"7"};
    const quotaTwo = {...quotaOne,requestId:randomUUID()};
    const quotaGate = gate();
    const quotaFirst = gatedFinance(prisma,quotaGate).serializable(tx => recordVaultCollectionTestOnly(tx,1n,quotaOne));
    await quotaGate.entered;
    let quotaAttempts = 0;
    const retryQuota = async () => {
      for (;;) {
        try { quotaAttempts++; return await db.serializable(tx => recordVaultCollectionTestOnly(tx,1n,quotaTwo)); }
        catch (error) { if (quotaAttempts < 3 && typeof error === "object" && error !== null && "code" in error && error.code === "40001") continue; throw error; }
      }
    };
    const quotaSecond = retryQuota().then(value => ({value}),error => ({error}));
    try { await waitForLock(admin,"commerce_sales"); } finally { quotaGate.release(); }
    const quotaSaved = await quotaFirst, quotaRejected = await quotaSecond;
    assert.equal(quotaSaved.replayed,false);
    assert.ok("error" in quotaRejected); assert.match(String(quotaRejected.error),/مبلغ التحصيل لا يمكن أن يزيد على المتبقي/);
    assert.ok(quotaAttempts >= 2);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_collections WHERE request_id=$1::uuid", [quotaTwo.requestId])).rows[0].n,0);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE external_ref=$1", [`collection:${quotaSaved.id}`])).rows[0].n,1);
    assert.deepEqual(await db.serializable(tx => recordVaultCollectionTestOnly(tx,1n,quotaOne)),{id:quotaSaved.id,replayed:true});
    // Real catalog sales/returns and a noncash refund supply recorded source
    // events; only the subsequent cash-to-vault command remains experimental.
    const itemCategory = (await admin.query<{id:string}>("INSERT INTO sales_item_categories(code,name_ar) VALUES('SYNRET83','فئة اختبار المستحق') RETURNING id::text")).rows[0].id;
    const itemType = (await admin.query<{id:string}>("INSERT INTO sales_item_types(category_id,name_ar) VALUES($1::bigint,'نوع اختبار المستحق') RETURNING id::text", [itemCategory])).rows[0].id;
    const catalogInput = (paid: string) => ({ requestId: randomUUID(), branchId: "83", customerName: "عميل اصطناعي", customerPhone: "01000000000", discount: "0", initialPayment: paid, method: "CARD", lines: [{typeId:itemType,quantity:"10",unitPrice:"10",details:[]}] });
    const returnSale = await createCatalogSale(prisma,1n,catalogInput("40"));
    const returnLine = await prisma.commerceSaleLine.findFirstOrThrow({where:{saleId:BigInt(returnSale.id)},select:{id:true}});
    await returnCommerceSale(prisma,1n,{requestId:randomUUID(),saleId:returnSale.id,cancel:false,accepted:true,lines:[{saleLineId:String(returnLine.id),quantity:"3",serialIds:[]}]});
    // 100 - 30 returned - 40 collected = 30 due.
    const returnCommand = {...rawCommand,requestId:randomUUID(),saleId:returnSale.id,amount:"31"};
    await assert.rejects(() => db.serializable(tx => recordVaultCollectionTestOnly(tx,1n,returnCommand)),/مبلغ التحصيل لا يمكن أن يزيد على المتبقي/);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_collections WHERE request_id=$1::uuid",[returnCommand.requestId])).rows[0].n,0);
    const exactReturnCommand = {...returnCommand,requestId:randomUUID(),amount:"30"};
    const exactReturn = await db.serializable(tx => recordVaultCollectionTestOnly(tx,1n,exactReturnCommand));
    assert.equal(exactReturn.replayed,false);
    assert.deepEqual(await db.serializable(tx => recordVaultCollectionTestOnly(tx,1n,exactReturnCommand)),{id:exactReturn.id,replayed:true});
    const fullyPaidSale = await createCatalogSale(prisma,1n,catalogInput("80"));
    const fullyPaidLine = await prisma.commerceSaleLine.findFirstOrThrow({where:{saleId:BigInt(fullyPaidSale.id)},select:{id:true}});
    await returnCommerceSale(prisma,1n,{requestId:randomUUID(),saleId:fullyPaidSale.id,cancel:false,accepted:true,lines:[{saleLineId:String(fullyPaidLine.id),quantity:"3",serialIds:[]}]});
    // Remaining sale 70, net collected 80 - refund 10 = 70, so due is zero.
    await recordCommerceRefund(prisma,1n,{requestId:randomUUID(),saleId:fullyPaidSale.id,amount:"10",method:"CARD",actuallyPaid:true});
    const zeroDueCommand = {...rawCommand,requestId:randomUUID(),saleId:fullyPaidSale.id,amount:"0.01"};
    await assert.rejects(() => db.serializable(tx => recordVaultCollectionTestOnly(tx,1n,zeroDueCommand)),/مبلغ التحصيل لا يمكن أن يزيد على المتبقي/);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_collections WHERE request_id=$1::uuid",[zeroDueCommand.requestId])).rows[0].n,0);
    // Real return vs the *test-only* vault command on separate catalog
    // invoices. The invoices' initial card collections are real service writes.
    for (const order of ["return-first", "collection-first"] as const) {
      const invoice = await createCatalogSale(prisma,1n,catalogInput("40"));
      const line: {id: bigint} = await prisma.commerceSaleLine.findFirstOrThrow({where:{saleId:BigInt(invoice.id)},select:{id:true}});
      const returnInput: {requestId:string;saleId:string;cancel:boolean;accepted:boolean;lines:Array<{saleLineId:string;quantity:string;serialIds:string[]}>} = {requestId:randomUUID(),saleId:invoice.id,cancel:false,accepted:true,lines:[{saleLineId:String(line.id),quantity:"3",serialIds:[]}]};
      const collectionInput = {...rawCommand,requestId:randomUUID(),saleId:invoice.id,amount:"40"};
      const lock = gate();
      if (order === "return-first") {
        const first = returnCommerceSale(gatedSale(prisma,lock),1n,returnInput);
        await lock.entered;
        let attempts = 0;
        const retryExperimental = async () => {
          for (;;) {
            try { attempts++; return await db.serializable(tx => recordVaultCollectionTestOnly(tx,1n,collectionInput)); }
            catch (error) { if (attempts < 3 && typeof error === "object" && error !== null && "code" in error && error.code === "40001") continue; throw error; }
          }
        };
        const delayed = retryExperimental().then(value => ({value}),error => ({error}));
        try { await waitForLock(admin,"commerce_sales"); } finally { lock.release(); }
        const returned = await first, rejected = await delayed;
        assert.equal(returned.replayed,false);
        assert.ok("error" in rejected); assert.match(String(rejected.error),/مبلغ التحصيل لا يمكن أن يزيد على المتبقي/);
        assert.ok(attempts >= 2,"the laboratory harness retries serialization failure");
        assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_collections WHERE request_id=$1::uuid",[collectionInput.requestId])).rows[0].n,0);
        assert.deepEqual(await returnCommerceSale(prisma,1n,returnInput),{id:returned.id,replayed:true});
      } else {
        const first: Promise<{id:string;replayed:boolean}> = gatedFinance(prisma,lock).serializable(tx => recordVaultCollectionTestOnly(tx,1n,collectionInput));
        await lock.entered;
        const delayed = returnCommerceSale(prisma,1n,returnInput);
        try { await waitForLock(admin,"commerce_sales"); } finally { lock.release(); }
        const saved: {id:string;replayed:boolean} = await first;
        const returned: {id:string;replayed:boolean} = await delayed;
        assert.equal(saved.replayed,false); assert.equal(returned.replayed,false);
        assert.deepEqual(await db.serializable(tx => recordVaultCollectionTestOnly(tx,1n,collectionInput)),{id:saved.id,replayed:true});
        assert.deepEqual(await returnCommerceSale(prisma,1n,returnInput),{id:returned.id,replayed:true});
        assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE kind='COLLECTION' AND external_ref=$1", [`collection:${saved.id}`])).rows[0].n,1);
        const totals: {collected:string;returned:string;refunded:string} = (await admin.query<{collected:string;returned:string;refunded:string}>(`SELECT
          (SELECT COALESCE(sum(amount),0)::text FROM commerce_collections WHERE sale_id=$1::bigint) AS collected,
          (SELECT COALESCE(sum(rl.total),0)::text FROM commerce_return_lines rl JOIN commerce_returns r ON r.id=rl.return_id WHERE r.sale_id=$1::bigint) AS returned,
          (SELECT COALESCE(sum(amount),0)::text FROM commerce_refunds WHERE sale_id=$1::bigint) AS refunded`, [invoice.id])).rows[0];
        assert.deepEqual(totals,{collected:"80.00",returned:"30.00",refunded:"0"},"later return creates a recorded customer liability, not an automatic refund");
      }
    }
    // A real noncash refund and the laboratory collection compete for the
    // invoice lock. In these fixtures there is a recorded customer liability,
    // not money due from the customer, both before and after the refund.
    for (const order of ["refund-first", "collection-first"] as const) {
      const invoice = await createCatalogSale(prisma,1n,catalogInput("80"));
      const line: {id:bigint} = await prisma.commerceSaleLine.findFirstOrThrow({where:{saleId:BigInt(invoice.id)},select:{id:true}});
      await returnCommerceSale(prisma,1n,{requestId:randomUUID(),saleId:invoice.id,cancel:false,accepted:true,lines:[{saleLineId:String(line.id),quantity:"3",serialIds:[]}]});
      const refundInput = {requestId:randomUUID(),saleId:invoice.id,amount:"10",method:"CARD",actuallyPaid:true};
      const collectionInput = {...rawCommand,requestId:randomUUID(),saleId:invoice.id,amount:"0.01"};
      const lock = gate();
      let refund: {id:string;replayed:boolean};
      if (order === "refund-first") {
        const first = recordCommerceRefund(gatedSale(prisma,lock),1n,refundInput);
        await lock.entered;
        let attempts = 0;
        const retryExperimental = async () => {
          for (;;) {
            try { attempts++; return await db.serializable(tx => recordVaultCollectionTestOnly(tx,1n,collectionInput)); }
            catch (error) { if (attempts < 3 && typeof error === "object" && error !== null && "code" in error && error.code === "40001") continue; throw error; }
          }
        };
        const delayed = retryExperimental().then(value => ({value}),error => ({error}));
        try { await waitForLock(admin,"commerce_sales"); } finally { lock.release(); }
        refund = await first;
        const rejected = await delayed;
        assert.ok("error" in rejected); assert.match(String(rejected.error),/مبلغ التحصيل لا يمكن أن يزيد على المتبقي/);
        assert.ok(attempts >= 2, "laboratory retry is explicit");
      } else {
        const first = gatedFinance(prisma,lock,"FROM public.commerce_sales s JOIN public.branches").serializable(tx => recordVaultCollectionTestOnly(tx,1n,collectionInput)).then(value => ({value}),error => ({error}));
        await lock.entered;
        const delayed = recordCommerceRefund(prisma,1n,refundInput);
        try { await waitForLock(admin,"commerce_sales"); } finally { lock.release(); }
        const rejected = await first;
        assert.ok("error" in rejected); assert.match(String(rejected.error),/مبلغ التحصيل لا يمكن أن يزيد على المتبقي/);
        refund = await delayed;
      }
      assert.equal(refund.replayed,false);
      assert.deepEqual(await recordCommerceRefund(prisma,1n,refundInput),{id:refund.id,replayed:true});
      const state: {rows:Array<{collections:string;refunds:string;badRequest:number;cashMoves:number}>} = await admin.query<{collections:string;refunds:string;badRequest:number;cashMoves:number}>(`SELECT
        (SELECT COALESCE(sum(amount),0)::text FROM commerce_collections WHERE sale_id=$1::bigint) AS collections,
        (SELECT COALESCE(sum(amount),0)::text FROM commerce_refunds WHERE sale_id=$1::bigint) AS refunds,
        (SELECT count(*)::int FROM commerce_collections WHERE request_id=$2::uuid) AS "badRequest",
        (SELECT count(*)::int FROM finance.movements WHERE external_ref=$3) AS "cashMoves"`, [invoice.id,collectionInput.requestId,`refund:${refund.id}`]);
      assert.deepEqual(state.rows[0],{collections:"80.00",refunds:"10.00",badRequest:0,cashMoves:0},"recorded card refund does not create a cash movement");
    }
    // Repeat the selected invoice-lock orders with an actual CASH refund from
    // the same synthetic vault. The later collection remains laboratory-only.
    for (const order of ["cash-refund-first", "collection-before-cash-refund"] as const) {
      const invoice = await createCatalogSale(prisma,1n,catalogInput("80"));
      const line: {id:bigint} = await prisma.commerceSaleLine.findFirstOrThrow({where:{saleId:BigInt(invoice.id)},select:{id:true}});
      await returnCommerceSale(prisma,1n,{requestId:randomUUID(),saleId:invoice.id,cancel:false,accepted:true,lines:[{saleLineId:String(line.id),quantity:"3",serialIds:[]}]});
      const refundInput = {requestId:randomUUID(),saleId:invoice.id,amount:"10",method:"CASH",actuallyPaid:true,accountId:commandVault.id,negativeAcknowledged:false,checkpointRef:"OPENING",timing:"AFTER_REVIEWED_CHECKPOINT"};
      const collectionInput = {...rawCommand,requestId:randomUUID(),saleId:invoice.id,amount:"0.01"};
      const lock = gate();
      let refund: {id:string;replayed:boolean};
      if (order === "cash-refund-first") {
        const first = recordCommerceRefund(gatedSale(prisma,lock),1n,refundInput);
        await lock.entered;
        let attempts = 0;
        const retryExperimental = async () => {
          for (;;) {
            try { attempts++; return await db.serializable(tx => recordVaultCollectionTestOnly(tx,1n,collectionInput)); }
            catch (error) { if (attempts < 3 && typeof error === "object" && error !== null && "code" in error && error.code === "40001") continue; throw error; }
          }
        };
        const delayed = retryExperimental().then(value => ({value}),error => ({error}));
        try { await waitForLock(admin,"commerce_sales"); } finally { lock.release(); }
        refund = await first;
        const rejected = await delayed;
        assert.ok("error" in rejected); assert.match(String(rejected.error),/مبلغ التحصيل لا يمكن أن يزيد على المتبقي/);
        assert.ok(attempts >= 2,"test harness retries a serialization abort");
      } else {
        const first = gatedFinance(prisma,lock,"FROM public.commerce_sales s JOIN public.branches").serializable(tx => recordVaultCollectionTestOnly(tx,1n,collectionInput)).then(value => ({value}),error => ({error}));
        await lock.entered;
        const delayed = recordCommerceRefund(prisma,1n,refundInput);
        try { await waitForLock(admin,"commerce_sales"); } finally { lock.release(); }
        const rejected = await first;
        assert.ok("error" in rejected); assert.match(String(rejected.error),/مبلغ التحصيل لا يمكن أن يزيد على المتبقي/);
        refund = await delayed;
      }
      assert.equal(refund.replayed,false);
      assert.deepEqual(await recordCommerceRefund(prisma,1n,refundInput),{id:refund.id,replayed:true});
      const refundEvidence: {rows:Array<{source:string;amount:string;n:number}>} = await admin.query<{source:string;amount:string;n:number}>(`SELECT source_id::text AS source,sum(amount)::text AS amount,count(*)::int AS n FROM finance.movements WHERE kind='REFUND' AND external_ref=$1 GROUP BY source_id`, [`refund:${refund.id}`]);
      assert.deepEqual(refundEvidence.rows,[{source:commandVault.id,amount:"10.00",n:1}]);
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_collections WHERE request_id=$1::uuid",[collectionInput.requestId])).rows[0].n,0);
    }
    // Separate invoices share the same vault, so both operations may be
    // legitimate; account locking must serialize the selected interleavings.
    for (const order of ["vault-refund-first", "vault-collection-first"] as const) {
      const collectionSale = await createCatalogSale(prisma,1n,catalogInput("40"));
      const refundSale = await createCatalogSale(prisma,1n,catalogInput("80"));
      const refundLine: {id:bigint} = await prisma.commerceSaleLine.findFirstOrThrow({where:{saleId:BigInt(refundSale.id)},select:{id:true}});
      await returnCommerceSale(prisma,1n,{requestId:randomUUID(),saleId:refundSale.id,cancel:false,accepted:true,lines:[{saleLineId:String(refundLine.id),quantity:"3",serialIds:[]}]});
      const refundInput = {requestId:randomUUID(),saleId:refundSale.id,amount:"10",method:"CASH",actuallyPaid:true,accountId:commandVault.id,negativeAcknowledged:false,checkpointRef:"OPENING",timing:"AFTER_REVIEWED_CHECKPOINT"};
      const collectionInput = {...rawCommand,requestId:randomUUID(),saleId:collectionSale.id,amount:"10"};
      const lock = gate();
      let refund: {id:string;replayed:boolean};
      let collected: {id:string;replayed:boolean};
      if (order === "vault-refund-first") {
        const first = recordCommerceRefund(gatedRefundAccount(prisma,lock),1n,refundInput);
        await lock.entered;
        let attempts = 0;
        const retryExperimental = async () => {
          for (;;) {
            try { attempts++; return await db.serializable(tx => recordVaultCollectionTestOnly(tx,1n,collectionInput)); }
            catch (error) { if (attempts < 3 && typeof error === "object" && error !== null && "code" in error && error.code === "40001") continue; throw error; }
          }
        };
        const delayed = retryExperimental();
        try { await waitForLock(admin,"accounts"); } finally { lock.release(); }
        refund = await first; collected = await delayed;
        assert.ok(attempts >= 2,"test harness retries the laboratory transaction");
      } else {
        const first: Promise<{id:string;replayed:boolean}> = gatedFinance(prisma,lock).serializable(tx => recordVaultCollectionTestOnly(tx,1n,collectionInput));
        await lock.entered;
        const delayed = recordCommerceRefund(prisma,1n,refundInput);
        try { await waitForLock(admin,"accounts"); } finally { lock.release(); }
        collected = await first; refund = await delayed;
      }
      assert.equal(refund.replayed,false); assert.equal(collected.replayed,false);
      assert.deepEqual(await recordCommerceRefund(prisma,1n,refundInput),{id:refund.id,replayed:true});
      assert.deepEqual(await db.serializable(tx => recordVaultCollectionTestOnly(tx,1n,collectionInput)),{id:collected.id,replayed:true});
      const effects: {rows:Array<{kind:string;source:string|null;destination:string|null;amount:string;n:number}>} = await admin.query<{kind:string;source:string|null;destination:string|null;amount:string;n:number}>(`SELECT kind,source_id::text AS source,destination_id::text AS destination,sum(amount)::text AS amount,count(*)::int AS n
        FROM finance.movements WHERE (kind='REFUND' AND external_ref=$1) OR (kind='COLLECTION' AND external_ref=$2)
        GROUP BY kind,source_id,destination_id ORDER BY kind`, [`refund:${refund.id}`,`collection:${collected.id}`]);
      assert.deepEqual(effects.rows,[{kind:"COLLECTION",source:null,destination:commandVault.id,amount:"10.00",n:1},{kind:"REFUND",source:commandVault.id,destination:null,amount:"10.00",n:1}]);
    }
    // Chosen lock orders against a direct synthetic status writer. These do not
    // exercise the admin service, only the lab command's actor revalidation.
    await admin.query(`INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT n,83,role_code,'مدير اصطناعي '||n,'pg-vault-actor-'||n||'@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now()
      FROM users CROSS JOIN generate_series(84,85) n WHERE id=1`);
    for (const actor of ["84", "85"]) {
      const sale: string = (await admin.query<{id:string}>(`INSERT INTO commerce_sales(request_id,request_hash,branch_id,warehouse_id,customer_name,customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,created_by_id)
        SELECT $1::uuid,repeat('a',64),83,warehouse_id,'صلاحية خزنة اصطناعية',customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,$2::bigint FROM commerce_sales WHERE id=2 RETURNING id::text`, [randomUUID(),actor])).rows[0].id;
      const input = {...rawCommand,requestId:randomUUID(),saleId:sale,amount:"5"};
      const lock = gate();
      if (actor === "84") {
        await admin.query("BEGIN");
        await admin.query("UPDATE public.users SET status='SUSPENDED' WHERE id=$1::bigint", [actor]);
        let attempts = 0;
        const retryCommand = async () => {
          for (;;) {
            try { attempts++; return await db.serializable(tx => recordVaultCollectionTestOnly(tx,BigInt(actor),input)); }
            catch (error) { if (attempts < 3 && typeof error === "object" && error !== null && "code" in error && error.code === "40001") continue; throw error; }
          }
        };
        const delayed = retryCommand().then(value => ({value}),error => ({error}));
        try { await waitForLock(admin,"users"); } finally { await admin.query("COMMIT"); }
        const rejected = await delayed;
        assert.ok("error" in rejected); assert.match(String(rejected.error),/المسجّل غير مخوّل/);
        assert.ok(attempts >= 2,"test harness retries after the status writer");
        assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_collections WHERE request_id=$1::uuid",[input.requestId])).rows[0].n,0);
      } else {
        const first: Promise<{id:string;replayed:boolean}> = gatedFinance(prisma,lock,"FROM public.users WHERE id=$1::bigint FOR SHARE").serializable(tx => recordVaultCollectionTestOnly(tx,BigInt(actor),input));
        await lock.entered;
        const suspend: Promise<number> = Promise.resolve(prisma.$executeRawUnsafe("UPDATE public.users SET status='SUSPENDED' WHERE id=$1::bigint",actor));
        try { await waitForLock(admin,"users"); } finally { lock.release(); }
        const saved = await first;
        assert.equal(saved.replayed,false); assert.equal(await suspend,1);
        await assert.rejects(() => db.serializable(tx => recordVaultCollectionTestOnly(tx,BigInt(actor),input)),/المسجّل غير مخوّل/);
        assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE external_ref=$1",[`collection:${saved.id}`])).rows[0].n,1);
        await admin.query("UPDATE public.users SET status='ACTIVE' WHERE id=$1::bigint", [actor]);
        assert.deepEqual(await db.serializable(tx => recordVaultCollectionTestOnly(tx,BigInt(actor),input)),{id:saved.id,replayed:true});
      }
    }
    // The existing sales service has a separate creator-attribution guard that
    // the proposed laboratory command intentionally does not model. Neither
    // its experiment nor its success authorizes removing the real guard.
    const someoneElsesSale = await createCatalogSale(prisma,85n,catalogInput("40"));
    const proxyPayment = {...rawCommand,requestId:randomUUID(),saleId:someoneElsesSale.id,amount:"5"};
    const beforeCreatorGuard = (await admin.query<{revision:string}>("SELECT revision::text AS revision FROM commerce_sales WHERE id=$1::bigint",[someoneElsesSale.id])).rows[0].revision;
    await assert.rejects(() => recordCommerceCollection(prisma!,1n,proxyPayment),/التحصيل النقدي بالنيابة عن منشئ الفاتورة متوقف مؤقتًا/);
    assert.equal((await admin.query<{revision:string}>("SELECT revision::text AS revision FROM commerce_sales WHERE id=$1::bigint",[someoneElsesSale.id])).rows[0].revision,beforeCreatorGuard);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_collections WHERE request_id=$1::uuid",[proxyPayment.requestId])).rows[0].n,0);
    const labProxy = await db.serializable(tx => recordVaultCollectionTestOnly(tx,1n,proxyPayment));
    assert.equal(labProxy.replayed,false);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE external_ref=$1",[`collection:${labProxy.id}`])).rows[0].n,1);
    assert.deepEqual(await db.serializable(tx => recordVaultCollectionTestOnly(tx,1n,proxyPayment)),{id:labProxy.id,replayed:true});
    const commandCount = await requestCashCount(db,"1",{requestId:randomUUID(),accountId:commandVault.id,expectedBalance:"190",countedAmount:"190",reason:"جرد أمر اصطناعي",actuallyCounted:true},today);
    assert.deepEqual(await db.serializable(tx => recordVaultCollectionTestOnly(tx,1n,rawCommand)),{id:commandSaved.id,replayed:true},"command replay precedes count guard");
    assert.deepEqual(await db.serializable(tx => recordVaultCollectionTestOnly(tx,1n,legacyCommand)),{id:legacyRow.rows[0].id,replayed:true});
    const blockedCommand = {...rawCommand,requestId:randomUUID(),amount:"2"};
    await assert.rejects(() => db.serializable(tx => recordVaultCollectionTestOnly(tx,1n,blockedCommand)),/جرد مفتوح أو جرد مؤكد/);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_collections WHERE request_id=$1::uuid", [blockedCommand.requestId])).rows[0].n,0);
    await confirmCashCount(db,"1",{requestId:randomUUID(),countId:commandCount.id,reason:"تأكيد جرد اصطناعي",stillCurrent:true});
    await assert.rejects(() => db.serializable(tx => recordVaultCollectionTestOnly(tx,1n,blockedCommand)),/جرد مفتوح أو جرد مؤكد/);
    assert.deepEqual(await db.serializable(tx => recordVaultCollectionTestOnly(tx,1n,rawCommand)),{id:commandSaved.id,replayed:true});
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE destination_id=$1::bigint AND kind='COLLECTION'", [commandVault.id])).rows[0].n,9);

    // Characterize overlapping opening and the laboratory routing snapshot,
    // not an integration or a rule permitting real concurrent operations.
    await admin.query("INSERT INTO branches (id,code,name_ar,city,phone,invoice_prefix,opening_date,is_active,created_at) VALUES (86,'SYN86','فرع فتح عهدة اصطناعي','تجربة','000','SYN86',CURRENT_DATE,true,now())");
    await admin.query(`INSERT INTO users(id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT 86,86,role_code,'مدير فتح اصطناعي','pg-opening-race@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=1`);
    const openingVault = await openAccount(db,"1",{requestId:randomUUID(),branchId:"86",kind:"VAULT",holderId:null,openingAmount:"0",openingDate:today,counted:true},today);
    const openingSale: string = (await admin.query<{id:string}>(`INSERT INTO commerce_sales(request_id,request_hash,branch_id,warehouse_id,customer_name,customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,created_by_id)
      SELECT $1::uuid,repeat('a',64),86,warehouse_id,'فاتورة فتح اصطناعية',customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,86 FROM commerce_sales WHERE id=2 RETURNING id::text`,[randomUUID()])).rows[0].id;
    const openingInput = {...rawCommand,requestId:randomUUID(),saleId:openingSale,amount:"5"};
    const openingLock = gate();
    const openingCollecting: Promise<{id:string;replayed:boolean}> = gatedFinance(prisma,openingLock,"FROM public.users WHERE id=$1::bigint FOR SHARE").serializable(tx => recordVaultCollectionTestOnly(tx,86n,openingInput));
    await openingLock.entered;
    const custodyOpeningInput = {requestId:randomUUID(),branchId:"86",kind:"CUSTODY",holderId:"86",openingAmount:"0",openingDate:today,counted:true};
    let opened: {id:string;replayed:boolean};
    try {
      opened = await Promise.race([
        openAccount(db,"1",custodyOpeningInput,today),
        new Promise<never>((_,reject) => { const t = setTimeout(() => reject(new Error("synthetic opening unexpectedly waited for collector")),5000); t.unref(); }),
      ]);
    } finally { openingLock.release(); }
    const collected = await openingCollecting;
    assert.equal(opened.replayed,false); assert.equal(collected.replayed,false);
    const openingAssignment = await admin.query<{accountId:string;treatment:string}>(`SELECT account_id::text AS "accountId",treatment FROM finance.collection_allocations_test_only WHERE collection_id=$1::bigint`,[collected.id]);
    assert.deepEqual(openingAssignment.rows,[{accountId:openingVault.id,treatment:"VAULT_MOVEMENT"}],"overlapping transactions may serialize the collection before the newly committed custody");
    assert.deepEqual(await db.serializable(tx => recordVaultCollectionTestOnly(tx,86n,openingInput)),{id:collected.id,replayed:true});
    const newAfterOpening = {...openingInput,requestId:randomUUID()};
    await assert.rejects(() => db.serializable(tx => recordVaultCollectionTestOnly(tx,86n,newAfterOpening)),/الوجهة المختارة ليست خزنة/);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE external_ref=$1",[`collection:${collected.id}`])).rows[0].n,1);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_collections WHERE request_id=$1::uuid",[newAfterOpening.requestId])).rows[0].n,0);

    // Experimental coordination: opening and *new* collection UPDATE a
    // pre-provisioned per-branch/holder marker. A lock-only marker is not
    // enough to force retry of an older SERIALIZABLE snapshot. This wrapper
    // and its table exist only in this disposable test, not production.
    await admin.query(`CREATE TABLE finance.route_barriers_test_only (
      branch_id bigint NOT NULL REFERENCES public.branches(id), holder_id bigint NOT NULL REFERENCES public.users(id),
      revision bigint NOT NULL DEFAULT 0, PRIMARY KEY(branch_id,holder_id))`);
    const markRoute = async (tx: FinanceTransaction, branch: string, holder: string) => {
      const updated = await tx.query<{revision:string}>(`UPDATE finance.route_barriers_test_only SET revision=revision+1
        WHERE branch_id=$1::bigint AND holder_id=$2::bigint RETURNING revision::text AS revision`,[branch,holder]);
      assert.equal(updated.rows.length,1,"missing synthetic barrier must fail closed");
    };
    const withRouteBarrier = (base: FinanceDatabase,branch: string,holder: string): FinanceDatabase => ({
      serializable: work => base.serializable(async tx => { await markRoute(tx,branch,holder); return work(tx); }),
    });
    // Test-only interceptor at direct opening's reviewed account INSERT. It
    // must run inside the command's tx and receives no production wiring.
    const directOpeningAfterReview = (base:FinanceDatabase,branch:string,holder:string):FinanceDatabase => ({
      serializable:work => base.serializable(async tx => {
        const wrapped:FinanceTransaction = {...tx,query:async <T extends Record<string,unknown>>(sql:string,params?:unknown[]) => {
          if (sql.includes("INSERT INTO finance.accounts (branch_id,kind,holder_id")) {
            assert.equal(params?.[0],branch); assert.equal(params?.[1],"CUSTODY"); assert.equal(params?.[2],holder);
            await markRoute(tx,branch,holder);
          }
          return tx.query<T>(sql,params);
        }};
        return work(wrapped);
      }),
    });
    for (const [id,order] of [[87,"opening-first"],[88,"collection-first"]] as const) {
      const branch = String(id), holder = String(id);
      await admin.query(`INSERT INTO branches(id,code,name_ar,city,phone,invoice_prefix,opening_date,is_active,created_at)
        VALUES($1::bigint,$2,'فرع حاجز اصطناعي','تجربة','000',$2,CURRENT_DATE,true,now())`,[branch,`SYN${branch}`]);
      await admin.query(`INSERT INTO users(id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
        SELECT $1::bigint,$1::bigint,role_code,'مدير حاجز اصطناعي',$2,password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=1`,[holder,`pg-barrier-${holder}@selahtone.local`]);
      const barrierVault = await openAccount(db,"1",{requestId:randomUUID(),branchId:branch,kind:"VAULT",holderId:null,openingAmount:"0",openingDate:today,counted:true},today);
      await admin.query("INSERT INTO finance.route_barriers_test_only(branch_id,holder_id) VALUES($1::bigint,$2::bigint)",[branch,holder]);
      const saleId: string = (await admin.query<{id:string}>(`INSERT INTO commerce_sales(request_id,request_hash,branch_id,warehouse_id,customer_name,customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,created_by_id)
        SELECT $1::uuid,$2,$3::bigint,warehouse_id,'فاتورة حاجز اصطناعية',customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,$4::bigint FROM commerce_sales WHERE id=2 RETURNING id::text`,[randomUUID(),"a".repeat(64),branch,holder])).rows[0].id;
      const collectInput = {...rawCommand,requestId:randomUUID(),saleId,amount:"5"};
      const openRequest = {requestId:randomUUID(),branchId:branch,kind:"CUSTODY",holderId:holder,openingAmount:"0",openingDate:today,counted:true};
      const g = gate();
      const gated = directOpeningAfterReview(gatedFinance(prisma,g,"UPDATE finance.route_barriers_test_only"),branch,holder);
      const ordinary = directOpeningAfterReview(db,branch,holder);
      let openedId = "";
      const collectionBarrier = async (tx: FinanceTransaction, saleBranch: string, actorId: bigint) => {
        assert.equal(saleBranch,branch); assert.equal(String(actorId),holder);
        await markRoute(tx,saleBranch,String(actorId));
      };
      if (order === "opening-first") {
        const missingRequest = {...collectInput,requestId:randomUUID()};
        const saleRevision: string = (await admin.query<{revision:string}>("SELECT revision::text AS revision FROM commerce_sales WHERE id=$1::bigint",[saleId])).rows[0].revision;
        await admin.query("DELETE FROM finance.route_barriers_test_only WHERE branch_id=$1::bigint AND holder_id=$2::bigint",[branch,holder]);
        await assert.rejects(() => db.serializable(tx => recordVaultCollectionTestOnly(tx,BigInt(holder),missingRequest,collectionBarrier)),/missing synthetic barrier must fail closed/);
        assert.equal((await admin.query<{revision:string}>("SELECT revision::text AS revision FROM commerce_sales WHERE id=$1::bigint",[saleId])).rows[0].revision,saleRevision);
        assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_collections WHERE request_id=$1::uuid",[missingRequest.requestId])).rows[0].n,0);
        assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE destination_id=$1::bigint",[barrierVault.id])).rows[0].n,0);
        const missingOpening = {...openRequest,requestId:randomUUID()};
        await assert.rejects(() => openAccount(ordinary,"1",missingOpening,today),/missing synthetic barrier must fail closed/);
        assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.accounts WHERE kind='CUSTODY' AND branch_id=$1::bigint AND holder_id=$2::bigint",[branch,holder])).rows[0].n,0);
        assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.requests WHERE request_id=$1::uuid",[missingOpening.requestId])).rows[0].n,0);
        await admin.query("INSERT INTO finance.route_barriers_test_only(branch_id,holder_id) VALUES($1::bigint,$2::bigint)",[branch,holder]);
      }
      let attempts = 0;
      const retry = async <T>(work: () => Promise<T>): Promise<T> => {
        for (;;) { try { attempts++; return await work(); } catch (error) { if (attempts < 3 && isRetryableTransactionConflict(error)) continue; throw error; } }
      };
      if (order === "opening-first") {
        const first = openAccount(gated,"1",openRequest,today);
        await g.entered;
        const second = retry(() => db.serializable(tx => recordVaultCollectionTestOnly(tx,BigInt(holder),collectInput,collectionBarrier))).then(value => ({value}),error => ({error}));
        try { await waitForLock(admin,"route_barriers_test_only"); } finally { g.release(); }
        const openedAccount = await first, rejected = await second;
        assert.equal(openedAccount.replayed,false); openedId=openedAccount.id;
        assert.ok("error" in rejected); assert.match(String(rejected.error),/الوجهة المختارة ليست خزنة/);
        assert.ok(attempts >= 2);
        assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_collections WHERE request_id=$1::uuid",[collectInput.requestId])).rows[0].n,0);
        assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE destination_id=$1::bigint",[barrierVault.id])).rows[0].n,0);
      } else {
        const first: Promise<{id:string;replayed:boolean}> = gatedFinance(prisma,g,"UPDATE finance.route_barriers_test_only").serializable(tx => recordVaultCollectionTestOnly(tx,BigInt(holder),collectInput,collectionBarrier));
        await g.entered;
        let openingTransactions = 0;
        const countedOpening: FinanceDatabase = {serializable: work => { openingTransactions++; return ordinary.serializable(work); }};
        const second = retry(() => openAccount(countedOpening,"1",openRequest,today));
        try { await waitForLock(admin,"route_barriers_test_only"); } finally { g.release(); }
        const saved: {id:string;replayed:boolean} = await first;
        const openedAccount = await second;
        assert.equal(saved.replayed,false); assert.equal(openedAccount.replayed,false); openedId=openedAccount.id;
        assert.ok(openingTransactions >= 2,"the real finance command retries the aborted transaction");
        const beforeReplay: string = (await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.route_barriers_test_only WHERE branch_id=$1::bigint AND holder_id=$2::bigint",[branch,holder])).rows[0].revision;
        await admin.query("BEGIN");
        try {
          await admin.query("UPDATE finance.route_barriers_test_only SET revision=revision+1 WHERE branch_id=$1::bigint AND holder_id=$2::bigint",[branch,holder]);
          const replayWithHeldBarrier = await Promise.race([
            db.serializable(tx => recordVaultCollectionTestOnly(tx,BigInt(holder),collectInput,collectionBarrier)),
            new Promise<never>((_,reject) => { const timer = setTimeout(() => reject(new Error("replay waited for synthetic route barrier")),5000); timer.unref(); }),
          ]);
          assert.deepEqual(replayWithHeldBarrier,{id:saved.id,replayed:true},"replay does not need the routing barrier");
        } finally { await admin.query("ROLLBACK"); }
        assert.equal((await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.route_barriers_test_only WHERE branch_id=$1::bigint AND holder_id=$2::bigint",[branch,holder])).rows[0].revision,beforeReplay,"replay must not write the marker");
        assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE external_ref=$1",[`collection:${saved.id}`])).rows[0].n,1);
        const fresh = {...collectInput,requestId:randomUUID()};
        await assert.rejects(() => db.serializable(tx => recordVaultCollectionTestOnly(tx,BigInt(holder),fresh,collectionBarrier)),/الوجهة المختارة ليست خزنة/);
      }
      const openMarkerBefore: string = (await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.route_barriers_test_only WHERE branch_id=$1::bigint AND holder_id=$2::bigint",[branch,holder])).rows[0].revision;
      await admin.query("BEGIN");
      try {
        await admin.query("UPDATE finance.route_barriers_test_only SET revision=revision+1 WHERE branch_id=$1::bigint AND holder_id=$2::bigint",[branch,holder]);
        const replay = await Promise.race([
          openAccount(ordinary,"1",openRequest,today),
          new Promise<never>((_,reject) => { const timer=setTimeout(()=>reject(new Error("opening replay waited for synthetic marker")),5000); timer.unref(); }),
        ]);
        assert.deepEqual(replay,{id:openedId,replayed:true});
        await assert.rejects(() => openAccount(ordinary,"3",openRequest,today),/هذه العملية للمدير والمحاسب فقط/);
      } finally { await admin.query("ROLLBACK"); }
      assert.equal((await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.route_barriers_test_only WHERE branch_id=$1::bigint AND holder_id=$2::bigint",[branch,holder])).rows[0].revision,openMarkerBefore,"opening replay must not write the marker");
    }

    // Counterexample: the current unwrapped real opening service does not use
    // the test-only marker. A collector holding that marker cannot force such
    // a writer to wait or refresh the collector's SERIALIZABLE snapshot.
    await admin.query(`INSERT INTO branches(id,code,name_ar,city,phone,invoice_prefix,opening_date,is_active,created_at)
      VALUES(388,'SYN388','فرع كاتب غير منسق','تجربة','000','SYN388',CURRENT_DATE,true,now())`);
    await admin.query(`INSERT INTO users(id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT 388,388,role_code,'مدير كاتب غير منسق','pg-uncoordinated-388@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=1`);
    const uncoordinatedVault = await openAccount(db,"1",{requestId:randomUUID(),branchId:"388",kind:"VAULT",holderId:null,openingAmount:"0",openingDate:today,counted:true},today);
    await admin.query("INSERT INTO finance.route_barriers_test_only(branch_id,holder_id) VALUES(388,388)");
    const uncoordinatedSale: string = (await admin.query<{id:string}>(`INSERT INTO commerce_sales(request_id,request_hash,branch_id,warehouse_id,customer_name,customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,created_by_id)
      SELECT $1::uuid,$2,388,warehouse_id,'فاتورة كاتب غير منسق',customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,388 FROM commerce_sales WHERE id=2 RETURNING id::text`,[randomUUID(),"a".repeat(64)])).rows[0].id;
    const uncoordinatedInput = {...rawCommand,requestId:randomUUID(),saleId:uncoordinatedSale,amount:"5"};
    const uncoordinatedGate = gate();
    const uncoordinatedBarrier = (tx:FinanceTransaction,branch:string,actor:bigint) => markRoute(tx,branch,String(actor));
    const uncoordinatedCollection: Promise<{id:string;replayed:boolean}> = gatedFinance(prisma,uncoordinatedGate,"UPDATE finance.route_barriers_test_only").serializable(tx => recordVaultCollectionTestOnly(tx,388n,uncoordinatedInput,uncoordinatedBarrier));
    await uncoordinatedGate.entered;
    let uncoordinatedOpening: {id:string;replayed:boolean};
    try {
      uncoordinatedOpening = await Promise.race([
        openAccount(db,"1",{requestId:randomUUID(),branchId:"388",kind:"CUSTODY",holderId:"388",openingAmount:"0",openingDate:today,counted:true},today),
        new Promise<never>((_,reject) => { const timer = setTimeout(() => reject(new Error("unwrapped synthetic opening unexpectedly waited")),5000); timer.unref(); }),
      ]);
    } finally { uncoordinatedGate.release(); }
    const uncoordinatedSaved = await uncoordinatedCollection;
    assert.equal(uncoordinatedOpening.replayed,false); assert.equal(uncoordinatedSaved.replayed,false);
    const uncoordinatedAssignment = await admin.query<{accountId:string;treatment:string}>(`SELECT account_id::text AS "accountId",treatment FROM finance.collection_allocations_test_only WHERE collection_id=$1::bigint`,[uncoordinatedSaved.id]);
    assert.deepEqual(uncoordinatedAssignment.rows,[{accountId:uncoordinatedVault.id,treatment:"VAULT_MOVEMENT"}],"a marker on only one writer does not guarantee the user's stronger ordering");
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE external_ref=$1",[`collection:${uncoordinatedSaved.id}`])).rows[0].n,1);
    assert.deepEqual(await db.serializable(tx => recordVaultCollectionTestOnly(tx,388n,uncoordinatedInput,uncoordinatedBarrier)),{id:uncoordinatedSaved.id,replayed:true});
    await assert.rejects(() => db.serializable(tx => recordVaultCollectionTestOnly(tx,388n,{...uncoordinatedInput,requestId:randomUUID()},uncoordinatedBarrier)),/الوجهة المختارة ليست خزنة/);

    // Approval is a second real account-creation route, not just openAccount.
    // A staff request may remain pending across an authorized role edit.
    await admin.query(`INSERT INTO branches(id,code,name_ar,city,phone,invoice_prefix,opening_date,is_active,created_at)
      VALUES(389,'SYN389','فرع اعتماد غير منسق','تجربة','000','SYN389',CURRENT_DATE,true,now())`);
    await admin.query(`INSERT INTO users(id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT 389,389,role_code,'موظف طلب اصطناعي','pg-approval-gap-389@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3`);
    const approvalVault = await openAccount(db,"1",{requestId:randomUUID(),branchId:"389",kind:"VAULT",holderId:null,openingAmount:"0",openingDate:today,counted:true},today);
    const pendingApproval = await requestCustody(db,"389",{requestId:randomUUID(),amount:"10",reason:"طلب اصطناعي قبل تغيير الدور"});
    const priorRole = await prisma.user.findUniqueOrThrow({where:{id:389n},select:{fullName:true,email:true,phone:true,roleCode:true,branchId:true,status:true}});
    await updateDirectoryUser(prisma,{userId:389n,actorRole:"MANAGER",financeOn:true,expected:priorRole,data:{...priorRole,roleCode:"MANAGER"}});
    const reviewedApproval = custodyRequestSnapshot((await admin.query<{id:string;branchId:string;requesterId:string;amount:string;reason:string}>(`SELECT id::text AS id,branch_id::text AS "branchId",requester_id::text AS "requesterId",requested_amount::text AS amount,reason FROM finance.custody_requests WHERE id=$1::bigint`,[pendingApproval.id])).rows[0]);
    const approvalInput = {requestId:randomUUID(),requestId2:pendingApproval.id,decision:"APPROVE",reason:"اعتماد اصطناعي",openingDate:today,counted:true,expectedSnapshot:reviewedApproval};
    await admin.query("INSERT INTO finance.route_barriers_test_only(branch_id,holder_id) VALUES(389,389)");
    const approvalSale: string = (await admin.query<{id:string}>(`INSERT INTO commerce_sales(request_id,request_hash,branch_id,warehouse_id,customer_name,customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,created_by_id)
      SELECT $1::uuid,$2,389,warehouse_id,'فاتورة اعتماد اصطناعية',customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,389 FROM commerce_sales WHERE id=2 RETURNING id::text`,[randomUUID(),"a".repeat(64)])).rows[0].id;
    const approvalCollection = {...rawCommand,requestId:randomUUID(),saleId:approvalSale,amount:"5"};
    const approvalBarrier = (tx:FinanceTransaction,branch:string,actor:bigint) => markRoute(tx,branch,String(actor));
    const approvalRouteGate = gate();
    const pendingLab: Promise<{id:string;replayed:boolean}> = gatedFinance(prisma,approvalRouteGate,"UPDATE finance.route_barriers_test_only").serializable(tx => recordVaultCollectionTestOnly(tx,389n,approvalCollection,approvalBarrier));
    await approvalRouteGate.entered;
    let approval: {id:string;replayed:boolean};
    try {
      approval = await Promise.race([
        decideCustodyRequest(db,"1",approvalInput,today),
        new Promise<never>((_,reject) => { const timer = setTimeout(() => reject(new Error("unwrapped approval unexpectedly waited on synthetic marker")),5000); timer.unref(); }),
      ]);
    } finally { approvalRouteGate.release(); }
    const approvalLab = await pendingLab;
    assert.equal(approval.replayed,false); assert.equal(approvalLab.replayed,false);
    const approvalRecord = (await admin.query<{status:string;accountId:string}>(`SELECT status,account_id::text AS "accountId" FROM finance.custody_requests WHERE id=$1::bigint`,[pendingApproval.id])).rows[0];
    assert.deepEqual(approvalRecord,{status:"APPROVED",accountId:approval.id});
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE external_ref=$1 AND destination_id=$2::bigint",[`collection:${approvalLab.id}`,approvalVault.id])).rows[0].n,1);
    assert.deepEqual(await decideCustodyRequest(db,"1",approvalInput,today),{id:approval.id,replayed:true});
    assert.deepEqual(await db.serializable(tx => recordVaultCollectionTestOnly(tx,389n,approvalCollection,approvalBarrier)),{id:approvalLab.id,replayed:true});

    // Intercept the reviewed approval's actual insert inside the same tx.
    // Replay, rejection, authorization failures and stale snapshots don't reach
    // this hook. It is deliberately test-only and SQL-shape dependent.
    const approvalRouteAfterReview = (base:FinanceDatabase,branch:string,holder:string):FinanceDatabase => ({
      serializable: work => base.serializable(async tx => {
        const wrapped:FinanceTransaction = {...tx,query:async <T extends Record<string,unknown>>(sql:string,params?:unknown[]) => {
          if (sql.includes("INSERT INTO finance.accounts (branch_id,kind,holder_id")) {
            assert.equal(params?.[0],branch); assert.equal(params?.[1],holder);
            await markRoute(tx,branch,holder);
          }
          return tx.query<T>(sql,params);
        }};
        return work(wrapped);
      }),
    });
    // Approval via the same laboratory marker, in both selected orders. The
    // wrapper is test-only; the real approval service is unchanged.
    for (const [id,order] of [[390,"approval-first"],[391,"collection-first"]] as const) {
      const branch=String(id), holder=String(id);
      await admin.query(`INSERT INTO branches(id,code,name_ar,city,phone,invoice_prefix,opening_date,is_active,created_at)
        VALUES($1::bigint,$2,'فرع تنسيق اعتماد','تجربة','000',$2,CURRENT_DATE,true,now())`,[branch,`SYN${branch}`]);
      await admin.query(`INSERT INTO users(id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
        SELECT $1::bigint,$1::bigint,role_code,'موظف تنسيق اعتماد',$2,password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3`,[holder,`pg-guarded-approval-${holder}@selahtone.local`]);
      const vault = await openAccount(db,"1",{requestId:randomUUID(),branchId:branch,kind:"VAULT",holderId:null,openingAmount:"0",openingDate:today,counted:true},today);
      const request = await requestCustody(db,holder,{requestId:randomUUID(),amount:"10",reason:"طلب تنسيق اصطناعي"});
      const initial = await prisma.user.findUniqueOrThrow({where:{id:BigInt(holder)},select:{fullName:true,email:true,phone:true,roleCode:true,branchId:true,status:true}});
      await updateDirectoryUser(prisma,{userId:BigInt(holder),actorRole:"MANAGER",financeOn:true,expected:initial,data:{...initial,roleCode:"MANAGER"}});
      const snapshot = custodyRequestSnapshot((await admin.query<{id:string;branchId:string;requesterId:string;amount:string;reason:string}>(`SELECT id::text AS id,branch_id::text AS "branchId",requester_id::text AS "requesterId",requested_amount::text AS amount,reason FROM finance.custody_requests WHERE id=$1::bigint`,[request.id])).rows[0]);
      const approvalInput = {requestId:randomUUID(),requestId2:request.id,decision:"APPROVE",reason:"اعتماد تنسيق اصطناعي",openingDate:today,counted:true,expectedSnapshot:snapshot};
      await admin.query("INSERT INTO finance.route_barriers_test_only(branch_id,holder_id) VALUES($1::bigint,$2::bigint)",[branch,holder]);
      const saleId: string = (await admin.query<{id:string}>(`INSERT INTO commerce_sales(request_id,request_hash,branch_id,warehouse_id,customer_name,customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,created_by_id)
        SELECT $1::uuid,$2,$3::bigint,warehouse_id,'فاتورة تنسيق اعتماد',customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,$4::bigint FROM commerce_sales WHERE id=2 RETURNING id::text`,[randomUUID(),"a".repeat(64),branch,holder])).rows[0].id;
      const input = {...rawCommand,requestId:randomUUID(),saleId,amount:"5"};
      const route = (tx:FinanceTransaction,b:string,actor:bigint) => { assert.equal(b,branch); assert.equal(String(actor),holder); return markRoute(tx,b,String(actor)); };
      const g = gate(), ordinary = approvalRouteAfterReview(db,branch,holder);
      await assert.rejects(() => decideCustodyRequest(ordinary,"1",{...approvalInput,requestId:randomUUID(),expectedSnapshot:"0".repeat(64)},today),/تغيّر طلب العهدة/);
      assert.equal((await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.route_barriers_test_only WHERE branch_id=$1::bigint AND holder_id=$2::bigint",[branch,holder])).rows[0].revision,"0","stale review must not write the marker");
      let attempts=0;
      const retry = async <T>(work:()=>Promise<T>):Promise<T> => { for (;;) { try { attempts++; return await work(); } catch (error) { if (attempts < 3 && isRetryableTransactionConflict(error)) continue; throw error; } } };
      if (order === "approval-first") {
        const first = decideCustodyRequest(approvalRouteAfterReview(gatedFinance(prisma,g,"UPDATE finance.route_barriers_test_only"),branch,holder),"1",approvalInput,today);
        await g.entered;
        const second = retry(() => db.serializable(tx => recordVaultCollectionTestOnly(tx,BigInt(holder),input,route))).then(value=>({value}),error=>({error}));
        try { await waitForLock(admin,"route_barriers_test_only"); } finally { g.release(); }
        const approved = await first, rejected = await second;
        assert.equal(approved.replayed,false); assert.ok(attempts>=2);
        assert.ok("error" in rejected); assert.match(String(rejected.error),/الوجهة المختارة ليست خزنة/);
        assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_collections WHERE request_id=$1::uuid",[input.requestId])).rows[0].n,0);
        assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE destination_id=$1::bigint",[vault.id])).rows[0].n,0);
        assert.deepEqual(await decideCustodyRequest(ordinary,"1",approvalInput,today),{id:approved.id,replayed:true});
      } else {
        const first: Promise<{id:string;replayed:boolean}> = gatedFinance(prisma,g,"UPDATE finance.route_barriers_test_only").serializable(tx => recordVaultCollectionTestOnly(tx,BigInt(holder),input,route));
        await g.entered;
        let approvalTransactions=0;
        const countedApproval: FinanceDatabase = {serializable:work=>{ approvalTransactions++; return ordinary.serializable(work); }};
        const second = decideCustodyRequest(countedApproval,"1",approvalInput,today);
        try { await waitForLock(admin,"route_barriers_test_only"); } finally { g.release(); }
        const saved: {id:string;replayed:boolean} = await first;
        const approved = await second;
        assert.equal(saved.replayed,false); assert.equal(approved.replayed,false);
        assert.ok(approvalTransactions>=2,"finance command retries approval's aborted transaction");
        assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE external_ref=$1 AND destination_id=$2::bigint",[`collection:${saved.id}`,vault.id])).rows[0].n,1);
        assert.deepEqual(await db.serializable(tx => recordVaultCollectionTestOnly(tx,BigInt(holder),input,route)),{id:saved.id,replayed:true});
        await assert.rejects(() => db.serializable(tx => recordVaultCollectionTestOnly(tx,BigInt(holder),{...input,requestId:randomUUID()},route)),/الوجهة المختارة ليست خزنة/);
        assert.deepEqual(await decideCustodyRequest(ordinary,"1",approvalInput,today),{id:approved.id,replayed:true});
      }
      assert.equal((await admin.query<{status:string}>("SELECT status FROM finance.custody_requests WHERE id=$1::bigint",[request.id])).rows[0].status,"APPROVED");
      const beforeApprovalReplay: string = (await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.route_barriers_test_only WHERE branch_id=$1::bigint AND holder_id=$2::bigint",[branch,holder])).rows[0].revision;
      await admin.query("BEGIN");
      try {
        await admin.query("UPDATE finance.route_barriers_test_only SET revision=revision+1 WHERE branch_id=$1::bigint AND holder_id=$2::bigint",[branch,holder]);
        const replay = await Promise.race([
          decideCustodyRequest(ordinary,"1",approvalInput,today),
          new Promise<never>((_,reject) => { const timer=setTimeout(()=>reject(new Error("approval replay waited for synthetic marker")),5000); timer.unref(); }),
        ]);
        assert.equal(replay.replayed,true,"authorized approval replay must not wait for the marker");
        await assert.rejects(() => decideCustodyRequest(ordinary,"3",approvalInput,today),/هذه العملية للمدير والمحاسب فقط/);
      } finally { await admin.query("ROLLBACK"); }
      assert.equal((await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.route_barriers_test_only WHERE branch_id=$1::bigint AND holder_id=$2::bigint",[branch,holder])).rows[0].revision,beforeApprovalReplay);
    }

    // Demonstrate a lock-order cycle, not a proposed integration: collector
    // locks actor then marker; the test-wrapped directory writer takes marker
    // then tries to update actor. PostgreSQL must abort one whole transaction.
    await admin.query(`INSERT INTO branches(id,code,name_ar,city,phone,invoice_prefix,opening_date,is_active,created_at)
      VALUES(392,'SYN392','فرع تعارض أقفال اصطناعي','تجربة','000','SYN392',CURRENT_DATE,true,now())`);
    await admin.query(`INSERT INTO users(id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT 392,392,role_code,'مدير تعارض اصطناعي','pg-marker-deadlock-392@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=1`);
    const cycleVault = await openAccount(db,"1",{requestId:randomUUID(),branchId:"392",kind:"VAULT",holderId:null,openingAmount:"0",openingDate:today,counted:true},today);
    await admin.query("INSERT INTO finance.route_barriers_test_only(branch_id,holder_id) VALUES(392,392)");
    const cycleSale: string = (await admin.query<{id:string}>(`INSERT INTO commerce_sales(request_id,request_hash,branch_id,warehouse_id,customer_name,customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,created_by_id)
      SELECT $1::uuid,$2,392,warehouse_id,'فاتورة تعارض اصطناعية',customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,392 FROM commerce_sales WHERE id=2 RETURNING id::text`,[randomUUID(),"a".repeat(64)])).rows[0].id;
    const cycleInput = {...rawCommand,requestId:randomUUID(),saleId:cycleSale,amount:"5"};
    const cycleUser = await prisma.user.findUniqueOrThrow({where:{id:392n},select:{fullName:true,email:true,phone:true,roleCode:true,branchId:true,status:true}});
    const userGate = gate(), markerGate = gate();
    let directoryTransactions = 0;
    let markerSignalled = false;
    const guardedDirectory = new Proxy(prisma,{get(target,key,receiver) {
      if (key !== "$transaction") return Reflect.get(target,key,receiver);
      return (work:(tx:unknown)=>Promise<unknown>,options:unknown) => {
        directoryTransactions++;
        return target.$transaction(async tx => {
          await markRoute(financePort(tx),"392","392");
          if (!markerSignalled) { markerSignalled=true; markerGate.signal(); }
          return work(tx);
        },options as never);
      };
    }}) as PrismaClient;
    let cycleAttempts=0;
    const cycleBarrier = (tx:FinanceTransaction,branch:string,actor:bigint) => markRoute(tx,branch,String(actor));
    const collectorWithRetry = async () => {
      for (;;) {
        try { cycleAttempts++; return await (cycleAttempts===1 ? gatedFinance(prisma!,userGate,"FROM public.users WHERE id=$1::bigint FOR SHARE") : db).serializable(tx => recordVaultCollectionTestOnly(tx,392n,cycleInput,cycleBarrier)); }
        catch(error) { if (cycleAttempts<4 && isRetryableTransactionConflict(error)) continue; throw error; }
      }
    };
    const cycleCollect = collectorWithRetry().then(value=>({value}),error=>({error}));
    await userGate.entered;
    const cycleSuspend = updateDirectoryUser(guardedDirectory,{userId:392n,actorRole:"MANAGER",financeOn:true,expected:cycleUser,data:{...cycleUser,status:"SUSPENDED"}});
    try { await markerGate.entered; await waitForLock(admin,"users"); } finally { userGate.release(); }
    const cycleResult = await cycleCollect;
    await cycleSuspend;
    assert.ok(cycleAttempts>=2 || directoryTransactions>=2,"the inverted locks require a transaction retry");
    assert.equal((await admin.query<{status:string}>("SELECT status::text AS status FROM users WHERE id=392")).rows[0].status,"SUSPENDED");
    const cycleRows = await admin.query<{id:string}>("SELECT id::text AS id FROM commerce_collections WHERE request_id=$1::uuid",[cycleInput.requestId]);
    if ("value" in cycleResult) {
      assert.equal(cycleResult.value.replayed,false); assert.deepEqual(cycleRows.rows,[{id:cycleResult.value.id}]);
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE external_ref=$1 AND destination_id=$2::bigint",[`collection:${cycleResult.value.id}`,cycleVault.id])).rows[0].n,1);
    } else {
      assert.match(String(cycleResult.error),/المسجّل غير مخوّل/); assert.equal(cycleRows.rows.length,0);
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE destination_id=$1::bigint",[cycleVault.id])).rows[0].n,0);
    }
    await assert.rejects(() => db.serializable(tx => recordVaultCollectionTestOnly(tx,392n,cycleInput,cycleBarrier)),/المسجّل غير مخوّل/);

    // Compare a consistent actor-before-marker order in two selected races.
    // The injected directory wrapper remains a disposable experiment, not an
    // implementation shared by production writers.
    for (const [id,order] of [[393,"directory-first"],[394,"collection-first"]] as const) {
      const branch=String(id),holder=String(id);
      await admin.query(`INSERT INTO branches(id,code,name_ar,city,phone,invoice_prefix,opening_date,is_active,created_at)
        VALUES($1::bigint,$2,'فرع ترتيب أقفال اصطناعي','تجربة','000',$2,CURRENT_DATE,true,now())`,[branch,`SYN${branch}`]);
      await admin.query(`INSERT INTO users(id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
        SELECT $1::bigint,$1::bigint,role_code,'مدير ترتيب اصطناعي',$2,password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=1`,[holder,`pg-consistent-${holder}@selahtone.local`]);
      const vault = await openAccount(db,"1",{requestId:randomUUID(),branchId:branch,kind:"VAULT",holderId:null,openingAmount:"0",openingDate:today,counted:true},today);
      await admin.query("INSERT INTO finance.route_barriers_test_only(branch_id,holder_id) VALUES($1::bigint,$2::bigint)",[branch,holder]);
      const saleId: string = (await admin.query<{id:string}>(`INSERT INTO commerce_sales(request_id,request_hash,branch_id,warehouse_id,customer_name,customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,created_by_id)
        SELECT $1::uuid,$2,$3::bigint,warehouse_id,'فاتورة ترتيب اصطناعية',customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,$4::bigint FROM commerce_sales WHERE id=2 RETURNING id::text`,[randomUUID(),"a".repeat(64),branch,holder])).rows[0].id;
      const input = {...rawCommand,requestId:randomUUID(),saleId,amount:"5"};
      const actor = await prisma.user.findUniqueOrThrow({where:{id:BigInt(holder)},select:{fullName:true,email:true,phone:true,roleCode:true,branchId:true,status:true}});
      const g=gate(); let directoryTransactions=0,paused=false;
      const directoryAfterUser = new Proxy(prisma,{get(target,key,receiver) {
        if (key !== "$transaction") return Reflect.get(target,key,receiver);
        return (work:(tx:unknown)=>Promise<unknown>,options:unknown) => {
          directoryTransactions++;
          return target.$transaction(async tx => {
            const wrapped = new Proxy(tx,{get(obj,prop,recv) {
              if (prop !== "$queryRawUnsafe") return Reflect.get(obj,prop,recv);
              return async (sql:string,...params:unknown[]) => {
                const result = await tx.$queryRawUnsafe(sql,...params);
                if (sql.includes("FROM public.users WHERE id=$1::bigint FOR UPDATE")) {
                  await markRoute(financePort(tx),branch,holder);
                  if (order==="directory-first" && !paused) { paused=true; g.signal(); await g.wait; }
                }
                return result;
              };
            }});
            return work(wrapped);
          },options as never);
        };
      }}) as PrismaClient;
      const route = (tx:FinanceTransaction,b:string,a:bigint) => { assert.equal(b,branch); assert.equal(String(a),holder); return markRoute(tx,b,String(a)); };
      const suspend = () => updateDirectoryUser(directoryAfterUser,{userId:BigInt(holder),actorRole:"MANAGER",financeOn:true,expected:actor,data:{...actor,status:"SUSPENDED"}});
      let collectionAttempts=0;
      const collect = async (base:FinanceDatabase) => {
        for (;;) {
          try { collectionAttempts++; return await (collectionAttempts===1 ? base : db).serializable(tx => recordVaultCollectionTestOnly(tx,BigInt(holder),input,route)); }
          catch(error) { if (collectionAttempts<4 && isRetryableTransactionConflict(error)) continue; throw error; }
        }
      };
      if (order==="directory-first") {
        const first = suspend(); await g.entered;
        const second = collect(db).then(value=>({value}),error=>({error}));
        try { await waitForLock(admin,"users"); } finally { g.release(); }
        await first; const rejected=await second;
        assert.ok("error" in rejected); assert.match(String(rejected.error),/المسجّل غير مخوّل/);
        assert.ok(collectionAttempts>=2);
        assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_collections WHERE request_id=$1::uuid",[input.requestId])).rows[0].n,0);
        assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE destination_id=$1::bigint",[vault.id])).rows[0].n,0);
      } else {
        const first = collect(gatedFinance(prisma,g,"FROM public.users WHERE id=$1::bigint FOR SHARE")); await g.entered;
        const second = suspend();
        try { await waitForLock(admin,"users"); } finally { g.release(); }
        const saved = await first; await second;
        assert.equal(saved.replayed,false); assert.ok(directoryTransactions>=2);
        assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE external_ref=$1 AND destination_id=$2::bigint",[`collection:${saved.id}`,vault.id])).rows[0].n,1);
        await assert.rejects(() => db.serializable(tx => recordVaultCollectionTestOnly(tx,BigInt(holder),input,route)),/المسجّل غير مخوّل/);
      }
      assert.equal((await admin.query<{status:string}>("SELECT status::text AS status FROM users WHERE id=$1::bigint",[holder])).rows[0].status,"SUSPENDED");
    }

    // Test-only closure interceptor: discover branch/holder without a row
    // lock, update the routing marker, then let the real command lock the row
    // and recheck the discovered identity while that lock is held.
    const closeRouteBeforeAccount = (base:FinanceDatabase,expectedBranch:string,expectedHolder:string):FinanceDatabase => ({
      serializable:work=>base.serializable(async tx=>{
        const wrapped:FinanceTransaction={...tx,query:async <T extends Record<string,unknown>>(sql:string,params?:unknown[])=>{
          if (!sql.includes(`kind, closed_at::text AS "closedAt" FROM finance.accounts WHERE id=$1::bigint FOR UPDATE`)) return tx.query<T>(sql,params);
          const id = String(params?.[0]);
          const before = await tx.query<{branch:string;holder:string|null;kind:string}>(`SELECT branch_id::text AS branch,holder_id::text AS holder,kind FROM finance.accounts WHERE id=$1::bigint`,[id]);
          assert.deepEqual(before.rows,[{branch:expectedBranch,holder:expectedHolder,kind:"CUSTODY"}],"fixture must identify one custody");
          await markRoute(tx,before.rows[0].branch,before.rows[0].holder!);
          const result = await tx.query<T>(sql,params);
          const after = await tx.query<{branch:string;holder:string|null;kind:string}>(`SELECT branch_id::text AS branch,holder_id::text AS holder,kind FROM finance.accounts WHERE id=$1::bigint`,[id]);
          assert.deepEqual(after.rows,before.rows,"account identity must still match under the account lock");
          return result;
        }};
        return work(wrapped);
      }),
    });
    // Selected closure races: the same synthetic barrier is injected into
    // the real close command and the laboratory vault collection. No claim is
    // made about writers that do not participate in this experiment.
    for (const [id,order] of [[386,"close-first"],[387,"collection-first"]] as const) {
      const branch = String(id), holder = String(id);
      await admin.query(`INSERT INTO branches(id,code,name_ar,city,phone,invoice_prefix,opening_date,is_active,created_at)
        VALUES($1::bigint,$2,'فرع إقفال اصطناعي','تجربة','000',$2,CURRENT_DATE,true,now())`,[branch,`SYN${branch}`]);
      await admin.query(`INSERT INTO users(id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
        SELECT $1::bigint,$1::bigint,role_code,'مدير إقفال اصطناعي',$2,password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=1`,[holder,`pg-close-barrier-${holder}@selahtone.local`]);
      const vault = await openAccount(db,"1",{requestId:randomUUID(),branchId:branch,kind:"VAULT",holderId:null,openingAmount:"0",openingDate:today,counted:true},today);
      const custody = await openAccount(db,"1",{requestId:randomUUID(),branchId:branch,kind:"CUSTODY",holderId:holder,openingAmount:"0",openingDate:today,counted:true},today);
      await admin.query("INSERT INTO finance.route_barriers_test_only(branch_id,holder_id) VALUES($1::bigint,$2::bigint)",[branch,holder]);
      const saleId: string = (await admin.query<{id:string}>(`INSERT INTO commerce_sales(request_id,request_hash,branch_id,warehouse_id,customer_name,customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,created_by_id)
        SELECT $1::uuid,$2,$3::bigint,warehouse_id,'فاتورة إقفال اصطناعية',customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,$4::bigint FROM commerce_sales WHERE id=2 RETURNING id::text`,[randomUUID(),"a".repeat(64),branch,holder])).rows[0].id;
      const collectInput = {...rawCommand,requestId:randomUUID(),saleId,amount:"5"};
      const closeInput = {requestId:randomUUID(),accountId:custody.id,reason:"إقفال اصطناعي"};
      const barrier = (tx:FinanceTransaction,b:string,a:bigint) => { assert.equal(b,branch); assert.equal(String(a),holder); return markRoute(tx,b,String(a)); };
      const g = gate();
      const guardedClose = closeRouteBeforeAccount(db,branch,holder);
      const gatedClose = closeRouteBeforeAccount(gatedFinance(prisma,g,"UPDATE finance.route_barriers_test_only"),branch,holder);
      if (order === "close-first") {
        const count = await requestCashCount(db,"1",{requestId:randomUUID(),accountId:custody.id,expectedBalance:"0",countedAmount:"0",reason:"جرد قبل إقفال اصطناعي",actuallyCounted:true},today);
        const blocked = {...closeInput,requestId:randomUUID()};
        await assert.rejects(() => closeAccount(guardedClose,"1",blocked),/طلب تسوية أو جرد مفتوح/);
        assert.equal((await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.route_barriers_test_only WHERE branch_id=$1::bigint AND holder_id=$2::bigint",[branch,holder])).rows[0].revision,"0","failure must roll back the marker");
        assert.equal((await admin.query<{closed:boolean}>("SELECT closed_at IS NOT NULL AS closed FROM finance.accounts WHERE id=$1::bigint",[custody.id])).rows[0].closed,false);
        assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.requests WHERE request_id=$1::uuid",[blocked.requestId])).rows[0].n,0);
        await cancelCashCount(db,"1",{requestId:randomUUID(),countId:count.id,reason:"إلغاء جرد اصطناعي"});
      }
      let attempts = 0;
      const retry = async <T>(work: () => Promise<T>): Promise<T> => {
        for (;;) { try { attempts++; return await work(); } catch (error) { if (attempts < 3 && isRetryableTransactionConflict(error)) continue; throw error; } }
      };
      if (order === "close-first") {
        const first = closeAccount(gatedClose,"1",closeInput);
        await g.entered;
        const second = retry(() => db.serializable(tx => recordVaultCollectionTestOnly(tx,BigInt(holder),collectInput,barrier)));
        try { await waitForLock(admin,"route_barriers_test_only"); } finally { g.release(); }
        const closed = await first, saved = await second;
        assert.equal(closed.replayed,false); assert.equal(saved.replayed,false); assert.ok(attempts >= 2);
        assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE external_ref=$1 AND destination_id=$2::bigint",[`collection:${saved.id}`,vault.id])).rows[0].n,1);
        assert.deepEqual(await db.serializable(tx => recordVaultCollectionTestOnly(tx,BigInt(holder),collectInput,barrier)),{id:saved.id,replayed:true});
      } else {
        const first = gatedFinance(prisma,g,"UPDATE finance.route_barriers_test_only").serializable(tx => recordVaultCollectionTestOnly(tx,BigInt(holder),collectInput,barrier)).then(value=>({value}),error=>({error}));
        await g.entered;
        const second = closeAccount(guardedClose,"1",closeInput);
        try { await waitForLock(admin,"route_barriers_test_only"); } finally { g.release(); }
        const rejected = await first, closed = await second;
        assert.ok("error" in rejected); assert.match(String(rejected.error),/الوجهة المختارة ليست خزنة/);
        assert.equal(closed.replayed,false);
        assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM commerce_collections WHERE request_id=$1::uuid",[collectInput.requestId])).rows[0].n,0);
        assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE destination_id=$1::bigint",[vault.id])).rows[0].n,0);
      }
      assert.equal((await admin.query<{closed:boolean}>("SELECT closed_at IS NOT NULL AS closed FROM finance.accounts WHERE id=$1::bigint",[custody.id])).rows[0].closed,true);
      const beforeCloseReplay: string = (await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.route_barriers_test_only WHERE branch_id=$1::bigint AND holder_id=$2::bigint",[branch,holder])).rows[0].revision;
      await admin.query("BEGIN");
      try {
        await admin.query("UPDATE finance.route_barriers_test_only SET revision=revision+1 WHERE branch_id=$1::bigint AND holder_id=$2::bigint",[branch,holder]);
        const replay = await Promise.race([
          closeAccount(guardedClose,"1",closeInput),
          new Promise<never>((_,reject)=>{const timer=setTimeout(()=>reject(new Error("closure replay waited for synthetic marker")),5000);timer.unref();}),
        ]);
        assert.deepEqual(replay,{id:custody.id,replayed:true});
        await assert.rejects(() => closeAccount(guardedClose,"3",closeInput),/هذه العملية للمدير والمحاسب فقط/);
      } finally { await admin.query("ROLLBACK"); }
      assert.equal((await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.route_barriers_test_only WHERE branch_id=$1::bigint AND holder_id=$2::bigint",[branch,holder])).rows[0].revision,beforeCloseReplay);
    }

    // An intentionally non-cooperating SQL writer changes the holder between
    // the preliminary lookup and account lock. Reviewed fixture identity is
    // pinned by the interceptor; the real closure API does not expose this
    // synthetic pin, so the example is not a production guard.
    await admin.query(`INSERT INTO branches(id,code,name_ar,city,phone,invoice_prefix,opening_date,is_active,created_at)
      VALUES(396,'SYN396','فرع هوية اصطناعي','تجربة','000','SYN396',CURRENT_DATE,true,now())`);
    await admin.query(`INSERT INTO users(id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT n,396,role_code,'حامل هوية اصطناعي '||n,'pg-custody-identity-'||n||'@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users CROSS JOIN generate_series(396,397) n WHERE id=1`);
    const identityCustody = await openAccount(db,"1",{requestId:randomUUID(),branchId:"396",kind:"CUSTODY",holderId:"396",openingAmount:"0",openingDate:today,counted:true},today);
    await admin.query("INSERT INTO finance.route_barriers_test_only(branch_id,holder_id) VALUES(396,396),(396,397)");
    const identityClose = {requestId:randomUUID(),accountId:identityCustody.id,reason:"مراجعة هوية اصطناعية"};
    const identityGate = gate(); let identityAttempts=0;
    const identityPort=closeRouteBeforeAccount(gatedFinance(prisma,identityGate,"SELECT branch_id::text AS branch,holder_id::text AS holder,kind FROM finance.accounts WHERE id=$1::bigint"),"396","396");
    const countedIdentity:FinanceDatabase={serializable:work=>{identityAttempts++; return identityPort.serializable(work);}};
    const identityClosing = closeAccount(countedIdentity,"1",identityClose).then(value=>({value}),error=>({error}));
    await identityGate.entered;
    try { await admin.query("UPDATE finance.accounts SET holder_id=397 WHERE id=$1::bigint",[identityCustody.id]); }
    finally { identityGate.release(); }
    const identityRejected = await identityClosing;
    assert.ok("error" in identityRejected); assert.match(String(identityRejected.error),/fixture must identify one custody/);
    assert.ok(identityAttempts>=2,"the changed locked row aborts the stale serializable transaction before the identity recheck");
    const identityState = (await admin.query<{holder:string;closed:boolean}>("SELECT holder_id::text AS holder,closed_at IS NOT NULL AS closed FROM finance.accounts WHERE id=$1::bigint",[identityCustody.id])).rows[0];
    assert.deepEqual(identityState,{holder:"397",closed:false});
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.requests WHERE request_id=$1::uuid",[identityClose.requestId])).rows[0].n,0);
    const identityMarkers = await admin.query<{holder:string;revision:string}>("SELECT holder_id::text AS holder,revision::text AS revision FROM finance.route_barriers_test_only WHERE branch_id=396 ORDER BY holder_id");
    assert.deepEqual(identityMarkers.rows,[{holder:"396",revision:"0"},{holder:"397",revision:"0"}],"the aborted old marker update rolls back");

    // Contrast the actual close API without a test-pinned reviewed holder. A
    // read-only probe establishes an old snapshot before its real account lock;
    // the only identity mutation is an intentionally uncoordinated SQL writer.
    await admin.query(`INSERT INTO branches(id,code,name_ar,city,phone,invoice_prefix,opening_date,is_active,created_at)
      VALUES(398,'SYN398','فرع مقارنة الهوية','تجربة','000','SYN398',CURRENT_DATE,true,now())`);
    await admin.query(`INSERT INTO users(id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT n,398,role_code,'حامل مقارنة اصطناعي '||n,'pg-unpinned-close-'||n||'@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users CROSS JOIN generate_series(398,399) n WHERE id=1`);
    const unpinnedCustody = await openAccount(db,"1",{requestId:randomUUID(),branchId:"398",kind:"CUSTODY",holderId:"398",openingAmount:"0",openingDate:today,counted:true},today);
    const unpinnedClose = {requestId:randomUUID(),accountId:unpinnedCustody.id,reason:"مقارنة هوية اصطناعية"};
    const unpinnedGate=gate(); let unpinnedAttempts=0;
    const probeBase=gatedFinance(prisma,unpinnedGate,"SELECT branch_id::text AS branch,holder_id::text AS holder,kind FROM finance.accounts WHERE id=$1::bigint");
    const unpinnedProbe:FinanceDatabase={serializable:work=>{
      unpinnedAttempts++;
      return probeBase.serializable(async tx=>{
        const wrapped:FinanceTransaction={...tx,query:async <T extends Record<string,unknown>>(sql:string,params?:unknown[])=>{
          if (sql.includes(`kind, closed_at::text AS "closedAt" FROM finance.accounts WHERE id=$1::bigint FOR UPDATE`))
            await tx.query(`SELECT branch_id::text AS branch,holder_id::text AS holder,kind FROM finance.accounts WHERE id=$1::bigint`,[String(params?.[0])]);
          return tx.query<T>(sql,params);
        }};
        return work(wrapped);
      });
    }};
    const unpinnedClosing = closeAccount(unpinnedProbe,"1",unpinnedClose).then(value=>({value}),error=>({error}));
    await unpinnedGate.entered;
    try { await admin.query("UPDATE finance.accounts SET holder_id=399 WHERE id=$1::bigint",[unpinnedCustody.id]); }
    finally { unpinnedGate.release(); }
    const unpinnedResult = await unpinnedClosing;
    assert.ok("value" in unpinnedResult,`unpinned real close did not succeed: ${"error" in unpinnedResult ? String(unpinnedResult.error) : ""}`);
    assert.equal(unpinnedResult.value.replayed,false); assert.ok(unpinnedAttempts>=2);
    assert.deepEqual((await admin.query<{holder:string;closed:boolean}>("SELECT holder_id::text AS holder,closed_at IS NOT NULL AS closed FROM finance.accounts WHERE id=$1::bigint",[unpinnedCustody.id])).rows[0],{holder:"399",closed:true},"after retry the real API has no reviewed holder identity to compare");
    assert.deepEqual(await closeAccount(unpinnedProbe,"1",unpinnedClose),{id:unpinnedCustody.id,replayed:true});

    // Reviewed-close adapter versus an intentionally uncoordinated holder
    // change, in two selected account-lock orders. The SQL change is not an
    // endorsed account transfer and the adapter is not production wiring.
    for (const [id,order] of [[400,"holder-first"],[401,"close-first"]] as const) {
      const branch=String(id), holder=String(id), alternate=String(id+2);
      await admin.query(`INSERT INTO branches(id,code,name_ar,city,phone,invoice_prefix,opening_date,is_active,created_at)
        VALUES($1::bigint,$2,'فرع إقفال مراجَع اصطناعي','تجربة','000',$2,CURRENT_DATE,true,now())`,[branch,`SYN${branch}`]);
      await admin.query(`INSERT INTO users(id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
        SELECT n,$1::bigint,role_code,'حامل مراجَع اصطناعي '||n,'pg-reviewed-close-'||n||'@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users CROSS JOIN (VALUES($2::bigint),($3::bigint)) ids(n) WHERE id=1`,[branch,holder,alternate]);
      const account=await openAccount(db,"1",{requestId:randomUUID(),branchId:branch,kind:"CUSTODY",holderId:holder,openingAmount:"0",openingDate:today,counted:true},today);
      const snapshot=syntheticCloseAccountSnapshot({id:account.id,branchId:branch,kind:"CUSTODY",holderId:holder,closed:false});
      const input={requestId:randomUUID(),accountId:account.id,reason:"مراجعة إقفال اصطناعية",expectedAccountSnapshot:snapshot};
      if(order==="holder-first") {
        const beforeAudit: number = (await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.audit_events WHERE entity_type='ACCOUNT' AND entity_id=$1::bigint AND action='CLOSE'",[account.id])).rows[0].n;
        await admin.query("BEGIN");
        await admin.query("UPDATE finance.accounts SET holder_id=$2::bigint WHERE id=$1::bigint",[account.id,alternate]);
        let reviewedAttempts=0;
        const countedClose:FinanceDatabase={serializable:work=>{ reviewedAttempts++; return db.serializable(work); }};
        const delayed=reviewedCloseTestOnly(countedClose,"1",input).then(value=>({value}),error=>({error}));
        try { await waitForLock(admin,"accounts"); } finally { await admin.query("COMMIT"); }
        const rejected=await delayed;
        assert.ok("error" in rejected); assert.match(String(rejected.error),/تغيّرت هوية العهدة/);
        assert.ok(reviewedAttempts>=2,"the real close command retried the aborted SERIALIZABLE transaction");
        assert.deepEqual((await admin.query<{holder:string;closed:boolean}>("SELECT holder_id::text AS holder,closed_at IS NOT NULL AS closed FROM finance.accounts WHERE id=$1::bigint",[account.id])).rows[0],{holder:alternate,closed:false});
        assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.requests WHERE request_id=$1::uuid",[input.requestId])).rows[0].n,0);
        assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.audit_events WHERE entity_type='ACCOUNT' AND entity_id=$1::bigint AND action='CLOSE'",[account.id])).rows[0].n,beforeAudit);
      } else {
        const lock=gate();
        const first=reviewedCloseTestOnly(gatedFinance(prisma,lock,`kind, closed_at::text AS "closedAt" FROM finance.accounts WHERE id=$1::bigint FOR UPDATE`),"1",input);
        await lock.entered;
        const delayed:Promise<number>=Promise.resolve(prisma.$executeRawUnsafe("UPDATE finance.accounts SET holder_id=$2::bigint WHERE id=$1::bigint",account.id,alternate));
        try { await waitForLock(admin,"accounts"); } finally { lock.release(); }
        const saved=await first; assert.equal(saved.replayed,false); assert.equal(await delayed,1);
        assert.deepEqual((await admin.query<{holder:string;closed:boolean}>("SELECT holder_id::text AS holder,closed_at IS NOT NULL AS closed FROM finance.accounts WHERE id=$1::bigint",[account.id])).rows[0],{holder:alternate,closed:true});
        assert.deepEqual(await reviewedCloseTestOnly(db,"1",input),{id:account.id,replayed:true});
        await assert.rejects(()=>reviewedCloseTestOnly(db,"1",{...input,expectedAccountSnapshot:syntheticCloseAccountSnapshot({id:account.id,branchId:branch,kind:"CUSTODY",holderId:alternate,closed:true})}),/طلب الإقفال الاصطناعي مختلف/);
      }
    }

    // V2 binds the reviewed account revision. Pair it with a real recorded
    // transfer in both selected custody-lock orders, on disposable data.
    for (const [id,order] of [[407,"transfer-first"],[408,"close-first"]] as const) {
      const branch=String(id), holder=String(id);
      await admin.query(`INSERT INTO branches(id,code,name_ar,city,phone,invoice_prefix,opening_date,is_active,created_at)
        VALUES($1::bigint,$2,'فرع نسخة إقفال اصطناعي','تجربة','000',$2,CURRENT_DATE,true,now())`,[branch,`SYN${branch}`]);
      await admin.query(`INSERT INTO users(id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
        SELECT $1::bigint,$1::bigint,role_code,'حامل نسخة اصطناعي',$2,password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=1`,[holder,`pg-close-v2-${holder}@selahtone.local`]);
      const vault=await openAccount(db,"1",{requestId:randomUUID(),branchId:branch,kind:"VAULT",holderId:null,openingAmount:"10",openingDate:today,counted:true},today);
      const account=await openAccount(db,"1",{requestId:randomUUID(),branchId:branch,kind:"CUSTODY",holderId:holder,openingAmount:"0",openingDate:today,counted:true},today);
      const accountRevision: string = (await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.accounts WHERE id=$1::bigint",[account.id])).rows[0].revision;
      const input={requestId:randomUUID(),accountId:account.id,reason:"إقفال نسخة اصطناعي",reviewVersion:2,expectedAccountSnapshot:syntheticCloseAccountSnapshotV2({id:account.id,branchId:branch,kind:"CUSTODY",holderId:holder,closed:false,revision:accountRevision})};
      const transfer={requestId:randomUUID(),fromId:vault.id,toId:account.id,amount:"5",expectedBalance:"10",actuallyTransferred:true};
      const lock=gate();
      if (order === "transfer-first") {
        let paused=false;
        const gatedTransfer:FinanceDatabase={serializable:work=>db.serializable(async tx=>{
          const wrapped:FinanceTransaction={...tx,query:async <T extends Record<string,unknown>>(sql:string,params?:unknown[])=>{
            const result=await tx.query<T>(sql,params);
            if(!paused && sql.includes("FROM finance.accounts WHERE id=$1::bigint FOR UPDATE") && params?.[0]===account.id) {paused=true;lock.signal();await lock.wait;}
            return result;
          }};
          return work(wrapped);
        })};
        const first=transferCash(gatedTransfer,"1",transfer);
        await lock.entered;
        let attempts=0;
        const counted:FinanceDatabase={serializable:work=>{attempts++;return db.serializable(work);}};
        const second=reviewedCloseTestOnly(counted,"1",input).then(value=>({value}),error=>({error}));
        try {await waitForLock(admin,"accounts");} finally {lock.release();}
        const sent=await first, rejected=await second;
        assert.equal(sent.replayed,false); assert.ok(attempts>=2);
        assert.ok("error" in rejected); assert.match(String(rejected.error),/تغيّرت هوية العهدة/);
        const state: {closed:boolean;revision:string}=(await admin.query<{closed:boolean;revision:string}>("SELECT closed_at IS NOT NULL AS closed,revision::text AS revision FROM finance.accounts WHERE id=$1::bigint",[account.id])).rows[0];
        assert.equal(state.closed,false); assert.notEqual(state.revision,accountRevision);
        assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.requests WHERE request_id=$1::uuid",[input.requestId])).rows[0].n,0);
        assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE id=$1::bigint AND destination_id=$2::bigint",[sent.id,account.id])).rows[0].n,1);
        assert.deepEqual(await transferCash(db,"1",transfer),{id:sent.id,replayed:true});
      } else {
        const first=reviewedCloseTestOnly(gatedFinance(prisma,lock,`kind, closed_at::text AS "closedAt" FROM finance.accounts WHERE id=$1::bigint FOR UPDATE`),"1",input);
        await lock.entered;
        const second=transferCash(db,"1",transfer).then(value=>({value}),error=>({error}));
        try {await waitForLock(admin,"accounts");} finally {lock.release();}
        const closed=await first, rejected=await second;
        assert.equal(closed.replayed,false); assert.ok("error" in rejected); assert.match(String(rejected.error),/عهدة مقفلة/);
        assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.requests WHERE request_id=$1::uuid",[transfer.requestId])).rows[0].n,0);
        assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE source_id=$1::bigint OR destination_id=$1::bigint",[account.id])).rows[0].n,0);
        assert.deepEqual(await reviewedCloseTestOnly(db,"1",input),{id:closed.id,replayed:true});
        // Read-only comparison of current synthetic evidence, not a link
        // between the request and audit event or proof of historical review.
        const inspectClose = () => db.serializable(tx => inspectSyntheticCloseEvidence(tx, account.id));
        assert.equal(await inspectClose(),"reviewed_v2_current_match");
        const extraAudit: {id:string} = (await admin.query<{id:string}>(`INSERT INTO finance.audit_events(entity_type,entity_id,action,actor_id,reason)
          VALUES('ACCOUNT',$1::bigint,'CLOSE',1,$2) RETURNING id::text AS id`,[account.id,input.reason])).rows[0];
        assert.equal(await inspectClose(),"ambiguous_sources");
        assert.deepEqual(await reviewedCloseTestOnly(db,"1",input),{id:closed.id,replayed:true});
        await admin.query("DELETE FROM finance.audit_events WHERE id=$1::bigint",[extraAudit.id]);
        // Compare the retained unsafe three-statement variant with the new
        // single-statement comparator under the same synthetic interleaving.
        // Both committed database states are unresolved.
        const oldHash: string = syntheticCloseRequestIdentity("1",{requestId:input.requestId,accountId:input.accountId,reason:input.reason},input).reviewedHash!;
        const nextRevision: string = (BigInt(accountRevision)+1n).toString();
        const nextSnapshot: string = syntheticCloseAccountSnapshotV2({id:account.id,branchId:branch,kind:"CUSTODY",holderId:holder,closed:false,revision:nextRevision});
        const nextHash: string = syntheticCloseRequestIdentity("1",{requestId:input.requestId,accountId:input.accountId,reason:input.reason},{reviewVersion:2,expectedAccountSnapshot:nextSnapshot}).reviewedHash!;
        for (const [isolation,singleStatement] of [["READ COMMITTED",false],["SERIALIZABLE",false],["READ COMMITTED",true]] as const) {
          await admin.query("BEGIN");
          await admin.query("UPDATE finance.accounts SET revision=$2::bigint WHERE id=$1::bigint",[account.id,accountRevision]);
          await admin.query("UPDATE finance.requests SET request_hash=$2 WHERE request_id=$1::uuid",[input.requestId,nextHash]);
          await admin.query("COMMIT");
          assert.equal(await inspectClose(),"unresolved");
          const reader = new Client(config); await reader.connect();
          try {
            await reader.query(`BEGIN ISOLATION LEVEL ${isolation} READ ONLY`);
            const readGate=gate(); let paused=false;
            const port: FinanceTransaction = {query:async <T extends Record<string,unknown>>(sql:string,params?:unknown[])=>{
              const result=await reader.query<T>(sql,params);
              if (!paused && sql.includes("FROM finance.accounts WHERE id=$1::bigint")) { paused=true; readGate.signal(); await readGate.wait; }
              return {rows:result.rows};
            }};
            const inspection=(singleStatement ? inspectSyntheticCloseEvidence : inspectSyntheticCloseEvidenceMultiStatementUnsafe)(port,account.id);
            await readGate.entered;
            try {
              await admin.query("BEGIN");
              await admin.query("UPDATE finance.accounts SET revision=$2::bigint WHERE id=$1::bigint",[account.id,nextRevision]);
              await admin.query("UPDATE finance.requests SET request_hash=$2 WHERE request_id=$1::uuid",[input.requestId,oldHash]);
              await admin.query("COMMIT");
            } finally { readGate.release(); }
            assert.equal(await inspection,isolation === "READ COMMITTED" && !singleStatement ? "reviewed_v2_current_match" : "unresolved");
            await reader.query("COMMIT");
            assert.equal(await inspectClose(),"unresolved","neither committed state matched");
          } finally { await reader.end(); }
        }
        // Restore the genuine synthetic close evidence before testing replay.
        await admin.query("BEGIN");
        await admin.query("UPDATE finance.accounts SET revision=$2::bigint WHERE id=$1::bigint",[account.id,accountRevision]);
        await admin.query("UPDATE finance.requests SET request_hash=$2 WHERE request_id=$1::uuid",[input.requestId,oldHash]);
        await admin.query("COMMIT");
        assert.equal(await inspectClose(),"reviewed_v2_current_match");
        await admin.query("UPDATE finance.accounts SET revision=revision+1 WHERE id=$1::bigint",[account.id]);
        assert.equal(await inspectClose(),"unresolved");
        assert.deepEqual(await reviewedCloseTestOnly(db,"1",input),{id:closed.id,replayed:true});
      }
    }

    // A count can be cancelled without changing account revision. Test an
    // overlapping cancellation after the reviewed close has locked its account.
    await admin.query(`INSERT INTO branches(id,code,name_ar,city,phone,invoice_prefix,opening_date,is_active,created_at)
      VALUES(409,'SYN409','فرع إلغاء جرد اصطناعي','تجربة','000','SYN409',CURRENT_DATE,true,now())`);
    await admin.query(`INSERT INTO users(id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT 409,409,role_code,'حامل جرد اصطناعي','pg-close-count-409@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=1`);
    const countAccount=await openAccount(db,"1",{requestId:randomUUID(),branchId:"409",kind:"CUSTODY",holderId:"409",openingAmount:"0",openingDate:today,counted:true},today);
    const count=await requestCountFromHolder(db,"1",{requestId:randomUUID(),accountId:countAccount.id,reason:"جرد اصطناعي قبل الإقفال"});
    const countAccountRevision: string = (await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.accounts WHERE id=$1::bigint",[countAccount.id])).rows[0].revision;
    const countCloseInput={requestId:randomUUID(),accountId:countAccount.id,reason:"إقفال بعد إلغاء اصطناعي",reviewVersion:2,expectedAccountSnapshot:syntheticCloseAccountSnapshotV2({id:countAccount.id,branchId:"409",kind:"CUSTODY",holderId:"409",closed:false,revision:countAccountRevision})};
    const countCancelInput={requestId:randomUUID(),countId:count.id,reason:"إلغاء اصطناعي"};
    const pendingSnapshotBefore=await db.serializable(tx=>readSyntheticClosePendingSnapshot(tx,countAccount.id));
    assert.ok(pendingSnapshotBefore);
    const countCloseGate=gate();
    const pendingClose=reviewedCloseTestOnly(gatedFinance(prisma,countCloseGate,`kind, closed_at::text AS "closedAt" FROM finance.accounts WHERE id=$1::bigint FOR UPDATE`),"1",countCloseInput).then(value=>({value}),error=>({error}));
    await countCloseGate.entered;
    try { assert.equal((await cancelCashCount(db,"1",countCancelInput)).replayed,false); } finally { countCloseGate.release(); }
    const firstClose=await pendingClose;
    assert.ok("error" in firstClose); assert.match(String(firstClose.error),/طلب تسوية أو جرد مفتوح/);
    assert.equal((await admin.query<{revision:string}>("SELECT revision::text AS revision FROM finance.accounts WHERE id=$1::bigint",[countAccount.id])).rows[0].revision,countAccountRevision);
    const pendingSnapshotAfter=await db.serializable(tx=>readSyntheticClosePendingSnapshot(tx,countAccount.id));
    assert.notEqual(pendingSnapshotAfter,pendingSnapshotBefore,"the single-statement test reader sees the cancelled open ID");
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.requests WHERE request_id=$1::uuid",[countCloseInput.requestId])).rows[0].n,0);
    const afterCancelClose=await reviewedCloseTestOnly(db,"1",countCloseInput);
    assert.equal(afterCancelClose.replayed,false);
    assert.deepEqual(await reviewedCloseTestOnly(db,"1",countCloseInput),{id:countAccount.id,replayed:true});
    assert.deepEqual(await cancelCashCount(db,"1",countCancelInput),{id:count.id,replayed:true});

    await checkSettlementCancellationSnapshot(admin,db,today);

    // Reviewed-close SQL adapter: duplicate deliveries and changed reviewed
    // identity compete on the same synthetic request and account.
    for (const [id,changed] of [[404,false],[405,true]] as const) {
      const branch=String(id),holder=String(id);
      await admin.query(`INSERT INTO branches(id,code,name_ar,city,phone,invoice_prefix,opening_date,is_active,created_at)
        VALUES($1::bigint,$2,'فرع تكرار إقفال اصطناعي','تجربة','000',$2,CURRENT_DATE,true,now())`,[branch,`SYN${branch}`]);
      await admin.query(`INSERT INTO users(id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
        SELECT $1::bigint,$1::bigint,role_code,'حامل تكرار اصطناعي',$2,password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=1`,[holder,`pg-close-repeat-${holder}@selahtone.local`]);
      const account=await openAccount(db,"1",{requestId:randomUUID(),branchId:branch,kind:"CUSTODY",holderId:holder,openingAmount:"0",openingDate:today,counted:true},today);
      const snapshot=syntheticCloseAccountSnapshot({id:account.id,branchId:branch,kind:"CUSTODY",holderId:holder,closed:false});
      const input={requestId:randomUUID(),accountId:account.id,reason:"تكرار إقفال اصطناعي",expectedAccountSnapshot:snapshot};
      const competing=changed?{...input,expectedAccountSnapshot:syntheticCloseAccountSnapshot({id:account.id,branchId:branch,kind:"CUSTODY",holderId:"1",closed:false})}:input;
      const g=gate(); let attempts=0;
      const first=reviewedCloseTestOnly(gatedFinance(prisma,g,`kind, closed_at::text AS "closedAt" FROM finance.accounts WHERE id=$1::bigint FOR UPDATE`),"1",input);
      await g.entered;
      const counted:FinanceDatabase={serializable:work=>{attempts++;return db.serializable(work);}};
      const second=reviewedCloseTestOnly(counted,"1",competing).then(value=>({value}),error=>({error}));
      try { await waitForLock(admin,"accounts"); } finally { g.release(); }
      const saved=await first, later=await second;
      assert.equal(saved.replayed,false); assert.ok(attempts>=2,"the real close command retries its aborted transaction");
      if(changed) { assert.ok("error" in later); assert.match(String(later.error),/طلب الإقفال الاصطناعي مختلف/); }
      else { assert.ok("value" in later); assert.deepEqual(later.value,{id:saved.id,replayed:true}); }
      assert.deepEqual(await reviewedCloseTestOnly(db,"1",input),{id:saved.id,replayed:true});
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.requests WHERE request_id=$1::uuid",[input.requestId])).rows[0].n,1);
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.audit_events WHERE entity_type='ACCOUNT' AND action='CLOSE' AND entity_id=$1::bigint",[account.id])).rows[0].n,1);
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE source_id=$1::bigint OR destination_id=$1::bigint",[account.id])).rows[0].n,0);
    }
    // Legacy requests replay with their original identity only, including on
    // PostgreSQL; adding a snapshot cannot retroactively create a review.
    await admin.query(`INSERT INTO branches(id,code,name_ar,city,phone,invoice_prefix,opening_date,is_active,created_at)
      VALUES(406,'SYN406','فرع إقفال قديم اصطناعي','تجربة','000','SYN406',CURRENT_DATE,true,now())`);
    await admin.query(`INSERT INTO users(id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT 406,406,role_code,'حامل إقفال قديم','pg-legacy-close-406@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=1`);
    const legacyCloseAccount=await openAccount(db,"1",{requestId:randomUUID(),branchId:"406",kind:"CUSTODY",holderId:"406",openingAmount:"0",openingDate:today,counted:true},today);
    const legacyCloseInput={requestId:randomUUID(),accountId:legacyCloseAccount.id,reason:"إقفال قديم اصطناعي"};
    const legacyCloseResult=await closeAccount(db,"1",legacyCloseInput);
    assert.deepEqual(await reviewedCloseTestOnly(db,"1",legacyCloseInput),{id:legacyCloseResult.id,replayed:true});
    await assert.rejects(()=>reviewedCloseTestOnly(db,"1",{...legacyCloseInput,expectedAccountSnapshot:syntheticCloseAccountSnapshot({id:legacyCloseAccount.id,branchId:"406",kind:"CUSTODY",holderId:"406",closed:false})}),/طلب الإقفال الاصطناعي مختلف/);
    await assert.rejects(()=>reviewedCloseTestOnly(db,"3",legacyCloseInput),/هذه العملية للمدير والمحاسب فقط/);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.audit_events WHERE entity_type='ACCOUNT' AND action='CLOSE' AND entity_id=$1::bigint",[legacyCloseAccount.id])).rows[0].n,1);

    // Deliberately demonstrate the account/marker order inversion: the
    // collector holds the marker before choosing and locking custody; the
    // real close command has already locked custody before this test-only
    // interception attempts the marker. This is not a production hook.
    await admin.query(`INSERT INTO branches(id,code,name_ar,city,phone,invoice_prefix,opening_date,is_active,created_at)
      VALUES(395,'SYN395','فرع تعارض إقفال','تجربة','000','SYN395',CURRENT_DATE,true,now())`);
    await admin.query(`INSERT INTO users(id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT 395,395,role_code,'مدير تعارض إقفال','pg-close-cycle-395@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=1`);
    const closeCycleVault = await openAccount(db,"1",{requestId:randomUUID(),branchId:"395",kind:"VAULT",holderId:null,openingAmount:"0",openingDate:today,counted:true},today);
    const closeCycleCustody = await openAccount(db,"1",{requestId:randomUUID(),branchId:"395",kind:"CUSTODY",holderId:"395",openingAmount:"0",openingDate:today,counted:true},today);
    await admin.query("INSERT INTO finance.route_barriers_test_only(branch_id,holder_id) VALUES(395,395)");
    const closeCycleSale: string = (await admin.query<{id:string}>(`INSERT INTO commerce_sales(request_id,request_hash,branch_id,warehouse_id,customer_name,customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,created_by_id)
      SELECT $1::uuid,$2,395,warehouse_id,'فاتورة تعارض إقفال',customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,395 FROM commerce_sales WHERE id=2 RETURNING id::text`,[randomUUID(),"a".repeat(64)])).rows[0].id;
    const closeCycleInput = {...rawCommand,requestId:randomUUID(),saleId:closeCycleSale,amount:"5"};
    const closeCycleRequest = {requestId:randomUUID(),accountId:closeCycleCustody.id,reason:"إقفال تعارض اصطناعي"};
    const closeCycleGate=gate(); let closeCycleTransactions=0, closeCycleAttempts=0;
    const closeAfterAccount:FinanceDatabase = {serializable:work=>{
      closeCycleTransactions++;
      return db.serializable(async tx => {
        const wrapped:FinanceTransaction={...tx,query:async <T extends Record<string,unknown>>(sql:string,params?:unknown[])=>{
          if (sql.includes("UPDATE finance.accounts SET closed_at=CURRENT_TIMESTAMP")) {
            assert.equal(params?.[0],closeCycleCustody.id);
            await markRoute(tx,"395","395");
          }
          return tx.query<T>(sql,params);
        }};
        return work(wrapped);
      });
    }};
    const closeCycleRoute = (tx:FinanceTransaction,branch:string,actor:bigint) => markRoute(tx,branch,String(actor));
    const closeCycleCollect = (async () => {
      for (;;) {
        try {
          closeCycleAttempts++;
          const base=closeCycleAttempts===1 ? gatedFinance(prisma!,closeCycleGate,"UPDATE finance.route_barriers_test_only") : db;
          return await base.serializable(tx => recordVaultCollectionTestOnly(tx,395n,closeCycleInput,closeCycleRoute));
        } catch(error) { if (closeCycleAttempts<4 && isRetryableTransactionConflict(error)) continue; throw error; }
      }
    })().then(value=>({value}),error=>({error}));
    await closeCycleGate.entered;
    const closeCycleClose = closeAccount(closeAfterAccount,"1",closeCycleRequest);
    try { await waitForLock(admin,"route_barriers_test_only"); } finally { closeCycleGate.release(); }
    const closeCycleResult = await closeCycleCollect;
    const closeCycleClosed = await closeCycleClose;
    assert.equal(closeCycleClosed.replayed,false);
    assert.ok(closeCycleAttempts>=2 || closeCycleTransactions>=2,"an inverted account-marker cycle requires a whole-transaction retry");
    assert.equal((await admin.query<{closed:boolean}>("SELECT closed_at IS NOT NULL AS closed FROM finance.accounts WHERE id=$1::bigint",[closeCycleCustody.id])).rows[0].closed,true);
    const closeCycleRows=await admin.query<{id:string}>("SELECT id::text AS id FROM commerce_collections WHERE request_id=$1::uuid",[closeCycleInput.requestId]);
    if ("value" in closeCycleResult) {
      assert.equal(closeCycleResult.value.replayed,false); assert.deepEqual(closeCycleRows.rows,[{id:closeCycleResult.value.id}]);
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE external_ref=$1 AND destination_id=$2::bigint",[`collection:${closeCycleResult.value.id}`,closeCycleVault.id])).rows[0].n,1);
      assert.deepEqual(await db.serializable(tx => recordVaultCollectionTestOnly(tx,395n,closeCycleInput,closeCycleRoute)),{id:closeCycleResult.value.id,replayed:true});
    } else {
      assert.match(String(closeCycleResult.error),/الوجهة المختارة ليست خزنة/); assert.equal(closeCycleRows.rows.length,0);
      assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements WHERE destination_id=$1::bigint",[closeCycleVault.id])).rows[0].n,0);
    }
    assert.deepEqual(await closeAccount(closeAfterAccount,"1",closeCycleRequest),{id:closeCycleCustody.id,replayed:true});

    // Production display SQL over these real synthetic source writes. It is an
    // event-registration view, not settlement attribution or physical cash.
    const recorded = await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      return financePort(tx).query<{kind:string;method:string;amount:string;count:number;flagged:number}>(RECORDED_FLOW_SQL, ["1", "18", `${today.slice(0,7)}-01`]);
    }, { isolationLevel: "Serializable", timeout: 20000 });
    const collectionFlow = recorded.rows.find(r => r.kind === "COLLECTION" && r.method === "CASH");
    const paymentFlow = recorded.rows.find(r => r.kind === "PAYMENT" && r.method === "CASH");
    assert.deepEqual(collectionFlow, {kind:"COLLECTION",method:"CASH",amount:"10.00",count:1,flagged:0});
    assert.deepEqual(paymentFlow, {kind:"PAYMENT",method:"CASH",amount:"12.00",count:3,flagged:0});
    assert.equal(recorded.rows.some(r => r.kind === "REFUND"), false);
    const otherBranchFlow = await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      return financePort(tx).query(RECORDED_FLOW_SQL, ["2", "18", `${today.slice(0,7)}-01`]);
    }, { isolationLevel: "Serializable", timeout: 20000 });
    assert.equal(otherBranchFlow.rows.length, 0, "recorder events in a different branch must not enter the selected scope");

    // The page's aggregate reads a real synthetic settlement transfer through
    // the production SQL and the Prisma WASM/PostgreSQL adapter, in scope.
    const transferMonth = await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      return financePort(tx).query<{ branchId:string; direction:string; amount:string; count:number }>(TRANSFER_MONTH_SQL, [false,"1",realAccount.id,`${today.slice(0,7)}-01`]);
    }, { isolationLevel: "Serializable", timeout: 20000 });
    assert.equal(transferMonth.rows.length, 1);
    assert.equal(transferMonth.rows[0].branchId, "1");
    assert.equal(transferMonth.rows[0].direction, "TO_VAULT");
    assert.equal(transferMonth.rows[0].amount, "7.00");
    assert.equal(transferMonth.rows[0].count, 1);
    const wrongTransferScope = await prisma.$transaction(tx => financePort(tx).query(TRANSFER_MONTH_SQL, [false,"2",realAccount.id,`${today.slice(0,7)}-01`]), { isolationLevel: "Serializable", timeout: 20000 });
    assert.equal(wrongTransferScope.rows.length, 0);

    // A read-only repeatable snapshot compares the old formula with candidate
    // IDs after those real services; it does not certify actual history.
    const reviewRowsBefore = await admin.query<{ revision: string; receipts: string }>(`SELECT revision::text AS revision,(SELECT count(*)::text FROM finance.settlement_allocation_receipts_test_only) AS receipts FROM finance.accounts WHERE id=$1::bigint`, [realAccount.id]);
    const report = await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      await tx.$executeRawUnsafe("SET LOCAL selahtone.cutover_period_audit_test_only='yes'");
      return auditTestOnlyPeriod(financePort(tx), realAccount.id);
    }, { isolationLevel: "Serializable", timeout: 20000 });
    assert.equal(report.context.openSettlements, 1);
    assert.deepEqual(report.payments.matched.map(p => p.amount), ["4.00", "5.00"]);
    assert.equal(report.payments.oldOnly.length, 0); assert.equal(report.payments.candidateOnly.length, 0);
    const reviewRowsAfter = await admin.query<{ revision: string; receipts: string }>(`SELECT revision::text AS revision,(SELECT count(*)::text FROM finance.settlement_allocation_receipts_test_only) AS receipts FROM finance.accounts WHERE id=$1::bigint`, [realAccount.id]);
    assert.deepEqual(reviewRowsAfter.rows, reviewRowsBefore.rows);
    const readReceipts = () => prisma!.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      await tx.$executeRawUnsafe("SET LOCAL selahtone.cutover_period_audit_test_only='yes'");
      return auditTestOnlyReceipts(financePort(tx), realAccount.id);
    }, { isolationLevel: "Serializable", timeout: 20000 });
    const receiptReport = await readReceipts();
    assert.deepEqual(receiptReport.confirmedWithoutReceipt, []);
    assert.deepEqual(receiptReport.linkedWithoutReceipt, []);
    const receipt = receiptReport.reviews.find(row => row.settlementId === realRequest1.id);
    assert.ok(receipt); assert.deepEqual(receipt.issues, []);
    assert.deepEqual(receipt.collections.map(row => row.id), realReview1.collections.map(row => row.id));
    assert.deepEqual(receipt.payments.map(row => row.id), realReview1.payments.map(row => row.id));
    // Mutate only the disposable fixture to show the receipt detects source
    // changes; checking never writes. Restore before continuing other tests.
    const syntheticCollection = realReview1.collections[0];
    assert.ok(syntheticCollection);
    await admin.query("UPDATE commerce_collections SET amount=amount+1 WHERE id=$1::bigint", [syntheticCollection.id]);
    try {
      const tampered = await readReceipts();
      const flagged = tampered.reviews.find(row => row.settlementId === realRequest1.id);
      assert.ok(flagged?.issues.includes("snapshot_mismatch"));
      assert.ok(flagged?.issues.includes("attached_total_mismatch"));
      assert.deepEqual((await admin.query<{ amount: string }>("SELECT amount::text AS amount FROM commerce_collections WHERE id=$1::bigint", [syntheticCollection.id])).rows[0].amount, "11.00");
    } finally { await admin.query("UPDATE commerce_collections SET amount=$2::numeric WHERE id=$1::bigint", [syntheticCollection.id, syntheticCollection.amount]); }
    assert.deepEqual((await readReceipts()).reviews.find(row => row.settlementId === realRequest1.id)?.issues, []);
    assert.deepEqual((await admin.query<{ revision: string; receipts: string }>(`SELECT revision::text AS revision,(SELECT count(*)::text FROM finance.settlement_allocation_receipts_test_only) AS receipts FROM finance.accounts WHERE id=$1::bigint`, [realAccount.id])).rows, reviewRowsBefore.rows);

    // Count and holder-cash payment with experimental in-transaction
    // allocation/comparison. Two selected orders; all fixtures are synthetic.
    await admin.query(`INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT n,1,role_code,'موظف جرد تزامن '||n,'pg-count-payment-'||n||'@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users CROSS JOIN generate_series(25,26) n WHERE id=3`);
    for (const holder of ["25", "26"]) {
      const account = await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "CUSTODY", holderId: holder, openingAmount: "10", openingDate: today, counted: true }, today);
      await admin.query("UPDATE finance.accounts SET opened_at=now()-interval '1 day' WHERE id=$1::bigint", [account.id]);
      const expense = await createExpense(db, holder, { requestId: randomUUID(), branchId: "1", categoryId: "1", amount: "8", expenseDate: today, description: "مصروف وجرد متزامنان" });
      await approveExpense(db, "1", { requestId: randomUUID(), expenseId: expense.id, expectedRevision: "1" });
      const payment = { requestId: randomUUID(), expenseId: expense.id, expectedRevision: "2", method: "CASH", accountId: null, paymentDate: today, actuallyPaid: true, source: "HOLDER_CASH" };
      const countInput = { requestId: randomUUID(), accountId: account.id, expectedBalance: "10", countedAmount: "10", reason: "جرد تزامن اصطناعي", actuallyCounted: true };
      const g = gate();
      if (holder === "25") {
        const counting = requestCashCount(testCountClosePeriodGuard(gatedFinance(prisma, g), account.id), "1", countInput, today);
        await g.entered;
        const delayedPayment = payExpense(testHolderPaymentService(db, holder), holder, payment, today);
        try { await waitForLock(admin, "accounts"); } finally { g.release(); }
        const counted = await counting;
        await assert.rejects(delayedPayment, /جرد مفتوح للعهدة/);
        const state: { status: string; observed: string } = (await admin.query<{ status: string; observed: string }>("SELECT status,observed_balance::text AS observed FROM finance.cash_counts WHERE id=$1::bigint", [counted.id])).rows[0];
        assert.deepEqual(state, { status: "OPEN", observed: "10.00" });
        assert.equal((await admin.query<{ n: string }>("SELECT count(*)::text AS n FROM finance.payments WHERE expense_id=$1::bigint", [expense.id])).rows[0].n, "0");
        assert.equal((await admin.query<{ n: string }>("SELECT count(*)::text AS n FROM finance.requests WHERE request_id=$1::uuid", [payment.requestId])).rows[0].n, "0");
        await cancelCashCount(db, "1", { requestId: randomUUID(), countId: counted.id, reason: "إلغاء جرد تجريبي" });
        await payExpense(testHolderPaymentService(db, holder), holder, payment, today);
        assert.equal((await payExpense(testHolderPaymentService(db, holder), holder, payment, today)).replayed, true);
      } else {
        const locked = gatedFinance(prisma, g, "WHERE branch_id=$1::bigint AND holder_id=$2::bigint AND kind='CUSTODY' AND closed_at IS NULL ORDER BY id FOR UPDATE");
        const paying = payExpense(testHolderPaymentService(locked, holder), holder, payment, today);
        await g.entered;
        const outdatedCount = requestCashCount(testCountClosePeriodGuard(db, account.id), "1", countInput, today);
        try { await waitForLock(admin, "accounts"); } finally { g.release(); }
        await paying;
        await assert.rejects(outdatedCount, /تغير الرصيد المتوقع في اليد/);
        assert.equal((await admin.query<{ n: string }>("SELECT count(*)::text AS n FROM finance.requests WHERE request_id=$1::uuid", [countInput.requestId])).rows[0].n, "0");
        assert.equal((await admin.query<{ n: string }>("SELECT count(*)::text AS n FROM finance.cash_counts WHERE account_id=$1::bigint", [account.id])).rows[0].n, "0");
      }
      const pending: Awaited<ReturnType<typeof reviewTestPeriod>> = await db.serializable(tx => reviewTestPeriod(tx, account.id));
      assert.deepEqual(pending.payments.map(p => p.amount), ["8.00"]);
      assert.equal((await settlementOverview(db, holder, account.id)).expected, "2.00");
      const newInput = { ...countInput, requestId: randomUUID(), expectedBalance: "2", countedAmount: "2" };
      const newCount = await requestCashCount(testCountClosePeriodGuard(db, account.id), "1", newInput, today);
      const decision = { requestId: randomUUID(), countId: newCount.id, reason: "اعتماد جرد جديد", stillCurrent: true };
      await confirmCashCount(testCountClosePeriodGuard(db, account.id), "1", decision);
      assert.equal((await confirmCashCount(testCountClosePeriodGuard(db, account.id), "1", decision)).replayed, true);
      assert.equal((await admin.query<{ n: string }>("SELECT count(*)::text AS n FROM finance.movements WHERE cash_count_id=$1::bigint", [newCount.id])).rows[0].n, "0");
      assert.deepEqual((await db.serializable(tx => reviewTestPeriod(tx, account.id))).payments.map(p => p.id), pending.payments.map(p => p.id), "count does not consume pending payments");
      // Replay remains safe even after a confirmed count; a new payment does not.
      assert.equal((await payExpense(testHolderPaymentService(db, holder), holder, payment, today)).replayed, true);
      const afterCountExpense = await createExpense(db, holder, { requestId: randomUUID(), branchId: "1", categoryId: "1", amount: "3", expenseDate: today, description: "صرف اصطناعي بعد جرد مؤكد" });
      await approveExpense(db, "1", { requestId: randomUUID(), expenseId: afterCountExpense.id, expectedRevision: "1" });
      const afterCountPayment = { ...payment, requestId: randomUUID(), expenseId: afterCountExpense.id };
      await assert.rejects(() => payExpense(db, holder, afterCountPayment, today), /جرد مؤكد/);
      assert.equal((await admin.query<{ n: string }>("SELECT count(*)::text AS n FROM finance.payments WHERE expense_id=$1::bigint", [afterCountExpense.id])).rows[0].n, "0");
      assert.equal((await admin.query<{ n: string }>("SELECT count(*)::text AS n FROM finance.requests WHERE request_id=$1::uuid", [afterCountPayment.requestId])).rows[0].n, "0");
    }

    // Directed count records the reference when the holder submits, not when
    // the request was opened. Test payment against that submission both ways.
    await admin.query(`INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT n,1,role_code,'موظف جرد موجّه '||n,'pg-directed-payment-'||n||'@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users CROSS JOIN generate_series(27,28) n WHERE id=3`);
    for (const holder of ["27", "28"]) {
      const account = await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "CUSTODY", holderId: holder, openingAmount: "10", openingDate: today, counted: true }, today);
      await admin.query("UPDATE finance.accounts SET opened_at=now()-interval '1 day' WHERE id=$1::bigint", [account.id]);
      const expense = await createExpense(db, holder, { requestId: randomUUID(), branchId: "1", categoryId: "1", amount: "8", expenseDate: today, description: "صرف وجرد موجّه متزامنان" });
      await approveExpense(db, "1", { requestId: randomUUID(), expenseId: expense.id, expectedRevision: "1" });
      const payment = { requestId: randomUUID(), expenseId: expense.id, expectedRevision: "2", method: "CASH", accountId: null, paymentDate: today, actuallyPaid: true, source: "HOLDER_CASH" };
      const count = await requestCountFromHolder(db, "1", { requestId: randomUUID(), accountId: account.id, reason: "جرد موجّه اصطناعي" });
      const submit = { requestId: randomUUID(), countId: count.id, countedAmount: "10", actuallyCounted: true };
      const g = gate();
      if (holder === "27") {
        const submitting = submitHolderCount(testCountClosePeriodGuard(gatedFinance(prisma, g), account.id), holder, submit);
        await g.entered;
        const paying = payExpense(testHolderPaymentService(db, holder), holder, payment, today);
        try { await waitForLock(admin, "accounts"); } finally { g.release(); }
        await submitting;
        await assert.rejects(paying, /جرد مفتوح للعهدة/);
      } else {
        const locked = gatedFinance(prisma, g, "WHERE branch_id=$1::bigint AND holder_id=$2::bigint AND kind='CUSTODY' AND closed_at IS NULL ORDER BY id FOR UPDATE");
        const paying = payExpense(testHolderPaymentService(locked, holder), holder, payment, today);
        await g.entered;
        const submitting = submitHolderCount(testCountClosePeriodGuard(db, account.id), holder, submit);
        try { await waitForLock(admin, "accounts"); } finally { g.release(); }
        await assert.rejects(paying, /جرد مفتوح للعهدة/);
        await submitting;
      }
      const record: { observed: string; difference: string } = (await admin.query<{ observed: string; difference: string }>("SELECT observed_balance::text AS observed,difference::text AS difference FROM finance.cash_counts WHERE id=$1::bigint", [count.id])).rows[0];
      assert.deepEqual(record, { observed: "10.00", difference: "0.00" });
      assert.equal((await admin.query<{ n: string }>("SELECT count(*)::text AS n FROM finance.payments WHERE expense_id=$1::bigint", [expense.id])).rows[0].n, "0");
      assert.equal((await admin.query<{ n: string }>("SELECT count(*)::text AS n FROM finance.requests WHERE request_id=$1::uuid", [payment.requestId])).rows[0].n, "0");
      await cancelCashCount(db, "1", { requestId: randomUUID(), countId: count.id, reason: "إلغاء جرد تجريبي" });
      await payExpense(testHolderPaymentService(db, holder), holder, payment, today);
      assert.equal((await payExpense(testHolderPaymentService(db, holder), holder, payment, today)).replayed, true);
      const pending: Awaited<ReturnType<typeof reviewTestPeriod>> = await db.serializable(tx => reviewTestPeriod(tx, account.id));
      assert.deepEqual(pending.payments.map(p => p.amount), ["8.00"]);
      assert.equal((await admin.query<{ n: string }>("SELECT count(*)::text AS n FROM finance.movements WHERE cash_count_id=$1::bigint", [count.id])).rows[0].n, "0");
    }

    // PostgreSQL also executes the mismatch path (not only the matching path)
    // of the test-only count/close comparator. Equality is manufactured; this
    // is not evidence about the physical order of actual historical events.
    await admin.query(`INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT n,1,role_code,'موظف حد فترة '||n,'pg-boundary-count-'||n||'@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users CROSS JOIN generate_series(29,30) n WHERE id=3`);
    for (const holder of ["29", "30"]) {
      const account = await openAccount(db, "1", { requestId: randomUUID(), branchId: "1", kind: "CUSTODY", holderId: holder, openingAmount: "0", openingDate: today, counted: true }, today);
      const adapter = testCountClosePeriodGuard(db, account.id);
      if (holder === "29") {
        const sale = (await admin.query<{ id: string }>(`INSERT INTO commerce_sales(request_id,request_hash,branch_id,warehouse_id,customer_name,customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,created_by_id)
          SELECT $1::uuid,repeat('a',64),branch_id,warehouse_id,'حد جرد اصطناعي',customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,$2::bigint FROM commerce_sales WHERE id=2 RETURNING id::text`, [randomUUID(),holder])).rows[0].id;
        await recordCommerceCollection(testCollectionService(prisma, holder), BigInt(holder), { requestId: randomUUID(), saleId: sale, amount: "8", method: "CASH", actuallyPaid: false });
        const pending = await db.serializable(tx => reviewTestPeriod(tx, account.id));
        assert.deepEqual(pending.collections.map(item => item.amount), ["8.00"]);
        await admin.query("UPDATE commerce_collections SET created_at=(SELECT opened_at FROM finance.accounts WHERE id=$1::bigint) WHERE id=$2::bigint", [account.id,pending.collections[0].id]);
      } else {
        const expense = await createExpense(db, holder, { requestId: randomUUID(), branchId: "1", categoryId: "1", amount: "8", expenseDate: today, description: "حد دفع اصطناعي" });
        await approveExpense(db, "1", { requestId: randomUUID(), expenseId: expense.id, expectedRevision: "1" });
        await payExpense(testHolderPaymentService(db, holder), holder, { requestId: randomUUID(), expenseId: expense.id, expectedRevision: "2", method: "CASH", accountId: null, paymentDate: today, actuallyPaid: true, source: "HOLDER_CASH" }, today);
        const pending = await db.serializable(tx => reviewTestPeriod(tx, account.id));
        assert.deepEqual(pending.payments.map(item => item.amount), ["8.00"]);
        await admin.query("UPDATE finance.payments SET recorded_at=(SELECT opened_at FROM finance.accounts WHERE id=$1::bigint) WHERE id=$2::bigint", [account.id,pending.payments[0].id]);
      }
      const before: Record<string, unknown> = (await admin.query(`SELECT revision::text,closed_at::text,
        (SELECT count(*)::int FROM finance.cash_counts WHERE account_id=$1::bigint) AS counts,
        (SELECT count(*)::int FROM finance.audit_events) AS audits,
        (SELECT count(*)::int FROM finance.requests) AS requests,
        (SELECT count(*)::int FROM finance.movements) AS movements FROM finance.accounts WHERE id=$1::bigint`, [account.id])).rows[0];
      const count = { requestId: randomUUID(), accountId: account.id, expectedBalance: "0", countedAmount: "0", reason: "حد اختبار اصطناعي", actuallyCounted: true };
      const close = { requestId: randomUUID(), accountId: account.id, reason: "حد إقفال اصطناعي" };
      await assert.rejects(() => requestCashCount(adapter, "1", count, today), /بنفس وقت بداية الفترة/);
      await assert.rejects(() => closeAccount(adapter, "1", close), /بنفس وقت بداية الفترة/);
      const after: Record<string, unknown> = (await admin.query(`SELECT revision::text,closed_at::text,
        (SELECT count(*)::int FROM finance.cash_counts WHERE account_id=$1::bigint) AS counts,
        (SELECT count(*)::int FROM finance.audit_events) AS audits,
        (SELECT count(*)::int FROM finance.requests) AS requests,
        (SELECT count(*)::int FROM finance.movements) AS movements FROM finance.accounts WHERE id=$1::bigint`, [account.id])).rows[0];
      assert.deepEqual(after, before, "mismatch must roll back count, closure, revision, audit and receipts");
      await assert.rejects(() => closeAccount(db, "1", close), /بنفس وقت بداية الفترة/);
      const remains = await db.serializable(tx => reviewTestPeriod(tx, account.id));
      assert.equal(remains.collections.length + remains.payments.length, 1);
      const dashboard: { expected: string; boundary: boolean } = (await admin.query<{ expected: string; boundary: boolean }>(`SELECT (x.bal+x.period_sales-x.period_expenses)::text AS expected,x.boundary_ambiguous AS boundary FROM (${CUSTODY_EXPECTATION_SQL}) x WHERE x.id=$2::bigint`, ["1", account.id])).rows[0];
      const overview = await settlementOverview(db, "1", account.id);
      assert.equal(dashboard.expected, overview.expected);
      assert.equal(dashboard.boundary, overview.boundaryAmbiguous);
      assert.equal(dashboard.boundary, true);
    }

    // Directory edits and custody creation use real services, real serializable
    // transactions and explicit locks; all users and branches are synthetic.
    await admin.query(`INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT n,1,role_code,'موظف اصطناعي '||n,'pg-directory-'||n||'@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now()
      FROM users CROSS JOIN generate_series(10,15) n WHERE id=3`);
    const expectedUser = async (id: bigint) => prisma!.user.findUniqueOrThrow({ where: { id }, select: { fullName: true, email: true, phone: true, roleCode: true, branchId: true, status: true } });
    const inputUser = async (id: bigint, branchId: bigint | null, status: "ACTIVE" | "SUSPENDED" = "ACTIVE") => {
      const expected = await expectedUser(id);
      return { userId: id, actorRole: "MANAGER" as const, financeOn: true, expected, data: { ...expected, branchId, status } };
    };
    const broken = interceptedDirectory(prisma, "FROM finance.accounts", undefined, true);
    await assert.rejects(updateDirectoryUser(broken, await inputUser(10n, 2n)), /تعذّر التحقق من العهد/);
    assert.equal((await expectedUser(10n)).branchId, 1n);
    await assert.rejects(setDirectoryBranchActive(broken, 2n, false, true), /تعذّر التحقق من العهد/);
    assert.equal((await prisma.branch.findUniqueOrThrow({ where: { id: 2n } })).isActive, true);

    const openInput = (holderId: string) => ({ requestId: randomUUID(), branchId: "1", kind: "CUSTODY", holderId, openingAmount: "0", openingDate: today, counted: true });
    const openFirstGate = gate();
    const openedFirst = openAccount(gatedFinance(prisma, openFirstGate, "FROM public.users WHERE id=$1::bigint AND branch_id=$2::bigint"), "1", openInput("10"), today);
    await openFirstGate.entered;
    const blockedMove = updateDirectoryUser(prisma, { ...await inputUser(10n, 2n), financeOn: false });
    try { await waitForLock(admin, "users"); } finally { openFirstGate.release(); }
    await openedFirst;
    await assert.rejects(blockedMove, /عهدة نقدية مفتوحة/);
    assert.equal((await expectedUser(10n)).branchId, 1n);
    await assert.rejects(updateDirectoryUser(prisma, { ...await inputUser(10n, 1n, "SUSPENDED"), financeOn: false }), /عهدة نقدية مفتوحة/);
    assert.equal((await expectedUser(10n)).status, "ACTIVE");

    const moveFirstGate = gate();
    const movedFirst = updateDirectoryUser(interceptedDirectory(prisma, "FROM public.users WHERE id=$1::bigint FOR UPDATE", moveFirstGate), { ...await inputUser(11n, 2n), financeOn: false });
    await moveFirstGate.entered;
    const blockedOpen = openAccount(db, "1", openInput("11"), today);
    try { await waitForLock(admin, "users"); } finally { moveFirstGate.release(); }
    await movedFirst;
    await assert.rejects(blockedOpen, /الموظف غير نشط أو لا ينتمي إلى الفرع/);
    assert.equal((await admin.query<{ n: string }>("SELECT count(*)::text n FROM finance.accounts WHERE holder_id=11 AND kind='CUSTODY'")).rows[0].n, "0");

    // Synthetic external branch state changes exercise both lock orders. They
    // do not model or authorize a real directory operation.
    await admin.query(`INSERT INTO branches (id,code,name_ar,invoice_prefix,opening_date,is_active,created_at)
      VALUES (90,'BR90','فرع اصطناعي','BR90',CURRENT_DATE,true,now());
      INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT n,90,role_code,'موظف طلب اصطناعي '||n,'pg-request-'||n||'@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now()
      FROM users CROSS JOIN generate_series(90,91) n WHERE id=3`);
    const requestInput = { requestId: randomUUID(), amount: "10", reason: "طلب اصطناعي" };
    const requestGate = gate();
    const requestFirst = requestCustody(gatedFinance(prisma, requestGate, "FROM public.branches WHERE id=$1::bigint FOR SHARE"), "90", requestInput);
    await requestGate.entered;
    const laterStop = Promise.resolve(prisma.$executeRawUnsafe("UPDATE public.branches SET is_active=false WHERE id=90"));
    try { await waitForLock(admin, "branches"); } finally { requestGate.release(); }
    const savedBeforeStop = await requestFirst;
    await laterStop;
    assert.equal((await requestCustody(db, "90", requestInput)).replayed, true);
    await assert.rejects(() => decideCustodyRequest(db, "1", { requestId: randomUUID(), requestId2: savedBeforeStop.id, decision: "APPROVE", reason: "اختبار", openingDate: today, counted: true }, today), /الفرع غير موجود أو غير نشط/);
    await decideCustodyRequest(db, "1", { requestId: randomUUID(), requestId2: savedBeforeStop.id, decision: "REJECT", reason: "رفض اصطناعي" }, today);
    await admin.query("UPDATE public.branches SET is_active=true WHERE id=90");
    const stopGate = gate();
    const stopFirst = prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe("UPDATE public.branches SET is_active=false WHERE id=90");
      stopGate.signal(); await stopGate.wait;
    }, { isolationLevel: "Serializable", timeout: 20000 });
    await stopGate.entered;
    const requestAfterStop = requestCustody(db, "91", { requestId: randomUUID(), amount: "10", reason: "طلب بعد الإيقاف" });
    try { await waitForLock(admin, "branches"); } finally { stopGate.release(); }
    await stopFirst;
    await assert.rejects(requestAfterStop, /الفرع غير موجود أو غير نشط/);
    assert.equal((await admin.query<{ n: string }>("SELECT count(*)::text AS n FROM finance.custody_requests WHERE requester_id=91")).rows[0].n, "0");
    const custodySnapshot = async (id: string) => custodyRequestSnapshot((await admin!.query<{ id: string; branchId: string; requesterId: string; amount: string; reason: string }>(`SELECT id::text AS id,branch_id::text AS "branchId",requester_id::text AS "requesterId",requested_amount::text AS amount,reason FROM finance.custody_requests WHERE id=$1::bigint`, [id])).rows[0]);
    // External synthetic writer changes the request while approval waits on its row.
    await admin.query("UPDATE public.branches SET is_active=true WHERE id=90");
    const changingRequest = await requestCustody(db, "90", { requestId: randomUUID(), amount: "10", reason: "طلب قبل تعديل اصطناعي" });
    const staleToken = await custodySnapshot(changingRequest.id);
    const changingGate = gate();
    const changing = prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe("UPDATE finance.custody_requests SET requested_amount=20,reason='تغيير اصطناعي' WHERE id=$1::bigint", changingRequest.id);
      changingGate.signal(); await changingGate.wait;
    }, { isolationLevel: "Serializable", timeout: 20000 });
    await changingGate.entered;
    const staleDecision = decideCustodyRequest(db, "1", { requestId: randomUUID(), requestId2: changingRequest.id, decision: "APPROVE", reason: "اعتماد قديم", openingDate: today, counted: true, expectedSnapshot: staleToken }, today);
    try { await waitForLock(admin, "custody_requests"); } finally { changingGate.release(); }
    await changing;
    await assert.rejects(staleDecision, /تغيّر طلب العهدة منذ عرضه/);
    assert.equal((await admin.query<{ status: string }>("SELECT status FROM finance.custody_requests WHERE id=$1::bigint", [changingRequest.id])).rows[0].status, "PENDING");
    assert.equal((await admin.query<{ n: string }>("SELECT count(*)::text AS n FROM finance.accounts WHERE holder_id=90")).rows[0].n, "0");
    await decideCustodyRequest(db, "1", { requestId: randomUUID(), requestId2: changingRequest.id, decision: "REJECT", reason: "رفض بعد مراجعة" }, today);
    // An intervening direct opening is not a decision on the pending request.
    await admin.query("UPDATE public.branches SET is_active=true WHERE id=90");
    const competingRequest = await requestCustody(db, "91", { requestId: randomUUID(), amount: "10", reason: "طلب اصطناعي متعارض" });
    const competingAccount = await openAccount(db, "1", { requestId: randomUUID(), branchId: "90", kind: "CUSTODY", holderId: "91", openingAmount: "0", openingDate: today, counted: true }, today);
    const competingApproval = { requestId: randomUUID(), requestId2: competingRequest.id, decision: "APPROVE", reason: "اعتماد اصطناعي", openingDate: today, counted: true, expectedSnapshot: await custodySnapshot(competingRequest.id) };
    await assert.rejects(() => decideCustodyRequest(db, "1", competingApproval, today), /سواء كانت مفتوحة أو مقفلة/);
    assert.equal((await admin.query<{ status: string }>("SELECT status FROM finance.custody_requests WHERE id=$1::bigint", [competingRequest.id])).rows[0].status, "PENDING");
    await decideCustodyRequest(db, "1", { requestId: randomUUID(), requestId2: competingRequest.id, decision: "REJECT", reason: "فتح مباشر" }, today);
    await closeAccount(db, "1", { requestId: randomUUID(), accountId: competingAccount.id, reason: "إقفال اصطناعي" });
    const closedRequest = await requestCustody(db, "91", { requestId: randomUUID(), amount: "10", reason: "طلب بعد إقفال" });
    const closedRequestSnapshot = await custodySnapshot(closedRequest.id);
    await assert.rejects(() => decideCustodyRequest(db, "1", { ...competingApproval, requestId: randomUUID(), requestId2: closedRequest.id, expectedSnapshot: closedRequestSnapshot }, today), /سواء كانت مفتوحة أو مقفلة/);
    assert.equal((await admin.query<{ status: string }>("SELECT status FROM finance.custody_requests WHERE id=$1::bigint", [closedRequest.id])).rows[0].status, "PENDING");
    await decideCustodyRequest(db, "1", { requestId: randomUUID(), requestId2: closedRequest.id, decision: "REJECT", reason: "مراجعة السجل المقفل" }, today);

    // A synthetic external user transfer races a directed count. The normal
    // directory service forbids moving an open holder; this models a bypass.
    await admin.query(`INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT 92,90,role_code,'موظف جرد اصطناعي','pg-count-scope@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3`);
    const scopeAccount = await openAccount(db, "1", { requestId: randomUUID(), branchId: "90", kind: "CUSTODY", holderId: "92", openingAmount: "0", openingDate: today, counted: true }, today);
    const scopeCount = await requestCountFromHolder(db, "1", { requestId: randomUUID(), accountId: scopeAccount.id, reason: "جرد نطاق اصطناعي" });
    const moveCountGate = gate();
    const externalMove = prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe("UPDATE public.users SET branch_id=1 WHERE id=92");
      moveCountGate.signal(); await moveCountGate.wait;
    }, { isolationLevel: "Serializable", timeout: 20000 });
    await moveCountGate.entered;
    const movedHolderCount = submitHolderCount(db, "92", { requestId: randomUUID(), countId: scopeCount.id, countedAmount: "0", actuallyCounted: true });
    try { await waitForLock(admin, "users"); } finally { moveCountGate.release(); }
    await externalMove;
    await  assert.rejects(movedHolderCount, /عهدتك في فرعك الحالي/);
    assert.equal((await admin.query<{ counter: string | null }>("SELECT counter_id::text AS counter FROM finance.cash_counts WHERE id=$1::bigint", [scopeCount.id])).rows[0].counter, null);
    await admin.query("INSERT INTO finance.accounts(branch_id,kind,holder_id,opening_amount,opening_date,opened_by) VALUES(1,'CUSTODY',92,0,CURRENT_DATE,1)");
    assert.equal((await settlementOverview(db, "1", scopeAccount.id)).multipleCustodies, true);
    assert.equal((await admin.query<{ flag: boolean }>(`SELECT multiple_custodies AS flag FROM (${CUSTODY_EXPECTATION_SQL}) x WHERE x.id=$2::bigint`, ["90",scopeAccount.id])).rows[0].flag, true);
    const blockedDuplicate = /أكثر من عهدة مفتوحة لصاحب الحساب/;
    await assert.rejects(() => requestCountFromHolder(db, "1", { requestId: randomUUID(), accountId: scopeAccount.id, reason: "جرد متعارض" }), blockedDuplicate);
    await cancelCashCount(db, "1", { requestId: randomUUID(), countId: scopeCount.id, reason: "مراجعة التعارض" });
    await assert.rejects(() => closeAccount(db, "1", { requestId: randomUUID(), accountId: scopeAccount.id, reason: "إقفال متعارض" }), blockedDuplicate);
    await assert.rejects(() => requestSettlement(db, "1", { requestId: randomUUID(), accountId: scopeAccount.id, countedAmount: "0", expectedBalance: "0", reason: "تسوية متعارضة", actuallyCounted: true }), blockedDuplicate);

    // A pending request may be rejected, but cannot open an account in the
    // old branch after its holder has moved or been suspended.
    for (const [id, newBranch, status] of [[12n, 2n, "ACTIVE"], [13n, 1n, "SUSPENDED"]] as const) {
      const request = await requestCustody(db, String(id), { requestId: randomUUID(), amount: "10", reason: "طلب اصطناعي" });
      await updateDirectoryUser(prisma, await inputUser(id, newBranch, status));
      const decision = (decision: "APPROVE" | "REJECT") => ({ requestId: randomUUID(), requestId2: request.id, decision, reason: "قرار اصطناعي", openingDate: today, counted: true });
      await assert.rejects(decideCustodyRequest(db, "1", decision("APPROVE"), today), /مقدم الطلب غير نشط أو لم يعد في فرع الطلب/);
      assert.equal((await admin.query<{ status: string }>("SELECT status FROM finance.custody_requests WHERE id=$1::bigint", [request.id])).rows[0].status, "PENDING");
      await decideCustodyRequest(db, "1", decision("REJECT"), today);
    }

    const decide = (id: string, expectedSnapshot: string) => ({ requestId: randomUUID(), requestId2: id, decision: "APPROVE", reason: "اعتماد اصطناعي", openingDate: today, counted: true, expectedSnapshot });
    const req14 = await requestCustody(db, "14", { requestId: randomUUID(), amount: "10", reason: "طلب اصطناعي" });
    const snapshot14 = await custodySnapshot(req14.id);
    const approvalGate = gate();
    const approvalFirst = decideCustodyRequest(gatedFinance(prisma, approvalGate, "FROM public.users\n      WHERE id=$1::bigint AND branch_id=$2::bigint"), "1", decide(req14.id, snapshot14), today);
    await approvalGate.entered;
    const moveAfterApproval = updateDirectoryUser(prisma, await inputUser(14n, 2n));
    try { await waitForLock(admin, "users"); } finally { approvalGate.release(); }
    await approvalFirst;
    await assert.rejects(moveAfterApproval, /عهدة نقدية مفتوحة/);
    assert.equal((await expectedUser(14n)).branchId, 1n);

    const req15 = await requestCustody(db, "15", { requestId: randomUUID(), amount: "10", reason: "طلب اصطناعي" });
    const snapshot15 = await custodySnapshot(req15.id);
    const suspendGate = gate();
    const suspensionFirst = updateDirectoryUser(interceptedDirectory(prisma, "FROM public.users WHERE id=$1::bigint FOR UPDATE", suspendGate), await inputUser(15n, 1n, "SUSPENDED"));
    await suspendGate.entered;
    const approvalAfterSuspension = decideCustodyRequest(db, "1", decide(req15.id, snapshot15), today);
    try { await waitForLock(admin, "users"); } finally { suspendGate.release(); }
    await suspensionFirst;
    await assert.rejects(approvalAfterSuspension, /مقدم الطلب غير نشط أو لم يعد في فرع الطلب/);
    assert.equal((await admin.query<{ status: string }>("SELECT status FROM finance.custody_requests WHERE id=$1::bigint", [req15.id])).rows[0].status, "PENDING");

    // The local status command delegates to this service. With no flag it
    // still observes an installed finance schema and serializes with opening.
    await admin.query(`INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT n,1,role_code,'موظف حالة اصطناعي '||n,'pg-status-'||n||'@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users CROSS JOIN generate_series(23,24) n WHERE id=3`);
    for (const id of [23n,24n]) await prisma.authSession.create({ data: { id: randomUUID(), userId: id, expiresAt: new Date(Date.now()+3_600_000) } });
    const cliOpenGate = gate();
    const cliOpeningFirst = openAccount(gatedFinance(prisma, cliOpenGate, "FROM public.users WHERE id=$1::bigint AND branch_id=$2::bigint"), "1", openInput("23"), today);
    await cliOpenGate.entered;
    const cliBlockedSuspend = setDirectoryUserStatus(prisma, "pg-status-23@selahtone.local", "SUSPENDED", false);
    try { await waitForLock(admin, "users"); } finally { cliOpenGate.release(); }
    await cliOpeningFirst;
    await assert.rejects(cliBlockedSuspend, /عهدة نقدية مفتوحة/);
    assert.equal((await expectedUser(23n)).status, "ACTIVE");
    assert.equal(await prisma.authSession.count({ where: { userId: 23n } }), 1);

    const cliSuspendGate = gate();
    const cliSuspendFirst = setDirectoryUserStatus(interceptedDirectory(prisma, "FROM public.users WHERE id=$1::bigint FOR UPDATE", cliSuspendGate), "pg-status-24@selahtone.local", "SUSPENDED", false);
    await cliSuspendGate.entered;
    const cliBlockedOpen = openAccount(db, "1", openInput("24"), today);
    try { await waitForLock(admin, "users"); } finally { cliSuspendGate.release(); }
    await cliSuspendFirst;
    await assert.rejects(cliBlockedOpen, /الموظف غير نشط أو لا ينتمي إلى الفرع/);
    assert.equal((await expectedUser(24n)).status, "SUSPENDED");
    assert.equal(await prisma.authSession.count({ where: { userId: 24n } }), 0);
    assert.equal((await admin.query<{ n: string }>("SELECT count(*)::text AS n FROM finance.accounts WHERE kind='CUSTODY' AND holder_id=24")).rows[0].n, "0");

    // Flag off does not bypass branch protection when finance tables exist.
    // This deliberately creates a legacy-style suspended holder with an open
    // custody, without executing a real-data state change.
    await admin.query(`INSERT INTO branches (id,code,name_ar,invoice_prefix,opening_date,is_active,created_at) VALUES (4,'TST','فرع اصطناعي','TST',CURRENT_DATE,true,now());
      INSERT INTO warehouses (id,branch_id,code,name_ar,is_default,holds_stock,is_active) VALUES (4,4,'TST-W1','مستودع اصطناعي',true,true,true);
      INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT 31,4,role_code,'موظف فرع اصطناعي','pg-disabled-branch@selahtone.local',password_hash,'SUSPENDED',false,'FULL',false,now() FROM users WHERE id=3;
      INSERT INTO finance.accounts(branch_id,kind,holder_id,opening_amount,opening_date,opened_by) VALUES(4,'CUSTODY',31,0,CURRENT_DATE,1)`);
    const branchCustody = (await admin.query<{ id: string }>("SELECT id::text AS id FROM finance.accounts WHERE holder_id=31")).rows[0].id;
    await assert.rejects(() => setDirectoryBranchActive(prisma!, 4n, false, false), /عهدة نقدية مفتوحة/);
    await assert.rejects(() => setDirectoryBranchActive(interceptedDirectory(prisma!, "to_regclass('finance.accounts')", undefined, true), 4n, false, false), /تعذّر التحقق من جاهزية المالية/);
    await assert.rejects(() => setDirectoryBranchActive(interceptedDirectory(prisma!, "FROM finance.accounts", undefined, true), 4n, false, false), /تعذّر التحقق من العهد/);
    assert.equal((await prisma.branch.findUniqueOrThrow({ where: { id: 4n } })).isActive, true);
    assert.equal((await prisma.warehouse.findUniqueOrThrow({ where: { id: 4n } })).isActive, true);
    await closeAccount(db, "1", { requestId: randomUUID(), accountId: branchCustody, reason: "إقفال تجريبي" });
    await setDirectoryBranchActive(prisma, 4n, false, false);
    assert.equal((await prisma.warehouse.findUniqueOrThrow({ where: { id: 4n } })).isActive, false);
    await setDirectoryBranchActive(prisma, 4n, true, false);

    // Branch shutdown owns the branch lock; an attempted user creation must
    // observe the new inactive state after retry rather than write behind it.
    const branchGate = gate();
    const shutting = setDirectoryBranchActive(interceptedDirectory(prisma, "FROM public.branches WHERE id=$1::bigint FOR UPDATE", branchGate), 3n, false, true);
    await branchGate.entered;
    const creating = createDirectoryUser(prisma, { fullName: "موظف فرع اصطناعي", email: "new-directory@selahtone.local", phone: null, roleCode: "CS_AGENT", branchId: 3n, status: "ACTIVE", passwordHash: "synthetic", mustChangePassword: true });
    try { await waitForLock(admin, "branches"); } finally { branchGate.release(); }
    await shutting;
    await assert.rejects(creating, /الفرع المختار غير موجود أو غير نشط/);
    assert.equal(await prisma.user.count({ where: { email: "new-directory@selahtone.local" } }), 0);
    await setDirectoryBranchActive(prisma, 3n, true, true);
    await admin.query("SELECT setval(pg_get_serial_sequence('public.users','id'),100)");
    const createGate = gate();
    const createdFirst = createDirectoryUser(interceptedDirectory(prisma, "FROM public.branches WHERE id=$1::bigint FOR SHARE", createGate), { fullName: "موظف فرع اصطناعي", email: "first-directory@selahtone.local", phone: null, roleCode: "CS_AGENT", branchId: 3n, status: "ACTIVE", passwordHash: "synthetic", mustChangePassword: true });
    await createGate.entered;
    const blockedShutdown = setDirectoryBranchActive(prisma, 3n, false, true);
    try { await waitForLock(admin, "branches"); } finally { createGate.release(); }
    await createdFirst;
    await assert.rejects(blockedShutdown, /انقل الموظفين النشطين/);
    assert.equal((await prisma.branch.findUniqueOrThrow({ where: { id: 3n } })).isActive, true);

    // Index replacement is deliberately test-only and requires opt-in; this
    // is not the schema used by the deployed application.
    await admin.query("SET selahtone.custody_reopen_test_only='yes'");
    await admin.query(read("prototypes/finance-custody-reopen/index.test-only.sql"));
    await admin.query(`INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT n,1,role_code,'موظف إعادة فتح اصطناعي '||n,'pg-reopen-'||n||'@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users CROSS JOIN generate_series(21,22) n WHERE id=3`);
    const openFor = (holder: string) => ({ requestId: randomUUID(), branchId: "1", kind: "CUSTODY", holderId: holder, openingAmount: "0", openingDate: today, counted: true });
    const old21 = await openAccount(db, "1", openFor("21"), today);
    await closeAccount(db, "1", { requestId: randomUUID(), accountId: old21.id, reason: "إقفال اصطناعي" });
    const duplicateGate = gate();
    const delayedOpen = openAccount(gatedFinance(prisma, duplicateGate, "FROM public.users WHERE id=$1::bigint AND branch_id=$2::bigint"), "1", openFor("21"), today);
    await duplicateGate.entered;
    const winningInput = openFor("21");
    const winner = await openAccount(db, "1", winningInput, today);
    duplicateGate.release();
    await assert.rejects(delayedOpen, /مسجّل بالفعل/);
    assert.equal((await openAccount(db, "1", winningInput, today)).id, winner.id);
    assert.equal((await admin.query<{ n: string }>("SELECT count(*)::text AS n FROM finance.accounts WHERE holder_id=21 AND kind='CUSTODY' AND closed_at IS NULL")).rows[0].n, "1");

    const closeFirstGate = gate();
    const closeWinning = closeAccount(gatedFinance(prisma, closeFirstGate, "UPDATE finance.accounts SET closed_at=CURRENT_TIMESTAMP"), "1", { requestId: randomUUID(), accountId: winner.id, reason: "إقفال متزامن" });
    await closeFirstGate.entered;
    const replacementAfterClose = openAccount(db, "1", openFor("21"), today);
    try { await waitForLock(admin, "accounts"); } finally { closeFirstGate.release(); }
    await closeWinning;
    const latest21 = await replacementAfterClose;
    assert.notEqual(latest21.id, winner.id);
    assert.equal((await admin.query<{ n: string }>("SELECT count(*)::text AS n FROM finance.accounts WHERE holder_id=21 AND kind='CUSTODY' AND closed_at IS NULL")).rows[0].n, "1");

    // Isolate the timestamp assumption from the finance engine: a serializable
    // transaction can start and take a snapshot, then insert after a different
    // transaction closes the old row, without necessarily being retried. The
    // partial index enforces uniqueness, not chronological transaction times.
    await admin.query(`CREATE TABLE synthetic_reopen_clock (id integer PRIMARY KEY, holder integer NOT NULL, opened_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP, closed_at timestamptz);
      CREATE UNIQUE INDEX synthetic_reopen_clock_open ON synthetic_reopen_clock(holder) WHERE closed_at IS NULL;
      INSERT INTO synthetic_reopen_clock(id,holder) VALUES (1,1)`);
    const clockOpener = new Client(config);
    try {
      await clockOpener.connect();
      await clockOpener.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      // Establish a snapshot without reading the account table; this is a
      // minimal counterexample, not a reproduction of all engine queries.
      await clockOpener.query("SELECT CURRENT_TIMESTAMP");
      await admin.query("UPDATE synthetic_reopen_clock SET closed_at=clock_timestamp() WHERE id=1");
      await clockOpener.query("INSERT INTO synthetic_reopen_clock(id,holder) VALUES (2,1)");
      await clockOpener.query("COMMIT");
      const clock = await admin.query<{ ordered: boolean }>(`SELECT n.opened_at >= o.closed_at AS ordered FROM synthetic_reopen_clock n, synthetic_reopen_clock o WHERE n.id=2 AND o.id=1`);
      assert.equal(clock.rows[0].ordered, false, "partial uniqueness and SERIALIZABLE do not by themselves order transaction timestamps");
    } finally {
      await clockOpener.end();
      await admin.query("DROP TABLE synthetic_reopen_clock");
    }

    // Start a replacement-opening transaction BEFORE old cash/settlement/close,
    // but pause before its insert. Its start timestamp is not a safe cutoff if
    // a stale SERIALIZABLE transaction can commit without a retry.
    const old22 = await openAccount(db, "1", openFor("22"), today);
    const sale22 = (await admin.query<{ id: string }>(`INSERT INTO commerce_sales(request_id,request_hash,branch_id,warehouse_id,customer_name,customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,created_by_id)
      SELECT $1::uuid,repeat('a',64),branch_id,warehouse_id,'فتح عهدة اصطناعي',customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,22 FROM commerce_sales WHERE id=2 RETURNING id::text`, [randomUUID()])).rows[0].id;
    const reopenGate = gate(); let reopenAttempts = 0, reopenPaused = false;
    const reopenTrace: Array<{ attempt: number; transactionStart: string; observedAt: string; snapshot: string }> = [];
    const trackedReopen: FinanceDatabase = { serializable: work => {
      const attempt = ++reopenAttempts;
      return prisma!.$transaction(async tx => {
        const port = financePort(tx);
        const wrapped: FinanceTransaction = { ...port, query: async <T extends Record<string, unknown>>(sql: string, params?: unknown[]) => {
          const result = await port.query<T>(sql, params);
          if (sql.includes("FROM public.users WHERE id=$1::bigint AND branch_id=$2::bigint")) {
            const trace = await port.query<{ transactionStart: string; observedAt: string; snapshot: string }>(`SELECT CURRENT_TIMESTAMP::text AS "transactionStart", clock_timestamp()::text AS "observedAt", pg_current_snapshot()::text AS snapshot`);
            reopenTrace.push({ attempt, ...trace.rows[0] });
            if (!reopenPaused) { reopenPaused = true; reopenGate.signal(); await reopenGate.wait; }
          }
          return result;
        } };
        return work(wrapped);
      }, { isolationLevel: "Serializable", timeout: 20000 });
    } };
    const pendingReopen = openAccount(trackedReopen, "1", openFor("22"), today);
    await reopenGate.entered;
    let new22;
    try {
      await recordCommerceCollection(prisma, 22n, { requestId: randomUUID(), saleId: sale22, amount: "5", method: "CASH", actuallyPaid: false });
      const settlement22 = await requestSettlement(db, "22", { requestId: randomUUID(), accountId: old22.id, expectedBalance: "0", countedAmount: "5", reason: "تسوية قبل إعادة الفتح", actuallyCounted: true });
      await confirmSettlement(db, "1", { requestId: randomUUID(), settlementId: settlement22.id, expectedBalance: "0", transferAmount: "5", transferDirection: "TO_VAULT", reason: "اعتماد قبل الإقفال", actuallyTransferred: true });
      await closeAccount(db, "1", { requestId: randomUUID(), accountId: old22.id, reason: "إقفال قبل إعادة الفتح" });
    } finally { reopenGate.release(); }
    new22 = await pendingReopen;
    const times22 = (await admin.query<{ ordered: boolean; openedAt: string; closedAt: string }>(`SELECT n.opened_at >= o.closed_at AS ordered, n.opened_at::text AS "openedAt", o.closed_at::text AS "closedAt" FROM finance.accounts n,finance.accounts o WHERE n.id=$1::bigint AND o.id=$2::bigint`, [new22.id,old22.id])).rows[0];
    const reopenDiagnostic = JSON.stringify({ attempts: reopenAttempts, times: times22, trace: reopenTrace });
    assert.ok(reopenAttempts >= 2, `stale replacement transaction must be retried in this tested interleaving: ${reopenDiagnostic}`);
    assert.ok(times22.ordered, `replacement opening must not predate closure: ${reopenDiagnostic}`);
    assert.equal((await settlementOverview(db, "22", new22.id)).sales, "0.00");

    // Test-only alternative: predecessor row locks and an explicit transaction
    // time comparison. No implication that this handles all writers or history.
    await admin.query(`INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT 96,1,role_code,'موظف حد اصطناعي','pg-reopen-boundary@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3`);
    const previous96=await openAccount(db,"1",openFor("96"),today);
    // Start the opening transaction but deliberately postpone its first SQL
    // statement: its snapshot can see the closure while CURRENT_TIMESTAMP
    // remains the older transaction-start time.
    const beforeSnapshot=gate();
    const delayedSnapshot:FinanceDatabase={serializable:work=>prisma!.$transaction(async tx=>{
      await tx.$queryRawUnsafe("SELECT CURRENT_TIMESTAMP");
      beforeSnapshot.signal();await beforeSnapshot.wait;
      return work(financePort(tx));
    },{isolationLevel:"ReadCommitted",timeout:20000})};
    // READ COMMITTED is deliberate here: PostgreSQL's serializable snapshot is
    // established by the timestamp query, so a separate experiment is needed
    // to isolate a later statement snapshot with an older transaction clock.
    const deniedInput=openFor("96");
    const denied= openAccount(guardSyntheticReplacementOpen(delayedSnapshot),"1",deniedInput,today).then(value=>({value}),error=>({error}));
    await beforeSnapshot.entered;
    try {await closeAccount(db,"1",{requestId:randomUUID(),accountId:previous96.id,reason:"إقفال حد اصطناعي"});} finally {beforeSnapshot.release();}
    const deniedResult=await denied;
    assert.ok("error" in deniedResult);assert.match(String(deniedResult.error),/تعذر إثبات حد زمني/);
    assert.equal((await admin.query<{n:number}>("SELECT count(*)::int AS n FROM finance.requests WHERE request_id=$1::uuid",[deniedInput.requestId])).rows[0].n,0);
    const safe96=await openAccount(guardSyntheticReplacementOpen(db),"1",deniedInput,today);
    assert.equal(safe96.replayed,false);
    assert.equal((await admin.query<{ordered:boolean}>("SELECT n.opened_at>o.closed_at AS ordered FROM finance.accounts n,finance.accounts o WHERE n.id=$1::bigint AND o.id=$2::bigint",[safe96.id,previous96.id])).rows[0].ordered,true);
    assert.deepEqual(await openAccount(guardSyntheticReplacementOpen(db),"1",deniedInput,today),{id:safe96.id,replayed:true});
    await admin.query(`INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT 97,1,role_code,'موظف لقطة اصطناعي','pg-reopen-snapshot@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3`);
    const previous97=await openAccount(db,"1",openFor("97"),today);
    const snapshotGate=gate();let guardedAttempts=0;
    const underlyingGuard=gatedFinance(prisma,snapshotGate,"FROM public.users WHERE id=$1::bigint AND branch_id=$2::bigint");
    const measuredGuard:FinanceDatabase={serializable:work=>{guardedAttempts++;return underlyingGuard.serializable(work);}};
    const guardedInput=openFor("97");
    const guardedOpen=openAccount(guardSyntheticReplacementOpen(measuredGuard),"1",guardedInput,today);
    await snapshotGate.entered;
    try {await closeAccount(db,"1",{requestId:randomUUID(),accountId:previous97.id,reason:"إقفال لقطة اصطناعي"});} finally {snapshotGate.release();}
    const guardedNew=await guardedOpen;
    assert.ok(guardedAttempts>=2,"the stale locked-predecessor snapshot must abort and retry in this schedule");
    assert.equal((await admin.query<{ordered:boolean}>("SELECT n.opened_at>o.closed_at AS ordered FROM finance.accounts n,finance.accounts o WHERE n.id=$1::bigint AND o.id=$2::bigint",[guardedNew.id,previous97.id])).rows[0].ordered,true);
    assert.deepEqual(await openAccount(guardSyntheticReplacementOpen(db),"1",guardedInput,today),{id:guardedNew.id,replayed:true});

    // Counterexample to the proposed timestamp guard: a close transaction can
    // start first but commit last. A direct, uncoordinated source writer then
    // commits after opening's transaction clock and before the close commits.
    // READ COMMITTED here intentionally exposes a newer statement snapshot.
    await admin.query(`INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
      SELECT 98,1,role_code,'موظف ترتيب اصطناعي','pg-reopen-commit-order@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3`);
    const previous98=await openAccount(db,"1",openFor("98"),today);
    const sale98=(await admin.query<{id:string}>(`INSERT INTO commerce_sales(request_id,request_hash,branch_id,warehouse_id,customer_name,customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,created_by_id)
      SELECT $1::uuid,repeat('b',64),branch_id,warehouse_id,'تداخل حد اصطناعي',customer_phone,subtotal,discount,taxable_base,tax_total,total,revision,98 FROM commerce_sales WHERE id=2 RETURNING id::text`,[randomUUID()])).rows[0].id;
    const olderCloseGate=gate();
    const close98=closeAccount(gatedFinance(prisma,olderCloseGate,"UPDATE finance.accounts SET closed_at=CURRENT_TIMESTAMP"),"1",{requestId:randomUUID(),accountId:previous98.id,reason:"إقفال طويل اصطناعي"});
    await olderCloseGate.entered;
    const laterOpenGate=gate();
    const laterSnapshot:FinanceDatabase={serializable:work=>prisma!.$transaction(async tx=>{
      await tx.$queryRawUnsafe("SELECT CURRENT_TIMESTAMP");
      laterOpenGate.signal();await laterOpenGate.wait;
      return work(financePort(tx));
    },{isolationLevel:"ReadCommitted",timeout:20000})};
    const earlyClockOpen=openAccount(guardSyntheticReplacementOpen(laterSnapshot),"1",openFor("98"),today);
    await laterOpenGate.entered;
    let bypassCollection:string;
    try {
      bypassCollection=(await admin.query<{id:string}>(`INSERT INTO commerce_collections(request_id,request_hash,sale_id,amount,method,is_initial,created_by_id)
        VALUES($1::uuid,repeat('c',64),$2::bigint,5,'CASH',false,98) RETURNING id::text`,[randomUUID(),sale98])).rows[0].id;
    } finally {olderCloseGate.release();}
    try {await close98;} finally {laterOpenGate.release();}
    const unsafe98=await earlyClockOpen;
    const boundary98=(await admin.query<{ordered:boolean;sourceAfterOpen:boolean}>(`SELECT n.opened_at>o.closed_at AS ordered,c.created_at>n.opened_at AS "sourceAfterOpen"
      FROM finance.accounts n,finance.accounts o,commerce_collections c WHERE n.id=$1::bigint AND o.id=$2::bigint AND c.id=$3::bigint`,[unsafe98.id,previous98.id,bypassCollection!])).rows[0];
    assert.deepEqual(boundary98,{ordered:true,sourceAfterOpen:true});
    assert.equal((await settlementOverview(db,"98",unsafe98.id)).sales,"5.00");

    // A separate disposable database exercises the proposed invariant without
    // changing any of the preceding experiments or an existing database.
    await admin.query('CREATE DATABASE synthetic_custody_uniqueness');
    const uniqueConfig = { ...config, database: "synthetic_custody_uniqueness" };
    const uniqueAdmin = new Client(uniqueConfig), writerA = new Client(uniqueConfig), writerB = new Client(uniqueConfig);
    try {
      await uniqueAdmin.connect(); await writerA.connect(); await writerB.connect();
      await uniqueAdmin.query(buildDdl());
      await uniqueAdmin.query(read("scripts/local-pglite-seed.sql").replaceAll("__PREVIEW_BCRYPT__", "synthetic"));
      await uniqueAdmin.query("SET selahtone.finance_release_candidate_test_only='yes'");
      for (const f of ["prototypes/finance-release/release-candidate.test-only.sql", "prisma/manual-settlement-upgrade.sql", "prisma/manual-custody-closure-upgrade.sql"]) await uniqueAdmin.query(read(f));
      const uniqueScript = read("prototypes/finance-custody-uniqueness/index.test-only.sql");
      await assert.rejects(() => uniqueAdmin.query(uniqueScript), /requires explicit opt-in/); await uniqueAdmin.query("ROLLBACK");
      await uniqueAdmin.query("SET selahtone.custody_uniqueness_test_only='yes'");
      await uniqueAdmin.query(`INSERT INTO finance.accounts(branch_id,kind,holder_id,opening_amount,opening_date,opened_by)
        VALUES (1,'CUSTODY',3,0,CURRENT_DATE,1),(2,'CUSTODY',3,0,CURRENT_DATE,1)`);
      await uniqueAdmin.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      await uniqueAdmin.query("SET LOCAL selahtone.custody_uniqueness_test_only='yes'");
      const auditPort: FinanceTransaction = { query: async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => ({ rows: (await uniqueAdmin.query(sql, params)).rows as T[] }) };
      const auditFirst = await auditSyntheticOpenCustodies(auditPort, "0", 1);
      assert.equal(auditFirst.rows[0].anotherOpenCustody, true);
      assert.ok(auditFirst.nextAfterId);
      const auditSecond = await auditSyntheticOpenCustodies(auditPort, auditFirst.nextAfterId!, 1);
      assert.equal(auditSecond.rows[0].anotherOpenCustody, true);
      assert.equal(auditSecond.nextAfterId, null);
      assert.notEqual(auditFirst.rows[0].branchMismatch, auditSecond.rows[0].branchMismatch);
      await assert.rejects(() => uniqueAdmin.query("UPDATE finance.accounts SET closed_at=now()"), /read.only/i);
      await uniqueAdmin.query("ROLLBACK");
      await assert.rejects(() => uniqueAdmin.query(uniqueScript), /multiple open custodies/); await uniqueAdmin.query("ROLLBACK");
      assert.equal((await uniqueAdmin.query<{ n: string }>("SELECT count(*)::text AS n FROM finance.accounts WHERE holder_id=3")).rows[0].n, "2");
      assert.equal((await uniqueAdmin.query<{ ok: boolean }>("SELECT to_regclass('finance.finance_one_open_custody_per_holder_test_only') IS NOT NULL AS ok")).rows[0].ok, false);
      await uniqueAdmin.query("DELETE FROM finance.accounts WHERE holder_id=3"); // synthetic setup only
      // Reproduce the previously unproven limitation: an outside writer that
      // does not participate in the app protocol commits after the duplicate
      // check but before closure. This tests a defect, not an allowed workflow.
      await uniqueAdmin.query(`INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
        SELECT 93,1,role_code,'كاتب اصطناعي','race-gap@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3`);
      const oldAccount = (await uniqueAdmin.query<{ id: string }>(`INSERT INTO finance.accounts(branch_id,kind,holder_id,opening_amount,opening_date,opened_by)
        VALUES(1,'CUSTODY',93,0,CURRENT_DATE,1) RETURNING id::text AS id`)).rows[0].id;
      const syntheticClient = new WasmClient({ adapter: new PrismaPg(uniqueConfig) });
      try {
        const gapGate = gate();
        const closing = closeAccount(gatedFinance(syntheticClient, gapGate, "SELECT EXISTS (SELECT 1 FROM finance.accounts"), "1", { requestId: randomUUID(), accountId: oldAccount, reason: "إقفال اصطناعي لفحص السباق" });
        await gapGate.entered;
        try { await uniqueAdmin.query(`INSERT INTO finance.accounts(branch_id,kind,holder_id,opening_amount,opening_date,opened_by) VALUES(2,'CUSTODY',93,0,CURRENT_DATE,1)`); }
        finally { gapGate.release(); }
        await closing;
        assert.equal((await uniqueAdmin.query<{ closed: boolean }>("SELECT closed_at IS NOT NULL AS closed FROM finance.accounts WHERE id=$1::bigint", [oldAccount])).rows[0].closed, true, "the current application guard alone can close after a racing external insert");
      } finally { await syntheticClient.$disconnect(); }
      await uniqueAdmin.query("DELETE FROM finance.accounts WHERE holder_id=93"); // disposable scenario teardown only

      // Explore CONCURRENTLY separately; it cannot be inside the test-only
      // migration transaction and its failure can leave an invalid index.
      await writerA.query("BEGIN");
      await writerA.query(`INSERT INTO finance.accounts(branch_id,kind,holder_id,opening_amount,opening_date,opened_by)
        VALUES (1,'CUSTODY',3,0,CURRENT_DATE,1),(2,'CUSTODY',3,0,CURRENT_DATE,1)`);
      const concurrentBuild = uniqueAdmin.query(`CREATE UNIQUE INDEX CONCURRENTLY finance_one_open_custody_concurrent_test_only
        ON finance.accounts(holder_id) WHERE kind='CUSTODY' AND closed_at IS NULL`)
        .then(() => ({ code: "success" }), e => ({ code: String(e.code) }));
      try { await waitForLock(writerB, "accounts"); } finally { await writerA.query("COMMIT"); }
      assert.deepEqual(await concurrentBuild, { code: "23505" });
      const invalid = (await uniqueAdmin.query<{ valid: boolean; ready: boolean }>(`SELECT i.indisvalid AS valid,i.indisready AS ready
        FROM pg_index i WHERE i.indexrelid=to_regclass('finance.finance_one_open_custody_concurrent_test_only')`)).rows;
      assert.equal(invalid.length, 1);
      assert.equal(invalid[0].valid, false);
      assert.equal(invalid[0].ready, false, "this failed build stopped before the index became ready");
      // A read-only catalog observer reports the leftover; it does not decide
      // that another index is correct, or repair/drop anything.
      await uniqueAdmin.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      await uniqueAdmin.query("SET LOCAL selahtone.custody_uniqueness_test_only='yes'");
      const indexPort: FinanceTransaction = { query: async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => ({ rows: (await uniqueAdmin.query(sql, params)).rows as T[] }) };
      await assert.rejects(() => observeSyntheticAccountIndexes(indexPort, "-1", 2), /cursor/);
      const indexRows = []; let indexCursor: string | null = "0";
      while (indexCursor !== null) { const page = await observeSyntheticAccountIndexes(indexPort, indexCursor, 1); indexRows.push(...page.rows); indexCursor = page.nextAfterOid; }
      const failedIndex = indexRows.find(row => row.name === "finance_one_open_custody_concurrent_test_only");
      assert.ok(failedIndex); assert.equal(failedIndex.valid, false); assert.equal(failedIndex.ready, false); assert.equal(failedIndex.unique, true);
      assert.match(failedIndex.definition, /CREATE UNIQUE INDEX/); assert.ok(failedIndex.predicate);
      await assert.rejects(() => uniqueAdmin.query("DROP INDEX finance.finance_one_open_custody_concurrent_test_only"), /read.only/i);
      await uniqueAdmin.query("ROLLBACK");
      // IF NOT EXISTS is not a repair: it accepts the leftover index name.
      await uniqueAdmin.query(`CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS finance_one_open_custody_concurrent_test_only
        ON finance.accounts(holder_id) WHERE kind='CUSTODY' AND closed_at IS NULL`);
      assert.equal((await uniqueAdmin.query<{ valid: boolean }>(`SELECT indisvalid AS valid FROM pg_index WHERE indexrelid=to_regclass('finance.finance_one_open_custody_concurrent_test_only')`)).rows[0].valid, false);
      assert.equal((await uniqueAdmin.query<{ n: string }>("SELECT count(*)::text AS n FROM finance.accounts WHERE holder_id=3")).rows[0].n, "2");
      await uniqueAdmin.query("DROP INDEX finance.finance_one_open_custody_concurrent_test_only"); // disposable teardown only
      await uniqueAdmin.query("DELETE FROM finance.accounts WHERE holder_id=3"); // disposable fixture reset only

      // Start an uncommitted duplicate before the actual script. Its preflight
      // cannot see the rows; the ordinary CREATE INDEX must wait for the writer
      // and then reject duplicates instead of reporting a usable index.
      await writerA.query("BEGIN");
      await writerA.query(`INSERT INTO finance.accounts(branch_id,kind,holder_id,opening_amount,opening_date,opened_by)
        VALUES (1,'CUSTODY',3,0,CURRENT_DATE,1),(2,'CUSTODY',3,0,CURRENT_DATE,1)`);
      const building = uniqueAdmin.query(uniqueScript).then(() => ({ code: "success" }), e => ({ code: String(e.code) }));
      try { await waitForLock(writerB, "accounts"); } finally { await writerA.query("COMMIT"); }
      assert.deepEqual(await building, { code: "23505" });
      await uniqueAdmin.query("ROLLBACK");
      assert.equal((await uniqueAdmin.query<{ n: string }>("SELECT count(*)::text AS n FROM finance.accounts WHERE holder_id=3")).rows[0].n, "2");
      assert.equal((await uniqueAdmin.query<{ ok: boolean }>("SELECT to_regclass('finance.finance_one_open_custody_per_holder_test_only') IS NOT NULL AS ok")).rows[0].ok, false);
      await uniqueAdmin.query("DELETE FROM finance.accounts WHERE holder_id=3"); // disposable fixture reset only
      await uniqueAdmin.query(uniqueScript);
      await writerA.query("BEGIN");
      await writerA.query(`INSERT INTO finance.accounts(branch_id,kind,holder_id,opening_amount,opening_date,opened_by) VALUES (1,'CUSTODY',3,0,CURRENT_DATE,1)`);
      const writerBResult = writerB.query(`INSERT INTO finance.accounts(branch_id,kind,holder_id,opening_amount,opening_date,opened_by) VALUES (2,'CUSTODY',3,0,CURRENT_DATE,1)`)
        .then(() => ({ code: "success", constraint: "" }), e => ({ code: String(e.code), constraint: String(e.constraint) }));
      try { await waitForLock(uniqueAdmin, "accounts"); } finally { await writerA.query("COMMIT"); }
      assert.deepEqual(await writerBResult, { code: "23505", constraint: "finance_one_open_custody_per_holder_test_only" });
      assert.equal((await uniqueAdmin.query<{ n: string }>("SELECT count(*)::text AS n FROM finance.accounts WHERE holder_id=3 AND closed_at IS NULL")).rows[0].n, "1");
      assert.equal((await uniqueAdmin.query<{ ok: boolean }>("SELECT to_regclass('finance.finance_custody_per_holder') IS NOT NULL AS ok")).rows[0].ok, true);
    } finally {
      await writerA.query("ROLLBACK").catch(() => {}); await writerB.query("ROLLBACK").catch(() => {});
      await writerA.end().catch(() => {}); await writerB.end().catch(() => {}); await uniqueAdmin.end().catch(() => {});
    }

    // A separate permissive database tests NOT VALID and nullable kind,
    // deliberately unlike the candidate schema. Never connected to real data.
    await admin.query('CREATE DATABASE synthetic_custody_constraints');
    const constraintAdmin = new Client({ ...config, database: "synthetic_custody_constraints" });
    try {
      await constraintAdmin.connect();
      await constraintAdmin.query(`CREATE SCHEMA finance; CREATE TABLE finance.accounts (id bigint PRIMARY KEY,kind text,holder_id bigint);
        INSERT INTO finance.accounts VALUES (1,'CUSTODY',NULL);
        ALTER TABLE finance.accounts ADD CONSTRAINT holder_test CHECK (kind <> 'CUSTODY' OR holder_id IS NOT NULL) NOT VALID`);
      const attempt = await constraintAdmin.query("INSERT INTO finance.accounts VALUES(2,'CUSTODY',NULL)").then(() => "success", e => String(e.code));
      assert.equal(attempt, "23514", "NOT VALID checks still reject new false rows in this test");
      await constraintAdmin.query("INSERT INTO finance.accounts VALUES(3,NULL,NULL)");
      const validate = await constraintAdmin.query("ALTER TABLE finance.accounts VALIDATE CONSTRAINT holder_test").then(() => "success", e => String(e.code));
      assert.equal(validate, "23514");
      await constraintAdmin.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      await constraintAdmin.query("SET LOCAL selahtone.custody_uniqueness_test_only='yes'");
      const constraintPort: FinanceTransaction = { query: async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => ({ rows: (await constraintAdmin.query(sql,params)).rows as T[] }) };
      const observedConstraints = []; let oidCursor: string | null = "0";
      while (oidCursor !== null) { const page = await observeSyntheticAccountConstraints(constraintPort,oidCursor,1); observedConstraints.push(...page.rows); oidCursor=page.nextAfterOid; }
      const check = observedConstraints.find(row => row.name === "holder_test"); assert.ok(check);
      assert.equal(check.validated,false); assert.equal(check.kind,"c"); assert.equal(check.enforced,"true");
      const observedColumns = []; let columnCursor: number | null = 0;
      while (columnCursor !== null) { const page = await observeSyntheticAccountColumns(constraintPort,columnCursor,1); observedColumns.push(...page.rows); columnCursor=page.nextAfterPosition; }
      assert.equal(observedColumns.find(row => row.name === "kind")?.notNull,false);
      await assert.rejects(() => constraintAdmin.query("ALTER TABLE finance.accounts DROP CONSTRAINT holder_test"),/read.only/i);
      await constraintAdmin.query("ROLLBACK");
      assert.equal((await constraintAdmin.query<{ n: string }>("SELECT count(*)::text AS n FROM finance.accounts")).rows[0].n,"2");
    } finally { await constraintAdmin.query("ROLLBACK").catch(() => {}); await constraintAdmin.end().catch(() => {}); }
  } finally {
    if (oldFlag === undefined) delete process.env.FINANCE_ENABLED; else process.env.FINANCE_ENABLED = oldFlag;
    if (oldStockFlag === undefined) delete process.env.SALES_STOCK_DECOUPLED; else process.env.SALES_STOCK_DECOUPLED = oldStockFlag;
    // Release any test-owned locks before waiting for outstanding Prisma work.
    // ROLLBACK is harmless when no explicit admin transaction remains.
    if (admin) await admin.query("ROLLBACK").catch(() => {});
    if (prisma) await prisma.$disconnect(); if (admin) await admin.end();
    if (started) ctl(["-D", data, "-m", "immediate", "-w", "stop"]);
    rmSync(dir, { recursive: true, force: true });
  }
});
