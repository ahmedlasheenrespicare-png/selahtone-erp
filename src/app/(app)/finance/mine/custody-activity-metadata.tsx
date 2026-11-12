import type { DataColumn } from "@/components/data-driven/data-table";
import type { DataFilterTab } from "@/lib/data-driven-ui";

export type CustodyMovementItem = {
  id: string;
  recordedAt: string;
  kindLabel: string;
  direction: "IN" | "OUT";
  formattedAmount: string;
};

export type CustodyDirectionFilter = "ALL" | "IN" | "OUT";

export const custodyMovementFilters: Array<DataFilterTab<CustodyMovementItem, CustodyDirectionFilter>> = [
  { id: "ALL", label: "الكل", matches: () => true },
  { id: "IN", label: "داخل (مقبوض)", matches: (item) => item.direction === "IN" },
  { id: "OUT", label: "خارج (منصرف/مسلَّم)", matches: (item) => item.direction === "OUT" },
];

export const custodyMovementSearch = {
  placeholder: "بحث بنوع الحركة أو التاريخ…",
  text: (item: CustodyMovementItem): readonly string[] => [[
    item.recordedAt, item.kindLabel, item.formattedAmount,
  ].join(" ")],
};

export const custodyMovementColumns: DataColumn<CustodyMovementItem>[] = [
  { id: "recorded-at", header: "التاريخ والوقت", renderCell: (item) => <bdi dir="ltr">{item.recordedAt}</bdi> },
  { id: "kind", header: "النوع", renderCell: (item) => item.kindLabel },
  {
    id: "direction",
    header: "الاتجاه",
    renderCell: (item) => (
      <span className={`fin-badge ${item.direction === "OUT" ? "fin-badge--out" : "fin-badge--in"}`}>
        {item.direction === "OUT" ? "خارج" : "داخل"}
      </span>
    ),
  },
  {
    id: "amount",
    header: "المبلغ",
    renderCell: (item) => (
      <span className={`fin-money${item.direction === "OUT" ? " fin-money--negative" : ""}`}>
        <bdi dir="ltr">{item.direction === "OUT" ? `-${item.formattedAmount}` : item.formattedAmount}</bdi>
      </span>
    ),
  },
];
