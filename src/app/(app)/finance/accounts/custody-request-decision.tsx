"use client";

import { randomUUID } from "node:crypto";
import { useActionState, useState } from "react";
import { decideCustodyRequestAction } from "../actions";
import { initialFinanceActionState } from "../finance-state";
import { formatMoney } from "../format";

export type PendingCustodyRequest = {
  id: string;
  amount: string;
  reason: string;
  requesterName: string;
  createdAt: string;
};

/** البتّ في طلب عهدة: بالموافقة تُفتح العهدة بجرد فعلي، أو بالرفض بسبب.
 *  فالعهدة كانت تُفتح من طرفٍ واحد، فصار الموظف يقرع بابها ويُجاب. */
export function CustodyRequestDecision({ request, today }: { request: PendingCustodyRequest; today: string }) {
  const [state, formAction, pending] = useActionState(decideCustodyRequestAction, initialFinanceActionState);
  const [decision, setDecision] = useState<"APPROVE" | "REJECT" | "">("");
  const [reason, setReason] = useState("");
  const [counted, setCounted] = useState(false);

  if (state.status === "success") {
    return (
      <div className="fin-panel fin-success" role="status">
        <p>{state.message}</p>
      </div>
    );
  }

  return (
    <form action={formAction} className="fin-form-stack">
      <input type="hidden" name="requestId" value={randomUUID()} />
      <input type="hidden" name="requestDbId" value={request.id} />
      <input type="hidden" name="openingDate" value={today} />
      <div className="fin-panel">
        <div className="fin-panel__heading">
          <h2>طلب عهدة · {request.requesterName}</h2>
          <p>
            المطلوب <strong>{formatMoney(request.amount)}</strong> — {request.reason}
          </p>
        </div>
        <div className="fin-panel__body">
          <div className="fin-fields">
            <label className="field fin-field">
              <span className="fin-field__label">القرار</span>
              <select value={decision} onChange={(event) => setDecision(event.target.value as "APPROVE" | "REJECT")}>
                <option value="">اختر…</option>
                <option value="APPROVE">موافقة — تُفتح العهدة بجرد فعلي</option>
                <option value="REJECT">رفض</option>
              </select>
              <input type="hidden" name="decision" value={decision} />
            </label>
            {decision === "APPROVE" ? (
              <label className="field fin-field">
                <span className="fin-field__label">أقرّ بأنني أجريتُ جردًا فعليًا للمبلغ</span>
                <input type="checkbox" name="counted" value="yes" checked={counted}
                  onChange={(event) => setCounted(event.target.checked)} />
                <span className="fin-field__hint">بغير هذا الإقرار لا تُفتح العهدة.</span>
              </label>
            ) : null}
            <label className="field fin-field fin-field--wide">
              <span className="fin-field__label">سبب القرار</span>
              <input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300}
                placeholder={decision === "REJECT" ? "سبب الرفض" : "ملاحظة على الموافقة"} />
              <input type="hidden" name="reason" value={reason} />
            </label>
          </div>
          {state.status === "error" ? <div className="fin-alert fin-alert--error" role="alert">{state.message}</div> : null}
          <div className="fin-actions">
            <button type="submit" className="fin-button"
              disabled={pending || decision === "" || reason.trim() === "" || (decision === "APPROVE" && !counted)}>
              {pending ? "جارٍ الحفظ…" : decision === "REJECT" ? "ارفض الطلب" : "وافِق وافتح العهدة"}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
