import { randomUUID } from "node:crypto";
import Link from "next/link";
import { AppIcon } from "@/components/app-icon";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import ReceiptForm from "./receipt-form";

export const dynamic = "force-dynamic";

export default async function NewReceiptPage() {
  const session = await requireSession();
  if (session.role !== "MANAGER" && session.role !== "CS_AGENT") {
    return <div className="inv-page"><div className="inv-alert inv-alert--error">تسجيل التوريد متاح للمدير وموظف الفرع فقط.</div><Link href="/inventory/receipts" className="inv-back">العودة إلى سجل التوريدات</Link></div>;
  }
  if (session.role === "CS_AGENT" && !session.branchId) {
    return <div className="inv-page"><div className="inv-alert inv-alert--error">لا يوجد فرع مرتبط بحسابك. راجع المدير قبل تسجيل التوريد.</div><Link href="/inventory" className="inv-back">العودة إلى المخزون</Link></div>;
  }
  const [products, warehouses] = await Promise.all([
    prisma.product.findMany({ where: { isActive: true, category: { not: "SERVICE" } }, orderBy: { nameAr: "asc" }, select: { id: true, nameAr: true, sku: true, category: true, isSerialized: true, purchaseCost: true } }),
    prisma.warehouse.findMany({ where: { isActive: true, holdsStock: true, branch: { isActive: true }, ...(session.role === "CS_AGENT" ? { branchId: BigInt(session.branchId!) } : {}) }, orderBy: [{ branch: { code: "asc" } }, { code: "asc" }], select: { id: true, nameAr: true, code: true, branch: { select: { nameAr: true } } } }),
  ]);

  return <div className="inv-page">
    <Link href="/inventory/receipts" className="inv-back"><AppIcon name="arrow" /> العودة إلى سجل التوريدات</Link>
    <div className="inv-heading"><div><p className="inv-heading__eyebrow">حركة مخزون</p><h1>تسجيل توريد بضاعة</h1><p>أضف كمية صنف إلى مستودع واحد بعد مراجعة التكلفة والسيريالات.</p></div></div>
    {!products.length || !warehouses.length ? <div className="inv-panel inv-empty">لا يمكن تسجيل توريد قبل توفر صنف مخزني نشط ومستودع نشط في نطاق حسابك.</div> : <ReceiptForm
      requestId={randomUUID()}
      products={products.map((product) => ({ id: product.id.toString(), name: product.nameAr, sku: product.sku, needsSerials: product.isSerialized || product.category === "HEARING_AID", purchaseCost: product.purchaseCost.toString() }))}
      warehouses={warehouses.map((warehouse) => ({ id: warehouse.id.toString(), name: warehouse.nameAr, code: warehouse.code, branch: warehouse.branch.nameAr }))}
    />}
  </div>;
}
