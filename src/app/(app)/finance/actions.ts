"use server";

import { revalidatePath } from "next/cache";
import { requireSession, type SessionUser } from "@/lib/auth";
import { createAppCategory, editAppCategory } from "@/lib/finance/app-categories";
import { financeDb, financeEnabled } from "@/lib/finance/db";
import { approveExpense, cancelCashCount, confirmCashCount, createExpense, openAccount, payExpense, requestCashCount, requestPaidExpenseReview, transferCash } from "@/lib/finance/engine";
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
  for (const path of ["/finance", "/finance/accounts", "/finance/transfers", "/finance/expenses", "/finance/counts", "/finance/categories", "/dashboard"]) {
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

export async function createExpenseAction(_previous: FinanceActionState, formData: FormData): Promise<FinanceActionState> {
  const guard = await requireFinanceManager();
  if ("state" in guard) return guard.state;
  const raw = {
    requestId: text(formData, "requestId"),
    branchId: text(formData, "branchId"),
    categoryId: text(formData, "categoryId"),
    amount: text(formData, "amount"),
    expenseDate: text(formData, "expenseDate"),
    description: text(formData, "description"),
    beneficiary: text(formData, "beneficiary") || null,
    documentNumber: text(formData, "documentNumber") || null,
    taxAmount: text(formData, "taxAmount") || null,
  };
  try {
    const result = await createExpense(financeDb, guard.session.id, raw);
    revalidateFinance();
    return {
      status: "success",
      id: result.id,
      message: result.replayed ? "سبق حفظ هذا الطلب؛ لم يُسجَّل مصروف مكرر." : "سُجّل المصروف بانتظار الاعتماد.",
    };
  } catch (error) {
    return translate(error);
  }
}

export async function approveExpenseAction(_previous: FinanceActionState, formData: FormData): Promise<FinanceActionState> {
  const guard = await requireFinanceManager();
  if ("state" in guard) return guard.state;
  const raw = {
    requestId: text(formData, "requestId"),
    expenseId: text(formData, "expenseId"),
    expectedRevision: text(formData, "expectedRevision"),
    selfApproved: confirmed(formData, "selfApproved"),
  };
  try {
    const result = await approveExpense(financeDb, guard.session.id, raw);
    revalidateFinance();
    return {
      status: "success",
      id: result.id,
      message: result.replayed ? "سبق حفظ هذا الطلب؛ لم يتكرر الاعتماد." : "اعتُمد المصروف. الصرف الفعلي خطوة منفصلة.",
    };
  } catch (error) {
    return translate(error);
  }
}

export async function payExpenseAction(_previous: FinanceActionState, formData: FormData): Promise<FinanceActionState> {
  const guard = await requireFinanceManager();
  if ("state" in guard) return guard.state;
  const method = text(formData, "method");
  const raw = {
    requestId: text(formData, "requestId"),
    expenseId: text(formData, "expenseId"),
    expectedRevision: text(formData, "expectedRevision"),
    method,
    accountId: method === "CASH" ? text(formData, "accountId") : null,
    paymentDate: text(formData, "paymentDate"),
    actuallyPaid: confirmed(formData, "actuallyPaid"),
    openingOrder: text(formData, "openingOrder") || null,
    includedInOpening: confirmed(formData, "includedInOpening"),
    afterCountId: text(formData, "afterCountId") || null,
    afterCount: confirmed(formData, "afterCount"),
    expectedBalance: method === "CASH" ? text(formData, "expectedBalance") : null,
    negativeAcknowledged: confirmed(formData, "negativeAcknowledged"),
  };
  try {
    const result = await payExpense(financeDb, guard.session.id, raw);
    revalidateFinance();
    return {
      status: "success",
      id: result.id,
      message: result.replayed ? "سبق حفظ هذا الطلب؛ لم تُسجَّل حركة مكررة." : "سُجّل الصرف الفعلي للمصروف.",
    };
  } catch (error) {
    return translate(error);
  }
}

export async function requestExpenseReviewAction(_previous: FinanceActionState, formData: FormData): Promise<FinanceActionState> {
  const guard = await requireFinanceManager();
  if ("state" in guard) return guard.state;
  const raw = {
    requestId: text(formData, "requestId"),
    expenseId: text(formData, "expenseId"),
    expectedRevision: text(formData, "expectedRevision"),
    reason: text(formData, "reason"),
    proposedAmount: text(formData, "proposedAmount") || null,
  };
  try {
    const result = await requestPaidExpenseReview(financeDb, guard.session.id, raw);
    revalidateFinance();
    return {
      status: "success",
      id: result.id,
      message: result.replayed ? "سبق حفظ هذا الطلب؛ لم يُنشأ طلب مكرر." : "سُجّل طلب المراجعة. لا يتغير الرصيد ولا المبلغ قبل تأكيد الإدارة.",
    };
  } catch (error) {
    return translate(error);
  }
}

export async function requestCountAction(_previous: FinanceActionState, formData: FormData): Promise<FinanceActionState> {
  const guard = await requireFinanceManager();
  if ("state" in guard) return guard.state;
  const raw = {
    requestId: text(formData, "requestId"),
    accountId: text(formData, "accountId"),
    expectedBalance: text(formData, "expectedBalance"),
    countedAmount: text(formData, "countedAmount"),
    reason: text(formData, "reason"),
    actuallyCounted: confirmed(formData, "actuallyCounted"),
  };
  try {
    const result = await requestCashCount(financeDb, guard.session.id, raw);
    revalidateFinance();
    return {
      status: "success",
      id: result.id,
      message: result.replayed
        ? "سبق حفظ هذا الطلب؛ لم يُسجَّل جرد مكرر."
        : "سُجّل الجرد كملاحظة أولية. الفرق لا يؤثر على الرصيد إلا بتأكيد تسوية منفصل.",
    };
  } catch (error) {
    return translate(error);
  }
}

export async function confirmCountAction(_previous: FinanceActionState, formData: FormData): Promise<FinanceActionState> {
  const guard = await requireFinanceManager();
  if ("state" in guard) return guard.state;
  const raw = {
    requestId: text(formData, "requestId"),
    countId: text(formData, "countId"),
    reason: text(formData, "reason"),
    stillCurrent: confirmed(formData, "stillCurrent"),
  };
  try {
    const result = await confirmCashCount(financeDb, guard.session.id, raw);
    revalidateFinance();
    return {
      status: "success",
      id: result.id,
      message: result.replayed ? "سبق حفظ هذا الطلب؛ لم تتكرر التسوية." : "أُكدت تسوية الجرد وسُجّل الفرق كحركة رصيد.",
    };
  } catch (error) {
    return translate(error);
  }
}

export async function cancelCountAction(_previous: FinanceActionState, formData: FormData): Promise<FinanceActionState> {
  const guard = await requireFinanceManager();
  if ("state" in guard) return guard.state;
  const raw = {
    requestId: text(formData, "requestId"),
    countId: text(formData, "countId"),
    reason: text(formData, "reason"),
  };
  try {
    const result = await cancelCashCount(financeDb, guard.session.id, raw);
    revalidateFinance();
    return {
      status: "success",
      id: result.id,
      message: result.replayed ? "سبق حفظ هذا الطلب؛ لم يتكرر الإلغاء." : "أُلغي طلب الجرد بسبب موثق، بلا أي حركة نقد.",
    };
  } catch (error) {
    return translate(error);
  }
}

export async function createCategoryAction(_previous: FinanceActionState, formData: FormData): Promise<FinanceActionState> {
  const guard = await requireFinanceManager();
  if ("state" in guard) return guard.state;
  const raw = { requestId: text(formData, "requestId"), name: text(formData, "name") };
  try {
    const result = await createAppCategory(financeDb, guard.session.id, raw);
    revalidateFinance();
    return {
      status: "success",
      id: result.id,
      message: result.replayed ? "سبق حفظ هذا الطلب؛ لم يُضف بند مكرر." : "أُضيف البند وهو نشط الآن.",
    };
  } catch (error) {
    return translate(error);
  }
}

export async function editCategoryAction(_previous: FinanceActionState, formData: FormData): Promise<FinanceActionState> {
  const guard = await requireFinanceManager();
  if ("state" in guard) return guard.state;
  const raw = {
    requestId: text(formData, "requestId"),
    categoryId: text(formData, "categoryId"),
    expectedSnapshot: text(formData, "expectedSnapshot"),
    name: text(formData, "name"),
    active: text(formData, "active") === "yes",
    reason: text(formData, "reason"),
  };
  try {
    const result = await editAppCategory(financeDb, guard.session.id, raw);
    revalidateFinance();
    return {
      status: "success",
      id: result.id,
      message: result.replayed ? "سبق حفظ هذا الطلب؛ لم يتكرر التعديل." : "حُفظ تعديل البند مع سببه في السجل.",
    };
  } catch (error) {
    return translate(error);
  }
}
