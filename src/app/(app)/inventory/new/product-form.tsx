"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { CATEGORY_LABELS, PRODUCT_CATEGORIES, parseProductInput, productSku, type FieldErrors, type ProductInput, type ProductInputRaw } from "@/lib/inventory-validation";
import { createProductAction } from "../actions";
import { initialInventoryActionState, type InventoryActionState } from "../inventory-state";

type TaxOption = { id: string; code: string; name: string; rate: string };
type Props = { requestId: string; taxRates: TaxOption[] };

const FIELD_NAMES: Record<string, string> = {
  sku: "رمز الصنف", nameAr: "اسم الصنف", category: "التصنيف", brand: "العلامة التجارية", model: "الموديل",
  purchaseCost: "تكلفة الشراء", salePrice: "سعر البيع", taxRateId: "الضريبة", isSerialized: "السيريال", form: "النموذج",
};

export default function ProductForm({ requestId, taxRates }: Props) {
  const [values, setValues] = useState<ProductInputRaw>({ requestId, sku: "", nameAr: "", category: "", brand: "", model: "", purchaseCost: "", salePrice: "", taxRateId: "", isSerialized: false });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [review, setReview] = useState<ProductInput | null>(null);
  const [state, formAction, pending] = useActionState(createProductAction, initialInventoryActionState);
  const [dismissedError, setDismissedError] = useState<InventoryActionState | null>(null);

  function update<K extends keyof ProductInputRaw>(key: K, value: ProductInputRaw[K]) {
    setDismissedError(state);
    setValues((old) => ({ ...old, [key]: value, ...(key === "category" && value === "SERVICE" ? { isSerialized: false } : {}) }));
    setReview(null);
    setErrors((old) => { const next = { ...old }; delete next[key]; return next; });
  }

  function reviewValues() {
    const parsed = parseProductInput(values);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      setReview(null);
      const first = Object.keys(parsed.errors).find((key) => key !== "form");
      if (first) document.getElementById(`product-${first}`)?.focus();
      return;
    }
    setErrors({});
    setReview(parsed.value);
  }

  if (state.status === "success") {
    return <div className="inv-panel inv-success" role="status">
      <h2>تم حفظ الصنف</h2><p>{state.message}</p>
      <div className="inv-actions">
        {state.id && <Link className="inv-button" href={`/inventory/opening?productId=${encodeURIComponent(state.id)}`}>تسجيل رصيد لهذا الصنف</Link>}
        <a className="inv-button inv-button--secondary" href="/inventory/new">إضافة صنف آخر</a>
        <Link className="inv-button inv-button--text" href="/inventory">العودة إلى المخزون</Link>
      </div>
    </div>;
  }

  const taxName = review?.taxRateId ? taxRates.find((tax) => Number(tax.id) === review.taxRateId) : null;
  const fieldError = (key: string) => errors[key];
  const errorId = (key: string) => fieldError(key) ? `product-${key}-error` : undefined;

  return (
    <form className="inv-form-layout" action={formAction} noValidate onSubmit={(event) => { if (!review) { event.preventDefault(); reviewValues(); } }}>
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="reviewed" value={review ? "yes" : "no"} />
      <div className="inv-form-stack">
        {state.status === "error" && state !== dismissedError && <div className="inv-alert inv-alert--error" role="alert">
          <strong>{state.message}</strong>
          {state.fieldErrors && <ul>{Object.entries(state.fieldErrors).map(([key, message]) => <li key={key}>{FIELD_NAMES[key] ?? key}: {message}</li>)}</ul>}
        </div>}
        {errors.form && <div className="inv-alert inv-alert--error" role="alert">{errors.form}</div>}
        <section className="inv-panel" aria-labelledby="product-details-title">
          <div className="inv-panel__heading"><h2 id="product-details-title">بيانات الصنف</h2><p>الصنف يُضاف إلى الدليل المشترك لكل الفروع.</p></div>
          <div className="inv-panel__body inv-fields">
            <div className="inv-field inv-field--wide">
              <label htmlFor="product-nameAr">اسم الصنف *</label>
              <input id="product-nameAr" disabled={pending} name="nameAr" value={values.nameAr} onChange={(e) => update("nameAr", e.target.value)} maxLength={180} aria-invalid={!!fieldError("nameAr")} aria-describedby={errorId("nameAr")} />
              {fieldError("nameAr") && <p id="product-nameAr-error" className="inv-field__error">{fieldError("nameAr")}</p>}
            </div>
            <div className="inv-field">
              <label htmlFor="product-category">التصنيف *</label>
              <select id="product-category" disabled={pending} name="category" value={values.category} onChange={(e) => update("category", e.target.value)} aria-invalid={!!fieldError("category")} aria-describedby={errorId("category")}>
                <option value="">اختر التصنيف</option>
                {PRODUCT_CATEGORIES.map((category) => <option value={category} key={category}>{CATEGORY_LABELS[category]}</option>)}
              </select>
              {fieldError("category") && <p id="product-category-error" className="inv-field__error">{fieldError("category")}</p>}
            </div>
            <div className="inv-field">
              <label htmlFor="product-sku">رمز الصنف (SKU)</label>
              <input id="product-sku" disabled={pending} name="sku" dir="ltr" value={values.sku} onChange={(e) => update("sku", e.target.value)} maxLength={40} autoComplete="off" aria-invalid={!!fieldError("sku")} aria-describedby={errorId("sku") ?? "product-sku-hint"} />
              {fieldError("sku") ? <p id="product-sku-error" className="inv-field__error">{fieldError("sku")}</p> : <p id="product-sku-hint" className="inv-field__hint">اختياري؛ ينشئ النظام رمزًا إذا تركته فارغًا.</p>}
            </div>
            <div className="inv-field">
              <label htmlFor="product-brand">العلامة التجارية</label>
              <input id="product-brand" disabled={pending} name="brand" value={values.brand} onChange={(e) => update("brand", e.target.value)} maxLength={80} aria-invalid={!!fieldError("brand")} aria-describedby={errorId("brand")} />
              {fieldError("brand") && <p id="product-brand-error" className="inv-field__error">{fieldError("brand")}</p>}
            </div>
            <div className="inv-field">
              <label htmlFor="product-model">الموديل</label>
              <input id="product-model" disabled={pending} name="model" value={values.model} onChange={(e) => update("model", e.target.value)} maxLength={80} aria-invalid={!!fieldError("model")} aria-describedby={errorId("model")} />
              {fieldError("model") && <p id="product-model-error" className="inv-field__error">{fieldError("model")}</p>}
            </div>
            {values.category === "HEARING_AID" && <div className="inv-check inv-field--wide"><span><strong>السيريال مطلوب لكل سماعة</strong><small>ستدخل رقم كل جهاز عند تسجيل الرصيد الافتتاحي.</small></span></div>}
            {values.category && values.category !== "HEARING_AID" && values.category !== "SERVICE" && <label className="inv-check inv-field--wide" htmlFor="product-isSerialized">
              <input id="product-isSerialized" disabled={pending} type="checkbox" name="isSerialized" value="yes" checked={values.isSerialized} onChange={(e) => update("isSerialized", e.target.checked)} />
              <span><strong>هذا الصنف يتطلب رقمًا تسلسليًا لكل قطعة</strong><small>فعّل الخيار إذا كانت القطع تُتبع بأرقام منفردة.</small></span>
            </label>}
          </div>
        </section>

        <section className="inv-panel" aria-labelledby="product-pricing-title">
          <div className="inv-panel__heading"><h2 id="product-pricing-title">الأسعار والضريبة</h2><p>سعر البيع المسجّل موحّد لكل الفروع.</p></div>
          <div className="inv-panel__body inv-fields">
            <div className="inv-field">
              <label htmlFor="product-purchaseCost">تكلفة الشراء (ج.م) *</label>
              <input id="product-purchaseCost" disabled={pending} name="purchaseCost" dir="ltr" inputMode="decimal" value={values.purchaseCost} onChange={(e) => update("purchaseCost", e.target.value)} placeholder="0.00" aria-invalid={!!fieldError("purchaseCost")} aria-describedby={errorId("purchaseCost")} />
              {fieldError("purchaseCost") && <p id="product-purchaseCost-error" className="inv-field__error">{fieldError("purchaseCost")}</p>}
            </div>
            <div className="inv-field">
              <label htmlFor="product-salePrice">سعر البيع الموحد (ج.م) *</label>
              <input id="product-salePrice" disabled={pending} name="salePrice" dir="ltr" inputMode="decimal" value={values.salePrice} onChange={(e) => update("salePrice", e.target.value)} placeholder="0.00" aria-invalid={!!fieldError("salePrice")} aria-describedby={errorId("salePrice")} />
              {fieldError("salePrice") && <p id="product-salePrice-error" className="inv-field__error">{fieldError("salePrice")}</p>}
            </div>
            <div className="inv-field inv-field--wide">
              <label htmlFor="product-taxRateId">معدل الضريبة</label>
              <select id="product-taxRateId" disabled={pending} name="taxRateId" value={values.taxRateId} onChange={(e) => update("taxRateId", e.target.value)} aria-invalid={!!fieldError("taxRateId")} aria-describedby={errorId("taxRateId") ?? "product-taxRateId-hint"}>
                <option value="">غير محدد بعد</option>
                {taxRates.map((tax) => <option value={tax.id} key={tax.id}>{tax.name} — {tax.rate}% ({tax.code})</option>)}
              </select>
              {fieldError("taxRateId") ? <p id="product-taxRateId-error" className="inv-field__error">{fieldError("taxRateId")}</p> : <p id="product-taxRateId-hint" className="inv-field__hint">اختر المعدل المناسب بعد مراجعته مع المحاسب؛ لا تُحسب فاتورة في هذه الخطوة.</p>}
            </div>
          </div>
        </section>

        {review && <section className="inv-review" aria-labelledby="product-review-title" aria-live="polite">
          <h2 id="product-review-title">راجع بيانات الصنف</h2><p>لن يُحفظ شيء حتى تضغط «تأكيد وحفظ».</p>
          <dl>
            <div><dt>الاسم</dt><dd>{review.nameAr}</dd></div><div><dt>التصنيف</dt><dd>{CATEGORY_LABELS[review.category]}</dd></div>
            <div><dt>رمز الصنف{review.sku ? "" : " (تلقائي)"}</dt><dd dir="ltr">{productSku(review)}</dd></div><div><dt>العلامة والموديل</dt><dd>{[review.brand, review.model].filter(Boolean).join(" · ") || "غير محدد"}</dd></div>
            <div><dt>تكلفة الشراء</dt><dd>{review.purchaseCost} ج.م</dd></div><div><dt>سعر البيع الموحد</dt><dd>{review.salePrice} ج.م</dd></div>
            <div><dt>الضريبة</dt><dd>{taxName ? `${taxName.name} (${taxName.rate}%)` : "غير محدد"}</dd></div><div><dt>تتبع السيريال</dt><dd>{review.isSerialized ? "مطلوب لكل قطعة" : "غير مطلوب"}</dd></div>
          </dl>
        </section>}
        <div className="inv-form-actions">
          {!review ? <button type="button" className="inv-button" onClick={(event) => { event.preventDefault(); reviewValues(); }} disabled={pending}>مراجعة البيانات</button> : <><button type="submit" className="inv-button" disabled={pending}>{pending ? "جارٍ الحفظ…" : "تأكيد وحفظ الصنف"}</button><button type="button" className="inv-button inv-button--secondary" onClick={() => setReview(null)} disabled={pending}>تعديل البيانات</button></>}
          {pending ? <span className="inv-button inv-button--text" aria-disabled="true">انتظر انتهاء الحفظ</span> : <Link className="inv-button inv-button--text" href="/inventory">إلغاء</Link>}
        </div>
      </div>
      <aside className="inv-side"><h2>قبل البدء</h2><ul><li>المدير والمحاسب فقط يمكنهما إضافة الأصناف.</li><li>السماعات تتطلب رقمًا تسلسليًا لكل جهاز عند تسجيل الرصيد.</li><li>إضافة الصنف لا تغيّر أي رصيد؛ يُسجّل رصيد كل مستودع على حدة.</li><li>سعر البيع هنا واحد لكل الفروع.</li></ul></aside>
    </form>
  );
}
