"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";

import type { CatalogCategoryView } from "@/lib/catalog-sales";
import { MAX_CATALOG_LINES, parseCatalogSaleInput, type CatalogSaleLineInput } from "@/lib/catalog-validation";
import { displayMoney } from "@/lib/commerce-display";
import { distributeInvoiceDiscount, grossLineCents, staffDiscountAllowed, validateCollectionAmount } from "@/lib/commerce-math";
import { duplicatesCatalogLine, type PaymentMethod } from "@/lib/commerce-validation";
import { scaledInteger } from "@/lib/inventory-math";
import type { FieldErrors } from "@/lib/inventory-validation";
import { createCatalogSaleAction } from "../actions";
import { initialSalesActionState, type SalesActionState } from "../sales-state";

type BranchOption = { id: string; name: string };
type CartLine = {
  key: string; typeId: string; categoryName: string; typeName: string;
  quantity: string; unitPrice: string; values: Record<string, string>;
};
type Props = {
  requestId: string;
  catalog: CatalogCategoryView[];
  branches: BranchOption[];
  defaultBranchId: string;
  staff: boolean;
  discountBps: number;
};
type Review = { lines: CatalogSaleLineInput[]; gross: bigint[]; subtotal: bigint; discount: bigint; total: bigint; payment: bigint };

export default function CatalogSaleForm({ requestId, catalog, branches, defaultBranchId, staff, discountBps }: Props) {
  const [branchId, setBranchId] = useState(defaultBranchId || branches[0]?.id || "");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [discount, setDiscount] = useState("0");
  const [initialPayment, setInitialPayment] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [categoryId, setCategoryId] = useState(catalog[0]?.id ?? "");
  const [typeId, setTypeId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [cart, setCart] = useState<CartLine[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [review, setReview] = useState<Review | null>(null);
  const [dismissedError, setDismissedError] = useState<SalesActionState | null>(null);
  const [state, formAction, pending] = useActionState(createCatalogSaleAction, initialSalesActionState);

  const category = useMemo(() => catalog.find((item) => item.id === categoryId) ?? null, [catalog, categoryId]);
  const types = category?.types ?? [];
  // تصنيف بنوع واحد يُنتقى تلقائيًا: «صيانة» و«سماعة» يظهران مباشرة بحقولهما.
  const activeTypeId = typeId && types.some((item) => item.id === typeId) ? typeId : (types.length === 1 ? types[0]!.id : "");
  const activeType = types.find((item) => item.id === activeTypeId) ?? null;

  function edited() { setReview(null); setErrors({}); setDismissedError(state); }
  function selectCategory(id: string) { edited(); setCategoryId(id); setTypeId(""); setValues({}); }
  function selectType(id: string) { edited(); setTypeId(id); setValues({}); }

  function addLine() {
    edited();
    if (!category || !activeType) { setErrors({ lines: "اختر التصنيف والنوع." }); return; }
    if (cart.length >= MAX_CATALOG_LINES) { setErrors({ lines: `الحد ${MAX_CATALOG_LINES} بندًا في الفاتورة.` }); return; }
    // القاعدة تُسأل في الدالة ذاتها التي يسألها المحرك، لا تُنسخ هنا. فالمنع كان
    // في موضعين يختلفان: المحرك يقبل اختلاف القيم، والنموذج يمنع تكرار النوع
    // مطلقًا، فصار حكم النموذج هو الحاجز الفعلي وأبطل حكم المحرك.
    const asDetails = (item: { typeId: string; values: Record<string, string> }) =>
      ({ typeId: item.typeId, details: Object.entries(item.values).map(([key, value]) => ({ key, value })) });
    if (duplicatesCatalogLine([...cart.map(asDetails), asDetails({ typeId: activeType.id, values })])) {
      setErrors({ lines: "هذا البند مضاف بالقيم نفسها؛ عدّل الكمية في بنده، أو غيّر أحد الحقول لإضافة وحدة أخرى." });
      return;
    }
    const missing = activeType.fields.filter((field) => field.required && !(values[field.key] ?? "").trim());
    if (missing.length) { setErrors({ lines: `اكتب: ${missing.map((field) => field.label).join("، ")}` }); return; }
    const parsed = parseCatalogSaleInput({
      requestId, branchId: branchId || "1", customerName: "تجربة", customerPhone: "01000000000",
      discount: "0", initialPayment: "1", method: "CASH",
      lines: [{ typeId: activeType.id, quantity, unitPrice, details: Object.entries(values).map(([key, value]) => ({ key, value })) }],
    });
    if (!parsed.ok) { setErrors(parsed.errors); return; }
    setCart((items) => [...items, {
      key: crypto.randomUUID(), typeId: activeType.id, categoryName: category.name, typeName: activeType.name,
      quantity: parsed.value.lines[0]!.quantity, unitPrice: parsed.value.lines[0]!.unitPrice,
      values: { ...values },
    }]);
    setValues({}); setUnitPrice(""); setQuantity("1"); setTypeId("");
  }

  function updateLine(key: string, patch: Partial<CartLine>) { edited(); setCart((items) => items.map((item) => (item.key === key ? { ...item, ...patch } : item))); }
  function removeLine(key: string) { edited(); setCart((items) => items.filter((item) => item.key !== key)); }

  function reviewValues() {
    const parsed = parseCatalogSaleInput(rawInput());
    if (!parsed.ok) { setErrors(parsed.errors); setReview(null); return; }
    try {
      const value = parsed.value;
      const gross = value.lines.map((line) => grossLineCents(scaledInteger(line.quantity, 2), scaledInteger(line.unitPrice, 2)));
      const subtotal = gross.reduce((sum, item) => sum + item, 0n);
      const discountCents = scaledInteger(value.discount, 2);
      if (!staffDiscountAllowed(subtotal, discountCents, BigInt(discountBps))) throw new Error("الخصم يتجاوز الحد المسموح لدورك.");
      const payment = scaledInteger(value.initialPayment, 2);
      validateCollectionAmount(subtotal - discountCents, payment);
      setErrors({});
      setReview({ lines: value.lines, gross, subtotal, discount: discountCents, total: subtotal - discountCents, payment });
    } catch (error) { setReview(null); setErrors({ form: error instanceof Error ? error.message : "راجع بيانات الفاتورة." }); }
  }

  function rawInput() {
    return {
      requestId, branchId, customerName, customerPhone, discount, initialPayment, method,
      lines: cart.map((item) => ({
        typeId: item.typeId, quantity: item.quantity, unitPrice: item.unitPrice,
        details: Object.entries(item.values).map(([key, value]) => ({ key, value })),
      })),
    };
  }

  if (state.status === "success") return <div className="inv-panel inv-success" role="status"><h2>تم تسجيل البيع</h2><p>{state.message}</p>
    <div className="inv-actions"><Link className="inv-button" href={`/sales/${state.id}`}>عرض الفاتورة</Link><a className="inv-button inv-button--secondary" href="/sales/new">بيع جديد</a><Link className="inv-button inv-button--text" href="/sales">كل الفواتير</Link></div></div>;

  return <form className="sale-grid" action={formAction} noValidate onSubmit={(event) => { if (!review) { event.preventDefault(); reviewValues(); } }}>
    <input type="hidden" name="reviewed" value={review ? "yes" : "no"} />
    <input type="hidden" name="payload" value={review ? JSON.stringify({ ...rawInput(), lines: review.lines }) : ""} />
    <div className="sale-stack">
      {state.status === "error" && state !== dismissedError && <div className="inv-alert inv-alert--error" role="alert"><strong>{state.message}</strong>{state.fieldErrors && <ul>{Object.entries(state.fieldErrors).map(([key, value]) => <li key={key}>{value}</li>)}</ul>}</div>}
      {Object.keys(errors).length > 0 && <div className="inv-alert inv-alert--error" role="alert"><strong>راجع البيانات:</strong><ul>{Object.entries(errors).map(([key, value]) => <li key={key}>{value}</li>)}</ul></div>}

      <section className="inv-panel" aria-labelledby="sale-customer-title"><div className="inv-panel__heading"><h2 id="sale-customer-title">بيانات العميل</h2><p>الاسم ورقم الهاتف مطلوبان لكل فاتورة.</p></div><div className="inv-panel__body inv-fields">
        {branches.length > 0 && <div className="inv-field"><label htmlFor="sale-branch">الفرع *</label><select id="sale-branch" disabled={pending} value={branchId} onChange={(event) => { edited(); setBranchId(event.target.value); }}><option value="">اختر الفرع</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></div>}
        <div className="inv-field"><label htmlFor="sale-customer-name">اسم العميل *</label><input id="sale-customer-name" disabled={pending} value={customerName} onChange={(event) => { edited(); setCustomerName(event.target.value); }} maxLength={180} aria-invalid={!!errors.customerName} /></div>
        <div className="inv-field"><label htmlFor="sale-customer-phone">رقم الهاتف *</label><input id="sale-customer-phone" disabled={pending} value={customerPhone} onChange={(event) => { edited(); setCustomerPhone(event.target.value); }} maxLength={30} dir="ltr" inputMode="tel" aria-invalid={!!errors.customerPhone} /></div>
      </div></section>

      <section className="inv-panel" aria-labelledby="sale-items-title"><div className="inv-panel__heading"><h2 id="sale-items-title">الأصناف</h2><p>اختر التصنيف ثم النوع، واكتب السعر بنفسه. لا مخزون ولا مستودع: البند يُسجَّل كما كتبته.</p></div><div className="inv-panel__body">
        <div className="sale-inline">
          <div className="inv-field"><label htmlFor="sale-category">التصنيف</label><select id="sale-category" disabled={pending} value={categoryId} onChange={(event) => selectCategory(event.target.value)}>
            {catalog.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
          {types.length > 1 && <div className="inv-field"><label htmlFor="sale-type">النوع</label><select id="sale-type" disabled={pending} value={activeTypeId} onChange={(event) => selectType(event.target.value)}>
            <option value="">اختر النوع</option>{types.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>}
          <div className="inv-field"><label htmlFor="sale-quantity">الكمية</label><input id="sale-quantity" disabled={pending} inputMode="decimal" dir="ltr" value={quantity} onChange={(event) => { edited(); setQuantity(event.target.value); }} /></div>
          <div className="inv-field"><label htmlFor="sale-price">السعر (ج.م) *</label><input id="sale-price" disabled={pending} inputMode="decimal" dir="ltr" value={unitPrice} onChange={(event) => { edited(); setUnitPrice(event.target.value); }} placeholder="يكتبه الموظف" /></div>
        </div>
        {activeType && activeType.fields.length > 0 && <div className="inv-fields" style={{ marginTop: 12 }}>{activeType.fields.map((field) => <div className="inv-field" key={field.id}>
          <label htmlFor={`field-${field.id}`}>{field.label}{field.required ? " *" : ""}</label>
          <input id={`field-${field.id}`} disabled={pending} value={values[field.key] ?? ""} maxLength={300} onChange={(event) => { edited(); setValues((old) => ({ ...old, [field.key]: event.target.value })); }} />
        </div>)}</div>}
        <div style={{ marginTop: 12 }}><button type="button" className="inv-button inv-button--secondary" disabled={pending} onClick={addLine}>إضافة البند</button></div>
        <div style={{ marginTop: 16 }}>{cart.length === 0 ? <p className="sale-note">لم تُضف بنودًا بعد.</p> : <div className="inv-table-wrap table-wrap"><table className="inv-table"><thead><tr>
          <th>التصنيف</th><th>النوع</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th><th /></tr></thead><tbody>{cart.map((item) => {
            const cents = grossLineCents(scaledInteger(item.quantity, 2), scaledInteger(item.unitPrice, 2));
            return <tr key={item.key}><td>{item.categoryName}</td><td>{item.typeName}{Object.entries(item.values).length > 0 && <div className="sale-note">{Object.entries(item.values).map(([key, value]) => `${key}: ${value}`).join(" · ")}</div>}</td>
              <td><input className="sale-line-input" disabled={pending} inputMode="decimal" dir="ltr" value={item.quantity} onChange={(event) => updateLine(item.key, { quantity: event.target.value })} aria-label={`كمية ${item.typeName}`} /></td>
              <td><input className="sale-line-input" disabled={pending} inputMode="decimal" dir="ltr" value={item.unitPrice} onChange={(event) => updateLine(item.key, { unitPrice: event.target.value })} aria-label={`سعر ${item.typeName}`} /></td>
              <td><bdi dir="ltr">{displayMoney(cents)}</bdi></td>
              <td><button type="button" className="sale-product__remove" disabled={pending} onClick={() => removeLine(item.key)}>إزالة</button></td></tr>;
          })}</tbody></table></div>}</div>
      </div></section>

      <section className="inv-panel" aria-labelledby="sale-payment-title"><div className="inv-panel__heading"><h2 id="sale-payment-title">الخصم والدفعة الأولى</h2><p>يمكن تحصيل الباقي لاحقًا من الفاتورة.</p></div><div className="inv-panel__body inv-fields">
        <div className="inv-field"><label htmlFor="sale-discount">الخصم (ج.م)</label><input id="sale-discount" disabled={pending} inputMode="decimal" dir="ltr" value={discount} onChange={(event) => { edited(); setDiscount(event.target.value); }} /><p className="inv-field__hint">{staff ? `حد الموظف الحالي ${(discountBps / 100).toString()}% من قيمة الأصناف قبل الخصم.` : "الخصم مبلغ بالجنيه على الفاتورة."}</p></div>
        <div className="inv-field"><label htmlFor="sale-initial">الدفعة الأولى (ج.م) *</label><input id="sale-initial" disabled={pending} inputMode="decimal" dir="ltr" value={initialPayment} onChange={(event) => { edited(); setInitialPayment(event.target.value); }} /><p className="inv-field__hint">يجب أن تكون أكبر من صفر ولا تزيد على الإجمالي.</p></div>
        <div className="inv-field inv-field--wide"><label htmlFor="sale-method">وسيلة الدفع *</label><select id="sale-method" disabled={pending} value={method} onChange={(event) => { edited(); setMethod(event.target.value as PaymentMethod); }}><option value="CASH">نقدي</option><option value="CARD">بطاقة</option><option value="BANK_TRANSFER">تحويل بنكي</option><option value="WALLET">محفظة</option></select></div>
      </div></section>

      {review && <section className="inv-review" aria-labelledby="sale-review-title" aria-live="polite"><h2 id="sale-review-title">راجع الفاتورة قبل التأكيد</h2>
        <p>لن يُحفظ شيء حتى تؤكد. الخادم يعيد فحص الأصناف والأسعار والصلاحيات عند الحفظ، ولا يُخصم أي مخزون.</p><dl>
          <div><dt>العميل</dt><dd>{customerName} — <bdi dir="ltr">{customerPhone}</bdi></dd></div>
          <div><dt>البنود</dt><dd>{cart.map((item) => `${item.categoryName} — ${item.typeName} × ${item.quantity}`).join(" · ")}</dd></div>
          <div><dt>الدفعة الأولى</dt><dd>{displayMoney(review.payment)} ج.م</dd></div>
          <div><dt>الباقي على العميل</dt><dd>{displayMoney(review.total - review.payment)} ج.م</dd></div>
        </dl></section>}

      <div className="inv-form-actions">{!review ? <button type="button" className="inv-button" disabled={pending} onClick={(event) => { event.preventDefault(); reviewValues(); }}>مراجعة الفاتورة</button> : <><button type="submit" className="inv-button" disabled={pending}>{pending ? "جارٍ الحفظ…" : "تأكيد البيع"}</button><button type="button" className="inv-button inv-button--secondary" disabled={pending} onClick={() => setReview(null)}>تعديل البيانات</button></>}<Link className="inv-button inv-button--text" href="/sales">إلغاء</Link></div>
    </div>
    <aside className="inv-side"><h2>ملخص الفاتورة</h2>{review ? <dl className="sale-totals"><div><dt>قيمة الأصناف</dt><dd>{displayMoney(review.subtotal)} ج.م</dd></div><div><dt>الخصم</dt><dd>{displayMoney(review.discount)} ج.م</dd></div><div className="sale-totals__strong"><dt>الإجمالي النهائي</dt><dd>{displayMoney(review.total)} ج.م</dd></div><div><dt>الدفعة الأولى</dt><dd>{displayMoney(review.payment)} ج.م</dd></div><div><dt>الباقي على العميل</dt><dd>{displayMoney(review.total - review.payment)} ج.م</dd></div></dl> : <p>أدخل البيانات ثم اضغط «مراجعة الفاتورة» لإظهار الإجماليات.</p>}
      <p>السعر الذي تكتبه هو النهائي؛ الضريبة تُسجَّل «غير محددة» ولا يحسبها النظام. الإيصال داخلي وليس فاتورة إلكترونية رسمية.</p></aside>
  </form>;
}
