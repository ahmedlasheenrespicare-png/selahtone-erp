import React from "react";
import type { DataColumn } from "@/components/data-driven/data-table";
import type { DataFilterTab, DataSelectOption } from "@/lib/data-driven-ui";

/** Client-safe analytics DTO; profitability fields are optional by authorization. */
export type SafeTopItem = {
  key: string;
  name: string;
  category: string;
  isStock: boolean;
  quantityFormatted: string;
  quantityNum: number;
  lines: number;
  revenueFormatted: string;
  revenueNum: number;
  sharePct: number;
  costFormatted?: string | null;
  profitFormatted?: string | null;
  profitNum?: number;
  marginPct?: number | null;
};
export type SalesStatsSortKey = "revenue" | "quantity" | "profit";
export type SalesStatsItemKind = "all" | "stock" | "catalog";

export const salesStatsItemSearch = {
  ariaLabel: "بحث في جدول الأصناف المباعة",
  placeholder: "ابحث باسم الصنف أو التصنيف...",
  text: (item: SafeTopItem): readonly string[] => [item.name, item.category],
};

export const salesStatsItemKinds: Array<DataFilterTab<SafeTopItem, SalesStatsItemKind>> = [
  { id: "all", label: "الكل", matches: () => true },
  { id: "stock", label: "مخزوني", matches: (item) => item.isStock },
  { id: "catalog", label: "كتالوج فني", matches: (item) => !item.isStock },
];

export type SalesStatsSortOption = DataSelectOption<SalesStatsSortKey> & {
  compare: (a: SafeTopItem, b: SafeTopItem) => number;
};

export function createSalesStatsSortOptions(showProfitability: boolean): SalesStatsSortOption[] {
  return [
    {
      value: "revenue",
      label: "الأعلى إيرادًا",
      compare: (a, b) => b.revenueNum - a.revenueNum || b.quantityNum - a.quantityNum,
    },
    {
      value: "quantity",
      label: "الأكثر كميةً",
      compare: (a, b) => b.quantityNum - a.quantityNum || b.revenueNum - a.revenueNum,
    },
    ...(showProfitability ? [{
      value: "profit" as const,
      label: "الأعلى ربحًا",
      compare: (a: SafeTopItem, b: SafeTopItem) => {
        if (a.isStock !== b.isStock) return a.isStock ? -1 : 1;
        return (b.profitNum ?? 0) - (a.profitNum ?? 0) || b.revenueNum - a.revenueNum;
      },
    }] : []),
  ];
}

export function createSalesStatsItemColumns(showProfitability: boolean): DataColumn<SafeTopItem>[] {
  return [
    {
      id: "rank",
      header: "#",
      cellClassName: "sales-stats-rank",
      renderCell: (_item, index) => index + 1,
    },
    {
      id: "item",
      header: "الصنف والنوع",
      renderCell: (item) => (
        <div className="sales-stats-item-cell">
          <strong>{item.name}</strong>
          <span className={`sale-chip ${item.isStock ? "" : "sale-chip--neutral"}`}>
            <span className="sale-chip__dot" aria-hidden="true" />
            {item.isStock ? "صنف مخزوني" : "كتالوج فني"}
          </span>
        </div>
      ),
    },
    { id: "category", header: "التصنيف", renderCell: (item) => item.category },
    {
      id: "quantity",
      header: "الكمية الصافية",
      renderCell: (item) => (
        <>
          <bdi dir="ltr">{item.quantityFormatted}</bdi>
          <small className="sales-stats-cell-sub">{item.lines} سطر</small>
        </>
      ),
    },
    {
      id: "revenue",
      header: "صافي الإيراد",
      renderCell: (item) => <strong><bdi dir="ltr">{item.revenueFormatted}</bdi> ج.م</strong>,
    },
    {
      id: "share",
      header: "نسبة المساهمة",
      renderCell: (item) => (
        <div className="sales-stats-share">
          <span><bdi dir="ltr">{item.sharePct}%</bdi></span>
          <div className="sales-stats-bar" aria-hidden="true">
            <span style={{ width: `${Math.min(100, Math.max(3, item.sharePct))}%` }} />
          </div>
        </div>
      ),
    },
    ...(showProfitability ? [
      {
        id: "cost",
        header: "التكلفة",
        renderCell: (item: SafeTopItem) => item.costFormatted != null ? (
          <span><bdi dir="ltr">{item.costFormatted}</bdi> ج.م</span>
        ) : <span className="sales-stats-muted">—</span>,
      },
      {
        id: "profit",
        header: "الربح والهامش",
        renderCell: (item: SafeTopItem) => item.isStock && item.profitFormatted != null ? (
          <div className="sales-stats-profit-cell">
            <strong><bdi dir="ltr">{item.profitFormatted}</bdi> ج.م</strong>
            <span className={`sale-chip ${(item.marginPct ?? 0) >= 20 ? "" : (item.marginPct ?? 0) > 0 ? "sale-chip--warning" : "sale-chip--neutral"}`}>
              هامش <bdi dir="ltr">{item.marginPct ?? 0}%</bdi>
            </span>
          </div>
        ) : <span className="sale-chip sale-chip--neutral">بدون تكلفة مسجّلة</span>,
      },
    ] : []),
  ];
}
