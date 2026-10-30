import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { FinanceProblem, type FinanceDatabase, type FinanceTransaction } from "../prototypes/finance-engine/types";
import { caseSnapshot } from "../prototypes/finance-engine/validation";
import { addReconciliationNote, closeReconciliationCase, correctOpeningBalance, createReconciliationCase, listAccounts, listReconciliationCases, listReconciliationNotes, openAccount, recordHistoricalCommerceInTransaction, requestCashCount, confirmCashCount } from "../prototypes/finance-engine/engine";

const uid=()=>randomUUID(),today="2026-10-30";
function adapter(pg:PGlite,verifySales=true,failAction?:string):FinanceDatabase { return {serializable:work=>pg.transaction(async tx=>{
 await tx.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
 const q:FinanceTransaction={query:async(sql,params=[])=>{
   if(failAction && sql.includes("INSERT INTO finance_lab.audit_events") && params[0]==="RECON_CASE" && params[2]===failAction) throw Error("injected case audit failure");
   return {rows:(await tx.query(sql,params)).rows as never[]};
 }};
 if(verifySales)q.verifySaleBranch=async(sale,branch)=>{if(!((sale==="101"&&branch==="1")||(sale==="102"&&branch==="2")))throw new FinanceProblem("sale_branch","invoice mismatch")};
 return work(q);
})};}
async function rejected(f:()=>Promise<unknown>,code:string){await assert.rejects(f,(e:unknown)=>e instanceof FinanceProblem&&e.code===code,`expected ${code}`)}

test("case snapshots are canonical, bounded and reject duplicate or malformed entries",()=>{
 assert.equal(caseSnapshot(undefined),"");assert.equal(caseSnapshot("10:2,2:1,1:3"),"1:3,2:1,10:2");
 for(const value of ["1:1,1:2","1:0","-1:2","1:1:3","x:1","1:1,",Array(201).fill("1:1").join(",")]) assert.throws(()=>caseSnapshot(value),FinanceProblem);
});

test("unresolved reconciliation cases are auditable, private and never book money by themselves",{timeout:120_000},async t=>{
 const pg=new PGlite();try{
 await pg.exec("SET selahtone.finance_lab_test_only='yes'");await pg.exec(readFileSync("prototypes/finance-engine/schema.test-only.sql","utf8"));
 await pg.exec(`INSERT INTO finance_lab.branches(id,name_ar,is_active) VALUES(1,'أ',true),(2,'ب',true);
 INSERT INTO finance_lab.users(id,role_code,branch_id,status,full_name) VALUES(1,'MANAGER',NULL,'ACTIVE','مدير'),(2,'ACCOUNTANT',NULL,'ACTIVE','محاسب'),(3,'CS_AGENT',1,'ACTIVE','موظف');`);
 const db=adapter(pg),account=(await openAccount(db,"1",{requestId:uid(),branchId:"1",kind:"VAULT",holderId:null,openingAmount:"100",openingDate:"2020-01-01",counted:true},today)).id;
 const account2=(await openAccount(db,"1",{requestId:uid(),branchId:"2",kind:"VAULT",holderId:null,openingAmount:"50",openingDate:"2020-01-01",counted:true},today)).id;
 const balance=async()=>(await listAccounts(db,"1")).find(a=>a.id===account)!.balance;
 const moves=async()=>Number((await pg.query<{n:number}>("SELECT count(*)::int AS n FROM finance_lab.movements")).rows[0].n);
 const opening=(extra:Record<string,unknown>={})=>({requestId:uid(),kind:"OPENING",branchId:"1",accountId:account,reason:"لا نعلم رصيد البداية الصحيح",...extra});
 const history=(extra:Record<string,unknown>={})=>({requestId:uid(),kind:"COLLECTION",branchId:"1",saleId:"101",reason:"لا نعلم إن تم التحصيل",...extra});
 const close=(caseId:string,extra:Record<string,unknown>={})=>({requestId:uid(),caseId,expectedRevision:"1",reason:"ثبت عدم الحاجة للتعديل",verifiedNoChange:true,...extra});
 const correction=(caseId:string,extra:Record<string,unknown>={})=>({requestId:uid(),accountId:account,expectedOpening:"100",correctedOpening:"90",expectedBalance:"100",verifiedOpening:true,noPriorSettlement:true,reason:"تحقق مستند وهمي",pendingCaseId:caseId,expectedCaseRevision:"1",caseReviewed:true,...extra});
 await t.test("opening report and notes remain pending without altering cash; replay, privacy and closure",async()=>{
   const raw=opening({proposedAmount:"95"});
   await rejected(()=>createReconciliationCase(db,"3",raw,today),"forbidden");
   await rejected(()=>createReconciliationCase(db,"1",{...raw,accountId:account2},today),"account_branch");
   await assert.rejects(()=>createReconciliationCase(adapter(pg,true,"CREATE"),"1",raw,today),/injected case audit failure/);
   assert.equal((await listReconciliationCases(db,"1")).length,0);assert.equal(await balance(),"100.00");
   const saved=await createReconciliationCase(db,"1",raw,today);assert.equal((await createReconciliationCase(db,"1",raw,today)).replayed,true);
   await rejected(()=>createReconciliationCase(db,"1",{...raw,reason:"مختلف"},today),"request_conflict");
   await rejected(()=>createReconciliationCase(db,"2",opening(),today),"case_exists");
   const row=(await listReconciliationCases(db,"2"))[0];assert.equal(row.status,"OPEN");assert.equal(row.proposedAmount,"95.00");assert.equal(row.openingSnapshot,"100.00");assert.equal(row.balanceSnapshot,"100.00");
   const note={requestId:uid(),caseId:saved.id,note:"لم يصل المستند بعد"};const added=await addReconciliationNote(db,"2",note);assert.equal((await addReconciliationNote(db,"2",note)).replayed,true);
   assert.equal((await listReconciliationNotes(db,"1"))[0].id,added.id);await rejected(()=>listReconciliationCases(db,"3"),"forbidden");await rejected(()=>listReconciliationNotes(db,"3"),"forbidden");
   await rejected(()=>closeReconciliationCase(db,"1",close(saved.id,{verifiedNoChange:false})),"invalid_input");
   assert.equal(await balance(),"100.00");assert.equal(await moves(),0);
   await rejected(()=>closeReconciliationCase(db,"1",close(saved.id)),"case_changed");
   const end=close(saved.id,{expectedRevision:"2"});await closeReconciliationCase(db,"1",end);assert.equal((await closeReconciliationCase(db,"1",end)).replayed,true);
   await rejected(()=>addReconciliationNote(db,"1",{...note,requestId:uid()}),"case_resolved");
   await rejected(()=>closeReconciliationCase(db,"2",close(saved.id)),"case_resolved");
   const closed=(await listReconciliationCases(db,"1"))[0];assert.equal(closed.status,"CLOSED");assert.equal(closed.resolvedBy,"1");assert.equal(closed.resolutionReason,"ثبت عدم الحاجة للتعديل");assert.equal(await moves(),0);
 });
 await t.test("an open case requires explicit linking; audit failure rolls back case, correction and money",async()=>{
   const item=await createReconciliationCase(db,"1",opening(),today);const raw=correction(item.id);
   await rejected(()=>correctOpeningBalance(db,"1",{...raw,pendingCaseId:null}),"case_review_required");
   await rejected(()=>correctOpeningBalance(db,"1",{...raw,caseReviewed:false}),"case_review_required");
   await rejected(()=>correctOpeningBalance(db,"1",{...raw,expectedBalance:"99"}),"balance_changed");
   await assert.rejects(()=>correctOpeningBalance(adapter(pg,true,"CONFIRM"),"1",raw),/injected case audit failure/);
   assert.equal(await balance(),"100.00");assert.equal(await moves(),0);assert.equal((await listReconciliationCases(db,"1")).find(c=>c.id===item.id)?.status,"OPEN");
   const result=await correctOpeningBalance(db,"2",raw);assert.equal((await correctOpeningBalance(db,"2",raw)).replayed,true);
   assert.equal(await balance(),"90.00");assert.equal(await moves(),1);
   const row=(await listReconciliationCases(db,"1")).find(c=>c.id===item.id)!;assert.equal(row.status,"CONFIRMED");assert.equal(row.openingCorrectionId,result.id);assert.equal(row.openingSnapshot,"100.00");
   await rejected(()=>correctOpeningBalance(db,"1",{...raw,requestId:uid(),expectedOpening:"90",expectedBalance:"90",correctedOpening:"80"}),"case_resolved");
 });
 await t.test("filing an uncertain opening does not invalidate a pending physical count",async()=>{
   const c=await requestCashCount(db,"1",{requestId:uid(),accountId:account2,expectedBalance:"50",countedAmount:"50",reason:"جرد وهمي",actuallyCounted:true},today);
   await createReconciliationCase(db,"1",opening({branchId:"2",accountId:account2}),today);
   await confirmCashCount(db,"2",{requestId:uid(),countId:c.id,reason:"تطابق",stillCurrent:true});
   assert.equal((await listAccounts(db,"1")).find(a=>a.id===account2)?.balance,"50.00");
 });
 await t.test("historical guesses require verified invoice scope and support notes, linked or distinct events",async()=>{
   const raw=history({accountId:null,proposedAmount:"10",possibleDate:"2019-12-31",possibleHandler:"غير متأكد"});
   await rejected(()=>createReconciliationCase(adapter(pg,false),"1",raw,today),"sale_verification_required");
   await rejected(()=>createReconciliationCase(db,"1",{...raw,saleId:"102"},today),"sale_branch");
   await rejected(()=>createReconciliationCase(db,"1",{...raw,accountId:account2},today),"account_branch");
   await rejected(()=>createReconciliationCase(db,"1",{...raw,proposedAmount:"0"},today),"invalid_input");
   await rejected(()=>createReconciliationCase(db,"1",{...raw,possibleDate:"2027-01-01"},today),"future_date");
   const one=await createReconciliationCase(db,"1",raw,today),two=await createReconciliationCase(db,"2",history(),today);
   assert.equal((await listReconciliationCases(db,"1","101")).length,2);assert.equal((await listReconciliationCases(db,"1","102")).length,0);
   const event=(extra:Record<string,unknown>={})=>({eventType:"COLLECTION",eventId:"7",saleId:"101",branchId:"1",accountId:account,amount:"8",actualDate:"2019-12-31",checkpointType:"OPENING",checkpointCountId:null,handler:"موظف وهمي",reason:"مستند تمت مراجعته",verifiedActual:true,beforeCheckpoint:true,includedInCheckpoint:true,notPreviouslyRecorded:true,caseSnapshot:`${one.id}:1,${two.id}:1`,...extra});
   const run=(v:unknown,database=db)=>database.serializable(tx=>recordHistoricalCommerceInTransaction(tx,"1",v,today));
   await rejected(()=>run(event()),"case_review_required");
   await rejected(()=>run(event({pendingCaseId:one.id,caseReviewed:false})),"case_review_required");
   await rejected(()=>run(event({pendingCaseId:one.id,caseReviewed:true,eventType:"REFUND"})),"case_review_required");
   await rejected(()=>run(event({pendingCaseId:one.id,caseReviewed:true,saleId:"999"})),"case_review_required");
   await assert.rejects(()=>run(event({pendingCaseId:one.id,caseReviewed:true}),adapter(pg,true,"CONFIRM")),/injected case audit failure/);
   assert.equal((await listReconciliationCases(db,"1","101")).find(c=>c.id===one.id)?.status,"OPEN");assert.equal(Number((await pg.query<{n:number}>("SELECT count(*)::int AS n FROM finance_lab.historical_commerce")).rows[0].n),0);
   const record=await run(event({pendingCaseId:one.id,caseReviewed:true}));
   const resolved=(await listReconciliationCases(db,"1","101")).find(c=>c.id===one.id)!;assert.equal(resolved.status,"CONFIRMED");assert.equal(resolved.historicalId,record);assert.equal(resolved.proposedAmount,"10.00");
   await addReconciliationNote(db,"2",{requestId:uid(),caseId:two.id,note:"ملاحظة أضيفت بعد مراجعة قديمة"});
   await rejected(()=>run(event({eventId:"8",distinctFromPending:true,caseSnapshot:`${two.id}:1`})) ,"cases_changed");
   await run(event({eventId:"8",distinctFromPending:true,caseSnapshot:`${two.id}:2`}));assert.equal((await listReconciliationCases(db,"1","101")).find(c=>c.id===two.id)?.status,"OPEN");
   assert.equal(await balance(),"90.00");assert.equal(await moves(),1);
   await closeReconciliationCase(db,"1",close(two.id,{expectedRevision:"2"}));assert.equal((await listReconciliationCases(db,"1","101")).find(c=>c.id===two.id)?.status,"CLOSED");
 });
 }finally{await pg.close()}
});
