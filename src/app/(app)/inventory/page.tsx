import { prisma } from "@/lib/prisma";
import { requireSession, canSeeAllBranches } from "@/lib/auth";

export const dynamic = "force-dynamic";

const nf = new Intl.NumberFormat("ar-EG-u-nu-latn", { maximumFractionDigits: 2 });

const CATEGORY_LABEL: Record<string, string> = {
  HEARING_AID: "سماعة طبية",
  ACCESSORY: "مستلزم",
  SPARE_PART: "قطعة غيار",
  SERVICE: "خدمة",
};

export default async function InventoryPage() {
  const session = await requireSession();

  const products = await prisma.product.findMany({
    where: { isActive: true },
    include: { taxRate: true },
    orderBy: [{ category: "asc" }, { sku: "asc" }],
  });

  // أرصدة المخزون لكل مستودع (مفلترة بفرع المستخدم إذا كان كاونتر)
  const levels = await prisma.stockLevel.findMany({
    where: canSeeAllBranches(session) ? {} : { warehouse: { branchId: BigInt(session.branchId!) } },
    include: { warehouse: { include: { branch: true } } },
  });

  const stockByProduct = new Map<string, { qty: number; value: number; where: string[] }>();
  for (const l of levels) {
    const key = l.productId.toString();
    const current = stockByProduct.get(key) ?? { qty: 0, value: 0, where: [] };
    current.qty += Number(l.qtyOnHand);
    current.value += Number(l.qtyOnHand) * Number(l.avgCost);
    current.where.push(`${l.warehouse.branch.code}: ${nf.format(Number(l.qtyOnHand))}`);
    stockByProduct.set(key, current);
  }

  return (
    <>
      <div className="kpis">
        <div className="kpi">
          <small>أصناف نشطة</small>
          <b>{nf.format(products.length)}</b>
          <span>سماعات · مستلزمات · قطع غيار · خدمات</span>
        </div>
        <div className="kpi">
          <small>أصناف بمخزون</small>
          <b>{nf.format([...stockByProduct.values()].filter((s) => s.qty > 0).length)}</b>
          <span>لها رصيد فعلي في مستودع واحد على الأقل</span>
        </div>
        <div className="kpi">
          <small>إجمالي القيمة</small>
          <b>{nf.format([...stockByProduct.values()].reduce((a, s) => a + s.value, 0))}</b>
          <span>ج.م بمتوسط التكلفة</span>
        </div>
        <div className="kpi">
          <small>نطاق العرض</small>
          <b style={{ fontSize: 17 }}>{session.branchName ?? "كل الفروع"}</b>
          <span>{canSeeAllBranches(session) ? "محاسب/مدير" : "موظف كاونتر"}</span>
        </div>
      </div>

      <div className="card">
        <h2>الأصناف ومعدل الضريبة <span className="pill">{products.length} صنف</span></h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>الصنف</th>
                <th>التصنيف</th>
                <th>ضريبة</th>
                <th>سعر الشراء</th>
                <th>سعر البيع</th>
                <th>سيريال</th>
                <th>الأرصدة (فرع: كمية)</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const stock = stockByProduct.get(p.id.toString());
                return (
                  <tr key={p.id.toString()}>
                    <td><code>{p.sku}</code></td>
                    <td>{p.nameAr}</td>
                    <td className="muted">{CATEGORY_LABEL[p.category] ?? p.category}</td>
                    <td>
                      <span className="badge b-teal">{p.taxRate?.code ?? "—"}</span>
                    </td>
                    <td className="num">{nf.format(Number(p.purchaseCost))}</td>
                    <td className="num">{nf.format(Number(p.salePrice))}</td>
                    <td>{p.isSerialized ? <span className="badge b-warn">مطلوب</span> : <span className="muted">—</span>}</td>
                    <td className="small">
                      {stock && stock.where.length > 0
                        ? stock.where.join(" · ")
                        : <span className="muted">لا يوجد رصيد بعد</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {levels.length === 0 && (
        <div className="card">
          <h2>الأرصدة</h2>
          <p className="small muted" style={{ margin: 0 }}>لا توجد أرصدة مخزون مسجّلة في النطاق الحالي.</p>
        </div>
      )}
    </>
  );
}
