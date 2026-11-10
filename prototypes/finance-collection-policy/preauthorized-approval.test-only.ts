/** Synthetic experiment only; not an application authorization layer.
 * Duplicates a narrow check before a marker, so it may drift from the engine.
 * Does not establish a global lock order, HTTP access, or human review.
 */
import { canManageFinance } from "../../src/lib/finance/policy";
import { FinanceProblem, type Actor, type FinanceDatabase, type WriteResult } from "../../src/lib/finance/types";
import { branchApproveCustodyTestOnly } from "./branch-barrier.test-only";

type Approval={requestId:string;requestId2:string;decision:"APPROVE";reason:string;openingDate:string;counted:boolean;expectedSnapshot:string};
export async function preauthorizedApprovalTestOnly(db:FinanceDatabase,actorId:string,raw:Approval,today:string):Promise<WriteResult> {
  return db.serializable(async tx=>{
    const actors=await tx.query<Actor & Record<string,unknown>>(`SELECT id::text AS id,role_code::text AS role,branch_id::text AS "branchId",status::text AS status,must_change_password AS "mustChangePassword" FROM public.users WHERE id=$1::bigint FOR SHARE`,[actorId]);
    const actor=actors.rows[0] ?? null;
    if(!canManageFinance(actor)) throw new FinanceProblem("forbidden","اختبار اصطناعي: لا تملك صلاحية اعتماد العهدة.");
    const request=await tx.query<{branchId:string}>(`SELECT branch_id::text AS "branchId" FROM finance.custody_requests WHERE id=$1::bigint`,[raw.requestId2]);
    if(!request.rows[0] || (actor?.role==="ACCOUNTANT" && actor.branchId!==request.rows[0].branchId))
      throw new FinanceProblem("forbidden","اختبار اصطناعي: لا تملك صلاحية فرع الطلب.");
    // The original engine still rechecks actor, scope, status, snapshot, and
    // replay. The precheck alone must never authorize an actual write.
    return branchApproveCustodyTestOnly({serializable:work=>work(tx)},actorId,raw,today);
  });
}
