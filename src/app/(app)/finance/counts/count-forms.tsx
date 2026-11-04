"use client";

import { useActionState, useState } from "react";
import { cancelCountAction, confirmCountAction, requestCountAction } from "../actions";
import { initialFinanceActionState } from "../finance-state";
import { accountLabel, formatMoney } from "../format";

export type CountAccountOption = { id: string; kind: "VAULT" | "CUSTODY"; branchName: string; holderName: string | null; balance: string; expected: string };

const EGP_DENOMINATIONS = [200, 100, 50, 20, 10, 5, 1] as const;

/** A count is an observation: it records what was actually counted against the
 * balance the database holds, and never moves money on its own. */
export function CountRequestForm({ requestId, accounts }: { requestId: string; accounts: CountAccountOption[] }) {
  const [accountId, setAccountId] = useState("");
  const [countedAmount, setCountedAmount] = useState("");
  const [reason, setReason] = useState("");
  const [actuallyCounted, setActuallyCounted] = useState(false);
  const [review, setReview] = useState(false);
  const [showDenoms, setShowDenoms] = useState(true);
  const [denomQty, setDenomQty] = useState<Record<number, string>>({});
  const [coinsAmount, setCoinsAmount] = useState("");
  const [state, formAction, pending] = useActionState(requestCountAction, initialFinanceActionState);

  function computeDenomTotal(nextQty: Record<number, string>, nextCoins: string): number {
    let sum = 0;
    for (const d of EGP_DENOMINATIONS) {
      const q = Number(nextQty[d] ?? "0");
      if (Number.isFinite(q) && q > 0) sum += d * Math.floor(q);
    }
    const c = Number(nextCoins);
    if (Number.isFinite(c) && c > 0) sum += c;
    return Math.round(sum * 100) / 100;
  }

  function updateDenom(denom: number, raw: string): void {
    const cleaned = raw.replace(/[^0-9]/g, "");
    const next = { ...denomQty, [denom]: cleaned };
    setDenomQty(next);
    const total = computeDenomTotal(next, coinsAmount);
    setCountedAmount(total > 0 ? String(total) : "");
    setReview(false);
  }

  function updateCoins(raw: string): void {
    setCoinsAmount(raw);
    const total = computeDenomTotal(denomQty, raw);
    setCountedAmount(total > 0 ? String(total) : "");
    setReview(false);
  }

  const account = accounts.find((item) => item.id === accountId) ?? null;
  const counted = Number(countedAmount);
  const countedValid = countedAmount.trim() !== "" && Number.isFinite(counted) && counted >= 0;
  // مرجع الجرد «المتوقَّع بيده» لا الرصيد الدفتري: مبيعات الفترة ومصروفاتها من
  // نقد الموظف لم تُسوَ بعد، والمقارنة بالدفتري تخترع عجزًا بقدرها ثم تخصمه
  // التسوية مرة أخرى. خزنة الفرع لا تُسوّى فمرجعها رصيدها نفسه.
  const observed = account ? Number(account.expected) : null;
  const difference = account && countedValid ? counted - observed! : null;
  const ready = Boolean(account) && countedValid && reason.trim().length > 0 && actuallyCounted;

  if (state.status === "success") {
    return <div className="fin-alert fin-alert--success" role="status">{state.message}</div>;
  }

  return (
    <form action={formAction} className="fin-form-stack">
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="accountId" value={accountId} />
      <input type="hidden" name="countedAmount" value={countedAmount} />
      {/* يُرسَل «المتوقَّع بيده» لا الرصيد الدفتري: فالمحرك يقارن به
          (current + مبيعات الفترة − مصروفاتها) ويرفض إن اختلف. وإرسال الدفتري
          يجعل كل جرد يفشل متى كان للموظف مبيعات غير مسوّاة — أي حين يكون
          الجرد مطلوبًا بالذات. */}
      <input type="hidden" name="expectedBalance" value={account?.expected ?? ""} />
      <input type="hidden" name="reason" value={reason} />
      <input type="hidden" name="actuallyCounted" value={actuallyCounted ? "yes" : "no"} />

      <div className="fin-fields">
        <label className="field fin-field">
          <span className="fin-field__label">الحساب</span>
          <select value={accountId} onChange={(event) => { setAccountId(event.target.value); setReview(false); }}>
            <option value="">— اختر حسابًا —</option>
            {accounts.map((item) => (
              <option key={item.id} value={item.id}>
                {item.branchName} · {accountLabel(item.kind)}{item.holderName ? ` · ${item.holderName}` : ""} · {formatMoney(item.balance)}
              </option>
            ))}
          </select>
          {account ? (
            <span className="fin-field__hint">
              {account.kind === "CUSTODY"
                ? `الرصيد الدفتري: ${formatMoney(account.balance)} · المتوقَّع بيده الآن: ${formatMoney(account.expected)}`
                : `الرصيد الدفتري الآن: ${formatMoney(account.balance)}`}
            </span>
          ) : null}
        </label>
        <div className="field fin-field">
          <div className="sale-field-head">
            <label htmlFor="counted-amount-input" className="fin-field__label">النقد المعدود فعليًا</label>
            <button
              type="button"
              className="sale-fill-btn"
              onClick={() => setShowDenoms((prev) => !prev)}
            >
              {showDenoms ? "إخفاء حاسبة الفئات" : "حاسبة الفئات الورقية"}
            </button>
          </div>
          <input id="counted-amount-input" inputMode="decimal" value={countedAmount} onChange={(event) => { setCountedAmount(event.target.value); setReview(false); }} placeholder="0.00" />
          {countedAmount.trim() !== "" && !countedValid ? <span className="fin-field__error">أدخل مبلغًا غير سالب.</span> : null}
        </div>
        <div className="field fin-field">
          <span className="fin-field__label">الفرق</span>
          <span className={`fin-field__hint${difference !== null && difference < 0 ? " fin-money--negative" : ""}`}>
            {difference === null ? "—" : `${formatMoney(difference.toFixed(2))} ج.م`}
          </span>
        </div>

        {showDenoms ? (
          <div className="fin-denom-box fin-field--wide" role="group" aria-label="حاسبة فئات النقد المصري">
            <div className="fin-denom-box__head">
              <strong>حاسبة فئات النقد المصري (تعبئ الحقل تلقائيًا)</strong>
              <button
                type="button"
                className="sale-fill-btn"
                onClick={() => {
                  setDenomQty({});
                  setCoinsAmount("");
                  setCountedAmount("");
                  setReview(false);
                }}
              >
                تصفير الفئات
              </button>
            </div>
            <div className="fin-denom-grid">
              {EGP_DENOMINATIONS.map((denom) => (
                <label key={denom} className="fin-denom-cell">
                  <span className="fin-denom-cell__tag">{denom} ج.م</span>
                  <input
                    inputMode="numeric"
                    placeholder="عدد الورق"
                    value={denomQty[denom] ?? ""}
                    onChange={(e) => updateDenom(denom, e.target.value)}
                  />
                  <small>
                    {Number(denomQty[denom] ?? "0") > 0
                      ? `${(denom * Number(denomQty[denom])).toLocaleString("en-US")} ج.م`
                      : "0 ج.م"}
                  </small>
                </label>
              ))}
              <label className="fin-denom-cell">
                <span className="fin-denom-cell__tag">فكة / عملات</span>
                <input
                  inputMode="decimal"
                  placeholder="ج.م"
                  value={coinsAmount}
                  onChange={(e) => updateCoins(e.target.value)}
                />
                <small>قيمة مباشرة</small>
              </label>
            </div>
          </div>
        ) : null}
        <label className="field fin-field fin-field--wide">
          <span className="fin-field__label">سبب الجرد</span>
          <input value={reason} maxLength={300} onChange={(event) => { setReason(event.target.value); setReview(false); }} />
        </label>
        <label className="fin-check fin-field--wide">
          <input type="checkbox" checked={actuallyCounted} onChange={(event) => { setActuallyCounted(event.target.checked); setReview(false); }} />
          <span>أقر بأنني عدَدت النقد فعليًا الآن.</span>
        </label>
      </div>

      {state.status === "error" ? (
        <div className="fin-alert fin-alert--error" role="alert">
          {state.message}
          {state.details?.currentBalance ? ` الرصيد الحالي كما تراه قاعدة البيانات: ${state.details.currentBalance}.` : ""}
        </div>
      ) : null}

      {review ? (
        <div className="fin-review" role="status">
          <h2>راجع قبل التسجيل</h2>
          <ul>
            <li>الحساب: {account ? `${accountLabel(account.kind)}${account.holderName ? ` · ${account.holderName}` : ""}` : "—"}</li>
            <li>الرصيد الدفتري: {formatMoney(account?.balance)}</li>
            <li>المعدود فعليًا: {countedAmount}</li>
            <li>الفرق: {difference === null ? "—" : formatMoney(difference.toFixed(2))}</li>
          </ul>
          <p className="fin-field__hint">التسجيل الآن ملاحظة فقط؛ الفرق لا يؤثر على الرصيد إلا بتأكيد تسوية منفصل.</p>
        </div>
      ) : null}

      <div className="fin-form-actions">
        {!review ? (
          <button type="button" className="fin-button" disabled={!ready} onClick={() => setReview(true)}>مراجعة</button>
        ) : (
          <button type="submit" className="fin-button" disabled={pending || !ready}>{pending ? "جارٍ الحفظ…" : "تسجيل الجرد"}</button>
        )}
      </div>
    </form>
  );
}

/** Resolving an open count: confirm posts the difference, cancel closes it with
 * a reason and no cash movement at all. */
export function CountResolveForm({ requestId, countId, difference }: { requestId: string; countId: string; difference: string }) {
  const [mode, setMode] = useState<"CONFIRM" | "CANCEL">("CONFIRM");
  const [reason, setReason] = useState("");
  const [stillCurrent, setStillCurrent] = useState(false);
  const [confirmState, confirmAction, confirmPending] = useActionState(confirmCountAction, initialFinanceActionState);
  const [cancelState, cancelAction, cancelPending] = useActionState(cancelCountAction, initialFinanceActionState);
  const state = mode === "CONFIRM" ? confirmState : cancelState;

  if (state.status === "success") return <div className="fin-alert fin-alert--success" role="status">{state.message}</div>;

  if (mode === "CONFIRM") {
    return (
      <form action={confirmAction} className="fin-form-stack">
        <input type="hidden" name="requestId" value={requestId} />
        <input type="hidden" name="countId" value={countId} />
        <input type="hidden" name="reason" value={reason} />
        <input type="hidden" name="stillCurrent" value={stillCurrent ? "yes" : "no"} />
        <div className="fin-fields">
          <label className="field fin-field">
            <span className="fin-field__label">سبب تأكيد التسوية</span>
            <input value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} />
          </label>
          <label className="fin-check fin-field--wide">
            <input type="checkbox" checked={stillCurrent} onChange={(event) => setStillCurrent(event.target.checked)} />
            <span>أقر بأن المعدود ما زال فعليًا ولم تقع حركة نقد بعد الجرد.</span>
          </label>
        </div>
        {state.status === "error" ? <div className="fin-alert fin-alert--error" role="alert">{state.message}</div> : null}
        <div className="fin-form-actions">
          <button type="submit" className="fin-button" disabled={confirmPending || !stillCurrent || reason.trim().length === 0}>
            {confirmPending ? "جارٍ الحفظ…" : `تأكيد التسوية (${formatMoney(difference)})`}
          </button>
          <button type="button" className="fin-button fin-button--text" onClick={() => setMode("CANCEL")}>إلغاء الطلب بدلًا من ذلك</button>
        </div>
      </form>
    );
  }

  return (
    <form action={cancelAction} className="fin-form-stack">
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="countId" value={countId} />
      <input type="hidden" name="reason" value={reason} />
      <div className="fin-fields">
        <label className="field fin-field">
          <span className="fin-field__label">سبب إلغاء طلب الجرد</span>
          <input value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} />
          <span className="fin-field__hint">الإلغاء لا ينشئ أي حركة نقد.</span>
        </label>
      </div>
      {state.status === "error" ? <div className="fin-alert fin-alert--error" role="alert">{state.message}</div> : null}
      <div className="fin-form-actions">
        <button type="submit" className="fin-button" disabled={cancelPending || reason.trim().length === 0}>
          {cancelPending ? "جارٍ الحفظ…" : "تأكيد الإلغاء"}
        </button>
        <button type="button" className="fin-button fin-button--text" onClick={() => setMode("CONFIRM")}>العودة إلى التأكيد</button>
      </div>
    </form>
  );
}
