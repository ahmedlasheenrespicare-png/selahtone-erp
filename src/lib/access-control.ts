/**
 * محرك الصلاحيات الكاملة (الصفحات + العناصر الداخلية + مفتاح الكتابة) — منطق صِرف
 * بلا قاعدة بيانات ولا جلسة، ليُختبر ولا يُعتمد عليه وحده؛ أنفاذ حقيقي في
 * access-control-server.ts.
 *
 * مبادئ مثبّتة:
 * - الافتراضي المسموح: الوصول على النمط القديم (لا قيود) حتى يُطبَّق الأدمن ما يريد؛
 *   الصفوف المخزّنة هي منع/سماح صريح، وقالب الدور يُعلوه استثناء الحساب في الاتجاهين.
 * - مفتاح «/مسار» يملك استخدامان: الصفحة نفسها + الصفحة دائمًا مسموحة إن كانت always.
 * - مفتاح «/مسار#write» هو قفل الكتابة — تنفّذه دون عناصر واجهة أيضًا أكشناتُ الخادم.
 * - الأدمن النظام (الدور MANAGER والبريد ضمن ADMIN_EMAILS — الافتراضي manager@selahtone.local)
 *   يُقفَل تجاوزُه ولا يُقيَّد أبدًا، ويبقى وحده من يصل /admin و/setup.
 * - فشل مخزن الصلاحيات = منع مؤقت لغير الأدمن، مع شاشة لوحة قيادة آمنة وتنبيه.
 * - المفاتيح غير المعروفة من إصدارات أقدم تُتجاهل ولا تُعطل — ولا تُرفض أبدًا.
 */
export type AccessSubjectKind = "role" | "user";

export interface AccessElementDef {
  key: string;
  label: string;
  /** محدّدات تُطبَّق في الطبقة CSS الخادمية إن كانت مُعلنة على العناصر الموجودة فعليًا. */
  selector?: string;
}

export interface AccessPageDef {
  route: string;
  label: string;
  group: string;
  /** لا تُخفى صفحة آمنة (مثل لوحة القيادة — هدف التحويلات). */
  always?: boolean;
  elements: AccessElementDef[];
}

const WRITE_LABEL = "التعديل والحفظ في هذه الصفحة";
const ALWAYS_WRITE_LABEL =
  "قفل الكتابة العام — يسري على عمليات وحدة المالية كلها";

function page(
  route: string,
  label: string,
  group: string,
  elements: AccessElementDef[] = [],
  always = false,
): AccessPageDef {
  // /finance يحمل مفتاح الكتابة العام للوحدة بدل مفتاح الصفحة وحدها.
  if (route === "/finance") {
    return {
      route,
      label,
      group,
      always,
      elements: [{ key: "/finance#write", label: ALWAYS_WRITE_LABEL }, ...elements],
    };
  }
  const write: AccessElementDef[] = always ? [] : [{ key: `${route}#write`, label: WRITE_LABEL }];
  return { route, label, group, always, elements: [...write, ...elements] };
}

export const ACCESS_GROUP_NAMES = ["الرئيسية", "المبيعات", "المخزون", "المالية"] as const;
export type AccessGroupName = (typeof ACCESS_GROUP_NAMES)[number];

const DASHBOARD_ELEMENTS: AccessElementDef[] = [
  { key: "/dashboard#recorded-flow", label: "مؤشر الحركات المالية المسجّلة في لوحة القيادة" },
  { key: "/dashboard#profitability", label: "الربحية وتكلفة البضاعة في مؤشر الداشبورد فقط" },
  { key: "/dashboard#stock-value", label: "قيمة المخزون الإجمالية في الداشبورد فقط" },
  { key: "/dashboard#expense-details", label: "تفاصيل المصروفات بالداشبورد: اليوم والشهر والسجل الحي" },
  { key: "/dashboard#invoice-details", label: "تفاصيل الفواتير والعملاء بالداشبورد (تشمل البحث وبطاقات المبيعات والتحصيل والذمم والسجل الحي)" },
  { key: "/dashboard#part-pulse", label: "نبض اليوم", selector: '[data-dash-part="pulse"]' },
  { key: "/dashboard#part-pace", label: "وتيرة الشهر", selector: '[data-dash-part="pace"]' },
  {
    key: "/dashboard#part-governance",
    label: "الرقابة والتنبيهات",
    selector: '[data-dash-part="governance"]',
  },
  { key: "/dashboard#part-wallet", label: "الحافظة والجيب", selector: '[data-dash-part="wallet"]' },
  {
    key: "/dashboard#part-today-invoices",
    label: "فواتير اليوم",
    selector: '[data-dash-part="today-invoices"],[data-dash-part="today"]',
  },
  {
    key: "/dashboard#part-today-collections",
    label: "تفاصيل تحصيلات اليوم",
    selector: '[data-dash-part="today-collections"]',
  },
  {
    key: "/dashboard#part-today-expenses",
    label: "مصروفات اليوم",
    selector: '[data-dash-part="today-expenses"]',
  },
  {
    key: "/dashboard#focus-hint",
    label: "تلميح «معاملات اليوم»",
    selector: '[data-dash-part="focus-hint"]',
  },
];

/**
 * كل صفحة موجودة فعليًا في src/app/(app) — يُمنع إضافة مفاتيح لصفحات غير موجودة هنا؛
 * أي مفتاح يخزّنه الأدمن دون ما يقابله ليس له أثر (القاعدة بلا أثر على السلوك).
 */
export const ACCESS_PAGES: readonly AccessPageDef[] = [
  page("/dashboard", "لوحة القيادة", "الرئيسية", DASHBOARD_ELEMENTS, true),

  page("/sales", "المبيعات والفواتير", "المبيعات", [
    { key: "/sales#collect", label: "تسجيل تحصيل على الفاتورة" },
    { key: "/sales#refund", label: "تسجيل رد مبلغ للعميل" },
    { key: "/sales#refund-balances", label: "عرض أرصدة الحسابات في نموذج رد المبيعات فقط" },
    { key: "/sales#return", label: "تسجيل مرتجع جزئي" },
    { key: "/sales#cancel", label: "إلغاء الفاتورة بالكامل" },
  ]),
  page("/sales/new", "بيع جديد", "المبيعات"),
  page("/sales/today", "مبيعات اليوم", "المبيعات"),
  page("/sales/stats", "إحصائيات المبيعات", "المبيعات", [
    { key: "/sales/stats#profitability", label: "التكلفة والربحية في إحصائيات المبيعات فقط" },
  ]),
  page("/sales/catalog", "أصناف البيع", "المبيعات", [
    { key: "/sales/catalog#create-category", label: "إضافة تصنيف بيع" },
    { key: "/sales/catalog#edit-category", label: "تعديل تصنيف بيع" },
    { key: "/sales/catalog#change-category-status", label: "تغيير حالة تصنيف بيع" },
    { key: "/sales/catalog#create-type", label: "إضافة نوع بيع" },
    { key: "/sales/catalog#edit-type", label: "تعديل نوع بيع" },
    { key: "/sales/catalog#change-type-status", label: "تغيير حالة نوع بيع" },
    { key: "/sales/catalog#create-field", label: "إضافة حقل بيع" },
    { key: "/sales/catalog#edit-field", label: "تعديل حقل بيع" },
    { key: "/sales/catalog#change-field-status", label: "تغيير حالة حقل بيع" },
  ]),
  page("/sales/settings", "حد خصم الموظف", "المبيعات"),

  page("/inventory", "المخزون", "المخزون", [
    { key: "/inventory#cost-details", label: "أسعار الشراء وقيم المخزون في صفحة المخزون فقط" },
  ]),
  page("/inventory/new", "صنف جديد", "المخزون"),
  page("/inventory/opening", "رصيد أول المدة", "المخزون", [
    { key: "/inventory/opening#purchase-cost-hint", label: "إظهار تكلفة دليل الصنف في نموذج الرصيد الافتتاحي فقط" },
  ]),
  page("/inventory/receipts", "إيصالات الاستلام", "المخزون", [
    { key: "/inventory/receipts#unit-cost", label: "تكلفة الوحدة في سجل التوريدات فقط" },
  ]),
  page("/inventory/receipts/new", "إيصال استلام جديد", "المخزون", [
    { key: "/inventory/receipts/new#purchase-cost-hint", label: "إظهار تكلفة دليل الصنف في نموذج التوريد فقط" },
  ]),
  page("/inventory/serials", "الأرقام التسلسلية", "المخزون"),

  page("/finance", "الحسابات النقدية", "المالية", [
    { key: "/finance#close-custody", label: "إقفال عهدة" },
  ]),
  page("/finance/accounts", "الخزائن والعهد", "المالية", [
    { key: "/finance/accounts#open", label: "فتح حساب نقدي" },
    { key: "/finance/accounts#decide-custody", label: "البت في طلب عهدة" },
  ]),
  page("/finance/transfers", "التحويلات والتسليم", "المالية", [
    { key: "/finance/transfers#transfer", label: "تسجيل تحويل نقدي" },
    { key: "/finance/transfers#confirm-settlement", label: "اعتماد طلب التسوية" },
    { key: "/finance/transfers#reject-settlement", label: "رفض طلب التسوية" },
  ]),
  page("/finance/expenses", "المصروفات", "المالية", [
    { key: "/finance/expenses#approve", label: "اعتماد المصروف" },
    { key: "/finance/expenses#pay", label: "تسجيل صرف المصروف" },
    { key: "/finance/expenses#review", label: "طلب مراجعة مصروف مدفوع" },
  ]),
  page("/finance/expenses/new", "تسجيل مصروف", "المالية"),
  page("/finance/expenses/today", "مصروفات اليوم", "المالية"),
  page("/finance/counts", "الجرد", "المالية", [
    { key: "/finance/counts#request", label: "تسجيل جرد نقدي" },
    { key: "/finance/counts#confirm", label: "تأكيد تسوية الجرد" },
    { key: "/finance/counts#cancel", label: "إلغاء طلب الجرد" },
    { key: "/finance/counts#request-holder", label: "طلب جرد من صاحب العهدة" },
  ]),
  page("/finance/categories", "البنود", "المالية", [
    { key: "/finance/categories#create", label: "إضافة بند مصروف" },
    { key: "/finance/categories#edit", label: "تعديل أو تفعيل بند مصروف" },
  ]),
  page("/finance/help", "دليل المالية", "المالية"),
  page("/finance/mine", "عهدتي", "المالية", [
    { key: "/finance/mine#request-custody", label: "طلب فتح عهدة" },
    { key: "/finance/mine#submit-count", label: "تقديم الجرد الموجّه" },
  ]),
  page("/finance/reports", "التقارير المالية", "المالية"),
  page("/finance/settlements", "التسويات", "المالية", [
    { key: "/finance/settlements#cancel", label: "إلغاء طلب تسوية" },
  ]),
  page("/finance/settlements/new", "طلب تسوية", "المالية", [
    { key: "/finance/settlements/new#request", label: "تقديم طلب تسوية" },
  ]),
];

export const ACCESS_PAGE_ROUTES = new Set(ACCESS_PAGES.map((p) => p.route));

/** جميع المفاتيح المعروفة للنظام (صفحات + عناصر) — يتجاهل أي مخزَّن غيرها. */
function allKnownKeys(): string[] {
  const keys: string[] = [];
  for (const p of ACCESS_PAGES) {
    keys.push(p.route);
    for (const el of p.elements) keys.push(el.key);
  }
  return keys;
}
export const ALL_ACCESS_KEYS: readonly string[] = Object.freeze(allKnownKeys());
export const KNOWN_ACCESS_KEYS = new Set(ALL_ACCESS_KEYS);

/** Store failure: deny every registered page and element except always-open page routes. */
export function hiddenOnAccessStoreFailure(): Set<string> {
  return new Set(ACCESS_PAGES.flatMap(p => [...(p.always ? [] : [p.route]), ...p.elements.map(element => element.key)]));
}

export function findAccessPage(route: string): AccessPageDef | undefined {
  return ACCESS_PAGES.find((p) => p.route === route);
}

/**
 * صفحة ديناميكية (/sales/[saleId]، /finance/expenses/[expenseId]…) تُحسم
 * على صفحتها الأصل؛ والمسارات غير المعروفة لا تُمنع (لا تعطيل لشيء جديد قبل تسجيله).
 */
export function canonicalPageForRoute(pathname: string | null | undefined): string | null {
  if (!pathname) return null;
  const path = pathname.split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";
  if (path === "/") return null;
  if (ACCESS_PAGE_ROUTES.has(path)) return path;
  // أطول بادئة معروفة (للديناميكيات) — لا يُحتاج المرور لقالب.
  let best: string | null = null;
  for (const route of ACCESS_PAGE_ROUTES) {
    if (path === route || path.startsWith(`${route}/`)) {
      if (best === null || route.length > best.length) best = route;
    }
  }
  return best;
}

/** Resolve dynamic page URLs to their registered page while preserving element keys. */
export function accessKeyAllowed(hidden: ReadonlySet<string>, key: string): boolean {
  const normalized = key.includes("#") ? key : (canonicalPageForRoute(key) ?? key.split("?")[0]);
  if (findAccessPage(normalized)?.always) return true;
  return !hidden.has(normalized);
}

/**
 * الحل النهائي: ممنوعات غيرقابلة للتجاوز إلا بالأدمن النظام (يُطبق في الخادم).
 * userRows يعلو roleRows في الاتجاهين؛ لا شيء يسقط إلا بصف صريح.
 */
export function resolveHiddenKeys(
  roleRows: ReadonlyMap<string, boolean>,
  userRows: ReadonlyMap<string, boolean>,
): Set<string> {
  const hidden = new Set<string>();
  for (const key of ALL_ACCESS_KEYS) {
    let allowed = true;
    if (roleRows.has(key)) allowed = roleRows.get(key) as boolean;
    if (userRows.has(key)) allowed = userRows.get(key) as boolean;
    if (!allowed) hidden.add(key);
  }
  return hidden;
}

/** الأدمن النظام: الدور MANAGER وبريد ضمن القائمة (الافتراضية manager@selahtone.local). */
export const DEFAULT_ADMIN_EMAILS = ["manager@selahtone.local"];

export function parseAdminEmails(raw: string | undefined | null): string[] {
  if (!raw) return [...DEFAULT_ADMIN_EMAILS];
  const parsed = raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  return parsed.length > 0 ? parsed : [...DEFAULT_ADMIN_EMAILS];
}

export function isSystemAdmin(
  role: string | null | undefined,
  email: string | null | undefined,
  adminEmails: readonly string[],
): boolean {
  if (role !== "MANAGER" || typeof email !== "string") return false;
  return adminEmails.includes(email.trim().toLowerCase());
}

/** محدّد عام آمن لأي عنصر: أي طرف يحمل data-ac="<المفتاح>" يُخفى بالكامل. */
function genericRule(key: string): string {
  return `[data-ac="${key}"]{display:none !important}`;
}

/**
 * ورقة أنماط خادمية: المفاتيح المخفية المعلنة محدّداتها تُخفى بعناصرها الحقيقية،
 * والكل يقبل المحدّد العام data-ac. يُحقن في أحد صفحات التطبيق بواسطة الخادم.
 */
export function hiddenAccessCss(hidden: ReadonlySet<string>): string {
  if (hidden.size === 0) return "";
  const rules: string[] = [];
  for (const p of ACCESS_PAGES) {
    for (const el of p.elements) {
      if (!hidden.has(el.key)) continue;
      // مفاتيح الكتابة خادمية صرفة — تُفرض في أكشنات الخادم ولا تحتاج (ولا تستحق) أي قاعدة CSS.
      if (el.key.endsWith("#write")) continue;
      if (el.selector) rules.push(`${el.selector}{display:none !important}`);
      rules.push(genericRule(el.key));
    }
  }
  return rules.join("\n");
}

/** Page denial, page write denial and finance-wide write denial all apply. */
export function writeAllowedForKeys(hidden: ReadonlySet<string>, key: string): boolean {
  // Stored obsolete rules are ignored, but a programming error at a live
  // authorization call must never turn an unknown action into an allow.
  if (!KNOWN_ACCESS_KEYS.has(key)) return false;
  const pageKey = key.split("#")[0];
  const elementKey = key.includes("#") ? key : `${key}#write`;
  return (findAccessPage(pageKey)?.always || !hidden.has(pageKey)) && !hidden.has(`${pageKey}#write`) && !hidden.has(elementKey) &&
    !(pageKey.startsWith("/finance/") && hidden.has("/finance#write"));
}

/** Read-only elements remain visible when their page's write lock is closed. */
const READ_ONLY_ELEMENT_KEYS = new Set([
  "/dashboard#focus-hint", "/dashboard#profitability", "/dashboard#stock-value",
  "/dashboard#expense-details", "/dashboard#invoice-details", "/dashboard#recorded-flow",
  "/inventory#cost-details", "/inventory/receipts#unit-cost", "/sales/stats#profitability",
]);

/** Permission-rule result only: role/feature/record constraints are separate. */
export function accessRulesAllowKey(hidden: ReadonlySet<string>, key: string): boolean {
  if (!KNOWN_ACCESS_KEYS.has(key)) return false;
  if (!key.includes("#")) return accessKeyAllowed(hidden, key);
  // Balance data exists only inside the refund form, which is itself write-gated.
  if (key === "/sales#refund-balances") return writeAllowedForKeys(hidden, "/sales#refund") && accessKeyAllowed(hidden, key);
  if (READ_ONLY_ELEMENT_KEYS.has(key)) {
    const pageKey = key.split("#")[0];
    return accessKeyAllowed(hidden, pageKey) && accessKeyAllowed(hidden, key);
  }
  return writeAllowedForKeys(hidden, key);
}

/** Keys currently safe to edit in the in-progress administrative panel. */
const IMPLEMENTED_WRITE_KEYS = new Set([
  "/dashboard#focus-hint", "/dashboard#profitability", "/dashboard#stock-value", "/dashboard#expense-details", "/dashboard#invoice-details", "/dashboard#recorded-flow",
  "/sales/stats#profitability",
  "/sales#write", "/sales#collect", "/sales#refund", "/sales#refund-balances", "/sales#return", "/sales#cancel", "/sales/new#write", "/sales/settings#write", "/sales/catalog#write",
  "/sales/catalog#create-category", "/sales/catalog#edit-category", "/sales/catalog#change-category-status",
  "/sales/catalog#create-type", "/sales/catalog#edit-type", "/sales/catalog#change-type-status",
  "/sales/catalog#create-field", "/sales/catalog#edit-field", "/sales/catalog#change-field-status",
  "/inventory#cost-details", "/inventory/receipts#unit-cost", "/inventory/opening#purchase-cost-hint", "/inventory/receipts/new#purchase-cost-hint", "/inventory/new#write", "/inventory/opening#write", "/inventory/receipts/new#write",
  "/finance#write", "/finance/accounts#write", "/finance/transfers#write", "/finance/transfers#transfer",
  "/finance/transfers#confirm-settlement", "/finance/transfers#reject-settlement", "/finance/expenses#write",
  "/finance/expenses#approve", "/finance/expenses#pay", "/finance/expenses#review",
  "/finance/expenses/new#write", "/finance/counts#write", "/finance/counts#request", "/finance/counts#confirm",
  "/finance/counts#cancel", "/finance/counts#request-holder", "/finance/categories#write", "/finance/categories#create",
  "/finance/categories#edit", "/finance/mine#write",
  "/finance/settlements#write", "/finance/settlements/new#write", "/finance#close-custody",
  "/finance/accounts#open", "/finance/accounts#decide-custody", "/finance/mine#request-custody", "/finance/mine#submit-count",
  "/finance/settlements#cancel", "/finance/settlements/new#request",
]);
export function isEditableAccessKey(key: string): boolean {
  if (!KNOWN_ACCESS_KEYS.has(key)) return false;
  if (key.includes("#")) return IMPLEMENTED_WRITE_KEYS.has(key);
  const definition = findAccessPage(key);
  return !!definition && !definition.always && (["المبيعات", "المخزون", "المالية"].includes(definition.group));
}
