/**
 * مسار البيع من مستودع ومخزون: يعمل حين يُشغَّل المخزون صراحةً بمتغيّر INVENTORY_ENABLED.
 * يقدّم نفس تجربة الكاونتر السريعة (نبض الوردية، المسودة التلقائية، بطاقات الدفع، الإيصال اللحظي والفوري).
 */
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { AppIcon } from "@/components/app-icon";
import { branchScope, requireSession } from "@/lib/auth";
import { displayMoney } from "@/lib/commerce-display";
import { customerPosition } from "@/lib/commerce-math";
import { financeDb, financeEnabled } from "@/lib/finance/db";
import { scaledInteger } from "@/lib/inventory-math";
import { positiveDatabaseId } from "@/lib/inventory-validation";
import { prisma } from "@/lib/prisma";
import type { KnownCustomerHint } from "./catalog-sale-form";
import SaleForm from "./sale-form";

export const dynamic = "force-dynamic";
type Props = { warehouseParam?: string | string[] };

function cairoDate(): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (name: string) => parts.find((p) => p.type === name)?.value;
  return new Date(`${part("year")}-${part("month")}-${part("day")}T00:00:00.000Z`);
}

function cairoStartOfTodayUtc(now = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtcMs = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  const offsetMs = asUtcMs - now.getTime();
  return new Date(
    Date.UTC(get("year"), get("month") - 1, get("day"), 0, 0, 0) - offsetMs,
  );
}

export default async function WarehouseSale({ warehouseParam }: Props) {
  const session = await requireSession();
  if (session.role !== "MANAGER" && session.role !== "CS_AGENT") {
    return (
      <div className="inv-page">
        <div className="inv-alert inv-alert--error">
          إنشاء البيع متاح للمدير وموظف الفرع فقط. يستطيع المحاسب عرض الفواتير وتسجيل التحصيل.
        </div>
        <Link href="/sales" className="inv-back">
          العودة إلى الفواتير
        </Link>
      </div>
    );
  }

  const scope = branchScope(session);
  const financeOn = financeEnabled();
  const todayStart = cairoStartOfTodayUtc();
  const actorIdBig = BigInt(session.id);

  const warehouses = await prisma.warehouse.findMany({
    where: {
      isActive: true,
      holdsStock: true,
      branch: { isActive: true },
      ...(scope.branchId ? { branchId: BigInt(scope.branchId) } : {}),
    },
    orderBy: [{ branch: { code: "asc" } }, { code: "asc" }],
    select: {
      id: true,
      branchId: true,
      nameAr: true,
      code: true,
      branch: { select: { nameAr: true } },
    },
  });

  const requested =
    typeof warehouseParam === "string" ? positiveDatabaseId(warehouseParam) : null;
  const warehouse = requested
    ? warehouses.find((item) => item.id.toString() === requested) ?? null
    : warehouses[0] ?? null;

  const today = cairoDate();
  const stockDecoupled = process.env.SALES_STOCK_DECOUPLED === "true";

  const [products, stock, settings, recentSales, todayBranchSales, actorTodayCashRows, custodyCheck] =
    warehouse
      ? await Promise.all([
          prisma.product.findMany({
            where: { isActive: true },
            include: { taxRate: true },
            orderBy: [{ nameAr: "asc" }, { id: "asc" }],
          }),
          prisma.stockLevel.findMany({
            where: { warehouseId: warehouse.id },
            select: { productId: true, qtyOnHand: true },
          }),
          prisma.commerceSettings.findUnique({ where: { id: 1 } }),
          prisma.commerceSale.findMany({
            where: {
              cancelledAt: null,
              branchId: warehouse.branchId,
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
          prisma.commerceSale
            .findMany({
              where: {
                cancelledAt: null,
                createdAt: { gte: todayStart },
                branchId: warehouse.branchId,
              },
              select: { total: true },
            })
            .catch(() => []),
          prisma.commerceCollection
            .findMany({
              where: {
                createdById: actorIdBig,
                method: "CASH",
                createdAt: { gte: todayStart },
                sale: { cancelledAt: null },
              },
              select: { amount: true },
            })
            .catch(() => []),
          financeOn
            ? financeDb
                .serializable((tx) =>
                  tx.query<{ id: string }>(
                    `SELECT id::text AS id
                       FROM finance.accounts
                      WHERE holder_id = $1::bigint
                        AND kind = 'CUSTODY'
                        AND closed_at IS NULL
                      LIMIT 1`,
                    [session.id],
                  ),
                )
                .then((res) => res.rows.length > 0)
                .catch(() => false)
            : Promise.resolve(false),
        ])
      : [[], [], null, [], [], [], false];

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
    const col = s.collections.reduce(
      (acc, c) => acc + scaledInteger(c.amount.toFixed(2), 2),
      0n,
    );
    const ref = s.refunds.reduce(
      (acc, r) => acc + scaledInteger(r.amount.toFixed(2), 2),
      0n,
    );
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

  const levels = new Map(
    stock.map((item) => [item.productId.toString(), item.qtyOnHand.toFixed(2)]),
  );

  const mappedProducts = products.map((product) => {
    const tax = product.taxRate;
    const supported =
      tax &&
      tax.isActive &&
      tax.effectiveFrom <= today &&
      (!tax.effectiveTo || tax.effectiveTo >= today) &&
      ["VAT", "SCHEDULE", "EXEMPT"].includes(tax.kind) &&
      tax.rate.greaterThanOrEqualTo(0) &&
      tax.rate.lessThanOrEqualTo(100) &&
      (tax.kind !== "EXEMPT" || tax.rate.isZero());
    return {
      id: product.id.toString(),
      name: product.nameAr,
      sku: product.sku,
      unitPrice: product.salePrice.toFixed(2),
      taxId: tax?.id.toString() ?? "",
      taxKind: tax?.kind ?? "",
      taxRate: tax?.rate.toFixed(3) ?? "",
      taxCode: tax?.code ?? "غير محدد",
      taxUsable: Boolean(supported),
      isStock: product.category !== "SERVICE",
      isSerialized:
        product.category !== "SERVICE" &&
        (product.isSerialized || product.category === "HEARING_AID"),
      quantityAvailable: levels.get(product.id.toString()) ?? "0.00",
    };
  });

  const usableCount = mappedProducts.filter((p) => p.taxUsable).length;
  const todayInvoicesCount = todayBranchSales.length;
  const todaySalesCents = todayBranchSales.reduce(
    (sum, s) => sum + scaledInteger(s.total.toFixed(2), 2),
    0n,
  );
  const actorTodayCashCents = actorTodayCashRows.reduce(
    (sum, c) => sum + scaledInteger(c.amount.toFixed(2), 2),
    0n,
  );
  const isManager = session.role === "MANAGER";
  const discountBps = settings
    ? isManager
      ? settings.managerDiscountBps
      : settings.staffDiscountBps
    : 0;
  const discountPctDisplay = (discountBps / 100).toString();

  return (
    <div className="inv-page">
      <div className="inv-heading">
        <div>
          <p className="inv-heading__eyebrow">
            <span className="sales-eyebrow-dot" aria-hidden="true" />
            كاونتر البيع المباشر
          </p>
          <h1>بيع جديد</h1>
          <p>
            اختر المستودع والعميل والأصناف ووسيلة التحصيل، وراجع الإيصال اللحظي قبل التأكيد.
          </p>
        </div>
        <div className="inv-actions">
          {isManager ? (
            <Link href="/inventory" className="inv-button inv-button--secondary">
              <AppIcon name="inventory" />
              <span>المخزون</span>
            </Link>
          ) : null}
          <Link href="/sales" className="inv-button inv-button--secondary">
            ← العودة إلى الفواتير
          </Link>
        </div>
      </div>

      {/* شريط نبض كاونتر البيع اليومي */}
      <section className="sales-kpi-strip no-print" aria-label="نبض كاونتر البيع اليومي">
        <div className="sales-kpi-card is-accent">
          <span className="sales-kpi-card__icon" aria-hidden="true">
            <AppIcon name="receipt" />
          </span>
          <div className="sales-kpi-card__body">
            <span className="sales-kpi-card__label">فواتير الفرع اليوم</span>
            <strong className="sales-kpi-card__value">
              {todayInvoicesCount} <small>فاتورة</small>
            </strong>
            <small className="sales-kpi-card__sub">
              بإجمالي <bdi dir="ltr">{displayMoney(todaySalesCents)}</bdi> ج.م اليوم
            </small>
          </div>
        </div>

        <div className="sales-kpi-card">
          <span className="sales-kpi-card__icon" aria-hidden="true">
            <AppIcon name="cash" />
          </span>
          <div className="sales-kpi-card__body">
            <span className="sales-kpi-card__label">تحصيلك النقدي اليوم</span>
            <strong className="sales-kpi-card__value">
              <bdi dir="ltr">{displayMoney(actorTodayCashCents)}</bdi> <small>ج.م</small>
            </strong>
            <small className="sales-kpi-card__sub">
              {financeOn
                ? custodyCheck
                  ? "مرتبط بعهدتك النقدية المفتوحة ✓"
                  : "تُسجَّل كمقبوضات نقدية للفرع"
                : "المحصّل نقدًا بحسابك اليوم"}
            </small>
          </div>
        </div>

        <div className="sales-kpi-card">
          <span className="sales-kpi-card__icon" aria-hidden="true">
            <AppIcon name="products" />
          </span>
          <div className="sales-kpi-card__body">
            <span className="sales-kpi-card__label">الأصناف الجاهزة للبيع</span>
            <strong className="sales-kpi-card__value">
              {usableCount} <small>صنف</small>
            </strong>
            <small className="sales-kpi-card__sub">
              {warehouse ? `${warehouse.branch.nameAr} · ${warehouse.code}` : "اختر المستودع"}
            </small>
          </div>
        </div>

        <div className="sales-kpi-card">
          <span className="sales-kpi-card__icon" aria-hidden="true">
            <AppIcon name="shield" />
          </span>
          <div className="sales-kpi-card__body">
            <span className="sales-kpi-card__label">سقف الخصم المعتمد لدورك</span>
            <strong className="sales-kpi-card__value">
              <bdi dir="ltr">{discountPctDisplay}%</bdi>
            </strong>
            <small className="sales-kpi-card__sub">
              {isManager ? "سقف صلاحية المدير العام" : "حد صلاحية موظف الكاونتر"}
            </small>
          </div>
        </div>
      </section>

      {stockDecoupled && (
        <div className="inv-alert inv-alert--warning">
          المخزون مفصول مؤقتًا عن البيع: تُسجَّل الفواتير والمرتجعات بلا اشتراط رصيد وبلا تحريكه. يلزم جردٌ وتسوية عند إعادة الربط.
        </div>
      )}
      <div className="inv-alert inv-alert--warning">
        الأسعار نهائية وشاملة الضريبة المحددة للصنف. يجب مراجعة المعالجة والنسب مع المحاسب قبل التشغيل الفعلي؛ معدل غير محدد ليس إعفاءً.
      </div>

      {!warehouses.length ? (
        <div className="inv-panel inv-empty">لا يوجد مستودع نشط في نطاق حسابك.</div>
      ) : (
        <>
          {warehouses.length > 1 ? (
            <form
              className="inv-panel"
              method="get"
              action="/sales/new"
              style={{ marginBottom: 16 }}
            >
              <div className="inv-panel__body sale-inline">
                <div className="inv-field">
                  <label htmlFor="sale-warehouse">الفرع والمستودع</label>
                  <select
                    id="sale-warehouse"
                    name="warehouseId"
                    defaultValue={warehouse?.id.toString() ?? ""}
                    required
                  >
                    <option value="">اختر المستودع</option>
                    {warehouses.map((item) => (
                      <option
                        key={item.id.toString()}
                        value={item.id.toString()}
                      >
                        {item.branch.nameAr} — {item.nameAr} ({item.code})
                      </option>
                    ))}
                  </select>
                </div>
                <button className="inv-button inv-button--secondary" type="submit">
                  تبديل المستودع
                </button>
              </div>
            </form>
          ) : null}

          {warehouse && settings && (
            <SaleForm
              stockDecoupled={stockDecoupled}
              requestId={randomUUID()}
              warehouseId={warehouse.id.toString()}
              warehouseName={`${warehouse.branch.nameAr} — ${warehouse.nameAr}`}
              staff={session.role === "CS_AGENT"}
              discountBps={discountBps}
              knownCustomers={knownCustomers}
              financeOn={financeOn}
              hasOpenCustody={custodyCheck}
              products={mappedProducts}
            />
          )}
          {warehouse && !settings && (
            <div className="inv-alert inv-alert--error">
              إعداد حد الخصم غير موجود؛ لا يمكن إنشاء بيع قبل مراجعته.
            </div>
          )}
        </>
      )}
    </div>
  );
}
