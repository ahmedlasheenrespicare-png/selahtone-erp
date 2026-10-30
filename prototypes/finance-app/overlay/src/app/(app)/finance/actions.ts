"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { scopedFinanceDb } from "@/lib/finance-lab";
import {
  addExpenseAttachment, addCategory, approveExpense, createExpense, editCategory, editUnpaidExpense,
  openAccount, correctOpeningBalance, payExpense, requestPaidExpenseReview, transferCash, requestCashCount, confirmCashCount, cancelCashCount, confirmPaidExpenseCorrection, closePaidExpenseReview,
  createReconciliationCase, addReconciliationNote, closeReconciliationCase,
} from "../../../../prototypes/finance-engine/engine";
import { FinanceProblem } from "../../../../prototypes/finance-engine/types";
import { readFictionalAttachment } from "@/lib/finance-attachment-form";
import type { FinanceActionState } from "./state";

const commands = { addCategory, approveExpense, createExpense, editCategory, editUnpaidExpense, openAccount, correctOpeningBalance, payExpense, requestPaidExpenseReview, transferCash, requestCashCount, confirmCashCount, cancelCashCount, confirmPaidExpenseCorrection, closePaidExpenseReview, createReconciliationCase, addReconciliationNote, closeReconciliationCase } as const;
type Command = keyof typeof commands;

/** Session is verified on the server; neither actor ID nor role comes from form data.
 * The core checks role, branch and current data again inside its transaction. */
export async function financeAction(_previous: FinanceActionState, data: FormData): Promise<FinanceActionState> {
  const session = await requireSession();
  if (session.role !== "MANAGER" && session.role !== "ACCOUNTANT") return { status: "error", message: "هذه العملية للمدير والمحاسب فقط." };
  const financeDb = scopedFinanceDb(session);
  const command = data.get("command");
  if (typeof command !== "string" || (command !== "addExpenseAttachment" && !Object.hasOwn(commands, command))) return { status: "error", message: "عملية غير معروفة." };
  const raw: Record<string, unknown> = {};
  for (const [key, value] of data) if (key !== "command" && typeof value === "string") raw[key] = value;
  for (const key of ["counted", "actuallyTransferred", "actuallyPaid", "includedInOpening", "negativeAcknowledged", "actuallyCounted", "stillCurrent", "verifiedPayment", "noPriorSettlement", "afterCount", "verifiedOpening", "countCovered", "caseReviewed", "verifiedNoChange"]) raw[key] = data.get(key) === "yes";
  if (command === "editCategory") {
    if (data.get("active") !== "true" && data.get("active") !== "false") return { status: "error", message: "حدد حالة البند." };
    raw.active = data.get("active") === "true";
  }
  try {
    let result;
    if (command === "addExpenseAttachment") {
      result = await addExpenseAttachment(financeDb, session.id, raw, await readFictionalAttachment(data));
    } else {
      result = await commands[command as Command](financeDb, session.id, raw);
    }
    revalidatePath("/finance"); revalidatePath("/sales");
    const saleId = data.get("saleId");
    if (typeof saleId === "string" && /^[1-9]\d{0,18}$/.test(saleId)) revalidatePath(`/sales/${saleId}`);
    const message = command === "createReconciliationCase" ? "حُفظت الحالة معلقة للمراجعة دون تغيير الفاتورة أو النقد." : command === "addReconciliationNote" ? "حُفظت الملاحظة؛ الحالة ما زالت معلقة." : command === "closeReconciliationCase" ? "أُغلقت الحالة دون تسجيل عملية أو تغيير النقد." : "تم الحفظ في التجربة الوهمية.";
    return { status: "success", message: result.replayed ? "سبق حفظ الطلب؛ لم يُكرر." : message };
  } catch (error) {
    if (error instanceof FinanceProblem) return { status: "error", message: error.message };
    // No customer, expense or account details are logged.
    console.error("Finance lab operation failed", typeof error === "object" && error && "code" in error ? String(error.code) : "unexpected");
    return { status: "error", message: "تعذر تأكيد الحفظ. راجع السجل والرصيد قبل محاولة طلب جديد." };
  }
}
