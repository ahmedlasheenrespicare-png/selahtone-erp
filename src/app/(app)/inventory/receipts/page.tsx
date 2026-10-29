import Link from "next/link";
import { branchScope, requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
const dateFormatter = new Intl.DateTimeFormat("ar-EG-u-nu-latn", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Cairo" });

export default async function ReceiptsPage() {
  const session = await requireSession();
  const scope = branchScope(session);
  const receipts = await prisma.inventoryReceipt.findMany({
    where: scope.branchId ? { warehouse: { branchId: BigInt(scope.branchId) } } : {},
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100,
    include: { product: { select: { nameAr: true, sku: true } }, warehouse: { select: { nameAr: true, branch: { select: { nameAr: true } } } }, createdBy: { select: { fullName: true } }, _count: { select: { serials: true } } },
  });
  const canReceive = session.role === "MANAGER" || session.role === "CS_AGENT";
  return <div className="inv-page">
    <div className="inv-heading">
      <div><p className="inv-heading__eyebrow">حركات المخزون</p><h1>سجل التوريدات</h1><p>آخر حركات توريد البضاعة في نطاق حسابك؛ لا تشمل الأرصدة الافتتاحية.</p></div>
      <div className="inv-actions">{canReceive && <Link className="inv-button" href="/inventory/receipts/new">تسجيل توريد</Link>}<Link className="inv-button inv-button--secondary" href="/inventory">المخزون</Link></div>
    </div>
    <div className="inv-alert">هذا سجل مخزني فقط؛ لا يمثّل فواتير أو حسابات موردين أو دفعات شراء.</div>
    {!receipts.length ? <div className="inv-panel inv-empty">لا توجد توريدات مسجلة في نطاق حسابك.</div> : <>
      <div className="inv-table-wrap table-wrap" role="region" aria-label="جدول التوريدات" tabIndex={0}>
        <table className="inv-table"><thead><tr><th>رقم الحركة</th><th>الصنف</th><th>الفرع والمستودع</th><th>الكمية</th><th>تكلفة الوحدة (ج.م)</th><th>سيريالات</th><th>المرجع</th><th>سجّلها</th><th>التاريخ</th></tr></thead>
          <tbody>{receipts.map((receipt) => <tr key={receipt.id.toString()}>
            <td><bdi dir="ltr">{receipt.id.toString()}</bdi></td>
            <td>{receipt.product.nameAr} <span className="muted">({receipt.product.sku})</span></td>
            <td>{receipt.warehouse.branch.nameAr} — {receipt.warehouse.nameAr}</td>
            <td><bdi dir="ltr">{receipt.quantity.toFixed(2)}</bdi></td>
            <td><bdi dir="ltr">{receipt.unitCost.toFixed(4)}</bdi></td>
            <td>{receipt._count.serials}</td>
            <td>{receipt.sourceReference ?? "—"}</td>
            <td>{receipt.createdBy.fullName}</td><td>{dateFormatter.format(receipt.createdAt)}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <p className="inv-page__foot">يظهر آخر 100 توريد ضمن نطاق حسابك.</p>
    </>}
  </div>;
}
