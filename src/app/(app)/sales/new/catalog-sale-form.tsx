"use client";

import Link from "next/link";
import { useActionState, useMemo, useRef, useState } from "react";

import type { CatalogCategoryView } from "@/lib/catalog-sales";
import { MAX_CATALOG_LINES, parseCatalogSaleInput, type CatalogSaleLineInput } from "@/lib/catalog-validation";
import { displayMoney } from "@/lib/commerce-display";
import { grossLineCents, staffDiscountAllowed, validateCollectionAmount } from "@/lib/commerce-math";
import { duplicatesCatalogLine, type PaymentMethod } from "@/lib/commerce-validation";
import { scaledInteger } from "@/lib/inventory-math";
import type { FieldErrors } from "@/lib/inventory-validation";
import { createCatalogSaleAction } from "../actions";
import { initialSalesActionState, type SalesActionState } from "../sales-state";

type BranchOption = { id: string; name: string };
export type KnownCustomerHint = {
  phone: string;
  digits: string;
  name: string;
  invoiceCount: number;
  unpaidFormatted: string;
  hasUnpaid: boolean;
};
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
  knownCustomers?: KnownCustomerHint[];
};
type Review = { lines: CatalogSaleLineInput[]; gross: bigint[]; subtotal: bigint; discount: bigint; total: bigint; payment: bigint };

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
  if (cents <= 0n) return "0";
  const whole = cents / 100n;
  const frac = cents % 100n;
  if (frac === 0n) return whole.toString();
  return `${whole.toString()}.${frac.toString().padStart(2, "0")}`;
}

export default function CatalogSaleForm({
  requestId,
  catalog,
  branches,
  defaultBranchId,
  staff,
  discountBps,
  knownCustomers = [],
}: Props) {
  const [branchId, setBranchId] = useState(defaultBranchId || branches[0]?.id || "");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [discount, setDiscount] = useState("0");
  const [discountMode, setDiscountMode] = useState<"EGP" | "PCT">("EGP");
  const [discountPctInput, setDiscountPctInput] = useState("0");
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
  const priceInputRef = useRef<HTMLInputElement>(null);

  const category = useMemo(() => catalog.find((item) => item.id === categoryId) ?? null, [catalog, categoryId]);
  const types = category?.types ?? [];
  // تصنيف بنوع واحد يُنتقى تلقائيًا: «صيانة» و«سماعة» يظهران مباشرة بحقولهما.
  const activeTypeId: string = typeId && types.some((item) => item.id === typeId) ? typeId : (types.length === 1 ? types[0]!.id : "");
  const activeType = types.find((item) => item.id === activeTypeId) ?? null;

  const quickTypes = useMemo(() => {
    return catalog.flatMap((cat) =>
      cat.types.map((t) => ({
        catId: cat.id,
        catName: cat.name,
        typeId: t.id,
        typeName: t.name,
        label: cat.types.length === 1 ? cat.name : `${cat.name} · ${t.name}`,
      })),
    ).slice(0, 10);
  }, [catalog]);

  // التعرّف التلقائي على العميل برقم الهاتف أو الاسم
  const customerMatches = useMemo(() => {
    const phoneDigits = customerPhone.replace(/\D+/g, "");
    const nameTrimmed = customerName.trim().toLowerCase();
    if (phoneDigits.length < 4 && nameTrimmed.length < 3) return [];
    return knownCustomers
      .filter((c) => {
        if (phoneDigits.length >= 4 && c.digits.includes(phoneDigits)) return true;
        if (nameTrimmed.length >= 3 && c.name.toLowerCase().includes(nameTrimmed)) return true;
        return false;
      })
      .slice(0, 4);
  }, [knownCustomers, customerPhone, customerName]);

  const exactMatchedCustomer = useMemo(() => {
    const phoneDigits = customerPhone.replace(/\D+/g, "");
    if (phoneDigits.length < 8) return null;
    return knownCustomers.find((c) => c.digits === phoneDigits) ?? null;
  }, [knownCustomers, customerPhone]);

  // الإجماليات اللحظية قبل خطوة المراجعة
  const liveSubtotalCents = useMemo(() => {
    return cart.reduce((sum, item) => {
      const q = safeMoneyCents(item.quantity);
      const p = safeMoneyCents(item.unitPrice);
      return sum + grossLineCents(q, p);
    }, 0n);
  }, [cart]);

  const maxAllowedDiscountCents = useMemo(
    () => (liveSubtotalCents * BigInt(discountBps)) / 10000n,
    [liveSubtotalCents, discountBps],
  );

  const liveDiscountCents = safeMoneyCents(discount);
  const liveTotalCents = liveSubtotalCents > liveDiscountCents ? liveSubtotalCents - liveDiscountCents : 0n;
  const livePaymentCents = safeMoneyCents(initialPayment);
  const liveRemainingCents = liveTotalCents > livePaymentCents ? liveTotalCents - livePaymentCents : 0n;

  function syncDiscountFromPct(pctStr: string, subCents: bigint) {
    setDiscountPctInput(pctStr);
    const num = Number(pctStr);
    if (!Number.isFinite(num) || num <= 0 || subCents <= 0n) {
      setDiscount("0");
      return;
    }
    const clampedBps = Math.min(10000, Math.max(0, Math.round(num * 100)));
    const discCents = (subCents * BigInt(clampedBps)) / 10000n;
    setDiscount(centsToInputDecimal(discCents));
  }

  function edited() { setReview(null); setErrors({}); setDismissedError(state); }
  function selectCategory(id: string) { edited(); setCategoryId(id); setTypeId(""); setValues({}); }
  function selectType(id: string) { edited(); setTypeId(id); setValues({}); }

  function pickQuickItem(catId: string, tId: string) {
    edited();
    setCategoryId(catId);
    setTypeId(tId);
    setValues({});
    setTimeout(() => priceInputRef.current?.focus(), 20);
  }

  function addLine() {
    edited();
    if (!category || !activeType) { setErrors({ lines: "اختر التصنيف والنوع." }); return; }
    if (cart.length >= MAX_CATALOG_LINES) { setErrors({ lines: `الحد ${MAX_CATALOG_LINES} بندًا في الفاتورة.` }); return; }
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
    const nextLine: CartLine = {
      key: crypto.randomUUID(), typeId: activeType.id, categoryName: category.name, typeName: activeType.name,
      quantity: parsed.value.lines[0]!.quantity, unitPrice: parsed.value.lines[0]!.unitPrice,
      values: { ...values },
    };
    setCart((items) => {
      const next = [...items, nextLine];
      if (discountMode === "PCT") {
        const nextSub = next.reduce((sum, it) => sum + grossLineCents(safeMoneyCents(it.quantity), safeMoneyCents(it.unitPrice)), 0n);
        syncDiscountFromPct(discountPctInput, nextSub);
      }
      return next;
    });
    setValues({}); setUnitPrice(""); setQuantity("1"); setTypeId("");
  }

  function updateLine(key: string, patch: Partial<CartLine>) {
    edited();
    setCart((items) => {
      const next = items.map((item) => (item.key === key ? { ...item, ...patch } : item));
      if (discountMode === "PCT") {
        const nextSub = next.reduce((sum, it) => sum + grossLineCents(safeMoneyCents(it.quantity), safeMoneyCents(it.unitPrice)), 0n);
        syncDiscountFromPct(discountPctInput, nextSub);
      }
      return next;
    });
  }
  function removeLine(key: string) {
    edited();
    setCart((items) => {
      const next = items.filter((item) => item.key !== key);
      if (discountMode === "PCT") {
        const nextSub = next.reduce((sum, it) => sum + grossLineCents(safeMoneyCents(it.quantity), safeMoneyCents(it.unitPrice)), 0n);
        syncDiscountFromPct(discountPctInput, nextSub);
      }
      return next;
    });
  }

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

      <section className="inv-panel" aria-labelledby="sale-customer-title"><div className="inv-panel__heading"><h2 id="sale-customer-title">بيانات العميل</h2><p>الاسم ورقم الهاتف مطلوبان لكل فاتورة، مع التعرّف التلقائي على العملاء المسجّلين سابقًا.</p></div><div className="inv-panel__body inv-fields">
        {branches.length > 0 && <div className="inv-field"><label htmlFor="sale-branch">الفرع *</label><select id="sale-branch" disabled={pending} value={branchId} onChange={(event) => { edited(); setBranchId(event.target.value); }}><option value="">اختر الفرع</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></div>}
        <div className="inv-field"><label htmlFor="sale-customer-phone">رقم الهاتف *</label><input id="sale-customer-phone" disabled={pending} value={customerPhone} onChange={(event) => { edited(); setCustomerPhone(event.target.value); }} maxLength={30} dir="ltr" inputMode="tel" placeholder="01xxxxxxxxx" aria-invalid={!!errors.customerPhone} /></div>
        <div className="inv-field"><label htmlFor="sale-customer-name">اسم العميل *</label><input id="sale-customer-name" disabled={pending} value={customerName} onChange={(event) => { edited(); setCustomerName(event.target.value); }} maxLength={180} aria-invalid={!!errors.customerName} /></div>

        {customerMatches.length > 0 && !(exactMatchedCustomer && customerName === exactMatchedCustomer.name) ? (
          <div className="inv-field inv-field--wide sale-customer-hints" aria-label="عملاء مسجلون سابقًا">
            <span className="sale-customer-hints__label">عملاء مسجّلون سابقًا (اضغط للتعبئة التلقائية):</span>
            <div className="sale-quick-chips">
              {customerMatches.map((c) => (
                <button
                  key={c.digits}
                  type="button"
                  className={`sale-quick-chip${c.hasUnpaid ? " is-warn" : ""}`}
                  onClick={() => {
                    edited();
                    setCustomerName(c.name);
                    setCustomerPhone(c.phone);
                  }}
                >
                  <strong>{c.name}</strong>
                  <small dir="ltr">{c.phone}</small>
                  <span>
                    ({c.invoiceCount} {c.invoiceCount === 1 ? "فاتورة" : "فواتير"}
                    {c.hasUnpaid ? ` · متبقٍ ${c.unpaidFormatted} ج.م` : ""})
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {exactMatchedCustomer?.hasUnpaid ? (
          <div className="inv-field inv-field--wide">
            <div className="inv-alert inv-alert--warning" role="status">
              تنبيه تحصيل: العميل <strong>{exactMatchedCustomer.name}</strong> لديه رصيد متبقٍ من فواتير سابقة قدره{" "}
              <strong><bdi dir="ltr">{exactMatchedCustomer.unpaidFormatted}</bdi> ج.م</strong>.
            </div>
          </div>
        ) : null}
      </div></section>

      <section className="inv-panel" aria-labelledby="sale-items-title"><div className="inv-panel__heading"><h2 id="sale-items-title">الأصناف</h2><p>اختر الصنف بنقرة سريعة أو من القائمة، واكتب السعر المتفق عليه.</p></div><div className="inv-panel__body">
        {quickTypes.length > 0 ? (
          <div className="sale-quick-bar" aria-label="اختيار سريع للأصناف">
            <span className="sale-quick-bar__label">اختيار سريع:</span>
            <div className="sale-quick-chips">
              {quickTypes.map((qt) => {
                const selected = categoryId === qt.catId && activeTypeId === qt.typeId;
                return (
                  <button
                    key={qt.typeId}
                    type="button"
                    className={`sale-quick-chip${selected ? " is-active" : ""}`}
                    disabled={pending}
                    onClick={() => pickQuickItem(qt.catId, qt.typeId)}
                  >
                    {qt.label}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="sale-inline">
          <div className="inv-field"><label htmlFor="sale-category">التصنيف</label><select id="sale-category" disabled={pending} value={categoryId} onChange={(event) => selectCategory(event.target.value)}>
            {catalog.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
          {types.length > 1 && <div className="inv-field"><label htmlFor="sale-type">النوع</label><select id="sale-type" disabled={pending} value={activeTypeId} onChange={(event) => selectType(event.target.value)}>
            <option value="">اختر النوع</option>{types.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>}
          <div className="inv-field"><label htmlFor="sale-quantity">الكمية</label><input id="sale-quantity" disabled={pending} inputMode="decimal" dir="ltr" value={quantity} onChange={(event) => { edited(); setQuantity(event.target.value); }} /></div>
          <div className="inv-field"><label htmlFor="sale-price">السعر (ج.م) *</label><input ref={priceInputRef} id="sale-price" disabled={pending} inputMode="decimal" dir="ltr" value={unitPrice} onChange={(event) => { edited(); setUnitPrice(event.target.value); }} placeholder="يكتبه الموظف" /></div>
        </div>
        {activeType && activeType.fields.length > 0 && <div className="inv-fields" style={{ marginTop: 12 }}>{activeType.fields.map((field) => <div className="inv-field" key={field.id}>
          <label htmlFor={`field-${field.id}`}>{field.label}{field.required ? " *" : ""}</label>
          <input id={`field-${field.id}`} disabled={pending} value={values[field.key] ?? ""} maxLength={300} onChange={(event) => { edited(); setValues((old) => ({ ...old, [field.key]: event.target.value })); }} />
        </div>)}</div>}
        <div style={{ marginTop: 12 }}><button type="button" className="inv-button inv-button--secondary" disabled={pending} onClick={addLine}>إضافة البند</button></div>
        <div style={{ marginTop: 16 }}>{cart.length === 0 ? <p className="sale-note">لم تُضف بنودًا بعد.</p> : <div className="inv-table-wrap table-wrap"><table className="inv-table"><thead><tr>
          <th>التصنيف</th><th>النوع</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th><th /></tr></thead><tbody>{cart.map((item) => {
            const cents = grossLineCents(safeMoneyCents(item.quantity), safeMoneyCents(item.unitPrice));
            return <tr key={item.key}><td>{item.categoryName}</td><td>{item.typeName}{Object.entries(item.values).length > 0 && <div className="sale-note">{Object.entries(item.values).map(([key, value]) => `${key}: ${value}`).join(" · ")}</div>}</td>
              <td><input className="sale-line-input" disabled={pending} inputMode="decimal" dir="ltr" value={item.quantity} onChange={(event) => updateLine(item.key, { quantity: event.target.value })} aria-label={`كمية ${item.typeName}`} /></td>
              <td><input className="sale-line-input" disabled={pending} inputMode="decimal" dir="ltr" value={item.unitPrice} onChange={(event) => updateLine(item.key, { unitPrice: event.target.value })} aria-label={`سعر ${item.typeName}`} /></td>
              <td><bdi dir="ltr">{displayMoney(cents)}</bdi></td>
              <td><button type="button" className="sale-product__remove" disabled={pending} onClick={() => removeLine(item.key)}>إزالة</button></td></tr>;
          })}</tbody></table></div>}</div>
      </div></section>

      <section className="inv-panel" aria-labelledby="sale-payment-title"><div className="inv-panel__heading"><h2 id="sale-payment-title">الخصم والدفعة الأولى</h2><p>أدخل الخصم بالجنيه أو بالنسبة المئوية، ويمكن تحصيل الباقي لاحقًا من الفاتورة.</p></div><div className="inv-panel__body inv-fields">
        <div className="inv-field">
          <div className="sale-field-head">
            <label htmlFor="sale-discount">الخصم ({discountMode === "EGP" ? "ج.م" : "%"})</label>
            <div className="sale-mode-switch" role="group" aria-label="طريقة إدخال الخصم">
              <button
                type="button"
                className={discountMode === "EGP" ? "is-active" : ""}
                onClick={() => {
                  edited();
                  setDiscountMode("EGP");
                }}
              >
                ج.م
              </button>
              <button
                type="button"
                className={discountMode === "PCT" ? "is-active" : ""}
                onClick={() => {
                  edited();
                  setDiscountMode("PCT");
                  syncDiscountFromPct(discountPctInput, liveSubtotalCents);
                }}
              >
                %
              </button>
            </div>
          </div>
          {discountMode === "EGP" ? (
            <input
              id="sale-discount"
              disabled={pending}
              inputMode="decimal"
              dir="ltr"
              value={discount}
              onChange={(event) => {
                edited();
                setDiscount(event.target.value);
              }}
            />
          ) : (
            <input
              id="sale-discount"
              disabled={pending}
              inputMode="decimal"
              dir="ltr"
              value={discountPctInput}
              onChange={(event) => {
                edited();
                syncDiscountFromPct(event.target.value, liveSubtotalCents);
              }}
              placeholder="مثال: 5"
            />
          )}
          <p className="inv-field__hint">
            {staff
              ? `حد الموظف الحالي ${(discountBps / 100).toString()}% (${displayMoney(maxAllowedDiscountCents)} ج.م على السلة الحالية).`
              : `السقف الأعلى ${(discountBps / 100).toString()}% (${displayMoney(maxAllowedDiscountCents)} ج.م) — قيمة الخصم الفعلية: ${displayMoney(liveDiscountCents)} ج.م.`}
          </p>
        </div>

        <div className="inv-field">
          <div className="sale-field-head">
            <label htmlFor="sale-initial">الدفعة الأولى (ج.م) *</label>
            {liveTotalCents > 0n ? (
              <button
                type="button"
                className="sale-fill-btn"
                disabled={pending}
                onClick={() => {
                  edited();
                  setInitialPayment(centsToInputDecimal(liveTotalCents));
                }}
              >
                سداد كامل ({displayMoney(liveTotalCents)})
              </button>
            ) : null}
          </div>
          <input id="sale-initial" disabled={pending} inputMode="decimal" dir="ltr" value={initialPayment} onChange={(event) => { edited(); setInitialPayment(event.target.value); }} />
          <p className="inv-field__hint">يجب أن تكون أكبر من صفر ولا تزيد على الإجمالي.</p>
        </div>
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
    <aside className="inv-side">
      <h2>ملخص الفاتورة اللحظي</h2>
      {review ? (
        <dl className="sale-totals">
          <div><dt>قيمة الأصناف</dt><dd>{displayMoney(review.subtotal)} ج.م</dd></div>
          <div><dt>الخصم</dt><dd>{displayMoney(review.discount)} ج.م</dd></div>
          <div className="sale-totals__strong"><dt>الإجمالي النهائي</dt><dd>{displayMoney(review.total)} ج.م</dd></div>
          <div><dt>الدفعة الأولى</dt><dd>{displayMoney(review.payment)} ج.م</dd></div>
          <div><dt>الباقي على العميل</dt><dd>{displayMoney(review.total - review.payment)} ج.م</dd></div>
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
        <p>أضف بندًا لإظهار الإجماليات والباقي على العميل لحظيًا أثناء الكتابة.</p>
      )}
      <p>السعر الذي تكتبه هو النهائي؛ الضريبة تُسجَّل «غير محددة» ولا يحسبها النظام. الإيصال داخلي وليس فاتورة إلكترونية رسمية.</p>
    </aside>
  </form>;
}
