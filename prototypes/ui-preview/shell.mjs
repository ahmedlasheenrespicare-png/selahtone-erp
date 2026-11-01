/**
 * ============================================================
 *  الهيكل العام والأنماط المشتركة — صفحة المعاينة
 *
 *  تعرض ما تشترك فيه كل الشاشات: رأس الصفحة، والتنبيهات، وشريط
 *  التصفية، وشريط الأرقام الكثيف، والجدول، والأزرار، والحقول،
 *  وحالة الفراغ. الجدول يمثّل شاشة التسويات ببيانات افتراضية.
 * ============================================================
 */
import {
  FILTERS,
  SETTLEMENT_ROWS,
  formatMoney,
  formatInt,
  counted,
  settlementTable,
  settlementTotals,
  shellStats,
} from "./model.mjs";
import { icon, toast, mountChrome, preview, onPreviewChange } from "./ui.mjs";

const patterns = document.getElementById("patterns");

/** ---------------- القطع ---------------- */

function section(title, note, body, plain = false) {
  return `<section class="pattern" aria-label="${title}">
    <div class="pattern__head"><h2>${title}</h2><p>${note}</p></div>
    <div class="pattern__demo${plain ? " is-plain" : ""}">${body}</div>
  </section>`;
}

function pageHeadPattern() {
  return section(
    "رأس الصفحة",
    "عنوان واحد، وسطر واحد يشرحه، ثم الأزرار. العنوان في المحتوى والمسار في الشريط الأعلى.",
    `<div class="page-head">
      <div>
        <h1>التسويات</h1>
        <p class="page-subtitle">طلبات سلّمها الموظفون، وما ينتظر اعتمادك أو تأكيدك.</p>
      </div>
      <div class="head-actions">
        <button type="button" class="btn" data-href="/finance/counts/new">${icon("plus")} جرد جديد</button>
        <button type="button" class="btn btn--secondary" data-href="/export">${icon("download")} تصدير</button>
        <button type="button" class="btn btn--ghost btn--icon" data-href="/settings" aria-label="إعدادات العرض">${icon("settings")}</button>
      </div>
    </div>`,
    true,
  );
}

function alertsPattern() {
  const totals = settlementTotals();
  return section(
    "التنبيهات داخل الصفحة",
    "تنبيه واحد في أعلى الصفحة يشرح ما يمنع الإتمام — لا ركام من التنبيهات.",
    `<div class="pattern" style="gap:8px">
      <div class="alert alert--warning">${icon("alert")}<span><strong>طلب واحد بطل بحركة نقدية بعده.</strong> ألغِه بسبب وأعد الجرد بطلب جديد.</span></div>
      <div class="alert alert--info">${icon("alert")}<span><strong>${counted(totals.open, "طلبًا معلّقًا", "طلبات معلّقة")}</strong> بقيمة ${formatMoney(totals.openValue)} ج.م لم يُسلَّم للخزنة بعد.</span></div>
      <div class="alert alert--danger">${icon("alert")}<span><strong>عجز جرد ${formatMoney(totals.shortage)} ج.م</strong> في طلب ST-1039 — المعدود أقل من المتوقَّع.</span></div>
    </div>`,
  );
}

function toolbarPattern() {
  const options = (list) => list.map((option) => `<option value="${option.id}">${option.label}</option>`).join("");
  return section(
    "شريط التصفية",
    "كل شاشة فيها جدول: بحث، ثم تصفية، ثم إجراء يمينًا. التصفية فوق الجدول لا في رأس الصفحة.",
    `<div class="toolbar" style="margin:-12px -14px 12px;border-radius:11px 11px 0 0">
      <div class="field"><label for="f-branch">الفرع</label><select id="f-branch">${options(FILTERS.branch)}</select></div>
      <div class="field"><label for="f-status">الحالة</label><select id="f-status">${options(FILTERS.status)}</select></div>
      <div class="field"><label for="f-period">الفترة</label><select id="f-period">${options(FILTERS.period)}</select></div>
      <div class="field"><label for="f-q">بحث</label><input id="f-q" type="search" placeholder="رقم الطلب أو الموظف"></div>
      <div class="head-actions" style="margin-inline-start:auto">
        <button type="button" class="btn btn--sm" data-href="/filter">${icon("filter")} تصفية</button>
        <button type="button" class="btn btn--sm btn--ghost" data-href="/reset">إلغاء</button>
      </div>
    </div>
    <p class="pattern-note">الفرز على «المعدود» و«الفرق» من رؤوس الأعمدة، والبحث يعمل أثناء الكتابة.</p>`,
  );
}

function statStripPattern() {
  return section(
    "شريط الأرقام الكثيف",
    "ستة أرقام في سطر واحد: الكثافة المطلوبة بلا تسوية بين الأرقام — الرقم المساند ١٩px والقائد ٤٠px.",
    `<div class="stat-strip">${shellStats()
      .map((stat) => `<div class="stat"><small>${stat.label}</small><b class="num">${stat.value}${stat.unit ? `<span>${stat.unit}</span>` : ""}</b>${stat.hint ? `<span>${stat.hint}</span>` : ""}</div>`)
      .join("")}</div>`,
    true,
  );
}

function tablePattern() {
  const totals = settlementTotals();
  const rows = SETTLEMENT_ROWS.map((row) => {
    const diff = settlementTable.diff(row);
    const diffClass = diff === 0 ? "is-gray" : diff < 0 ? "is-red" : "is-teal";
    const diffText = diff === 0 ? "0.00" : `${diff < 0 ? "−" : "+"}${formatMoney(Math.abs(diff))}`;
    return `<tr>
      <td class="strong num">${row.id}</td>
      <td class="wrap">${row.employee}</td>
      <td>${row.branch}</td>
      <td><span class="num">${formatMoney(row.counted)}</span></td>
      <td><span class="num">${formatMoney(row.expected)}</span></td>
      <td><span class="tag ${diffClass}"><i></i><span class="num">${diffText}</span></span></td>
      <td><span class="tag is-${row.tone}"><i></i>${row.status}</span></td>
      <td><div class="row-actions"><button type="button" class="btn btn--sm btn--ghost btn--icon" data-href="/settlements/${row.id}" aria-label="إجراءات ${row.id}">${icon("dots")}</button></div></td>
    </tr>`;
  }).join("");

  const head = settlementTable.columns.map((column) => `<th scope="col">${column}</th>`).join("");

  return section(
    "الجدول الكثيف",
    `صف بارتفاع ٣٤px ورأس ثابت: ${counted(totals.rows, "طلبًا", "طلبات")} في شاشة واحدة بلا تنقّل. الفرق = المعدود − المتوقَّع، فهو العجز الحقيقي لا حصيلة الفترة.`,
    `<div class="table-wrap" role="region" aria-label="جدول التسويات" tabindex="0">
      <table class="table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>
    </div>
    <div class="card__foot" style="margin:0 -14px -12px;border-radius:0 0 11px 11px">
      <span>المعدود في المعلّقة <b class="num">${formatMoney(totals.counted)}</b> ج.م · المتوقَّع <b class="num">${formatMoney(totals.openValue)}</b> ج.م</span>
      <span class="table-pager">
        <button type="button" class="pager-btn" data-href="/prev" aria-label="السابق">${icon("chevron")}</button>
        <button type="button" class="pager-btn is-active">1</button>
        <button type="button" class="pager-btn" data-href="/p2">2</button>
        <button type="button" class="pager-btn" data-href="/p3">3</button>
        <button type="button" class="pager-btn" data-href="/next" aria-label="التالي" style="transform:scaleX(-1)">${icon("chevron")}</button>
      </span>
    </div>`,
  );
}

function buttonsPattern() {
  const tags = [
    ["is-teal", "مؤكَّدة"], ["is-amber", "بانتظار الاعتماد"], ["is-blue", "بانتظار التأكيد"],
    ["is-red", "بطلت"], ["is-gray", "ملغاة"],
  ];
  return section(
    "الأزرار والشارات",
    "زر رئيسي واحد لكل شاشة، وما عداه ثانوي أو شبحي. الشارات تحمل الحالة ولا تحمل اللون وحده.",
    `<div class="pattern" style="gap:10px">
      <div class="pattern-row">
        <button type="button" class="btn" data-href="/a">${icon("plus")} رئيسي</button>
        <button type="button" class="btn btn--secondary" data-href="/b">ثانوي</button>
        <button type="button" class="btn btn--ghost" data-href="/c">شبحي</button>
        <button type="button" class="btn btn--danger" data-href="/d">حذف</button>
        <button type="button" class="btn btn--sm" data-href="/e">صغير</button>
        <button type="button" class="btn" disabled>معطّل</button>
      </div>
      <div class="pattern-row">${tags
        .map(([tone, label]) => `<span class="tag ${tone}"><i></i>${label}</span>`)
        .join("")}</div>
    </div>`,
  );
}

function formPattern() {
  return section(
    "الحقول والنماذج",
    "تسمية فوق الحقل، وتلميح تحته، ورسالة الخطأ تحل محل التلميح ولا تتزاحم معه.",
    `<div class="form-grid">
      <div class="field-block"><label for="d1">مبلغ التحويل الفعلي</label><input id="d1" value="3,150.00" inputmode="decimal"><small>يُسلَّم للخزنة، ويُترك الباقي عهدة ثابتة.</small></div>
      <div class="field-block"><label for="d2">الفرع</label><select id="d2"><option>فرع العريش</option></select><small>نطاق حسابك إن لم تكن ترى كل الفروع.</small></div>
      <div class="field-block is-invalid"><label for="d3">سبب الإلغاء</label><textarea id="d3"></textarea><span class="error">السبب مطلوب عند إلغاء طلب معتمد.</span></div>
      <div class="field-block"><label for="d4">تاريخ الجرد</label><input id="d4" value="2026-11-01" dir="ltr"><small>التاريخ بصيغة لاتينية لأنه يُقرأ آليًا.</small></div>
    </div>`,
  );
}

function emptyPattern() {
  return section(
    "حالة الفراغ",
    "الفراغ رسالة لا خطأ: تقول ما العمل التالي، ولا تترك الشاشة بيضاء.",
    `<div class="empty">
      <span class="empty__icon">${icon("settlement")}</span>
      <strong>لا تسويات مطابقة لهذه التصفية</strong>
      <p>غيّر الفرع أو الحالة، أو ألغِ التصفية لترى كل الطلبات. لا تُنشأ تسوية من هذه الشاشة.</p>
      <button type="button" class="btn btn--secondary btn--sm" data-href="/reset">إلغاء التصفية</button>
    </div>`,
  );
}

/** ---------------- الرسم ---------------- */

function render() {
  patterns.innerHTML = [
    pageHeadPattern(),
    alertsPattern(),
    toolbarPattern(),
    statStripPattern(),
    tablePattern(),
    buttonsPattern(),
    formPattern(),
    emptyPattern(),
  ].join("");
}

function mount() {
  const requested = new URLSearchParams(globalThis.location?.search ?? "").get("role");
  if (["MANAGER", "ACCOUNTANT", "CS_AGENT"].includes(requested)) preview.role = requested;

  mountChrome({ active: "settlements", title: "التسويات", breadcrumb: ["صلة تون", "المالية", "التسويات"] });
  onPreviewChange(render);
  render();
}

mount();
