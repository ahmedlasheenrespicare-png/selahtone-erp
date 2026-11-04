"use client";

import { useId, type CSSProperties } from "react";
import { AppIcon } from "@/components/app-icon";
import { useWorkspaceTheme } from "@/app/(app)/workspace-theme-provider";
import type { SkyCyclePhase } from "@/lib/workspace-theme";

const PHASE_COPY: Record<
  SkyCyclePhase,
  { status: string; subtitle: string; modeHint: string }
> = {
  dawn: {
    status: "شروق النهار",
    subtitle: "الساعة الذهبية",
    modeHint: "الوضع النهاري",
  },
  day: {
    status: "النهار",
    subtitle: "سماء صافية",
    modeHint: "الوضع النهاري",
  },
  dusk: {
    status: "شفق الغروب",
    subtitle: "غروب ذهبي",
    modeHint: "الوضع النهاري",
  },
  night: {
    status: "الليل",
    subtitle: "قمر مكتمل",
    modeHint: "الوضع الليلي",
  },
};

export default function ColorModeToggle({
  showDate = true,
  compact = false,
}: {
  showDate?: boolean;
  compact?: boolean;
}) {
  const { colorMode, isAutoTimeMode, clock, toggleColorMode, enableAutoTimeMode } =
    useWorkspaceTheme();
  const uid = useId().replace(/:/g, "");

  const isDark = colorMode === "dark";
  const visualPhase: SkyCyclePhase = isDark
    ? "night"
    : clock.skyPhase === "night"
      ? "day"
      : clock.skyPhase;

  const orbAngle = isAutoTimeMode
    ? clock.orbitDeg
    : isDark
      ? 30
      : visualPhase === "dawn"
        ? -34
        : visualPhase === "dusk"
          ? 34
          : -6;

  const copy = PHASE_COPY[visualPhase];
  const sunGradId = `sky-sun-${uid}`;
  const cloudGradId = `sky-cloud-${uid}`;
  const moonGradId = `sky-moon-${uid}`;

  const orbitStyle = {
    "--sky-orbit-deg": `${orbAngle}deg`,
  } as CSSProperties;
  const shortNumericDate = clock.isoDate ? clock.isoDate.slice(5).replace("-", "/") : "";

  return (
    <div
      className={`workspace-topbar__skydate${compact ? " is-compact" : ""}`}
      role="group"
      aria-label="تاريخ اليوم وحالة النهار والليل"
    >
      {showDate && clock.dateFormatted ? (
        <div className="workspace-topbar__date" title={`تاريخ اليوم: ${clock.dateFormatted}`}>
          <span className="workspace-topbar__date-icon" aria-hidden="true">
            <AppIcon name="calendar" />
          </span>
          <div className="workspace-topbar__date-copy">
            <small>تاريخ اليوم</small>
            <time dateTime={clock.isoDate}>
              <span className="workspace-date__full">{clock.dateFormatted}</span>
              {compact && shortNumericDate ? (
                <span className="workspace-date__short" dir="ltr">
                  {shortNumericDate}
                </span>
              ) : null}
            </time>
          </div>
        </div>
      ) : null}

      <div className="sky-cycle-wrap">
        <button
          type="button"
          className={`sky-cycle-card is-${visualPhase}${isDark ? " is-dark" : " is-light"}${
            isAutoTimeMode ? " is-auto" : " is-manual"
          }`}
          style={orbitStyle}
          aria-pressed={isDark}
          aria-label={`${copy.modeHint} (${copy.status} — ${
            isAutoTimeMode ? "يتحول تلقائيًا مع النهار والليل" : "تبديل يدوي مؤقت"
          }). انقر للتبديل بين النهاري والليلي`}
          title={
            isAutoTimeMode
              ? `${copy.status} (${clock.timeFormatted}) · يتحول تلقائيًا بين النهار والليل — انقر للتبديل`
              : `${copy.modeHint} مفعل يدويًا — انقر للتبديل أو سيعود تلقائيًا عند تحوّل الوقت`
          }
          onClick={toggleColorMode}
        >
          {/* طبقات السماء البيئية — مستوحاة من dangerous-moose-2 */}
          <span className="sky-cycle-card__bg sky-cycle-card__bg--dawn" aria-hidden="true" />
          <span className="sky-cycle-card__bg sky-cycle-card__bg--day" aria-hidden="true" />
          <span className="sky-cycle-card__bg sky-cycle-card__bg--dusk" aria-hidden="true" />
          <span className="sky-cycle-card__bg sky-cycle-card__bg--night" aria-hidden="true" />
          <span className="sky-cycle-card__stars" aria-hidden="true" />

          {/* المسار المداري المنحني والجرم السماوي المتوهج — مستوحى من dangerous-moose-2 */}
          <span className="sky-cycle-card__orbit" aria-hidden="true">
            <span className="sky-cycle-card__orbit-path" />
            <span className="sky-cycle-card__pivot">
              <span className="sky-cycle-card__orb" />
            </span>
          </span>

          {/* محتوى البطاقة التفاعلي القابل للتمدد عند التمرير — مستوحى من lovely-husky-84 */}
          <span className="sky-cycle-card__content">
            <span className="sky-cycle-card__scene" aria-hidden="true">
              <svg viewBox="0 0 64 64" className="sky-cycle-card__svg">
                <defs>
                  <linearGradient id={sunGradId} x1="16.5" y1="19.67" x2="25.5" y2="30.33" gradientUnits="userSpaceOnUse">
                    <stop offset="0" stopColor="#fde047" />
                    <stop offset="0.5" stopColor="#fbbf24" />
                    <stop offset="1" stopColor="#f59e0b" />
                  </linearGradient>
                  <linearGradient id={cloudGradId} x1="22.5" y1="22" x2="39.2" y2="50.8" gradientUnits="userSpaceOnUse">
                    <stop offset="0" stopColor={isDark ? "#e2e8f0" : "#ffffff"} />
                    <stop offset="0.55" stopColor={isDark ? "#cbd5e1" : "#f3f7fe"} />
                    <stop offset="1" stopColor={isDark ? "#94a3b8" : "#dbeafe"} />
                  </linearGradient>
                  <linearGradient id={moonGradId} x1="16" y1="14" x2="32" y2="34" gradientUnits="userSpaceOnUse">
                    <stop offset="0" stopColor="#ffffff" />
                    <stop offset="0.6" stopColor="#e2e8f0" />
                    <stop offset="1" stopColor="#bfd4f2" />
                  </linearGradient>
                </defs>

                {!isDark ? (
                  <g className="sky-cycle-card__svg-sun">
                    <circle
                      cx="21"
                      cy="24"
                      r="6.2"
                      fill={`url(#${sunGradId})`}
                      stroke="#f59e0b"
                      strokeWidth="0.6"
                    />
                    <path
                      className="sky-cycle-card__sun-rays"
                      d="M21 13.8V10.5M21 37.5v-3.3m7.2-13.2l2.3-2.3M11.5 33.5l2.3-2.3m0-14.4l-2.3-2.3m19 19l-2.3-2.3M7.5 24h3.3m23.7 0h-3.3"
                      fill="none"
                      stroke="#fde047"
                      strokeLinecap="round"
                      strokeWidth="2.1"
                    />
                  </g>
                ) : (
                  <g className="sky-cycle-card__svg-moon">
                    <path
                      d="M28.6 25.8A8.6 8.6 0 0118.2 15.4a8.7 8.7 0 1010.4 10.4z"
                      fill={`url(#${moonGradId})`}
                      stroke="#e2e8f0"
                      strokeWidth="0.6"
                      strokeLinejoin="round"
                    />
                    <circle cx="34" cy="15" r="1.2" fill="#fde68a" className="sky-cycle-card__twinkle" />
                    <circle cx="11" cy="18" r="1" fill="#e0f2fe" className="sky-cycle-card__twinkle sky-cycle-card__twinkle--alt" />
                  </g>
                )}

                <path
                  className="sky-cycle-card__cloud"
                  d="M47.5 32.5h-.32a10.2 10.2 0 00-18.7-7.7 6.8 6.8 0 00-10.3 5.8 7 7 0 00.1 1.1A7.3 7.3 0 0019.5 46h28a6.75 6.75 0 000-13.5z"
                  fill={`url(#${cloudGradId})`}
                  stroke={isDark ? "rgba(226,232,240,0.45)" : "#e6effc"}
                  strokeWidth="0.6"
                />
              </svg>
            </span>

            <span className="sky-cycle-card__text">
              <strong className="sky-cycle-card__status">{copy.status}</strong>
              <small className="sky-cycle-card__subtitle">{copy.subtitle}</small>
            </span>

            <span className="sky-cycle-card__extra" aria-hidden="true">
              <span className="sky-cycle-card__clock" dir="ltr">
                {clock.timeFormatted}
              </span>
              <span className="sky-cycle-card__mode-tag">
                {isAutoTimeMode ? "تلقائي" : "يدوي"}
              </span>
            </span>
          </span>
        </button>

        {!isAutoTimeMode ? (
          <button
            type="button"
            className="sky-cycle-reset"
            onClick={enableAutoTimeMode}
            title="العودة إلى التحول التلقائي حسب وقت النهار والليل"
            aria-label="العودة إلى التحول التلقائي حسب وقت النهار والليل"
          >
            تلقائي ↺
          </button>
        ) : null}
      </div>
    </div>
  );
}
