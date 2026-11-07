import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  PantherChartPoint,
  PantherChartSeries,
  PantherMetricBlock,
} from "@/components/panther-spotlight-card";
import { displayMoney, METHOD_LABELS } from "@/lib/commerce-display";
import type { PaymentMethod } from "@/lib/commerce-validation";

/**
 * إحصائيات المبيعات للمدير: الفواتير، والمبالغ، وأكثر الأصناف مبيعًا.
 *
 * ملاحظتان مقصودتان في الحساب:
 *
 * ١. الفواتير الملغاة مستثناة من كل رقم هنا. فالملغاة لم تُبع، وجمعها مع غيرها
 *    يجعل الإحصاء يزيد كلما أخطأ الموظف وألغى.
 *
 * ٢. الربح محسوب على الأصناف المخزونية وحدها. أصناف الكتالوج تُباع بلا تكلفة
 *    مسجّلة (unit_cost فارغ)، فلو حُسبت تكلفتها صفرًا لظهر ربحها مساويًا
 *    لإيرادها — وهو رقم صحيح حسابيًا ومضلِّل معنىً. فالحقل «cost» يجمع تكلفة
 *    المخزوني فقط، والواجهة تقول ذلك صراحة.
 */

export type SalesStats = {
  invoiceCount: number;
  subtotal: string;
  discount: string;
  tax: string;
  total: string;
  averageInvoice: string;
  cancelledCount: number;
  outstandingCount: number;
  outstandingTotal: string;
  topItems: TopItem[];
};

export type TopItem = {
  name: string;
  category: string | null;
  quantity: string;
  revenue: string;
  cost: string;
  lines: number;
};

export type Period = "today" | "7" | "month" | "all";

export function isPeriod(value: unknown): value is Period {
  return value === "today" || value === "7" || value === "month" || value === "all";
}

/** نصوص العرض جاهزة للواجهة: فالتنسيق لا يتكرر في كل شاشة فيختلف. */
function money(cents: bigint): string {
  const sign = cents < 0n ? "-" : "";
  const abs = cents < 0n ? -cents : cents;
  return `${sign}${(abs / 100n).toString()}.${(abs % 100n).toString().padStart(2, "0")}`;
}

function toCents(value: string): bigint {
  const negative = value.trim().startsWith("-");
  const [whole = "0", fraction = ""] = value.replace("-", "").split(".");
  return (negative ? -1n : 1n) * (BigInt(whole || "0") * 100n + BigInt((fraction + "00").slice(0, 2) || "0"));
}

/**
 * بداية الفترة تُحسب في قاعدة البيانات لا في التطبيق: فالأعمدة timestamptz،
 * ويوم القاهرة يبدأ قبل UTC بساعتين. حسابها في Node يعني الاعتماد على توقيت
 * الخادم، وهو ليس توقيت العمل.
 */
async function periodStart(db: PrismaClient, period: Period): Promise<Date> {
  const rows = await db.$queryRaw<Array<{ start: Date }>>`
    SELECT CASE ${period}
      WHEN 'today' THEN (DATE_TRUNC('day', NOW() AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo')
      WHEN '7' THEN (DATE_TRUNC('day', NOW() AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo') - INTERVAL '7 days'
      WHEN 'month' THEN (date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo')
      ELSE '1970-01-01T00:00:00Z'::timestamptz
    END AS start`;
  return rows[0].start;
}

export async function loadSalesStats(db: PrismaClient, branchId: string | null, period: Period): Promise<SalesStats> {
  const start = await periodStart(db, period);
  // يُمرَّر كـNULL لمن يرى كل الفروع، فيلغي الشرط في SQL بدل أن يُبنى نص الاستعلام.
  const branch = branchId === null ? null : BigInt(branchId);
  const salesWhere = { cancelledAt: null, ...(branch === null ? {} : { branchId: branch }) };

  const [aggregate, cancelled, lines] = await Promise.all([
    db.commerceSale.aggregate({
      where: { ...salesWhere, createdAt: { gte: start } },
      _count: { _all: true },
      _sum: { subtotal: true, discount: true, taxTotal: true, total: true },
    }),
    db.commerceSale.count({
      where: {
        ...(branch === null ? {} : { branchId: branch }),
        createdAt: { gte: start },
        NOT: { cancelledAt: null },
      },
    }),
    db.commerceSaleLine.groupBy({
      by: ["nameSnapshot", "categorySnapshot"],
      where: { sale: { ...salesWhere, createdAt: { gte: start } } },
      _sum: { quantity: true, total: true },
      _count: { _all: true },
      orderBy: { _sum: { total: "desc" } },
      take: 10,
    }),
  ]);

  const totalRows = lines.map((line) => ({
    name: line.nameSnapshot,
    category: line.categorySnapshot,
    // العمودان NOT NULL في البند، لكن مجموعة groupBy تُرجع null إن كانت كل
    // قيمها null — فالاحتياط هنا لا للعمود بل للمجموع.
    quantity: (line._sum.quantity ?? new Prisma.Decimal(0)).toFixed(2),
    revenue: (line._sum.total ?? new Prisma.Decimal(0)).toFixed(2),
    lines: line._count._all,
  }));

  // التكلفة تُجمع في SQL لأنها موزونة بالكمية: فجمع unit_cost وحده يعدّ البند
  // الذي كميته ١٠ كأن كميته ١.
  const names = totalRows.map((row) => row.name);
  const costs = names.length
    ? await db.$queryRaw<Array<{ name: string; cost: string }>>`
        SELECT l.name_snapshot AS name,
          COALESCE(SUM(CASE WHEN l.is_stock THEN l.unit_cost * l.quantity ELSE 0 END), 0)::text AS cost
        FROM commerce_sale_lines l
        JOIN commerce_sales s ON s.id = l.sale_id
        WHERE s.cancelled_at IS NULL
          AND (${branch}::bigint IS NULL OR s.branch_id = ${branch}::bigint)
          AND s.created_at >= ${start}::timestamptz
          AND l.name_snapshot IN (${Prisma.join(names)})
        GROUP BY l.name_snapshot`
    : [];
  const costByName = new Map(costs.map((row) => [row.name, row.cost]));

  // الباقي على العملاء: فواتير غير ملغاة لم تُحصَّل كاملًا. المرتجعات والردود
  // داخلة في الحساب، فهي تنقص أصل الفاتورة عند التجارة لا هنا.
  const outstanding = await db.$queryRaw<Array<{ total: string; n: number }>>`
    SELECT COALESCE(SUM(x.remaining), 0)::text AS total, COUNT(*)::int AS n FROM (
      SELECT s.total
          - COALESCE((SELECT SUM(r.amount) FROM commerce_refunds r WHERE r.sale_id = s.id), 0)
          - COALESCE((SELECT SUM(c.amount) FROM commerce_collections c WHERE c.sale_id = s.id), 0) AS remaining
      FROM commerce_sales s
      WHERE s.cancelled_at IS NULL
        AND (${branch}::bigint IS NULL OR s.branch_id = ${branch}::bigint)
        AND s.created_at >= ${start}::timestamptz
    ) x WHERE x.remaining > 0`;

  const subtotalCents = toCents(aggregate._sum.subtotal?.toFixed(2) ?? "0");
  const discountCents = toCents(aggregate._sum.discount?.toFixed(2) ?? "0");
  const taxCents = toCents(aggregate._sum.taxTotal?.toFixed(2) ?? "0");
  const totalCents = toCents(aggregate._sum.total?.toFixed(2) ?? "0");
  const count = aggregate._count._all;

  return {
    invoiceCount: count,
    subtotal: money(subtotalCents),
    discount: money(discountCents),
    tax: money(taxCents),
    total: money(totalCents),
    averageInvoice: money(count === 0 ? 0n : totalCents / BigInt(count)),
    cancelledCount: cancelled,
    outstandingCount: Number(outstanding[0]?.n ?? 0),
    outstandingTotal: money(toCents(outstanding[0]?.total ?? "0")),
    topItems: totalRows.map((row) => ({ ...row, cost: costByName.get(row.name) ?? "0.00" })),
  };
}

const arMoney = new Intl.NumberFormat("ar-EG-u-nu-latn", {
  maximumFractionDigits: 2,
});
const arDateTime = new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/** تفاصيل فارغة للبطاقات خارج نطاق «العرض الرئيسي» — لا تُستهلك هناك (تُمرَّر بلا children). */
const EMPTY_COLLECTIONS_DETAILS: CollectionsDetails = {
  settled: [],
  due: [],
  returns: [],
  settledMore: 0,
  dueMore: 0,
  customers: [],
  branches: [],
};

function formatCentsAr(cents: bigint): string {
  return arMoney.format(Number(cents) / 100);
}

/**
 * سلاسل الرسم البياني التفاعلي لمبيعات الفترة — تعكس الفواتير والتحصيلات والأفرع الحقيقية من القاعدة.
 */
export async function loadSalesChartSeries(
  db: PrismaClient,
  branchId: string | null,
  period: Period,
): Promise<PantherChartSeries[]> {
  const start = await periodStart(db, period);
  const branch = branchId === null ? null : BigInt(branchId);

  const [salesRows, activeBranches] = await Promise.all([
    db.$queryRaw<
      Array<{
        id: string;
        branchId: string;
        branchName: string;
        branchCode: string;
        customerName: string;
        day: string;
        dayShort: string;
        total: string;
        remaining: string;
      }>
    >`
      SELECT
        s.id::text AS id,
        s.branch_id::text AS "branchId",
        b.name_ar AS "branchName",
        b.code AS "branchCode",
        s.customer_name AS "customerName",
        to_char(s.created_at AT TIME ZONE 'Africa/Cairo', 'YYYY-MM-DD') AS day,
        to_char(s.created_at AT TIME ZONE 'Africa/Cairo', 'FMDD/FMMM') AS "dayShort",
        s.total::text AS total,
        GREATEST(
          s.total
          - COALESCE((SELECT SUM(r.amount) FROM commerce_refunds r WHERE r.sale_id = s.id), 0)
          - COALESCE((SELECT SUM(c.amount) FROM commerce_collections c WHERE c.sale_id = s.id), 0),
          0
        )::text AS remaining
      FROM commerce_sales s
      JOIN branches b ON b.id = s.branch_id
      WHERE s.cancelled_at IS NULL
        AND (${branch}::bigint IS NULL OR s.branch_id = ${branch}::bigint)
        AND s.created_at >= ${start}::timestamptz
      ORDER BY s.created_at ASC, s.id ASC`,
    branch === null
      ? db.branch.findMany({
          where: { isActive: true },
          select: { id: true, nameAr: true, code: true },
          orderBy: { code: "asc" },
        })
      : Promise.resolve([]),
  ]);

  const series: PantherChartSeries[] = [];

  if (salesRows.length === 0) {
    series.push({
      id: "cumulative",
      label: "مسار المبيعات",
      points: [
        {
          label: "بداية الفترة",
          shortLabel: "البداية",
          value: 0,
          formattedValue: "0 ج.م",
          secondaryValue: 0,
          secondaryLabel: "المتبقي",
          secondaryFormatted: "0 ج.م",
          detail: "بداية حساب الفترة المختارة",
        },
        {
          label: "الآن — لا فواتير بعد",
          shortLabel: "الآن",
          value: 0,
          formattedValue: "0 ج.م",
          secondaryValue: 0,
          secondaryLabel: "المتبقي",
          secondaryFormatted: "0 ج.م",
          detail: "لم تُسجّل فواتير مؤكدة في هذه الفترة",
        },
      ],
    });
  } else if (salesRows.length <= 14) {
    let cumTotal = 0n;
    let cumRemaining = 0n;
    const cumulativePoints: PantherChartPoint[] = [
      {
        label: "بداية الفترة",
        shortLabel: "٠",
        value: 0,
        formattedValue: "0 ج.م",
        secondaryValue: 0,
        secondaryLabel: "المتبقي",
        secondaryFormatted: "0 ج.م",
        detail: "نقطة الانطلاق قبل تسجيل فواتير الفترة",
      },
    ];
    const invoicePoints: PantherChartPoint[] = [];

    for (const row of salesRows) {
      const saleCents = toCents(row.total);
      const remCents = toCents(row.remaining);
      cumTotal += saleCents;
      cumRemaining += remCents;

      cumulativePoints.push({
        label: `فاتورة #${row.id} · ${row.branchName}`,
        shortLabel: `#${row.id}`,
        value: Number(cumTotal) / 100,
        formattedValue: `${formatCentsAr(cumTotal)} ج.م`,
        secondaryValue: Number(cumRemaining) / 100,
        secondaryLabel: "تراكمي المتبقي",
        secondaryFormatted: `${formatCentsAr(cumRemaining)} ج.م`,
        detail: `قيمة الفاتورة ${formatCentsAr(saleCents)} ج.م (${row.customerName}) · ${row.day}`,
      });

      invoicePoints.push({
        label: `فاتورة #${row.id} · ${row.customerName}`,
        shortLabel: `#${row.id}`,
        value: Number(saleCents) / 100,
        formattedValue: `${formatCentsAr(saleCents)} ج.م`,
        secondaryValue: Number(remCents) / 100,
        secondaryLabel: "متبقٍّ",
        secondaryFormatted: `${formatCentsAr(remCents)} ج.م`,
        detail: `${row.branchName} · ${row.day}`,
      });
    }

    series.push({
      id: "cumulative",
      label: "مسار المبيعات",
      points: cumulativePoints,
    });
    series.push({
      id: "invoices",
      label: "كل فاتورة",
      points: invoicePoints,
    });
  } else {
    const byDay = new Map<
      string,
      { dayShort: string; totalCents: bigint; remCents: bigint; count: number }
    >();
    for (const row of salesRows) {
      const entry = byDay.get(row.day) ?? {
        dayShort: row.dayShort,
        totalCents: 0n,
        remCents: 0n,
        count: 0,
      };
      entry.totalCents += toCents(row.total);
      entry.remCents += toCents(row.remaining);
      entry.count += 1;
      byDay.set(row.day, entry);
    }

    let cumTotal = 0n;
    let cumRem = 0n;
    const cumDayPoints: PantherChartPoint[] = [
      {
        label: "بداية الفترة",
        shortLabel: "٠",
        value: 0,
        formattedValue: "0 ج.م",
        secondaryValue: 0,
        secondaryLabel: "المتبقي",
        secondaryFormatted: "0 ج.م",
      },
    ];
    const dailyPoints: PantherChartPoint[] = [];

    for (const [day, d] of byDay.entries()) {
      cumTotal += d.totalCents;
      cumRem += d.remCents;
      cumDayPoints.push({
        label: `يوم ${day}`,
        shortLabel: d.dayShort,
        value: Number(cumTotal) / 100,
        formattedValue: `${formatCentsAr(cumTotal)} ج.م`,
        secondaryValue: Number(cumRem) / 100,
        secondaryLabel: "تراكمي المتبقي",
        secondaryFormatted: `${formatCentsAr(cumRem)} ج.م`,
        detail: `مبيعات اليوم ${formatCentsAr(d.totalCents)} ج.م (${d.count} فاتورة)`,
      });
      dailyPoints.push({
        label: `يوم ${day}`,
        shortLabel: d.dayShort,
        value: Number(d.totalCents) / 100,
        formattedValue: `${formatCentsAr(d.totalCents)} ج.م`,
        secondaryValue: Number(d.remCents) / 100,
        secondaryLabel: "متبقٍّ",
        secondaryFormatted: `${formatCentsAr(d.remCents)} ج.م`,
        detail: `${d.count} فاتورة مؤكدة في هذا اليوم`,
      });
    }

    series.push({
      id: "cumulative",
      label: "مسار المبيعات",
      points: cumDayPoints,
    });
    series.push({
      id: "daily",
      label: "يوميًا",
      points: dailyPoints,
    });
  }

  if (activeBranches.length > 1) {
    const branchTotals = new Map<
      string,
      { totalCents: bigint; remCents: bigint; count: number }
    >();
    for (const row of salesRows) {
      const entry = branchTotals.get(row.branchId) ?? {
        totalCents: 0n,
        remCents: 0n,
        count: 0,
      };
      entry.totalCents += toCents(row.total);
      entry.remCents += toCents(row.remaining);
      entry.count += 1;
      branchTotals.set(row.branchId, entry);
    }

    series.push({
      id: "branches",
      label: "حسب الفرع",
      points: activeBranches.map((b) => {
        const stat = branchTotals.get(b.id.toString()) ?? {
          totalCents: 0n,
          remCents: 0n,
          count: 0,
        };
        return {
          label: b.nameAr,
          shortLabel: b.nameAr.replace(/^فرع\s+/, ""),
          value: Number(stat.totalCents) / 100,
          formattedValue: `${formatCentsAr(stat.totalCents)} ج.م`,
          secondaryValue: Number(stat.remCents) / 100,
          secondaryLabel: "المتبقي",
          secondaryFormatted: `${formatCentsAr(stat.remCents)} ج.م`,
          detail: `${stat.count} فاتورة مؤكدة في ${b.nameAr}`,
        };
      }),
    });
  }

  return series;
}

export type CollectionsInvoiceRow = {
  saleId: string;
  branchName: string;
  customerName: string;
  netFormatted: string;
  remainingFormatted: string;
  hasRemaining: boolean;
  createdAtShort: string;
};

export type CollectionsCustomerDetails = {
  name: string;
  invoicedFormatted: string;
  collectedFormatted: string;
  dueFormatted: string;
  count: number;
  invoices: CollectionsInvoiceRow[];
};

export type CollectionsBranchDetails = {
  branchId: string;
  name: string;
  invoicedFormatted: string;
  collectedFormatted: string;
  dueFormatted: string;
  collectionRatePct: number;
  count: number;
  invoices: CollectionsInvoiceRow[];
};

export type CollectionsReturnRow = {
  saleId: string;
  customerName: string;
  branchName: string;
  amountFormatted: string;
  at: string;
};

export type CollectionsDetails = {
  settled: CollectionsInvoiceRow[];
  due: CollectionsInvoiceRow[];
  returns: CollectionsReturnRow[];
  settledMore: number;
  dueMore: number;
  customers: CollectionsCustomerDetails[];
  branches: CollectionsBranchDetails[];
};

export type CollectionsSpotlightData = {
  title: string;
  subtitle: string;
  pill: string;
  primary: PantherMetricBlock;
  secondary: PantherMetricBlock;
  series: PantherChartSeries[];
  actionHref: string;
  actionLabel: string;
  /** تفاصيل حقيقية للتبويبات الثلاث (إضافة اختيارية بدل الاستيراد في كل مستهلك) */
  details: CollectionsDetails;
};

/**
 * مؤشر «التحصيل والعملاء» التفاعلي المشترك بين لوحة القيادة وصفحة المبيعات:
 * يعكس صافي التحصيلات الفعلية وأرصدة العملاء عبر كل الفواتير النشطة في نطاق صلاحية المستخدم.
 */
export async function loadCollectionsSpotlight(
  db: PrismaClient,
  branchId: string | null,
  opts: { canSell: boolean; context: "dashboard" | "sales"; period?: Period },
): Promise<CollectionsSpotlightData> {
  const branch = branchId === null ? null : BigInt(branchId);
  // عند تمرير period تُقيّد جميع بيانات البطاقة (فواتير/عملاؤهم/توزيع التحصيل) بالفترة المحددة —
  // تُستخدم في صفحة «سجل مبيعات اليوم»؛ بلا period السلوك مطابق للسابق حرفيًا.
  const start = opts.period ? await periodStart(db, opts.period) : null;

  const [invoiceRows, activeBranches, returnRowsRaw] = await Promise.all([
    db.$queryRaw<
      Array<{
        id: string;
        branchId: string;
        branchName: string;
        customerName: string;
        original: string;
        returned: string;
        collected: string;
        refunded: string;
        createdAt: Date;
      }>
    >`
      SELECT
        s.id::text AS id,
        s.branch_id::text AS "branchId",
        b.name_ar AS "branchName",
        s.customer_name AS "customerName",
        s.created_at AS "createdAt",
        s.total::text AS original,
        COALESCE(
          (SELECT SUM(rl.total) FROM commerce_return_lines rl
           JOIN commerce_returns r ON r.id = rl.return_id
           WHERE r.sale_id = s.id),
          0
        )::text AS returned,
        COALESCE(
          (SELECT SUM(c.amount) FROM commerce_collections c WHERE c.sale_id = s.id),
          0
        )::text AS collected,
        COALESCE(
          (SELECT SUM(rf.amount) FROM commerce_refunds rf WHERE rf.sale_id = s.id),
          0
        )::text AS refunded
      FROM commerce_sales s
      JOIN branches b ON b.id = s.branch_id
      WHERE s.cancelled_at IS NULL
        AND (${branch}::bigint IS NULL OR s.branch_id = ${branch}::bigint)
        AND (${start}::timestamptz IS NULL OR s.created_at >= ${start}::timestamptz)
      ORDER BY s.created_at DESC, s.id DESC`,
    branch === null
      ? db.branch.findMany({
          where: { isActive: true },
          select: { id: true, nameAr: true, code: true },
          orderBy: { code: "asc" },
        })
      : Promise.resolve([]),
    db.$queryRaw<
      Array<{
        saleId: string;
        branchName: string;
        customerName: string;
        returned: string;
        createdAt: Date;
      }>
    >`
      SELECT
        r.sale_id::text AS "saleId",
        b.name_ar AS "branchName",
        s.customer_name AS "customerName",
        COALESCE(SUM(rl.total), 0)::text AS returned,
        MAX(r.created_at) AS "createdAt"
      FROM commerce_returns r
      JOIN commerce_sales s ON s.id = r.sale_id
      JOIN branches b ON b.id = s.branch_id
      JOIN commerce_return_lines rl ON rl.return_id = r.id
      WHERE s.cancelled_at IS NULL
        AND (${branch}::bigint IS NULL OR s.branch_id = ${branch}::bigint)
        AND (${start}::timestamptz IS NULL OR r.created_at >= ${start}::timestamptz)
      GROUP BY r.sale_id, b.name_ar, s.customer_name
      ORDER BY MAX(r.created_at) DESC
      LIMIT 8`,
  ]);
  const returnRows = returnRowsRaw;

  let activeInvoicesCount = 0;
  let dueInvoicesCount = 0;
  let settledInvoicesCount = 0;
  let settledNetCents = 0n;
  let partiallyDueNetCents = 0n;
  let returnedTotalCents = 0n;
  let netInvoicedCents = 0n;
  let netCollectedCents = 0n;
  let totalDueFromCustomerCents = 0n;
  let totalDueToCustomerCents = 0n;

  const customerMap = new Map<
    string,
    { invoiced: bigint; collected: bigint; due: bigint; count: number }
  >();
  const branchMap = new Map<
    string,
    { branchName: string; invoiced: bigint; collected: bigint; due: bigint; count: number }
  >();

  for (const row of invoiceRows) {
    activeInvoicesCount += 1;
    const original = toCents(row.original);
    const returned = toCents(row.returned);
    const collected = toCents(row.collected);
    const refunded = toCents(row.refunded);

    const netInvoice = original - returned;
    const netCollected = collected - refunded;
    const dueFrom = netInvoice > netCollected ? netInvoice - netCollected : 0n;
    const dueTo = netCollected > netInvoice ? netCollected - netInvoice : 0n;

    netInvoicedCents += netInvoice;
    netCollectedCents += netCollected;
    returnedTotalCents += returned;
    totalDueFromCustomerCents += dueFrom;
    totalDueToCustomerCents += dueTo;

    if (dueFrom > 0n) {
      dueInvoicesCount += 1;
      partiallyDueNetCents += netInvoice;
    } else {
      settledInvoicesCount += 1;
      settledNetCents += netInvoice;
    }

    const custKey = row.customerName.trim() || "عميل نقدي";
    const cStat = customerMap.get(custKey) ?? {
      invoiced: 0n,
      collected: 0n,
      due: 0n,
      count: 0,
    };
    cStat.invoiced += netInvoice;
    cStat.collected += netCollected;
    cStat.due += dueFrom;
    cStat.count += 1;
    customerMap.set(custKey, cStat);

    const bStat = branchMap.get(row.branchId) ?? {
      branchName: row.branchName,
      invoiced: 0n,
      collected: 0n,
      due: 0n,
      count: 0,
    };
    bStat.invoiced += netInvoice;
    bStat.collected += netCollected;
    bStat.due += dueFrom;
    bStat.count += 1;
    branchMap.set(row.branchId, bStat);
  }

  const collectionRatePct =
    netInvoicedCents > 0n
      ? Math.min(
          100,
          Math.max(
            0,
            Math.round((Number(netCollectedCents) / Number(netInvoicedCents)) * 1000) / 10,
          ),
        )
      : 100;

  const series: PantherChartSeries[] = [
    {
      id: "settlement-state",
      label: "موقف السداد",
      points: [
        {
          label: "فواتير مسدّدة بالكامل",
          shortLabel: "مسدّد",
          value: Number(settledNetCents) / 100,
          formattedValue: `${displayMoney(settledNetCents)} ج.م`,
          detail: `${arMoney.format(settledInvoicesCount)} فاتورة نشطة مكتملة التحصيل`,
          pinKey: "settlement:settled",
        },
        {
          label: "فواتير عليها باقٍ للتحصيل",
          shortLabel: "متبقٍ",
          value: Number(totalDueFromCustomerCents) / 100,
          formattedValue: `${displayMoney(totalDueFromCustomerCents)} ج.م`,
          secondaryValue: Number(partiallyDueNetCents) / 100,
          secondaryLabel: "صافي الفواتير",
          secondaryFormatted: `${displayMoney(partiallyDueNetCents)} ج.م`,
          detail: `${arMoney.format(dueInvoicesCount)} فاتورة بانتظار استكمال التحصيل`,
          pinKey: "settlement:due",
        },
        {
          label: "مرتجعات الفواتير النشطة",
          shortLabel: "مرتجع",
          value: Number(returnedTotalCents) / 100,
          formattedValue: `${displayMoney(returnedTotalCents)} ج.م`,
          detail:
            totalDueToCustomerCents > 0n
              ? `مستحق رد للعملاء: ${displayMoney(totalDueToCustomerCents)} ج.م`
              : "لا مبالغ معلّقة للرد للعملاء",
          pinKey: "settlement:returns",
        },
      ],
    },
  ];

  if (customerMap.size > 0) {
    const sortedCustomers = Array.from(customerMap.entries())
      .sort((a, b) => {
        if (b[1].due !== a[1].due) return b[1].due > a[1].due ? 1 : -1;
        if (b[1].invoiced !== a[1].invoiced) return b[1].invoiced > a[1].invoiced ? 1 : -1;
        return b[1].count - a[1].count;
      })
      .slice(0, 6);

    const customerPoints: PantherChartPoint[] = sortedCustomers.map(([custName, stat], idx) => ({
      label: custName,
      shortLabel: custName.split(/\s+/).slice(0, 2).join(" ").slice(0, 12) || `#${idx + 1}`,
      value: Number(stat.collected) / 100,
      formattedValue: `${displayMoney(stat.collected)} ج.م`,
      secondaryValue: Number(stat.due) / 100,
      secondaryLabel: "المتبقي",
      secondaryFormatted: `${displayMoney(stat.due)} ج.م`,
      detail:
        stat.due > 0n
          ? `متبقٍّ ${displayMoney(stat.due)} ج.م من ${displayMoney(stat.invoiced)} ج.م (${stat.count} فاتورة)`
          : `مسدّد بالكامل · ${stat.count} فاتورة`,
      pinKey: `cust:${encodeURIComponent(custName)}`,
    }));

    if (customerPoints.length === 1) {
      customerPoints.unshift({
        label: "نقطة الأساس",
        shortLabel: "٠",
        value: 0,
        formattedValue: "0.00 ج.م",
      });
    }

    series.push({
      id: "customer-balances",
      label: "أرصدة العملاء",
      points: customerPoints,
    });
  }

  if (activeBranches.length > 1) {
    series.push({
      id: "branch-collections",
      label: "التحصيل حسب الفرع",
      points: activeBranches.map((b) => {
        const stat = branchMap.get(b.id.toString()) ?? {
          branchName: b.nameAr,
          invoiced: 0n,
          collected: 0n,
          due: 0n,
          count: 0,
        };
        return {
          label: b.nameAr,
          shortLabel: b.nameAr.replace(/^فرع\s+/, "").slice(0, 10),
          value: Number(stat.collected) / 100,
          formattedValue: `${displayMoney(stat.collected)} ج.م`,
          secondaryValue: Number(stat.invoiced) / 100,
          secondaryLabel: "صافي الفواتير",
          secondaryFormatted: `${displayMoney(stat.invoiced)} ج.م`,
          detail: `${arMoney.format(stat.count)} فاتورة نشطة`,
          pinKey: `branch:${encodeURIComponent(b.nameAr)}`,
        };
      }),
    });
  } else if (branchMap.size > 0) {
    const branchPoints: PantherChartPoint[] = Array.from(branchMap.values()).map((stat, idx) => ({
      label: stat.branchName,
      shortLabel: stat.branchName.replace(/^فرع\s+/, "").slice(0, 10) || `#${idx + 1}`,
      value: Number(stat.collected) / 100,
      formattedValue: `${displayMoney(stat.collected)} ج.م`,
      secondaryValue: Number(stat.invoiced) / 100,
      secondaryLabel: "صافي الفواتير",
      secondaryFormatted: `${displayMoney(stat.invoiced)} ج.م`,
      detail: `${arMoney.format(stat.count)} فاتورة نشطة`,
      pinKey: `branch:${encodeURIComponent(stat.branchName)}`,
    }));
    if (branchPoints.length === 1) {
      branchPoints.unshift({
        label: "نقطة الأساس",
        shortLabel: "٠",
        value: 0,
        formattedValue: "0.00 ج.م",
      });
    }
    series.push({
      id: "branch-collections",
      label: "التحصيل حسب الفرع",
      points: branchPoints,
    });
  }

  /* ── تلخيص التفاصيل الحقيقية للتبويبات الثلاث (التحصيل/العملاء/الفروع) ── */
  const enrichedRows = invoiceRows.map((row) => {
    const original = toCents(row.original);
    const returned = toCents(row.returned);
    const collected = toCents(row.collected);
    const refunded = toCents(row.refunded);
    const netInvoice = original - returned;
    const remainingCents = netInvoice - (collected - refunded);
    return {
      id: row.id,
      custKey: row.customerName.trim() || "عميل نقدي",
      branchId: row.branchId,
      branchName: row.branchName,
      customerName: row.customerName,
      netCents: netInvoice,
      remainingCents,
      createdAt: row.createdAt,
    };
  });
  const toSheetRow = (r: (typeof enrichedRows)[number]): CollectionsInvoiceRow => ({
    saleId: r.id,
    branchName: r.branchName,
    customerName: r.customerName,
    netFormatted: displayMoney(r.netCents),
    remainingFormatted: displayMoney(r.remainingCents > 0n ? r.remainingCents : 0n),
    hasRemaining: r.remainingCents > 0n,
    createdAtShort: arDateTime.format(r.createdAt),
  });
  const settledAll = enrichedRows
    .filter((r) => r.remainingCents <= 0n)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const dueAll = enrichedRows
    .filter((r) => r.remainingCents > 0n)
    .sort(
      (a, b) =>
        (b.remainingCents > a.remainingCents ? 1 : b.remainingCents < a.remainingCents ? -1 : 0) ||
        b.createdAt.getTime() - a.createdAt.getTime(),
    );
  const settled = settledAll.slice(0, 6).map(toSheetRow);
  const due = dueAll.slice(0, 6).map(toSheetRow);

  const byCustomer = new Map<string, typeof enrichedRows>();
  const byBranch = new Map<string, typeof enrichedRows>();
  for (const r of enrichedRows) {
    const cList = byCustomer.get(r.custKey) ?? [];
    cList.push(r);
    byCustomer.set(r.custKey, cList);
    const bList = byBranch.get(r.branchId) ?? [];
    bList.push(r);
    byBranch.set(r.branchId, bList);
  }
  const remainingDesc = (a: (typeof enrichedRows)[number], b: (typeof enrichedRows)[number]) =>
    (b.remainingCents > a.remainingCents ? 1 : b.remainingCents < a.remainingCents ? -1 : 0) ||
    b.createdAt.getTime() - a.createdAt.getTime();
  for (const list of byCustomer.values()) list.sort(remainingDesc);
  for (const list of byBranch.values()) list.sort(remainingDesc);

  const sortedCustomersForDetails = Array.from(customerMap.entries())
    .sort((a, b) => {
      if (b[1].due !== a[1].due) return b[1].due > a[1].due ? 1 : -1;
      if (b[1].invoiced !== a[1].invoiced) return b[1].invoiced > a[1].invoiced ? 1 : -1;
      return b[1].count - a[1].count;
    })
    .slice(0, 6);
  const detailCustomers: CollectionsCustomerDetails[] = sortedCustomersForDetails.map(([name, stat]) => ({
    name,
    invoicedFormatted: displayMoney(stat.invoiced),
    collectedFormatted: displayMoney(stat.collected),
    dueFormatted: displayMoney(stat.due),
    count: stat.count,
    invoices: (byCustomer.get(name) ?? []).slice(0, 3).map(toSheetRow),
  }));

  const activeBranchDetails =
    activeBranches.length > 0
      ? activeBranches.map((b) => ({ id: b.id.toString(), nameAr: b.nameAr }))
      : Array.from(branchMap.entries()).map(([id, value]) => ({ id, nameAr: value.branchName }));
  const detailBranches: CollectionsBranchDetails[] = activeBranchDetails.map((b) => {
    const stat = branchMap.get(b.id);
    const invoiced = stat?.invoiced ?? 0n;
    const collected = stat?.collected ?? 0n;
    const dueC = stat?.due ?? 0n;
    const collectionRatePct =
      invoiced > 0n
        ? Math.min(100, Math.max(0, Math.round((Number(collected) / Number(invoiced)) * 1000) / 10))
        : 100;
    return {
      branchId: b.id,
      name: b.nameAr,
      invoicedFormatted: displayMoney(invoiced),
      collectedFormatted: displayMoney(collected),
      dueFormatted: displayMoney(dueC),
      collectionRatePct,
      count: stat?.count ?? 0,
      invoices: (byBranch.get(b.id) ?? []).slice(0, 3).map(toSheetRow),
    };
  });

  const detailReturns: CollectionsReturnRow[] = returnRows.slice(0, 6).map((r) => ({
    saleId: r.saleId,
    customerName: r.customerName,
    branchName: r.branchName,
    amountFormatted: displayMoney(toCents(r.returned)),
    at: arDateTime.format(r.createdAt),
  }));

  const details: CollectionsDetails = {
    settled,
    due,
    returns: detailReturns,
    settledMore: Math.max(0, settledAll.length - settled.length),
    dueMore: Math.max(0, dueAll.length - due.length),
    customers: detailCustomers,
    branches: detailBranches,
  };

  const actionHref =
    opts.context === "dashboard"
      ? "/sales"
      : opts.canSell
        ? "/sales/new"
        : "#sales-directory";
  const actionLabel =
    opts.context === "dashboard"
      ? dueInvoicesCount > 0
        ? "متابعة التحصيل وفواتير العملاء"
        : "عرض سجل الفواتير والتحصيلات"
      : opts.canSell
        ? "تسجيل عملية بيع جديدة"
        : "استعراض جدول الفواتير";

  return {
    title: "التحصيل والعملاء",
    subtitle:
      opts.period === "today"
        ? branch === null
          ? "محدّث الآن · تحصيلات اليوم وأرصدة عملاء اليوم عبر الفروع"
          : "محدّث الآن · تحصيلات اليوم وأرصدة عملاء فرعك"
        : branch === null
          ? "محدّث الآن · صافي التحصيلات وأرصدة العملاء عبر الفروع"
          : "محدّث الآن · صافي التحصيلات وأرصدة عملاء فرعك",
    pill: `${arMoney.format(activeInvoicesCount)} فاتورة نشطة`,
    primary: {
      label: "صافي المحصّل الفعلي",
      value: displayMoney(netCollectedCents),
      unit: "ج.م",
      delta: `${arMoney.format(collectionRatePct)}% نسبة التحصيل من صافي الفواتير (${displayMoney(netInvoicedCents)} ج.م)`,
      tone: "positive",
    },
    secondary: {
      label: "المتبقي على العملاء",
      value: displayMoney(totalDueFromCustomerCents),
      unit: "ج.م",
      delta:
        dueInvoicesCount > 0
          ? `${arMoney.format(dueInvoicesCount)} فاتورة عليها رصيد متبقٍ بانتظار التحصيل`
          : "0 ذمم معلّقة · الفواتير النشطة مسدّدة بالكامل",
      tone: dueInvoicesCount > 0 ? "negative" : "positive",
    },
    series,
    actionHref,
    actionLabel,
    details,
  };
}

export type ExecutivePaymentMethodRow = {
  method: string;
  label: string;
  collectedFormatted: string;
  refundedFormatted: string;
  netFormatted: string;
  netNum: number;
  count: number;
  sharePct: number;
};

export type ExecutiveBranchRow = {
  branchId: string;
  branchName: string;
  branchCode: string;
  invoiceCount: number;
  netSalesFormatted: string;
  netSalesNum: number;
  netCollectedFormatted: string;
  outstandingFormatted: string;
  outstandingNum: number;
  returnedFormatted: string;
  collectionRatePct: number;
  sharePct: number;
};

export type ExecutiveStaffRow = {
  userId: string;
  staffName: string;
  branchName: string;
  invoiceCount: number;
  netSalesFormatted: string;
  netSalesNum: number;
  netCollectedFormatted: string;
  averageInvoiceFormatted: string;
  collectionRatePct: number;
};

export type ExecutiveTopItemRow = {
  key: string;
  name: string;
  category: string;
  isStock: boolean;
  quantityFormatted: string;
  quantityNum: number;
  lines: number;
  revenueFormatted: string;
  revenueNum: number;
  sharePct: number;
  costFormatted: string | null;
  profitFormatted: string | null;
  profitNum: number;
  marginPct: number | null;
};

export type ExecutiveSalesAnalytics = {
  invoiceCount: number;
  cancelledCount: number;
  returnedInvoicesCount: number;
  outstandingCount: number;
  subtotalFormatted: string;
  discountFormatted: string;
  grossSalesFormatted: string;
  returnedFormatted: string;
  returnedNum: number;
  netSalesFormatted: string;
  netSalesNum: number;
  taxFormatted: string;
  averageInvoiceFormatted: string;
  netCollectedFormatted: string;
  netCollectedNum: number;
  refundedFormatted: string;
  collectionRatePct: number;
  outstandingFormatted: string;
  outstandingNum: number;
  dueToCustomerFormatted: string;
  dueToCustomerNum: number;
  stockRevenueFormatted: string;
  stockCostFormatted: string;
  stockProfitFormatted: string;
  stockProfitNum: number;
  stockMarginPct: number;
  catalogRevenueFormatted: string;
  catalogRevenueNum: number;
  comparison: {
    label: string;
    prevNetSalesFormatted: string;
    prevInvoiceCount: number;
    growthPct: number | null;
    direction: "up" | "down" | "flat";
  } | null;
  paymentMethods: ExecutivePaymentMethodRow[];
  branchPerformance: ExecutiveBranchRow[];
  staffPerformance: ExecutiveStaffRow[];
  topItems: ExecutiveTopItemRow[];
  collectionsSpotlight: CollectionsSpotlightData;
  profitabilitySpotlight: CollectionsSpotlightData;
};

const ORDERED_METHODS: PaymentMethod[] = ["CASH", "CARD", "BANK_TRANSFER", "WALLET"];

export async function loadExecutiveSalesAnalytics(
  db: PrismaClient,
  branchId: string | null,
  period: Period,
): Promise<ExecutiveSalesAnalytics> {
  const branch = branchId === null ? null : BigInt(branchId);

  const boundsRows = await db.$queryRaw<
    Array<{ start: Date; prevStart: Date | null; prevEnd: Date | null }>
  >`
    SELECT
      CASE ${period}
        WHEN 'today' THEN (DATE_TRUNC('day', NOW() AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo')
        WHEN '7' THEN (DATE_TRUNC('day', NOW() AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo') - INTERVAL '7 days'
        WHEN 'month' THEN (date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo')
        ELSE '1970-01-01T00:00:00Z'::timestamptz
      END AS start,
      CASE ${period}
        WHEN 'today' THEN (DATE_TRUNC('day', NOW() AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo') - INTERVAL '1 day'
        WHEN '7' THEN (DATE_TRUNC('day', NOW() AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo') - INTERVAL '14 days'
        WHEN 'month' THEN ((date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Cairo') - INTERVAL '1 month') AT TIME ZONE 'Africa/Cairo')
        ELSE NULL
      END AS "prevStart",
      CASE ${period}
        WHEN 'today' THEN (DATE_TRUNC('day', NOW() AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo')
        WHEN '7' THEN (DATE_TRUNC('day', NOW() AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo') - INTERVAL '7 days'
        WHEN 'month' THEN (date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo')
        ELSE NULL
      END AS "prevEnd"`;

  const start = boundsRows[0].start;
  const prevStart = boundsRows[0].prevStart;
  const prevEnd = boundsRows[0].prevEnd;

  const [
    salesRows,
    cancelledCount,
    prevSummaryRows,
    collectionMethodRows,
    refundMethodRows,
    lineRows,
    activeBranches,
  ] = await Promise.all([
    db.$queryRaw<
      Array<{
        id: string;
        branchId: string;
        branchName: string;
        branchCode: string;
        userId: string;
        staffName: string;
        customerName: string;
        subtotal: string;
        discount: string;
        taxTotal: string;
        total: string;
        returned: string;
        collected: string;
        refunded: string;
      }>
    >`
      SELECT
        s.id::text AS id,
        s.branch_id::text AS "branchId",
        b.name_ar AS "branchName",
        b.code AS "branchCode",
        s.created_by_id::text AS "userId",
        u.full_name AS "staffName",
        s.customer_name AS "customerName",
        s.subtotal::text AS subtotal,
        s.discount::text AS discount,
        COALESCE(s.tax_total, 0)::text AS "taxTotal",
        s.total::text AS total,
        COALESCE(
          (SELECT SUM(rl.total) FROM commerce_return_lines rl
           JOIN commerce_returns r ON r.id = rl.return_id
           WHERE r.sale_id = s.id),
          0
        )::text AS returned,
        COALESCE(
          (SELECT SUM(c.amount) FROM commerce_collections c WHERE c.sale_id = s.id),
          0
        )::text AS collected,
        COALESCE(
          (SELECT SUM(rf.amount) FROM commerce_refunds rf WHERE rf.sale_id = s.id),
          0
        )::text AS refunded
      FROM commerce_sales s
      JOIN branches b ON b.id = s.branch_id
      JOIN users u ON u.id = s.created_by_id
      WHERE s.cancelled_at IS NULL
        AND (${branch}::bigint IS NULL OR s.branch_id = ${branch}::bigint)
        AND s.created_at >= ${start}::timestamptz
      ORDER BY s.created_at DESC, s.id DESC`,
    db.commerceSale.count({
      where: {
        ...(branch === null ? {} : { branchId: branch }),
        createdAt: { gte: start },
        NOT: { cancelledAt: null },
      },
    }),
    prevStart && prevEnd
      ? db.$queryRaw<Array<{ netSales: string; n: number }>>`
          SELECT
            COALESCE(
              SUM(
                s.total - COALESCE(
                  (SELECT SUM(rl.total) FROM commerce_return_lines rl
                   JOIN commerce_returns r ON r.id = rl.return_id
                   WHERE r.sale_id = s.id),
                  0
                )
              ),
              0
            )::text AS "netSales",
            COUNT(*)::int AS n
          FROM commerce_sales s
          WHERE s.cancelled_at IS NULL
            AND (${branch}::bigint IS NULL OR s.branch_id = ${branch}::bigint)
            AND s.created_at >= ${prevStart}::timestamptz
            AND s.created_at < ${prevEnd}::timestamptz`
      : Promise.resolve([]),
    db.$queryRaw<Array<{ method: string; total: string; n: number }>>`
      SELECT
        c.method AS method,
        COALESCE(SUM(c.amount), 0)::text AS total,
        COUNT(*)::int AS n
      FROM commerce_collections c
      JOIN commerce_sales s ON s.id = c.sale_id
      WHERE s.cancelled_at IS NULL
        AND (${branch}::bigint IS NULL OR s.branch_id = ${branch}::bigint)
        AND s.created_at >= ${start}::timestamptz
      GROUP BY c.method`,
    db.$queryRaw<Array<{ method: string; total: string; n: number }>>`
      SELECT
        rf.method AS method,
        COALESCE(SUM(rf.amount), 0)::text AS total,
        COUNT(*)::int AS n
      FROM commerce_refunds rf
      JOIN commerce_sales s ON s.id = rf.sale_id
      WHERE s.cancelled_at IS NULL
        AND (${branch}::bigint IS NULL OR s.branch_id = ${branch}::bigint)
        AND s.created_at >= ${start}::timestamptz
      GROUP BY rf.method`,
    db.$queryRaw<
      Array<{
        name: string;
        category: string | null;
        isStock: boolean;
        lines: number;
        netQty: string;
        netRevenue: string;
        netCost: string;
      }>
    >`
      SELECT
        l.name_snapshot AS name,
        l.category_snapshot AS category,
        l.is_stock AS "isStock",
        COUNT(*)::int AS lines,
        COALESCE(
          SUM(
            GREATEST(
              l.quantity - COALESCE((SELECT SUM(rl.quantity) FROM commerce_return_lines rl WHERE rl.sale_line_id = l.id), 0),
              0
            )
          ),
          0
        )::text AS "netQty",
        COALESCE(
          SUM(
            GREATEST(
              l.total - COALESCE((SELECT SUM(rl.total) FROM commerce_return_lines rl WHERE rl.sale_line_id = l.id), 0),
              0
            )
          ),
          0
        )::text AS "netRevenue",
        COALESCE(
          SUM(
            CASE
              WHEN l.is_stock THEN COALESCE(l.unit_cost, 0) * GREATEST(
                l.quantity - COALESCE((SELECT SUM(rl.quantity) FROM commerce_return_lines rl WHERE rl.sale_line_id = l.id), 0),
                0
              )
              ELSE 0
            END
          ),
          0
        )::numeric(14, 2)::text AS "netCost"
      FROM commerce_sale_lines l
      JOIN commerce_sales s ON s.id = l.sale_id
      WHERE s.cancelled_at IS NULL
        AND (${branch}::bigint IS NULL OR s.branch_id = ${branch}::bigint)
        AND s.created_at >= ${start}::timestamptz
      GROUP BY l.name_snapshot, l.category_snapshot, l.is_stock
      ORDER BY SUM(
        GREATEST(
          l.total - COALESCE((SELECT SUM(rl.total) FROM commerce_return_lines rl WHERE rl.sale_line_id = l.id), 0),
          0
        )
      ) DESC`,
    db.branch.findMany({
      where: { isActive: true, ...(branch === null ? {} : { id: branch }) },
      select: { id: true, nameAr: true, code: true },
      orderBy: { code: "asc" },
    }),
  ]);

  let subtotalCents = 0n;
  let discountCents = 0n;
  let taxCents = 0n;
  let grossSalesCents = 0n;
  let returnedCents = 0n;
  let netSalesCents = 0n;
  let netCollectedCents = 0n;
  let refundedCents = 0n;
  let outstandingCents = 0n;
  let dueToCustomerCents = 0n;
  let returnedInvoicesCount = 0;
  let outstandingCount = 0;
  let settledCount = 0;
  let settledNetCents = 0n;
  let partiallyDueNetCents = 0n;

  const branchAgg = new Map<
    string,
    {
      branchName: string;
      branchCode: string;
      count: number;
      netSales: bigint;
      netCollected: bigint;
      outstanding: bigint;
      returned: bigint;
    }
  >();
  const staffAgg = new Map<
    string,
    {
      staffName: string;
      branchName: string;
      count: number;
      netSales: bigint;
      netCollected: bigint;
    }
  >();
  const customerAgg = new Map<
    string,
    { invoiced: bigint; collected: bigint; due: bigint; count: number }
  >();

  for (const row of salesRows) {
    const sub = toCents(row.subtotal);
    const disc = toCents(row.discount);
    const tax = toCents(row.taxTotal);
    const orig = toCents(row.total);
    const ret = toCents(row.returned);
    const col = toCents(row.collected);
    const ref = toCents(row.refunded);

    const netInv = orig - ret;
    const netCol = col - ref;
    const dueFrom = netInv > netCol ? netInv - netCol : 0n;
    const dueTo = netCol > netInv ? netCol - netInv : 0n;

    subtotalCents += sub;
    discountCents += disc;
    taxCents += tax;
    grossSalesCents += orig;
    returnedCents += ret;
    netSalesCents += netInv;
    netCollectedCents += netCol;
    refundedCents += ref;
    outstandingCents += dueFrom;
    dueToCustomerCents += dueTo;

    if (ret > 0n) returnedInvoicesCount += 1;
    if (dueFrom > 0n) {
      outstandingCount += 1;
      partiallyDueNetCents += netInv;
    } else {
      settledCount += 1;
      settledNetCents += netInv;
    }

    const bStat = branchAgg.get(row.branchId) ?? {
      branchName: row.branchName,
      branchCode: row.branchCode,
      count: 0,
      netSales: 0n,
      netCollected: 0n,
      outstanding: 0n,
      returned: 0n,
    };
    bStat.count += 1;
    bStat.netSales += netInv;
    bStat.netCollected += netCol;
    bStat.outstanding += dueFrom;
    bStat.returned += ret;
    branchAgg.set(row.branchId, bStat);

    const sStat = staffAgg.get(row.userId) ?? {
      staffName: row.staffName,
      branchName: row.branchName,
      count: 0,
      netSales: 0n,
      netCollected: 0n,
    };
    sStat.count += 1;
    sStat.netSales += netInv;
    sStat.netCollected += netCol;
    staffAgg.set(row.userId, sStat);

    const cKey = row.customerName.trim() || "عميل نقدي";
    const cStat = customerAgg.get(cKey) ?? {
      invoiced: 0n,
      collected: 0n,
      due: 0n,
      count: 0,
    };
    cStat.invoiced += netInv;
    cStat.collected += netCol;
    cStat.due += dueFrom;
    cStat.count += 1;
    customerAgg.set(cKey, cStat);
  }

  const invoiceCount = salesRows.length;
  const averageInvoiceCents =
    invoiceCount > 0 ? netSalesCents / BigInt(invoiceCount) : 0n;
  const collectionRatePct =
    netSalesCents > 0n
      ? Math.min(
          100,
          Math.max(0, Math.round((Number(netCollectedCents) / Number(netSalesCents)) * 1000) / 10),
        )
      : 100;

  // مقارنة الفترة السابقة
  let comparison: ExecutiveSalesAnalytics["comparison"] = null;
  if (period !== "all" && prevSummaryRows[0]) {
    const prevNetCents = toCents(prevSummaryRows[0].netSales);
    const prevCount = Number(prevSummaryRows[0].n ?? 0);
    const compLabel =
      period === "today"
        ? "مقارنةً بالأمس"
        : period === "7"
          ? "مقارنةً بالسبعة أيام السابقة"
          : "مقارنةً بالشهر الماضي";

    let growthPct: number | null = null;
    let direction: "up" | "down" | "flat" = "flat";
    if (prevNetCents > 0n) {
      growthPct =
        Math.round(
          ((Number(netSalesCents) - Number(prevNetCents)) / Number(prevNetCents)) * 1000,
        ) / 10;
      direction = growthPct > 0 ? "up" : growthPct < 0 ? "down" : "flat";
    } else if (netSalesCents > 0n) {
      direction = "up";
    }

    comparison = {
      label: compLabel,
      prevNetSalesFormatted: displayMoney(prevNetCents),
      prevInvoiceCount: prevCount,
      growthPct,
      direction,
    };
  }

  // تفصيل وسائل الدفع
  const colByMethod = new Map(
    collectionMethodRows.map((r) => [r.method, { cents: toCents(r.total), n: Number(r.n) }]),
  );
  const refByMethod = new Map(
    refundMethodRows.map((r) => [r.method, { cents: toCents(r.total), n: Number(r.n) }]),
  );
  const allMethodKeys = Array.from(
    new Set<string>([...ORDERED_METHODS, ...colByMethod.keys(), ...refByMethod.keys()]),
  );
  const paymentMethods: ExecutivePaymentMethodRow[] = allMethodKeys.map((m) => {
    const c = colByMethod.get(m)?.cents ?? 0n;
    const r = refByMethod.get(m)?.cents ?? 0n;
    const net = c - r;
    const count = (colByMethod.get(m)?.n ?? 0) + (refByMethod.get(m)?.n ?? 0);
    const sharePct =
      netCollectedCents > 0n && net > 0n
        ? Math.min(100, Math.round((Number(net) / Number(netCollectedCents)) * 1000) / 10)
        : 0;
    return {
      method: m,
      label: METHOD_LABELS[m as PaymentMethod] ?? m,
      collectedFormatted: displayMoney(c),
      refundedFormatted: displayMoney(r),
      netFormatted: displayMoney(net),
      netNum: Number(net) / 100,
      count,
      sharePct,
    };
  });

  // تفصيل الربحية والأصناف
  let stockRevenueCents = 0n;
  let stockCostCents = 0n;
  let catalogRevenueCents = 0n;
  const categoryAgg = new Map<string, { revenue: bigint; profit: bigint; lines: number }>();

  for (const l of lineRows) {
    const rev = toCents(l.netRevenue);
    const cost = toCents(l.netCost);
    if (l.isStock) {
      stockRevenueCents += rev;
      stockCostCents += cost;
    } else {
      catalogRevenueCents += rev;
    }
    const catName = (l.category ?? "").trim() || (l.isStock ? "أصناف مخزونية" : "خدمات وكتالوج");
    const cat = categoryAgg.get(catName) ?? { revenue: 0n, profit: 0n, lines: 0 };
    cat.revenue += rev;
    cat.profit += l.isStock ? rev - cost : 0n;
    cat.lines += Number(l.lines);
    categoryAgg.set(catName, cat);
  }

  const totalLineRevenueCents = stockRevenueCents + catalogRevenueCents;
  const stockProfitCents = stockRevenueCents - stockCostCents;
  const stockMarginPct =
    stockRevenueCents > 0n
      ? Math.round((Number(stockProfitCents) / Number(stockRevenueCents)) * 1000) / 10
      : 0;

  const topItems: ExecutiveTopItemRow[] = lineRows.slice(0, 20).map((l, idx) => {
    const rev = toCents(l.netRevenue);
    const cost = toCents(l.netCost);
    const prof = rev - cost;
    const qtyNum = Number(l.netQty);
    const sharePct =
      totalLineRevenueCents > 0n
        ? Math.round((Number(rev) / Number(totalLineRevenueCents)) * 1000) / 10
        : 0;
    const marginPct =
      l.isStock && rev > 0n ? Math.round((Number(prof) / Number(rev)) * 1000) / 10 : null;

    return {
      key: `${l.isStock ? "stock" : "cat"}-${idx}-${l.name}`,
      name: l.name,
      category: (l.category ?? "").trim() || "—",
      isStock: l.isStock,
      quantityFormatted: arMoney.format(qtyNum),
      quantityNum: qtyNum,
      lines: Number(l.lines),
      revenueFormatted: displayMoney(rev),
      revenueNum: Number(rev) / 100,
      sharePct,
      costFormatted: l.isStock ? displayMoney(cost) : null,
      profitFormatted: l.isStock ? displayMoney(prof) : null,
      profitNum: l.isStock ? Number(prof) / 100 : -Infinity,
      marginPct,
    };
  });

  // مقارنة أداء الفروع النشطة
  const branchPerformance: ExecutiveBranchRow[] = activeBranches
    .map((b) => {
      const stat = branchAgg.get(b.id.toString()) ?? {
        branchName: b.nameAr,
        branchCode: b.code,
        count: 0,
        netSales: 0n,
        netCollected: 0n,
        outstanding: 0n,
        returned: 0n,
      };
      const colPct =
        stat.netSales > 0n
          ? Math.min(100, Math.max(0, Math.round((Number(stat.netCollected) / Number(stat.netSales)) * 1000) / 10))
          : 100;
      const sharePct =
        netSalesCents > 0n && stat.netSales > 0n
          ? Math.min(100, Math.round((Number(stat.netSales) / Number(netSalesCents)) * 1000) / 10)
          : 0;
      return {
        branchId: b.id.toString(),
        branchName: b.nameAr,
        branchCode: b.code,
        invoiceCount: stat.count,
        netSalesFormatted: displayMoney(stat.netSales),
        netSalesNum: Number(stat.netSales) / 100,
        netCollectedFormatted: displayMoney(stat.netCollected),
        outstandingFormatted: displayMoney(stat.outstanding),
        outstandingNum: Number(stat.outstanding) / 100,
        returnedFormatted: displayMoney(stat.returned),
        collectionRatePct: colPct,
        sharePct,
      };
    })
    .sort((a, b) => b.netSalesNum - a.netSalesNum || b.invoiceCount - a.invoiceCount);

  // أداء موظفي المبيعات
  const staffPerformance: ExecutiveStaffRow[] = Array.from(staffAgg.entries())
    .map(([userId, s]) => {
      const avg = s.count > 0 ? s.netSales / BigInt(s.count) : 0n;
      const colPct =
        s.netSales > 0n
          ? Math.min(100, Math.max(0, Math.round((Number(s.netCollected) / Number(s.netSales)) * 1000) / 10))
          : 100;
      return {
        userId,
        staffName: s.staffName,
        branchName: s.branchName,
        invoiceCount: s.count,
        netSalesFormatted: displayMoney(s.netSales),
        netSalesNum: Number(s.netSales) / 100,
        netCollectedFormatted: displayMoney(s.netCollected),
        averageInvoiceFormatted: displayMoney(avg),
        collectionRatePct: colPct,
      };
    })
    .sort((a, b) => b.netSalesNum - a.netSalesNum || b.invoiceCount - a.invoiceCount);

  // مؤشر التحصيل وطرق الدفع للفترة المختارة
  const methodPoints: PantherChartPoint[] = paymentMethods.map((m) => ({
    label: `تحصيل ${m.label}`,
    shortLabel: m.label,
    value: Math.max(0, m.netNum),
    formattedValue: `${m.netFormatted} ج.م`,
    detail: `${arMoney.format(m.count)} حركة · ${arMoney.format(m.sharePct)}% من صافي المحصّل`,
  }));

  const periodCollectionsSeries: PantherChartSeries[] = [
    {
      id: "payment-methods",
      label: "طرق الدفع",
      points: methodPoints,
    },
    {
      id: "settlement-state",
      label: "موقف السداد",
      points: [
        {
          label: "فواتير مسدّدة بالكامل",
          shortLabel: "مسدّد",
          value: Number(settledNetCents) / 100,
          formattedValue: `${displayMoney(settledNetCents)} ج.م`,
          detail: `${arMoney.format(settledCount)} فاتورة مكتملة التحصيل`,
        },
        {
          label: "متبقٍّ على العملاء",
          shortLabel: "متبقٍ",
          value: Number(outstandingCents) / 100,
          formattedValue: `${displayMoney(outstandingCents)} ج.م`,
          secondaryValue: Number(partiallyDueNetCents) / 100,
          secondaryLabel: "صافي الفواتير",
          secondaryFormatted: `${displayMoney(partiallyDueNetCents)} ج.م`,
          detail: `${arMoney.format(outstandingCount)} فاتورة بانتظار التحصيل`,
        },
        {
          label: "مرتجعات الفترة",
          shortLabel: "مرتجع",
          value: Number(returnedCents) / 100,
          formattedValue: `${displayMoney(returnedCents)} ج.م`,
          detail: `${arMoney.format(returnedInvoicesCount)} فاتورة شملتها مرتجعات`,
        },
      ],
    },
  ];

  if (customerAgg.size > 0) {
    const custPoints: PantherChartPoint[] = Array.from(customerAgg.entries())
      .sort((a, b) => {
        if (b[1].due !== a[1].due) return b[1].due > a[1].due ? 1 : -1;
        return b[1].invoiced > a[1].invoiced ? 1 : -1;
      })
      .slice(0, 6)
      .map(([name, c], idx) => ({
        label: name,
        shortLabel: name.split(/\s+/).slice(0, 2).join(" ").slice(0, 12) || `#${idx + 1}`,
        value: Number(c.collected) / 100,
        formattedValue: `${displayMoney(c.collected)} ج.م`,
        secondaryValue: Number(c.due) / 100,
        secondaryLabel: "المتبقي",
        secondaryFormatted: `${displayMoney(c.due)} ج.م`,
        detail:
          c.due > 0n
            ? `متبقٍّ ${displayMoney(c.due)} ج.م (${c.count} فاتورة)`
            : `مسدّد بالكامل · ${c.count} فاتورة`,
      }));
    if (custPoints.length === 1) {
      custPoints.unshift({ label: "نقطة الأساس", shortLabel: "٠", value: 0, formattedValue: "0.00 ج.م" });
    }
    periodCollectionsSeries.push({
      id: "top-customers",
      label: "أعلى العملاء",
      points: custPoints,
    });
  }

  const collectionsSpotlight: CollectionsSpotlightData = {
    title: "التحصيل وطرق الدفع",
    subtitle: "محدّث الآن · توزيع التحصيل الفعلي والذمم في الفترة المختارة",
    pill: `${arMoney.format(collectionRatePct)}% تحصيل`,
    primary: {
      label: "صافي المحصّل الفعلي",
      value: displayMoney(netCollectedCents),
      unit: "ج.م",
      delta: `من صافي مبيعات ${displayMoney(netSalesCents)} ج.م بعد خصم المرتجعات`,
      tone: "positive",
    },
    secondary: {
      label: "المتبقي على العملاء",
      value: displayMoney(outstandingCents),
      unit: "ج.م",
      delta:
        outstandingCount > 0
          ? `${arMoney.format(outstandingCount)} فاتورة عليها رصيد بانتظار التحصيل`
          : "0 ذمم معلّقة في هذه الفترة",
      tone: outstandingCount > 0 ? "negative" : "positive",
    },
    series: periodCollectionsSeries,
    actionHref: "/sales",
    actionLabel: "متابعة سجل الفواتير والتحصيلات",
    details: EMPTY_COLLECTIONS_DETAILS,
  };

  // مؤشر الربحية وأداء الأصناف
  const stockProfitItems = topItems
    .filter((i) => i.isStock)
    .slice()
    .sort((a, b) => b.profitNum - a.profitNum)
    .slice(0, 6);

  const profitPoints: PantherChartPoint[] =
    stockProfitItems.length > 0
      ? stockProfitItems.map((item, idx) => ({
          label: item.name,
          shortLabel: item.name.slice(0, 11) || `#${idx + 1}`,
          value: Math.max(0, item.profitNum),
          formattedValue: `${item.profitFormatted ?? "0.00"} ج.م`,
          secondaryValue: item.revenueNum,
          secondaryLabel: "الإيراد",
          secondaryFormatted: `${item.revenueFormatted} ج.م`,
          detail: `هامش الربح ${arMoney.format(item.marginPct ?? 0)}% · الكمية ${item.quantityFormatted}`,
        }))
      : [
          { label: "بداية القياس", shortLabel: "٠", value: 0, formattedValue: "0.00 ج.م" },
          {
            label: "لا مبيعات مخزونية بعد",
            shortLabel: "الآن",
            value: 0,
            formattedValue: "0.00 ج.م",
            detail: "لم تُسجّل أصناف مخزونية بتكلفة في هذه الفترة",
          },
        ];
  if (profitPoints.length === 1) {
    profitPoints.unshift({ label: "نقطة الأساس", shortLabel: "٠", value: 0, formattedValue: "0.00 ج.م" });
  }

  const revenuePoints: PantherChartPoint[] =
    topItems.length > 0
      ? topItems.slice(0, 6).map((item, idx) => ({
          label: item.name,
          shortLabel: item.name.slice(0, 11) || `#${idx + 1}`,
          value: item.revenueNum,
          formattedValue: `${item.revenueFormatted} ج.م`,
          detail: `${arMoney.format(item.sharePct)}% من إيراد الفترة · الكمية ${item.quantityFormatted}`,
        }))
      : [
          { label: "بداية القياس", shortLabel: "٠", value: 0, formattedValue: "0.00 ج.م" },
          { label: "لا أصناف مباعة", shortLabel: "الآن", value: 0, formattedValue: "0.00 ج.م" },
        ];
  if (revenuePoints.length === 1) {
    revenuePoints.unshift({ label: "نقطة الأساس", shortLabel: "٠", value: 0, formattedValue: "0.00 ج.م" });
  }

  const profitabilitySeries: PantherChartSeries[] = [
    { id: "top-profit", label: "أعلى ربحًا", points: profitPoints },
    { id: "top-revenue", label: "أعلى إيرادًا", points: revenuePoints },
  ];

  if (categoryAgg.size > 0) {
    const catPoints: PantherChartPoint[] = Array.from(categoryAgg.entries())
      .sort((a, b) => (b[1].revenue > a[1].revenue ? 1 : -1))
      .slice(0, 6)
      .map(([catName, c], idx) => ({
        label: catName,
        shortLabel: catName.slice(0, 11) || `#${idx + 1}`,
        value: Number(c.revenue) / 100,
        formattedValue: `${displayMoney(c.revenue)} ج.م`,
        secondaryValue: Number(c.profit) / 100,
        secondaryLabel: "ربح المخزوني",
        secondaryFormatted: `${displayMoney(c.profit)} ج.م`,
        detail: `${arMoney.format(c.lines)} سطر بيع في التصنيف`,
      }));
    if (catPoints.length === 1) {
      catPoints.unshift({ label: "نقطة الأساس", shortLabel: "٠", value: 0, formattedValue: "0.00 ج.م" });
    }
    profitabilitySeries.push({ id: "by-category", label: "حسب التصنيف", points: catPoints });
  }

  const profitabilitySpotlight: CollectionsSpotlightData = {
    title: "الربحية وأداء الأصناف",
    subtitle: "محدّث الآن · ربح الأصناف المخزونية ومساهمة الكتالوج الفني",
    pill: `هامش ${arMoney.format(stockMarginPct)}%`,
    primary: {
      label: "ربح الأصناف المخزونية",
      value: displayMoney(stockProfitCents),
      unit: "ج.م",
      delta: `إيراد مخزوني ${displayMoney(stockRevenueCents)} ج.م − تكلفة ${displayMoney(stockCostCents)} ج.م`,
      tone: stockProfitCents >= 0n ? "positive" : "negative",
    },
    secondary: {
      label: "إيراد الكتالوج الفني",
      value: displayMoney(catalogRevenueCents),
      unit: "ج.م",
      delta:
        catalogRevenueCents > 0n
          ? "أصناف فنية بلا تكلفة مخزونية مسجّلة (تُعرض مستقلة)"
          : "جميع مبيعات الفترة من الأصناف المخزونية المسعّرة بالتكلفة",
      tone: "positive",
    },
    series: profitabilitySeries,
    actionHref: "#top-items-section",
    actionLabel: "استعراض جدول الأصناف والهوامش",
    details: EMPTY_COLLECTIONS_DETAILS,
  };

  return {
    invoiceCount,
    cancelledCount,
    returnedInvoicesCount,
    outstandingCount,
    subtotalFormatted: displayMoney(subtotalCents),
    discountFormatted: displayMoney(discountCents),
    grossSalesFormatted: displayMoney(grossSalesCents),
    returnedFormatted: displayMoney(returnedCents),
    returnedNum: Number(returnedCents) / 100,
    netSalesFormatted: displayMoney(netSalesCents),
    netSalesNum: Number(netSalesCents) / 100,
    taxFormatted: displayMoney(taxCents),
    averageInvoiceFormatted: displayMoney(averageInvoiceCents),
    netCollectedFormatted: displayMoney(netCollectedCents),
    netCollectedNum: Number(netCollectedCents) / 100,
    refundedFormatted: displayMoney(refundedCents),
    collectionRatePct,
    outstandingFormatted: displayMoney(outstandingCents),
    outstandingNum: Number(outstandingCents) / 100,
    dueToCustomerFormatted: displayMoney(dueToCustomerCents),
    dueToCustomerNum: Number(dueToCustomerCents) / 100,
    stockRevenueFormatted: displayMoney(stockRevenueCents),
    stockCostFormatted: displayMoney(stockCostCents),
    stockProfitFormatted: displayMoney(stockProfitCents),
    stockProfitNum: Number(stockProfitCents) / 100,
    stockMarginPct,
    catalogRevenueFormatted: displayMoney(catalogRevenueCents),
    catalogRevenueNum: Number(catalogRevenueCents) / 100,
    comparison,
    paymentMethods,
    branchPerformance,
    staffPerformance,
    topItems,
    collectionsSpotlight,
    profitabilitySpotlight,
  };
}
