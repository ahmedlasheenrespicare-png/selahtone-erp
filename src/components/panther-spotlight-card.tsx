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

export type PantherSpotlightCardProps = {
  title: string;
  subtitle: string;
  pill?: string;
  primary: PantherMetricBlock;
  secondary: PantherMetricBlock;
  series?: PantherChartSeries[];
  actionHref: string;
  actionLabel: string;
  layout?: "wallet" | "section";
};

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
  primary,
  secondary,
  series,
  actionHref,
  actionLabel,
  layout = "section",
}: PantherSpotlightCardProps) {
  const titleId = useId();
  const gradientId = useId();

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
            <div className="monthly-panther__icon" aria-hidden="true">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                strokeWidth="1.6"
                stroke="currentColor"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path stroke="none" d="M0 0h24v24H0z" fill="none" />
                <path d="M3 12m0 1a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z" />
                <path d="M9 8m0 1a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z" />
                <path d="M15 4m0 1a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z" />
                <path d="M4 20l14 0" />
              </svg>
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
