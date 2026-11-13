import Link from "next/link";
import DataTable from "@/components/data-driven/data-table";
import { branchScope, requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAccessContext, requirePageAccess } from "@/lib/access-control-server";
import { writeAllowedForKeys } from "@/lib/access-control";
import { createInventoryReceiptColumns, type InventoryReceiptRow } from "../inventory-registers-metadata";

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
  const rows: InventoryReceiptRow[] = receipts.map((receipt) => ({
    id: receipt.id.toString(),
    productName: receipt.product.nameAr,
    sku: receipt.product.sku,
    branchName: receipt.warehouse.branch.nameAr,
    warehouseName: receipt.warehouse.nameAr,
    quantityFormatted: receipt.quantity.toFixed(2),
    unitCostFormatted: showUnitCost ? receipt.unitCost.toFixed(4) : null,
    serialCount: receipt._count.serials,
    sourceReference: receipt.sourceReference,
    createdByName: receipt.createdBy.fullName,
    createdAtFormatted: dateFormatter.format(receipt.createdAt),
  }));
  return <div className="inv-page">
    <div className="inv-heading">
      <div><p className="inv-heading__eyebrow">حركات المخزون</p><h1>سجل التوريدات</h1><p>آخر حركات توريد البضاعة في نطاق حسابك؛ لا تشمل الأرصدة الافتتاحية.</p></div>
      <div className="inv-actions">{canReceive && <Link className="inv-button" href="/inventory/receipts/new">تسجيل توريد</Link>}{access.isAllowed("/inventory") && <Link className="inv-button inv-button--secondary" href="/inventory">المخزون</Link>}</div>
    </div>
    <div className="inv-alert">هذا سجل مخزني فقط؛ لا يمثّل فواتير أو حسابات موردين أو دفعات شراء.</div>
    {!receipts.length ? <div className="inv-panel inv-empty" role="status">لا توجد توريدات مسجلة في نطاق حسابك.</div> : <>
      <DataTable
        rows={rows}
        columns={createInventoryReceiptColumns(showUnitCost)}
        rowKey={(row) => row.id}
        regionLabel="جدول التوريدات"
        regionClassName="inv-table-wrap table-wrap"
        tableClassName="inv-table"
      />
      <p className="inv-page__foot">يظهر آخر 100 توريد ضمن نطاق حسابك.</p>
    </>}
  </div>;
}
