"use client";

import { useActionState, useState } from "react";

import { confirmSettlementAction, rejectSettlementAction } from "../actions";
import { initialFinanceActionState } from "../finance-state";
import { formatMoney } from "../format";

export type SettlementDecisionItem = {
  id: string;
  branchName: string;
  holderName: string | null;
  systemBalance: string;
  countedAmount: string;
  salesTotal: string;
  expensesTotal: string;
  expectedAmount: string;
  deviation: string;
  adjustment: string;
  reason: string;
  createdAt: string;
  expectedBalance: string;
};

/**
 * قرار الإدارة في طلب تسوية موظف: اعتماد بخطوة واحدة (حركة تسوية + تحويل الفرق)
 * أو رفض بسبب. لا شيء يتغيّر قبل الاعتماد، والرفض بلا أي أثر مالي.
 */
export function SettlementDecisionCard({ item }: { item: SettlementDecisionItem }) {
  const adjustmentNumber = Number(item.adjustment);
  const direction = adjustmentNumber < 0 ? "TO_CUSTODY" : "TO_VAULT";
  const counted = Number(item.countedAmount);
  const [confirmRequestId] = useState(() => crypto.randomUUID());
  const [rejectRequestId] = useState(() => crypto.randomUUID());
  const [amount, setAmount] = useState(Math.abs(adjustmentNumber).toFixed(2));
  const [reason, setReason] = useState("");
  const [review, setReview] = useState(false);
  const [confirmState, confirmAction, confirming] = useActionState(confirmSettlementAction, initialFinanceActionState);
  const [rejectState, rejectAction, rejecting] = useActionState(rejectSettlementAction, initialFinanceActionState);

  const amountNumber = Number(amount);
  const amountValid = amount.trim() !== "" && Number.isFinite(amountNumber) && amountNumber >= 0;
  const projected = amountValid ? (direction === "TO_VAULT" ? counted - amountNumber : counted + amountNumber) : null;
  const needsWarning = projected !== null && projected < 0;

  if (confirmState.status === "success" || rejectState.status === "success") {
    return (
      <div className="fin-panel fin-success" role="status">
        <h2>سُجّل القرار</h2>
        <p>{confirmState.status === "success" ? confirmState.message : rejectState.message}</p>
      </div>
    );
  }

  return (
    <div className="fin-panel">
      <div className="fin-panel__heading">
        <h2>{item.branchName} · {item.holderName ?? "عهدة الموظف"}</h2>
        <p>طلب بتاريخ {item.createdAt.slice(0, 10)} — سبب الموظف: {item.reason}</p>
      </div>
      <div className="fin-panel__body">
        <div className="fin-fields">
          <div className="field fin-field">
            <span className="fin-field__label">الرصيد النظامي</span>
            <span className="fin-field__hint">{formatMoney(item.systemBalance)}</span>
          </div>
          <div className="field fin-field">
            <span className="fin-field__label">مبيعات الفترة</span>
            <span className="fin-field__hint">{formatMoney(item.salesTotal)}</span>
          </div>
          <div className="field fin-field">
            <span className="fin-field__label">مصروفات الفترة</span>
            <span className="fin-field__hint">{formatMoney(item.expensesTotal)}</span>
          </div>
          <div className="field fin-field">
            <span className="fin-field__label">المتوقع بيده</span>
            <span className="fin-field__hint">{formatMoney(item.expectedAmount)}</span>
          </div>
          <div className="field fin-field">
            <span className="fin-field__label">المعدود فعليًا</span>
            <span className="fin-field__hint">{formatMoney(item.countedAmount)}</span>
          </div>
          <div className="field fin-field">
            <span className="fin-field__label">الفرق</span>
            <span className="fin-field__hint">
              {formatMoney(item.adjustment)} — {adjustmentNumber > 0 ? "زيادة: من العهدة إلى الخزنة" : adjustmentNumber < 0 ? "عجز: من الخزنة إلى العهدة" : "مطابق"}
            </span>
          </div>
          <div className="field fin-field fin-field--wide">
            <span className="fin-field__label">انحراف عن المتوقع</span>
            <span className="fin-field__hint">{formatMoney(item.deviation)}{Number(item.deviation) !== 0 ? " — راجعه قبل الاعتماد" : ""}</span>
          </div>
        </div>

        <form action={confirmAction} className="fin-form-stack" style={{ marginTop: 14 }}>
          <input type="hidden" name="requestId" value={confirmRequestId} />
          <input type="hidden" name="settlementId" value={item.id} />
          <input type="hidden" name="expectedBalance" value={item.expectedBalance} />
          <input type="hidden" name="transferDirection" value={direction} />
          <div className="fin-fields">
            <label className="field fin-field">
              <span className="fin-field__label">مبلغ التحويل الفعلي</span>
              <input inputMode="decimal" value={amount} onChange={(event) => { setAmount(event.target.value); setReview(false); }} placeholder="0.00" />
              <input type="hidden" name="transferAmount" value={amount} />
              <span className="fin-field__hint">
                {direction === "TO_VAULT" ? "من العهدة إلى خزنة الفرع" : "من خزنة الفرع إلى العهدة"}
                {projected !== null ? ` · رصيد العهدة بعده: ${formatMoney(projected.toFixed(2))}` : ""}
              </span>
            </label>
            <label className="field fin-field fin-field--wide">
              <span className="fin-field__label">سبب الاعتماد</span>
              <input value={reason} onChange={(event) => { setReason(event.target.value); setReview(false); }} maxLength={300} placeholder="مثال: استلمت الزيادة نقدًا وسُلّمت للخزنة" />
              <input type="hidden" name="reason" value={reason} />
            </label>
            {needsWarning ? (
              <label className="fin-check fin-field--wide">
                <input type="checkbox" name="negativeAcknowledged" value="yes" />
                <span>سيصبح رصيد العهدة سالبًا. أقر بأنني راجعت الفرق قبل التسجيل.</span>
              </label>
            ) : null}
          </div>

          {confirmState.status === "error" ? (
            <div className="fin-alert fin-alert--error" role="alert">
              {confirmState.message}
              {confirmState.details?.currentBalance ? ` الرصيد الحالي كما تراه قاعدة البيانات: ${confirmState.details.currentBalance}.` : ""}
            </div>
          ) : null}

          {review ? (
            <div className="fin-review" role="status">
              <h3>راجع قبل الحفظ</h3>
              <ul>
                <li>الفرق: {formatMoney(item.adjustment)}</li>
                <li>التحويل: {formatMoney(amount || "0")} {direction === "TO_VAULT" ? "(العهدة ← الخزنة)" : "(الخزنة ← العهدة)"}</li>
                <li>رصيد العهدة بعده: {projected === null ? "—" : formatMoney(projected.toFixed(2))}</li>
              </ul>
              <label className="fin-check">
                <input type="checkbox" name="actuallyTransferred" value="yes" required />
                <span>أقر بأن النقد انتقل فعليًا في هذه اللحظة.</span>
              </label>
            </div>
          ) : null}

          <div className="fin-form-actions">
            {!review ? (
              <button type="button" className="fin-button" disabled={!amountValid || reason.trim().length < 3} onClick={() => setReview(true)}>مراجعة الاعتماد</button>
            ) : (
              <button type="submit" className="fin-button" disabled={confirming}>{confirming ? "جارٍ الحفظ…" : "تأكيد الاعتماد والتحويل"}</button>
            )}
          </div>
        </form>

        <form action={rejectAction} className="fin-inline-form" style={{ marginTop: 10 }}>
          <input type="hidden" name="requestId" value={rejectRequestId} />
          <input type="hidden" name="settlementId" value={item.id} />
          <input name="reason" maxLength={300} placeholder="سبب الرفض" aria-label="سبب الرفض" required />
          <button type="submit" className="fin-button fin-button--secondary" disabled={rejecting}>
            {rejecting ? "جارٍ الرفض…" : "رفض الطلب"}
          </button>
        </form>
        {rejectState.status === "error" ? (
          <div className="fin-alert fin-alert--error" role="alert">{rejectState.message}</div>
        ) : null}
      </div>
    </div>
  );
}
