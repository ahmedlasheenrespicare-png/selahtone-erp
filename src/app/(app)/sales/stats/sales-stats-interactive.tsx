"use client";

import { useMemo, useState } from "react";
import { AppIcon } from "@/components/app-icon";
import type {
  ExecutiveBranchRow,
  ExecutivePaymentMethodRow,
  ExecutiveStaffRow,
  ExecutiveTopItemRow,
} from "@/lib/sales-stats";

type SafeTopItem = Omit<ExecutiveTopItemRow, "costFormatted" | "profitFormatted" | "profitNum" | "marginPct"> &
  Partial<Pick<ExecutiveTopItemRow, "costFormatted" | "profitFormatted" | "profitNum" | "marginPct">>;

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
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="sales-stats-export-bar no-print">
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

type SortKey = "revenue" | "quantity" | "profit";
type ItemKindFilter = "all" | "stock" | "catalog";

export function SalesStatsTopItemsPanel({ items, showProfitability }: { items: SafeTopItem[]; showProfitability: boolean }) {
  const [sortBy, setSortBy] = useState<SortKey>("revenue");
  const [kindFilter, setKindFilter] = useState<ItemKindFilter>("all");
  const [query, setQuery] = useState("");

  const counts = useMemo(() => {
    let stock = 0;
    let catalog = 0;
    for (const item of items) {
      if (item.isStock) stock += 1;
      else catalog += 1;
    }
    return { all: items.length, stock, catalog };
  }, [items]);

  const filteredAndSorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter((item) => {
        if (kindFilter === "stock" && !item.isStock) return false;
        if (kindFilter === "catalog" && item.isStock) return false;
        if (!q) return true;
        return (
          item.name.toLowerCase().includes(q) ||
          item.category.toLowerCase().includes(q)
        );
      })
      .slice()
      .sort((a, b) => {
        if (sortBy === "quantity") {
          return b.quantityNum - a.quantityNum || b.revenueNum - a.revenueNum;
        }
        if (sortBy === "profit") {
          if (a.isStock !== b.isStock) return a.isStock ? -1 : 1;
          return (b.profitNum ?? 0) - (a.profitNum ?? 0) || b.revenueNum - a.revenueNum;
        }
        return b.revenueNum - a.revenueNum || b.quantityNum - a.quantityNum;
      });
  }, [items, kindFilter, query, sortBy]);

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
              <button
                type="button"
                className={`sales-stats-seg__btn${sortBy === "revenue" ? " is-active" : ""}`}
                onClick={() => setSortBy("revenue")}
              >
                الأعلى إيرادًا
              </button>
              <button
                type="button"
                className={`sales-stats-seg__btn${sortBy === "quantity" ? " is-active" : ""}`}
                onClick={() => setSortBy("quantity")}
              >
                الأكثر كميةً
              </button>
              {showProfitability ? <button
                type="button"
                className={`sales-stats-seg__btn${sortBy === "profit" ? " is-active" : ""}`}
                onClick={() => setSortBy("profit")}
              >
                الأعلى ربحًا
              </button> : null}
            </div>

            <div className="sales-stats-seg" role="group" aria-label="تصفية نوع الصنف">
              <button
                type="button"
                className={`sales-stats-seg__btn${kindFilter === "all" ? " is-active" : ""}`}
                onClick={() => setKindFilter("all")}
              >
                الكل ({counts.all})
              </button>
              <button
                type="button"
                className={`sales-stats-seg__btn${kindFilter === "stock" ? " is-active" : ""}`}
                onClick={() => setKindFilter("stock")}
              >
                مخزوني ({counts.stock})
              </button>
              <button
                type="button"
                className={`sales-stats-seg__btn${kindFilter === "catalog" ? " is-active" : ""}`}
                onClick={() => setKindFilter("catalog")}
              >
                كتالوج فني ({counts.catalog})
              </button>
            </div>

            <input
              type="search"
              className="sales-stats-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ابحث باسم الصنف أو التصنيف..."
              aria-label="بحث في جدول الأصناف المباعة"
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
        <div
          className="inv-table-wrap table-wrap"
          role="region"
          aria-label="جدول أكثر الأصناف مبيعًا"
          tabIndex={0}
        >
          <table className="inv-table sales-stats-table">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">الصنف والنوع</th>
                <th scope="col">التصنيف</th>
                <th scope="col">الكمية الصافية</th>
                <th scope="col">صافي الإيراد</th>
                <th scope="col">نسبة المساهمة</th>
                {showProfitability ? <><th scope="col">التكلفة</th>
                <th scope="col">الربح والهامش</th></> : null}
              </tr>
            </thead>
            <tbody>
              {filteredAndSorted.map((item, idx) => (
                <tr key={item.key}>
                  <td className="sales-stats-rank">{idx + 1}</td>
                  <td>
                    <div className="sales-stats-item-cell">
                      <strong>{item.name}</strong>
                      <span
                        className={`sale-chip ${
                          item.isStock ? "" : "sale-chip--neutral"
                        }`}
                      >
                        <span className="sale-chip__dot" aria-hidden="true" />
                        {item.isStock ? "صنف مخزوني" : "كتالوج فني"}
                      </span>
                    </div>
                  </td>
                  <td>{item.category}</td>
                  <td>
                    <bdi dir="ltr">{item.quantityFormatted}</bdi>
                    <small className="sales-stats-cell-sub">{item.lines} سطر</small>
                  </td>
                  <td>
                    <strong>
                      <bdi dir="ltr">{item.revenueFormatted}</bdi> ج.م
                    </strong>
                  </td>
                  <td>
                    <div className="sales-stats-share">
                      <span>
                        <bdi dir="ltr">{item.sharePct}%</bdi>
                      </span>
                      <div className="sales-stats-bar" aria-hidden="true">
                        <span style={{ width: `${Math.min(100, Math.max(3, item.sharePct))}%` }} />
                      </div>
                    </div>
                  </td>
                  {showProfitability ? <><td>
                    {item.costFormatted != null ? (
                      <span>
                        <bdi dir="ltr">{item.costFormatted}</bdi> ج.م
                      </span>
                    ) : (
                      <span className="sales-stats-muted">—</span>
                    )}
                  </td>
                  <td>
                    {item.isStock && item.profitFormatted != null ? (
                      <div className="sales-stats-profit-cell">
                        <strong>
                          <bdi dir="ltr">{item.profitFormatted}</bdi> ج.م
                        </strong>
                        <span
                          className={`sale-chip ${
                            (item.marginPct ?? 0) >= 20
                              ? ""
                              : (item.marginPct ?? 0) > 0
                                ? "sale-chip--warning"
                                : "sale-chip--neutral"
                          }`}
                        >
                          هامش <bdi dir="ltr">{item.marginPct ?? 0}%</bdi>
                        </span>
                      </div>
                    ) : (
                      <span className="sale-chip sale-chip--neutral">
                        بدون تكلفة مسجّلة
                      </span>
                    )}
                  </td></> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showProfitability ? <div className="inv-page__foot sales-stats-foot">
        الربح يُحتسب حصريًا للأصناف المخزونية المسعّرة بمتوسط التكلفة (صافي الإيراد المخزوني − تكلفة الكمية المباعة بعد خصم المرتجعات). أما أصناف الكتالوج الفني فتُعرض مستقلةً دون افتراض تكلفتها صفرًا.
      </div> : null}
    </div>
  );
}
