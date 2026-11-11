"use client";

import { useActionState, useEffect, useState } from "react";
import { displayMoney, fixedScaled } from "@/lib/commerce-display";
import { validateCollectionAmount, validateRefundAmount } from "@/lib/commerce-math";
import { parseMoneyMovement, type PaymentMethod } from "@/lib/commerce-validation";
import { scaledInteger } from "@/lib/inventory-math";
import { collectAction, refundAction } from "../actions";
import { initialSalesActionState, type SalesActionState } from "../sales-state";

export type MovementAccountOption = { id: string; label: string; balance?: string; checkpointRef?: string; checkpointDate?: string; checkpointConfirmedAt?: string | null };
type Props = { mode: "collect" | "refund"; saleId: string; requestId: string; maximum: string; accounts?: MovementAccountOption[]; canViewBalances?: boolean; financeEnabled?: boolean };
export default function MovementForm({ mode, saleId, requestId, maximum, accounts = [], canViewBalances = true, financeEnabled = true }: Props) {
  const refund = mode === "refund";
  const [amount, setAmount] = useState(fixedScaled(BigInt(maximum)));
  const [amountEdited, setAmountEdited] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [accountId, setAccountId] = useState("");
  const [negativeAcknowledged, setNegativeAcknowledged] = useState(false);
  const [paid, setPaid] = useState(false);
  const [timing, setTiming] = useState("");
  const [review, setReview] = useState(false);
  const [error, setError] = useState("");
  const [state, action, pending] = useActionState(refund ? refundAction : collectAction, initialSalesActionState);
  const [dismissed, setDismissed] = useState<SalesActionState | null>(null);
  useEffect(() => { if (!amountEdited && state.status === "idle") setAmount(fixedScaled(BigInt(maximum))); }, [maximum, amountEdited, state.status]);
  function edited() { setReview(false); setError(""); setDismissed(state); }
  // نقدي فقط هو ما يخرج من حساب؛ غير النقدي لا يحرك نقد الفرع.
  const cashRefund = refund && method === "CASH";
  const account = accounts.find((entry) => entry.id === accountId) ?? null;
  const projected = account?.balance !== undefined ? Number(account.balance) - (Number(amount) || 0) : null;
  const needsWarning = projected !== null && projected < 0;
  function reviewValues() {
    if (cashRefund && (!account?.checkpointRef || timing !== "AFTER_REVIEWED_CHECKPOINT")) {
      setError("الرد السابق للجرد أو غير المؤكد متوقف للمراجعة؛ لم يُسجّل رد أو حركة نقدية."); return;
    }
    const parsed = parseMoneyMovement({
      requestId, saleId, amount, method, actuallyPaid: refund ? paid : false,
      accountId: cashRefund ? accountId : null, negativeAcknowledged,
    }, refund);
    if (!parsed.ok) { setError(Object.values(parsed.errors).join(" ")); return; }
    try {
      const cents = scaledInteger(parsed.value.amount, 2);
      if (refund) validateRefundAmount(BigInt(maximum), cents); else validateCollectionAmount(BigInt(maximum), cents);
      setError(""); setReview(true);
    } catch (problem) { setError(problem instanceof Error ? problem.message : "راجع المبلغ."); }
  }
  const title = refund ? "تسجيل رد مبلغ للعميل" : "تسجيل تحصيل";
  if (state.status === "success") return <div className="inv-panel inv-panel__body" role="status"><h2>{title}</h2><p>{state.message}</p><a className="inv-button inv-button--secondary" href={`/sales/${saleId}`}>تحديث الفاتورة</a></div>;
  if (BigInt(maximum) <= 0n) return null;
  return <form className="inv-panel" action={action} onSubmit={(event) => { if (!review) { event.preventDefault(); reviewValues(); } }} noValidate>
    <input type="hidden" name="requestId" value={requestId} /><input type="hidden" name="saleId" value={saleId} /><input type="hidden" name="reviewed" value={review ? "yes" : "no"} />
    <input type="hidden" name="accountId" value={cashRefund ? accountId : ""} />
    {cashRefund && <><input type="hidden" name="checkpointRef" value={account?.checkpointRef ?? ""} /><input type="hidden" name="timing" value={timing} /></>}
    <input type="hidden" name="negativeAcknowledged" value={cashRefund && negativeAcknowledged ? "yes" : "no"} />
    <div className="inv-panel__heading"><h2>{title}</h2><p>{refund ? "سجّل المبلغ بعد دفعه فعليًا فقط؛ الرد النقدي يُخصم من الحساب الذي تختاره في اللحظة نفسها." : "سجّل مبلغًا تم تحصيله من العميل، كاملًا أو جزئيًا."}</p></div>
    <div className="inv-panel__body sale-stack">
      {!refund && method === "CASH" ? <p className="sale-note">مؤقتًا لا يمكن تسجيل التحصيل النقدي إلا بواسطة منشئ الفاتورة؛ عند تفعيل المالية يلزم أيضًا أن تكون له عهدة مفتوحة في فرع الفاتورة، دون طلب تسوية أو جرد مفتوح. التحصيل غير النقدي غير مقيّد بهذا الشرط.</p> : null}
      {state.status === "error" && state !== dismissed && <div className="inv-alert inv-alert--error" role="alert">{state.message}{state.fieldErrors && <ul>{Object.values(state.fieldErrors).map((value, index) => <li key={index}>{value}</li>)}</ul>}</div>}
      {error && <div className="inv-alert inv-alert--error" role="alert">{error}</div>}
      <p className="sale-note">{refund ? "المستحق للعميل" : "المتبقي على العميل"}: {displayMoney(BigInt(maximum))} ج.م</p>
      <div className="inv-field"><label htmlFor={`${mode}-amount`}>المبلغ (ج.م) *</label><input id={`${mode}-amount`} name="amount" inputMode="decimal" dir="ltr" value={amount} disabled={pending} onChange={(e) => { edited(); setAmountEdited(true); setAmount(e.target.value); }} /></div>
      <div className="inv-field"><label htmlFor={`${mode}-method`}>الوسيلة *</label><select id={`${mode}-method`} name="method" value={method} disabled={pending} onChange={(e) => { edited(); setMethod(e.target.value as PaymentMethod); setAccountId(""); setNegativeAcknowledged(false); setTiming(""); }}><option value="CASH">نقدي</option><option value="CARD">بطاقة</option><option value="BANK_TRANSFER">تحويل بنكي</option><option value="WALLET">محفظة</option></select></div>
      {cashRefund ? (
        <>
          {!financeEnabled && <p className="sale-note">تسجيل رد نقدي جديد متوقف عند تعطيل المالية لأن نقطة الجرد والحساب غير متاحين للمراجعة. راجع المسؤول؛ الرد غير النقدي متاح وفق الصلاحيات.</p>}
          <div className="inv-field">
            <label htmlFor={`${mode}-account`}>يُخصم من *</label>
            <select id={`${mode}-account`} value={accountId} disabled={pending} onChange={(e) => { edited(); setAccountId(e.target.value); setNegativeAcknowledged(false); setTiming(""); }}>
              <option value="">— اختر حسابًا —</option>
              {accounts.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}{entry.balance !== undefined ? ` · ${displayMoney(scaledInteger(entry.balance, 2))}` : ""}</option>)}
            </select>
            {account?.balance !== undefined && projected !== null
              ? <span className="sale-note">الرصيد الحالي: {displayMoney(scaledInteger(account.balance, 2))} · بعد الرد: {displayMoney(scaledInteger(projected.toFixed(2), 2))}</span>
              : <span className="sale-note">النقد يخرج من هذا الحساب الآن؛ اختر العهدة إن دفع الموظف من نقده، أو خزنة الفرع إن دُفع منها.</span>}
            {!canViewBalances ? <span className="sale-note">رصيد الحساب محجوب. لا يمكن إتمام رد يجعل الرصيد سالبًا؛ راجع مسؤولًا مخولًا عند تعذر الرد.</span> : null}
          </div>
          {account && <div className="inv-field">
            <label htmlFor={`${mode}-timing`}>متى دُفع النقد مقارنة بآخر نقطة مراجعة؟ *</label>
            <span className="sale-note">{account.checkpointRef === "OPENING" ? `نقطة المراجعة: افتتاح الحساب بتاريخ ${account.checkpointDate} (لا يوجد جرد مؤكد).` : `نقطة المراجعة: الجرد المؤكد رقم ${account.checkpointRef}، تاريخ العد المسجل ${account.checkpointDate}، وقت الاعتماد المسجل ${account.checkpointConfirmedAt} بتوقيت القاهرة.`}</span>
            <select id={`${mode}-timing`} value={timing} disabled={pending} onChange={(e) => { edited(); setTiming(e.target.value); }}>
              <option value="">— اختر —</option><option value="AFTER_REVIEWED_CHECKPOINT">أؤكد أن الدفع تم بعد نقطة المراجعة المذكورة</option>
              <option value="BEFORE_REVIEWED_CHECKPOINT">قبل نقطة المراجعة</option><option value="UNKNOWN">التوقيت غير مؤكد</option>
            </select>
            <span className="sale-note">إذا سبق الدفع النقطة أو لم تتأكد من توقيته، توقف وراجع المسؤول؛ لا تسجّل حركة أخرى. الإقرار لا يثبت وقت الدفع بذاته.</span>
          </div>}
          {needsWarning
            ? <label className="inv-check"><input type="checkbox" checked={negativeAcknowledged} disabled={pending} onChange={(e) => { edited(); setNegativeAcknowledged(e.target.checked); }} /><span><strong>سيصبح الرصيد سالبًا؛ أقر بأنني راجعت الفرق.</strong></span></label>
            : null}
        </>
      ) : null}
      {refund && <label className="inv-check"><input type="checkbox" name="actuallyPaid" value="yes" checked={paid} disabled={pending} onChange={(e) => { edited(); setPaid(e.target.checked); }} /><span><strong>أؤكد أن المبلغ دُفع للعميل فعليًا</strong><small>هذا التسجيل لا يحوّل أموالًا ولا يثبت تحويلًا تلقائيًا.</small></span></label>}
      {review && <div className="inv-review" aria-live="polite"><h2>مراجعة {refund ? "الرد" : "التحصيل"}</h2><p>المبلغ: {amount} ج.م. {refund ? "سيسجّل كمدفوع فعليًا للعميل." : "سيسجّل كتحصيل من العميل."}{cashRefund && account ? ` ويُخصم من: ${account.label}، بعد ${account.checkpointRef === "OPENING" ? "افتتاح الحساب" : `الجرد رقم ${account.checkpointRef}`}.` : ""}</p></div>}
      <div className="inv-form-actions">{review ? <><button type="submit" className="inv-button" disabled={pending || (needsWarning && !negativeAcknowledged)}>{pending ? "جارٍ الحفظ…" : "تأكيد التسجيل"}</button><button type="button" className="inv-button inv-button--secondary" disabled={pending} onClick={() => setReview(false)}>تعديل</button></> : <button type="button" className="inv-button" disabled={pending || (cashRefund && !accountId)} onClick={(event) => { event.preventDefault(); reviewValues(); }}>مراجعة {refund ? "الرد" : "التحصيل"}</button>}</div>
    </div>
  </form>;
}
