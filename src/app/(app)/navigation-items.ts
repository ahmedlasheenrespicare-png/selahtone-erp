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

/** Keep the existing role-specific navigation and label unfinished pages clearly.
 * The finance entry appears only when the staged finance module is switched on,
 * which requires an applied, reviewed migration; otherwise nothing changes. */
export function navigationGroups(canViewAllBranches: boolean, financeEnabled = false): NavigationGroup[] {
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
            ...(financeEnabled ? [{ label: "المالية", icon: "cash" as const, href: "/finance" }] : []),
            { label: "المصروفات", icon: "expenses" },
            { label: "العهد النقدية", icon: "cash" },
            { label: "التقارير الضريبية", icon: "reports" },
          ],
        }
      : {
          label: "أعمال الفرع",
          items: [
            ...(financeEnabled ? [{ label: "عهدتي", icon: "cash" as const, href: "/finance" }] : [{ label: "عهدتي", icon: "cash" as const }]),
            { label: "إيرادي اليومي", icon: "receipt" },
          ],
        },
  ];
}

export function isCurrentPath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
