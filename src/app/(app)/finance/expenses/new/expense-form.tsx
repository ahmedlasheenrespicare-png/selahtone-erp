"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { createExpenseAction } from "../../actions";
import { initialFinanceActionState } from "../../finance-state";

export type BranchOption = { id: string; name: string };
export type CategoryOption = { id: string; name: string; active: boolean };
type Props = { requestId: string; today: string; branches: BranchOption[]; categories: CategoryOption[] };

export default function ExpenseForm({ requestId, today, branches, categories }: Props) {
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(today);
  const [description, setDescription] = useState("");
  const [beneficiary, setBeneficiary] = useState("");
  const [documentNumber, setDocumentNumber] = useState("");
  const [taxAmount, setTaxAmount] = useState("");
  const [review, setReview] = useState(false);
  const [state, formAction, pending] = useActionState(createExpenseAction, initialFinanceActionState);

  const amountNumber = Number(amount);
  const amountValid = amount.trim() !== "" && Number.isFinite(amountNumber) && amountNumber > 0;
  const taxNumber = taxAmount.trim() === "" ? 0 : Number(taxAmount);
  const taxValid = taxAmount.trim() === "" || (Number.isFinite(taxNumber) && taxNumber >= 0 && taxNumber <= (Number.isFinite(amountNumber) ? amountNumber : 0));
  const activeCategories = categories.filter((category) => category.active);
  const ready = Boolean(branchId) && Boolean(categoryId) && amountValid && taxValid &&
    /^\d{4}-\d{2}-\d{2}$/.test(expenseDate) && description.trim().length > 0;

  if (state.status === "success") {
    return (
      <div className="fin-panel fin-success" role="status">
        <h2>تم تسجيل المصروف</h2>
        <p>{state.message}</p>
        <div className="fin-actions">
          <a className="fin-button" href="/finance/expenses/new">تسجيل مصروف آخر</a>
          <Link className="fin-button fin-button--secondary" href="/finance/expenses">سجل المصروفات</Link>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="fin-form-stack">
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="branchId" value={branchId} />
      <input type="hidden" name="categoryId" value={categoryId} />
      <input type="hidden" name="amount" value={amount} />
      <input type="hidden" name="expenseDate" value={expenseDate} />
      <input type="hidden" name="description" value={description} />
      <input type="hidden" name="beneficiary" value={beneficiary} />
      <input type="hidden" name="documentNumber" value={documentNumber} />
      <input type="hidden" name="taxAmount" value={taxAmount} />

      <div className="fin-panel">
        <div className="fin-panel__heading">
          <h2>بيانات المصروف</h2>
          <p>المبلغ الإجمالي يشمل الضريبة إن أُدخلت. المستفيد ورقم المستند اختياريان.</p>
        </div>
        <div className="fin-panel__body">
          <div className="fin-fields">
            <label className="field fin-field">
              <span className="fin-field__label">الفرع</span>
              <select value={branchId} onChange={(event) => { setBranchId(event.target.value); setReview(false); }}>
                {branches.map((branch) => (<option key={branch.id} value={branch.id}>{branch.name}</option>))}
              </select>
            </label>
            <label className="field fin-field">
              <span className="fin-field__label">البند</span>
              <select value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setReview(false); }}>
                <option value="">— اختر بندًا نشطًا —</option>
                {activeCategories.map((category) => (<option key={category.id} value={category.id}>{category.name}</option>))}
              </select>
              {activeCategories.length === 0 ? <span className="fin-field__error">لا يوجد بند نشط؛ أضف بندًا أولًا.</span> : null}
            </label>
            <label className="field fin-field">
              <span className="fin-field__label">المبلغ الإجمالي</span>
              <input inputMode="decimal" value={amount} onChange={(event) => { setAmount(event.target.value); setReview(false); }} placeholder="0.00" />
              {amount.trim() !== "" && !amountValid ? <span className="fin-field__error">أدخل مبلغًا أكبر من صفر.</span> : null}
            </label>
            <label className="field fin-field">
              <span className="fin-field__label">ضريبة (اختياري)</span>
              <input inputMode="decimal" value={taxAmount} onChange={(event) => { setTaxAmount(event.target.value); setReview(false); }} placeholder="بدون" />
              <span className="fin-field__hint">تُدخل يدويًا من المستند. الفارغ ليس صفرًا ولا إعفاءً، ولا حساب آلي.</span>
              {!taxValid ? <span className="fin-field__error">الضريبة لا تتجاوز المبلغ الإجمالي.</span> : null}
            </label>
            <label className="field fin-field">
              <span className="fin-field__label">تاريخ المصروف</span>
              <input type="date" value={expenseDate} max={today} onChange={(event) => { setExpenseDate(event.target.value); setReview(false); }} />
              <span className="fin-field__hint">وقت التسجيل يُحفظ تلقائيًا ومنفصلًا عن هذا التاريخ.</span>
            </label>
            <div className="field fin-field" />
            <label className="field fin-field fin-field--wide">
              <span className="fin-field__label">الوصف</span>
              <input value={description} maxLength={180} onChange={(event) => { setDescription(event.target.value); setReview(false); }} />
            </label>
            <label className="field fin-field">
              <span className="fin-field__label">المستفيد (اختياري)</span>
              <input value={beneficiary} maxLength={120} onChange={(event) => setBeneficiary(event.target.value)} />
            </label>
            <label className="field fin-field">
              <span className="fin-field__label">رقم المستند (اختياري)</span>
              <input value={documentNumber} maxLength={120} onChange={(event) => setDocumentNumber(event.target.value)} />
            </label>
          </div>
        </div>
      </div>

      {state.status === "error" ? <div className="fin-alert fin-alert--error" role="alert">{state.message}</div> : null}

      {review ? (
        <div className="fin-review" role="status">
          <h2>راجع قبل الحفظ</h2>
          <ul>
            <li>الفرع: {branches.find((branch) => branch.id === branchId)?.name ?? "—"}</li>
            <li>البند: {categories.find((category) => category.id === categoryId)?.name ?? "—"}</li>
            <li>المبلغ: {amount}{taxAmount.trim() ? ` (منها ضريبة ${taxAmount})` : ""}</li>
            <li>تاريخ المصروف: {expenseDate}</li>
            <li>الوصف: {description}</li>
          </ul>
          <p className="fin-field__hint">يُسجَّل المصروف بانتظار الاعتماد؛ لا يُصرف إلا بخطوة منفصلة.</p>
        </div>
      ) : null}

      <div className="fin-form-actions">
        {!review ? (
          <button type="button" className="fin-button" disabled={!ready} onClick={() => setReview(true)}>مراجعة</button>
        ) : (
          <button type="submit" className="fin-button" disabled={pending || !ready}>{pending ? "جارٍ الحفظ…" : "تأكيد التسجيل"}</button>
        )}
        <Link className="fin-button fin-button--text" href="/finance/expenses">إلغاء</Link>
      </div>
    </form>
  );
}
