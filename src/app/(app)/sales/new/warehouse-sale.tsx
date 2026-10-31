/**
 * المسار القديم للبيع من مستودع ومخزون: الأصناف من جدول المنتجات، والسعر من
 * قاعدة البيانات، والبيع يخصم المخزون ويستهلك السيريالات.
 *
 * يعمل فقط حين يُشغَّل المخزون صراحةً بمتغيّر INVENTORY_ENABLED، لأن سير العمل
 * الفعلي للشركة لا يستخدم مخزونًا ولا مستودعات. الكود محتفظ به كاملًا لإعادة
 * التشغيل إن تقرّر ذلك لاحقًا بقرار منفصل.
 */
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { branchScope, requireSession } from "@/lib/auth";
import { positiveDatabaseId } from "@/lib/inventory-validation";
import { prisma } from "@/lib/prisma";
import SaleForm from "./sale-form";

export const dynamic = "force-dynamic";
type Props = { warehouseParam?: string | string[] };
function cairoDate(): Date {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (name: string) => parts.find((p) => p.type === name)?.value;
  return new Date(`${part("year")}-${part("month")}-${part("day")}T00:00:00.000Z`);
}

export default async function WarehouseSale({ warehouseParam }: Props) {
  const session = await requireSession();
  if (session.role !== "MANAGER" && session.role !== "CS_AGENT") return <div className="inv-page"><div className="inv-alert inv-alert--error">إنشاء البيع متاح للمدير وموظف الفرع فقط. يستطيع المحاسب عرض الفواتير وتسجيل التحصيل.</div><Link href="/sales" className="inv-back">العودة إلى الفواتير</Link></div>;
  const scope = branchScope(session);
  const warehouses = await prisma.warehouse.findMany({
    where: { isActive: true, holdsStock: true, branch: { isActive: true }, ...(scope.branchId ? { branchId: BigInt(scope.branchId) } : {}) },
    orderBy: [{ branch: { code: "asc" } }, { code: "asc" }], select: { id: true, nameAr: true, code: true, branch: { select: { nameAr: true } } },
  });
  const requested = typeof warehouseParam === "string" ? positiveDatabaseId(warehouseParam) : null;
  const warehouse = requested ? warehouses.find((item) => item.id.toString() === requested) : null;
  const today = cairoDate();
  const [products, stock, settings] = warehouse ? await Promise.all([
    prisma.product.findMany({ where: { isActive: true }, include: { taxRate: true }, orderBy: [{ nameAr: "asc" }, { id: "asc" }] }),
    prisma.stockLevel.findMany({ where: { warehouseId: warehouse.id }, select: { productId: true, qtyOnHand: true } }),
    prisma.commerceSettings.findUnique({ where: { id: 1 } }),
  ]) : [[], [], null];
  const levels = new Map(stock.map((item) => [item.productId.toString(), item.qtyOnHand.toFixed(2)]));
  return <div className="inv-page">
    <Link href="/sales" className="inv-back">← العودة إلى الفواتير</Link>
    <div className="inv-heading"><div><p className="inv-heading__eyebrow">كاونتر البيع</p><h1>بيع جديد</h1><p>اختر المستودع ثم راجع الأصناف والدفعة قبل تأكيد البيع.</p></div></div>
    <div className="inv-alert inv-alert--warning">الأسعار نهائية وشاملة الضريبة المحددة للصنف. يجب مراجعة المعالجة والنسب مع المحاسب قبل التشغيل الفعلي؛ معدل غير محدد ليس إعفاءً.</div>
    {!warehouses.length ? <div className="inv-panel inv-empty">لا يوجد مستودع نشط في نطاق حسابك.</div> : <>
      <form className="inv-panel" method="get" action="/sales/new" style={{ marginBottom: 16 }}><div className="inv-panel__body sale-inline">
        <div className="inv-field"><label htmlFor="sale-warehouse">الفرع والمستودع</label><select id="sale-warehouse" name="warehouseId" defaultValue={warehouse?.id.toString() ?? ""} required>
          <option value="">اختر المستودع</option>{warehouses.map((item) => <option key={item.id.toString()} value={item.id.toString()}>{item.branch.nameAr} — {item.nameAr} ({item.code})</option>)}
        </select></div><button className="inv-button inv-button--secondary" type="submit">فتح قائمة الأصناف</button>
      </div></form>
      {warehouse && settings && <>
        <SaleForm requestId={randomUUID()} warehouseId={warehouse.id.toString()} warehouseName={`${warehouse.branch.nameAr} — ${warehouse.nameAr}`} staff={session.role === "CS_AGENT"} discountBps={settings.staffDiscountBps} products={products.map((product) => {
          const tax = product.taxRate;
          const supported = tax && tax.isActive && tax.effectiveFrom <= today && (!tax.effectiveTo || tax.effectiveTo >= today) && ["VAT", "SCHEDULE", "EXEMPT"].includes(tax.kind) && tax.rate.greaterThanOrEqualTo(0) && tax.rate.lessThanOrEqualTo(100) && (tax.kind !== "EXEMPT" || tax.rate.isZero());
          return { id: product.id.toString(), name: product.nameAr, sku: product.sku, unitPrice: product.salePrice.toFixed(2), taxId: tax?.id.toString() ?? "", taxKind: tax?.kind ?? "", taxRate: tax?.rate.toFixed(3) ?? "", taxCode: tax?.code ?? "غير محدد", taxUsable: Boolean(supported), isStock: product.category !== "SERVICE", isSerialized: product.category !== "SERVICE" && (product.isSerialized || product.category === "HEARING_AID"), quantityAvailable: levels.get(product.id.toString()) ?? "0.00" };
        })} />
      </>}
      {warehouse && !settings && <div className="inv-alert inv-alert--error">إعداد حد الخصم غير موجود؛ لا يمكن إنشاء بيع قبل مراجعته.</div>}
    </>}
  </div>;
}
