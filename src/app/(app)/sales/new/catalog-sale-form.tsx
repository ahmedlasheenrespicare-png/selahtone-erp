"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";

import { AppIcon, type AppIconName } from "@/components/app-icon";
import type { CatalogCategoryView, CatalogFieldView } from "@/lib/catalog-sales";
import {
  MAX_CATALOG_LINES,
  parseCatalogSaleInput,
  type CatalogSaleLineInput,
} from "@/lib/catalog-validation";
import { displayMoney, METHOD_LABELS } from "@/lib/commerce-display";
import {
  grossLineCents,
  staffDiscountAllowed,
  validateCollectionAmount,
} from "@/lib/commerce-math";
import { duplicatesCatalogLine, type PaymentMethod } from "@/lib/commerce-validation";
import {
  buildReceiptShareSummary,
  computePaymentPresetCents,
  evaluateLiveDiscountStatus,
  formatCartFieldEntries,
  normalizeCounterWhatsAppPhone,
  type TypePriceHint,
} from "@/lib/counter-sale-helpers";
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
  key: string;
  categoryId: string;
  typeId: string;
  categoryName: string;
  typeName: string;
  quantity: string;
  unitPrice: string;
  values: Record<string, string>;
};

type Props = {
  requestId: string;
  catalog: CatalogCategoryView[];
  branches: BranchOption[];
  defaultBranchId: string;
  defaultBranchName?: string;
  staff: boolean;
  discountBps: number;
  knownCustomers?: KnownCustomerHint[];
  priceHints?: Record<string, TypePriceHint>;
  financeOn?: boolean;
  hasOpenCustody?: boolean;
  userScopeKey?: string;
};

type Review = {
  lines: CatalogSaleLineInput[];
  gross: bigint[];
  subtotal: bigint;
  discount: bigint;
  total: bigint;
  payment: bigint;
};

type SavedDraft = {
  branchId?: string;
  customerName?: string;
  customerPhone?: string;
  discount?: string;
  discountMode?: "EGP" | "PCT";
  discountPctInput?: string;
  initialPayment?: string;
  fullPaymentLocked?: boolean;
  method?: PaymentMethod;
  cart?: CartLine[];
};

const PAYMENT_CARD_OPTIONS: Array<{
  value: PaymentMethod;
  label: string;
  icon: AppIconName;
  shortHint: string;
}> = [
  {
    value: "CASH",
    label: "نقدي",
    icon: "cash",
    shortHint: "تحصيل نقدي بالكاونتر",
  },
  {
    value: "CARD",
    label: "بطاقة بنكية",
    icon: "sales",
    shortHint: "ماكينة POS / فيزا",
  },
  {
    value: "BANK_TRANSFER",
    label: "تحويل بنكي",
    icon: "transfers",
    shortHint: "إنستا باي / حساب بنكي",
  },
  {
    value: "WALLET",
    label: "محفظة إلكترونية",
    icon: "shield",
    shortHint: "فودافون كاش / محافظ",
  },
];

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
  defaultBranchName = "",
  staff,
  discountBps,
  knownCustomers = [],
  priceHints = {},
  financeOn = false,
  hasOpenCustody = false,
  userScopeKey = "default",
}: Props) {
  const draftStorageKey = `selahtone:new-sale-draft:${userScopeKey}`;

  const [branchId, setBranchId] = useState(defaultBranchId || branches[0]?.id || "");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [discount, setDiscount] = useState("0");
  const [discountMode, setDiscountMode] = useState<"EGP" | "PCT">("EGP");
  const [discountPctInput, setDiscountPctInput] = useState("0");
  const [initialPayment, setInitialPayment] = useState("");
  const [fullPaymentLocked, setFullPaymentLocked] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>("CASH");

  const [catalogSearch, setCatalogSearch] = useState("");
  const [categoryId, setCategoryId] = useState(catalog[0]?.id ?? "");
  const [typeId, setTypeId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});

  const [cart, setCart] = useState<CartLine[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [review, setReview] = useState<Review | null>(null);
  const [dismissedError, setDismissedError] = useState<SalesActionState | null>(null);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [restoredFromDraft, setRestoredFromDraft] = useState(false);
  const [copiedReceipt, setCopiedReceipt] = useState(false);

  const [state, formAction, pending] = useActionState(
    createCatalogSaleAction,
    initialSalesActionState,
  );
  const priceInputRef = useRef<HTMLInputElement>(null);

  // خريطة حقول كل نوع لترجمة مفاتيح الحقول إلى عناوينها العربية داخل السلة
  const typeMetaById = useMemo(() => {
    const map = new Map<
      string,
      { categoryId: string; categoryName: string; typeName: string; fields: CatalogFieldView[] }
    >();
    for (const cat of catalog) {
      for (const t of cat.types) {
        map.set(t.id, {
          categoryId: cat.id,
          categoryName: cat.name,
          typeName: t.name,
          fields: t.fields,
        });
      }
    }
    return map;
  }, [catalog]);

  // استعادة المسودة المحفوظة تلقائيًا من sessionStorage عند فتح الشاشة
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(draftStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as SavedDraft;
        if (parsed && typeof parsed === "object") {
          const validCart = Array.isArray(parsed.cart)
            ? parsed.cart.filter((item) => item && typeof item.typeId === "string" && typeMetaById.has(item.typeId))
            : [];
          const hasMeaningfulData =
            validCart.length > 0 ||
            Boolean(parsed.customerName?.trim()) ||
            Boolean(parsed.customerPhone?.trim());
          if (hasMeaningfulData) {
            if (parsed.branchId && (branches.length === 0 || branches.some((b) => b.id === parsed.branchId))) {
              setBranchId(parsed.branchId);
            }
            if (typeof parsed.customerName === "string") setCustomerName(parsed.customerName);
            if (typeof parsed.customerPhone === "string") setCustomerPhone(parsed.customerPhone);
            if (typeof parsed.discount === "string") setDiscount(parsed.discount);
            if (parsed.discountMode === "EGP" || parsed.discountMode === "PCT") {
              setDiscountMode(parsed.discountMode);
            }
            if (typeof parsed.discountPctInput === "string") {
              setDiscountPctInput(parsed.discountPctInput);
            }
            if (typeof parsed.initialPayment === "string") setInitialPayment(parsed.initialPayment);
            if (typeof parsed.fullPaymentLocked === "boolean") {
              setFullPaymentLocked(parsed.fullPaymentLocked);
            }
            if (
              parsed.method &&
              ["CASH", "CARD", "BANK_TRANSFER", "WALLET"].includes(parsed.method)
            ) {
              setMethod(parsed.method);
            }
            if (validCart.length > 0) setCart(validCart);
            setRestoredFromDraft(true);
          }
        }
      }
    } catch {
      // تجاهل أخطاء التخزين المؤقت للمتصفح
    } finally {
      setDraftHydrated(true);
    }
  }, [draftStorageKey, branches, typeMetaById]);

  // حفظ المسودة تلقائيًا وحذفها فور نجاح البيع
  useEffect(() => {
    if (!draftHydrated) return;
    try {
      if (state.status === "success") {
        window.sessionStorage.removeItem(draftStorageKey);
        return;
      }
      const isEmpty =
        cart.length === 0 &&
        !customerName.trim() &&
        !customerPhone.trim() &&
        (!initialPayment.trim() || initialPayment === "0");
      if (isEmpty) {
        window.sessionStorage.removeItem(draftStorageKey);
        return;
      }
      const payload: SavedDraft = {
        branchId,
        customerName,
        customerPhone,
        discount,
        discountMode,
        discountPctInput,
        initialPayment,
        fullPaymentLocked,
        method,
        cart,
      };
      window.sessionStorage.setItem(draftStorageKey, JSON.stringify(payload));
    } catch {
      // تجاهل قيود التخزين في الوضع الخاص
    }
  }, [
    draftHydrated,
    draftStorageKey,
    state.status,
    branchId,
    customerName,
    customerPhone,
    discount,
    discountMode,
    discountPctInput,
    initialPayment,
    fullPaymentLocked,
    method,
    cart,
  ]);

  const category = useMemo(
    () => catalog.find((item) => item.id === categoryId) ?? null,
    [catalog, categoryId],
  );
  const types = category?.types ?? [];
  const activeTypeId: string =
    typeId && types.some((item) => item.id === typeId)
      ? typeId
      : types.length === 1
        ? types[0]!.id
        : "";
  const activeType = types.find((item) => item.id === activeTypeId) ?? null;
  const activePriceHint = activeTypeId ? priceHints[activeTypeId] ?? null : null;

  const allQuickTypes = useMemo(() => {
    return catalog.flatMap((cat) =>
      cat.types.map((t) => ({
        catId: cat.id,
        catName: cat.name,
        typeId: t.id,
        typeName: t.name,
        label: cat.types.length === 1 ? cat.name : `${cat.name} · ${t.name}`,
      })),
    );
  }, [catalog]);

  const visibleQuickTypes = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase();
    const filtered = q
      ? allQuickTypes.filter(
          (qt) =>
            qt.label.toLowerCase().includes(q) ||
            qt.catName.toLowerCase().includes(q) ||
            qt.typeName.toLowerCase().includes(q),
        )
      : allQuickTypes;
    return filtered.slice(0, 14);
  }, [allQuickTypes, catalogSearch]);

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

  // الإجماليات اللحظية وفحص سقف الخصم الحيّ
  const liveSubtotalCents = useMemo(() => {
    return cart.reduce((sum, item) => {
      const q = safeMoneyCents(item.quantity);
      const p = safeMoneyCents(item.unitPrice);
      return sum + grossLineCents(q, p);
    }, 0n);
  }, [cart]);

  const liveDiscountCents = safeMoneyCents(discount);
  const discountVerdict = useMemo(
    () => evaluateLiveDiscountStatus(liveSubtotalCents, liveDiscountCents, discountBps),
    [liveSubtotalCents, liveDiscountCents, discountBps],
  );

  const liveTotalCents =
    liveSubtotalCents > liveDiscountCents ? liveSubtotalCents - liveDiscountCents : 0n;

  // إبقاء الدفعة الأولى مربوطة بكامل الإجمالي عندما يختار الموظف ربط السداد الكامل
  useEffect(() => {
    if (!fullPaymentLocked) return;
    if (liveTotalCents <= 0n) return;
    const nextStr = centsToInputDecimal(liveTotalCents);
    if (initialPayment !== nextStr) {
      setInitialPayment(nextStr);
    }
  }, [fullPaymentLocked, liveTotalCents, initialPayment]);

  const livePaymentCents = safeMoneyCents(initialPayment);
  const liveRemainingCents =
    liveTotalCents > livePaymentCents ? liveTotalCents - livePaymentCents : 0n;

  const selectedBranchName = useMemo(() => {
    if (branches.length > 0) {
      return branches.find((b) => b.id === branchId)?.name ?? defaultBranchName;
    }
    return defaultBranchName;
  }, [branches, branchId, defaultBranchName]);

  const hasDraftData =
    cart.length > 0 || Boolean(customerName.trim()) || Boolean(customerPhone.trim());

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

  function edited() {
    setReview(null);
    setErrors({});
    setDismissedError(state);
  }

  function clearDraftCompletely() {
    edited();
    setCustomerName("");
    setCustomerPhone("");
    setDiscount("0");
    setDiscountPctInput("0");
    setDiscountMode("EGP");
    setInitialPayment("");
    setFullPaymentLocked(false);
    setMethod("CASH");
    setQuantity("1");
    setUnitPrice("");
    setValues({});
    setCart([]);
    setRestoredFromDraft(false);
    try {
      window.sessionStorage.removeItem(draftStorageKey);
    } catch {
      // ignore
    }
  }

  function selectCategory(id: string) {
    edited();
    setCategoryId(id);
    setTypeId("");
    setValues({});
  }

  function selectType(id: string) {
    edited();
    setTypeId(id);
    setValues({});
  }

  function pickQuickItem(catId: string, tId: string) {
    edited();
    setCategoryId(catId);
    setTypeId(tId);
    setValues({});
    setTimeout(() => priceInputRef.current?.focus(), 20);
  }

  function validatePendingLineAgainst(
    existingCart: CartLine[],
  ): { ok: true; line: CartLine } | { ok: false; errors: FieldErrors } {
    if (!category || !activeType) {
      return { ok: false, errors: { lines: "اختر التصنيف والنوع." } };
    }
    if (existingCart.length >= MAX_CATALOG_LINES) {
      return {
        ok: false,
        errors: { lines: `الحد ${MAX_CATALOG_LINES} بندًا في الفاتورة.` },
      };
    }
    const asDetails = (item: { typeId: string; values: Record<string, string> }) => ({
      typeId: item.typeId,
      details: Object.entries(item.values).map(([key, value]) => ({ key, value })),
    });
    if (
      duplicatesCatalogLine([
        ...existingCart.map(asDetails),
        asDetails({ typeId: activeType.id, values }),
      ])
    ) {
      return {
        ok: false,
        errors: {
          lines:
            "هذا البند مضاف بالقيم نفسها؛ عدّل الكمية في بنده، أو غيّر أحد الحقول لإضافة وحدة أخرى.",
        },
      };
    }
    const missing = activeType.fields.filter(
      (field) => field.required && !(values[field.key] ?? "").trim(),
    );
    if (missing.length) {
      return {
        ok: false,
        errors: { lines: `اكتب: ${missing.map((field) => field.label).join("، ")}` },
      };
    }
    const parsed = parseCatalogSaleInput({
      requestId,
      branchId: branchId || "1",
      customerName: "تجربة",
      customerPhone: "01000000000",
      discount: "0",
      initialPayment: "1",
      method: "CASH",
      lines: [
        {
          typeId: activeType.id,
          quantity,
          unitPrice,
          details: Object.entries(values).map(([key, value]) => ({ key, value })),
        },
      ],
    });
    if (!parsed.ok) {
      return { ok: false, errors: parsed.errors };
    }
    return {
      ok: true,
      line: {
        key: crypto.randomUUID(),
        categoryId: category.id,
        typeId: activeType.id,
        categoryName: category.name,
        typeName: activeType.name,
        quantity: parsed.value.lines[0]!.quantity,
        unitPrice: parsed.value.lines[0]!.unitPrice,
        values: { ...values },
      },
    };
  }

  function addLine() {
    edited();
    const res = validatePendingLineAgainst(cart);
    if (!res.ok) {
      setErrors(res.errors);
      return;
    }
    const nextCart = [...cart, res.line];
    setCart(nextCart);
    if (discountMode === "PCT") {
      const nextSub = nextCart.reduce(
        (sum, it) => sum + grossLineCents(safeMoneyCents(it.quantity), safeMoneyCents(it.unitPrice)),
        0n,
      );
      syncDiscountFromPct(discountPctInput, nextSub);
    }
    setValues({});
    setUnitPrice("");
    setQuantity("1");
    setTypeId("");
  }

  function handleItemKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      addLine();
    }
  }

  function editLineInBuilder(item: CartLine) {
    edited();
    const remaining = cart.filter((row) => row.key !== item.key);
    setCart(remaining);
    if (discountMode === "PCT") {
      const nextSub = remaining.reduce(
        (sum, it) => sum + grossLineCents(safeMoneyCents(it.quantity), safeMoneyCents(it.unitPrice)),
        0n,
      );
      syncDiscountFromPct(discountPctInput, nextSub);
    }
    setCategoryId(item.categoryId);
    setTypeId(item.typeId);
    setQuantity(item.quantity);
    setUnitPrice(item.unitPrice);
    setValues({ ...item.values });
    setTimeout(() => priceInputRef.current?.focus(), 20);
  }

  function updateLine(key: string, patch: Partial<CartLine>) {
    edited();
    setCart((items) => {
      const next = items.map((item) => (item.key === key ? { ...item, ...patch } : item));
      if (discountMode === "PCT") {
        const nextSub = next.reduce(
          (sum, it) => sum + grossLineCents(safeMoneyCents(it.quantity), safeMoneyCents(it.unitPrice)),
          0n,
        );
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
        const nextSub = next.reduce(
          (sum, it) => sum + grossLineCents(safeMoneyCents(it.quantity), safeMoneyCents(it.unitPrice)),
          0n,
        );
        syncDiscountFromPct(discountPctInput, nextSub);
      }
      return next;
    });
  }

  function applyPaymentPreset(ratioBps: 10000 | 5000 | 2500) {
    edited();
    const presetCents = computePaymentPresetCents(liveTotalCents, ratioBps);
    setInitialPayment(centsToInputDecimal(presetCents));
    setFullPaymentLocked(ratioBps === 10000);
  }

  function buildRawInputFor(targetCart: CartLine[], overridePayment?: string, overrideDiscount?: string) {
    return {
      requestId,
      branchId,
      customerName,
      customerPhone,
      discount: overrideDiscount ?? discount,
      initialPayment: overridePayment ?? initialPayment,
      method,
      lines: targetCart.map((item) => ({
        typeId: item.typeId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        details: Object.entries(item.values).map(([key, value]) => ({ key, value })),
      })),
    };
  }

  function reviewValues() {
    let workingCart = cart;
    let workingDiscount = discount;
    let workingPayment = initialPayment;

    // دمج تلقائي للبند المكتوب أمام الموظف إن نسي الضغط على «إضافة البند»
    if (unitPrice.trim() !== "") {
      const pendingLine = validatePendingLineAgainst(cart);
      if (!pendingLine.ok) {
        setErrors(pendingLine.errors);
        setReview(null);
        return;
      }
      workingCart = [...cart, pendingLine.line];
      setCart(workingCart);
      setValues({});
      setUnitPrice("");
      setQuantity("1");
      setTypeId("");

      const nextSub = workingCart.reduce(
        (sum, it) => sum + grossLineCents(safeMoneyCents(it.quantity), safeMoneyCents(it.unitPrice)),
        0n,
      );
      if (discountMode === "PCT") {
        const num = Number(discountPctInput);
        const clampedBps = Number.isFinite(num) && num > 0 ? Math.min(10000, Math.round(num * 100)) : 0;
        const discCents = (nextSub * BigInt(clampedBps)) / 10000n;
        workingDiscount = centsToInputDecimal(discCents);
        setDiscount(workingDiscount);
      }
      const nextDiscCents = safeMoneyCents(workingDiscount);
      const nextTot = nextSub > nextDiscCents ? nextSub - nextDiscCents : 0n;
      if (fullPaymentLocked || (!workingPayment.trim() && workingCart.length === 1)) {
        // إذا كان ربط السداد الكامل مفعّلًا نحدّث الدفعة تلقائيًا
        if (fullPaymentLocked && nextTot > 0n) {
          workingPayment = centsToInputDecimal(nextTot);
          setInitialPayment(workingPayment);
        }
      }
    }

    const parsed = parseCatalogSaleInput(
      buildRawInputFor(workingCart, workingPayment, workingDiscount),
    );
    if (!parsed.ok) {
      setErrors(parsed.errors);
      setReview(null);
      return;
    }
    try {
      const value = parsed.value;
      const gross = value.lines.map((line) =>
        grossLineCents(scaledInteger(line.quantity, 2), scaledInteger(line.unitPrice, 2)),
      );
      const subtotal = gross.reduce((sum, item) => sum + item, 0n);
      const discountCents = scaledInteger(value.discount, 2);
      if (!staffDiscountAllowed(subtotal, discountCents, BigInt(discountBps))) {
        throw new Error("الخصم يتجاوز الحد المسموح لدورك.");
      }
      const payment = scaledInteger(value.initialPayment, 2);
      validateCollectionAmount(subtotal - discountCents, payment);
      setErrors({});
      setReview({
        lines: value.lines,
        gross,
        subtotal,
        discount: discountCents,
        total: subtotal - discountCents,
        payment,
      });
    } catch (error) {
      setReview(null);
      setErrors({
        form: error instanceof Error ? error.message : "راجع بيانات الفاتورة.",
      });
    }
  }

  // ==================== شاشة الإيصال الفوري عقب إتمام البيع بنجاح ====================
  if (state.status === "success") {
    const finalTotal = review?.total ?? liveTotalCents;
    const finalPaid = review?.payment ?? livePaymentCents;
    const finalRemaining = finalTotal > finalPaid ? finalTotal - finalPaid : 0n;
    const shareText = buildReceiptShareSummary({
      invoiceId: state.id ?? "",
      branchName: selectedBranchName || undefined,
      customerName,
      itemsSummary: cart.map((c) => `${c.typeName} × ${c.quantity}`),
      totalCents: finalTotal,
      paidCents: finalPaid,
      method,
    });
    const waPhone = normalizeCounterWhatsAppPhone(customerPhone);
    const waHref = waPhone
      ? `https://wa.me/${waPhone}?text=${encodeURIComponent(shareText)}`
      : null;

    return (
      <div className="sale-instant-receipt" role="status">
        <div className="sale-instant-receipt__banner">
          <div>
            <p className="inv-heading__eyebrow" style={{ color: "var(--sl-muted)", marginBottom: 4 }}>
              تم حفظ الفاتورة والدفعة الأولى بنجاح
            </p>
            <h2 style={{ margin: 0 }}>إيصال بيع داخلي مؤكد</h2>
          </div>
          <span className="sale-instant-receipt__code" dir="ltr">
            <AppIcon name="receipt" />
            <span>ST-{state.id}</span>
          </span>
        </div>

        <p style={{ margin: "0 0 12px", color: "var(--sl-muted)", fontSize: 13 }}>
          {state.message}
        </p>

        <div className="sale-instant-receipt__grid">
          <div className="sale-instant-receipt__stat">
            <span>العميل</span>
            <strong>{customerName}</strong>
            <small dir="ltr" style={{ color: "var(--sl-muted)" }}>
              {customerPhone}
            </small>
          </div>
          <div className="sale-instant-receipt__stat">
            <span>صافي الفاتورة</span>
            <strong dir="ltr">{displayMoney(finalTotal)} ج.م</strong>
          </div>
          <div className="sale-instant-receipt__stat">
            <span>المسدّد ({METHOD_LABELS[method]})</span>
            <strong dir="ltr">{displayMoney(finalPaid)} ج.م</strong>
          </div>
          <div className="sale-instant-receipt__stat">
            <span>الباقي على العميل</span>
            <strong dir="ltr">{displayMoney(finalRemaining)} ج.م</strong>
          </div>
        </div>

        <div className="inv-actions" style={{ flexWrap: "wrap", gap: 10 }}>
          <Link className="inv-button" href={`/sales/${state.id}`}>
            <AppIcon name="printer" />
            <span>فتح وطباعة الإيصال (ST-{state.id})</span>
          </Link>

          {waHref ? (
            <a
              href={waHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inv-button inv-button--secondary"
            >
              <AppIcon name="share" />
              <span>إرسال الإيصال عبر واتساب</span>
            </a>
          ) : null}

          <button
            type="button"
            className="inv-button inv-button--secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(shareText);
                setCopiedReceipt(true);
                setTimeout(() => setCopiedReceipt(false), 2500);
              } catch {
                // ignore clipboard permission errors
              }
            }}
          >
            <AppIcon name="check" />
            <span>{copiedReceipt ? "تم نسخ الملخص ✓" : "نسخ ملخص الإيصال"}</span>
          </button>

          <a className="inv-button inv-button--secondary" href="/sales/new">
            <AppIcon name="plusCircle" />
            <span>بدء بيع جديد فورًا</span>
          </a>

          <Link className="inv-button inv-button--text" href="/sales">
            كل الفواتير
          </Link>
        </div>
      </div>
    );
  }

  // ==================== نموذج الكاونتر الرئيسي ====================
  return (
    <form
      className="sale-grid"
      action={formAction}
      noValidate
      onSubmit={(event) => {
        if (!review) {
          event.preventDefault();
          reviewValues();
        }
      }}
    >
      <input type="hidden" name="reviewed" value={review ? "yes" : "no"} />
      <input
        type="hidden"
        name="payload"
        value={
          review
            ? JSON.stringify({
                ...buildRawInputFor(cart),
                lines: review.lines,
              })
            : ""
        }
      />

      <div className="sale-stack">
        {hasDraftData ? (
          <div className="sale-draft-bar no-print">
            <span className="sale-draft-bar__info">
              <span className="sale-draft-bar__dot" aria-hidden="true" />
              <span>
                {restoredFromDraft
                  ? "استُعيدت مسودة البيع غير المحفوظة تلقائيًا لحماية عملك."
                  : "المسودة محفوظة تلقائيًا في هذه الجلسة حتى تأكيد البيع."}
              </span>
            </span>
            <button
              type="button"
              className="sale-draft-reset"
              disabled={pending}
              onClick={clearDraftCompletely}
            >
              <AppIcon name="close" />
              <span>تفريغ النموذج</span>
            </button>
          </div>
        ) : null}

        {state.status === "error" && state !== dismissedError && (
          <div className="inv-alert inv-alert--error" role="alert">
            <strong>{state.message}</strong>
            {state.fieldErrors && (
              <ul>
                {Object.entries(state.fieldErrors).map(([key, value]) => (
                  <li key={key}>{value}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {Object.keys(errors).length > 0 && (
          <div className="inv-alert inv-alert--error" role="alert">
            <strong>راجع البيانات:</strong>
            <ul>
              {Object.entries(errors).map(([key, value]) => (
                <li key={key}>{value}</li>
              ))}
            </ul>
          </div>
        )}

        {/* ١) بيانات الفرع والعميل */}
        <section className="inv-panel" aria-labelledby="sale-customer-title">
          <div className="inv-panel__heading">
            <h2 id="sale-customer-title">١. بيانات الفرع والعميل</h2>
            <p>
              ابدأ برقم الهاتف أو اسم العميل للتعبئة التلقائية من سجله السابق وفحص أي متأخرات مستحقة.
            </p>
          </div>
          <div className="inv-panel__body inv-fields">
            {branches.length > 0 && (
              <div className="inv-field">
                <label htmlFor="sale-branch">الفرع *</label>
                <select
                  id="sale-branch"
                  disabled={pending}
                  value={branchId}
                  onChange={(event) => {
                    edited();
                    setBranchId(event.target.value);
                  }}
                >
                  <option value="">اختر الفرع</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="inv-field">
              <label htmlFor="sale-customer-phone">رقم الهاتف *</label>
              <input
                id="sale-customer-phone"
                disabled={pending}
                value={customerPhone}
                onChange={(event) => {
                  edited();
                  setCustomerPhone(event.target.value);
                }}
                maxLength={30}
                dir="ltr"
                inputMode="tel"
                placeholder="01xxxxxxxxx"
                aria-invalid={!!errors.customerPhone}
              />
            </div>

            <div className="inv-field">
              <label htmlFor="sale-customer-name">اسم العميل *</label>
              <input
                id="sale-customer-name"
                disabled={pending}
                value={customerName}
                onChange={(event) => {
                  edited();
                  setCustomerName(event.target.value);
                }}
                maxLength={180}
                placeholder="الاسم الثلاثي أو التجاري"
                aria-invalid={!!errors.customerName}
              />
            </div>

            {customerMatches.length > 0 &&
            !(exactMatchedCustomer && customerName === exactMatchedCustomer.name) ? (
              <div
                className="inv-field inv-field--wide sale-customer-hints"
                aria-label="عملاء مسجلون سابقًا"
              >
                <span className="sale-customer-hints__label">
                  عملاء مسجّلون سابقًا (اضغط للتعبئة الفورية):
                </span>
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
                        ({c.invoiceCount}{" "}
                        {c.invoiceCount === 1 ? "فاتورة" : "فواتير"}
                        {c.hasUnpaid ? ` · متبقٍ ${c.unpaidFormatted} ج.م` : ""})
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {exactMatchedCustomer?.hasUnpaid ? (
              <div className="inv-field inv-field--wide">
                <div className="inv-alert inv-alert--warning" role="status" style={{ margin: 0 }}>
                  تنبيه تحصيل: العميل <strong>{exactMatchedCustomer.name}</strong> لديه رصيد متبقٍ من فواتير سابقة قدره{" "}
                  <strong>
                    <bdi dir="ltr">{exactMatchedCustomer.unpaidFormatted}</bdi> ج.م
                  </strong>
                  .
                </div>
              </div>
            ) : null}
          </div>
        </section>

        {/* ٢) كاونتر الأصناف السريع والسلة */}
        <section className="inv-panel" aria-labelledby="sale-items-title">
          <div className="inv-panel__heading">
            <h2 id="sale-items-title">٢. الأصناف والتسعير</h2>
            <p>
              ابحث أو انقر الصنف مباشرةً، واكتب السعر أو اختر السعر الاسترشادي ثم اضغط <kbd>Enter</kbd> أو «إضافة البند».
            </p>
          </div>
          <div className="inv-panel__body">
            {allQuickTypes.length > 0 ? (
              <div className="sale-quick-bar" aria-label="اختيار سريع للأصناف">
                {allQuickTypes.length > 5 ? (
                  <div className="sale-catalog-search">
                    <AppIcon name="search" />
                    <input
                      id="sale-catalog-search"
                      type="search"
                      value={catalogSearch}
                      onChange={(e) => setCatalogSearch(e.target.value)}
                      placeholder="بحث فوري في الأصناف والتصنيفات…"
                      aria-label="بحث فوري في الأصناف"
                    />
                  </div>
                ) : null}
                <span className="sale-quick-bar__label">اختيار بنقرة واحدة:</span>
                <div className="sale-quick-chips">
                  {visibleQuickTypes.map((qt) => {
                    const selected =
                      categoryId === qt.catId && activeTypeId === qt.typeId;
                    const hint = priceHints[qt.typeId];
                    return (
                      <button
                        key={qt.typeId}
                        type="button"
                        className={`sale-quick-chip${selected ? " is-active" : ""}`}
                        disabled={pending}
                        onClick={() => pickQuickItem(qt.catId, qt.typeId)}
                      >
                        <span>{qt.label}</span>
                        {hint ? <small dir="ltr">{hint.commonFormatted} ج.م</small> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="sale-inline">
              <div className="inv-field">
                <label htmlFor="sale-category">التصنيف</label>
                <select
                  id="sale-category"
                  disabled={pending}
                  value={categoryId}
                  onChange={(event) => selectCategory(event.target.value)}
                >
                  {catalog.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </div>

              {types.length > 1 && (
                <div className="inv-field">
                  <label htmlFor="sale-type">النوع</label>
                  <select
                    id="sale-type"
                    disabled={pending}
                    value={activeTypeId}
                    onChange={(event) => selectType(event.target.value)}
                  >
                    <option value="">اختر النوع</option>
                    {types.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="inv-field">
                <label htmlFor="sale-quantity">الكمية</label>
                <input
                  id="sale-quantity"
                  disabled={pending}
                  inputMode="decimal"
                  dir="ltr"
                  value={quantity}
                  onKeyDown={handleItemKeyDown}
                  onChange={(event) => {
                    edited();
                    setQuantity(event.target.value);
                  }}
                />
              </div>

              <div className="inv-field">
                <label htmlFor="sale-price">السعر (ج.م) *</label>
                <input
                  ref={priceInputRef}
                  id="sale-price"
                  disabled={pending}
                  inputMode="decimal"
                  dir="ltr"
                  value={unitPrice}
                  onKeyDown={handleItemKeyDown}
                  onChange={(event) => {
                    edited();
                    setUnitPrice(event.target.value);
                  }}
                  placeholder="السعر المتفق عليه"
                />
              </div>
            </div>

            {activePriceHint ? (
              <div className="sale-price-hints" aria-label="أسعار استرشادية من مبيعات الفرع">
                <span className="sale-price-hints__label">تسعير استرشادي لهذا النوع:</span>
                <button
                  type="button"
                  className="sale-price-hint-btn"
                  disabled={pending}
                  onClick={() => {
                    edited();
                    setUnitPrice(activePriceHint.latestPrice);
                  }}
                >
                  <span>آخر بيع:</span>
                  <bdi dir="ltr">{activePriceHint.latestFormatted}</bdi>
                  <span>ج.م</span>
                </button>
                {activePriceHint.commonPrice !== activePriceHint.latestPrice ? (
                  <button
                    type="button"
                    className="sale-price-hint-btn"
                    disabled={pending}
                    onClick={() => {
                      edited();
                      setUnitPrice(activePriceHint.commonPrice);
                    }}
                  >
                    <span>الأكثر تكرارًا:</span>
                    <bdi dir="ltr">{activePriceHint.commonFormatted}</bdi>
                    <span>ج.م</span>
                  </button>
                ) : null}
              </div>
            ) : null}

            {activeType && activeType.fields.length > 0 && (
              <div className="inv-fields" style={{ marginTop: 12 }}>
                {activeType.fields.map((field) => (
                  <div className="inv-field" key={field.id}>
                    <label htmlFor={`field-${field.id}`}>
                      {field.label}
                      {field.required ? " *" : ""}
                    </label>
                    <input
                      id={`field-${field.id}`}
                      disabled={pending}
                      value={values[field.key] ?? ""}
                      maxLength={300}
                      onKeyDown={handleItemKeyDown}
                      onChange={(event) => {
                        edited();
                        setValues((old) => ({
                          ...old,
                          [field.key]: event.target.value,
                        }));
                      }}
                    />
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginTop: 12 }}>
              <button
                type="button"
                className="inv-button inv-button--secondary"
                disabled={pending}
                onClick={addLine}
              >
                <AppIcon name="plusCircle" />
                <span>إضافة البند للسلة</span>
              </button>
            </div>

            <div style={{ marginTop: 16 }}>
              {cart.length === 0 ? (
                <p className="sale-note">
                  لم تُضف بنودًا بعد. إن كانت الفاتورة لبند واحد يمكنك تعبئة السعر أعلاه والضغط على «مراجعة الفاتورة» مباشرةً.
                </p>
              ) : (
                <div className="inv-table-wrap table-wrap" role="region" aria-label="بنود سلة البيع" tabIndex={0}>
                  <table className="inv-table">
                    <thead>
                      <tr>
                        <th>التصنيف</th>
                        <th>النوع والتفاصيل</th>
                        <th>الكمية</th>
                        <th>سعر الوحدة</th>
                        <th>الإجمالي</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {cart.map((item) => {
                        const cents = grossLineCents(
                          safeMoneyCents(item.quantity),
                          safeMoneyCents(item.unitPrice),
                        );
                        const meta = typeMetaById.get(item.typeId);
                        const arabicEntries = formatCartFieldEntries(
                          meta?.fields ?? [],
                          item.values,
                        );
                        return (
                          <tr key={item.key}>
                            <td>{item.categoryName}</td>
                            <td>
                              <strong>{item.typeName}</strong>
                              {arabicEntries.length > 0 ? (
                                <div className="sale-cart-tags">
                                  {arabicEntries.map((entry) => (
                                    <span key={entry.key} className="sale-cart-tag">
                                      <strong>{entry.label}:</strong> {entry.value}
                                    </span>
                                  ))}
                                </div>
                              ) : null}
                            </td>
                            <td>
                              <input
                                className="sale-line-input"
                                disabled={pending}
                                inputMode="decimal"
                                dir="ltr"
                                value={item.quantity}
                                onChange={(event) =>
                                  updateLine(item.key, {
                                    quantity: event.target.value,
                                  })
                                }
                                aria-label={`كمية ${item.typeName}`}
                              />
                            </td>
                            <td>
                              <input
                                className="sale-line-input"
                                disabled={pending}
                                inputMode="decimal"
                                dir="ltr"
                                value={item.unitPrice}
                                onChange={(event) =>
                                  updateLine(item.key, {
                                    unitPrice: event.target.value,
                                  })
                                }
                                aria-label={`سعر ${item.typeName}`}
                              />
                            </td>
                            <td>
                              <strong>
                                <bdi dir="ltr">{displayMoney(cents)}</bdi>
                              </strong>
                            </td>
                            <td>
                              <div className="sale-cart-actions">
                                <button
                                  type="button"
                                  className="sale-line-edit"
                                  disabled={pending}
                                  onClick={() => editLineInBuilder(item)}
                                >
                                  تعديل
                                </button>
                                <button
                                  type="button"
                                  className="sale-product__remove"
                                  disabled={pending}
                                  onClick={() => removeLine(item.key)}
                                >
                                  إزالة
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ٣) الخصم والدفعة الأولى ووسيلة الدفع */}
        <section className="inv-panel" aria-labelledby="sale-payment-title">
          <div className="inv-panel__heading">
            <h2 id="sale-payment-title">٣. الخصم والتحصيل ووسيلة الدفع</h2>
            <p>
              حدّد الخصم ضمن سقف صلاحيتك، واختر نسبة الدفعة الأولى ووسيلة التحصيل الفعلية.
            </p>
          </div>
          <div className="inv-panel__body inv-fields">
            <div className="inv-field">
              <div className="sale-field-head">
                <label htmlFor="sale-discount">
                  الخصم ({discountMode === "EGP" ? "ج.م" : "%"})
                </label>
                <div
                  className="sale-mode-switch"
                  role="group"
                  aria-label="طريقة إدخال الخصم"
                >
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

              {liveSubtotalCents > 0n && liveDiscountCents > 0n ? (
                <div
                  className={`sale-discount-guard ${
                    discountVerdict.withinLimit ? "is-ok" : "is-over"
                  }`}
                  role="status"
                >
                  {discountVerdict.withinLimit ? (
                    <span>
                      الخصم الفعلي ({discountVerdict.effectivePercentLabel}%) ضمن السقف المسموح ({discountVerdict.ceilingPercentLabel}%) ✓
                    </span>
                  ) : (
                    <span>
                      تجاوزت السقف المسموح ({discountVerdict.ceilingPercentLabel}%) بمقدار{" "}
                      <bdi dir="ltr">{displayMoney(discountVerdict.excessCents)}</bdi> ج.م
                    </span>
                  )}
                </div>
              ) : (
                <p className="inv-field__hint">
                  {staff
                    ? `حد خصم الموظف ${(discountBps / 100).toString()}% (${displayMoney(discountVerdict.maxAllowedCents)} ج.م على السلة الحالية).`
                    : `سقف خصم المدير ${(discountBps / 100).toString()}% (${displayMoney(discountVerdict.maxAllowedCents)} ج.م على السلة الحالية).`}
                </p>
              )}
            </div>

            <div className="inv-field">
              <div className="sale-field-head">
                <label htmlFor="sale-initial">الدفعة الأولى (ج.م) *</label>
                {liveTotalCents > 0n ? (
                  <div className="sale-payment-presets">
                    <button
                      type="button"
                      className={`sale-fill-btn${fullPaymentLocked ? " is-locked" : ""}`}
                      disabled={pending}
                      onClick={() => applyPaymentPreset(10000)}
                      title="يسدّد كامل الإجمالي ويتحدث تلقائيًا عند تعديل السلة"
                    >
                      سداد كامل 100% ({displayMoney(liveTotalCents)})
                    </button>
                    <button
                      type="button"
                      className="sale-fill-btn"
                      disabled={pending}
                      onClick={() => applyPaymentPreset(5000)}
                    >
                      50%
                    </button>
                    <button
                      type="button"
                      className="sale-fill-btn"
                      disabled={pending}
                      onClick={() => applyPaymentPreset(2500)}
                    >
                      25%
                    </button>
                  </div>
                ) : null}
              </div>
              <input
                id="sale-initial"
                disabled={pending}
                inputMode="decimal"
                dir="ltr"
                value={initialPayment}
                onChange={(event) => {
                  edited();
                  setFullPaymentLocked(false);
                  setInitialPayment(event.target.value);
                }}
              />
              <p className="inv-field__hint">
                {fullPaymentLocked
                  ? "مربوطة بالسداد الكامل تلقائيًا — تتحدّث مع أي تعديل في السلة."
                  : "يجب أن تكون أكبر من صفر ولا تزيد على الإجمالي النهائي."}
              </p>
            </div>

            <div className="inv-field inv-field--wide">
              <label id="sale-method-label">وسيلة الدفع الفعلية *</label>
              <input type="hidden" id="sale-method" value={method} readOnly />
              <div
                className="sale-pay-cards"
                role="radiogroup"
                aria-labelledby="sale-method-label"
              >
                {PAYMENT_CARD_OPTIONS.map((opt) => {
                  const selected = method === opt.value;
                  const cashHint =
                    opt.value === "CASH" && financeOn
                      ? "مؤقتًا: عهدة مفتوحة للمسجّل دون طلب تسوية أو جرد مفتوح في فرع الفاتورة"
                      : opt.shortHint;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      disabled={pending}
                      className={`sale-pay-card${selected ? " is-active" : ""}`}
                      onClick={() => {
                        edited();
                        setMethod(opt.value);
                      }}
                    >
                      <div className="sale-pay-card__head">
                        <strong>{opt.label}</strong>
                        <AppIcon name={opt.icon} />
                      </div>
                      <small>{cashHint}</small>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {review && (
          <section
            className="inv-review"
            aria-labelledby="sale-review-title"
            aria-live="polite"
          >
            <h2 id="sale-review-title">راجع الفاتورة قبل التأكيد النهائي</h2>
            <p>
              لن يُحفظ شيء حتى تضغط «تأكيد البيع». الخادم يعيد فحص الأصناف والأسعار وسقف الخصم عند الحفظ.
            </p>
            <dl>
              <div>
                <dt>العميل</dt>
                <dd>
                  {customerName} — <bdi dir="ltr">{customerPhone}</bdi>
                </dd>
              </div>
              {selectedBranchName ? (
                <div>
                  <dt>الفرع</dt>
                  <dd>{selectedBranchName}</dd>
                </div>
              ) : null}
              <div>
                <dt>البنود ({cart.length})</dt>
                <dd>
                  {cart
                    .map(
                      (item) =>
                        `${item.categoryName} — ${item.typeName} × ${item.quantity}`,
                    )
                    .join(" · ")}
                </dd>
              </div>
              <div>
                <dt>الدفعة الأولى ({METHOD_LABELS[method]})</dt>
                <dd>{displayMoney(review.payment)} ج.م</dd>
              </div>
              <div>
                <dt>الباقي على العميل</dt>
                <dd>{displayMoney(review.total - review.payment)} ج.م</dd>
              </div>
            </dl>
          </section>
        )}

        <div className="inv-form-actions">
          {!review ? (
            <button
              type="button"
              className="inv-button"
              disabled={pending}
              onClick={(event) => {
                event.preventDefault();
                reviewValues();
              }}
            >
              <AppIcon name="receipt" />
              <span>مراجعة الفاتورة</span>
            </button>
          ) : (
            <>
              <button type="submit" className="inv-button" disabled={pending}>
                <AppIcon name="check" />
                <span>{pending ? "جارٍ حفظ الفاتورة…" : "تأكيد البيع وإصدار الإيصال"}</span>
              </button>
              <button
                type="button"
                className="inv-button inv-button--secondary"
                disabled={pending}
                onClick={() => setReview(null)}
              >
                تعديل البيانات
              </button>
            </>
          )}
          <Link className="inv-button inv-button--text" href="/sales">
            إلغاء
          </Link>
        </div>
      </div>

      {/* ==================== الإيصال الحيّ المثبّت (Sticky Live Receipt) ==================== */}
      <aside className="inv-side sale-live-receipt" aria-label="معاينة الإيصال اللحظية">
        <div className="sale-receipt-head">
          <h2>الإيصال اللحظي</h2>
          <span className="sale-cart-tag">
            {METHOD_LABELS[method]}
          </span>
        </div>

        <div className="sale-receipt-meta">
          {selectedBranchName ? (
            <span>
              الفرع: <strong>{selectedBranchName}</strong>
            </span>
          ) : null}
          <span>
            العميل:{" "}
            <strong>
              {customerName.trim() ? customerName : "لم يُحدَّد بعد"}
            </strong>
          </span>
          {customerPhone.trim() ? (
            <span dir="ltr">{customerPhone}</span>
          ) : null}
        </div>

        {cart.length > 0 ? (
          <ul className="sale-receipt-lines">
            {cart.map((item) => {
              const lineGross = grossLineCents(
                safeMoneyCents(item.quantity),
                safeMoneyCents(item.unitPrice),
              );
              return (
                <li key={item.key}>
                  <span>
                    {item.typeName} <small dir="ltr">× {item.quantity}</small>
                  </span>
                  <strong dir="ltr">{displayMoney(lineGross)}</strong>
                </li>
              );
            })}
          </ul>
        ) : null}

        {review ? (
          <>
            <dl className="sale-totals">
              <div>
                <dt>قيمة الأصناف</dt>
                <dd>{displayMoney(review.subtotal)} ج.م</dd>
              </div>
              <div>
                <dt>الخصم</dt>
                <dd>{displayMoney(review.discount)} ج.م</dd>
              </div>
              <div className="sale-totals__strong">
                <dt>الإجمالي النهائي</dt>
                <dd>{displayMoney(review.total)} ج.م</dd>
              </div>
              <div>
                <dt>الدفعة الأولى</dt>
                <dd>{displayMoney(review.payment)} ج.م</dd>
              </div>
              <div>
                <dt>الباقي على العميل</dt>
                <dd>{displayMoney(review.total - review.payment)} ج.م</dd>
              </div>
            </dl>
            <span
              className={`sale-due-pill ${
                review.total - review.payment === 0n
                  ? "sale-due-pill--paid"
                  : "sale-due-pill--due"
              }`}
            >
              {review.total - review.payment === 0n
                ? "مسدّدة بالكامل ✓"
                : `متبقٍ للتحصيل: ${displayMoney(review.total - review.payment)} ج.م`}
            </span>
          </>
        ) : cart.length > 0 ? (
          <>
            <dl className="sale-totals">
              <div>
                <dt>قيمة الأصناف ({cart.length})</dt>
                <dd>{displayMoney(liveSubtotalCents)} ج.م</dd>
              </div>
              <div>
                <dt>الخصم</dt>
                <dd>{displayMoney(liveDiscountCents)} ج.م</dd>
              </div>
              <div className="sale-totals__strong">
                <dt>الإجمالي النهائي</dt>
                <dd>{displayMoney(liveTotalCents)} ج.م</dd>
              </div>
              <div>
                <dt>الدفعة الأولى</dt>
                <dd>{displayMoney(livePaymentCents)} ج.م</dd>
              </div>
              <div>
                <dt>الباقي على العميل</dt>
                <dd>{displayMoney(liveRemainingCents)} ج.م</dd>
              </div>
            </dl>
            <span
              className={`sale-due-pill ${
                liveTotalCents > 0n && liveRemainingCents === 0n && livePaymentCents === liveTotalCents
                  ? "sale-due-pill--paid"
                  : "sale-due-pill--due"
              }`}
            >
              {liveTotalCents > 0n && liveRemainingCents === 0n && livePaymentCents === liveTotalCents
                ? "مسدّدة بالكامل ✓"
                : `الباقي على العميل: ${displayMoney(liveRemainingCents)} ج.م`}
            </span>
          </>
        ) : (
          <p style={{ margin: 0 }}>
            اختر الصنف واكتب السعر لعرض تفاصيل الإيصال والباقي على العميل لحظيًا.
          </p>
        )}

        <div className="sale-receipt-cta no-print">
          {!review ? (
            <button
              type="button"
              className="inv-button"
              disabled={pending}
              onClick={(event) => {
                event.preventDefault();
                reviewValues();
              }}
            >
              <AppIcon name="receipt" />
              <span>مراجعة الفاتورة</span>
            </button>
          ) : (
            <button type="submit" className="inv-button" disabled={pending}>
              <AppIcon name="check" />
              <span>{pending ? "جارٍ الحفظ…" : "تأكيد البيع الآن"}</span>
            </button>
          )}
        </div>

        <p style={{ margin: 0, fontSize: 11.5 }}>
          السعر المكتوب نهائي؛ الضريبة تُسجَّل «غير محددة» ولا يحسبها النظام. الإيصال داخلي وليس فاتورة إلكترونية رسمية.
        </p>
      </aside>
    </form>
  );
}
