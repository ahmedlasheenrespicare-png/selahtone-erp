"use server";

import { revalidatePath } from "next/cache";
import { writeAccessAllowed, WRITE_DENIED_MESSAGE } from "@/lib/access-control-server";
import { requireSession, type SessionUser } from "@/lib/auth";
import { createAppCategory, editAppCategory } from "@/lib/finance/app-categories";
import { financeDb, financeDbForSession, financeEnabled } from "@/lib/finance/db";
import { approveExpense, cancelCashCount, cancelSettlement, confirmCashCount, confirmSettlement, createExpense, openAccount, payExpense, closePaidExpenseReview, rejectSettlement, requestCashCount, requestPaidExpenseReview, requestSettlement, transferCash, closeAccount, requestCustody, decideCustodyRequest, requestCountFromHolder, submitHolderCount } from "@/lib/finance/engine";
import { buildCustodyDecisionPayload } from "@/lib/finance/new-account-helpers";
import { payExpensePayload } from "@/lib/finance/pay-expense-source";
import { FinanceProblem } from "@/lib/finance/types";
import type { FinanceActionState } from "./finance-state";

/**
 * Every finance write is a single SERIALIZABLE transaction inside the engine,
 * and the actor's role, status and branch are re-read from the database there.
 * Each write also rechecks the session role, branch and email under the actor lock.
 * The auth session and the operation's access-control rules are rechecked inside
 * the same transaction; the outer permission check is only early UX feedback.
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
async function requireFinanceManager(route: string): Promise<Guard> {
  const session = await requireSession();
  if (!financeEnabled()) return { state: { status: "error", message: "وحدة المالية غير مفعّلة في هذا النشر." } };
  if (!(await writeAccessAllowed(route))) return { state: { status: "error", message: WRITE_DENIED_MESSAGE } };
  if (session.role !== "MANAGER" && session.role !== "ACCOUNTANT") {
    return { state: { status: "error", message: "إدارة الحسابات النقدية متاحة للمدير والمحاسب فقط." } };
  }
  return { session };
}
/** Recording an expense is open to management and to branch staff; the engine
 * re-reads the actor and refuses any branch that is not the staff member's own. */
async function requireFinanceWriter(route: string): Promise<Guard> {
  const session = await requireSession();
  if (!financeEnabled()) return { state: { status: "error", message: "وحدة المالية غير مفعّلة في هذا النشر." } };
  if (!(await writeAccessAllowed(route))) return { state: { status: "error", message: WRITE_DENIED_MESSAGE } };
  return { session };
}
function translate(error: unknown): FinanceActionState {
  if (error instanceof FinanceProblem) return { status: "error", code: error.code, message: error.message, details: error.details };
  return unexpected(error);
}
function revalidateFinance(): void {
  for (const path of ["/finance", "/finance/accounts", "/finance/transfers", "/finance/expenses", "/finance/counts", "/finance/categories", "/finance/settlements", "/finance/mine", "/dashboard"]) {
    try { revalidatePath(path); } catch { console.error("Finance cache revalidation failed"); }
  }
}

export async function openAccountAction(_previous: FinanceActionState, formData: FormData): Promise<FinanceActionState> {
  const guard = await requireFinanceManager("/finance/accounts#open");
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
    const result = await openAccount(financeDbForSession(financeDb, guard.session, "/finance/accounts#open"), guard.session.id, raw);
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

/** إقفال عهدة بعد تصفيتها. ليس حركة مال: فالرصيد صفرٌ سلفًا بتسوية سابقة. */
export async function closeAccountAction(_previous: FinanceActionState, formData: FormData): Promise<FinanceActionState> {
  const guard = await requireFinanceManager("/finance#close-custody");
  if ("state" in guard) return guard.state;
  const raw = {
    requestId: text(formData, "requestId"),
    accountId: text(formData, "accountId"),
    reason: text(formData, "reason") || null,
  };
  try {
    const result = await closeAccount(financeDbForSession(financeDb, guard.session, "/finance#close-custody"), guard.session.id, raw);
    revalidateFinance();
    return {
      status: "success",
      id: result.id,
      message: result.replayed ? "سبق حفظ هذا الطلب؛ لم يُقفل الحساب مرتين." : "أُقفلت العهدة. سجلها وحركاتها وتسوياتها باقية للمراجعة.",
    };
  } catch (error) {
    return translate(error);
  }
}

export async function transferCashAction(_previous: FinanceActionState, formData: FormData): Promise<FinanceActionState> {
  const guard = await requireFinanceWriter("/finance/transfers#transfer");
  if ("state" in guard) return guard.state;
  const fromId = text(formData, "fromId");
  const toId = text(formData, "toId");
  const raw = {
    requestId: text(formData, "requestId"),
    fromId,
    toId,
    amount: text(formData, "amount"),
    expectedBalance: text(formData, "expectedBalance"),
    actuallyTransferred: confirmed(formData, "actuallyTransferred"),
    negativeAcknowledged: confirmed(formData, "negativeAcknowledged"),
  };
  try {
    // The engine handles idempotent replay before locking and checking the
    // accounts. A separate precheck here would incorrectly reject a replay
    // after one account is later closed.
    const result = await transferCash(financeDbForSession(financeDb, guard.session, "/finance/transfers#transfer"), guard.session.id, raw);
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
  const guard = await requireFinanceWriter("/finance/expenses/new");
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
    const result = await createExpense(financeDbForSession(financeDb, guard.session, "/finance/expenses/new"), guard.session.id, raw);
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
  const guard = await requireFinanceManager("/finance/expenses#approve");
  if ("state" in guard) return guard.state;
  const raw = {
    requestId: text(formData, "requestId"),
    expenseId: text(formData, "expenseId"),
    expectedRevision: text(formData, "expectedRevision"),
    selfApproved: confirmed(formData, "selfApproved"),
  };
  try {
    const result = await approveExpense(financeDbForSession(financeDb, guard.session, "/finance/expenses#approve"), guard.session.id, raw);
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
  const guard = await requireFinanceManager("/finance/expenses#pay");
  if ("state" in guard) return guard.state;
  // مصدر الصرف (نقد الموظف أو خصم فوري) يُشكَّل في وحدة مُختبَرة: غيابه يعني خصمًا
  // فوريًا، ومثل هذا الدفع لا يصل إلى التسوية أبدًا.
  const raw = payExpensePayload(formData);
  try {
    const result = await payExpense(financeDbForSession(financeDb, guard.session, "/finance/expenses#pay"), guard.session.id, raw);
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
  const guard = await requireFinanceManager("/finance/expenses#review");
  if ("state" in guard) return guard.state;
  const raw = {
    requestId: text(formData, "requestId"),
    expenseId: text(formData, "expenseId"),
    expectedRevision: text(formData, "expectedRevision"),
    reason: text(formData, "reason"),
    proposedAmount: text(formData, "proposedAmount") || null,
  };
  try {
    const result = await requestPaidExpenseReview(financeDbForSession(financeDb, guard.session, "/finance/expenses#review"), guard.session.id, raw);
    revalidateFinance();
    return {
      status: "success",
      id: result.id,
      message: result.replayed ? "سبق حفظ هذا الطلب؛ لم يُنشأ طلب مكرر." : "سُجّل طلب المراجعة دون تغيير المبلغ أو الرصيد؛ يمكن لمراجع آخر مخوّل إغلاقه دون تصحيح بعد فحصه.",
    };
  } catch (error) {
    return translate(error);
  }
}

export async function closeExpenseReviewAction(_previous: FinanceActionState, formData: FormData): Promise<FinanceActionState> {
  const guard = await requireFinanceManager("/finance/expenses#review");
  if ("state" in guard) return guard.state;
  try {
    const result = await closePaidExpenseReview(financeDbForSession(financeDb, guard.session, "/finance/expenses#review"), guard.session.id, {
      requestId: text(formData, "requestId"), reviewId: text(formData, "reviewId"),
      reason: text(formData, "reason"), expectedRevision: text(formData, "expectedRevision"), expectedReviewSnapshot: text(formData, "expectedReviewSnapshot"), reviewedNoChange: confirmed(formData, "reviewedNoChange"),
    });
    revalidateFinance();
    return { status: "success", id: result.id, message: result.replayed
      ? "سبق إغلاق الطلب دون تصحيح؛ لم تُسجّل عملية مكررة."
      : "أُغلق الطلب دون تصحيح أو حركة مالية. لا يثبت الإغلاق أثر الدفع أو التسوية ولا يرفع حراسة التصحيح." };
  } catch (error) { return translate(error); }
}

export async function requestCountAction(_previous: FinanceActionState, formData: FormData): Promise<FinanceActionState> {
  const guard = await requireFinanceManager("/finance/counts#request");
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
    const result = await requestCashCount(financeDbForSession(financeDb, guard.session, "/finance/counts#request"), guard.session.id, raw);
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
  const guard = await requireFinanceManager("/finance/counts#confirm");
  if ("state" in guard) return guard.state;
  const raw = {
    requestId: text(formData, "requestId"),
    countId: text(formData, "countId"),
    reason: text(formData, "reason"),
    stillCurrent: confirmed(formData, "stillCurrent"),
  };
  try {
    const result = await confirmCashCount(financeDbForSession(financeDb, guard.session, "/finance/counts#confirm"), guard.session.id, raw);
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
  const guard = await requireFinanceManager("/finance/counts#cancel");
  if ("state" in guard) return guard.state;
  const raw = {
    requestId: text(formData, "requestId"),
    countId: text(formData, "countId"),
    reason: text(formData, "reason"),
  };
  try {
    const result = await cancelCashCount(financeDbForSession(financeDb, guard.session, "/finance/counts#cancel"), guard.session.id, raw);
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
  const guard = await requireFinanceManager("/finance/categories#create");
  if ("state" in guard) return guard.state;
  const raw = { requestId: text(formData, "requestId"), name: text(formData, "name") };
  try {
    const result = await createAppCategory(financeDbForSession(financeDb, guard.session, "/finance/categories#create"), guard.session.id, raw);
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
  const guard = await requireFinanceManager("/finance/categories#edit");
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
    const result = await editAppCategory(financeDbForSession(financeDb, guard.session, "/finance/categories#edit"), guard.session.id, raw);
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

/** طلب تسوية من الموظف: لا يغيّر النقد ولا العهدة، ويبقى بانتظار اعتماد الإدارة. */
export async function requestSettlementAction(_previous: FinanceActionState, formData: FormData): Promise<FinanceActionState> {
  const guard = await requireFinanceWriter("/finance/settlements/new#request");
  if ("state" in guard) return guard.state;
  const raw = {
    requestId: text(formData, "requestId"),
    accountId: text(formData, "accountId"),
    countedAmount: text(formData, "countedAmount"),
    expectedBalance: text(formData, "expectedBalance"),
    reason: text(formData, "reason"),
    actuallyCounted: confirmed(formData, "actuallyCounted"),
  };
  try {
    const result = await requestSettlement(financeDbForSession(financeDb, guard.session, "/finance/settlements/new#request"), guard.session.id, raw);
    revalidateFinance();
    return {
      status: "success",
      id: result.id,
      message: result.replayed ? "سبق تسجيل هذا الطلب؛ لم يُسجَّل طلب مكرر." : "سُجّل طلب التسوية وهو بانتظار اعتماد المدير.",
    };
  } catch (error) {
    return translate(error);
  }
}

/** اعتماد التسوية وتسجيل تعديلها والتحويل المدخل في معاملة واحدة. */
export async function confirmSettlementAction(_previous: FinanceActionState, formData: FormData): Promise<FinanceActionState> {
  const guard = await requireFinanceManager("/finance/transfers#confirm-settlement");
  if ("state" in guard) return guard.state;
  const raw = {
    requestId: text(formData, "requestId"),
    settlementId: text(formData, "settlementId"),
    expectedBalance: text(formData, "expectedBalance"),
    transferAmount: text(formData, "transferAmount"),
    transferDirection: text(formData, "transferDirection"),
    reason: text(formData, "reason"),
    actuallyTransferred: confirmed(formData, "actuallyTransferred"),
    negativeAcknowledged: confirmed(formData, "negativeAcknowledged"),
  };
  try {
    const result = await confirmSettlement(financeDbForSession(financeDb, guard.session, "/finance/transfers#confirm-settlement"), guard.session.id, raw);
    revalidateFinance();
    return {
      status: "success",
      id: result.id,
      message: result.replayed ? "سبق حفظ هذا الطلب؛ لم تُسجَّل حركة مكررة." : "اعتُمدت التسوية وسُجّل مبلغ التحويل المُدخل إن كان غير صفر؛ التسجيل والإقرار لا يثبتان انتقال النقد فعليًا.",
    };
  } catch (error) {
    return translate(error);
  }
}

export async function rejectSettlementAction(_previous: FinanceActionState, formData: FormData): Promise<FinanceActionState> {
  const guard = await requireFinanceManager("/finance/transfers#reject-settlement");
  if ("state" in guard) return guard.state;
  const raw = { requestId: text(formData, "requestId"), settlementId: text(formData, "settlementId"), reason: text(formData, "reason") };
  try {
    const result = await rejectSettlement(financeDbForSession(financeDb, guard.session, "/finance/transfers#reject-settlement"), guard.session.id, raw);
    revalidateFinance();
    return { status: "success", id: result.id, message: result.replayed ? "سبق حفظ هذا القرار." : "رُفض طلب التسوية بسبب مدوّن، بلا أي أثر على النقد." };
  } catch (error) {
    return translate(error);
  }
}

/** إلغاء الطلب من صاحبه (أو الإدارة) قبل الاعتماد: بلا أي أثر مالي. */
export async function cancelSettlementAction(_previous: FinanceActionState, formData: FormData): Promise<FinanceActionState> {
  const guard = await requireFinanceWriter("/finance/settlements#cancel");
  if ("state" in guard) return guard.state;
  const raw = { requestId: text(formData, "requestId"), settlementId: text(formData, "settlementId"), reason: text(formData, "reason") };
  try {
    const result = await cancelSettlement(financeDbForSession(financeDb, guard.session, "/finance/settlements#cancel"), guard.session.id, raw);
    revalidateFinance();
    return { status: "success", id: result.id, message: result.replayed ? "سبق حفظ هذا القرار." : "أُلغي طلب التسوية، بلا أي أثر على النقد." };
  } catch (error) {
    return translate(error);
  }
}

/** طلب عهدة: يقدّمه الموظف، ويبتّ فيه المدير أو المحاسب. */
export async function requestCustodyAction(_previous: FinanceActionState, formData: FormData): Promise<FinanceActionState> {
  const guard = await requireFinanceWriter("/finance/mine#request-custody");
  if ("state" in guard) return guard.state;
  const { session } = guard;
  try {
    const result = await requestCustody(financeDbForSession(financeDb, session, "/finance/mine#request-custody"), session.id, {
      requestId: formData.get("requestId"), amount: formData.get("amount"), reason: formData.get("reason"),
    });
    revalidateFinance();
    return { status: "success", message: `سُجّل طلب العهدة برقم ${result.id}، وهو بانتظار اعتماد المدير.` };
  } catch (error) { return translate(error); }
}

/** البتّ في طلب عهدة: بالموافقة تُفتح العهدة بجرد فعلي، أو بالرفض بسبب. */
export async function decideCustodyRequestAction(_previous: FinanceActionState, formData: FormData): Promise<FinanceActionState> {
  const guard = await requireFinanceManager("/finance/accounts#decide-custody");
  if ("state" in guard) return guard.state;
  const { session } = guard;
  const payload = buildCustodyDecisionPayload({
    requestId: text(formData, "requestId"),
    requestDbId: text(formData, "requestDbId"),
    decision: text(formData, "decision"),
    reason: text(formData, "reason"),
    openingDate: text(formData, "openingDate"),
    countedRaw: text(formData, "counted"),
    expectedSnapshot: text(formData, "expectedSnapshot"),
  });
  try {
    const result = await decideCustodyRequest(financeDbForSession(financeDb, session, "/finance/accounts#decide-custody"), session.id, payload);
    revalidateFinance();
    return {
      status: "success",
      id: result.id,
      message:
        payload.decision === "APPROVE"
          ? result.replayed
            ? "سبق اعتماد هذا الطلب؛ لم تُفتح عهدة مكررة."
            : "اعتُمد طلب العهدة وفُتحت العهدة بالرصيد الفعلي بعد تأكيد الجرد."
          : "رُفض طلب العهدة بسبب مدوّن، دون أي أثر مالي.",
    };
  } catch (error) { return translate(error); }
}

/** المدير يطلب جردًا من موظف: فيعدّه الموظف بنفسه ثم يعتمده المدير. */
export async function requestCountFromHolderAction(_previous: FinanceActionState, formData: FormData): Promise<FinanceActionState> {
  const guard = await requireFinanceManager("/finance/counts#request-holder");
  if ("state" in guard) return guard.state;
  const { session } = guard;
  try {
    const result = await requestCountFromHolder(financeDbForSession(financeDb, session, "/finance/counts#request-holder"), session.id, {
      requestId: formData.get("requestId"), accountId: formData.get("accountId"), reason: formData.get("reason"),
    });
    revalidateFinance();
    return { status: "success", message: `طُلب الجرد من الموظف (طلب ${result.id}).` };
  } catch (error) { return translate(error); }
}

/** الموظف يعدّ الجرد الموجَّه ويُقرّ أنّه عدّه بنفسه. */
export async function submitHolderCountAction(_previous: FinanceActionState, formData: FormData): Promise<FinanceActionState> {
  const guard = await requireFinanceWriter("/finance/mine#submit-count");
  if ("state" in guard) return guard.state;
  const { session } = guard;
  try {
    await submitHolderCount(financeDbForSession(financeDb, session, "/finance/mine#submit-count"), session.id, {
      requestId: text(formData, "requestId"),
      countId: text(formData, "countId"),
      countedAmount: text(formData, "countedAmount"),
      actuallyCounted: confirmed(formData, "actuallyCounted"),
    });
    revalidateFinance();
    return { status: "success", message: "سُجّل جردُك، وهو بانتظار تأكيد المدير." };
  } catch (error) { return translate(error); }
}
