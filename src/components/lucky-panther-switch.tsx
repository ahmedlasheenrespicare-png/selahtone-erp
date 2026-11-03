"use client";

import type { WorkspaceThemeId } from "@/lib/workspace-theme";

type LuckyPantherSwitchProps = {
  checked: boolean;
  onChange: (nextChecked: boolean) => void;
  variant: WorkspaceThemeId;
  ariaLabel: string;
};

/**
 * زر التبديل ثلاثي الأبعاد لتشغيل/إيقاف الخلفية الهندسية على صفحات النظام
 * مستند إلى تصميم sreenath_9297/lucky-panther-31 (MIT) من Uiverse.io
 */
export function LuckyPantherSwitch({
  checked,
  onChange,
  variant,
  ariaLabel,
}: LuckyPantherSwitchProps) {
  return (
    <label
      className="lp31-switch"
      dir="ltr"
      data-variant={variant}
      title={ariaLabel}
      onClick={(event) => event.stopPropagation()}
    >
      <input
        type="checkbox"
        className="lp31-input"
        checked={checked}
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="lp31-track">
        <span className="lp31-text lp31-text--off" aria-hidden="true">
          بدون
        </span>
        <span className="lp31-text lp31-text--on" aria-hidden="true">
          خلفية
        </span>
        <span className="lp31-knob" aria-hidden="true">
          <span className="lp31-cube">
            <span className="lp31-face lp31-front" />
            <span className="lp31-face lp31-back" />
            <span className="lp31-face lp31-right" />
            <span className="lp31-face lp31-left" />
            <span className="lp31-face lp31-top" />
            <span className="lp31-face lp31-bottom" />
          </span>
        </span>
      </span>
    </label>
  );
}
