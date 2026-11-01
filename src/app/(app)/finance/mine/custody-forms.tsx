"use client";

import { useActionState, useState } from "react";
import { initialFinanceActionState } from "../finance-state";
import { requestCustodyAction, submitHolderCountAction } from "../actions";

/** طلب عهدة: الموظف يطلب، والمدير يعتمد. وهو الباب الذي لم يكن. */
export function CustodyRequestForm({ requestId }: { requestId: string }) {
  const [state, formAction, pending] = useActionState(requestCustodyAction, initialFinanceActionState);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  if (state.status === "success") {
    return (
      <div className="fin-panel fin-success" role="status">
        <h2>سُجّل طلب العهدة</h2>
        <p>{state.message}</p>
      </div>
    );
  }

  return (
    <form action={formAction} className="fin-form-stack">
      <input type="hidden" name="requestId" value={requestId} />
      <div className="fin-panel">
        <div className="fin-panel__heading">
          <h2>طلب عهدة</h2>
          <p>ليس لك عهدة مفتوحة. اطلبها بمبلغٍ مقترح وسبب، ويعتمدها المدير أو المحاسب بجرد فعلي.</p>
        </div>
        <div className="fin-panel__body">
          <div className="fin-fields">
            <label className="field fin-field">
              <span className="fin-field__label">المبلغ المقترح</span>
              <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" />
              <input type="hidden" name="amount" value={amount} />
            </label>
            <label className="field fin-field fin-field--wide">
              <span className="fin-field__label">سبب الطلب</span>
              <input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} placeholder="مثال: استلام كاونتر العريش" />
              <input type="hidden" name="reason" value={reason} />
            </label>
          </div>
          {state.status === "error" ? <div className="fin-alert fin-alert--error" role="alert">{state.message}</div> : null}
          <div className="fin-actions">
            <button type="submit" className="fin-button" disabled={pending || amount.trim() === "" || reason.trim() === ""}>
              {pending ? "جارٍ الإرسال…" : "أرسل الطلب"}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}

/** الجرد الموجَّه: المدير طلب، وأنت تعدّ وتُقرّ. فالجرد شهادةُ صاحب اليد. */
export function HolderCountForm({ requestId, countId, reason }: { requestId: string; countId: string; reason: string | null }) {
  const [state, formAction, pending] = useActionState(submitHolderCountAction, initialFinanceActionState);
  const [counted, setCounted] = useState("");
  const [actuallyCounted, setActuallyCounted] = useState(false);

  if (state.status === "success") {
    return (
      <div className="fin-panel fin-success" role="status">
        <h2>سُجّل جردُك</h2>
        <p>{state.message}</p>
      </div>
    );
  }

  return (
    <form action={formAction} className="fin-form-stack">
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="countId" value={countId} />
      <div className="fin-panel">
        <div className="fin-panel__heading">
          <h2>جردٌ مطلوب منك</h2>
          <p>{reason ?? "طلب المدير جردَ عهدتك. عدّ النقد كاملًا وأقرّ أنك عددتَه بنفسك."}</p>
        </div>
        <div className="fin-panel__body">
          <div className="fin-fields">
            <label className="field fin-field">
              <span className="fin-field__label">كل ما بيدك الآن — عُدّ النقد كاملًا</span>
              <input inputMode="decimal" value={counted} onChange={(event) => setCounted(event.target.value)} placeholder="0.00" />
              <input type="hidden" name="countedAmount" value={counted} />
              <span className="fin-field__hint">المبلغ كله الذي في يدك، لا ما ستسلّمه.</span>
            </label>
            <label className="field fin-field fin-field--wide">
              <span className="fin-field__label">أقرّ بأنني عددتُ النقد بنفسي</span>
              <input type="checkbox" name="actuallyCounted" value="yes" checked={actuallyCounted}
                onChange={(event) => setActuallyCounted(event.target.checked)} />
              <input type="hidden" name="actuallyCounted" value={actuallyCounted ? "yes" : "no"} />
            </label>
          </div>
          {state.status === "error" ? <div className="fin-alert fin-alert--error" role="alert">{state.message}</div> : null}
          <div className="fin-actions">
            <button type="submit" className="fin-button"
              disabled={pending || counted.trim() === "" || !actuallyCounted}>
              {pending ? "جارٍ الإرسال…" : "سلّم الجرد"}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
