import type { AppIconName } from "@/components/app-icon";
import type { MenuScope } from "@/lib/menu-scope";

export type NavigationItem = {
  label: string;
  icon: AppIconName;
  href?: string;
  /** عناصر فرعية تُعرض منسدلة عند الضغط على العنصر الأب. */
  children?: NavigationItem[];
};

export type NavigationGroup = {
  label: string;
  items: NavigationItem[];
};

/**
 * Role-specific navigation. Unfinished pages are no longer listed as dead
 * labels: every rendered item has a real destination, so the menu never shows
 * something that cannot be opened. The finance group appears only when the
 * staged module is switched on, which requires an applied, reviewed migration.
 */
const DASHBOARD: NavigationItem = { label: "لوحة القيادة", icon: "dashboard", href: "/dashboard" };
const SALES: NavigationItem = { label: "المبيعات والفواتير", icon: "sales", href: "/sales" };
const INVENTORY: NavigationItem = { label: "المخزون والمستودعات", icon: "inventory", href: "/inventory" };

/**
 * شاشات البيع منسدلةً تحت «المبيعات»: ثلاث منها مدير فقط (إحصائيات المبيعات،
 * أصناف البيع، حد خصم الموظف) تحرسها صفحاتُها نفسها. فلا تُعرض لمن يرفضه
 * الحارس، وإلا صار في القائمة رابطٌ يُحوّل صاحبه إلى لوحته كلما ضغطه.
 */
const SALES_MANAGER_CHILDREN: NavigationItem[] = [
  { label: "المبيعات والفواتير", icon: "receipt", href: "/sales" },
  { label: "بيع جديد", icon: "arrow", href: "/sales/new" },
  { label: "إحصائيات المبيعات", icon: "reports", href: "/sales/stats" },
  { label: "أصناف البيع", icon: "products", href: "/sales/catalog" },
  { label: "حد خصم الموظف", icon: "settings", href: "/sales/settings" },
];
const SALES_EMPLOYEE_CHILDREN: NavigationItem[] = SALES_MANAGER_CHILDREN.filter(
  (item) => item.href === "/sales" || item.href === "/sales/new",
);
const SALES_PARENT: NavigationItem = { label: "المبيعات", icon: "sales", children: SALES_MANAGER_CHILDREN };
const SALES_EMPLOYEE_PARENT: NavigationItem = { label: "المبيعات", icon: "sales", children: SALES_EMPLOYEE_CHILDREN };

export function navigationGroups(
  canViewAllBranches: boolean,
  financeEnabled = false,
  menuScope: MenuScope = "FULL",
  inventoryEnabled = false,
): NavigationGroup[] {
  if (menuScope === "LIMITED") {
    return [
      { label: "الرئيسية", items: [DASHBOARD] },
      { label: "المبيعات", items: [SALES] },
      ...(financeEnabled
        ? [{
            label: "المالية",
            items: [
              { label: "المصروفات", icon: "expenses" as const, href: "/finance/expenses" },
              { label: "تسجيل مصروف", icon: "expenses" as const, href: "/finance/expenses/new" },
            ],
          }]
        : []),
    ];
  }

  const financeGroups: NavigationGroup[] = financeEnabled
    ? [
        {
          label: "المالية",
          items: [
            { label: "الحسابات", icon: "cash", href: "/finance" },
            { label: "الخزائن والعهد", icon: "cash", href: "/finance/accounts" },
            { label: "التحويلات والتسليم", icon: "arrow", href: "/finance/transfers" },
            { label: "المصروفات", icon: "expenses", href: "/finance/expenses" },
            { label: "الجرد", icon: "check", href: "/finance/counts" },
            { label: "البنود", icon: "products", href: "/finance/categories" },
          ],
        },
      ]
    : [];

  if (canViewAllBranches) {
    return [
      { label: "الرئيسية", items: [DASHBOARD] },
      { label: inventoryEnabled ? "المبيعات والمخزون" : "المبيعات", items: inventoryEnabled ? [SALES_PARENT, INVENTORY] : [SALES_PARENT] },
      ...financeGroups,
      {
        label: "الإدارة",
        items: [
          { label: "الفروع والمستخدمون", icon: "branch", href: "/admin" },
          { label: "التحقق من الإعداد", icon: "settings", href: "/setup" },
        ],
      },
    ];
  }

  return [
    { label: "الرئيسية", items: [DASHBOARD] },
    {
      label: "أعمال الفرع",
      items: [
        SALES_EMPLOYEE_PARENT,
        ...(inventoryEnabled ? [INVENTORY] : []),
        ...(financeEnabled
          ? [
              { label: "عهدتي", icon: "cash" as const, href: "/finance/mine" },
              { label: "مصروفاتي", icon: "expenses" as const, href: "/finance/expenses" },
              { label: "تسجيل مصروف", icon: "expenses" as const, href: "/finance/expenses/new" },
              { label: "طلب تسوية", icon: "cash" as const, href: "/finance/settlements" },
            ]
          : []),
      ],
    },
  ];
}

export function isCurrentPath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export type BottomDockRole = "MANAGER" | "ACCOUNTANT" | "CS_AGENT";

export type BottomDockItem = {
  id: string;
  label: string;
  icon: AppIconName;
  href?: string;
  action?: "open-menu";
  featured?: boolean;
};

/**
 * أهم خمس صفحات في الشريط السفلي المثبّت للجوال والشاشات الضيقة (<= 820px)،
 * مخصّصة حسب صلاحيات كل دور ونطاق القائمة (FULL / LIMITED) وتفعيل الوحدات
 * بحيث لا يظهر لأي مستخدم تبويب غير مصرّح له.
 */
export function mobileBottomDockItems(
  role: BottomDockRole,
  financeEnabled = false,
  menuScope: MenuScope = "FULL",
  inventoryEnabled = false,
): BottomDockItem[] {
  if (menuScope === "LIMITED") {
    if (financeEnabled) {
      if (role === "ACCOUNTANT") {
        return [
          { id: "dashboard", label: "الرئيسية", icon: "dashboard", href: "/dashboard" },
          { id: "sales", label: "الفواتير", icon: "receipt", href: "/sales" },
          { id: "new-expense", label: "مصروف جديد", icon: "plusCircle", href: "/finance/expenses/new", featured: true },
          { id: "expenses", label: "المصروفات", icon: "expenses", href: "/finance/expenses" },
          { id: "menu", label: "القائمة", icon: "menu", action: "open-menu" },
        ];
      }
      return [
        { id: "dashboard", label: "الرئيسية", icon: "dashboard", href: "/dashboard" },
        { id: "sales", label: "الفواتير", icon: "receipt", href: "/sales" },
        { id: "new-sale", label: "بيع جديد", icon: "plusCircle", href: "/sales/new", featured: true },
        { id: "expenses", label: "المصروفات", icon: "expenses", href: "/finance/expenses" },
        { id: "new-expense", label: "مصروف جديد", icon: "plusDoc", href: "/finance/expenses/new" },
      ];
    }

    if (role === "ACCOUNTANT") {
      return [
        { id: "dashboard", label: "الرئيسية", icon: "dashboard", href: "/dashboard" },
        { id: "sales", label: "الفواتير", icon: "receipt", href: "/sales", featured: true },
        { id: "password", label: "كلمة المرور", icon: "lock", href: "/change-password" },
        { id: "menu", label: "القائمة", icon: "menu", action: "open-menu" },
      ];
    }

    return [
      { id: "dashboard", label: "الرئيسية", icon: "dashboard", href: "/dashboard" },
      { id: "sales", label: "الفواتير", icon: "receipt", href: "/sales" },
      { id: "new-sale", label: "بيع جديد", icon: "plusCircle", href: "/sales/new", featured: true },
      ...(role === "MANAGER"
        ? [{ id: "sales-stats", label: "الإحصائيات", icon: "reports" as const, href: "/sales/stats" }]
        : [{ id: "password", label: "كلمة المرور", icon: "lock" as const, href: "/change-password" }]),
      { id: "menu", label: "القائمة", icon: "menu", action: "open-menu" },
    ];
  }

  if (role === "MANAGER") {
    if (financeEnabled) {
      return [
        { id: "dashboard", label: "الرئيسية", icon: "dashboard", href: "/dashboard" },
        { id: "sales", label: "الفواتير", icon: "receipt", href: "/sales" },
        { id: "new-sale", label: "بيع جديد", icon: "plusCircle", href: "/sales/new", featured: true },
        { id: "finance", label: "الحسابات", icon: "cash", href: "/finance" },
        { id: "expenses", label: "المصروفات", icon: "expenses", href: "/finance/expenses" },
      ];
    }
    return [
      { id: "dashboard", label: "الرئيسية", icon: "dashboard", href: "/dashboard" },
      { id: "sales", label: "الفواتير", icon: "receipt", href: "/sales" },
      { id: "new-sale", label: "بيع جديد", icon: "plusCircle", href: "/sales/new", featured: true },
      { id: "sales-stats", label: "الإحصائيات", icon: "reports", href: "/sales/stats" },
      inventoryEnabled
        ? { id: "inventory", label: "المخزون", icon: "inventory", href: "/inventory" }
        : { id: "admin", label: "الإدارة", icon: "branch", href: "/admin" },
    ];
  }

  if (role === "ACCOUNTANT") {
    if (financeEnabled) {
      return [
        { id: "dashboard", label: "الرئيسية", icon: "dashboard", href: "/dashboard" },
        { id: "sales", label: "الفواتير", icon: "receipt", href: "/sales" },
        { id: "finance", label: "الحسابات", icon: "cash", href: "/finance", featured: true },
        { id: "transfers", label: "التسليمات", icon: "transfers", href: "/finance/transfers" },
        { id: "expenses", label: "المصروفات", icon: "expenses", href: "/finance/expenses" },
      ];
    }
    return [
      { id: "dashboard", label: "الرئيسية", icon: "dashboard", href: "/dashboard" },
      { id: "sales", label: "الفواتير", icon: "receipt", href: "/sales" },
      { id: "admin", label: "الإدارة", icon: "branch", href: "/admin", featured: true },
      inventoryEnabled
        ? { id: "inventory", label: "المخزون", icon: "inventory", href: "/inventory" }
        : { id: "setup", label: "الإعداد", icon: "settings", href: "/setup" },
      { id: "menu", label: "القائمة", icon: "menu", action: "open-menu" },
    ];
  }

  // موظف الكاونتر / الفرع (CS_AGENT)
  if (financeEnabled) {
    return [
      { id: "dashboard", label: "الرئيسية", icon: "dashboard", href: "/dashboard" },
      { id: "sales", label: "الفواتير", icon: "receipt", href: "/sales" },
      { id: "new-sale", label: "بيع جديد", icon: "plusCircle", href: "/sales/new", featured: true },
      { id: "custody", label: "عهدتي", icon: "cash", href: "/finance/mine" },
      { id: "expenses", label: "مصروفاتي", icon: "expenses", href: "/finance/expenses" },
    ];
  }

  return [
    { id: "dashboard", label: "الرئيسية", icon: "dashboard", href: "/dashboard" },
    { id: "sales", label: "الفواتير", icon: "receipt", href: "/sales" },
    { id: "new-sale", label: "بيع جديد", icon: "plusCircle", href: "/sales/new", featured: true },
    inventoryEnabled
      ? { id: "inventory", label: "المخزون", icon: "inventory", href: "/inventory" }
      : { id: "password", label: "كلمة المرور", icon: "lock", href: "/change-password" },
    { id: "menu", label: "القائمة", icon: "menu", action: "open-menu" },
  ];
}

/**
 * يختار التبويب الأدق مطابقةً للمسار الحالي (الأطول بادئةً)،
 * حتى لا يضيء «الفواتير» (/sales) مع «بيع جديد» (/sales/new) في الوقت نفسه،
 * ولا يضيء «الحسابات» (/finance) مع «المصروفات» (/finance/expenses) أو «التسليمات» (/finance/transfers).
 */
export function resolveActiveBottomDockHref(
  pathname: string,
  items: readonly BottomDockItem[],
): string | null {
  let bestHref: string | null = null;
  for (const item of items) {
    if (!item.href) continue;
    if (isCurrentPath(pathname, item.href)) {
      if (!bestHref || item.href.length > bestHref.length) {
        bestHref = item.href;
      }
    }
  }
  return bestHref;
}
