/**
 * ============================================================
 *  لوحة القيادة — صفحة المعاينة
 *
 *  تعرض نموذجًا افتراضيًا من model.mjs فقط: لا تفتح صفحات، ولا تقرأ
 *  قاعدة بيانات، ولا تتصل بالشبكة.
 * ============================================================
 */
import { ROLE_IDS, buildDashboard, counted, formatMoney, formatInt } from "./model.mjs";
import { icon, toast, mountChrome, preview, onPreviewChange } from "./ui.mjs";

const refs = {
  pageHead: document.getElementById("page-head"),
  focus: document.getElementById("focus-slot"),
  money: document.getElementById("money-slot"),
  chart: document.getElementById("chart-slot"),
  tiles: document.getElementById("tiles-slot"),
  table: document.getElementById("table-slot"),
  shortcuts: document.getElementById("shortcuts-slot"),
  footNote: document.getElementById("foot-note"),
};

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

function statStrip(view) {
  return `<div class="stat-strip">${view.tiles
    .map((tile) => `<div class="stat"><small>${tile.label}</small><b class="num">${tile.value}${tile.unit ? `<span>${tile.unit}</span>` : ""}</b>${tile.hint ? `<span>${tile.hint}</span>` : ""}</div>`)
    .join("")}</div>`;
}

function tableCard(view) {
  const table = view.table;
  const head = table.columns.map((column) => `<th scope="col">${column}</th>`).join("");
  const body = table.rows
    .map((row) => `<tr>${row
      .map((cell, index) => {
        if (cell === "نقدًا" || cell === "آجل") {
          return `<td><span class="tag${cell === "آجل" ? " is-amber" : ""}"><i></i>${cell}</span></td>`;
        }
        const isNumber = /^[\d,]+\.\d{2}$/.test(cell);
        return `<td class="${index === 0 ? "strong" : ""}">${isNumber ? `<span class="num">${cell}</span>` : cell}</td>`;
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
    <div class="card__foot"><span>${table.footer}</span><span>الإجمالي <b class="num">${table.footerTotal}</b> ج.م</span></div>
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
  const view = buildDashboard({ role: preview.role, branchId: preview.branchId });

  refs.pageHead.innerHTML = `<div>
      <h1>${view.heading.greeting}</h1>
      <p class="page-subtitle">${view.heading.subtitle}</p>
    </div>
    <div class="head-actions">
      <span class="chip-scope">${view.heading.eyebrow} · ${view.scope.label}</span>
      <button type="button" class="btn btn--secondary btn--sm" data-refresh="1">${icon("refresh")} تحديث</button>
    </div>`;

  refs.focus.innerHTML = focusCard(view);
  refs.money.innerHTML = moneyCard(view);
  refs.chart.innerHTML = chartCard(view);
  refs.tiles.innerHTML = statStrip(view);
  refs.table.innerHTML = tableCard(view);
  refs.shortcuts.innerHTML = shortcutsCard(view);

  refs.footNote.innerHTML = `<span>الحساب: <strong>${view.role.label}</strong></span><span class="dot"></span><span dir="ltr">${view.role.email}</span><span class="dot"></span><span>الأرقام افتراضية — المعاينة لا تقرأ قاعدة البيانات</span><span class="dot"></span><span>الشريط الجانبي يُطوى، والقائمة تصير أدراجًا تحت ٩٨٠px</span>`;
}

function mount() {
  const requested = new URLSearchParams(globalThis.location?.search ?? "").get("role");
  if (ROLE_IDS.includes(requested)) preview.role = requested;

  mountChrome({ active: "dashboard", title: "لوحة القيادة", breadcrumb: ["صلة تون", "لوحة القيادة"] });
  onPreviewChange(render);
  render();

  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-refresh]")) {
      event.preventDefault();
      toast("الأرقام ثابتة في المعاينة — لا يوجد تحديث فعلي من قاعدة البيانات.");
    }
  });
}

mount();
