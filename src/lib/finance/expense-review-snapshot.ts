import { createHash } from "node:crypto";

/** Optimistic token for the displayed review fields, not authentication or evidence. */
export function expenseReviewSnapshot(review: {
  id: string; expenseId: string; expenseRevision: number; status: string;
  reason: string; proposedAmount: string | null; createdBy: string; createdAt: string;
}): string {
  return createHash("sha256").update(JSON.stringify([
    "expense-review-v1", review.id, review.expenseId, review.expenseRevision,
    review.status, review.reason, review.proposedAmount, review.createdBy, review.createdAt,
  ])).digest("hex");
}
