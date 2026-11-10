"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { cancelSettlementAction, requestSettlementAction } from "../actions";
import { initialFinanceActionState } from "../finance-state";
import { formatMoney } from "../format";
import { PeriodEstimateNotice } from "../period-estimate-notice";

export const SETTLEMENT_STATUS_LABEL: Record<string, string> = {
  OPEN: "بانتظار الاعتماد",
  CONFIRMED: "معتمدة",
  REJECTED: "مرفوضة",
  CANCELLED: "مُلغاة",
};

type RequestProps = {
  requestId: string;
  accountId: string;
  systemBalance: string;
  sales: string;
  expenses: string;
  expected: string;
};

export function SettlementRequestForm({ requestId, accountId, systemBalance, sales, expenses, expected }: RequestProps) {
  const [counted, setCounted] = useState("");
  const [reason, setReason] = useState("");
  const [review, setReview] = useState(false);
  const [state, formAction, pending] = useActionState(requestSettlementAction, initialFinanceActionState);

  const countedNumber = Number(counted);
  const valid = counted.trim() !== "" && Number.isFinite(countedNumber) && countedNumber >= 0;
  // A difference against book balance is not the amount physically handed
  // over; the reviewer chooses the transfer separately, including zero.
  const bookDifference = valid ? countedNumber - Number(systemBalance) : null;
  const deviation = valid ? countedNumber - Number(expected) : null;
  // A large difference prompts review; it is not proof of a mistake or loss.
  const expectedNumber = Number(expected);
  const deviationTooLarge = deviation !== null && expectedNumber > 0 && deviation < 0
    && Math.abs(deviation) > expectedNumber / 2;

  if (state.status === "success") {
    return (
      <div className="fin-panel fin-success" role="status">
        <h2>سُجّل طلب التسوية</h2>
        <p>{state.message}</p>
        <div className="fin-actions">
          <Link className="fin-button" href="/finance/settlements">طلباتي</Link>
          <Link className="fin-button fin-button--secondary" href="/finance/mine">عهدة الموظف</Link>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="fin-form-stack">
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="accountId" value={accountId} />
      <input type="hidden" name="expectedBalance" value={systemBalance} />

      <div className="fin-panel">
        <div className="fin-panel__heading">
          <h2>مؤشر الفترة التقديري</h2>
          <p>رصيد العهدة الدفتري + التحصيلات المحسوبة − مصروفات نقد الموظف المحسوبة؛ مؤشر للمراجعة لا إسناد مؤكد للنقد.</p>
        </div>
        <div className="fin-panel__body">
          <PeriodEstimateNotice />
          <div className="fin-fields">
            <div className="field fin-field">
              <span className="fin-field__label">رصيد العهدة (النظامي)</span>
              <span className="fin-field__hint">{formatMoney(systemBalance)}</span>
            </div>
            <div className="field fin-field">
              <span className="fin-field__label">مبيعات الفترة (نقدًا)</span>
              <span className="fin-field__hint">{formatMoney(sales)}</span>
            </div>
            <div className="field fin-field">
              <span className="fin-field__label">مصروفات الفترة (من نقدك)</span>
              <span className="fin-field__hint">{formatMoney(expenses)}</span>
            </div>
            <div className="field fin-field">
              <span className="fin-field__label">مؤشر الفترة التقديري</span>
              <span className="fin-field__hint">{formatMoney(expected)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="fin-panel">
        <div className="fin-panel__heading">
          <h2>النقد المعدود فعليًا</h2>
          <p>عدد ما بيدك الآن. الفرق عن المؤشر تنبيه للمراجعة، وليس إثباتًا لعجز أو زيادة فعلية.</p>
        </div>
        <div className="fin-panel__body">
          <div className="fin-fields">
            <label className="field fin-field">
              <span className="fin-field__label">كل ما بيدك الآن — عُدّ النقد كاملًا</span>
              <input inputMode="decimal" value={counted} onChange={(event) => { setCounted(event.target.value); setReview(false); }} placeholder="0.00" />
              <input type="hidden" name="countedAmount" value={counted} />
            </label>
            <span className="fin-field__hint">اكتب ما عددته بالفعل كاملًا، لا قيمة المؤشر ولا المبلغ المقترح تسليمه.</span>
            <div className="field fin-field">
              <span className="fin-field__label">الفرق عن المؤشر</span>
              <span className="fin-field__hint">
                {deviation === null ? "—" : `${formatMoney(deviation.toFixed(2))} — ${deviation > 0 ? "أعلى من المؤشر" : deviation < 0 ? "أقل من المؤشر" : "مطابق للمؤشر"}`}
              </span>
            </div>
            <div className="field fin-field">
              <span className="fin-field__label">المعدود ناقص الرصيد الدفتري — ليس مبلغ التحويل</span>
              <span className="fin-field__hint">{bookDifference === null ? "—" : `${formatMoney(bookDifference.toFixed(2))} ج.م`}</span>
            </div>
            <label className="field fin-field fin-field--wide">
              <span className="fin-field__label">سبب التسوية</span>
              <input value={reason} onChange={(event) => { setReason(event.target.value); setReview(false); }} maxLength={300} placeholder="مثال: تسوية نهاية الأسبوع بعد جرد النقد" />
              <input type="hidden" name="reason" value={reason} />
            </label>
          </div>
        </div>
      </div>

      {deviationTooLarge ? (

        <div className="fin-alert fin-alert--warning" role="alert">

          <strong>تأكّد ممّا كتبتَه.</strong> كتبتَ {formatMoney(countedNumber.toFixed(2))} ومؤشر الفترة {formatMoney(expectedNumber.toFixed(2))} — أي فرقًا عن المؤشر قدره {formatMoney(Math.abs(deviation ?? 0).toFixed(2))}. أعد العد وراجع السجلات؛ اكتب ما عددته بالفعل، وليس قيمة المؤشر.

        </div>

      ) : null}


      {state.status === "error" ? (
        <div className="fin-alert fin-alert--error" role="alert">
          {state.message}
          {state.details?.currentBalance ? ` الرصيد الحالي كما تراه قاعدة البيانات: ${state.details.currentBalance}.` : ""}
        </div>
      ) : null}

      {review ? (
        <div className="fin-review" role="status">
          <h2>راجع قبل الإرسال</h2>
          <ul>
            <li>المعدود فعليًا: {formatMoney(counted || "0")}</li>
            <li>مؤشر الفترة: {formatMoney(expected)}</li>
            <li>الفرق عن المؤشر: {deviation === null ? "—" : formatMoney(deviation.toFixed(2))}</li>
            <li>المعدود ناقص الرصيد الدفتري: {bookDifference === null ? "—" : formatMoney(bookDifference.toFixed(2))}</li>
            <li>السبب: {reason || "—"}</li>
          </ul>
          <label className="fin-check">
            <input type="checkbox" name="actuallyCounted" value="yes" required />
            <span>أقر بأنني عددت النقد بيدي فعليًا في هذه اللحظة.</span>
          </label>
          <p className="fin-field__hint">الإقرار تسجيل للمسؤولية؛ لا يثبت حيازة النقد أو اكتمال الفترة أو انتقاله لاحقًا.</p>
        </div>
      ) : null}

      <div className="fin-form-actions">
        {!review ? (
          <button type="button" className="fin-button" disabled={!valid || reason.trim().length < 3} onClick={() => setReview(true)}>مراجعة</button>
        ) : (
          <button type="submit" className="fin-button" disabled={pending}>{pending ? "جارٍ الحفظ…" : "إرسال الطلب"}</button>
        )}
        <Link className="fin-button fin-button--text" href="/finance/settlements">إلغاء</Link>
      </div>
    </form>
  );
}

export function SettlementCancelForm({ settlementId }: { settlementId: string }) {
  // مُعرّف الطلب يُولَّد في الخادم عند كل عرض، فلا يتكرر إرسال النموذج نفسه.
  const [requestId] = useState(() => crypto.randomUUID());
  const [reason, setReason] = useState("");
  const [state, formAction, pending] = useActionState(cancelSettlementAction, initialFinanceActionState);

  return (
    <form action={formAction} className="fin-inline-form">
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="settlementId" value={settlementId} />
      <input name="reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} placeholder="سبب الإلغاء" aria-label="سبب الإلغاء" />
      <button type="submit" className="fin-button fin-button--secondary" disabled={pending || reason.trim().length < 3}>
        {pending ? "جارٍ الإلغاء…" : "إلغاء الطلب"}
      </button>
      {state.status === "error" ? <span className="fin-field__error">{state.message}</span> : null}
    </form>
  );
}
