/**
 * ============================================================
 *  الأجزاء المشتركة بين صفحات المعاينة
 *
 *  القائمة الجانبية، والشريط الأعلى، والتنبيهات، والتنبيه العائم.
 *  لا تقرأ هذه الوحدة قاعدة بيانات ولا تتصل بالشبكة: كل ما تعرضه
 *  من model.mjs، وكل نقرة تُظهر تنبيهًا بما تفتحه في التطبيق فقط.
 * ============================================================
 */
import { ROLES, ROLE_IDS, BRANCHES, NOTIFICATIONS, navFor, unreadCount, scopeOptions } from "./model.mjs";

/** أيقونات بخطوط (stroke) — لا صور ولا مكتبات خارجية. */
export const ICONS = {
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
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
  arrow: '<path d="M14 6l-6 6 6 6"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  alert: '<path d="M12 3l9 16H3l9-16z"/><path d="M12 9v5"/><path d="M12 17h.01"/>',
  check: '<path d="M4.5 12.5l5 5L20 7"/>',
  refresh: '<path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1"/><path d="M20.5 4v5h-5"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  lock: '<path d="M6.5 11V8a5.5 5.5 0 0 1 11 0v3"/><rect x="4.5" y="11" width="15" height="10" rx="2"/>',
  users: '<path d="M15 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="3.2"/><path d="M22 20v-2a4 4 0 0 0-3-3.8"/>',
  settings: '<circle cx="12" cy="12" r="3.2"/><path d="M12 3v2.4M12 18.6V21M3 12h2.4M18.6 12H21M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M18.4 5.6l-1.7 1.7M7.3 16.7l-1.7 1.7"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/>',
  bell: '<path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6"/><path d="M10.5 20a2 2 0 0 0 3 0"/>',
  menu: '<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/>',
  dots: '<circle cx="5.5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18.5" cy="12" r="1.4"/>',
  sidebar: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M10 4.5v15"/>',
  download: '<path d="M12 4v11"/><path d="M8 11l4 4 4-4"/><path d="M4 20h16"/>',
  filter: '<path d="M4 5h16l-6 7v6l-4 2v-8L4 5z"/>',
  eye: '<path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="2.6"/>',
};

export function icon(name, className = "") {
  const body = ICONS[name] ?? ICONS.dashboard;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="${className}" aria-hidden="true">${body}</svg>`;
}

/* ---------------- حالة المعاينة ---------------- */

export const preview = { role: "MANAGER", branchId: null };
const listeners = new Set();

/** تُخطر الصفحة عند تبديل الدور أو النطاق لتعيد رسم نفسها. */
export function onPreviewChange(listener) {
  listeners.add(listener);
}

function emitChange() {
  for (const listener of listeners) listener(preview);
}

/**
 * بصمة المعاينة — تُحدَّث مع كل تغيير في التصميم.
 *
 * الغرض: أن يعرف من يفتح المعاينة أن ما يراه هو الأحدث قبل أن يحكم
 * عليه. فإن رأى رقمًا قديمًا فالمشكلة في التخزين المؤقت عنده،
 * لا في التصميم نفسه.
 */
export const PREVIEW_VERSION = { id: "٥", at: "١ نوفمبر · ٠١:٢٠" };

/** التصميمات الثلاثة — نفس المحتوى بترتيب وهيئة مختلفين. */
export const DESIGNS = [
  { id: "a", mark: "أ", name: "لوحة", note: "بطاقات · رقم قائد لكل قسم · كثافة عالية" },
  { id: "b", mark: "ب", name: "مهام", note: "عمود مهام ثابت · الأرقام قائمة رأسية بجانب المحتوى" },
  { id: "c", mark: "ج", name: "جدول", note: "لا بطاقات ولا ظلال · صفوف مخطّطة · أقصى كثافة" },
];

export const design = { current: "a" };
const designListeners = new Set();

export function onDesignChange(listener) {
  designListeners.add(listener);
}

export function setDesign(id) {
  const next = DESIGNS.find((item) => item.id === id) ?? DESIGNS[0];
  design.current = next.id;
  document.documentElement.dataset.design = next.id;
  for (const listener of designListeners) listener(next);
}

/* ---------------- التنبيه العائم ---------------- */

let toastTimer = null;
export function toast(message) {
  let box = document.getElementById("toast");
  if (!box) {
    box = document.createElement("div");
    box.id = "toast";
    box.className = "toast";
    box.setAttribute("role", "status");
    box.setAttribute("aria-live", "polite");
    box.innerHTML = `<span id="toast-text"></span>`;
    document.body.appendChild(box);
  }
  document.getElementById("toast-text").textContent = message;
  box.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove("is-visible"), 2600);
}

/* ---------------- الهيكل ---------------- */

function sidebarHtml(active) {
  const role = ROLES[preview.role];
  const branchIds = preview.branchId ? [preview.branchId] : BRANCHES.map((b) => b.id);
  const groups = navFor(preview.role, branchIds)
    .map(
      (group) => `<div class="nav-group">
        <p class="nav-group__label">${group.label}</p>
        <ul class="nav-list">${group.items
          .map(
            (item) => `<li><button type="button" class="nav-item${item.id === active ? " is-active" : ""}" data-route="${item.href}" data-nav="${item.id}">
              ${icon(item.icon)}<span class="nav-item__label">${item.label}</span>
              ${item.badge > 0 ? `<span class="nav-badge num">${item.badge}</span>` : ""}
            </button></li>`,
          )
          .join("")}</ul>
      </div>`,
    )
    .join("");

  const branchField = role.canFilterBranch
    ? `<label>النطاق
         <select id="branch-select">${scopeOptions()
           .map((option) => `<option value="${option.id}"${option.id === (preview.branchId ?? "") ? " selected" : ""}>${option.label}</option>`)
           .join("")}</select>
       </label>`
    : "";

  return `<div class="brand">
      <span class="brand-mark" aria-hidden="true">${icon("branch")}</span>
      <span class="brand-text"><strong>صلة<span>تون</span></strong><small>SELHTONE ERP</small></span>
    </div>
    <nav aria-label="التنقّل الرئيسي">${groups}</nav>
    <div class="sidebar-foot">
      <div class="preview-controls">
        <p class="preview-controls__title">${icon("eye")} إعدادات المعاينة</p>
        <label>الدور
          <select id="role-select">${ROLE_IDS.map(
            (id) => `<option value="${id}"${id === preview.role ? " selected" : ""}>${ROLES[id].label}</option>`,
          ).join("")}</select>
        </label>
        ${branchField}
      </div>
      <div class="user-card">
        <span class="user-card__avatar" aria-hidden="true">${role.initial}</span>
        <span class="user-card__text"><strong>${role.name}</strong><small>${role.label}</small></span>
      </div>
      <button type="button" class="collapse-btn" id="collapse-btn">${icon("sidebar")}<span>طي القائمة</span></button>
    </div>`;
}

function topbarHtml(breadcrumb) {
  const crumbs = breadcrumb
    .map((crumb, index) => {
      const last = index === breadcrumb.length - 1;
      return last
        ? `<span class="current">${crumb}</span>`
        : `<a href="#" data-route="/${crumb}">${crumb}</a><span class="sep">/</span>`;
    })
    .join("");

  const items = NOTIFICATIONS.map(
    (item) => `<li class="notif-item${item.unread ? " is-unread" : ""}">
      <span class="notif-item__icon ${item.tone}">${icon(item.icon)}</span>
      <span class="notif-item__text"><strong>${item.title}</strong><small>${item.time}</small></span>
    </li>`,
  ).join("");

  return `<button type="button" class="icon-btn only-mobile" id="drawer-btn" aria-label="فتح القائمة">${icon("menu")}</button>
    <div class="crumbs">${crumbs}</div>
    <div class="search">
      ${icon("search")}
      <input type="search" id="global-search" placeholder="ابحث: فاتورة، عميل، صنف…" aria-label="بحث سريع">
      <kbd>Ctrl K</kbd>
    </div>
    <div class="topbar-actions">
      <div class="design-switch" role="group" aria-label="تبديل التصميم">
        ${DESIGNS.map((item) => `<button type="button" data-design="${item.id}" class="${item.id === design.current ? "is-active" : ""}" title="${item.note}" aria-pressed="${item.id === design.current}"><b>${item.mark}</b>${item.name}</button>`).join("")}
      </div>
      <div class="notif-wrap">
        <button type="button" class="icon-btn notif-btn" id="notif-btn" aria-label="التنبيهات" aria-expanded="false">
          ${icon("bell")}<span class="dot num">${unreadCount()}</span>
        </button>
        <div class="notif-panel" id="notif-panel" hidden>
          <div class="notif-panel__head"><span>التنبيهات · ${unreadCount()} غير مقروء</span><button type="button" data-mark-read="1">تعليم الكل مقروءًا</button></div>
          <ul class="notif-list">${items}</ul>
        </div>
      </div>
      <button type="button" class="icon-btn" data-href="/change-password" aria-label="كلمة المرور" title="كلمة المرور">${icon("lock")}</button>
    </div>`;
}

/**
 * يبني القائمة والشريط الأعلى ويصل أسلاكهما.
 * @param {{ active: string, breadcrumb: string[] }} options
 */
export function mountChrome(options) {
  const shell = document.getElementById("shell");
  const sidebar = document.getElementById("sidebar");
  const topbar = document.getElementById("topbar");

  // الرابط ?design=b يفتح المعاينة على تصميم بعينه للمقارنة.
  const requestedDesign = new URLSearchParams(globalThis.location?.search ?? "").get("design");
  setDesign(DESIGNS.some((item) => item.id === requestedDesign) ? requestedDesign : "a");

  const chip = document.getElementById("version-chip");
  if (chip) {
    chip.innerHTML = `<strong style="color:#63470c">نسخة ${PREVIEW_VERSION.id}</strong> · ${PREVIEW_VERSION.at}`;
  }

  const draw = () => {
    sidebar.innerHTML = sidebarHtml(options.active);
    topbar.innerHTML = topbarHtml(options.breadcrumb);

    sidebar.querySelector("#role-select").addEventListener("change", (event) => {
      preview.role = event.target.value;
      preview.branchId = null;
      draw(); // بطاقة المستخدم وشارات القائمة تتغيّر مع الدور
      emitChange();
    });

    const branchSelect = sidebar.querySelector("#branch-select");
    if (branchSelect) {
      branchSelect.addEventListener("change", (event) => {
        preview.branchId = event.target.value || null;
        draw();
        emitChange();
      });
    }

    topbar.querySelectorAll("[data-design]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        setDesign(button.dataset.design);
        draw();
      });
    });

    sidebar.querySelector("#collapse-btn").addEventListener("click", () => {
      shell.classList.toggle("is-collapsed");
    });
  };

  draw();

  const drawerBtn = topbar.querySelector("#drawer-btn");
  if (drawerBtn) {
    drawerBtn.addEventListener("click", () => {
      shell.classList.toggle("is-drawer");
    });
  }

  const notifBtn = topbar.querySelector("#notif-btn");
  const notifPanel = topbar.querySelector("#notif-panel");
  notifBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    const open = notifPanel.hidden;
    notifPanel.hidden = !open;
    notifBtn.setAttribute("aria-expanded", String(open));
  });
  notifPanel.addEventListener("click", (event) => {
    if (event.target.closest("[data-mark-read]")) {
      event.stopPropagation();
      toast("تعليم التنبيهات مقروءة غير منفّذ في المعاينة.");
    }
  });
  document.addEventListener("click", (event) => {
    if (!notifPanel.hidden && !event.target.closest(".notif-wrap")) {
      notifPanel.hidden = true;
      notifBtn.setAttribute("aria-expanded", "false");
    }
  });

  const search = topbar.querySelector("#global-search");
  search.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      toast("البحث الموحّد غير منفّذ في المعاينة — هذا مكانه في الشريط الأعلى.");
    }
  });

  document.addEventListener("click", (event) => {
    const link = event.target.closest("[data-href]");
    if (link) {
      event.preventDefault();
      toast(`في التطبيق يفتح هذا الزر: ${link.dataset.href} — المعاينة للتصميم فقط.`);
      return;
    }
    const nav = event.target.closest("[data-route]");
    if (nav) {
      event.preventDefault();
      shell.classList.remove("is-drawer");
      const target = nav.dataset.nav ?? "";
      if (target === options.active) {
        toast("أنت في هذه الشاشة الآن.");
      } else {
        toast(`المعاينة تعرض تصميم ${options.title ?? "هذه الشاشة"} فقط — بقية الشاشات تُصمَّم لاحقًا.`);
      }
    }
  });

  return { redrawChrome: draw };
}
