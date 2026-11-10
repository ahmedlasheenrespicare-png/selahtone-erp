/**
 * Synthetic, read-only diagnostic. Not imported by the application. This does
 * not decide cutover eligibility, reconstruct historical custody or mutate data.
 */
import type { FinanceTransaction } from "../../src/lib/finance/types";
type Row = Record<string, unknown>;
type Context = Row & { accountId: string; branchId: string; holderId: string; closed: boolean; closedAt: string | null; cutoff: string; cutoffBeforeOpening: boolean; cutoffAfterClosure: boolean; openSettlements: number; openCounts: number };
export type PeriodItem = Row & {
  id: string; amount: string; happenedAt: string; oldFormula: boolean; candidatePending: boolean;
  atBoundary: boolean; afterClosure: boolean; atClosure: boolean; invalidCandidate: boolean; sourceMethod: string; sourceKind: string;
  assignedAccountId: string | null; assignedSettlementId: string | null; allocationTreatment: string | null;
  creatorId: string | null; recorderId: string | null;
};
export type Groups = { matched: PeriodItem[]; oldOnly: PeriodItem[]; candidateOnly: PeriodItem[]; boundary: PeriodItem[]; afterClosure: PeriodItem[]; closureBoundary: PeriodItem[]; invalidCandidate: PeriodItem[] };
function group(rows: PeriodItem[]): Groups {
  return {
    matched: rows.filter(r => r.oldFormula && r.candidatePending),
    oldOnly: rows.filter(r => r.oldFormula && !r.candidatePending),
    candidateOnly: rows.filter(r => !r.oldFormula && r.candidatePending),
    // An equal timestamp might already have been settled or might have arrived
    // later. It is never labeled settled or unsettled by this diagnostic.
    boundary: rows.filter(r => r.atBoundary),
    afterClosure: rows.filter(r => r.afterClosure),
    closureBoundary: rows.filter(r => r.atClosure),
    invalidCandidate: rows.filter(r => r.invalidCandidate),
  };
}
export async function auditTestOnlyPeriod(tx: FinanceTransaction, accountId: string): Promise<{ context: Context; collections: Groups; payments: Groups }> {
  if (!/^[1-9]\d{0,18}$/.test(accountId)) throw new Error("invalid synthetic account id");
  const safety = await tx.query<Row & { optedIn: boolean; readOnly: boolean; stableSnapshot: boolean }>(`SELECT
    current_setting('selahtone.cutover_period_audit_test_only',true)='yes' AS "optedIn",
    current_setting('transaction_read_only')='on' AS "readOnly",
    current_setting('transaction_isolation') IN ('repeatable read','serializable') AS "stableSnapshot"`);
  if (!safety.rows[0]?.optedIn || !safety.rows[0]?.readOnly || !safety.rows[0]?.stableSnapshot)
    throw new Error("synthetic period audit requires explicit opt-in and a read-only repeatable snapshot");
  const account = await tx.query<Context>(`SELECT a.id::text AS "accountId",a.branch_id::text AS "branchId",a.holder_id::text AS "holderId",(a.closed_at IS NOT NULL) AS closed,a.closed_at::text AS "closedAt",
    boundary.cutoff::text AS cutoff,
    COALESCE(boundary.cutoff < a.opened_at,false) AS "cutoffBeforeOpening",
    COALESCE(boundary.cutoff > a.closed_at,false) AS "cutoffAfterClosure",
    (SELECT COUNT(*)::int FROM finance.settlements s WHERE s.account_id=a.id AND s.status='OPEN') AS "openSettlements",
    (SELECT COUNT(*)::int FROM finance.cash_counts c WHERE c.account_id=a.id AND c.status='OPEN') AS "openCounts"
    FROM finance.accounts a
    CROSS JOIN LATERAL (SELECT COALESCE((SELECT s.resolved_at FROM finance.settlements s WHERE s.account_id=a.id AND s.status='CONFIRMED' ORDER BY s.resolved_at DESC,s.id DESC LIMIT 1),a.opened_at) AS cutoff) boundary
    WHERE a.id=$1::bigint AND a.kind='CUSTODY' AND a.holder_id IS NOT NULL`, [accountId]);
  const context = account.rows[0];
  if (!context) throw new Error("synthetic custody not found");
  const collections = await tx.query<PeriodItem>(`SELECT c.id::text AS id,c.amount::numeric(22,2)::text AS amount,c.created_at::text AS "happenedAt",
    COALESCE((c.method='CASH' AND s.branch_id=$2::bigint AND s.created_by_id=$3::bigint AND c.created_at>$4::timestamptz),false) AS "oldFormula",
    COALESCE(alloc.account_id=$1::bigint AND alloc.treatment='CUSTODY_PENDING' AND alloc.settlement_id IS NULL,false) AS "candidatePending",
    COALESCE((c.method='CASH' AND s.branch_id=$2::bigint AND s.created_by_id=$3::bigint AND c.created_at=$4::timestamptz),false) AS "atBoundary",
    COALESCE(c.created_at>$5::timestamptz,false) AS "afterClosure",COALESCE(c.created_at=$5::timestamptz,false) AS "atClosure",
    c.method AS "sourceMethod",'COLLECTION' AS "sourceKind",
    COALESCE(alloc.account_id=$1::bigint AND alloc.settlement_id IS NULL AND
      (alloc.treatment<>'CUSTODY_PENDING' OR c.method<>'CASH' OR s.branch_id IS DISTINCT FROM $2::bigint OR c.created_by_id IS DISTINCT FROM $3::bigint OR alloc.assigned_by IS DISTINCT FROM c.created_by_id),false) AS "invalidCandidate",
    alloc.account_id::text AS "assignedAccountId",alloc.settlement_id::text AS "assignedSettlementId",alloc.treatment AS "allocationTreatment",
    s.created_by_id::text AS "creatorId",c.created_by_id::text AS "recorderId"
    FROM public.commerce_collections c JOIN public.commerce_sales s ON s.id=c.sale_id
    LEFT JOIN finance.collection_allocations_test_only alloc ON alloc.collection_id=c.id
    WHERE (c.method='CASH' AND s.branch_id=$2::bigint AND s.created_by_id=$3::bigint AND c.created_at >= $4::timestamptz)
      OR (alloc.account_id=$1::bigint AND alloc.settlement_id IS NULL)
    ORDER BY c.id`, [accountId,context.branchId,context.holderId,context.cutoff,context.closedAt]);
  const payments = await tx.query<PeriodItem>(`SELECT p.id::text AS id,p.amount::numeric(22,2)::text AS amount,p.recorded_at::text AS "happenedAt",
    (p.source='HOLDER_CASH' AND e.branch_id=$2::bigint AND e.requested_by=$3::bigint AND p.recorded_at>$4::timestamptz) AS "oldFormula",
    COALESCE(alloc.account_id=$1::bigint AND alloc.settlement_id IS NULL,false) AS "candidatePending",
    (p.source='HOLDER_CASH' AND e.branch_id=$2::bigint AND e.requested_by=$3::bigint AND p.recorded_at=$4::timestamptz) AS "atBoundary",
    COALESCE(p.recorded_at>$5::timestamptz,false) AS "afterClosure",COALESCE(p.recorded_at=$5::timestamptz,false) AS "atClosure",
    p.method AS "sourceMethod",p.source AS "sourceKind",
    COALESCE(alloc.account_id=$1::bigint AND alloc.settlement_id IS NULL AND
      (p.source<>'HOLDER_CASH' OR p.method<>'CASH' OR e.branch_id IS DISTINCT FROM $2::bigint OR e.requested_by IS DISTINCT FROM $3::bigint OR p.recorded_by IS DISTINCT FROM $3::bigint OR alloc.assigned_by IS DISTINCT FROM p.recorded_by),false) AS "invalidCandidate",
    alloc.account_id::text AS "assignedAccountId",alloc.settlement_id::text AS "assignedSettlementId",CASE WHEN alloc.payment_id IS NOT NULL THEN 'HOLDER_CASH' ELSE NULL END AS "allocationTreatment",
    e.requested_by::text AS "creatorId",p.recorded_by::text AS "recorderId"
    FROM finance.payments p JOIN finance.expenses e ON e.id=p.expense_id
    LEFT JOIN finance.holder_payment_allocations_test_only alloc ON alloc.payment_id=p.id
    WHERE (p.source='HOLDER_CASH' AND e.branch_id=$2::bigint AND e.requested_by=$3::bigint AND p.recorded_at >= $4::timestamptz)
      OR (alloc.account_id=$1::bigint AND alloc.settlement_id IS NULL)
    ORDER BY p.id`, [accountId,context.branchId,context.holderId,context.cutoff,context.closedAt]);
  return { context, collections: group(collections.rows), payments: group(payments.rows) };
}
