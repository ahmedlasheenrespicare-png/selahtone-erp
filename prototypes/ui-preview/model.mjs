/**
 * ============================================================
 *  معاينة لوحة القيادة — نموذج البيانات والحساب
 *
 *  هذه معاينة تصورية منفصلة وليست ميزة فعلية: لا تستخدم Prisma،
 *  ولا ملفات التطبيق، ولا قاعدة بيانات، ولا تخزينًا في المتصفح،
 *  ولا تتصل بالشبكة. كل الأسماء والفروع والمبالغ افتراضية.
 *
 *  كل المبالغ أعداد صحيحة بالقرش — كما يجري العمل في النظام
 *  الفعلي — حتى لا تتسرّب أخطاء الفاصلة العائمة إلى الأرقام
 *  التي يُسأل عنها المستخدم.
 *
 *  القاعدة الحسابية الوحيدة في هذه المعاينة:
 *    المتوقَّع في اليد = رصيد العهدة + المحصَّل نقدًا − المصروف من نقد الموظف
 * ============================================================
 */

export const ROLE_IDS = ["MANAGER", "ACCOUNTANT", "CS_AGENT"];

export const ROLES = {
  MANAGER: {
    id: "MANAGER",
    label: "مدير الشركة",
    name: "أحمد لاشين",
    first: "أحمد",
    email: "ahmed@selahtone.example",
    initial: "أ",
    branchId: null,
    scopeLabel: "كل الفروع",
    canFilterBranch: true,
  },
  ACCOUNTANT: {
    id: "ACCOUNTANT",
    label: "المحاسب",
    name: "محمد سالم",
    first: "محمد",
    email: "mohamed@selahtone.example",
    initial: "م",
    branchId: "ARH",
    scopeLabel: "فرع العريش",
    canFilterBranch: false,
  },
  CS_AGENT: {
    id: "CS_AGENT",
    label: "موظف الكاونتر",
    name: "إبراهيم عيد",
    first: "إبراهيم",
    email: "ibrahim@selahtone.example",
    initial: "إ",
    branchId: "ARH",
    scopeLabel: "فرع العريش",
    canFilterBranch: false,
  },
};

/**
 * مبيعات آخر ٧ أيام بالقرش، مرتّبة من الأقدم إلى اليوم.
 * اليوم هو آخر عنصر، وهو ما يجعل «مبيعات اليوم» قابلاً للمطابقة.
 */
export const BRANCHES = [
  {
    id: "ARH",
    code: "ARH",
    nameAr: "فرع العريش",
    city: "العريش",
    vault: 3_420_000,
    warehouses: ["ARH-MAIN", "ARH-SVC"],
    users: 4,
    active: true,
    weekSales: [62_000, 71_000, 54_000, 84_000, 64_000, 76_000, 26_000],
    weekInvoices: [4, 5, 3, 6, 4, 5, 2],
  },
  {
    id: "SHM",
    code: "SHM",
    nameAr: "فرع الشيخ زويد",
    city: "الشيخ زويد",
    vault: 1_280_000,
    warehouses: ["SHM-MAIN", "SHM-SVC"],
    users: 3,
    active: true,
    weekSales: [38_000, 29_000, 46_000, 41_000, 52_000, 47_000, 15_000],
    weekInvoices: [3, 2, 4, 3, 5, 4, 2],
  },
  {
    id: "BID",
    code: "BID",
    nameAr: "فرع بئر العبد",
    city: "بئر العبد",
    vault: 845_000,
    warehouses: ["BID-MAIN"],
    users: 2,
    active: true,
    weekSales: [24_000, 18_000, 31_000, 27_000, 35_000, 33_000, 11_000],
    weekInvoices: [2, 2, 3, 2, 4, 3, 1],
  },
];

/** العهد القائمة — `isSelf` يوسم عهدة الموظف الذي نعرض لوحته. */
export const CUSTODIES = [
  { id: 4, branchId: "ARH", holder: "إبراهيم عيد", opening: 100_000, collected: 245_000, expenses: 30_000, adjustments: 0, isSelf: true },
  { id: 5, branchId: "ARH", holder: "نور الهدى فتحي", opening: 150_000, collected: 112_500, expenses: 75_000, adjustments: 0, isSelf: false },
  { id: 6, branchId: "SHM", holder: "محمود فتحي", opening: 200_000, collected: 168_400, expenses: 100_000, adjustments: 0, isSelf: false },
  { id: 7, branchId: "BID", holder: "سارة عادل", opening: 120_000, collected: 96_600, expenses: 62_000, adjustments: 0, isSelf: false },
];

/** مبيعات الموظف نفسه في آخر ٧ أيام — مجموعها == المحصَّل في فترته. */
export const SELF_WEEK = {
  sales: [30_000, 38_000, 27_000, 46_000, 33_000, 42_000, 29_000],
  invoices: [5, 6, 4, 7, 5, 6, 7],
};

/** ملخّص الشهر (مدير فقط) — الفواتير غير الملغاة. */
export const MONTH = {
  invoices: 312,
  cancelled: 4,
  net: 5_124_000,
  outstanding: 1_845_000,
  outstandingInvoices: 6,
};

/** فواتير اليوم للموظف — الأربع الظاهرة + الباقي، ومجموعها مبيعات اليوم. */
export const SELF_TODAY_INVOICES = {
  shown: [
    { id: "INV-2041", time: "١٠:١٢", amount: 4_500, status: "نقدًا" },
    { id: "INV-2042", time: "١١:٠٥", amount: 4_500, status: "نقدًا" },
    { id: "INV-2043", time: "١٢:٤٠", amount: 4_500, status: "آجل" },
    { id: "INV-2044", time: "٠٢:١٥", amount: 8_000, status: "نقدًا" },
  ],
  hiddenCount: 3,
  hiddenTotal: 7_500,
};

/**
 * ما يحتاج إجراءً — لكل دور ما يخصه. التوزيع على الفروع يجعل
 * تصفية المدير بفرع بعينه تُعيد أعدادًا صحيحة لا أعداد الشركة كلها.
 */
export const FOCUS = {
  MANAGER: [
    {
      id: "approve-expenses", tone: "warning", icon: "expenses", href: "/finance/expenses",
      one: "مصروفًا بانتظار اعتمادك",
      many: "مصروفات بانتظار اعتمادك",
      perBranch: { ARH: { count: 2, amount: 120_000 }, SHM: { count: 1, amount: 64_000 }, BID: { count: 1, amount: 50_000 } },
    },
    {
      id: "approve-settlements", tone: "info", icon: "settlement", href: "/finance/transfers",
      one: "طلب تسوية بانتظار اعتمادك",
      many: "طلبات تسوية بانتظار اعتمادك",
      perBranch: { ARH: { count: 1, amount: 315_000 }, SHM: { count: 1, amount: 268_400 }, BID: { count: 1, amount: 154_600 } },
    },
    {
      id: "stale-settlement", tone: "warning", icon: "alert", href: "/finance/transfers",
      one: "طلب تسوية بطل بحركة نقدية بعده",
      many: "طلبات تسوية بطلت بحركة نقدية بعدها",
      perBranch: { ARH: { count: 1, amount: null } },
    },
    {
      id: "pay-expenses", tone: "info", icon: "cash", href: "/finance/expenses",
      one: "مصروفًا معتمدًا بانتظار أن يصرفه المحاسب",
      many: "مصروفات معتمدة بانتظار أن يصرفها المحاسب",
      perBranch: { ARH: { count: 2, amount: 190_000 }, SHM: { count: 1, amount: 55_000 } },
    },
  ],
  ACCOUNTANT: [
    {
      id: "pay", tone: "warning", icon: "cash", href: "/finance/expenses",
      one: "مصروفًا معتمدًا بانتظار تسجيل صرفه",
      many: "مصروفات معتمدة بانتظار تسجيل صرفها",
      perBranch: { ARH: { count: 2, amount: 190_000 } },
    },
    {
      id: "confirm", tone: "warning", icon: "settlement", href: "/finance/transfers",
      one: "طلب تسوية بانتظار تأكيدك",
      many: "طلبات تسوية بانتظار تأكيدك",
      perBranch: { ARH: { count: 1, amount: 187_500 } },
    },
    {
      id: "pending", tone: "info", icon: "expenses", href: "/finance/expenses",
      one: "مصروفًا لم يعتمده المدير بعد",
      many: "مصروفات لم يعتمدها المدير بعد",
      perBranch: { ARH: { count: 2, amount: 120_000 } },
    },
  ],
  CS_AGENT: [
    {
      id: "count", tone: "warning", icon: "settlement", href: "/finance/mine",
      hideCount: true,
      one: "جرد عهدتك واطلب تسوية — آخر جرد منذ ٧ أيام",
      many: "",
      perBranch: { ARH: { count: 1, amount: 315_000 } },
    },
    {
      id: "my-expense", tone: "info", icon: "expenses", href: "/finance/expenses",
      one: "مصروفًا لك بانتظار اعتماد المدير",
      many: "مصروفات لك بانتظار اعتماد المدير",
      perBranch: { ARH: { count: 1, amount: 30_000 } },
    },
    {
      id: "outstanding", tone: "info", icon: "receipt", href: "/sales",
      one: "فاتورة عليها باقٍ لدى العميل",
      many: "فواتير عليها باقٍ لدى العملاء",
      perBranch: { ARH: { count: 3, amount: 420_000 } },
    },
  ],
};

export const FOCUS_HEADLINE = {
  MANAGER: { label: "ما يحتاج قرارك", unit: "إجراء", note: "مجموع ما ينتظر اعتمادك أو اعتماد غيرك في النطاق المحدد" },
  ACCOUNTANT: { label: "ما ينتظرك الآن", unit: "إجراء", note: "ما يتحرّك تحت يدك: صرف ما اعتُمد، وتأكيد ما سُلِّم" },
  CS_AGENT: { label: "ما يحتاج انتباهك", unit: "تنبيه", note: "ما يخص عهدتك ومبيعاتك في فرعك" },
};

export const SHORTCUTS = {
  MANAGER: [
    { label: "فاتورة جديدة", hint: "ابدأ بيعًا الآن", icon: "sales", href: "/sales/new" },
    { label: "اعتماد المصروفات", hint: "٤ مصروفات بانتظارك", icon: "expenses", href: "/finance/expenses" },
    { label: "التسويات", hint: "٣ تسويات بانتظار الاعتماد", icon: "settlement", href: "/finance/transfers" },
    { label: "إحصاءات المبيعات", hint: "تفاصيل الشهر", icon: "stockValue", href: "/sales/stats" },
  ],
  ACCOUNTANT: [
    { label: "تسجيل صرف", hint: "٢ مصروفًا معتمدًا", icon: "cash", href: "/finance/expenses" },
    { label: "تأكيد التسويات", hint: "طلب بانتظار التأكيد", icon: "settlement", href: "/finance/transfers" },
    { label: "العهدة", hint: "٢ عهدة قائمة", icon: "receipt", href: "/finance" },
  ],
  CS_AGENT: [
    { label: "فاتورة جديدة", hint: "ابدأ بيعًا الآن", icon: "sales", href: "/sales/new" },
    { label: "عهدة نقدي", hint: "الجرد وطلب التسوية", icon: "receipt", href: "/finance/mine" },
    { label: "مصروف جديد", hint: "سجّل ما صرفته", icon: "expenses", href: "/finance/expenses" },
  ],
};

/** ---------------- أدوات تنسيق ---------------- */

const moneyFormatter = new Intl.NumberFormat("ar-EG-u-nu-latn", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const intFormatter = new Intl.NumberFormat("ar-EG-u-nu-latn");
const weekdayFormatter = new Intl.DateTimeFormat("ar-EG", { weekday: "long", timeZone: "Africa/Cairo" });
const longDateFormatter = new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Africa/Cairo",
});

/** ٦٤٧٠٥٠٠ قرشًا → "64,705.00" */
export function formatMoney(cents) {
  return moneyFormatter.format((Number(cents) || 0) / 100);
}

/** ١٢٣٤٥٦٧ قرشًا → "12,345.67" */
export function formatInt(value) {
  return intFormatter.format(Number(value) || 0);
}

export function formatDate(now = new Date()) {
  return longDateFormatter.format(now);
}

/**
 * صياغة العدد العربية: «مصروفًا» للواحد و«مصروفات» لما فوقه.
 * الواجهة تُقرأ بالعربية، وجمع التكسير لا يصلح معه جمع المؤنث السالم.
 */
export function counted(count, one, many) {
  return Number(count) === 1 ? `1 ${one}` : `${formatInt(count)} ${many}`;
}

export function sum(list) {
  return list.reduce((total, value) => total + value, 0);
}

/** المتوقَّع في اليد = الرصيد + المحصَّل نقدًا − المصروف من نقد الموظف. */
export function expectedInHand(custody) {
  return custody.opening + custody.collected - custody.expenses + custody.adjustments;
}

export function custodiesOf(branchIds) {
  return CUSTODIES.filter((item) => branchIds.includes(item.branchId));
}

export function branchesOf(branchId) {
  return branchId ? BRANCHES.filter((branch) => branch.id === branchId) : BRANCHES;
}

/** أسماء آخر ٧ أيام من الأقدم إلى اليوم. */
export function weekDays(now = new Date()) {
  const days = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const day = new Date(now);
    day.setDate(now.getDate() - offset);
    days.push(weekdayFormatter.format(day));
  }
  return days;
}

/** ---------------- بناء اللوحة ---------------- */

function focusFor(roleId, branchIds) {
  const items = (FOCUS[roleId] ?? [])
    .map((item) => {
      const count = sum(branchIds.map((id) => item.perBranch[id]?.count ?? 0));
      const amount = sum(branchIds.map((id) => item.perBranch[id]?.amount ?? 0));
      const hasAmount = branchIds.some((id) => item.perBranch[id]?.amount != null);
      const spread = branchIds
        .map((id) => ({ id, name: BRANCHES.find((branch) => branch.id === id)?.nameAr ?? id, count: item.perBranch[id]?.count ?? 0 }))
        .filter((entry) => entry.count > 0);
      const text = item.hideCount ? item.one : counted(count, item.one, item.many);
      return {
        id: item.id, tone: item.tone, icon: item.icon, href: item.href, text,
        count, amount: hasAmount ? amount : null, spread,
      };
    })
    .filter((item) => item.count > 0);
  return { items, count: sum(items.map((item) => item.count)) };
}

function moneyFor(roleId, branchIds) {
  if (roleId === "CS_AGENT") {
    const self = CUSTODIES.find((item) => item.isSelf);
    return {
      label: "المتوقَّع بيدك الآن",
      value: expectedInHand(self),
      unit: "ج.م",
      sentence: [
        { text: "عهدة" }, { amount: self.opening },
        { text: "+ نقد حصّلته" }, { amount: self.collected },
        { text: "− مصروف من نقدك" }, { amount: self.expenses },
      ],
      footnote: "به تُسأل عند التسليم — لا بالرصيد الدفتري وحده.",
      subs: [
        { label: "مبيعات اليوم", value: formatMoney(SELF_WEEK.sales[6]), unit: "ج.م", hint: counted(SELF_WEEK.invoices[6], "فاتورة", "فواتير") },
        { label: "عهدة ثابتة", value: formatMoney(self.opening), unit: "ج.م", hint: "لا تُفرَّغ عند التسوية" },
        { label: "باقٍ على العملاء", value: formatMoney(420_000), unit: "ج.م", hint: counted(3, "فاتورة", "فواتير") },
      ],
    };
  }

  if (roleId === "ACCOUNTANT") {
    const custody = sum(custodiesOf(branchIds).map(expectedInHand));
    const list = custodiesOf(branchIds);
    const sentence = [];
    list.forEach((item, index) => {
      if (index > 0) sentence.push({ text: "+" });
      sentence.push({ text: `عهدة ${item.holder}` }, { amount: expectedInHand(item) });
    });
    return {
      label: "المتوقَّع في العهد",
      value: custody,
      unit: "ج.م",
      sentence,
      footnote: "هذا ما سيُسلَّم لخزنة الفرع عند التسوية.",
      subs: [
        { label: "عهدة قائمة", value: formatInt(list.length), hint: "في نطاقك" },
        { label: "بانتظار الصرف", value: formatMoney(190_000), unit: "ج.م", hint: "٢ مصروفًا معتمدًا" },
        { label: "بانتظار التأكيد", value: formatMoney(187_500), unit: "ج.م", hint: "تسوية واحدة" },
      ],
    };
  }

  const selected = BRANCHES.filter((b) => branchIds.includes(b.id));
  const vaultTotal = sum(selected.map((b) => b.vault));
  const custody = sum(custodiesOf(branchIds).map(expectedInHand));
  const committed = 245_000;
  return {
    label: "النقد تحت الإدارة",
    value: vaultTotal + custody,
    unit: "ج.م",
    sentence: [
      { text: "خزن الفروع" }, { amount: vaultTotal },
      { text: "+" }, { text: "المتوقَّع في العهد" }, { amount: custody },
    ],
    footnote: `يلتزم منها ${formatMoney(committed)} مصروفات معتمدة بانتظار الصرف.`,
    subs: [
      { label: "خزن الفروع", value: formatMoney(vaultTotal), unit: "ج.م", hint: counted(selected.length, "خزنة", "خزنات") },
      { label: "المتوقَّع في العهد", value: formatMoney(custody), unit: "ج.م", hint: counted(custodiesOf(branchIds).length, "عهدة", "عهد") },
      { label: "باقٍ على العملاء", value: formatMoney(MONTH.outstanding), unit: "ج.م", hint: counted(MONTH.outstandingInvoices, "فاتورة", "فواتير") },
    ],
  };
}

function chartFor(roleId, branchIds, now) {
  const labels = weekDays(now);
  const isSelf = roleId === "CS_AGENT";
  const sales = isSelf
    ? SELF_WEEK.sales
    : labels.map((_, index) => sum(BRANCHES.filter((b) => branchIds.includes(b.id)).map((b) => b.weekSales[index])));
  const invoices = isSelf
    ? SELF_WEEK.invoices
    : labels.map((_, index) => sum(BRANCHES.filter((b) => branchIds.includes(b.id)).map((b) => b.weekInvoices[index])));
  const max = Math.max(...sales, 1);
  return {
    title: isSelf ? "مبيعاتك — آخر ٧ أيام" : "حركة البيع — آخر ٧ أيام",
    subtitle: isSelf ? "ما بعته أنت، نقدًا وآجلًا" : "الفواتير غير الملغاة في النطاق المحدد",
    days: labels.map((label, index) => ({
      label,
      value: sales[index],
      display: formatMoney(sales[index]),
      count: invoices[index],
      pct: Math.round((sales[index] / max) * 100),
      isToday: index === labels.length - 1,
    })),
    total: sum(sales),
    totalDisplay: formatMoney(sum(sales)),
    totalCount: sum(invoices),
    avgDisplay: formatMoney(Math.round(sum(sales) / 7)),
    note: isSelf ? "مجموع الأسبوع يساوي المحصَّل في فترتك." : "الشريط الأفتح هو اليوم.",
  };
}

/**
 * شريط أرقام كثيف: ستة أرقام في سطر واحد. الغرض أن تُقرأ الشاشة كلها
 * بلا تنقّل — فالكثافة هنا في عدد الأرقام المساندة، لا في تسويتها
 * بالرقم القائد: كل رقم مساند أصغر من الرقم القائد بمرتبتين على الأقل.
 */
function tilesFor(roleId, branchIds) {
  const branches = BRANCHES.filter((b) => branchIds.includes(b.id));
  const warehouses = sum(branches.map((b) => b.warehouses.length));
  const users = sum(branches.map((b) => b.users));
  if (roleId === "MANAGER") {
    return [
      { label: "فروع نشطة", value: formatInt(branches.length), hint: branchIds.length === BRANCHES.length ? "في نطاق حسابك" : "بعد التصفية" },
      { label: "مستودعات", value: formatInt(warehouses), hint: "في الفروع المحددة" },
      { label: "مستخدمون", value: formatInt(users), hint: "حسابات نشطة" },
      { label: "منتجات نشطة", value: formatInt(24), hint: "دليل المنتجات" },
      { label: "قيمة المخزون", value: formatMoney(48_630_000), unit: "ج.م", hint: "بمتوسط التكلفة" },
      { label: "تسويات الأسبوع", value: formatInt(12), hint: "مؤكَّدة ومعلّقة" },
    ];
  }
  if (roleId === "ACCOUNTANT") {
    return [
      { label: "عهدة قائمة", value: formatInt(custodiesOf(branchIds).length), hint: "في نطاقك" },
      { label: "تسويات الأسبوع", value: formatInt(4), hint: "مؤكَّدة ومعلّقة" },
      { label: "بنود المصروفات", value: formatInt(12), hint: "دليل البنود" },
      { label: "معدلات الضريبة", value: formatInt(3), hint: "معدلات نشطة" },
      { label: "مستخدمو الفرع", value: formatInt(users), hint: "حسابات نشطة" },
      { label: "أصناف نشطة", value: formatInt(24), hint: "دليل المنتجات" },
    ];
  }
  return [
    { label: "فواتير اليوم", value: formatInt(SELF_WEEK.invoices[6]), hint: "أتممتها اليوم" },
    { label: "مبيعات اليوم", value: formatMoney(SELF_WEEK.sales[6]), unit: "ج.م", hint: "نقدًا وآجلًا" },
    { label: "باقٍ على العملاء", value: formatMoney(420_000), unit: "ج.م", hint: counted(3, "فاتورة", "فواتير") },
    { label: "آخر جرد", value: "٧", unit: "أيام", hint: "مذ كان آخر جرد" },
    { label: "أصناف متاحة", value: formatInt(24), hint: "في كتالوج فرعك" },
    { label: "مستودعات فرعك", value: formatInt(2), hint: "تخدم مبيعاتك" },
  ];
}

function tableFor(roleId, branchIds) {
  if (roleId === "CS_AGENT") {
    const shown = SELF_TODAY_INVOICES.shown;
    return {
      title: "فواتير اليوم",
      hint: `ظهر ${shown.length} من ${counted(shown.length + SELF_TODAY_INVOICES.hiddenCount, "فاتورة", "فواتير")}`,
      columns: ["الفاتورة", "الوقت", "المبلغ", "الحالة"],
      rows: shown.map((row) => [row.id, row.time, formatMoney(row.amount), row.status]),
      footer: `＋ ${counted(SELF_TODAY_INVOICES.hiddenCount, "فاتورة أخرى", "فواتير أخرى")} بإجمالي ${formatMoney(SELF_TODAY_INVOICES.hiddenTotal)}`,
      footerTotal: formatMoney(sum(shown.map((r) => r.amount)) + SELF_TODAY_INVOICES.hiddenTotal),
    };
  }
  const branches = BRANCHES.filter((b) => branchIds.includes(b.id));
  return {
    title: roleId === "MANAGER" ? "الفروع" : "عهدة الفرع",
    hint: "الأرقام بعد التصفية",
    columns: ["الفرع", "المدينة", "خزنة الفرع", "المتوقَّع في العهد", "مبيعات الأسبوع"],
    rows: branches.map((branch) => [
      branch.nameAr,
      branch.city,
      formatMoney(branch.vault),
      formatMoney(sum(custodiesOf([branch.id]).map(expectedInHand))),
      formatMoney(sum(branch.weekSales)),
    ]),
    footer: `${counted(branches.length, "فرع", "فروع")} · ${counted(sum(branches.map((b) => b.warehouses.length)), "مستودع", "مستودعات")}`,
    footerTotal: formatMoney(sum(branches.map((b) => sum(b.weekSales)))),
  };
}

/**
 * يبني نموذج العرض الكامل لدور ونطاق محدَّدين.
 * @param {{ role?: string, branchId?: string | null, now?: Date }} input
 */
export function buildDashboard(input = {}) {
  const roleId = ROLE_IDS.includes(input.role) ? input.role : "MANAGER";
  const role = ROLES[roleId];
  const now = input.now ?? new Date();
  const branchId = role.canFilterBranch && input.branchId ? input.branchId : role.branchId;
  const branchIds = branchId ? [branchId] : BRANCHES.map((branch) => branch.id);
  const focus = focusFor(roleId, branchIds);

  return {
    role,
    branchId,
    scope: {
      label: branchId ? (BRANCHES.find((b) => b.id === branchId)?.nameAr ?? role.scopeLabel) : "كل الفروع",
      canFilter: role.canFilterBranch,
      options: [{ id: "", label: "كل الفروع" }, ...BRANCHES.map((b) => ({ id: b.id, label: b.nameAr }))],
    },
    heading: {
      greeting: `أهلًا بك، ${role.first}`,
      eyebrow: `اليوم · ${formatDate(now)}`,
      subtitle:
        roleId === "MANAGER"
          ? "رقم واحد يجمع ما يحتاج قرارك، ورقم واحد يجمع مال الشركة الآن."
          : roleId === "ACCOUNTANT"
          ? "ما يتحرّك تحت يدك قبل أن يتحرّك غيرك."
          : "ما يجب أن يكون في يدك فعلًا، وما أنجزته اليوم.",
    },
    focus: {
      ...focus,
      label: FOCUS_HEADLINE[roleId].label,
      unit: FOCUS_HEADLINE[roleId].unit,
      note: FOCUS_HEADLINE[roleId].note,
    },
    money: moneyFor(roleId, branchIds),
    chart: chartFor(roleId, branchIds, now),
    tiles: tilesFor(roleId, branchIds),
    table: tableFor(roleId, branchIds),
    shortcuts: SHORTCUTS[roleId],
  };
}

/* ============================================================
   الهيكل العام والأنماط المشتركة
   نفس قاعدة البيانات الافتراضية، مبنية للأجزاء المشتركة بين
   كل الشاشات: القائمة، والتنبيهات، والجدول الكثيف.
   ============================================================ */

/** القائمة الجانبية — لكل دور ما يفتحه فعلاً، لا كل ما في النظام. */
export const NAV = [
  {
    label: "الرئيسية",
    items: [
      { id: "dashboard", label: "لوحة القيادة", icon: "dashboard", href: "/dashboard" },
      { id: "tasks", label: "مهامي", icon: "check", href: "/tasks" },
    ],
  },
  {
    label: "المبيعات",
    items: [
      { id: "sales-new", label: "فاتورة جديدة", icon: "sales", href: "/sales/new" },
      { id: "sales", label: "الفواتير", icon: "receipt", href: "/sales" },
      { id: "stats", label: "الإحصاءات", icon: "stockValue", href: "/sales/stats" },
    ],
  },
  {
    label: "المالية",
    items: [
      { id: "custody", label: "العهدة والخزنة", icon: "cash", href: "/finance" },
      { id: "settlements", label: "التسويات", icon: "settlement", href: "/finance/transfers" },
      { id: "expenses", label: "المصروفات", icon: "expenses", href: "/finance/expenses" },
      { id: "counts", label: "الجرد", icon: "clock", href: "/finance/counts" },
    ],
  },
  {
    label: "المخزون",
    items: [
      { id: "inventory", label: "الأصناف", icon: "products", href: "/inventory" },
      { id: "receipts", label: "الاستلام", icon: "warehouse", href: "/inventory/receipts" },
    ],
  },
  {
    label: "الإعدادات",
    items: [
      { id: "branches", label: "الفروع والمستودعات", icon: "branch", href: "/setup/branches" },
      { id: "users", label: "المستخدمون", icon: "users", href: "/admin" },
      { id: "setup", label: "إعدادات النظام", icon: "settings", href: "/setup" },
    ],
  },
];

/** ما يراه كل دور من القائمة — الموظف لا يفتح المالية ولا الإعدادات. */
const MENU_SCOPE = {
  MANAGER: ["dashboard", "tasks", "sales-new", "sales", "stats", "custody", "settlements", "expenses", "counts", "inventory", "receipts", "branches", "users", "setup"],
  ACCOUNTANT: ["dashboard", "tasks", "sales", "custody", "settlements", "expenses", "counts", "inventory", "receipts"],
  CS_AGENT: ["dashboard", "tasks", "sales-new", "sales", "counts"],
};

/** معرّفات «ما يحتاج إجراءً» التي تُغذّي شارات القائمة — مصدر واحد للعدد. */
const BADGE_GROUPS = {
  tasks: ["approve-expenses", "approve-settlements", "stale-settlement", "pay-expenses", "pay", "confirm", "pending", "count", "my-expense", "outstanding"],
  settlements: ["approve-settlements", "stale-settlement", "confirm", "count"],
  expenses: ["approve-expenses", "pay-expenses", "pay", "pending", "my-expense"],
};

export function badgesFor(roleId, branchIds = BRANCHES.map((b) => b.id)) {
  const items = (FOCUS[roleId] ?? []);
  const count = (ids) =>
    sum(ids.flatMap((id) => {
      const item = items.find((entry) => entry.id === id);
      return item ? branchIds.map((branch) => item.perBranch[branch]?.count ?? 0) : [];
    }));
  return {
    tasks: count(BADGE_GROUPS.tasks),
    settlements: count(BADGE_GROUPS.settlements),
    expenses: count(BADGE_GROUPS.expenses),
  };
}

/** القائمة بعد تصفية الدور وحساب الشارات من مصدر واحد. */
export function navFor(roleId, branchIds = BRANCHES.map((b) => b.id)) {
  const scope = MENU_SCOPE[roleId] ?? MENU_SCOPE.MANAGER;
  const badges = badgesFor(roleId, branchIds);
  return NAV.map((group) => ({
    label: group.label,
    items: group.items
      .filter((item) => scope.includes(item.id))
      .map((item) => ({ ...item, badge: badges[item.id] ?? 0 })),
  })).filter((group) => group.items.length > 0);
}

/** التنبيهات أعلى الصفحة — أحدثها أولًا. */
export const NOTIFICATIONS = [
  { id: "n1", tone: "is-red", icon: "alert", title: "طلب تسوية ST-1039 فيه عجز ٨٤.٠٠ ج.م", time: "قبل ١٢ دقيقة", unread: true },
  { id: "n2", tone: "is-warning", icon: "expenses", title: "٤ مصروفات بانتظار اعتمادك", time: "قبل ساعة", unread: true },
  { id: "n3", tone: "is-info", icon: "settlement", title: "نور الهدى سلّمت تسوية بانتظار تأكيدك", time: "قبل ٣ ساعات", unread: true },
  { id: "n4", tone: "is-teal", icon: "check", title: "اعتمدتَ تسوية ST-1037", time: "أمس", unread: false },
];

export function unreadCount() {
  return NOTIFICATIONS.filter((item) => item.unread).length;
}

/**
 * جدول كثيف يمثّل شاشة التسويات: المعدود مقابل المتوقَّع، والفرق هو
 * العجز الحقيقي — لا حصيلة الفترة.
 */
export const SETTLEMENT_ROWS = [
  { id: "ST-1041", employee: "إبراهيم عيد", branch: "العريش", counted: 315_000, expected: 315_000, status: "بانتظار الاعتماد", tone: "amber" },
  { id: "ST-1040", employee: "نور الهدى فتحي", branch: "العريش", counted: 187_500, expected: 187_500, status: "بانتظار التأكيد", tone: "blue" },
  { id: "ST-1039", employee: "محمود فتحي", branch: "الشيخ زويد", counted: 260_000, expected: 268_400, status: "بانتظار الاعتماد", tone: "amber" },
  { id: "ST-1038", employee: "سارة عادل", branch: "بئر العبد", counted: 154_600, expected: 154_600, status: "بانتظار الاعتماد", tone: "amber" },
  { id: "ST-1037", employee: "محمود فتحي", branch: "الشيخ زويد", counted: 322_000, expected: 322_000, status: "مؤكَّدة", tone: "teal" },
  { id: "ST-1036", employee: "إبراهيم عيد", branch: "العريش", counted: 291_000, expected: 294_000, status: "مؤكَّدة", tone: "teal" },
  { id: "ST-1034", employee: "سارة عادل", branch: "بئر العبد", counted: 218_000, expected: 218_000, status: "بطلت بحركة نقدية", tone: "red" },
  { id: "ST-1035", employee: "نور الهدى فتحي", branch: "العريش", counted: 160_000, expected: 160_000, status: "ملغاة", tone: "gray" },
];

const OPEN_STATUSES = ["بانتظار الاعتماد", "بانتظار التأكيد"];

export const settlementTable = {
  columns: ["رقم الطلب", "الموظف", "الفرع", "المعدود", "المتوقَّع", "الفرق", "الحالة", ""],
  rows: SETTLEMENT_ROWS,
  /** الفرق = المعدود − المتوقَّع: سالبه عجز حقيقي، وموجبه زيادة. */
  diff: (row) => row.counted - row.expected,
  isOpen: (row) => OPEN_STATUSES.includes(row.status),
};

/** مجاميع الجدول — تُعرض في تذييله. */
export function settlementTotals() {
  const rows = SETTLEMENT_ROWS;
  const open = rows.filter(settlementTable.isOpen);
  const shortage = sum(rows.map((row) => (settlementTable.diff(row) < 0 ? -settlementTable.diff(row) : 0)));
  return {
    rows: rows.length,
    open: open.length,
    openValue: sum(open.map((row) => row.expected)),
    shortage,
    counted: sum(open.map((row) => row.counted)),
  };
}

/** شريط أرقام كثيف أعلى الجدول: ستة أرقام في سطر واحد. */
export function shellStats() {
  const totals = settlementTotals();
  return [
    { label: "طلبات معلّقة", value: formatInt(totals.open), hint: "بانتظار اعتماد أو تأكيد" },
    { label: "قيمة المعلّق", value: formatMoney(totals.openValue), unit: "ج.م", hint: "ما لم يُسلَّم بعد" },
    { label: "مؤكَّدة اليوم", value: formatInt(2), hint: "أُتمّت اليوم" },
    { label: "عجز الجرد", value: formatMoney(totals.shortage), unit: "ج.م", hint: "المعدود أقل من المتوقَّع" },
    { label: "زمن الاعتماد", value: "3", unit: "ساعات", hint: "المتوسط هذا الأسبوع" },
    { label: "تسويات الأسبوع", value: formatInt(12), hint: "مؤكَّدة وملغاة" },
  ];
}

/** خيارات شريط التصفية — تُبنى من الفروع والحالات المعروفة. */
export const FILTERS = {
  branch: [{ id: "", label: "كل الفروع" }, ...BRANCHES.map((b) => ({ id: b.id, label: b.nameAr }))],
  status: [
    { id: "", label: "كل الحالات" },
    { id: "open", label: "معلّقة" },
    { id: "confirmed", label: "مؤكَّدة" },
    { id: "cancelled", label: "ملغاة ومبطلة" },
  ],
  period: [
    { id: "7", label: "آخر ٧ أيام" },
    { id: "30", label: "آخر ٣٠ يومًا" },
    { id: "month", label: "هذا الشهر" },
  ],
};

/** خيارات النطاق للمدير في شريط المعاينة. */
export function scopeOptions() {
  return [{ id: "", label: "كل الفروع" }, ...BRANCHES.map((b) => ({ id: b.id, label: b.nameAr }))];
}
