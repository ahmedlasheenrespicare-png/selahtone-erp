"use server";

import { revalidatePath } from "next/cache";
import { getAccessContext, writeAccessAllowed, WRITE_DENIED_MESSAGE } from "@/lib/access-control-server";
import { accessKeyAllowed } from "@/lib/access-control";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { InventoryProblem } from "@/lib/inventory-operations";
import { parseReturnInput } from "@/lib/commerce-validation";
import { createCatalogSale } from "@/lib/catalog-sales";
import { changeStaffDiscountLimit, createCommerceSale, recordCommerceCollection, recordCommerceRefund, returnCommerceSale } from "@/lib/commerce-operations";
import type { SalesActionState } from "./sales-state";

function text(formData: FormData, key: string): string { const value = formData.get(key); return typeof value === "string" ? value : ""; }
function payload(formData: FormData): unknown {
  const raw = text(formData, "payload");
  if (!raw || raw.length > 200_000) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
function failure(error: unknown): SalesActionState {
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
  if (!(await writeAccessAllowed("/sales/new"))) return { status: "error", message: WRITE_DENIED_MESSAGE };
  if (text(formData, "reviewed") !== "yes") return { status: "error", message: "راجع الفاتورة قبل تأكيد البيع." };
  try {
    const result = await createCommerceSale(prisma, { id: BigInt(session.id), sessionId: session.sessionId }, payload(formData));
    refresh(result.id);
    return { status: "success", id: result.id, message: result.replayed ? "سبق حفظ هذا الطلب؛ لم تُسجّل فاتورة مكررة." : "تم تسجيل الفاتورة والتحصيل الأول وخصم المخزون." };
  } catch (error) { return failure(error); }
}

export async function createCatalogSaleAction(_previous: SalesActionState, formData: FormData): Promise<SalesActionState> {
  const session = await requireSession();
  if (!(await writeAccessAllowed("/sales/new"))) return { status: "error", message: WRITE_DENIED_MESSAGE };
  if (text(formData, "reviewed") !== "yes") return { status: "error", message: "راجع الفاتورة قبل تأكيد البيع." };
  try {
    const result = await createCatalogSale(prisma, { id: BigInt(session.id), sessionId: session.sessionId }, payload(formData));
    refresh(result.id);
    return { status: "success", id: result.id, message: result.replayed ? "سبق حفظ هذا الطلب؛ لم تُسجّل فاتورة مكررة." : "تم تسجيل الفاتورة والدفعة الأولى. لا يوجد مخزون ولا مستودع في هذا المسار." };
  } catch (error) { return failure(error); }
}

export async function collectAction(_previous: SalesActionState, formData: FormData): Promise<SalesActionState> {
  const session = await requireSession();
  if (!(await writeAccessAllowed("/sales#collect"))) return { status: "error", message: WRITE_DENIED_MESSAGE };
  if (text(formData, "reviewed") !== "yes") return { status: "error", message: "راجع التحصيل قبل التأكيد." };
  const raw = { requestId: text(formData, "requestId"), saleId: text(formData, "saleId"), amount: text(formData, "amount"), method: text(formData, "method"), actuallyPaid: false };
  try {
    const result = await recordCommerceCollection(prisma, { id: BigInt(session.id), sessionId: session.sessionId }, raw); refresh(raw.saleId);
    return { status: "success", id: result.id, message: result.replayed ? "سبق تسجيل هذا التحصيل؛ لم يُكرر." : "تم تسجيل التحصيل." };
  } catch (error) { return failure(error); }
}

export async function refundAction(_previous: SalesActionState, formData: FormData): Promise<SalesActionState> {
  const session = await requireSession();
  if (!(await writeAccessAllowed("/sales#refund"))) return { status: "error", message: WRITE_DENIED_MESSAGE };
  if (text(formData, "reviewed") !== "yes") return { status: "error", message: "راجع الرد قبل التأكيد." };
  const method = text(formData, "method");
  const access = await getAccessContext();
  const canViewBalances = accessKeyAllowed(access.hidden, "/sales#refund-balances");
  const raw = {
    requestId: text(formData, "requestId"), saleId: text(formData, "saleId"), amount: text(formData, "amount"), method,
    actuallyPaid: text(formData, "actuallyPaid") === "yes",
    // الرد النقدي يخرج من حساب الفرع في المعاملة نفسها؛ غير النقدي لا يحرك نقدًا.
    accountId: method === "CASH" ? text(formData, "accountId") : null,
    negativeAcknowledged: text(formData, "negativeAcknowledged") === "yes",
    // An old form may retry a legacy request without either field. Do not
    // invent empty review fields, which would change its replay identity.
    ...(method === "CASH" && (formData.has("checkpointRef") || formData.has("timing"))
      ? { checkpointRef: text(formData, "checkpointRef"), timing: text(formData, "timing") } : {}),
  };
  // Do not silently rewrite the request payload: retries must keep the same hash.
  if (method === "CASH" && !canViewBalances && raw.negativeAcknowledged)
    return { status: "error", message: "لا يمكن تأكيد رصيد سالب دون صلاحية عرض الرصيد؛ راجع مسؤولًا مخولًا." };
  try {
    const result = await recordCommerceRefund(prisma, { id: BigInt(session.id), sessionId: session.sessionId }, raw); refresh(raw.saleId);
    return { status: "success", id: result.id, message: result.replayed ? "سبق تسجيل هذا الرد؛ لم يُكرر." : method === "CASH" ? "تم تسجيل المبلغ الذي دُفع للعميل بالفعل، وخُصم من الحساب المختار." : "تم تسجيل المبلغ الذي دُفع للعميل بالفعل؛ لم تُنشأ حركة نقدية." };
  } catch (error) {
    if (!canViewBalances && method === "CASH" && error instanceof InventoryProblem && error.message.includes("سيصبح الرصيد سالبًا"))
      return { status: "error", message: "تعذر الرد من الحساب المختار؛ راجع مسؤولًا مخولًا قبل المحاولة." };
    return failure(error);
  }
}

export async function returnAction(_previous: SalesActionState, formData: FormData): Promise<SalesActionState> {
  const session = await requireSession();
  if (text(formData, "reviewed") !== "yes") return { status: "error", message: "راجع المرتجع قبل التأكيد." };
  // Parse once before choosing the permission; never trust a separate client-supplied key.
  const parsed = parseReturnInput(payload(formData));
  if (!parsed.ok) return { status: "error", message: "راجع المرتجع ثم حاول مجددًا.", fieldErrors: parsed.errors };
  if (!(await writeAccessAllowed(parsed.value.cancel ? "/sales#cancel" : "/sales#return"))) return { status: "error", message: WRITE_DENIED_MESSAGE };
  try {
    const result = await returnCommerceSale(prisma, { id: BigInt(session.id), sessionId: session.sessionId }, parsed.value);
    const saleId = parsed.value.saleId;
    refresh(saleId);
    return { status: "success", id: result.id, message: result.replayed ? "سبق حفظ هذا المرتجع؛ لم يُكرر." : "تم تسجيل المرتجع وإعادة المقبول للمخزون. لم يُسجّل رد مالي تلقائيًا." };
  } catch (error) { return failure(error); }
}

export async function discountSettingAction(_previous: SalesActionState, formData: FormData): Promise<SalesActionState> {
  const session = await requireSession();
  if (!(await writeAccessAllowed("/sales/settings"))) return { status: "error", message: WRITE_DENIED_MESSAGE };
  if (text(formData, "reviewed") !== "yes") return { status: "error", message: "راجع نسبة الخصم قبل الحفظ." };
  try {
    const result = await changeStaffDiscountLimit(prisma, { id: BigInt(session.id), sessionId: session.sessionId }, { requestId: text(formData, "requestId"), percent: text(formData, "percent"), managerPercent: text(formData, "managerPercent") });
    refresh();
    return { status: "success", id: result.id, message: result.replayed ? "سبق حفظ هذا التغيير." : "تم تحديث حد خصم الموظف." };
  } catch (error) { return failure(error); }
}
