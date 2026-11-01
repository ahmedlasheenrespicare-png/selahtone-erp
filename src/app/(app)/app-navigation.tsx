"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { AppIcon } from "@/components/app-icon";
import { BrandMark } from "@/components/brand-mark";
import type { MenuScope } from "@/lib/menu-scope";
import { isCurrentPath, navigationGroups } from "./navigation-items";

type AppNavigationProps = {
  canViewAllBranches: boolean;
  financeEnabled?: boolean;
  menuScope?: MenuScope;
  inventoryEnabled?: boolean;
};

export function AppNavigation({ canViewAllBranches, financeEnabled = false, menuScope = "FULL", inventoryEnabled = false }: AppNavigationProps) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  // يُفتح الأب منسدلًا إن كان المسار الحالي داخل أحد أبنائه، فلا يضيع موضع
  // الموظف حين ينتقل بين شاشات البيع.
  const [openParents, setOpenParents] = useState<string[]>(() =>
    navigationGroups(canViewAllBranches, financeEnabled, menuScope, inventoryEnabled)
      .flatMap((group) => group.items)
      .filter((item) => item.children?.some((child) => child.href && isCurrentPath(pathname, child.href)))
      .map((item) => item.label),
  );
  function toggleParent(label: string): void {
    setOpenParents((open) => (open.includes(label) ? open.filter((entry) => entry !== label) : [...open, label]));
  }

  return (
    <aside
      className="workspace-sidebar"
      onKeyDown={(event) => {
        if (event.key === "Escape" && menuOpen) {
          setMenuOpen(false);
          toggleRef.current?.focus();
        }
      }}
    >
      <div className="workspace-sidebar__brand-row">
        <Link href="/dashboard" className="workspace-brand" onClick={() => setMenuOpen(false)} aria-label="صلة تون، لوحة القيادة">
          <BrandMark className="workspace-brand__mark" />
          <span className="workspace-brand__text">
            <strong>صله <span>تون</span></strong>
            <small dir="ltr">SELATONE HEARING</small>
          </span>
        </Link>
        <button
          ref={toggleRef}
          className="workspace-nav-toggle"
          type="button"
          aria-expanded={menuOpen}
          aria-controls="workspace-navigation"
          aria-label={menuOpen ? "إغلاق القائمة" : "فتح القائمة"}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <AppIcon name={menuOpen ? "close" : "menu"} />
        </button>
      </div>

      <nav id="workspace-navigation" className={`workspace-navigation${menuOpen ? " is-open" : ""}`} aria-label="التنقل الرئيسي">
        {navigationGroups(canViewAllBranches, financeEnabled, menuScope, inventoryEnabled).map((group) => (
          <div className="workspace-nav-group" key={group.label}>
            <p className="workspace-nav-group__label">{group.label}</p>
            <ul>
              {group.items.map((item) => (
                <li key={item.label}>
                  {item.children?.length ? (
                    <>
                      <button
                        type="button"
                        className="workspace-nav-item workspace-nav-parent"
                        aria-expanded={openParents.includes(item.label)}
                        aria-controls={`subnav-${item.label}`}
                        onClick={() => toggleParent(item.label)}
                      >
                        <AppIcon name={item.icon} />
                        <span>{item.label}</span>
                        <AppIcon name="arrow" className={`workspace-nav-chevron${openParents.includes(item.label) ? " is-open" : ""}`} />
                      </button>
                      {openParents.includes(item.label) ? (
                        <ul id={`subnav-${item.label}`} className="workspace-nav-sublist">
                          {item.children.map((child) => (
                            <li key={child.label}>
                              {child.href ? (
                                <Link
                                  href={child.href}
                                  className={`workspace-nav-item workspace-nav-subitem${isCurrentPath(pathname, child.href) ? " is-active" : ""}`}
                                  aria-current={isCurrentPath(pathname, child.href) ? "page" : undefined}
                                  onClick={() => setMenuOpen(false)}
                                >
                                  <AppIcon name={child.icon} />
                                  <span>{child.label}</span>
                                  {isCurrentPath(pathname, child.href) && <span className="workspace-nav-item__indicator" aria-hidden="true" />}
                                </Link>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </>
                  ) : item.href ? (
                    <Link
                      href={item.href}
                      className={`workspace-nav-item${isCurrentPath(pathname, item.href) ? " is-active" : ""}`}
                      aria-current={isCurrentPath(pathname, item.href) ? "page" : undefined}
                      onClick={() => setMenuOpen(false)}
                    >
                      <AppIcon name={item.icon} />
                      <span>{item.label}</span>
                      {isCurrentPath(pathname, item.href) && <span className="workspace-nav-item__indicator" aria-hidden="true" />}
                    </Link>
                  ) : (
                    <span className="workspace-nav-item is-disabled" aria-disabled="true">
                      <AppIcon name={item.icon} />
                      <span>{item.label}</span>
                      <small>قريبًا</small>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="workspace-sidebar__foot">
        <span className="workspace-sidebar__foot-icon"><AppIcon name="check" /></span>
        <span><strong>مساحة عملك</strong><small>{canViewAllBranches ? "إدارة أوضح لكل الفروع" : "متابعة أوضح لفرعك"}</small></span>
      </div>
    </aside>
  );
}
