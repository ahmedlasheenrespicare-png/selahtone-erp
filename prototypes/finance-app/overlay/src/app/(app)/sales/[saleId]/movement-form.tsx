"use client";

import { useActionState, useEffect, useState } from "react";
import { displayMoney, fixedScaled } from "@/lib/commerce-display";
import { validateCollectionAmount, validateRefundAmount } from "@/lib/commerce-math";
import { parseMoneyMovement, type PaymentMethod } from "@/lib/commerce-validation";
import { scaledInteger } from "@/lib/inventory-math";
import { collectAction, refundAction } from "../actions";
import { initialSalesActionState, type SalesActionState } from "../sales-state";

type CashTarget = { id: string; label: string; balance?: string; checkpointRef: string; checkpointDate: string };
type Props = { mode: "collect" | "refund"; saleId: string; requestId: string; maximum: string; cashTargets: CashTarget[] };
export default function MovementForm({ mode, saleId, requestId, maximum, cashTargets }: Props) {
  const refund = mode === "refund";
  const [amount, setAmount] = useState(fixedScaled(BigInt(maximum)));
  const [amountEdited, setAmountEdited] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [accountId, setAccount] = useState("");
  const [negativeAcknowledged, setNegativeAcknowledged] = useState(false);
  const [paid, setPaid] = useState(false);
  const [afterCheckpoint,setAfterCheckpoint] = useState(false);
  const [review, setReview] = useState(false);
  const [error, setError] = useState("");
  const [state, action, pending] = useActionState(refund ? refundAction : collectAction, initialSalesActionState);
  const [dismissed, setDismissed] = useState<SalesActionState | null>(null);
  const account = cashTargets.find((a) => a.id === accountId);
  let projected: bigint | null = null;
  try { if (refund && method === "CASH" && account?.balance !== undefined) projected = scaledInteger(account.balance, 2) - scaledInteger(amount, 2); } catch { /* validation reports invalid amount */ }
  useEffect(() => { if (!amountEdited && state.status === "idle") setAmount(fixedScaled(BigInt(maximum))); }, [maximum, amountEdited, state.status]);
  function edited() { setReview(false); setError(""); setDismissed(state); }
  function reviewValues() {
    const parsed = parseMoneyMovement({ requestId, saleId, amount, method, actuallyPaid: refund ? paid : false }, refund);
    if (!parsed.ok) { setError(Object.values(parsed.errors).join(" ")); return; }
    try {
      const cents = scaledInteger(parsed.value.amount, 2);
      if (refund) validateRefundAmount(BigInt(maximum), cents); else validateCollectionAmount(BigInt(maximum), cents);
      if (method === "CASH" && !account) throw new Error("اختر مكان النقد الفعلي.");
      if (method === "CASH" && !afterCheckpoint) throw new Error("أكد أن العملية الفعلية حدثت بعد آخر جرد للحساب، أو استخدم مراجعة التاريخي.");
      if (refund && method === "CASH" && account?.balance === undefined) throw new Error("لا يمكن مراجعة رصيد الحساب؛ افتح الصفحة من جديد.");
      if (projected !== null && projected < 0n && !negativeAcknowledged) throw new Error("أكد مراجعة الرصيد السالب أولًا.");
      setError(""); setReview(true);
    } catch (problem) { setError(problem instanceof Error ? problem.message : "راجع المبلغ."); }
  }
  const title = refund ? "تسجيل رد مبلغ للعميل" : "تسجيل تحصيل";
  if (state.status === "success") return <div className="inv-panel inv-panel__body" role="status"><h2>{title}</h2><p>{state.message}</p><a className="inv-button inv-button--secondary" href={`/sales/${saleId}`}>تحديث الفاتورة</a></div>;
  if (BigInt(maximum) <= 0n) return null;
  return <form className="inv-panel" action={action} onSubmit={(event) => { if (!review) { event.preventDefault(); reviewValues(); } }} noValidate>
    <input type="hidden" name="requestId" value={requestId} /><input type="hidden" name="saleId" value={saleId} /><input type="hidden" name="reviewed" value={review ? "yes" : "no"} />
    {refund && method === "CASH" && <input type="hidden" name="expectedBalance" value={account?.balance ?? ""} />}
    {method === "CASH" && <input type="hidden" name="cashCheckpointRef" value={account?.checkpointRef ?? ""} />}
    <div className="inv-panel__heading"><h2>{title}</h2><p>{refund ? "سجّل المبلغ بعد دفعه فعليًا فقط؛ النظام لا ينفذ تحويلًا." : "سجّل مبلغًا تم تحصيله من العميل، كاملًا أو جزئيًا."}</p></div>
    <div className="inv-panel__body sale-stack">
      {state.status === "error" && state !== dismissed && <div className="inv-alert inv-alert--error" role="alert">{state.message}{state.fieldErrors && <ul>{Object.values(state.fieldErrors).map((value, index) => <li key={index}>{value}</li>)}</ul>}</div>}
      {error && <div className="inv-alert inv-alert--error" role="alert">{error}</div>}
      <p className="sale-note">{refund ? "المستحق للعميل" : "المتبقي على العميل"}: {displayMoney(BigInt(maximum))} ج.م</p>
      <div className="inv-field"><label htmlFor={`${mode}-amount`}>المبلغ (ج.م) *</label><input id={`${mode}-amount`} name="amount" inputMode="decimal" dir="ltr" value={amount} disabled={pending} onChange={(e) => { edited(); setAmountEdited(true); setAmount(e.target.value); setNegativeAcknowledged(false); setAfterCheckpoint(false); }} /></div>
      <div className="inv-field"><label htmlFor={`${mode}-method`}>الوسيلة *</label><select id={`${mode}-method`} name="method" value={method} disabled={pending} onChange={(e) => { edited(); setMethod(e.target.value as PaymentMethod); setAccount(""); setNegativeAcknowledged(false); setAfterCheckpoint(false); }}><option value="CASH">نقدي</option><option value="CARD">بطاقة</option><option value="BANK_TRANSFER">تحويل بنكي</option><option value="WALLET">محفظة</option></select></div>
      {method === "CASH" && <div className="inv-field"><label htmlFor={`${mode}-account`}>{refund ? "مصدر النقد الفعلي" : "مكان النقد الفعلي"} *</label><select id={`${mode}-account`} name="cashAccountId" value={accountId} disabled={pending} onChange={(e) => { edited(); setAccount(e.target.value); setNegativeAcknowledged(false); setAfterCheckpoint(false); }}><option value="">اختر الخزنة أو العهدة</option>{cashTargets.map((a) => <option key={a.id} value={a.id}>{a.label}{refund && a.balance !== undefined ? ` · ${a.balance} ج.م` : ""}</option>)}</select></div>}
      {method === "CASH" && account && <label className="inv-check"><input type="checkbox" name="afterCheckpoint" value="yes" checked={afterCheckpoint} disabled={pending} onChange={(e) => { edited(); setAfterCheckpoint(e.target.checked); }} /><span>أؤكد أن {refund ? "الرد الفعلي" : "التحصيل الفعلي"} حدث بعد آخر جرد لهذا الحساب ({account.checkpointDate}). إن سبقه فتحتاج الحالة مراجعة الإدارة.</span></label>}
      {projected !== null && <p className="sale-note" style={{ color: projected < 0n ? "#b42318" : undefined }}>الرصيد المتوقع بعد الرد: <bdi dir="ltr">{fixedScaled(projected)}</bdi> ج.م {projected < 0n && "— سالب ويحتاج مراجعة"}</p>}
      {projected !== null && projected < 0n && <label className="inv-check"><input type="checkbox" name="negativeAcknowledged" value="yes" checked={negativeAcknowledged} disabled={pending} onChange={(e) => { edited(); setNegativeAcknowledged(e.target.checked); }} /><span><strong>أؤكد مراجعة الرصيد السالب</strong></span></label>}
      {refund && <label className="inv-check"><input type="checkbox" name="actuallyPaid" value="yes" checked={paid} disabled={pending} onChange={(e) => { edited(); setPaid(e.target.checked); }} /><span><strong>أؤكد أن المبلغ دُفع للعميل فعليًا</strong><small>هذا التسجيل لا يحوّل أموالًا ولا يثبت تحويلًا تلقائيًا.</small></span></label>}
      {review && <div className="inv-review" aria-live="polite"><h2>مراجعة {refund ? "الرد" : "التحصيل"}</h2><p>المبلغ: {amount} ج.م. {refund ? "سيسجّل كمدفوع فعليًا للعميل." : "سيسجّل كتحصيل من العميل."}{method === "CASH" && ` الحساب: ${account?.label}.`}</p></div>}
      <div className="inv-form-actions">{review ? <><button type="submit" className="inv-button" disabled={pending}>{pending ? "جارٍ الحفظ…" : "تأكيد التسجيل"}</button><button type="button" className="inv-button inv-button--secondary" disabled={pending} onClick={() => setReview(false)}>تعديل</button></> : <button type="button" className="inv-button" disabled={pending} onClick={(event) => { event.preventDefault(); reviewValues(); }}>مراجعة {refund ? "الرد" : "التحصيل"}</button>}</div>
    </div>
  </form>;
}
