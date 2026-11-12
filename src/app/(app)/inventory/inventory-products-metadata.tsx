import React from "react";
import type { DataColumn } from "@/components/data-driven/data-table";
import type { DataCsvColumn, DataSelectOption } from "@/lib/data-driven-ui";

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

export type InventoryStockFilter = "ALL" | "IN_STOCK" | "LOW" | "ZERO";

export const inventoryProductSearch = {
  ariaLabel: "بحث في الأصناف",
  placeholder: "ابحث بكود SKU أو اسم الصنف أو المستودع…",
  text: (product: InventoryProductRow): readonly string[] => [
    [product.sku, product.nameAr, product.categoryLabel, product.whereSummary].join(" "),
  ],
};

export const inventoryCategoryOptions: DataSelectOption<string>[] = [
  { value: "ALL", label: "كل التصنيفات" },
  { value: "HEARING_AID", label: "سماعة طبية" },
  { value: "ACCESSORY", label: "مستلزم" },
  { value: "SPARE_PART", label: "قطعة غيار" },
  { value: "SERVICE", label: "خدمة" },
];

export type InventoryStockOption = DataSelectOption<InventoryStockFilter> & {
  matches: (product: InventoryProductRow) => boolean;
  count?: (rows: readonly InventoryProductRow[]) => number;
};

const isLowStock = (product: InventoryProductRow) =>
  !product.isService && product.qtyUnits > 0 && product.qtyUnits <= 2;
const isZeroStock = (product: InventoryProductRow) =>
  !product.isService && product.qtyUnits <= 0;

export const inventoryStockOptions: InventoryStockOption[] = [
  { value: "ALL", label: "كل الأرصدة", matches: () => true },
  {
    value: "IN_STOCK",
    label: "متوفّر بالمخزن",
    matches: (product) => !product.isService && product.qtyUnits > 0,
  },
  {
    value: "LOW",
    label: "رصيد منخفض (≤ 2)",
    matches: isLowStock,
    count: (rows) => rows.filter(isLowStock).length,
  },
  {
    value: "ZERO",
    label: "نفد الرصيد (0)",
    matches: isZeroStock,
    count: (rows) => rows.filter(isZeroStock).length,
  },
];

export function inventoryStockCount(
  rows: readonly InventoryProductRow[],
  filter: InventoryStockFilter,
): number {
  const option = inventoryStockOptions.find((item) => item.value === filter);
  return option ? rows.filter(option.matches).length : 0;
}

export function createInventoryProductCsvColumns(
  canSeeCost: boolean,
): DataCsvColumn<InventoryProductRow>[] {
  return [
    { header: "SKU", value: (product) => product.sku },
    { header: "الصنف", value: (product) => product.nameAr },
    { header: "التصنيف", value: (product) => product.categoryLabel },
    { header: "الضريبة", value: (product) => product.taxCode },
    ...(canSeeCost ? [{
      header: "سعر الشراء",
      value: (product: InventoryProductRow) => product.purchaseCostFormatted ?? "—",
    }] : []),
    { header: "سعر البيع", value: (product) => product.salePriceFormatted },
    { header: "سيريال", value: (product) => product.requiresSerial ? "مطلوب" : "—" },
    { header: "الأرصدة", value: (product) => product.whereSummary || "0" },
  ];
}

export function createInventoryProductColumns(
  canSeeCost: boolean,
): DataColumn<InventoryProductRow>[] {
  return [
    { id: "sku", header: "SKU", renderCell: (product) => <code>{product.sku}</code> },
    { id: "name", header: "الصنف", renderCell: (product) => product.nameAr },
    {
      id: "category",
      header: "التصنيف",
      cellClassName: "muted",
      renderCell: (product) => product.categoryLabel,
    },
    {
      id: "tax",
      header: "ضريبة",
      renderCell: (product) => <span className="badge b-teal">{product.taxCode}</span>,
    },
    ...(canSeeCost ? [{
      id: "purchase-cost",
      header: "سعر الشراء",
      cellClassName: "num",
      renderCell: (product: InventoryProductRow) => product.purchaseCostFormatted,
    }] : []),
    {
      id: "sale-price",
      header: "سعر البيع",
      cellClassName: "num",
      renderCell: (product) => product.salePriceFormatted,
    },
    {
      id: "serial",
      header: "سيريال",
      renderCell: (product) => product.requiresSerial
        ? <span className="badge b-warn">مطلوب</span>
        : <span className="muted">—</span>,
    },
    {
      id: "stock",
      header: "الأرصدة (فرع: كمية)",
      cellClassName: "small",
      renderCell: (product) => product.whereSummary ? (
        <>
          <span>{product.whereSummary}</span>
          {isLowStock(product) ? (
            <span className="badge b-warn" style={{ marginInlineStart: 6 }}>منخفض</span>
          ) : null}
        </>
      ) : product.isService ? (
        <span className="muted">خدمة غير مخزنية</span>
      ) : (
        <span className="badge b-err">نفد الرصيد (0)</span>
      ),
    },
  ];
}
