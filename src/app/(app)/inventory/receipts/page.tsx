import Link from "next/link";
import { branchScope, requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAccessContext, requirePageAccess } from "@/lib/access-control-server";
import { writeAllowedForKeys } from "@/lib/access-control";

export const dynamic = "force-dynamic";
const dateFormatter = new Intl.DateTimeFormat("ar-EG-u-nu-latn", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Cairo" });

export default async function ReceiptsPage() {
  await requirePageAccess("/inventory/receipts");

  const session = await requireSession();
  const scope = branchScope(session);
  const access = await getAccessContext();
  const showUnitCost = access.isAllowed("/inventory/receipts#unit-cost");
  const receipts = await prisma.inventoryReceipt.findMany({
    where: scope.branchId ? { warehouse: { branchId: BigInt(scope.branchId) } } : {},
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100,
    include: { product: { select: { nameAr: true, sku: true } }, warehouse: { select: { nameAr: true, branch: { select: { nameAr: true } } } }, createdBy: { select: { fullName: true } }, _count: { select: { serials: true } } },
  });
  const canReceive = (session.role === "MANAGER" || session.role === "CS_AGENT") && writeAllowedForKeys(access.hidden, "/inventory/receipts/new");
  return <div className="inv-page">
    <div className="inv-heading">
      <div><p className="inv-heading__eyebrow">حركات المخزون</p><h1>سجل التوريدات</h1><p>آخر حركات توريد البضاعة في نطاق حسابك؛ لا تشمل الأرصدة الافتتاحية.</p></div>
      <div className="inv-actions">{canReceive && <Link className="inv-button" href="/inventory/receipts/new">تسجيل توريد</Link>}{access.isAllowed("/inventory") && <Link className="inv-button inv-button--secondary" href="/inventory">المخزون</Link>}</div>
    </div>
    <div className="inv-alert">هذا سجل مخزني فقط؛ لا يمثّل فواتير أو حسابات موردين أو دفعات شراء.</div>
    {!receipts.length ? <div className="inv-panel inv-empty" role="status">لا توجد توريدات مسجلة في نطاق حسابك.</div> : <>
      <div className="inv-table-wrap table-wrap" role="region" aria-label="جدول التوريدات" tabIndex={0}>
        <table className="inv-table"><thead><tr><th scope="col">رقم الحركة</th><th scope="col">الصنف</th><th scope="col">الفرع والمستودع</th><th scope="col">الكمية</th>{showUnitCost && <th scope="col">تكلفة الوحدة (ج.م)</th>}<th scope="col">سيريالات</th><th scope="col">المرجع</th><th scope="col">سجّلها</th><th scope="col">التاريخ</th></tr></thead>
          <tbody>{receipts.map((receipt) => <tr key={receipt.id.toString()}>
            <td><bdi dir="ltr">{receipt.id.toString()}</bdi></td>
            <td>{receipt.product.nameAr} <span className="muted">({receipt.product.sku})</span></td>
            <td>{receipt.warehouse.branch.nameAr} — {receipt.warehouse.nameAr}</td>
            <td><bdi dir="ltr">{receipt.quantity.toFixed(2)}</bdi></td>
            {showUnitCost && <td><bdi dir="ltr">{receipt.unitCost.toFixed(4)}</bdi></td>}
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
