/**
 * Disposable experiment only. Deliberately intercepts the current engine's SQL
 * to compare a pending-allocation formula with the creator-based formula.
 * Requires caller-owned serializable transactions. It is NOT an application
 * adapter, migration, history reconstruction, authorization, or a cutover plan.
 * SQL pattern matching and the branch-wide missing-allocation check are not a
 * complete safety boundary. Never deploy or run on actual data.
 */
import { formatCents } from "../../src/lib/finance/validation";
import { FinanceProblem, type FinanceDatabase, type FinanceTransaction } from "../../src/lib/finance/types";
import { scaledInteger } from "../../src/lib/inventory-math";
import { attachAfterRealConfirmationTestOnly, lockAndValidatePendingSourcesTestOnly } from "./period.test-only";

type Confirmation = { actorId:string; collectionIds:string[]; paymentIds:string[]; reviewedHash:string };
export function testAllocatedFormula(db:FinanceDatabase,accountId:string,confirmation?:Confirmation):FinanceDatabase {
  return { serializable: work => db.serializable(tx => {
    let substitutions=0;
    const port:FinanceTransaction={...tx,query:async <T extends Record<string,unknown>>(sql:string,params?:unknown[])=>{
      const isSales=sql.includes("SELECT COALESCE(SUM(c.amount),0)::text AS total") && sql.includes("s.created_by_id=$3::bigint");
      const isExpenses=sql.includes("SELECT COALESCE(SUM(p.amount),0)::text AS total") && sql.includes("e.requested_by=$3::bigint");
      if(isSales || isExpenses) {
        const source=await tx.query<{branchId:string;holderId:string}>(`SELECT branch_id::text AS "branchId",holder_id::text AS "holderId" FROM finance.accounts WHERE id=$1::bigint AND kind='CUSTODY' AND closed_at IS NULL`,[accountId]);
        const account=source.rows[0];
        if(!account || account.branchId!==params?.[0] || account.holderId!==params?.[2]) throw new FinanceProblem("experimental_scope", "اختبار اصطناعي: نطاق العهدة غير مطابق.");
        // Deliberately conservative: any unassigned cash source in the branch,
        // regardless of date, prevents the experiment. This is NOT proof that
        // earlier settlements or currently assigned sources are historically correct.
        const missing=await tx.query<{found:boolean}>(`SELECT EXISTS(
          SELECT 1 FROM public.commerce_collections c JOIN public.commerce_sales s ON s.id=c.sale_id
          WHERE s.branch_id=$1::bigint AND c.method='CASH' AND NOT EXISTS(SELECT 1 FROM finance.collection_allocations_test_only a WHERE a.collection_id=c.id))
          OR EXISTS(SELECT 1 FROM finance.payments p JOIN finance.expenses e ON e.id=p.expense_id
          WHERE e.branch_id=$1::bigint AND p.source='HOLDER_CASH' AND NOT EXISTS(SELECT 1 FROM finance.holder_payment_allocations_test_only a WHERE a.payment_id=p.id)) AS found`,[account.branchId]);
        if(missing.rows[0]?.found) throw new FinanceProblem("experimental_unassigned", "اختبار اصطناعي: توجد مصادر نقدية بلا تخصيص؛ لا يمكن تجاهلها.");
        const checked=await lockAndValidatePendingSourcesTestOnly(tx,accountId);
        const rows=isSales?checked.collections:checked.payments;
        const total=formatCents(rows.reduce((sum,row)=>sum+scaledInteger(row.amount,2),0n));
        substitutions++;
        return {rows:[{total} as unknown as T]};
      }
      if(sql.includes("INSERT INTO finance.settlements") && substitutions!==2)
        throw new FinanceProblem("experimental_incomplete", "اختبار اصطناعي: لم تُقرأ صيغة التخصيص كاملة.");
      const result=await tx.query<T>(sql,params);
      if(confirmation && sql.includes("UPDATE finance.settlements SET status='CONFIRMED'")) {
        if(substitutions!==2) throw new FinanceProblem("experimental_incomplete", "اختبار اصطناعي: لم تُقرأ صيغة التخصيص كاملة.");
        await attachAfterRealConfirmationTestOnly(tx,accountId,String(params?.[6]),confirmation.actorId,confirmation.collectionIds,confirmation.paymentIds,confirmation.reviewedHash,false);
      }
      return result;
    }};
    return work(port);
  }) };
}
