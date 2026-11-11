import Link from "next/link";
import PantherSpotlightCard from "@/components/panther-spotlight-card";
import { prisma } from "@/lib/prisma";
import { requireSession, canSeeAllBranches } from "@/lib/auth";
import { formatInventoryDecimal, scaledInteger, stockValueScaled } from "@/lib/inventory-math";
import InventoryProductsView, { type InventoryProductRow } from "./inventory-products-view";
import { getAccessContext, requirePageAccess } from "@/lib/access-control-server";
import { writeAllowedForKeys } from "@/lib/access-control";

export const dynamic = "force-dynamic";

const nf = new Intl.NumberFormat("ar-EG-u-nu-latn", { maximumFractionDigits: 2 });

const CATEGORY_LABEL: Record<string, string> = {
  HEARING_AID: "سماعة طبية",
  ACCESSORY: "مستلزم",
  SPARE_PART: "قطعة غيار",
  SERVICE: "خدمة",
};

export default async function InventoryPage() {
  await requirePageAccess("/inventory");

  const session = await requireSession();
  const canSeeAll = canSeeAllBranches(session);
  const access = await getAccessContext();
  const canSeeCost = canSeeAll && access.isAllowed("/inventory#cost-details");
  const canCreateProduct = canSeeAll && writeAllowedForKeys(access.hidden, "/inventory/new");
  const canCreateOpening = canSeeAll && writeAllowedForKeys(access.hidden, "/inventory/opening");
  const canCreateReceipt = (session.role === "MANAGER" || session.role === "CS_AGENT") && writeAllowedForKeys(access.hidden, "/inventory/receipts/new");

  const products = await prisma.product.findMany({
    where: { isActive: true },
    include: { taxRate: true },
    orderBy: [{ category: "asc" }, { sku: "asc" }],
  });

  // أرصدة المخزون لكل مستودع (مفلترة بفرع المستخدم إذا كان كاونتر)
  const levels = await prisma.stockLevel.findMany({
    where: canSeeAll ? {} : { warehouse: { branchId: BigInt(session.branchId!) } },
    include: { warehouse: { include: { branch: true } } },
  });

  const stockByProduct = new Map<string, { qty: bigint; value: bigint; where: string[] }>();
  for (const level of levels) {
    const key = level.productId.toString();
    const current = stockByProduct.get(key) ?? { qty: 0n, value: 0n, where: [] };
    const quantity = level.qtyOnHand.toFixed(2);
    current.qty += scaledInteger(quantity, 2);
    if (canSeeCost) {
      current.value += stockValueScaled(quantity, level.avgCost.toFixed(4));
    }
    current.where.push(`${level.warehouse.branch.code}: ${formatInventoryDecimal(scaledInteger(quantity, 2), 2)}`);
    stockByProduct.set(key, current);
  }

  const totalStockValue = [...stockByProduct.values()].reduce((a, s) => a + s.value, 0n);
  const totalStockUnits = [...stockByProduct.values()].reduce((a, s) => a + s.qty, 0n);
  const stockableProducts = products.filter((p) => p.category !== "SERVICE");
  const inStockCount = stockableProducts.filter((p) => (stockByProduct.get(p.id.toString())?.qty ?? 0n) > 0n).length;
  const zeroStockCount = Math.max(0, stockableProducts.length - inStockCount);
  const receiptActionHref = canCreateReceipt ? "/inventory/receipts/new" : access.isAllowed("/inventory/receipts") ? "/inventory/receipts" : undefined;

  const topStockItems = stockableProducts
    .slice()
    .sort((a, b) => {
      if (canSeeCost) {
        const va = stockByProduct.get(a.id.toString())?.value ?? 0n;
        const vb = stockByProduct.get(b.id.toString())?.value ?? 0n;
        if (va !== vb) return va < vb ? -1 : 1;
      }
      const qa = stockByProduct.get(a.id.toString())?.qty ?? 0n;
      const qb = stockByProduct.get(b.id.toString())?.qty ?? 0n;
      if (qa !== qb) return qa < qb ? -1 : 1;
      return a.sku.localeCompare(b.sku);
    })
    .slice(-12);

  const qtySeries = {
    id: "stock-qty",
    label: "الكميات بالمستودع",
    points: topStockItems.map((p) => {
      const st = stockByProduct.get(p.id.toString()) ?? {
        qty: 0n,
        value: 0n,
        where: [],
      };
      const qtyFormatted = formatInventoryDecimal(st.qty, 2);
      return {
        label: `${p.nameAr} (${p.sku})`,
        shortLabel: p.sku,
        value: Number(st.qty) / 100,
        formattedValue: `${qtyFormatted} وحدة`,
        detail: st.where.join(" · ") || "رصيد صفر (يحتاج توريدًا)",
      };
    }),
  };

  const inventorySeries =
    topStockItems.length > 0
      ? canSeeCost
        ? [
            {
              id: "stock-value",
              label: "قيمة الأصناف",
              points: topStockItems.map((p) => {
                const st = stockByProduct.get(p.id.toString()) ?? {
                  qty: 0n,
                  value: 0n,
                  where: [],
                };
                const valFormatted = formatInventoryDecimal(st.value, 6);
                const qtyFormatted = formatInventoryDecimal(st.qty, 2);
                return {
                  label: `${p.nameAr} (${p.sku})`,
                  shortLabel: p.sku,
                  value: Number(st.value) / 1_000_000,
                  formattedValue: `${valFormatted} ج.م`,
                  detail: `الكمية المتاحة: ${qtyFormatted} · ${CATEGORY_LABEL[p.category] ?? p.category}`,
                };
              }),
            },
            qtySeries,
          ]
        : [qtySeries]
      : undefined;

  const productRows: InventoryProductRow[] = products.map((p) => {
    const stock = stockByProduct.get(p.id.toString());
    return {
      id: p.id.toString(),
      sku: p.sku,
      nameAr: p.nameAr,
      category: p.category,
      categoryLabel: CATEGORY_LABEL[p.category] ?? p.category,
      taxCode: p.taxRate?.code ?? "—",
      purchaseCostFormatted: canSeeCost
        ? formatInventoryDecimal(scaledInteger(p.purchaseCost.toFixed(2), 2), 2)
        : null,
      salePriceFormatted: formatInventoryDecimal(scaledInteger(p.salePrice.toFixed(2), 2), 2),
      requiresSerial: p.isSerialized || p.category === "HEARING_AID",
      isService: p.category === "SERVICE",
      qtyUnits: stock ? Number(stock.qty) / 100 : 0,
      whereSummary: stock && stock.where.length > 0 ? stock.where.join(" · ") : "",
    };
  });

  return (
    <div className="inv-page">
      <div className="inv-heading">
        <div>
          <p className="inv-heading__eyebrow">إدارة الأصناف</p>
          <h1>المخزون والمستودعات</h1>
          <p>عرض الأصناف وأرصدة الفروع المتاحة لحسابك.</p>
        </div>
        <div className="inv-actions">
          {access.isAllowed("/inventory/serials") && <Link className="inv-button inv-button--secondary" href="/inventory/serials">سجل السيريالات</Link>}
          {access.isAllowed("/inventory/receipts") && <Link className="inv-button inv-button--secondary" href="/inventory/receipts">سجل التوريدات</Link>}
          {canCreateReceipt && <Link className="inv-button inv-button--secondary" href="/inventory/receipts/new">تسجيل توريد</Link>}
          {canCreateOpening && <Link className="inv-button inv-button--secondary" href="/inventory/opening">تسجيل رصيد افتتاحي</Link>}
          {canCreateProduct && <Link className="inv-button" href="/inventory/new"><span className="inv-button__plus" aria-hidden="true">+</span> إضافة صنف</Link>}
        </div>
      </div>

      <PantherSpotlightCard
        icon="inventoryCube"
        chartVariant="columns"
        title="ميزان المخزون والنواقص"
        subtitle={`محدّث الآن · ${session.branchName ?? "كل الفروع"}`}
        pill={`${nf.format(products.length)} صنف نشط`}
        primary={
          canSeeCost
            ? {
                label: "إجمالي قيمة المخزون",
                value: formatInventoryDecimal(totalStockValue, 6),
                unit: "ج.م",
                delta: `${nf.format(inStockCount)} صنف مخزني متوفّر في المستودعات`,
                tone: "positive",
              }
            : {
                label: canSeeAll ? "إجمالي الوحدات المتاحة" : "إجمالي الوحدات المتاحة بفرعك",
                value: formatInventoryDecimal(totalStockUnits, 2),
                unit: "وحدة",
                delta: `${nf.format(inStockCount)} صنف مخزني متوفّر في المستودعات المتاحة`,
                tone: "positive",
              }
        }
        secondary={{
          label: "أصناف رصيدها صفر (نواقص)",
          value: nf.format(zeroStockCount),
          unit: "صنف",
          delta:
            zeroStockCount > 0
              ? "أصناف مخزنية تحتاج توريدًا أو رصيدًا افتتاحيًا"
              : "0 نواقص · كل الأصناف المخزنية متوفّرة",
          tone: zeroStockCount > 0 ? "negative" : "positive",
        }}
        series={inventorySeries}
        actionHref={receiptActionHref}
        actionLabel={canCreateReceipt ? "تسجيل توريد بضاعة جديد" : "عرض سجل التوريدات"}
      />

      <div className="kpis">
        <div className="kpi">
          <small>أصناف نشطة</small>
          <b>{nf.format(products.length)}</b>
          <span>سماعات · مستلزمات · قطع غيار · خدمات</span>
        </div>
        <div className="kpi">
          <small>أصناف بمخزون</small>
          <b>{nf.format([...stockByProduct.values()].filter((s) => s.qty > 0n).length)}</b>
          <span>لها رصيد فعلي في مستودع واحد على الأقل</span>
        </div>
        {canSeeCost ? (
          <div className="kpi">
            <small>إجمالي القيمة</small>
            <b>{formatInventoryDecimal(totalStockValue, 6)}</b>
            <span>ج.م بمتوسط التكلفة</span>
          </div>
        ) : (
          <div className="kpi">
            <small>الوحدات بالمستودع</small>
            <b>{formatInventoryDecimal(totalStockUnits, 2)}</b>
            <span>{canSeeAll ? "إجمالي الوحدات في المستودعات المتاحة" : "إجمالي الوحدات المتاحة بفرعك"}</span>
          </div>
        )}
        <div className="kpi">
          <small>نطاق العرض</small>
          <b style={{ fontSize: 17 }}>{session.branchName ?? "كل الفروع"}</b>
          <span>{canSeeAll ? "محاسب/مدير" : "موظف كاونتر"}</span>
        </div>
      </div>

      <InventoryProductsView rows={productRows} canSeeCost={canSeeCost} />

      {levels.length === 0 && (
        <div className="card">
          <h2>الأرصدة</h2>
          <p className="small muted" style={{ margin: 0 }}>لا توجد أرصدة مخزون مسجّلة في النطاق الحالي.</p>
        </div>
      )}
    </div>
  );
}
