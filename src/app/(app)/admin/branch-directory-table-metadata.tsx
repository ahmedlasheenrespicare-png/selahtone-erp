import Link from "next/link";
import { AppIcon } from "@/components/app-icon";
import type { DataColumn } from "@/components/data-driven/data-table";

export type AdminBranchDirectoryRow = {
  id: string;
  code: string;
  nameAr: string;
  city: string | null;
  phone: string | null;
  invoicePrefix: string;
  isActive: boolean;
  userCount: number;
  activeUserCount: number;
  warehouseCount: number;
  hasOpenVault: boolean;
  openCustodyCount: number;
};

export function createBranchDirectoryColumns(options: {
  canManageBranches: boolean;
  showFinanceSummary: boolean;
  editingBranchId: string | null;
  onToggleBranch: (branchId: string) => void;
  onShowBranchStaff: (branchName: string) => void;
}): DataColumn<AdminBranchDirectoryRow>[] {
  return [
    {
      id: "branch", header: "الفرع والكود", renderCell: (branch) => (
        <div className="dashboard-branch-name">
          <span className="dashboard-branch-name__icon"><AppIcon name="branch" /></span>
          <span><strong>{branch.nameAr}</strong><small dir="ltr">{branch.code}</small></span>
        </div>
      ),
    },
    {
      id: "contact", header: "المدينة والهاتف", renderCell: (branch) => (
        <div className="admin-cell-stack"><span>{branch.city ?? "—"}</span>{branch.phone ? <small dir="ltr" className="admin-subtext">{branch.phone}</small> : null}</div>
      ),
    },
    {
      id: "billing", header: "الفوترة والمستودعات", renderCell: (branch) => (
        <div className="admin-cell-stack"><span>البادئة: <strong dir="ltr">{branch.invoicePrefix}</strong></span><small className="admin-subtext">{branch.warehouseCount} مستودع مرتبط</small></div>
      ),
    },
    ...(options.showFinanceSummary ? [{
      id: "finance", header: "الجاهزية المالية", renderCell: (branch: AdminBranchDirectoryRow) => (
        <div className="admin-cell-stack">
          {branch.hasOpenVault ? <span className="admin-pill admin-pill--ok">خزنة مفتوحة</span> : <Link href="/finance/accounts" className="admin-pill admin-pill--warn">بلا خزنة — افتح الآن</Link>}
          <small className="admin-subtext">{branch.openCustodyCount} عهدة موظف مفتوحة</small>
        </div>
      ),
    }] : []),
    {
      id: "staff", header: "فريق الفرع", renderCell: (branch) => (
        <div className="admin-cell-stack">
          <strong>{branch.activeUserCount} نشط <small className="admin-subtext">من {branch.userCount}</small></strong>
          {branch.userCount > 0 ? <button type="button" className="admin-link-btn no-print" onClick={() => options.onShowBranchStaff(branch.nameAr)}>عرض موظفي الفرع ←</button> : null}
        </div>
      ),
    },
    {
      id: "status", header: "الحالة", renderCell: (branch) => (
        <span className={branch.isActive ? "admin-pill admin-pill--ok" : "admin-pill admin-pill--err"}>{branch.isActive ? "نشط" : "موقوف"}</span>
      ),
    },
    {
      id: "action", header: "إجراء", headerClassName: "no-print", cellClassName: "no-print", renderCell: (branch) => {
        const isEditing = options.editingBranchId === branch.id;
        return options.canManageBranches ? (
          <button type="button" className={`admin-ghost-btn${isEditing ? " is-active" : ""}`} onClick={() => options.onToggleBranch(branch.id)}>
            <span>{isEditing ? "إغلاق" : "تعديل"}</span>
          </button>
        ) : <span className="admin-subtext">للمدير العام</span>;
      },
    },
  ];
}
