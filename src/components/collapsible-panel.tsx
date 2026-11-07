"use client";

/**
 * لوحة قابلة للطي — النمط العام لأي صفحة.
 *
 * تُنفّذ بـ <details>/<summary> أصليين (دلالات + لوحة مفاتيح بلا تكلفة JS)،
 * وتتذكّر حالة الطي لكل جهاز عبر localStorage بمفتاح `selahtone:v1:collapse:<storageKey>`:
 *   "1" = مفتوحة · أي قيمة أخرى أو غياب = مطوية (الحالة الافتراضية).
 * تُضبط الحالة قبل الطلاء (useLayoutEffect) فلا يحدث وميض بين مطوي/مفتوح.
 */

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { AppIcon, type AppIconName } from "@/components/app-icon";

export type CollapsiblePanelProps = {
  /** مفتاح تعريف للحفظ في localStorage — يجب أن يكون فريدًا لكل استخدام. */
  storageKey: string;
  /** سطر واحد يُعرض دائمًا — مفتاح اللون واللون من CSS. */
  title: string;
  /** أيقونة صغيرة بجانب العنوان (اختياري). */
  iconName?: AppIconName;
  /** كلاسات إضافية للجذر. */
  className?: string;
  children: ReactNode;
};

export default function CollapsiblePanel({
  storageKey,
  title,
  iconName = "settings",
  className = "",
  children,
}: CollapsiblePanelProps) {
  const ref = useRef<HTMLDetailsElement>(null);
  const key = `selahtone:v1:collapse:${storageKey}`;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    try {
      if (window.localStorage.getItem(key) === "1") el.open = true;
    } catch {
      // وضع التصفح الخاص/المحاصر — تُبقى مطوية.
    }
  }, [key]);

  const persist = () => {
    const el = ref.current;
    if (!el) return;
    try {
      window.localStorage.setItem(key, el.open ? "1" : "0");
    } catch {
      // نفس المسار — لا داعي لإفشال الطي من أجل الذاكرة.
    }
  };

  return (
    <details ref={ref} className={`collapse-panel no-print ${className}`.trim()} onToggle={persist}>
      <summary className="collapse-panel__summary">
        <span className="collapse-panel__title">
          <span className="collapse-panel__icon" aria-hidden="true">
            <AppIcon name={iconName} />
          </span>
          <span className="collapse-panel__text">{title}</span>
        </span>
        <span className="collapse-panel__chevron" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </summary>
      <div className="collapse-panel__body">{children}</div>
    </details>
  );
}
