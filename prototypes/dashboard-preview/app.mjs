/**
 * ============================================================
 *  معاينة لوحة القيادة — العرض
 *
 *  تعرض هذه الواجهة نموذجًا افتراضيًا من model.mjs فقط: لا تفتح
 *  صفحات، ولا تقرأ قاعدة بيانات، ولا تتصل بالشبكة. كل نقرة على
 *  رابط تُظهر تنبيهًا يذكّر أن المعاينة للتصميم لا للتنفيذ.
 * ============================================================
 */
import { ROLES, ROLE_IDS, buildDashboard, counted, formatMoney, formatInt } from "./model.mjs";

/** أيقونات بسيطة بخطوط (stroke) — لا صور ولا مكتبات خارجية. */
const ICONS = {
  dashboard: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z"/><path d="M9 8h6"/><path d="M9 12h6"/>',
  sales: '<path d="M4 5h2l2.2 9.4a2 2 0 0 0 2 1.6h7.4a2 2 0 0 0 2-1.6L21 8H7"/><circle cx="10.5" cy="20" r="1.3"/><circle cx="18" cy="20" r="1.3"/>',
  cash: '<path d="M3 7c0-1.66 4.03-3 9-3s9 1.34 9 3-4.03 3-9 3-9-1.34-9-3z"/><path d="M3 7v5c0 1.66 4.03 3 9 3s9-1.34 9-3V7"/><path d="M3 12v5c0 1.66 4.03 3 9 3s9-1.34 9-3v-5"/>',
  settlement: '<path d="M12 3v18"/><path d="M5 8l7-5 7 5"/><path d="M5 8h14"/><path d="M8.5 8 5.5 14h6L8.5 8z"/><path d="M15.5 8l-3 6h6l-3-6z"/>',
  expenses: '<path d="M14 5l6 6-6 6"/><path d="M20 11H4"/>',
  branch: '<path d="M4 21V6l8-3 8 3v15"/><path d="M9 21v-6h6v6"/>',
  warehouse: '<path d="M3 8l9-5 9 5v8l-9 5-9-5V8z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/>',
  products: '<path d="M20.6 12.6 12 21.2 3.4 12.6V3.4h9.2z"/><circle cx="8.4" cy="8.4" r="1.5"/>',
  stockValue: '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>',
  calendar: '<rect x="3.5" y="5.5" width="17" height="15" rx="2"/><path d="M3.5 10.5h17"/><path d="M8.5 3.5v4"/><path d="M15.5 3.5v4"/>',
  arrow: '<path d="M14 6l-6 6 6 6"/>',
  alert: '<path d="M12 3l9 16H3l9-16z"/><path d="M12 9v5"/><path d="M12 17h.01"/>',
  check: '<path d="M4.5 12.5l5 5L20 7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
  refresh: '<path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1"/><path d="M20.5 4v5h-5"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  lock: '<path d="M6.5 11V8a5.5 5.5 0 0 1 11 0v3"/><rect x="4.5" y="11" width="15" height="10" rx="2"/>',
};

function icon(name, className = "") {
  const body = ICONS[name] ?? ICONS.dashboard;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="${className}" aria-hidden="true">${body}</svg>`;
}

const state = { role: "MANAGER", branchId: null };

const refs = {
  eyebrow: document.getElementById("eyebrow"),
  greeting: document.getElementById("greeting"),
  subtitle: document.getElementById("subtitle"),
  headActions: document.getElementById("head-actions"),
  focus: document.getElementById("focus-slot"),
  money: document.getElementById("money-slot"),
  chart: document.getElementById("chart-slot"),
  tiles: document.getElementById("tiles-slot"),
  table: document.getElementById("table-slot"),
  shortcuts: document.getElementById("shortcuts-slot"),
  footNote: document.getElementById("foot-note"),
  roleSelect: document.getElementById("role-select"),
  branchSelect: document.getElementById("branch-select"),
  branchControl: document.getElementById("branch-control"),
  avatar: document.getElementById("user-avatar"),
  userName: document.getElementById("user-name"),
  userRole: document.getElementById("user-role"),
  toast: document.getElementById("toast"),
  toastText: document.getElementById("toast-text"),
};

let toastTimer = null;
function toast(message) {
  refs.toastText.textContent = message;
  refs.toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => refs.toast.classList.remove("is-visible"), 2600);
}

/** ---------------- القطع ---------------- */

function focusCard(view) {
  const rows = view.focus.items
    .map((item) => {
      const spread = item.spread.length > 1
        ? `<small>${item.spread.map((entry) => `${entry.name} ${formatInt(entry.count)}`).join(" · ")}</small>`
        : "";
      const amount = item.amount == null
        ? ""
        : `<span class="focus-row__amount"><b class="num">${formatMoney(item.amount)}</b><small>ج.م</small></span>`;
      return `<a class="focus-row" href="#" data-href="${item.href}">
        <span class="focus-row__icon is-${item.tone}">${icon(item.icon)}</span>
        <span class="focus-row__text"><strong>${item.text}</strong>${spread}</span>
        ${amount}
        ${icon("arrow", "focus-row__arrow")}
      </a>`;
    })
    .join("");

  const list = view.focus.count === 0
    ? `<div class="focus-empty">
         <span class="focus-empty__icon">${icon("check")}</span>
         <span><strong>لا شيء ينتظرك الآن</strong><small>كل ما تحت يدك مُعتمد ومصروف.</small></span>
       </div>`
    : `<div class="focus__list">${rows}</div>`;

  return `<section class="card focus" aria-labelledby="focus-title">
    <div class="focus__count">
      <p class="focus__label" id="focus-title">${view.focus.label}</p>
      <div class="focus__value"><b class="num">${formatInt(view.focus.count)}</b><span>${view.focus.unit}</span></div>
      <p class="focus__note">${view.focus.note}</p>
    </div>
    ${list}
  </section>`;
}

function moneyCard(view) {
  const sentence = view.money.sentence
    .map((part) => (part.amount == null ? part.text : `<span class="num">${formatMoney(part.amount)}</span>`))
    .join(" ");
  const subs = view.money.subs
    .map((sub) => `<div class="money__sub"><small>${sub.label}</small><b class="num">${sub.value}${sub.unit ? `<span>${sub.unit}</span>` : ""}</b>${sub.hint ? `<span>${sub.hint}</span>` : ""}</div>`)
    .join("");
  return `<section class="card" aria-labelledby="money-title">
    <div class="card__head">
      <div><p class="card__eyebrow">المال الآن</p><h2 class="card__title" id="money-title">${view.money.label}</h2></div>
    </div>
    <div class="card__body">
      <div class="money__value"><b class="num">${formatMoney(view.money.value)}</b><span>${view.money.unit}</span></div>
      <p class="money__sentence">${sentence}</p>
      <p class="money__footnote">${view.money.footnote}</p>
      <div class="money__subs">${subs}</div>
    </div>
  </section>`;
}

function chartCard(view) {
  const chart = view.chart;
  const columns = chart.days
    .map((day) => `<div class="chart-col${day.isToday ? " is-today" : ""}" title="${day.label}: ${day.display} — ${formatInt(day.count)} فاتورة">
        <span class="chart-col__value num">${day.display}</span>
        <span class="chart-col__track"><span class="chart-col__bar" style="--h:${Math.max(day.pct, 5)}%"></span></span>
        <span class="chart-col__day">${day.label}</span>
        <span class="chart-col__count num">${formatInt(day.count)}</span>
      </div>`)
    .join("");
  const label = chart.days.map((day) => `${day.label} ${day.display}`).join("، ");
  return `<section class="card" aria-labelledby="chart-title">
    <div class="card__head">
      <div><p class="card__eyebrow">${chart.subtitle}</p><h2 class="card__title" id="chart-title">${chart.title}</h2></div>
      <div class="chart__total"><b class="num">${chart.totalDisplay}</b><span>ج.م · ${counted(chart.totalCount, "فاتورة", "فواتير")}</span></div>
    </div>
    <div class="card__body">
      <div class="chart" role="img" aria-label="مبيعات آخر سبعة أيام: ${label}">${columns}</div>
      <div class="chart-legend">
        <span><i class="week"></i>أيام الأسبوع</span>
        <span><i class="today"></i>اليوم</span>
        <span>المتوسط اليومي <b class="num">${chart.avgDisplay}</b> ج.م</span>
        <span>${chart.note}</span>
      </div>
    </div>
  </section>`;
}

function tilesSection(view) {
  return `<div class="tiles">${view.tiles
    .map((tile) => `<article class="tile"><small>${tile.label}</small><b class="num">${tile.value}${tile.unit ? `<span>${tile.unit}</span>` : ""}</b>${tile.hint ? `<span class="hint">${tile.hint}</span>` : ""}</article>`)
    .join("")}</div>`;
}

function tableCard(view) {
  const table = view.table;
  const head = table.columns.map((column) => `<th scope="col">${column}</th>`).join("");
  const body = table.rows
    .map((row) => `<tr>${row
      .map((cell, index) => {
        const isNumber = /^[\d,]+\.\d{2}$/.test(cell);
        const cls = index === 0 ? "strong" : "";
        if (cell === "نقدًا" || cell === "آجل") {
          return `<td><span class="tag${cell === "آجل" ? " is-amber" : ""}"><i></i>${cell}</span></td>`;
        }
        return `<td class="${cls}">${isNumber ? `<span class="num">${cell}</span>` : cell}</td>`;
      })
      .join("")}</tr>`)
    .join("");
  return `<section class="card" aria-labelledby="table-title">
    <div class="card__head">
      <div><h2 class="card__title" id="table-title">${table.title}</h2><p class="card__hint">${table.hint}</p></div>
    </div>
    <div class="table-wrap" role="region" aria-label="${table.title}" tabindex="0">
      <table class="table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
    </div>
    <div class="card__foot">${table.footer} · الإجمالي <b class="num">${table.footerTotal}</b> ج.م</div>
  </section>`;
}

function shortcutsCard(view) {
  return `<section class="card" aria-labelledby="shortcuts-title">
    <div class="card__head">
      <div><h2 class="card__title" id="shortcuts-title">وصول سريع</h2><p class="card__hint">أقصر طريق إلى ما تفتحه كل يوم</p></div>
    </div>
    <div class="shortcuts">${view.shortcuts
      .map((item) => `<button type="button" class="shortcut" data-href="${item.href}">
        <span class="shortcut__icon">${icon(item.icon)}</span>
        <span class="shortcut__text"><strong>${item.label}</strong><small>${item.hint}</small></span>
        ${icon("arrow", "shortcut__arrow")}
      </button>`)
      .join("")}</div>
  </section>`;
}

/** ---------------- الرسم ---------------- */

function render() {
  const view = buildDashboard({ role: state.role, branchId: state.branchId });

  refs.eyebrow.textContent = view.heading.eyebrow;
  refs.greeting.textContent = view.heading.greeting;
  refs.subtitle.textContent = view.heading.subtitle;
  refs.avatar.textContent = view.role.initial;
  refs.userName.textContent = view.role.name;
  refs.userRole.textContent = `${view.role.label} · ${view.scope.label}`;

  const primary = view.shortcuts[0];
  refs.headActions.innerHTML = `<button type="button" class="btn" data-href="${primary.href}">${icon("plus")} ${primary.label}</button>
    <button type="button" class="btn btn--ghost" data-refresh="1">${icon("refresh")} تحديث</button>`;

  refs.focus.innerHTML = focusCard(view);
  refs.money.innerHTML = moneyCard(view);
  refs.chart.innerHTML = chartCard(view);
  refs.tiles.innerHTML = tilesSection(view);
  refs.table.innerHTML = tableCard(view);
  refs.shortcuts.innerHTML = shortcutsCard(view);

  refs.footNote.innerHTML = `<span>الحساب: <strong>${view.role.label}</strong></span><span class="dot"></span><span dir="ltr">${view.role.email}</span><span class="dot"></span><span>الأرقام افتراضية — المعاينة لا تقرأ قاعدة البيانات</span>`;

  refs.branchControl.hidden = !view.scope.canFilter;
  refs.branchSelect.innerHTML = view.scope.options
    .map((option) => `<option value="${option.id}"${option.id === (view.branchId ?? "") ? " selected" : ""}>${option.label}</option>`)
    .join("");
}

function mount() {
  // الرابط ?role=ACCOUNTANT يفتح المعاينة على دور بعينه — للتجربة والمشاركة فقط.
  const requested = new URLSearchParams(globalThis.location?.search ?? "").get("role");
  if (ROLE_IDS.includes(requested)) state.role = requested;

  refs.roleSelect.innerHTML = ROLE_IDS.map(
    (id) => `<option value="${id}"${id === state.role ? " selected" : ""}>${ROLES[id].label}</option>`,
  ).join("");

  refs.roleSelect.addEventListener("change", (event) => {
    state.role = event.target.value;
    state.branchId = null;
    render();
  });

  refs.branchSelect.addEventListener("change", (event) => {
    state.branchId = event.target.value || null;
    render();
  });

  document.addEventListener("click", (event) => {
    const refresh = event.target.closest("[data-refresh]");
    if (refresh) {
      event.preventDefault();
      toast("الأرقام ثابتة في المعاينة — لا يوجد تحديث فعلي من قاعدة البيانات.");
      return;
    }
    const link = event.target.closest("[data-href]");
    if (link) {
      event.preventDefault();
      toast(`في التطبيق يفتح هذا الزر: ${link.dataset.href} — المعاينة للتصميم فقط.`);
      return;
    }
    const nav = event.target.closest("[data-route]");
    if (nav) {
      event.preventDefault();
      if (nav.dataset.route === "/dashboard") {
        toast("أنت في لوحة القيادة الآن.");
      } else {
        toast("المعاينة تعرض تصميم لوحة القيادة فقط — بقية الشاشات تُصمَّم بعد اعتمادها.");
      }
    }
  });

  render();
}

mount();
