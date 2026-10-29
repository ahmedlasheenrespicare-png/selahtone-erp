import { randomUUID } from "node:crypto";
import Link from "next/link";
import { AppIcon } from "@/components/app-icon";
import { canSeeAllBranches, requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import ProductForm from "./product-form";

export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  const session = await requireSession();
  if (!canSeeAllBranches(session)) {
    return <div className="inv-page"><div className="inv-alert inv-alert--error">إضافة الأصناف متاحة للمدير والمحاسب فقط.</div><Link href="/inventory" className="inv-back">العودة إلى المخزون</Link></div>;
  }
  const taxRates = await prisma.taxRate.findMany({ where: { isActive: true }, orderBy: { nameAr: "asc" }, select: { id: true, code: true, nameAr: true, rate: true } });

  return (
    <div className="inv-page">
      <Link href="/inventory" className="inv-back"><AppIcon name="arrow" /> العودة إلى المخزون</Link>
      <div className="inv-heading"><div><p className="inv-heading__eyebrow">إدخال يدوي</p><h1>إضافة صنف جديد</h1><p>أدخل بيانات الصنف المشتركة، ثم راجعها قبل الحفظ.</p></div></div>
      <ProductForm requestId={randomUUID()} taxRates={taxRates.map((tax) => ({ id: tax.id.toString(), code: tax.code, name: tax.nameAr, rate: tax.rate.toString() }))} />
    </div>
  );
}
