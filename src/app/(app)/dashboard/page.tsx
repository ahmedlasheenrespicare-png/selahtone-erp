import Link from "next/link";
import { AppIcon, type AppIconName } from "@/components/app-icon";
import { prisma } from "@/lib/prisma";
import { requireSession, branchScope, canSeeAllBranches } from "@/lib/auth";
import { formatInventoryDecimal, stockValueScaled } from "@/lib/inventory-math";
import { loadCashSummary, loadEmployeeCash } from "@/lib/finance/dashboard";

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

  // الأدوار لا تتحدد بوجود العهدة: فموظفٌ بلا عهدة مسجلة كان يرى ملخّص الشركة
  // كله — أرقام الفروع ومجموع العهد — لأن الملخّص كان يُعرض لكل من لا عهدة له.
  // فصار التفريق بالدور، وهو الثابت، لا بالعهدة، وهي حالة طارئة.
  const isEmployee = session.role === "CS_AGENT";
  const isAccountant = session.role === "ACCOUNTANT";
  const cash = isEmployee ? await loadEmployeeCash(session) : null;
  const summary = isEmployee ? null : await loadCashSummary(session);
  const cashActions = cash
    ? [
        cash.settlementStale
          ? { key: "stale", tone: "warning", text: "طلب تسوية معلق وقد بطل بحركة نقدية بعده — ألغِه بسبب وأعد الجرد بطلب جديد.", href: "/finance/mine" }
          : null,
        cash.openSettlementId
          ? { key: "open", tone: "info", text: "لديك طلب تسوية معلق بانتظار اعتماد المدير. أي حركة نقدية جديدة تُبطل المعدود.", href: "/finance/mine" }
          : null,
        cash.pendingExpenses > 0
          ? { key: "pending", tone: "info", text: `${cash.pendingExpenses} مصروفًا بانتظار اعتماد المدير.`, href: "/finance/expenses" }
          : null,
        cash.approvedUnpaid > 0
          ? { key: "approved", tone: "warning", text: `${cash.approvedUnpaid} مصروفًا معتمدًا بانتظار تسجيل الصرف.`, href: "/finance/expenses" }
          : null,
        cash.outstandingCount > 0
          ? { key: "outstanding", tone: "info", text: `${cash.outstandingCount} فاتورة عليها باقٍ لدى العملاء.`, href: "/sales" }
          : null,
      ].filter((item): item is { key: string; tone: string; text: string; href: string } => item !== null)
    : [];
  // كل دور يُسأل عن غير ما يُسأل عنه الآخر: الموظف عن نقده ومبيعاته، والمحاسب
  // عما يتحرّك تحت يده، والمدير عن الصورة العامة. فالأرقام نفسها للثلاثة تعني
  // أن اثنين منهم يقرآن ما لا يعنيهما — و«قيمة المخزون» على مستوى الشركة كانت
  // تُعرض لموظف الكاونتر، وهو ما لا يحتاجه لعمله.
  const metrics: Metric[] = isEmployee
    ? [
        { label: "مبيعات اليوم", value: nf.format(cash?.todaySalesCount ?? 0), detail: "فاتورة أتممتها اليوم", icon: "receipt", tone: "blue" },
        { label: "باقٍ على العملاء", value: nf.format(cash?.outstandingCount ?? 0), detail: "فاتورة لم تُسدَّد بالكامل", icon: "cash", tone: "amber" },
        { label: "الأصناف المتاحة", value: nf.format(productCount), detail: "في نطاق فرعك", icon: "products", tone: "violet" },
        { label: "مستودعات فرعك", value: nf.format(warehouseCount), detail: "تخدم مبيعاتك", icon: "warehouse", tone: "cyan" },
      ]
    : isAccountant
    ? [
        { label: "تسويات بانتظار التأكيد", value: nf.format(summary?.pendingSettlements ?? 0), detail: "طلبات سلّمها الموظفون", icon: "cash", tone: "amber" },
        { label: "بانتظار الصرف", value: nf.format(summary?.approvedUnpaid ?? 0), detail: "مصروفات اعتمدت ولم تُصرف", icon: "expenses", tone: "violet" },
        { label: "المتوقَّع في العهد", value: summary ? nf.format(Number(summary.totalExpected)) : "0", unit: "ج.م", detail: "ما سيُسلَّم للخزنة", icon: "stockValue", tone: "cyan" },
        { label: "العهد القائمة", value: nf.format(summary?.custodyCount ?? 0), detail: "عهدة نشطة", icon: "branch", tone: "blue" },
      ]
    : [
        { label: "الفروع النشطة", value: nf.format(branches.length), detail: canViewAllBranches ? "في نطاق حسابك" : "فرعك الحالي", icon: "branch", tone: "blue" },
        { label: "المستودعات", value: nf.format(warehouseCount), detail: "في الفروع المتاحة لك", icon: "warehouse", tone: "cyan" },
        { label: "المنتجات النشطة", value: nf.format(productCount), detail: "في دليل المنتجات", icon: "products", tone: "violet" },
        { label: "قيمة المخزون", value: formatInventoryDecimal(stockValue, 6), unit: "ج.م", detail: "محسوبة بمتوسط التكلفة", icon: "stockValue", tone: "amber" },
      ];

  // ما ينتظر المدير غير ما ينتظر المحاسب، وإن كانا يقرآن الملخّص نفسه:
  // المدير يعتمد، والمحاسب يصرف ويؤكد. فبطاقة واحدة لهما تُخفي على كلٍّ منهما
  // ما يخصه في زحام ما يخص الآخر.
  const roleActions = isEmployee || !summary ? [] : (isAccountant
    ? [
        summary.pendingSettlements > 0 && { key: "settle", tone: "warning", text: `${summary.pendingSettlements} طلب تسوية بانتظار تأكيدك.`, href: "/finance/settlements" },
        summary.approvedUnpaid > 0 && { key: "pay", tone: "warning", text: `${summary.approvedUnpaid} مصروفًا معتمدًا بانتظار تسجيل صرفه.`, href: "/finance/expenses" },
        summary.pendingExpenses > 0 && { key: "pending", tone: "info", text: `${summary.pendingExpenses} مصروفًا لم يعتمده المدير بعد.`, href: "/finance/expenses" },
      ]
    : [
        summary.pendingExpenses > 0 && { key: "approve", tone: "warning", text: `${summary.pendingExpenses} مصروفًا بانتظار اعتمادك.`, href: "/finance/expenses" },
        summary.pendingSettlements > 0 && { key: "settle", tone: "info", text: `${summary.pendingSettlements} طلب تسوية بانتظار اعتمادك.`, href: "/finance/settlements" },
        summary.approvedUnpaid > 0 && { key: "pay", tone: "info", text: `${summary.approvedUnpaid} مصروفًا معتمدًا بانتظار أن يصرفه المحاسب.`, href: "/finance/expenses" },
      ]).filter((item): item is { key: string; tone: string; text: string; href: string } => typeof item !== "boolean");

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

      {cash ? (
        <section className="dashboard-panel" aria-labelledby="cash-title" style={{ marginBottom: 18 }}>
          <div className="dashboard-panel__heading">
            <div>
              <p className="dashboard-panel__eyebrow">عهدة الموظف</p>
              <h2 id="cash-title">المتوقَّع بيدك الآن</h2>
              <p>هذا ما يجب أن يكون في يدك فعلًا وبه تُسأل عند التسليم — لا الرصيد الدفتري وحده.</p>
            </div>
            <span className="dashboard-panel__heading-icon"><AppIcon name="receipt" /></span>
          </div>
          <div className="dashboard-metrics">
            <article className="dashboard-metric">
              <p className="dashboard-metric__label">المتوقَّع بيدك</p>
              <div className="dashboard-metric__value"><strong>{nf.format(Number(cash.expected))}</strong><span>ج.م</span></div>
              <p className="dashboard-metric__detail">
                رصيد العهدة {nf.format(Number(cash.balance))} + مبيعات الفترة {nf.format(Number(cash.sales))} − مصروفاتها من نقدك {nf.format(Number(cash.expenses))}
              </p>
            </article>
            <article className="dashboard-metric">
              <p className="dashboard-metric__label">مبيعات اليوم نقدًا</p>
              <div className="dashboard-metric__value"><strong>{nf.format(Number(cash.todaySales))}</strong><span>ج.م</span></div>
              <p className="dashboard-metric__detail">{nf.format(cash.todaySalesCount)} فاتورة</p>
            </article>
            <article className="dashboard-metric">
              <p className="dashboard-metric__label">مصروفات اليوم من نقدك</p>
              <div className="dashboard-metric__value"><strong>{nf.format(Number(cash.todayExpenses))}</strong><span>ج.م</span></div>
              <p className="dashboard-metric__detail">مما صرفته من العهدة اليوم</p>
            </article>
            <article className="dashboard-metric">
              <p className="dashboard-metric__label">باقٍ على العملاء</p>
              <div className="dashboard-metric__value"><strong>{nf.format(Number(cash.outstanding))}</strong><span>ج.م</span></div>
              <p className="dashboard-metric__detail">{nf.format(cash.outstandingCount)} فاتورة آجلة</p>
            </article>
          </div>
          <div className="dashboard-panel__footer">
            <span>المتوقَّع بيدك يتغيّر مع كل بيع نقدي ومع كل مصروف تصرفه من نقدك</span>
          </div>
        </section>
      ) : null}

      {cash ? (
        <section className="dashboard-panel" aria-labelledby="todo-title" style={{ marginBottom: 18 }}>
          <div className="dashboard-panel__heading">
            <div>
              <p className="dashboard-panel__eyebrow">يحتاج إجراءك</p>
              <h2 id="todo-title">ما ينتظرك اليوم</h2>
            </div>
            <span className="dashboard-count">{nf.format(cashActions.length)} عنصر</span>
          </div>
          {cashActions.length > 0 ? (
            <div className="dashboard-setup__items">
              {cashActions.map((item) => (
                <Link className="dashboard-shortcut" key={item.key} href={item.href}>
                  <span className={`dashboard-shortcut__icon ${item.tone === "warning" ? "is-cyan" : "is-blue"}`}><AppIcon name="receipt" /></span>
                  <span><strong>{item.text}</strong></span>
                  <AppIcon className="dashboard-shortcut__arrow" name="arrow" />
                </Link>
              ))}
            </div>
          ) : (
            <div className="dashboard-empty">
              <strong>لا شيء يطلب منك الآن</strong>
              <p>لا طلب تسوية معلق ولا مصروفات بانتظار الاعتماد.</p>
            </div>
          )}
        </section>
      ) : null}

      {summary && summary.custodyCount > 0 ? (
        <section className="dashboard-panel" aria-labelledby="summary-title" style={{ marginBottom: 18 }}>
          <div className="dashboard-panel__heading">
            <div>
              <p className="dashboard-panel__eyebrow">ملخّص النقد</p>
              <h2 id="summary-title">العهدة والمستحق للخزنة</h2>
              <p>مجمَّع «المتوقَّع بيده» لكل عهدة، لا أرصدتها الدفترية.</p>
            </div>
            <span className="dashboard-count">{nf.format(summary.custodyCount)} عهدة</span>
          </div>
          <div className="dashboard-metrics">
            <article className="dashboard-metric">
              <p className="dashboard-metric__label">المتوقَّع في كل العهد</p>
              <div className="dashboard-metric__value"><strong>{nf.format(Number(summary.totalExpected))}</strong><span>ج.م</span></div>
              <p className="dashboard-metric__detail">ما سيُسلَّم للخزنة عند التسويات</p>
            </article>
            <article className="dashboard-metric">
              <p className="dashboard-metric__label">طلبات تسوية معلقة</p>
              <div className="dashboard-metric__value"><strong>{nf.format(summary.pendingSettlements)}</strong></div>
              <p className="dashboard-metric__detail">بانتظار اعتمادك</p>
            </article>
            <article className="dashboard-metric">
              <p className="dashboard-metric__label">مصروفات بانتظار الاعتماد</p>
              <div className="dashboard-metric__value"><strong>{nf.format(summary.pendingExpenses)}</strong></div>
              <p className="dashboard-metric__detail">لم تُعتمد بعد</p>
            </article>
            <article className="dashboard-metric">
              <p className="dashboard-metric__label">معتمدة بانتظار الصرف</p>
              <div className="dashboard-metric__value"><strong>{nf.format(summary.approvedUnpaid)}</strong></div>
              <p className="dashboard-metric__detail">اعتمدت ولم تُصرف</p>
            </article>
          </div>
        </section>
      ) : null}

      {roleActions.length > 0 ? (
        <section className="dashboard-panel" aria-labelledby="role-todo-title" style={{ marginBottom: 18 }}>
          <div className="dashboard-panel__heading">
            <div>
              <p className="dashboard-panel__eyebrow">{isAccountant ? "يحتاج إجراءك" : "يحتاج اعتمادك"}</p>
              <h2 id="role-todo-title">{isAccountant ? "ما ينتظرك اليوم" : "ما ينتظر قرارك"}</h2>
            </div>
            <span className="dashboard-count">{nf.format(roleActions.length)} عنصر</span>
          </div>
          <div className="dashboard-setup__items">
            {roleActions.map((item) => (
              <Link className="dashboard-shortcut" key={item.key} href={item.href}>
                <span className={`dashboard-shortcut__icon ${item.tone === "warning" ? "is-cyan" : "is-blue"}`}><AppIcon name={item.href.includes("settlements") ? "cash" : "expenses"} /></span>
                <span><strong>{item.text}</strong></span>
                <AppIcon className="dashboard-shortcut__arrow" name="arrow" />
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="dashboard-overview" aria-labelledby="overview-title">
        <div className="dashboard-section-heading">
          <div><h2 id="overview-title">نظرة عامة</h2><p>{isEmployee ? "مبيعاتك ونطاق فرعك" : isAccountant ? "ما يتحرّك تحت يدك" : "صورة الشركة"}</p></div>
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
          {!isEmployee && !isAccountant ? (
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
          ) : null}

          <section className="dashboard-panel dashboard-shortcuts" aria-labelledby="shortcuts-title">
            <div className="dashboard-panel__heading">
              <div><p className="dashboard-panel__eyebrow">ابدأ من هنا</p><h2 id="shortcuts-title">وصول سريع</h2></div>
            </div>
            {isEmployee ? (
              <>
                <Link className="dashboard-shortcut" href="/sales/new">
                  <span className="dashboard-shortcut__icon"><AppIcon name="sales" /></span>
                  <span><strong>فاتورة جديدة</strong><small>ابدأ بيعًا الآن</small></span>
                  <AppIcon className="dashboard-shortcut__arrow" name="arrow" />
                </Link>
                <Link className="dashboard-shortcut" href="/finance/mine">
                  <span className="dashboard-shortcut__icon is-cyan"><AppIcon name="cash" /></span>
                  <span><strong>عهدة نقدي</strong><small>جرد العهدة وطلب التسوية</small></span>
                  <AppIcon className="dashboard-shortcut__arrow" name="arrow" />
                </Link>
              </>
            ) : (
              <>
                <Link className="dashboard-shortcut" href="/finance/settlements">
                  <span className="dashboard-shortcut__icon"><AppIcon name="cash" /></span>
                  <span><strong>التسويات</strong><small>طلبات العهد بانتظار الإجراء</small></span>
                  <AppIcon className="dashboard-shortcut__arrow" name="arrow" />
                </Link>
                <Link className="dashboard-shortcut" href="/finance/expenses">
                  <span className="dashboard-shortcut__icon is-cyan"><AppIcon name="expenses" /></span>
                  <span><strong>المصروفات</strong><small>{isAccountant ? "صرف ما اعتمد" : "اعتماد المصروفات"}</small></span>
                  <AppIcon className="dashboard-shortcut__arrow" name="arrow" />
                </Link>
              </>
            )}
          </section>
        </div>
      </div>

      <div className="dashboard-account-note"><span>حسابك: <strong>{ROLE_LABEL[session.role] ?? session.role}</strong></span><span aria-hidden="true">·</span><span dir="ltr">{session.email}</span></div>
    </div>
  );
}
