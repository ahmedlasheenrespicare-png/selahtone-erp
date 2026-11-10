/** Describe persisted evidence only; this does not prove physical payment. */
export function paymentSourceLabel(payment: { method: string; source: string | null; accountId: string | null; historical: boolean }): string {
  if (payment.method !== "CASH") return "دفع غير نقدي — لا يحرّك النقد";
  if (payment.source === "HOLDER_CASH") return "نقد الموظف — بلا حركة دفع فورية؛ أثر الفترة يحتاج تحققًا";
  if (payment.accountId && payment.historical) return "دفع تاريخي — مسجّل كمشمول بالافتتاح، بلا حركة صرف جديدة";
  if (payment.accountId && (payment.source === "ACCOUNT" || payment.source === null)) return "دفع من حساب — أثر دفتري وفق السجل";
  return "مصدر نقدي غير محدّد — يحتاج مراجعة";
}

export function paymentAccountLabel(
  payment: { method: string; source: string | null; accountId: string | null },
  account: { kind: "VAULT" | "CUSTODY"; holderName: string | null; branchName: string } | null,
): string {
  if (payment.method !== "CASH") return "—";
  if (payment.source === "HOLDER_CASH" && !payment.accountId) return "لم يُربط حساب في سجل الدفع";
  if (!payment.accountId) return "غير محفوظ — يحتاج مراجعة";
  if (!account) return `الحساب #${payment.accountId} (تفاصيله غير متاحة)`;
  return account.kind === "CUSTODY" ? `عهدة · ${account.holderName ?? "الموظف"}` : `خزنة · ${account.branchName}`;
}
