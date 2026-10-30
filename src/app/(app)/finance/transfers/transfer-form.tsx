"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { transferCashAction } from "../actions";
import { initialFinanceActionState } from "../finance-state";
import { accountLabel, formatMoney } from "../format";

export type AccountOption = { id: string; kind: "VAULT" | "CUSTODY"; branchId: string; branchName: string; holderName: string | null; balance: string };
type Props = { requestId: string; accounts: AccountOption[] };

export default function TransferForm({ requestId, accounts }: Props) {
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [amount, setAmount] = useState("");
  const [negativeAcknowledged, setNegativeAcknowledged] = useState(false);
  const [review, setReview] = useState(false);
  const [state, formAction, pending] = useActionState(transferCashAction, initialFinanceActionState);

  const source = accounts.find((account) => account.id === fromId) ?? null;
  const targets = useMemo(
    () => accounts.filter((account) => account.id !== fromId && source && account.branchId === source.branchId && account.kind !== source.kind),
    [accounts, fromId, source],
  );
  const target = targets.find((account) => account.id === toId) ?? null;
  const amountNumber = Number(amount);
  const amountValid = amount.trim() !== "" && Number.isFinite(amountNumber) && amountNumber > 0;
  const projected = source && amountValid ? Number(source.balance) - amountNumber : null;
  const needsWarning = projected !== null && projected < 0;

  if (state.status === "success") {
    return (
      <div className="fin-panel fin-success" role="status">
        <h2>تم تسجيل التسليم</h2>
        <p>{state.message}</p>
        <div className="fin-actions">
          <a className="fin-button" href="/finance/transfers">تسليم آخر</a>
          <Link className="fin-button fin-button--secondary" href="/finance">الحسابات النقدية</Link>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="fin-form-stack">
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="fromId" value={fromId} />
      <input type="hidden" name="toId" value={toId} />
      <input type="hidden" name="amount" value={amount} />
      <input type="hidden" name="expectedBalance" value={source?.balance ?? ""} />
      <input type="hidden" name="negativeAcknowledged" value={negativeAcknowledged ? "yes" : "no"} />

      <div className="fin-panel">
        <div className="fin-panel__heading">
          <h2>التسليم الفعلي</h2>
          <p>خطوة واحدة بين خزنة الفرع وعهدة موظف في الفرع نفسه فقط. لا يجوز التسليم بين فرعين.</p>
        </div>
        <div className="fin-panel__body">
          <div className="fin-fields">
            <label className="field fin-field">
              <span className="fin-field__label">من (مصدر النقد)</span>
              <select value={fromId} onChange={(event) => { setFromId(event.target.value); setToId(""); setReview(false); }}>
                <option value="">— اختر الحساب —</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.branchName} · {accountLabel(account.kind)}{account.kind === "CUSTODY" && account.holderName ? ` · ${account.holderName}` : ""} · {formatMoney(account.balance)}
                  </option>
                ))}
              </select>
              {source ? <span className="fin-field__hint">الرصيد الحالي: {formatMoney(source.balance)}</span> : null}
            </label>
            <label className="field fin-field">
              <span className="fin-field__label">إلى (مستلم النقد)</span>
              <select value={toId} disabled={!source} onChange={(event) => { setToId(event.target.value); setReview(false); }}>
                <option value="">— اختر الحساب —</option>
                {targets.map((account) => (
                  <option key={account.id} value={account.id}>
                    {accountLabel(account.kind)}{account.kind === "CUSTODY" && account.holderName ? ` · ${account.holderName}` : ""} · {formatMoney(account.balance)}
                  </option>
                ))}
              </select>
              {source && targets.length === 0 ? <span className="fin-field__hint">لا يوجد حساب مقابل في هذا الفرع؛ افتح عهدة للموظف أولًا.</span> : null}
            </label>
            <label className="field fin-field">
              <span className="fin-field__label">المبلغ</span>
              <input inputMode="decimal" value={amount} onChange={(event) => { setAmount(event.target.value); setReview(false); }} placeholder="0.00" />
              {amount.trim() !== "" && !amountValid ? <span className="fin-field__error">أدخل مبلغًا أكبر من صفر.</span> : null}
            </label>
            <div className="field fin-field">
              <span className="fin-field__label">الرصيد بعد التسليم</span>
              <span className="fin-field__hint">{projected === null ? "—" : formatMoney(projected.toFixed(2))}</span>
            </div>
            {needsWarning ? (
              <label className="fin-check fin-field--wide">
                <input type="checkbox" checked={negativeAcknowledged} onChange={(event) => { setNegativeAcknowledged(event.target.checked); setReview(false); }} />
                <span>سيصبح رصيد المصدر سالبًا. أقر بأنني راجعت الفرق قبل التسجيل.</span>
              </label>
            ) : null}
          </div>
        </div>
      </div>

      {state.status === "error" ? (
        <div className="fin-alert fin-alert--error" role="alert">
          {state.message}
          {state.details?.currentBalance ? ` الرصيد الحالي كما تراه قاعدة البيانات: ${state.details.currentBalance}.` : ""}
        </div>
      ) : null}

      {review ? (
        <div className="fin-review" role="status">
          <h2>راجع قبل الحفظ</h2>
          <ul>
            <li>من: {source ? `${accountLabel(source.kind)}${source.holderName ? ` · ${source.holderName}` : ""}` : "—"} ({formatMoney(source?.balance)})</li>
            <li>إلى: {target ? `${accountLabel(target.kind)}${target.holderName ? ` · ${target.holderName}` : ""}` : "—"}</li>
            <li>المبلغ: {amount}</li>
            <li>الفرع: {source?.branchName ?? "—"}</li>
          </ul>
          <label className="fin-check">
            <input type="checkbox" name="actuallyTransferred" value="yes" required />
            <span>أقر بأن النقد سُلِّم فعليًا في هذه اللحظة.</span>
          </label>
        </div>
      ) : null}

      <div className="fin-form-actions">
        {!review ? (
          <button
            type="button"
            className="fin-button"
            disabled={!source || !target || !amountValid || (needsWarning && !negativeAcknowledged)}
            onClick={() => setReview(true)}
          >
            مراجعة
          </button>
        ) : (
          <button type="submit" className="fin-button" disabled={pending}>{pending ? "جارٍ الحفظ…" : "تأكيد التسليم"}</button>
        )}
        <Link className="fin-button fin-button--text" href="/finance">إلغاء</Link>
      </div>
    </form>
  );
}
