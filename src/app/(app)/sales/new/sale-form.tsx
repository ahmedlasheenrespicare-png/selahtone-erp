"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { calculateInclusiveSale, grossLineCents, staffDiscountAllowed, validateCollectionAmount, type CalculatedSale, type ReviewedTax } from "@/lib/commerce-math";
import { displayMoney } from "@/lib/commerce-display";
import { MAX_SALE_LINES, MAX_SALE_SERIALS, parseSaleInput, type PaymentMethod, type SaleInput } from "@/lib/commerce-validation";
import { scaledInteger } from "@/lib/inventory-math";
import type { FieldErrors } from "@/lib/inventory-validation";
import { createSaleAction } from "../actions";
import { initialSalesActionState, type SalesActionState } from "../sales-state";
import type { KnownCustomerHint } from "./catalog-sale-form";
import SerialSelector, { type SerialOption } from "./serial-selector";

type Product = { id: string; name: string; sku: string; unitPrice: string; taxId: string; taxKind: string; taxRate: string; taxCode: string; taxUsable: boolean; isStock: boolean; isSerialized: boolean; quantityAvailable: string };
type CartItem = { productId: string; quantity: string; serials: SerialOption[] };
type Props = {
  requestId: string;
  warehouseId: string;
  warehouseName: string;
  staff: boolean;
  discountBps: number;
  products: Product[];
  stockDecoupled: boolean;
  knownCustomers?: KnownCustomerHint[];
};
type Review = { input: SaleInput; calculation: CalculatedSale; payment: bigint };

function safeMoneyCents(raw: string): bigint {
  const trimmed = raw.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return 0n;
  try {
    return scaledInteger(trimmed, 2);
  } catch {
    return 0n;
  }
}

function centsToInputDecimal(cents: bigint): string {
  const neg = cents < 0n ? "-" : "";
  const abs = cents < 0n ? -cents : cents;
  const whole = abs / 100n;
  const frac = abs % 100n;
  return frac === 0n ? `${neg}${whole}` : `${neg}${whole}.${frac.toString().padStart(2, "0")}`;
}

export default function SaleForm({
  requestId,
  warehouseId,
  warehouseName,
  staff,
  discountBps,
  products,
  stockDecoupled,
  knownCustomers = [],
}: Props) {
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [discount, setDiscount] = useState("0");
  const [discountMode, setDiscountMode] = useState<"EGP" | "PCT">("EGP");
  const [discountPctInput, setDiscountPctInput] = useState("0");
  const [initialPayment, setInitialPayment] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [selectedId, setSelectedId] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [review, setReview] = useState<Review | null>(null);
  const [state, formAction, pending] = useActionState(createSaleAction, initialSalesActionState);
  const [dismissedError, setDismissedError] = useState<SalesActionState | null>(null);
  const productMap = new Map(products.map((product) => [product.id, product]));

  const usableProducts = useMemo(() => products.filter((p) => p.taxUsable).slice(0, 8), [products]);

  const phoneDigits = customerPhone.replace(/\D+/g, "");
  const matchedCustomers = useMemo(() => {
    if (phoneDigits.length < 4) return [];
    return knownCustomers.filter((c) => c.digits.includes(phoneDigits)).slice(0, 4);
  }, [knownCustomers, phoneDigits]);
  const exactCustomer = useMemo(() => {
    if (phoneDigits.length < 8) return null;
    return knownCustomers.find((c) => c.digits === phoneDigits) ?? null;
  }, [knownCustomers, phoneDigits]);

  const liveSubtotalCents = useMemo(() => {
    let sum = 0n;
    for (const item of cart) {
      const p = productMap.get(item.productId);
      if (!p) continue;
      sum += grossLineCents(safeMoneyCents(item.quantity), safeMoneyCents(p.unitPrice));
    }
    return sum;
  }, [cart, productMap]);

  const liveDiscountCents = safeMoneyCents(discount);
  const liveTotalCents = liveSubtotalCents > liveDiscountCents ? liveSubtotalCents - liveDiscountCents : 0n;
  const livePaymentCents = safeMoneyCents(initialPayment);
  const liveRemainingCents = liveTotalCents > livePaymentCents ? liveTotalCents - livePaymentCents : 0n;

  function syncDiscountFromPct(pctRaw: string, subCents: bigint) {
    const pctNum = Number(pctRaw);
    if (!Number.isFinite(pctNum) || pctNum <= 0 || subCents <= 0n) {
      setDiscount("0");
      return;
    }
    const clampedBps = BigInt(Math.min(10000, Math.max(0, Math.round(pctNum * 100))));
    const computedCents = (subCents * clampedBps) / 10000n;
    setDiscount(centsToInputDecimal(computedCents));
  }

  function edited() { setReview(null); setErrors({}); setDismissedError(state); }
  function addProductById(targetId: string) {
    edited();
    const product = productMap.get(targetId);
    if (!product || !product.taxUsable) { setErrors({ lines: "اختر صنفًا متاحًا بضريبة محددة وسارية." }); return; }
    if (cart.some((item) => item.productId === product.id)) { setErrors({ lines: "الصنف مضاف بالفعل؛ عدّل الكمية في بنده." }); return; }
    if (cart.length >= MAX_SALE_LINES) { setErrors({ lines: `الحد ${MAX_SALE_LINES} صنفًا في الفاتورة.` }); return; }
    setCart((items) => [...items, { productId: product.id, quantity: product.isSerialized ? "0" : "1", serials: [] }]);
    setSelectedId("");
  }
  function addProduct() { addProductById(selectedId); }
  function updateItem(id: string, update: (old: CartItem) => CartItem) { edited(); setCart((old) => old.map((item) => item.productId === id ? update(item) : item)); }
  function rawInput() {
    return { requestId, warehouseId, customerName, customerPhone, discount, initialPayment, method, lines: cart.map((item) => {
      const product = productMap.get(item.productId)!;
      return { productId: item.productId, quantity: item.quantity, serialIds: item.serials.map((serial) => serial.id), expectedUnitPrice: product.unitPrice, expectedTaxRateId: product.taxId, expectedTaxKind: product.taxKind, expectedTaxRate: product.taxRate };
    }) };
  }
  function reviewValues() {
    const parsed = parseSaleInput(rawInput());
    if (!parsed.ok) { setErrors(parsed.errors); setReview(null); return; }
    try {
      const values = parsed.value;
      for (const item of values.lines) {
        const product = productMap.get(item.productId)!;
        if (!product.taxUsable) throw new Error("أحد الأصناف يحتاج مراجعة ضريبته.");
        if (!stockDecoupled && product.isStock && scaledInteger(item.quantity, 2) > scaledInteger(product.quantityAvailable, 2)) throw new Error(`الكمية المطلوبة من ${product.name} تزيد على المتاح.`);
        if (product.isSerialized && BigInt(item.serialIds.length) * 100n !== scaledInteger(item.quantity, 2)) throw new Error(`اختر سيريالًا لكل جهاز من ${product.name}.`);
      }
      const calculation = calculateInclusiveSale(values.lines.map((item) => {
        const product = productMap.get(item.productId)!;
        const tax: ReviewedTax = product.taxKind === "EXEMPT" ? { kind: "EXEMPT", rateThousandthPercent: scaledInteger(product.taxRate, 3) as 0n } : { kind: product.taxKind as "VAT" | "SCHEDULE", rateThousandthPercent: scaledInteger(product.taxRate, 3) };
        return { quantityHundredths: scaledInteger(item.quantity, 2), unitPriceCents: scaledInteger(product.unitPrice, 2), tax };
      }), scaledInteger(values.discount, 2));
      if (!staffDiscountAllowed(calculation.subtotalCents, calculation.discountCents, BigInt(discountBps))) throw new Error("الخصم يتجاوز الحد المسموح لدورك.");
      const payment = scaledInteger(values.initialPayment, 2); validateCollectionAmount(calculation.finalCents, payment);
      setErrors({}); setReview({ input: values, calculation, payment });
    } catch (error) { setReview(null); setErrors({ form: error instanceof Error ? error.message : "راجع بيانات الفاتورة." }); }
  }
  if (state.status === "success") return <div className="inv-panel inv-success" role="status"><h2>تم تسجيل البيع</h2><p>{state.message}</p><div className="inv-actions"><Link className="inv-button" href={`/sales/${state.id}`}>عرض الفاتورة</Link><a className="inv-button inv-button--secondary" href={`/sales/new?warehouseId=${warehouseId}`}>بيع جديد</a><Link className="inv-button inv-button--text" href="/sales">كل الفواتير</Link></div></div>;

  return <form className="sale-grid" action={formAction} noValidate onSubmit={(event) => { if (!review) { event.preventDefault(); reviewValues(); } }}>
    <input type="hidden" name="reviewed" value={review ? "yes" : "no"} /><input type="hidden" name="payload" value={review ? JSON.stringify(review.input) : ""} />
    <div className="sale-stack">
      {state.status === "error" && state !== dismissedError && <div className="inv-alert inv-alert--error" role="alert"><strong>{state.message}</strong>{state.fieldErrors && <ul>{Object.entries(state.fieldErrors).map(([key, value]) => <li key={key}>{value}</li>)}</ul>}</div>}
      {Object.keys(errors).length > 0 && <div className="inv-alert inv-alert--error" role="alert"><strong>راجع البيانات:</strong><ul>{Object.entries(errors).map(([key, value]) => <li key={key}>{value}</li>)}</ul></div>}
      <section className="inv-panel" aria-labelledby="sale-customer-title"><div className="inv-panel__heading"><h2 id="sale-customer-title">بيانات العميل</h2><p>اكتب رقم الهاتف لاقتراح اسم العميل تلقائيًا من فواتيره السابقة.</p></div><div className="inv-panel__body inv-fields">
        <div className="inv-field">
          <label htmlFor="sale-customer-phone">رقم الهاتف *</label>
          <input id="sale-customer-phone" disabled={pending} value={customerPhone} onChange={(e) => { edited(); setCustomerPhone(e.target.value); }} maxLength={30} dir="ltr" inputMode="tel" aria-invalid={!!errors.customerPhone} />
          {matchedCustomers.length > 0 ? (
            <div className="sale-customer-hints" role="listbox" aria-label="عملاء مسجلون سابقًا">
              {matchedCustomers.map((c) => (
                <button
                  key={c.digits}
                  type="button"
                  className="sale-customer-hint"
                  onClick={() => {
                    edited();
                    setCustomerPhone(c.phone);
                    setCustomerName(c.name);
                  }}
                >
                  <span><strong>{c.name}</strong> · <bdi dir="ltr">{c.phone}</bdi> ({c.invoiceCount} فاتورة)</span>
                  {c.hasUnpaid ? <span className="sale-customer-hint__warn">عليه {c.unpaidFormatted} ج.م</span> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="inv-field"><label htmlFor="sale-customer-name">اسم العميل *</label><input id="sale-customer-name" disabled={pending} value={customerName} onChange={(e) => { edited(); setCustomerName(e.target.value); }} maxLength={180} aria-invalid={!!errors.customerName} /></div>
        {exactCustomer?.hasUnpaid ? (
          <div className="inv-field inv-field--wide">
            <div className="inv-alert inv-alert--warning" style={{ margin: 0 }}>
              تنبيه: يوجد على العميل <strong>{exactCustomer.name}</strong> رصيد مستحق غير مسدّد قدره <bdi dir="ltr">{exactCustomer.unpaidFormatted}</bdi> ج.م من فواتير سابقة.
            </div>
          </div>
        ) : null}
      </div></section>
      <section className="inv-panel" aria-labelledby="sale-items-title"><div className="inv-panel__heading"><h2 id="sale-items-title">الأصناف</h2><p>المستودع: {warehouseName}. يُخصم المخزون عند تأكيد البيع حتى لو وُجد باقي.</p></div><div className="inv-panel__body">
        {usableProducts.length > 0 ? (
          <div className="sale-quick-pick">
            <span className="sale-quick-pick__label">اختيار سريع للأصناف المتاحة:</span>
            <div className="sale-quick-chips">
              {usableProducts.map((p) => (
                <button key={p.id} type="button" className="sale-quick-chip" onClick={() => addProductById(p.id)}>
                  <span>{p.name}</span>
                  <small>{p.unitPrice} ج.م</small>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="sale-inline"><div className="inv-field"><label htmlFor="sale-product">إضافة صنف</label><select id="sale-product" disabled={pending} value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
          <option value="">اختر الصنف</option>{products.map((product) => <option key={product.id} value={product.id} disabled={!product.taxUsable}>{product.name} — {product.sku} — {product.unitPrice} ج.م{!product.taxUsable ? " (الضريبة تحتاج مراجعة)" : ""}</option>)}
        </select></div><button type="button" className="inv-button inv-button--secondary" disabled={pending} onClick={addProduct}>إضافة الصنف</button></div>
        <div style={{ marginTop: 16 }}>{cart.length === 0 ? <p className="sale-note">لم تُضف أصنافًا بعد. الأصناف ذات الضريبة غير المحددة أو غير المدعومة غير متاحة للبيع.</p> : cart.map((item) => {
          const product = productMap.get(item.productId)!;
          return <div className="sale-product" key={product.id}>
            <div className="sale-product__heading"><div><h3>{product.name}</h3><p>{product.sku} · {product.unitPrice} ج.م · ضريبة {product.taxCode} ({product.taxRate}%) {product.isStock ? `· المتاح ${product.quantityAvailable}` : "· خدمة"}</p></div><button type="button" className="sale-product__remove" disabled={pending} onClick={() => { edited(); setCart((old) => old.filter((row) => row.productId !== product.id)); }}>إزالة</button></div>
            {!product.isSerialized ? <div className="inv-field"><label htmlFor={`sale-qty-${product.id}`}>الكمية</label><input id={`sale-qty-${product.id}`} disabled={pending} inputMode="decimal" dir="ltr" value={item.quantity} onChange={(e) => updateItem(product.id, (old) => ({ ...old, quantity: e.target.value }))} /></div> : <SerialSelector
              productId={product.id} warehouseId={warehouseId} selected={item.serials} pending={pending}
              limitReached={cart.reduce((sum, row) => sum + row.serials.length, 0) >= MAX_SALE_SERIALS}
              onChange={(serials) => updateItem(product.id, (old) => ({ ...old, serials, quantity: String(serials.length) }))}
            />}
          </div>;
        })}</div>
      </div></section>
      <section className="inv-panel" aria-labelledby="sale-payment-title"><div className="inv-panel__heading"><h2 id="sale-payment-title">الخصم والدفعة الأولى</h2><p>يمكن تحصيل الباقي لاحقًا من الفاتورة.</p></div><div className="inv-panel__body inv-fields">
        <div className="inv-field">
          <div className="sale-field-head">
            <label htmlFor="sale-discount">الخصم ({discountMode === "EGP" ? "ج.م" : "%"})</label>
            <div className="sale-mode-switch" role="group" aria-label="نوع الخصم">
              <button type="button" className={discountMode === "EGP" ? "is-active" : ""} onClick={() => setDiscountMode("EGP")}>ج.م</button>
              <button type="button" className={discountMode === "PCT" ? "is-active" : ""} onClick={() => { setDiscountMode("PCT"); syncDiscountFromPct(discountPctInput, liveSubtotalCents); }}>%</button>
            </div>
          </div>
          {discountMode === "EGP" ? (
            <input id="sale-discount" disabled={pending} inputMode="decimal" dir="ltr" value={discount} onChange={(e) => { edited(); setDiscount(e.target.value); }} />
          ) : (
            <input id="sale-discount" disabled={pending} inputMode="decimal" dir="ltr" value={discountPctInput} onChange={(e) => { edited(); setDiscountPctInput(e.target.value); syncDiscountFromPct(e.target.value, liveSubtotalCents); }} />
          )}
          <p className="inv-field__hint">{staff ? `حد الموظف الحالي ${(discountBps / 100).toString()}% من قيمة الأصناف قبل الخصم.` : "الخصم يُحفظ كمبلغ بالجنيه على الفاتورة."}</p>
        </div>
        <div className="inv-field">
          <div className="sale-field-head">
            <label htmlFor="sale-initial">الدفعة الأولى (ج.م) *</label>
            {liveTotalCents > 0n ? (
              <button type="button" className="sale-fill-btn" onClick={() => { edited(); setInitialPayment(centsToInputDecimal(liveTotalCents)); }}>
                سداد كامل ({displayMoney(liveTotalCents)})
              </button>
            ) : null}
          </div>
          <input id="sale-initial" disabled={pending} inputMode="decimal" dir="ltr" value={initialPayment} onChange={(e) => { edited(); setInitialPayment(e.target.value); }} />
          <p className="inv-field__hint">يجب أن تكون أكبر من صفر ولا تزيد على الإجمالي.</p>
        </div>
        <div className="inv-field inv-field--wide"><label htmlFor="sale-method">وسيلة الدفع *</label><select id="sale-method" disabled={pending} value={method} onChange={(e) => { edited(); setMethod(e.target.value as PaymentMethod); }}><option value="CASH">نقدي</option><option value="CARD">بطاقة</option><option value="BANK_TRANSFER">تحويل بنكي</option><option value="WALLET">محفظة</option></select></div>
      </div></section>
      {review && <section className="inv-review" aria-labelledby="sale-review-title" aria-live="polite"><h2 id="sale-review-title">راجع الفاتورة قبل التأكيد</h2><p>لن يُحفظ شيء حتى تؤكد. الخادم يعيد فحص السعر والضريبة والمخزون والسيريالات عند الحفظ.</p><dl>
        <div><dt>العميل</dt><dd>{review.input.customerName} — <bdi dir="ltr">{review.input.customerPhone}</bdi></dd></div><div><dt>المستودع</dt><dd>{warehouseName}</dd></div>
        <div><dt>الأصناف</dt><dd>{review.input.lines.map((line) => `${productMap.get(line.productId)?.name} × ${line.quantity}`).join(" · ")}</dd></div>
        <div><dt>السيريالات</dt><dd>{review.input.lines.flatMap((line) => line.serialIds.map((id) => cart.find((item) => item.productId === line.productId)?.serials.find((serial) => serial.id === id)?.number)).filter(Boolean).join(" · ") || "لا توجد"}</dd></div>
        <div><dt>الدفعة الأولى</dt><dd>{displayMoney(review.payment)} ج.م</dd></div><div><dt>الباقي على العميل</dt><dd>{displayMoney(review.calculation.finalCents - review.payment)} ج.م</dd></div>
      </dl></section>}
      <div className="inv-form-actions">{!review ? <button type="button" className="inv-button" disabled={pending} onClick={(event) => { event.preventDefault(); reviewValues(); }}>مراجعة الفاتورة</button> : <><button type="submit" className="inv-button" disabled={pending}>{pending ? "جارٍ الحفظ…" : "تأكيد البيع"}</button><button type="button" className="inv-button inv-button--secondary" disabled={pending} onClick={() => setReview(null)}>تعديل البيانات</button></>}<Link className="inv-button inv-button--text" href="/sales">إلغاء</Link></div>
    </div>
    <aside className="inv-side">
      <h2>ملخص الفاتورة اللحظي</h2>
      {review ? (
        <dl className="sale-totals">
          <div><dt>قيمة الأصناف</dt><dd>{displayMoney(review.calculation.subtotalCents)} ج.م</dd></div>
          <div><dt>الخصم</dt><dd>{displayMoney(review.calculation.discountCents)} ج.م</dd></div>
          <div><dt>ضريبة ضمن السعر</dt><dd>{displayMoney(review.calculation.taxCents)} ج.م</dd></div>
          <div className="sale-totals__strong"><dt>الإجمالي النهائي</dt><dd>{displayMoney(review.calculation.finalCents)} ج.م</dd></div>
          <div><dt>الدفعة الأولى</dt><dd>{displayMoney(review.payment)} ج.م</dd></div>
          <div><dt>الباقي على العميل</dt><dd>{displayMoney(review.calculation.finalCents - review.payment)} ج.م</dd></div>
        </dl>
      ) : cart.length > 0 ? (
        <dl className="sale-totals">
          <div><dt>قيمة الأصناف ({cart.length})</dt><dd>{displayMoney(liveSubtotalCents)} ج.م</dd></div>
          <div><dt>الخصم</dt><dd>{displayMoney(liveDiscountCents)} ج.م</dd></div>
          <div className="sale-totals__strong"><dt>الإجمالي النهائي</dt><dd>{displayMoney(liveTotalCents)} ج.م</dd></div>
          <div><dt>الدفعة الأولى</dt><dd>{displayMoney(livePaymentCents)} ج.م</dd></div>
          <div><dt>الباقي على العميل</dt><dd>{displayMoney(liveRemainingCents)} ج.م</dd></div>
        </dl>
      ) : (
        <p>أضف صنفًا لإظهار الإجماليات والباقي على العميل لحظيًا أثناء الكتابة.</p>
      )}
      <p>السعر شامل الضريبة إن استحقت؛ الإيصال داخلي وليس فاتورة إلكترونية رسمية.</p>
    </aside>
  </form>;
}
