/** Synthetic arrays only. No database access, writes, authorization, or cash-flow calculation. */
export type SyntheticExpense = {
  id: string;
  branchId: string;
  requesterId: string;
  status: string;
  expenseDate: string | null;
  paymentDate: string | null;
  recordedAt: string | null;
  effectiveAmount: string | null;
  paymentAmount: string | null;
};
export type Scope = { branchId: string; requesterId?: string };

type Finding = "MISSING_EXPENSE_DATE" | "MISSING_PAYMENT_DATE" | "MISSING_RECORDED_AT" | "MISSING_PAYMENT_AMOUNT" | "MISSING_EFFECTIVE_AMOUNT" | "AMOUNT_MISMATCH" | "PAID_WITHOUT_PAYMENT";
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" });
function day(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}
function recordedDay(value: string | null): string | null {
  // Require an explicit offset: a local timestamp without a zone is ambiguous.
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  if (!day(value.slice(0, 10))) return null;
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) ? dayFmt.format(date) : null;
}
function cents(value: string | null): bigint | null {
  if (!value || !/^\d+\.\d{2}$/.test(value)) return null;
  const [whole, fraction] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction);
}

/** Three independent sets of IDs, not a verdict or production reporting algorithm. */
export function auditSyntheticExpensePeriods(rows: readonly SyntheticExpense[], scope: Scope, month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !scope.branchId || scope.requesterId === "") throw new Error("invalid synthetic scope or month");
  const ids = new Set<string>();
  const expenseMonth: string[] = [], paymentMonth: string[] = [], recordedMonth: string[] = [];
  const findings: { id: string; issues: Finding[] }[] = [];
  for (const row of rows) {
    // Duplicate IDs anywhere make scoping or aggregation unsafe, even across branches.
    if (!row.id || ids.has(row.id)) throw new Error("duplicate or missing synthetic expense ID");
    ids.add(row.id);
    if (row.branchId !== scope.branchId || (scope.requesterId !== undefined && row.requesterId !== scope.requesterId)) continue;
    const expenseDay = day(row.expenseDate);
    if (expenseDay?.startsWith(month)) expenseMonth.push(row.id);
    if (row.status !== "PAID") continue;
    const paymentDay = day(row.paymentDate), createdDay = recordedDay(row.recordedAt);
    if (paymentDay?.startsWith(month)) paymentMonth.push(row.id);
    if (createdDay?.startsWith(month)) recordedMonth.push(row.id);
    const issues: Finding[] = [];
    if (!expenseDay) issues.push("MISSING_EXPENSE_DATE");
    if (!paymentDay) issues.push("MISSING_PAYMENT_DATE");
    if (!createdDay) issues.push("MISSING_RECORDED_AT");
    const paymentAmount = cents(row.paymentAmount), effectiveAmount = cents(row.effectiveAmount);
    if (paymentAmount === null) issues.push("MISSING_PAYMENT_AMOUNT");
    if (effectiveAmount === null) issues.push("MISSING_EFFECTIVE_AMOUNT");
    if (paymentAmount !== null && effectiveAmount !== null && paymentAmount !== effectiveAmount) issues.push("AMOUNT_MISMATCH");
    if (!row.paymentDate && !row.recordedAt && !row.paymentAmount) issues.push("PAID_WITHOUT_PAYMENT");
    if (issues.length) findings.push({ id: row.id, issues });
  }
  return { expenseMonth, paymentMonth, recordedMonth, findings };
}
