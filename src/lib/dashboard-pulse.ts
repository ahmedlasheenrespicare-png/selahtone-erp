import type { PrismaClient } from "@prisma/client";
import { displayMoney, METHOD_LABELS } from "@/lib/commerce-display";
import type { PaymentMethod } from "@/lib/commerce-validation";

const arNum = new Intl.NumberFormat("ar-EG-u-nu-latn", {
  maximumFractionDigits: 2,
});

function toCents(value: string): bigint {
  const negative = value.trim().startsWith("-");
  const [whole = "0", fraction = ""] = value.replace("-", "").split(".");
  return (
    (negative ? -1n : 1n) *
    (BigInt(whole || "0") * 100n + BigInt((fraction + "00").slice(0, 2) || "0"))
  );
}

export type DashboardActivityItem = {
  key: string;
  kind: "sale" | "collection" | "expense" | "settlement";
  title: string;
  subtitle: string;
  amountFormatted: string;
  statusLabel: string;
  tone: "positive" | "warning" | "neutral";
  timestampMs: number;
  timestampIso: string;
  href: string;
};

export type DashboardStockAlertItem = {
  key: string;
  productName: string;
  sku: string;
  warehouseName: string;
  warehouseCode: string;
  branchName: string;
  qtyFormatted: string;
  isZero: boolean;
};

export type DashboardBranchHealthItem = {
  branchId: string;
  branchName: string;
  branchCode: string;
  city: string | null;
  warehouseCodes: string[];
  usersCount: number;
  todaySalesFormatted: string;
  todaySalesNum: number;
  todayInvoicesCount: number;
  outstandingFormatted: string;
  outstandingNum: number;
  outstandingCount: number;
};

export type DashboardTodayInvoiceLine = {
  name: string;
  quantityFormatted: string;
  totalFormatted: string;
};

export type DashboardTodayInvoiceItem = {
  key: string;
  saleId: string;
  customerName: string;
  branchName: string;
  staffName: string;
  lines: DashboardTodayInvoiceLine[];
  extraLinesCount: number;
  totalFormatted: string;
  remainingFormatted: string;
  badge: "paid" | "credit" | "cancelled";
  timestampMs: number;
  timestampIso: string;
};

export type DashboardTodaySplitRow = {
  key: string;
  saleId: string;
  customerName: string;
  staffName: string;
  method: string;
  methodLabel: string;
  amountFormatted: string;
  invoiceTotalFormatted: string;
  remainingFormatted: string;
  hasRemaining: boolean;
  timestampMs: number;
  timestampIso: string;
  /** فاتورة قديمة (نشأت قبل اليوم) تحصّل منها اليوم — تظهر بشارة «قديمة» داخل أقسام الوسائل */
  isOldInvoice?: boolean;
  /** عدد الأيام منذ صدور الفاتورة (فقط للفواتير القديمة) */
  invoiceAgeDays?: number;
  /** تاريخ الفاتورة الأصلية (ISO) — فقط للفواتير القديمة */
  issuedAtIso?: string;
};

export type DashboardTodaySplitSection = {
  method: string;
  label: string;
  totalFormatted: string;
  /** مجموع المبالغ الخام (بقدرات) بعد خصم مرتجعات الوسيلة — للرسم البياني في بطاقة تحصيلات اليوم */
  totalCents: bigint;
  invoiceCount: number;
  rows: DashboardTodaySplitRow[];
};

/** تحصيل اليوم على ذمة قديمة: فاتورة أُنشئت قبل اليوم وذمتها كانت مفتوحة عند بدء اليوم. */
/** صف خام من استعلام «تحصيلات اليوم على فواتير قديمة» */
export type DashboardTodayOldInvoiceRow = {
  id: string;
  customerName: string;
  branchName: string;
  collectorName: string;
  issuedAt: Date;
  total: string;
  collected: string;
  refunded: string;
  lastAt: Date;
  remainingBefore: string;
  remainingAfter: string;
};

export type DashboardTodayOldInvoiceItem = {
  key: string;
  saleId: string;
  customerName: string;
  branchName: string;
  collectorName: string;
  issuedAtIso: string;
  /** عدد الأيام منذ صدور الفاتورة (بحد أدنى ١) */
  ageDays: number;
  totalFormatted: string;
  /** صافي المحصّل اليوم على هذه الفاتورة (إجمالي محصّلات اليوم − مرتجعاتها) */
  collectedTodayFormatted: string;
  remainingBeforeFormatted: string;
  remainingAfterFormatted: string;
  /** هل سدّد تحصيل اليوم ذمتها بالكامل؟ */
  cleared: boolean;
  /** «نقدي 150.00 + بطاقة 100.00» (صافيًا بعد المرتجعات) */
  methodBreakdown: string;
  timestampMs: number;
  timestampIso: string;
};

export type DashboardTodayRefundItem = {
  key: string;
  saleId: string;
  customerName: string;
  staffName: string;
  method: string;
  methodLabel: string;
  amountFormatted: string;
  timestampMs: number;
  timestampIso: string;
};

export type DashboardOperationalPulse = {
  todayNetSalesFormatted: string;
  todayNetSalesNum: number;
  todayInvoicesCount: number;
  yesterdayNetSalesFormatted: string;
  todayGrowthPct: number | null;
  todayGrowthDirection: "up" | "down" | "flat";
  todayNetCollectedFormatted: string;
  todayCashCollectedFormatted: string;
  todayElectronicCollectedFormatted: string;
  outOfStockCount: number;
  lowStockTotalCount: number;
  lowStockItems: DashboardStockAlertItem[];
  branchHealth: DashboardBranchHealthItem[];
  recentCommerceEvents: DashboardActivityItem[];
  todayInvoicesList: DashboardTodayInvoiceItem[];
  todaySplitSections: DashboardTodaySplitSection[];
  todaySplitDistinctInvoices: number;
  todayRemainingFormatted: string;
  todayRemainingCount: number;
  todayRefundsList: DashboardTodayRefundItem[];
  todayRefundsTotalFormatted: string;
  /** تحصيلات اليوم على فواتير آجلة قديمة (نشأت قبل اليوم وذمتها كانت مفتوحة) */
  todayOldInvoiceCollections: DashboardTodayOldInvoiceItem[];
  /** صافي ما تحصّل اليوم على الذمم القديمة، مُنسّقًا (ج.م) */
  todayOldCollectedTotalFormatted: string;
  todayRefundsMovesCount: number;
  /** إجمالي المتبقي على العملاء الآن (غير الملغى: بعد المرتجعات ثم بعد صافي التحصيلات) */
  outstandingTotalFormatted: string;
  /** نسبة تغيّر المتبقي مقابل رصيد بداية اليوم بتوقيت القاهرة؛ null عند انعدام متبقّي اليوم-السابق */
  outstandingChangePct: number | null;
  outstandingChangeDirection: "up" | "down" | "flat";
};

export async function loadDashboardOperationalData(
  db: PrismaClient,
  opts: {
    branchId: string | null;
    branches: Array<{
      id: string;
      nameAr: string;
      code: string;
      city: string | null;
      warehouseCodes: string[];
      usersCount: number;
    }>;
  },
): Promise<DashboardOperationalPulse> {
  const branch = opts.branchId === null ? null : BigInt(opts.branchId);

  const bounds = await db.$queryRaw<
    Array<{ todayStart: Date; yesterdayStart: Date }>
  >`
    SELECT
      (DATE_TRUNC('day', NOW() AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo') AS "todayStart",
      (DATE_TRUNC('day', NOW() AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo') - INTERVAL '1 day' AS "yesterdayStart"`;

  const todayStart = bounds[0].todayStart;
  const yesterdayStart = bounds[0].yesterdayStart;

  const [
    todaySalesRows,
    yesterdaySalesRows,
    todayColRows,
    todayRefRows,
    branchOutstandingRows,
    lowStockRows,
    lowStockCountsRows,
    recentSalesRows,
    recentCollectionsRows,
    todayInvoiceRows,
    todayInvoiceLineRows,
    todaySplitCollectionRows,
    todaySplitRefundRows,
    todayRefundDetailRows,
    oldSettledInvoiceRows,
    outstandingNetRows,
  ] = await Promise.all([
    db.$queryRaw<
      Array<{ branchId: string; netSales: string; n: number }>
    >`
      SELECT
        s.branch_id::text AS "branchId",
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
        AND s.created_at >= ${todayStart}::timestamptz
      GROUP BY s.branch_id`,
    db.$queryRaw<Array<{ netSales: string; n: number }>>`
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
        AND s.created_at >= ${yesterdayStart}::timestamptz
        AND s.created_at < ${todayStart}::timestamptz`,
    db.$queryRaw<Array<{ method: string; total: string; n: number }>>`
      SELECT
        c.method AS method,
        COALESCE(SUM(c.amount), 0)::text AS total,
        COUNT(*)::int AS n
      FROM commerce_collections c
      JOIN commerce_sales s ON s.id = c.sale_id
      WHERE s.cancelled_at IS NULL
        AND (${branch}::bigint IS NULL OR s.branch_id = ${branch}::bigint)
        AND c.created_at >= ${todayStart}::timestamptz
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
        AND rf.created_at >= ${todayStart}::timestamptz
      GROUP BY rf.method`,
    db.$queryRaw<Array<{ branchId: string; total: string; n: number }>>`
      SELECT
        x."branchId" AS "branchId",
        COALESCE(SUM(x.due), 0)::text AS total,
        COUNT(*)::int AS n
      FROM (
        SELECT
          s.branch_id::text AS "branchId",
          GREATEST(
            s.total
            - COALESCE((SELECT SUM(rl.total) FROM commerce_return_lines rl JOIN commerce_returns r ON r.id = rl.return_id WHERE r.sale_id = s.id), 0)
            - (
                COALESCE((SELECT SUM(c.amount) FROM commerce_collections c WHERE c.sale_id = s.id), 0)
                - COALESCE((SELECT SUM(rf.amount) FROM commerce_refunds rf WHERE rf.sale_id = s.id), 0)
              ),
            0
          ) AS due
        FROM commerce_sales s
        WHERE s.cancelled_at IS NULL
          AND (${branch}::bigint IS NULL OR s.branch_id = ${branch}::bigint)
      ) x
      WHERE x.due > 0
      GROUP BY x."branchId"`,
    db.$queryRaw<
      Array<{
        stockId: string;
        productName: string;
        sku: string;
        warehouseName: string;
        warehouseCode: string;
        branchName: string;
        qty: string;
      }>
    >`
      SELECT
        sl.id::text AS "stockId",
        p.name_ar AS "productName",
        p.sku AS sku,
        w.name_ar AS "warehouseName",
        w.code AS "warehouseCode",
        b.name_ar AS "branchName",
        sl.qty_on_hand::text AS qty
      FROM stock_levels sl
      JOIN products p ON p.id = sl.product_id
      JOIN warehouses w ON w.id = sl.warehouse_id
      JOIN branches b ON b.id = w.branch_id
      WHERE p.is_active = true
        AND p.category != 'SERVICE'
        AND w.is_active = true
        AND w.holds_stock = true
        AND b.is_active = true
        AND (${branch}::bigint IS NULL OR w.branch_id = ${branch}::bigint)
        AND sl.qty_on_hand <= 2
      ORDER BY sl.qty_on_hand ASC, p.name_ar ASC
      LIMIT 6`,
    db.$queryRaw<Array<{ zeroCount: number; lowTotalCount: number }>>`
      SELECT
        COUNT(*) FILTER (WHERE sl.qty_on_hand <= 0)::int AS "zeroCount",
        COUNT(*)::int AS "lowTotalCount"
      FROM stock_levels sl
      JOIN products p ON p.id = sl.product_id
      JOIN warehouses w ON w.id = sl.warehouse_id
      JOIN branches b ON b.id = w.branch_id
      WHERE p.is_active = true
        AND p.category != 'SERVICE'
        AND w.is_active = true
        AND w.holds_stock = true
        AND b.is_active = true
        AND (${branch}::bigint IS NULL OR w.branch_id = ${branch}::bigint)
        AND sl.qty_on_hand <= 2`,
    db.$queryRaw<
      Array<{
        id: string;
        customerName: string;
        branchName: string;
        staffName: string;
        total: string;
        cancelled: boolean;
        createdAt: Date;
      }>
    >`
      SELECT
        s.id::text AS id,
        s.customer_name AS "customerName",
        b.name_ar AS "branchName",
        u.full_name AS "staffName",
        s.total::text AS total,
        (s.cancelled_at IS NOT NULL) AS cancelled,
        s.created_at AS "createdAt"
      FROM commerce_sales s
      JOIN branches b ON b.id = s.branch_id
      JOIN users u ON u.id = s.created_by_id
      WHERE (${branch}::bigint IS NULL OR s.branch_id = ${branch}::bigint)
      ORDER BY s.created_at DESC, s.id DESC
      LIMIT 6`,
    db.$queryRaw<
      Array<{
        id: string;
        saleId: string;
        customerName: string;
        branchName: string;
        staffName: string;
        amount: string;
        method: string;
        createdAt: Date;
      }>
    >`
      SELECT
        c.id::text AS id,
        c.sale_id::text AS "saleId",
        s.customer_name AS "customerName",
        b.name_ar AS "branchName",
        u.full_name AS "staffName",
        c.amount::text AS amount,
        c.method AS method,
        c.created_at AS "createdAt"
      FROM commerce_collections c
      JOIN commerce_sales s ON s.id = c.sale_id
      JOIN branches b ON b.id = s.branch_id
      JOIN users u ON u.id = c.created_by_id
      WHERE c.is_initial = false
        AND s.cancelled_at IS NULL
        AND (${branch}::bigint IS NULL OR s.branch_id = ${branch}::bigint)
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT 5`,
    db.$queryRaw<
      Array<{
        id: string;
        customerName: string;
        branchName: string;
        staffName: string;
        total: string;
        cancelled: boolean;
        remaining: string;
        createdAt: Date;
      }>
    >`
      SELECT
        s.id::text AS id,
        s.customer_name AS "customerName",
        b.name_ar AS "branchName",
        u.full_name AS "staffName",
        s.total::text AS total,
        (s.cancelled_at IS NOT NULL) AS cancelled,
        GREATEST(
          s.total
          - COALESCE((SELECT SUM(rl.total) FROM commerce_return_lines rl
                     JOIN commerce_returns r ON r.id = rl.return_id
                     WHERE r.sale_id = s.id), 0)
          - (
              COALESCE((SELECT SUM(c.amount) FROM commerce_collections c WHERE c.sale_id = s.id), 0)
              - COALESCE((SELECT SUM(rf.amount) FROM commerce_refunds rf WHERE rf.sale_id = s.id), 0)
            ),
          0
        )::text AS remaining,
        s.created_at AS "createdAt"
      FROM commerce_sales s
      JOIN branches b ON b.id = s.branch_id
      JOIN users u ON u.id = s.created_by_id
      WHERE (${branch}::bigint IS NULL OR s.branch_id = ${branch}::bigint)
        AND s.created_at >= ${todayStart}::timestamptz
      ORDER BY s.created_at DESC, s.id DESC`,
    db.$queryRaw<
      Array<{
        saleId: string;
        nameSnapshot: string;
        quantity: string;
        total: string;
      }>
    >`
      SELECT
        l.sale_id::text AS "saleId",
        l.name_snapshot AS "nameSnapshot",
        l.quantity::text AS quantity,
        l.total::text AS total
      FROM commerce_sale_lines l
      JOIN commerce_sales s ON s.id = l.sale_id
      WHERE (${branch}::bigint IS NULL OR s.branch_id = ${branch}::bigint)
        AND s.created_at >= ${todayStart}::timestamptz
      ORDER BY l.sale_id, l.id`,
    db.$queryRaw<Array<{ saleId: string; method: string; collected: string }>>`
      SELECT
        c.sale_id::text AS "saleId",
        c.method AS method,
        COALESCE(SUM(c.amount), 0)::text AS collected
      FROM commerce_collections c
      JOIN commerce_sales s ON s.id = c.sale_id
      WHERE s.cancelled_at IS NULL
        AND (${branch}::bigint IS NULL OR s.branch_id = ${branch}::bigint)
        AND c.created_at >= ${todayStart}::timestamptz
      GROUP BY c.sale_id, c.method`,
    db.$queryRaw<Array<{ saleId: string; method: string; refunded: string }>>`
      SELECT
        rf.sale_id::text AS "saleId",
        rf.method AS method,
        COALESCE(SUM(rf.amount), 0)::text AS refunded
      FROM commerce_refunds rf
      JOIN commerce_sales s ON s.id = rf.sale_id
      WHERE s.cancelled_at IS NULL
        AND (${branch}::bigint IS NULL OR s.branch_id = ${branch}::bigint)
        AND rf.created_at >= ${todayStart}::timestamptz
      GROUP BY rf.sale_id, rf.method`,
    db.$queryRaw<
      Array<{
        id: string;
        saleId: string;
        customerName: string;
        staffName: string;
        method: string;
        amount: string;
        createdAt: Date;
      }>
    >`
      SELECT
        rf.id::text AS id,
        rf.sale_id::text AS "saleId",
        s.customer_name AS "customerName",
        u.full_name AS "staffName",
        rf.method AS method,
        rf.amount::text AS amount,
        rf.created_at AS "createdAt"
      FROM commerce_refunds rf
      JOIN commerce_sales s ON s.id = rf.sale_id
      JOIN users u ON u.id = rf.created_by_id
      WHERE s.cancelled_at IS NULL
        AND (${branch}::bigint IS NULL OR s.branch_id = ${branch}::bigint)
        AND rf.created_at >= ${todayStart}::timestamptz
      ORDER BY rf.created_at DESC, rf.id DESC`,
    db.$queryRaw<DashboardTodayOldInvoiceRow[]>`
      WITH net AS (
        SELECT c.sale_id,
               COALESCE(SUM(c.amount), 0) AS collected,
               MAX(c.created_at) AS "lastAt",
               (ARRAY_AGG(c.created_by_id ORDER BY c.created_at DESC, c.id DESC))[1] AS "collectorId"
        FROM commerce_collections c
        JOIN commerce_sales s ON s.id = c.sale_id
        WHERE s.cancelled_at IS NULL
          AND (${branch}::bigint IS NULL OR s.branch_id = ${branch}::bigint)
          AND c.created_at >= ${todayStart}::timestamptz
        GROUP BY c.sale_id
      ),
      ref AS (
        SELECT rf.sale_id, COALESCE(SUM(rf.amount), 0) AS refunded
        FROM commerce_refunds rf
        JOIN commerce_sales s ON s.id = rf.sale_id
        WHERE s.cancelled_at IS NULL
          AND (${branch}::bigint IS NULL OR s.branch_id = ${branch}::bigint)
          AND rf.created_at >= ${todayStart}::timestamptz
        GROUP BY rf.sale_id
      ),
      coll_before AS (
        SELECT c.sale_id, COALESCE(SUM(c.amount), 0) AS before_amt
        FROM commerce_collections c
        WHERE c.created_at < ${todayStart}::timestamptz
        GROUP BY c.sale_id
      ),
      ref_before AS (
        SELECT rf.sale_id, COALESCE(SUM(rf.amount), 0) AS before_amt
        FROM commerce_refunds rf
        WHERE rf.created_at < ${todayStart}::timestamptz
        GROUP BY rf.sale_id
      ),
      rets AS (
        SELECT r.sale_id, COALESCE(SUM(rl.total), 0) AS returned
        FROM commerce_return_lines rl
        JOIN commerce_returns r ON r.id = rl.return_id
        GROUP BY r.sale_id
      )
      SELECT
        s.id::text AS id,
        s.customer_name AS "customerName",
        b.name_ar AS "branchName",
        u.full_name AS "collectorName",
        s.created_at AS "issuedAt",
        s.total::text AS total,
        net.collected::text AS collected,
        COALESCE(ref.refunded, 0)::text AS refunded,
        net."lastAt" AS "lastAt",
        GREATEST(s.total - COALESCE(rets.returned, 0) - (COALESCE(coll_before.before_amt, 0) - COALESCE(ref_before.before_amt, 0)), 0)::text AS "remainingBefore",
        GREATEST(s.total - COALESCE(rets.returned, 0) - (COALESCE(coll_before.before_amt, 0) + net.collected - COALESCE(ref_before.before_amt, 0) - COALESCE(ref.refunded, 0)), 0)::text AS "remainingAfter"
      FROM net
      JOIN commerce_sales s ON s.id = net.sale_id
      JOIN branches b ON b.id = s.branch_id
      JOIN users u ON u.id = net."collectorId"
      LEFT JOIN ref ON ref.sale_id = s.id
      LEFT JOIN coll_before ON coll_before.sale_id = s.id
      LEFT JOIN ref_before ON ref_before.sale_id = s.id
      LEFT JOIN rets ON rets.sale_id = s.id
      WHERE s.created_at < ${todayStart}::timestamptz
        AND GREATEST(s.total - COALESCE(rets.returned, 0) - (COALESCE(coll_before.before_amt, 0) - COALESCE(ref_before.before_amt, 0)), 0) > 0
      ORDER BY net."lastAt" DESC, s.id DESC`,
    db.$queryRaw<Array<{ nowTotal: string; prevTotal: string }>>`
      WITH base AS (
        SELECT
          s.id AS sale_id,
          s.total,
          GREATEST(COALESCE((
            SELECT SUM(rl.total) FROM commerce_return_lines rl JOIN commerce_returns r ON r.id = rl.return_id
            WHERE r.sale_id = s.id), 0), 0) AS returned_all,
          GREATEST(COALESCE((
            SELECT SUM(rl.total) FROM commerce_return_lines rl JOIN commerce_returns r ON r.id = rl.return_id
            WHERE r.sale_id = s.id AND r.created_at < ${todayStart}::timestamptz), 0), 0) AS returned_prev,
          GREATEST(COALESCE((SELECT SUM(c.amount) FROM commerce_collections c WHERE c.sale_id = s.id), 0), 0) AS collected_all,
          GREATEST(COALESCE((SELECT SUM(c.amount) FROM commerce_collections c WHERE c.sale_id = s.id AND c.created_at < ${todayStart}::timestamptz), 0), 0) AS collected_prev,
          GREATEST(COALESCE((SELECT SUM(rf.amount) FROM commerce_refunds rf WHERE rf.sale_id = s.id), 0), 0) AS refunded_all,
          GREATEST(COALESCE((SELECT SUM(rf.amount) FROM commerce_refunds rf WHERE rf.sale_id = s.id AND rf.created_at < ${todayStart}::timestamptz), 0), 0) AS refunded_prev
        FROM commerce_sales s
        WHERE s.cancelled_at IS NULL
          AND (${branch}::bigint IS NULL OR s.branch_id = ${branch}::bigint)
      )
      SELECT
        COALESCE(SUM(GREATEST(0, total - returned_all - (collected_all - refunded_all))), 0)::text AS "nowTotal",
        COALESCE(SUM(GREATEST(0, total - returned_prev - (collected_prev - refunded_prev))), 0)::text AS "prevTotal"
      FROM base`,
  ]);

  let todayNetSalesCents = 0n;
  let todayInvoicesCount = 0;
  const todayByBranch = new Map<string, { cents: bigint; count: number }>();
  for (const r of todaySalesRows) {
    const c = toCents(r.netSales);
    todayNetSalesCents += c;
    todayInvoicesCount += Number(r.n);
    todayByBranch.set(r.branchId, { cents: c, count: Number(r.n) });
  }

  const yesterdayNetSalesCents = toCents(yesterdaySalesRows[0]?.netSales ?? "0");
  let todayGrowthPct: number | null = null;
  let todayGrowthDirection: "up" | "down" | "flat" = "flat";
  if (yesterdayNetSalesCents > 0n) {
    todayGrowthPct =
      Math.round(
        ((Number(todayNetSalesCents) - Number(yesterdayNetSalesCents)) /
          Number(yesterdayNetSalesCents)) *
          1000,
      ) / 10;
    todayGrowthDirection =
      todayGrowthPct > 0 ? "up" : todayGrowthPct < 0 ? "down" : "flat";
  } else if (todayNetSalesCents > 0n) {
    todayGrowthDirection = "up";
  }

  let todayCashCents = 0n;
  let todayElecCents = 0n;
  for (const r of todayColRows) {
    const c = toCents(r.total);
    if (r.method === "CASH") todayCashCents += c;
    else todayElecCents += c;
  }
  let todayRefundsCents = 0n;
  let todayRefundsMovesCount = 0;
  for (const r of todayRefRows) {
    const c = toCents(r.total);
    todayRefundsCents += c;
    todayRefundsMovesCount += Number(r.n);
    if (r.method === "CASH") todayCashCents -= c;
    else todayElecCents -= c;
  }
  const todayNetCollectedCents = todayCashCents + todayElecCents;

  const outByBranch = new Map<string, { cents: bigint; count: number }>();
  for (const r of branchOutstandingRows) {
    outByBranch.set(r.branchId, { cents: toCents(r.total), count: Number(r.n) });
  }

  const branchHealth: DashboardBranchHealthItem[] = opts.branches.map((b) => {
    const t = todayByBranch.get(b.id) ?? { cents: 0n, count: 0 };
    const o = outByBranch.get(b.id) ?? { cents: 0n, count: 0 };
    return {
      branchId: b.id,
      branchName: b.nameAr,
      branchCode: b.code,
      city: b.city,
      warehouseCodes: b.warehouseCodes,
      usersCount: b.usersCount,
      todaySalesFormatted: displayMoney(t.cents),
      todaySalesNum: Number(t.cents) / 100,
      todayInvoicesCount: t.count,
      outstandingFormatted: displayMoney(o.cents),
      outstandingNum: Number(o.cents) / 100,
      outstandingCount: o.count,
    };
  });

  const lowStockItems: DashboardStockAlertItem[] = lowStockRows.map((r) => {
    const qtyNum = Number(r.qty);
    return {
      key: `stock-${r.stockId}`,
      productName: r.productName,
      sku: r.sku,
      warehouseName: r.warehouseName,
      warehouseCode: r.warehouseCode,
      branchName: r.branchName,
      qtyFormatted: arNum.format(qtyNum),
      isZero: qtyNum <= 0,
    };
  });

  const linesBySale = new Map<string, DashboardTodayInvoiceLine[]>();
  for (const r of todayInvoiceLineRows) {
    const line: DashboardTodayInvoiceLine = {
      name: r.nameSnapshot,
      quantityFormatted: arNum.format(Number(r.quantity)),
      totalFormatted: displayMoney(toCents(r.total)),
    };
    const bucket = linesBySale.get(r.saleId);
    if (bucket) bucket.push(line);
    else linesBySale.set(r.saleId, [line]);
  }

  const todayInvoicesList: DashboardTodayInvoiceItem[] = todayInvoiceRows.map((r) => {
    const allLines = linesBySale.get(r.id) ?? [];
    return {
      key: `today-inv-${r.id}`,
      saleId: r.id,
      customerName: r.customerName,
      branchName: r.branchName,
      staffName: r.staffName,
      lines: allLines,
      extraLinesCount: 0,
      totalFormatted: displayMoney(toCents(r.total)),
      remainingFormatted: displayMoney(toCents(r.remaining)),
      badge: r.cancelled ? "cancelled" : toCents(r.remaining) > 0n ? "credit" : "paid",
      timestampMs: r.createdAt.getTime(),
      timestampIso: r.createdAt.toISOString(),
    };
  });

  // المتبقي على فواتير اليوم (الملغاة لا تُحتسب) + توزيع تحصيلات اليوم حسب (الفاتورة × الوسيلة)
  let todayRemainingCents = 0n;
  let todayRemainingCount = 0;
  for (const r of todayInvoiceRows) {
    if (r.cancelled) continue;
    const due = toCents(r.remaining);
    todayRemainingCents += due;
    if (due > 0n) todayRemainingCount += 1;
  }

  const METHOD_ORDER = ["CASH", "CARD", "BANK_TRANSFER", "WALLET"] as const;
  const netBySaleAndMethod = new Map<string, Map<string, bigint>>();
  const addNet = (saleId: string, method: string, cents: bigint) => {
    const perSale = netBySaleAndMethod.get(saleId) ?? new Map<string, bigint>();
    perSale.set(method, (perSale.get(method) ?? 0n) + cents);
    netBySaleAndMethod.set(saleId, perSale);
  };
  for (const r of todaySplitCollectionRows) addNet(r.saleId, r.method, toCents(r.collected));
  for (const r of todaySplitRefundRows) addNet(r.saleId, r.method, -toCents(r.refunded));

  // فواتير قديمة (قبل اليوم) تحصّل منها اليوم وكانت ذمتها مفتوحة — مصدر لقسم «تحصيلات فواتير قديمة اليوم» والشارات داخل أقسام الوسائل
  type OldInvoiceMetaEntry = {
    customerName: string;
    collectorName: string;
    branchName: string;
    issuedAtIso: string;
    ageDays: number;
    totalCents: bigint;
    collectedTodayCents: bigint;
    remainingBeforeCents: bigint;
    remainingAfterCents: bigint;
    lastAtMs: number;
    lastAtIso: string;
  };
  const MS_PER_DAY = 86_400_000;
  const oldInvoiceMetaById = new Map<string, OldInvoiceMetaEntry>(
    oldSettledInvoiceRows.map((r: DashboardTodayOldInvoiceRow) => [
      r.id,
      {
        customerName: r.customerName,
        collectorName: r.collectorName,
        branchName: r.branchName,
        issuedAtIso: r.issuedAt.toISOString(),
        ageDays: Math.max(1, Math.floor((todayStart.getTime() - r.issuedAt.getTime()) / MS_PER_DAY)),
        totalCents: toCents(r.total),
        collectedTodayCents: toCents(r.collected) - toCents(r.refunded),
        remainingBeforeCents: toCents(r.remainingBefore),
        remainingAfterCents: toCents(r.remainingAfter),
        lastAtMs: r.lastAt.getTime(),
        lastAtIso: r.lastAt.toISOString(),
      },
    ]),
  );

  const todayInvoiceById = new Map(todayInvoiceRows.map((r) => [r.id, r]));
  const rowsByMethod = new Map<string, DashboardTodaySplitRow[]>();
  const totalsByMethod = new Map<string, bigint>();
  for (const method of METHOD_ORDER) {
    rowsByMethod.set(method, []);
    totalsByMethod.set(method, 0n);
  }
  const splitSaleIds = new Set<string>();
  for (const [saleId, perMethod] of netBySaleAndMethod) {
    const invoice = todayInvoiceById.get(saleId);
    const oldMeta = oldInvoiceMetaById.get(saleId);
    // فواتير اليوم موجودة في مجموعة بطاقتي اليوم؛ القدامى المسموحون يُعلَّمون بشارة «قديمة»؛ والباقي (ملغاة) يُستبعد
    if (!invoice && !oldMeta) continue;
    const rowBase = invoice
      ? (() => {
          const remainingCents = invoice.cancelled ? 0n : toCents(invoice.remaining);
          return {
            customerName: invoice.customerName,
            staffName: invoice.staffName,
            invoiceTotalFormatted: displayMoney(toCents(invoice.total)),
            remainingFormatted: displayMoney(remainingCents),
            hasRemaining: remainingCents > 0n,
            isOldInvoice: false as const,
            invoiceAgeDays: undefined as number | undefined,
            issuedAtIso: undefined as string | undefined,
            timestampMs: invoice.createdAt.getTime(),
            timestampIso: invoice.createdAt.toISOString(),
          };
        })()
      : (() => {
          const m = oldMeta!;
          return {
            customerName: m.customerName,
            staffName: m.collectorName,
            invoiceTotalFormatted: displayMoney(m.totalCents),
            remainingFormatted: displayMoney(m.remainingAfterCents),
            hasRemaining: m.remainingAfterCents > 0n,
            isOldInvoice: true as const,
            invoiceAgeDays: m.ageDays,
            issuedAtIso: m.issuedAtIso,
            timestampMs: m.lastAtMs,
            timestampIso: m.lastAtIso,
          };
        })();
    for (const [method, net] of perMethod) {
      const bucket = rowsByMethod.get(method);
      if (!bucket || net <= 0n) continue;
      if (invoice) splitSaleIds.add(saleId); // المؤشر العلوي «N فاتورة مسددة» يظل محسوبًا من فواتير اليوم فقط (قرار المستخدم)
      totalsByMethod.set(method, (totalsByMethod.get(method) ?? 0n) + net);
      bucket.push({
        key: `split-${method}-${saleId}`,
        saleId,
        method,
        methodLabel: METHOD_LABELS[method as PaymentMethod] ?? method,
        amountFormatted: displayMoney(net),
        ...rowBase,
      });
    }
  }
  const todaySplitSections: DashboardTodaySplitSection[] = [];
  for (const method of METHOD_ORDER) {
    const rows = rowsByMethod.get(method)!;
    rows.sort((a, b) => b.timestampMs - a.timestampMs);
    // قسمان أوليان دائمًا (نقدي وبطاقة)؛ بقية الوسائل تظهر فقط عند وجود تحصيلاتها
    if (method !== "CASH" && method !== "CARD" && rows.length === 0) continue;
    todaySplitSections.push({
      method,
      label: METHOD_LABELS[method],
      totalFormatted: displayMoney(totalsByMethod.get(method) ?? 0n),
      totalCents: totalsByMethod.get(method) ?? 0n,
      invoiceCount: rows.length,
      rows,
    });
  }
  const todaySplitDistinctInvoices = splitSaleIds.size;

  // القسم المستقل: تحصيلات اليوم على الذمم القديمة (فاتورة قبل اليوم + ذمة مفتوحة عند بدء اليوم)
  const todayOldInvoiceCollections: DashboardTodayOldInvoiceItem[] = [...oldInvoiceMetaById].map(
    ([saleId, m]) => ({
      key: `old-${saleId}`,
      saleId,
      customerName: m.customerName,
      branchName: m.branchName,
      collectorName: m.collectorName,
      issuedAtIso: m.issuedAtIso,
      ageDays: m.ageDays,
      totalFormatted: displayMoney(m.totalCents),
      collectedTodayFormatted: displayMoney(m.collectedTodayCents),
      remainingBeforeFormatted: displayMoney(m.remainingBeforeCents),
      remainingAfterFormatted: displayMoney(m.remainingAfterCents),
      cleared: m.remainingAfterCents === 0n,
      methodBreakdown: (() => {
        const perMethod = netBySaleAndMethod.get(saleId);
        if (!perMethod) return "";
        return [...perMethod]
          .filter(([, net]) => net > 0n)
          .map(([method, net]) => `${METHOD_LABELS[method as PaymentMethod] ?? method} ${displayMoney(net)}`)
          .join(" + ");
      })(),
      timestampMs: m.lastAtMs,
      timestampIso: m.lastAtIso,
    }),
  );
  const todayOldCollectedTotalFormatted = displayMoney(
    [...oldInvoiceMetaById.values()].reduce((acc, m) => acc + m.collectedTodayCents, 0n),
  );

  const todayRefundsList: DashboardTodayRefundItem[] = todayRefundDetailRows.map((r) => ({
    key: `today-refund-${r.id}`,
    saleId: r.saleId,
    customerName: r.customerName,
    staffName: r.staffName,
    method: r.method,
    methodLabel: METHOD_LABELS[r.method as PaymentMethod] ?? r.method,
    amountFormatted: displayMoney(toCents(r.amount)),
    timestampMs: r.createdAt.getTime(),
    timestampIso: r.createdAt.toISOString(),
  }));

  const recentCommerceEvents: DashboardActivityItem[] = [
    ...recentSalesRows.map((s) => ({
      key: `sale-${s.id}`,
      kind: "sale" as const,
      title: `فاتورة ST-${s.id} — ${s.customerName}`,
      subtitle: `${s.branchName} · ${s.staffName}`,
      amountFormatted: `${displayMoney(toCents(s.total))} ج.م`,
      statusLabel: s.cancelled ? "ملغاة" : "مؤكدة",
      tone: s.cancelled ? ("neutral" as const) : ("positive" as const),
      timestampMs: s.createdAt.getTime(),
      timestampIso: s.createdAt.toISOString(),
      href: `/sales/${s.id}`,
    })),
    ...recentCollectionsRows.map((c) => ({
      key: `col-${c.id}`,
      kind: "collection" as const,
      title: `تحصيل فاتورة ST-${c.saleId} — ${c.customerName}`,
      subtitle: `${METHOD_LABELS[c.method as PaymentMethod] ?? c.method} · ${c.branchName} · ${c.staffName}`,
      amountFormatted: `${displayMoney(toCents(c.amount))} ج.م`,
      statusLabel: "تحصيل مسجّل",
      tone: "positive" as const,
      timestampMs: c.createdAt.getTime(),
      timestampIso: c.createdAt.toISOString(),
      href: `/sales/${c.saleId}`,
    })),
  ];

  const outstandingNowCents = toCents(outstandingNetRows[0]?.nowTotal ?? "0");
  const outstandingPrevCents = toCents(outstandingNetRows[0]?.prevTotal ?? "0");
  let outstandingChangePct: number | null = null;
  let outstandingChangeDirection: "up" | "down" | "flat" = "flat";
  if (outstandingPrevCents > 0n) {
    outstandingChangePct =
      Math.round(
        ((Number(outstandingNowCents - outstandingPrevCents) / Number(outstandingPrevCents)) * 1000),
      ) / 10;
    outstandingChangeDirection =
      outstandingChangePct > 0 ? "up" : outstandingChangePct < 0 ? "down" : "flat";
  } else if (outstandingNowCents > 0n) {
    outstandingChangeDirection = "up";
  }
  const outstandingTotalFormatted = displayMoney(outstandingNowCents);

  return {
    todayNetSalesFormatted: displayMoney(todayNetSalesCents),
    todayNetSalesNum: Number(todayNetSalesCents) / 100,
    todayInvoicesCount,
    yesterdayNetSalesFormatted: displayMoney(yesterdayNetSalesCents),
    todayGrowthPct,
    todayGrowthDirection,
    todayNetCollectedFormatted: displayMoney(todayNetCollectedCents),
    todayCashCollectedFormatted: displayMoney(todayCashCents),
    todayElectronicCollectedFormatted: displayMoney(todayElecCents),
    outOfStockCount: Number(lowStockCountsRows[0]?.zeroCount ?? 0),
    lowStockTotalCount: Number(lowStockCountsRows[0]?.lowTotalCount ?? 0),
    lowStockItems,
    branchHealth,
    recentCommerceEvents,
    todayInvoicesList,
    todaySplitSections,
    todaySplitDistinctInvoices,
    todayRemainingFormatted: displayMoney(todayRemainingCents),
    todayRemainingCount,
    todayRefundsTotalFormatted: displayMoney(todayRefundsCents),
    todayRefundsMovesCount,
    todayRefundsList,
    todayOldInvoiceCollections,
    todayOldCollectedTotalFormatted,
    outstandingTotalFormatted,
    outstandingChangePct,
    outstandingChangeDirection,
  };
}
