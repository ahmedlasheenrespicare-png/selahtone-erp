import Link from "next/link";
import type { DataColumn } from "@/components/data-driven/data-table";

export type CheckAxis = "INFRA" | "SECURITY" | "COMMERCE" | "FINANCE";
export type CheckSeverity = "ok" | "warn" | "fail";
export type ReadinessCheckItem = {
  id: string;
  axis: CheckAxis;
  axisLabel: string;
  label: string;
  severity: CheckSeverity;
  statusLabel: string;
  detail: string;
  actionHref?: string;
  actionLabel?: string;
};
export type BranchReadinessRow = {
  id: string;
  nameAr: string;
  code: string;
  city: string | null;
  invoicePrefix: string;
  isActive: boolean;
  warehouseCodes: string;
  hasDefaultWarehouse: boolean;
  activeStaffCount: number;
  totalStaffCount: number;
  hasOpenVault: boolean;
  openCustodyCount: number;
  ready: boolean;
  verdictLabel: string;
  remediationHref: string | null;
  remediationLabel: string | null;
};

function pillClass(severity: CheckSeverity): string {
  if (severity === "ok") return "setup-pill setup-pill--ok";
  if (severity === "warn") return "setup-pill setup-pill--warn";
  return "setup-pill setup-pill--err";
}

export const readinessCheckColumns: DataColumn<ReadinessCheckItem>[] = [
  { id: "number", header: "#", headerAriaLabel: "رقم الفحص", renderCell: (_row, index) => <bdi dir="ltr">{index + 1}</bdi> },
  { id: "axis", header: "المحور", renderCell: (row) => <span className="setup-pill setup-pill--axis">{row.axisLabel}</span> },
  { id: "check", header: "بند الفحص", renderCell: (row) => <strong>{row.label}</strong> },
  { id: "status", header: "الحالة", renderCell: (row) => <span className={pillClass(row.severity)}>{row.statusLabel}</span> },
  { id: "detail", header: "التفصيل والتشخيص الفعلي", renderCell: (row) => <span className="setup-subtext">{row.detail}</span> },
  {
    id: "action", header: "الإجراء السريع", headerClassName: "no-print", cellClassName: "no-print", renderCell: (row) => (
      row.actionHref && row.actionLabel
        ? <Link className="setup-btn" href={row.actionHref}><span>{row.actionLabel}</span></Link>
        : <span className="setup-subtext">—</span>
    ),
  },
];

export function createBranchReadinessColumns(financeOn: boolean): DataColumn<BranchReadinessRow>[] {
  return [
    {
      id: "branch", header: "الفرع والكود", renderCell: (row) => (
        <div className="setup-cell-stack"><strong>{row.nameAr}</strong><small dir="ltr" className="setup-subtext">{row.code} · {row.isActive ? "نشط" : "موقوف"}</small></div>
      ),
    },
    {
      id: "city", header: "المدينة والبادئة", renderCell: (row) => (
        <div className="setup-cell-stack"><span>{row.city ?? "—"}</span><small dir="ltr" className="setup-subtext">بادئة: {row.invoicePrefix}</small></div>
      ),
    },
    {
      id: "warehouses", header: "المستودعات", renderCell: (row) => (
        <div className="setup-cell-stack"><span dir="ltr">{row.warehouseCodes || "لا يوجد"}</span><small className="setup-subtext">{row.hasDefaultWarehouse ? "مستودع افتراضي مربوط" : "ينقصه مستودع افتراضي"}</small></div>
      ),
    },
    ...(financeOn ? [{
      id: "finance", header: "الخزنة والعُهَد", renderCell: (row: BranchReadinessRow) => (
        <div className="setup-cell-stack">
          <span className={row.hasOpenVault ? "setup-pill setup-pill--ok" : "setup-pill setup-pill--warn"}>{row.hasOpenVault ? "خزنة مفتوحة ✓" : "بلا خزنة مفتوحة"}</span>
          <small className="setup-subtext">{row.openCustodyCount} عهدة موظف مفتوحة</small>
        </div>
      ),
    }] : []),
    {
      id: "staff", header: "الموظفون النشطون", renderCell: (row) => (
        <strong>{row.activeStaffCount} <small className="setup-subtext">من {row.totalStaffCount}</small></strong>
      ),
    },
    {
      id: "verdict", header: "حكم الجاهزية", renderCell: (row) => (
        <span className={!row.isActive ? "setup-pill setup-pill--axis" : row.ready ? "setup-pill setup-pill--ok" : "setup-pill setup-pill--warn"}>{row.verdictLabel}</span>
      ),
    },
    {
      id: "remediation", header: "معالجة", headerClassName: "no-print", cellClassName: "no-print", renderCell: (row) => (
        row.remediationHref && row.remediationLabel
          ? <Link className="setup-btn" href={row.remediationHref}><span>{row.remediationLabel}</span></Link>
          : <span className="setup-subtext">مكتمل ✓</span>
      ),
    },
  ];
}
