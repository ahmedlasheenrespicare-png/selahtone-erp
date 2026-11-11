"use client";

import { useActionState, useRef, useState } from "react";
import { closeAccountAction } from "./actions";
import { OlderCorrectionNotice } from "./older-correction-notice";
import { initialFinanceActionState } from "./finance-state";

/**
 * إقفال عهدة بعد تصفيتها.
 *
 * الزر لا يظهر إلا لعهدة رصيدها صفر: فالإقفال تسجيل لحالة لا حركة مال، وعهدة
 * في ذمتها نقد لا تُقفل بل تُصفّى أولًا بتسوية. ومنع الظهور هنا لا يكفي وحده —
 * المحرك يعيد الفحص — لكن منع محاولة يعرف صاحبها أنها ستفشل خير من رفض بعدها.
 */
export function CustodyCloseForm({ requestId, accountId, holderName }: { requestId: string; accountId: string; holderName: string }) {
  const [state, formAction, pending] = useActionState(closeAccountAction, initialFinanceActionState);
  const details = useRef<HTMLDetailsElement>(null);
  const [reason, setReason] = useState("");

  if (state.status === "success") return <span className="fin-field__hint">مقفلة</span>;

  return (
    <details ref={details}>
      <summary className="fin-button fin-button--text">إقفال العهدة</summary>
      <form action={formAction} className="fin-form-stack">
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="accountId" value={accountId} />
      <div className="field fin-field">
        <label htmlFor={`close-reason-${accountId}`}>سبب الإقفال</label>
        <input
          id={`close-reason-${accountId}`}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={300}
          placeholder="مثال: إجازة — صُفّيت العهدة بتسوية"
        />
        <input type="hidden" name="reason" value={reason} />
      </div>
      <p className="fin-field__hint">
        سيُقفل حساب «{holderName}» ولا يُحذف: سجله وحركاته وتسوياته تبقى للمراجعة. يجب تصفية الفترة وعدم وجود طلبات تسوية أو جرد مفتوحة قبل الإقفال.
      </p>
      <OlderCorrectionNotice />
      {state.status === "error" ? (
        <div className="fin-alert fin-alert--error" role="alert">{state.message}</div>
      ) : null}
      <div className="fin-actions">
        <button className="fin-button" type="submit" disabled={pending}>
          {pending ? "جارٍ الإقفال…" : "تأكيد الإقفال"}
        </button>
        <button className="fin-button fin-button--text" type="button" onClick={() => { if (details.current) details.current.open = false; }} disabled={pending}>
          إلغاء
        </button>
      </div>
      </form>
    </details>
  );
}
