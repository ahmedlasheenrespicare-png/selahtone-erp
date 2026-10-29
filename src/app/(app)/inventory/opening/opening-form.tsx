"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { MAX_SERIALS_PER_OPENING, parseOpeningInput, type FieldErrors, type OpeningInput, type OpeningInputRaw } from "@/lib/inventory-validation";
import { createOpeningAction } from "../actions";
import { initialInventoryActionState, type InventoryActionState } from "../inventory-state";

type ProductOption = { id: string; name: string; sku: string; needsSerials: boolean; purchaseCost: string };
type WarehouseOption = { id: string; name: string; code: string; branch: string };
type Props = { requestId: string; initialProductId: string; products: ProductOption[]; warehouses: WarehouseOption[] };

const FIELD_NAMES: Record<string, string> = { productId: "الصنف", warehouseId: "المستودع", quantity: "الكمية", unitCost: "تكلفة الوحدة", serialNumbers: "الأرقام التسلسلية", form: "النموذج" };

export default function OpeningForm({ requestId, initialProductId, products, warehouses }: Props) {
  const [values, setValues] = useState<OpeningInputRaw>({ requestId, productId: initialProductId, warehouseId: "", quantity: "", unitCost: "", serialNumbers: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [review, setReview] = useState<OpeningInput | null>(null);
  const [state, formAction, pending] = useActionState(createOpeningAction, initialInventoryActionState);
  const [dismissedError, setDismissedError] = useState<InventoryActionState | null>(null);
  const selectedProduct = products.find((product) => product.id === values.productId);

  function update<K extends keyof OpeningInputRaw>(key: K, value: OpeningInputRaw[K]) {
    setDismissedError(state);
    setValues((old) => key === "productId" ? { ...old, productId: value as string, quantity: "", unitCost: "", serialNumbers: "" } : { ...old, [key]: value });
    setReview(null);
    setErrors((old) => { const next = { ...old }; delete next[key]; if (key === "productId") { delete next.quantity; delete next.unitCost; delete next.serialNumbers; } return next; });
  }

  function reviewValues() {
    const parsed = parseOpeningInput(values, selectedProduct?.needsSerials ?? false);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      setReview(null);
      const first = Object.keys(parsed.errors).find((key) => key !== "form");
      if (first) document.getElementById(`opening-${first}`)?.focus();
      return;
    }
    setErrors({});
    setReview(parsed.value);
  }

  if (state.status === "success") {
    return <div className="inv-panel inv-success" role="status">
      <h2>تم تسجيل الرصيد</h2><p>{state.message}</p>
      <div className="inv-actions"><a className="inv-button" href="/inventory/opening">تسجيل رصيد آخر</a><Link className="inv-button inv-button--secondary" href="/inventory/serials">عرض السيريالات</Link><Link className="inv-button inv-button--text" href="/inventory">العودة إلى المخزون</Link></div>
    </div>;
  }

  const reviewProduct = review && products.find((product) => product.id === review.productId);
  const reviewWarehouse = review && warehouses.find((warehouse) => warehouse.id === review.warehouseId);
  const fieldError = (key: string) => errors[key];
  const errorId = (key: string) => fieldError(key) ? `opening-${key}-error` : undefined;
  const enteredSerials = values.serialNumbers.split(/\r?\n/).filter((line) => line.trim()).length;

  return (
    <form className="inv-form-layout" action={formAction} noValidate onSubmit={(event) => { if (!review) { event.preventDefault(); reviewValues(); } }}>
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="reviewed" value={review ? "yes" : "no"} />
      <div className="inv-form-stack">
        {state.status === "error" && state !== dismissedError && <div className="inv-alert inv-alert--error" role="alert"><strong>{state.message}</strong>{state.fieldErrors && <ul>{Object.entries(state.fieldErrors).map(([key, message]) => <li key={key}>{FIELD_NAMES[key] ?? key}: {message}</li>)}</ul>}</div>}
        {errors.form && <div className="inv-alert inv-alert--error" role="alert">{errors.form}</div>}
        <div className="inv-alert inv-alert--warning"><strong>لأرصدة البداية فقط:</strong> لا يستبدل هذا النموذج رصيدًا مسجلًا، حتى لو كان صفرًا. لا يوجد تعديل أو تصحيح من هذه الشاشة بعد الحفظ.</div>
        <section className="inv-panel" aria-labelledby="opening-details-title">
          <div className="inv-panel__heading"><h2 id="opening-details-title">الصنف والمستودع</h2><p>اختر الصنف والفرع الذي توجد به الكمية الفعلية.</p></div>
          <div className="inv-panel__body inv-fields">
            <div className="inv-field inv-field--wide">
              <label htmlFor="opening-productId">الصنف *</label>
              <select id="opening-productId" disabled={pending} name="productId" value={values.productId} onChange={(e) => update("productId", e.target.value)} aria-invalid={!!fieldError("productId")} aria-describedby={errorId("productId")}>
                <option value="">اختر الصنف</option>{products.map((product) => <option value={product.id} key={product.id}>{product.name} — {product.sku}</option>)}
              </select>
              {fieldError("productId") && <p id="opening-productId-error" className="inv-field__error">{fieldError("productId")}</p>}
            </div>
            <div className="inv-field inv-field--wide">
              <label htmlFor="opening-warehouseId">الفرع والمستودع *</label>
              <select id="opening-warehouseId" disabled={pending} name="warehouseId" value={values.warehouseId} onChange={(e) => update("warehouseId", e.target.value)} aria-invalid={!!fieldError("warehouseId")} aria-describedby={errorId("warehouseId")}>
                <option value="">اختر المستودع</option>{warehouses.map((warehouse) => <option value={warehouse.id} key={warehouse.id}>{warehouse.branch} — {warehouse.name} ({warehouse.code})</option>)}
              </select>
              {fieldError("warehouseId") && <p id="opening-warehouseId-error" className="inv-field__error">{fieldError("warehouseId")}</p>}
            </div>
            <div className="inv-field">
              <label htmlFor="opening-quantity">الكمية الفعلية *</label>
              <input id="opening-quantity" disabled={pending} name="quantity" inputMode="decimal" dir="ltr" value={values.quantity} onChange={(e) => update("quantity", e.target.value)} placeholder="0" aria-invalid={!!fieldError("quantity")} aria-describedby={errorId("quantity") ?? "opening-quantity-hint"} />
              {fieldError("quantity") ? <p id="opening-quantity-error" className="inv-field__error">{fieldError("quantity")}</p> : <p id="opening-quantity-hint" className="inv-field__hint">أدخل كمية أكبر من صفر. للأجهزة ذات السيريال يجب أن تكون عددًا صحيحًا.</p>}
            </div>
            <div className="inv-field">
              <label htmlFor="opening-unitCost">متوسط تكلفة الوحدة (ج.م) *</label>
              <input id="opening-unitCost" disabled={pending} name="unitCost" inputMode="decimal" dir="ltr" value={values.unitCost} onChange={(e) => update("unitCost", e.target.value)} placeholder="0.00" aria-invalid={!!fieldError("unitCost")} aria-describedby={errorId("unitCost") ?? "opening-unitCost-hint"} />
              {fieldError("unitCost") ? <p id="opening-unitCost-error" className="inv-field__error">{fieldError("unitCost")}</p> : <p id="opening-unitCost-hint" className="inv-field__hint">تُستخدم لحساب قيمة المخزون.{selectedProduct && ` تكلفة الشراء في دليل الصنف: ${selectedProduct.purchaseCost} ج.م.`}</p>}
            </div>
          </div>
        </section>
        {selectedProduct?.needsSerials && <section className="inv-panel" aria-labelledby="serial-entry-title">
          <div className="inv-panel__heading"><h2 id="serial-entry-title">الأرقام التسلسلية</h2><p>أدخل رقمًا لكل جهاز، كل رقم في سطر مستقل.</p></div>
          <div className="inv-panel__body"><div className="inv-field">
            <label htmlFor="opening-serialNumbers">السيريالات * <span className="inv-field__hint">({enteredSerials} مُدخل)</span></label>
            <textarea id="opening-serialNumbers" disabled={pending} name="serialNumbers" dir="ltr" value={values.serialNumbers} onChange={(e) => update("serialNumbers", e.target.value)} autoComplete="off" spellCheck={false} placeholder={'SN-001\nSN-002'} aria-invalid={!!fieldError("serialNumbers")} aria-describedby={errorId("serialNumbers") ?? "opening-serialNumbers-hint"} />
            {fieldError("serialNumbers") ? <p id="opening-serialNumbers-error" className="inv-field__error">{fieldError("serialNumbers")}</p> : <p id="opening-serialNumbers-hint" className="inv-field__hint">يجب أن يساوي عدد الأرقام عدد الأجهزة؛ لا يتكرر الرقم بين الفروع. الحد {MAX_SERIALS_PER_OPENING} في الرصيد الواحد.</p>}
          </div></div>
        </section>}
        {review && <section className="inv-review" aria-labelledby="opening-review-title" aria-live="polite">
          <h2 id="opening-review-title">راجع الرصيد قبل الحفظ</h2><p>لن يُحفظ شيء حتى تؤكد. لا يمكن تعديل هذا الرصيد من هنا بعد الحفظ.</p>
          <dl>
            <div><dt>الصنف</dt><dd>{reviewProduct?.name} ({reviewProduct?.sku})</dd></div>
            <div><dt>الفرع والمستودع</dt><dd>{reviewWarehouse?.branch} — {reviewWarehouse?.name}</dd></div>
            <div><dt>الكمية</dt><dd>{review.quantity}</dd></div><div><dt>متوسط تكلفة الوحدة</dt><dd>{review.unitCost} ج.م</dd></div>
            <div><dt>الأرقام التسلسلية</dt><dd>{review.serials.length ? `${review.serials.length} رقم` : "غير مطلوبة لهذا الصنف"}</dd></div>
          </dl>
          {review.serials.length > 0 && <div className="inv-review__serials" dir="ltr" role="region" aria-label="الأرقام التسلسلية للمراجعة" tabIndex={0}>{review.serials.map((serial) => serial.number).join("\n")}</div>}
        </section>}
        <div className="inv-form-actions">
          {!review ? <button type="button" className="inv-button" onClick={(event) => { event.preventDefault(); reviewValues(); }} disabled={pending}>مراجعة الرصيد</button> : <><button type="submit" className="inv-button" disabled={pending}>{pending ? "جارٍ الحفظ…" : "تأكيد وحفظ الرصيد"}</button><button type="button" className="inv-button inv-button--secondary" onClick={() => setReview(null)} disabled={pending}>تعديل البيانات</button></>}
          {pending ? <span className="inv-button inv-button--text" aria-disabled="true">انتظر انتهاء الحفظ</span> : <Link className="inv-button inv-button--text" href="/inventory">إلغاء</Link>}
        </div>
      </div>
      <aside className="inv-side"><h2>كيف يُسجّل الرصيد؟</h2><ul><li>يُسجّل مرة واحدة للصنف في كل مستودع، دون استبدال أرصدة موجودة.</li><li>الأرقام التسلسلية مطلوبة للسماعات ولكل صنف مفعّل له التتبع.</li><li>الكمية وتكلفة الوحدة تُستخدمان في قيمة المخزون؛ لا تُحسب ضريبة هنا.</li><li>حركات البيع والنقل وتصحيح الأرصدة ليست ضمن هذه الخطوة.</li></ul><p><Link href="/inventory/serials">عرض سجل السيريالات</Link></p></aside>
    </form>
  );
}
