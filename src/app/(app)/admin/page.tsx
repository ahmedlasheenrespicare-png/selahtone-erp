import { redirect } from "next/navigation";

import { AppIcon } from "@/components/app-icon";
import { ROLE_LABELS, type AdminRole } from "@/lib/admin-directory";
import { MENU_SCOPE_LABELS, isMenuScope, type MenuScope } from "@/lib/menu-scope";
import { canSeeAllBranches, getSession } from "@/lib/auth";
import { requireMenuScopeAccess } from "@/lib/menu-scope-guard";
import { prisma } from "@/lib/prisma";
import { BranchActiveForm, BranchCreateForm, BranchRenameForm, PasswordResetForm, UserCreateForm, UserEditForm } from "./admin-forms";

export const dynamic = "force-dynamic";

/**
 * Branch and user directory for managers and accountants. It is deliberately
 * plain: every write is a server action that re-checks the actor, and the
 * screen never shows a password hash or a session token.
 */
export default async function AdminPage() {
  const session = await getSession();
  await requireMenuScopeAccess("/admin");
  if (!session) redirect("/login");
  if (session.mustChangePassword) redirect("/change-password");
  if (!canSeeAllBranches(session)) {
    return (
      <div className="dashboard">
        <div className="alert alert-err" role="alert">إدارة الفروع والمستخدمين متاحة للمدير والمحاسب فقط.</div>
      </div>
    );
  }

  const [branches, users] = await Promise.all([
    prisma.branch.findMany({
      orderBy: { code: "asc" },
      include: { _count: { select: { users: true, warehouses: true } } },
    }),
    prisma.user.findMany({
      orderBy: [{ roleCode: "asc" }, { fullName: "asc" }],
      include: { branch: { select: { nameAr: true } } },
    }),
  ]);

  const activeBranches = branches.filter((branch) => branch.isActive);

  return (
    <div className="dashboard">
      <section className="dashboard-overview" aria-labelledby="admin-title">
        <div className="dashboard-section-heading">
          <div>
            <h2 id="admin-title">الفروع والمستخدمون</h2>
            <p>إضافة فرع أو مستخدم، وإعادة تسمية الفروع، وإيقافها أو تفعيلها.</p>
          </div>
          <span className="dashboard-scope"><span /> كل الفروع</span>
        </div>
      </section>

      <div className="dashboard-grid">
        <section className="dashboard-panel" aria-labelledby="branches-title">
          <div className="dashboard-panel__heading">
            <div>
              <p className="dashboard-panel__eyebrow">الفروع</p>
              <h2 id="branches-title">قائمة الفروع ({branches.length})</h2>
              <p>خزنة واحدة لكل فرع نشط، وموظف واحد أو أكثر لكل فرع.</p>
            </div>
            <span className="dashboard-panel__heading-icon"><AppIcon name="branch" /></span>
          </div>
          <div className="dashboard-table-wrap" role="region" aria-label="جدول الفروع" tabIndex={0}>
            <table className="dashboard-table">
              <thead>
                <tr>
                  <th scope="col">الفرع</th>
                  <th scope="col">المدينة</th>
                  <th scope="col">البادئة</th>
                  <th scope="col">المستودعات</th>
                  <th scope="col">المستخدمون</th>
                  <th scope="col">الحالة</th>
                  <th scope="col">نطاق القائمة</th>
                  <th scope="col">إجراء</th>
                </tr>
              </thead>
              <tbody>
                {branches.map((branch) => (
                  <tr key={branch.id.toString()}>
                    <td>
                      <div className="dashboard-branch-name">
                        <span className="dashboard-branch-name__icon"><AppIcon name="branch" /></span>
                        <span><strong>{branch.nameAr}</strong><small dir="ltr">{branch.code}</small></span>
                      </div>
                    </td>
                    <td>{branch.city ?? "—"}</td>
                    <td dir="ltr">{branch.invoicePrefix}</td>
                    <td>{branch._count.warehouses}</td>
                    <td>{branch._count.users}</td>
                    <td>{branch.isActive ? "نشط" : "موقوف"}</td>
                    <td>
                      <details>
                        <summary className="dashboard-text-link">تعديل</summary>
                        <div className="dashboard-setup__items">
                          <BranchRenameForm
                            branch={{
                              id: branch.id.toString(),
                              code: branch.code,
                              nameAr: branch.nameAr,
                              city: branch.city,
                              invoicePrefix: branch.invoicePrefix,
                              isActive: branch.isActive,
                              userCount: branch._count.users,
                              warehouseCount: branch._count.warehouses,
                            }}
                          />
                          <BranchActiveForm
                            branch={{
                              id: branch.id.toString(),
                              code: branch.code,
                              nameAr: branch.nameAr,
                              city: branch.city,
                              invoicePrefix: branch.invoicePrefix,
                              isActive: branch.isActive,
                              userCount: branch._count.users,
                              warehouseCount: branch._count.warehouses,
                            }}
                          />
                        </div>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="dashboard-panel__footer"><span>إيقاف فرع يوقف مستودعاته ويمنع المبيعات الجديدة فيه.</span></div>
        </section>

        <section className="dashboard-panel" aria-labelledby="new-branch-title">
          <div className="dashboard-panel__heading">
            <div>
              <p className="dashboard-panel__eyebrow">إضافة</p>
              <h2 id="new-branch-title">فرع جديد</h2>
              <p>يُنشأ معه مستودع افتراضي واحد باسم الفرع.</p>
            </div>
            <span className="dashboard-panel__heading-icon"><AppIcon name="warehouse" /></span>
          </div>
          <BranchCreateForm />
        </section>

        <section className="dashboard-panel" aria-labelledby="users-title">
          <div className="dashboard-panel__heading">
            <div>
              <p className="dashboard-panel__eyebrow">المستخدمون</p>
              <h2 id="users-title">قائمة المستخدمين ({users.length})</h2>
              <p>موظف الفرع يسجّل المبيعات والمصروفات ويرى عهدته؛ والمدير والمحاسب يديران كل الفروع.</p>
            </div>
            <span className="dashboard-panel__heading-icon"><AppIcon name="settings" /></span>
          </div>
          <div className="dashboard-table-wrap" role="region" aria-label="جدول المستخدمين" tabIndex={0}>
            <table className="dashboard-table">
              <thead>
                <tr>
                  <th scope="col">الاسم</th>
                  <th scope="col">البريد</th>
                  <th scope="col">الدور</th>
                  <th scope="col">الفرع</th>
                  <th scope="col">الحالة</th>
                  <th scope="col">إجراء</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id.toString()}>
                    <td><strong>{user.fullName}</strong></td>
                    <td dir="ltr">{user.email}</td>
                    <td>{ROLE_LABELS[user.roleCode as AdminRole] ?? user.roleCode}</td>
                    <td>{user.branch?.nameAr ?? "بدون فرع"}</td>
                    <td>{user.status === "ACTIVE" ? "نشط" : "موقوف"}{user.mustChangePassword ? " • بانتظار تغيير كلمة المرور" : ""}</td>
                    <td>{user.roleCode === "CS_AGENT" ? "—" : MENU_SCOPE_LABELS[(isMenuScope(user.menuScope) ? user.menuScope : "FULL") as MenuScope]}</td>
                    <td>
                      <details>
                        <summary className="dashboard-text-link">تعديل</summary>
                        <div className="dashboard-setup__items">
                          <UserEditForm
                            user={{
                              id: user.id.toString(),
                              fullName: user.fullName,
                              email: user.email,
                              role: user.roleCode as AdminRole,
                              branchId: user.branchId === null ? null : user.branchId.toString(),
                              branchName: user.branch?.nameAr ?? null,
                              isActive: user.status === "ACTIVE",
                              mustChangePassword: user.mustChangePassword,
                              isSelf: user.id.toString() === session.id,
                              menuScope: isMenuScope(user.menuScope) ? user.menuScope : "FULL",
                            }}
                            branches={activeBranches.map((branch) => ({ id: branch.id.toString(), nameAr: branch.nameAr, code: branch.code }))}
                          />
                          <PasswordResetForm
                            user={{
                              id: user.id.toString(),
                              fullName: user.fullName,
                              email: user.email,
                              role: user.roleCode as AdminRole,
                              branchId: user.branchId === null ? null : user.branchId.toString(),
                              branchName: user.branch?.nameAr ?? null,
                              isActive: user.status === "ACTIVE",
                              mustChangePassword: user.mustChangePassword,
                              isSelf: user.id.toString() === session.id,
                              menuScope: isMenuScope(user.menuScope) ? user.menuScope : "FULL",
                            }}
                          />
                        </div>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="dashboard-panel__footer"><span>لا تُعرض كلمات المرور أو تجزئاتها في أي شاشة.</span></div>
        </section>

        <section className="dashboard-panel" aria-labelledby="new-user-title">
          <div className="dashboard-panel__heading">
            <div>
              <p className="dashboard-panel__eyebrow">إضافة</p>
              <h2 id="new-user-title">مستخدم جديد</h2>
              <p>كلمة المرور تُجزَّأ بـbcrypt ولا تُسجَّل في أي سجل.</p>
            </div>
            <span className="dashboard-panel__heading-icon"><AppIcon name="lock" /></span>
          </div>
          <UserCreateForm branches={activeBranches.map((branch) => ({ id: branch.id.toString(), nameAr: branch.nameAr, code: branch.code }))} />
        </section>
      </div>
    </div>
  );
}
