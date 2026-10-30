"use server";

import { revalidatePath } from "next/cache";
import { requireSession, type SessionUser } from "@/lib/auth";
import { financeDb, financeEnabled } from "@/lib/finance/db";
import { openAccount, transferCash } from "@/lib/finance/engine";
import { FinanceProblem } from "@/lib/finance/types";
import type { FinanceActionState } from "./finance-state";

/**
 * Every finance write is a single SERIALIZABLE transaction inside the engine,
 * and the actor's role, status and branch are re-read from the database there.
 * These actions only shape the form payload and translate failures; they never
 * trust the browser for identity, role or amounts.
 */
function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}
function confirmed(formData: FormData, key: string): boolean {
  return text(formData, key) === "yes";
}
function unexpected(error: unknown): FinanceActionState {
  // لا تُكتب مبالغ أو أسماء في السجلات؛ رمز الخطأ يكفي للتشخيص.
  const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code.slice(0, 40) : "unexpected";
  console.error("Finance operation failed:", code);
  return { status: "error", message: "تعذّر التأكد من نتيجة العملية. راجع الصفحة قبل تكرار الطلب؛ يمكن إعادة المحاولة من النموذج نفسه دون تكرار العملية." };
}
type Guard = { session: SessionUser } | { state: FinanceActionState };
async function requireFinanceManager(): Promise<Guard> {
  const session = await requireSession();
  if (!financeEnabled()) return { state: { status: "error", message: "وحدة المالية غير مفعّلة في هذا النشر." } };
  if (session.role !== "MANAGER" && session.role !== "ACCOUNTANT") {
    return { state: { status: "error", message: "إدارة الحسابات النقدية متاحة للمدير والمحاسب فقط." } };
  }
  return { session };
}
function translate(error: unknown): FinanceActionState {
  if (error instanceof FinanceProblem) return { status: "error", code: error.code, message: error.message, details: error.details };
  return unexpected(error);
}
function revalidateFinance(): void {
  for (const path of ["/finance", "/finance/accounts", "/finance/transfers", "/dashboard"]) {
    try { revalidatePath(path); } catch { console.error("Finance cache revalidation failed"); }
  }
}

export async function openAccountAction(_previous: FinanceActionState, formData: FormData): Promise<FinanceActionState> {
  const guard = await requireFinanceManager();
  if ("state" in guard) return guard.state;
  const holderId = text(formData, "holderId");
  const raw = {
    requestId: text(formData, "requestId"),
    branchId: text(formData, "branchId"),
    kind: text(formData, "kind"),
    holderId: holderId || null,
    openingAmount: text(formData, "openingAmount"),
    openingDate: text(formData, "openingDate"),
    counted: confirmed(formData, "counted"),
  };
  try {
    const result = await openAccount(financeDb, guard.session.id, raw);
    revalidateFinance();
    return {
      status: "success",
      id: result.id,
      message: result.replayed ? "سبق حفظ هذا الطلب؛ لم يُفتح حساب مكرر." : "فُتح الحساب بالرصيد الفعلي بعد تأكيد الجرد.",
    };
  } catch (error) {
    return translate(error);
  }
}

export async function transferCashAction(_previous: FinanceActionState, formData: FormData): Promise<FinanceActionState> {
  const guard = await requireFinanceManager();
  if ("state" in guard) return guard.state;
  const raw = {
    requestId: text(formData, "requestId"),
    fromId: text(formData, "fromId"),
    toId: text(formData, "toId"),
    amount: text(formData, "amount"),
    expectedBalance: text(formData, "expectedBalance"),
    actuallyTransferred: confirmed(formData, "actuallyTransferred"),
    negativeAcknowledged: confirmed(formData, "negativeAcknowledged"),
  };
  try {
    const result = await transferCash(financeDb, guard.session.id, raw);
    revalidateFinance();
    return {
      status: "success",
      id: result.id,
      message: result.replayed ? "سبق حفظ هذا الطلب؛ لم تُسجَّل حركة مكررة." : "سُجّل التسليم الفعلي بين الحسابين.",
    };
  } catch (error) {
    return translate(error);
  }
}
