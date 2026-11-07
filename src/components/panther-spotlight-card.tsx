"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";

export type PantherChartVariant =
  | "area"
  | "gauge"
  | "donut"
  | "columns"
  | "waterfall"
  | "bars";

export type PantherPointTone = "accent" | "alt" | "warn" | "danger";

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
  tone?: PantherPointTone;
  /** مفتاح التثبيت: عند تثبيت هذه النقطة يُخفى كل عنصر في التفاصيل لا يحمل data-pin-part مطابقًا (التوسعة اختيارية، بلا أثر لباقي المستخدمين) */
  pinKey?: string;
};

export type PantherChartSeries = {
  id: string;
  label: string;
  points: PantherChartPoint[];
  chartVariant?: PantherChartVariant;
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
  chartVariant?: PantherChartVariant;
  primary: PantherMetricBlock;
  secondary: PantherMetricBlock;
  series?: PantherChartSeries[];
  actionHref: string;
  actionLabel: string;
  layout?: "wallet" | "section";
  /** محتوى إضافي (مثل قوائم البنود التفصيلية) يُرسم داخل البطاقة بين الرسم وزر الإجراء */
  children?: ReactNode;
  /** علامة تبويب تبويبية اختيارية تُصق على الجذر — تبقي أدوات التحقق والاختبار كما هي */
  dataDashPart?: string;
  /** عند تفعيلها والبطاقة تحوي تفاصيل: يضغط المستخدم على الـHUD فتظهر/تختفي التفاصيل (accordion) بدل ظهورها دائمًا */
  detailsHudToggle?: boolean;
};

const SERIES_VARIANT_BY_ID: Record<string, PantherChartVariant> = {
  "pillar-scores": "gauge",
  "settlement-state": "donut",
  "liquidity-mix": "donut",
  "ledger-stages": "donut",
  "status-breakdown": "donut",
  "serial-mix": "donut",
  "cash-funnel": "waterfall",
  "profit-bridge": "waterfall",
  "custody-equation": "waterfall",
  "cash-equation": "waterfall",
  "branch-ranking": "bars",
  "customer-balances": "bars",
  "top-profit": "bars",
  "top-revenue": "bars",
  "top-categories": "bars",
  "open-accounts": "bars",
  "pillar-points": "columns",
  "branch-axes": "columns",
  "branch-collections": "columns",
  "branch-conversion": "columns",
  "branch-operating": "columns",
  "branch-balance": "columns",
  "top-items": "columns",
  "by-category": "columns",
  "by-branch": "columns",
  "today-vs-period": "columns",
  "daily-sales": "area",
  "daily-expenses": "area",
  "month-expenses": "area",
  "daily-conversion": "area",
  "daily-operating": "area",
};

const ICON_DEFAULT_VARIANT: Record<PantherSpotlightIconName, PantherChartVariant> = {
  efficiencyGauge: "gauge",
  customerCollection: "donut",
  balanceScale: "donut",
  approvalFlow: "donut",
  cashConversion: "waterfall",
  netProfit: "waterfall",
  branchScorecard: "bars",
  inventoryCube: "columns",
  serialScan: "columns",
  salesGrowth: "area",
  expenseReceipt: "area",
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
  if (title.includes("حركة العهدة")) {
    return "cashConversion";
  }
  if (title.includes("الميزان النقدي")) {
    return "balanceScale";
  }
  if (title.includes("المخزون")) {
    return "inventoryCube";
  }
  return "salesGrowth";
}

function resolveActiveChartVariant(
  activeSeries: PantherChartSeries | undefined,
  explicitVariant: PantherChartVariant | undefined,
  resolvedIcon: PantherSpotlightIconName,
): PantherChartVariant {
  if (activeSeries?.chartVariant) return activeSeries.chartVariant;
  if (activeSeries?.id && SERIES_VARIANT_BY_ID[activeSeries.id]) {
    return SERIES_VARIANT_BY_ID[activeSeries.id];
  }
  if (explicitVariant) return explicitVariant;
  return ICON_DEFAULT_VARIANT[resolvedIcon] ?? "area";
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

type WaterfallStep = {
  idx: number;
  point: PantherChartPoint;
  startVal: number;
  endVal: number;
  kind: "start" | "plus" | "minus" | "subtotal" | "total";
};

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
  const normalized = raw
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[٬,]/g, "")
    .replace(/٫/g, ".")
    .replace(/[^\d.-]/g, "");
  const num = Number.parseFloat(normalized);
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

function isSyntheticPaddingPoint(pt: PantherChartPoint): boolean {
  return (
    pt.value === 0 &&
    (pt.label === "نقطة الأساس" ||
      pt.label === "نقطة البداية" ||
      pt.label === "بداية القياس")
  );
}

function normalizeAreaPoints(rawPoints: PantherChartPoint[]): PantherChartPoint[] {
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

function prepareVariantPoints(
  rawPoints: PantherChartPoint[],
  variant: PantherChartVariant,
): PantherChartPoint[] {
  if (variant === "area") {
    return normalizeAreaPoints(rawPoints);
  }
  if (rawPoints.length === 0) {
    return [{ label: "الآن", shortLabel: "الآن", value: 0, formattedValue: "0" }];
  }
  const cleaned = rawPoints.filter((p) => !isSyntheticPaddingPoint(p));
  const base = cleaned.length > 0 ? cleaned : [rawPoints[rawPoints.length - 1]];
  if (variant === "gauge") return base.slice(0, 5);
  if (variant === "donut") return base.slice(0, 5);
  if (variant === "bars") return base.slice(0, 4);
  if (variant === "waterfall") return base.slice(0, 6);
  if (variant === "columns") return base.slice(0, 10);
  return base;
}

function plotAreaSeriesPoints(points: PantherChartPoint[]): {
  plotted: PlottedPoint[];
  maxVal: number;
  minVal: number;
  zeroY: number;
} {
  let minVal = 0;
  let maxVal = 0;
  for (const pt of points) {
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

  const count = points.length;
  const usableWidth = SVG_W - PAD_X * 2;
  const plotted: PlottedPoint[] = points.map((pt, idx) => ({
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

function buildWaterfallSteps(points: PantherChartPoint[]): WaterfallStep[] {
  const n = points.length;
  const steps: WaterfallStep[] = [];
  let running = 0;

  for (let i = 0; i < n; i += 1) {
    const pt = points[i];
    const v = Number.isFinite(pt.value) ? pt.value : 0;
    const text = `${pt.shortLabel ?? ""} ${pt.label}`;

    if (i === 0) {
      running = v;
      steps.push({ idx: i, point: pt, startVal: 0, endVal: v, kind: "start" });
      continue;
    }

    if (i === n - 1 && n >= 3) {
      running = v;
      steps.push({ idx: i, point: pt, startVal: 0, endVal: v, kind: "total" });
      continue;
    }

    const isOutflow =
      pt.tone === "danger" ||
      /مدفوع|مصروف|منصرف|خصم|تكلفة|^−|-/.test(text);
    const isAdditive =
      pt.tone === "alt" || /^\+|إضافة|العُهَد|مقبوضات/.test(text);

    if (isOutflow) {
      const nextRun = running - Math.abs(v);
      steps.push({
        idx: i,
        point: pt,
        startVal: running,
        endVal: nextRun,
        kind: "minus",
      });
      running = nextRun;
    } else if (isAdditive) {
      const nextRun = running + Math.abs(v);
      steps.push({
        idx: i,
        point: pt,
        startVal: running,
        endVal: nextRun,
        kind: "plus",
      });
      running = nextRun;
    } else {
      running = v;
      steps.push({
        idx: i,
        point: pt,
        startVal: 0,
        endVal: v,
        kind: "subtotal",
      });
    }
  }

  return steps;
}

function resolvePointColorVar(
  pt: PantherChartPoint,
  idx: number,
  variant: PantherChartVariant,
): string {
  if (pt.tone === "danger") return "var(--mp-danger)";
  if (pt.tone === "warn") return "var(--mp-warn)";
  if (pt.tone === "alt") return "var(--mp-alt)";
  if (pt.tone === "accent") return "var(--mp-accent)";

  const txt = `${pt.label} ${pt.shortLabel ?? ""}`;
  if (/متبق|للاعتماد|معلق|نواقص|عجز|ملغ/.test(txt) || pt.value < 0) {
    return "var(--mp-danger)";
  }
  if (/للصرف|معتمد بانتظار|مرتجع|خصم/.test(txt)) {
    return "var(--mp-warn)";
  }
  if (variant === "donut") {
    const palette = [
      "var(--mp-accent)",
      "var(--mp-alt)",
      "var(--mp-warn)",
      "var(--mp-danger)",
    ];
    return palette[idx % palette.length];
  }
  return idx === 0 ? "var(--mp-accent)" : "var(--mp-alt)";
}

function shouldShowTick(index: number, total: number): boolean {
  if (total <= 6) return true;
  if (index === 0 || index === total - 1) return true;
  const step = Math.ceil((total - 1) / 4);
  return index % step === 0;
}

export default function PantherSpotlightCard({
  title,
  subtitle,
  pill,
  icon,
  chartVariant,
  primary,
  secondary,
  series,
  actionHref,
  actionLabel,
  layout = "section",
  children,
  dataDashPart,
  detailsHudToggle,
}: PantherSpotlightCardProps) {
  const titleId = useId();
  const gradientId = useId();
  const resolvedIcon = resolveSpotlightIcon(title, icon);

  const resolvedSeries =
    series && series.length > 0 ? series : buildFallbackSeries(primary, secondary);

  const [seriesIndex, setSeriesIndex] = useState(0);
  const safeSeriesIdx = Math.min(seriesIndex, resolvedSeries.length - 1);
  const currentSeries = resolvedSeries[safeSeriesIdx];

  const activeVariant = resolveActiveChartVariant(
    currentSeries,
    chartVariant,
    resolvedIcon,
  );

  const displayPoints = useMemo(
    () => prepareVariantPoints(currentSeries.points, activeVariant),
    [currentSeries.points, activeVariant],
  );
  const lastIndex = Math.max(0, displayPoints.length - 1);

  const defaultIndex = useMemo(() => {
    if (activeVariant === "area" || activeVariant === "waterfall") {
      return lastIndex;
    }
    if (activeVariant === "donut") {
      const firstPos = displayPoints.findIndex((p) => p.value > 0);
      return firstPos >= 0 ? firstPos : 0;
    }
    return 0;
  }, [activeVariant, displayPoints, lastIndex]);

  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [pinnedIndex, setPinnedIndex] = useState<number | null>(null);

  const rawActiveIndex = hoverIndex ?? pinnedIndex ?? defaultIndex;
  const activeIndex = Math.max(0, Math.min(rawActiveIndex, lastIndex));
  const activePoint = displayPoints[activeIndex] ?? displayPoints[0];

  const detailsRef = useRef<HTMLDivElement | null>(null);
  const pinnedPointForFilter = pinnedIndex !== null ? (displayPoints[pinnedIndex] ?? null) : null;
  const pinnedKey = pinnedPointForFilter?.pinKey ?? null;
  const hudToggleable = Boolean(detailsHudToggle) && Boolean(children);
  const detailsHudId = useId();
  const [detailsHudOpen, setDetailsHudOpen] = useState(false);
  // متى تُظهر البطاقة منطقة التفاصيل لكل نقطة؟
  // - البطاقات العادية (اليوم): تُفلتر حسب المثبّت فقط، والكل يظهر دون تثبيت.
  // - البطاقات الضاغطة على HUD: التفاصيل تتبع النقطة المعروضة في HUD (المثبّتة وإلا الافتراضية) دائمًا.
  const effectivePinKey = hudToggleable
    ? (pinnedKey ?? displayPoints[defaultIndex]?.pinKey ?? null)
    : pinnedKey;

  useEffect(() => {
    const root = detailsRef.current;
    if (!root) return;
    root.querySelectorAll<HTMLElement>("[data-pin-part]").forEach((el) => {
      const keys = (el.dataset.pinPart ?? "").split(/\s+/).filter(Boolean);
      el.hidden = effectivePinKey !== null && !keys.includes(effectivePinKey);
    });
  }, [effectivePinKey, children]);

  const isInteractiveSvgLane =
    activeVariant === "area" ||
    activeVariant === "columns" ||
    activeVariant === "waterfall";

  const areaPlot = useMemo(
    () => (activeVariant === "area" ? plotAreaSeriesPoints(displayPoints) : null),
    [activeVariant, displayPoints],
  );

  function resolveIndexFromClientX(clientX: number, target: HTMLElement): number {
    const rect = target.getBoundingClientRect();
    if (rect.width <= 0 || displayPoints.length === 0) return defaultIndex;
    if (activeVariant === "area" && areaPlot) {
      const relX = ((clientX - rect.left) / rect.width) * SVG_W;
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < areaPlot.plotted.length; i += 1) {
        const dist = Math.abs(areaPlot.plotted[i].x - relX);
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = i;
        }
      }
      return bestIdx;
    }
    const ratio = Math.max(0, Math.min(0.9999, (clientX - rect.left) / rect.width));
    return Math.floor(ratio * displayPoints.length);
  }

  function togglePin(idx: number) {
    setPinnedIndex((prev) => (prev === idx ? null : idx));
  }

  function renderChartBody() {
    if (activeVariant === "gauge") {
      const headlineScore = Math.max(
        0,
        Math.min(100, parseNumericFallback(primary.value)),
      );
      const isInspectingPillar = hoverIndex !== null || pinnedIndex !== null;
      const gaugePct = Math.max(
        0,
        Math.min(100, isInspectingPillar ? activePoint.value : headlineScore),
      );
      const R = 52;
      const CX = 160;
      const CY = 72;
      const arcLen = Math.PI * R;
      const filledLen = (gaugePct / 100) * arcLen;
      const rad = (gaugePct / 100) * Math.PI;
      const dotX = CX - R * Math.cos(rad);
      const dotY = CY - R * Math.sin(rad);
      const gaugeStroke =
        gaugePct >= 75
          ? "var(--mp-accent)"
          : gaugePct >= 50
            ? "var(--mp-warn)"
            : "var(--mp-danger)";

      return (
        <div className="monthly-panther__gauge">
          <svg
            viewBox="0 0 320 82"
            preserveAspectRatio="xMidYMid meet"
            className="monthly-panther__gauge-svg"
          >
            {[0, 0.25, 0.5, 0.75, 1].map((t) => {
              const a = t * Math.PI;
              const x1 = CX - (R + 7) * Math.cos(a);
              const y1 = CY - (R + 7) * Math.sin(a);
              const x2 = CX - (R + 11) * Math.cos(a);
              const y2 = CY - (R + 11) * Math.sin(a);
              return (
                <line
                  key={t}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="var(--mp-muted)"
                  strokeWidth="1.35"
                  opacity="0.45"
                />
              );
            })}
            <path
              d={`M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`}
              fill="none"
              stroke="var(--mp-track)"
              strokeWidth="10.5"
              strokeLinecap="round"
            />
            <path
              d={`M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`}
              fill="none"
              stroke={gaugeStroke}
              strokeWidth="10.5"
              strokeLinecap="round"
              strokeDasharray={`${filledLen.toFixed(2)} ${arcLen.toFixed(2)}`}
              className="monthly-panther__gauge-arc"
            />
            <circle
              cx={dotX}
              cy={dotY}
              r="5"
              fill={gaugeStroke}
              stroke="var(--mp-node-bg, var(--mp-bg))"
              strokeWidth="2"
            />
            <text
              x={CX}
              y="53"
              textAnchor="middle"
              className="monthly-panther__gauge-score"
            >
              {Math.round(gaugePct)}%
            </text>
            <text
              x={CX}
              y="69"
              textAnchor="middle"
              className="monthly-panther__gauge-caption"
            >
              {isInspectingPillar
                ? (activePoint.shortLabel ?? activePoint.label).slice(0, 14)
                : "المؤشر المركّب"}
            </text>
          </svg>

          <div className="monthly-panther__gauge-pillars" dir="rtl">
            {displayPoints.map((pt, idx) => {
              const isAct = idx === activeIndex;
              return (
                <button
                  key={`pillar-${pt.label}-${idx}`}
                  type="button"
                  className={`monthly-panther__gauge-chip${isAct ? " is-active" : ""}`}
                  onMouseEnter={() => setHoverIndex(idx)}
                  onMouseLeave={() => setHoverIndex(null)}
                  onClick={(e) => {
                    e.stopPropagation();
                    togglePin(idx);
                  }}
                >
                  <span className="monthly-panther__gauge-chip-label">
                    {pt.shortLabel ?? pt.label.slice(0, 8)}
                  </span>
                  <bdi dir="ltr" className="monthly-panther__gauge-chip-val">
                    {Math.round(pt.value)}
                  </bdi>
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    if (activeVariant === "donut") {
      const R = 36;
      const C = 2 * Math.PI * R;
      const magnitudes = displayPoints.map((p) => Math.max(0, p.value));
      const totalMag = magnitudes.reduce((a, b) => a + b, 0);
      const nonZeroCount = magnitudes.filter((m) => m > 0).length;

      let cumFrac = 0;
      const slices = displayPoints.map((pt, idx) => {
        const mag = magnitudes[idx];
        const frac = totalMag > 0 ? mag / totalMag : 0;
        const startFrac = cumFrac;
        cumFrac += frac;
        const rawLen = frac * C;
        const visibleLen =
          nonZeroCount > 1 && rawLen > 4 ? Math.max(1.6, rawLen - 2.4) : rawLen;
        return {
          idx,
          point: pt,
          frac,
          pct: totalMag > 0 ? Math.round(frac * 100) : 0,
          dashArray: `${visibleLen.toFixed(2)} ${C.toFixed(2)}`,
          dashOffset: -(startFrac * C),
          color: resolvePointColorVar(pt, idx, "donut"),
        };
      });

      const activeSlice = slices[activeIndex] ?? slices[0];

      return (
        <div className="monthly-panther__donut" dir="rtl">
          <svg
            viewBox="0 0 104 104"
            className="monthly-panther__donut-ring"
            aria-hidden="true"
          >
            <circle
              cx="52"
              cy="52"
              r={R}
              fill="none"
              stroke="var(--mp-track)"
              strokeWidth="10.5"
            />
            {totalMag > 0
              ? slices.map((s) =>
                  s.frac > 0 ? (
                    <circle
                      key={`slice-${s.idx}`}
                      cx="52"
                      cy="52"
                      r={R}
                      fill="none"
                      stroke={s.color}
                      strokeWidth={s.idx === activeIndex ? 13.5 : 10.5}
                      strokeDasharray={s.dashArray}
                      strokeDashoffset={s.dashOffset}
                      transform="rotate(-90 52 52)"
                      className="monthly-panther__donut-slice"
                      opacity={s.idx === activeIndex ? 1 : 0.78}
                      onMouseEnter={() => setHoverIndex(s.idx)}
                      onMouseLeave={() => setHoverIndex(null)}
                      onClick={(e) => {
                        e.stopPropagation();
                        togglePin(s.idx);
                      }}
                    />
                  ) : null,
                )
              : null}
            <text
              x="52"
              y="49"
              textAnchor="middle"
              className="monthly-panther__donut-pct"
            >
              {activeSlice ? `${activeSlice.pct}%` : "0%"}
            </text>
            <text
              x="52"
              y="64"
              textAnchor="middle"
              className="monthly-panther__donut-sub"
            >
              {(activeSlice?.point.shortLabel ?? activeSlice?.point.label ?? "").slice(
                0,
                9,
              )}
            </text>
          </svg>

          <div className="monthly-panther__donut-legend">
            {slices.slice(0, 4).map((s) => {
              const isAct = s.idx === activeIndex;
              return (
                <button
                  key={`legend-${s.point.label}-${s.idx}`}
                  type="button"
                  className={`monthly-panther__donut-item${isAct ? " is-active" : ""}`}
                  onMouseEnter={() => setHoverIndex(s.idx)}
                  onMouseLeave={() => setHoverIndex(null)}
                  onClick={(e) => {
                    e.stopPropagation();
                    togglePin(s.idx);
                  }}
                >
                  <span
                    className="monthly-panther__donut-dot"
                    style={{ background: s.color }}
                    aria-hidden="true"
                  />
                  <span className="monthly-panther__donut-name">
                    {s.point.shortLabel ?? s.point.label}
                  </span>
                  <bdi dir="ltr" className="monthly-panther__donut-share">
                    {s.pct}%
                  </bdi>
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    if (activeVariant === "bars") {
      const rawMax = Math.max(
        1,
        ...displayPoints.map((p) =>
          Math.max(Math.abs(p.value), p.secondaryValue ?? 0),
        ),
      );
      const isScoreScale =
        rawMax <= 100 &&
        displayPoints.some(
          (p) =>
            p.formattedValue.includes("١٠٠") ||
            p.formattedValue.includes("100") ||
            (p.secondaryLabel ?? "").includes("المستهدف"),
        );
      const scaleMax = isScoreScale ? 100 : rawMax;

      return (
        <div className="monthly-panther__bars" dir="rtl">
          {displayPoints.map((pt, idx) => {
            const isAct = idx === activeIndex;
            const pct = Math.max(
              4,
              Math.min(100, (Math.abs(pt.value) / scaleMax) * 100),
            );
            const targetPct =
              pt.secondaryValue !== undefined &&
              pt.secondaryValue > 0 &&
              pt.secondaryValue <= scaleMax
                ? Math.min(100, (pt.secondaryValue / scaleMax) * 100)
                : null;
            const fillVar =
              pt.value < 0
                ? "var(--mp-danger)"
                : idx === 0
                  ? "var(--mp-accent)"
                  : "var(--mp-alt)";

            return (
              <button
                key={`bar-${pt.label}-${idx}`}
                type="button"
                className={`monthly-panther__bar-row${isAct ? " is-active" : ""}`}
                onMouseEnter={() => setHoverIndex(idx)}
                onMouseLeave={() => setHoverIndex(null)}
                onClick={(e) => {
                  e.stopPropagation();
                  togglePin(idx);
                }}
              >
                <span className="monthly-panther__bar-rank" aria-hidden="true">
                  {idx + 1}
                </span>
                <span className="monthly-panther__bar-name">
                  {pt.shortLabel ?? pt.label}
                </span>
                <span className="monthly-panther__bar-track" dir="ltr">
                  <span
                    className="monthly-panther__bar-fill"
                    style={{ width: `${pct.toFixed(1)}%`, background: fillVar }}
                  />
                  {targetPct !== null ? (
                    <span
                      className="monthly-panther__bar-target"
                      style={{ left: `${targetPct.toFixed(1)}%` }}
                      aria-hidden="true"
                    />
                  ) : null}
                </span>
                <bdi dir="ltr" className="monthly-panther__bar-val">
                  {pt.formattedValue}
                </bdi>
              </button>
            );
          })}
        </div>
      );
    }

    if (activeVariant === "waterfall") {
      const steps = buildWaterfallSteps(displayPoints);
      const n = steps.length;
      const allLevels = steps.flatMap((s) => [s.startVal, s.endVal, 0]);
      const minV = Math.min(...allLevels);
      const maxV = Math.max(...allLevels);
      const span = maxV - minV || 1;
      const plotH = BOTTOM_Y - TOP_Y;
      const toY = (v: number) => BOTTOM_Y - ((v - minV) / span) * plotH;
      const zeroY = toY(0);
      const laneW = (SVG_W - PAD_X * 2) / Math.max(1, n);
      const barW = Math.min(34, Math.max(12, laneW * 0.56));

      return (
        <>
          <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} preserveAspectRatio="none">
            <line
              x1={PAD_X}
              y1={TOP_Y}
              x2={SVG_W - PAD_X}
              y2={TOP_Y}
              className="monthly-panther__grid-line"
            />
            <line
              x1={PAD_X}
              y1={zeroY}
              x2={SVG_W - PAD_X}
              y2={zeroY}
              className="monthly-panther__grid-baseline"
            />
            {steps.map((s, i) => {
              const cx = PAD_X + (i + 0.5) * laneW;
              const bx = cx - barW / 2;
              const yA = toY(s.startVal);
              const yB = toY(s.endVal);
              const barTop = Math.min(yA, yB);
              const barH = Math.max(4, Math.abs(yB - yA));
              const isAct = i === activeIndex;
              const fill =
                s.kind === "minus" || (s.kind === "total" && s.endVal < 0)
                  ? "var(--mp-danger)"
                  : s.kind === "total"
                    ? "var(--mp-alt)"
                    : "var(--mp-accent)";

              const nextCx = i < n - 1 ? PAD_X + (i + 1.5) * laneW : null;
              const connY = toY(s.endVal);

              return (
                <g key={`wf-${s.idx}`}>
                  {nextCx !== null ? (
                    <line
                      x1={bx + barW}
                      y1={connY}
                      x2={nextCx - barW / 2}
                      y2={connY}
                      stroke="var(--mp-muted)"
                      strokeWidth="1.15"
                      strokeDasharray="3 3"
                      opacity="0.58"
                      vectorEffect="non-scaling-stroke"
                    />
                  ) : null}
                  <rect
                    x={bx}
                    y={barTop}
                    width={barW}
                    height={barH}
                    rx="4"
                    fill={fill}
                    opacity={isAct ? 1 : 0.72}
                  />
                  {isAct ? (
                    <line
                      x1={cx}
                      y1={TOP_Y - 4}
                      x2={cx}
                      y2={BOTTOM_Y}
                      className="monthly-panther__crosshair"
                      vectorEffect="non-scaling-stroke"
                    />
                  ) : null}
                </g>
              );
            })}
          </svg>

          <div className="monthly-panther__x-axis" aria-hidden="true">
            {steps.map((s, idx) => {
              if (!shouldShowTick(idx, n)) return null;
              const tickText = s.point.shortLabel ?? s.point.label.slice(0, 7);
              const cx = PAD_X + (idx + 0.5) * laneW;
              return (
                <span
                  key={`wf-tick-${idx}`}
                  className={`monthly-panther__x-tick${idx === activeIndex ? " is-active" : ""}`}
                  style={{ left: `${(cx / SVG_W) * 100}%` }}
                >
                  {tickText}
                </span>
              );
            })}
          </div>
        </>
      );
    }

    if (activeVariant === "columns") {
      const n = displayPoints.length;
      const vals = displayPoints.map((p) => (Number.isFinite(p.value) ? p.value : 0));
      const minV = Math.min(0, ...vals);
      const maxV = Math.max(0, ...vals);
      const span = maxV - minV || 1;
      const plotH = BOTTOM_Y - TOP_Y;
      const toY = (v: number) => BOTTOM_Y - ((v - minV) / span) * plotH;
      const zeroY = toY(0);
      const avgV = vals.reduce((a, b) => a + b, 0) / Math.max(1, n);
      const showAvg = n >= 2 && (maxV > 0 || minV < 0);
      const avgY = toY(avgV);
      const laneW = (SVG_W - PAD_X * 2) / Math.max(1, n);
      const barW = Math.min(28, Math.max(8, laneW * 0.56));

      return (
        <>
          <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} preserveAspectRatio="none">
            <line
              x1={PAD_X}
              y1={TOP_Y}
              x2={SVG_W - PAD_X}
              y2={TOP_Y}
              className="monthly-panther__grid-line"
            />
            <line
              x1={PAD_X}
              y1={zeroY}
              x2={SVG_W - PAD_X}
              y2={zeroY}
              className="monthly-panther__grid-baseline"
            />
            {displayPoints.map((pt, i) => {
              const cx = PAD_X + (i + 0.5) * laneW;
              const bx = cx - barW / 2;
              const yVal = toY(vals[i]);
              const barTop = Math.min(zeroY, yVal);
              const barH = Math.max(3.5, Math.abs(zeroY - yVal));
              const isAct = i === activeIndex;
              const fill =
                vals[i] < 0
                  ? "var(--mp-danger)"
                  : isAct
                    ? "var(--mp-accent)"
                    : "var(--mp-alt)";

              return (
                <g key={`col-${i}`}>
                  <rect
                    x={bx}
                    y={TOP_Y}
                    width={barW}
                    height={plotH}
                    rx="4"
                    fill="var(--mp-track)"
                  />
                  <rect
                    x={bx}
                    y={barTop}
                    width={barW}
                    height={barH}
                    rx="4"
                    fill={fill}
                    opacity={isAct ? 1 : 0.72}
                  />
                </g>
              );
            })}
            {showAvg ? (
              <line
                x1={PAD_X}
                y1={avgY}
                x2={SVG_W - PAD_X}
                y2={avgY}
                stroke="var(--mp-warn)"
                strokeWidth="1.35"
                strokeDasharray="4 3"
                opacity="0.82"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
          </svg>

          <div className="monthly-panther__x-axis" aria-hidden="true">
            {displayPoints.map((pt, idx) => {
              if (!shouldShowTick(idx, n)) return null;
              const tickText = pt.shortLabel ?? pt.label.slice(0, 7);
              const cx = PAD_X + (idx + 0.5) * laneW;
              return (
                <span
                  key={`col-tick-${idx}`}
                  className={`monthly-panther__x-tick${idx === activeIndex ? " is-active" : ""}`}
                  style={{ left: `${(cx / SVG_W) * 100}%` }}
                >
                  {tickText}
                </span>
              );
            })}
          </div>
        </>
      );
    }

    // Default: "area" (Smooth Monotone Cubic Spline)
    const { plotted, zeroY } = areaPlot!;
    const areaLastIdx = plotted.length - 1;
    const areaActivePt = plotted[activeIndex] ?? plotted[areaLastIdx];
    const primaryLinePath = buildMonotonePath(
      plotted.map((p) => ({ x: p.x, y: p.y })),
    );
    const areaPath = `${primaryLinePath} L${plotted[areaLastIdx].x.toFixed(2)},${zeroY.toFixed(2)} L${plotted[0].x.toFixed(2)},${zeroY.toFixed(2)} Z`;
    const hasSecondaryLine = plotted.every((p) => p.secondaryY !== null);
    const secondaryLinePath = hasSecondaryLine
      ? buildMonotonePath(
          plotted.map((p) => ({ x: p.x, y: p.secondaryY ?? zeroY })),
        )
      : "";
    const dotLeftPct = (areaActivePt.x / SVG_W) * 100;
    const dotTopPct = (areaActivePt.y / SVG_H) * 100;

    return (
      <>
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

          <line
            x1={areaActivePt.x}
            y1={TOP_Y - 4}
            x2={areaActivePt.x}
            y2={BOTTOM_Y}
            className="monthly-panther__crosshair"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {hasSecondaryLine && areaActivePt.secondaryY !== null ? (
          <span
            className="monthly-panther__sec-dot"
            style={{
              left: `${(areaActivePt.x / SVG_W) * 100}%`,
              top: `${(areaActivePt.secondaryY / SVG_H) * 100}%`,
            }}
            aria-hidden="true"
          />
        ) : null}

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
      </>
    );
  }

  return (
    <section
      className={`monthly-panther${layout === "section" ? " is-section" : ""}`}
      aria-labelledby={titleId}
      data-chart-variant={activeVariant}
      data-dash-part={dataDashPart}
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

          <div
            className={`monthly-panther__hud${hudToggleable ? " monthly-panther__hud--toggle" : ""}`}
            {...(hudToggleable
              ? ({
                  role: "button",
                  tabIndex: 0,
                  "aria-expanded": detailsHudOpen,
                  "aria-controls": detailsHudId,
                  onClick: () => setDetailsHudOpen((v) => !v),
                  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setDetailsHudOpen((v) => !v);
                    }
                  },
                } as const)
              : ({ "aria-live": "polite" } as const))}
          >
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

            {hudToggleable ? (
              <span className="monthly-panther__hud-toggle" aria-hidden="true">
                <svg
                  viewBox="0 0 24 24"
                  width="14"
                  height="14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </span>
            ) : null}
          </div>

          <div
            className={`monthly-panther__chart is-variant-${activeVariant}`}
            data-chart-variant={activeVariant}
            dir="ltr"
            tabIndex={0}
            role="group"
            aria-label={`مؤشر تفاعلي لـ ${title} — حرّك المؤشر أو الأسهم لاستعراض القيم`}
            onPointerMove={
              isInteractiveSvgLane
                ? (event) => {
                    setHoverIndex(
                      resolveIndexFromClientX(event.clientX, event.currentTarget),
                    );
                  }
                : undefined
            }
            onPointerLeave={
              isInteractiveSvgLane
                ? () => {
                    setHoverIndex(null);
                  }
                : undefined
            }
            onClick={
              isInteractiveSvgLane
                ? (event) => {
                    const idx = resolveIndexFromClientX(
                      event.clientX,
                      event.currentTarget,
                    );
                    setPinnedIndex((prev) => (prev === idx ? null : idx));
                  }
                : undefined
            }
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
            {renderChartBody()}
          </div>
        </div>

        {children ? (
          <div
            className="monthly-panther__details"
            ref={detailsRef}
            id={detailsHudId}
            data-pin-key={effectivePinKey ?? undefined}
            hidden={hudToggleable && !detailsHudOpen}
          >
            {children}
          </div>
        ) : null}

        <div className="monthly-panther__foot">
          <Link href={actionHref} className="monthly-panther__btn">
            {actionLabel}
          </Link>
        </div>
      </div>
    </section>
  );
}
