"use client";

import { useMemo, useState } from "react";
import { AppIcon } from "@/components/app-icon";
import { downloadCsvFile } from "@/lib/csv-export";

export type InventoryProductRow = {
  id: string;
  sku: string;
  nameAr: string;
  category: string;
  categoryLabel: string;
  taxCode: string;
  purchaseCostFormatted: string | null;
  salePriceFormatted: string;
  requiresSerial: boolean;
  isService: boolean;
  qtyUnits: number;
  whereSummary: string;
};

type StockFilter = "ALL" | "IN_STOCK" | "LOW" | "ZERO";

export default function InventoryProductsView({
  rows,
  canSeeCost,
}: {
  rows: InventoryProductRow[];
  canSeeCost: boolean;
}) {
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [stockFilter, setStockFilter] = useState<StockFilter>("ALL");

  const lowCount = useMemo(
    () => rows.filter((r) => !r.isService && r.qtyUnits > 0 && r.qtyUnits <= 2).length,
    [rows],
  );
  const zeroCount = useMemo(
    () => rows.filter((r) => !r.isService && r.qtyUnits <= 0).length,
    [rows],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (categoryFilter !== "ALL" && r.category !== categoryFilter) return false;
      if (stockFilter === "IN_STOCK" && (r.isService || r.qtyUnits <= 0)) return false;
      if (stockFilter === "LOW" && (r.isService || r.qtyUnits <= 0 || r.qtyUnits > 2)) return false;
      if (stockFilter === "ZERO" && (r.isService || r.qtyUnits > 0)) return false;
      if (q) {
        const hay = `${r.sku} ${r.nameAr} ${r.categoryLabel} ${r.whereSummary}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, query, categoryFilter, stockFilter]);

  function handleExportCsv(): void {
    const headers = canSeeCost
      ? ["SKU", "الصنف", "التصنيف", "الضريبة", "سعر الشراء", "سعر البيع", "سيريال", "الأرصدة"]
      : ["SKU", "الصنف", "التصنيف", "الضريبة", "سعر البيع", "سيريال", "الأرصدة"];
    downloadCsvFile(
      `selahtone-inventory-${new Date().toISOString().slice(0, 10)}.csv`,
      headers,
      filtered.map((r) =>
        canSeeCost
          ? [
              r.sku,
              r.nameAr,
              r.categoryLabel,
              r.taxCode,
              r.purchaseCostFormatted ?? "—",
              r.salePriceFormatted,
              r.requiresSerial ? "مطلوب" : "—",
              r.whereSummary || "0",
            ]
          : [
              r.sku,
              r.nameAr,
              r.categoryLabel,
              r.taxCode,
              r.salePriceFormatted,
              r.requiresSerial ? "مطلوب" : "—",
              r.whereSummary || "0",
            ],
      ),
    );
  }

  return (
    <div className="card">
      <div className="inv-card-head">
        <h2>
          الأصناف ومعدل الضريبة <span className="pill">{filtered.length} / {rows.length} صنف</span>
        </h2>
        <button
          type="button"
          className="inv-button inv-button--secondary"
          onClick={handleExportCsv}
          disabled={filtered.length === 0}
        >
          <AppIcon name="download" />
          <span>تصدير CSV</span>
        </button>
      </div>

      {(zeroCount > 0 || lowCount > 0) ? (
        <div className="alert alert-warn" role="status">
          <strong>مؤشر نواقص المخزون:</strong>{" "}
          {zeroCount > 0 ? `${zeroCount} صنف مخزني نفد رصيده (0)` : ""}
          {zeroCount > 0 && lowCount > 0 ? " · " : ""}
          {lowCount > 0 ? `${lowCount} صنف برصيد منخفض (٢ أو أقل)` : ""}.
        </div>
      ) : null}

      <div className="admin-filter-bar" role="region" aria-label="تصفية الأصناف">
        <input
          type="search"
          className="admin-filter-bar__search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ابحث بكود SKU أو اسم الصنف أو المستودع…"
          aria-label="بحث في الأصناف"
        />
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          aria-label="تصفية حسب التصنيف"
        >
          <option value="ALL">كل التصنيفات</option>
          <option value="HEARING_AID">سماعة طبية</option>
          <option value="ACCESSORY">مستلزم</option>
          <option value="SPARE_PART">قطعة غيار</option>
          <option value="SERVICE">خدمة</option>
        </select>
        <select
          value={stockFilter}
          onChange={(e) => setStockFilter(e.target.value as StockFilter)}
          aria-label="حالة الرصيد"
        >
          <option value="ALL">كل الأرصدة</option>
          <option value="IN_STOCK">متوفّر بالمخزن</option>
          <option value="LOW">رصيد منخفض (≤ 2) ({lowCount})</option>
          <option value="ZERO">نفد الرصيد (0) ({zeroCount})</option>
        </select>
      </div>

      <div className="table-wrap" role="region" aria-label="جدول الأصناف وأرصدة المستودعات" tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th>SKU</th>
              <th>الصنف</th>
              <th>التصنيف</th>
              <th>ضريبة</th>
              {canSeeCost ? <th>سعر الشراء</th> : null}
              <th>سعر البيع</th>
              <th>سيريال</th>
              <th>الأرصدة (فرع: كمية)</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={canSeeCost ? 8 : 7} className="muted">
                  لا توجد أصناف تطابق البحث أو التصفية المختارة.
                </td>
              </tr>
            ) : (
              filtered.map((p) => (
                <tr key={p.id}>
                  <td><code>{p.sku}</code></td>
                  <td>{p.nameAr}</td>
                  <td className="muted">{p.categoryLabel}</td>
                  <td>
                    <span className="badge b-teal">{p.taxCode}</span>
                  </td>
                  {canSeeCost ? <td className="num">{p.purchaseCostFormatted}</td> : null}
                  <td className="num">{p.salePriceFormatted}</td>
                  <td>
                    {p.requiresSerial ? (
                      <span className="badge b-warn">مطلوب</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="small">
                    {p.whereSummary ? (
                      <>
                        <span>{p.whereSummary}</span>
                        {!p.isService && p.qtyUnits > 0 && p.qtyUnits <= 2 ? (
                          <span className="badge b-warn" style={{ marginInlineStart: 6 }}>
                            منخفض
                          </span>
                        ) : null}
                      </>
                    ) : p.isService ? (
                      <span className="muted">خدمة غير مخزنية</span>
                    ) : (
                      <span className="badge b-err">نفد الرصيد (0)</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
