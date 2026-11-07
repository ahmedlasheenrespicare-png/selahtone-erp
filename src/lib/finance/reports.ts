/* تقارير المالية (v1) — المدير والمحاسب فقط عبر حارس الصفحة.
   لا صلاحيات ولا جداول ولا أعمدة جديدة؛ كل شيء يُقرأ من الموجود.
   «المبلغ الفعال» = آخر تصحيح مؤكد («expense_corrections» إن وُجد) وإلا الأصل —
   نفس دلالة اليوم، لئلا تُعرض أرقام التقرير بغير دلالة باقي الشاشات. */
import type { FinanceTransaction } from "./types";
import { cairoDate } from "./validation";
import { displayMoney } from "@/lib/commerce-display";

export type ReportPeriod = "today" | "week" | "month";
export const REPORT_PERIOD_LABEL: Record<ReportPeriod, string> = {
  today: "اليوم",
  week: "آخر ٧ أيام",
  month: "الشهر الحالي",
};
export const REPORT_PERIOD_ORDER: readonly ReportPeriod[] = ["today", "week", "month"];

export function normalizeReportPeriod(raw: unknown): ReportPeriod {
  return raw === "today" || raw === "week" || raw === "month" ? raw : "month";
}

type CairoDay = string; // YYYY-MM-DD
const DAY_MS = 86_400_000;

function parseDay(day: CairoDay): number {
  return Date.parse(`${day}T00:00:00.000Z`);
}

function formatDay(time: number): CairoDay {
  return new Date(time).toISOString().slice(0, 10);
}

function addDays(day: CairoDay, days: number): CairoDay {
  return formatDay(parseDay(day) + days * DAY_MS);
}

function firstOfMonth(day: CairoDay): CairoDay {
  return `${day.slice(0, 7)}-01`;
}

function previousMonthSameSpan(today: CairoDay): { from: CairoDay; to: CairoDay } {
  const [year, month, dom] = today.split("-").map(Number);
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevLast = new Date(Date.UTC(prevYear, prevMonth, 0)).getUTCDate();
  const mm = String(prevMonth).padStart(2, "0");
  return {
    from: `${prevYear}-${mm}-01`,
    to: `${prevYear}-${mm}-${String(Math.min(dom, prevLast)).padStart(2, "0")}`,
  };
}

export type ReportRange = { from: CairoDay; to: CairoDay; prevFrom: CairoDay; prevTo: CairoDay };

export function reportRange(period: ReportPeriod, today: CairoDay): ReportRange {
  if (period === "today") {
    const yesterday = addDays(today, -1);
    return { from: today, to: today, prevFrom: yesterday, prevTo: yesterday };
  }
  if (period === "week") {
    return { from: addDays(today, -6), to: today, prevFrom: addDays(today, -13), prevTo: addDays(today, -7) };
  }
  const prev = previousMonthSameSpan(today);
  return { from: firstOfMonth(today), to: today, prevFrom: prev.from, prevTo: prev.to };
}

export type PeriodTotals = { count: number; totalCents: bigint };
export type CategoryShare = { name: string; count: number; totalCents: bigint; sharePct: number };
export type BranchSum = { branchId: string; count: number; totalCents: bigint };
export type AwaitingTotals = { pendingCount: number; pendingCents: bigint; approvedCount: number; approvedCents: bigint };
export type SettlementMonth = { monthCount: number; monthAbsDeviationCents: bigint; openCount: number; staleOpenCount: number };

export type FinanceExpenseReport = {
  period: ReportPeriod;
  today: CairoDay;
  range: ReportRange;
  current: PeriodTotals;
  previous: PeriodTotals;
  deltaCents: bigint;
  awaiting: AwaitingTotals;
  topCategories: CategoryShare[];
  branchSums: BranchSum[];
  settlements: SettlementMonth;
};

function toCents(raw: string | null | undefined): bigint {
  if (!raw) return 0n;
  const trimmed = raw.trim();
  const negative = trimmed.startsWith("-");
  const body = negative || trimmed.startsWith("+") ? trimmed.slice(1) : trimmed;
  const [whole = "0", frac = ""] = body.split(".");
  const cents = BigInt(whole || "0") * 100n + BigInt((frac + "00").slice(0, 2) || "0");
  return negative ? -cents : cents;
}

const EFFECTIVE = `COALESCE((SELECT c.after_amount FROM finance.expense_corrections c WHERE c.expense_id=e.id ORDER BY c.id DESC LIMIT 1), e.amount)`;

type CountTotalRow = { count: string; total: string };
type StatusRow = { status: string; count: string; total: string };
type CategoryRow = { name: string; count: string; total: string };
type BranchRow = { branchId: string; count: string; total: string };
type SettlementsAggRow = { count: string; absdev: string };
type SettlementsOpenRow = { count: string };

export function formatReportCents(cents: bigint): string {
  return displayMoney(cents);
}

/** يعمل داخل معاملة المستخدم المالية (FinanceTransaction) — بلا اتصال إضافي. */
export async function loadExpenseFinanceReport(
  tx: FinanceTransaction,
  period: ReportPeriod,
  now: Date = new Date(),
): Promise<FinanceExpenseReport> {
  const today = cairoDate(now);
  const range = reportRange(period, today);
  const monthFrom = firstOfMonth(today);

  type Row<T> = { rows: T[] };
  const q = <T extends Record<string, unknown>>(sql: string, params: unknown[]): Promise<Row<T>> =>
    tx.query<T>(sql, params);

  const [currentRes, previousRes, awaitingRes, categoriesRes, branchesRes, monthRes, openRes, staleRes] = await Promise.all([
    q<CountTotalRow>(
      `SELECT COUNT(*)::text AS count, COALESCE(SUM(eff.effective),0)::text AS total
         FROM finance.expenses e
         CROSS JOIN LATERAL (SELECT ${EFFECTIVE} AS effective) eff
        WHERE e.expense_date BETWEEN $1::date AND $2::date`,
      [range.from, range.to]),
    q<CountTotalRow>(
      `SELECT COUNT(*)::text AS count, COALESCE(SUM(eff.effective),0)::text AS total
         FROM finance.expenses e
         CROSS JOIN LATERAL (SELECT ${EFFECTIVE} AS effective) eff
        WHERE e.expense_date BETWEEN $1::date AND $2::date`,
      [range.prevFrom, range.prevTo]),
    q<StatusRow>(
      `SELECT e.status AS status, COUNT(*)::text AS count, COALESCE(SUM(eff.effective),0)::text AS total
         FROM finance.expenses e
         CROSS JOIN LATERAL (SELECT ${EFFECTIVE} AS effective) eff
        WHERE e.status IN ('PENDING','APPROVED')
        GROUP BY e.status`,
      []),
    q<CategoryRow>(
      `SELECT e.category_snapshot AS name, COUNT(*)::text AS count, COALESCE(SUM(eff.effective),0)::text AS total
         FROM finance.expenses e
         CROSS JOIN LATERAL (SELECT ${EFFECTIVE} AS effective) eff
        WHERE e.expense_date BETWEEN $1::date AND $2::date
        GROUP BY e.category_snapshot
        ORDER BY SUM(eff.effective) DESC NULLS LAST
        LIMIT 6`,
      [range.from, range.to]),
    q<BranchRow>(
      `SELECT e.branch_id::text AS "branchId", COUNT(*)::text AS count, COALESCE(SUM(eff.effective),0)::text AS total
         FROM finance.expenses e
         CROSS JOIN LATERAL (SELECT ${EFFECTIVE} AS effective) eff
        WHERE e.expense_date BETWEEN $1::date AND $2::date
        GROUP BY e.branch_id
        ORDER BY SUM(eff.effective) DESC NULLS LAST`,
      [range.from, range.to]),
    q<SettlementsAggRow>(
      `SELECT COUNT(*)::text AS count, COALESCE(SUM(ABS(s.deviation)),0)::text AS absdev
         FROM finance.settlements s
        WHERE (s.created_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN $1::date AND $2::date`,
      [monthFrom, today]),
    q<SettlementsOpenRow>(
      `SELECT COUNT(*)::text AS count FROM finance.settlements WHERE status='OPEN'`,
      []),
    q<SettlementsOpenRow>(
      `SELECT COUNT(*)::text AS count FROM finance.settlements WHERE status='OPEN' AND created_at < CURRENT_TIMESTAMP - INTERVAL '7 days'`,
      []),
  ]);

  const current: PeriodTotals = { count: Number(currentRes.rows[0]?.count ?? "0"), totalCents: toCents(currentRes.rows[0]?.total) };
  const previous: PeriodTotals = { count: Number(previousRes.rows[0]?.count ?? "0"), totalCents: toCents(previousRes.rows[0]?.total) };
  const awaiting: AwaitingTotals = { pendingCount: 0, pendingCents: 0n, approvedCount: 0, approvedCents: 0n };
  for (const row of awaitingRes.rows) {
    if (row.status === "PENDING") { awaiting.pendingCount = Number(row.count); awaiting.pendingCents = toCents(row.total); }
    if (row.status === "APPROVED") { awaiting.approvedCount = Number(row.count); awaiting.approvedCents = toCents(row.total); }
  }
  const topCategories: CategoryShare[] = categoriesRes.rows.map((row) => {
    const total = toCents(row.total);
    const sharePct = current.totalCents > 0n ? Math.round(Number((total * 1000n) / current.totalCents)) / 10 : 0;
    return { name: row.name, count: Number(row.count), totalCents: total, sharePct };
  });
  const branchSums: BranchSum[] = branchesRes.rows.map((row) => ({ branchId: row.branchId, count: Number(row.count), totalCents: toCents(row.total) }));
  const settlements: SettlementMonth = {
    monthCount: Number(monthRes.rows[0]?.count ?? "0"),
    monthAbsDeviationCents: toCents(monthRes.rows[0]?.absdev),
    openCount: Number(openRes.rows[0]?.count ?? "0"),
    staleOpenCount: Number(staleRes.rows[0]?.count ?? "0"),
  };
  return { period, today, range, current, previous, deltaCents: current.totalCents - previous.totalCents, awaiting, topCategories, branchSums, settlements };
}
