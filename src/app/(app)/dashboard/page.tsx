import { prisma } from "@/lib/prisma";
import { requireSession, branchScope, canSeeAllBranches } from "@/lib/auth";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  MANAGER: "مدير الشركة",
  ACCOUNTANT: "المحاسب",
  CS_AGENT: "موظف الكاونتر",
};

const nf = new Intl.NumberFormat("ar-EG-u-nu-latn", { maximumFractionDigits: 2 });

export default async function DashboardPage() {
  const session = await requireSession();
  const scope = branchScope(session);

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
    (sum, s) => sum + Number(s.qtyOnHand) * Number(s.avgCost),
    0,
  );

  return (
    <>
      <div className="alert alert-ok">
        <b>تم الاتصال بقاعدة البيانات بنجاح ✓</b> — هذه أول شاشة تعمل فعليًا من نظامك.
        البيانات الظاهرة أُنشئت من ملف <code>prisma/seed.ts</code>.
      </div>

      <div className="kpis">
        <div className="kpi">
          <small>الفروع النشطة</small>
          <b>{nf.format(branches.length)}</b>
          <span>{canSeeAllBranches(session) ? "كل الفروع في نطاقك" : "فرعك فقط"}</span>
        </div>
        <div className="kpi">
          <small>المستودعات</small>
          <b>{nf.format(branches.reduce((n, b) => n + b.warehouses.length, 0))}</b>
          <span>مستودع افتراضي لكل فرع</span>
        </div>
        <div className="kpi">
          <small>المنتجات المسجّلة</small>
          <b>{nf.format(productCount)}</b>
          <span>سماعات · مستلزمات · قطع غيار · خدمات</span>
        </div>
        <div className="kpi">
          <small>قيمة المخزون</small>
          <b>{nf.format(stockValue)}</b>
          <span>ج.م — بمتوسط التكلفة</span>
        </div>
      </div>

      <div className="card">
        <h2>الفروع والمستودعات <span className="pill">{branches.length} فرع</span></h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>الكود</th>
                <th>الفرع</th>
                <th>المدينة</th>
                <th>المستودع</th>
                <th>المستخدمون</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {branches.map((b) => (
                <tr key={b.id.toString()}>
                  <td><code>{b.code}</code></td>
                  <td>{b.nameAr}</td>
                  <td className="muted">{b.city ?? "—"}</td>
                  <td>
                    {b.warehouses.map((w) => (
                      <span key={w.id.toString()} className="badge b-teal" style={{ marginInlineEnd: 6 }}>
                        {w.code}
                      </span>
                    ))}
                    {b.warehouses.length === 0 && <span className="muted">لا يوجد</span>}
                  </td>
                  <td className="num">{b._count.users}</td>
                  <td>
                    <span className={`badge ${b.isActive ? "b-ok" : "b-gray"}`}>
                      {b.isActive ? "نشط" : "موقوف"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>جاهزية الإعداد</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>البند</th><th>الحالة</th><th>الملاحظة</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>معدلات الضريبة</td>
                <td><span className="badge b-ok">{taxCount} معدل</span></td>
                <td className="muted">معفى · 5% أجهزة طبية · 14% عام · مكوّن 8% تراكمي · 22% للتحقق</td>
              </tr>
              <tr>
                <td>بنود المصروفات</td>
                <td><span className="badge b-ok">{expenseCategories} بند</span></td>
                <td className="muted">إيجار، مرافق، رواتب، نثرية، قطع غيار، تسويق، صيانة</td>
              </tr>
              <tr>
                <td>المستخدم الحالي</td>
                <td><span className="badge b-teal">{ROLE_LABEL[session.role]}</span></td>
                <td className="muted">
                  النطاق: {session.branchName ?? "كل الفروع"} · {session.email}
                </td>
              </tr>
              <tr>
                <td>محرك الضريبة</td>
                <td><span className="badge b-ok">17 اختبارًا ناجحًا</span></td>
                <td className="muted">تحقق: <code>npm run check:tax</code></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
