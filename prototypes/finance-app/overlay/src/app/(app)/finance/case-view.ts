/** Server-only transformation for the disposable lab. */
import { randomUUID } from "node:crypto";
import type { ReconciliationCase, ReconciliationNote } from "../../../../prototypes/finance-engine/engine";
export type CaseView = {
  id:string; kind:"OPENING"|"COLLECTION"|"REFUND"; branchId:string; accountId:string|null; saleId:string|null;
  proposedAmount:string|null; possibleDate:string|null; possibleHandler:string|null; reason:string;
  openingSnapshot:string|null; balanceSnapshot:string|null; status:"OPEN"|"CONFIRMED"|"CLOSED"; revision:number;
  createdBy:string; createdAt:string; resolvedBy:string|null; resolvedAt:string|null; resolutionReason:string|null;
  openingCorrectionId:string|null; historicalId:string|null;
  notes:Array<{id:string;note:string;createdBy:string;createdAt:string}>; noteRequest:string; closeRequest:string;
};
export function caseViews(cases:ReconciliationCase[],notes:ReconciliationNote[]):CaseView[] {
  return cases.map(c=>({
    id:c.id,kind:c.kind,branchId:c.branchId,accountId:c.accountId,saleId:c.saleId,proposedAmount:c.proposedAmount,possibleDate:c.possibleDate,
    possibleHandler:c.possibleHandler,reason:c.reason,openingSnapshot:c.openingSnapshot,balanceSnapshot:c.balanceSnapshot,status:c.status,revision:c.revision,
    createdBy:c.createdBy,createdAt:c.createdAt,resolvedBy:c.resolvedBy,resolvedAt:c.resolvedAt,resolutionReason:c.resolutionReason,
    openingCorrectionId:c.openingCorrectionId,historicalId:c.historicalId,notes:notes.filter(n=>n.caseId===c.id).map(n=>({id:n.id,note:n.note,createdBy:n.createdBy,createdAt:n.createdAt})),
    noteRequest:randomUUID(),closeRequest:randomUUID(),
  }));
}
