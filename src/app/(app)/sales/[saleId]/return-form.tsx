"use client";

import { useActionState, useState } from "react";
import { allocatePartialReturn, customerPosition } from "@/lib/commerce-math";
import { displayMoney, fixedScaled } from "@/lib/commerce-display";
import { parseReturnInput, type ReturnInput, type ReturnLineInput } from "@/lib/commerce-validation";
import { decimalString } from "@/lib/inventory-validation";
import { scaledInteger } from "@/lib/inventory-math";
import { returnAction } from "../actions";
import { initialSalesActionState, type SalesActionState } from "../sales-state";

type Line = { id: string; name: string; quantity: string; previouslyReturned: string; remaining: string; total: string; tax: string; isStock: boolean; isSerialized: boolean; serials: { id: string; number: string }[] };
type Props = { requestId: string; saleId: string; lines: Line[]; originalCents: string; returnedCents: string; collectedCents: string; refundedCents: string; unavailable: boolean };
type Entry = { quantity: string; serialIds: string[] };
type Review = { input: ReturnInput; returnCents: bigint; dueFrom: bigint; dueTo: bigint };

export default function ReturnForm({ requestId, saleId, lines, originalCents, returnedCents, collectedCents, refundedCents, unavailable }: Props) {
  const [cancel, setCancel] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState("");
  const [state, action, pending] = useActionState(returnAction, initialSalesActionState);
  const [dismissed, setDismissed] = useState<SalesActionState | null>(null);
  function edited() { setReview(null); setError(""); setDismissed(state); }
  function update(id: string, fn: (old: Entry) => Entry) { edited(); setEntries((old) => ({ ...old, [id]: fn(old[id] ?? { quantity: "", serialIds: [] }) })); }
  function toggle(id: string, serialId: string) { update(id, (entry) => ({ ...entry, serialIds: entry.serialIds.includes(serialId) ? entry.serialIds.filter((x) => x !== serialId) : [...entry.serialIds, serialId] })); }
  function reviewValues() {
    try {
      let selected: ReturnLineInput[] = [];
      if (cancel) {
        selected = lines.filter((line) => scaledInteger(line.remaining, 2) > 0n).map((line) => ({ saleLineId: line.id, quantity: line.remaining, serialIds: line.isSerialized ? line.serials.map((serial) => serial.id) : [] }));
      } else {
        selected = lines.flatMap((line) => {
          const entry = entries[line.id] ?? { quantity: "", serialIds: [] };
          if (line.isSerialized) return entry.serialIds.length ? [{ saleLineId: line.id, quantity: String(entry.serialIds.length), serialIds: entry.serialIds }] : [];
          const value = entry.quantity.trim();
          if (!value || (decimalString(value, 12, 2) !== null && scaledInteger(decimalString(value, 12, 2)!, 2) === 0n)) return [];
          return [{ saleLineId: line.id, quantity: value, serialIds: [] }];
        });
      }
      if (!selected.length) throw new Error("اختر كمية أو سيريالًا واحدًا على الأقل للمرتجع.");
      const parsed = parseReturnInput({ requestId, saleId, cancel, accepted, lines: cancel ? [] : selected });
      if (!parsed.ok) throw new Error(Object.values(parsed.errors).join(" "));
      let returned = 0n;
      for (const item of selected) {
        const line = lines.find((value) => value.id === item.saleLineId)!;
        const quantity = scaledInteger(decimalString(item.quantity, 12, 2)!, 2);
        if (line.isSerialized && BigInt(item.serialIds.length) * 100n !== quantity) throw new Error(`السيريالات المتاحة لا تطابق كمية ${line.name} المتبقية؛ راجع الفاتورة.`);
        returned += allocatePartialReturn({ originalQuantityHundredths: scaledInteger(line.quantity, 2), previousReturnedHundredths: scaledInteger(line.previouslyReturned, 2), returnQuantityHundredths: quantity, originalFinalCents: scaledInteger(line.total, 2), originalTaxCents: scaledInteger(line.tax, 2) }).finalCents;
      }
      const position = customerPosition({ originalTotalCents: BigInt(originalCents), returnedCents: BigInt(returnedCents) + returned, collectedCents: BigInt(collectedCents), refundedCents: BigInt(refundedCents) });
      setError(""); setReview({ input: parsed.value, returnCents: returned, dueFrom: position.dueFromCustomerCents, dueTo: position.dueToCustomerCents });
    } catch (problem) { setReview(null); setError(problem instanceof Error ? problem.message : "راجع المرتجع."); }
  }
  if (state.status === "success") return <div className="inv-panel inv-panel__body" role="status"><h2>تم تسجيل المرتجع</h2><p>{state.message}</p><a className="inv-button inv-button--secondary" href={`/sales/${saleId}`}>تحديث الفاتورة</a></div>;
  if (unavailable) return null;
  return <form className="inv-panel" action={action} onSubmit={(event) => { if (!review) { event.preventDefault(); reviewValues(); } }} noValidate>
    <input type="hidden" name="reviewed" value={review ? "yes" : "no"} /><input type="hidden" name="payload" value={review ? JSON.stringify(review.input) : ""} />
    <div className="inv-panel__heading"><h2>مرتجع أو إلغاء</h2><p>للمدير فقط. تُعاد البنود المقبولة للمخزون وتُسوّى قيمتها مع باقي العميل أولًا.</p></div>
    <div className="inv-panel__body sale-stack">
      {state.status === "error" && state !== dismissed && <div className="inv-alert inv-alert--error" role="alert">{state.message}{state.fieldErrors && <ul>{Object.values(state.fieldErrors).map((value, index) => <li key={index}>{value}</li>)}</ul>}</div>}
      {error && <div className="inv-alert inv-alert--error" role="alert">{error}</div>}
      <fieldset className="sale-serials"><legend>نوع العملية</legend><div className="sale-serials__list">
        <label><input type="radio" name="return-mode" checked={!cancel} disabled={pending} onChange={() => { edited(); setCancel(false); }} />مرتجع جزئي</label>
        <label><input type="radio" name="return-mode" checked={cancel} disabled={pending} onChange={() => { edited(); setCancel(true); }} />إلغاء كامل للباقي</label>
      </div><p className="sale-note">الإلغاء يعيد كل البنود غير المرتجعة سابقًا، ولا يدفع أي مبلغ تلقائيًا.</p></fieldset>
      {!cancel && lines.filter((line) => scaledInteger(line.remaining, 2) > 0n).map((line) => {
        const entry = entries[line.id] ?? { quantity: "", serialIds: [] };
        return <div className="sale-product" key={line.id}><div className="sale-product__heading"><div><h3>{line.name}</h3><p>المتبقي الممكن إرجاعه: {line.remaining}{!line.isStock ? " · خدمة لا تُضاف للمخزون" : ""}</p></div></div>
          {line.isSerialized ? <fieldset className="sale-serials"><legend>اختر الأجهزة المقبولة</legend><div className="sale-serials__list">{line.serials.map((serial) => <label key={serial.id}><input type="checkbox" disabled={pending} checked={entry.serialIds.includes(serial.id)} onChange={() => toggle(line.id, serial.id)} /><bdi dir="ltr">{serial.number}</bdi></label>)}</div></fieldset> : <div className="inv-field"><label htmlFor={`return-qty-${line.id}`}>الكمية المقبولة للمرتجع</label><input id={`return-qty-${line.id}`} disabled={pending} inputMode="decimal" dir="ltr" value={entry.quantity} onChange={(event) => update(line.id, (old) => ({ ...old, quantity: event.target.value }))} placeholder="0" /></div>}
        </div>;
      })}
      <label className="inv-check"><input type="checkbox" checked={accepted} disabled={pending} onChange={(event) => { edited(); setAccepted(event.target.checked); }} /><span><strong>أؤكد قبول البنود المحددة للمرتجع</strong><small>تُعاد السلع المقبولة للمخزون في المستودع الأصلي.</small></span></label>
      {review && <div className="inv-review" aria-live="polite"><h2>مراجعة {cancel ? "الإلغاء" : "المرتجع"}</h2><dl><div><dt>قيمة المرتجع</dt><dd>{displayMoney(review.returnCents)} ج.م</dd></div><div><dt>المتبقي على العميل بعده</dt><dd>{displayMoney(review.dueFrom)} ج.م</dd></div><div><dt>المستحق للعميل بعده</dt><dd>{displayMoney(review.dueTo)} ج.م</dd></div></dl><p>المستحق للعميل لا يعني ردّه. يُسجّل الرد بعد دفعه فعليًا بصورة منفصلة.</p></div>}
      <div className="inv-form-actions">{review ? <><button type="submit" className="inv-button" disabled={pending}>{pending ? "جارٍ الحفظ…" : `تأكيد ${cancel ? "الإلغاء" : "المرتجع"}`}</button><button type="button" className="inv-button inv-button--secondary" disabled={pending} onClick={() => setReview(null)}>تعديل</button></> : <button type="button" className="inv-button" disabled={pending} onClick={(event) => { event.preventDefault(); reviewValues(); }}>مراجعة المرتجع</button>}</div>
    </div>
  </form>;
}
