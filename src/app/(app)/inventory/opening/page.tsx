import { randomUUID } from "node:crypto";
import Link from "next/link";
import { AppIcon } from "@/components/app-icon";
import { canSeeAllBranches, requireSession } from "@/lib/auth";
import { positiveDatabaseId } from "@/lib/inventory-validation";
import { prisma } from "@/lib/prisma";
import OpeningForm from "./opening-form";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ productId?: string | string[] }> };

export default async function OpeningPage({ searchParams }: Props) {
  const session = await requireSession();
  if (!canSeeAllBranches(session)) {
    return <div className="inv-page"><div className="inv-alert inv-alert--error">تسجيل الأرصدة متاح للمدير والمحاسب فقط.</div><Link href="/inventory" className="inv-back">العودة إلى المخزون</Link></div>;
  }
  const [products, warehouses] = await Promise.all([
    prisma.product.findMany({ where: { isActive: true, category: { not: "SERVICE" } }, orderBy: { nameAr: "asc" }, select: { id: true, nameAr: true, sku: true, category: true, isSerialized: true, purchaseCost: true } }),
    prisma.warehouse.findMany({ where: { isActive: true, holdsStock: true, branch: { isActive: true } }, orderBy: [{ branch: { code: "asc" } }, { code: "asc" }], select: { id: true, nameAr: true, code: true, branch: { select: { nameAr: true } } } }),
  ]);
  const query = await searchParams;
  const requested = typeof query.productId === "string" ? positiveDatabaseId(query.productId) : null;
  const initialProductId = requested && products.some((product) => product.id.toString() === requested) ? requested : "";

  return (
    <div className="inv-page">
      <Link href="/inventory" className="inv-back"><AppIcon name="arrow" /> العودة إلى المخزون</Link>
      <div className="inv-heading"><div><p className="inv-heading__eyebrow">إدخال يدوي</p><h1>تسجيل رصيد افتتاحي</h1><p>رصيد واحد لصنف واحد في مستودع واحد في كل مرة.</p></div></div>
      {!products.length || !warehouses.length ? <div className="inv-panel inv-empty">
        لا يمكن تسجيل رصيد قبل توفر صنف نشط ومستودع نشط يحتفظ بالمخزون.
        <div className="inv-actions" style={{ justifyContent: "center", marginTop: 14 }}><Link className="inv-button" href="/inventory/new">إضافة صنف</Link><Link className="inv-button inv-button--secondary" href="/inventory">العودة إلى المخزون</Link></div>
      </div> : <OpeningForm
        requestId={randomUUID()}
        initialProductId={initialProductId}
        products={products.map((product) => ({ id: product.id.toString(), name: product.nameAr, sku: product.sku, needsSerials: product.isSerialized || product.category === "HEARING_AID", purchaseCost: product.purchaseCost.toString() }))}
        warehouses={warehouses.map((warehouse) => ({ id: warehouse.id.toString(), name: warehouse.nameAr, code: warehouse.code, branch: warehouse.branch.nameAr }))}
      />}
    </div>
  );
}
