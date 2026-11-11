/**
 * Disposable, fictional cash-decision evidence. Every movement must join to a
 * human-command record, the correct request/result, a prior approval where
 * applicable, and the exact transaction time. Directly injected orphan rows,
 * missing attestations, unreviewed corrections and self-approval are detected.
 * This is not proof of physical cash transfer or production/legacy completeness.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { FinanceDatabase, FinanceTransaction } from "../src/lib/finance/types";
import { auditCashDecisionEvidence, type CashDecisionAudit } from "../prototypes/finance-cash-decision-audit/audit.test-only";
import {
  approveExpense, cancelCashCount, confirmCashCount, confirmPaidExpenseCorrection, confirmSettlement, correctOpeningBalance, createExpense,
  editUnpaidExpense, openAccount, payExpense, requestCashCount,
  recordHistoricalCommerceInTransaction, rejectSettlement, requestPaidExpenseReview, requestSettlement, transferCash,
} from "../src/lib/finance/engine";

const root=process.cwd(),read=(f:string)=>readFileSync(path.join(root,f),"utf8"),req=()=>randomUUID();
function adapter(pg:PGlite):FinanceDatabase {return {serializable:work=>pg.transaction(async tx=>{await tx.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");const port:FinanceTransaction={query:async<T extends Record<string,unknown>>(sql:string,parameters:unknown[]=[])=>({rows:(await tx.query(sql,parameters)).rows as T[]})};return work(port);})};}
const opening=(kind:"VAULT"|"CUSTODY",holderId:string|null,amount:string,branchId="1")=>({requestId:req(),branchId,kind,holderId,openingAmount:amount,openingDate:"2026-10-20",counted:true});
const draft={branchId:"1",categoryId:"1",amount:"80",expenseDate:"2026-10-21",description:"مصروف اصطناعي",beneficiary:"",documentNumber:"",taxAmount:""};
async function fresh():Promise<PGlite>{const pg=new PGlite();for(const f of ["tests/fixtures/inventory-baseline.sql","tests/fixtures/finance-legacy-categories.sql","tests/fixtures/commerce-collections.sql"]){await pg.exec(read(f));}await pg.exec("SET selahtone.finance_release_candidate_test_only='yes'");await pg.exec(read("prototypes/finance-release/release-candidate.test-only.sql"));await pg.exec(read("prisma/manual-settlement-upgrade.sql"));await pg.exec(read("prisma/manual-custody-closure-upgrade.sql"));await pg.exec("ALTER TABLE public.commerce_sales ADD COLUMN created_by_id bigint;ALTER TABLE public.commerce_collections ADD COLUMN created_by_id bigint;ALTER TABLE public.commerce_collections ADD COLUMN request_id uuid;CREATE TABLE public.commerce_refunds(id bigserial PRIMARY KEY,sale_id bigint NOT NULL REFERENCES public.commerce_sales(id),amount numeric(14,2) NOT NULL,method varchar(16) NOT NULL,created_by_id bigint NOT NULL,created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,request_id uuid);INSERT INTO public.users(branch_id,role_code,full_name,email,password_hash,status,must_change_password) VALUES(2,'CS_AGENT','موظف الفرع الثاني','staff2@example.test','fixture','ACTIVE',FALSE)");return pg;}
const audit=async(pg:PGlite):Promise<CashDecisionAudit>=>adapter(pg).serializable(auditCashDecisionEvidence);
const linked=async(pg:PGlite,n:number)=>{const a=await audit(pg);assert.equal(a.movements,n);assert.deepEqual(a.orphans,[],JSON.stringify(a.orphans));assert.equal(a.linked,n);};
const count=async(pg:PGlite)=>Number((await pg.query<{n:number}>("SELECT count(*)::int AS n FROM finance.movements")).rows[0].n);

test("new cash refunds stay blocked before any commerce write while finance is disabled",()=>{
  const source=read("src/lib/commerce-operations.ts"),guard=source.indexOf("الرد النقدي متوقف للمراجعة"),write=source.indexOf("tx.commerceRefund.create");
  assert.ok(guard>=0&&write>guard,"the disabled-finance cash-refund guard must precede the refund write");
  assert.match(read("render.yaml"),/key:\s*FINANCE_ENABLED[\s\S]*?value:\s*["']?false/);
});

test("cash movement evidence: human decisions precede and explain every kind; orphans are detected",{timeout:240_000},async t=>{
  const pg=await fresh();try{
    const db=adapter(pg);
    await openAccount(db,"1",opening("VAULT",null,"10000"),"2026-11-11");await openAccount(db,"1",opening("VAULT",null,"3000","2"),"2026-11-11");await openAccount(db,"1",opening("CUSTODY","3","500"),"2026-11-11");
    const ids=(await pg.query<{id:string}>("SELECT id::text AS id FROM finance.accounts ORDER BY id")).rows.map(row=>row.id),[v1,v2,c1]=ids;
    await t.test("direct transfer and opening correction have exact actor/request/time links",async()=>{
      const tr=await transferCash(db,"1",{requestId:req(),fromId:v1,toId:c1,amount:"200",expectedBalance:"10000",actuallyTransferred:true,negativeAcknowledged:false});
      assert.equal(tr.replayed,false);await linked(pg,1);
      await correctOpeningBalance(db,"1",{requestId:req(),accountId:v1,expectedOpening:"10000",correctedOpening:"10200",expectedBalance:"9800",verifiedOpening:true,noPriorSettlement:true,reason:"تصحيح اصطناعي موثق",negativeAcknowledged:false});
      await linked(pg,2);
    });
    await t.test("expense approval precedes actual payment; non-cash has no cash movement",async()=>{
      const approved=async()=>{const e=await createExpense(db,"1",{...draft,requestId:req()});await editUnpaidExpense(db,"1",{...draft,requestId:req(),expenseId:e.id,expectedRevision:"1",reason:"مراجعة اصطناعية"});await approveExpense(db,"1",{requestId:req(),expenseId:e.id,expectedRevision:"2"});return e.id;};
      const card=await approved();
      await payExpense(db,"1",{requestId:req(),expenseId:card,expectedRevision:"3",method:"CARD",accountId:"",paymentDate:"2026-11-11",actuallyPaid:true,openingOrder:"",includedInOpening:false,afterCountId:"",afterCount:false,expectedBalance:"",negativeAcknowledged:false,source:"ACCOUNT"});
      await linked(pg,2);
      const cash=await approved();
      await payExpense(db,"1",{requestId:req(),expenseId:cash,expectedRevision:"3",method:"CASH",accountId:v1,paymentDate:"2026-11-11",actuallyPaid:true,openingOrder:"",includedInOpening:false,afterCountId:"",afterCount:false,expectedBalance:"10000",negativeAcknowledged:false,source:"ACCOUNT"});
      await linked(pg,3);
    });
    await t.test("actual same-transaction collection links; wallet and non-actual cash do not",async()=>{
      const sale=await pg.query<{id:number}>("INSERT INTO public.commerce_sales(branch_id,created_by_id) VALUES(1,3) RETURNING id");
      await pg.query("INSERT INTO public.commerce_collections(sale_id,amount,method,created_by_id) VALUES($1::bigint,50,'WALLET',3),($1::bigint,60,'CASH',3)",[sale.rows[0].id]);
      let actualCollection="";const collections=await pg.query<{id:number;amount:string}>("SELECT id,amount::text FROM public.commerce_collections ORDER BY id");
      await db.serializable(async tx=>{
        const {postCashCollectionInTransaction}=await import("../src/lib/finance/engine");
        const inserted=await tx.query<{id:number}>("INSERT INTO public.commerce_collections(sale_id,amount,method,created_by_id,request_id) VALUES($1::bigint,40,'CASH',3,$2::uuid) RETURNING id",[sale.rows[0].id,req()]);actualCollection=String(inserted.rows[0].id);await postCashCollectionInTransaction(tx,"3",{branchId:"1",accountId:c1,amount:"40",collectionId:actualCollection});
      });
      await linked(pg,4);
      const before=await count(pg);
      await assert.rejects(()=>db.serializable(tx=>recordHistoricalCommerceInTransaction(tx,"1",{eventType:"COLLECTION",eventId:String(collections.rows[1].id),saleId:String(sale.rows[0].id),branchId:"1",accountId:c1,amount:"60",actualDate:"2026-10-20",checkpointType:"OPENING",checkpointCountId:"",handler:"موظف اصطناعي",reason:"غير مؤكد",verifiedActual:false,beforeCheckpoint:true,includedInCheckpoint:true,notPreviouslyRecorded:true,caseSnapshot:""})));
      assert.equal(await count(pg),before);
      await db.serializable(tx=>recordHistoricalCommerceInTransaction(tx,"1",{eventType:"COLLECTION",eventId:String(collections.rows[0].id),saleId:String(sale.rows[0].id),branchId:"1",accountId:c1,amount:"50",actualDate:"2026-10-20",checkpointType:"OPENING",checkpointCountId:"",handler:"موظف اصطناعي",reason:"تحصيل سابق اصطناعي مؤكد",verifiedActual:true,beforeCheckpoint:true,includedInCheckpoint:true,notPreviouslyRecorded:true,caseSnapshot:""}));
      assert.equal(await count(pg),before);await linked(pg,4);
    });
;
    await t.test("cash-count adjustment requires the confirmed reviewer and reason",async()=>{
      const q=await requestCashCount(db,"1",{requestId:req(),accountId:c1,expectedBalance:"840",countedAmount:"830",reason:"جرد اصطناعي",actuallyCounted:true});
      await confirmCashCount(db,"1",{requestId:req(),countId:String(q.id),expectedBalance:"840",countedAmount:"830",reason:"فرق جرد اصطناعي مقبول",stillCurrent:true});
      await linked(pg,5);
      const q2=await requestCashCount(db,"1",{requestId:req(),accountId:c1,expectedBalance:"830",countedAmount:"830",reason:"جرد اصطناعي",actuallyCounted:true});
      await confirmCashCount(db,"1",{requestId:req(),countId:String(q2.id),expectedBalance:"830",countedAmount:"830",reason:"مطابق",stillCurrent:true});
      await linked(pg,5);
    });
    await t.test("paid-expense review and correction carry their own decision",async()=>{
      const e=await createExpense(db,"1",{...draft,requestId:req()});
      await editUnpaidExpense(db,"1",{...draft,requestId:req(),expenseId:e.id,expectedRevision:"1",reason:"مراجعة اصطناعية"});
      await approveExpense(db,"1",{requestId:req(),expenseId:e.id,expectedRevision:"2"});
      await payExpense(db,"1",{requestId:req(),expenseId:e.id,expectedRevision:"3",method:"CASH",accountId:v1,paymentDate:"2026-11-11",actuallyPaid:true,openingOrder:"",includedInOpening:false,afterCountId:"",afterCount:false,expectedBalance:"9920",negativeAcknowledged:false,source:"ACCOUNT"});
      const r=await requestPaidExpenseReview(db,"1",{requestId:req(),expenseId:e.id,expectedRevision:"4",reason:"تصحيح مبلغ اصطناعي",proposedAmount:"70"});
      await confirmPaidExpenseCorrection(db,"1",{requestId:req(),reviewId:r.id,confirmedAmount:"70",expectedBalance:"9840",reason:"اعتماد تصحيح اصطناعي",verifiedPayment:true,noPriorSettlement:true,negativeAcknowledged:false});
      await linked(pg,7);
    });
    await t.test("settlement: independent confirmation; zero difference and rejection move nothing",async()=>{
      await openAccount(db,"1",opening("CUSTODY","5","0","2"),"2026-11-11");const c2=(await pg.query<{id:string}>("SELECT id::text AS id FROM finance.accounts WHERE holder_id=5")).rows[0].id;
      const s=await requestSettlement(db,"5",{requestId:req(),accountId:c2,countedAmount:"100",expectedBalance:"0",reason:"إغلاق اصطناعي",actuallyCounted:true});
      await confirmSettlement(db,"1",{requestId:req(),settlementId:s.id,expectedBalance:"0",transferAmount:"100",transferDirection:"TO_VAULT",reason:"تسوية اصطناعية معتمدة",actuallyTransferred:true});
      await linked(pg,9);
      const s2=await requestSettlement(db,"5",{requestId:req(),accountId:c2,countedAmount:"0",expectedBalance:"0",reason:"مطابق",actuallyCounted:true});
      await confirmSettlement(db,"1",{requestId:req(),settlementId:s2.id,expectedBalance:"0",transferAmount:"0",transferDirection:"TO_VAULT",reason:"لا فرق",actuallyTransferred:true});
      await linked(pg,9);
      const rejected=await requestSettlement(db,"5",{requestId:req(),accountId:c2,countedAmount:"100",expectedBalance:"0",reason:"طلب مرفوض اصطناعي",actuallyCounted:true});
      await rejectSettlement(db,"1",{requestId:req(),settlementId:rejected.id,reason:"رفض اصطناعي موثق"});
      await linked(pg,9);
      const cancelled=await requestCashCount(db,"1",{requestId:req(),accountId:c2,expectedBalance:"0",countedAmount:"0",reason:"جرد سيُلغى",actuallyCounted:true});
      await cancelCashCount(db,"1",{requestId:req(),countId:cancelled.id,reason:"إلغاء اصطناعي موثق"});
      await linked(pg,9);
    });
    await t.test("tampered links, unapproved records and a raw orphan are all reported",async()=>{
      await pg.query("INSERT INTO finance.movements(kind,amount,branch_id,source_id,destination_id,actor_id) VALUES('TRANSFER',1,1,$1::bigint,$2::bigint,1)",[v1,v2]);
      const a=await audit(pg);assert.equal(a.orphans.length,1);assert.equal(a.orphans[0].kind,"TRANSFER");
      await pg.exec("DELETE FROM finance.movements WHERE amount=1 AND kind='TRANSFER' AND settlement_id IS NULL");
      const rows=await pg.query<{id:number;request_id:string}>("SELECT m.id,r.request_id::text FROM finance.movements m JOIN finance.requests r ON r.result_id=m.id AND r.action='TRANSFER' WHERE m.kind='TRANSFER' AND m.settlement_id IS NULL");
      await pg.query("UPDATE finance.requests SET actor_id=2 WHERE request_id=$1::uuid",[rows.rows[0].request_id]);
      assert.equal((await audit(pg)).orphans.length,1);
      await pg.query("UPDATE finance.requests SET actor_id=1 WHERE request_id=$1::uuid",[rows.rows[0].request_id]);
      await assert.rejects(()=>pg.query("UPDATE finance.payments SET actually_paid=false WHERE id=(SELECT expense_payment_id FROM finance.movements WHERE kind='EXPENSE' LIMIT 1)"),/payments_actually_paid_check/);
      assert.deepEqual((await audit(pg)).orphans,[]);
      await pg.query("UPDATE finance.expenses SET approved_at=(SELECT m.created_at+interval '1 second' FROM finance.movements m JOIN finance.payments p ON p.id=m.expense_payment_id WHERE p.expense_id=finance.expenses.id) WHERE id=(SELECT p.expense_id FROM finance.payments p JOIN finance.movements m ON m.expense_payment_id=p.id LIMIT 1)");
      assert.equal((await audit(pg)).orphans.length,1);
    });
  }finally{await pg.close();}
});


