import { randomUUID } from "node:crypto";
import Link from "next/link";

import { branchScope, requireSession } from "@/lib/auth";
import { loadSalesCatalog } from "@/lib/catalog-sales";
import { displayMoney } from "@/lib/commerce-display";
import { customerPosition } from "@/lib/commerce-math";
import { inventoryEnabled } from "@/lib/feature-flags";
import { scaledInteger } from "@/lib/inventory-math";
import { requireMenuScopeAccess } from "@/lib/menu-scope-guard";
import { prisma } from "@/lib/prisma";
import CatalogSaleForm, { type KnownCustomerHint } from "./catalog-sale-form";
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
  const scope = branchScope(session);
  const [catalog, settings, branches, recentSales] = await Promise.all([
    loadSalesCatalog(prisma),
    prisma.commerceSettings.findUnique({ where: { id: 1 } }),
    session.role === "MANAGER"
      ? prisma.branch.findMany({ where: { isActive: true }, orderBy: [{ code: "asc" }], select: { id: true, nameAr: true } })
      : Promise.resolve([]),
    prisma.commerceSale.findMany({
      where: {
        cancelledAt: null,
        ...(scope.branchId ? { branchId: BigInt(scope.branchId) } : {}),
      },
      orderBy: [{ createdAt: "desc" }],
      take: 150,
      select: {
        customerName: true,
        customerPhone: true,
        total: true,
        collections: { select: { amount: true } },
        refunds: { select: { amount: true } },
        returns: { select: { lines: { select: { total: true } } } },
      },
    }),
  ]);
  if (!catalog.length) {
    return <div className="inv-page"><div className="inv-alert inv-alert--error">لا توجد أصناف بيع نشطة. أضف الأصناف من شاشة «أصناف البيع» أولًا.</div><Link href="/sales" className="inv-back">العودة إلى الفواتير</Link></div>;
  }

  const customerMap = new Map<
    string,
    { phone: string; name: string; invoiceCount: number; unpaidCents: bigint }
  >();
  for (const s of recentSales) {
    const digits = s.customerPhone.replace(/\D+/g, "");
    if (digits.length < 6) continue;
    const orig = scaledInteger(s.total.toFixed(2), 2);
    const ret = s.returns
      .flatMap((r) => r.lines)
      .reduce((acc, l) => acc + scaledInteger(l.total.toFixed(2), 2), 0n);
    const col = s.collections.reduce((acc, c) => acc + scaledInteger(c.amount.toFixed(2), 2), 0n);
    const ref = s.refunds.reduce((acc, r) => acc + scaledInteger(r.amount.toFixed(2), 2), 0n);
    const pos = customerPosition({
      originalTotalCents: orig,
      returnedCents: ret,
      collectedCents: col,
      refundedCents: ref,
    });
    const existing = customerMap.get(digits);
    if (existing) {
      existing.invoiceCount += 1;
      existing.unpaidCents += pos.dueFromCustomerCents;
    } else {
      customerMap.set(digits, {
        phone: s.customerPhone,
        name: s.customerName,
        invoiceCount: 1,
        unpaidCents: pos.dueFromCustomerCents,
      });
    }
  }
  const knownCustomers: KnownCustomerHint[] = Array.from(customerMap.values())
    .slice(0, 80)
    .map((c) => ({
      phone: c.phone,
      digits: c.phone.replace(/\D+/g, ""),
      name: c.name,
      invoiceCount: c.invoiceCount,
      unpaidFormatted: displayMoney(c.unpaidCents),
      hasUnpaid: c.unpaidCents > 0n,
    }));

  return <div className="inv-page">
    <div className="inv-heading">
      <div><p className="inv-heading__eyebrow"><span className="sales-eyebrow-dot" aria-hidden="true" />كاونتر البيع</p><h1>بيع جديد</h1><p>اختر التصنيف والنوع، واكتب السعر الذي اتفقت عليه مع العميل.</p></div>
      <div className="inv-actions"><Link href="/sales" className="inv-button inv-button--secondary">← العودة إلى الفواتير</Link></div>
    </div>
    <div className="inv-alert inv-alert--warning">السعر الذي تكتبه نهائي، والضريبة تُسجَّل «غير محددة» ولا يحسبها النظام. الإيصال داخلي وليس فاتورة ضريبية إلكترونية؛ راجع المعالجة الضريبية مع المحاسب.</div>
    <CatalogSaleForm
      requestId={randomUUID()}
      catalog={catalog}
      branches={branches.map((branch) => ({ id: branch.id.toString(), name: branch.nameAr }))}
      defaultBranchId={session.branchId ?? ""}
      staff={session.role === "CS_AGENT"}
      discountBps={session.role === "MANAGER" ? settings?.managerDiscountBps ?? 0 : settings?.staffDiscountBps ?? 0}
      knownCustomers={knownCustomers}
    />
  </div>;
}
