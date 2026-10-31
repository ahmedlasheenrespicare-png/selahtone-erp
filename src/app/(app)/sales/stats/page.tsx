import Link from "next/link";
import { redirect } from "next/navigation";
import { branchScope, requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isPeriod, loadSalesStats, type Period } from "@/lib/sales-stats";

export const dynamic = "force-dynamic";

const nf = new Intl.NumberFormat("ar-EG-u-nu-latn", { maximumFractionDigits: 2 });

const PERIODS: Array<{ value: Period; label: string }> = [
  { value: "today", label: "اليوم" },
  { value: "7", label: "آخر ٧ أيام" },
  { value: "month", label: "هذا الشهر" },
  { value: "all", label: "كل الفترة" },
];

function money(value: string): string {
  return nf.format(Number(value));
}

function profit(revenue: string, cost: string): string {
  return money((Number(revenue) - Number(cost)).toFixed(2));
}

export default async function SalesStatsPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const session = await requireSession();
  // الإحصاء ملخّص مالي وتجاري للإدارة؛ موظف الكاونتر يرى مبيعاته في اللوحة.
  if (session.role !== "MANAGER") redirect("/sales");

  const params = await searchParams;
  const period: Period = isPeriod(params.period) ? params.period : "month";
  const scope = branchScope(session);
  const stats = await loadSalesStats(prisma, scope.branchId ?? null, period);

  return (
    <div className="inv-page">
      <div className="inv-heading">
        <div>
          <p className="inv-heading__eyebrow">المبيعات والتحصيل</p>
          <h1>إحصائيات المبيعات</h1>
          <p>الفواتير والمبالغ وأكثر الأصناف مبيعًا في نطاق حسابك.</p>
        </div>
        <div className="inv-actions">
          <Link className="inv-button inv-button--secondary" href="/sales">الفواتير</Link>
        </div>
      </div>

      <div className="inv-actions" style={{ marginBottom: 18 }}>
        {PERIODS.map((item) => (
          <Link
            key={item.value}
            className={`inv-button${item.value === period ? "" : " inv-button--secondary"}`}
            href={`/sales/stats?period=${item.value}`}
          >
            {item.label}
          </Link>
        ))}
      </div>

      <div className="inv-panel" style={{ marginBottom: 18 }}>
        <div className="inv-panel__heading">
          <h2>المبيعات</h2>
          <p>الفواتير غير الملغاة في الفترة المحددة. الأسعار نهائية والضريبة متضمنة فيها، فلا تُجمع فوق الإجمالي.</p>
        </div>
        <div className="inv-panel__body">
          <div className="inv-fields">
            <div className="field inv-field">
              <span className="inv-field__label">عدد الفواتير</span>
              <span className="inv-field__hint">{nf.format(stats.invoiceCount)}</span>
            </div>
            <div className="field inv-field">
              <span className="inv-field__label">إجمالي قبل الخصم</span>
              <span className="inv-field__hint">{money(stats.subtotal)} ج.م</span>
            </div>
            <div className="field inv-field">
              <span className="inv-field__label">الخصومات</span>
              <span className="inv-field__hint">{money(stats.discount)} ج.م</span>
            </div>
            <div className="field inv-field">
              <span className="inv-field__label">صافي المبيعات</span>
              <span className="inv-field__hint">{money(stats.total)} ج.م</span>
            </div>
            {/* الضريبة داخلة في السعر — المحرك يقولها صراحةً ولا يجمعها فوق
                الإجمالي. فعرضها بعد النهائي يمنع قراءتها على أنها تُضاف إليه. */}
            <div className="field inv-field">
              <span className="inv-field__label">منها ضريبة (متضمنة)</span>
              <span className="inv-field__hint">{money(stats.tax)} ج.م</span>
            </div>
            <div className="field inv-field">
              <span className="inv-field__label">متوسط الفاتورة</span>
              <span className="inv-field__hint">{money(stats.averageInvoice)} ج.م</span>
            </div>
          </div>
        </div>
      </div>

      <div className="inv-panel" style={{ marginBottom: 18 }}>
        <div className="inv-panel__heading">
          <h2>الفواتير</h2>
          <p>ما أُلغي، وما بقي على العملاء.</p>
        </div>
        <div className="inv-panel__body">
          <div className="inv-fields">
            <div className="field inv-field">
              <span className="inv-field__label">فواتير ملغاة</span>
              <span className="inv-field__hint">{nf.format(stats.cancelledCount)}</span>
            </div>
            <div className="field inv-field">
              <span className="inv-field__label">فواتير عليها باقٍ</span>
              <span className="inv-field__hint">{nf.format(stats.outstandingCount)}</span>
            </div>
            <div className="field inv-field">
              <span className="inv-field__label">مجموع الباقي على العملاء</span>
              <span className="inv-field__hint">{money(stats.outstandingTotal)} ج.م</span>
            </div>
          </div>
        </div>
      </div>

      <div className="inv-panel">
        <div className="inv-panel__heading">
          <h2>أكثر الأصناف مبيعًا</h2>
          <p>أعلى عشرة أصناف بالإيراد في الفترة المحددة.</p>
        </div>
        {stats.topItems.length === 0 ? (
          <div className="inv-panel__body">
            <p className="inv-field__hint">لا توجد مبيعات مسجلة في هذه الفترة.</p>
          </div>
        ) : (
          <div className="inv-table-wrap table-wrap" role="region" aria-label="جدول أكثر الأصناف مبيعًا" tabIndex={0}>
            <table className="inv-table">
              <thead>
                <tr>
                  <th scope="col">الصنف</th>
                  <th scope="col">التصنيف</th>
                  <th scope="col">الكمية المباعة</th>
                  <th scope="col">الإيراد</th>
                  <th scope="col">الربح</th>
                </tr>
              </thead>
              <tbody>
                {stats.topItems.map((item) => (
                  <tr key={item.name}>
                    <td>{item.name}</td>
                    <td>{item.category ?? "—"}</td>
                    <td><bdi dir="ltr">{money(item.quantity)}</bdi></td>
                    <td><bdi dir="ltr">{money(item.revenue)} ج.م</bdi></td>
                    <td><bdi dir="ltr">{profit(item.revenue, item.cost)} ج.م</bdi></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {/* الربح بلا هذا الشرح يُقرأ خطأً: فصنف الكتالوج لا تكلفة له مسجّلة،
            فلو عُدّت تكلفته صفرًا لظهر ربحه مساويًا لإيراده. */}
        <div className="inv-page__foot">
          الربح = الإيراد − تكلفة الأصناف المخزونية فقط. أصناف الكتالوج تُباع بلا تكلفة مسجّلة،
          فلا تدخل في التكلفة ويظهر ربحها مساويًا لإيرادها.
        </div>
      </div>
    </div>
  );
}
