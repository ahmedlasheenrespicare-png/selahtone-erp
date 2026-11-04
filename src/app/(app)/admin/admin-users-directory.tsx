"use client";

import { useMemo, useState } from "react";
import { ROLE_LABELS, type AdminRole } from "@/lib/admin-directory";
import { MENU_SCOPE_LABELS } from "@/lib/menu-scope";
import {
  PasswordResetForm,
  RevokeSessionsForm,
  UserEditForm,
  type BranchOption,
  type UserRow,
} from "./admin-forms";

export type AdminDirectoryUserRow = UserRow & {
  activeSessionCount: number;
  lastLoginLabel: string | null;
};

export default function AdminUsersDirectory({
  users,
  activeBranches,
}: {
  users: AdminDirectoryUserRow[];
  activeBranches: BranchOption[];
}) {
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"ALL" | AdminRole>("ALL");
  const [branchFilter, setBranchFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "SUSPENDED">("ALL");

  const branchNames = useMemo(() => {
    const set = new Set<string>();
    for (const u of users) {
      if (u.branchName) set.add(u.branchName);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ar"));
  }, [users]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter !== "ALL" && u.role !== roleFilter) return false;
      if (statusFilter === "ACTIVE" && !u.isActive) return false;
      if (statusFilter === "SUSPENDED" && u.isActive) return false;
      if (branchFilter === "NONE" && u.branchName !== null) return false;
      if (branchFilter !== "ALL" && branchFilter !== "NONE" && u.branchName !== branchFilter) return false;
      if (q) {
        const hay = `${u.fullName} ${u.email} ${ROLE_LABELS[u.role] ?? u.role} ${u.branchName ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [users, query, roleFilter, branchFilter, statusFilter]);

  return (
    <>
      <div className="admin-filter-bar" role="region" aria-label="تصفية المستخدمين">
        <input
          type="search"
          className="admin-filter-bar__search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ابحث بالاسم أو البريد الإلكتروني…"
          aria-label="بحث في قائمة المستخدمين"
        />
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as "ALL" | AdminRole)}
          aria-label="تصفية حسب الدور"
        >
          <option value="ALL">كل الأدوار ({users.length})</option>
          <option value="MANAGER">{ROLE_LABELS.MANAGER}</option>
          <option value="ACCOUNTANT">{ROLE_LABELS.ACCOUNTANT}</option>
          <option value="CS_AGENT">{ROLE_LABELS.CS_AGENT}</option>
        </select>
        <select
          value={branchFilter}
          onChange={(e) => setBranchFilter(e.target.value)}
          aria-label="تصفية حسب الفرع"
        >
          <option value="ALL">كل الفروع</option>
          <option value="NONE">بدون فرع (إدارة مركزية)</option>
          {branchNames.map((bn) => (
            <option key={bn} value={bn}>
              {bn}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "ALL" | "ACTIVE" | "SUSPENDED")}
          aria-label="تصفية حسب الحالة"
        >
          <option value="ALL">كل الحالات</option>
          <option value="ACTIVE">نشط فقط</option>
          <option value="SUSPENDED">موقوف فقط</option>
        </select>
      </div>

      <div className="dashboard-table-wrap" role="region" aria-label="جدول المستخدمين" tabIndex={0}>
        <table className="dashboard-table">
          <thead>
            <tr>
              <th scope="col">الاسم</th>
              <th scope="col">البريد</th>
              <th scope="col">الدور</th>
              <th scope="col">الفرع</th>
              <th scope="col">الحالة والجلسات</th>
              <th scope="col">نطاق القائمة</th>
              <th scope="col">إجراء</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7}>لا يوجد مستخدمون يطابقون البحث أو عوامل التصفية الحالية.</td>
              </tr>
            ) : (
              filtered.map((user) => (
                <tr key={user.id}>
                  <td>
                    <div>
                      <strong>{user.fullName}</strong>
                      {user.lastLoginLabel ? (
                        <small style={{ display: "block", opacity: 0.78 }}>
                          آخر دخول: <bdi dir="ltr">{user.lastLoginLabel}</bdi>
                        </small>
                      ) : (
                        <small style={{ display: "block", opacity: 0.65 }}>لم يسجّل دخولًا بعد</small>
                      )}
                    </div>
                  </td>
                  <td dir="ltr">{user.email}</td>
                  <td>{ROLE_LABELS[user.role] ?? user.role}</td>
                  <td>{user.branchName ?? "بدون فرع"}</td>
                  <td>
                    <span>
                      {user.isActive ? "نشط" : "موقوف"}
                      {user.mustChangePassword ? " • بانتظار تغيير كلمة المرور" : ""}
                    </span>
                    {user.activeSessionCount > 0 ? (
                      <span className="badge b-ok" style={{ marginInlineStart: 6 }}>
                        {user.activeSessionCount} جلسة نشطة
                      </span>
                    ) : null}
                  </td>
                  <td>{user.role === "CS_AGENT" ? "—" : MENU_SCOPE_LABELS[user.menuScope]}</td>
                  <td>
                    <details>
                      <summary className="dashboard-text-link">تعديل</summary>
                      <div className="dashboard-setup__items">
                        <UserEditForm user={user} branches={activeBranches} />
                        <PasswordResetForm user={user} />
                        <RevokeSessionsForm user={user} activeSessionCount={user.activeSessionCount} />
                      </div>
                    </details>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
