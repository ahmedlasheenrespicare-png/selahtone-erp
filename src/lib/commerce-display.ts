import type { PaymentMethod } from "./commerce-validation";

const digits = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
export function displayMoney(cents: bigint): string {
  const negative = cents < 0n;
  const value = negative ? -cents : cents;
  return `${negative ? "-" : ""}${digits.format(value / 100n)}.${(value % 100n).toString().padStart(2, "0")}`;
}
export function fixedScaled(value: bigint, scale = 2): string {
  const negative = value < 0n;
  const amount = negative ? -value : value;
  const base = 10n ** BigInt(scale);
  return `${negative ? "-" : ""}${amount / base}.${(amount % base).toString().padStart(scale, "0")}`;
}
export const METHOD_LABELS: Record<PaymentMethod, string> = { CASH: "نقدي", CARD: "بطاقة", BANK_TRANSFER: "تحويل بنكي", WALLET: "محفظة" };
