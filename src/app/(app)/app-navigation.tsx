"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { AppIcon } from "@/components/app-icon";
import { accessKeyAllowed } from "@/lib/access-control";
import { BrandMark } from "@/components/brand-mark";
import ColorModeToggle from "@/components/color-mode-toggle";
import { LuckyPantherSwitch } from "@/components/lucky-panther-switch";
import { SelatoneFacebookLogo, SelatoneFacebookMark } from "@/components/selatone-facebook-logo";
import { WORKSPACE_THEME_GROUPS } from "@/lib/workspace-theme";
import LogoutButton from "./logout-button";
import {
  mobileBottomDockItems,
  resolveActiveBottomDockHref,
  resolveActiveSidebarHref,
  sidebarNavigationGroups,
  type BottomDockRole,
  type NavigationAccess,
  type SidebarNavBadges,
} from "./navigation-items";
import { useWorkspaceTheme } from "./workspace-theme-provider";

type AppNavigationProps = {
  canViewAllBranches: boolean;
  role?: BottomDockRole;
  financeEnabled?: boolean;
  access?: { hiddenPages: string[]; showAdministration: boolean };
  inventoryEnabled?: boolean;
  badges?: SidebarNavBadges;
  userName?: string;
  roleLabel?: string;
  branchLabel?: string;
};

export function AppNavigation({
  canViewAllBranches,
  role,
  financeEnabled = false,
  access,
  inventoryEnabled = false,
  badges,
  userName = "مستخدم النظام",
  roleLabel = "مساحة العمل",
  branchLabel = "كل الفروع",
}: AppNavigationProps) {
  const pathname = usePathname();
  const { theme, setTheme, dashboardBgByTheme, setThemeDashboardBg, clock } = useWorkspaceTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  // قسم المظهر مطوي افتراضيًا لتقليل طول القائمة الجانبية وإبراز العمليات اليومية.
  const [themeOpen, setThemeOpen] = useState(false);
  const [openThemeGroups, setOpenThemeGroups] = useState<string[]>(() =>
    WORKSPACE_THEME_GROUPS.map((group) => group.id),
  );
  const toggleRef = useRef<HTMLButtonElement>(null);
  const navigationRef = useRef<HTMLElement>(null);
  const accountTriggerRef = useRef<HTMLButtonElement>(null);
  const accountPopoverRef = useRef<HTMLDivElement>(null);
  const menuWasOpenRef = useRef(false);
  const accountWasOpenRef = useRef(false);
  const [accountPopoverPosition, setAccountPopoverPosition] = useState<CSSProperties | null>(null);

  const effectiveRole: BottomDockRole = role ?? (canViewAllBranches ? "MANAGER" : "CS_AGENT");
  const navigationAccess: NavigationAccess | undefined = access && {
    showAdministration: access.showAdministration,
    isPageAllowed: (href) => accessKeyAllowed(new Set(access.hiddenPages), href),
  };
  const navGroups = sidebarNavigationGroups(effectiveRole, {
    financeEnabled,
    access: navigationAccess,
    inventoryEnabled,
    badges,
  });

  const activeSidebarHref = resolveActiveSidebarHref(pathname, navGroups);

  // يُفتح الأب منسدلًا فقط إن كان المسار الفعّال داخل أحد أبنائه (قوائم المبيعات والمخزون والتهيئة).
  const [openParents, setOpenParents] = useState<string[]>(() =>
    navGroups
      .flatMap((group) => group.items)
      .filter((item) => item.children?.some((child) => child.href === activeSidebarHref))
      .map((item) => item.label),
  );

  useEffect(() => {
    // التنقل بالروابط أو بأزرار المتصفح يبدأ صفحة جديدة بلا بقاء لوحات الجوال فوقها.
    setAccountOpen(false);
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) {
      if (menuWasOpenRef.current) toggleRef.current?.focus();
      menuWasOpenRef.current = false;
      return;
    }
    menuWasOpenRef.current = true;
    const frame = window.requestAnimationFrame(() => {
      navigationRef.current
        ?.querySelector<HTMLElement>('[aria-current="page"], button, a[href]')
        ?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [menuOpen]);

  useEffect(() => {
    if (!accountOpen) {
      if (accountWasOpenRef.current) accountTriggerRef.current?.focus();
      accountWasOpenRef.current = false;
      return;
    }
    accountWasOpenRef.current = true;
    const frame = window.requestAnimationFrame(() => {
      accountPopoverRef.current?.querySelector<HTMLElement>("a[href], button")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [accountOpen]);

  useEffect(() => {
    if (!activeSidebarHref) return;
    const matchingParent = navGroups
      .flatMap((group) => group.items)
      .find((item) => item.children?.some((child) => child.href === activeSidebarHref));
    if (matchingParent) {
      setOpenParents((prev) =>
        prev.includes(matchingParent.label) ? prev : [...prev, matchingParent.label],
      );
    }
  }, [activeSidebarHref]);

  useEffect(() => {
    if (!accountOpen) {
      setAccountPopoverPosition(null);
      return;
    }

    function positionPopover(): void {
      const trigger = accountTriggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const width = Math.max(0, Math.min(304, window.innerWidth - 36));
      const left = Math.min(
        Math.max(18, rect.right - width),
        Math.max(18, window.innerWidth - width - 18),
      );
      const naturalHeight = Math.min(
        accountPopoverRef.current?.offsetHeight || 220,
        window.innerHeight - 24,
      );
      const belowTop = rect.bottom + 10;
      const top = belowTop + naturalHeight <= window.innerHeight - 12
        ? belowTop
        : Math.max(12, rect.top - naturalHeight - 10);
      setAccountPopoverPosition({
        position: "fixed",
        top,
        left,
        width,
        maxHeight: Math.max(120, window.innerHeight - top - 12),
      });
    }

    function handlePointerDown(event: MouseEvent): void {
      const target = event.target as Node | null;
      if (!target) return;
      if (accountTriggerRef.current?.contains(target)) return;
      if (accountPopoverRef.current?.contains(target)) return;
      setAccountOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      setAccountOpen(false);
      accountTriggerRef.current?.focus();
    }

    positionPopover();
    window.addEventListener("resize", positionPopover);
    document.addEventListener("scroll", positionPopover, true);
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("resize", positionPopover);
      document.removeEventListener("scroll", positionPopover, true);
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [accountOpen]);

  function toggleParent(label: string): void {
    setOpenParents((open) => (open.includes(label) ? open.filter((entry) => entry !== label) : [...open, label]));
  }
  function toggleThemeGroup(groupId: string): void {
    setOpenThemeGroups((open) =>
      open.includes(groupId) ? open.filter((entry) => entry !== groupId) : [...open, groupId],
    );
  }

  const isSelatoneBrand = theme === "wallet-selahtone";
  const userInitial = Array.from(userName)[0] ?? "ص";
  const dockItems = mobileBottomDockItems(
    effectiveRole,
    financeEnabled,
    navigationAccess,
    inventoryEnabled,
  );
  const activeDockHref = resolveActiveBottomDockHref(pathname, dockItems);
  const dockListStyle = {
    "--dock-cols": String(dockItems.length),
  } as CSSProperties;
  const accountPortalTarget = accountOpen && typeof document !== "undefined"
    ? accountTriggerRef.current?.closest(".workspace-shell") ?? document.body
    : null;

  return (
    <>
    <aside
      className="workspace-sidebar"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          if (accountOpen) {
            setAccountOpen(false);
            accountTriggerRef.current?.focus();
            return;
          }
          if (menuOpen) {
            setMenuOpen(false);
            toggleRef.current?.focus();
          }
        }
      }}
    >
      <div className={`workspace-sidebar__brand-row${isSelatoneBrand ? " is-selahtone-brand" : ""}`}>
        {isSelatoneBrand ? (
          <Link
            href="/dashboard"
            className="workspace-brand workspace-brand--selahtone"
            onClick={() => {
              setMenuOpen(false);
              setAccountOpen(false);
            }}
            aria-label="صلة تون للخدمات السمعية، لوحة القيادة"
          >
            <SelatoneFacebookLogo className="workspace-brand__fb-card" />
            <span className="workspace-brand__fb-mobile">
              <SelatoneFacebookMark className="workspace-brand__fb-mark" />
              <span className="workspace-brand__text">
                <strong>صلة <span>تون</span></strong>
                <small>للخدمات السمعية</small>
              </span>
            </span>
          </Link>
        ) : (
          <Link
            href="/dashboard"
            className="workspace-brand"
            onClick={() => {
              setMenuOpen(false);
              setAccountOpen(false);
            }}
            aria-label="صلة تون، لوحة القيادة"
          >
            <BrandMark className="workspace-brand__mark" />
            <span className="workspace-brand__text">
              <strong>صله <span>تون</span></strong>
              <small dir="ltr">SELATONE HEARING</small>
            </span>
          </Link>
        )}

        <div className="workspace-mobile-strip" aria-label="شريط مساحة العمل والتاريخ والحساب">
          <div className="workspace-mobile-strip__title" title="نظام إدارة صلة تون — مساحة العمل">
            <span className="workspace-mobile-strip__title-icon" aria-hidden="true">
              <AppIcon name="dashboard" />
            </span>
            <span className="workspace-mobile-strip__title-copy">
              <small>نظام إدارة صلة تون</small>
              <strong>مساحة العمل</strong>
            </span>
          </div>

          <ColorModeToggle compact />

          <div className="workspace-mobile-strip__inline-actions">
            <div
              className="workspace-user workspace-user--compact"
              title={`${userName} — ${roleLabel} · ${branchLabel}`}
            >
              <span className="workspace-user__avatar" aria-hidden="true">{userInitial}</span>
              <span className="workspace-user__details">
                <strong>{userName}</strong>
                <small>{roleLabel} <span aria-hidden="true">·</span> {branchLabel}</small>
              </span>
            </div>
            <Link
              href="/change-password"
              className="workspace-account-link workspace-account-link--compact"
              title="تغيير كلمة المرور"
              aria-label="تغيير كلمة المرور"
            >
              <AppIcon name="lock" />
              <span>كلمة المرور</span>
            </Link>
            <LogoutButton />
          </div>

          <button
            ref={accountTriggerRef}
            type="button"
            className={`workspace-mobile-account__trigger${accountOpen ? " is-open" : ""}`}
            aria-expanded={accountOpen}
            aria-controls="workspace-mobile-account-popover"
            aria-haspopup="dialog"
            aria-label={`حساب المستخدم ومساحة العمل: ${userName}`}
            title={`${userName} — ${roleLabel} · ${branchLabel}`}
            onClick={() => {
              setAccountOpen((open) => {
                const next = !open;
                if (next) setMenuOpen(false);
                return next;
              });
            }}
          >
            <span className="workspace-user__avatar workspace-mobile-account__avatar" aria-hidden="true">
              {userInitial}
            </span>
            <span className="workspace-mobile-account__name">{userName}</span>
            <AppIcon
              name="arrow"
              className={`workspace-mobile-account__chevron${accountOpen ? " is-open" : ""}`}
            />
          </button>
        </div>

        <button
          ref={toggleRef}
          className="workspace-nav-toggle"
          type="button"
          aria-expanded={menuOpen}
          aria-controls="workspace-navigation"
          aria-label={menuOpen ? "إغلاق القائمة" : "فتح القائمة"}
          onClick={() => {
            setMenuOpen((open) => {
              const next = !open;
              if (next) setAccountOpen(false);
              return next;
            });
          }}
        >
          <AppIcon name={menuOpen ? "close" : "menu"} />
        </button>

        {accountPortalTarget ? createPortal((
          <div
            ref={accountPopoverRef}
            style={accountPopoverPosition ?? { visibility: "hidden" }}
            id="workspace-mobile-account-popover"
            className="workspace-mobile-popover"
            role="dialog"
            aria-label="بطاقة مساحة العمل وحساب المستخدم"
          >
            <div className="workspace-mobile-popover__head">
              <span className="workspace-topbar__title-icon" aria-hidden="true">
                <AppIcon name="dashboard" />
              </span>
              <div className="workspace-mobile-popover__head-copy">
                <small>نظام إدارة صلة تون</small>
                <strong>مساحة العمل</strong>
              </div>
              {clock.dateFormatted ? (
                <time className="workspace-mobile-popover__date" dateTime={clock.isoDate}>
                  {clock.dateFormatted}
                </time>
              ) : null}
            </div>

            <div className="workspace-mobile-popover__user">
              <span className="workspace-user__avatar" aria-hidden="true">{userInitial}</span>
              <div className="workspace-user__details">
                <strong>{userName}</strong>
                <small>{roleLabel} <span aria-hidden="true">·</span> {branchLabel}</small>
              </div>
            </div>

            <div className="workspace-mobile-popover__actions">
              <Link
                href="/change-password"
                className="workspace-account-link"
                onClick={() => setAccountOpen(false)}
              >
                <AppIcon name="lock" />
                <span>كلمة المرور</span>
              </Link>
              <LogoutButton />
            </div>
          </div>
        ), accountPortalTarget) : null}
      </div>

      <nav ref={navigationRef} id="workspace-navigation" className={`workspace-navigation${menuOpen ? " is-open" : ""}`} aria-label="التنقل الرئيسي">
        {navGroups.map((group) => (
          <div className="workspace-nav-group" key={group.label}>
            <p className="workspace-nav-group__label">{group.label}</p>
            <ul>
              {group.items.map((item) => {
                const parentOpen = openParents.includes(item.label);
                const parentHasActive = Boolean(
                  item.children?.some((child) => child.href && child.href === activeSidebarHref),
                );
                const itemActive = Boolean(item.href && item.href === activeSidebarHref);

                return (
                  <li key={item.label}>
                    {item.children?.length ? (
                      <>
                        <button
                          type="button"
                          className={`workspace-nav-item workspace-nav-parent${
                            parentHasActive && !parentOpen ? " is-active" : ""
                          }`}
                          aria-expanded={parentOpen}
                          aria-controls={`subnav-${item.label}`}
                          onClick={() => toggleParent(item.label)}
                        >
                          <AppIcon name={item.icon} />
                          <span>{item.label}</span>
                          <AppIcon
                            name="arrow"
                            className={`workspace-nav-chevron${parentOpen ? " is-open" : ""}`}
                          />
                        </button>
                        {parentOpen ? (
                          <ul id={`subnav-${item.label}`} className="workspace-nav-sublist">
                            {item.children.map((child) => {
                              const childActive = Boolean(
                                child.href && child.href === activeSidebarHref,
                              );
                              return (
                                <li key={child.label}>
                                  {child.href ? (
                                    <Link
                                      href={child.href}
                                      className={`workspace-nav-item workspace-nav-subitem${
                                        childActive ? " is-active" : ""
                                      }`}
                                      aria-current={childActive ? "page" : undefined}
                                      onClick={() => setMenuOpen(false)}
                                    >
                                      <AppIcon name={child.icon} />
                                      <span>{child.label}</span>
                                      {child.badgeCount && child.badgeCount > 0 ? (
                                        <span className="workspace-nav-badge">
                                          {child.badgeCount}
                                        </span>
                                      ) : childActive ? (
                                        <span
                                          className="workspace-nav-item__indicator"
                                          aria-hidden="true"
                                        />
                                      ) : null}
                                    </Link>
                                  ) : null}
                                </li>
                              );
                            })}
                          </ul>
                        ) : null}
                      </>
                    ) : item.href ? (
                      <Link
                        href={item.href}
                        className={`workspace-nav-item${itemActive ? " is-active" : ""}${
                          item.featured && !itemActive ? " is-featured" : ""
                        }`}
                        aria-current={itemActive ? "page" : undefined}
                        onClick={() => setMenuOpen(false)}
                      >
                        <AppIcon name={item.icon} />
                        <span>{item.label}</span>
                        {item.badgeCount && item.badgeCount > 0 ? (
                          <span
                            className="workspace-nav-badge"
                            aria-label={`${item.badgeCount} بانتظار المراجعة`}
                          >
                            {item.badgeCount}
                          </span>
                        ) : itemActive ? (
                          <span className="workspace-nav-item__indicator" aria-hidden="true" />
                        ) : null}
                      </Link>
                    ) : (
                      <span className="workspace-nav-item is-disabled" aria-disabled="true">
                        <AppIcon name={item.icon} />
                        <span>{item.label}</span>
                        <small>قريبًا</small>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        <div className="workspace-nav-group">
          <p className="workspace-nav-group__label">المظهر</p>
          <ul>
            <li>
              <button
                type="button"
                className="workspace-nav-item workspace-nav-parent"
                aria-expanded={themeOpen}
                aria-controls="subnav-theme"
                onClick={() => setThemeOpen((open) => !open)}
              >
                <AppIcon name="theme" />
                <span>المظهر والسمات</span>
                <AppIcon name="arrow" className={`workspace-nav-chevron${themeOpen ? " is-open" : ""}`} />
              </button>
              {themeOpen ? (
                <ul id="subnav-theme" className="workspace-nav-sublist">
                  {WORKSPACE_THEME_GROUPS.map((group) => {
                    const groupOpen = openThemeGroups.includes(group.id);
                    const groupHasActive = group.variants.some((v) => v.id === theme);
                    return (
                      <li key={group.id}>
                        <button
                          type="button"
                          className={`workspace-nav-item workspace-nav-subitem workspace-nav-parent${groupHasActive && !groupOpen ? " is-active" : ""}`}
                          aria-expanded={groupOpen}
                          aria-controls={`subnav-${group.id}`}
                          onClick={() => toggleThemeGroup(group.id)}
                        >
                          <AppIcon name="cash" />
                          <span>{group.label}</span>
                          <AppIcon name="arrow" className={`workspace-nav-chevron${groupOpen ? " is-open" : ""}`} />
                        </button>
                        {groupOpen ? (
                          <ul id={`subnav-${group.id}`} className="workspace-nav-sublist workspace-nav-sublist--nested">
                            {group.variants.map((option) => {
                              const active = theme === option.id;
                              const bgEnabled = Boolean(dashboardBgByTheme[option.id]);
                              return (
                                <li key={option.id}>
                                  <div
                                    className={`workspace-nav-item workspace-nav-subitem workspace-theme-row${active ? " is-active" : ""}`}
                                  >
                                    <button
                                      type="button"
                                      className="workspace-theme-btn"
                                      aria-pressed={active}
                                      onClick={() => {
                                        setTheme(option.id);
                                        setMenuOpen(false);
                                      }}
                                    >
                                      <span
                                        className="workspace-theme-swatch"
                                        style={{
                                          backgroundColor: option.swatch,
                                          boxShadow: `inset 0 0 0 2px ${option.ring}`,
                                        }}
                                        aria-hidden="true"
                                      />
                                      <span className="workspace-theme-btn__label">{option.label}</span>
                                    </button>
                                    <LuckyPantherSwitch
                                      checked={bgEnabled}
                                      variant={option.id}
                                      ariaLabel={`تشغيل خلفية الصفحات لثيم ${option.label}`}
                                      onChange={(nextChecked) =>
                                        setThemeDashboardBg(option.id, nextChecked)
                                      }
                                    />
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </li>
          </ul>
        </div>
      </nav>

      <div className="workspace-sidebar__foot">
        <span className="workspace-sidebar__foot-icon"><AppIcon name="check" /></span>
        <span><strong>مساحة عملك</strong><small>{canViewAllBranches ? "إدارة أوضح لكل الفروع" : "متابعة أوضح لفرعك"}</small></span>
      </div>
    </aside>

    <nav className="workspace-bottom-dock" aria-label="التنقل السريع السفلي">
      <ul className="workspace-bottom-dock__list" style={dockListStyle}>
        {dockItems.map((item) => {
          const isMenuAction = item.action === "open-menu";
          const isActive = isMenuAction ? menuOpen : Boolean(item.href && activeDockHref === item.href);
          const itemClassName = `workspace-bottom-dock__item${isActive ? " is-active" : ""}${
            item.featured ? " is-featured" : ""
          }`;

          return (
            <li className="workspace-bottom-dock__cell" key={item.id}>
              {item.href ? (
                <Link
                  href={item.href}
                  className={itemClassName}
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => {
                    setMenuOpen(false);
                    setAccountOpen(false);
                  }}
                >
                  <span className="workspace-bottom-dock__icon" aria-hidden="true">
                    <AppIcon name={item.icon} />
                  </span>
                  <span className="workspace-bottom-dock__label">{item.label}</span>
                </Link>
              ) : (
                <button
                  type="button"
                  className={itemClassName}
                  aria-expanded={menuOpen}
                  aria-controls="workspace-navigation"
                  onClick={() => {
                    setAccountOpen(false);
                    setMenuOpen((open) => {
                      const next = !open;
                      if (next && typeof window !== "undefined") {
                        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
                        window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
                      }
                      return next;
                    });
                  }}
                >
                  <span className="workspace-bottom-dock__icon" aria-hidden="true">
                    <AppIcon name={menuOpen ? "close" : item.icon} />
                  </span>
                  <span className="workspace-bottom-dock__label">
                    {menuOpen ? "إغلاق" : item.label}
                  </span>
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
    </>
  );
}
