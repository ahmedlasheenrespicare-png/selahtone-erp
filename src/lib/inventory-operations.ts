import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { parseOpeningInput, positiveDatabaseId, productSku, type FieldErrors, type OpeningInputRaw, type ProductInput } from "./inventory-validation";

export class InventoryProblem extends Error {
  constructor(message: string, readonly fieldErrors?: FieldErrors) {
    super(message);
    this.name = "InventoryProblem";
  }
}

type Db = PrismaClient;
type Transaction = Parameters<Parameters<Db["$transaction"]>[0]>[0];
type WriteResult = { id: string; replayed: boolean };

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function isUniqueError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

function isSerializationError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2034";
}

function ensureMatchingRequest(record: { requestHash: string; createdById: bigint }, actorId: bigint, expectedHash: string): void {
  if (record.createdById !== actorId || record.requestHash.trim() !== expectedHash) {
    throw new InventoryProblem("استُخدم هذا الطلب مسبقًا ببيانات مختلفة. افتح نموذجًا جديدًا.");
  }
}

async function ensureEditor(tx: Transaction, actorId: bigint): Promise<void> {
  // تُراجع الحالة والدور من قاعدة البيانات مرة أخرى داخل المعاملة، وليس من النموذج.
  const actor = await tx.user.findUnique({ where: { id: actorId }, select: { status: true, roleCode: true, mustChangePassword: true } });
  if (!actor || actor.status !== "ACTIVE" || actor.mustChangePassword || !["MANAGER", "ACCOUNTANT"].includes(actor.roleCode)) {
    throw new InventoryProblem("إضافة الأصناف والأرصدة متاحة للمدير والمحاسب فقط.");
  }
}

async function withSerializableRetry<T>(db: Db, work: (tx: Transaction) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(work, { isolationLevel: "Serializable", maxWait: 5000, timeout: 20000 });
    } catch (error) {
      // إعادة المحاولة بعد تعارض تسلسلي آمنة؛ المعاملة السابقة رُفضت ولم تُعتمد.
      if (isSerializationError(error) && attempt < 2) continue;
      throw error;
    }
  }
}

/** إنشاء صنف وسجل من أنشأه في المعاملة نفسها. لا يغيّر أي صنف موجود. */
export async function createInventoryProduct(db: Db, actorId: bigint, input: ProductInput): Promise<WriteResult> {
  const requestHash = digest({ actorId: actorId.toString(), ...input });
  // الرمز المولَّد ثابت لنفس الطلب حتى لا ينشئ تكراره صنفًا آخر.
  const sku = productSku(input);

  try {
    return await withSerializableRetry(db, async (tx) => {
      await ensureEditor(tx, actorId);
      const prior = await tx.inventoryProductCreation.findUnique({ where: { requestId: input.requestId } });
      if (prior) {
        ensureMatchingRequest(prior, actorId, requestHash);
        return { id: prior.productId.toString(), replayed: true };
      }
      // Prisma's case-insensitive equals uses ILIKE on PostgreSQL, where `_` is a wildcard.
      // Compare normalized codes literally so an SKU such as A_B does not match A1B.
      const existing = await tx.$queryRaw<Array<{ id: bigint }>>`SELECT "id" FROM "products" WHERE upper("sku") = upper(${sku}) LIMIT 1`;
      if (existing.length) throw new InventoryProblem("رمز الصنف مستخدم بالفعل. اختر رمزًا آخر.", { sku: "رمز الصنف مستخدم بالفعل." });
      if (input.taxRateId !== null) {
        const tax = await tx.taxRate.findUnique({ where: { id: input.taxRateId }, select: { isActive: true } });
        if (!tax?.isActive) throw new InventoryProblem("معدل الضريبة المختار لم يعد متاحًا.", { taxRateId: "اختر معدلًا نشطًا أو اتركه غير محدد." });
      }
      const product = await tx.product.create({
        data: {
          sku,
          nameAr: input.nameAr,
          category: input.category,
          brand: input.brand,
          model: input.model,
          purchaseCost: input.purchaseCost,
          salePrice: input.salePrice,
          taxRateId: input.taxRateId,
          isSerialized: input.isSerialized,
        },
        select: { id: true },
      });
      await tx.inventoryProductCreation.create({ data: { requestId: input.requestId, requestHash, productId: product.id, createdById: actorId } });
      return { id: product.id.toString(), replayed: false };
    });
  } catch (error) {
    if (!isUniqueError(error)) throw error;
    // عند وصول نسختين متزامنتين من الطلب نفسه قد تفوز إحداهما بقيد uniqueness.
    const prior = await db.inventoryProductCreation.findUnique({ where: { requestId: input.requestId } });
    if (prior) {
      ensureMatchingRequest(prior, actorId, requestHash);
      return { id: prior.productId.toString(), replayed: true };
    }
    throw new InventoryProblem("تعذر إنشاء الصنف لأن رمزه مسجّل بالفعل. لم يُضف صنف جديد.", { sku: "استخدم رمزًا مختلفًا." });
  }
}

/** يسجل رصيدًا افتتاحيًا لمرة واحدة فقط؛ الرصيد والسجل والسيريالات عملية ذرية. */
export async function createInventoryOpening(db: Db, actorId: bigint, raw: OpeningInputRaw): Promise<WriteResult> {
  const productId = positiveDatabaseId(raw.productId);
  const warehouseId = positiveDatabaseId(raw.warehouseId);
  if (!productId || !warehouseId) {
    throw new InventoryProblem("راجع الصنف والمستودع المختارين.", {
      ...(!productId ? { productId: "اختر صنفًا متاحًا." } : {}),
      ...(!warehouseId ? { warehouseId: "اختر مستودعًا متاحًا." } : {}),
    });
  }

  let requestHash: string | null = null;
  let requestId: string | null = null;
  try {
    return await withSerializableRetry(db, async (tx) => {
      await ensureEditor(tx, actorId);
      const product = await tx.product.findUnique({ where: { id: BigInt(productId) }, select: { id: true, category: true, isSerialized: true, isActive: true } });
      if (!product) throw new InventoryProblem("الصنف المختار غير موجود أو لم يعد متاحًا.");
      const needsSerials = product.isSerialized || product.category === "HEARING_AID";
      const parsed = parseOpeningInput(raw, needsSerials);
      if (!parsed.ok) throw new InventoryProblem("راجع البيانات المحددة ثم حاول مجددًا.", parsed.errors);
      requestId = parsed.value.requestId;
      requestHash = digest({ actorId: actorId.toString(), ...parsed.value });

      const prior = await tx.inventoryOpening.findUnique({ where: { requestId } });
      if (prior) {
        ensureMatchingRequest(prior, actorId, requestHash);
        return { id: prior.id.toString(), replayed: true };
      }
      if (!product.isActive || product.category === "SERVICE") throw new InventoryProblem("لا يمكن تسجيل رصيد لصنف غير نشط أو لخدمة.");
      const warehouse = await tx.warehouse.findUnique({ where: { id: BigInt(warehouseId) }, include: { branch: { select: { isActive: true } } } });
      if (!warehouse || !warehouse.isActive || !warehouse.holdsStock || !warehouse.branch.isActive) {
        throw new InventoryProblem("المستودع أو الفرع غير نشط، أو لا يحتفظ بمخزون.");
      }
      const existing = await tx.stockLevel.findUnique({ where: { warehouseId_productId: { warehouseId: BigInt(warehouseId), productId: BigInt(productId) } }, select: { id: true } });
      if (existing) throw new InventoryProblem("يوجد رصيد مسجّل لهذا الصنف في المستودع، حتى لو كان صفرًا. لم يُستبدل أو يُعدّل.");
      if (parsed.value.serials.length) {
        const duplicate = await tx.inventorySerial.findFirst({ where: { serialKey: { in: parsed.value.serials.map((serial) => serial.key) } }, select: { id: true } });
        if (duplicate) throw new InventoryProblem("أحد الأرقام التسلسلية مسجّل بالفعل. لم يُحفظ الرصيد.", { serialNumbers: "راجع الأرقام في سجل السيريالات." });
      }
      await tx.stockLevel.create({ data: { warehouseId: BigInt(warehouseId), productId: BigInt(productId), qtyOnHand: parsed.value.quantity, avgCost: parsed.value.unitCost } });
      const opening = await tx.inventoryOpening.create({
        data: {
          requestId,
          requestHash,
          warehouseId: BigInt(warehouseId),
          productId: BigInt(productId),
          quantity: parsed.value.quantity,
          unitCost: parsed.value.unitCost,
          createdById: actorId,
        },
        select: { id: true },
      });
      if (parsed.value.serials.length) {
        await tx.inventorySerial.createMany({ data: parsed.value.serials.map((serial) => ({ openingId: opening.id, serialNumber: serial.number, serialKey: serial.key })) });
      }
      return { id: opening.id.toString(), replayed: false };
    });
  } catch (error) {
    if (!isUniqueError(error)) throw error;
    if (requestId && requestHash) {
      const prior = await db.inventoryOpening.findUnique({ where: { requestId } });
      if (prior) {
        ensureMatchingRequest(prior, actorId, requestHash);
        return { id: prior.id.toString(), replayed: true };
      }
    }
    throw new InventoryProblem("سُجّل الرصيد أو أحد الأرقام بالتزامن مع طلبك. لم يُحفظ أي جزء من هذا الطلب؛ راجع المخزون والسيريالات.");
  }
}
