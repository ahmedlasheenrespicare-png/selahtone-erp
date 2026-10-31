import Link from "next/link";
import { branchScope, requireSession } from "@/lib/auth";
import { customerPosition } from "@/lib/commerce-math";
import { displayMoney } from "@/lib/commerce-display";
import { scaledInteger } from "@/lib/inventory-math";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
const dateFormatter = new Intl.DateTimeFormat("ar-EG-u-nu-latn", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Cairo" });

export default async function SalesPage() {
  const session = await requireSession();
  const scope = branchScope(session);
  const sales = await prisma.commerceSale.findMany({
    where: scope.branchId ? { branchId: BigInt(scope.branchId) } : {}, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100,
    include: { branch: { select: { nameAr: true } }, collections: { select: { amount: true } }, refunds: { select: { amount: true } }, returns: { select: { lines: { select: { total: true } } } }, lines: { select: { quantity: true, returnLines: { select: { quantity: true } } } } },
  });
  const canSell = session.role === "MANAGER" || session.role === "CS_AGENT";
  return <div className="inv-page">
    <div className="inv-heading"><div><p className="inv-heading__eyebrow">المبيعات والتحصيل</p><h1>الفواتير</h1><p>مبيعات الفروع المتاحة لحسابك، والتحصيلات والمبالغ المستحقة.</p></div>
      <div className="inv-actions">{session.role === "MANAGER" && <Link className="inv-button inv-button--secondary" href="/sales/catalog">أصناف البيع</Link>}{session.role === "MANAGER" && <Link className="inv-button inv-button--secondary" href="/sales/settings">حد خصم الموظف</Link>}{canSell && <Link className="inv-button" href="/sales/new">بيع جديد</Link>}</div>
    </div>
    <div className="inv-alert">الإيصالات داخلية وليست فواتير ضريبية إلكترونية. راجع المعالجة الضريبية للأصناف مع المحاسب قبل التشغيل الفعلي.</div>
    {!sales.length ? <div className="inv-panel inv-empty">لا توجد فواتير مسجلة في نطاق حسابك.</div> : <>
      <div className="inv-table-wrap table-wrap" role="region" aria-label="جدول فواتير البيع" tabIndex={0}><table className="inv-table">
        <thead><tr><th>الفاتورة</th><th>العميل</th><th>الفرع</th><th>الإجمالي الأصلي</th><th>المتبقي على العميل</th><th>مستحق للعميل</th><th>الحالة</th><th>التاريخ</th></tr></thead>
        <tbody>{sales.map((sale) => {
          const returned = sale.returns.flatMap((entry) => entry.lines).reduce((sum, line) => sum + scaledInteger(line.total.toFixed(2), 2), 0n);
          const collected = sale.collections.reduce((sum, entry) => sum + scaledInteger(entry.amount.toFixed(2), 2), 0n);
          const refunded = sale.refunds.reduce((sum, entry) => sum + scaledInteger(entry.amount.toFixed(2), 2), 0n);
          const original = scaledInteger(sale.total.toFixed(2), 2);
          const balance = customerPosition({ originalTotalCents: original, returnedCents: returned, collectedCents: collected, refundedCents: refunded });
          const hasReturns = sale.lines.some((line) => line.returnLines.length > 0);
          const allReturned = sale.lines.length > 0 && sale.lines.every((line) => line.returnLines.reduce((sum, item) => sum + scaledInteger(item.quantity.toFixed(2), 2), 0n) === scaledInteger(line.quantity.toFixed(2), 2));
          const status = sale.cancelledAt ? "ملغاة" : allReturned ? "مرتجعة بالكامل" : hasReturns ? "مرتجع جزئي" : "مؤكدة";
          return <tr key={sale.id.toString()}>
            <td><Link href={`/sales/${sale.id.toString()}`}>ST-{sale.id.toString()}</Link></td>
            <td>{sale.customerName}<br /><span className="muted"><bdi dir="ltr">{sale.customerPhone}</bdi></span></td><td>{sale.branch.nameAr}</td>
            <td><bdi dir="ltr">{displayMoney(original)}</bdi></td><td><bdi dir="ltr">{displayMoney(balance.dueFromCustomerCents)}</bdi></td><td><bdi dir="ltr">{displayMoney(balance.dueToCustomerCents)}</bdi></td>
            <td><span className={`sale-chip ${sale.cancelledAt ? "sale-chip--neutral" : hasReturns ? "sale-chip--warning" : ""}`}>{status}</span></td><td>{dateFormatter.format(sale.createdAt)}</td>
          </tr>;
        })}</tbody>
      </table></div><p className="inv-page__foot">يظهر آخر 100 فاتورة في نطاق حسابك. المبلغ المستحق للعميل لا يعني أن رده تم.</p>
    </>}
  </div>;
}
