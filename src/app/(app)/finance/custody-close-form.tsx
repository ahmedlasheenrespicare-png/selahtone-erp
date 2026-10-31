"use client";

import { useActionState, useState } from "react";
import { closeAccountAction } from "./actions";
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
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  if (state.status === "success") return <span className="fin-field__hint">مقفلة</span>;

  if (!open) {
    return (
      <button className="fin-button fin-button--text" type="button" onClick={() => setOpen(true)}>
        إقفال العهدة
      </button>
    );
  }

  return (
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
        سيُقفل حساب «{holderName}» ولا يُحذف: سجله وحركاته وتسوياته تبقى للمراجعة.
      </p>
      {state.status === "error" ? (
        <div className="fin-alert fin-alert--error" role="alert">{state.message}</div>
      ) : null}
      <div className="fin-actions">
        <button className="fin-button" type="submit" disabled={pending}>
          {pending ? "جارٍ الإقفال…" : "تأكيد الإقفال"}
        </button>
        <button className="fin-button fin-button--text" type="button" onClick={() => setOpen(false)} disabled={pending}>
          إلغاء
        </button>
      </div>
    </form>
  );
}
