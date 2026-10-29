import Link from "next/link";
import { AppIcon, type AppIconName } from "@/components/app-icon";
import { prisma } from "@/lib/prisma";
import { requireSession, branchScope, canSeeAllBranches } from "@/lib/auth";
import { formatInventoryDecimal, stockValueScaled } from "@/lib/inventory-math";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  MANAGER: "مدير الشركة",
  ACCOUNTANT: "المحاسب",
  CS_AGENT: "موظف الكاونتر",
};

const nf = new Intl.NumberFormat("ar-EG-u-nu-latn", { maximumFractionDigits: 2 });
const dateFormatter = new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Africa/Cairo",
});

type Metric = {
  label: string;
  value: string;
  unit?: string;
  detail: string;
  icon: AppIconName;
  tone: string;
};

export default async function DashboardPage() {
  const session = await requireSession();
  const scope = branchScope(session);
  const canViewAllBranches = canSeeAllBranches(session);

  const branches = await prisma.branch.findMany({
    where: { isActive: true, ...(scope.branchId ? { id: BigInt(scope.branchId) } : {}) },
    include: {
      warehouses: true,
      _count: { select: { users: true } },
    },
    orderBy: { code: "asc" },
  });

  const productCount = await prisma.product.count({ where: { isActive: true } });
  const taxCount = await prisma.taxRate.count({ where: { isActive: true } });
  const expenseCategories = await prisma.expenseCategory.count();
  const stockLevels = await prisma.stockLevel.findMany({
    where: scope.branchId ? { warehouse: { branchId: BigInt(scope.branchId) } } : {},
    select: { qtyOnHand: true, avgCost: true },
  });
  const stockValue = stockLevels.reduce(
    (sum, stock) => sum + stockValueScaled(stock.qtyOnHand.toFixed(2), stock.avgCost.toFixed(4)),
    0n,
  );
  const warehouseCount = branches.reduce((count, branch) => count + branch.warehouses.length, 0);
  const now = new Date();
  const metrics: Metric[] = [
    {
      label: "الفروع النشطة",
      value: nf.format(branches.length),
      detail: canViewAllBranches ? "في نطاق حسابك" : "فرعك الحالي",
      icon: "branch",
      tone: "blue",
    },
    {
      label: "المستودعات",
      value: nf.format(warehouseCount),
      detail: "في الفروع المتاحة لك",
      icon: "warehouse",
      tone: "cyan",
    },
    {
      label: "المنتجات النشطة",
      value: nf.format(productCount),
      detail: "في دليل المنتجات",
      icon: "products",
      tone: "violet",
    },
    {
      label: "قيمة المخزون",
      value: formatInventoryDecimal(stockValue, 6),
      unit: "ج.م",
      detail: "محسوبة بمتوسط التكلفة",
      icon: "stockValue",
      tone: "amber",
    },
  ];

  return (
    <div className="dashboard">
      <div className="dashboard-heading">
        <div>
          <p className="dashboard-eyebrow"><span /> لوحة القيادة</p>
          <h1>أهلًا بك، {session.name}</h1>
          <p className="dashboard-heading__description">نظرة واضحة على أعمالك وبيانات الفروع في مكان واحد.</p>
        </div>
        <div className="dashboard-date">
          <span><AppIcon name="calendar" /></span>
          <div><small>تاريخ اليوم</small><time dateTime={now.toISOString()}>{dateFormatter.format(now)}</time></div>
        </div>
      </div>

      <section className="dashboard-overview" aria-labelledby="overview-title">
        <div className="dashboard-section-heading">
          <div><h2 id="overview-title">نظرة عامة</h2><p>ملخص البيانات المتاحة لحسابك</p></div>
          <span className="dashboard-scope"><span /> {canViewAllBranches ? "كل الفروع" : (session.branchName ?? "فرعك")}</span>
        </div>
        <div className="dashboard-metrics">
          {metrics.map((metric) => (
            <article className="dashboard-metric" key={metric.label}>
              <div className="dashboard-metric__top">
                <span className={`dashboard-metric__icon is-${metric.tone}`}><AppIcon name={metric.icon} /></span>
              </div>
              <p className="dashboard-metric__label">{metric.label}</p>
              <div className="dashboard-metric__value"><strong>{metric.value}</strong>{metric.unit && <span>{metric.unit}</span>}</div>
              <p className="dashboard-metric__detail">{metric.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <div className="dashboard-grid">
        <section className="dashboard-panel dashboard-branches" aria-labelledby="branches-title">
          <div className="dashboard-panel__heading">
            <div>
              <p className="dashboard-panel__eyebrow">متابعة الفروع</p>
              <h2 id="branches-title">الفروع والمستودعات</h2>
              <p>تفاصيل الفروع النشطة المتاحة لحسابك</p>
            </div>
            <span className="dashboard-count">{nf.format(branches.length)} فرع</span>
          </div>
          {branches.length > 0 ? (
            <>
              <p className="dashboard-table-hint">مرّر الجدول أفقيًا لعرض باقي التفاصيل</p>
              <div className="dashboard-table-wrap" role="region" aria-label="جدول الفروع والمستودعات" tabIndex={0}>
                <table className="dashboard-table">
                  <thead>
                    <tr>
                      <th scope="col">الفرع</th>
                      <th scope="col">المدينة</th>
                      <th scope="col">المستودعات</th>
                      <th scope="col">المستخدمون</th>
                      <th scope="col">الحالة</th>
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
                        <td>
                          <div className="dashboard-warehouse-list">
                            {branch.warehouses.map((warehouse) => <span key={warehouse.id.toString()} dir="ltr">{warehouse.code}</span>)}
                            {branch.warehouses.length === 0 && <span className="dashboard-warehouse-list__empty">لا يوجد</span>}
                          </div>
                        </td>
                        <td>{nf.format(branch._count.users)}</td>
                        <td><span className={`dashboard-status${branch.isActive ? "" : " is-inactive"}`}><span />{branch.isActive ? "نشط" : "موقوف"}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="dashboard-empty"><AppIcon name="branch" /><strong>لا توجد فروع نشطة متاحة</strong><p>ستظهر هنا الفروع المتاحة لحسابك عند إضافتها.</p></div>
          )}
          <div className="dashboard-panel__footer"><span>عرض الفروع حسب نطاق صلاحية حسابك</span></div>
        </section>

        <div className="dashboard-side">
          <section className="dashboard-panel dashboard-setup" aria-labelledby="setup-title">
            <div className="dashboard-panel__heading">
              <div><p className="dashboard-panel__eyebrow">معلومات أساسية</p><h2 id="setup-title">ملخص الإعداد</h2><p>بيانات النظام المسجّلة</p></div>
              <span className="dashboard-panel__heading-icon"><AppIcon name="settings" /></span>
            </div>
            <div className="dashboard-setup__items">
              <div className="dashboard-setup__item">
                <span className="dashboard-setup__item-icon is-blue"><AppIcon name="receipt" /></span>
                <span><strong>معدلات الضريبة</strong><small>المعدلات النشطة</small></span>
                <b>{nf.format(taxCount)}</b>
              </div>
              <div className="dashboard-setup__item">
                <span className="dashboard-setup__item-icon is-violet"><AppIcon name="expenses" /></span>
                <span><strong>بنود المصروفات</strong><small>البنود المسجّلة</small></span>
                <b>{nf.format(expenseCategories)}</b>
              </div>
            </div>
            {canViewAllBranches && <Link className="dashboard-text-link" href="/setup">عرض تفاصيل الإعداد <AppIcon name="arrow" /></Link>}
          </section>

          <section className="dashboard-panel dashboard-shortcuts" aria-labelledby="shortcuts-title">
            <div className="dashboard-panel__heading">
              <div><p className="dashboard-panel__eyebrow">ابدأ من هنا</p><h2 id="shortcuts-title">وصول سريع</h2></div>
            </div>
            <Link className="dashboard-shortcut" href="/inventory">
              <span className="dashboard-shortcut__icon"><AppIcon name="inventory" /></span>
              <span><strong>المخزون والمستودعات</strong><small>عرض أرصدة المنتجات</small></span>
              <AppIcon className="dashboard-shortcut__arrow" name="arrow" />
            </Link>
            {canViewAllBranches && <Link className="dashboard-shortcut" href="/setup">
              <span className="dashboard-shortcut__icon is-cyan"><AppIcon name="settings" /></span>
              <span><strong>التحقق من الإعداد</strong><small>عرض إعدادات النظام</small></span>
              <AppIcon className="dashboard-shortcut__arrow" name="arrow" />
            </Link>}
          </section>
        </div>
      </div>

      <div className="dashboard-account-note"><span>حسابك: <strong>{ROLE_LABEL[session.role] ?? session.role}</strong></span><span aria-hidden="true">·</span><span dir="ltr">{session.email}</span></div>
    </div>
  );
}
