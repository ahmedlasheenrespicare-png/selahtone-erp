import type { DataColumn } from "@/components/data-driven/data-table";

export type CatalogCartTableRow = {
  key: string;
  categoryName: string;
  typeName: string;
  quantity: string;
  unitPrice: string;
  totalFormatted: string;
  details: Array<{ key: string; label: string; value: string }>;
};

export function createCatalogCartColumns(options: {
  pending: boolean;
  onUpdateLine: (key: string, patch: { quantity?: string; unitPrice?: string }) => void;
  onEditLine: (key: string) => void;
  onRemoveLine: (key: string) => void;
}): DataColumn<CatalogCartTableRow>[] {
  return [
    { id: "category", header: "التصنيف", renderCell: (row) => row.categoryName },
    {
      id: "details", header: "النوع والتفاصيل", renderCell: (row) => (
        <>
          <strong>{row.typeName}</strong>
          {row.details.length > 0 ? (
            <div className="sale-cart-tags">
              {row.details.map((entry) => <span key={entry.key} className="sale-cart-tag"><strong>{entry.label}:</strong> {entry.value}</span>)}
            </div>
          ) : null}
        </>
      ),
    },
    {
      id: "quantity", header: "الكمية", renderCell: (row) => (
        <input className="sale-line-input" disabled={options.pending} inputMode="decimal" dir="ltr" value={row.quantity}
          onChange={(event) => options.onUpdateLine(row.key, { quantity: event.target.value })} aria-label={`كمية ${row.typeName}`} />
      ),
    },
    {
      id: "unit-price", header: "سعر الوحدة", renderCell: (row) => (
        <input className="sale-line-input" disabled={options.pending} inputMode="decimal" dir="ltr" value={row.unitPrice}
          onChange={(event) => options.onUpdateLine(row.key, { unitPrice: event.target.value })} aria-label={`سعر ${row.typeName}`} />
      ),
    },
    { id: "total", header: "الإجمالي", renderCell: (row) => <strong><bdi dir="ltr">{row.totalFormatted}</bdi></strong> },
    {
      id: "actions", header: "", headerAriaLabel: "إجراءات البند", renderCell: (row) => (
        <div className="sale-cart-actions">
          <button type="button" className="sale-line-edit" disabled={options.pending} onClick={() => options.onEditLine(row.key)}>تعديل</button>
          <button type="button" className="sale-product__remove" disabled={options.pending} onClick={() => options.onRemoveLine(row.key)}>إزالة</button>
        </div>
      ),
    },
  ];
}
