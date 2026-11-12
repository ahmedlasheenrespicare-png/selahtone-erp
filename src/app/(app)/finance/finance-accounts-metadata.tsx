import Link from "next/link";
import type { ReactNode } from "react";
import type { DataColumn } from "@/components/data-driven/data-table";
import type { DataCsvColumn, DataFilterTab, DataSelectOption } from "@/lib/data-driven-ui";

export type FinanceAccountRow = {
  id: string;
  title: string;
  subtitle: string;
  branchId: string;
  branchName: string;
  kind: "VAULT" | "CUSTODY";
  kindLabel: string;
  openingDate: string;
  recordedOpeningFormatted: string;
  balanceFormatted: string;
  isNegative: boolean;
  isClosed: boolean;
  canClose: boolean;
  closeRequestId: string;
  holderName: string;
};

export type AccountFilter = "all" | "vault" | "custody" | "over_ceiling" | "closed";

export function parseFormattedMoney(raw: string): number {
  const cleaned = raw.replace(/[^0-9.\-]/g, "");
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : 0;
}

export function findOverCeilingIds(rows: readonly FinanceAccountRow[], custodyCeiling: number): Set<string> {
  return new Set(rows.filter((row) =>
    row.kind === "CUSTODY" && !row.isClosed && parseFormattedMoney(row.balanceFormatted) >= custodyCeiling,
  ).map((row) => row.id));
}

export function createAccountFilters(overCeilingIds: ReadonlySet<string>): Array<DataFilterTab<FinanceAccountRow, AccountFilter>> {
  return [
    { id: "all", label: "كل الحسابات", matches: () => true },
    { id: "vault", label: "خزائن الفروع", matches: (row) => row.kind === "VAULT" },
    { id: "custody", label: "عُهَد الموظفين", matches: (row) => row.kind === "CUSTODY" },
    { id: "over_ceiling", label: "تجاوزت السقف", matches: (row) => overCeilingIds.has(row.id), isVisible: (rows) => overCeilingIds.size > 0 },
    { id: "closed", label: "مقفلة", matches: (row) => row.isClosed, isVisible: (rows) => rows.some((row) => row.isClosed) },
  ];
}

export const custodyCeilingOptions: Array<DataSelectOption<string>> = [
  { value: "10000", label: "سقف عهدة: 10,000 ج.م" },
  { value: "15000", label: "سقف عهدة: 15,000 ج.م" },
  { value: "25000", label: "سقف عهدة: 25,000 ج.م" },
  { value: "50000", label: "سقف عهدة: 50,000 ج.م" },
];

export const financeAccountSearch = {
  placeholder: "ابحث باسم الفرع أو الموظف أو تاريخ الجرد…",
  text: (row: FinanceAccountRow): readonly string[] => [[
    row.title, row.subtitle, row.branchName, row.kindLabel, row.openingDate,
  ].join(" ")],
};

export function createFinanceAccountCsvColumns(overCeilingIds: ReadonlySet<string>): DataCsvColumn<FinanceAccountRow>[] {
  return [
    { header: "الحساب", value: (row) => row.title },
    { header: "الفرع", value: (row) => row.branchName },
    { header: "النوع", value: (row) => row.kindLabel },
    { header: "تاريخ الجرد", value: (row) => row.openingDate },
    { header: "رصيد الجرد (ج.م)", value: (row) => row.recordedOpeningFormatted },
    { header: "الرصيد الحالي (ج.م)", value: (row) => row.balanceFormatted },
    { header: "الحالة", value: (row) => row.isClosed ? "مقفلة" : row.isNegative ? "سالب" : overCeilingIds.has(row.id) ? "تجاوز سقف العهدة" : "نشط" },
  ];
}

type FinanceAccountColumnOptions = {
  overCeilingIds: ReadonlySet<string>;
  canManage: boolean;
  canCloseCustody: boolean;
  renderCloseAction: (row: FinanceAccountRow) => ReactNode;
};

export function createFinanceAccountColumns(options: FinanceAccountColumnOptions): DataColumn<FinanceAccountRow>[] {
  return [
    {
      id: "account", header: "الحساب", renderCell: (row) => (
        <div className="fin-account-cell"><strong>{row.title}</strong><small>{row.subtitle}</small></div>
      ),
    },
    {
      id: "kind", header: "النوع", renderCell: (row) => (
        <span className={`fin-badge ${row.kind === "VAULT" ? "fin-badge--vault" : "fin-badge--custody"}`}>{row.kindLabel}</span>
      ),
    },
    { id: "opening-date", header: "تاريخ الجرد", renderCell: (row) => <bdi dir="ltr">{row.openingDate}</bdi> },
    { id: "opening-balance", header: "رصيد الجرد", renderCell: (row) => <bdi dir="ltr">{row.recordedOpeningFormatted}</bdi> },
    {
      id: "balance", header: "الرصيد الحالي", renderCell: (row) => {
        const isOverCeiling = options.overCeilingIds.has(row.id);
        return <><span className={`fin-money${row.isNegative ? " fin-money--negative" : ""}`}><bdi dir="ltr">{row.balanceFormatted}</bdi></span>
          {row.isClosed ? <> <span className="fin-badge fin-badge--closed">مقفلة</span></>
            : row.isNegative ? <> <span className="fin-badge fin-badge--negative">سالب</span></>
              : isOverCeiling ? <> <span className="fin-badge b-warn">فوق السقف</span></> : null}</>;
      },
    },
    ...(options.canManage ? [{
      id: "action",
      header: "إجراء",
      renderCell: (row: FinanceAccountRow) => {
        const isOverCeiling = options.overCeilingIds.has(row.id);
        return <div className="fin-row-actions">
          {isOverCeiling ? <Link href="/finance/transfers" className="fin-button fin-button--secondary">توريد للخزنة</Link> : null}
          {row.canClose && options.canCloseCustody ? options.renderCloseAction(row) : !isOverCeiling ? <span className="fin-field__hint">—</span> : null}
        </div>;
      },
    }] : []),
  ];
}
