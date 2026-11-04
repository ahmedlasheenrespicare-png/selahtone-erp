"use client";

import { useId, useState } from "react";
import Link from "next/link";

export type PantherMetricBlock = {
  label: string;
  value: string;
  unit?: string;
  delta: string;
  tone: "positive" | "negative";
};

export type PantherChartPoint = {
  label: string;
  shortLabel?: string;
  value: number;
  formattedValue: string;
  detail?: string;
  secondaryValue?: number;
  secondaryLabel?: string;
  secondaryFormatted?: string;
};

export type PantherChartSeries = {
  id: string;
  label: string;
  points: PantherChartPoint[];
};

export type PantherSpotlightIconName =
  | "efficiencyGauge"
  | "salesGrowth"
  | "customerCollection"
  | "cashConversion"
  | "balanceScale"
  | "expenseReceipt"
  | "approvalFlow"
  | "netProfit"
  | "serialScan"
  | "branchScorecard"
  | "inventoryCube";

export type PantherSpotlightCardProps = {
  title: string;
  subtitle: string;
  pill?: string;
  icon?: PantherSpotlightIconName;
  primary: PantherMetricBlock;
  secondary: PantherMetricBlock;
  series?: PantherChartSeries[];
  actionHref: string;
  actionLabel: string;
  layout?: "wallet" | "section";
};

function resolveSpotlightIcon(
  title: string,
  explicit?: PantherSpotlightIconName,
): PantherSpotlightIconName {
  if (explicit) return explicit;
  if (title.includes("الكفاءة التشغيلية") || title.includes("الشامل")) {
    return "efficiencyGauge";
  }
  if (title.includes("التحوّل النقدي") || title.includes("التحول النقدي")) {
    return "cashConversion";
  }
  if (title.includes("تقييم وكفاءة الفروع") || title.includes("كفاءة الفروع")) {
    return "branchScorecard";
  }
  if (title.includes("السيريالات") || (title.includes("الأصناف") && title.includes("حركة"))) {
    return "serialScan";
  }
  if (title.includes("الربحية") || title.includes("صافي التشغيل")) {
    return "netProfit";
  }
  if (title.includes("التحصيل")) {
    return "customerCollection";
  }
  if (title.includes("مراحل الاعتماد")) {
    return "approvalFlow";
  }
  if (title.includes("مصروفات")) {
    return "expenseReceipt";
  }
  if (title.includes("الميزان النقدي") || title.includes("حركة العهدة")) {
    return "balanceScale";
  }
  if (title.includes("المخزون")) {
    return "inventoryCube";
  }
  return "salesGrowth";
}

function SpotlightSvgIcon({ name }: { name: PantherSpotlightIconName }) {
  switch (name) {
    case "efficiencyGauge":
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          strokeWidth="1.75"
          stroke="currentColor"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4.2 17.6a9 9 0 1 1 15.6 0" />
          <path d="M12 4.2v2" />
          <path d="M5.7 8.5l1.5 1.1" />
          <path d="M18.3 8.5l-1.5 1.1" />
          <path d="M12 13.5l4.2-4.2" />
          <circle cx="12" cy="13.5" r="1.9" />
        </svg>
      );
    case "salesGrowth":
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          strokeWidth="1.75"
          stroke="currentColor"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 16.8l5.4-5.4 4 3.4L21 6.4" />
          <path d="M15.4 6.4H21V12" />
          <circle cx="8.4" cy="11.4" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="12.4" cy="14.8" r="1.2" fill="currentColor" stroke="none" />
          <path d="M3 20.2h18" opacity="0.45" />
        </svg>
      );
    case "customerCollection":
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          strokeWidth="1.75"
          stroke="currentColor"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="9" cy="7.5" r="3.2" />
          <path d="M3.4 19.5c0-3 2.5-5.2 5.6-5.2 1.1 0 2.1.3 3 .8" />
          <circle cx="16.8" cy="15.6" r="4.4" />
          <path d="m14.9 15.6 1.3 1.3 2.6-2.7" />
        </svg>
      );
    case "cashConversion":
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          strokeWidth="1.75"
          stroke="currentColor"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M20 11A8.1 8.1 0 0 0 5.3 7.2L4 8.5" />
          <path d="M4 4.5v4h4" />
          <path d="M4 13a8.1 8.1 0 0 0 14.7 3.8L20 15.5" />
          <path d="M20 19.5v-4h-4" />
          <circle cx="12" cy="12" r="2.7" />
        </svg>
      );
    case "balanceScale":
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          strokeWidth="1.75"
          stroke="currentColor"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 3.2v16.8" />
          <path d="M8.2 20h7.6" />
          <path d="M5 7h14" />
          <path d="M5 7 2.5 13h5L5 7Z" />
          <path d="M19 7l-2.5 6h5L19 7Z" />
          <path d="M2.5 13a2.5 2.5 0 0 0 5 0" />
          <path d="M16.5 13a2.5 2.5 0 0 0 5 0" />
        </svg>
      );
    case "expenseReceipt":
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          strokeWidth="1.75"
          stroke="currentColor"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 4.6A1.6 1.6 0 0 1 6.6 3h8.8A1.6 1.6 0 0 1 17 4.6V21l-2.2-1.5L12.5 21l-2.3-1.5L8 21l-3-1.5V4.6Z" />
          <path d="M8.4 8h5.2" />
          <path d="M8.4 11.4h3.4" />
          <path d="M14 14.6h7" />
          <path d="m18.6 12.2 2.4 2.4-2.4 2.4" />
        </svg>
      );
    case "approvalFlow":
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          strokeWidth="1.75"
          stroke="currentColor"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M13 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v5.5" />
          <path d="m7.5 8.5 1.4 1.4 2.8-2.8" />
          <path d="M7.5 13.5h4.5" />
          <circle cx="17.2" cy="16.8" r="3.8" />
          <path d="m15.7 16.8 1.1 1.1 2.2-2.3" />
        </svg>
      );
    case "netProfit":
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          strokeWidth="1.75"
          stroke="currentColor"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6.2 4h11.6l3.4 5.5L12 20.8 2.8 9.5 6.2 4Z" />
          <path d="M2.8 9.5h18.4" />
          <path d="M9.6 4 7.7 9.5 12 20.8l4.3-11.3L14.4 4" />
        </svg>
      );
    case "serialScan":
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          strokeWidth="1.75"
          stroke="currentColor"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 7.2V5.4A1.4 1.4 0 0 1 5.4 4h1.8" />
          <path d="M16.8 4h1.8A1.4 1.4 0 0 1 20 5.4v1.8" />
          <path d="M20 16.8v1.8a1.4 1.4 0 0 1-1.4 1.4h-1.8" />
          <path d="M7.2 20H5.4A1.4 1.4 0 0 1 4 18.6v-1.8" />
          <path d="M7.5 8.5v7" />
          <path d="M10.5 8.5v7" />
          <path d="M13.5 8.5v7" />
          <path d="M16.5 8.5v7" />
        </svg>
      );
    case "branchScorecard":
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          strokeWidth="1.75"
          stroke="currentColor"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4.2 10.5V19a1.2 1.2 0 0 0 1.2 1.2h13.2a1.2 1.2 0 0 0 1.2-1.2v-8.5" />
          <path d="M3 10.2 5 4.8h14l2 5.4" />
          <path d="M3 10.2a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" />
          <path d="m12 13.2.85 1.75 1.95.28-1.4 1.36.33 1.91L12 17.6l-1.73.9.33-1.91-1.4-1.36 1.95-.28L12 13.2Z" />
        </svg>
      );
    case "inventoryCube":
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          strokeWidth="1.75"
          stroke="currentColor"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Z" />
          <path d="M4 7.5 12 12l8-4.5" />
          <path d="M12 12v9" />
          <path d="m8 5.25 8 4.5" />
        </svg>
      );
  }
}

const SVG_W = 320;
const SVG_H = 114;
const PAD_X = 14;
const TOP_Y = 14;
const BOTTOM_Y = 88;

type PlottedPoint = PantherChartPoint & {
  x: number;
  y: number;
  secondaryY: number | null;
};

/**
 * منحنى هيرميت الرتيب (Monotone Cubic Spline) ليمرّ بدقة عبر كل نقطة حقيقية
 * دون قفزات وهمية فوق أعلى قيمة أو تحت الصفر.
 */
function buildMonotonePath(coords: Array<{ x: number; y: number }>): string {
  if (coords.length === 0) return "";
  if (coords.length === 1) {
    const y = coords[0].y.toFixed(2);
    return `M${PAD_X},${y} L${SVG_W - PAD_X},${y}`;
  }
  if (coords.length === 2) {
    return `M${coords[0].x.toFixed(2)},${coords[0].y.toFixed(2)} L${coords[1].x.toFixed(2)},${coords[1].y.toFixed(2)}`;
  }

  const n = coords.length;
  const dx: number[] = [];
  const dy: number[] = [];
  const m: number[] = [];

  for (let i = 0; i < n - 1; i += 1) {
    const deltaX = Math.max(coords[i + 1].x - coords[i].x, 0.0001);
    const deltaY = coords[i + 1].y - coords[i].y;
    dx.push(deltaX);
    dy.push(deltaY);
    m.push(deltaY / deltaX);
  }

  const tangents: number[] = new Array(n).fill(0);
  tangents[0] = m[0];
  tangents[n - 1] = m[n - 2];

  for (let i = 1; i < n - 1; i += 1) {
    if (m[i - 1] * m[i] <= 0) {
      tangents[i] = 0;
    } else {
      tangents[i] = (m[i - 1] + m[i]) / 2;
    }
  }

  for (let i = 0; i < n - 1; i += 1) {
    if (Math.abs(m[i]) < 1e-6) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
    } else {
      const a = tangents[i] / m[i];
      const b = tangents[i + 1] / m[i];
      const h = Math.hypot(a, b);
      if (h > 3) {
        const t = 3 / h;
        tangents[i] = t * a * m[i];
        tangents[i + 1] = t * b * m[i];
      }
    }
  }

  let d = `M${coords[0].x.toFixed(2)},${coords[0].y.toFixed(2)}`;
  for (let i = 0; i < n - 1; i += 1) {
    const p0 = coords[i];
    const p1 = coords[i + 1];
    const seg = dx[i] / 3;
    const cp1x = p0.x + seg;
    const cp1y = p0.y + tangents[i] * seg;
    const cp2x = p1.x - seg;
    const cp2y = p1.y - tangents[i + 1] * seg;
    d += ` C${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${p1.x.toFixed(2)},${p1.y.toFixed(2)}`;
  }
  return d;
}

function parseNumericFallback(raw: string): number {
  const cleaned = raw.replace(/[^\d.-]/g, "");
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
}

function buildFallbackSeries(
  primary: PantherMetricBlock,
  secondary: PantherMetricBlock,
): PantherChartSeries[] {
  const pVal = parseNumericFallback(primary.value);
  const sVal = parseNumericFallback(secondary.value);
  const unitSuffix = primary.unit ? ` ${primary.unit}` : "";
  const secUnit = secondary.unit ? ` ${secondary.unit}` : "";
  return [
    {
      id: "summary",
      label: "المؤشر الفعلي",
      points: [
        {
          label: "نقطة الأساس",
          shortLabel: "٠",
          value: 0,
          formattedValue: `0${unitSuffix}`,
        },
        {
          label: secondary.label,
          shortLabel: "المقارن",
          value: sVal,
          formattedValue: `${secondary.value}${secUnit}`,
          detail: secondary.delta,
        },
        {
          label: primary.label,
          shortLabel: "الحالي",
          value: pVal,
          formattedValue: `${primary.value}${unitSuffix}`,
          detail: primary.delta,
        },
      ],
    },
  ];
}

function normalizePoints(rawPoints: PantherChartPoint[]): PantherChartPoint[] {
  if (rawPoints.length === 0) {
    return [
      { label: "بداية الفترة", shortLabel: "البداية", value: 0, formattedValue: "0" },
      { label: "الآن", shortLabel: "الآن", value: 0, formattedValue: "0" },
    ];
  }
  if (rawPoints.length === 1) {
    const only = rawPoints[0];
    return [
      {
        label: "نقطة البداية",
        shortLabel: "٠",
        value: 0,
        formattedValue: "0",
        secondaryValue: only.secondaryValue !== undefined ? 0 : undefined,
        secondaryLabel: only.secondaryLabel,
        secondaryFormatted: only.secondaryValue !== undefined ? "0" : undefined,
      },
      only,
    ];
  }
  return rawPoints;
}

function plotSeriesPoints(points: PantherChartPoint[]): {
  plotted: PlottedPoint[];
  maxVal: number;
  minVal: number;
  zeroY: number;
} {
  const normalized = normalizePoints(points);
  let minVal = 0;
  let maxVal = 0;
  for (const pt of normalized) {
    const v = Number.isFinite(pt.value) ? pt.value : 0;
    minVal = Math.min(minVal, v);
    maxVal = Math.max(maxVal, v);
    if (pt.secondaryValue !== undefined && Number.isFinite(pt.secondaryValue)) {
      minVal = Math.min(minVal, pt.secondaryValue);
      maxVal = Math.max(maxVal, pt.secondaryValue);
    }
  }

  const span = maxVal - minVal;
  const plotHeight = BOTTOM_Y - TOP_Y;
  const toY = (val: number): number => {
    const safe = Number.isFinite(val) ? val : 0;
    if (span <= 0) return BOTTOM_Y;
    return TOP_Y + (1 - (safe - minVal) / span) * plotHeight;
  };

  const count = normalized.length;
  const usableWidth = SVG_W - PAD_X * 2;
  const plotted: PlottedPoint[] = normalized.map((pt, idx) => ({
    ...pt,
    x: count === 1 ? SVG_W / 2 : PAD_X + (idx / (count - 1)) * usableWidth,
    y: toY(pt.value),
    secondaryY:
      pt.secondaryValue !== undefined && Number.isFinite(pt.secondaryValue)
        ? toY(pt.secondaryValue)
        : null,
  }));

  return {
    plotted,
    maxVal,
    minVal,
    zeroY: toY(0),
  };
}

function shouldShowTick(index: number, total: number): boolean {
  if (total <= 6) return true;
  if (index === 0 || index === total - 1) return true;
  const step = Math.ceil((total - 1) / 4);
  return index % step === 0;
}

/**
 * بطاقة المؤشرات المزدوجة المضيئة ذات المؤشر التفاعلي الحي — مبنية على تصميم Gidarx «clever-panther-6» (MIT)
 * ومتكيّفة تلقائيًا مع ثيمَي الحافظة (الافتراضي الأخضر الليموني، وصلة تون السماوي الكحلي).
 */
export default function PantherSpotlightCard({
  title,
  subtitle,
  pill,
  icon,
  primary,
  secondary,
  series,
  actionHref,
  actionLabel,
  layout = "section",
}: PantherSpotlightCardProps) {
  const titleId = useId();
  const gradientId = useId();
  const resolvedIcon = resolveSpotlightIcon(title, icon);

  const resolvedSeries =
    series && series.length > 0 ? series : buildFallbackSeries(primary, secondary);

  const [seriesIndex, setSeriesIndex] = useState(0);
  const safeSeriesIdx = Math.min(seriesIndex, resolvedSeries.length - 1);
  const currentSeries = resolvedSeries[safeSeriesIdx];

  const { plotted, zeroY } = plotSeriesPoints(currentSeries.points);
  const lastIndex = plotted.length - 1;

  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [pinnedIndex, setPinnedIndex] = useState<number | null>(null);

  const rawActiveIndex = hoverIndex ?? pinnedIndex ?? lastIndex;
  const activeIndex = Math.max(0, Math.min(rawActiveIndex, lastIndex));
  const activePoint = plotted[activeIndex];

  const primaryLinePath = buildMonotonePath(plotted.map((p) => ({ x: p.x, y: p.y })));
  const areaPath = `${primaryLinePath} L${plotted[lastIndex].x.toFixed(2)},${zeroY.toFixed(2)} L${plotted[0].x.toFixed(2)},${zeroY.toFixed(2)} Z`;

  const hasSecondaryLine = plotted.every((p) => p.secondaryY !== null);
  const secondaryLinePath = hasSecondaryLine
    ? buildMonotonePath(plotted.map((p) => ({ x: p.x, y: p.secondaryY ?? zeroY })))
    : "";

  const dotLeftPct = (activePoint.x / SVG_W) * 100;
  const dotTopPct = (activePoint.y / SVG_H) * 100;

  function resolveIndexFromClientX(clientX: number, target: HTMLElement): number {
    const rect = target.getBoundingClientRect();
    if (rect.width <= 0) return lastIndex;
    const relX = ((clientX - rect.left) / rect.width) * SVG_W;
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < plotted.length; i += 1) {
      const dist = Math.abs(plotted[i].x - relX);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  return (
    <section
      className={`monthly-panther${layout === "section" ? " is-section" : ""}`}
      aria-labelledby={titleId}
    >
      <div className="monthly-panther__glow" aria-hidden="true" />

      <div className="monthly-panther__inner">
        <div className="monthly-panther__head">
          <div className="monthly-panther__brand">
            <div
              className="monthly-panther__icon"
              data-spotlight-icon={resolvedIcon}
              aria-hidden="true"
            >
              <SpotlightSvgIcon name={resolvedIcon} />
            </div>
            <div>
              <h2 id={titleId} className="monthly-panther__title">
                {title}
              </h2>
              <p className="monthly-panther__subtitle">{subtitle}</p>
            </div>
          </div>

          {pill ? <span className="monthly-panther__pill">{pill}</span> : null}
        </div>

        <div className="monthly-panther__metrics">
          <div className="monthly-panther__metric">
            <p className="monthly-panther__metric-label">{primary.label}</p>
            <p className="monthly-panther__metric-value">
              <bdi dir="ltr">{primary.value}</bdi>
              {primary.unit ? (
                <>
                  {" "}
                  <small>{primary.unit}</small>
                </>
              ) : null}
            </p>
            <p className={`monthly-panther__metric-delta is-${primary.tone}`}>
              {primary.delta}
            </p>
          </div>

          <div className="monthly-panther__metric">
            <p className="monthly-panther__metric-label">{secondary.label}</p>
            <p className="monthly-panther__metric-value">
              <bdi dir="ltr">{secondary.value}</bdi>
              {secondary.unit ? (
                <>
                  {" "}
                  <small>{secondary.unit}</small>
                </>
              ) : null}
            </p>
            <p className={`monthly-panther__metric-delta is-${secondary.tone}`}>
              {secondary.delta}
            </p>
          </div>
        </div>

        <div className="monthly-panther__chart-block">
          {resolvedSeries.length > 1 ? (
            <div
              className="monthly-panther__tabs"
              role="tablist"
              aria-label={`طريقة عرض مؤشر ${title}`}
            >
              {resolvedSeries.map((item, idx) => {
                const isSelected = idx === safeSeriesIdx;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    className={`monthly-panther__tab${isSelected ? " is-active" : ""}`}
                    onClick={() => {
                      setSeriesIndex(idx);
                      setHoverIndex(null);
                      setPinnedIndex(null);
                    }}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          ) : null}

          <div className="monthly-panther__hud" aria-live="polite">
            <div className="monthly-panther__hud-info">
              <span className="monthly-panther__hud-point">
                <span className="monthly-panther__hud-live-dot" aria-hidden="true" />
                <span>{activePoint.label}</span>
                {pinnedIndex !== null ? (
                  <span className="monthly-panther__hud-pin">مثبّت</span>
                ) : null}
              </span>
              {activePoint.detail ? (
                <small className="monthly-panther__hud-detail">
                  {activePoint.detail}
                </small>
              ) : null}
            </div>

            <div className="monthly-panther__hud-values">
              <strong className="monthly-panther__hud-primary">
                <bdi dir="ltr">{activePoint.formattedValue}</bdi>
              </strong>
              {activePoint.secondaryFormatted ? (
                <span className="monthly-panther__hud-secondary">
                  {activePoint.secondaryLabel ? `${activePoint.secondaryLabel}: ` : ""}
                  <bdi dir="ltr">{activePoint.secondaryFormatted}</bdi>
                </span>
              ) : null}
            </div>
          </div>

          <div
            className="monthly-panther__chart"
            dir="ltr"
            tabIndex={0}
            role="group"
            aria-label={`مؤشر تفاعلي لـ ${title} — حرّك المؤشر أو الأسهم لاستعراض القيم`}
            onPointerMove={(event) => {
              setHoverIndex(resolveIndexFromClientX(event.clientX, event.currentTarget));
            }}
            onPointerLeave={() => {
              setHoverIndex(null);
            }}
            onClick={(event) => {
              const idx = resolveIndexFromClientX(event.clientX, event.currentTarget);
              setPinnedIndex((prev) => (prev === idx ? null : idx));
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") {
                event.preventDefault();
                setPinnedIndex(Math.min(activeIndex + 1, lastIndex));
              } else if (event.key === "ArrowLeft") {
                event.preventDefault();
                setPinnedIndex(Math.max(activeIndex - 1, 0));
              } else if (event.key === "Home") {
                event.preventDefault();
                setPinnedIndex(0);
              } else if (event.key === "End") {
                event.preventDefault();
                setPinnedIndex(lastIndex);
              } else if (event.key === "Escape") {
                setPinnedIndex(null);
                setHoverIndex(null);
              }
            }}
          >
            <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} preserveAspectRatio="none">
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    style={{ stopColor: "var(--mp-accent)", stopOpacity: 0.3 }}
                  />
                  <stop
                    offset="100%"
                    style={{ stopColor: "var(--mp-accent)", stopOpacity: 0.01 }}
                  />
                </linearGradient>
              </defs>

              {/* خطوط القياس المرجعية */}
              <line
                x1={PAD_X}
                y1={TOP_Y}
                x2={SVG_W - PAD_X}
                y2={TOP_Y}
                className="monthly-panther__grid-line"
              />
              <line
                x1={PAD_X}
                y1={(TOP_Y + BOTTOM_Y) / 2}
                x2={SVG_W - PAD_X}
                y2={(TOP_Y + BOTTOM_Y) / 2}
                className="monthly-panther__grid-line"
              />
              <line
                x1={PAD_X}
                y1={zeroY}
                x2={SVG_W - PAD_X}
                y2={zeroY}
                className="monthly-panther__grid-baseline"
              />

              {/* المساحة المظلّلة والمنحنى الرئيسي */}
              <path d={areaPath} fill={`url(#${gradientId})`} />

              {hasSecondaryLine ? (
                <path
                  d={secondaryLinePath}
                  fill="none"
                  className="monthly-panther__secondary-path"
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}

              <path
                d={primaryLinePath}
                fill="none"
                style={{ stroke: "var(--mp-accent)" }}
                strokeWidth="2.4"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />

              {/* خط المؤشر العمودي المتحرّك */}
              <line
                x1={activePoint.x}
                y1={TOP_Y - 4}
                x2={activePoint.x}
                y2={BOTTOM_Y}
                className="monthly-panther__crosshair"
                vectorEffect="non-scaling-stroke"
              />
            </svg>

            {/* نقطة المؤشر على المنحنى المقارن بطبقة HTML دائرية */}
            {hasSecondaryLine && activePoint.secondaryY !== null ? (
              <span
                className="monthly-panther__sec-dot"
                style={{
                  left: `${(activePoint.x / SVG_W) * 100}%`,
                  top: `${(activePoint.secondaryY / SVG_H) * 100}%`,
                }}
                aria-hidden="true"
              />
            ) : null}

            {/* النقاط الفعلية على المنحنى بطبقة HTML تحافظ على دائريتها التامة مهما تغيّر عرض البطاقة */}
            {plotted.map((pt, idx) => {
              const isCurrent = idx === activeIndex;
              return (
                <span
                  key={`node-${pt.label}-${idx}`}
                  className={`monthly-panther__node${isCurrent ? " is-active" : ""}`}
                  style={{
                    left: `${(pt.x / SVG_W) * 100}%`,
                    top: `${(pt.y / SVG_H) * 100}%`,
                  }}
                  aria-hidden="true"
                />
              );
            })}

            {/* النقطة المضيئة النابضة المتحرّكة مع القيمة النشطة */}
            <div
              className="monthly-panther__dot-anchor"
              style={{
                left: `${dotLeftPct}%`,
                top: `${dotTopPct}%`,
              }}
              aria-hidden="true"
            >
              <span className="monthly-panther__dot-pulse" />
              <span className="monthly-panther__dot" />
            </div>

            {/* تسميات المحور الأفقي */}
            <div className="monthly-panther__x-axis" aria-hidden="true">
              {plotted.map((pt, idx) => {
                if (!shouldShowTick(idx, plotted.length)) return null;
                const tickText = pt.shortLabel ?? pt.label;
                if (!tickText) return null;
                const edgeClass =
                  idx === 0
                    ? " is-start"
                    : idx === plotted.length - 1
                      ? " is-end"
                      : "";
                return (
                  <span
                    key={`tick-${pt.label}-${idx}`}
                    className={`monthly-panther__x-tick${edgeClass}${idx === activeIndex ? " is-active" : ""}`}
                    style={{ left: `${(pt.x / SVG_W) * 100}%` }}
                  >
                    {tickText}
                  </span>
                );
              })}
            </div>
          </div>
        </div>

        <div className="monthly-panther__foot">
          <Link href={actionHref} className="monthly-panther__btn">
            {actionLabel}
          </Link>
        </div>
      </div>
    </section>
  );
}
