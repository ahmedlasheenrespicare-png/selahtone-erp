import type { ReactNode } from "react";
import PantherSpotlightCard, {
  type PantherChartSeries,
} from "@/components/panther-spotlight-card";

export type MonthlySalesPantherProps = {
  monthLabel: string;
  totalFormatted: string;
  outstandingFormatted: string;
  averageFormatted: string;
  invoiceCount: string;
  outstandingCount: string;
  hasOutstanding: boolean;
  collectedPercent: number;
  outstandingPercent: number;
  hasSales: boolean;
  series: PantherChartSeries[];
  reportHref: string;
  reportLabel: string;
  /** عند تفعيلها ضغطُ المستخدم على الـHUD يُظهِر/يُخفي التفاصيل (accordion) */
  detailsHudToggle?: boolean;
  children?: ReactNode;
};

export default function MonthlySalesPanther({
  monthLabel,
  totalFormatted,
  outstandingFormatted,
  averageFormatted,
  invoiceCount,
  outstandingCount,
  hasOutstanding,
  collectedPercent,
  outstandingPercent,
  hasSales,
  series,
  reportHref,
  reportLabel,
  detailsHudToggle,
  children,
}: MonthlySalesPantherProps) {
  return (
    <PantherSpotlightCard
      layout="wallet"
      icon="salesGrowth"
      chartVariant="area"
      title="مبيعات الشهر"
      subtitle={`محدّث الآن · ${monthLabel}`}
      pill={`${invoiceCount} فاتورة`}
      primary={{
        label: "صافي المبيعات",
        value: totalFormatted,
        unit: "ج.م",
        delta: hasSales
          ? `${collectedPercent}% محصّل · متوسط ${averageFormatted} ج.م`
          : "لا فواتير مؤكدة بعد هذا الشهر",
        tone: "positive",
      }}
      secondary={{
        label: "المتبقي على العملاء",
        value: outstandingFormatted,
        unit: "ج.م",
        delta: hasOutstanding
          ? `${outstandingPercent}% آجل · ${outstandingCount} فاتورة عليها باقٍ`
          : "0% متأخرات · مسدّدة بالكامل",
        tone: hasOutstanding ? "negative" : "positive",
      }}
      series={series}
      actionHref={reportHref}
      actionLabel={reportLabel}
      detailsHudToggle={detailsHudToggle}
    >
      {children}
    </PantherSpotlightCard>
  );
}
