import { createHash } from "node:crypto";

/** Optimistic comparison of the request reviewed, not a signature or evidence of counting. */
export function custodyRequestSnapshot(request: { id: string; branchId: string; requesterId: string; amount: string; reason: string }): string {
  return createHash("sha256").update(JSON.stringify(["custody-request-v1", request.id, request.branchId, request.requesterId, request.amount, request.reason])).digest("hex");
}
