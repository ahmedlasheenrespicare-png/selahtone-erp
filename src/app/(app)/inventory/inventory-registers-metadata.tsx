import type { DataColumn } from "@/components/data-driven/data-table";

export type InventoryReceiptRow = {
  id: string;
  productName: string;
  sku: string;
  branchName: string;
  warehouseName: string;
  quantityFormatted: string;
  unitCostFormatted: string | null;
  serialCount: number;
  sourceReference: string | null;
  createdByName: string;
  createdAtFormatted: string;
};

export type InventorySerialRow = {
  id: string;
  serialNumber: string;
  productName: string | null;
  sku: string | null;
  branchName: string | null;
  warehouseName: string | null;
  isSold: boolean;
  createdAtFormatted: string;
};

export function createInventoryReceiptColumns(showUnitCost: boolean): DataColumn<InventoryReceiptRow>[] {
  return [
    { id: "movement", header: "رقم الحركة", renderCell: (row) => <bdi dir="ltr">{row.id}</bdi> },
    {
      id: "product",
      header: "الصنف",
      renderCell: (row) => <>{row.productName} <span className="muted">({row.sku})</span></>,
    },
    { id: "warehouse", header: "الفرع والمستودع", renderCell: (row) => `${row.branchName} — ${row.warehouseName}` },
    { id: "quantity", header: "الكمية", renderCell: (row) => <bdi dir="ltr">{row.quantityFormatted}</bdi> },
    ...(showUnitCost ? [{
      id: "unit-cost",
      header: "تكلفة الوحدة (ج.م)",
      renderCell: (row: InventoryReceiptRow) => <bdi dir="ltr">{row.unitCostFormatted}</bdi>,
    }] : []),
    { id: "serials", header: "سيريالات", renderCell: (row) => row.serialCount },
    { id: "reference", header: "المرجع", renderCell: (row) => row.sourceReference ?? "—" },
    { id: "created-by", header: "سجّلها", renderCell: (row) => row.createdByName },
    { id: "created-at", header: "التاريخ", renderCell: (row) => row.createdAtFormatted },
  ];
}

export const inventorySerialColumns: DataColumn<InventorySerialRow>[] = [
  { id: "serial", header: "الرقم التسلسلي", renderCell: (row) => <bdi dir="ltr">{row.serialNumber}</bdi> },
  {
    id: "product",
    header: "الصنف",
    renderCell: (row) => row.productName ? (
      <>{row.productName} <span className="muted">({row.sku})</span></>
    ) : "مصدر غير معروف",
  },
  { id: "branch", header: "الفرع", renderCell: (row) => row.branchName ?? "—" },
  { id: "warehouse", header: "المستودع", renderCell: (row) => row.warehouseName ?? "—" },
  { id: "status", header: "الحالة", renderCell: (row) => row.isSold ? "مباع" : "متاح" },
  { id: "created-at", header: "تاريخ التسجيل", renderCell: (row) => row.createdAtFormatted },
];
