import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { FinanceProblem, type FinanceDatabase, type FinanceTransaction } from "../prototypes/finance-engine/types";
import { addCategory, approveExpense, cancelCashCount, confirmCashCount, confirmPaidExpenseCorrection, closePaidExpenseReview, createExpense, listAccountActivity, listAccounts, listCashCounts, listExpenseAudit, listExpenseCorrections, listExpenses, listPaidExpenseReviews, openAccount, payExpense, requestCashCount, requestPaidExpenseReview, transferCash } from "../prototypes/finance-engine/engine";

const uid=()=>randomUUID(), today="2026-10-29";
function adapter(pg:PGlite):FinanceDatabase { return { serializable:work=>pg.transaction(async tx=>{
  await tx.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
  const q:FinanceTransaction={query:async(sql,params=[])=>({rows:(await tx.query(sql,params)).rows as never[]})};return work(q);
})}; }
function failAudit(db:FinanceDatabase, action:string):FinanceDatabase {return {serializable:work=>db.serializable(tx=>work({query:async(sql,params=[])=>{
  if(sql.includes("INSERT INTO finance_lab.audit_events") && params[2]===action) throw new Error("injected audit failure");
  return tx.query(sql,params);
}}))};}
async function rejected(f:()=>Promise<unknown>,code:string) {await assert.rejects(f,(e:unknown)=>e instanceof FinanceProblem && e.code===code,`expected ${code}`);}
async function bal(db:FinanceDatabase,id:string){return (await listAccounts(db,"1")).find(a=>a.id===id)!.balance;}

// All data below is fictional and goes into an in-memory schema, never production.
test("reviewed correction and physical count: isolated, atomic, no assumed refund",{timeout:120_000},async t=>{
 const pg=new PGlite();try{
  await pg.exec("SET selahtone.finance_lab_test_only = 'yes'");await pg.exec(readFileSync("prototypes/finance-engine/schema.test-only.sql","utf8"));
  await pg.exec(`INSERT INTO finance_lab.branches(id,name_ar,is_active) VALUES(1,'أ',true),(2,'ب',true),(3,'ج',true),(4,'د',true),(5,'هـ',true),(6,'موقوف',false);
   INSERT INTO finance_lab.users(id,branch_id,role_code,status,must_change_password,full_name) VALUES
   (1,NULL,'MANAGER','ACTIVE',false,'مدير'),(2,NULL,'ACCOUNTANT','ACTIVE',false,'محاسب'),(3,1,'CS_AGENT','ACTIVE',false,'موظف'),(4,3,'CS_AGENT','ACTIVE',false,'موظف آخر');`);
  const db=adapter(pg),cat=(await addCategory(db,"1",{requestId:uid(),name:"بند اختبار"})).id;
  const vault=async(branchId:string,amount:string,openingDate="2026-10-20")=>(await openAccount(db,"1",{requestId:uid(),branchId,kind:"VAULT",holderId:null,openingAmount:amount,openingDate,counted:true},today)).id;
  const draft=async(branchId:string,amount:string,taxAmount:string|null="0")=>(await createExpense(db,"1",{requestId:uid(),branchId,categoryId:cat,amount,expenseDate:"2026-10-19",description:"وهمي",taxAmount})).id;
  const approve=async(id:string)=>approveExpense(db,"1",{requestId:uid(),expenseId:id,expectedRevision:"1"});
  const paidCash=async(id:string,accountId:string,balance:string,extra:Record<string,unknown>={})=>payExpense(db,"1",{requestId:uid(),expenseId:id,expectedRevision:"2",method:"CASH",accountId,paymentDate:"2026-10-21",actuallyPaid:true,expectedBalance:balance,...extra},today);
  const review=async(id:string,rev:string,proposedAmount:string)=>requestPaidExpenseReview(db,"1",{requestId:uid(),expenseId:id,expectedRevision:rev,reason:"تحقق من المبلغ",proposedAmount});
  const correction=(reviewId:string,confirmedAmount:string,expectedBalance:string|null,extra:Record<string,unknown>={})=>({requestId:uid(),reviewId,confirmedAmount,expectedBalance,reason:"مراجعة مستند الدفع الوهمي",verifiedPayment:true,noPriorSettlement:true,...extra});
  const count=(accountId:string,expectedBalance:string,countedAmount:string,extra:Record<string,unknown>={})=>({requestId:uid(),accountId,expectedBalance,countedAmount,reason:"جرد تجريبي",actuallyCounted:true,...extra});
  const confirm=(countId:string,extra:Record<string,unknown>={})=>({requestId:uid(),countId,reason:"مراجعة الجرد",stillCurrent:true,...extra});

  await t.test("review requires confirmation; effective amount and signed book delta retain original payment",async()=>{
   const account=await vault("1","100"),id=await draft("1","50","14");await approve(id);await paidCash(id,account,"100");
   const first=await review(id,"3","30");assert.equal(await bal(db,account),"50.00");
   const before=(await pg.query<{payment:unknown}>("SELECT to_jsonb(p) AS payment FROM finance_lab.payments p WHERE expense_id=$1::bigint",[id])).rows[0].payment;
   const base=correction(first.id,"30","50");
   await rejected(()=>confirmPaidExpenseCorrection(db,"3",base),"forbidden");
   await rejected(()=>confirmPaidExpenseCorrection(db,"1",{...base,verifiedPayment:false}),"invalid_input");
   await rejected(()=>confirmPaidExpenseCorrection(db,"1",{...base,noPriorSettlement:false}),"invalid_input");
   await rejected(()=>confirmPaidExpenseCorrection(db,"1",{...base,confirmedAmount:"13"}),"tax_review_required");
   await rejected(()=>confirmPaidExpenseCorrection(db,"1",{...base,expectedBalance:"51"}),"balance_changed");
   await rejected(()=>confirmPaidExpenseCorrection(db,"1",{...base,confirmedAmount:"50"}),"no_change");
   assert.equal(await bal(db,account),"50.00");assert.equal((await listPaidExpenseReviews(db,"2")).length,1);
   const saved=await confirmPaidExpenseCorrection(db,"2",base);assert.equal((await confirmPaidExpenseCorrection(db,"2",base)).replayed,true);
   await rejected(()=>confirmPaidExpenseCorrection(db,"2",{...base,confirmedAmount:"31"}),"request_conflict");
   await rejected(()=>confirmPaidExpenseCorrection(db,"1",{...base,requestId:uid()}),"review_closed");
   assert.equal(await bal(db,account),"70.00");
   const effective=(await listExpenses(db,"1")).find(e=>e.id===id)!;assert.equal(effective.amount,"30.00");assert.equal(effective.originalAmount,"50.00");assert.equal(effective.paymentAmount,"50.00");assert.equal(effective.revision,4);
   assert.deepEqual((await pg.query<{payment:unknown}>("SELECT to_jsonb(p) AS payment FROM finance_lab.payments p WHERE expense_id=$1::bigint",[id])).rows[0].payment,before);
   const movement=(await pg.query<{amount:string;source:string|null;dest:string|null}>(`SELECT amount::text,source_id::text AS source,destination_id::text AS dest FROM finance_lab.movements WHERE expense_correction_id=$1::bigint`,[saved.id])).rows[0];
   assert.deepEqual(movement,{amount:"20.00",source:null,dest:account});
   const audit=(await listExpenseAudit(db,"2",id)).find(a=>a.action==="CORRECT_PAID")!;const data=audit.afterData as Record<string,unknown>;
   assert.equal(data.actualCashMoved,false);assert.equal(data.beforeBalance,"50.00");assert.equal(data.afterBalance,"70.00");
   const detail=(await listExpenseCorrections(db,"2")).find(c=>c.id===saved.id)!;
   assert.equal(detail.beforeAmount,"50.00");assert.equal(detail.afterAmount,"30.00");assert.equal(detail.bookDifference,"20.00");assert.equal(detail.balanceBefore,"50.00");assert.equal(detail.balanceAfter,"70.00");
   assert.equal(detail.reviewReason,"تحقق من المبلغ");assert.equal(detail.proposedAmount,"30.00");assert.equal(detail.reviewCreatedBy,"1");assert.equal(detail.createdBy,"2");
   await rejected(()=>listExpenseCorrections(db,"3"),"forbidden");
   const second=await review(id,"4","70");await confirmPaidExpenseCorrection(db,"1",correction(second.id,"70","70"));assert.equal(await bal(db,account),"30.00");
   const third=await review(id,"5","110");const negative=correction(third.id,"110","30");
   await rejected(()=>confirmPaidExpenseCorrection(db,"1",negative),"negative_warning");
   await confirmPaidExpenseCorrection(db,"1",{...negative,negativeAcknowledged:true});assert.equal(await bal(db,account),"-10.00");
   assert.deepEqual((await pg.query<{payment:unknown}>("SELECT to_jsonb(p) AS payment FROM finance_lab.payments p WHERE expense_id=$1::bigint",[id])).rows[0].payment,before);
   const corrections=await pg.query<{before:string;after:string}>("SELECT before_amount::text AS before,after_amount::text AS after FROM finance_lab.expense_corrections WHERE expense_id=$1::bigint ORDER BY id",[id]);
   assert.deepEqual(corrections.rows,[{before:"50.00",after:"30.00"},{before:"30.00",after:"70.00"},{before:"70.00",after:"110.00"}]);
   // A staff view of its own account never identifies an expense correction.
   const custody=(await openAccount(db,"1",{requestId:uid(),branchId:"1",kind:"CUSTODY",holderId:"3",openingAmount:"100",openingDate:"2026-10-20",counted:true},today)).id;
   const staffExpense=await draft("1","20");await approve(staffExpense);await paidCash(staffExpense,custody,"100");const staffReview=await review(staffExpense,"3","10");await confirmPaidExpenseCorrection(db,"1",correction(staffReview.id,"10","80"));
   const activity=await listAccountActivity(db,"3",custody);assert.equal(activity[0].kind,"BALANCE_ADJUSTMENT");assert.equal(JSON.stringify(activity).includes("EXPENSE_CORRECTION"),false);
   await rejected(()=>listPaidExpenseReviews(db,"3"),"forbidden");await rejected(()=>listCashCounts(db,"3"),"forbidden");
  });
  await t.test("historical and noncash corrections have no cash movement",async()=>{
   const account=await vault("2","300");
   const old=await draft("2","35");await approve(old);await paidCash(old,account,"",{paymentDate:"2026-10-19",includedInOpening:true,expectedBalance:null});
   const h=await review(old,"3","25");await confirmPaidExpenseCorrection(db,"1",correction(h.id,"25",null));assert.equal(await bal(db,account),"300.00");
   const card=await draft("2","80");await approve(card);await payExpense(db,"1",{requestId:uid(),expenseId:card,expectedRevision:"2",method:"CARD",accountId:null,paymentDate:"2026-10-21",actuallyPaid:true,expectedBalance:null},today);
   const c=await review(card,"3","60");await rejected(()=>confirmPaidExpenseCorrection(db,"1",correction(c.id,"60","300")),"invalid_input");await confirmPaidExpenseCorrection(db,"2",correction(c.id,"60",null));
   assert.equal(await bal(db,account),"300.00");assert.equal(Number((await pg.query<{n:string | number}>("SELECT count(*) AS n FROM finance_lab.movements WHERE branch_id=2")).rows[0].n),0);
   assert.equal((await listExpenses(db,"1")).find(e=>e.id===old)!.amount,"25.00");assert.equal((await listExpenses(db,"1")).find(e=>e.id===card)!.amount,"60.00");
  });
  await t.test("record first, confirm separately, retain before/after; matching count creates no movement",async()=>{
   const account=await vault("3","100");const raw=count(account,"100","80");
   await rejected(()=>requestCashCount(db,"3",raw,today),"forbidden");await rejected(()=>requestCashCount(db,"1",{...raw,actuallyCounted:false},today),"invalid_input");
   await rejected(()=>requestCashCount(db,"1",{...raw,countedAmount:"-1"},today),"invalid_input");await rejected(()=>requestCashCount(db,"1",{...raw,expectedBalance:"99"},today),"balance_changed");
   const created=await requestCashCount(db,"1",raw,today);assert.equal((await requestCashCount(db,"1",raw,today)).replayed,true);assert.equal(await bal(db,account),"100.00");
   await rejected(()=>requestCashCount(db,"2",count(account,"100","80"),today),"count_exists");
   await rejected(()=>confirmCashCount(db,"3",confirm(created.id)),"forbidden");await rejected(()=>confirmCashCount(db,"1",confirm(created.id,{stillCurrent:false})),"invalid_input");
   const yes=confirm(created.id);await confirmCashCount(db,"1",yes);assert.equal((await confirmCashCount(db,"1",yes)).replayed,true);assert.equal(await bal(db,account),"80.00");
   await rejected(()=>confirmCashCount(db,"2",confirm(created.id)),"count_closed");
   const saved=(await listCashCounts(db,"2")).find(c=>c.id===created.id)!;assert.equal(saved.observedBalance,"100.00");assert.equal(saved.countedAmount,"80.00");assert.equal(saved.difference,"-20.00");assert.equal(saved.createdBy,"1");assert.equal(saved.resolvedBy,"1");
   const m=(await pg.query<{amount:string;source:string|null;dest:string|null}>("SELECT amount::text,source_id::text AS source,destination_id::text AS dest FROM finance_lab.movements WHERE cash_count_id=$1::bigint",[created.id])).rows[0];assert.deepEqual(m,{amount:"20.00",source:account,dest:null});
   const match=await requestCashCount(db,"2",count(account,"80","80"),today);await confirmCashCount(db,"1",confirm(match.id));
   assert.equal(Number((await pg.query<{n:string | number}>("SELECT count(*) AS n FROM finance_lab.movements WHERE cash_count_id=$1::bigint",[match.id])).rows[0].n),0);
   const plus=await requestCashCount(db,"1",count(account,"80","120"),today);await confirmCashCount(db,"2",confirm(plus.id));assert.equal(await bal(db,account),"120.00");
   const pm=(await pg.query<{source:string|null;dest:string|null}>("SELECT source_id::text AS source,destination_id::text AS dest FROM finance_lab.movements WHERE cash_count_id=$1::bigint",[plus.id])).rows[0];assert.deepEqual(pm,{source:null,dest:account});
  });
  await t.test("intervening movements invalidate a count even when the balance returns to its prior value",async()=>{
   const a=(await listAccounts(db,"1")).find(x=>x.branchId==="3" && x.kind==="VAULT")!.id;
   const b=(await openAccount(db,"1",{requestId:uid(),branchId:"3",kind:"CUSTODY",holderId:"4",openingAmount:"0",openingDate:"2026-10-20",counted:true},today)).id;
   const pending=await requestCashCount(db,"1",count(a,"120","110"),today);
   await transferCash(db,"1",{requestId:uid(),fromId:a,toId:b,amount:"10",expectedBalance:"120",actuallyTransferred:true});
   await transferCash(db,"1",{requestId:uid(),fromId:b,toId:a,amount:"10",expectedBalance:"10",actuallyTransferred:true});assert.equal(await bal(db,a),"120.00");
   await rejected(()=>confirmCashCount(db,"1",confirm(pending.id)),"count_stale");
   await rejected(()=>cancelCashCount(db,"1",{requestId:uid(),countId:pending.id,reason:""}),"invalid_input");
   await cancelCashCount(db,"2",{requestId:uid(),countId:pending.id,reason:"تحرك النقد بعد الجرد"});
   assert.equal((await listCashCounts(db,"1")).find(c=>c.id===pending.id)!.status,"CANCELLED");assert.equal(await bal(db,a),"120.00");
   const replacement=await requestCashCount(db,"2",count(a,"120","110"),today);await confirmCashCount(db,"2",confirm(replacement.id));assert.equal(await bal(db,a),"110.00");
  });
  await t.test("later or same-day count blocks a possible double adjustment, including a payment entered late",async()=>{
   const a=await vault("4","100"),id=await draft("4","20");await approve(id);await paidCash(id,a,"100");
   const c=await requestCashCount(db,"1",count(a,"80","80"),"2026-10-25");await confirmCashCount(db,"1",confirm(c.id));
   const r=await review(id,"3","10");await rejected(()=>confirmPaidExpenseCorrection(db,"1",correction(r.id,"10","80")),"count_overlap");
   assert.equal(await bal(db,a),"80.00");assert.ok((await listPaidExpenseReviews(db,"1")).find(v=>v.id===r.id));
   const late=await draft("4","10");await approve(late);
   await rejected(()=>paidCash(late,a,"80",{paymentDate:"2026-10-24"}),"count_overlap");
   await rejected(()=>paidCash(late,a,"80",{paymentDate:"2026-10-25"}),"count_order_required");
   await rejected(()=>paidCash(late,a,"80",{paymentDate:"2026-10-25",afterCountId:c.id,afterCount:false}),"invalid_input");
   // A newer count in the same day invalidates an older ordering confirmation.
   const newer=await requestCashCount(db,"1",count(a,"80","80"),"2026-10-25");await confirmCashCount(db,"1",confirm(newer.id));
   await rejected(()=>paidCash(late,a,"80",{paymentDate:"2026-10-25",afterCountId:c.id,afterCount:true}),"count_order_required");
   assert.equal((await listExpenses(db,"1")).find(e=>e.id===late)!.status,"APPROVED");assert.equal(await bal(db,a),"80.00");
   await paidCash(late,a,"80",{paymentDate:"2026-10-25",afterCountId:newer.id,afterCount:true});assert.equal(await bal(db,a),"70.00");
   assert.equal((await listExpenses(db,"1")).find(e=>e.id===late)!.paymentAfterCountId,newer.id);
   const lateReview=await review(late,"3","8");await confirmPaidExpenseCorrection(db,"1",correction(lateReview.id,"8","70"));assert.equal(await bal(db,a),"72.00");
   // Another count after that payment makes a further correction ambiguous.
   const after=await requestCashCount(db,"1",count(a,"72","72"),"2026-10-25");await confirmCashCount(db,"1",confirm(after.id));
   const again=await review(late,"4","7");await rejected(()=>confirmPaidExpenseCorrection(db,"1",correction(again.id,"7","72")),"count_overlap");
   const future=await draft("4","10");await approve(future);await paidCash(future,a,"72",{paymentDate:"2026-10-26"});assert.equal(await bal(db,a),"62.00");
   // A historical pre-opening payment remains safe after later counts: no movement.
   const historical=await draft("4","10");await approve(historical);await paidCash(historical,a,"",{paymentDate:"2026-10-19",includedInOpening:true,expectedBalance:null});
   const hr=await review(historical,"3","8");await confirmPaidExpenseCorrection(db,"1",correction(hr.id,"8",null));assert.equal(await bal(db,a),"62.00");
  });
  await t.test("an investigated review can close without changing the paid record or cash, with full reason",async()=>{
   const a=(await listAccounts(db,"1")).find(x=>x.branchId==="4" && x.kind==="VAULT")!.id;
   const id=await draft("4","20");await approve(id);await payExpense(db,"1",{requestId:uid(),expenseId:id,expectedRevision:"2",method:"CARD",accountId:null,paymentDate:"2026-10-21",actuallyPaid:true,expectedBalance:null},today);
   const r=await review(id,"3","18"),before=await bal(db,a),moves=(await pg.query<{n:string | number}>("SELECT count(*) AS n FROM finance_lab.movements")).rows[0].n;
   const close={requestId:uid(),reviewId:r.id,reason:"بعد الفحص لا حاجة لتصحيح"};
   await rejected(()=>closePaidExpenseReview(db,"3",close),"forbidden");await rejected(()=>closePaidExpenseReview(db,"1",{...close,reason:""}),"invalid_input");
   await closePaidExpenseReview(db,"2",close);assert.equal((await closePaidExpenseReview(db,"2",close)).replayed,true);await rejected(()=>closePaidExpenseReview(db,"1",{...close,requestId:uid()}),"review_closed");
   assert.equal(await bal(db,a),before);assert.equal((await pg.query<{n:string | number}>("SELECT count(*) AS n FROM finance_lab.movements")).rows[0].n,moves);
   const exp=(await listExpenses(db,"1")).find(x=>x.id===id)!;assert.equal(exp.amount,"20.00");assert.equal(exp.revision,3);assert.equal(exp.hasOpenReview,false);
   const audit=(await listExpenseAudit(db,"1",id)).find(x=>x.action==="CLOSE_REVIEW_NO_CHANGE")!;assert.equal(audit.reason,close.reason);assert.equal((audit.afterData as Record<string,unknown>).correctionMade,false);
   const again=await review(id,"3","19");assert.ok((await listPaidExpenseReviews(db,"1")).find(x=>x.id===again.id));
  });
  await t.test("audit failure rolls back count, correction, status, balance, revision and idempotency",async()=>{
   const a=await vault("5","100"),cnt=await requestCashCount(db,"1",count(a,"100","90"),today),cc=confirm(cnt.id);
   const revision=(await pg.query<{revision:string}>("SELECT revision::text FROM finance_lab.accounts WHERE id=$1::bigint",[a])).rows[0].revision;
   await assert.rejects(()=>confirmCashCount(failAudit(db,"CONFIRM"),"1",cc),/injected audit failure/);
   assert.equal(await bal(db,a),"100.00");assert.equal((await listCashCounts(db,"1")).find(x=>x.id===cnt.id)!.status,"OPEN");
   assert.equal((await pg.query<{revision:string}>("SELECT revision::text FROM finance_lab.accounts WHERE id=$1::bigint",[a])).rows[0].revision,revision);
   assert.equal(Number((await pg.query<{n:string | number}>("SELECT count(*) AS n FROM finance_lab.movements WHERE cash_count_id=$1::bigint",[cnt.id])).rows[0].n),0);
   assert.equal(Number((await pg.query<{n:string | number}>("SELECT count(*) AS n FROM finance_lab.requests WHERE request_id=$1::uuid",[cc.requestId])).rows[0].n),0);
   await cancelCashCount(db,"1",{requestId:uid(),countId:cnt.id,reason:"تهيئة الاختبار التالي"});
   const id=await draft("5","30");await approve(id);await paidCash(id,a,"100");const r=await review(id,"3","20"),correct=correction(r.id,"20","70");
   await assert.rejects(()=>confirmPaidExpenseCorrection(failAudit(db,"CORRECT_PAID"),"1",correct),/injected audit failure/);
   assert.equal(await bal(db,a),"70.00");assert.equal((await listExpenses(db,"1")).find(x=>x.id===id)!.amount,"30.00");assert.ok((await listPaidExpenseReviews(db,"1")).find(x=>x.id===r.id));
   assert.equal(Number((await pg.query<{n:string | number}>("SELECT count(*) AS n FROM finance_lab.expense_corrections WHERE expense_id=$1::bigint",[id])).rows[0].n),0);
   assert.equal(Number((await pg.query<{n:string | number}>("SELECT count(*) AS n FROM finance_lab.requests WHERE request_id=$1::uuid",[correct.requestId])).rows[0].n),0);
  });
 }finally{await pg.close();}
});
