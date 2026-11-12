import type { DataColumn } from "@/components/data-driven/data-table";

export type SecurityAttemptRow = {
  id: string;
  userFullName: string | null;
  userRoleLabel: string | null;
  branchName: string | null;
  shortIdentifierHash: string;
  resultCode: "SUCCESS" | "FAILED" | "THROTTLED" | "PASSWORD_CHANGE_SUCCESS" | "PASSWORD_CHANGE_FAILED" | "PASSWORD_RESET";
  resultLabel: string;
  tone: "ok" | "err" | "warn" | "info";
  timestampFormatted: string;
};

function securityBadgeClass(tone: SecurityAttemptRow["tone"]): string {
  if (tone === "ok") return "admin-pill admin-pill--ok";
  if (tone === "err") return "admin-pill admin-pill--err";
  if (tone === "warn") return "admin-pill admin-pill--warn";
  return "admin-pill admin-pill--accountant";
}

export const securityAttemptColumns: DataColumn<SecurityAttemptRow>[] = [
  { id: "attempt", header: "قيد #", renderCell: (row) => <bdi dir="ltr">#{row.id}</bdi> },
  {
    id: "identity", header: "المستخدم / البصمة", renderCell: (row) => (
      <div className="admin-cell-stack">
        <strong>{row.userFullName ?? "معرّف غير مرتبط بحساب"}</strong>
        <small dir="ltr" className="admin-subtext">SHA: {row.shortIdentifierHash}</small>
      </div>
    ),
  },
  {
    id: "role-branch", header: "الدور والفرع", renderCell: (row) => (
      <div className="admin-cell-stack"><span>{row.userRoleLabel ?? "—"}</span><small className="admin-subtext">{row.branchName ?? "—"}</small></div>
    ),
  },
  { id: "result", header: "نتيجة الحدث", renderCell: (row) => <span className={securityBadgeClass(row.tone)}>{row.resultLabel}</span> },
  { id: "timestamp", header: "التاريخ والوقت", renderCell: (row) => <bdi dir="ltr">{row.timestampFormatted}</bdi> },
];
