"use client";

import { useActionState, useState } from "react";

import {
  createCategoryAction, createFieldAction, createTypeAction,
  setCategoryActiveAction, setFieldActiveAction, setTypeActiveAction,
  updateCategoryAction, updateFieldAction, updateTypeAction,
} from "./actions";
import { initialCatalogActionState, type CatalogActionState } from "./catalog-state";

type RowAction = (previous: CatalogActionState, formData: FormData) => Promise<CatalogActionState>;
type EditProps = { id: string; nameLabel: string; initialName: string; initialSort: number; initialRequired?: boolean; submitLabel: string };
type ActiveProps = { id: string; active: boolean; reasonLabel: string };
type Option = { id: string; label: string };

function newRequestId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function Alert({ state }: { state: CatalogActionState }) {
  if (state.status === "idle") return null;
  const tone = state.status === "error" ? "inv-alert--error" : "inv-alert--success";
  return <div className={`inv-alert ${tone}`} role="status"><strong>{state.message}</strong>{state.fieldErrors && <ul>{Object.entries(state.fieldErrors).map(([key, value]) => <li key={key}>{value}</li>)}</ul>}</div>;
}

/** كل تغيير يُرسل سببًا واضحًا، ولا يُحذف أي صنف: الإيقاف فقط. */
export function CatalogCreateForms({ categories, types }: { categories: Option[]; types: Option[] }) {
  return <div className="sale-stack">
    <section className="inv-panel" aria-labelledby="catalog-add-category"><div className="inv-panel__heading"><h2 id="catalog-add-category">إضافة تصنيف</h2><p>مثل: بطاريات، قوالب، صيانة، سماعة، أخرى.</p></div>
      <div className="inv-panel__body"><CategoryForm /></div></section>
    <section className="inv-panel" aria-labelledby="catalog-add-type"><div className="inv-panel__heading"><h2 id="catalog-add-type">إضافة نوع داخل تصنيف</h2><p>مثل: مقاس ١٣ ضمن البطاريات، أو «سوفت» ضمن القوالب.</p></div>
      <div className="inv-panel__body"><TypeForm categories={categories} /></div></section>
    <section className="inv-panel" aria-labelledby="catalog-add-field"><div className="inv-panel__heading"><h2 id="catalog-add-field">إضافة حقل لنوع</h2><p>مثل: «نوع السماعة» و«بيان الحالة» و«بيان الصيانة» لنوع الصيانة.</p></div>
      <div className="inv-panel__body"><FieldForm types={types} /></div></section>
  </div>;
}

function CategoryForm() {
  const [requestId, setRequestId] = useState(newRequestId);
  const [state, action, pending] = useActionState(createCategoryAction, initialCatalogActionState);
  return <form action={action} className="inv-fields" onSubmit={() => setRequestId(newRequestId())}>
    <input type="hidden" name="requestId" value={requestId} /><input type="hidden" name="reviewed" value="yes" />
    <div className="inv-field"><label htmlFor="cat-code">الرمز (إنجليزي)</label><input id="cat-code" name="code" dir="ltr" maxLength={40} required disabled={pending} placeholder="BATTERY" /></div>
    <div className="inv-field"><label htmlFor="cat-name">الاسم بالعربية *</label><input id="cat-name" name="nameAr" maxLength={120} required disabled={pending} /></div>
    <div className="inv-field"><label htmlFor="cat-sort">ترتيب العرض</label><input id="cat-sort" name="sortOrder" dir="ltr" inputMode="numeric" defaultValue="0" disabled={pending} /></div>
    <div className="inv-form-actions"><button type="submit" className="inv-button" disabled={pending}>{pending ? "جارٍ الحفظ…" : "إضافة التصنيف"}</button></div>
    <Alert state={state} />
  </form>;
}

function TypeForm({ categories }: { categories: Option[] }) {
  const [requestId, setRequestId] = useState(newRequestId);
  const [state, action, pending] = useActionState(createTypeAction, initialCatalogActionState);
  return <form action={action} className="inv-fields" onSubmit={() => setRequestId(newRequestId())}>
    <input type="hidden" name="requestId" value={requestId} /><input type="hidden" name="reviewed" value="yes" />
    <div className="inv-field"><label htmlFor="type-category">التصنيف *</label><select id="type-category" name="categoryId" required disabled={pending} defaultValue="">
      <option value="">اختر التصنيف</option>{categories.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></div>
    <div className="inv-field"><label htmlFor="type-name">الاسم بالعربية *</label><input id="type-name" name="nameAr" maxLength={120} required disabled={pending} /></div>
    <div className="inv-field"><label htmlFor="type-sort">ترتيب العرض</label><input id="type-sort" name="sortOrder" dir="ltr" inputMode="numeric" defaultValue="0" disabled={pending} /></div>
    <div className="inv-form-actions"><button type="submit" className="inv-button" disabled={pending}>{pending ? "جارٍ الحفظ…" : "إضافة النوع"}</button></div>
    <Alert state={state} />
  </form>;
}

function FieldForm({ types }: { types: Option[] }) {
  const [requestId, setRequestId] = useState(newRequestId);
  const [state, action, pending] = useActionState(createFieldAction, initialCatalogActionState);
  return <form action={action} className="inv-fields" onSubmit={() => setRequestId(newRequestId())}>
    <input type="hidden" name="requestId" value={requestId} /><input type="hidden" name="reviewed" value="yes" />
    <div className="inv-field"><label htmlFor="field-type">النوع *</label><select id="field-type" name="typeId" required disabled={pending} defaultValue="">
      <option value="">اختر النوع</option>{types.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></div>
    <div className="inv-field"><label htmlFor="field-key">المفتاح (إنجليزي) *</label><input id="field-key" name="fieldKey" dir="ltr" maxLength={60} required disabled={pending} placeholder="device_type" /></div>
    <div className="inv-field"><label htmlFor="field-label">العنوان بالعربية *</label><input id="field-label" name="labelAr" maxLength={120} required disabled={pending} placeholder="نوع السماعة" /></div>
    <div className="inv-field"><label htmlFor="field-required">لازم للموظف؟</label><select id="field-required" name="isRequired" defaultValue="yes" disabled={pending}>
      <option value="yes">لازم</option><option value="no">اختياري</option></select></div>
    <div className="inv-field"><label htmlFor="field-sort">ترتيب العرض</label><input id="field-sort" name="sortOrder" dir="ltr" inputMode="numeric" defaultValue="0" disabled={pending} /></div>
    <div className="inv-form-actions"><button type="submit" className="inv-button" disabled={pending}>{pending ? "جارٍ الحفظ…" : "إضافة الحقل"}</button></div>
    <Alert state={state} />
  </form>;
}

/** تعديل الاسم والترتيب: يحفظ الأصل في السجل قبل التعديل. */
function RowEditForm({
  action, id, nameLabel, initialName, initialSort, withRequired = false, initialRequired = true, submitLabel,
}: {
  action: RowAction; id: string; nameLabel: string; initialName: string; initialSort: number;
  withRequired?: boolean; initialRequired?: boolean; submitLabel: string;
}) {
  const [requestId, setRequestId] = useState(newRequestId);
  const [state, formAction, pending] = useActionState(action, initialCatalogActionState);
  return <form action={formAction} className="sale-inline" onSubmit={() => setRequestId(newRequestId())}>
    <input type="hidden" name="requestId" value={requestId} /><input type="hidden" name="id" value={id} /><input type="hidden" name="reviewed" value="yes" />
    <div className="inv-field"><label>الاسم</label><input name="nameAr" defaultValue={initialName} maxLength={120} required disabled={pending} aria-label={nameLabel} /></div>
    <div className="inv-field"><label>الترتيب</label><input name="sortOrder" dir="ltr" inputMode="numeric" defaultValue={String(initialSort)} disabled={pending} aria-label="ترتيب العرض" /></div>
    {withRequired && <div className="inv-field"><label>اللزوم</label><select name="isRequired" defaultValue={initialRequired ? "yes" : "no"} disabled={pending} aria-label="لازم للموظف">
      <option value="yes">لازم</option><option value="no">اختياري</option></select></div>}
    <button type="submit" className="inv-button inv-button--text" disabled={pending}>{pending ? "…" : submitLabel}</button>
    {state.status !== "idle" && <p className={state.status === "error" ? "sale-note sale-note--error" : "sale-note"}>{state.message}</p>}
  </form>;
}

/** الإيقاف والتشغيل بسبب: لا حذف لأي صنف، والسبب يُحفظ في السجل. */
function RowActiveForm({ action, id, active, reasonLabel }: { action: RowAction; id: string; active: boolean; reasonLabel: string }) {
  const [requestId, setRequestId] = useState(newRequestId);
  const [state, formAction, pending] = useActionState(action, initialCatalogActionState);
  return <form action={formAction} className="sale-inline" onSubmit={() => setRequestId(newRequestId())}>
    <input type="hidden" name="requestId" value={requestId} /><input type="hidden" name="id" value={id} />
    <input type="hidden" name="active" value={active ? "no" : "yes"} />
    <div className="inv-field"><label>السبب</label><input name="reason" maxLength={300} required disabled={pending} aria-label={reasonLabel} placeholder={active ? "سبب الإيقاف" : "سبب إعادة التشغيل"} /></div>
    <button type="submit" className="inv-button inv-button--secondary" disabled={pending}>{pending ? "…" : active ? "إيقاف" : "تشغيل"}</button>
    {state.status !== "idle" && <p className={state.status === "error" ? "sale-note sale-note--error" : "sale-note"}>{state.message}</p>}
  </form>;
}

// غلافات رقيقة: الإجراء يستورد مباشرة من ملف "use server" داخل وحدة العميل،
// فلا تُمَّر إجراءات الخادم عبر خصائص من مكوّن الخادم.
export function CategoryEditForm(props: EditProps) { return <RowEditForm {...props} action={updateCategoryAction} />; }
export function TypeEditForm(props: EditProps) { return <RowEditForm {...props} action={updateTypeAction} />; }
export function FieldEditForm(props: EditProps) { return <RowEditForm {...props} action={updateFieldAction} withRequired />; }
export function CategoryActiveForm(props: ActiveProps) { return <RowActiveForm {...props} action={setCategoryActiveAction} />; }
export function TypeActiveForm(props: ActiveProps) { return <RowActiveForm {...props} action={setTypeActiveAction} />; }
export function FieldActiveForm(props: ActiveProps) { return <RowActiveForm {...props} action={setFieldActiveAction} />; }
