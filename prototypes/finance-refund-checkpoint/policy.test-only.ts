/** Synthetic policy experiment; this is NOT imported by the application. */
export type RefundTiming = "AFTER_REVIEWED_CHECKPOINT" | "BEFORE_REVIEWED_CHECKPOINT" | "UNKNOWN";

/**
 * A user's assertion is not evidence of physical timing. The normal path is
 * permitted to continue only for an explicit after-checkpoint assertion. The
 * caller must still verify the selected checkpoint inside its write transaction.
 */
export function checkSyntheticRefundTiming(value: unknown): asserts value is "AFTER_REVIEWED_CHECKPOINT" {
  if (value !== "AFTER_REVIEWED_CHECKPOINT") {
    throw new Error("الرد السابق للجرد أو غير المؤكد متوقف للمراجعة؛ لم يُسجّل رد أو حركة نقدية.");
  }
}
