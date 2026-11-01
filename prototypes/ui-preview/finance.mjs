/**
 * ============================================================
 *  المالية — صفحة المعاينة
 *
 *  أربعة تبويبات: الخزنة والعهدة، التسويات، المصروفات، الجرد.
 *  كل ما فيها من model.mjs: لا تفتح صفحات، ولا تقرأ قاعدة بيانات،
 *  ولا تتصل بالشبكة. الأعداد هنا هي نفسها أعداد لوحة القيادة.
 * ============================================================
 */
import {
  ACCOUNTS,
  EXPENSES,
  COUNTS,
  FILTERS,
  FINANCE_COLUMNS,
  SETTLEMENT_ROWS,
  accountsTotals,
  countsTotals,
  expensesTotals,
  financeStats,
  financeTabs,
  formatMoney,
  formatInt,
  counted,
  settlementTable,
  settlementTotals,
  sum,
} from "./model.mjs";
import { icon, toast, mountChrome, preview, onPreviewChange } from "./ui.mjs";

const root = document.getElementById("finance");
const state = { tab: "settlements" };

/** ---------------- القطع ---------------- */

function money(cents) {
  return cents == null ? "—" : `<span class="num">${formatMoney(cents)}</span>`;
}

function tag(label, tone) {
  return `<span class="tag ${tone}"><i></i>${label}</span>`;
}

function diffTag(diff) {
  if (diff == null) return "—";
  if (diff === 0) return tag(`<span class="num">0.00</span>`, "is-gray");
  const tone = diff < 0 ? "is-red" : "is-teal";
  return tag(`<span class="num">${diff < 0 ? "−" : "+"}${formatMoney(Math.abs(diff))}</span>`, tone);
}

function toolbar(statusOptions) {
  const options = (list) => list.map((option) => `<option value="${option.id}">${option.label}</option>`).join("");
  return `<div class="toolbar" style="margin:-9px -12px 9px;border-radius:var(--radius) var(--radius) 0 0">
    <div class="field"><label for="f-branch">الفرع</label><select id="f-branch">${options(FILTERS.branch)}</select></div>
    <div class="field"><label for="f-status">الحالة</label><select id="f-status">${options(statusOptions)}</select></div>
    <div class="field"><label for="f-period">الفترة</label><select id="f-period">${options(FILTERS.period)}</select></div>
    <div class="field"><label for="f-q">بحث</label><input id="f-q" type="search" placeholder="رقم أو اسم"></div>
    <div class="head-actions" style="margin-inline-start:auto">
      <button type="button" class="btn btn--sm" data-href="/filter">${icon("filter")} تصفية</button>
      <button type="button" class="btn btn--sm btn--ghost" data-href="/reset">إلغاء</button>
    </div>
  </div>`;
}

function tableCard(tabId, rows, footLeft, footRight) {
  const head = FINANCE_COLUMNS[tabId].map((column) => `<th scope="col">${column}</th>`).join("");
  return `<div class="table-wrap" role="region" aria-label="جدول ${tabId}" tabindex="0">
      <table class="table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>
    </div>
    <div class="card__foot" style="margin:0 -12px -12px;border-radius:0 0 var(--radius) var(--radius)">
      <span>${footLeft}</span><span>${footRight}</span>
    </div>`;
}

function accountsTable() {
  const rows = ACCOUNTS.map(
    (row) => `<tr>
      <td class="strong">${row.name}</td>
      <td>${tag(row.kind, row.kind === "خزنة" ? "is-blue" : "is-copper")}</td>
      <td>${row.branch}</td>
      <td>${money(row.balance)}</td>
      <td>${money(row.expected)}</td>
      <td>${row.lastMove}</td>
      <td>${tag(row.status, row.tone)}</td>
      <td><div class="row-actions"><button type="button" class="btn btn--sm btn--ghost btn--icon" data-href="/accounts/${row.id}" aria-label="إجراءات ${row.name}">${icon("dots")}</button></div></td>
    </tr>`,
  ).join("");
  const totals = accountsTotals();
  return tableCard(
    "accounts",
    rows,
    `${counted(totals.open, "عهدة قائمة", "عهد قائمة")} · ${counted(totals.closed, "عهدة مقفلة", "عهد مقفلة")} · ${counted(totals.stale, "عهدة", "عهد")} بلا جرد أسبوعًا`,
    `النقد تحت الإدارة <b class="num">${formatMoney(totals.total)}</b> ج.م`,
  );
}

function settlementsTable() {
  const rows = SETTLEMENT_ROWS.map((row) => `<tr>
      <td class="strong num">${row.id}</td>
      <td class="wrap">${row.employee}</td>
      <td>${row.branch}</td>
      <td>${money(row.counted)}</td>
      <td>${money(row.expected)}</td>
      <td>${diffTag(settlementTable.diff(row))}</td>
      <td>${tag(row.status, `is-${row.tone === "teal" ? "teal" : row.tone === "blue" ? "blue" : row.tone === "red" ? "red" : row.tone === "gray" ? "gray" : "amber"}`)}</td>
      <td><div class="row-actions"><button type="button" class="btn btn--sm btn--ghost btn--icon" data-href="/settlements/${row.id}" aria-label="إجراءات ${row.id}">${icon("dots")}</button></div></td>
    </tr>`).join("");
  const totals = settlementTotals();
  return tableCard(
    "settlements",
    rows,
    `${counted(totals.rows, "طلب", "طلبات")} · المعدود في المعلّقة <b class="num">${formatMoney(totals.counted)}</b> ج.م`,
    `المتوقَّع <b class="num">${formatMoney(totals.openValue)}</b> ج.م`,
  );
}

function expensesTable() {
  const rows = EXPENSES.map((row) => `<tr>
      <td class="strong num">${row.id}</td>
      <td><span class="num">${row.date}</span></td>
      <td>${row.category}</td>
      <td class="wrap">${row.beneficiary}</td>
      <td>${row.branch}</td>
      <td>${money(row.amount)}</td>
      <td>${tag(row.status, row.tone)}</td>
      <td><div class="row-actions"><button type="button" class="btn btn--sm btn--ghost btn--icon" data-href="/expenses/${row.id}" aria-label="إجراءات ${row.id}">${icon("dots")}</button></div></td>
    </tr>`).join("");
  const totals = expensesTotals();
  return tableCard(
    "expenses",
    rows,
    `${counted(totals.count, "مصروفًا", "مصروفات")} · مدفوع <b class="num">${formatMoney(sum(totals.paid.map((row) => row.amount)))}</b> ج.م`,
    `الإجمالي <b class="num">${formatMoney(totals.total)}</b> ج.م`,
  );
}

function countsTable() {
  const rows = COUNTS.map((row) => `<tr>
      <td class="strong num">${row.id}</td>
      <td><span class="num">${row.date}</span></td>
      <td class="wrap">${row.employee}</td>
      <td>${row.branch}</td>
      <td>${money(row.expected)}</td>
      <td>${money(row.counted)}</td>
      <td>${diffTag(row.counted == null ? null : row.counted - row.expected)}</td>
      <td>${tag(row.status, row.tone)}</td>
    </tr>`).join("");
  const totals = countsTotals();
  return tableCard(
    "counts",
    rows,
    `${counted(totals.total, "جردًا", "جردات")} · مفتوح ${formatInt(totals.open)} · ملغى ${formatInt(totals.cancelled)}`,
    `عجز الجرد <b class="num">${formatMoney(totals.shortage)}</b> ج.م`,
  );
}

const STATUS_OPTIONS = {
  accounts: [{ id: "", label: "كل الحسابات" }, { id: "vault", label: "خزن" }, { id: "custody", label: "عهد" }, { id: "closed", label: "مقفلة" }],
  settlements: FILTERS.status,
  expenses: [{ id: "", label: "كل الحالات" }, { id: "pending", label: "بانتظار الاعتماد" }, { id: "approved", label: "معتمد بانتظار الصرف" }, { id: "paid", label: "مدفوع" }, { id: "rejected", label: "مرفوض" }],
  counts: [{ id: "", label: "كل الجرد" }, { id: "open", label: "مفتوح" }, { id: "confirmed", label: "مؤكَّد" }, { id: "shortage", label: "فيه عجز" }],
};

const TABLES = { accounts: accountsTable, settlements: settlementsTable, expenses: expensesTable, counts: countsTable };

const TAB_NOTES = {
  accounts: "العهدة المقفلة تبقى ظاهرة بسجلها: لا حذف في النظام، والإقفال لا يصنع حركة مال.",
  settlements: "الفرق = المعدود − المتوقَّع. سالبه عجز حقيقي، وموجبه زيادة — لا حصيلة الفترة.",
  expenses: "الاعتماد ليس صرفًا: المصروف المعتمد يبقى التزامًا حتى يُسجَّل صرفه.",
  counts: "الجرد المفتوح يعني أن الموظف عدّ ولم يطلب التسوية بعد.",
};

/** ---------------- الرسم ---------------- */

function render() {
  const tabs = financeTabs();
  const active = tabs.find((tab) => tab.id === state.tab) ?? tabs[0];
  const stats = financeStats(active.id);

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>المالية</h1>
        <p class="page-subtitle">الخزنة والعهد والتسويات والمصروفات في شاشة واحدة.</p>
      </div>
      <div class="head-actions">
        <button type="button" class="btn" data-href="/finance/counts/new">${icon("plus")} جرد جديد</button>
        <button type="button" class="btn btn--secondary" data-href="/finance/expenses/new">مصروف جديد</button>
      </div>
    </div>

    <div class="tabs" role="tablist" aria-label="أقسام المالية">
      ${tabs
        .map(
          (tab) => `<button type="button" class="tab${tab.id === active.id ? " is-active" : ""}" role="tab"
              aria-selected="${tab.id === active.id}" data-tab="${tab.id}">
              ${tab.label}${tab.badge > 0 ? `<span class="count num">${tab.badge}</span>` : ""}
            </button>`,
        )
        .join("")}
    </div>

    <div class="stat-strip">${stats
      .map((stat) => `<div class="stat"><small>${stat.label}</small><b class="num">${stat.value}${stat.unit ? `<span>${stat.unit}</span>` : ""}</b>${stat.hint ? `<span>${stat.hint}</span>` : ""}</div>`)
      .join("")}</div>

    <section class="card" aria-label="${active.label}">
      ${toolbar(STATUS_OPTIONS[active.id] ?? FILTERS.status)}
      ${TABLES[active.id]()}
    </section>

    <p class="pattern-note">${TAB_NOTES[active.id]}</p>`;

  root.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.tab = button.dataset.tab;
      render();
    });
  });
}

function mount() {
  const requested = new URLSearchParams(globalThis.location?.search ?? "").get("role");
  if (["MANAGER", "ACCOUNTANT", "CS_AGENT"].includes(requested)) preview.role = requested;

  mountChrome({ active: "settlements", title: "المالية", breadcrumb: ["صلة تون", "المالية", "التسويات"] });
  onPreviewChange(render);
  render();
}

mount();
