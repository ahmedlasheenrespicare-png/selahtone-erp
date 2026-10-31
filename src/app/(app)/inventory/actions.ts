"use server";

import { revalidatePath } from "next/cache";
import { canSeeAllBranches, requireSession } from "@/lib/auth";
import { inventoryEnabled } from "@/lib/feature-flags";
import { prisma } from "@/lib/prisma";
import { createInventoryOpening, createInventoryProduct, InventoryProblem } from "@/lib/inventory-operations";
import { receiveInventoryStock } from "@/lib/receiving-operations";
import type { ReceiptInputRaw } from "@/lib/receiving-validation";
import { parseProductInput, type OpeningInputRaw, type ProductInputRaw } from "@/lib/inventory-validation";
import type { InventoryActionState } from "./inventory-state";

/** المخزون معطّل افتراضيًا: أي إجراء مخزون يُرفض قبل لمس قاعدة البيانات. */
function inventoryDisabled(): InventoryActionState | null {
  return inventoryEnabled() ? null : { status: "error", message: "المخزون والمستودعات معطّلة حاليًا في هذا النظام." };
}

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function unexpected(error: unknown): InventoryActionState {
  // لا نكتب بيانات النموذج أو الأرقام التسلسلية في السجلات.
  const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" && /^P\d{4}$/.test(error.code) ? error.code : "unexpected";
  console.error("Inventory operation failed:", code);
  return { status: "error", message: "تعذر التأكد من نتيجة العملية. راجع المخزون قبل بدء طلب جديد؛ يمكن إعادة المحاولة من النموذج نفسه دون تكرار الطلب." };
}

export async function createProductAction(_previous: InventoryActionState, formData: FormData): Promise<InventoryActionState> {
  const blocked = inventoryDisabled();
  if (blocked) return blocked;
  const session = await requireSession();
  if (!canSeeAllBranches(session)) return { status: "error", message: "إضافة الأصناف متاحة للمدير والمحاسب فقط." };
  if (text(formData, "reviewed") !== "yes") return { status: "error", message: "راجع بيانات الصنف قبل تأكيد الحفظ." };

  const raw: ProductInputRaw = {
    requestId: text(formData, "requestId"),
    sku: text(formData, "sku"),
    nameAr: text(formData, "nameAr"),
    category: text(formData, "category"),
    brand: text(formData, "brand"),
    model: text(formData, "model"),
    purchaseCost: text(formData, "purchaseCost"),
    salePrice: text(formData, "salePrice"),
    taxRateId: text(formData, "taxRateId"),
    isSerialized: text(formData, "isSerialized") === "yes",
  };
  const parsed = parseProductInput(raw);
  if (!parsed.ok) return { status: "error", message: "راجع البيانات المحددة ثم حاول مجددًا.", fieldErrors: parsed.errors };

  let result;
  try {
    result = await createInventoryProduct(prisma, BigInt(session.id), parsed.value);
  } catch (error) {
    if (error instanceof InventoryProblem) return { status: "error", message: error.message, fieldErrors: error.fieldErrors };
    return unexpected(error);
  }
  // الحفظ اكتمل حتى لو تعذّر تحديث الكاش؛ صفحات المخزون ديناميكية أصلًا.
  try {
    revalidatePath("/inventory");
    revalidatePath("/inventory/opening");
    revalidatePath("/dashboard");
  } catch { console.error("Inventory cache revalidation failed"); }
  return { status: "success", id: result.id, message: result.replayed ? "سبق حفظ هذا الطلب؛ لم يُضف صنف مكرر." : "تمت إضافة الصنف. لم يُسجّل رصيد له بعد." };
}

export async function createOpeningAction(_previous: InventoryActionState, formData: FormData): Promise<InventoryActionState> {
  const blocked = inventoryDisabled();
  if (blocked) return blocked;
  const session = await requireSession();
  if (!canSeeAllBranches(session)) return { status: "error", message: "تسجيل الأرصدة متاح للمدير والمحاسب فقط." };
  if (text(formData, "reviewed") !== "yes") return { status: "error", message: "راجع الرصيد والأرقام قبل تأكيد الحفظ." };

  const raw: OpeningInputRaw = {
    requestId: text(formData, "requestId"),
    productId: text(formData, "productId"),
    warehouseId: text(formData, "warehouseId"),
    quantity: text(formData, "quantity"),
    unitCost: text(formData, "unitCost"),
    serialNumbers: text(formData, "serialNumbers"),
  };
  let result;
  try {
    result = await createInventoryOpening(prisma, BigInt(session.id), raw);
  } catch (error) {
    if (error instanceof InventoryProblem) return { status: "error", message: error.message, fieldErrors: error.fieldErrors };
    return unexpected(error);
  }
  try {
    revalidatePath("/inventory");
    revalidatePath("/inventory/opening");
    revalidatePath("/inventory/serials");
    revalidatePath("/dashboard");
  } catch { console.error("Inventory cache revalidation failed"); }
  return { status: "success", id: result.id, message: result.replayed ? "سبق حفظ هذا الطلب؛ لم يُضف الرصيد مرة أخرى." : "تم حفظ الرصيد الافتتاحي والأرقام المسجّلة معه." };
}

export async function createReceiptAction(_previous: InventoryActionState, formData: FormData): Promise<InventoryActionState> {
  const blocked = inventoryDisabled();
  if (blocked) return blocked;
  const session = await requireSession();
  if (session.role !== "MANAGER" && session.role !== "CS_AGENT") return { status: "error", message: "تسجيل التوريد متاح للمدير وموظف الفرع فقط." };
  if (text(formData, "reviewed") !== "yes") return { status: "error", message: "راجع تفاصيل التوريد والأرقام قبل تأكيد الحفظ." };
  const raw: ReceiptInputRaw = {
    requestId: text(formData, "requestId"), productId: text(formData, "productId"),
    warehouseId: text(formData, "warehouseId"), quantity: text(formData, "quantity"),
    unitCost: text(formData, "unitCost"), serialNumbers: text(formData, "serialNumbers"),
    sourceReference: text(formData, "sourceReference"),
  };
  let result;
  try {
    result = await receiveInventoryStock(prisma, BigInt(session.id), raw);
  } catch (error) {
    if (error instanceof InventoryProblem) return { status: "error", message: error.message, fieldErrors: error.fieldErrors };
    return unexpected(error);
  }
  try {
    revalidatePath("/inventory");
    revalidatePath("/inventory/receipts");
    revalidatePath("/inventory/serials");
    revalidatePath("/dashboard");
  } catch { console.error("Inventory cache revalidation failed"); }
  return { status: "success", id: result.id, message: result.replayed ? "سبق حفظ هذا التوريد؛ لم تُضف الكمية مرة أخرى." : "تم تسجيل التوريد وإضافة الكمية للمخزون." };
}
