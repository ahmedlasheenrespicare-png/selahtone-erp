import { Prisma, type PrismaClient } from "@prisma/client";

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
      WHEN 'today' THEN (CURRENT_DATE AT TIME ZONE 'Africa/Cairo')
      WHEN '7' THEN (CURRENT_DATE AT TIME ZONE 'Africa/Cairo') - INTERVAL '7 days'
      WHEN 'month' THEN (date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo')
      ELSE '-infinity'::timestamptz
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
    db.commerceSale.count({ where: { ...salesWhere, createdAt: { gte: start }, NOT: { cancelledAt: null } } }),
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
