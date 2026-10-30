"use client";

import { useActionState, useState } from "react";
import { createCategoryAction, editCategoryAction } from "../actions";
import { initialFinanceActionState } from "../finance-state";

export type CategoryOption = { id: string; code: string; name: string; active: boolean; revision: number; snapshot: string };

export function CreateCategoryForm({ requestId }: { requestId: string }) {
  const [name, setName] = useState("");
  const [state, formAction, pending] = useActionState(createCategoryAction, initialFinanceActionState);
  if (state.status === "success") {
    return <div className="fin-alert fin-alert--success" role="status">{state.message}</div>;
  }
  return (
    <form action={formAction} className="fin-form-stack">
      <input type="hidden" name="requestId" value={requestId} />
      <div className="fin-fields">
        <label className="field fin-field">
          <span className="fin-field__label">اسم البند</span>
          <input name="name" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} required />
          <span className="fin-field__hint">يُضاف بندًا جديدًا; البنود القديمة لا تُنسخ ولا تُعاد تسميتها ضمنيًا.</span>
        </label>
      </div>
      {state.status === "error" ? <div className="fin-alert fin-alert--error" role="alert">{state.message}</div> : null}
      <div className="fin-form-actions">
        <button type="submit" className="fin-button" disabled={pending || name.trim().length === 0}>
          {pending ? "جارٍ الحفظ…" : "إضافة البند"}
        </button>
      </div>
    </form>
  );
}

export function EditCategoryForm({ requestId, category }: { requestId: string; category: CategoryOption }) {
  const [name, setName] = useState(category.name);
  const [active, setActive] = useState(category.active);
  const [reason, setReason] = useState("");
  const [state, formAction, pending] = useActionState(editCategoryAction, initialFinanceActionState);
  const changed = name.trim() !== category.name || active !== category.active;

  if (state.status === "success") {
    return <div className="fin-alert fin-alert--success" role="status">{state.message}</div>;
  }
  return (
    <form action={formAction} className="fin-form-stack">
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="categoryId" value={category.id} />
      <input type="hidden" name="expectedSnapshot" value={category.snapshot} />
      <input type="hidden" name="name" value={name} />
      <input type="hidden" name="active" value={active ? "yes" : "no"} />
      <div className="fin-fields">
        <label className="field fin-field">
          <span className="fin-field__label">اسم البند</span>
          <input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
          <span className="fin-field__hint">الرمز {category.code} والإصدار {category.revision} محفوظان.</span>
        </label>
        <label className="field fin-field">
          <span className="fin-field__label">الحالة</span>
          <select value={active ? "yes" : "no"} onChange={(event) => setActive(event.target.value === "yes")}>
            <option value="yes">نشط</option>
            <option value="no">موقوف</option>
          </select>
          <span className="fin-field__hint">الإيقاف يمنع المصروفات الجديدة فقط، ولا يحذف البند أو تاريخه.</span>
        </label>
        <label className="field fin-field fin-field--wide">
          <span className="fin-field__label">سبب التعديل</span>
          <input name="reason" value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} required />
        </label>
      </div>
      {state.status === "error" ? <div className="fin-alert fin-alert--error" role="alert">{state.message}</div> : null}
      <div className="fin-form-actions">
        <button type="submit" className="fin-button" disabled={pending || !changed || reason.trim().length === 0}>
          {pending ? "جارٍ الحفظ…" : "حفظ التعديل"}
        </button>
      </div>
    </form>
  );
}
