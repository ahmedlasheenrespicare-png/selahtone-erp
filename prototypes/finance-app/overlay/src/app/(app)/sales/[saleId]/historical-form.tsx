"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { displayMoney, fixedScaled } from "@/lib/commerce-display";
import { validateCollectionAmount, validateRefundAmount } from "@/lib/commerce-math";
import { parseMoneyMovement } from "@/lib/commerce-validation";
import { scaledInteger } from "@/lib/inventory-math";
import { historicalCollectionAction, historicalRefundAction } from "../actions";
import { initialSalesActionState, type SalesActionState } from "../sales-state";
import type { CaseView } from "../../finance/case-view";

type Target = { id:string; label:string; openingDate?:string };
type Count = { id:string; accountId:string; countedOn:string };
type Props = { mode:"collect"|"refund"; saleId:string; requestId:string; maximum:string; cashTargets:Target[]; counts:Count[]; openCases:CaseView[] };
export default function HistoricalForm({mode,saleId,requestId,maximum,cashTargets,counts,openCases}:Props) {
  const refund=mode==="refund";
  const [amount,setAmount]=useState(fixedScaled(BigInt(maximum))), [accountId,setAccount]=useState(""), [date,setDate]=useState("");
  const [checkpoint,setCheckpoint]=useState(""), [handler,setHandler]=useState(""), [reason,setReason]=useState("");
  const [verified,setVerified]=useState(false), [before,setBefore]=useState(false), [included,setIncluded]=useState(false), [unique,setUnique]=useState(false);
  const [review,setReview]=useState(false), [error,setError]=useState("");
  const [caseChoice,setCaseChoice]=useState(""),[caseReviewed,setCaseReviewed]=useState(false),[distinct,setDistinct]=useState(false);
  const caseSnapshot=[...openCases].sort((a,b)=>BigInt(a.id)<BigInt(b.id)?-1:BigInt(a.id)>BigInt(b.id)?1:0).map(c=>`${c.id}:${c.revision}`).join(",");
  const [reviewedCaseSnapshot,setReviewedCaseSnapshot]=useState("");
  const previousCaseSnapshot=useRef(caseSnapshot);
  const [state,action,pending]=useActionState(refund?historicalRefundAction:historicalCollectionAction,initialSalesActionState);
  const [dismissed,setDismissed]=useState<SalesActionState|null>(null);
  // New/closed cases or newly added notes invalidate an in-progress review.
  // The separately frozen snapshot also makes the server reject stale tabs.
  useEffect(()=>{
    if(previousCaseSnapshot.current!==caseSnapshot) {
      previousCaseSnapshot.current=caseSnapshot;
      setCaseChoice("");setCaseReviewed(false);setDistinct(false);setReview(false);
      setVerified(false);setBefore(false);setIncluded(false);setUnique(false);
      setError("تغيرت الحالات أو ملاحظاتها؛ راجعها مجددًا قبل التسجيل.");
    }
  },[caseSnapshot]);
  const account=cashTargets.find(a=>a.id===accountId);
  const options=counts.filter(c=>c.accountId===accountId);
  const selectedCount=checkpoint.startsWith("COUNT:")?options.find(c=>c.id===checkpoint.slice(6)):undefined;
  const checkpointType=checkpoint==="OPENING"?"OPENING":selectedCount?"COUNT":"";
  const checkpointDate=checkpointType==="OPENING"?account?.openingDate:selectedCount?.countedOn;
  function edited(){setReview(false);setError("");setDismissed(state);}
  function changedFacts(){edited();setVerified(false);setBefore(false);setIncluded(false);setUnique(false);setCaseReviewed(false);setDistinct(false);}
  function check(){
    const parsed=parseMoneyMovement({requestId,saleId,amount,method:"CASH",actuallyPaid:verified},refund);
    if(!parsed.ok){setError(Object.values(parsed.errors).join(" "));return;}
    try {
      if(refund) validateRefundAmount(BigInt(maximum),scaledInteger(parsed.value.amount,2)); else validateCollectionAmount(BigInt(maximum),scaledInteger(parsed.value.amount,2));
      if(!account||!checkpointType||!checkpointDate) throw new Error("اختر الحساب والجرد المؤكد الذي راجعته.");
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date>checkpointDate) throw new Error("أدخل تاريخًا صحيحًا لا يتأخر عن الجرد المختار.");
      if(!handler.trim()||!reason.trim()) throw new Error("أدخل من استلم أو دفع النقد وسبب التسجيل ومرجع المراجعة.");
      if(openCases.length && (!caseChoice || (caseChoice!=="UNRELATED" && !caseReviewed) || (caseChoice==="UNRELATED" && !distinct))) throw new Error("راجع الحالات المعلقة واربط الحالة، أو أكد أن الواقعة مختلفة عنها.");
      if(!verified||!before||!included||!unique) throw new Error("أكّد التحقق من العملية وترتيب الجرد وعدم تكرار التسجيل.");
      setError("");setReviewedCaseSnapshot(caseSnapshot);setReview(true);
    } catch(e){setError(e instanceof Error?e.message:"راجع العملية.");}
  }
  if(BigInt(maximum)<=0n) return null;
  if(state.status==="success") return <div className="inv-panel inv-panel__body" role="status"><h2>عملية سابقة للجرد</h2><p>{state.message}</p><a className="inv-button inv-button--secondary" href={`/sales/${saleId}`}>تحديث الفاتورة</a></div>;
  return <details className="inv-panel"><summary style={{padding:"1rem",cursor:"pointer"}}>{refund?"تسجيل رد نقدي سابق محتسب في الجرد":"تسجيل تحصيل نقدي سابق محتسب في الجرد"}</summary>
    <form action={action} className="inv-panel__body sale-stack" onSubmit={e=>{if(!review){e.preventDefault();check();}}} noValidate>
      <input type="hidden" name="requestId" value={requestId}/><input type="hidden" name="saleId" value={saleId}/><input type="hidden" name="reviewed" value={review?"yes":"no"}/>
      <input type="hidden" name="checkpointType" value={checkpointType}/><input type="hidden" name="checkpointCountId" value={selectedCount?.id??""}/><input type="hidden" name="pendingCaseId" value={caseChoice==="UNRELATED"?"":caseChoice}/><input type="hidden" name="caseSnapshot" value={reviewedCaseSnapshot}/>
      <p className="sale-note">للإدارة فقط: تسجَّل العملية على الفاتورة دون حركة نقدية جديدة بعد التحقق. لا تستخدم هذا المسار إذا كان ترتيب الجرد غير معلوم، أو إذا سُجلت العملية من قبل. يمكن حفظ اشتباه منفصل للمراجعة عند عدم التأكد. معرف الطلب يمنع إعادة الطلب نفسه، لكنه لا يكشف كل تكرار أُدخل بطلب جديد.</p>
      {state.status==="error"&&state!==dismissed&&<div className="inv-alert inv-alert--error" role="alert">{state.message}</div>}{error&&<div className="inv-alert inv-alert--error" role="alert">{error}</div>}
      <p className="sale-note">{refund?"المستحق للعميل":"المتبقي على العميل"}: {displayMoney(BigInt(maximum))} ج.م</p>
      <div className="inv-field"><label htmlFor={`${mode}-old-amount`}>مبلغ العملية الفعلية *</label><input id={`${mode}-old-amount`} name="amount" dir="ltr" inputMode="decimal" value={amount} onChange={e=>{changedFacts();setAmount(e.target.value);}} disabled={pending}/></div>
      <div className="inv-field"><label htmlFor={`${mode}-old-account`}>حساب النقد الفعلي *</label><select id={`${mode}-old-account`} name="cashAccountId" value={accountId} onChange={e=>{changedFacts();setAccount(e.target.value);setCheckpoint("");}} disabled={pending}><option value="">اختر الخزنة أو العهدة</option>{cashTargets.map(a=><option key={a.id} value={a.id}>{a.label}</option>)}</select></div>
      <div className="inv-field"><label htmlFor={`${mode}-old-date`}>تاريخ التحصيل أو الرد الفعلي *</label><input id={`${mode}-old-date`} name="actualDate" type="date" value={date} onChange={e=>{changedFacts();setDate(e.target.value);}} disabled={pending}/></div>
      <div className="inv-field"><label htmlFor={`${mode}-old-checkpoint`}>الجرد الذي احتسب العملية *</label><select id={`${mode}-old-checkpoint`} value={checkpoint} onChange={e=>{changedFacts();setCheckpoint(e.target.value);}} disabled={pending||!account}><option value="">اختر الجرد</option>{account?.openingDate&&<option value="OPENING">جرد البداية · {account.openingDate}</option>}{options.map(c=><option key={c.id} value={`COUNT:${c.id}`}>جرد مؤكد #{c.id} · {c.countedOn}</option>)}</select></div>
      <div className="inv-field"><label htmlFor={`${mode}-old-handler`}>من استلم أو دفع النقد فعليًا *</label><input id={`${mode}-old-handler`} name="handler" maxLength={120} value={handler} onChange={e=>{changedFacts();setHandler(e.target.value);}} disabled={pending}/></div>
      <div className="inv-field"><label htmlFor={`${mode}-old-reason`}>سبب التسجيل ومرجع التحقق *</label><input id={`${mode}-old-reason`} name="reason" maxLength={300} value={reason} onChange={e=>{changedFacts();setReason(e.target.value);}} disabled={pending}/></div>
      {openCases.length>0 && <><div className="inv-field"><label htmlFor={`${mode}-old-case`}>حالات معلقة من النوع نفسه *</label><select id={`${mode}-old-case`} value={caseChoice} onChange={e=>{changedFacts();setCaseChoice(e.target.value);}} disabled={pending}><option value="">اختر الحالة أو وضّح أنها واقعة أخرى</option>{openCases.map(c=><option key={c.id} value={c.id}>حالة #{c.id} · {c.proposedAmount ?? "مبلغ غير محدد"} · {c.reason}</option>)}<option value="UNRELATED">واقعة أخرى مختلفة عن جميع الحالات المعلقة</option></select></div>
        {caseChoice && caseChoice!=="UNRELATED" && <label className="inv-check"><input type="checkbox" name="caseReviewed" value="yes" checked={caseReviewed} onChange={e=>{edited();setCaseReviewed(e.target.checked);}} disabled={pending}/><span>راجعت الحالات وملاحظاتها وأربط هذا التسجيل بهذه الحالة، وأؤكد أنه لا يكرر الحالات الأخرى.</span></label>}
        {caseChoice==="UNRELATED" && <label className="inv-check"><input type="checkbox" name="distinctFromPending" value="yes" checked={distinct} onChange={e=>{edited();setDistinct(e.target.checked);}} disabled={pending}/><span>راجعت الحالات المعلقة وأؤكد أن هذه واقعة أخرى لا تكررها.</span></label>}</>}
      <label className="inv-check"><input type="checkbox" name="verifiedActual" value="yes" checked={verified} onChange={e=>{edited();setVerified(e.target.checked);}} disabled={pending}/><span>تحققت أن {refund?"الرد دُفع للعميل":"التحصيل استُلم من العميل"} فعليًا.</span></label>
      <label className="inv-check"><input type="checkbox" name="beforeCheckpoint" value="yes" checked={before} onChange={e=>{edited();setBefore(e.target.checked);}} disabled={pending}/><span>تحققت أن العملية سبقت هذا الجرد، بما في ذلك ترتيب اليوم نفسه.</span></label>
      <label className="inv-check"><input type="checkbox" name="includedInCheckpoint" value="yes" checked={included} onChange={e=>{edited();setIncluded(e.target.checked);}} disabled={pending}/><span>تحققت أن أثر العملية انعكس في الجرد المحدد لهذا الحساب.</span></label>
      <label className="inv-check"><input type="checkbox" name="notPreviouslyRecorded" value="yes" checked={unique} onChange={e=>{edited();setUnique(e.target.checked);}} disabled={pending}/><span>راجعت الفاتورة وأؤكد أن هذه العملية لم تُسجّل عليها سابقًا.</span></label>
      {review&&<div className="inv-review" aria-live="polite"><h2>مراجعة التسجيل التاريخي</h2><p>{amount} ج.م · {account?.label} · تاريخ العملية {date} · الجرد {checkpointDate}. رصيد النقد لن يتغير.</p></div>}
      <div className="inv-form-actions">{review?<><button type="submit" className="inv-button" disabled={pending}>{pending?"جارٍ الحفظ…":"تأكيد التسجيل التاريخي"}</button><button type="button" className="inv-button inv-button--secondary" disabled={pending} onClick={()=>setReview(false)}>تعديل</button></>:<button type="button" className="inv-button" disabled={pending} onClick={check}>مراجعة العملية التاريخية</button>}</div>
    </form>
  </details>;
}
