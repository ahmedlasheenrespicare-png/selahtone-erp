import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

import {
  distributeInvoiceDiscount, grossLineCents, staffDiscountAllowed, validateCollectionAmount,
  CommerceMathError,
} from "./commerce-math";
import { canPerformCommerce, type CommerceAction } from "./commerce-policy";
import { scaledInteger } from "./inventory-math";
import { InventoryProblem } from "./inventory-operations";
import {
  parseCatalogActive, parseCatalogField, parseCatalogFieldUpdate, parseCatalogId, parseCatalogName,
  parseCatalogSaleInput, parseCatalogTypeCreate, MAX_CATALOG_NAME,
  type CatalogActiveInput, type CatalogFieldInput, type CatalogFieldUpdateInput, type CatalogIdInput,
  type CatalogNameInput, type CatalogSaleInput, type CatalogTypeCreateInput,
} from "./catalog-validation";

/**
 * محرك البيع بالأصناف الفنية: لا مخزون ولا مستودع ولا سيريال ولا ضريبة محسوبة.
 *
 * القواعد الثابتة هنا:
 *  - الصنف يُقرأ من قاعدة البيانات لا من المتصفح، والموقوف منه لا يُباع.
 *  - السعر يكتبه الموظف وهو نهائي؛ الضريبة تُسجَّل «غير محددة» (فراغ لا صفر)،
 *    فلا حساب ولا إقرار تلقائي.
 *  - البيع ذرّي: فاتورة وبنودها ودفعتها الأولى تُحفظ في معاملة واحدة، أو لا شيء.
 *  - الحقول النصية يُتحقق من لزومها على الخادم، وتُحفظ لقطة لعناوينها وقيمها.
 */
type Db = PrismaClient;
type Transaction = Parameters<Parameters<Db["$transaction"]>[0]>[0];
type WriteResult = { id: string; replayed: boolean };

function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function isCode(error: unknown, code: string): boolean { return typeof error === "object" && error !== null && "code" in error && error.code === code; }
/** تكرار مفتاح فريد: رمز Prisma أو رسالة السائق مباشرةً (محرك اختبار بلا P2002). */
function isDuplicate(error: unknown): boolean {
  if (isCode(error, "P2002")) return true;
  return error instanceof Error && /duplicate key value violates unique constraint/i.test(error.message);
}
function fixed(value: bigint, places: number): string {
  if (value < 0n) throw new CommerceMathError("القيمة سالبة بصورة غير متوقعة.");
  const power = 10n ** BigInt(places);
  return `${value / power}.${(value % power).toString().padStart(places, "0")}`;
}
function ensureMatchingRequest(record: { requestHash: string; createdById: bigint }, actorId: bigint, expectedHash: string): void {
  if (record.createdById !== actorId || record.requestHash.trim() !== expectedHash) throw new InventoryProblem("استُخدم هذا الطلب مسبقًا ببيانات مختلفة. افتح نموذجًا جديدًا.");
}
async function withSerializableRetry<T>(db: Db, work: (tx: Transaction) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await db.$transaction(work, { isolationLevel: "Serializable", maxWait: 5000, timeout: 20000 }); }
    catch (error) { if (isCode(error, "P2034") && attempt < 2) continue; throw error; }
  }
}
async function authorize(tx: Transaction, actorId: bigint, action: CommerceAction, branchId: bigint | null, branchActive: boolean): Promise<void> {
  const actor = await tx.user.findUnique({ where: { id: actorId }, select: { status: true, roleCode: true, branchId: true, mustChangePassword: true } });
  if (!actor || !canPerformCommerce({ role: actor.roleCode, status: actor.status, mustChangePassword: actor.mustChangePassword, branchId: actor.branchId }, action, branchId, branchActive)) {
    throw new InventoryProblem("ليس لديك صلاحية لتنفيذ العملية في هذا الفرع.");
  }
}
function knownMath(error: unknown): never {
  if (error instanceof CommerceMathError) throw new InventoryProblem(error.message);
  throw error;
}

export type CatalogFieldView = { id: string; key: string; label: string; required: boolean; sortOrder: number; isActive: boolean };
export type CatalogTypeView = { id: string; name: string; sortOrder: number; isActive: boolean; fields: CatalogFieldView[] };
export type CatalogCategoryView = { id: string; code: string; name: string; sortOrder: number; isActive: boolean; types: CatalogTypeView[] };

/**
 * يقرأ شجرة الأصناف. الموظف يرى النشط فقط (للاختيار في البيع)، والمدير يرى
 * كل شيء بما فيه الموقوف (للإدارة). لا تُحذف الأصناف أبدًا: الإيقاف فقط.
 */
export async function loadSalesCatalog(db: Db, includeInactive = false): Promise<CatalogCategoryView[]> {
  const categories = await db.salesItemCategory.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    include: {
      types: {
        where: includeInactive ? {} : { isActive: true },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        include: { fields: { where: includeInactive ? {} : { isActive: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } },
      },
    },
  });
  return categories.map((category) => ({
    id: category.id.toString(), code: category.code, name: category.nameAr,
    sortOrder: category.sortOrder, isActive: category.isActive,
    types: category.types.map((type) => ({
      id: type.id.toString(), name: type.nameAr, sortOrder: type.sortOrder, isActive: type.isActive,
      fields: type.fields.map((field) => ({
        id: field.id.toString(), key: field.fieldKey, label: field.labelAr,
        required: field.isRequired, sortOrder: field.sortOrder, isActive: field.isActive,
      })),
    })),
  }));
}

export async function createCatalogSale(db: Db, actorId: bigint, raw: unknown): Promise<WriteResult> {
  const parsed = parseCatalogSaleInput(raw);
  if (!parsed.ok) throw new InventoryProblem("راجع بيانات البيع ثم حاول مجددًا.", parsed.errors);
  const input: CatalogSaleInput = parsed.value;
  const requestHash = digest({ actorId: actorId.toString(), ...input });
  try {
    return await withSerializableRetry(db, async (tx) => {
      const branchId = BigInt(input.branchId);
      const branch = await tx.branch.findUnique({ where: { id: branchId }, select: { isActive: true } });
      if (!branch) throw new InventoryProblem("الفرع غير موجود.");
      await authorize(tx, actorId, "CREATE_SALE", branchId, branch.isActive);
      const prior = await tx.commerceSale.findUnique({ where: { requestId: input.requestId } });
      if (prior) { ensureMatchingRequest(prior, actorId, requestHash); return { id: prior.id.toString(), replayed: true }; }
      const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId }, select: { roleCode: true } });
      await tx.$queryRaw`SELECT "id" FROM "commerce_settings" WHERE "id" = 1 FOR SHARE`;
      const settings = await tx.commerceSettings.findUnique({ where: { id: 1 } });
      if (!settings || settings.staffDiscountBps < 0 || settings.staffDiscountBps > 10000
        || settings.managerDiscountBps < 0 || settings.managerDiscountBps > 10000) throw new InventoryProblem("إعداد حد الخصم غير صالح؛ راجع المدير.");

      if (new Set(input.lines.map((line) => line.typeId)).size !== input.lines.length) throw new InventoryProblem("لا تكرر الصنف في الفاتورة؛ اجمع الكمية في بند واحد.");
      const types = await tx.salesItemType.findMany({
        where: { id: { in: input.lines.map((line) => BigInt(line.typeId)) }, isActive: true, category: { isActive: true } },
        include: { category: true, fields: { where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } },
      });
      const typeMap = new Map(types.map((type) => [type.id.toString(), type]));
      const prepared = input.lines.map((line) => {
        const type = typeMap.get(line.typeId);
        if (!type) throw new InventoryProblem("أحد الأصناف غير متاح أو موقوف؛ حدّث الشاشة ثم أعد المحاولة.");
        const values = new Map(line.details.map((detail) => [detail.key, detail.value]));
        const known = new Set(type.fields.map((field) => field.fieldKey));
        // حقل غير معروف يعني نموذجًا قديمًا أو بيانات مزوّرة: يُرفض قبل أي حساب.
        if ([...values.keys()].some((key) => !known.has(key))) throw new InventoryProblem(`حقول غير معروفة في بند «${type.nameAr}». حدّث الشاشة ثم أعد المحاولة.`);
        const entries: Array<{ key: string; label: string; value: string }> = [];
        for (const field of type.fields) {
          const value = values.get(field.fieldKey)?.trim() ?? "";
          if (!value && field.isRequired) throw new InventoryProblem(`اكتب ${field.labelAr} في بند «${type.nameAr}».`);
          if (value) entries.push({ key: field.fieldKey, label: field.labelAr, value });
        }
        return {
          line, type, entries,
          quantity: scaledInteger(line.quantity, 2),
          unitPrice: scaledInteger(line.unitPrice, 2),
        };
      });

      const gross = prepared.map((item) => grossLineCents(item.quantity, item.unitPrice));
      const subtotalCents = gross.reduce((sum, value) => sum + value, 0n);
      const discountCents = scaledInteger(input.discount, 2);
      const allocations = distributeInvoiceDiscount(gross, discountCents);
      const totalCents = subtotalCents - discountCents;
      // السقف يسري على كل دور، لا على موظف الكاونتر وحده: كان المحاسب والمدير
      // قبل هذا يمنحان أي خصم بلا حدّ. والمدير وحده له سقف أعلى يُضبط من الإعدادات.
      const ceilingBps = actor.roleCode === "MANAGER" ? settings.managerDiscountBps : settings.staffDiscountBps;
      if (!staffDiscountAllowed(subtotalCents, discountCents, BigInt(ceilingBps))) {
        throw new InventoryProblem(actor.roleCode === "MANAGER"
          ? "الخصم يتجاوز سقف المدير المسموح."
          : "الخصم يتجاوز الحد المسموح لدورك.");
      }
      const firstPayment = scaledInteger(input.initialPayment, 2);
      validateCollectionAmount(totalCents, firstPayment);

      const sale = await tx.commerceSale.create({
        data: {
          requestId: input.requestId, requestHash, branchId,
          customerName: input.customerName, customerPhone: input.customerPhone,
          subtotal: fixed(subtotalCents, 2), discount: fixed(discountCents, 2),
          // الضريبة غير محددة: فراغ في الفاتورة وفي كل بند، لا صفر ولا إعفاء.
          taxableBase: null, taxTotal: null, total: fixed(totalCents, 2), createdById: actorId,
        },
        select: { id: true },
      });

      for (const [index, item] of prepared.entries()) {
        const lineTotal = gross[index] - allocations[index];
        await tx.commerceSaleLine.create({
          data: {
            saleId: sale.id,
            productId: null, catalogTypeId: item.type.id,
            categorySnapshot: item.type.category.nameAr, typeSnapshot: item.type.nameAr,
            details: { entries: item.entries },
            skuSnapshot: null, nameSnapshot: `${item.type.category.nameAr} — ${item.type.nameAr}`,
            quantity: item.line.quantity, unitPrice: item.line.unitPrice,
            taxRateId: null, taxCodeSnapshot: null, taxKindSnapshot: null, taxRateSnapshot: null,
            gross: fixed(gross[index], 2), discount: fixed(allocations[index], 2),
            taxableBase: null, taxAmount: null, total: fixed(lineTotal, 2),
            unitCost: null, isStock: false, isSerialized: false,
          },
          select: { id: true },
        });
      }
      await tx.commerceCollection.create({
        data: { requestId: input.requestId, requestHash, saleId: sale.id, amount: fixed(firstPayment, 2), method: input.method, isInitial: true, createdById: actorId },
      });
      return { id: sale.id.toString(), replayed: false };
    });
  } catch (error) {
    if (isDuplicate(error)) {
      const prior = await db.commerceSale.findUnique({ where: { requestId: input.requestId } });
      if (prior) { ensureMatchingRequest(prior, actorId, requestHash); return { id: prior.id.toString(), replayed: true }; }
      throw new InventoryProblem("تعارض البيع مع عملية أخرى. لم يُحفظ أي جزء؛ راجع الفاتورة ثم أعد المحاولة.");
    }
    return knownMath(error);
  }
}

// ---------------------------------------------------------------------------
//  إدارة الأصناف: للمدير فقط، بسبب واضح، وسجل كامل لكل تغيير.
// ---------------------------------------------------------------------------
type AuditEntity = "CATEGORY" | "TYPE" | "FIELD";
type AuditAction = "CREATE" | "UPDATE" | "ACTIVATE" | "DEACTIVATE";

async function authorizeManager(tx: Transaction, actorId: bigint): Promise<void> {
  const actor = await tx.user.findUnique({ where: { id: actorId }, select: { status: true, roleCode: true, mustChangePassword: true } });
  if (!actor || actor.status !== "ACTIVE" || actor.mustChangePassword || actor.roleCode !== "MANAGER") {
    throw new InventoryProblem("إدارة أصناف البيع متاحة للمدير فقط.");
  }
}

function problem(error: unknown, parsed: { ok: boolean; errors?: Record<string, string> }): never {
  if (error instanceof InventoryProblem) throw error;
  if (!parsed.ok) throw new InventoryProblem("راجع البيانات ثم حاول مجددًا.", parsed.errors);
  throw error;
}

async function recordAudit(
  tx: Transaction, requestId: string, entity: AuditEntity, entityId: bigint, action: AuditAction,
  before: unknown, after: unknown, reason: string, actorId: bigint,
): Promise<void> {
  await tx.salesCatalogAudit.create({
    data: {
      requestId, entity, entityId, action,
      beforeData: before === null ? undefined : (before as object),
      afterData: after === null ? undefined : (after as object),
      reason, actorId,
    },
  });
}

async function replayAudit(db: Db, requestId: string, actorId: bigint): Promise<WriteResult | null> {
  const prior = await db.salesCatalogAudit.findUnique({ where: { requestId }, select: { actorId: true, entityId: true } });
  if (!prior) return null;
  if (prior.actorId !== actorId) throw new InventoryProblem("استُخدم هذا الطلب مسبقًا. أعد فتح الشاشة.");
  return { id: prior.entityId.toString(), replayed: true };
}

/** كل كتابة إدارة: تحقق ← صلاحية مدير ← تغيير ← سجل، في معاملة واحدة. */
async function adminWrite<T>(
  db: Db, actorId: bigint, requestId: string,
  work: (tx: Transaction) => Promise<{ id: bigint; audit: { entity: AuditEntity; entityId: bigint; action: AuditAction; before: unknown; after: unknown; reason: string } }>,
): Promise<WriteResult> {
  try {
    const result = await withSerializableRetry(db, async (tx) => {
      await authorizeManager(tx, actorId);
      const existing = await tx.salesCatalogAudit.findUnique({ where: { requestId }, select: { actorId: true, entityId: true } });
      if (existing) {
        if (existing.actorId !== actorId) throw new InventoryProblem("استُخدم هذا الطلب مسبقًا. أعد فتح الشاشة.");
        return { id: existing.entityId, replayed: true as const };
      }
      const done = await work(tx);
      await recordAudit(tx, requestId, done.audit.entity, done.audit.entityId, done.audit.action, done.audit.before, done.audit.after, done.audit.reason, actorId);
      return { id: done.id, replayed: false as const };
    });
    return { id: result.id.toString(), replayed: result.replayed };
  } catch (error) {
    if (isDuplicate(error)) {
      const replayed = await replayAudit(db, requestId, actorId);
      if (replayed) return replayed;
      throw new InventoryProblem("الاسم أو الرمز مستخدم بالفعل، أو تعارض الطلب مع تغيير آخر. لم يُحفظ أي شيء.");
    }
    throw error;
  }
}

const snapshot = (row: { nameAr: string; sortOrder: number; isActive: boolean }) => ({ nameAr: row.nameAr, sortOrder: row.sortOrder, isActive: row.isActive });
const fieldSnapshot = (row: { fieldKey: string; labelAr: string; isRequired: boolean; sortOrder: number; isActive: boolean }) =>
  ({ fieldKey: row.fieldKey, labelAr: row.labelAr, isRequired: row.isRequired, sortOrder: row.sortOrder, isActive: row.isActive });

export async function createSalesCategory(db: Db, actorId: bigint, raw: unknown): Promise<WriteResult> {
  const parsed = parseCatalogName(raw, true);
  if (!parsed.ok) throw new InventoryProblem("راجع بيانات التصنيف ثم حاول مجددًا.", parsed.errors);
  const input: CatalogNameInput = parsed.value;
  try {
    return await adminWrite(db, actorId, input.requestId, async (tx) => {
      const created = await tx.salesItemCategory.create({
        data: { code: input.code!, nameAr: input.nameAr, sortOrder: input.sortOrder, createdById: actorId, updatedById: actorId },
        select: { id: true, nameAr: true, sortOrder: true, isActive: true },
      });
      return { id: created.id, audit: { entity: "CATEGORY", entityId: created.id, action: "CREATE", before: null, after: { ...snapshot(created), code: input.code }, reason: "إضافة تصنيف بيع" } };
    });
  } catch (error) { return problem(error, parsed); }
}

export async function updateSalesCategory(db: Db, actorId: bigint, raw: unknown): Promise<WriteResult> {
  const parsed = parseCatalogId(raw);
  if (!parsed.ok) throw new InventoryProblem("راجع بيانات التصنيف ثم حاول مجددًا.", parsed.errors);
  const input: CatalogIdInput = parsed.value;
  try {
    return await adminWrite(db, actorId, input.requestId, async (tx) => {
      const before = await tx.salesItemCategory.findUnique({ where: { id: BigInt(input.id) }, select: { nameAr: true, sortOrder: true, isActive: true } });
      if (!before) throw new InventoryProblem("التصنيف غير موجود.");
      const updated = await tx.salesItemCategory.update({
        where: { id: BigInt(input.id) },
        data: { nameAr: input.nameAr!, sortOrder: input.sortOrder!, updatedById: actorId },
        select: { id: true, nameAr: true, sortOrder: true, isActive: true },
      });
      return { id: updated.id, audit: { entity: "CATEGORY", entityId: updated.id, action: "UPDATE", before: snapshot(before), after: snapshot(updated), reason: "تعديل تصنيف بيع" } };
    });
  } catch (error) { return problem(error, parsed); }
}

export async function setSalesCategoryActive(db: Db, actorId: bigint, raw: unknown): Promise<WriteResult> {
  const parsed = parseCatalogActive(raw);
  if (!parsed.ok) throw new InventoryProblem("راجع بيانات التصنيف ثم حاول مجددًا.", parsed.errors);
  const input: CatalogActiveInput = parsed.value;
  try {
    return await adminWrite(db, actorId, input.requestId, async (tx) => {
      const before = await tx.salesItemCategory.findUnique({ where: { id: BigInt(input.id) }, select: { nameAr: true, sortOrder: true, isActive: true } });
      if (!before) throw new InventoryProblem("التصنيف غير موجود.");
      const updated = await tx.salesItemCategory.update({
        where: { id: BigInt(input.id) }, data: { isActive: input.active, updatedById: actorId },
        select: { id: true, nameAr: true, sortOrder: true, isActive: true },
      });
      return { id: updated.id, audit: { entity: "CATEGORY", entityId: updated.id, action: input.active ? "ACTIVATE" : "DEACTIVATE", before: snapshot(before), after: snapshot(updated), reason: input.reason } };
    });
  } catch (error) { return problem(error, parsed); }
}

export async function createSalesType(db: Db, actorId: bigint, raw: unknown): Promise<WriteResult> {
  const parsed = parseCatalogTypeCreate(raw);
  if (!parsed.ok) throw new InventoryProblem("راجع بيانات الصنف ثم حاول مجددًا.", parsed.errors);
  const input: CatalogTypeCreateInput = parsed.value;
  try {
    return await adminWrite(db, actorId, input.requestId, async (tx) => {
      const category = await tx.salesItemCategory.findUnique({ where: { id: BigInt(input.categoryId) }, select: { id: true } });
      if (!category) throw new InventoryProblem("التصنيف غير موجود.");
      const created = await tx.salesItemType.create({
        data: { categoryId: BigInt(input.categoryId), nameAr: input.nameAr, sortOrder: input.sortOrder, createdById: actorId, updatedById: actorId },
        select: { id: true, nameAr: true, sortOrder: true, isActive: true },
      });
      return { id: created.id, audit: { entity: "TYPE", entityId: created.id, action: "CREATE", before: null, after: { ...snapshot(created), categoryId: input.categoryId }, reason: "إضافة صنف بيع" } };
    });
  } catch (error) { return problem(error, parsed); }
}

export async function updateSalesType(db: Db, actorId: bigint, raw: unknown): Promise<WriteResult> {
  const parsed = parseCatalogId(raw);
  if (!parsed.ok) throw new InventoryProblem("راجع بيانات الصنف ثم حاول مجددًا.", parsed.errors);
  const input: CatalogIdInput = parsed.value;
  try {
    return await adminWrite(db, actorId, input.requestId, async (tx) => {
      const before = await tx.salesItemType.findUnique({ where: { id: BigInt(input.id) }, select: { nameAr: true, sortOrder: true, isActive: true } });
      if (!before) throw new InventoryProblem("الصنف غير موجود.");
      const updated = await tx.salesItemType.update({
        where: { id: BigInt(input.id) }, data: { nameAr: input.nameAr!, sortOrder: input.sortOrder!, updatedById: actorId },
        select: { id: true, nameAr: true, sortOrder: true, isActive: true },
      });
      return { id: updated.id, audit: { entity: "TYPE", entityId: updated.id, action: "UPDATE", before: snapshot(before), after: snapshot(updated), reason: "تعديل صنف بيع" } };
    });
  } catch (error) { return problem(error, parsed); }
}

export async function setSalesTypeActive(db: Db, actorId: bigint, raw: unknown): Promise<WriteResult> {
  const parsed = parseCatalogActive(raw);
  if (!parsed.ok) throw new InventoryProblem("راجع بيانات الصنف ثم حاول مجددًا.", parsed.errors);
  const input: CatalogActiveInput = parsed.value;
  try {
    return await adminWrite(db, actorId, input.requestId, async (tx) => {
      const before = await tx.salesItemType.findUnique({ where: { id: BigInt(input.id) }, select: { nameAr: true, sortOrder: true, isActive: true } });
      if (!before) throw new InventoryProblem("الصنف غير موجود.");
      const updated = await tx.salesItemType.update({
        where: { id: BigInt(input.id) }, data: { isActive: input.active, updatedById: actorId },
        select: { id: true, nameAr: true, sortOrder: true, isActive: true },
      });
      return { id: updated.id, audit: { entity: "TYPE", entityId: updated.id, action: input.active ? "ACTIVATE" : "DEACTIVATE", before: snapshot(before), after: snapshot(updated), reason: input.reason } };
    });
  } catch (error) { return problem(error, parsed); }
}

export async function createSalesField(db: Db, actorId: bigint, raw: unknown): Promise<WriteResult> {
  const parsed = parseCatalogField(raw);
  if (!parsed.ok) throw new InventoryProblem("راجع بيانات الحقل ثم حاول مجددًا.", parsed.errors);
  const input: CatalogFieldInput = parsed.value;
  try {
    return await adminWrite(db, actorId, input.requestId, async (tx) => {
      const type = await tx.salesItemType.findUnique({ where: { id: BigInt(input.typeId) }, select: { id: true } });
      if (!type) throw new InventoryProblem("الصنف غير موجود.");
      const created = await tx.salesItemField.create({
        data: {
          typeId: BigInt(input.typeId), fieldKey: input.fieldKey, labelAr: input.labelAr,
          isRequired: input.isRequired, sortOrder: input.sortOrder, createdById: actorId, updatedById: actorId,
        },
        select: { id: true, fieldKey: true, labelAr: true, isRequired: true, sortOrder: true, isActive: true },
      });
      return { id: created.id, audit: { entity: "FIELD", entityId: created.id, action: "CREATE", before: null, after: { ...fieldSnapshot(created), typeId: input.typeId }, reason: "إضافة حقل للصنف" } };
    });
  } catch (error) { return problem(error, parsed); }
}

export async function updateSalesField(db: Db, actorId: bigint, raw: unknown): Promise<WriteResult> {
  const parsed = parseCatalogFieldUpdate(raw);
  if (!parsed.ok) throw new InventoryProblem("راجع بيانات الحقل ثم حاول مجددًا.", parsed.errors);
  const input: CatalogFieldUpdateInput = parsed.value;
  try {
    return await adminWrite(db, actorId, input.requestId, async (tx) => {
      const before = await tx.salesItemField.findUnique({ where: { id: BigInt(input.id) }, select: { fieldKey: true, labelAr: true, isRequired: true, sortOrder: true, isActive: true } });
      if (!before) throw new InventoryProblem("الحقل غير موجود.");
      const updated = await tx.salesItemField.update({
        where: { id: BigInt(input.id) },
        data: { labelAr: input.labelAr, isRequired: input.isRequired, sortOrder: input.sortOrder, updatedById: actorId },
        select: { id: true, fieldKey: true, labelAr: true, isRequired: true, sortOrder: true, isActive: true },
      });
      return { id: updated.id, audit: { entity: "FIELD", entityId: updated.id, action: "UPDATE", before: fieldSnapshot(before), after: fieldSnapshot(updated), reason: "تعديل حقل الصنف" } };
    });
  } catch (error) { return problem(error, parsed); }
}

export async function setSalesFieldActive(db: Db, actorId: bigint, raw: unknown): Promise<WriteResult> {
  const parsed = parseCatalogActive(raw);
  if (!parsed.ok) throw new InventoryProblem("راجع بيانات الحقل ثم حاول مجددًا.", parsed.errors);
  const input: CatalogActiveInput = parsed.value;
  try {
    return await adminWrite(db, actorId, input.requestId, async (tx) => {
      const before = await tx.salesItemField.findUnique({ where: { id: BigInt(input.id) }, select: { fieldKey: true, labelAr: true, isRequired: true, sortOrder: true, isActive: true } });
      if (!before) throw new InventoryProblem("الحقل غير موجود.");
      const updated = await tx.salesItemField.update({
        where: { id: BigInt(input.id) }, data: { isActive: input.active, updatedById: actorId },
        select: { id: true, fieldKey: true, labelAr: true, isRequired: true, sortOrder: true, isActive: true },
      });
      return { id: updated.id, audit: { entity: "FIELD", entityId: updated.id, action: input.active ? "ACTIVATE" : "DEACTIVATE", before: fieldSnapshot(before), after: fieldSnapshot(updated), reason: input.reason } };
    });
  } catch (error) { return problem(error, parsed); }
}

export type CatalogAuditRow = {
  id: string; entity: string; entityId: string; action: string;
  reason: string; actor: string; createdAt: Date;
  before: unknown; after: unknown;
};

/** سجل التغييرات: للمدير فقط. الأصل محفوظ قبل التعديل وبعده. */
export async function listCatalogAudit(db: Db, actorId: bigint, take = 50): Promise<CatalogAuditRow[]> {
  const rows = await db.$transaction(async (tx) => {
    await authorizeManager(tx, actorId);
    return tx.salesCatalogAudit.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: Math.min(Math.max(take, 1), 200),
      include: { actor: { select: { fullName: true } } },
    });
  }, { isolationLevel: "ReadCommitted" });
  return rows.map((row) => ({
    id: row.id.toString(), entity: row.entity, entityId: row.entityId.toString(), action: row.action,
    reason: row.reason, actor: row.actor.fullName, createdAt: row.createdAt,
    before: row.beforeData, after: row.afterData,
  }));
}

export { MAX_CATALOG_NAME };
