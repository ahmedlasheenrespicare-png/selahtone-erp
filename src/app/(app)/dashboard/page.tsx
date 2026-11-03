import Link from "next/link";
import { AppIcon, type AppIconName } from "@/components/app-icon";
// عميلٌ لا خادم: فإنّ التمريرَ تفاعل، والصفحةُ نفسها تُبنى على الخادم.
import DashboardWallet, { type WalletPocketItem } from "./dashboard-wallet";
import MonthlySalesPanther from "./monthly-sales-panther";
import { prisma } from "@/lib/prisma";
import { requireSession, branchScope, canSeeAllBranches } from "@/lib/auth";
import { formatInventoryDecimal, stockValueScaled } from "@/lib/inventory-math";
import { loadCashSummary, loadEmployeeCash } from "@/lib/finance/dashboard";
import { loadSalesStats } from "@/lib/sales-stats";

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
const monthFormatter = new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
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
  // ملخّص مبيعات الشهر للمدير: الأرقام المفصّلة في /sales/stats، وهنا ما يكفي
  // ليعرف هل يفتحها. فالعناوين بلا أعداد تجعل المدير ينتقل ليسأل.
  //
  // والاستدعاء محمي: فاللوحة تعرض النقد والمهام والفروع، ولا يجوز أن تعطّلها
  // كلها إحصائية مبيعات تعذّر حسابها. والخطأ يُسجَّل ليُرى، لا يُخفى بالصمت.
  let sales: Awaited<ReturnType<typeof loadSalesStats>> | null = null;
  let monthSales: Awaited<ReturnType<typeof loadSalesStats>> | null = null;
  let todaySales: Awaited<ReturnType<typeof loadSalesStats>> | null = null;
  try {
    [monthSales, todaySales] = await Promise.all([
      loadSalesStats(prisma, scope.branchId ?? null, "month"),
      loadSalesStats(prisma, scope.branchId ?? null, "today"),
    ]);
    if (session.role === "MANAGER") {
      sales = monthSales;
    }
  } catch (error) {
    console.error("dashboard: sales stats failed", error);
  }

  const monthTotalNum = monthSales ? Number(monthSales.total) : 0;
  const monthOutstandingNum = monthSales ? Number(monthSales.outstandingTotal) : 0;
  const monthOutstandingPct =
    monthTotalNum > 0
      ? Math.min(100, Math.round((monthOutstandingNum / monthTotalNum) * 1000) / 10)
      : 0;
  const monthCollectedPct = monthTotalNum > 0 ? Math.max(0, Math.round((100 - monthOutstandingPct) * 10) / 10) : 0;

  const expectedBalanceValue = cash
    ? `${nf.format(Number(cash.expected))} ج.م`
    : summary
      ? `${nf.format(Number(summary.totalExpected))} ج.م`
      : "—";
  const todayNetSalesValue = todaySales
    ? `${nf.format(Number(todaySales.total))} ج.م`
    : cash
      ? `${nf.format(Number(cash.todaySales))} ج.م`
      : "—";
  const unapprovedSettlements = cash ? (cash.openSettlementId ? 1 : 0) : (summary?.pendingSettlements ?? 0);
  const unapprovedExpenses = cash ? cash.pendingExpenses : (summary?.pendingExpenses ?? 0);

  const pocketItems: WalletPocketItem[] = [
    { key: "expected", label: "المستحق للخزنة", value: expectedBalanceValue, kind: "money" },
    { key: "today-sales", label: "مبيعات اليوم", value: todayNetSalesValue, kind: "money" },
    ...(unapprovedSettlements > 0
      ? [{ key: "settlements", label: "تسويات", value: nf.format(unapprovedSettlements), kind: "count" as const }]
      : []),
    ...(unapprovedExpenses > 0
      ? [{ key: "expenses", label: "مصروفات", value: nf.format(unapprovedExpenses), kind: "count" as const }]
      : []),
  ];
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

      {/* كرتٌ واحد بترتيب المعادلة: الرصيد، ثم المبيعات، ثم المصروفات،
          ثم الناتج — فيُقرأ «المتوقَّع بيدك» حصيلةً لا رقمًا بين أرقام.
          وكانت لوحةٌ بيضاء تحوي هذا الكرتَ الكحليّ ورأسُها يكرّر رأسَه
          («عهدة الموظف» مرتين)، فأُزيلت اللوحة وبقي الكرت، ونُقل وصفُها
          إلى جسمه ملاحظةً لئلّا يضيع. */}
      {/* الحافظة — على تصميم byllzz «rude-bat-50» (MIT) بألوانه الأصلية:
          كل كرتٍ شريحةٌ مباشرة في مسار السحب الأفقي، وتعلوها طبقتا التراكب،
          ويحفظ الجيبُ الأمامي المنحني «المستحق للخزنة» مستورًا بنجوم حتى يُمرَّ عليه أو يُلمس. */}
      <DashboardWallet
        balanceValue={expectedBalanceValue}
        balanceLabel="المستحق للخزنة"
        pocketItems={pocketItems}
      >
      {cash ? (
          <article className="stat-card is-custody" aria-labelledby="cash-title">
            <div className="stat-card__head">
              <h3 id="cash-title">عهدة الموظف</h3>
              <p>الرصيد، زائدًا مبيعات الفترة، ناقصًا مصروفاتها من نقدك.</p>
              </div>
              <div className="stat-card__body">
                <div className="stat-grid">
                  <div className="stat-grid__item">
                    <span className="stat-grid__label">رصيد العهدة</span>
                    <span className="stat-grid__value">{nf.format(Number(cash.balance))} ج.م</span>
                  </div>
                  <div className="stat-grid__item">
                    <span className="stat-grid__label">مبيعات الفترة</span>
                    <span className="stat-grid__value">{nf.format(Number(cash.sales))} ج.م</span>
                  </div>
                  <div className="stat-grid__item">
                    <span className="stat-grid__label">مصروفاتها من نقدك</span>
                    <span className="stat-grid__value">{nf.format(Number(cash.expenses))} ج.م</span>
                  </div>
                  <div className="stat-grid__item is-primary">
                    <span className="stat-grid__label">المتوقَّع بيدك</span>
                    <span className="stat-grid__value">{nf.format(Number(cash.expected))} ج.م</span>
                  </div>
                  <div className="stat-grid__item">
                    <span className="stat-grid__label">مبيعات اليوم نقدًا</span>
                    <span className="stat-grid__value">{nf.format(Number(cash.todaySales))} ج.م</span>
                  </div>
                  <div className="stat-grid__item">
                    <span className="stat-grid__label">مصروفات اليوم من نقدك</span>
                    <span className="stat-grid__value">{nf.format(Number(cash.todayExpenses))} ج.م</span>
                  </div>
                  <div className="stat-grid__item is-wide">
                    <span className="stat-grid__label">باقٍ على العملاء</span>
                    <span className="stat-grid__value">{nf.format(Number(cash.outstanding))} ج.م <small>{nf.format(cash.outstandingCount)} فاتورة آجلة</small></span>
                  </div>
                </div>
              </div>
              <div className="dashboard-panel__footer">
                <span>المتوقَّع بيدك يتغيّر مع كل بيع نقدي ومع كل مصروف تصرفه من نقدك</span>
              </div>
            </article>
      ) : null}

      {cash ? (
        <article className="stat-card is-todo" aria-labelledby="todo-title">
          <div className="stat-card__head">
            <h3 id="todo-title">ما ينتظرك اليوم</h3>
            <p>يحتاج إجراءك</p>
            <span className="stat-card__badge">{nf.format(cashActions.length)} عنصر</span>
          </div>
          <div className="stat-card__body">
            <div className="stat-grid">
              {cashActions.length > 0 ? (
                cashActions.map((item) => (
                  <Link className="stat-grid__item is-link" key={item.key} href={item.href}>
                    <span className="stat-grid__label">
                      <span className={`stat-grid__icon ${item.tone === "warning" ? "is-cyan" : "is-blue"}`} aria-hidden="true"><AppIcon name="receipt" /></span>
                      {item.text}
                    </span>
                    <AppIcon className="stat-grid__arrow" name="arrow" />
                  </Link>
                ))
              ) : (
                <div className="stat-grid__item is-note">
                  <span className="stat-grid__label">لا شيء يطلب منك الآن — لا طلب تسوية معلّق ولا مصروفات بانتظار الاعتماد.</span>
                </div>
              )}
            </div>
          </div>
        </article>
      ) : null}

      {summary && summary.custodyCount > 0 ? (
        <>
          <article className="stat-card is-custody" aria-labelledby="summary-title">
            <div className="stat-card__head">
              <h3 id="summary-title">عهدة كل فرع</h3>
              <p>ما بيد كل فرعٍ الآن — مكوّناتُ المستحق.</p>
              <span className="stat-card__badge">{nf.format(summary.custodyCount)} عهدة</span>
              </div>
              <div className="stat-card__body">
                <div className="stat-grid">
                  {summary.custodies.map((custody) => (
                    <div className="stat-grid__item" key={custody.branchName}>
                      <span className="stat-grid__label">{custody.branchName}</span>
                      <span className="stat-grid__value">{nf.format(Number(custody.expected))} ج.م</span>
                    </div>
                  ))}
                  <div className="stat-grid__item">
                    <span className="stat-grid__label">عدد العهد</span>
                    <span className="stat-grid__value">{nf.format(summary.custodyCount)}</span>
                  </div>
                  <div className="stat-grid__item">
                    <span className="stat-grid__label">متوسط العهدة</span>
                    <span className="stat-grid__value">
                      {nf.format(Math.round(Number(summary.totalExpected) / Math.max(summary.custodyCount, 1)))} ج.م
                    </span>
                  </div>
                </div>
              </div>
            </article>

            {/* الناتج: وحده في كرت، مبرزًا، لا ينازعه عددُ الفروع. */}
            <article className="stat-card is-custody" aria-labelledby="expected-total-title">
              <div className="stat-card__head">
                <h3 id="expected-total-title">المستحق للخزنة</h3>
                <p>المتوقَّع تسليمه من كل العهد النشطة.</p>
              </div>
              <div className="stat-card__body">
                <div className="stat-grid">
                  <div className="stat-grid__item is-primary">
                    <span className="stat-grid__label">المستحق للخزنة — المتوقَّع في كل العهد</span>
                    <span className="stat-grid__value">{nf.format(Number(summary.totalExpected))} ج.م</span>
                  </div>
                  <div className="stat-grid__item is-note">
                    <span className="stat-grid__label">مجمَّع «المتوقَّع بيده» لكل عهدة — لا أرصدتها الدفترية. وهو ما سيُسلَّم للخزنة عند التسويات.</span>
                  </div>
                </div>
              </div>
            </article>
            {/* العدّاداتُ مهامٌ معلّقة لا أرقامُ ملخّص: فصارت كرتًا ثالثًا
                يلي الناتج، وبقيت بتنسيقها وألوانها فإنّها محكومةٌ بمعانيها
                (كهرمانيٌّ للانتظار، وتحذيريٌّ للمعتمدِ غيرِ المصروف). */}
            <article className="stat-card is-todo">
              <div className="stat-card__head">
                <h3>بانتظارك</h3>
                <p>تسوياتٌ ومصروفاتٌ تطلب إجراءً.</p>
              </div>
              <div className="stat-card__body">
                {summary.pendingSettlements + summary.pendingExpenses + summary.approvedUnpaid > 0 ? (
                  <div className="cash-tallies">
                    {summary.pendingSettlements > 0 ? (
                      <div className="cash-tally is-amber">
                        <strong>{nf.format(summary.pendingSettlements)}</strong>
                        <span>طلب تسوية بانتظار اعتمادك</span>
                      </div>
                    ) : null}
                    {summary.pendingExpenses > 0 ? (
                      <div className="cash-tally">
                        <strong>{nf.format(summary.pendingExpenses)}</strong>
                        <span>مصروفًا بانتظار الاعتماد</span>
                      </div>
                    ) : null}
                    {summary.approvedUnpaid > 0 ? (
                      <div className="cash-tally is-warning">
                        <strong>{nf.format(summary.approvedUnpaid)}</strong>
                        <span>معتمدًا بانتظار الصرف</span>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="cash-tallies">
                    <span className="cash-tallies__empty">
                      لا شيء بانتظارك — التسويات معتمدة والمصروفات مصروفة
                    </span>
                  </div>
                )}
              </div>
            </article>
        </>
      ) : null}

      {roleActions.length > 0 ? (
        <article className="stat-card is-todo" aria-labelledby="role-todo-title">
          <div className="stat-card__head">
            <h3 id="role-todo-title">{isAccountant ? "ما ينتظرك اليوم" : "ما ينتظر قرارك"}</h3>
            <p>{isAccountant ? "يحتاج إجراءك" : "يحتاج اعتمادك"}</p>
            <span className="stat-card__badge">{nf.format(roleActions.length)} عنصر</span>
          </div>
          <div className="stat-card__body">
            <div className="stat-grid">
              {/* كان هذا القسم يظهر فارغًا بلا بيان إن لم يكن ثمة عمل؛
                  فصار يقولها، كأخيه كرت الموظف. */}
              {roleActions.length > 0 ? (
                roleActions.map((item) => (
                  <Link className="stat-grid__item is-link" key={item.key} href={item.href}>
                    <span className="stat-grid__label">
                      <span className={`stat-grid__icon ${item.tone === "warning" ? "is-cyan" : "is-blue"}`} aria-hidden="true">
                        <AppIcon name={item.href.includes("settlements") ? "cash" : "expenses"} />
                      </span>
                      {item.text}
                    </span>
                    <AppIcon className="stat-grid__arrow" name="arrow" />
                  </Link>
                ))
              ) : (
                <div className="stat-grid__item is-note">
                  <span className="stat-grid__label">لا شيء ينتظر قرارك الآن.</span>
                </div>
              )}
            </div>
          </div>
        </article>
      ) : null}

      {sales ? (
          <article className="stat-card is-sales" aria-labelledby="sales-title">
            <div className="stat-card__head">
              <h3 id="sales-title">المبيعات</h3>
              <p>الفواتير غير الملغاة هذا الشهر، وما بقي على العملاء.</p>
              </div>
              <div className="stat-card__body">
                <div className="stat-grid">
                  <div className="stat-grid__item">
                    <span className="stat-grid__label">عدد الفواتير</span>
                    <span className="stat-grid__value">{nf.format(sales.invoiceCount)} <small>منها {nf.format(sales.cancelledCount)} ملغاة</small></span>
                  </div>
                  <div className="stat-grid__item">
                    <span className="stat-grid__label">باقٍ على العملاء</span>
                    <span className="stat-grid__value">{nf.format(Number(sales.outstandingTotal))} ج.م <small>{nf.format(sales.outstandingCount)} فاتورة لم تُسدَّد</small></span>
                  </div>
                  {/* الناتج: هو الرقم الذي يُفتح هذا القسم لأجله. */}
                  <div className="stat-grid__item is-primary">
                    <span className="stat-grid__label">صافي المبيعات</span>
                    <span className="stat-grid__value">{nf.format(Number(sales.total))} ج.م</span>
                  </div>
                  <div className="stat-grid__item is-note">
                    <span className="stat-grid__label">بعد الخصم — والضريبة متضمنة في السعر لا مضافة إليه</span>
                  </div>
                  <Link className="stat-grid__link" href="/sales/stats">التفاصيل <AppIcon name="arrow" /></Link>
                </div>
              </div>
            </article>
      ) : null}

      {/* كان عنوانُ هذا القسم خارج الكرت — شاذًّا عن سائر الكروت التي تحمل
          عناوينَها في رؤوسها. فصار العنوانُ رأسًا وشارةُ النطاق شارةً فيه.
          والناتجُ هو المبلغُ وحده: فكل رقمٍ له وحدة (ج.م) نال is-primary،
          أيًّا كان دور الناظر. */}
        <article className="stat-card is-overview" aria-labelledby="overview-title">
          <div className="stat-card__head">
            <h3 id="overview-title">نظرة عامة</h3>
            <p>{isEmployee ? "مبيعاتك ونطاق فرعك" : isAccountant ? "ما يتحرّك تحت يدك" : "صورة الشركة"}</p>
            <span className="stat-card__badge">{canViewAllBranches ? "كل الفروع" : (session.branchName ?? "فرعك")}</span>
          </div>
          <div className="stat-card__body">
              <div className="stat-grid">
                {metrics.map((metric) => (
                  <div className={`stat-grid__item${metric.unit ? " is-primary" : ""}`} key={metric.label}>
                    <span className="stat-grid__label">
                      <span className={`stat-grid__icon is-${metric.tone}`} aria-hidden="true"><AppIcon name={metric.icon} /></span>
                      {metric.label}
                    </span>
                    <span className="stat-grid__value">{metric.value}{metric.unit ? ` ${metric.unit}` : ""}</span>
                    <span className="stat-grid__detail">{metric.detail}</span>
                  </div>
                ))}
              </div>
            </div>
          </article>

        <article className="stat-card is-branches" aria-labelledby="branches-title">
          <div className="stat-card__head">
            <h3 id="branches-title">متابعة الفروع</h3>
            <p>الفروع والمستودعات — تفاصيل الفروع النشطة المتاحة لحسابك</p>
            <span className="stat-card__badge">{nf.format(branches.length)} فرع</span>
          </div>
          <div className="stat-card__body">
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
          </div>
        </article>

          {!isEmployee && !isAccountant ? (
          <article className="stat-card is-setup" aria-labelledby="setup-title">
            <div className="stat-card__head">
              <h3 id="setup-title">معلومات أساسية</h3>
              <p>بيانات النظام المسجّلة</p>
            </div>
            <div className="stat-card__body">
              <div className="stat-grid">
                <div className="stat-grid__item">
                  <span className="stat-grid__label">
                    <span className="stat-grid__icon is-blue" aria-hidden="true"><AppIcon name="receipt" /></span>
                    معدلات الضريبة
                  </span>
                  <span className="stat-grid__value">{nf.format(taxCount)}</span>
                  <span className="stat-grid__detail">المعدلات النشطة</span>
                </div>
                <div className="stat-grid__item">
                  <span className="stat-grid__label">
                    <span className="stat-grid__icon is-violet" aria-hidden="true"><AppIcon name="expenses" /></span>
                    بنود المصروفات
                  </span>
                  <span className="stat-grid__value">{nf.format(expenseCategories)}</span>
                  <span className="stat-grid__detail">البنود المسجّلة</span>
                </div>
                {canViewAllBranches ? (
                  <Link className="stat-grid__link" href="/setup">عرض تفاصيل الإعداد <AppIcon name="arrow" /></Link>
                ) : null}
              </div>
            </div>
          </article>
          ) : null}

          {/* روابطٌ لا أرقام: فجاءت عناصرَ شبكةٍ بنقرة، لا بطاقاتِ قيم.
              والمساران محفوظان — للموظف غيرهما لغيره. */}
          <article className="stat-card is-shortcuts" aria-labelledby="shortcuts-title">
            <div className="stat-card__head">
              <h3 id="shortcuts-title">ابدأ من هنا</h3>
              <p>وصولٌ سريع إلى ما تفعله أولًا.</p>
            </div>
            <div className="stat-card__body">
              <div className="stat-grid">
                {isEmployee ? (
                  <>
                    <Link className="stat-grid__item is-link" href="/sales/new">
                      <span className="stat-grid__label">
                        <span className="stat-grid__icon is-blue" aria-hidden="true"><AppIcon name="sales" /></span>
                        فاتورة جديدة
                      </span>
                      <span className="stat-grid__detail">ابدأ بيعًا الآن</span>
                      <AppIcon className="stat-grid__arrow" name="arrow" />
                    </Link>
                    <Link className="stat-grid__item is-link" href="/finance/mine">
                      <span className="stat-grid__label">
                        <span className="stat-grid__icon is-cyan" aria-hidden="true"><AppIcon name="cash" /></span>
                        عهدة نقدي
                      </span>
                      <span className="stat-grid__detail">جرد العهدة وطلب التسوية</span>
                      <AppIcon className="stat-grid__arrow" name="arrow" />
                    </Link>
                  </>
                ) : (
                  <>
                    <Link className="stat-grid__item is-link" href="/finance/settlements">
                      <span className="stat-grid__label">
                        <span className="stat-grid__icon is-blue" aria-hidden="true"><AppIcon name="cash" /></span>
                        التسويات
                      </span>
                      <span className="stat-grid__detail">طلبات العهد بانتظار الإجراء</span>
                      <AppIcon className="stat-grid__arrow" name="arrow" />
                    </Link>
                    <Link className="stat-grid__item is-link" href="/finance/expenses">
                      <span className="stat-grid__label">
                        <span className="stat-grid__icon is-cyan" aria-hidden="true"><AppIcon name="expenses" /></span>
                        المصروفات
                      </span>
                      <span className="stat-grid__detail">{isAccountant ? "صرف ما اعتمد" : "اعتماد المصروفات"}</span>
                      <AppIcon className="stat-grid__arrow" name="arrow" />
                    </Link>
                  </>
                )}
              </div>
            </div>
          </article>

      </DashboardWallet>

      {monthSales ? (
        <MonthlySalesPanther
          monthLabel={monthFormatter.format(now)}
          totalFormatted={nf.format(Number(monthSales.total))}
          outstandingFormatted={nf.format(Number(monthSales.outstandingTotal))}
          averageFormatted={nf.format(Number(monthSales.averageInvoice))}
          invoiceCount={nf.format(monthSales.invoiceCount)}
          outstandingCount={nf.format(monthSales.outstandingCount)}
          hasOutstanding={monthOutstandingNum > 0}
          collectedPercent={monthCollectedPct}
          outstandingPercent={monthOutstandingPct}
          hasSales={monthSales.invoiceCount > 0}
          reportHref={session.role === "MANAGER" ? "/sales/stats?period=month" : "/sales"}
          reportLabel={session.role === "MANAGER" ? "عرض التقرير الكامل لمبيعات الشهر" : "عرض سجل فواتير الشهر"}
        />
      ) : null}

      <div className="dashboard-account-note"><span>حسابك: <strong>{ROLE_LABEL[session.role] ?? session.role}</strong></span><span aria-hidden="true">·</span><span dir="ltr">{session.email}</span></div>
    </div>
  );
}
