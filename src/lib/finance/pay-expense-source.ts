/**
 * The pay-expense form sends one extra field the engine reads: `source`.
 *   HOLDER_CASH = خرج من نقد الموظف، فيُجمَع ضمن مصروفات فترته ويُسوّى في التسوية.
 *   ACCOUNT     = خُصم فورًا من حساب نقدي (خزنة أو عهدة) وتتحرك حركته الآن.
 *
 * The engine supports both, but a missing value silently falls back to an
 * immediate account debit — and such a payment never reaches the settlement.
 * So the form must state which one it means, and the payload is shaped here
 * where it can be tested without a session, a browser or a database.
 */
export type PaySource = "HOLDER_CASH" | "ACCOUNT";

export function payExpenseSource(value: unknown): PaySource {
  return value === "HOLDER_CASH" ? "HOLDER_CASH" : "ACCOUNT";
}

function read(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}
function confirmed(formData: FormData, key: string): boolean {
  return read(formData, key) === "yes";
}

/**
 * Shapes the submitted form into the engine payload. Everything that belongs
 * to an immediate account debit is dropped for holder cash, because the engine
 * rejects a settlement-settled payment that also carries account, balance or
 * count fields.
 */
export function payExpensePayload(formData: FormData): Record<string, unknown> {
  const source = payExpenseSource(read(formData, "source"));
  const fromAccount = source === "ACCOUNT";
  const method = read(formData, "method");
  const cashFromAccount = fromAccount && method === "CASH";
  return {
    requestId: read(formData, "requestId"),
    expenseId: read(formData, "expenseId"),
    expectedRevision: read(formData, "expectedRevision"),
    source,
    method,
    accountId: cashFromAccount ? read(formData, "accountId") : null,
    paymentDate: read(formData, "paymentDate"),
    actuallyPaid: confirmed(formData, "actuallyPaid"),
    openingOrder: fromAccount ? read(formData, "openingOrder") || null : null,
    includedInOpening: fromAccount ? confirmed(formData, "includedInOpening") : false,
    afterCountId: fromAccount ? read(formData, "afterCountId") || null : null,
    afterCount: fromAccount ? confirmed(formData, "afterCount") : false,
    expectedBalance: cashFromAccount ? read(formData, "expectedBalance") : null,
    negativeAcknowledged: fromAccount ? confirmed(formData, "negativeAcknowledged") : false,
  };
}
