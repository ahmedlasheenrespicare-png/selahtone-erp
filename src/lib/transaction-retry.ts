/** Only known serialization/deadlock aborts are safe to retry as whole transactions. */
export function isRetryableTransactionConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  const { code, meta } = error as {
    code?: unknown;
    meta?: { code?: unknown; driverAdapterError?: { cause?: { originalCode?: unknown } } };
  };
  if (code === "P2034" || code === "40001" || code === "40P01") return true;
  if (code !== "P2010") return false;
  return [meta?.code, meta?.driverAdapterError?.cause?.originalCode].some(
    pgCode => pgCode === "40001" || pgCode === "40P01",
  );
}
