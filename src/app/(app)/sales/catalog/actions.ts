"use server";

import { revalidatePath } from "next/cache";

import { requireSession } from "@/lib/auth";
import {
  createSalesCategory, createSalesField, createSalesType,
  setSalesCategoryActive, setSalesFieldActive, setSalesTypeActive,
  updateSalesCategory, updateSalesField, updateSalesType,
} from "@/lib/catalog-sales";
import { InventoryProblem } from "@/lib/inventory-operations";
import { prisma } from "@/lib/prisma";
import type { CatalogActionState } from "./catalog-state";

/**
 * إجراءات إدارة أصناف البيع. الصلاحية الحقيقية داخل المحرك (مدير فقط، داخل
 * المعاملة نفسها)، لا في هذه الطبقة: الحارس هنا للتبكير في رفض الطلب فقط.
 */
function text(formData: FormData, key: string): string { const value = formData.get(key); return typeof value === "string" ? value : ""; }
function number(value: string): number | undefined { const parsed = Number(value); return Number.isSafeInteger(parsed) ? parsed : undefined; }

function failure(error: unknown): CatalogActionState {
  if (error instanceof InventoryProblem) return { status: "error", message: error.message, fieldErrors: error.fieldErrors };
  // لا تُسجَّل أسماء الأصناف أو أسباب التغيير في السجلات.
  const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" && /^P\d{4}$/.test(error.code) ? error.code : "unexpected";
  console.error("Catalog operation failed:", code);
  return { status: "error", message: "تعذر التأكد من نتيجة العملية. راجع الأصناف ثم أعد المحاولة من النموذج نفسه." };
}

function refresh() {
  try { revalidatePath("/sales/catalog"); revalidatePath("/sales/new"); revalidatePath("/sales"); } catch { console.error("Catalog cache revalidation failed"); }
}

type Result = { id: string; replayed: boolean };
async function run(work: (actorId: bigint) => Promise<Result>, done: string): Promise<CatalogActionState> {
  const session = await requireSession();
  try {
    const result = await work(BigInt(session.id));
    refresh();
    return { status: "success", message: result.replayed ? "سبق حفظ هذا الطلب؛ لم يُكرر." : done };
  } catch (error) { return failure(error); }
}

export async function createCategoryAction(_previous: CatalogActionState, formData: FormData): Promise<CatalogActionState> {
  if (text(formData, "reviewed") !== "yes") return { status: "error", message: "راجع بيانات التصنيف قبل الحفظ." };
  const raw = { requestId: text(formData, "requestId"), code: text(formData, "code"), nameAr: text(formData, "nameAr"), sortOrder: number(text(formData, "sortOrder")) };
  return run((actorId) => createSalesCategory(prisma, actorId, raw), "تمت إضافة التصنيف.");
}

export async function updateCategoryAction(_previous: CatalogActionState, formData: FormData): Promise<CatalogActionState> {
  if (text(formData, "reviewed") !== "yes") return { status: "error", message: "راجع بيانات التصنيف قبل الحفظ." };
  const raw = { requestId: text(formData, "requestId"), id: text(formData, "id"), nameAr: text(formData, "nameAr"), sortOrder: number(text(formData, "sortOrder")) };
  return run((actorId) => updateSalesCategory(prisma, actorId, raw), "تم تعديل التصنيف.");
}

export async function setCategoryActiveAction(_previous: CatalogActionState, formData: FormData): Promise<CatalogActionState> {
  const raw = { requestId: text(formData, "requestId"), id: text(formData, "id"), active: text(formData, "active") === "yes", reason: text(formData, "reason") };
  return run((actorId) => setSalesCategoryActive(prisma, actorId, raw), "تم تحديث حالة التصنيف.");
}

export async function createTypeAction(_previous: CatalogActionState, formData: FormData): Promise<CatalogActionState> {
  if (text(formData, "reviewed") !== "yes") return { status: "error", message: "راجع بيانات الصنف قبل الحفظ." };
  const raw = { requestId: text(formData, "requestId"), categoryId: text(formData, "categoryId"), nameAr: text(formData, "nameAr"), sortOrder: number(text(formData, "sortOrder")) };
  return run((actorId) => createSalesType(prisma, actorId, raw), "تمت إضافة الصنف.");
}

export async function updateTypeAction(_previous: CatalogActionState, formData: FormData): Promise<CatalogActionState> {
  if (text(formData, "reviewed") !== "yes") return { status: "error", message: "راجع بيانات الصنف قبل الحفظ." };
  const raw = { requestId: text(formData, "requestId"), id: text(formData, "id"), nameAr: text(formData, "nameAr"), sortOrder: number(text(formData, "sortOrder")) };
  return run((actorId) => updateSalesType(prisma, actorId, raw), "تم تعديل الصنف.");
}

export async function setTypeActiveAction(_previous: CatalogActionState, formData: FormData): Promise<CatalogActionState> {
  const raw = { requestId: text(formData, "requestId"), id: text(formData, "id"), active: text(formData, "active") === "yes", reason: text(formData, "reason") };
  return run((actorId) => setSalesTypeActive(prisma, actorId, raw), "تم تحديث حالة الصنف.");
}

export async function createFieldAction(_previous: CatalogActionState, formData: FormData): Promise<CatalogActionState> {
  if (text(formData, "reviewed") !== "yes") return { status: "error", message: "راجع بيانات الحقل قبل الحفظ." };
  const raw = {
    requestId: text(formData, "requestId"), typeId: text(formData, "typeId"), fieldKey: text(formData, "fieldKey"),
    labelAr: text(formData, "labelAr"), isRequired: text(formData, "isRequired") === "yes", sortOrder: number(text(formData, "sortOrder")),
  };
  return run((actorId) => createSalesField(prisma, actorId, raw), "تمت إضافة الحقل.");
}

export async function updateFieldAction(_previous: CatalogActionState, formData: FormData): Promise<CatalogActionState> {
  if (text(formData, "reviewed") !== "yes") return { status: "error", message: "راجع بيانات الحقل قبل الحفظ." };
  const raw = {
    requestId: text(formData, "requestId"), id: text(formData, "id"), labelAr: text(formData, "labelAr"),
    isRequired: text(formData, "isRequired") === "yes", sortOrder: number(text(formData, "sortOrder")),
  };
  return run((actorId) => updateSalesField(prisma, actorId, raw), "تم تعديل الحقل.");
}

export async function setFieldActiveAction(_previous: CatalogActionState, formData: FormData): Promise<CatalogActionState> {
  const raw = { requestId: text(formData, "requestId"), id: text(formData, "id"), active: text(formData, "active") === "yes", reason: text(formData, "reason") };
  return run((actorId) => setSalesFieldActive(prisma, actorId, raw), "تم تحديث حالة الحقل.");
}
