import type { PrismaClient } from "@prisma/client";
import type {
  PantherChartPoint,
  PantherChartSeries,
} from "@/components/panther-spotlight-card";
import { displayMoney } from "@/lib/commerce-display";
import type {
  DashboardFinanceOpsSummary,
  DashboardPaidExpenseFlow,
  DashboardSpotlightData,
} from "@/lib/finance/dashboard";

const arNum = new Intl.NumberFormat("ar-EG-u-nu-latn", {
  maximumFractionDigits: 2,
});

function clampScore(v: number, min = 0, max = 100): number {
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, Math.round(v * 10) / 10));
}

function toCents(value: string): bigint {
  const trimmed = String(value ?? "0").trim();
  const negative = trimmed.startsWith("-");
  const [whole = "0", fraction = ""] = trimmed.replace("-", "").split(".");
  return (
    (negative ? -1n : 1n) *
    (BigInt(whole || "0") * 100n + BigInt((fraction + "00").slice(0, 2) || "0"))
  );
}

export function normalizeSearchQuery(raw: string): string {
  return raw
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .trim()
    .slice(0, 80);
}

export type DashboardMonthPace = {
  dayOfMonth: number;
  daysInMonth: number;
  monthProgressPct: number;
  mtdNetSalesFormatted: string;
  dailyAverageFormatted: string;
  projectedCloseFormatted: string;
  prevSameSpanFormatted: string;
  prevFullMonthFormatted: string;
  paceVsLastMonthPct: number | null;
  paceDirection: "up" | "down" | "flat";
};

export type DashboardAgingBucket = {
  key: "over30" | "days8To30" | "days0To7";
  label: string;
  tone: "danger" | "warning" | "info";
  count: number;
  totalFormatted: string;
  sharePct: number;
};

export type DashboardPriorityInvoice = {
  saleId: string;
  customerName: string;
  customerPhone: string;
  branchName: string;
  ageDays: number;
  ageLabel: string;
  tone: "danger" | "warning" | "info";
  netTotalFormatted: string;
  paidFormatted: string;
  dueFormatted: string;
  href: string;
};

export type DashboardAgingRadar = {
  totalOpenCount: number;
  totalDueFormatted: string;
  buckets: DashboardAgingBucket[];
  priorityInvoices: DashboardPriorityInvoice[];
};

export type DashboardGovernanceAlert = {
  key: string;
  tone: "danger" | "warning" | "info";
  title: string;
  detail: string;
  href: string;
};

export type DashboardGovernanceWatch = {
  isClean: boolean;
  staffDiscountPctLabel: string;
  alerts: DashboardGovernanceAlert[];
};

export type DashboardOmniSerialHit = {
  serialId: string;
  serialNumber: string;
  productName: string;
  sku: string;
  warehouseName: string;
  branchName: string;
  isAvailable: boolean;
  customerName: string | null;
  saleId: string | null;
};

export type DashboardOmniSaleHit = {
  saleId: string;
  customerName: string;
  customerPhone: string;
  branchName: string;
  createdAtIso: string;
  netTotalFormatted: string;
  dueFormatted: string;
  hasDue: boolean;
  isCancelled: boolean;
  statusLabel: string;
  tone: "positive" | "warning" | "danger";
};

export type DashboardOmniProductHit = {
  productId: string;
  sku: string;
  nameAr: string;
  salePriceFormatted: string;
  qtyOnHandFormatted: string;
  isSerialized: boolean;
};

export type DashboardOmniSearchResults = {
  query: string;
  totalHits: number;
  serials: DashboardOmniSerialHit[];
  sales: DashboardOmniSaleHit[];
  products: DashboardOmniProductHit[];
};

export type DashboardBranchScoreBadge = {
  score: number;
  gradeLabel: string;
  tone: "positive" | "warning" | "danger";
};

export type DashboardExecutiveSuite = {
  fifthSpotlight: DashboardSpotlightData;
  compositeEfficiencySpotlight: DashboardSpotlightData;
  cashConversionSpotlight: DashboardSpotlightData;
  branchEfficiencySpotlight: DashboardSpotlightData;
  branchScoresById: Record<string, DashboardBranchScoreBadge>;
  monthPace: DashboardMonthPace;
  agingRadar: DashboardAgingRadar;
  governance: DashboardGovernanceWatch | null;
  omniSearch: DashboardOmniSearchResults | null;
};

export async function loadDashboardExecutiveSuite(
  db: PrismaClient,
  opts: {
    branchId: string | null;
    canManage: boolean;
    monthLabel: string;
    branches: Array<{ id: string; nameAr: string }>;
    financeOpsSummary: DashboardFinanceOpsSummary | null;
    paidExpenseFlow?: DashboardPaidExpenseFlow | null;
    employeeCustodyState?: {
      settlementStale: boolean;
      pendingActionsCount: number;
    } | null;
    searchQuery?: string | null;
    canAccessInventorySerials: boolean;
    canAccessSalesStats: boolean;
    canAccessFinance: boolean;
  },
): Promise<DashboardExecutiveSuite> {
  const branch = opts.branchId === null ? null : BigInt(opts.branchId);
  const branchNames = new Map(opts.branches.map((b) => [b.id, b.nameAr]));

  const boundsRows = await db.$queryRaw<
    Array<{
      todayStart: Date;
      monthStart: Date;
      prevMonthStart: Date;
      prevSameSpanEnd: Date;
      dayOfMonth: number;
      daysInMonth: number;
    }>
  >`
    SELECT
      (DATE_TRUNC('day', NOW() AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo') AS "todayStart",
      (DATE_TRUNC('month', NOW() AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo') AS "monthStart",
      ((DATE_TRUNC('month', NOW() AT TIME ZONE 'Africa/Cairo') - INTERVAL '1 month') AT TIME ZONE 'Africa/Cairo') AS "prevMonthStart",
      LEAST(
        ((DATE_TRUNC('month', NOW() AT TIME ZONE 'Africa/Cairo') - INTERVAL '1 month')
          + ((NOW() AT TIME ZONE 'Africa/Cairo') - DATE_TRUNC('month', NOW() AT TIME ZONE 'Africa/Cairo'))) AT TIME ZONE 'Africa/Cairo',
        (DATE_TRUNC('month', NOW() AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo')
      ) AS "prevSameSpanEnd",
      GREATEST(1, EXTRACT(DAY FROM (NOW() AT TIME ZONE 'Africa/Cairo'))::int) AS "dayOfMonth",
      GREATEST(1, EXTRACT(DAY FROM (DATE_TRUNC('month', NOW() AT TIME ZONE 'Africa/Cairo') + INTERVAL '1 month - 1 day'))::int) AS "daysInMonth"`;

  const bounds = boundsRows[0];

  // ── الاستعلامات المشتركة: وتيرة الشهر + رادار التحصيل وأعمار الذمم ──
  const [paceRows, agingSummaryRows, priorityInvoiceRows] = await Promise.all([
    db.$queryRaw<
      Array<{
        mtdNet: string;
        prevSpanNet: string;
        prevFullNet: string;
      }>
    >`
      SELECT
        COALESCE((
          SELECT SUM(
            s.total - COALESCE((SELECT SUM(rl.total) FROM commerce_return_lines rl JOIN commerce_returns r ON r.id = rl.return_id WHERE r.sale_id = s.id), 0)
          )
          FROM commerce_sales s
          WHERE s.cancelled_at IS NULL
            AND (${branch}::bigint IS NULL OR s.branch_id = ${branch}::bigint)
            AND s.created_at >= ${bounds.monthStart}::timestamptz
        ), 0)::text AS "mtdNet",
        COALESCE((
          SELECT SUM(
            s.total - COALESCE((SELECT SUM(rl.total) FROM commerce_return_lines rl JOIN commerce_returns r ON r.id = rl.return_id WHERE r.sale_id = s.id), 0)
          )
          FROM commerce_sales s
          WHERE s.cancelled_at IS NULL
            AND (${branch}::bigint IS NULL OR s.branch_id = ${branch}::bigint)
            AND s.created_at >= ${bounds.prevMonthStart}::timestamptz
            AND s.created_at < ${bounds.prevSameSpanEnd}::timestamptz
        ), 0)::text AS "prevSpanNet",
        COALESCE((
          SELECT SUM(
            s.total - COALESCE((SELECT SUM(rl.total) FROM commerce_return_lines rl JOIN commerce_returns r ON r.id = rl.return_id WHERE r.sale_id = s.id), 0)
          )
          FROM commerce_sales s
          WHERE s.cancelled_at IS NULL
            AND (${branch}::bigint IS NULL OR s.branch_id = ${branch}::bigint)
            AND s.created_at >= ${bounds.prevMonthStart}::timestamptz
            AND s.created_at < ${bounds.monthStart}::timestamptz
        ), 0)::text AS "prevFullNet"`,
    db.$queryRaw<
      Array<{
        bucket: string;
        totalDue: string;
        n: number;
      }>
    >`
      SELECT
        CASE
          WHEN x."ageDays" >= 30 THEN 'over30'
          WHEN x."ageDays" >= 8 THEN 'days8To30'
          ELSE 'days0To7'
        END AS bucket,
        COALESCE(SUM(x.due), 0)::text AS "totalDue",
        COUNT(*)::int AS n
      FROM (
        SELECT
          GREATEST(0, ((NOW() AT TIME ZONE 'Africa/Cairo')::date - (s.created_at AT TIME ZONE 'Africa/Cairo')::date))::int AS "ageDays",
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
      GROUP BY 1`,
    db.$queryRaw<
      Array<{
        saleId: string;
        customerName: string;
        customerPhone: string;
        branchName: string;
        ageDays: number;
        netTotal: string;
        paidNet: string;
        due: string;
      }>
    >`
      SELECT
        x."saleId",
        x."customerName",
        x."customerPhone",
        x."branchName",
        x."ageDays",
        x."netTotal"::text AS "netTotal",
        x."paidNet"::text AS "paidNet",
        x.due::text AS due
      FROM (
        SELECT
          s.id::text AS "saleId",
          s.customer_name AS "customerName",
          s.customer_phone AS "customerPhone",
          b.name_ar AS "branchName",
          s.created_at AS "createdAt",
          GREATEST(0, ((NOW() AT TIME ZONE 'Africa/Cairo')::date - (s.created_at AT TIME ZONE 'Africa/Cairo')::date))::int AS "ageDays",
          (
            s.total - COALESCE((SELECT SUM(rl.total) FROM commerce_return_lines rl JOIN commerce_returns r ON r.id = rl.return_id WHERE r.sale_id = s.id), 0)
          ) AS "netTotal",
          GREATEST(
            COALESCE((SELECT SUM(c.amount) FROM commerce_collections c WHERE c.sale_id = s.id), 0)
            - COALESCE((SELECT SUM(rf.amount) FROM commerce_refunds rf WHERE rf.sale_id = s.id), 0),
            0
          ) AS "paidNet",
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
        JOIN branches b ON b.id = s.branch_id
        WHERE s.cancelled_at IS NULL
          AND (${branch}::bigint IS NULL OR s.branch_id = ${branch}::bigint)
      ) x
      WHERE x.due > 0
      ORDER BY
        CASE
          WHEN x."ageDays" >= 30 THEN 0
          WHEN x."ageDays" >= 8 THEN 1
          ELSE 2
        END ASC,
        x.due DESC,
        x."createdAt" ASC
      LIMIT 5`,
  ]);

  // ── بناء شريط وتيرة الشهر وتوقع الإغلاق (Feature #4) ──
  const paceRow = paceRows[0];
  const mtdCents = toCents(paceRow?.mtdNet ?? "0");
  const prevSpanCents = toCents(paceRow?.prevSpanNet ?? "0");
  const prevFullCents = toCents(paceRow?.prevFullNet ?? "0");
  const dayOfMonth = Math.max(1, Number(bounds.dayOfMonth));
  const daysInMonth = Math.max(dayOfMonth, Number(bounds.daysInMonth));
  const dailyAvgCents = mtdCents / BigInt(dayOfMonth);
  const projectedCloseCents = (mtdCents * BigInt(daysInMonth)) / BigInt(dayOfMonth);

  let paceVsLastMonthPct: number | null = null;
  let paceDirection: "up" | "down" | "flat" = "flat";
  if (prevSpanCents > 0n) {
    const rawPct =
      Math.round((Number(mtdCents - prevSpanCents) / Number(prevSpanCents)) * 1000) / 10;
    paceVsLastMonthPct = rawPct;
    paceDirection = rawPct > 0 ? "up" : rawPct < 0 ? "down" : "flat";
  } else if (mtdCents > 0n) {
    paceDirection = "up";
  }

  const monthPace: DashboardMonthPace = {
    dayOfMonth,
    daysInMonth,
    monthProgressPct: Math.min(100, Math.round((dayOfMonth / daysInMonth) * 100)),
    mtdNetSalesFormatted: displayMoney(mtdCents),
    dailyAverageFormatted: displayMoney(dailyAvgCents),
    projectedCloseFormatted: displayMoney(projectedCloseCents),
    prevSameSpanFormatted: displayMoney(prevSpanCents),
    prevFullMonthFormatted: displayMoney(prevFullCents),
    paceVsLastMonthPct,
    paceDirection,
  };

  // ── بناء رادار أولويات التحصيل وأعمار الذمم (Feature #2) ──
  const bucketMap = new Map<string, { cents: bigint; count: number }>();
  let totalDueCents = 0n;
  let totalOpenCount = 0;
  for (const row of agingSummaryRows) {
    const c = toCents(row.totalDue);
    const n = Number(row.n);
    bucketMap.set(row.bucket, { cents: c, count: n });
    totalDueCents += c;
    totalOpenCount += n;
  }

  const makeBucket = (
    key: DashboardAgingBucket["key"],
    label: string,
    tone: DashboardAgingBucket["tone"],
  ): DashboardAgingBucket => {
    const info = bucketMap.get(key) ?? { cents: 0n, count: 0 };
    const sharePct =
      totalDueCents > 0n
        ? Math.min(100, Math.round((Number(info.cents) / Number(totalDueCents)) * 1000) / 10)
        : 0;
    return {
      key,
      label,
      tone,
      count: info.count,
      totalFormatted: displayMoney(info.cents),
      sharePct,
    };
  };

  const agingRadar: DashboardAgingRadar = {
    totalOpenCount,
    totalDueFormatted: displayMoney(totalDueCents),
    buckets: [
      makeBucket("over30", "متأخرة +٣٠ يومًا", "danger"),
      makeBucket("days8To30", "متوسطة ٨–٣٠ يومًا", "warning"),
      makeBucket("days0To7", "حديثة ٠–٧ أيام", "info"),
    ],
    priorityInvoices: priorityInvoiceRows.map((inv) => {
      const age = Number(inv.ageDays);
      const tone: DashboardPriorityInvoice["tone"] =
        age >= 30 ? "danger" : age >= 8 ? "warning" : "info";
      const ageLabel =
        age === 0 ? "اليوم" : age === 1 ? "منذ يوم" : `منذ ${arNum.format(age)} يوم`;
      return {
        saleId: inv.saleId,
        customerName: inv.customerName,
        customerPhone: inv.customerPhone,
        branchName: inv.branchName,
        ageDays: age,
        ageLabel,
        tone,
        netTotalFormatted: displayMoney(toCents(inv.netTotal)),
        paidFormatted: displayMoney(toCents(inv.paidNet)),
        dueFormatted: displayMoney(toCents(inv.due)),
        href: `/sales/${inv.saleId}`,
      };
    }),
  };

  // ── بناء المؤشر الخامس التفاعلي + تنبيهات الرقابة المالية (Features #1 & #5) ──
  let fifthSpotlight: DashboardSpotlightData;
  let governance: DashboardGovernanceWatch | null = null;

  if (opts.canManage) {
    const [profitRows, govRows] = await Promise.all([
      db.$queryRaw<
        Array<{
          dayKey: string;
          branchId: string;
          netSales: string;
          cogs: string;
          discounts: string;
          partialReturns: string;
          invoicesCount: number;
        }>
      >`
        SELECT
          TO_CHAR(s.created_at AT TIME ZONE 'Africa/Cairo', 'YYYY-MM-DD') AS "dayKey",
          s.branch_id::text AS "branchId",
          COALESCE(
            SUM(
              s.total - COALESCE(
                (SELECT SUM(rl.total) FROM commerce_return_lines rl JOIN commerce_returns r ON r.id = rl.return_id WHERE r.sale_id = s.id),
                0
              )
            ),
            0
          )::text AS "netSales",
          COALESCE(
            SUM((
              SELECT COALESCE(
                SUM(
                  ROUND(
                    GREATEST(
                      sl.quantity - COALESCE(
                        (SELECT SUM(rl2.quantity) FROM commerce_return_lines rl2 JOIN commerce_returns r2 ON r2.id = rl2.return_id WHERE rl2.sale_line_id = sl.id),
                        0
                      ),
                      0
                    ) * COALESCE(sl.unit_cost, 0),
                    2
                  )
                ),
                0
              )
              FROM commerce_sale_lines sl
              WHERE sl.sale_id = s.id AND sl.is_stock = true
            )),
            0
          )::text AS cogs,
          COALESCE(SUM(s.discount), 0)::text AS discounts,
          COALESCE(
            SUM((
              SELECT COALESCE(SUM(rl3.total), 0)
              FROM commerce_return_lines rl3
              JOIN commerce_returns r3 ON r3.id = rl3.return_id
              WHERE r3.sale_id = s.id AND r3.is_cancellation = false
            )),
            0
          )::text AS "partialReturns",
          COUNT(*)::int AS "invoicesCount"
        FROM commerce_sales s
        WHERE s.cancelled_at IS NULL
          AND (${branch}::bigint IS NULL OR s.branch_id = ${branch}::bigint)
          AND s.created_at >= ${bounds.monthStart}::timestamptz
        GROUP BY 1, 2
        ORDER BY 1 ASC`,
      db.$queryRaw<
        Array<{
          staffDiscountBps: number;
          todayCancelledCount: number;
          todayPartialReturnsCount: number;
          todayPartialReturnsTotal: string;
          highDiscountMonthCount: number;
          maxDiscountPct: string;
        }>
      >`
        WITH cfg AS (
          SELECT COALESCE((SELECT staff_discount_bps FROM commerce_settings WHERE id = 1), 500)::int AS bps
        )
        SELECT
          cfg.bps AS "staffDiscountBps",
          (
            SELECT COUNT(*)::int FROM commerce_sales s
            WHERE s.cancelled_at IS NOT NULL
              AND (${branch}::bigint IS NULL OR s.branch_id = ${branch}::bigint)
              AND s.cancelled_at >= ${bounds.todayStart}::timestamptz
          ) AS "todayCancelledCount",
          (
            SELECT COUNT(*)::int FROM commerce_returns r
            JOIN commerce_sales s ON s.id = r.sale_id
            WHERE r.is_cancellation = false
              AND (${branch}::bigint IS NULL OR s.branch_id = ${branch}::bigint)
              AND r.created_at >= ${bounds.todayStart}::timestamptz
          ) AS "todayPartialReturnsCount",
          (
            SELECT COALESCE(SUM(rl.total), 0)::text
            FROM commerce_return_lines rl
            JOIN commerce_returns r ON r.id = rl.return_id
            JOIN commerce_sales s ON s.id = r.sale_id
            WHERE r.is_cancellation = false
              AND (${branch}::bigint IS NULL OR s.branch_id = ${branch}::bigint)
              AND r.created_at >= ${bounds.todayStart}::timestamptz
          ) AS "todayPartialReturnsTotal",
          (
            SELECT COUNT(*)::int FROM commerce_sales s
            WHERE s.cancelled_at IS NULL
              AND (${branch}::bigint IS NULL OR s.branch_id = ${branch}::bigint)
              AND s.created_at >= ${bounds.monthStart}::timestamptz
              AND s.subtotal > 0
              AND s.discount > 0
              AND (s.discount * 10000) >= (s.subtotal * cfg.bps)
          ) AS "highDiscountMonthCount",
          (
            SELECT COALESCE(MAX(ROUND((s.discount * 100.0) / NULLIF(s.subtotal, 0), 1)), 0)::text
            FROM commerce_sales s
            WHERE s.cancelled_at IS NULL
              AND (${branch}::bigint IS NULL OR s.branch_id = ${branch}::bigint)
              AND s.created_at >= ${bounds.monthStart}::timestamptz
              AND s.subtotal > 0
              AND s.discount > 0
          ) AS "maxDiscountPct"
        FROM cfg`,
    ]);

    let monthNetSalesCents = 0n;
    let monthCogsCents = 0n;
    let monthDiscountsCents = 0n;
    let monthPartialReturnsCents = 0n;

    const salesByDay = new Map<string, { netSales: bigint; cogs: bigint }>();
    const salesByBranchId = new Map<string, { netSales: bigint; cogs: bigint }>();

    for (const row of profitRows) {
      const ns = toCents(row.netSales);
      const cg = toCents(row.cogs);
      const dc = toCents(row.discounts);
      const pr = toCents(row.partialReturns);
      monthNetSalesCents += ns;
      monthCogsCents += cg;
      monthDiscountsCents += dc;
      monthPartialReturnsCents += pr;

      const dayEntry = salesByDay.get(row.dayKey) ?? { netSales: 0n, cogs: 0n };
      dayEntry.netSales += ns;
      dayEntry.cogs += cg;
      salesByDay.set(row.dayKey, dayEntry);

      const brEntry = salesByBranchId.get(row.branchId) ?? { netSales: 0n, cogs: 0n };
      brEntry.netSales += ns;
      brEntry.cogs += cg;
      salesByBranchId.set(row.branchId, brEntry);
    }

    const finSummary = opts.financeOpsSummary;
    const monthOpExpensesCents = toCents(finSummary?.monthRecognizedExpensesCentsStr ?? "0");
    const monthGrossProfitCents = monthNetSalesCents - monthCogsCents;
    const monthNetOperatingCents = monthGrossProfitCents - monthOpExpensesCents;
    const grossMarginPct =
      monthNetSalesCents > 0n
        ? Math.round((Number(monthGrossProfitCents) / Number(monthNetSalesCents)) * 1000) / 10
        : 0;

    // السلسلة ١: المسار التراكمي اليومي لصافي التشغيل ومجمل الربح
    const expByDayObj = finSummary?.monthRecognizedByDayCents ?? {};
    const allDays = Array.from(
      new Set([...salesByDay.keys(), ...Object.keys(expByDayObj)]),
    ).sort();

    const dailyPoints: PantherChartPoint[] = [
      {
        label: "بداية الشهر",
        shortLabel: "٠",
        value: 0,
        formattedValue: "0.00 ج.م",
        secondaryValue: 0,
        secondaryLabel: "مجمل الربح",
        secondaryFormatted: "0.00 ج.م",
      },
    ];

    if (allDays.length === 0) {
      dailyPoints.push({
        label: "الآن — بانتظار أول حركة",
        shortLabel: "الآن",
        value: 0,
        formattedValue: "0.00 ج.م",
        secondaryValue: 0,
        secondaryLabel: "مجمل الربح",
        secondaryFormatted: "0.00 ج.م",
      });
    } else {
      let cumGross = 0n;
      let cumNetOp = 0n;
      for (const dKey of allDays) {
        const sDay = salesByDay.get(dKey) ?? { netSales: 0n, cogs: 0n };
        const eDay = toCents(expByDayObj[dKey] ?? "0");
        const dayGross = sDay.netSales - sDay.cogs;
        const dayNetOp = dayGross - eDay;
        cumGross += dayGross;
        cumNetOp += dayNetOp;
        dailyPoints.push({
          label: `يوم ${dKey}`,
          shortLabel: dKey.slice(5),
          value: Number(cumNetOp) / 100,
          formattedValue: `${displayMoney(cumNetOp)} ج.م`,
          secondaryValue: Number(cumGross) / 100,
          secondaryLabel: "مجمل الربح",
          secondaryFormatted: `${displayMoney(cumGross)} ج.م`,
          detail: `تشغيل اليوم ${displayMoney(dayNetOp)} ج.م · مصروفات معتمدة ${displayMoney(eDay)} ج.م`,
        });
      }
    }

    // السلسلة ٢: مساهمة كل فرع نشط بعد تكلفة البضاعة والمصروفات المعتمدة
    const expByBranchObj = finSummary?.monthRecognizedByBranchIdCents ?? {};
    const rawBranchPoints: PantherChartPoint[] = opts.branches.map((b) => {
      const sBr = salesByBranchId.get(b.id) ?? { netSales: 0n, cogs: 0n };
      const eBr = toCents(expByBranchObj[b.id] ?? "0");
      const brGross = sBr.netSales - sBr.cogs;
      const brNetOp = brGross - eBr;
      return {
        label: b.nameAr,
        shortLabel: b.nameAr.replace(/^فرع\s+/, ""),
        value: Number(brNetOp) / 100,
        formattedValue: `${displayMoney(brNetOp)} ج.م`,
        secondaryValue: Number(sBr.netSales) / 100,
        secondaryLabel: "صافي المبيعات",
        secondaryFormatted: `${displayMoney(sBr.netSales)} ج.م`,
        detail: `مجمل ربح ${displayMoney(brGross)} ج.م − مصروفات ${displayMoney(eBr)} ج.م`,
      };
    });

    const branchPoints: PantherChartPoint[] =
      rawBranchPoints.length === 1
        ? [
            {
              label: "نقطة المقارنة",
              shortLabel: "٠",
              value: 0,
              formattedValue: "0.00 ج.م",
              secondaryValue: 0,
              secondaryLabel: "صافي المبيعات",
              secondaryFormatted: "0.00 ج.م",
            },
            rawBranchPoints[0],
          ]
        : rawBranchPoints;

    // السلسلة ١: جسر الربحية (المبيعات ← مجمل الربح ← المصروفات التشغيلية ← صافي التشغيل)
    const bridgePoints: PantherChartPoint[] = [
      {
        label: "صافي المبيعات",
        shortLabel: "المبيعات",
        value: Number(monthNetSalesCents) / 100,
        formattedValue: `${displayMoney(monthNetSalesCents)} ج.م`,
        detail: "بعد استبعاد الإلغاءات والمرتجعات",
      },
      {
        label: "مجمل الربح بعد التكلفة",
        shortLabel: "المجمل",
        value: Number(monthGrossProfitCents) / 100,
        formattedValue: `${displayMoney(monthGrossProfitCents)} ج.م`,
        detail: `تكلفة البضاعة المباعة: ${displayMoney(monthCogsCents)} ج.م`,
      },
      {
        label: "المصروفات التشغيلية بالشهر",
        shortLabel: "−المصروفات",
        value: Number(monthOpExpensesCents) / 100,
        formattedValue: `${displayMoney(monthOpExpensesCents)} ج.م`,
        detail: `خصومات ومرتجعات الفترة: ${displayMoney(monthDiscountsCents + monthPartialReturnsCents)} ج.م`,
        tone: "danger",
      },
      {
        label: "صافي التشغيل بعد المصروفات",
        shortLabel: "=الصافي",
        value: Number(monthNetOperatingCents) / 100,
        formattedValue: `${displayMoney(monthNetOperatingCents)} ج.م`,
        detail: "صافي ربح التشغيل الفعلي بعد التكلفة والمصروفات",
      },
    ];

    const profitSeries: PantherChartSeries[] = [
      {
        id: "profit-bridge",
        label: "جسر الربحية",
        chartVariant: "waterfall",
        points: bridgePoints,
      },
      {
        id: "daily-operating",
        label: "صافي الأيام",
        chartVariant: "area",
        points: dailyPoints,
      },
      ...(branchPoints.length > 0
        ? [
            {
              id: "branch-operating",
              label: "مساهمة الفروع",
              chartVariant: "columns" as const,
              points: branchPoints,
            },
          ]
        : []),
    ];

    const statsHref = opts.canAccessSalesStats
      ? opts.branchId
        ? `/sales/stats?period=month&branch=${opts.branchId}`
        : "/sales/stats?period=month"
      : "/sales";

    fifthSpotlight = {
      title: "الربحية وصافي التشغيل",
      subtitle: `محدّث الآن · ${opts.monthLabel}`,
      pill: monthNetSalesCents > 0n ? `هامش مجمل ${arNum.format(grossMarginPct)}%` : "الشهر الحالي",
      primary: {
        label: "صافي التشغيل بعد المصروفات",
        value: displayMoney(monthNetOperatingCents),
        unit: "ج.م",
        delta: `مجمل الربح ${displayMoney(monthGrossProfitCents)} ج.م · تكلفة البضاعة ${displayMoney(monthCogsCents)} ج.م`,
        tone: monthNetOperatingCents >= 0n ? "positive" : "negative",
      },
      secondary: {
        label: "الخصومات والمرتجعات بالشهر",
        value: displayMoney(monthDiscountsCents + monthPartialReturnsCents),
        unit: "ج.م",
        delta: `خصومات ${displayMoney(monthDiscountsCents)} ج.م · مرتجعات جزئية ${displayMoney(monthPartialReturnsCents)} ج.م`,
        tone: monthDiscountsCents + monthPartialReturnsCents > 0n ? "negative" : "positive",
      },
      series: profitSeries,
      actionHref: statsHref,
      actionLabel: opts.canAccessSalesStats
        ? "فتح إحصائيات المبيعات والتحليل"
        : "مراجعة سجل الفواتير",
    };

    // بناء شريط تنبيهات الرقابة المالية والخصومات (Feature #5)
    const gov = govRows[0];
    const staffPct = Math.round(((gov?.staffDiscountBps ?? 500) / 100) * 10) / 10;
    const alerts: DashboardGovernanceAlert[] = [];

    const todayCancels = Number(gov?.todayCancelledCount ?? 0);
    const todayReturns = Number(gov?.todayPartialReturnsCount ?? 0);
    const todayReturnsCents = toCents(gov?.todayPartialReturnsTotal ?? "0");
    if (todayCancels > 0 || todayReturns > 0) {
      alerts.push({
        key: "cancels-returns",
        tone: todayCancels > 0 ? "danger" : "warning",
        title: `${todayCancels > 0 ? `${arNum.format(todayCancels)} فاتورة ملغاة` : ""}${todayCancels > 0 && todayReturns > 0 ? " و" : ""}${todayReturns > 0 ? `${arNum.format(todayReturns)} مرتجع جزئي اليوم` : ""}`,
        detail:
          todayReturnsCents > 0n
            ? `بقيمة مرتجعات ${displayMoney(todayReturnsCents)} ج.م اليوم — راجع السجل للتثبّت`
            : "حركات إلغاء مسجّلة اليوم ضمن النطاق المعروض",
        href: "/sales",
      });
    }

    const highDiscCount = Number(gov?.highDiscountMonthCount ?? 0);
    const maxDiscNum = Number(gov?.maxDiscountPct ?? "0");
    if (highDiscCount > 0) {
      alerts.push({
        key: "high-discounts",
        tone: "warning",
        title: `${arNum.format(highDiscCount)} فاتورة بلغت أو تجاوزت سقف خصم الكاونتر (${arNum.format(staffPct)}%)`,
        detail: `أعلى نسبة خصم مسجّلة هذا الشهر: ${arNum.format(maxDiscNum)}%`,
        href: "/sales",
      });
    }

    const staleCount = finSummary?.staleOpenSettlementsCount ?? 0;
    if (staleCount > 0) {
      alerts.push({
        key: "stale-settlements",
        tone: "danger",
        title: `${arNum.format(staleCount)} طلب تسوية عهدة معلّق بطل بحركة نقدية لاحقة`,
        detail: "وقعت مقبوضات أو منصرفات نقدية بعد الجرد؛ يلزم إعادة الجرد قبل الاعتماد",
        href: "/finance/settlements",
      });
    }

    const varianceCount = finSummary?.varianceSettlementsCount ?? 0;
    const varianceCents = toCents(finSummary?.varianceTotalAbsCentsStr ?? "0");
    if (varianceCount > 0) {
      alerts.push({
        key: "settlement-variance",
        tone: "warning",
        title: `${arNum.format(varianceCount)} تسوية عهدة بفرق جرد فعلي هذا الشهر`,
        detail: `إجمالي الفروقات المطلقة: ${displayMoney(varianceCents)} ج.م`,
        href: "/finance/settlements",
      });
    }

    governance = {
      isClean: alerts.length === 0,
      staffDiscountPctLabel: `${arNum.format(staffPct)}%`,
      alerts,
    };
  } else {
    // ── لموظف الكاونتر (CS_AGENT): مؤشر «حركة الأصناف والسيريالات» دون أي كشف للتكلفة أو الهوامش ──
    const [topItemRows, serialSummaryRows] = await Promise.all([
      db.$queryRaw<
        Array<{
          itemName: string;
          sku: string | null;
          isStock: boolean;
          netUnits: string;
          netValue: string;
        }>
      >`
        SELECT
          sl.name_snapshot AS "itemName",
          MAX(sl.sku_snapshot) AS sku,
          BOOL_OR(sl.is_stock) AS "isStock",
          COALESCE(
            SUM(
              GREATEST(
                sl.quantity - COALESCE(
                  (SELECT SUM(rl.quantity) FROM commerce_return_lines rl JOIN commerce_returns r ON r.id = rl.return_id WHERE rl.sale_line_id = sl.id),
                  0
                ),
                0
              )
            ),
            0
          )::text AS "netUnits",
          COALESCE(
            SUM(
              GREATEST(
                sl.total - COALESCE(
                  (SELECT SUM(rl2.total) FROM commerce_return_lines rl2 JOIN commerce_returns r2 ON r2.id = rl2.return_id WHERE rl2.sale_line_id = sl.id),
                  0
                ),
                0
              )
            ),
            0
          )::text AS "netValue"
        FROM commerce_sale_lines sl
        JOIN commerce_sales s ON s.id = sl.sale_id
        WHERE s.cancelled_at IS NULL
          AND (${branch}::bigint IS NULL OR s.branch_id = ${branch}::bigint)
          AND s.created_at >= ${bounds.monthStart}::timestamptz
        GROUP BY sl.name_snapshot
        HAVING SUM(
          GREATEST(
            sl.quantity - COALESCE(
              (SELECT SUM(rl.quantity) FROM commerce_return_lines rl JOIN commerce_returns r ON r.id = rl.return_id WHERE rl.sale_line_id = sl.id),
              0
            ),
            0
          )
        ) > 0
        ORDER BY SUM(
          GREATEST(
            sl.quantity - COALESCE(
              (SELECT SUM(rl.quantity) FROM commerce_return_lines rl JOIN commerce_returns r ON r.id = rl.return_id WHERE rl.sale_line_id = sl.id),
              0
            ),
            0
          )
        ) DESC
        LIMIT 6`,
      db.$queryRaw<
        Array<{
          soldSerialsMonth: number;
          availableSerialsBranch: number;
          stockUnitsMonth: string;
          catalogUnitsMonth: string;
        }>
      >`
        SELECT
          (
            SELECT COUNT(*)::int
            FROM commerce_sale_line_serials sls
            JOIN commerce_sale_lines sl ON sl.id = sls.sale_line_id
            JOIN commerce_sales s ON s.id = sl.sale_id
            LEFT JOIN commerce_return_serials crs ON crs.sale_line_serial_id = sls.id
            WHERE s.cancelled_at IS NULL
              AND crs.id IS NULL
              AND (${branch}::bigint IS NULL OR s.branch_id = ${branch}::bigint)
              AND s.created_at >= ${bounds.monthStart}::timestamptz
          ) AS "soldSerialsMonth",
          (
            SELECT COUNT(*)::int
            FROM inventory_serials ser
            LEFT JOIN inventory_openings io ON io.id = ser.opening_id
            LEFT JOIN inventory_receipts ir ON ir.id = ser.receipt_id
            JOIN warehouses w ON w.id = COALESCE(io.warehouse_id, ir.warehouse_id)
            JOIN products p ON p.id = COALESCE(io.product_id, ir.product_id)
            WHERE ser.current_sale_line_id IS NULL
              AND w.is_active = true
              AND w.holds_stock = true
              AND p.is_active = true
              AND (${branch}::bigint IS NULL OR w.branch_id = ${branch}::bigint)
          ) AS "availableSerialsBranch",
          COALESCE((
            SELECT SUM(
              GREATEST(
                sl.quantity - COALESCE((SELECT SUM(rl.quantity) FROM commerce_return_lines rl JOIN commerce_returns r ON r.id = rl.return_id WHERE rl.sale_line_id = sl.id), 0),
                0
              )
            )
            FROM commerce_sale_lines sl
            JOIN commerce_sales s ON s.id = sl.sale_id
            WHERE s.cancelled_at IS NULL
              AND sl.is_stock = true
              AND (${branch}::bigint IS NULL OR s.branch_id = ${branch}::bigint)
              AND s.created_at >= ${bounds.monthStart}::timestamptz
          ), 0)::text AS "stockUnitsMonth",
          COALESCE((
            SELECT SUM(
              GREATEST(
                sl.quantity - COALESCE((SELECT SUM(rl.quantity) FROM commerce_return_lines rl JOIN commerce_returns r ON r.id = rl.return_id WHERE rl.sale_line_id = sl.id), 0),
                0
              )
            )
            FROM commerce_sale_lines sl
            JOIN commerce_sales s ON s.id = sl.sale_id
            WHERE s.cancelled_at IS NULL
              AND sl.is_stock = false
              AND (${branch}::bigint IS NULL OR s.branch_id = ${branch}::bigint)
              AND s.created_at >= ${bounds.monthStart}::timestamptz
          ), 0)::text AS "catalogUnitsMonth"`,
    ]);

    const serInfo = serialSummaryRows[0];
    const soldSerialsMonth = Number(serInfo?.soldSerialsMonth ?? 0);
    const availableSerials = Number(serInfo?.availableSerialsBranch ?? 0);
    const stockUnitsNum = Number(serInfo?.stockUnitsMonth ?? "0");
    const catalogUnitsNum = Number(serInfo?.catalogUnitsMonth ?? "0");
    const totalUnitsNum = Math.round((stockUnitsNum + catalogUnitsNum) * 100) / 100;

    const topPointsRaw: PantherChartPoint[] =
      topItemRows.length > 0
        ? topItemRows.map((item, idx) => {
            const units = Number(item.netUnits);
            const valCents = toCents(item.netValue);
            return {
              label: item.itemName,
              shortLabel: item.sku ? item.sku.slice(0, 8) : `#${idx + 1}`,
              value: units,
              formattedValue: `${arNum.format(units)} وحدة`,
              detail: `صافي مبيعات الصنف: ${displayMoney(valCents)} ج.م`,
            };
          })
        : [
            {
              label: "بداية الشهر",
              shortLabel: "٠",
              value: 0,
              formattedValue: "0 وحدة",
            },
            {
              label: "لم تُسجّل وحدات مباعة بعد",
              shortLabel: "الآن",
              value: 0,
              formattedValue: "0 وحدة",
            },
          ];

    const topPoints =
      topPointsRaw.length === 1
        ? [
            {
              label: "نقطة البداية",
              shortLabel: "٠",
              value: 0,
              formattedValue: "0 وحدة",
            },
            topPointsRaw[0],
          ]
        : topPointsRaw;

    const mixPoints: PantherChartPoint[] = [
      {
        label: "سيريالات متاحة بمستودع فرعك",
        shortLabel: "سيريال متاح",
        value: availableSerials,
        formattedValue: `${arNum.format(availableSerials)} سيريال`,
        detail: "أجهزة برقم تسلسلي جاهزة للتسليم الفوري",
      },
      {
        label: "أجهزة تسلسلية مسلّمة هذا الشهر",
        shortLabel: "مسلّم",
        value: soldSerialsMonth,
        formattedValue: `${arNum.format(soldSerialsMonth)} سيريال`,
        detail: "أجهزة بيعت هذا الشهر ولم تُرتجع",
      },
      {
        label: "وحدات مخزنية مباعة",
        shortLabel: "مخزني",
        value: stockUnitsNum,
        formattedValue: `${arNum.format(stockUnitsNum)} وحدة`,
      },
      {
        label: "بنود كتالوج وخدمات فنية",
        shortLabel: "كتالوج",
        value: catalogUnitsNum,
        formattedValue: `${arNum.format(catalogUnitsNum)} بند`,
      },
    ];

    fifthSpotlight = {
      title: "حركة الأصناف والسيريالات",
      subtitle: `نشاط فرعك · ${opts.monthLabel}`,
      pill: `${arNum.format(totalUnitsNum)} وحدة`,
      primary: {
        label: "الوحدات المسلّمة هذا الشهر",
        value: arNum.format(totalUnitsNum),
        unit: "وحدة",
        delta: `${arNum.format(soldSerialsMonth)} جهاز برقم تسلسلي مسلّم للعملاء`,
        tone: "positive",
      },
      secondary: {
        label: "سيريالات جاهزة بمستودع فرعك",
        value: arNum.format(availableSerials),
        unit: "سيريال",
        delta:
          availableSerials > 0
            ? `${arNum.format(topItemRows.length)} صنف متداول هذا الشهر`
            : "لا توجد سيريالات متاحة حاليًا في مستودع الفرع",
        tone: availableSerials > 0 ? "positive" : "negative",
      },
      series: [
        { id: "top-items", label: "الأكثر حركة", points: topPoints },
        { id: "serial-mix", label: "السيريالات والأنواع", points: mixPoints },
      ],
      actionHref: opts.canAccessInventorySerials ? "/inventory/serials" : "/sales/new",
      actionLabel: opts.canAccessInventorySerials
        ? "استعراض سجل الأرقام التسلسلية"
        : "إنشاء فاتورة بيع جديدة",
    };
  }

  // ── شريط البحث الفوري الشامل (Feature #3) ──
  const normalizedQ = opts.searchQuery ? normalizeSearchQuery(opts.searchQuery) : "";
  let omniSearch: DashboardOmniSearchResults | null = null;

  if (normalizedQ.length >= 1) {
    const escapedLike = `%${normalizedQ.replace(/[%_\\]/g, "\\$&")}%`;
    const numericIdMatch = normalizedQ.replace(/^#/, "").trim();
    const exactSaleId = /^\d{1,15}$/.test(numericIdMatch) ? BigInt(numericIdMatch) : null;

    const [serialRows, saleRows, productRows] = await Promise.all([
      db.$queryRaw<
        Array<{
          serialId: string;
          serialNumber: string;
          productName: string;
          sku: string;
          warehouseName: string;
          branchName: string;
          saleId: string | null;
          customerName: string | null;
        }>
      >`
        SELECT
          ser.id::text AS "serialId",
          ser.serial_number AS "serialNumber",
          p.name_ar AS "productName",
          p.sku AS sku,
          w.name_ar AS "warehouseName",
          b.name_ar AS "branchName",
          s.id::text AS "saleId",
          s.customer_name AS "customerName"
        FROM inventory_serials ser
        LEFT JOIN inventory_openings io ON io.id = ser.opening_id
        LEFT JOIN inventory_receipts ir ON ir.id = ser.receipt_id
        JOIN warehouses w ON w.id = COALESCE(io.warehouse_id, ir.warehouse_id)
        JOIN branches b ON b.id = w.branch_id
        JOIN products p ON p.id = COALESCE(io.product_id, ir.product_id)
        LEFT JOIN commerce_sale_lines sl ON sl.id = ser.current_sale_line_id
        LEFT JOIN commerce_sales s ON s.id = sl.sale_id
        WHERE b.is_active = true
          AND (${branch}::bigint IS NULL OR w.branch_id = ${branch}::bigint OR s.branch_id = ${branch}::bigint)
          AND (
            ser.serial_number ILIKE ${escapedLike}
            OR ser.serial_key ILIKE ${escapedLike}
          )
        ORDER BY ser.id DESC
        LIMIT 6`,
      db.$queryRaw<
        Array<{
          saleId: string;
          customerName: string;
          customerPhone: string;
          branchId: string;
          createdAt: Date;
          cancelledAt: Date | null;
          netTotal: string;
          due: string;
        }>
      >`
        SELECT
          s.id::text AS "saleId",
          s.customer_name AS "customerName",
          s.customer_phone AS "customerPhone",
          s.branch_id::text AS "branchId",
          s.created_at AS "createdAt",
          s.cancelled_at AS "cancelledAt",
          (
            s.total - COALESCE((SELECT SUM(rl.total) FROM commerce_return_lines rl JOIN commerce_returns r ON r.id = rl.return_id WHERE r.sale_id = s.id), 0)
          )::text AS "netTotal",
          CASE
            WHEN s.cancelled_at IS NOT NULL THEN '0.00'
            ELSE GREATEST(
              s.total
              - COALESCE((SELECT SUM(rl.total) FROM commerce_return_lines rl JOIN commerce_returns r ON r.id = rl.return_id WHERE r.sale_id = s.id), 0)
              - (
                  COALESCE((SELECT SUM(c.amount) FROM commerce_collections c WHERE c.sale_id = s.id), 0)
                  - COALESCE((SELECT SUM(rf.amount) FROM commerce_refunds rf WHERE rf.sale_id = s.id), 0)
                ),
              0
            )::text
          END AS due
        FROM commerce_sales s
        WHERE (${branch}::bigint IS NULL OR s.branch_id = ${branch}::bigint)
          AND (
            (${exactSaleId}::bigint IS NOT NULL AND s.id = ${exactSaleId}::bigint)
            OR s.customer_name ILIKE ${escapedLike}
            OR s.customer_phone ILIKE ${escapedLike}
          )
        ORDER BY s.id DESC
        LIMIT 6`,
      db.$queryRaw<
        Array<{
          productId: string;
          sku: string;
          nameAr: string;
          salePrice: string;
          isSerialized: boolean;
          qtyOnHand: string;
        }>
      >`
        SELECT
          p.id::text AS "productId",
          p.sku AS sku,
          p.name_ar AS "nameAr",
          p.sale_price::text AS "salePrice",
          p.is_serialized AS "isSerialized",
          COALESCE((
            SELECT SUM(sl.qty_on_hand)
            FROM stock_levels sl
            JOIN warehouses w ON w.id = sl.warehouse_id
            JOIN branches b ON b.id = w.branch_id
            WHERE sl.product_id = p.id
              AND w.is_active = true
              AND w.holds_stock = true
              AND b.is_active = true
              AND (${branch}::bigint IS NULL OR w.branch_id = ${branch}::bigint)
          ), 0)::text AS "qtyOnHand"
        FROM products p
        WHERE p.is_active = true
          AND (
            p.sku ILIKE ${escapedLike}
            OR p.name_ar ILIKE ${escapedLike}
          )
        ORDER BY p.id DESC
        LIMIT 4`,
    ]);

    const serials: DashboardOmniSerialHit[] = serialRows.map((r) => ({
      serialId: r.serialId,
      serialNumber: r.serialNumber,
      productName: r.productName,
      sku: r.sku,
      warehouseName: r.warehouseName,
      branchName: r.branchName,
      isAvailable: r.saleId === null,
      customerName: r.customerName,
      saleId: r.saleId,
    }));

    const sales: DashboardOmniSaleHit[] = saleRows.map((r) => {
      const dueCents = toCents(r.due);
      const isCancelled = r.cancelledAt !== null;
      const hasDue = !isCancelled && dueCents > 0n;
      return {
        saleId: r.saleId,
        customerName: r.customerName,
        customerPhone: r.customerPhone,
        branchName: branchNames.get(r.branchId) ?? "الفرع",
        createdAtIso: new Date(r.createdAt).toISOString(),
        netTotalFormatted: displayMoney(toCents(r.netTotal)),
        dueFormatted: displayMoney(dueCents),
        hasDue,
        isCancelled,
        statusLabel: isCancelled
          ? "ملغاة"
          : hasDue
            ? `متبقٍّ ${displayMoney(dueCents)} ج.م`
            : "مسدّدة بالكامل",
        tone: isCancelled ? "danger" : hasDue ? "warning" : "positive",
      };
    });

    const products: DashboardOmniProductHit[] = productRows.map((p) => ({
      productId: p.productId,
      sku: p.sku,
      nameAr: p.nameAr,
      salePriceFormatted: displayMoney(toCents(p.salePrice)),
      qtyOnHandFormatted: arNum.format(Number(p.qtyOnHand)),
      isSerialized: Boolean(p.isSerialized),
    }));

    omniSearch = {
      query: normalizedQ,
      totalHits: serials.length + sales.length + products.length,
      serials,
      sales,
      products,
    };
  }

  // ── الحزمة المركّبة الثلاثية: الكفاءة الشاملة + التحوّل النقدي الصافي + تقييم وكفاءة الفروع ──
  const [salesDayBranchRows, collectionsDayBranchRows, branchEvalRows] = await Promise.all([
    db.$queryRaw<
      Array<{
        dayKey: string;
        branchId: string;
        netSales: string;
        discounts: string;
        partialReturns: string;
        subtotal: string;
      }>
    >`
      SELECT
        TO_CHAR(s.created_at AT TIME ZONE 'Africa/Cairo', 'YYYY-MM-DD') AS "dayKey",
        s.branch_id::text AS "branchId",
        COALESCE(
          SUM(
            s.total - COALESCE(
              (SELECT SUM(rl.total) FROM commerce_return_lines rl JOIN commerce_returns r ON r.id = rl.return_id WHERE r.sale_id = s.id),
              0
            )
          ),
          0
        )::text AS "netSales",
        COALESCE(SUM(s.discount), 0)::text AS discounts,
        COALESCE(
          SUM((
            SELECT COALESCE(SUM(rl2.total), 0)
            FROM commerce_return_lines rl2
            JOIN commerce_returns r2 ON r2.id = rl2.return_id
            WHERE r2.sale_id = s.id AND r2.is_cancellation = false
          )),
          0
        )::text AS "partialReturns",
        COALESCE(SUM(s.subtotal), 0)::text AS subtotal
      FROM commerce_sales s
      WHERE s.cancelled_at IS NULL
        AND (${branch}::bigint IS NULL OR s.branch_id = ${branch}::bigint)
        AND s.created_at >= ${bounds.monthStart}::timestamptz
      GROUP BY 1, 2
      ORDER BY 1 ASC`,
    db.$queryRaw<
      Array<{
        dayKey: string;
        branchId: string;
        netCollected: string;
      }>
    >`
      SELECT
        ev."dayKey",
        ev."branchId",
        COALESCE(SUM(ev.delta), 0)::text AS "netCollected"
      FROM (
        SELECT
          TO_CHAR(c.created_at AT TIME ZONE 'Africa/Cairo', 'YYYY-MM-DD') AS "dayKey",
          s.branch_id::text AS "branchId",
          c.amount AS delta
        FROM commerce_collections c
        JOIN commerce_sales s ON s.id = c.sale_id
        WHERE s.cancelled_at IS NULL
          AND (${branch}::bigint IS NULL OR s.branch_id = ${branch}::bigint)
          AND c.created_at >= ${bounds.monthStart}::timestamptz
        UNION ALL
        SELECT
          TO_CHAR(rf.created_at AT TIME ZONE 'Africa/Cairo', 'YYYY-MM-DD') AS "dayKey",
          s.branch_id::text AS "branchId",
          (-rf.amount) AS delta
        FROM commerce_refunds rf
        JOIN commerce_sales s ON s.id = rf.sale_id
        WHERE s.cancelled_at IS NULL
          AND (${branch}::bigint IS NULL OR s.branch_id = ${branch}::bigint)
          AND rf.created_at >= ${bounds.monthStart}::timestamptz
      ) ev
      GROUP BY 1, 2
      ORDER BY 1 ASC`,
    db.$queryRaw<
      Array<{
        branchId: string;
        branchName: string;
        monthNetSales: string;
        allTimeNetSales: string;
        openDueTotal: string;
        over30DueTotal: string;
        totalStockRows: number;
        zeroStockRows: number;
        lowStockRows: number;
      }>
    >`
      SELECT
        b.id::text AS "branchId",
        b.name_ar AS "branchName",
        COALESCE((
          SELECT SUM(
            s.total - COALESCE((SELECT SUM(rl.total) FROM commerce_return_lines rl JOIN commerce_returns r ON r.id = rl.return_id WHERE r.sale_id = s.id), 0)
          )
          FROM commerce_sales s
          WHERE s.branch_id = b.id AND s.cancelled_at IS NULL AND s.created_at >= ${bounds.monthStart}::timestamptz
        ), 0)::text AS "monthNetSales",
        COALESCE((
          SELECT SUM(
            s.total - COALESCE((SELECT SUM(rl.total) FROM commerce_return_lines rl JOIN commerce_returns r ON r.id = rl.return_id WHERE r.sale_id = s.id), 0)
          )
          FROM commerce_sales s
          WHERE s.branch_id = b.id AND s.cancelled_at IS NULL
        ), 0)::text AS "allTimeNetSales",
        COALESCE((
          SELECT SUM(
            GREATEST(
              s.total
              - COALESCE((SELECT SUM(rl.total) FROM commerce_return_lines rl JOIN commerce_returns r ON r.id = rl.return_id WHERE r.sale_id = s.id), 0)
              - (
                  COALESCE((SELECT SUM(c.amount) FROM commerce_collections c WHERE c.sale_id = s.id), 0)
                  - COALESCE((SELECT SUM(rf.amount) FROM commerce_refunds rf WHERE rf.sale_id = s.id), 0)
                ),
              0
            )
          )
          FROM commerce_sales s
          WHERE s.branch_id = b.id AND s.cancelled_at IS NULL
        ), 0)::text AS "openDueTotal",
        COALESCE((
          SELECT SUM(
            GREATEST(
              s.total
              - COALESCE((SELECT SUM(rl.total) FROM commerce_return_lines rl JOIN commerce_returns r ON r.id = rl.return_id WHERE r.sale_id = s.id), 0)
              - (
                  COALESCE((SELECT SUM(c.amount) FROM commerce_collections c WHERE c.sale_id = s.id), 0)
                  - COALESCE((SELECT SUM(rf.amount) FROM commerce_refunds rf WHERE rf.sale_id = s.id), 0)
                ),
              0
            )
          )
          FROM commerce_sales s
          WHERE s.branch_id = b.id
            AND s.cancelled_at IS NULL
            AND ((NOW() AT TIME ZONE 'Africa/Cairo')::date - (s.created_at AT TIME ZONE 'Africa/Cairo')::date) >= 30
        ), 0)::text AS "over30DueTotal",
        (
          SELECT COUNT(*)::int
          FROM stock_levels sl
          JOIN warehouses w ON w.id = sl.warehouse_id
          JOIN products p ON p.id = sl.product_id
          WHERE w.branch_id = b.id AND w.is_active = true AND w.holds_stock = true AND p.is_active = true AND p.category <> 'SERVICE'
        ) AS "totalStockRows",
        (
          SELECT COUNT(*)::int
          FROM stock_levels sl
          JOIN warehouses w ON w.id = sl.warehouse_id
          JOIN products p ON p.id = sl.product_id
          WHERE w.branch_id = b.id AND w.is_active = true AND w.holds_stock = true AND p.is_active = true AND p.category <> 'SERVICE'
            AND sl.qty_on_hand <= 0
        ) AS "zeroStockRows",
        (
          SELECT COUNT(*)::int
          FROM stock_levels sl
          JOIN warehouses w ON w.id = sl.warehouse_id
          JOIN products p ON p.id = sl.product_id
          WHERE w.branch_id = b.id AND w.is_active = true AND w.holds_stock = true AND p.is_active = true AND p.category <> 'SERVICE'
            AND sl.qty_on_hand > 0 AND sl.qty_on_hand <= 2
        ) AS "lowStockRows"
      FROM branches b
      WHERE b.is_active = true
        AND (${branch}::bigint IS NULL OR b.id = ${branch}::bigint)
      ORDER BY b.code ASC`,
  ]);

  // ── أ) حساب «مؤشر التحوّل النقدي الصافي» (Cash Conversion Index) ──
  const paidFlow = opts.paidExpenseFlow ?? {
    monthPaidCentsStr: "0",
    monthPaidByDayCents: {},
    monthPaidByBranchIdCents: {},
  };
  const mtdPaidExpensesCents = toCents(paidFlow.monthPaidCentsStr);

  let mtdCollectedTotalCents = 0n;
  let mtdSubtotalCents = 0n;
  let mtdLeakageCents = 0n; // خصومات + مرتجعات جزئية
  const bookSalesByDay = new Map<string, bigint>();
  const collectedByDay = new Map<string, bigint>();
  const collectedByBranch = new Map<string, bigint>();
  const bookSalesByBranch = new Map<string, bigint>();

  for (const r of salesDayBranchRows) {
    const ns = toCents(r.netSales);
    mtdSubtotalCents += toCents(r.subtotal);
    mtdLeakageCents += toCents(r.discounts) + toCents(r.partialReturns);
    bookSalesByDay.set(r.dayKey, (bookSalesByDay.get(r.dayKey) ?? 0n) + ns);
    bookSalesByBranch.set(r.branchId, (bookSalesByBranch.get(r.branchId) ?? 0n) + ns);
  }
  for (const r of collectionsDayBranchRows) {
    const nc = toCents(r.netCollected);
    mtdCollectedTotalCents += nc;
    collectedByDay.set(r.dayKey, (collectedByDay.get(r.dayKey) ?? 0n) + nc);
    collectedByBranch.set(r.branchId, (collectedByBranch.get(r.branchId) ?? 0n) + nc);
  }

  const netCashRetainedCents = mtdCollectedTotalCents - mtdPaidExpensesCents;
  const grossCollectionPct =
    mtdCents > 0n
      ? Math.round((Number(mtdCollectedTotalCents) / Number(mtdCents)) * 1000) / 10
      : mtdCollectedTotalCents > 0n
        ? 100
        : 0;
  const netRetainedPer100 =
    mtdCents > 0n
      ? Math.round((Number(netCashRetainedCents) / Number(mtdCents)) * 1000) / 10
      : netCashRetainedCents > 0n
        ? 100
        : 0;

  const cashAllDays = Array.from(
    new Set([
      ...bookSalesByDay.keys(),
      ...collectedByDay.keys(),
      ...Object.keys(paidFlow.monthPaidByDayCents),
    ]),
  ).sort();

  const dailyConversionPoints: PantherChartPoint[] = [
    {
      label: "بداية الشهر",
      shortLabel: "٠",
      value: 0,
      formattedValue: "0.00 ج.م",
      secondaryValue: 0,
      secondaryLabel: "صافي المبيعات",
      secondaryFormatted: "0.00 ج.م",
    },
  ];
  if (cashAllDays.length === 0) {
    dailyConversionPoints.push({
      label: "الآن — بانتظار أول حركة",
      shortLabel: "الآن",
      value: 0,
      formattedValue: "0.00 ج.م",
      secondaryValue: 0,
      secondaryLabel: "صافي المبيعات",
      secondaryFormatted: "0.00 ج.م",
    });
  } else {
    let cumSales = 0n;
    let cumRetained = 0n;
    for (const dKey of cashAllDays) {
      const dSales = bookSalesByDay.get(dKey) ?? 0n;
      const dCol = collectedByDay.get(dKey) ?? 0n;
      const dPaid = toCents(paidFlow.monthPaidByDayCents[dKey] ?? "0");
      cumSales += dSales;
      cumRetained += dCol - dPaid;
      dailyConversionPoints.push({
        label: `يوم ${dKey}`,
        shortLabel: dKey.slice(5),
        value: Number(cumRetained) / 100,
        formattedValue: `${displayMoney(cumRetained)} ج.م`,
        secondaryValue: Number(cumSales) / 100,
        secondaryLabel: "صافي المبيعات",
        secondaryFormatted: `${displayMoney(cumSales)} ج.م`,
        detail: `محصّل اليوم ${displayMoney(dCol)} ج.م − مدفوع ${displayMoney(dPaid)} ج.م`,
      });
    }
  }

  const cashFunnelPoints: PantherChartPoint[] = [
    {
      label: "١. صافي المبيعات الدفترية",
      shortLabel: "المبيعات",
      value: Number(mtdCents) / 100,
      formattedValue: `${displayMoney(mtdCents)} ج.م`,
      detail: "إجمالي مبيعات الشهر الصافية بعد المرتجعات",
    },
    {
      label: "٢. المحصّل الفعلي (نقدي وإلكتروني)",
      shortLabel: "المحصّل",
      value: Number(mtdCollectedTotalCents) / 100,
      formattedValue: `${displayMoney(mtdCollectedTotalCents)} ج.م`,
      detail: `نسبة التحويل التحصيلي: ${arNum.format(grossCollectionPct)}%`,
    },
    {
      label: "٣. المصروفات المدفوعة فعليًا",
      shortLabel: "المدفوع",
      value: Number(mtdPaidExpensesCents) / 100,
      formattedValue: `${displayMoney(mtdPaidExpensesCents)} ج.م`,
      detail: opts.canManage
        ? "المصروفات المسدّدة فعليًا في النطاق المعروض"
        : "المصروفات المسدّدة على حسابك هذا الشهر",
    },
    {
      label: "٤. صافي النقد المحتفظ به",
      shortLabel: "صافي النقد",
      value: Number(netCashRetainedCents) / 100,
      formattedValue: `${displayMoney(netCashRetainedCents)} ج.م`,
      detail: `${arNum.format(netRetainedPer100)} ج.م صافي من كل ١٠٠ ج.م مبيعات`,
    },
  ];

  const cashBranchRaw: PantherChartPoint[] = opts.branches.map((b) => {
    const bCol = collectedByBranch.get(b.id) ?? 0n;
    const bPaid = toCents(paidFlow.monthPaidByBranchIdCents[b.id] ?? "0");
    const bRetained = bCol - bPaid;
    return {
      label: b.nameAr,
      shortLabel: b.nameAr.replace(/^فرع\s+/, ""),
      value: Number(bRetained) / 100,
      formattedValue: `${displayMoney(bRetained)} ج.م`,
      secondaryValue: Number(bCol) / 100,
      secondaryLabel: "المحصّل الفعلي",
      secondaryFormatted: `${displayMoney(bCol)} ج.م`,
      detail: `مبيعات الفرع: ${displayMoney(bookSalesByBranch.get(b.id) ?? 0n)} ج.م`,
    };
  });
  const cashBranchPoints: PantherChartPoint[] =
    cashBranchRaw.length === 1
      ? [
          {
            label: "نقطة الأساس",
            shortLabel: "٠",
            value: 0,
            formattedValue: "0.00 ج.م",
            secondaryValue: 0,
            secondaryLabel: "المحصّل الفعلي",
            secondaryFormatted: "0.00 ج.م",
          },
          cashBranchRaw[0],
        ]
      : cashBranchRaw;

  const cashConversionSeries: PantherChartSeries[] = [
    {
      id: "cash-funnel",
      label: "قمع السيولة",
      chartVariant: "waterfall",
      points: cashFunnelPoints,
    },
    {
      id: "daily-conversion",
      label: "المسار اليومي",
      chartVariant: "area",
      points: dailyConversionPoints,
    },
    ...(opts.canManage && cashBranchPoints.length > 0
      ? [
          {
            id: "branch-conversion",
            label: "حسب الفرع",
            chartVariant: "columns" as const,
            points: cashBranchPoints,
          },
        ]
      : []),
  ];

  const cashConversionSpotlight: DashboardSpotlightData = {
    title: "مؤشر التحوّل النقدي الصافي",
    subtitle: `المبيعات ← التحصيل ← الصافي · ${opts.monthLabel}`,
    pill: `تحصيل ${arNum.format(grossCollectionPct)}%`,
    primary: {
      label: "صافي النقد من كل ١٠٠ ج.م بيع",
      value: arNum.format(netRetainedPer100),
      unit: "ج.م / ١٠٠",
      delta: `صافي السيولة المحتفظ بها بالشهر: ${displayMoney(netCashRetainedCents)} ج.م`,
      tone: netCashRetainedCents >= 0n ? "positive" : "negative",
    },
    secondary: {
      label: "إجمالي المحصّل الفعلي هذا الشهر",
      value: displayMoney(mtdCollectedTotalCents),
      unit: "ج.م",
      delta: `مبيعات دفترية ${displayMoney(mtdCents)} ج.م · مدفوع ${displayMoney(mtdPaidExpensesCents)} ج.م`,
      tone: grossCollectionPct >= 75 || mtdCents === 0n ? "positive" : "negative",
    },
    series: cashConversionSeries,
    actionHref: opts.canAccessFinance
      ? opts.canManage
        ? "/finance"
        : "/finance/mine"
      : "/sales",
    actionLabel: opts.canAccessFinance
      ? opts.canManage
        ? "مراجعة حركة السيولة والخزائن"
        : "مراجعة عهدتي النقدية"
      : "مراجعة الفواتير والتحصيلات",
  };

  // ── ب) حساب «مؤشر تقييم وكفاءة الفروع» (Branch Performance Scorecard /100) ──
  const maxBranchMonthSales = branchEvalRows.reduce((mx, r) => {
    const v = toCents(r.monthNetSales);
    return v > mx ? v : mx;
  }, 0n);

  type EvaluatedBranch = {
    branchId: string;
    branchName: string;
    score: number;
    salesScore: number;
    collectionScore: number;
    custodyScore: number;
    stockScore: number;
    strongestLabel: string;
    strongestScore: number;
    weakestLabel: string;
    weakestScore: number;
  };

  const staleMap = opts.financeOpsSummary?.staleByBranchId ?? {};
  const varianceMap = opts.financeOpsSummary?.varianceByBranchId ?? {};

  const evaluatedBranches: EvaluatedBranch[] = branchEvalRows.map((row) => {
    const bMonthSales = toCents(row.monthNetSales);
    const bAllSales = toCents(row.allTimeNetSales);
    const bDue = toCents(row.openDueTotal);
    const bOver30 = toCents(row.over30DueTotal);

    // ١. نشاط المبيعات (30%)
    const salesScore =
      maxBranchMonthSales > 0n
        ? clampScore(35 + (Number(bMonthSales) / Number(maxBranchMonthSales)) * 65)
        : bAllSales > 0n
          ? 65
          : 50;

    // ٢. جودة التحصيل وقلة المتأخرات (30%)
    let collectionScore = 100;
    if (bDue > 0n) {
      const denom = bAllSales > bDue ? Number(bAllSales) : Number(bDue) * 2;
      const dueRatio = denom > 0 ? (Number(bDue) / denom) * 100 : 0;
      const over30Ratio = (Number(bOver30) / Number(bDue)) * 100;
      collectionScore = clampScore(100 - dueRatio * 0.7 - over30Ratio * 0.25);
    }

    // ٣. انضباط العهد والتسويات (20%)
    let custodyScore = 100;
    if (opts.canManage) {
      const stCount = staleMap[row.branchId] ?? 0;
      const vrCount = varianceMap[row.branchId] ?? 0;
      custodyScore = clampScore(100 - stCount * 30 - vrCount * 18);
    } else if (opts.employeeCustodyState) {
      custodyScore = clampScore(
        100 -
          (opts.employeeCustodyState.settlementStale ? 35 : 0) -
          opts.employeeCustodyState.pendingActionsCount * 8,
      );
    }

    // ٤. توافر وجاهزية المخزون (20%)
    const totalRows = Math.max(0, Number(row.totalStockRows));
    const zeroRows = Math.max(0, Number(row.zeroStockRows));
    const lowRows = Math.max(0, Number(row.lowStockRows));
    const stockScore =
      totalRows > 0
        ? clampScore((1 - (zeroRows * 1.0 + lowRows * 0.5) / totalRows) * 100)
        : 85;

    const score = clampScore(
      salesScore * 0.3 +
        collectionScore * 0.3 +
        custodyScore * 0.2 +
        stockScore * 0.2,
    );

    const axes = [
      { label: "نشاط المبيعات", val: salesScore },
      { label: "جودة التحصيل", val: collectionScore },
      { label: "انضباط العهد", val: custodyScore },
      { label: "جاهزية المخزون", val: stockScore },
    ].sort((a, b) => b.val - a.val);

    return {
      branchId: row.branchId,
      branchName: row.branchName,
      score,
      salesScore,
      collectionScore,
      custodyScore,
      stockScore,
      strongestLabel: axes[0].label,
      strongestScore: axes[0].val,
      weakestLabel: axes[axes.length - 1].label,
      weakestScore: axes[axes.length - 1].val,
    };
  });

  const branchScoresById: Record<string, DashboardBranchScoreBadge> = {};
  for (const eb of evaluatedBranches) {
    const tone: DashboardBranchScoreBadge["tone"] =
      eb.score >= 80 ? "positive" : eb.score >= 60 ? "warning" : "danger";
    const gradeLabel =
      eb.score >= 80 ? "ممتاز" : eb.score >= 60 ? "مستقر" : "يحتاج متابعة";
    branchScoresById[eb.branchId] = {
      score: eb.score,
      gradeLabel,
      tone,
    };
  }

  const rankedBranches = evaluatedBranches.slice().sort((a, b) => b.score - a.score);
  const avgBranchScore =
    rankedBranches.length > 0
      ? clampScore(
          rankedBranches.reduce((acc, b) => acc + b.score, 0) / rankedBranches.length,
        )
      : 0;
  const topBranch = rankedBranches[0] ?? {
    branchId: "0",
    branchName: "النطاق الحالي",
    score: 0,
    salesScore: 0,
    collectionScore: 0,
    custodyScore: 0,
    stockScore: 0,
    strongestLabel: "التحصيل",
    strongestScore: 0,
    weakestLabel: "المبيعات",
    weakestScore: 0,
  };
  const bottomBranch = rankedBranches[rankedBranches.length - 1] ?? topBranch;

  const branchRankRaw: PantherChartPoint[] = rankedBranches.map((eb) => ({
    label: eb.branchName,
    shortLabel: eb.branchName.replace(/^فرع\s+/, ""),
    value: eb.score,
    formattedValue: `${arNum.format(eb.score)} / 100`,
    secondaryValue: eb.collectionScore,
    secondaryLabel: "جودة التحصيل",
    secondaryFormatted: `${arNum.format(eb.collectionScore)} / 100`,
    detail: `مبيعات ${arNum.format(eb.salesScore)}% · عهد ${arNum.format(eb.custodyScore)}% · مخزون ${arNum.format(eb.stockScore)}%`,
  }));
  const branchRankPoints: PantherChartPoint[] =
    branchRankRaw.length === 1
      ? [
          {
            label: "المعيار المستهدف",
            shortLabel: "المعيار",
            value: 80,
            formattedValue: "80 / 100",
            secondaryValue: 80,
            secondaryLabel: "جودة التحصيل",
            secondaryFormatted: "80 / 100",
            detail: "خط القياس المستهدف لكفاءة الفرع",
          },
          branchRankRaw[0],
        ]
      : branchRankRaw;

  const avgAxis = (pick: (eb: EvaluatedBranch) => number) =>
    rankedBranches.length > 0
      ? clampScore(
          rankedBranches.reduce((acc, eb) => acc + pick(eb), 0) / rankedBranches.length,
        )
      : 0;

  const branchAxesPoints: PantherChartPoint[] = [
    {
      label: "نشاط المبيعات (30%)",
      shortLabel: "المبيعات",
      value: avgAxis((x) => x.salesScore),
      formattedValue: `${arNum.format(avgAxis((x) => x.salesScore))} / 100`,
      secondaryValue: 80,
      secondaryLabel: "المستهدف",
      secondaryFormatted: "80 / 100",
    },
    {
      label: "جودة التحصيل (30%)",
      shortLabel: "التحصيل",
      value: avgAxis((x) => x.collectionScore),
      formattedValue: `${arNum.format(avgAxis((x) => x.collectionScore))} / 100`,
      secondaryValue: 80,
      secondaryLabel: "المستهدف",
      secondaryFormatted: "80 / 100",
    },
    {
      label: "انضباط العهد (20%)",
      shortLabel: "العهد",
      value: avgAxis((x) => x.custodyScore),
      formattedValue: `${arNum.format(avgAxis((x) => x.custodyScore))} / 100`,
      secondaryValue: 80,
      secondaryLabel: "المستهدف",
      secondaryFormatted: "80 / 100",
    },
    {
      label: "جاهزية المخزون (20%)",
      shortLabel: "المخزون",
      value: avgAxis((x) => x.stockScore),
      formattedValue: `${arNum.format(avgAxis((x) => x.stockScore))} / 100`,
      secondaryValue: 80,
      secondaryLabel: "المستهدف",
      secondaryFormatted: "80 / 100",
    },
  ];

  const branchEfficiencySpotlight: DashboardSpotlightData = {
    title: "مؤشر تقييم وكفاءة الفروع",
    subtitle:
      rankedBranches.length > 1
        ? `مقارنة ${arNum.format(rankedBranches.length)} فروع نشطة · من ١٠٠`
        : `تقييم ${topBranch.branchName} · من ١٠٠`,
    pill: `متوسط ${arNum.format(avgBranchScore)}/100`,
    primary:
      rankedBranches.length > 1
        ? {
            label: "الفرع الأعلى كفاءةً الآن",
            value: arNum.format(topBranch.score),
            unit: "/ 100",
            delta: `${topBranch.branchName} — أقوى محور: ${topBranch.strongestLabel} (${arNum.format(topBranch.strongestScore)}%)`,
            tone: topBranch.score >= 65 ? "positive" : "negative",
          }
        : {
            label: `درجة كفاءة ${topBranch.branchName}`,
            value: arNum.format(topBranch.score),
            unit: "/ 100",
            delta: `أقوى محور: ${topBranch.strongestLabel} (${arNum.format(topBranch.strongestScore)}%)`,
            tone: topBranch.score >= 65 ? "positive" : "negative",
          },
    secondary:
      rankedBranches.length > 1
        ? {
            label: "الفرع الأجدر بالدعم والمتابعة",
            value: arNum.format(bottomBranch.score),
            unit: "/ 100",
            delta: `${bottomBranch.branchName} — فرصة تحسين في ${bottomBranch.weakestLabel} (${arNum.format(bottomBranch.weakestScore)}%)`,
            tone: bottomBranch.score >= 70 ? "positive" : "negative",
          }
        : {
            label: "المحور الأجدر بالتحسين بالفرع",
            value: arNum.format(topBranch.weakestScore),
            unit: "/ 100",
            delta: `${topBranch.weakestLabel} — المعيار المستهدف 80 / 100`,
            tone: topBranch.weakestScore >= 70 ? "positive" : "negative",
          },
    series: [
      { id: "branch-ranking", label: "تقييم الفروع", points: branchRankPoints },
      { id: "branch-axes", label: "محاور التقييم", points: branchAxesPoints },
    ],
    actionHref: opts.canAccessSalesStats
      ? opts.branchId
        ? `/sales/stats?period=month&branch=${opts.branchId}`
        : "/sales/stats?period=month"
      : "/sales",
    actionLabel: opts.canAccessSalesStats
      ? "مقارنة الفروع في لوحة التحليلات"
      : "استعراض فواتير الفرع",
  };

  // ── ج) حساب «مؤشر الكفاءة التشغيلية الشامل» (Composite Efficiency Score /100) ──
  // ١. جودة التحصيل وأعمار الذمم (30%)
  const over30Bucket = bucketMap.get("over30") ?? { cents: 0n, count: 0 };
  const over30SharePct =
    totalDueCents > 0n ? (Number(over30Bucket.cents) / Number(totalDueCents)) * 100 : 0;
  const baseCollectionScore =
    mtdCents > 0n
      ? clampScore(grossCollectionPct)
      : totalDueCents === 0n
        ? 100
        : 68;
  const pillarCollection = clampScore(baseCollectionScore - over30SharePct * 0.35);

  // ٢. كفاءة التشغيل وضبط المصروفات للإدارة (أو انضباط الفواتير للكاونتر) (25%)
  const leakagePct =
    mtdSubtotalCents > 0n ? (Number(mtdLeakageCents) / Number(mtdSubtotalCents)) * 100 : 0;
  let pillarOperations = 85;
  if (opts.canManage) {
    const recExpCents = toCents(opts.financeOpsSummary?.monthRecognizedExpensesCentsStr ?? "0");
    if (mtdCents > 0n) {
      const expRatioPct = (Number(recExpCents) / Number(mtdCents)) * 100;
      pillarOperations = clampScore(100 - expRatioPct * 0.65 - Math.max(0, leakagePct - 5) * 1.5);
    } else {
      pillarOperations = recExpCents === 0n ? 80 : 52;
    }
  } else {
    pillarOperations =
      mtdSubtotalCents > 0n ? clampScore(100 - leakagePct * 2.2) : 85;
  }

  // ٣. وتيرة نمو المبيعات (20%)
  const pillarPace =
    paceVsLastMonthPct !== null
      ? clampScore(75 + paceVsLastMonthPct, 20, 100)
      : mtdCents > 0n
        ? 88
        : 55;

  // ٤. انضباط العهد والاعتمادات (15%)
  let pillarCustody = 100;
  if (opts.canManage) {
    const st = opts.financeOpsSummary?.staleOpenSettlementsCount ?? 0;
    const vr = opts.financeOpsSummary?.varianceSettlementsCount ?? 0;
    const bk = opts.financeOpsSummary?.pendingBacklogCount ?? 0;
    pillarCustody = clampScore(100 - st * 25 - vr * 15 - bk * 5);
  } else if (opts.employeeCustodyState) {
    pillarCustody = clampScore(
      100 -
        (opts.employeeCustodyState.settlementStale ? 35 : 0) -
        opts.employeeCustodyState.pendingActionsCount * 8,
    );
  }

  // ٥. جاهزية المخزون وتوافر الأصناف (10%)
  const totalScopeStockRows = branchEvalRows.reduce((s, r) => s + Number(r.totalStockRows), 0);
  const totalScopeZeroRows = branchEvalRows.reduce((s, r) => s + Number(r.zeroStockRows), 0);
  const totalScopeLowRows = branchEvalRows.reduce((s, r) => s + Number(r.lowStockRows), 0);
  const pillarStock =
    totalScopeStockRows > 0
      ? clampScore(
          (1 - (totalScopeZeroRows * 1.0 + totalScopeLowRows * 0.5) / totalScopeStockRows) * 100,
        )
      : 85;

  const compositeList = [
    {
      id: "col",
      label: "جودة التحصيل وأعمار الذمم",
      shortLabel: "التحصيل",
      weight: 30,
      score: pillarCollection,
    },
    {
      id: "ops",
      label: opts.canManage ? "صافي التشغيل وضبط المصروفات" : "انضباط الفواتير والخصومات",
      shortLabel: opts.canManage ? "التشغيل" : "الفواتير",
      weight: 25,
      score: pillarOperations,
    },
    {
      id: "pace",
      label: "وتيرة نمو المبيعات",
      shortLabel: "الوتيرة",
      weight: 20,
      score: pillarPace,
    },
    {
      id: "custody",
      label: "انضباط العهد والاعتمادات",
      shortLabel: "العهد",
      weight: 15,
      score: pillarCustody,
    },
    {
      id: "stock",
      label: "جاهزية المخزون",
      shortLabel: "المخزون",
      weight: 10,
      score: pillarStock,
    },
  ];

  const compositeTotal = clampScore(
    compositeList.reduce((acc, p) => acc + (p.score * p.weight) / 100, 0),
  );
  const compositeGrade =
    compositeTotal >= 80 ? "ممتاز" : compositeTotal >= 60 ? "مستقر" : "يحتاج متابعة";
  const sortedPillars = compositeList.slice().sort((a, b) => b.score - a.score);
  const strongestPillar = sortedPillars[0];
  const weakestPillar = sortedPillars[sortedPillars.length - 1];

  const compositeEfficiencySpotlight: DashboardSpotlightData = {
    title: "مؤشر الكفاءة التشغيلية الشامل",
    subtitle: `يجمع ٥ مؤشرات حيّة · ${opts.monthLabel}`,
    pill: `${compositeGrade} · ${arNum.format(compositeTotal)}/100`,
    primary: {
      label: "الدرجة المركّبة للأداء العام",
      value: arNum.format(compositeTotal),
      unit: "/ 100",
      delta: `أعلى محور: ${strongestPillar.label} (${arNum.format(strongestPillar.score)}%)`,
      tone: compositeTotal >= 65 ? "positive" : "negative",
    },
    secondary: {
      label: "أولوية التحسين لرفع الدرجة",
      value: arNum.format(weakestPillar.score),
      unit: "/ 100",
      delta: `${weakestPillar.label} (وزن ${arNum.format(weakestPillar.weight)}% من المؤشر الكلي)`,
      tone: weakestPillar.score >= 70 ? "positive" : "negative",
    },
    series: [
      {
        id: "pillar-scores",
        label: "درجة كل محور",
        points: compositeList.map((p) => ({
          label: `${p.label} (${p.weight}%)`,
          shortLabel: p.shortLabel,
          value: p.score,
          formattedValue: `${arNum.format(p.score)} / 100`,
          secondaryValue: 80,
          secondaryLabel: "المعيار المستهدف",
          secondaryFormatted: "80 / 100",
          detail: `يساهم بـ ${arNum.format(Math.round(((p.score * p.weight) / 100) * 10) / 10)} من ${p.weight} نقطة`,
        })),
      },
      {
        id: "weighted-points",
        label: "الوزن المكتسب",
        points: compositeList.map((p) => {
          const earned = Math.round(((p.score * p.weight) / 100) * 10) / 10;
          return {
            label: p.label,
            shortLabel: p.shortLabel,
            value: earned,
            formattedValue: `${arNum.format(earned)} نقطة`,
            secondaryValue: p.weight,
            secondaryLabel: "الوزن الأقصى",
            secondaryFormatted: `${arNum.format(p.weight)} نقطة`,
            detail: `تحقّق ${arNum.format(p.score)}% من وزن المحور`,
          };
        }),
      },
    ],
    actionHref: opts.canAccessSalesStats
      ? opts.branchId
        ? `/sales/stats?period=month&branch=${opts.branchId}`
        : "/sales/stats?period=month"
      : "/sales",
    actionLabel: opts.canAccessSalesStats
      ? "تحليل محاور الأداء بالتفصيل"
      : "مراجعة سجل العمليات",
  };

  return {
    fifthSpotlight,
    compositeEfficiencySpotlight,
    cashConversionSpotlight,
    branchEfficiencySpotlight,
    branchScoresById,
    monthPace,
    agingRadar,
    governance,
    omniSearch,
  };
}
