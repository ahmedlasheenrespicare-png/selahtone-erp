/*
 * A deliberately isolated, in-memory DEMONSTRATION model.
 * It is not the ERP sales engine: there is no database, authentication, persistence,
 * payment processor, official tax calculation, or server-side authorization here.
 */
export const BRANCHES = Object.freeze([
  { id: "demo-a", name: "الفرع التجريبي الأول", warehouse: "المستودع التجريبي الأول" },
  { id: "demo-b", name: "الفرع التجريبي الثاني", warehouse: "المستودع التجريبي الثاني" },
]);

// Prices, rates, product names, serials and customers are invented for the preview.
export const PRODUCTS = Object.freeze([
  { id: "aid", sku: "DEMO-HA-01", name: "سماعة رقمية تجريبية", detail: "جهاز يتطلب رقمًا تسلسليًا", category: "سماعة طبية", price: 580000, taxBps: 1000, serialized: true, icon: "ear" },
  { id: "battery", sku: "DEMO-BAT-01", name: "بطاريات سماعة تجريبية", detail: "عبوة بطاريات", category: "مستلزم", price: 12000, taxBps: 500, serialized: false, icon: "battery" },
  { id: "care", sku: "DEMO-CARE-01", name: "مجموعة عناية تجريبية", detail: "مستلزمات تنظيف", category: "مستلزم", price: 35000, taxBps: 0, serialized: false, icon: "sparkle" },
]);

export const METHODS = Object.freeze([
  { id: "cash", label: "نقدي" },
  { id: "card", label: "بطاقة" },
  { id: "transfer", label: "تحويل بنكي" },
  { id: "wallet", label: "محفظة" },
]);
export const ROLE_LABELS = Object.freeze({ staff: "موظف فرع تجريبي", manager: "مدير تجريبي", accountant: "محاسب تجريبي" });

const productById = (id) => PRODUCTS.find((item) => item.id === id);
const branchById = (id) => BRANCHES.find((branch) => branch.id === id);
const methodById = (id) => METHODS.find((method) => method.id === id);
const clone = (value) => structuredClone(value);

export class DemoError extends Error {
  constructor(message, field = null) {
    super(message);
    this.name = "DemoError";
    this.field = field;
  }
}

export function latinDigits(value) {
  return String(value).replace(/[٠-٩۰-۹]/g, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

/** Parse display currency or percentage into integer hundredths. No floating-point arithmetic. */
export function parseHundredths(value) {
  const normalized = latinDigits(String(value ?? "").trim()).replace(/٫/g, ".");
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) return null;
  const whole = Number(match[1]);
  return whole * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

export function formatMoney(cents) {
  const sign = cents < 0 ? "-" : "";
  const value = Math.abs(cents);
  const whole = Math.floor(value / 100).toLocaleString("en-US");
  return `${sign}${whole}.${String(value % 100).padStart(2, "0")}`;
}

export function formatPercent(bps) {
  return `${Math.floor(bps / 100)}${bps % 100 ? `.${String(bps % 100).padStart(2, "0").replace(/0$/, "")}` : ""}%`;
}

export function initialDraft(branchId = "demo-a", prefilled = false) {
  return {
    branchId,
    customerName: prefilled ? "عميل تجريبي" : "",
    phone: prefilled ? "01000000000" : "",
    cart: prefilled ? [{ productId: "aid", serials: ["SN-DEMO-A101"] }, { productId: "battery", quantity: 2 }] : [],
    discount: prefilled ? "100" : "0",
    initialPayment: prefilled ? "1500" : "",
    method: "cash",
  };
}

function basicState() {
  return {
    role: "manager",
    staffBranch: "demo-a",
    discountLimitBps: 500,
    stock: {
      "demo-a": { aid: ["SN-DEMO-A100", "SN-DEMO-A101", "SN-DEMO-A102", "SN-DEMO-A103"], battery: 14, care: 8 },
      "demo-b": { aid: ["SN-DEMO-B201", "SN-DEMO-B202"], battery: 9, care: 6 },
    },
    draft: {
      branchId: "demo-a", customerName: "عميل تجريبي سابق", phone: "01000000001",
      cart: [{ productId: "aid", serials: ["SN-DEMO-A100"] }, { productId: "battery", quantity: 2 }],
      discount: "100", initialPayment: "2000", method: "cash",
    },
    invoices: [],
    nextInvoice: 1001,
    nextPayment: 1,
    nextReturn: 1,
  };
}

export function createInitialState() {
  // A fictional pre-existing invoice lets users try collections and returns immediately.
  const seeded = createSale(basicState()).state;
  seeded.role = "staff";
  seeded.draft = initialDraft("demo-a", true);
  return seeded;
}

export function canSeeInvoice(state, invoice) {
  return !!invoice && (state.role !== "staff" || invoice.branchId === state.staffBranch);
}

export function availableFor(state, branchId, productId) {
  const product = productById(productId);
  const value = state.stock[branchId]?.[productId];
  if (!product || value === undefined) return product?.serialized ? [] : 0;
  return Array.isArray(value) ? [...value] : value;
}

/** Divide an invoice-level discount across units, preserving every cent. */
export function distributeDiscount(grossValues, discount) {
  const sum = grossValues.reduce((total, gross) => total + gross, 0);
  if (!Number.isSafeInteger(discount) || discount < 0 || discount > sum || grossValues.some((gross) => !Number.isSafeInteger(gross) || gross < 0)) {
    throw new DemoError("قيمة الخصم غير صالحة.", "discount");
  }
  if (!sum) return grossValues.map(() => 0);
  const total = BigInt(sum);
  const allocated = grossValues.map((gross, index) => {
    const numerator = BigInt(discount) * BigInt(gross);
    return { index, cents: Number(numerator / total), remainder: numerator % total };
  });
  let left = discount - allocated.reduce((totalCents, part) => totalCents + part.cents, 0);
  const order = [...allocated].sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1);
  for (let index = 0; index < left; index++) order[index].cents++;
  return allocated.map((part) => part.cents);
}

function includedTax(netCents, taxBps) {
  const numerator = BigInt(netCents) * BigInt(taxBps);
  const denominator = BigInt(10000 + taxBps);
  return Number((numerator * 2n + denominator) / (denominator * 2n));
}

function cartUnits(state) {
  const branch = branchById(state.draft.branchId);
  if (!branch) throw new DemoError("اختر فرعًا تجريبيًا متاحًا.", "branchId");
  if (state.role === "staff" && branch.id !== state.staffBranch) throw new DemoError("موظف الفرع يبيع من فرعه التجريبي فقط.", "branchId");
  if (!Array.isArray(state.draft.cart) || !state.draft.cart.length) throw new DemoError("أضف صنفًا واحدًا على الأقل إلى الفاتورة.", "cart");

  const units = [];
  const seenProducts = new Set();
  const seenSerials = new Set();
  for (const item of state.draft.cart) {
    const product = productById(item.productId);
    if (!product || seenProducts.has(item.productId)) throw new DemoError("تحقق من الأصناف في الفاتورة.", "cart");
    seenProducts.add(item.productId);
    const inStock = state.stock[branch.id]?.[product.id];
    if (product.serialized) {
      if (!Array.isArray(item.serials) || !item.serials.length || !Array.isArray(inStock)) throw new DemoError("اختر سيريالًا لكل سماعة.", "cart");
      for (const serial of item.serials) {
        if (!inStock.includes(serial) || seenSerials.has(serial)) throw new DemoError("أحد السيريالات غير متاح أو مكرر؛ راجع الاختيار.", "cart");
        seenSerials.add(serial);
        units.push({ productId: product.id, name: product.name, sku: product.sku, serial, gross: product.price, taxBps: product.taxBps });
      }
    } else {
      if (!Number.isInteger(item.quantity) || item.quantity <= 0 || typeof inStock !== "number" || item.quantity > inStock) {
        throw new DemoError("كمية أحد الأصناف أكبر من المتاح في المستودع التجريبي.", "cart");
      }
      for (let i = 0; i < item.quantity; i++) units.push({ productId: product.id, name: product.name, sku: product.sku, serial: null, gross: product.price, taxBps: product.taxBps });
    }
  }
  return units;
}

/** Used for the live summary; draft validation is repeated at confirmation. */
export function draftAmounts(state) {
  const units = cartUnits(state);
  const subtotal = units.reduce((sum, unit) => sum + unit.gross, 0);
  const discount = parseHundredths(state.draft.discount || "0");
  if (discount === null || discount > subtotal) throw new DemoError("أدخل خصمًا صحيحًا لا يزيد على قيمة الفاتورة.", "discount");
  if (state.role === "staff" && BigInt(discount) * 10000n > BigInt(subtotal) * BigInt(state.discountLimitBps)) {
    throw new DemoError(`الخصم يتجاوز حد الموظف (${formatPercent(state.discountLimitBps)} من الفاتورة).`, "discount");
  }
  const shares = distributeDiscount(units.map((unit) => unit.gross), discount);
  const calculatedUnits = units.map((unit, index) => {
    const net = unit.gross - shares[index];
    return { ...unit, discount: shares[index], net, tax: includedTax(net, unit.taxBps) };
  });
  const total = subtotal - discount;
  const tax = calculatedUnits.reduce((sum, unit) => sum + unit.tax, 0);
  const paid = parseHundredths(state.draft.initialPayment);
  return { subtotal, discount, total, tax, paid, remaining: paid === null ? null : total - paid, units: calculatedUnits };
}

export function validateDraft(state) {
  if (!["manager", "staff"].includes(state.role)) throw new DemoError("المحاسب لا ينشئ مبيعات في هذه المعاينة.");
  const name = state.draft.customerName.trim();
  const phone = latinDigits(state.draft.phone.trim());
  if (!name || name.length > 120) throw new DemoError("أدخل اسم العميل التجريبي.", "customerName");
  const phoneDigits = phone.replace(/\D/g, "");
  if (!/^[0-9+()\s-]+$/.test(phone) || phoneDigits.length < 7 || phoneDigits.length > 15) throw new DemoError("أدخل رقم هاتف تجريبيًا صحيحًا.", "phone");
  const amounts = draftAmounts(state);
  if (amounts.total <= 0) throw new DemoError("يجب أن يكون إجمالي الفاتورة أكبر من صفر.", "discount");
  if (amounts.paid === null || amounts.paid <= 0) throw new DemoError("أدخل دفعة أولى أكبر من صفر.", "initialPayment");
  if (amounts.paid > amounts.total) throw new DemoError("الدفعة الأولى لا يمكن أن تزيد على إجمالي الفاتورة.", "initialPayment");
  if (!methodById(state.draft.method)) throw new DemoError("اختر طريقة دفع تجريبية.", "method");
  return amounts;
}

export function createSale(state) {
  const amounts = validateDraft(state);
  const next = clone(state);
  const number = `DEMO-${next.nextInvoice++}`;
  const at = new Date().toISOString();
  const invoice = {
    id: number,
    number,
    branchId: next.draft.branchId,
    customerName: next.draft.customerName.trim(),
    phone: latinDigits(next.draft.phone.trim()),
    createdAt: at,
    createdBy: next.role,
    canceled: false,
    units: amounts.units.map((unit, index) => ({ ...unit, id: `${number}:${index + 1}`, returned: false })),
    payments: [{ id: `PAY-${next.nextPayment++}`, amount: amounts.paid, method: next.draft.method, createdAt: at, createdBy: next.role }],
    returns: [],
  };
  for (const unit of invoice.units) {
    if (unit.serial) {
      next.stock[invoice.branchId][unit.productId] = next.stock[invoice.branchId][unit.productId].filter((serial) => serial !== unit.serial);
    } else {
      next.stock[invoice.branchId][unit.productId]--;
    }
  }
  next.invoices.unshift(invoice);
  next.draft = initialDraft(invoice.branchId);
  return { state: next, invoiceId: invoice.id };
}

export function invoiceAmounts(invoice) {
  const active = invoice.units.filter((unit) => !unit.returned);
  const subtotal = active.reduce((sum, unit) => sum + unit.gross, 0);
  const discount = active.reduce((sum, unit) => sum + unit.discount, 0);
  const total = active.reduce((sum, unit) => sum + unit.net, 0);
  const tax = active.reduce((sum, unit) => sum + unit.tax, 0);
  const paid = invoice.payments.reduce((sum, payment) => sum + payment.amount, 0);
  // Refund settlement is deliberately not implemented; credit is an amount owed, not money returned.
  return { subtotal, discount, total, tax, paid, due: Math.max(0, total - paid), credit: Math.max(0, paid - total) };
}

export function recordPayment(state, invoiceId, amountInput, method) {
  const invoice = state.invoices.find((item) => item.id === invoiceId);
  if (!canSeeInvoice(state, invoice)) throw new DemoError("الفاتورة خارج نطاق حساب المعاينة.");
  if (invoice.canceled) throw new DemoError("لا يمكن التحصيل على فاتورة ملغاة.");
  const due = invoiceAmounts(invoice).due;
  const amount = parseHundredths(amountInput);
  if (amount === null || amount <= 0) throw new DemoError("أدخل مبلغ تحصيل أكبر من صفر.", "paymentAmount");
  if (amount > due) throw new DemoError("مبلغ التحصيل لا يمكن أن يزيد على المتبقي.", "paymentAmount");
  if (!methodById(method)) throw new DemoError("اختر طريقة دفع تجريبية.", "paymentMethod");
  const next = clone(state);
  const target = next.invoices.find((item) => item.id === invoiceId);
  target.payments.push({ id: `PAY-${next.nextPayment++}`, amount, method, createdAt: new Date().toISOString(), createdBy: next.role });
  return { state: next, invoiceId };
}

export function returnPreview(invoice, unitIds, cancel = false) {
  const available = invoice.units.filter((unit) => !unit.returned);
  if (invoice.canceled || !available.length) throw new DemoError("لا توجد أصناف متاحة للمرتجع في هذه الفاتورة.");
  const ids = cancel ? available.map((unit) => unit.id) : [...unitIds];
  if (!ids.length || new Set(ids).size !== ids.length) throw new DemoError("اختر جهازًا أو صنفًا واحدًا على الأقل للمرتجع.", "returnItems");
  if (ids.some((id) => !available.some((unit) => unit.id === id))) throw new DemoError("أحد الأصناف المختارة أُرجع بالفعل أو غير موجود.", "returnItems");
  const selected = available.filter((unit) => ids.includes(unit.id));
  const amount = selected.reduce((sum, unit) => sum + unit.net, 0);
  const before = invoiceAmounts(invoice);
  const totalAfter = before.total - amount;
  return { ids, selected, amount, dueAfter: Math.max(0, totalAfter - before.paid), creditAfter: Math.max(0, before.paid - totalAfter) };
}

export function registerReturn(state, invoiceId, unitIds, { cancel = false, reason = "" } = {}) {
  if (state.role !== "manager") throw new DemoError("الإلغاء والمرتجعات للمدير فقط في المعاينة.");
  const invoice = state.invoices.find((item) => item.id === invoiceId);
  if (!invoice) throw new DemoError("الفاتورة التجريبية غير موجودة.");
  const outcome = returnPreview(invoice, unitIds, cancel);
  if (reason.length > 240) throw new DemoError("السبب يجب ألا يزيد على 240 حرفًا.", "returnReason");
  for (const unit of outcome.selected) {
    const stock = state.stock[invoice.branchId]?.[unit.productId];
    if (unit.serial && (!Array.isArray(stock) || stock.includes(unit.serial))) throw new DemoError("تعذر إرجاع سيريال موجود بالفعل في المخزون التجريبي.");
    if (!unit.serial && typeof stock !== "number") throw new DemoError("تعذر العثور على المخزون التجريبي.");
  }
  const next = clone(state);
  const target = next.invoices.find((item) => item.id === invoiceId);
  const entry = { id: `RET-${next.nextReturn++}`, unitIds: outcome.ids, amount: outcome.amount, cancel, reason: reason.trim(), createdAt: new Date().toISOString() };
  for (const unit of target.units) {
    if (!outcome.ids.includes(unit.id)) continue;
    unit.returned = true;
    unit.returnId = entry.id;
    if (unit.serial) {
      next.stock[target.branchId][unit.productId].push(unit.serial);
      next.stock[target.branchId][unit.productId].sort();
    } else {
      next.stock[target.branchId][unit.productId]++;
    }
  }
  target.returns.push(entry);
  if (cancel) target.canceled = true;
  return { state: next, invoiceId, outcome };
}

export function setDiscountLimit(state, input) {
  if (state.role !== "manager") throw new DemoError("تغيير حد الخصم للمدير فقط.");
  const bps = parseHundredths(input);
  if (bps === null || bps > 10000) throw new DemoError("أدخل نسبة من 0 إلى 100.", "discountLimit");
  const next = clone(state);
  next.discountLimitBps = bps;
  return next;
}
