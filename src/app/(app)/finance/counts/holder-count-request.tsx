"use client";

import { useActionState, useState } from "react";
import { requestCountFromHolderAction } from "../actions";
import { initialFinanceActionState } from "../finance-state";
import { accountLabel } from "../format";

export type HolderCountAccount = { id: string; kind: "VAULT" | "CUSTODY"; branchName: string; holderName: string | null };

/** جردٌ موجَّه: المدير يطلبه من موظف، فيعدّه الموظف بنفسه ويُقرّ، ثم يعتمده
 *  المدير. كان الجردُ يُسجَّل بيد المدير عن يدٍ لا يشهدها؛ فصار بيد صاحبها. */
export function RequestCountFromHolderForm({ requestId, accounts }: { requestId: string; accounts: HolderCountAccount[] }) {
  const [state, formAction, pending] = useActionState(requestCountFromHolderAction, initialFinanceActionState);
  const custodies = accounts.filter((account) => account.kind === "CUSTODY");
  const [accountId, setAccountId] = useState(custodies[0]?.id ?? "");
  const [reason, setReason] = useState("");

  if (custodies.length === 0) return null;

  if (state.status === "success") {
    return (
      <div className="fin-panel fin-success" role="status">
        <h2>طُلب الجرد</h2>
        <p>{state.message}</p>
      </div>
    );
  }

  return (
    <form action={formAction} className="fin-form-stack">
      <input type="hidden" name="requestId" value={requestId} />
      <div className="fin-panel">
        <div className="fin-panel__heading">
          <h2>جردٌ موجَّه إلى موظف</h2>
          <p>
            اطلب من الموظف أن يعدّ عهدته بنفسه ويُقرّ أنّه عدّها. فالجرد شهادةُ صاحب اليد،
            وبه يظهر في صفحته بانتظار أن يعدّه، ثم تعتمده أنت.
          </p>
        </div>
        <div className="fin-panel__body">
          <div className="fin-fields">
            <label className="field fin-field">
              <span className="fin-field__label">عهدة الموظف</span>
              <select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
                {custodies.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.branchName} · {accountLabel(account.kind)}
                    {account.holderName ? ` · ${account.holderName}` : ""}
                  </option>
                ))}
              </select>
              <input type="hidden" name="accountId" value={accountId} />
            </label>
            <label className="field fin-field fin-field--wide">
              <span className="fin-field__label">سبب الجرد</span>
              <input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300}
                placeholder="مثال: جرد مفاجئ بنهاية الأسبوع" />
              <input type="hidden" name="reason" value={reason} />
            </label>
          </div>
          {state.status === "error" ? <div className="fin-alert fin-alert--error" role="alert">{state.message}</div> : null}
          <div className="fin-actions">
            <button type="submit" className="fin-button" disabled={pending || accountId === "" || reason.trim() === ""}>
              {pending ? "جارٍ الإرسال…" : "اطلب الجرد"}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
