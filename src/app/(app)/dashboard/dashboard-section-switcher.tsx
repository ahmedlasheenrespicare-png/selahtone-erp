"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { AppIcon } from "@/components/app-icon";
import {
  type DashboardSectionId,
  type DashboardSectionMeta,
  getDashboardSectionGuide,
  groupDashboardSections,
  resolveDashboardSectionId,
  stepDashboardSection,
} from "@/lib/dashboard-sections";

type Props = {
  userScopeKey: string;
  initialSectionParam?: string | null;
  items: DashboardSectionMeta[];
  slots: Partial<Record<DashboardSectionId, ReactNode>>;
  fullView: ReactNode;
  compactView: ReactNode;
  fullViewWallet: ReactNode;
};

const nf = new Intl.NumberFormat("ar-EG-u-nu-latn");

export default function DashboardSectionSwitcher({
  userScopeKey,
  initialSectionParam,
  items,
  slots,
  fullView,
  compactView,
  fullViewWallet,
}: Props) {
  const storageKey = `selahtone:dashboard-section:${userScopeKey}`;
  const availableIds = useMemo(() => items.map((item) => item.id), [items]);

  const [selectedId, setSelectedId] = useState<DashboardSectionId>(() =>
    resolveDashboardSectionId(initialSectionParam, availableIds, "pulse-wallet"),
  );
  const [open, setOpen] = useState(false);
  const [filterText, setFilterText] = useState("");
  const visibilityStorageKey = `selahtone:dashboard-visibility:${userScopeKey}`;
  const layoutStorageKey = `selahtone:dashboard-all-layout:${userScopeKey}`;
  const [allLayout, setAllLayout] = useState<"spacious" | "compact">("compact");
  const [visibilityBySection, setVisibilityBySection] = useState<Record<string, string[]>>({});
  const hiddenToggles = visibilityBySection[selectedId] ?? [];
  const [visibilityLoaded, setVisibilityLoaded] = useState(false);

  const dropdownWrapRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // يحتفظ المستخدم بتصميم العرض الشامل المفضل: السابق الواسع أو الشبكة المضغوطة.
  useEffect(() => {
    try {
      setAllLayout(window.localStorage.getItem(layoutStorageKey) === "spacious" ? "spacious" : "compact");
    } catch {
      setAllLayout("compact");
    }
  }, [layoutStorageKey]);

  function chooseAllLayout(layout: "spacious" | "compact") {
    setAllLayout(layout);
    try {
      window.localStorage.setItem(layoutStorageKey, layout);
    } catch {
      // يبقى الاختيار فعّالًا خلال الجلسة حتى إن كان التخزين المحلي غير متاح.
    }
  }

  // إعدادات الإظهار والإخفاء محفوظة لكل مستخدم ودور على هذا المتصفح.
  useEffect(() => {
    setVisibilityLoaded(false);
    try {
      const saved = window.localStorage.getItem(visibilityStorageKey);
      const parsed: unknown = saved ? JSON.parse(saved) : {};
      const normalized: Record<string, string[]> = {};
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [sectionId, keys] of Object.entries(parsed)) {
          if (Array.isArray(keys)) normalized[sectionId] = keys.filter((key): key is string => typeof key === "string");
        }
      }
      setVisibilityBySection(normalized);
    } catch {
      setVisibilityBySection({});
    }
    setVisibilityLoaded(true);
  }, [visibilityStorageKey]);

  useEffect(() => {
    if (!visibilityLoaded) return;
    try {
      window.localStorage.setItem(visibilityStorageKey, JSON.stringify(visibilityBySection));
    } catch {
      // التخزين المحلي اختياري؛ تبقى الإعدادات فعالة حتى مغادرة الصفحة.
    }
  }, [visibilityBySection, visibilityLoaded, visibilityStorageKey]);

  // استعادة آخر قسم اختاره المستخدم في الجلسة إذا لم يُمرَّر ?section= صراحةً في الرابط
  useEffect(() => {
    if (initialSectionParam) {
      const resolved = resolveDashboardSectionId(
        initialSectionParam,
        availableIds,
        "pulse-wallet",
      );
      setSelectedId(resolved);
      try {
        window.sessionStorage.setItem(storageKey, resolved);
        window.dispatchEvent(
          new CustomEvent("selahtone:dashboard-section-changed", { detail: resolved }),
        );
      } catch {
        // ignore
      }
      return;
    }

    try {
      const saved = window.sessionStorage.getItem(storageKey);
      if (saved) {
        const resolved = resolveDashboardSectionId(saved, availableIds, "pulse-wallet");
        setSelectedId(resolved);
        window.dispatchEvent(
          new CustomEvent("selahtone:dashboard-section-changed", { detail: resolved }),
        );
      }
    } catch {
      // ignore
    }
  }, [initialSectionParam, availableIds, storageKey]);

  function selectSection(nextId: DashboardSectionId) {
    const valid = resolveDashboardSectionId(nextId, availableIds, "pulse-wallet");
    setSelectedId(valid);
    setOpen(false);
    setFilterText("");
    try {
      window.sessionStorage.setItem(storageKey, valid);
      const url = new URL(window.location.href);
      if (valid === "pulse-wallet") {
        url.searchParams.delete("section");
      } else {
        url.searchParams.set("section", valid);
      }
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
      window.dispatchEvent(
        new CustomEvent("selahtone:dashboard-section-changed", { detail: valid }),
      );
    } catch {
      // ignore
    }
  }

  // الاستماع لاختيار قسم لوحة القيادة مباشرةً من القائمة المنسدلة الجانبية بدون إعادة تحميل
  const selectSectionRef = useRef(selectSection);
  selectSectionRef.current = selectSection;

  useEffect(() => {
    function handleSidebarSelect(event: Event) {
      const detail = (event as CustomEvent<string>).detail;
      if (typeof detail === "string") {
        selectSectionRef.current(detail as DashboardSectionId);
      }
    }
    window.addEventListener("selahtone:dashboard-section-select", handleSidebarSelect);
    return () => {
      window.removeEventListener("selahtone:dashboard-section-select", handleSidebarSelect);
    };
  }, []);

  // إغلاق القائمة عند النقر خارجها أو الضغط على Escape
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (
        dropdownWrapRef.current &&
        !dropdownWrapRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const activeMeta = useMemo(
    () => items.find((item) => item.id === selectedId) ?? items[0],
    [items, selectedId],
  );
  const activeIndex = useMemo(
    () => Math.max(0, availableIds.indexOf(selectedId)),
    [availableIds, selectedId],
  );
  const activeGuide = getDashboardSectionGuide(selectedId);
  const isShown = (key: string) => !hiddenToggles.includes(key);
  const visibleToggleCount = selectedId === "pulse-wallet"
    ? [
        isShown("part-pulse") && ["pulse-sales", "pulse-collections", "pulse-tasks", "pulse-stock"].some(isShown),
        isShown("part-pace") && ["pace-progress", "pace-average", "pace-projection", "pace-comparison"].some(isShown),
        isShown("part-governance") && ["governance-summary", "governance-alerts"].some(isShown),
        isShown("part-wallet") && ["wallet-cards", "wallet-pocket", "wallet-controls", "wallet-hint"].some(isShown),
        isShown("part-focus-hint"),
      ].filter(Boolean).length
    : activeGuide.toggles.filter((item) => isShown(item.key)).length;
  const hiddenToggleAttribute = hiddenToggles.join(" ");

  function toggleVisibility(key: string) {
    setVisibilityBySection((current) => {
      const hidden = current[selectedId] ?? [];
      const next = hidden.includes(key) ? hidden.filter((item) => item !== key) : [...hidden, key];
      return { ...current, [selectedId]: next };
    });
  }

  function restoreSectionVisibility() {
    setVisibilityBySection((current) => ({ ...current, [selectedId]: [] }));
  }

  const filteredGroups = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    const matching = q
      ? items.filter(
          (item) =>
            item.label.toLowerCase().includes(q) ||
            item.description.toLowerCase().includes(q),
        )
      : items;
    return groupDashboardSections(matching);
  }, [items, filterText]);

  return (
    <>
      <div className="dash-switcher-bar no-print" role="region" aria-label="اختيار قسم لوحة القيادة">
        <div className="dash-dropdown-wrap" ref={dropdownWrapRef}>
          <button
            type="button"
            className="dash-dropdown-trigger"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-label="قائمة أقسام لوحة القيادة"
            onClick={() => {
              const nextOpen = !open;
              setOpen(nextOpen);
              if (nextOpen) {
                setTimeout(() => searchInputRef.current?.focus(), 20);
              }
            }}
          >
            <span className="dash-dropdown-trigger__start">
              <span className="dash-dropdown-trigger__icon" aria-hidden="true">
                <AppIcon name={activeMeta?.icon ?? "dashboard"} />
              </span>
              <span className="dash-dropdown-trigger__copy">
                <span className="dash-dropdown-trigger__eyebrow">
                  محتوى لوحة القيادة ({nf.format(activeIndex + 1)} من {nf.format(items.length)})
                </span>
                <span className="dash-dropdown-trigger__title">
                  {activeMeta?.label ?? "لوحة القيادة"}
                </span>
              </span>
            </span>

            <span className="dash-dropdown-trigger__end">
              {activeMeta?.badgeCount && activeMeta.badgeCount > 0 ? (
                <span
                  className={`dash-section-badge${
                    activeMeta.badgeTone === "alert" ? " is-alert" : ""
                  }`}
                >
                  {nf.format(activeMeta.badgeCount)}
                </span>
              ) : null}
              <span className="dash-dropdown-chevron" aria-hidden="true">
                ▾
              </span>
            </span>
          </button>

          {open ? (
            <div className="dash-dropdown-menu" role="listbox" aria-label="كل أقسام ومؤشرات لوحة القيادة">
              <div className="dash-dropdown-search">
                <AppIcon name="search" />
                <input
                  ref={searchInputRef}
                  type="search"
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  placeholder="صفِّ أقسام ومؤشرات اللوحة بالاسم…"
                  aria-label="تصفية أقسام لوحة القيادة"
                />
              </div>

              <div className="dash-dropdown-scroll">
                {filteredGroups.length === 0 ? (
                  <p className="dash-dropdown-empty">لا يوجد قسم مطابق لعبارة البحث.</p>
                ) : (
                  filteredGroups.map((grp) => (
                    <div key={grp.group} className="dash-dropdown-group">
                      <span className="dash-dropdown-group__title">{grp.title}</span>
                      {grp.items.map((opt) => {
                        const isSelected = opt.id === selectedId;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            className={`dash-dropdown-option${isSelected ? " is-selected" : ""}`}
                            onClick={() => selectSection(opt.id)}
                          >
                            <span className="dash-dropdown-option__start">
                              <span className="dash-dropdown-option__icon" aria-hidden="true">
                                <AppIcon name={opt.icon} />
                              </span>
                              <span className="dash-dropdown-option__copy">
                                <strong>{opt.label}</strong>
                                <small>{opt.description}</small>
                              </span>
                            </span>

                            <span className="dash-dropdown-option__end">
                              {opt.badgeCount && opt.badgeCount > 0 ? (
                                <span
                                  className={`dash-section-badge${
                                    opt.badgeTone === "alert" ? " is-alert" : ""
                                  }`}
                                >
                                  {nf.format(opt.badgeCount)}
                                </span>
                              ) : null}
                              {isSelected ? <span aria-hidden="true">✓</span> : null}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : null}
        </div>

        <div className="dash-switcher-controls">
          <div className="dash-step-group" role="group" aria-label="التنقل بين الأقسام">
            <button
              type="button"
              className="dash-step-btn"
              onClick={() =>
                selectSection(stepDashboardSection(selectedId, availableIds, -1))
              }
              title="القسم السابق"
            >
              <span>السابق</span>
            </button>
            <button
              type="button"
              className="dash-step-btn"
              onClick={() =>
                selectSection(stepDashboardSection(selectedId, availableIds, 1))
              }
              title="القسم التالي"
            >
              <span>التالي</span>
            </button>
          </div>

          <button
            type="button"
            className={`dash-mode-toggle${selectedId === "all" ? " is-active" : ""}`}
            onClick={() =>
              selectSection(selectedId === "all" ? "pulse-wallet" : "all")
            }
          >
            <AppIcon name="dashboard" />
            <span>{selectedId === "all" ? "الوضع المركّز" : "عرض شامل (الكل)"}</span>
          </button>
        </div>
      </div>

      {/* عرض المحتوى بحسب الاختيار */}
      {selectedId === "all" ? (
        <div key="all" className="dash-single-stage dash-single-stage--all" data-dashboard-section="all" data-dashboard-layout={allLayout} data-hidden-toggles={hiddenToggleAttribute}>
          <div className="dash-all-layout-picker" role="group" aria-label="اختيار تصميم العرض الشامل">
            <span className="dash-all-layout-picker__label">تصميم اللوحة:</span>
            <button
              type="button"
              className={`dash-all-layout-picker__button${allLayout === "spacious" ? " is-active" : ""}`}
              aria-pressed={allLayout === "spacious"}
              onClick={() => chooseAllLayout("spacious")}
            >
              تصميم الدمج الأخير (واسع)
            </button>
            <button
              type="button"
              className={`dash-all-layout-picker__button${allLayout === "compact" ? " is-active" : ""}`}
              aria-pressed={allLayout === "compact"}
              onClick={() => chooseAllLayout("compact")}
            >
              الشبكة المضغوطة
            </button>
          </div>
          {allLayout === "compact" ? fullViewWallet : null}
          {allLayout === "compact" ? compactView : fullView}
        </div>
      ) : selectedId === "pulse-wallet" ? (
        <div key="pulse-wallet" className="dash-single-stage dash-single-stage--pulse-wallet" data-dashboard-section="pulse-wallet" data-hidden-toggles={hiddenToggleAttribute}>
          <div data-dash-part="pulse">{slots.pulse}</div>
          <div data-dash-part="pace">{slots.pace}</div>
          <div data-dash-part="governance">{slots.governance}</div>
          {slots.wallet ? (
            <div className="dash-pulse-wallet-center" data-dash-part="wallet">{slots.wallet}</div>
          ) : null}
          <div className="dash-focus-hint no-print" data-dash-part="focus-hint">
            <span>
              تستعرض الآن الوضع المركّز السريع. افتح القائمة المنسدلة بالأعلى لاستعراض أي مؤشر أو رادار على حدة.
            </span>
            <button type="button" onClick={() => selectSection("all")}>
              أو اعرض كل الأقسام معًا
            </button>
          </div>
        </div>
      ) : (
        <div
          key={selectedId}
          className={`dash-single-stage${
            activeMeta?.stageKind === "card" ? " dash-single-stage--card" : ""
          }`}
          data-dashboard-section={selectedId}
          data-hidden-toggles={hiddenToggleAttribute}
        >
          {slots[selectedId] ?? fullView}
        </div>
      )}

      <section className="dash-settings-panel no-print" aria-labelledby="dash-settings-title">
        <div className="dash-settings-panel__head">
          <div>
            <span className="dash-settings-panel__eyebrow">شرح وتخصيص</span>
            <h2 id="dash-settings-title">إعدادات وشرح الخيار المعروض</h2>
            <p>الخيار الحالي: <strong>{activeMeta?.label}</strong></p>
          </div>
          <button
            type="button"
            className="dash-settings-reset"
            onClick={restoreSectionVisibility}
            disabled={hiddenToggles.length === 0}
          >
            إظهار الكل (استعادة الافتراضي)
          </button>
        </div>
        <div className="dash-settings-guide">
          <p>{activeGuide.summary}</p>
          <div className="dash-settings-guide__columns">
            <div><strong>طريقة القراءة</strong><span>{activeGuide.howToRead}</span></div>
            <div><strong>متى أتخذ إجراء؟</strong><span>{activeGuide.whenToAct}</span></div>
          </div>
        </div>
        {visibleToggleCount === 0 ? (
          <div className="dash-settings-empty" role="status">
            أخفيت جميع عناصر هذا الخيار. استخدم «إظهار الكل» لإعادة المحتوى إلى وضعه الافتراضي.
          </div>
        ) : null}
        <div className="dash-settings-options" aria-label="عناصر الخيار وإعدادات ظهورها">
          {activeGuide.toggles.map((item) => {
            const shown = !hiddenToggles.includes(item.key);
            return (
              <label key={item.key} className={`dash-settings-option${shown ? " is-shown" : " is-hidden"}`}>
                <span className="dash-settings-option__copy">
                  <strong>{item.label}</strong>
                  <small>{item.explanation}</small>
                </span>
                <input
                  type="checkbox"
                  checked={shown}
                  onChange={() => toggleVisibility(item.key)}
                  aria-label={`${shown ? "إخفاء" : "إظهار"} ${item.label}`}
                />
              </label>
            );
          })}
        </div>
        <details className="dash-settings-all-guides">
          <summary>شرح بقية خيارات لوحة القيادة ({nf.format(items.length)})</summary>
          <div className="dash-settings-all-guides__list">
            {items.map((item) => (
              <article key={item.id}>
                <h3>{item.label}</h3>
                <p>{getDashboardSectionGuide(item.id).summary}</p>
                <small>{item.description}</small>
              </article>
            ))}
          </div>
        </details>
      </section>
    </>
  );
}
