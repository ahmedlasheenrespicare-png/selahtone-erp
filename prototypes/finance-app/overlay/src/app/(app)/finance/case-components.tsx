"use client";

import { startTransition, useActionState, useEffect, useRef, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { financeAction } from "./actions";
import { initialFinanceState } from "./state";
import type { CaseView } from "./case-view";

type Target = { id:string; label:string };
const kinds = { OPENING:"اشتباه خطأ رصيد بداية", COLLECTION:"تحصيل نقدي محتمل سابق للجرد", REFUND:"رد نقدي محتمل سابق للجرد" } as const;
function CaseAction({command,requestId,submit,children}:{command:string;requestId:string;submit:string;children:ReactNode}) {
  const [state,action,pending]=useActionState(financeAction,initialFinanceState),router=useRouter(),ref=useRef<HTMLFormElement>(null);
  useEffect(()=>{if(state.status==="success"){ref.current?.reset();router.refresh();}},[state,router]);
  function onSubmit(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=new FormData(event.currentTarget);startTransition(()=>action(form));}
  return <form ref={ref} action={action} onSubmit={onSubmit} className="lab-form">
    <input type="hidden" name="command" value={command}/><input type="hidden" name="requestId" value={requestId}/>{children}
    {state.status!=="idle" && <p role={state.status==="error"?"alert":"status"} className={state.status==="error"?"lab-negative":"lab-hint"}>{state.message}</p>}
    <button type="submit" className="inv-button inv-button--secondary" disabled={pending}>{pending?"جارٍ الحفظ…":submit}</button>
  </form>;
}
function Field({label,children}:{label:string;children:ReactNode}){return <label className="inv-field"><span>{label}</span>{children}</label>}

export function OpeningCaseForm({accountId,branchId,requestId}:{accountId:string;branchId:string;requestId:string}) {
  return <CaseAction command="createReconciliationCase" requestId={requestId} submit="حفظ الحالة معلقة">
    <input type="hidden" name="kind" value="OPENING"/><input type="hidden" name="branchId" value={branchId}/><input type="hidden" name="accountId" value={accountId}/>
    <p className="lab-hint">لا يلزم معرفة الرقم الصحيح الآن. هذه ملاحظة للمراجعة ولا تغيّر رصيد البداية أو النقد.</p>
    <Field label="رصيد البداية المحتمل (اختياري، غير مؤكد)"><input name="proposedAmount" inputMode="decimal" dir="ltr"/></Field>
    <Field label="ما الذي يحتاج التحقق؟ *"><input name="reason" maxLength={300} required/></Field>
  </CaseAction>;
}
export function SaleCaseForm({saleId,branchId,requestId,targets}:{saleId:string;branchId:string;requestId:string;targets:Target[]}) {
  return <details className="inv-panel"><summary style={{padding:"1rem",cursor:"pointer"}}>حفظ تحصيل أو رد محتمل للمراجعة</summary>
    <div className="inv-panel__body"><CaseAction command="createReconciliationCase" requestId={requestId} submit="حفظ الحالة معلقة">
      <input type="hidden" name="saleId" value={saleId}/><input type="hidden" name="branchId" value={branchId}/>
      <p className="lab-hint">احفظ ما تعرفه فقط. البيانات المقترحة غير مؤكدة، ولا تُسجَّل على الفاتورة ولا تحرك النقد. راجع الحالات السابقة لتجنب تكرار البلاغ.</p>
      <Field label="نوع الحالة *"><select name="kind" defaultValue="" required><option value="">اختر النوع</option><option value="COLLECTION">تحصيل نقدي محتمل</option><option value="REFUND">رد نقدي محتمل</option></select></Field>
      <Field label="الحساب المحتمل (اختياري)"><select name="accountId" defaultValue=""><option value="">غير معروف</option>{targets.map(a=><option value={a.id} key={a.id}>{a.label}</option>)}</select></Field>
      <Field label="المبلغ المحتمل (اختياري)"><input name="proposedAmount" dir="ltr" inputMode="decimal"/></Field>
      <Field label="التاريخ المحتمل (اختياري)"><input name="possibleDate" type="date"/></Field>
      <Field label="من تعامل بالنقد محتملًا (اختياري)"><input name="possibleHandler" maxLength={120}/></Field>
      <Field label="ما الذي يحتاج التحقق؟ *"><input name="reason" maxLength={300} required/></Field>
    </CaseAction></div>
  </details>;
}
export function CaseList({cases,accounts,users,branches,showLinks=true}:{cases:CaseView[];accounts:Target[];users:Record<string,string>;branches:Record<string,string>;showLinks?:boolean}) {
  const label=(id:string|null)=>id ? users[id] ?? `مستخدم ${id}` : "—";
  const sorted=[...cases].sort((a,b)=>a.status===b.status?0:a.status==="OPEN"?-1:b.status==="OPEN"?1:0);
  return <section className="inv-panel" id="reconciliation-cases"><div className="inv-panel__heading"><h2>الحالات المعلّقة وسجل مراجعتها</h2><p>الإبلاغ أو الملاحظات لا تسجّل دفعًا ولا تعدّل رصيدًا. تبقى الحالة معلّقة ما دام التحقق غير مكتمل.</p></div>
    <div className="inv-panel__body lab-stack">{sorted.length===0?<p>لا توجد حالات للمراجعة.</p>:sorted.map(c=><article className="lab-expense" key={c.id} data-case-id={c.id}>
      <div className="lab-expense-head"><strong>حالة #{c.id} · {kinds[c.kind]}</strong><span className="lab-status">{c.status==="OPEN"?"معلقة للمراجعة":c.status==="CONFIRMED"?"رُبطت بإجراء مؤكد":"أُغلقت دون إجراء"}</span></div>
      <div className="lab-meta"><span>الفرع: {branches[c.branchId] ?? `فرع ${c.branchId}`}</span><span>الحساب المحتمل: {c.accountId ? accounts.find(a=>a.id===c.accountId)?.label ?? `حساب ${c.accountId}` : "غير محدد"}</span>
        {c.saleId && <span>الفاتورة: {showLinks?<a href={`/sales/${c.saleId}`}>ST-{c.saleId}</a>:`ST-${c.saleId}`}</span>}
        <span>المبلغ المحتمل: {c.proposedAmount===null?"غير محدد":`${c.proposedAmount} ج.م`}</span>{c.possibleDate&&<span>التاريخ المحتمل: {c.possibleDate}</span>}{c.possibleHandler&&<span>المتعامل المحتمل: {c.possibleHandler}</span>}
        {c.openingSnapshot!==null&&<><span>البداية عند الإبلاغ: {c.openingSnapshot} ج.م</span><span>الرصيد عند الإبلاغ: {c.balanceSnapshot} ج.م</span></>}
        <span>سبب المراجعة: {c.reason}</span><span>أبلغ: {label(c.createdBy)} · {c.createdAt}</span>
        {c.resolvedBy && <><span>راجع: {label(c.resolvedBy)} · {c.resolvedAt}</span><span>سبب النتيجة: {c.resolutionReason}</span></>}
        {c.openingCorrectionId&&<span>تصحيح البداية المرتبط: #{c.openingCorrectionId}</span>}{c.historicalId&&<span>توثيق العملية التاريخية المرتبط: #{c.historicalId}</span>}
      </div>
      {c.notes.length>0&&<details><summary>ملاحظات المراجعة ({c.notes.length})</summary><ul className="lab-activity">{c.notes.map(n=><li key={n.id}><span>{n.note}<small>{label(n.createdBy)} · {n.createdAt}</small></span></li>)}</ul></details>}
      {c.status==="OPEN"&&<>
        {showLinks&&c.kind==="OPENING"&&c.accountId&&<p className="lab-hint"><a href={`/finance#account-${c.accountId}`}>اذهب إلى الحساب لتأكيد تصحيح مرتبط بعد التحقق</a>.</p>}
        {c.saleId&&<p className="lab-hint">بعد التحقق استخدم نموذج العملية التاريخية على الفاتورة، واربط الحالة به. إذا بقي الشك فلا تؤكد.</p>}
        <details><summary>إضافة ملاحظة مع إبقاء الحالة معلقة</summary><CaseAction command="addReconciliationNote" requestId={c.noteRequest} submit="حفظ الملاحظة"><input type="hidden" name="caseId" value={c.id}/>{c.saleId&&<input type="hidden" name="saleId" value={c.saleId}/>}<Field label="الملاحظة *"><input name="note" maxLength={300} required/></Field></CaseAction></details>
        <details><summary>إغلاق بعد المراجعة دون تغيير</summary><p className="lab-hint">للإغلاق فقط إذا تأكدت أن الحالة لا تتطلب تسجيلًا أو تصحيحًا. إن بقي الشك اتركها معلقة.</p><CaseAction key={`close-${c.id}-${c.revision}`} command="closeReconciliationCase" requestId={c.closeRequest} submit="إغلاق الحالة دون إجراء"><input type="hidden" name="caseId" value={c.id}/><input type="hidden" name="expectedRevision" value={c.revision}/>{c.saleId&&<input type="hidden" name="saleId" value={c.saleId}/>}<Field label="سبب الإغلاق *"><input name="reason" maxLength={300} required/></Field><label className="lab-check"><input type="checkbox" name="verifiedNoChange" value="yes"/><span>راجعت الحالة وأؤكد أنها لا تحتاج تسجيلًا أو تصحيحًا.</span></label></CaseAction></details>
      </>}
    </article>)}</div>
  </section>;
}
