import type { DataColumn } from "@/components/data-driven/data-table";

export type SaleDetailLineRow = {
  id: string;
  name: string;
  sku: string | null;
  taxCode: string | null;
  taxRateFormatted: string | null;
  detailNotes: string[];
  serialNotes: string[];
  quantityFormatted: string;
  unitPriceFormatted: string;
  discountFormatted: string;
  taxFormatted: string | null;
  totalFormatted: string;
};

export const saleDetailLineColumns: DataColumn<SaleDetailLineRow>[] = [
  {
    id: "product",
    header: "الصنف",
    renderCell: (line) => (
      <>
        <strong>{line.name}</strong><br />
        <span className="muted">{line.taxCode ? `${line.sku ?? "—"} · ${line.taxCode} (${line.taxRateFormatted ?? "0.000"}%)` : "الضريبة غير محددة"}</span>
        {line.detailNotes.length > 0 ? <div className="sale-note">{line.detailNotes.join(" · ")}</div> : null}
        {line.serialNotes.length > 0 ? <div className="sale-note">{line.serialNotes.join(" · ")}</div> : null}
      </>
    ),
  },
  { id: "quantity", header: "الكمية", renderCell: (line) => <bdi dir="ltr">{line.quantityFormatted}</bdi> },
  { id: "unit-price", header: "سعر الوحدة", renderCell: (line) => <bdi dir="ltr">{line.unitPriceFormatted}</bdi> },
  { id: "discount", header: "الخصم", renderCell: (line) => <bdi dir="ltr">{line.discountFormatted}</bdi> },
  { id: "tax", header: "الضريبة المضمنة", renderCell: (line) => <bdi dir="ltr">{line.taxFormatted ?? "غير محددة"}</bdi> },
  { id: "total", header: "الإجمالي", renderCell: (line) => <bdi dir="ltr">{line.totalFormatted}</bdi> },
];
