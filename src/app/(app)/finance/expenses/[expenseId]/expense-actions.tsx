"use client";

import { useActionState, useState } from "react";
import { approveExpenseAction, payExpenseAction, requestExpenseReviewAction } from "../../actions";
import { initialFinanceActionState } from "../../finance-state";
import { accountLabel, formatMoney } from "../../format";

export type AccountOption = { id: string; branchId: string; kind: "VAULT" | "CUSTODY"; branchName: string; holderName: string | null; balance: string; openingDate: string };

const METHODS: Array<{ value: string; label: string }> = [
  { value: "CASH", label: "نقدًا" },
  { value: "CARD", label: "بطاقة" },
  { value: "BANK_TRANSFER", label: "تحويل بنكي" },
  { value: "WALLET", label: "محفظة" },
];

/** نقد الموظف هو الأصل: المصروف يُصرف من نقده ويُسوّى في التسوية، لا بخصم فوري. */
const PAY_SOURCES: Array<{ value: "HOLDER_CASH" | "ACCOUNT"; label: string; hint: string }> = [
  {
    value: "HOLDER_CASH",
    label: "نقد الموظف (يُسوّى في التسوية)",
    hint: "المبلغ خرج من نقد الموظف. لا يتحرك رصيد العهدة الآن، ويُجمع ضمن مصروفات الفترة ليُسوّى عند اعتماد التسوية القادمة.",
  },
  {
    value: "ACCOUNT",
    label: "خصم فوري من حساب",
    hint: "النقد خرج من خزنة الفرع أو من العهدة نفسها، فيُخصم من رصيدها فور تسجيل الصرف.",
  },
];

export function ApproveForm({ requestId, expenseId, revision }: { requestId: string; expenseId: string; revision: string }) {
  const [selfApproved, setSelfApproved] = useState(false);
  const [state, formAction, pending] = useActionState(approveExpenseAction, initialFinanceActionState);
  if (state.status === "success") return <div className="fin-alert fin-alert--success" role="status">{state.message}</div>;
  return (
    <form action={formAction} className="fin-form-stack">
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="expenseId" value={expenseId} />
      <input type="hidden" name="expectedRevision" value={revision} />
      <input type="hidden" name="selfApproved" value={selfApproved ? "yes" : "no"} />
      <label className="fin-check">
        <input type="checkbox" checked={selfApproved} onChange={(event) => setSelfApproved(event.target.checked)} />
        <span>أقر بالاعتماد، وأتحمل أنه قد يكون نفس مُدخل المصروف (اعتماد ذاتي جائز مع حفظ الاسم والوقت).</span>
      </label>
      {state.status === "error" ? <div className="fin-alert fin-alert--error" role="alert">{state.message}</div> : null}
      <div className="fin-form-actions">
        <button type="submit" className="fin-button" disabled={pending || !selfApproved}>{pending ? "جارٍ الحفظ…" : "اعتماد المصروف"}</button>
      </div>
    </form>
  );
}

export function PayForm({
  requestId, expenseId, revision, amount, today, accounts, branchId,
}: { requestId: string; expenseId: string; revision: string; amount: string; today: string; accounts: AccountOption[]; branchId: string }) {
  const [paySource, setPaySource] = useState<"HOLDER_CASH" | "ACCOUNT">("HOLDER_CASH");
  const [method, setMethod] = useState("CASH");
  const [accountId, setAccountId] = useState("");
  const [paymentDate, setPaymentDate] = useState(today);
  const [openingOrder, setOpeningOrder] = useState("");
  const [includedInOpening, setIncludedInOpening] = useState(false);
  const [negativeAcknowledged, setNegativeAcknowledged] = useState(false);
  const [state, formAction, pending] = useActionState(payExpenseAction, initialFinanceActionState);

  // نقد الموظف نقدي دائمًا وبلا حساب؛ تبديل المصدر يفرّغ كل ما يخصّ الحساب.
  const holderCash = paySource === "HOLDER_CASH";
  function choosePaySource(next: "HOLDER_CASH" | "ACCOUNT") {
    setPaySource(next);
    setAccountId("");
    setOpeningOrder("");
    setIncludedInOpening(false);
    setNegativeAcknowledged(false);
    if (next === "HOLDER_CASH") setMethod("CASH");
  }

  const branchAccounts = accounts.filter((account) => account.branchId === branchId);
  const usableAccounts = branchAccounts.length ? branchAccounts : accounts;
  const source = usableAccounts.find((account) => account.id === accountId) ?? null;
  const projected = source ? Number(source.balance) - Number(amount) : null;
  const needsWarning = projected !== null && projected < 0;
  const sameDayAsOpening = Boolean(source && source.openingDate === paymentDate);

  if (state.status === "success") return <div className="fin-alert fin-alert--success" role="status">{state.message}</div>;

  return (
    <form action={formAction} className="fin-form-stack">
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="expenseId" value={expenseId} />
      <input type="hidden" name="expectedRevision" value={revision} />
      <input type="hidden" name="source" value={paySource} />
      <input type="hidden" name="method" value={holderCash ? "CASH" : method} />
      <input type="hidden" name="accountId" value={!holderCash && method === "CASH" ? accountId : ""} />
      <input type="hidden" name="paymentDate" value={paymentDate} />
      <input type="hidden" name="expectedBalance" value={!holderCash && method === "CASH" ? source?.balance ?? "" : ""} />
      <input type="hidden" name="openingOrder" value={!holderCash && sameDayAsOpening ? openingOrder : ""} />
      <input type="hidden" name="includedInOpening" value={!holderCash && includedInOpening ? "yes" : "no"} />
      <input type="hidden" name="afterCountId" value="" />
      <input type="hidden" name="afterCount" value="no" />
      <input type="hidden" name="negativeAcknowledged" value={!holderCash && negativeAcknowledged ? "yes" : "no"} />

      <div className="fin-fields">
        <label className="field fin-field fin-field--wide">
          <span className="fin-field__label">مصدر الصرف</span>
          <select value={paySource} onChange={(event) => choosePaySource(event.target.value as "HOLDER_CASH" | "ACCOUNT")}>
            {PAY_SOURCES.map((option) => (<option key={option.value} value={option.value}>{option.label}</option>))}
          </select>
          <span className="fin-field__hint">{PAY_SOURCES.find((option) => option.value === paySource)?.hint ?? ""}</span>
        </label>
        {holderCash ? (
          <div className="fin-alert fin-alert--warning fin-field--wide" role="status">
            الرصيد لن يتحرك الآن. سيظهر المبلغ ضمن «مصروفات الفترة» ويُسوّى عند اعتماد التسوية القادمة.
          </div>
        ) : (
        <label className="field fin-field">
          <span className="fin-field__label">وسيلة الدفع</span>
          <select value={method} onChange={(event) => { setMethod(event.target.value); setAccountId(""); }}>
            {METHODS.map((option) => (<option key={option.value} value={option.value}>{option.label}</option>))}
          </select>
          <span className="fin-field__hint">غير النقدي لا يحرك النقد ولا يفترض رصيدًا بنكيًا.</span>
        </label>
        )}
        <label className="field fin-field">
          <span className="fin-field__label">تاريخ الدفع الفعلي</span>
          <input type="date" value={paymentDate} max={today} onChange={(event) => setPaymentDate(event.target.value)} />
          <span className="fin-field__hint">افتراضًا اليوم، وقابل للتغيير.</span>
        </label>
        {!holderCash && method === "CASH" ? (
          <>
            <label className="field fin-field">
              <span className="fin-field__label">مصدر النقد</span>
              <select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
                <option value="">— اختر حسابًا —</option>
                {usableAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {accountLabel(account.kind)}{account.holderName ? ` · ${account.holderName}` : ""} · {formatMoney(account.balance)}
                  </option>
                ))}
              </select>
              {source ? <span className="fin-field__hint">الرصيد الحالي: {formatMoney(source.balance)} · بعد الصرف: {formatMoney((Number(source.balance) - Number(amount)).toFixed(2))}</span> : null}
            </label>
            {sameDayAsOpening ? (
              <label className="field fin-field">
                <span className="fin-field__label">ترتيب الدفع في يوم الجرد</span>
                <select value={openingOrder} onChange={(event) => setOpeningOrder(event.target.value)}>
                  <option value="">— حدّد الترتيب —</option>
                  <option value="BEFORE">قبل الجرد</option>
                  <option value="AFTER">بعد الجرد</option>
                </select>
                <label className="fin-check">
                  <input type="checkbox" checked={includedInOpening} onChange={(event) => setIncludedInOpening(event.target.checked)} />
                  <span>هذا الدفع داخل رصيد الجرد المسجَّل (لا خصم جديد).</span>
                </label>
              </label>
            ) : null}
            {needsWarning ? (
              <label className="fin-check fin-field--wide">
                <input type="checkbox" checked={negativeAcknowledged} onChange={(event) => setNegativeAcknowledged(event.target.checked)} />
                <span>سيصبح الرصيد سالبًا؛ أقر بأنني راجعت الفرق.</span>
              </label>
            ) : null}
          </>
        ) : null}
        <label className="fin-check fin-field--wide">
          <input type="checkbox" name="actuallyPaid" value="yes" required />
          <span>أقر بأن المبلغ دُفع فعليًا في هذا التاريخ.</span>
        </label>
      </div>

      {state.status === "error" ? (
        <div className="fin-alert fin-alert--error" role="alert">
          {state.message}
          {state.details?.currentBalance ? ` الرصيد الحالي كما تراه قاعدة البيانات: ${state.details.currentBalance}.` : ""}
        </div>
      ) : null}

      <div className="fin-form-actions">
        <button
          type="submit"
          className="fin-button"
          disabled={
            pending ||
            (!holderCash &&
              ((method === "CASH" && !accountId) ||
                (sameDayAsOpening && !openingOrder) ||
                (needsWarning && !negativeAcknowledged)))
          }
        >
          {pending ? "جارٍ الحفظ…" : holderCash ? "تسجيل الصرف من نقد الموظف" : "تسجيل الصرف الفعلي"}
        </button>
      </div>
    </form>
  );
}

export function ReviewForm({ requestId, expenseId, revision }: { requestId: string; expenseId: string; revision: string }) {
  const [state, formAction, pending] = useActionState(requestExpenseReviewAction, initialFinanceActionState);
  if (state.status === "success") return <div className="fin-alert fin-alert--success" role="status">{state.message}</div>;
  return (
    <form action={formAction} className="fin-form-stack">
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="expenseId" value={expenseId} />
      <input type="hidden" name="expectedRevision" value={revision} />
      <div className="fin-fields">
        <label className="field fin-field">
          <span className="fin-field__label">المبلغ الصحيح من وجهة نظرك (اختياري)</span>
          <input inputMode="decimal" name="proposedAmount" placeholder="بدون" />
        </label>
        <label className="field fin-field fin-field--wide">
          <span className="fin-field__label">سبب المراجعة</span>
          <input name="reason" maxLength={300} required />
          <span className="fin-field__hint">طلب المراجعة لا يغيّر المبلغ ولا الرصيد ولا يُنشئ رد مال.</span>
        </label>
      </div>
      {state.status === "error" ? <div className="fin-alert fin-alert--error" role="alert">{state.message}</div> : null}
      <div className="fin-form-actions">
        <button type="submit" className="fin-button" disabled={pending}>{pending ? "جارٍ الحفظ…" : "إرسال طلب المراجعة"}</button>
      </div>
    </form>
  );
}
