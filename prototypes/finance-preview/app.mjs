import {
  BRANCHES, CATEGORIES, METHODS, ROLE_NAMES, DemoProblem, createInitialState, setRole,
  visibleAccounts, selectableCashAccounts, balanceOf, totalCash, formatMoney,
  inspectTransfer, recordTransfer, inspectExpense, createExpense, approveExpense,
  inspectExpensePayment, payExpense, inspectPaidExpenseReview, requestPaidExpenseReview, inspectCollection, recordCollection,
  branchName, categoryName, methodName, accountName,
} from "./model.mjs";

const app = document.querySelector("#app");
let state = createInitialState();
function todayInCairo() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = (name) => parts.find((part) => part.type === name)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}
const ui = {
  view: "overview", status: "", error: "", review: null, reviewError: "", payment: null, paidReview: null,
  expense: { branchId: "branch-a", categoryId: "maintenance", amount: "", date: todayInCairo(), description: "", beneficiary: "", documentNumber: "", taxAmount: "" },
  transfer: { fromId: "", toId: "", amount: "", actuallyTransferred: false },
  collection: { branchId: "branch-a", method: "CASH", accountId: "", amount: "", actuallyReceived: false },
};
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const svg = (name) => {
  const paths = {
    shield: '<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/>',
    dashboard: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    receipt: '<path d="M5 3h14v18l-2-1.5-2 1.5-3-1.5L9 21l-2-1.5L5 21V3Z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    wallet: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M16 10h5v5h-5a2.5 2.5 0 0 1 0-5Z"/><path d="M7 5V3h10"/>',
    arrows: '<path d="M4 8h14m-4-4 4 4-4 4M20 16H6m4-4-4 4 4 4"/>',
    coins: '<ellipse cx="8" cy="6" rx="5" ry="2.5"/><path d="M3 6v4c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5V6M3 10v4c0 1.4 2.2 2.5 5 2.5"/><ellipse cx="16" cy="15" rx="5" ry="2.5"/><path d="M11 15v3c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-3"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    users: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4.5V20"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5h.01"/>',
    alert: '<path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 9v5M12 17h.01"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
  };
  return `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name] ?? paths.info}</svg>`;
};
const brand = () => `<svg class="brand-mark" viewBox="0 0 48 48" aria-hidden="true"><rect x="3" y="3" width="42" height="42" rx="14" fill="#edf4ff"/><path d="M25 10c-7 0-12 4.9-12 11.3 0 4 2 6.9 4.9 9.2 2 1.6 2.8 3.4 2.9 6.3h5c.1-3.9 1.4-6.4 3.8-8.3 2.2-1.7 3.6-4.2 3.6-7.2 0-4.2-3.3-7.4-7.6-7.4-3.9 0-6.9 2.8-6.9 6.7" fill="none" stroke="#315eaa" stroke-width="3" stroke-linecap="round"/><path d="M23.3 21.2c0-1.6 1.1-2.7 2.6-2.7s2.8 1.2 2.8 3" fill="none" stroke="#41a39a" stroke-width="2.8" stroke-linecap="round"/></svg>`;
const manager = () => state.role === "manager" || state.role === "accountant";
const money = (cents) => `<bdi dir="ltr">${esc(formatMoney(cents))}</bdi> <span class="currency">ج.م</span>`;
const chosen = (a, b) => a === b ? " selected" : "";
const check = (value) => value ? " checked" : "";
function notice(text, kind = "info") { return `<div class="notice ${kind === "info" ? "" : kind}" role="${kind === "error" || kind === "warning" ? "alert" : "status"}">${svg(kind === "warning" || kind === "error" ? "alert" : kind === "success" ? "check" : "info")}<span>${text}</span></div>`; }
function navButton(key, label, icon) { return `<button type="button" class="nav-button ${ui.view === key ? "active" : ""}" data-action="navigate" data-view="${key}" ${ui.view === key ? 'aria-current="page"' : ""}>${svg(icon)}<span>${label}</span>${ui.view === key ? '<span class="nav-dot" aria-hidden="true"></span>' : ""}</button>`; }
function header() {
  return `<div class="preview-banner" role="note">${svg("shield")}<strong>معاينة منفصلة ببيانات وهمية</strong><span class="dot">•</span><span>ليست الموقع الفعلي ولا تتصل بقاعدة بيانات أو تنقل أموالًا؛ تعود الأمثلة عند تحديث الصفحة.</span></div>
    <div class="shell"><aside class="sidebar" aria-label="قائمة المعاينة"><div class="brand">${brand()}<div class="brand-copy"><strong>صلة <span>تون</span></strong><small dir="ltr">SELATONE HEARING</small></div></div>
      <nav aria-label="التنقل في المعاينة"><p class="nav-title">العمليات المالية التجريبية</p><div class="nav-list">${navButton("overview", "نظرة عامة", "dashboard")}${manager() ? navButton("expenses", "المصروفات", "receipt") : ""}${navButton("accounts", manager() ? "الخزائن والعهد" : "عهدتي", "wallet")}${navButton("collection", "تحصيل تجريبي", "coins")}</div></nav>
      <div class="sidebar-tip"><strong>مساحة للتجربة فقط</strong><p>الأرصدة والعمليات والأسماء افتراضية. تبديل الدور للمحاكاة وليس مصادقة أو صلاحيات حقيقية.</p></div><div class="sidebar-foot">نموذج تصوري • غير متصل بالإنتاج</div></aside>
      <div class="work"><header class="topbar"><div class="topbar-title"><span class="topbar-icon">${svg("wallet")}</span><span><small>نظام إدارة صلة تون</small><strong>المصروفات والعهد</strong></span></div><div class="role-control"><span class="avatar" aria-hidden="true">ت</span><label for="demo-role">التجربة كـ<select id="demo-role" data-control="role">${Object.entries(ROLE_NAMES).map(([value, label]) => `<option value="${esc(value)}"${chosen(state.role, value)}>${esc(label)}</option>`).join("")}</select></label></div></header><main id="content" class="content" tabindex="-1">`;
}
function heading(title, subtitle, actions = "") {
  return `<div class="page-head"><div><p class="eyebrow">الإدارة المالية • معاينة</p><h1>${title}</h1><p class="subtitle">${subtitle}</p></div>${actions ? `<div class="head-actions">${actions}</div>` : ""}</div>`;
}
function metric(label, value, help, icon, color = "", negative = false) {
  return `<div class="metric"><div class="metric-top"><span class="metric-label">${label}</span><span class="metric-icon ${color}">${svg(icon)}</span></div><div class="metric-value ${negative ? "negative" : ""}">${value}</div><p class="metric-help">${help}</p></div>`;
}
function accountRows(accounts) {
  if (!accounts.length) return '<div class="empty">لا توجد حسابات تجريبية للعرض.</div>';
  return `<div class="account-list">${accounts.map((a) => {
    const amount = balanceOf(state, a.id);
    return `<div class="account-row"><span class="account-icon ${a.kind === "custody" ? "custody" : ""}">${svg(a.kind === "custody" ? "users" : "wallet")}</span><div class="account-copy"><strong>${esc(a.label)}</strong><small>${esc(branchName(a.branchId))} · ${a.kind === "vault" ? "خزنة فرع" : "عهدة موظف"}</small></div><div class="account-value ${amount < 0n ? "negative" : ""}">${money(amount)}<small>${amount < 0n ? "فرق يحتاج مراجعة" : "رصيد تجريبي"}</small></div></div>`;
  }).join("")}</div>`;
}
function history() {
  const owned = new Set(visibleAccounts(state).map((a) => a.id));
  const rows = state.movements.filter((m) => manager() || owned.has(m.fromId) || owned.has(m.toId)).slice(0, 5);
  if (!rows.length) return '<div class="empty">لا توجد حركات أُضيفت في هذه التجربة بعد.</div>';
  return rows.map((m) => {
    const title = m.kind === "TRANSFER" ? "تسليم نقدي" : m.kind === "COLLECTION" ? "تحصيل نقدي تجريبي" : manager() ? "صرف مصروف تجريبي" : "خصم من العهدة";
    const detail = m.kind === "TRANSFER" ? `من ${accountName(state, m.fromId)} إلى ${accountName(state, m.toId)}` : accountName(state, m.toId ?? m.fromId);
    return `<div class="history-row"><span><strong>${esc(title)}</strong><small>${esc(detail)} · ${esc(ROLE_NAMES[m.actor])}</small></span><b>${money(m.amountCents)}</b></div>`;
  }).join("");
}
function overview() {
  if (!manager()) {
    const accounts = visibleAccounts(state), own = accounts[0], balance = own ? balanceOf(state, own.id) : 0n;
    return `${heading("عهدتي النقدية", "اطّلع على عهدتك التجريبية وحركاتها ضمن فرعك.", `<button class="btn" type="button" data-action="navigate" data-view="collection">${svg("plus")} تحصيل تجريبي</button>`)}
      ${notice("هذه المحاكاة تعرض عهدة الموظف فقط. التسليم بين العهدة والخزنة يُسجّله المدير أو المحاسب بعد حدوثه فعليًا.")}
      <div class="metrics">${metric("رصيد عهدتي", money(balance), "مبلغ افتراضي للتوضيح", "wallet", "teal", balance < 0n)}${metric("الفرع", esc(branchName(state.staffBranch)), "نطاق الموظف التجريبي", "users", "violet")}</div>
      <div class="layout-grid"><div class="stack"><section class="panel"><div class="panel-header"><div><h2>عهدتي</h2><p>الأرصدة هنا بيانات خيالية فقط</p></div><span class="tag green">عهدة تجريبية</span></div>${accountRows(accounts)}</section><section class="panel"><div class="panel-header"><div><h2>آخر الحركات</h2><p>الحركات التي تخص عهدتك في هذه التجربة</p></div></div>${history()}</section></div><aside class="panel"><div class="panel-header"><div><h2>كيف يعمل التحصيل؟</h2></div></div><div class="panel-body"><p class="callout">اختر مكان النقد الذي استلم المبلغ فعليًا: عهدتك أو خزنة فرعك. البطاقة والتحويل والمحفظة لا تزيد الرصيد النقدي.</p></div></aside></div>`;
  }
  const safeTotal = state.accounts.filter((a) => a.kind === "vault").reduce((sum, a) => sum + balanceOf(state, a.id), 0n);
  const custodyTotal = state.accounts.filter((a) => a.kind === "custody").reduce((sum, a) => sum + balanceOf(state, a.id), 0n);
  const pending = state.expenses.filter((e) => e.status === "PENDING").length;
  const approved = state.expenses.filter((e) => e.status === "APPROVED").length;
  const negatives = state.accounts.filter((a) => balanceOf(state, a.id) < 0n);
  return `${heading("المصروفات والعهد النقدية", "صورة مبسطة للأرصدة وحالة المصروفات عبر الفروع التجريبية.", `<button class="btn secondary" type="button" data-action="navigate" data-view="accounts">${svg("arrows")} تسليم عهدة</button><button class="btn" type="button" data-action="navigate" data-view="expenses">${svg("plus")} مصروف جديد</button>`)}
    ${negatives.length ? notice(`يوجد ${negatives.length} حساب تجريبي برصيد سالب. السالب فرق في السجل يحتاج مراجعة، وليس نقدًا ماديًا سالبًا.`, "warning") : notice("هذه أرقام للتوضيح فقط. يُدخل الرصيد الافتتاحي الحقيقي بعد الجرد عند تفعيل الوحدة مستقبلًا.")}
    <div class="metrics">${metric("إجمالي النقد", money(totalCash(state)), "الخزائن والعهد معًا دون تكرار", "coins", "", totalCash(state) < 0n)}${metric("خزائن الفروع", money(safeTotal), "نقد محفوظ في الخزائن التجريبية", "wallet", "teal", safeTotal < 0n)}${metric("عهد الموظفين", money(custodyTotal), "نقد في عهد الموظفين التجريبية", "users", "violet", custodyTotal < 0n)}${metric("مصروفات تحتاج متابعة", `${pending + approved}`, `${pending} للاعتماد · ${approved} للصرف`, "clock", "amber")}</div>
    <div class="layout-grid"><div class="stack"><section class="panel"><div class="panel-header"><div><h2>الخزائن والعهد</h2><p>أرصدة افتتاحية وأرصدة حركات وهمية</p></div><button type="button" class="btn quiet small" data-action="navigate" data-view="accounts">عرض الحسابات ←</button></div>${accountRows(state.accounts)}</section><section class="panel"><div class="panel-header"><div><h2>آخر الحركات</h2><p>التحويل بين حسابين لا يزيد إجمالي النقد</p></div></div>${history()}</section></div>
      <aside class="stack"><section class="panel"><div class="panel-header"><div><h2>رحلة المصروف</h2><p>ثلاث خطوات منفصلة</p></div><span class="tag blue">توضيحي</span></div><div class="panel-body"><div class="steps"><div class="step"><span class="step-number">1</span><div><strong>تسجيل المصروف</strong><p>أدخل البند والمبلغ والفرع للمراجعة.</p></div></div><div class="step"><span class="step-number">2</span><div><strong>الاعتماد</strong><p>الاعتماد وحده لا يعني دفع المال.</p></div></div><div class="step"><span class="step-number">3</span><div><strong>تسجيل الصرف الفعلي</strong><p>يُخصم النقد من مصدره بعد الدفع الفعلي.</p></div></div></div></div></section><div class="callout">البطاقة والتحويل والمحفظة تُسجّل كوسائل غير نقدية، ولا تُضاف تلقائيًا لخزنة الفرع أو لعهدة الموظف. رد العميل النقدي يُخصم بعد الدفع الفعلي من مصدره، لا عند تسجيل المرتجع؛ الرد غير منفّذ في هذه المعاينة.</div></aside></div>`;
}
function expenseStatus(item) {
  if (item.status === "PENDING") return '<span class="tag amber">بانتظار الاعتماد</span>';
  if (item.status === "APPROVED") return '<span class="tag blue">معتمد · لم يُدفع</span>';
  return item.payment?.historical ? '<span class="tag blue">مدفوع تاريخيًا</span>' : '<span class="tag green">مدفوع</span>';
}
function expenseRows() {
  if (!state.expenses.length) return '<div class="empty">لا توجد مصروفات تجريبية.</div>';
  return `<p class="scroll-hint">اسحب الجدول أفقيًا لعرض الحالة وأزرار الإجراءات.</p><div class="table-wrap" role="region" aria-label="جدول المصروفات التجريبية" tabindex="0"><table><thead><tr><th scope="col">المصروف</th><th scope="col">الفرع</th><th scope="col">المبلغ</th><th scope="col">الحالة</th><th scope="col">الإجراء</th></tr></thead><tbody>${state.expenses.map((item) => `<tr><td><strong>${esc(item.description)}</strong><small>${esc(categoryName(item.categoryId))} · <bdi dir="ltr">${esc(item.date)}</bdi></small><small>سجّله: ${esc(ROLE_NAMES[item.createdBy])}${item.approvedBy ? ` · اعتمده: ${esc(ROLE_NAMES[item.approvedBy])}` : ""}</small>${item.beneficiary ? `<small>المستفيد: ${esc(item.beneficiary)}</small>` : ""}${item.documentNumber ? `<small>المستند: ${esc(item.documentNumber)}</small>` : ""}${item.taxCents != null ? `<small>الضريبة المدخلة: ${money(item.taxCents)}</small>` : ""}</td><td>${esc(branchName(item.branchId))}</td><td>${money(item.amountCents)}</td><td>${expenseStatus(item)}</td><td><div class="table-actions">${item.status === "PENDING" ? `<button type="button" class="btn secondary small" data-action="approve" data-id="${esc(item.id)}">اعتماد</button>` : item.status === "APPROVED" ? `<button type="button" class="btn secondary small" data-action="pay" data-id="${esc(item.id)}">تسجيل الصرف</button>` : `<span class="tag">${esc(methodName(item.payment.method))}</span>${state.paidReviews.some((review) => review.expenseId === item.id) ? '<span class="tag amber">قيد المراجعة</span>' : `<button type="button" class="btn secondary small" data-action="paid-review" data-id="${esc(item.id)}">طلب مراجعة</button>`}`}</div></td></tr>`).join("")}</tbody></table></div>`;
}
function branchOptions(selected) { return BRANCHES.map((b) => `<option value="${esc(b.id)}"${chosen(selected, b.id)}>${esc(b.name)}</option>`).join(""); }
function categoryOptions(selected) { return CATEGORIES.map((c) => `<option value="${esc(c.id)}"${chosen(selected, c.id)}>${esc(c.name)}</option>`).join(""); }
function methodOptions(selected) { return METHODS.map((m) => `<option value="${esc(m.id)}"${chosen(selected, m.id)}>${esc(m.label)}</option>`).join(""); }
function accountOptions(items, selected) { return `<option value="">اختر الحساب المناسب</option>${items.map((a) => `<option value="${esc(a.id)}"${chosen(selected, a.id)}>${esc(a.label)} — ${esc(branchName(a.branchId))}</option>`).join("")}`; }
function paymentPanel() {
  if (!ui.payment) return "";
  const item = state.expenses.find((x) => x.id === ui.payment.expenseId);
  if (!item) return "";
  const p = ui.payment;
  const options = state.accounts.filter((a) => a.branchId === item.branchId);
  const source = p.method === "CASH" ? options.find((a) => a.id === p.accountId) : null;
  const sameDay = Boolean(source && p.paymentDate && p.paymentDate === source.openingDate);
  const beforeCount = Boolean(source && p.paymentDate && (p.paymentDate < source.openingDate || (sameDay && p.openingOrder === "before")));
  const orderField = sameDay ? `<div class="field wide"><label for="opening-order">توقيت الدفع في يوم الجرد *</label><select id="opening-order" name="openingOrder"><option value="">اختر قبل الجرد أو بعده</option><option value="before"${chosen(p.openingOrder, "before")}>قبل الجرد</option><option value="after"${chosen(p.openingOrder, "after")}>بعد الجرد</option></select></div>` : "";
  const historicalCheck = beforeCount ? `<label class="check wide"><input type="checkbox" name="includedInOpening"${check(p.includedInOpening)}><span><strong>أؤكد أن الدفع سبق الجرد والرصيد الافتتاحي يعكسه</strong><small>سيُسجّل تاريخيًا دون خصم نقدي جديد في المثال.</small></span></label>` : "";
  return `<section class="panel" aria-labelledby="payment-title">
    <div class="panel-header"><div><h2 id="payment-title">تسجيل صرف فعلي</h2><p>${esc(item.description)} · ${money(item.amountCents)} · ${esc(branchName(item.branchId))}</p></div><button type="button" class="btn quiet small" data-action="close-payment">إغلاق</button></div>
    <form data-form="payment" class="panel-body"><div class="form-grid">
      <div class="field"><label for="payment-method">وسيلة الدفع *</label><select id="payment-method" name="method">${methodOptions(p.method)}</select></div>
      ${p.method === "CASH" ? `<div class="field"><label for="payment-account">مصدر النقد *</label><select id="payment-account" name="accountId">${accountOptions(options, p.accountId)}</select>${source ? `<p class="field-hint">تاريخ جرد هذا الحساب التجريبي: <bdi dir="ltr">${esc(source.openingDate)}</bdi>.</p>` : ""}</div>` : `<div class="field"><span class="field-label">الأثر على النقد</span><p class="field-hint">لا يُخصم من الخزنة أو العهدة؛ لا تُنشأ حركة بنكية.</p></div>`}
      <div class="field"><label for="payment-date">تاريخ الدفع الفعلي *</label><input id="payment-date" name="paymentDate" type="date" value="${esc(p.paymentDate)}"><p class="field-hint">يُحفظ وقت تسجيل الصرف منفصلًا.</p></div>
      ${orderField}${historicalCheck}
      <label class="check wide"><input type="checkbox" name="actuallyPaid"${check(p.actuallyPaid)}><span><strong>أؤكد أن المبلغ التجريبي دُفع بالفعل</strong><small>في النظام الفعلي لن ينفذ هذا الزر أي تحويل للأموال.</small></span></label>
    </div><div class="form-actions"><button type="submit" class="btn">مراجعة الصرف</button><span class="hint">لن يُسجّل قبل التأكيد.</span></div></form>
  </section>`;
}
function paidReviewPanel() {
  if (!ui.paidReview) return "";
  const item = state.expenses.find((entry) => entry.id === ui.paidReview.expenseId);
  if (!item || item.status !== "PAID") return "";
  return `<section class="panel" aria-labelledby="paid-review-title"><div class="panel-header"><div><h2 id="paid-review-title">طلب مراجعة مصروف مدفوع</h2><p>${esc(item.description)} · المبلغ المسجّل ${money(item.amountCents)}</p></div><button type="button" class="btn quiet small" data-action="close-paid-review">إغلاق</button></div>
    <form data-form="paidReview" class="panel-body"><p class="callout">يُحال الخطأ للمراجعة اليدوية فقط؛ يبقى المصروف والرصيد كما هما، ولا يُسجّل استرداد أو دفع جديد.</p><div class="form-grid review-fields">
    <div class="field wide"><label for="paid-review-reason">سبب المراجعة *</label><textarea id="paid-review-reason" name="reason" maxlength="300" placeholder="مثال: دُفع 100 وسُجّل 120">${esc(ui.paidReview.reason)}</textarea></div>
    <div class="field"><label for="paid-review-amount">المبلغ المقترح للمراجعة (اختياري)</label><input id="paid-review-amount" name="proposedAmount" dir="ltr" inputmode="decimal" value="${esc(ui.paidReview.proposedAmount)}" placeholder="غير محدد"><p class="field-hint">قيمة مقترحة تحتاج مراجعة؛ لا تغيّر المبلغ المسجل.</p></div></div>
    <div class="form-actions"><button type="submit" class="btn">مراجعة الطلب</button><span class="hint">لن تتغير الأرصدة.</span></div></form></section>`;
}
function paidReviewList() {
  if (!state.paidReviews.length) return "";
  return `<section class="panel"><div class="panel-header"><div><h2>طلبات المراجعة اليدوية</h2><p>مفتوحة للمراجعة فقط؛ التسوية غير منفذة في المعاينة</p></div><span class="tag amber">${state.paidReviews.length} مفتوح</span></div>
    ${state.paidReviews.map((entry) => { const item=state.expenses.find((value)=>value.id===entry.expenseId); return `<div class="history-row"><span class="review-copy"><strong>${esc(item?.description ?? "مصروف تجريبي")}</strong><small>${esc(entry.reason)}</small><small>طلبه: ${esc(ROLE_NAMES[entry.requestedBy])} · المسجل ${money(entry.originalAmountCents)} · المقترح ${entry.proposedAmountCents === null ? "غير محدد" : money(entry.proposedAmountCents)}</small></span><span class="tag amber">مراجعة يدوية</span></div>`; }).join("")}</section>`;
}
function expensesScreen() {
  if (!manager()) return notice("المصروفات متاحة للمدير والمحاسب التجريبيين فقط.", "warning");
  const e = ui.expense;
  return `${heading("المصروفات", "سجّل المصروف، ثم اعتمده، ثم أثبت الصرف بعد الدفع الفعلي.")}${notice("الحقول والبنود والأرصدة التالية توضيحية. اعتماد المصروف لا يخصم أي مبلغ.")}
    <div class="stack">${paymentPanel()}${paidReviewPanel()}${paidReviewList()}<div class="layout-grid"><section class="panel"><div class="panel-header"><div><h2>سجل المصروفات</h2><p>تجربة مراحل الطلب والاعتماد والصرف</p></div><span class="tag">بيانات وهمية</span></div>${expenseRows()}<div class="panel-foot">يمكن للمدير أو المحاسب اعتماد مصروف سجّله بنفسه في هذا التصور.</div></section>
      <section class="panel"><div class="panel-header"><div><h2>مصروف تجريبي جديد</h2><p>تسجيل الطلب لا يعني الدفع</p></div>${svg("receipt")}</div><form data-form="expense" class="panel-body"><div class="form-grid"><div class="field wide"><label for="expense-branch">الفرع *</label><select id="expense-branch" name="branchId">${branchOptions(e.branchId)}</select></div><div class="field wide"><label for="expense-category">البند *</label><select id="expense-category" name="categoryId">${categoryOptions(e.categoryId)}</select></div><div class="field"><label for="expense-amount">المبلغ (ج.م) *</label><input id="expense-amount" name="amount" dir="ltr" inputmode="decimal" value="${esc(e.amount)}" placeholder="0.00"></div><div class="field"><label for="expense-date">التاريخ *</label><input id="expense-date" name="date" type="date" value="${esc(e.date)}"></div><div class="field wide"><label for="expense-description">وصف توضيحي *</label><textarea id="expense-description" name="description" maxlength="180" placeholder="اكتب وصفًا تجريبيًا فقط">${esc(e.description)}</textarea></div><div class="field wide"><label for="expense-beneficiary">المستفيد (اختياري)</label><input id="expense-beneficiary" name="beneficiary" maxlength="120" value="${esc(e.beneficiary)}" placeholder="اسم تجريبي"></div><div class="field wide"><label for="expense-document">رقم المستند (اختياري)</label><input id="expense-document" name="documentNumber" maxlength="120" value="${esc(e.documentNumber)}" placeholder="رقم توضيحي"></div><div class="field wide"><label for="expense-tax">قيمة الضريبة من المستند (اختياري)</label><input id="expense-tax" name="taxAmount" dir="ltr" inputmode="decimal" value="${esc(e.taxAmount)}" placeholder="غير محددة"><p class="field-hint">لا تُحسب تلقائيًا ولا تعني الخانة الفارغة ضريبة صفر.</p></div><div class="field wide"><span class="field-label">المرفق (اختياري)</span><p class="field-hint">ملف واحد JPG أو PNG أو PDF حتى 5 ميجابايت. رفع الملفات غير مفعّل في المعاينة.</p></div></div><div class="form-actions"><button type="submit" class="btn wide">مراجعة المصروف</button></div></form></section></div></div>`;
}
function transferPanel() {
  if (!manager()) return "";
  const d = ui.transfer, from = state.accounts.find((a) => a.id === d.fromId);
  const destinations = from ? state.accounts.filter((a) => a.branchId === from.branchId && a.kind !== from.kind) : [];
  return `<section class="panel"><div class="panel-header"><div><h2>تسجيل تسليم نقدي</h2><p>بين خزنة وعهدة في الفرع نفسه</p></div>${svg("arrows")}</div><form class="panel-body" data-form="transfer"><div class="form-grid"><div class="field wide"><label for="transfer-from">من حساب *</label><select id="transfer-from" name="fromId">${accountOptions(state.accounts, d.fromId)}</select></div><div class="field wide"><label for="transfer-to">إلى حساب *</label><select id="transfer-to" name="toId">${accountOptions(destinations, d.toId)}</select></div><div class="field wide"><label for="transfer-amount">المبلغ (ج.م) *</label><input id="transfer-amount" name="amount" dir="ltr" inputmode="decimal" value="${esc(d.amount)}" placeholder="0.00"></div><label class="check wide"><input type="checkbox" name="actuallyTransferred"${check(d.actuallyTransferred)}><span><strong>أؤكد حدوث التسليم الفعلي في المثال</strong><small>التسليم لا ينشئ نقدًا أو إيرادًا جديدًا.</small></span></label></div><div class="form-actions"><button type="submit" class="btn wide">مراجعة التسليم</button></div></form></section>`;
}
function accountsScreen() {
  const accounts = visibleAccounts(state);
  const negative = accounts.filter((a) => balanceOf(state, a.id) < 0n).length;
  const title = manager() ? "الخزائن والعهد النقدية" : "عهدتي النقدية";
  return `${heading(title, manager() ? "تابع أرصدة الفروع والعهد وسجّل التسليم بعد حدوثه فعليًا." : "رصيد عهدتك وحركاتك في الفرع التجريبي.")}${negative ? notice(`يوجد ${negative} رصيد سالب في الحسابات المعروضة. هذا فرق يحتاج مراجعة، لا نقد مادي سالب.`, "warning") : notice("الأرصدة هنا افتتاحيات خيالية؛ الرصيد الحقيقي يُدخل بعد الجرد عند التفعيل مستقبلًا.")}
    <div class="layout-grid"><div class="stack"><section class="panel"><div class="panel-header"><div><h2>${manager() ? "حسابات النقد" : "عهدتي"}</h2><p>كل رصيد يمثل مكان النقد الفعلي</p></div><span class="tag blue">${accounts.length} حساب تجريبي</span></div>${accountRows(accounts)}</section><section class="panel"><div class="panel-header"><div><h2>حركات النقد الأخيرة</h2><p>حركات أُضيفت في هذه التجربة فقط</p></div></div>${history()}</section></div>${manager() ? transferPanel() : `<aside class="panel"><div class="panel-header"><h2>تسليم العهدة</h2></div><div class="panel-body"><p class="callout">يسجّل المدير أو المحاسب التسليم في خطوة واحدة بعد استلام النقد فعليًا. يمكن للموظف متابعة أثر الحركة على عهدته.</p></div></aside>`}</div>`;
}
function collectionScreen() {
  const d = ui.collection, accounts = selectableCashAccounts(state, d.branchId);
  const availableBranches = state.role === "staff" ? BRANCHES.filter((b) => b.id === state.staffBranch) : BRANCHES;
  const rows = state.collections.filter((x) => manager() || (x.branchId === state.staffBranch && x.actor === "staff")).slice(0, 5);
  return `${heading("تحصيل تجريبي", "مثال مستقل لتوضيح أين يظهر النقد بعد التحصيل.")}${notice("هذا المثال لا يُنشئ فاتورة ولا يتحقق من مستحق العميل، ولا يتصل بالمبيعات الفعلية أو ينقل أموالًا.", "warning")}
    <div class="layout-grid"><section class="panel"><div class="panel-header"><div><h2>توضيح مكان النقد</h2><p>اختر الحساب الذي استلم المال فعليًا</p></div><span class="tag blue">محاكاة فقط</span></div><form data-form="collection" class="panel-body"><div class="form-grid"><div class="field"><label for="collection-branch">الفرع *</label><select id="collection-branch" name="branchId">${availableBranches.map((b) => `<option value="${esc(b.id)}"${chosen(d.branchId, b.id)}>${esc(b.name)}</option>`).join("")}</select></div><div class="field"><label for="collection-method">وسيلة التحصيل *</label><select id="collection-method" name="method">${methodOptions(d.method)}</select></div><div class="field"><label for="collection-amount">المبلغ (ج.م) *</label><input id="collection-amount" name="amount" dir="ltr" inputmode="decimal" value="${esc(d.amount)}" placeholder="0.00"></div>${d.method === "CASH" ? `<div class="field"><label for="collection-account">مكان النقد الفعلي *</label><select id="collection-account" name="accountId">${accountOptions(accounts, d.accountId)}</select><p class="field-hint">اختر الحساب الذي يحتفظ بالمبلغ، لا الاثنين.</p></div>` : `<div class="field"><span class="field-label">الأثر على النقد</span><p class="field-hint">الوسيلة غير النقدية لا تزيد أرصدة الخزائن أو العهد.</p></div>`}<label class="check wide"><input type="checkbox" name="actuallyReceived"${check(d.actuallyReceived)}><span><strong>أؤكد استلام المبلغ في هذا المثال</strong><small>لن يحفظ هذا النموذج أي حركة حقيقية.</small></span></label></div><div class="form-actions"><button type="submit" class="btn">مراجعة التحصيل التجريبي</button></div></form></section>
      <aside class="stack"><section class="panel"><div class="panel-header"><div><h2>فكرة الربط</h2></div></div><div class="panel-body"><div class="steps"><div class="step"><span class="step-number">1</span><div><strong>حدّد مكان النقد</strong><p>الخزنة أو عهدة المستلم الفعلي.</p></div></div><div class="step"><span class="step-number">2</span><div><strong>تُضاف مرة واحدة</strong><p>لا يتضاعف المبلغ بين الفاتورة والعهدة.</p></div></div><div class="step"><span class="step-number">3</span><div><strong>سجّل التسليم لاحقًا</strong><p>ينتقل النقد بين الحسابين دون زيادة الإجمالي.</p></div></div></div></div></section><section class="panel"><div class="panel-header"><div><h2>تحصيلات المثال</h2><p>للتوضيح فقط، وليست فواتير</p></div></div>${rows.length ? rows.map((row) => `<div class="history-row"><span><strong>${esc(methodName(row.method))}</strong><small>${esc(row.accountId ? accountName(state, row.accountId) : "لا يؤثر على النقد")}</small></span><b>${money(row.amountCents)}</b></div>`).join("") : '<div class="empty">لم تضف تحصيلًا تجريبيًا بعد.</div>'}</section></aside></div>`;
}
function reviewValue(key, value) {
  return ["المبلغ", "المبلغ الإجمالي", "تاريخ المصروف", "تاريخ الدفع الفعلي", "الضريبة المدخلة", "رصيد المصدر بعد الحركة", "الرصيد بعد الصرف"].includes(key)
    ? `<bdi dir="ltr">${esc(value)}</bdi>` : esc(value);
}
function reviewDialog() {
  if (!ui.review) return "";
  const r = ui.review;
  return `<dialog class="dialog" id="review-dialog" aria-labelledby="review-title" aria-describedby="review-caption"><div class="dialog-header"><div><h2 id="review-title">${esc(r.title)}</h2><p id="review-caption">مراجعة تجريبية فقط؛ لن يُحفظ شيء في الموقع الفعلي.</p></div><button type="button" class="icon-button" data-action="cancel-review" aria-label="إغلاق المراجعة">×</button></div><div class="dialog-body"><dl class="review-list">${r.lines.map(([key, value]) => `<div><dt>${esc(key)}</dt><dd>${reviewValue(key, value)}</dd></div>`).join("")}</dl>${r.note ? notice(esc(r.note)) : ""}${r.projected !== null && r.projected < 0n ? `${notice(`سيصبح الرصيد التجريبي <bdi dir="ltr">${esc(formatMoney(r.projected))}</bdi> ج.م؛ هذا فرق يحتاج مراجعة.`, "warning")}<label class="check"><input id="negative-ack" type="checkbox"><span><strong>اطلعت على تنبيه الرصيد السالب</strong><small>يُسمح بالتسجيل بعد إظهار التنبيه وفق الاختيار.</small></span></label>` : ""}${ui.reviewError ? notice(esc(ui.reviewError), "error") : ""}</div><div class="dialog-actions"><button type="button" class="btn secondary" data-action="cancel-review">رجوع للتعديل</button><button type="button" class="btn" data-action="confirm-review">تأكيد تجريبي</button></div></dialog>`;
}
function render() {
  const content = ui.view === "expenses" ? expensesScreen() : ui.view === "accounts" ? accountsScreen() : ui.view === "collection" ? collectionScreen() : overview();
  app.innerHTML = `${header()}${ui.status ? notice(esc(ui.status), "success") : ""}${ui.error ? notice(esc(ui.error), "error") : ""}${content}</main></div></div>${reviewDialog()}`;
  const dialog = document.querySelector("#review-dialog");
  if (dialog) {
    dialog.showModal();
    dialog.addEventListener("cancel", (event) => { event.preventDefault(); ui.review = null; ui.reviewError = ""; render(); });
  }
}
function updateDraft(input) {
  const form = input.closest("form[data-form]");
  const draft = form?.dataset.form === "payment" ? ui.payment : form ? ui[form.dataset.form] : null;
  if (!draft || !input.name || !(input.name in draft)) return;
  draft[input.name] = input.type === "checkbox" ? input.checked : input.value;
}
app.addEventListener("input", (event) => { if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) updateDraft(event.target); });
app.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) return;
  if (target.dataset.control === "role") {
    state = setRole(state, target.value); ui.error = ""; ui.status = ""; ui.review = null; ui.payment = null; ui.paidReview = null;
    if (!manager() && ui.view === "expenses") ui.view = "overview";
    ui.collection.branchId = "branch-a"; ui.collection.accountId = "";
    render(); document.querySelector("#demo-role")?.focus(); return;
  }
  updateDraft(target);
  const form = target.closest("form[data-form]");
  if (!form || (target.tagName !== "SELECT" && !(form.dataset.form === "payment" && target.name === "paymentDate"))) return;
  if (form.dataset.form === "transfer" && target.name === "fromId") ui.transfer.toId = "";
  if (form.dataset.form === "collection" && (target.name === "method" || target.name === "branchId")) ui.collection.accountId = "";
  if (form.dataset.form === "payment") {
    if (target.name === "method") ui.payment.accountId = "";
    if (["method", "accountId", "paymentDate"].includes(target.name)) ui.payment.openingOrder = "";
    if (["method", "accountId", "paymentDate", "openingOrder"].includes(target.name)) ui.payment.includedInOpening = false;
  }
  ui.error = ""; render();
  document.querySelector(`form[data-form="${form.dataset.form}"] [name="${target.name}"]`)?.focus();
});
function setReview(kind, input, title, lines, projected = null, note = "") { ui.error = ""; ui.status = ""; ui.reviewError = ""; ui.review = { kind, input: structuredClone(input), title, lines, projected, note }; render(); }
app.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || !form.dataset.form) return;
  event.preventDefault();
  try {
    if (form.dataset.form === "expense") {
      const v = inspectExpense(state, ui.expense);
      const lines = [["الفرع", branchName(v.branchId)], ["البند", categoryName(v.categoryId)], ["الوصف", v.description], ["المبلغ الإجمالي", `${formatMoney(v.amountCents)} ج.م`], ["تاريخ المصروف", v.date], ["الضريبة المدخلة", v.taxCents === null ? "غير محددة" : `${formatMoney(v.taxCents)} ج.م`]];
      if (v.beneficiary) lines.push(["المستفيد", v.beneficiary]);
      if (v.documentNumber) lines.push(["رقم المستند", v.documentNumber]);
      setReview("expense", ui.expense, "مراجعة المصروف", lines, null, "سيُسجل طلبًا بانتظار الاعتماد، دون دفع أو خصم نقدي. الضريبة إن أُدخلت قيمة من المستند فقط.");
    } else if (form.dataset.form === "transfer") {
      const v = inspectTransfer(state, ui.transfer);
      if (!ui.transfer.actuallyTransferred) throw new DemoProblem("أكد حدوث التسليم الفعلي في المثال أولًا.");
      setReview("transfer", ui.transfer, "مراجعة التسليم النقدي", [["من", v.from.label], ["إلى", v.to.label], ["الفرع", branchName(v.from.branchId)], ["المبلغ", `${formatMoney(v.amount)} ج.م`], ["رصيد المصدر بعد الحركة", `${formatMoney(v.projected)} ج.م`]], v.projected, "لا يغيّر التحويل إجمالي النقد بين الحسابين.");
    } else if (form.dataset.form === "payment") {
      const v = inspectExpensePayment(state, ui.payment);
      if (!ui.payment.actuallyPaid) throw new DemoProblem("أكد دفع المصروف فعليًا في المثال أولًا.");
      const lines = [["المصروف", v.expense.description], ["الفرع", branchName(v.expense.branchId)], ["المبلغ", `${formatMoney(v.expense.amountCents)} ج.م`], ["تاريخ الدفع الفعلي", v.paymentDate], ["وسيلة الدفع", methodName(ui.payment.method)], ["مصدر النقد", v.account?.label ?? "لا يوجد — وسيلة غير نقدية"]];
      if (v.historical) lines.push(["أثر النقد", "دفعة تاريخية قبل الجرد؛ لا خصم جديد"]);
      else if (v.projected !== null) lines.push(["الرصيد بعد الصرف", `${formatMoney(v.projected)} ج.م`]);
      setReview("payment", ui.payment, "مراجعة الصرف الفعلي", lines, v.projected, v.historical ? "الدفع السابق للجرد انعكس في الرصيد الافتتاحي، لذلك لا يُخصم مجددًا." : "هذا تسجيل لدفعة تمت بالفعل؛ لا ينفذ النظام تحويلًا.");
    } else if (form.dataset.form === "paidReview") {
      const v = inspectPaidExpenseReview(state, ui.paidReview);
      setReview("paidReview", ui.paidReview, "تأكيد طلب المراجعة اليدوية", [["المصروف", v.expense.description], ["المبلغ المسجّل", `${formatMoney(v.expense.amountCents)} ج.م`], ["المبلغ المقترح", v.proposedAmountCents === null ? "غير محدد" : `${formatMoney(v.proposedAmountCents)} ج.م`], ["سبب المراجعة", v.reason]], null, "يبقى المصروف والرصيد كما هما؛ لا يُسجّل استرداد أو دفع جديد، والتسوية تحتاج مراجعة لاحقة.");
    } else if (form.dataset.form === "collection") {
      const v = inspectCollection(state, ui.collection);
      if (!ui.collection.actuallyReceived) throw new DemoProblem("أكد استلام المبلغ في المثال أولًا.");
      setReview("collection", ui.collection, "مراجعة التحصيل التجريبي", [["الفرع", branchName(ui.collection.branchId)], ["المبلغ", `${formatMoney(v.amount)} ج.م`], ["الوسيلة", methodName(ui.collection.method)], ["مكان النقد", v.account?.label ?? "لا يوجد — وسيلة غير نقدية"]], null, "هذه محاكاة مستقلة، لا تحفظ فاتورة أو تحصيلًا حقيقيًا.");
    }
  } catch (error) { ui.error = error instanceof DemoProblem ? error.message : "تعذر مراجعة البيانات التجريبية."; ui.status = ""; render(); document.querySelector("#content")?.focus(); }
});
app.addEventListener("click", (event) => {
  const button = event.target instanceof Element ? event.target.closest("button[data-action]") : null;
  if (!button) return;
  const action = button.dataset.action;
  if (action === "navigate") { ui.view = button.dataset.view; ui.error = ""; ui.status = ""; ui.payment = null; ui.paidReview = null; render(); document.querySelector("#content")?.focus(); return; }
  if (action === "pay") {
    if (!manager()) return;
    ui.paidReview = null; ui.payment = { expenseId: button.dataset.id, method: "CASH", accountId: "", paymentDate: todayInCairo(), openingOrder: "", includedInOpening: false, actuallyPaid: false }; ui.error = ""; ui.status = ""; render(); document.querySelector("#payment-title")?.scrollIntoView({ behavior: "smooth", block: "start" }); return;
  }
  if (action === "close-payment") { ui.payment = null; ui.error = ""; render(); return; }
  if (action === "paid-review") {
    if (!manager()) return;
    ui.payment = null; ui.paidReview = { expenseId: button.dataset.id, reason: "", proposedAmount: "" }; ui.error = ""; ui.status = ""; render();
    document.querySelector("#paid-review-title")?.scrollIntoView({ behavior: "smooth", block: "start" }); return;
  }
  if (action === "close-paid-review") { ui.paidReview = null; ui.error = ""; render(); return; }
  if (action === "approve") {
    const item = state.expenses.find((e) => e.id === button.dataset.id);
    if (!item) return;
    setReview("approve", { id: item.id }, "مراجعة اعتماد المصروف", [["الوصف", item.description], ["الفرع", branchName(item.branchId)], ["المبلغ", `${formatMoney(item.amountCents)} ج.م`]], null, "الاعتماد لا يعني دفع المال ولن يؤثر في رصيد النقد."); return;
  }
  if (action === "cancel-review") { ui.review = null; ui.reviewError = ""; render(); return; }
  if (action !== "confirm-review" || !ui.review) return;
  const r = ui.review, negativeAcknowledged = document.querySelector("#negative-ack")?.checked === true;
  try {
    if (r.kind === "expense") { state = createExpense(state, r.input); ui.expense.amount = ""; ui.expense.description = ""; ui.expense.beneficiary = ""; ui.expense.documentNumber = ""; ui.expense.taxAmount = ""; ui.status = "سُجّل المصروف التجريبي بانتظار الاعتماد؛ لم يُدفع شيء."; }
    else if (r.kind === "approve") { state = approveExpense(state, r.input.id); ui.status = "تم اعتماد المصروف التجريبي؛ لم يُسجّل الصرف بعد."; }
    else if (r.kind === "transfer") { state = recordTransfer(state, { ...r.input, negativeAcknowledged }); ui.transfer = { fromId: "", toId: "", amount: "", actuallyTransferred: false }; ui.status = "سُجّل التسليم التجريبي بين الحسابين دون تغيير إجمالي النقد."; }
    else if (r.kind === "payment") { const historical = inspectExpensePayment(state, r.input).historical; state = payExpense(state, { ...r.input, negativeAcknowledged }); ui.payment = null; ui.status = historical ? "سُجّلت الدفعة التجريبية تاريخيًا دون خصم نقدي جديد." : "سُجّل الصرف التجريبي بعد تأكيد الدفع؛ لم يُجر أي تحويل حقيقي."; }
    else if (r.kind === "collection") { state = recordCollection(state, r.input); ui.collection = { branchId: r.input.branchId, method: "CASH", accountId: "", amount: "", actuallyReceived: false }; ui.status = "سُجّل التحصيل في المحاكاة فقط؛ لم تُنشأ فاتورة أو حركة حقيقية."; }
    else if (r.kind === "paidReview") { state = requestPaidExpenseReview(state, r.input); ui.paidReview = null; ui.status = "أُحيل المصروف التجريبي للمراجعة اليدوية؛ لم تتغير بياناته أو أرصدته."; }
    ui.review = null; ui.reviewError = ""; ui.error = ""; render(); document.querySelector("#content")?.focus();
  } catch (error) { ui.reviewError = error instanceof DemoProblem ? error.message : "تعذر تأكيد المثال."; render(); }
});
render();
