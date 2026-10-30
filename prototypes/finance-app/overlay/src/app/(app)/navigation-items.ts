import type { AppIconName } from "@/components/app-icon";

export type NavigationItem = {
  label: string;
  icon: AppIconName;
  href?: string;
};

export type NavigationGroup = {
  label: string;
  items: NavigationItem[];
};

/** Keep the existing role-specific navigation and label unfinished pages clearly. */
export function navigationGroups(canViewAllBranches: boolean): NavigationGroup[] {
  return [
    {
      label: "الرئيسية",
      items: [
        { label: "لوحة القيادة", icon: "dashboard", href: "/dashboard" },
        { label: "المخزون والمستودعات", icon: "inventory", href: "/inventory" },
        { label: "المبيعات والفواتير", icon: "sales", href: "/sales" },
      ],
    },
    canViewAllBranches
      ? {
          label: "الإدارة والمتابعة",
          items: [
            { label: "التحقق من الإعداد", icon: "settings", href: "/setup" },
            { label: "المصروفات والعهد", icon: "expenses", href: "/finance" },
            
            { label: "التقارير الضريبية", icon: "reports" },
          ],
        }
      : {
          label: "أعمال الفرع",
          items: [
            { label: "عهدتي", icon: "cash", href: "/finance" },
            { label: "إيرادي اليومي", icon: "receipt" },
          ],
        },
  ];
}

export function isCurrentPath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
