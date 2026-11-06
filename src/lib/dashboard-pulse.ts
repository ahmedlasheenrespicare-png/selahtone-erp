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
};

export type DashboardTodaySplitSection = {
  method: string;
  label: string;
  totalFormatted: string;
  invoiceCount: number;
  rows: DashboardTodaySplitRow[];
};

export type DashboardTodayRefundItem = {
  key: string;
  saleId: string;
  customerName: string;
  staffName: string;
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
  todayRefundsMovesCount: number;
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
      lines: allLines.slice(0, 4),
      extraLinesCount: Math.max(0, allLines.length - 4),
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
    if (!invoice) continue; // فاتورة اليوم ليست في مجموعة بطاقتي اليوم (ملغاة تلغي التحصيلات)
    for (const [method, net] of perMethod) {
      const bucket = rowsByMethod.get(method);
      if (!bucket || net <= 0n) continue;
      splitSaleIds.add(saleId);
      const remainingCents = invoice.cancelled ? 0n : toCents(invoice.remaining);
      const totalCents = toCents(invoice.total);
      totalsByMethod.set(method, (totalsByMethod.get(method) ?? 0n) + net);
      bucket.push({
        key: `split-${method}-${saleId}`,
        saleId,
        customerName: invoice.customerName,
        staffName: invoice.staffName,
        method,
        methodLabel: METHOD_LABELS[method as PaymentMethod] ?? method,
        amountFormatted: displayMoney(net),
        invoiceTotalFormatted: displayMoney(totalCents),
        remainingFormatted: displayMoney(remainingCents),
        hasRemaining: remainingCents > 0n,
        timestampMs: invoice.createdAt.getTime(),
        timestampIso: invoice.createdAt.toISOString(),
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
      invoiceCount: rows.length,
      rows,
    });
  }
  const todaySplitDistinctInvoices = splitSaleIds.size;

  const todayRefundsList: DashboardTodayRefundItem[] = todayRefundDetailRows.map((r) => ({
    key: `today-refund-${r.id}`,
    saleId: r.saleId,
    customerName: r.customerName,
    staffName: r.staffName,
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
  };
}
