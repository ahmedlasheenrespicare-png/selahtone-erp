"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { InventoryProblem } from "@/lib/inventory-operations";
import { FinanceProblem } from "../../../../prototypes/finance-engine/types";
import { changeStaffDiscountLimit, createCommerceSale, recordCommerceCollection, recordCommerceRefund, recordHistoricalCollection, recordHistoricalRefund, returnCommerceSale } from "@/lib/commerce-operations";
import type { SalesActionState } from "./sales-state";

function text(formData: FormData, key: string): string { const value = formData.get(key); return typeof value === "string" ? value : ""; }
function payload(formData: FormData): unknown {
  const raw = text(formData, "payload");
  if (!raw || raw.length > 200_000) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
function failure(error: unknown): SalesActionState {
  if (error instanceof FinanceProblem) return { status: "error", message: error.message };
  if (error instanceof InventoryProblem) return { status: "error", message: error.message, fieldErrors: error.fieldErrors };
  // لا تُسجّل بيانات العميل أو السيريالات أو المبالغ في السجلات.
  const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" && /^P\d{4}$/.test(error.code) ? error.code : "unexpected";
  console.error("Commerce operation failed:", code);
  return { status: "error", message: "تعذر التأكد من نتيجة العملية. راجع الفاتورة والمخزون قبل بدء طلب جديد؛ يمكن إعادة المحاولة من النموذج نفسه." };
}
function refresh(saleId?: string) {
  try {
    revalidatePath("/sales"); revalidatePath("/sales/settings"); revalidatePath("/inventory"); revalidatePath("/inventory/serials"); revalidatePath("/dashboard");
    if (saleId && /^[1-9]\d{0,18}$/.test(saleId)) revalidatePath(`/sales/${saleId}`);
  } catch { console.error("Commerce cache revalidation failed"); }
}

export async function createSaleAction(_previous: SalesActionState, formData: FormData): Promise<SalesActionState> {
  const session = await requireSession();
  if (text(formData, "reviewed") !== "yes") return { status: "error", message: "راجع الفاتورة قبل تأكيد البيع." };
  try {
    const result = await createCommerceSale(prisma, BigInt(session.id), payload(formData));
    refresh(result.id);
    return { status: "success", id: result.id, message: result.replayed ? "سبق حفظ هذا الطلب؛ لم تُسجّل فاتورة مكررة." : "تم تسجيل الفاتورة والتحصيل الأول وخصم المخزون." };
  } catch (error) { return failure(error); }
}

export async function collectAction(_previous: SalesActionState, formData: FormData): Promise<SalesActionState> {
  const session = await requireSession();
  if (text(formData, "reviewed") !== "yes") return { status: "error", message: "راجع التحصيل قبل التأكيد." };
  const raw = { requestId: text(formData, "requestId"), saleId: text(formData, "saleId"), amount: text(formData, "amount"), method: text(formData, "method"), actuallyPaid: false, cashAccountId: text(formData, "cashAccountId"), cashCheckpointRef: text(formData,"cashCheckpointRef"), afterCheckpoint: text(formData,"afterCheckpoint") === "yes" };
  try {
    const result = await recordCommerceCollection(prisma, BigInt(session.id), raw); refresh(raw.saleId);
    return { status: "success", id: result.id, message: result.replayed ? "سبق تسجيل هذا التحصيل؛ لم يُكرر." : "تم تسجيل التحصيل." };
  } catch (error) { return failure(error); }
}

export async function refundAction(_previous: SalesActionState, formData: FormData): Promise<SalesActionState> {
  const session = await requireSession();
  if (text(formData, "reviewed") !== "yes") return { status: "error", message: "راجع الرد قبل التأكيد." };
  const raw = { requestId: text(formData, "requestId"), saleId: text(formData, "saleId"), amount: text(formData, "amount"), method: text(formData, "method"), actuallyPaid: text(formData, "actuallyPaid") === "yes", cashAccountId: text(formData, "cashAccountId"), expectedBalance: text(formData, "expectedBalance"), negativeAcknowledged: text(formData, "negativeAcknowledged") === "yes", cashCheckpointRef: text(formData,"cashCheckpointRef"), afterCheckpoint: text(formData,"afterCheckpoint") === "yes" };
  try {
    const result = await recordCommerceRefund(prisma, BigInt(session.id), raw); refresh(raw.saleId);
    return { status: "success", id: result.id, message: result.replayed ? "سبق تسجيل هذا الرد؛ لم يُكرر." : "تم تسجيل المبلغ الذي دُفع للعميل بالفعل. لم يُنفّذ النظام تحويلًا." };
  } catch (error) { return failure(error); }
}

async function historicalAction(formData: FormData, refund: boolean): Promise<SalesActionState> {
  const session = await requireSession();
  if (session.role !== "MANAGER" && session.role !== "ACCOUNTANT") return {status:"error",message:"مراجعة العمليات التاريخية للمدير والمحاسب فقط."};
  if (text(formData,"reviewed") !== "yes") return {status:"error",message:"راجع العملية التاريخية قبل التأكيد."};
  const raw = {
    requestId:text(formData,"requestId"),saleId:text(formData,"saleId"),amount:text(formData,"amount"),method:"CASH",
    actuallyPaid:text(formData,"verifiedActual") === "yes",cashAccountId:text(formData,"cashAccountId"),actualDate:text(formData,"actualDate"),
    checkpointType:text(formData,"checkpointType"),checkpointCountId:text(formData,"checkpointCountId"),handler:text(formData,"handler"),reason:text(formData,"reason"),
    verifiedActual:text(formData,"verifiedActual") === "yes",beforeCheckpoint:text(formData,"beforeCheckpoint") === "yes",
    includedInCheckpoint:text(formData,"includedInCheckpoint") === "yes",notPreviouslyRecorded:text(formData,"notPreviouslyRecorded") === "yes",
    pendingCaseId:text(formData,"pendingCaseId"),caseReviewed:text(formData,"caseReviewed") === "yes",distinctFromPending:text(formData,"distinctFromPending") === "yes",caseSnapshot:text(formData,"caseSnapshot"),
  };
  try {
    const result = refund ? await recordHistoricalRefund(prisma,BigInt(session.id),raw) : await recordHistoricalCollection(prisma,BigInt(session.id),raw);
    refresh(raw.saleId); revalidatePath("/finance");
    return {status:"success",id:result.id,message:result.replayed ? "سبق تسجيل الطلب؛ لم تُكرر العملية." : "سُجلت العملية التاريخية على الفاتورة بعد المراجعة دون تغيير رصيد النقد."};
  } catch (error) { return failure(error); }
}
export async function historicalCollectionAction(_previous: SalesActionState, formData: FormData): Promise<SalesActionState> { return historicalAction(formData,false); }
export async function historicalRefundAction(_previous: SalesActionState, formData: FormData): Promise<SalesActionState> { return historicalAction(formData,true); }

export async function returnAction(_previous: SalesActionState, formData: FormData): Promise<SalesActionState> {
  const session = await requireSession();
  if (text(formData, "reviewed") !== "yes") return { status: "error", message: "راجع المرتجع قبل التأكيد." };
  const raw = payload(formData);
  try {
    const result = await returnCommerceSale(prisma, BigInt(session.id), raw);
    const saleId = raw && typeof raw === "object" && "saleId" in raw && typeof raw.saleId === "string" ? raw.saleId : undefined;
    refresh(saleId);
    return { status: "success", id: result.id, message: result.replayed ? "سبق حفظ هذا المرتجع؛ لم يُكرر." : "تم تسجيل المرتجع وإعادة المقبول للمخزون. لم يُسجّل رد مالي تلقائيًا." };
  } catch (error) { return failure(error); }
}

export async function discountSettingAction(_previous: SalesActionState, formData: FormData): Promise<SalesActionState> {
  const session = await requireSession();
  if (text(formData, "reviewed") !== "yes") return { status: "error", message: "راجع نسبة الخصم قبل الحفظ." };
  try {
    const result = await changeStaffDiscountLimit(prisma, BigInt(session.id), { requestId: text(formData, "requestId"), percent: text(formData, "percent") });
    refresh();
    return { status: "success", id: result.id, message: result.replayed ? "سبق حفظ هذا التغيير." : "تم تحديث حد خصم الموظف." };
  } catch (error) { return failure(error); }
}
