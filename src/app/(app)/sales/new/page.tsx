import { WriteLockedNotice } from "@/app/(app)/components/write-locked-notice";
import { randomUUID } from "node:crypto";
import Link from "next/link";

import { AppIcon } from "@/components/app-icon";
import { branchScope, requireSession } from "@/lib/auth";
import { loadSalesCatalog } from "@/lib/catalog-sales";
import { displayMoney } from "@/lib/commerce-display";
import { customerPosition } from "@/lib/commerce-math";
import { buildTypePriceHints } from "@/lib/counter-sale-helpers";
import { inventoryEnabled } from "@/lib/feature-flags";
import { financeDb, financeEnabled } from "@/lib/finance/db";
import { scaledInteger } from "@/lib/inventory-math";

import { prisma } from "@/lib/prisma";
import CatalogSaleForm, { type KnownCustomerHint } from "./catalog-sale-form";
import WarehouseSale from "./warehouse-sale";
import "./new-sale.css";
import { requirePageAccess, writeAccessAllowed } from "@/lib/access-control-server";

export const dynamic = "force-dynamic";
type Props = { searchParams: Promise<{ warehouseId?: string | string[] }> };

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

export default async function NewSalePage({ searchParams }: Props) {
  await requirePageAccess("/sales/new");
  const session = await requireSession();
  if (!(await writeAccessAllowed("/sales/new"))) return <WriteLockedNotice backHref="/sales" backLabel="العودة إلى المبيعات" />;

  // المسار القديم يحتاج مستودعًا ومخزونًا: يُفتح فقط حين يُشغَّل المخزون صراحةً.
  if (inventoryEnabled()) {
    const params = await searchParams;
    return <WarehouseSale warehouseParam={params.warehouseId} />;
  }

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

  const [
    catalog,
    settings,
    branches,
    staffBranch,
    recentSales,
    recentLines,
    todayBranchSales,
    actorTodayCashRows,
    custodyCheck,
  ] = await Promise.all([
    loadSalesCatalog(prisma),
    prisma.commerceSettings.findUnique({ where: { id: 1 } }),
    session.role === "MANAGER"
      ? prisma.branch.findMany({
          where: { isActive: true },
          orderBy: [{ code: "asc" }],
          select: { id: true, nameAr: true },
        })
      : Promise.resolve([]),
    session.branchId
      ? prisma.branch.findUnique({
          where: { id: BigInt(session.branchId) },
          select: { nameAr: true },
        })
      : Promise.resolve(null),
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
    prisma.commerceSaleLine
      .findMany({
        where: {
          catalogTypeId: { not: null },
          sale: {
            cancelledAt: null,
            ...(scope.branchId ? { branchId: BigInt(scope.branchId) } : {}),
          },
        },
        orderBy: [{ id: "desc" }],
        take: 180,
        select: {
          catalogTypeId: true,
          unitPrice: true,
        },
      })
      .catch(() => []),
    prisma.commerceSale
      .findMany({
        where: {
          cancelledAt: null,
          createdAt: { gte: todayStart },
          ...(scope.branchId ? { branchId: BigInt(scope.branchId) } : {}),
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
  ]);

  if (!catalog.length) {
    return (
      <div className="inv-page">
        <div className="inv-alert inv-alert--error">
          لا توجد أصناف بيع نشطة. أضف الأصناف من شاشة «أصناف البيع» أولًا.
        </div>
        <Link href="/sales" className="inv-back">
          العودة إلى الفواتير
        </Link>
      </div>
    );
  }

  // ١) العملاء المسجّلون سابقًا ورصيد كل عميل
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

  // ٢) الأسعار الاسترشادية من مبيعات الفرع الفعلية
  const priceHints = buildTypePriceHints(
    recentLines
      .filter((r) => r.catalogTypeId !== null)
      .map((r) => ({
        catalogTypeId: r.catalogTypeId!.toString(),
        unitPriceFixed: r.unitPrice.toFixed(2),
        unitPriceCents: scaledInteger(r.unitPrice.toFixed(2), 2),
      })),
  );

  // ٣) مؤشرات نبض الكاونتر اليومي
  const todayInvoicesCount = todayBranchSales.length;
  const todaySalesCents = todayBranchSales.reduce(
    (sum, s) => sum + scaledInteger(s.total.toFixed(2), 2),
    0n,
  );
  const actorTodayCashCents = actorTodayCashRows.reduce(
    (sum, c) => sum + scaledInteger(c.amount.toFixed(2), 2),
    0n,
  );

  const totalActiveTypes = catalog.reduce((sum, c) => sum + c.types.length, 0);
  const discountBps =
    session.role === "MANAGER"
      ? (settings?.managerDiscountBps ?? 0)
      : (settings?.staffDiscountBps ?? 0);
  const discountPctDisplay = (discountBps / 100).toString();
  const isManager = session.role === "MANAGER";

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
            سجّل بيانات العميل، واختر الصنف بسعره الاسترشادي أو المتفق عليه، وأصدر الإيصال الداخلي خلال ثوانٍ.
          </p>
        </div>
        <div className="inv-actions">
          {isManager ? (
            <Link href="/sales/catalog" className="inv-button inv-button--secondary">
              <AppIcon name="products" />
              <span>أصناف البيع</span>
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
            <span className="sales-kpi-card__label">
              {scope.branchId ? "فواتير الفرع اليوم" : "فواتير اليوم بكل الفروع"}
            </span>
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
                ? "تحصيلات مسجّلة اليوم؛ قد تشمل سجلات سابقة"
                : "المحصّل نقدًا بحسابك اليوم"}
            </small>
          </div>
        </div>

        <div className="sales-kpi-card">
          <span className="sales-kpi-card__icon" aria-hidden="true">
            <AppIcon name="products" />
          </span>
          <div className="sales-kpi-card__body">
            <span className="sales-kpi-card__label">الأصناف النشطة بالكاونتر</span>
            <strong className="sales-kpi-card__value">
              {totalActiveTypes} <small>نوع</small>
            </strong>
            <small className="sales-kpi-card__sub">
              موزّعة على {catalog.length} تصنيف فني جاهز
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

      <div className="inv-alert inv-alert--warning">
        السعر الذي تكتبه نهائي، والضريبة تُسجَّل «غير محددة» ولا يحسبها النظام. الإيصال داخلي وليس فاتورة ضريبية إلكترونية؛ راجع المعالجة الضريبية مع المحاسب.
      </div>

      <CatalogSaleForm
        requestId={randomUUID()}
        catalog={catalog}
        branches={branches.map((branch) => ({
          id: branch.id.toString(),
          name: branch.nameAr,
        }))}
        defaultBranchId={session.branchId ?? ""}
        defaultBranchName={staffBranch?.nameAr ?? ""}
        staff={session.role === "CS_AGENT"}
        discountBps={discountBps}
        knownCustomers={knownCustomers}
        priceHints={priceHints}
        financeOn={financeOn}
        hasOpenCustody={custodyCheck}
        userScopeKey={`${session.id}-${session.branchId ?? "all"}`}
      />
    </div>
  );
}
