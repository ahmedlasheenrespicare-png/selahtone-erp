import Link from "next/link";
import type { DataColumn } from "@/components/data-driven/data-table";
import { canManageTargetUser, ROLE_LABELS, type AdminRole } from "@/lib/admin-directory";

export type AdminUserDirectoryRow = {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  role: AdminRole;
  branchId: string | null;
  branchName: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  isSelf: boolean;
  activeSessionCount: number;
  lastLoginLabel: string | null;
  openCustodyId: string | null;
};

function roleBadgeClass(role: AdminRole): string {
  if (role === "MANAGER") return "admin-pill admin-pill--manager";
  if (role === "ACCOUNTANT") return "admin-pill admin-pill--accountant";
  return "admin-pill admin-pill--staff";
}

export function createUserDirectoryColumns(options: {
  actorRole: AdminRole;
  financeOn: boolean;
  editingUserId: string | null;
  onToggleUser: (userId: string) => void;
}): DataColumn<AdminUserDirectoryRow>[] {
  return [
    {
      id: "identity", header: "المستخدم والتواصل", renderCell: (user) => (
        <div className="admin-cell-stack">
          <div className="admin-inline-line"><strong>{user.fullName}</strong>{user.isSelf ? <span className="admin-pill admin-pill--self">أنت</span> : null}</div>
          <small dir="ltr" className="admin-subtext">{user.email}{user.phone ? ` · ${user.phone}` : ""}</small>
          <small className="admin-subtext">{user.lastLoginLabel ? <>آخر دخول: <bdi dir="ltr">{user.lastLoginLabel}</bdi></> : "لم يسجّل دخولًا بعد"}</small>
        </div>
      ),
    },
    {
      id: "role", header: "الدور والصلاحيات", renderCell: (user) => (
        <div className="admin-cell-stack">
          <span className={roleBadgeClass(user.role)}>{ROLE_LABELS[user.role]}</span>
          <small className="admin-subtext">{user.role === "CS_AGENT" ? "شاشات عمليات الفرع" : "صلاحيات مخصصة لكل حساب"}</small>
        </div>
      ),
    },
    {
      id: "branch", header: "الفرع والذمّة المالية", renderCell: (user) => (
        <div className="admin-cell-stack">
          <strong>{user.branchName ?? "إدارة مركزية (كل الفروع)"}</strong>
          {user.openCustodyId ? options.financeOn ? (
            <Link href="/finance/accounts" className="admin-pill admin-pill--warn" title="استعراض العهدة المفتوحة في الحسابات النقدية">عهدة نقدية مفتوحة #{user.openCustodyId}</Link>
          ) : <span className="admin-pill admin-pill--warn">عهدة نقدية مفتوحة #{user.openCustodyId}</span> : null}
        </div>
      ),
    },
    {
      id: "status", header: "الحالة والجلسات", renderCell: (user) => (
        <div className="admin-cell-stack">
          <div className="admin-inline-line">
            <span className={user.isActive ? "admin-pill admin-pill--ok" : "admin-pill admin-pill--err"}>{user.isActive ? "نشط" : "موقوف"}</span>
            {user.activeSessionCount > 0 ? <span className="admin-pill admin-pill--accountant">{user.activeSessionCount} جلسة</span> : null}
          </div>
          {user.mustChangePassword ? <small className="admin-warn-note">بانتظار تغيير كلمة المرور المؤقتة</small> : null}
        </div>
      ),
    },
    {
      id: "action", header: "إجراء", headerClassName: "no-print", cellClassName: "no-print", renderCell: (user) => {
        const editable = canManageTargetUser(options.actorRole, user.role);
        const isEditing = options.editingUserId === user.id;
        return editable ? (
          <button type="button" className={`admin-ghost-btn${isEditing ? " is-active" : ""}`} onClick={() => options.onToggleUser(user.id)}>
            <span>{isEditing ? "إغلاق" : "إدارة"}</span>
          </button>
        ) : <span className="admin-subtext" title="تعديل حسابات الإدارة متاح للمدير العام فقط">صلاحية المدير</span>;
      },
    },
  ];
}
