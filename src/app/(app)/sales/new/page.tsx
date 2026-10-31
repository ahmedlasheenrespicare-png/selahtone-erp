import { randomUUID } from "node:crypto";
import Link from "next/link";

import { requireSession } from "@/lib/auth";
import { loadSalesCatalog } from "@/lib/catalog-sales";
import { inventoryEnabled } from "@/lib/feature-flags";
import { requireMenuScopeAccess } from "@/lib/menu-scope-guard";
import { prisma } from "@/lib/prisma";
import CatalogSaleForm from "./catalog-sale-form";
import WarehouseSale from "./warehouse-sale";

export const dynamic = "force-dynamic";
type Props = { searchParams: Promise<{ warehouseId?: string | string[] }> };

export default async function NewSalePage({ searchParams }: Props) {
  await requireMenuScopeAccess("/sales/new");
  const session = await requireSession();
  // المسار القديم يحتاج مستودعًا ومخزونًا: يُفتح فقط حين يُشغَّل المخزون صراحةً.
  if (inventoryEnabled()) {
    const params = await searchParams;
    return <WarehouseSale warehouseParam={params.warehouseId} />;
  }
  if (session.role !== "MANAGER" && session.role !== "CS_AGENT") {
    return <div className="inv-page"><div className="inv-alert inv-alert--error">إنشاء البيع متاح للمدير وموظف الفرع فقط. يستطيع المحاسب عرض الفواتير وتسجيل التحصيل.</div><Link href="/sales" className="inv-back">العودة إلى الفواتير</Link></div>;
  }
  const [catalog, settings, branches] = await Promise.all([
    loadSalesCatalog(prisma),
    prisma.commerceSettings.findUnique({ where: { id: 1 } }),
    session.role === "MANAGER"
      ? prisma.branch.findMany({ where: { isActive: true }, orderBy: [{ code: "asc" }], select: { id: true, nameAr: true } })
      : Promise.resolve([]),
  ]);
  if (!catalog.length) {
    return <div className="inv-page"><div className="inv-alert inv-alert--error">لا توجد أصناف بيع نشطة. أضف الأصناف من شاشة «أصناف البيع» أولًا.</div><Link href="/sales" className="inv-back">العودة إلى الفواتير</Link></div>;
  }
  return <div className="inv-page">
    <Link href="/sales" className="inv-back">← العودة إلى الفواتير</Link>
    <div className="inv-heading"><div><p className="inv-heading__eyebrow">كاونتر البيع</p><h1>بيع جديد</h1><p>اختر التصنيف والنوع، واكتب السعر الذي اتفقت عليه مع العميل.</p></div></div>
    <div className="inv-alert inv-alert--warning">السعر الذي تكتبه نهائي، والضريبة تُسجَّل «غير محددة» ولا يحسبها النظام. الإيصال داخلي وليس فاتورة ضريبية إلكترونية؛ راجع المعالجة الضريبية مع المحاسب.</div>
    <CatalogSaleForm
      requestId={randomUUID()}
      catalog={catalog}
      branches={branches.map((branch) => ({ id: branch.id.toString(), name: branch.nameAr }))}
      defaultBranchId={session.branchId ?? ""}
      staff={session.role === "CS_AGENT"}
      discountBps={session.role === "MANAGER" ? settings?.managerDiscountBps ?? 0 : settings?.staffDiscountBps ?? 0}
    />
  </div>;
}
