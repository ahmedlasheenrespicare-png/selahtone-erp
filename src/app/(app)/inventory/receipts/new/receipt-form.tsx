"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { MAX_SERIALS_PER_OPENING, type FieldErrors } from "@/lib/inventory-validation";
import { parseReceiptInput, type ReceiptInput, type ReceiptInputRaw } from "@/lib/receiving-validation";
import { createReceiptAction } from "../../actions";
import { initialInventoryActionState, type InventoryActionState } from "../../inventory-state";

type ProductOption = { id: string; name: string; sku: string; needsSerials: boolean; purchaseCost: string };
type WarehouseOption = { id: string; name: string; code: string; branch: string };
type Props = { requestId: string; products: ProductOption[]; warehouses: WarehouseOption[] };
const FIELD_NAMES: Record<string, string> = { productId: "الصنف", warehouseId: "المستودع", quantity: "الكمية", unitCost: "تكلفة الوحدة", serialNumbers: "الأرقام التسلسلية", sourceReference: "مرجع المورد", form: "النموذج" };

export default function ReceiptForm({ requestId, products, warehouses }: Props) {
  const [values, setValues] = useState<ReceiptInputRaw>({ requestId, productId: "", warehouseId: "", quantity: "", unitCost: "", serialNumbers: "", sourceReference: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [review, setReview] = useState<ReceiptInput | null>(null);
  const [state, formAction, pending] = useActionState(createReceiptAction, initialInventoryActionState);
  const [dismissedError, setDismissedError] = useState<InventoryActionState | null>(null);
  const selectedProduct = products.find((product) => product.id === values.productId);

  function update<K extends keyof ReceiptInputRaw>(key: K, value: ReceiptInputRaw[K]) {
    setDismissedError(state);
    setValues((old) => key === "productId" ? { ...old, productId: value as string, quantity: "", unitCost: "", serialNumbers: "" } : { ...old, [key]: value });
    setReview(null);
    setErrors((old) => { const next = { ...old }; delete next[key]; if (key === "productId") { delete next.quantity; delete next.unitCost; delete next.serialNumbers; } return next; });
  }

  function reviewValues() {
    const parsed = parseReceiptInput(values, selectedProduct?.needsSerials ?? false);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      setReview(null);
      const first = Object.keys(parsed.errors).find((key) => key !== "form");
      if (first) document.getElementById(`receipt-${first}`)?.focus();
      return;
    }
    setErrors({});
    setReview(parsed.value);
  }

  if (state.status === "success") return <div className="inv-panel inv-success" role="status">
    <h2>تم تسجيل التوريد</h2><p>{state.message}</p>
    {state.id && <p>رقم الحركة: <bdi dir="ltr">{state.id}</bdi></p>}
    <div className="inv-actions"><a className="inv-button" href="/inventory/receipts/new">تسجيل توريد آخر</a><Link className="inv-button inv-button--secondary" href="/inventory/receipts">عرض سجل التوريدات</Link><Link className="inv-button inv-button--text" href="/inventory">العودة إلى المخزون</Link></div>
  </div>;

  const reviewProduct = review && products.find((product) => product.id === review.productId);
  const reviewWarehouse = review && warehouses.find((warehouse) => warehouse.id === review.warehouseId);
  const fieldError = (key: string) => errors[key];
  const errorId = (key: string) => fieldError(key) ? `receipt-${key}-error` : undefined;
  const enteredSerials = values.serialNumbers.split(/\r?\n/).filter((line) => line.trim()).length;

  return <form className="inv-form-layout" action={formAction} noValidate onSubmit={(event) => { if (!review) { event.preventDefault(); reviewValues(); } }}>
    <input type="hidden" name="requestId" value={requestId} />
    <input type="hidden" name="reviewed" value={review ? "yes" : "no"} />
    <div className="inv-form-stack">
      {state.status === "error" && state !== dismissedError && <div className="inv-alert inv-alert--error" role="alert"><strong>{state.message}</strong>{state.fieldErrors && <ul>{Object.entries(state.fieldErrors).map(([key, message]) => <li key={key}>{FIELD_NAMES[key] ?? key}: {message}</li>)}</ul>}</div>}
      {errors.form && <div className="inv-alert inv-alert--error" role="alert">{errors.form}</div>}
      <div className="inv-alert"><strong>توريد مخزني فقط:</strong> تُضاف الكمية للرصيد الموجود ويُعاد حساب متوسط تكلفة المستودع. لا تُنشأ فاتورة شراء أو دفعة أو حساب للمورد.</div>
      <section className="inv-panel" aria-labelledby="receipt-details-title">
        <div className="inv-panel__heading"><h2 id="receipt-details-title">بيانات التوريد</h2><p>أدخل الكمية وتكلفة الوحدة الفعلية لهذا التوريد، وراجع المستودع قبل الحفظ.</p></div>
        <div className="inv-panel__body inv-fields">
          <div className="inv-field inv-field--wide">
            <label htmlFor="receipt-productId">الصنف *</label>
            <select id="receipt-productId" disabled={pending} name="productId" value={values.productId} onChange={(e) => update("productId", e.target.value)} aria-invalid={!!fieldError("productId")} aria-describedby={errorId("productId")}>
              <option value="">اختر الصنف</option>{products.map((product) => <option value={product.id} key={product.id}>{product.name} — {product.sku}</option>)}
            </select>
            {fieldError("productId") && <p id="receipt-productId-error" className="inv-field__error">{fieldError("productId")}</p>}
          </div>
          <div className="inv-field inv-field--wide">
            <label htmlFor="receipt-warehouseId">الفرع والمستودع *</label>
            <select id="receipt-warehouseId" disabled={pending} name="warehouseId" value={values.warehouseId} onChange={(e) => update("warehouseId", e.target.value)} aria-invalid={!!fieldError("warehouseId")} aria-describedby={errorId("warehouseId")}>
              <option value="">اختر المستودع</option>{warehouses.map((warehouse) => <option value={warehouse.id} key={warehouse.id}>{warehouse.branch} — {warehouse.name} ({warehouse.code})</option>)}
            </select>
            {fieldError("warehouseId") && <p id="receipt-warehouseId-error" className="inv-field__error">{fieldError("warehouseId")}</p>}
          </div>
          <div className="inv-field">
            <label htmlFor="receipt-quantity">الكمية الموردة *</label>
            <input id="receipt-quantity" disabled={pending} name="quantity" inputMode="decimal" dir="ltr" value={values.quantity} onChange={(e) => update("quantity", e.target.value)} placeholder="0" aria-invalid={!!fieldError("quantity")} aria-describedby={errorId("quantity") ?? "receipt-quantity-hint"} />
            {fieldError("quantity") ? <p id="receipt-quantity-error" className="inv-field__error">{fieldError("quantity")}</p> : <p id="receipt-quantity-hint" className="inv-field__hint">كمية أكبر من صفر؛ الأصناف ذات السيريال بأعداد صحيحة.</p>}
          </div>
          <div className="inv-field">
            <label htmlFor="receipt-unitCost">تكلفة الوحدة لهذا التوريد (ج.م) *</label>
            <input id="receipt-unitCost" disabled={pending} name="unitCost" inputMode="decimal" dir="ltr" value={values.unitCost} onChange={(e) => update("unitCost", e.target.value)} placeholder="0.00" aria-invalid={!!fieldError("unitCost")} aria-describedby={errorId("unitCost") ?? "receipt-unitCost-hint"} />
            {fieldError("unitCost") ? <p id="receipt-unitCost-error" className="inv-field__error">{fieldError("unitCost")}</p> : <p id="receipt-unitCost-hint" className="inv-field__hint">حتى أربع منازل عشرية.{selectedProduct && ` تكلفة الشراء في دليل الصنف: ${selectedProduct.purchaseCost} ج.م.`}</p>}
          </div>
          <div className="inv-field inv-field--wide">
            <label htmlFor="receipt-sourceReference">مرجع المورد أو المستند <span className="inv-field__hint">(اختياري)</span></label>
            <input id="receipt-sourceReference" disabled={pending} name="sourceReference" value={values.sourceReference} onChange={(e) => update("sourceReference", e.target.value)} maxLength={180} aria-invalid={!!fieldError("sourceReference")} aria-describedby={errorId("sourceReference") ?? "receipt-sourceReference-hint"} />
            {fieldError("sourceReference") ? <p id="receipt-sourceReference-error" className="inv-field__error">{fieldError("sourceReference")}</p> : <p id="receipt-sourceReference-hint" className="inv-field__hint">للإشارة فقط؛ لا يُسجّل حساب مورد أو فاتورة شراء.</p>}
          </div>
        </div>
      </section>
      {selectedProduct?.needsSerials && <section className="inv-panel" aria-labelledby="receipt-serial-title">
        <div className="inv-panel__heading"><h2 id="receipt-serial-title">الأرقام التسلسلية</h2><p>أدخل رقمًا جديدًا لكل جهاز، كل رقم في سطر مستقل.</p></div>
        <div className="inv-panel__body"><div className="inv-field">
          <label htmlFor="receipt-serialNumbers">السيريالات * <span className="inv-field__hint">({enteredSerials} مُدخل)</span></label>
          <textarea id="receipt-serialNumbers" disabled={pending} name="serialNumbers" dir="ltr" value={values.serialNumbers} onChange={(e) => update("serialNumbers", e.target.value)} autoComplete="off" spellCheck={false} placeholder={'SN-001\nSN-002'} aria-invalid={!!fieldError("serialNumbers")} aria-describedby={errorId("serialNumbers") ?? "receipt-serialNumbers-hint"} />
          {fieldError("serialNumbers") ? <p id="receipt-serialNumbers-error" className="inv-field__error">{fieldError("serialNumbers")}</p> : <p id="receipt-serialNumbers-hint" className="inv-field__hint">يجب أن يساوي عدد الأرقام عدد الأجهزة وألا يتكرر رقم سبق تسجيله. الحد {MAX_SERIALS_PER_OPENING} جهاز في التوريد الواحد.</p>}
        </div></div>
      </section>}
      {review && <section className="inv-review" aria-labelledby="receipt-review-title" aria-live="polite">
        <h2 id="receipt-review-title">راجع التوريد قبل الحفظ</h2><p>لن يُحفظ شيء حتى تؤكد. ستُضاف الكمية ويُحدّث متوسط تكلفة المستودع.</p>
        <dl>
          <div><dt>الصنف</dt><dd>{reviewProduct?.name} ({reviewProduct?.sku})</dd></div>
          <div><dt>الفرع والمستودع</dt><dd>{reviewWarehouse?.branch} — {reviewWarehouse?.name}</dd></div>
          <div><dt>الكمية</dt><dd>{review.quantity}</dd></div><div><dt>تكلفة الوحدة الموردة</dt><dd>{review.unitCost} ج.م</dd></div>
          <div><dt>مرجع المورد</dt><dd>{review.sourceReference ?? "لم يُدخل"}</dd></div><div><dt>الأرقام التسلسلية</dt><dd>{review.serials.length ? `${review.serials.length} رقم` : "غير مطلوبة لهذا الصنف"}</dd></div>
        </dl>
        {review.serials.length > 0 && <div className="inv-review__serials" dir="ltr" role="region" aria-label="الأرقام التسلسلية للمراجعة" tabIndex={0}>{review.serials.map((serial) => serial.number).join("\n")}</div>}
      </section>}
      <div className="inv-form-actions">
        {!review ? <button type="button" className="inv-button" onClick={(event) => { event.preventDefault(); reviewValues(); }} disabled={pending}>مراجعة التوريد</button> : <><button type="submit" className="inv-button" disabled={pending}>{pending ? "جارٍ الحفظ…" : "تأكيد وحفظ التوريد"}</button><button type="button" className="inv-button inv-button--secondary" onClick={() => setReview(null)} disabled={pending}>تعديل البيانات</button></>}
        {pending ? <span className="inv-button inv-button--text" aria-disabled="true">انتظر انتهاء الحفظ</span> : <Link className="inv-button inv-button--text" href="/inventory/receipts">إلغاء</Link>}
      </div>
    </div>
    <aside className="inv-side"><h2>كيف يُسجّل التوريد؟</h2><ul><li>متاح للمدير ولموظف الفرع ضمن مستودعات فرعه.</li><li>تُضاف الكمية للرصيد بدلًا من استبداله ويُحسب متوسط تكلفة مرجح لكل مستودع.</li><li>السيريالات فريدة بين الأرصدة الافتتاحية والتوريدات في كل الفروع.</li><li>المرجع اختياري، ولا يتضمن التوريد حسابات الموردين أو دفعات الشراء.</li></ul><p><Link href="/inventory/serials">عرض سجل السيريالات</Link></p></aside>
  </form>;
}
