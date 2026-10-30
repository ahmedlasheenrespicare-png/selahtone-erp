import type { AppIconName } from "@/components/app-icon";
import { type MenuScope } from "@/lib/menu-scope";

export type NavigationItem = {
  label: string;
  icon: AppIconName;
  href?: string;
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

export function navigationGroups(canViewAllBranches: boolean, financeEnabled = false, menuScope: MenuScope = "FULL"): NavigationGroup[] {
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
      { label: "المبيعات والمخزون", items: [SALES, INVENTORY] },
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
        SALES,
        INVENTORY,
        ...(financeEnabled
          ? [
              { label: "عهدتي", icon: "cash" as const, href: "/finance/mine" },
              { label: "مصروفاتي", icon: "expenses" as const, href: "/finance/expenses" },
              { label: "تسجيل مصروف", icon: "expenses" as const, href: "/finance/expenses/new" },
            ]
          : []),
      ],
    },
  ];
}

export function isCurrentPath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
