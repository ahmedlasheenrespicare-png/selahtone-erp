import {
  BRANCHES, PRODUCTS, METHODS, ROLE_LABELS, DemoError, createInitialState, initialDraft,
  availableFor, canSeeInvoice, draftAmounts, validateDraft, createSale, invoiceAmounts,
  recordPayment, returnPreview, registerReturn, setDiscountLimit, parseHundredths,
  formatMoney, formatPercent, latinDigits,
} from "./model.mjs";

/* All state lives in this browser tab. This standalone prototype never calls the ERP. */
let state = createInitialState();
const ui = { screen: "sale", from: "invoices", invoiceId: null, catalogSearch: "", invoiceSearch: "" };
const app = document.getElementById("app");
const dialogRoot = document.getElementById("dialog-root");
const toastElement = document.getElementById("toast");
let toastTimer;

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const product = (id) => PRODUCTS.find((item) => item.id === id);
const branch = (id) => BRANCHES.find((item) => item.id === id);
const method = (id) => METHODS.find((item) => item.id === id);
const money = (cents) => `<bdi dir="ltr">${formatMoney(cents)}</bdi> <span>ج.م</span>`;
const inputMoney = (cents) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
const count = (value) => new Intl.NumberFormat("ar-EG-u-nu-latn").format(value);
const date = (value) => new Intl.DateTimeFormat("ar-EG-u-nu-latn", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Cairo" }).format(new Date(value));
const currentInvoice = () => state.invoices.find((item) => item.id === ui.invoiceId);
const currentCartItem = (id) => state.draft.cart.find((item) => item.productId === id);

const paths = {
  home: '<path d="M3 10.5 12 3l9 7.5v9a1 1 0 0 1-1 1h-5.5v-6h-5v6H4a1 1 0 0 1-1-1z"/>',
  cart: '<path d="M3 4h2l1.8 10.2h10.9l2-7.2H6"/><circle cx="9" cy="19" r="1.2"/><circle cx="17" cy="19" r="1.2"/>',
  receipt: '<path d="M6 3h12v18l-3-1.8-3 1.8-3-1.8L6 21z"/><path d="M9 8h6M9 12h6M9 16h4"/>',
  return: '<path d="M8 7 4 11l4 4"/><path d="M5 11h9a5 5 0 0 1 0 10h-2"/><path d="M16 4a5 5 0 0 1 5 5"/>',
  user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.5-4 2.8-6 7-6s6.5 2 7 6"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3.5 19c.4-3.3 2.3-5 5.5-5s5.1 1.7 5.5 5M16 5a3 3 0 0 1 0 6M17 14c2.3.4 3.6 2 3.9 5"/>',
  box: '<path d="m4 7 8-4 8 4v10l-8 4-8-4z"/><path d="m4 7 8 4 8-4M12 11v10"/>',
  ear: '<path d="M6 14c0-6 2.5-10 7-10 3 0 5 2 5 5 0 4-4 4-4 7.5A3 3 0 0 1 8 17"/><path d="M10 10a3 3 0 0 1 3-3c1.7 0 2.7 1 2.7 2.5M20 6c1.2 1.4 1.7 3.2 1.4 5"/>',
  battery: '<rect x="6" y="5" width="12" height="16" rx="2"/><path d="M10 5V3h4v2M9 10h6M12 7v6"/>',
  sparkle: '<path d="m12 3 1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5zM19 15l.7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7z"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.3"/><path d="m16 16 4 4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5h.01"/>',
  shield: '<path d="M12 3 4 6v5c0 5 3.2 8.4 8 10 4.8-1.6 8-5 8-10V6z"/><path d="m9 12 2 2 4-4"/>',
  arrow: '<path d="M4 12h16M14 6l6 6-6 6"/>',
  left: '<path d="m14 6-6 6 6 6"/>',
  wallet: '<path d="M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12"/><path d="M20 11h-5a2 2 0 0 0 0 4h5"/>',
  card: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18M7 15h4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a2 2 0 0 0 .4 2.2l.1.1-2 3.4-.2-.1a2 2 0 0 0-2.1.5l-.1.1h-4l-.1-.2A2 2 0 0 0 9.2 20l-.2.1-2-3.4.1-.1A2 2 0 0 0 7.5 14l-.1-.2v-3.6l.1-.2a2 2 0 0 0-.4-2.2L7 7.7l2-3.4.2.1a2 2 0 0 0 2.1-.5l.1-.1h4l.1.2a2 2 0 0 0 2.2 1l.2-.1 2 3.4-.1.1a2 2 0 0 0-.4 2.2l.1.2v3.6z" transform="translate(-1.8 -.8) scale(1.15)"/>',
  print: '<path d="M7 8V3h10v5M7 17H5a2 2 0 0 1-2-2v-4a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v4a2 2 0 0 1-2 2h-2"/><path d="M7 14h10v7H7zM17 11h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
};
function icon(name, className = "") {
  return `<svg class="${esc(className)}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.info}</svg>`;
}
function brandMark() {
  return '<svg class="brand-mark" viewBox="0 0 46 46" fill="none" aria-hidden="true"><rect width="46" height="46" rx="7" fill="#3156A3"/><path d="M14 29c0-9 4-15 10-15 4 0 7 3 7 7 0 6-6 6-6 11a3.5 3.5 0 0 1-7 0" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/><path d="M33 14c3 3 4.5 7 3.5 11M37 10c4.5 4.5 6 10.5 4.5 16" stroke="#42B3E5" stroke-width="2.4" stroke-linecap="round"/><circle cx="24" cy="23" r="2.2" fill="#42B3E5"/></svg>';
}
function toast(message) {
  toastElement.textContent = message;
  toastElement.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastElement.classList.remove("is-visible"), 4000);
}
function navButton(id, label, glyph) {
  const active = ui.screen === id || (ui.screen === "detail" && ui.from === id);
  return `<button type="button" class="nav-item ${active ? "is-active" : ""}" data-action="navigate" data-screen="${id}" ${active ? 'aria-current="page"' : ""}>${icon(glyph)}<span>${label}</span>${active ? '<span class="nav-dot" aria-hidden="true"></span>' : ""}</button>`;
}
function roleOptions() {
  return Object.entries(ROLE_LABELS).map(([value, label]) => `<option value="${value}" ${state.role === value ? "selected" : ""}>${label}</option>`).join("");
}
function headerTitle() {
  if (ui.screen === "sale") return "كاونتر البيع";
  if (ui.screen === "returns") return "المرتجعات والإلغاء";
  if (ui.screen === "detail") return "تفاصيل الفاتورة";
  return "الفواتير والتحصيل";
}
function shell(content) {
  return `
    <div class="preview-banner" role="note">${icon("shield")}<strong>معاينة تجريبية منفصلة</strong><span class="separator">•</span><span>كل البيانات والأسعار والضرائب خيالية؛ أدخل بيانات وهمية فقط. لا اتصال بالإنتاج، وتُمسح التجربة عند تحديث الصفحة.</span></div>
    <div class="shell">
      <aside class="sidebar" aria-label="قائمة المعاينة">
        <div class="brand">${brandMark()}<span class="brand-text"><strong>صله <span>تون</span></strong><small dir="ltr">SELATONE HEARING</small></span></div>
        <nav aria-label="التنقل في المعاينة"><p class="nav-heading">المبيعات والتحصيل</p><div class="nav-list">
          ${navButton("sale", "بيع جديد", "cart")}${navButton("invoices", "الفواتير والتحصيل", "receipt")}${navButton("returns", "المرتجعات والإلغاء", "return")}
        </div></nav>
        <div class="sidebar-note"><div class="label">${icon("shield")} مساحة آمنة للتجربة</div><p>تبديل الأدوار للمحاكاة فقط؛ جرّب البيع والتحصيل دون التأثير على بيانات العمل الحقيقية.</p></div>
        <div class="sidebar-foot">نسخة تصورية • غير متصلة بالنظام</div>
      </aside>
      <div class="work">
        <header class="topbar"><div class="topbar-title"><span class="topbar-title__icon">${icon("cart")}</span><span><small>نظام إدارة صلة تون</small><strong>${headerTitle()}</strong></span></div>
          <div class="topbar-actions">${state.role === "manager" ? `<button type="button" class="top-settings" data-action="open-settings" title="إعداد حد الخصم التجريبي" aria-label="إعداد حد الخصم التجريبي">${icon("settings")}</button>` : ""}
            <div class="role-control"><span class="role-avatar" aria-hidden="true">ت</span><label for="demo-role">التجربة كـ<select id="demo-role" data-control="role">${roleOptions()}</select></label></div>
          </div>
        </header>
        <main id="content" class="content" tabindex="-1">${content}</main>
      </div>
    </div>`;
}
function heading(title, description, actions = "", eyebrow = "المبيعات والتحصيل") {
  return `<div class="page-head"><div><p class="eyebrow"><span class="eyebrow-dot"></span>${eyebrow}</p><h1>${title}</h1><p class="page-subtitle">${description}</p></div>${actions ? `<div class="head-actions">${actions}</div>` : ""}</div>`;
}
function roleNotice() {
  return `<div class="notice">${icon("info")}<span>المحاسب يمكنه عرض الفواتير وتسجيل التحصيل، لكنه لا ينشئ عملية بيع. اختر «موظف فرع تجريبي» أو «مدير تجريبي» من الأعلى لتجربة البيع.</span></div>`;
}
function customerPanel() {
  return `<section class="panel" aria-labelledby="customer-heading"><div class="panel-head"><div class="panel-title"><span class="panel-title__icon">${icon("user")}</span><div><h2 id="customer-heading">بيانات العميل</h2><p>معلومات بسيطة لتوثيق العملية ومتابعة الباقي</p></div></div><span class="caption-tag">١ / ٣</span></div>
    <div class="panel-body"><div class="fields">
      <div class="field"><label for="customer-name">اسم العميل <span class="required">*</span></label><input id="customer-name" data-control="customerName" value="${esc(state.draft.customerName)}" maxlength="120" placeholder="اسم عميل تجريبي" autocomplete="off"><p class="field-hint">استخدم بيانات وهمية أثناء التجربة.</p></div>
      <div class="field"><label for="customer-phone">رقم الهاتف <span class="required">*</span></label><input id="customer-phone" data-control="phone" value="${esc(state.draft.phone)}" dir="ltr" inputmode="tel" maxlength="25" placeholder="01000000000" autocomplete="off"><p class="field-hint">الاسم والهاتف مطلوبان لكل عملية.</p></div>
      <div class="field field--wide"><label for="sale-branch">الفرع والمستودع <span class="required">*</span></label><select id="sale-branch" data-control="branch" ${state.role === "staff" ? "disabled" : ""}>${BRANCHES.map((item) => `<option value="${item.id}" ${state.draft.branchId === item.id ? "selected" : ""}>${esc(item.name)} — ${esc(item.warehouse)}</option>`).join("")}</select><p class="field-hint">${state.role === "staff" ? "موظف الفرع يبيع من فرعه فقط." : "اختيار الفرع يحدد المخزون الذي تُخصم منه الأصناف."}</p></div>
    </div></div></section>`;
}
function catalogItems() {
  const search = latinDigits(ui.catalogSearch.trim().normalize("NFKC")).toLocaleLowerCase("ar");
  const items = PRODUCTS.filter((item) => `${item.name} ${item.sku} ${item.category}`.toLocaleLowerCase("ar").includes(search));
  if (!items.length) return '<div class="product-list-empty">لا توجد أصناف تجريبية مطابقة للبحث.</div>';
  return items.map((item) => {
    const inventory = availableFor(state, state.draft.branchId, item.id);
    const stockCount = Array.isArray(inventory) ? inventory.length : inventory;
    const cartItem = currentCartItem(item.id);
    const selectedCount = item.serialized ? cartItem?.serials.length ?? 0 : cartItem?.quantity ?? 0;
    const action = item.serialized ? "serials" : "add-product";
    const buttonLabel = item.serialized ? (selectedCount ? "تعديل السيريال" : "اختيار السيريال") : "إضافة";
    const disabled = stockCount === 0 || (!item.serialized && selectedCount >= stockCount);
    return `<div class="product-row"><div class="product-main"><span class="product-icon is-${item.icon}">${icon(item.icon)}</span><div class="product-text"><strong>${esc(item.name)}</strong><small><bdi dir="ltr">${esc(item.sku)}</bdi> · ${esc(item.category)}</small><div class="product-meta"><span class="tiny-pill">المتاح: ${count(stockCount)}</span>${item.serialized ? '<span class="tiny-pill is-serial">سيريال لكل جهاز</span>' : ""}${selectedCount ? `<span class="tiny-pill">في الفاتورة: ${count(selectedCount)}</span>` : ""}</div></div></div>
      <div class="product-price">${money(item.price)}<small>سعر تجريبي نهائي</small></div><button type="button" class="btn btn--secondary btn--small product-add" data-action="${action}" data-product="${item.id}" ${disabled ? "disabled" : ""}>${icon(item.serialized ? "box" : "plus")} ${buttonLabel}</button></div>`;
  }).join("");
}
function catalogPanel() {
  return `<section class="panel" aria-labelledby="catalog-heading"><div class="panel-head"><div class="panel-title"><span class="panel-title__icon">${icon("box")}</span><div><h2 id="catalog-heading">اختر الأصناف</h2><p>الأصناف المتاحة في المستودع التجريبي</p></div></div><div class="search-field">${icon("search")}<label class="visually-hidden" for="catalog-search">البحث عن صنف تجريبي</label><input id="catalog-search" data-control="catalogSearch" type="search" value="${esc(ui.catalogSearch)}" placeholder="ابحث عن صنف..."></div></div>
    <div id="catalog-items" class="product-list">${catalogItems()}</div><div class="catalog-foot">${icon("info")} الأسماء والأسعار ونسب الضريبة هنا أمثلة خيالية فقط.</div></section>`;
}
function cartItems() {
  if (!state.draft.cart.length) return '<div class="cart-empty">الفاتورة فارغة. اختر صنفًا من القائمة للبدء.</div>';
  return state.draft.cart.map((item) => {
    const p = product(item.productId);
    if (!p) return "";
    const quantity = p.serialized ? item.serials.length : item.quantity;
    return `<div class="cart-item"><div class="cart-item__top"><div class="cart-item__name"><strong>${esc(p.name)}</strong><small>${count(quantity)} × ${formatMoney(p.price)} ج.م</small></div><div class="cart-item__price">${money(p.price * quantity)}</div></div>
      <div class="cart-item__actions">${p.serialized ? `<div class="serial-chips">${item.serials.map((serial) => `<span class="serial-chip"><bdi dir="ltr">${esc(serial)}</bdi><button type="button" data-action="remove-serial" data-product="${p.id}" data-serial="${esc(serial)}" aria-label="إزالة السيريال ${esc(serial)}">${icon("close")}</button></span>`).join("")}</div><button type="button" class="btn btn--ghost btn--small" data-action="serials" data-product="${p.id}">تعديل</button>` : `<div class="quantity-control" aria-label="كمية ${esc(p.name)}"><button type="button" data-action="quantity" data-product="${p.id}" data-delta="-1" aria-label="تقليل كمية ${esc(p.name)}">−</button><b>${count(quantity)}</b><button type="button" data-action="quantity" data-product="${p.id}" data-delta="1" aria-label="زيادة كمية ${esc(p.name)}" ${quantity >= availableFor(state, state.draft.branchId, p.id) ? "disabled" : ""}>+</button></div><button type="button" class="btn btn--ghost btn--small" data-action="remove-product" data-product="${p.id}">إزالة</button>`}</div></div>`;
  }).join("");
}
function methodOptions(selected, name, control = "method") {
  return METHODS.map((item) => `<label class="method-option"><input type="radio" name="${name}" data-control="${control}" value="${item.id}" ${item.id === selected ? "checked" : ""}><span>${esc(item.label)}</span></label>`).join("");
}
function summaryPanel() {
  const quantity = state.draft.cart.reduce((sum, item) => sum + (product(item.productId)?.serialized ? item.serials.length : item.quantity), 0);
  return `<aside class="panel summary" aria-labelledby="summary-heading"><div class="summary-head"><div><h2 id="summary-heading">ملخص الفاتورة</h2><p>مسودة تجريبية · الأسعار نهائية</p></div><span class="summary-count" aria-label="${count(quantity)} قطعة">${count(quantity)}</span></div>
    <div class="cart-list">${cartItems()}</div><div class="summary-body">
      <div class="field"><label for="sale-discount">الخصم بالجنيه</label><div class="currency-field"><input id="sale-discount" data-control="discount" value="${esc(state.draft.discount)}" dir="ltr" inputmode="decimal"><span>ج.م</span></div><p class="field-hint">${state.role === "staff" ? `حد الموظف الحالي ${formatPercent(state.discountLimitBps)} من الفاتورة.` : "الخصم على الفاتورة ولا يغيّر سعر الصنف."}</p></div>
      <div id="sale-calculation" aria-live="polite"></div>
      <div class="summary-rule"></div><div class="summary-section-title">الدفعة الأولى <span>مطلوبة وأكبر من صفر</span></div>
      <div class="field"><label class="visually-hidden" for="initial-payment">قيمة الدفعة الأولى</label><div class="currency-field"><input id="initial-payment" data-control="initialPayment" value="${esc(state.draft.initialPayment)}" dir="ltr" inputmode="decimal" placeholder="0.00"><span>ج.م</span></div></div>
      <div><span class="field__label" id="payment-label">طريقة الدفع</span><div class="method-options" role="radiogroup" aria-labelledby="payment-label">${methodOptions(state.draft.method, "initial-method")}</div></div>
      <div id="sale-remaining"></div><div id="sale-error" hidden></div>
      <button type="button" class="btn btn--wide" data-action="review-sale">${icon("check")} مراجعة البيع التجريبي</button>
      <div class="summary-note">${icon("shield")} لن يتم حفظ شيء حقيقي؛ راجع التفاصيل قبل تأكيد التجربة.</div>
    </div></aside>`;
}
function salePage() {
  const actions = `<button type="button" class="btn btn--secondary" data-action="navigate" data-screen="invoices">${icon("receipt")} الفواتير والتحصيل</button>`;
  if (state.role === "accountant") return heading("بيع جديد", "هذه نسخة للتجربة فقط.", actions) + roleNotice();
  return `${heading("بيع جديد", "من بيانات العميل إلى مراجعة الإيصال، بخطوات واضحة.", actions)}
    <div class="flowline" aria-label="خطوات البيع"><span><b>١</b> بيانات العميل</span><span class="flowline-arrow">←</span><span><b>٢</b> اختيار الأصناف والسيريال</span><span class="flowline-arrow">←</span><span><b>٣</b> مراجعة وتأكيد</span></div>
    <div class="sale-grid"><div class="sale-main">${customerPanel()}${catalogPanel()}</div>${summaryPanel()}</div>`;
}
function updateSaleTotals() {
  const target = document.getElementById("sale-calculation");
  const dueTarget = document.getElementById("sale-remaining");
  const errorTarget = document.getElementById("sale-error");
  if (!target || !dueTarget || !errorTarget) return;
  try {
    const a = draftAmounts(state);
    target.innerHTML = `<div class="money-summary"><div class="summary-row"><span>إجمالي الأصناف</span><strong>${money(a.subtotal)}</strong></div><div class="summary-row"><span>الخصم</span><strong>− ${money(a.discount)}</strong></div><div class="summary-row is-total"><span>الإجمالي النهائي</span><strong>${money(a.total)}</strong></div><div class="summary-row"><span>ضريبة افتراضية ضمن الإجمالي</span><strong>${money(a.tax)}</strong></div></div>`;
    dueTarget.innerHTML = `<div class="summary-row is-due"><span>المتبقي على العميل</span><strong>${a.remaining !== null && a.remaining >= 0 ? money(a.remaining) : "—"}</strong></div>`;
    errorTarget.hidden = true;
    errorTarget.textContent = "";
  } catch (error) {
    target.innerHTML = '<div class="summary-row is-total"><span>الإجمالي النهائي</span><strong>—</strong></div>';
    dueTarget.innerHTML = '<div class="summary-row is-due"><span>المتبقي على العميل</span><strong>—</strong></div>';
    if (error instanceof DemoError && state.draft.cart.length) {
      errorTarget.className = "field-alert";
      errorTarget.textContent = error.message;
      errorTarget.hidden = false;
    } else errorTarget.hidden = true;
  }
}
function status(invoice) {
  const a = invoiceAmounts(invoice);
  if (invoice.canceled) return { className: "", label: "ملغاة" };
  if (a.credit) return { className: "is-credit", label: "مستحق للعميل" };
  if (!invoice.units.some((unit) => !unit.returned)) return { className: "", label: "مرتجعة بالكامل" };
  if (a.due) return { className: "is-pending", label: "عليها باقي" };
  return { className: "is-paid", label: "مدفوعة" };
}
function visibleInvoices() {
  const search = latinDigits(ui.invoiceSearch.trim().normalize("NFKC")).toLocaleLowerCase("ar");
  return state.invoices.filter((invoice) => canSeeInvoice(state, invoice) && `${invoice.number} ${invoice.customerName} ${invoice.phone} ${branch(invoice.branchId)?.name ?? ""}`.toLocaleLowerCase("ar").includes(search));
}
function invoiceRows() {
  const invoices = visibleInvoices();
  if (!invoices.length) return '<tr><td colspan="7"><div class="product-list-empty">لا توجد فواتير تجريبية مطابقة.</div></td></tr>';
  return invoices.map((invoice) => {
    const a = invoiceAmounts(invoice);
    const s = status(invoice);
    return `<tr><td><span class="invoice-number"><bdi dir="ltr">${esc(invoice.number)}</bdi></span></td><td><span class="table-name"><strong>${esc(invoice.customerName)}</strong><small><bdi dir="ltr">${esc(invoice.phone)}</bdi></small></span></td><td>${esc(branch(invoice.branchId)?.name)}</td><td>${money(a.total)}</td><td>${a.credit ? `<span class="status-pill is-credit">للعميل ${money(a.credit)}</span>` : money(a.due)}</td><td><span class="status-pill ${s.className}">${s.label}</span></td><td><button type="button" class="btn btn--secondary btn--small" data-action="show-invoice" data-invoice="${esc(invoice.id)}">${ui.screen === "returns" && state.role === "manager" ? "فتح للمرتجع" : "التفاصيل"}</button></td></tr>`;
  }).join("");
}
function invoicePage(isReturns) {
  const all = state.invoices.filter((invoice) => canSeeInvoice(state, invoice));
  const paid = all.reduce((sum, invoice) => sum + invoiceAmounts(invoice).paid, 0);
  const due = all.reduce((sum, invoice) => sum + invoiceAmounts(invoice).due, 0);
  const title = isReturns ? "المرتجعات والإلغاء" : "الفواتير والتحصيل";
  const subtitle = isReturns ? "اختر فاتورة تجريبية لمراجعة أصنافها وتسجيل المرتجع." : "تابع الفواتير والمدفوع والباقي في مكان واحد.";
  const actions = state.role !== "accountant" ? `<button type="button" class="btn" data-action="navigate" data-screen="sale">${icon("plus")} بيع تجريبي جديد</button>` : "";
  const note = isReturns ? `<div class="notice ${state.role === "manager" ? "" : "is-warning"}">${icon("info")}<span>${state.role === "manager" ? "يمكنك إلغاء فاتورة كاملة أو إرجاع بعض أصنافها. أي مبلغ مستحق للعميل يظهر كالتزام، وليس كأنه دُفع بالفعل." : "تسجيل الإلغاء والمرتجعات للمدير فقط. اختر «مدير تجريبي» من الأعلى لتجربة هذه الخطوة."}</span></div>` : "";
  return `${heading(title, subtitle, actions)}${note}
    <div class="metrics"><div class="metric"><div><small>فواتير تجريبية</small><strong>${count(all.length)}</strong></div><span class="metric-icon">${icon("receipt")}</span></div><div class="metric is-teal"><div><small>المدفوعات المسجّلة</small><strong>${money(paid)}</strong></div><span class="metric-icon">${icon("wallet")}</span></div><div class="metric is-amber"><div><small>المتبقي للتحصيل</small><strong>${money(due)}</strong></div><span class="metric-icon">${icon("clock")}</span></div></div>
    <section class="panel" aria-labelledby="invoice-list-heading"><div class="panel-head"><div class="panel-title"><span class="panel-title__icon">${icon("receipt")}</span><div><h2 id="invoice-list-heading">سجل الفواتير التجريبية</h2><p>الأرقام والأسماء هنا للعرض فقط</p></div></div><div class="search-field">${icon("search")}<label class="visually-hidden" for="invoice-search">البحث في الفواتير التجريبية</label><input id="invoice-search" data-control="invoiceSearch" type="search" value="${esc(ui.invoiceSearch)}" placeholder="رقم أو اسم أو هاتف..."></div></div>
      <div class="table-wrap" tabindex="0" role="region" aria-label="جدول الفواتير التجريبية"><table class="invoice-table"><thead><tr><th>رقم الفاتورة</th><th>العميل</th><th>الفرع</th><th>الإجمالي الحالي</th><th>المتبقي / المستحق</th><th>الحالة</th><th>الإجراء</th></tr></thead><tbody id="invoice-rows">${invoiceRows()}</tbody></table></div></section>`;
}
function detailPage(invoice) {
  if (!invoice || !canSeeInvoice(state, invoice)) return heading("الفاتورة غير متاحة", "هذه الفاتورة خارج نطاق حساب المعاينة.") + `<button type="button" class="btn btn--secondary" data-action="navigate" data-screen="invoices">العودة إلى الفواتير</button>`;
  const a = invoiceAmounts(invoice);
  const s = status(invoice);
  const active = invoice.units.filter((unit) => !unit.returned);
  const collect = a.due > 0 && !invoice.canceled ? `<button type="button" class="btn" data-action="collect" data-invoice="${esc(invoice.id)}">${icon("wallet")} تحصيل الباقي</button>` : "";
  const ret = state.role === "manager" && active.length && !invoice.canceled ? `<button type="button" class="btn btn--danger" data-action="return" data-invoice="${esc(invoice.id)}">${icon("return")} مرتجع أو إلغاء</button>` : "";
  const paymentRows = invoice.payments.map((payment) => `<div class="payment-row"><div><strong>${esc(method(payment.method)?.label ?? "طريقة غير معروفة")}</strong><small>${esc(date(payment.createdAt))} · ${esc(ROLE_LABELS[payment.createdBy] ?? "تجريبي")}</small></div><b>${money(payment.amount)}</b></div>`).join("");
  const returnRows = invoice.returns.length ? invoice.returns.map((entry) => {
    const returnedUnits = invoice.units.filter((unit) => entry.unitIds.includes(unit.id));
    const description = returnedUnits.map((unit) => `${unit.name}${unit.serial ? ` (${unit.serial})` : ""}`).join("، ");
    return `<div class="history-row"><div><strong>${entry.cancel ? "إلغاء الفاتورة التجريبية" : "مرتجع تجريبي"} · ${esc(entry.id)}</strong><small>${esc(description)}${entry.reason ? ` · السبب: ${esc(entry.reason)}` : ""}</small><small>${esc(date(entry.createdAt))}</small></div><b>${money(entry.amount)}</b></div>`;
  }).join("") : '<p class="field-hint">لا توجد مرتجعات مسجّلة لهذه الفاتورة التجريبية.</p>';
  return `<div id="invoice-print"><div class="print-watermark">إيصال تجريبي — غير معتمد ولا يمثل عملية بيع حقيقية</div><div class="detail-head"><div><button type="button" class="back-button no-print" data-action="navigate" data-screen="${esc(ui.from)}">${icon("arrow")} العودة إلى ${ui.from === "returns" ? "المرتجعات" : "الفواتير"}</button><p class="eyebrow"><span class="eyebrow-dot"></span>فاتورة تجريبية</p><h1><bdi dir="ltr">${esc(invoice.number)}</bdi></h1><p class="page-subtitle">${esc(date(invoice.createdAt))} · ${esc(branch(invoice.branchId)?.name)}</p></div><div class="detail-actions no-print">${collect}${ret}<button type="button" class="btn btn--secondary" data-action="print">${icon("print")} طباعة تجريبية</button></div></div>
    ${a.credit ? `<div class="notice is-warning">${icon("info")}<span>المستحق للعميل: <strong>${money(a.credit)}</strong>. هذا التزام تجريبي ولم يُسجّل دفعه للعميل؛ آلية رد المبلغ الفعلي تحتاج تحديدًا لاحقًا.</span></div>` : ""}
    <div class="detail-grid"><div class="detail-main">
      <section class="panel"><div class="panel-head"><div class="panel-title"><span class="panel-title__icon">${icon("user")}</span><div><h2>بيانات الفاتورة</h2><p>بيانات خيالية للتوضيح فقط</p></div></div><span class="status-pill ${s.className}">${s.label}</span></div><div class="panel-body"><dl class="detail-list"><div><dt>العميل</dt><dd>${esc(invoice.customerName)}</dd></div><div><dt>رقم الهاتف</dt><dd><bdi dir="ltr">${esc(invoice.phone)}</bdi></dd></div><div><dt>الفرع</dt><dd>${esc(branch(invoice.branchId)?.name)}</dd></div><div><dt>المستودع</dt><dd>${esc(branch(invoice.branchId)?.warehouse)}</dd></div></dl></div></section>
      <section class="panel"><div class="panel-head"><div class="panel-title"><span class="panel-title__icon">${icon("box")}</span><div><h2>الأصناف والسيريالات</h2><p>تظهر القطعة المرتجعة بحالتها</p></div></div><span class="caption-tag">${count(invoice.units.length)} قطعة</span></div><div class="table-wrap" role="region" aria-label="أصناف الفاتورة" tabindex="0"><table class="line-table"><thead><tr><th>الصنف</th><th>السيريال</th><th>القيمة بعد الخصم</th><th>الحالة</th></tr></thead><tbody>${invoice.units.map((unit) => `<tr><td><strong class="${unit.returned ? "line-returned" : ""}">${esc(unit.name)}</strong><br><span class="line-serial"><bdi dir="ltr">${esc(unit.sku)}</bdi></span></td><td>${unit.serial ? `<bdi dir="ltr">${esc(unit.serial)}</bdi>` : "—"}</td><td>${money(unit.net)}</td><td><span class="status-pill ${unit.returned ? "is-credit" : "is-paid"}">${unit.returned ? "مرتجع" : "مباع"}</span></td></tr>`).join("")}</tbody></table></div></section>
      <section class="panel"><div class="panel-head"><div class="panel-title"><span class="panel-title__icon">${icon("return")}</span><div><h2>سجل المرتجعات</h2><p>للمعاينة فقط</p></div></div></div><div class="panel-body">${returnRows}</div></section>
    </div><div class="detail-side"><section class="panel"><div class="panel-head"><div class="panel-title"><span class="panel-title__icon">${icon("receipt")}</span><div><h2>ملخص الحساب</h2><p>بعد المرتجعات إن وُجدت</p></div></div></div><div class="panel-body money-summary"><div class="summary-row"><span>الأصناف الحالية</span><strong>${money(a.subtotal)}</strong></div><div class="summary-row"><span>الخصم الموزّع</span><strong>− ${money(a.discount)}</strong></div><div class="summary-row is-total"><span>الإجمالي النهائي</span><strong>${money(a.total)}</strong></div><div class="summary-row"><span>ضريبة افتراضية ضمن الإجمالي</span><strong>${money(a.tax)}</strong></div><div class="summary-row"><span>المدفوع سابقًا</span><strong>${money(a.paid)}</strong></div><div class="summary-row is-due"><span>المتبقي على العميل</span><strong>${money(a.due)}</strong></div>${a.credit ? `<div class="summary-row"><span>مستحق للعميل</span><strong>${money(a.credit)}</strong></div>` : ""}</div></section>
      <section class="panel"><div class="panel-head"><div class="panel-title"><span class="panel-title__icon">${icon("wallet")}</span><div><h2>سجل التحصيل</h2><p>مدفوعات تجريبية فقط</p></div></div></div><div class="panel-body">${paymentRows}</div></section>
    </div></div></div>`;
}
function render() {
  const content = ui.screen === "sale" ? salePage() : ui.screen === "invoices" ? invoicePage(false) : ui.screen === "returns" ? invoicePage(true) : detailPage(currentInvoice());
  app.innerHTML = shell(content);
  updateSaleTotals();
}

function openDialog(title, subtitle, body, footer, options = {}) {
  const previous = document.activeElement;
  dialogRoot.innerHTML = `<dialog class="dialog" id="active-dialog" aria-labelledby="dialog-title"><div class="dialog-head"><div><h2 id="dialog-title">${esc(title)}</h2><p>${esc(subtitle)}</p></div><button type="button" class="icon-button" data-action="close-dialog" aria-label="إغلاق">${icon("close")}</button></div><div class="dialog-body">${body}<div id="dialog-error" class="field-alert" role="alert" hidden></div></div><div class="dialog-foot">${footer}</div></dialog>`;
  const dialog = document.getElementById("active-dialog");
  dialog.addEventListener("close", () => {
    if (dialogRoot.contains(dialog)) dialogRoot.innerHTML = "";
    if (previous && previous.isConnected && typeof previous.focus === "function") previous.focus();
  }, { once: true });
  dialog.showModal();
  const focused = dialog.querySelector(options.focus ?? "button, input, select, textarea");
  if (focused) focused.focus();
}
function closeDialog() {
  const dialog = document.getElementById("active-dialog");
  if (dialog?.open) dialog.close();
}
function dialogError(error) {
  const target = document.getElementById("dialog-error");
  if (!target) return;
  target.hidden = false;
  target.textContent = error instanceof DemoError ? error.message : "حدث خطأ في المعاينة؛ حاول مرة أخرى.";
  const mapping = { paymentAmount: "#collection-amount", returnReason: "#return-reason", discountLimit: "#discount-limit" };
  if (error?.field && mapping[error.field]) document.querySelector(mapping[error.field])?.focus();
}
function serialDialog(productId) {
  const item = product(productId);
  if (!item?.serialized) return;
  const available = availableFor(state, state.draft.branchId, productId);
  const selected = currentCartItem(productId)?.serials ?? [];
  const body = `<div class="dialog-callout">كل رقم يمثل جهازًا واحدًا في <strong>${esc(branch(state.draft.branchId)?.warehouse)}</strong>. الأرقام خيالية للتجربة.</div><div class="dialog-options" role="group" aria-label="الأرقام التسلسلية المتاحة">${available.map((serial) => `<label class="option-row"><input type="checkbox" name="demo-serial" value="${esc(serial)}" ${selected.includes(serial) ? "checked" : ""}><span><strong><bdi dir="ltr">${esc(serial)}</bdi></strong><small>جهاز تجريبي متاح</small></span></label>`).join("") || '<p class="field-hint">لا توجد أجهزة تجريبية متاحة.</p>'}</div>`;
  openDialog("اختيار السيريال", item.name, body, `<button type="button" class="btn btn--secondary" data-action="close-dialog">إلغاء</button><button type="button" class="btn" data-action="save-serials" data-product="${item.id}">تأكيد الاختيار</button>`, { focus: 'input[name="demo-serial"]' });
}
function reviewSale() {
  let amounts;
  try { amounts = validateDraft(state); }
  catch (error) {
    const target = document.getElementById("sale-error");
    if (target) { target.className = "field-alert"; target.textContent = error instanceof DemoError ? error.message : "تحقق من بيانات المعاينة."; target.hidden = false; target.setAttribute("role", "alert"); }
    const fields = { customerName: "#customer-name", phone: "#customer-phone", branchId: "#sale-branch", discount: "#sale-discount", initialPayment: "#initial-payment", cart: "#catalog-heading" };
    document.querySelector(fields[error?.field] ?? "#sale-error")?.focus();
    return;
  }
  const items = state.draft.cart.map((entry) => {
    const p = product(entry.productId);
    const quantity = p.serialized ? entry.serials.length : entry.quantity;
    return `<div class="review-line"><span>${esc(p.name)} × ${count(quantity)}${p.serialized ? `<br><small><bdi dir="ltr">${entry.serials.map(esc).join("، ")}</bdi></small>` : ""}</span><strong>${money(p.price * quantity)}</strong></div>`;
  }).join("");
  const body = `<div class="dialog-callout">هذه مراجعة وهمية فقط. لن تتصل العملية بمخزونك الحقيقي أو تسجل مدفوعات.</div><div class="review-list"><div class="review-line"><span>العميل</span><strong>${esc(state.draft.customerName)} · <bdi dir="ltr">${esc(state.draft.phone)}</bdi></strong></div><div class="review-line"><span>الفرع والمستودع</span><strong>${esc(branch(state.draft.branchId)?.name)} · ${esc(branch(state.draft.branchId)?.warehouse)}</strong></div>${items}<div class="review-line"><span>الخصم</span><strong>${money(amounts.discount)}</strong></div><div class="review-line is-strong"><span>الإجمالي النهائي</span><strong>${money(amounts.total)}</strong></div><div class="review-line"><span>المدفوع · ${esc(method(state.draft.method)?.label)}</span><strong>${money(amounts.paid)}</strong></div><div class="review-line"><span>المتبقي على العميل</span><strong>${money(amounts.remaining)}</strong></div><div class="review-line"><span>ضريبة افتراضية ضمن الإجمالي</span><strong>${money(amounts.tax)}</strong></div></div>`;
  openDialog("راجع البيع التجريبي", "تأكد من الأصناف والسيريالات والمبالغ قبل التأكيد.", body, `<button type="button" class="btn btn--secondary" data-action="close-dialog">تعديل البيانات</button><button type="button" class="btn" data-action="confirm-sale">تأكيد البيع التجريبي</button>`);
}
function paymentDialog(invoice) {
  if (!canSeeInvoice(state, invoice)) return;
  const a = invoiceAmounts(invoice);
  if (!a.due || invoice.canceled) return;
  const body = `<div class="dialog-callout">المتبقي التجريبي على العميل: <strong>${money(a.due)}</strong>. لن تتم أي عملية دفع حقيقية.</div><div class="field"><label for="collection-amount">مبلغ التحصيل <span class="required">*</span></label><div class="currency-field"><input id="collection-amount" value="${inputMoney(a.due)}" inputmode="decimal" dir="ltr"><span>ج.م</span></div><p class="field-hint">يمكن إدخال جزء من الباقي أو تسديده كاملًا.</p></div><div class="field"><label for="collection-method">طريقة الدفع</label><select id="collection-method">${METHODS.map((item) => `<option value="${item.id}">${esc(item.label)}</option>`).join("")}</select></div>`;
  openDialog("تسجيل تحصيل تجريبي", invoice.number, body, `<button type="button" class="btn btn--secondary" data-action="close-dialog">إلغاء</button><button type="button" class="btn" data-action="confirm-payment" data-invoice="${esc(invoice.id)}">تسجيل التحصيل التجريبي</button>`, { focus: "#collection-amount" });
}
function returnDialog(invoice) {
  if (state.role !== "manager" || !invoice) return;
  const items = invoice.units.filter((unit) => !unit.returned);
  if (!items.length) return;
  const body = `<div class="dialog-callout is-warning">المرتجع هنا تجريبي. يُعاد الصنف المقبول للمخزون الوهمي، ويُخصم المبلغ من الباقي أولًا.</div><div class="radio-tabs" role="radiogroup" aria-label="نوع العملية"><label><input type="radio" name="return-mode" value="partial" checked><span>مرتجع أصناف</span></label><label><input type="radio" name="return-mode" value="cancel"><span>إلغاء الفاتورة كاملة</span></label></div><div class="field"><span class="field__label">حدد القطع المراد إرجاعها</span><div class="dialog-options" role="group" aria-label="الأصناف المتاحة للمرتجع">${items.map((unit) => `<label class="option-row"><input type="checkbox" name="return-unit" value="${esc(unit.id)}"><span><strong>${esc(unit.name)} · ${money(unit.net)}</strong><small>${unit.serial ? `<bdi dir="ltr">${esc(unit.serial)}</bdi>` : `قطعة · ${esc(unit.sku)}`}</small></span></label>`).join("")}</div></div><div id="return-preview" class="dialog-callout">اختر قطعة لرؤية أثر المرتجع على الحساب.</div><div class="field"><label for="return-reason">سبب المرتجع <small>(اختياري للتجربة)</small></label><textarea id="return-reason" maxlength="240" placeholder="سبب تجريبي"></textarea></div>`;
  openDialog("مرتجع أو إلغاء تجريبي", invoice.number, body, `<button type="button" class="btn btn--secondary" data-action="close-dialog">إغلاق</button><button type="button" class="btn btn--danger" id="confirm-return" data-action="confirm-return" data-invoice="${esc(invoice.id)}">تأكيد المرتجع التجريبي</button>`, { focus: 'input[name="return-mode"]' });
}
function updateReturnDialog() {
  const invoice = currentInvoice();
  const target = document.getElementById("return-preview");
  if (!invoice || !target) return;
  const cancel = document.querySelector('input[name="return-mode"]:checked')?.value === "cancel";
  const ids = [...document.querySelectorAll('input[name="return-unit"]:checked')].map((input) => input.value);
  const button = document.getElementById("confirm-return");
  if (button) button.textContent = cancel ? "تأكيد الإلغاء التجريبي" : "تأكيد المرتجع التجريبي";
  try {
    const result = returnPreview(invoice, ids, cancel);
    target.innerHTML = `<div class="review-list"><div class="review-line"><span>قيمة المرتجع بعد الخصم</span><strong>${money(result.amount)}</strong></div><div class="review-line"><span>الباقي على العميل بعد المرتجع</span><strong>${money(result.dueAfter)}</strong></div><div class="review-line"><span>مستحق للعميل بعد المرتجع</span><strong>${money(result.creditAfter)}</strong></div></div><p class="field-hint">المبلغ المستحق للعميل لا يعني أنه دُفع له بالفعل.</p>`;
  } catch { target.textContent = "اختر قطعة لرؤية أثر المرتجع على الحساب."; }
}
function settingsDialog() {
  if (state.role !== "manager") return;
  const value = formatPercent(state.discountLimitBps).replace("%", "");
  const body = `<div class="dialog-callout">الحد يخص موظف الفرع فقط، ويُطبّق على مجموع الخصم بالجنيه كنسبة من الفاتورة. هذا الإعداد للمعاينة ولا يُحفظ.</div><div class="field"><label for="discount-limit">أقصى خصم للموظف (%)</label><input id="discount-limit" value="${esc(value)}" inputmode="decimal" dir="ltr"><p class="field-hint">أدخل نسبة من ٠ إلى ١٠٠.</p></div>`;
  openDialog("حد خصم الموظف", "إعداد تجريبي للمدير", body, `<button type="button" class="btn btn--secondary" data-action="close-dialog">إلغاء</button><button type="button" class="btn" data-action="save-settings">حفظ الإعداد التجريبي</button>`, { focus: "#discount-limit" });
}
function branchDialog(newBranch) {
  const target = branch(newBranch);
  if (!target) return;
  openDialog("تغيير الفرع التجريبي", "الأصناف مرتبطة بمخزون المستودع المختار.", `<div class="dialog-callout is-warning">سيتم مسح الأصناف من مسودة المعاينة عند الانتقال إلى <strong>${esc(target.name)}</strong>، لتختارها من مخزون الفرع الجديد. لن تتأثر أي بيانات حقيقية.</div>`, `<button type="button" class="btn btn--secondary" data-action="close-dialog">إبقاء الفرع الحالي</button><button type="button" class="btn" data-action="confirm-branch" data-branch="${esc(newBranch)}">تغيير الفرع</button>`);
}
function setScreen(screen) {
  if (!["sale", "invoices", "returns"].includes(screen)) return;
  ui.screen = screen;
  ui.invoiceSearch = "";
  render();
  document.getElementById("content")?.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: "instant" });
}

app.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  if (action === "navigate") { setScreen(button.dataset.screen); return; }
  if (action === "open-settings") { settingsDialog(); return; }
  if (action === "serials") { serialDialog(button.dataset.product); return; }
  if (action === "review-sale") { reviewSale(); return; }
  if (action === "print") { window.print(); return; }
  if (action === "show-invoice") {
    const invoice = state.invoices.find((item) => item.id === button.dataset.invoice);
    if (!canSeeInvoice(state, invoice)) return;
    ui.from = ui.screen === "returns" ? "returns" : "invoices";
    ui.invoiceId = invoice.id;
    ui.screen = "detail";
    render();
    document.getElementById("content")?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
    return;
  }
  if (action === "collect") { paymentDialog(currentInvoice()); return; }
  if (action === "return") { returnDialog(currentInvoice()); return; }
  if (action === "add-product") {
    const p = product(button.dataset.product);
    if (!p || p.serialized || state.role === "accountant") return;
    const stock = availableFor(state, state.draft.branchId, p.id);
    const entry = currentCartItem(p.id);
    if (entry && entry.quantity < stock) entry.quantity++;
    else if (!entry && stock > 0) state.draft.cart.push({ productId: p.id, quantity: 1 });
    render();
    return;
  }
  if (action === "quantity") {
    const p = product(button.dataset.product);
    const entry = currentCartItem(p?.id);
    if (!entry || p.serialized) return;
    const quantity = entry.quantity + Number(button.dataset.delta);
    if (quantity <= 0) state.draft.cart = state.draft.cart.filter((item) => item !== entry);
    else if (quantity <= availableFor(state, state.draft.branchId, p.id)) entry.quantity = quantity;
    render();
    return;
  }
  if (action === "remove-product") {
    state.draft.cart = state.draft.cart.filter((item) => item.productId !== button.dataset.product);
    render();
    return;
  }
  if (action === "remove-serial") {
    const entry = currentCartItem(button.dataset.product);
    if (!entry?.serials) return;
    entry.serials = entry.serials.filter((serial) => serial !== button.dataset.serial);
    if (!entry.serials.length) state.draft.cart = state.draft.cart.filter((item) => item !== entry);
    render();
  }
});

dialogRoot.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  if (action === "close-dialog") { closeDialog(); return; }
  if (action === "save-serials") {
    const p = product(button.dataset.product);
    if (!p?.serialized) return;
    const checked = [...dialogRoot.querySelectorAll('input[name="demo-serial"]:checked')].map((input) => input.value);
    const available = availableFor(state, state.draft.branchId, p.id);
    if (checked.some((serial) => !available.includes(serial))) { dialogError(new DemoError("أحد السيريالات لم يعد متاحًا.")); return; }
    state.draft.cart = state.draft.cart.filter((item) => item.productId !== p.id);
    if (checked.length) state.draft.cart.unshift({ productId: p.id, serials: checked });
    closeDialog(); render(); toast("تم تحديث السيريالات التجريبية في الفاتورة."); return;
  }
  if (action === "confirm-sale") {
    try {
      const result = createSale(state);
      state = result.state;
      ui.invoiceId = result.invoiceId; ui.from = "invoices"; ui.screen = "detail";
      closeDialog(); render(); toast("تم تأكيد بيع تجريبي فقط، دون حفظ بيانات حقيقية.");
      document.getElementById("content")?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: "instant" });
    } catch (error) { dialogError(error); }
    return;
  }
  if (action === "confirm-payment") {
    try {
      const result = recordPayment(state, button.dataset.invoice, document.getElementById("collection-amount")?.value, document.getElementById("collection-method")?.value);
      state = result.state; closeDialog(); render(); toast("تم تسجيل تحصيل تجريبي فقط.");
    } catch (error) { dialogError(error); }
    return;
  }
  if (action === "confirm-return") {
    try {
      const cancel = dialogRoot.querySelector('input[name="return-mode"]:checked')?.value === "cancel";
      const ids = [...dialogRoot.querySelectorAll('input[name="return-unit"]:checked')].map((input) => input.value);
      const result = registerReturn(state, button.dataset.invoice, ids, { cancel, reason: document.getElementById("return-reason")?.value ?? "" });
      state = result.state; closeDialog(); render(); toast(cancel ? "تم إلغاء الفاتورة التجريبية فقط." : "تم تسجيل المرتجع التجريبي وإعادة الأصناف الوهمية للمخزون.");
    } catch (error) { dialogError(error); }
    return;
  }
  if (action === "save-settings") {
    try { state = setDiscountLimit(state, document.getElementById("discount-limit")?.value); closeDialog(); render(); toast("تم تغيير حد الخصم في المعاينة فقط."); }
    catch (error) { dialogError(error); }
    return;
  }
  if (action === "confirm-branch") {
    if (!branch(button.dataset.branch) || state.role !== "manager") return;
    state.draft.branchId = button.dataset.branch; state.draft.cart = [];
    closeDialog(); render(); toast("اختر الأصناف من مخزون الفرع التجريبي الجديد.");
  }
});

app.addEventListener("input", (event) => {
  const target = event.target;
  const control = target.dataset.control;
  if (["customerName", "phone", "discount", "initialPayment"].includes(control)) {
    state.draft[control] = target.value;
    if (control === "discount" || control === "initialPayment") updateSaleTotals();
    else { const error = document.getElementById("sale-error"); if (error) error.hidden = true; }
  }
  if (control === "catalogSearch") {
    ui.catalogSearch = target.value;
    const container = document.getElementById("catalog-items");
    if (container) container.innerHTML = catalogItems();
  }
  if (control === "invoiceSearch") {
    ui.invoiceSearch = target.value;
    const container = document.getElementById("invoice-rows");
    if (container) container.innerHTML = invoiceRows();
  }
});
app.addEventListener("change", (event) => {
  const target = event.target;
  const control = target.dataset.control;
  if (control === "method") { state.draft.method = target.value; return; }
  if (control === "role" && Object.hasOwn(ROLE_LABELS, target.value)) {
    state.role = target.value;
    if (state.role === "staff" && state.draft.branchId !== state.staffBranch) {
      state.draft.branchId = state.staffBranch; state.draft.cart = [];
      toast("تم تغيير الفرع ومسح أصناف المسودة التجريبية.");
    }
    if (state.role === "accountant" && ui.screen === "sale") ui.screen = "invoices";
    if (ui.screen === "detail" && !canSeeInvoice(state, currentInvoice())) ui.screen = "invoices";
    render();
    return;
  }
  if (control === "branch" && state.role === "manager" && target.value !== state.draft.branchId) {
    const next = target.value;
    target.value = state.draft.branchId;
    if (state.draft.cart.length) branchDialog(next);
    else { state.draft.branchId = next; render(); }
  }
});
dialogRoot.addEventListener("change", (event) => {
  if (event.target.name === "return-mode") {
    const cancel = event.target.value === "cancel";
    for (const item of dialogRoot.querySelectorAll('input[name="return-unit"]')) { item.checked = cancel; item.disabled = cancel; }
    updateReturnDialog();
  }
  if (event.target.name === "return-unit") updateReturnDialog();
});

render();
