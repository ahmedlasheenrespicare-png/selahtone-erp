"use client";

import { useMemo, useState } from "react";
import { AppIcon } from "@/components/app-icon";
import DataTable from "@/components/data-driven/data-table";
import { filterRowsBySearch } from "@/lib/data-driven-ui";
import type {
  ExecutiveBranchRow,
  ExecutivePaymentMethodRow,
  ExecutiveStaffRow,
} from "@/lib/sales-stats";
import {
  createSalesStatsItemColumns,
  createSalesStatsSortOptions,
  salesStatsItemKinds,
  salesStatsItemSearch,
  type SafeTopItem,
  type SalesStatsItemKind,
  type SalesStatsSortKey,
} from "./sales-stats-items-metadata";

export type CsvExportPayload = {
  periodLabel: string;
  branchLabel: string;
  generatedAt: string;
  invoiceCount: number;
  cancelledCount: number;
  subtotalFormatted: string;
  discountFormatted: string;
  returnedFormatted: string;
  netSalesFormatted: string;
  netCollectedFormatted: string;
  collectionRatePct: number;
  outstandingFormatted: string;
  profitability?: { stockProfitFormatted: string; stockMarginPct: number };
  catalogRevenueFormatted: string;
  paymentMethods: ExecutivePaymentMethodRow[];
  branchPerformance: ExecutiveBranchRow[];
  staffPerformance: ExecutiveStaffRow[];
  topItems: SafeTopItem[];
};

function csvEscape(value: string | number): string {
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildSalesStatsCsv(exportPayload: CsvExportPayload): string {
    const lines: string[][] = [
      ["تقرير إحصائيات المبيعات — سيلاه تون (SelahTone ERP)"],
      ["الفترة الزمنية", exportPayload.periodLabel],
      ["نطاق الفرع", exportPayload.branchLabel],
      ["تاريخ استخراج التقرير", exportPayload.generatedAt],
      [],
      ["ملخص الأداء التنفيذي", "القيمة"],
      ["عدد الفواتير النشطة", String(exportPayload.invoiceCount)],
      ["الفواتير الملغاة", String(exportPayload.cancelledCount)],
      ["إجمالي قبل الخصم (ج.م)", exportPayload.subtotalFormatted],
      ["الخصومات (ج.م)", exportPayload.discountFormatted],
      ["المرتجعات (ج.م)", exportPayload.returnedFormatted],
      ["صافي المبيعات بعد المرتجعات (ج.م)", exportPayload.netSalesFormatted],
      ["صافي المحصّل الفعلي (ج.م)", exportPayload.netCollectedFormatted],
      ["نسبة التحصيل (%)", `${exportPayload.collectionRatePct}%`],
      ["المتبقي على العملاء (ج.م)", exportPayload.outstandingFormatted],
      ...(exportPayload.profitability ? [
        ["ربح الأصناف المخزونية (ج.م)", exportPayload.profitability.stockProfitFormatted],
        ["هامش ربح المخزوني (%)", `${exportPayload.profitability.stockMarginPct}%`],
      ] : []),
      ["إيراد الكتالوج الفني بدون تكلفة (ج.م)", exportPayload.catalogRevenueFormatted],
      [],
      ["طرق الدفع والتحصيل", "عدد الحركات", "صافي المحصّل (ج.م)", "الحصة (%)"],
      ...exportPayload.paymentMethods.map((m) => [
        m.label,
        String(m.count),
        m.netFormatted,
        `${m.sharePct}%`,
      ]),
      [],
      [
        "مقارنة أداء الفروع",
        "الكود",
        "الفواتير النشطة",
        "صافي المبيعات (ج.م)",
        "صافي المحصّل (ج.م)",
        "نسبة التحصيل (%)",
        "المتبقي على العملاء (ج.م)",
        "المرتجعات (ج.م)",
      ],
      ...exportPayload.branchPerformance.map((b) => [
        b.branchName,
        b.branchCode,
        String(b.invoiceCount),
        b.netSalesFormatted,
        b.netCollectedFormatted,
        `${b.collectionRatePct}%`,
        b.outstandingFormatted,
        b.returnedFormatted,
      ]),
      [],
      [
        "أداء موظفي المبيعات",
        "الفرع",
        "الفواتير النشطة",
        "صافي المبيعات (ج.م)",
        "صافي المحصّل (ج.م)",
        "متوسط الفاتورة (ج.م)",
        "نسبة التحصيل (%)",
      ],
      ...exportPayload.staffPerformance.map((s) => [
        s.staffName,
        s.branchName,
        String(s.invoiceCount),
        s.netSalesFormatted,
        s.netCollectedFormatted,
        s.averageInvoiceFormatted,
        `${s.collectionRatePct}%`,
      ]),
      [],
      [
        "أكثر الأصناف مبيعًا",
        "نوع البند",
        "التصنيف",
        "الكمية الصافية",
        "صافي الإيراد (ج.م)",
        "المساهمة (%)",
        ...(exportPayload.profitability ? ["التكلفة (ج.م)", "الربح الصافي (ج.م)", "هامش الربح (%)"] : []),
      ],
      ...exportPayload.topItems.map((i) => [
        i.name,
        i.isStock ? "مخزوني" : "كتالوج فني",
        i.category,
        i.quantityFormatted,
        i.revenueFormatted,
        `${i.sharePct}%`,
        ...(exportPayload.profitability ? [
          i.costFormatted ?? "غير مسجل", i.profitFormatted ?? "غير مسجل",
          i.marginPct != null ? `${i.marginPct}%` : "—",
        ] : []),
      ]),
    ];

    return "\uFEFF" + lines.map((row) => row.map(csvEscape).join(",")).join("\r\n");
}

export function SalesStatsActionToolbar({
  exportPayload,
  fileSlug,
}: {
  exportPayload: CsvExportPayload;
  fileSlug: string;
}) {
  const [exportMessage, setExportMessage] = useState("");
  const handleExportCsv = () => {
    const csvText = buildSalesStatsCsv(exportPayload);
    const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `selahtone-sales-stats-${fileSlug}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setExportMessage(`تم بدء تنزيل تقرير CSV ويضم ${exportPayload.invoiceCount} فاتورة نشطة.`);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="sales-stats-export-bar no-print">
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{exportMessage}</p>
      <button
        type="button"
        className="inv-button inv-button--secondary sales-stats-export-btn"
        onClick={handleExportCsv}
      >
        <AppIcon name="reports" />
        <span>تصدير التقرير (CSV)</span>
      </button>
      <button
        type="button"
        className="inv-button inv-button--secondary sales-stats-export-btn"
        onClick={handlePrint}
      >
        <AppIcon name="receipt" />
        <span>طباعة الملخص</span>
      </button>
    </div>
  );
}

export function SalesStatsTopItemsPanel({ items, showProfitability }: { items: SafeTopItem[]; showProfitability: boolean }) {
  const [sortBy, setSortBy] = useState<SalesStatsSortKey>("revenue");
  const [kindFilter, setKindFilter] = useState<SalesStatsItemKind>("all");
  const [query, setQuery] = useState("");

  const columns = useMemo(() => createSalesStatsItemColumns(showProfitability), [showProfitability]);
  const sortOptions = useMemo(() => createSalesStatsSortOptions(showProfitability), [showProfitability]);
  const counts = useMemo(() => Object.fromEntries(
    salesStatsItemKinds.map((kind) => [kind.id, items.filter(kind.matches).length]),
  ) as Record<SalesStatsItemKind, number>, [items]);

  const filteredAndSorted = useMemo(() => {
    const kind = salesStatsItemKinds.find((item) => item.id === kindFilter) ?? salesStatsItemKinds[0];
    const sort = sortOptions.find((item) => item.value === sortBy) ?? sortOptions[0];
    return filterRowsBySearch(items.filter(kind.matches), query, salesStatsItemSearch.text)
      .sort(sort.compare);
  }, [items, kindFilter, query, sortBy, sortOptions]);

  function resetItemFilters(): void {
    setQuery("");
    setKindFilter("all");
    setSortBy("revenue");
  }

  return (
    <div id="top-items-section" className="inv-panel sales-stats-items-panel">
      <div className="inv-panel__heading sales-stats-items-head">
        <div>
          <h2>أكثر الأصناف مبيعًا ومساهمةً في الإيراد{showProfitability ? " والربح" : ""}</h2>
          <p>
            صافي الكميات والإيرادات بعد خصم المرتجعات، مع فصل الأصناف المخزونية عن أصناف الكتالوج الفني.
          </p>
        </div>
        {items.length > 0 ? (
          <div className="sales-stats-items-controls no-print">
            <div className="sales-stats-seg" role="group" aria-label="ترتيب الأصناف">
              {sortOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`sales-stats-seg__btn${sortBy === option.value ? " is-active" : ""}`}
                  onClick={() => setSortBy(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="sales-stats-seg" role="group" aria-label="تصفية نوع الصنف">
              {salesStatsItemKinds.map((kind) => (
                <button
                  key={kind.id}
                  type="button"
                  className={`sales-stats-seg__btn${kindFilter === kind.id ? " is-active" : ""}`}
                  onClick={() => setKindFilter(kind.id)}
                >
                  {kind.label} ({counts[kind.id]})
                </button>
              ))}
            </div>

            <input
              type="search"
              className="sales-stats-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={salesStatsItemSearch.placeholder}
              aria-label={salesStatsItemSearch.ariaLabel}
            />
          </div>
        ) : null}
      </div>

      {items.length === 0 ? (
        <div className="inv-panel__body">
          <p className="inv-field__hint" role="status">لا توجد مبيعات مسجلة في هذه الفترة أو النطاق المختار.</p>
        </div>
      ) : filteredAndSorted.length === 0 ? (
        <div className="inv-panel__body">
          <p className="inv-field__hint" role="status">لا توجد أصناف مطابقة للفلتر أو عبارة البحث الحالية.</p>
          <button type="button" className="inv-button inv-button--secondary no-print" onClick={resetItemFilters}>مسح البحث والفلاتر</button>
        </div>
      ) : (
        <DataTable
          rows={filteredAndSorted}
          columns={columns}
          rowKey={(item) => item.key}
          regionLabel="جدول أكثر الأصناف مبيعًا"
          tableClassName="inv-table sales-stats-table"
        />
      )}

      {showProfitability ? <div className="inv-page__foot sales-stats-foot">
        الربح يُحتسب حصريًا للأصناف المخزونية المسعّرة بمتوسط التكلفة (صافي الإيراد المخزوني − تكلفة الكمية المباعة بعد خصم المرتجعات). أما أصناف الكتالوج الفني فتُعرض مستقلةً دون افتراض تكلفتها صفرًا.
      </div> : null}
    </div>
  );
}
