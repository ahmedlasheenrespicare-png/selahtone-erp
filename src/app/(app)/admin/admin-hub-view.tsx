"use client";

import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { AppIcon } from "@/components/app-icon";
import {
  canManageBranchStructure,
  canManageTargetUser,
  ROLE_LABELS,
  type AdminRole,
} from "@/lib/admin-directory";
import { downloadCsvFile } from "@/lib/csv-export";
import { MENU_SCOPE_LABELS } from "@/lib/menu-scope";
import {
  BranchCreateForm,
  BranchManageDrawer,
  PurgeSessionsButton,
  UserCreateForm,
  UserManageDrawer,
  type BranchOption,
  type BranchRow,
  type UserRow,
} from "./admin-forms";

export type SecurityAttemptRow = {
  id: string;
  userFullName: string | null;
  userRoleLabel: string | null;
  branchName: string | null;
  shortIdentifierHash: string;
  resultCode:
    | "SUCCESS"
    | "FAILED"
    | "THROTTLED"
    | "PASSWORD_CHANGE_SUCCESS"
    | "PASSWORD_CHANGE_FAILED"
    | "PASSWORD_RESET";
  resultLabel: string;
  tone: "ok" | "err" | "warn" | "info";
  timestampFormatted: string;
};

type HubTab = "users" | "branches" | "security";
type UserStatusFilter =
  | "ALL"
  | "ACTIVE"
  | "SUSPENDED"
  | "ONLINE"
  | "MUST_CHANGE_PW";
type BranchStatusFilter = "ALL" | "ACTIVE" | "INACTIVE" | "NO_VAULT";
type SecurityFilter = "ALL" | "SUCCESS" | "FAILED" | "THROTTLED" | "PASSWORD";

type Props = {
  actorRole: AdminRole;
  financeOn: boolean;
  users: UserRow[];
  branches: BranchRow[];
  activeBranches: BranchOption[];
  securityRows: SecurityAttemptRow[];
  activeThrottlesCount: number;
};

export default function AdminHubView({
  actorRole,
  financeOn,
  users,
  branches,
  activeBranches,
  securityRows,
  activeThrottlesCount,
}: Props) {
  const canManageBranches = canManageBranchStructure(actorRole);

  const [tab, setTab] = useState<HubTab>("users");

  // حالة تبويب المستخدمين
  const [userQuery, setUserQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"ALL" | AdminRole>("ALL");
  const [branchFilter, setBranchFilter] = useState<string>("ALL");
  const [userStatusFilter, setUserStatusFilter] =
    useState<UserStatusFilter>("ALL");
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);

  // حالة تبويب الفروع
  const [branchQuery, setBranchQuery] = useState("");
  const [branchStatusFilter, setBranchStatusFilter] =
    useState<BranchStatusFilter>("ALL");
  const [showCreateBranch, setShowCreateBranch] = useState(false);
  const [editingBranchId, setEditingBranchId] = useState<string | null>(null);

  // حالة تبويب الأمان
  const [secQuery, setSecQuery] = useState("");
  const [secFilter, setSecFilter] = useState<SecurityFilter>("ALL");

  const existingEmails = useMemo(() => users.map((u) => u.email), [users]);
  const existingCodes = useMemo(() => branches.map((b) => b.code), [branches]);
  const existingPrefixes = useMemo(
    () => branches.map((b) => b.invoicePrefix),
    [branches],
  );

  const userCounts = useMemo(() => {
    let active = 0;
    let suspended = 0;
    let online = 0;
    let mustChange = 0;
    for (const u of users) {
      if (u.isActive) active += 1;
      else suspended += 1;
      if (u.activeSessionCount > 0) online += 1;
      if (u.mustChangePassword) mustChange += 1;
    }
    return { all: users.length, active, suspended, online, mustChange };
  }, [users]);

  const filteredUsers = useMemo(() => {
    const q = userQuery.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter !== "ALL" && u.role !== roleFilter) return false;
      if (userStatusFilter === "ACTIVE" && !u.isActive) return false;
      if (userStatusFilter === "SUSPENDED" && u.isActive) return false;
      if (userStatusFilter === "ONLINE" && u.activeSessionCount === 0) {
        return false;
      }
      if (userStatusFilter === "MUST_CHANGE_PW" && !u.mustChangePassword) {
        return false;
      }
      if (branchFilter === "NONE" && u.branchName !== null) return false;
      if (
        branchFilter !== "ALL" &&
        branchFilter !== "NONE" &&
        u.branchName !== branchFilter
      ) {
        return false;
      }
      if (q) {
        const hay = `${u.fullName} ${u.email} ${u.phone ?? ""} ${
          ROLE_LABELS[u.role] ?? u.role
        } ${u.branchName ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [users, userQuery, roleFilter, branchFilter, userStatusFilter]);

  const branchCounts = useMemo(() => {
    let active = 0;
    let inactive = 0;
    let noVault = 0;
    for (const b of branches) {
      if (b.isActive) {
        active += 1;
        if (financeOn && !b.hasOpenVault) noVault += 1;
      } else {
        inactive += 1;
      }
    }
    return { all: branches.length, active, inactive, noVault };
  }, [branches, financeOn]);

  const filteredBranches = useMemo(() => {
    const q = branchQuery.trim().toLowerCase();
    return branches.filter((b) => {
      if (branchStatusFilter === "ACTIVE" && !b.isActive) return false;
      if (branchStatusFilter === "INACTIVE" && b.isActive) return false;
      if (branchStatusFilter === "NO_VAULT" && (!b.isActive || b.hasOpenVault)) {
        return false;
      }
      if (q) {
        const hay = `${b.nameAr} ${b.code} ${b.city ?? ""} ${b.phone ?? ""} ${b.invoicePrefix}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [branches, branchQuery, branchStatusFilter]);

  const secCounts = useMemo(() => {
    let success = 0;
    let failed = 0;
    let throttled = 0;
    let password = 0;
    for (const r of securityRows) {
      if (r.resultCode === "SUCCESS") success += 1;
      else if (r.resultCode === "FAILED") failed += 1;
      else if (r.resultCode === "THROTTLED") throttled += 1;
      else password += 1;
    }
    return { all: securityRows.length, success, failed, throttled, password };
  }, [securityRows]);

  const filteredSecurity = useMemo(() => {
    const q = secQuery.trim().toLowerCase();
    return securityRows.filter((r) => {
      if (secFilter === "SUCCESS" && r.resultCode !== "SUCCESS") return false;
      if (secFilter === "FAILED" && r.resultCode !== "FAILED") return false;
      if (secFilter === "THROTTLED" && r.resultCode !== "THROTTLED") {
        return false;
      }
      if (
        secFilter === "PASSWORD" &&
        r.resultCode !== "PASSWORD_CHANGE_SUCCESS" &&
        r.resultCode !== "PASSWORD_CHANGE_FAILED" &&
        r.resultCode !== "PASSWORD_RESET"
      ) {
        return false;
      }
      if (q) {
        const hay = `${r.id} ${r.userFullName ?? ""} ${r.branchName ?? ""} ${r.resultLabel} ${r.shortIdentifierHash}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [securityRows, secQuery, secFilter]);

  function jumpToBranchStaff(branchName: string) {
    setTab("users");
    setBranchFilter(branchName);
    setRoleFilter("ALL");
    setUserStatusFilter("ALL");
  }

  function exportUsersCsv() {
    downloadCsvFile(
      `selahtone-users-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        "الاسم الكامل",
        "البريد الإلكتروني",
        "الهاتف",
        "الدور الوظيفي",
        "الفرع",
        "الحالة",
        "نطاق القائمة",
        "الجلسات النشطة",
        "آخر دخول",
        "العهدة المفتوحة",
      ],
      filteredUsers.map((u) => [
        u.fullName,
        u.email,
        u.phone ?? "—",
        ROLE_LABELS[u.role],
        u.branchName ?? "إدارة مركزية",
        u.isActive ? "نشط" : "موقوف",
        u.role === "CS_AGENT" ? "فرع تشغيلي" : MENU_SCOPE_LABELS[u.menuScope],
        String(u.activeSessionCount),
        u.lastLoginLabel ?? "لم يسجّل دخولًا",
        u.openCustodyId ? `#${u.openCustodyId}` : "لا توجد",
      ]),
    );
  }

  function exportBranchesCsv() {
    downloadCsvFile(
      `selahtone-branches-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        "اسم الفرع",
        "الكود",
        "المدينة",
        "الهاتف",
        "بادئة الفواتير",
        "المستودعات",
        "الموظفون النشطون",
        "إجمالي الموظفين",
        "خزنة الفرع",
        "العُهَد المفتوحة",
        "الحالة",
      ],
      filteredBranches.map((b) => [
        b.nameAr,
        b.code,
        b.city ?? "—",
        b.phone ?? "—",
        b.invoicePrefix,
        String(b.warehouseCount),
        String(b.activeUserCount),
        String(b.userCount),
        financeOn ? (b.hasOpenVault ? "مفتوحة" : "غير مفتوحة") : "—",
        financeOn ? String(b.openCustodyCount) : "—",
        b.isActive ? "نشط" : "موقوف",
      ]),
    );
  }

  function exportSecurityCsv() {
    downloadCsvFile(
      `selahtone-auth-audit-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        "رقم السجل",
        "المستخدم",
        "الدور",
        "الفرع",
        "بصمة المعرّف",
        "نتيجة المحاولة",
        "التوقيت",
      ],
      filteredSecurity.map((r) => [
        `#${r.id}`,
        r.userFullName ?? "معرّف غير مسجّل",
        r.userRoleLabel ?? "—",
        r.branchName ?? "—",
        r.shortIdentifierHash,
        r.resultLabel,
        r.timestampFormatted,
      ]),
    );
  }

  function roleBadgeClass(role: AdminRole): string {
    if (role === "MANAGER") return "admin-pill admin-pill--manager";
    if (role === "ACCOUNTANT") return "admin-pill admin-pill--accountant";
    return "admin-pill admin-pill--staff";
  }

  function secBadgeClass(tone: SecurityAttemptRow["tone"]): string {
    if (tone === "ok") return "admin-pill admin-pill--ok";
    if (tone === "err") return "admin-pill admin-pill--err";
    if (tone === "warn") return "admin-pill admin-pill--warn";
    return "admin-pill admin-pill--accountant";
  }

  return (
    <section id="admin-directory" className="admin-hub">
      <div className="admin-main-tabs no-print" role="tablist" aria-label="أقسام الفروع والمستخدمين والأمان">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "users"}
          className={`admin-main-tab${tab === "users" ? " is-active" : ""}`}
          onClick={() => setTab("users")}
        >
          <AppIcon name="shield" />
          <span>المستخدمون والصلاحيات</span>
          <span className="admin-main-tab__count">{users.length}</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={tab === "branches"}
          className={`admin-main-tab${tab === "branches" ? " is-active" : ""}`}
          onClick={() => setTab("branches")}
        >
          <AppIcon name="branch" />
          <span>الفروع والمستودعات</span>
          <span className="admin-main-tab__count">{branches.length}</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={tab === "security"}
          className={`admin-main-tab${tab === "security" ? " is-active" : ""}`}
          onClick={() => setTab("security")}
        >
          <AppIcon name="lock" />
          <span>الأمان وسجل الدخول</span>
          <span className="admin-main-tab__count">{securityRows.length}</span>
        </button>
      </div>

      {/* ========================= التبويب ١: المستخدمون والصلاحيات ========================= */}
      {tab === "users" ? (
        <div className="dashboard-panel">
          <div className="dashboard-panel__heading admin-panel-head-split">
            <div>
              <p className="dashboard-panel__eyebrow">دليل الفريق والحوكمة</p>
              <h2>قائمة المستخدمين والصلاحيات ({filteredUsers.length})</h2>
              <p>
                {actorRole === "MANAGER"
                  ? "صلاحية كاملة لإدارة المديرين والمحاسبين وموظفي الفروع وفحص العُهَد قبل النقل أو الإيقاف."
                  : "عرض كامل لدليل الفريق، مع صلاحية إضافة وتعديل حسابات موظفي الفروع (CS_AGENT)."}
              </p>
            </div>
            <div className="admin-head-actions no-print">
              <button
                type="button"
                className="admin-ghost-btn"
                onClick={exportUsersCsv}
                disabled={filteredUsers.length === 0}
              >
                <AppIcon name="download" />
                <span>تصدير CSV ({filteredUsers.length})</span>
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setShowCreateUser((v) => !v)}
              >
                <AppIcon name={showCreateUser ? "close" : "plusCircle"} />
                <span>{showCreateUser ? "إغلاق النموذج" : "مستخدم جديد"}</span>
              </button>
            </div>
          </div>

          {showCreateUser ? (
            <div className="admin-collapsible-wrap no-print">
              <UserCreateForm
                branches={activeBranches}
                actorRole={actorRole}
                existingEmails={existingEmails}
                onClose={() => setShowCreateUser(false)}
              />
            </div>
          ) : null}

          <div className="admin-toolbar no-print" role="region" aria-label="تصفية المستخدمين">
            <div className="admin-filter-bar">
              <input
                type="search"
                className="admin-filter-bar__search"
                value={userQuery}
                onChange={(e) => setUserQuery(e.target.value)}
                placeholder="ابحث بالاسم أو البريد أو الهاتف أو الفرع…"
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
                {branches.map((b) => (
                  <option key={b.id} value={b.nameAr}>
                    {b.nameAr}
                  </option>
                ))}
              </select>
            </div>

            <div className="admin-chip-bar" role="tablist" aria-label="حالة الحساب">
              <button
                type="button"
                className={`admin-chip${userStatusFilter === "ALL" ? " is-active" : ""}`}
                onClick={() => setUserStatusFilter("ALL")}
              >
                الكل ({userCounts.all})
              </button>
              <button
                type="button"
                className={`admin-chip${userStatusFilter === "ACTIVE" ? " is-active" : ""}`}
                onClick={() => setUserStatusFilter("ACTIVE")}
              >
                نشط ({userCounts.active})
              </button>
              <button
                type="button"
                className={`admin-chip${userStatusFilter === "SUSPENDED" ? " is-active" : ""}`}
                onClick={() => setUserStatusFilter("SUSPENDED")}
              >
                موقوف ({userCounts.suspended})
              </button>
              <button
                type="button"
                className={`admin-chip${userStatusFilter === "ONLINE" ? " is-active" : ""}`}
                onClick={() => setUserStatusFilter("ONLINE")}
              >
                جلسة نشطة ({userCounts.online})
              </button>
              <button
                type="button"
                className={`admin-chip${
                  userStatusFilter === "MUST_CHANGE_PW" ? " is-active" : ""
                }`}
                onClick={() => setUserStatusFilter("MUST_CHANGE_PW")}
              >
                كلمة مرور مؤقتة ({userCounts.mustChange})
              </button>
            </div>
          </div>

          <div className="dashboard-table-wrap" role="region" aria-label="جدول المستخدمين" tabIndex={0}>
            <table className="dashboard-table">
              <thead>
                <tr>
                  <th scope="col">المستخدم والتواصل</th>
                  <th scope="col">الدور والصلاحيات</th>
                  <th scope="col">الفرع والذمّة المالية</th>
                  <th scope="col">الحالة والجلسات</th>
                  <th scope="col" className="no-print">إجراء</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center", padding: "24px 12px" }}>
                      لا يوجد مستخدمون يطابقون معايير البحث أو التصفية المحددة.
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((user) => {
                    const editable = canManageTargetUser(actorRole, user.role);
                    const isEditing = editingUserId === user.id;
                    return (
                      <Fragment key={user.id}>
                        <tr className={isEditing ? "admin-row--editing" : undefined}>
                          <td>
                            <div className="admin-cell-stack">
                              <div className="admin-inline-line">
                                <strong>{user.fullName}</strong>
                                {user.isSelf ? (
                                  <span className="admin-pill admin-pill--self">أنت</span>
                                ) : null}
                              </div>
                              <small dir="ltr" className="admin-subtext">
                                {user.email}
                                {user.phone ? ` · ${user.phone}` : ""}
                              </small>
                              <small className="admin-subtext">
                                {user.lastLoginLabel ? (
                                  <>
                                    آخر دخول: <bdi dir="ltr">{user.lastLoginLabel}</bdi>
                                  </>
                                ) : (
                                  "لم يسجّل دخولًا بعد"
                                )}
                              </small>
                            </div>
                          </td>

                          <td>
                            <div className="admin-cell-stack">
                              <span className={roleBadgeClass(user.role)}>
                                {ROLE_LABELS[user.role]}
                              </span>
                              <small className="admin-subtext">
                                {user.role === "CS_AGENT"
                                  ? "شاشات عمليات الفرع"
                                  : MENU_SCOPE_LABELS[user.menuScope]}
                                {user.role === "ACCOUNTANT"
                                  ? user.canCancelSales
                                    ? " · إلغاء البيع مفعّل"
                                    : " · بدون إلغاء بيع"
                                  : ""}
                              </small>
                            </div>
                          </td>

                          <td>
                            <div className="admin-cell-stack">
                              <strong>{user.branchName ?? "إدارة مركزية (كل الفروع)"}</strong>
                              {financeOn && user.openCustodyId ? (
                                <Link
                                  href="/finance/accounts"
                                  className="admin-pill admin-pill--warn"
                                  title="استعراض العهدة المفتوحة في الحسابات النقدية"
                                >
                                  عهدة نقدية مفتوحة #{user.openCustodyId}
                                </Link>
                              ) : null}
                            </div>
                          </td>

                          <td>
                            <div className="admin-cell-stack">
                              <div className="admin-inline-line">
                                <span
                                  className={
                                    user.isActive
                                      ? "admin-pill admin-pill--ok"
                                      : "admin-pill admin-pill--err"
                                  }
                                >
                                  {user.isActive ? "نشط" : "موقوف"}
                                </span>
                                {user.activeSessionCount > 0 ? (
                                  <span className="admin-pill admin-pill--accountant">
                                    {user.activeSessionCount} جلسة
                                  </span>
                                ) : null}
                              </div>
                              {user.mustChangePassword ? (
                                <small className="admin-warn-note">
                                  بانتظار تغيير كلمة المرور المؤقتة
                                </small>
                              ) : null}
                            </div>
                          </td>

                          <td className="no-print">
                            {editable ? (
                              <button
                                type="button"
                                className={`admin-ghost-btn${isEditing ? " is-active" : ""}`}
                                onClick={() =>
                                  setEditingUserId((prev) =>
                                    prev === user.id ? null : user.id,
                                  )
                                }
                              >
                                <span>{isEditing ? "إغلاق" : "إدارة"}</span>
                              </button>
                            ) : (
                              <span className="admin-subtext" title="تعديل حسابات الإدارة متاح للمدير العام فقط">
                                صلاحية المدير
                              </span>
                            )}
                          </td>
                        </tr>

                        {isEditing && editable ? (
                          <tr className="admin-drawer-row no-print">
                            <td colSpan={5}>
                              <UserManageDrawer
                                user={user}
                                branches={activeBranches}
                                actorRole={actorRole}
                                existingEmails={existingEmails}
                                onClose={() => setEditingUserId(null)}
                              />
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="dashboard-panel__footer">
            <span>
              تُشفَّر كلمات المرور بـ bcrypt، ويمنع النظام نقل موظف أو إيقافه قبل تصفية عهدته النقدية المفتوحة.
            </span>
          </div>
        </div>
      ) : null}

      {/* ========================= التبويب ٢: الفروع والمستودعات ========================= */}
      {tab === "branches" ? (
        <div className="dashboard-panel">
          <div className="dashboard-panel__heading admin-panel-head-split">
            <div>
              <p className="dashboard-panel__eyebrow">الهيكل التشغيلي</p>
              <h2>قائمة الفروع والمستودعات ({filteredBranches.length})</h2>
              <p>
                كل فرع يملك مستودعًا افتراضيًا وبادئة فواتير مستقلة وخزنة نقدية مخصّصة.
              </p>
            </div>
            <div className="admin-head-actions no-print">
              <button
                type="button"
                className="admin-ghost-btn"
                onClick={exportBranchesCsv}
                disabled={filteredBranches.length === 0}
              >
                <AppIcon name="download" />
                <span>تصدير CSV ({filteredBranches.length})</span>
              </button>
              {canManageBranches ? (
                <button
                  type="button"
                  className="btn"
                  onClick={() => setShowCreateBranch((v) => !v)}
                >
                  <AppIcon name={showCreateBranch ? "close" : "plusCircle"} />
                  <span>{showCreateBranch ? "إغلاق النموذج" : "فرع جديد"}</span>
                </button>
              ) : null}
            </div>
          </div>

          {showCreateBranch && canManageBranches ? (
            <div className="admin-collapsible-wrap no-print">
              <BranchCreateForm
                existingCodes={existingCodes}
                existingPrefixes={existingPrefixes}
                onClose={() => setShowCreateBranch(false)}
              />
            </div>
          ) : null}

          <div className="admin-toolbar no-print" role="region" aria-label="تصفية الفروع">
            <div className="admin-filter-bar">
              <input
                type="search"
                className="admin-filter-bar__search"
                value={branchQuery}
                onChange={(e) => setBranchQuery(e.target.value)}
                placeholder="ابحث باسم الفرع أو الكود أو المدينة أو الهاتف أو بادئة الفواتير…"
                aria-label="بحث في قائمة الفروع"
              />
            </div>

            <div className="admin-chip-bar" role="tablist" aria-label="حالة الفرع">
              <button
                type="button"
                className={`admin-chip${branchStatusFilter === "ALL" ? " is-active" : ""}`}
                onClick={() => setBranchStatusFilter("ALL")}
              >
                الكل ({branchCounts.all})
              </button>
              <button
                type="button"
                className={`admin-chip${branchStatusFilter === "ACTIVE" ? " is-active" : ""}`}
                onClick={() => setBranchStatusFilter("ACTIVE")}
              >
                نشط ({branchCounts.active})
              </button>
              <button
                type="button"
                className={`admin-chip${branchStatusFilter === "INACTIVE" ? " is-active" : ""}`}
                onClick={() => setBranchStatusFilter("INACTIVE")}
              >
                موقوف ({branchCounts.inactive})
              </button>
              {financeOn ? (
                <button
                  type="button"
                  className={`admin-chip${
                    branchStatusFilter === "NO_VAULT" ? " is-active" : ""
                  }`}
                  onClick={() => setBranchStatusFilter("NO_VAULT")}
                >
                  بانتظار فتح خزنة ({branchCounts.noVault})
                </button>
              ) : null}
            </div>
          </div>

          <div className="dashboard-table-wrap" role="region" aria-label="جدول الفروع" tabIndex={0}>
            <table className="dashboard-table">
              <thead>
                <tr>
                  <th scope="col">الفرع والكود</th>
                  <th scope="col">المدينة والهاتف</th>
                  <th scope="col">الفوترة والمستودعات</th>
                  {financeOn ? <th scope="col">الجاهزية المالية</th> : null}
                  <th scope="col">فريق الفرع</th>
                  <th scope="col">الحالة</th>
                  <th scope="col" className="no-print">إجراء</th>
                </tr>
              </thead>
              <tbody>
                {filteredBranches.length === 0 ? (
                  <tr>
                    <td
                      colSpan={financeOn ? 7 : 6}
                      style={{ textAlign: "center", padding: "24px 12px" }}
                    >
                      لا توجد فروع تطابق البحث أو التصفية الحالية.
                    </td>
                  </tr>
                ) : (
                  filteredBranches.map((branch) => {
                    const isEditing = editingBranchId === branch.id;
                    return (
                      <Fragment key={branch.id}>
                        <tr className={isEditing ? "admin-row--editing" : undefined}>
                          <td>
                            <div className="dashboard-branch-name">
                              <span className="dashboard-branch-name__icon">
                                <AppIcon name="branch" />
                              </span>
                              <span>
                                <strong>{branch.nameAr}</strong>
                                <small dir="ltr">{branch.code}</small>
                              </span>
                            </div>
                          </td>

                          <td>
                            <div className="admin-cell-stack">
                              <span>{branch.city ?? "—"}</span>
                              {branch.phone ? (
                                <small dir="ltr" className="admin-subtext">
                                  {branch.phone}
                                </small>
                              ) : null}
                            </div>
                          </td>

                          <td>
                            <div className="admin-cell-stack">
                              <span>
                                البادئة: <strong dir="ltr">{branch.invoicePrefix}</strong>
                              </span>
                              <small className="admin-subtext">
                                {branch.warehouseCount} مستودع مرتبط
                              </small>
                            </div>
                          </td>

                          {financeOn ? (
                            <td>
                              <div className="admin-cell-stack">
                                {branch.hasOpenVault ? (
                                  <span className="admin-pill admin-pill--ok">
                                    خزنة مفتوحة
                                  </span>
                                ) : (
                                  <Link
                                    href="/finance/accounts"
                                    className="admin-pill admin-pill--warn"
                                  >
                                    بلا خزنة — افتح الآن
                                  </Link>
                                )}
                                <small className="admin-subtext">
                                  {branch.openCustodyCount} عهدة موظف مفتوحة
                                </small>
                              </div>
                            </td>
                          ) : null}

                          <td>
                            <div className="admin-cell-stack">
                              <strong>
                                {branch.activeUserCount} نشط{" "}
                                <small className="admin-subtext">
                                  من {branch.userCount}
                                </small>
                              </strong>
                              {branch.userCount > 0 ? (
                                <button
                                  type="button"
                                  className="admin-link-btn no-print"
                                  onClick={() => jumpToBranchStaff(branch.nameAr)}
                                >
                                  عرض موظفي الفرع ←
                                </button>
                              ) : null}
                            </div>
                          </td>

                          <td>
                            <span
                              className={
                                branch.isActive
                                  ? "admin-pill admin-pill--ok"
                                  : "admin-pill admin-pill--err"
                              }
                            >
                              {branch.isActive ? "نشط" : "موقوف"}
                            </span>
                          </td>

                          <td className="no-print">
                            {canManageBranches ? (
                              <button
                                type="button"
                                className={`admin-ghost-btn${isEditing ? " is-active" : ""}`}
                                onClick={() =>
                                  setEditingBranchId((prev) =>
                                    prev === branch.id ? null : branch.id,
                                  )
                                }
                              >
                                <span>{isEditing ? "إغلاق" : "تعديل"}</span>
                              </button>
                            ) : (
                              <span className="admin-subtext">للمدير العام</span>
                            )}
                          </td>
                        </tr>

                        {isEditing && canManageBranches ? (
                          <tr className="admin-drawer-row no-print">
                            <td colSpan={financeOn ? 7 : 6}>
                              <BranchManageDrawer
                                branch={branch}
                                onClose={() => setEditingBranchId(null)}
                              />
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="dashboard-panel__footer">
            <span>
              إيقاف الفرع يشترط عدم وجود موظفين نشطين أو عُهَد نقدية مفتوحة فيه، ويوقف مستودعاته تلقائيًا.
            </span>
          </div>
        </div>
      ) : null}

      {/* ========================= التبويب ٣: الأمان وسجل الدخول ========================= */}
      {tab === "security" ? (
        <div className="dashboard-panel">
          <div className="dashboard-panel__heading admin-panel-head-split">
            <div>
              <p className="dashboard-panel__eyebrow">الرقابة الأمنية والجلسات</p>
              <h2>سجل الدخول والأحداث الأمنية ({filteredSecurity.length})</h2>
              <p>
                سجل رقابي لعمليات الدخول الناجحة والمحاولات المرفوضة وتقييد المعدّل وتصفير كلمات المرور دون كشف أي بيانات سرية.
              </p>
            </div>
            <div className="admin-head-actions no-print">
              {canManageBranches ? <PurgeSessionsButton /> : null}
              <button
                type="button"
                className="admin-ghost-btn"
                onClick={exportSecurityCsv}
                disabled={filteredSecurity.length === 0}
              >
                <AppIcon name="download" />
                <span>تصدير السجل CSV ({filteredSecurity.length})</span>
              </button>
            </div>
          </div>

          {activeThrottlesCount > 0 ? (
            <div className="admin-collapsible-wrap no-print">
              <div className="admin-inline-warn">
                يوجد حاليًا <strong>{activeThrottlesCount} قيد حظر مؤقت نشط (`LoginThrottle`)</strong> نتيجة محاولات دخول متكررة خاطئة؛ يُرفع الحظر تلقائيًا بانتهاء نافذة القفل الزمنية.
              </div>
            </div>
          ) : null}

          <div className="admin-toolbar no-print" role="region" aria-label="تصفية سجل الأمان">
            <div className="admin-filter-bar">
              <input
                type="search"
                className="admin-filter-bar__search"
                value={secQuery}
                onChange={(e) => setSecQuery(e.target.value)}
                placeholder="ابحث باسم المستخدم أو الفرع أو بصمة المعرّف أو نوع الحدث…"
                aria-label="بحث في سجل الأمان"
              />
            </div>

            <div className="admin-chip-bar" role="tablist" aria-label="نوع الحدث الأمني">
              <button
                type="button"
                className={`admin-chip${secFilter === "ALL" ? " is-active" : ""}`}
                onClick={() => setSecFilter("ALL")}
              >
                الكل ({secCounts.all})
              </button>
              <button
                type="button"
                className={`admin-chip${secFilter === "SUCCESS" ? " is-active" : ""}`}
                onClick={() => setSecFilter("SUCCESS")}
              >
                دخول ناجح ({secCounts.success})
              </button>
              <button
                type="button"
                className={`admin-chip${secFilter === "FAILED" ? " is-active" : ""}`}
                onClick={() => setSecFilter("FAILED")}
              >
                محاولة فاشلة ({secCounts.failed})
              </button>
              <button
                type="button"
                className={`admin-chip${secFilter === "THROTTLED" ? " is-active" : ""}`}
                onClick={() => setSecFilter("THROTTLED")}
              >
                تقييد مؤقت ({secCounts.throttled})
              </button>
              <button
                type="button"
                className={`admin-chip${secFilter === "PASSWORD" ? " is-active" : ""}`}
                onClick={() => setSecFilter("PASSWORD")}
              >
                كلمة المرور ({secCounts.password})
              </button>
            </div>
          </div>

          <div className="dashboard-table-wrap" role="region" aria-label="جدول سجل الدخول" tabIndex={0}>
            <table className="dashboard-table">
              <thead>
                <tr>
                  <th scope="col">قيد #</th>
                  <th scope="col">المستخدم / البصمة</th>
                  <th scope="col">الدور والفرع</th>
                  <th scope="col">نتيجة الحدث</th>
                  <th scope="col">التاريخ والوقت</th>
                </tr>
              </thead>
              <tbody>
                {filteredSecurity.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center", padding: "24px 12px" }}>
                      لا توجد أحداث أمنية مطابقة لمعايير البحث الحالية.
                    </td>
                  </tr>
                ) : (
                  filteredSecurity.map((row) => (
                    <tr key={row.id}>
                      <td dir="ltr">#{row.id}</td>
                      <td>
                        <div className="admin-cell-stack">
                          <strong>{row.userFullName ?? "معرّف غير مرتبط بحساب"}</strong>
                          <small dir="ltr" className="admin-subtext">
                            SHA: {row.shortIdentifierHash}
                          </small>
                        </div>
                      </td>
                      <td>
                        <div className="admin-cell-stack">
                          <span>{row.userRoleLabel ?? "—"}</span>
                          <small className="admin-subtext">
                            {row.branchName ?? "—"}
                          </small>
                        </div>
                      </td>
                      <td>
                        <span className={secBadgeClass(row.tone)}>
                          {row.resultLabel}
                        </span>
                      </td>
                      <td dir="ltr">{row.timestampFormatted}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="dashboard-panel__footer">
            <span>
              حفاظًا على الخصوصية لا يُخزَّن البريد الصريح ولا كلمة المرور في جدول المحاولات (`identifier_hash` فقط).
            </span>
          </div>
        </div>
      ) : null}
    </section>
  );
}
