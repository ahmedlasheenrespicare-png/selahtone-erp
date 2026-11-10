/** Synthetic-only candidate: recorded events, not physical cash or account balance. */
export type SyntheticEvent = {
  id: string; kind: "COLLECTION" | "REFUND" | "PAYMENT";
  branchId: string; actorId: string; method: string;
  amount: string; recordedAt: string;
};
type Scope = { branchId: string; actorId?: string };
const methods = ["CASH", "CARD", "BANK_TRANSFER", "WALLET"] as const;
const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" });
function recordedDay(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const datePart = value.slice(0, 10);
  const dateOnly = new Date(`${datePart}T00:00:00Z`);
  if (!Number.isFinite(dateOnly.valueOf()) || dateOnly.toISOString().slice(0, 10) !== datePart) return null;
  const t = new Date(value);
  return Number.isFinite(t.valueOf()) ? fmt.format(t) : null;
}
function amount(value: string): bigint | null {
  if (!/^\d+\.\d{2}$/.test(value)) return null;
  const [whole, fraction] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction);
}

/** Refuse totals if any scoped event is invalid; input must be a complete,
 * consistently scoped snapshot. This prototype cannot prove completeness. */
export function syntheticRecordedFlow(events: readonly SyntheticEvent[], scope: Scope, month: string) {
  if (!scope.branchId || scope.actorId === "" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("invalid synthetic scope or month");
  const ids = new Set<string>(), issues: string[] = [];
  const buckets = Object.fromEntries(methods.map(method => [method, { collection: 0n, refund: 0n, payment: 0n }]));
  for (const e of events) {
    const key = `${e.kind}:${e.id}`;
    if (!e.id || ids.has(key)) throw new Error("duplicate or missing synthetic event ID");
    ids.add(key);
    if (e.branchId !== scope.branchId || (scope.actorId !== undefined && e.actorId !== scope.actorId)) continue;
    const d = recordedDay(e.recordedAt), cents = amount(e.amount);
    if (!d || cents === null || !methods.includes(e.method as typeof methods[number]) || !["COLLECTION", "REFUND", "PAYMENT"].includes(e.kind)) { issues.push(key); continue; }
    if (!d.startsWith(month)) continue;
    const bucket = buckets[e.method];
    if (e.kind === "COLLECTION") bucket.collection += cents;
    else if (e.kind === "REFUND") bucket.refund += cents;
    else bucket.payment += cents;
  }
  // Never return partial totals as if they were complete.
  return issues.length ? { complete: false as const, issues } : { complete: true as const, buckets };
}
