import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { FinanceProblem, type FinanceDatabase, type FinanceTransaction } from "../prototypes/finance-engine/types";
import { openAccount, transferCash, correctOpeningBalance, requestCashCount, confirmCashCount, listAccounts, listOpeningCorrections, listAccountActivity, recordHistoricalCommerceInTransaction, postCashCollectionInTransaction, postCashRefundInTransaction } from "../prototypes/finance-engine/engine";

const uid=()=>randomUUID(), today="2026-10-30";
function adapter(pg:PGlite):FinanceDatabase { return { serializable:work=>pg.transaction(async tx=>{
  await tx.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
  const q:FinanceTransaction={query:async(sql,params=[])=>({rows:(await tx.query(sql,params)).rows as never[]})};return work(q);
})}; }
function failAudit(db:FinanceDatabase):FinanceDatabase {return {serializable:work=>db.serializable(tx=>work({query:async(sql,params=[])=>{
  if(sql.includes("INSERT INTO finance_lab.audit_events") && params[2]==="CORRECT_OPENING") throw new Error("injected audit failure");
  return tx.query(sql,params);
}}))};}
async function rejected(f:()=>Promise<unknown>,code:string) {await assert.rejects(f,(e:unknown)=>e instanceof FinanceProblem && e.code===code,`expected ${code}`);}

test("opening corrections and historical checkpoints are isolated, audited and never duplicate cash",{timeout:120_000},async t=>{
 const pg=new PGlite();try {
  await pg.exec("SET selahtone.finance_lab_test_only = 'yes'");await pg.exec(readFileSync("prototypes/finance-engine/schema.test-only.sql","utf8"));
  await pg.exec(`INSERT INTO finance_lab.branches(id,name_ar,is_active) VALUES(1,'أ',true),(2,'ب',true),(3,'ج',true),(4,'د',true);
   INSERT INTO finance_lab.users(id,branch_id,role_code,status,must_change_password,full_name) VALUES
   (1,NULL,'MANAGER','ACTIVE',false,'مدير'),(2,NULL,'ACCOUNTANT','ACTIVE',false,'محاسب'),(3,1,'CS_AGENT','ACTIVE',false,'موظف'),(4,2,'CS_AGENT','ACTIVE',false,'موظف آخر'),(5,3,'CS_AGENT','ACTIVE',false,'موظف ثالث');`);
  const db=adapter(pg);
  const open=async(branchId:string,kind:"VAULT"|"CUSTODY",holderId:string|null,amount:string)=>(await openAccount(db,"1",{requestId:uid(),branchId,kind,holderId,openingAmount:amount,openingDate:"2026-10-20",counted:true},today)).id;
  const bal=async(id:string)=>(await listAccounts(db,"1")).find(a=>a.id===id)!.balance;
  const xfer=async(fromId:string,toId:string,amount:string,expectedBalance:string)=>transferCash(db,"1",{requestId:uid(),fromId,toId,amount,expectedBalance,actuallyTransferred:true});
  const count=async(accountId:string,expectedBalance:string,countedAmount:string)=>{
    const x=await requestCashCount(db,"1",{requestId:uid(),accountId,expectedBalance,countedAmount,countedOn:"2026-10-25",reason:"جرد وهمي",actuallyCounted:true},"2026-10-25");
    await confirmCashCount(db,"2",{requestId:uid(),countId:x.id,reason:"تحقق وهمي",stillCurrent:true});return x.id;
  };
  const correction=(accountId:string,expectedOpening:string,correctedOpening:string,expectedBalance:string,extra:Record<string,unknown>={})=>({requestId:uid(),accountId,expectedOpening,correctedOpening,expectedBalance,verifiedOpening:true,noPriorSettlement:true,reason:"راجعنا مستند افتتاح وهمي",...extra});
  let one="",two="",checkpoint="";
  await t.test("correction after movements posts only signed book delta, preserving original and replay identity",async()=>{
    one=await open("1","VAULT",null,"1000");const c=await open("1","CUSTODY","3","0");await xfer(one,c,"200","1000");
    const input=correction(one,"1000","900","800");
    await rejected(()=>correctOpeningBalance(db,"3",input),"forbidden");
    await rejected(()=>correctOpeningBalance(db,"1",{...input,verifiedOpening:false}),"invalid_input");
    await rejected(()=>correctOpeningBalance(db,"1",{...input,noPriorSettlement:false}),"settlement_review_required");
    await rejected(()=>correctOpeningBalance(db,"1",{...input,expectedOpening:"999"}),"revision_changed");
    await rejected(()=>correctOpeningBalance(db,"1",{...input,expectedBalance:"799"}),"balance_changed");
    const saved=await correctOpeningBalance(db,"2",input); assert.equal((await correctOpeningBalance(db,"2",input)).replayed,true);
    await rejected(()=>correctOpeningBalance(db,"2",{...input,correctedOpening:"901"}),"request_conflict");
    assert.equal(await bal(one),"700.00");const a=(await listAccounts(db,"1")).find(a=>a.id===one)!;assert.equal(a.recordedOpening,"1000.00");assert.equal(a.currentOpening,"900.00");
    const c1=(await listOpeningCorrections(db,"1")).find(a=>a.id===saved.id)!;
    assert.equal(c1.bookDifference,"-100.00");assert.equal(c1.resolution,"BOOK");assert.equal(c1.balanceBefore,"800.00");assert.equal(c1.balanceAfter,"700.00");
    const m=(await pg.query<{kind:string;amount:string;source:string}>(`SELECT kind,amount::text,source_id::text AS source FROM finance_lab.movements WHERE opening_correction_id=$1::bigint`,[saved.id])).rows[0];assert.deepEqual(m,{kind:"OPENING_CORRECTION",amount:"100.00",source:one});
    const audit=(await pg.query<{data:{actualCashMoved:boolean}}>(`SELECT after_data AS data FROM finance_lab.audit_events WHERE entity_type='ACCOUNT' AND entity_id=$1::bigint AND action='CORRECT_OPENING'`,[one])).rows[0];assert.equal(audit.data.actualCashMoved,false);
    await correctOpeningBalance(db,"1",correction(one,"900","950","700"));assert.equal(await bal(one),"750.00");
    await rejected(()=>listOpeningCorrections(db,"3"),"forbidden");
  });
  await t.test("negative requires acknowledgement; failure to audit rolls everything back",async()=>{
    const vault=await open("3","VAULT",null,"100"),custody=await open("3","CUSTODY","5","0");await xfer(vault,custody,"90","100");
    const input=correction(vault,"100","80","10");await rejected(()=>correctOpeningBalance(db,"1",input),"negative_warning");
    await assert.rejects(()=>correctOpeningBalance(failAudit(db),"1",{...input,negativeAcknowledged:true}),/injected audit failure/);
    assert.equal(await bal(vault),"10.00");assert.equal((await listAccounts(db,"1")).find(a=>a.id===vault)!.currentOpening,"100.00");
    await correctOpeningBalance(db,"1",{...input,negativeAcknowledged:true});assert.equal(await bal(vault),"-10.00");
  });
  await t.test("a later count blocks a second delta; verified covered count changes metadata only",async()=>{
    two=await open("2","VAULT",null,"1000");const custody=await open("2","CUSTODY","4","0");await xfer(two,custody,"200","1000");checkpoint=await count(two,"800","700");
    const base=correction(two,"1000","900","700");await rejected(()=>correctOpeningBalance(db,"1",base),"count_overlap");
    await rejected(()=>correctOpeningBalance(db,"1",{...base,noPriorSettlement:false,countCovered:true,coveredCountId:"999"}),"count_overlap");
    const pending=(await requestCashCount(db,"1",{requestId:uid(),accountId:two,expectedBalance:"700",countedAmount:"700",countedOn:"2026-10-26",reason:"جرد انتظار",actuallyCounted:true},"2026-10-26")).id;
    const before=(await pg.query<{n:number}>("SELECT count(*)::int AS n FROM finance_lab.movements")).rows[0].n;
    const input={...base,noPriorSettlement:false,countCovered:true,coveredCountId:checkpoint};const saved=await correctOpeningBalance(db,"2",input);
    assert.equal((await correctOpeningBalance(db,"2",input)).replayed,true);assert.equal(await bal(two),"700.00");
    assert.equal((await pg.query<{n:number}>("SELECT count(*)::int AS n FROM finance_lab.movements")).rows[0].n,before);
    const detail=(await listOpeningCorrections(db,"1")).find(c=>c.id===saved.id)!;assert.equal(detail.resolution,"COUNT_COVERED");assert.equal(detail.coveredCountId,checkpoint);assert.equal(detail.balanceBefore,detail.balanceAfter);
    await rejected(()=>confirmCashCount(db,"1",{requestId:uid(),countId:pending,reason:"تحقق",stillCurrent:true}),"count_stale");
    await correctOpeningBalance(db,"1",correction(two,"900","950","700",{noPriorSettlement:false,countCovered:true,coveredCountId:checkpoint}));assert.equal(await bal(two),"700.00");
  });
  await t.test("same-date historical operation requires explicit attestation and a same-account checkpoint",async()=>{
    const hist=(eventType:"COLLECTION"|"REFUND",eventId:string,extra:Record<string,unknown>={})=>({eventType,eventId,saleId:"1",branchId:"2",accountId:two,amount:"10",actualDate:"2026-10-25",checkpointType:"COUNT",checkpointCountId:checkpoint,handler:"موظف وهمي",reason:"راجعنا سجلًا وهميًا",verifiedActual:true,beforeCheckpoint:true,includedInCheckpoint:true,notPreviouslyRecorded:true,...extra});
    const call=(actor:string,v:unknown)=>db.serializable(tx=>recordHistoricalCommerceInTransaction(tx,actor,v,today));
    await rejected(()=>call("3",hist("COLLECTION","1")),"forbidden");
    await rejected(()=>call("1",hist("COLLECTION","1",{beforeCheckpoint:false})),"invalid_input");
    await rejected(()=>call("1",hist("COLLECTION","1",{includedInCheckpoint:false})),"invalid_input");
    await rejected(()=>call("1",hist("COLLECTION","1",{notPreviouslyRecorded:false})),"invalid_input");
    await rejected(()=>call("1",hist("COLLECTION","1",{actualDate:"2026-10-26"})),"checkpoint_order");
    await rejected(()=>call("1",hist("COLLECTION","1",{accountId:one})),"account_branch");
    await rejected(()=>call("1",hist("COLLECTION","1",{checkpointCountId:"999"})),"checkpoint_unavailable");
    const before=await bal(two);await call("2",hist("COLLECTION","1"));await call("1",hist("REFUND","1"));assert.equal(await bal(two),before);
    const attested=await pg.query<{verified_actual:boolean;before_checkpoint:boolean;included_in_checkpoint:boolean;not_previously_recorded:boolean}>(
      "SELECT verified_actual,before_checkpoint,included_in_checkpoint,not_previously_recorded FROM finance_lab.historical_commerce ORDER BY id");
    assert.equal(attested.rows.length,2);assert(attested.rows.every(row=>row.verified_actual&&row.before_checkpoint&&row.included_in_checkpoint&&row.not_previously_recorded));
    await rejected(()=>db.serializable(tx=>postCashCollectionInTransaction(tx,"1",{branchId:"2",accountId:two,amount:"10",collectionId:"1"})),"duplicate");
    await rejected(()=>db.serializable(tx=>postCashRefundInTransaction(tx,"1",{branchId:"2",accountId:two,amount:"10",refundId:"1",expectedBalance:before,negativeAcknowledged:false})),"duplicate");
    await db.serializable(tx=>postCashCollectionInTransaction(tx,"1",{branchId:"2",accountId:two,amount:"10",collectionId:"2"}));
    await rejected(()=>call("1",hist("COLLECTION","2")),"duplicate");
    const old=hist("REFUND","2",{checkpointType:"OPENING",checkpointCountId:null,actualDate:"2026-10-20"});await call("2",old);
    assert.equal((await listAccountActivity(db,"3",(await listAccounts(db,"3"))[0].id)).some(a=>a.kind==="OPENING_CORRECTION"),false);
  });
 } finally {await pg.close();}
});
