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
  todayCollectionMovesCount: number;
  outOfStockCount: number;
  lowStockTotalCount: number;
  lowStockItems: DashboardStockAlertItem[];
  branchHealth: DashboardBranchHealthItem[];
  recentCommerceEvents: DashboardActivityItem[];
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
      date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo' AS "todayStart",
      date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo' - INTERVAL '1 day' AS "yesterdayStart"`;

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
  let todayCollectionMovesCount = 0;
  for (const r of todayColRows) {
    const c = toCents(r.total);
    todayCollectionMovesCount += Number(r.n);
    if (r.method === "CASH") todayCashCents += c;
    else todayElecCents += c;
  }
  for (const r of todayRefRows) {
    const c = toCents(r.total);
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
    todayCollectionMovesCount,
    outOfStockCount: Number(lowStockCountsRows[0]?.zeroCount ?? 0),
    lowStockTotalCount: Number(lowStockCountsRows[0]?.lowTotalCount ?? 0),
    lowStockItems,
    branchHealth,
    recentCommerceEvents,
  };
}
