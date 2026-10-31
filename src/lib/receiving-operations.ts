import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { canPerformCommerce } from "./commerce-policy";
import { InventoryProblem } from "./inventory-operations";
import { positiveDatabaseId } from "./inventory-validation";
import { parseReceiptInput, type ReceiptInputRaw } from "./receiving-validation";

type Db = PrismaClient;
type Transaction = Parameters<Parameters<Db["$transaction"]>[0]>[0];
type WriteResult = { id: string; replayed: boolean };

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function isCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
function ensureMatchingRequest(record: { requestHash: string; createdById: bigint }, actorId: bigint, expectedHash: string): void {
  if (record.createdById !== actorId || record.requestHash.trim() !== expectedHash) {
    throw new InventoryProblem("استُخدم هذا الطلب مسبقًا ببيانات مختلفة. افتح نموذجًا جديدًا.");
  }
}
async function withSerializableRetry<T>(db: Db, work: (tx: Transaction) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(work, { isolationLevel: "Serializable", maxWait: 5000, timeout: 20000 });
    } catch (error) {
      if (isCode(error, "P2034") && attempt < 2) continue;
      throw error;
    }
  }
}

/**
 * Record a new stock receipt without a supplier invoice or financial payment.
 * Stock, weighted average, receipt and unique serials are one transaction.
 * This function has NOT been run against production.
 */
export async function receiveInventoryStock(db: Db, actorId: bigint, raw: ReceiptInputRaw): Promise<WriteResult> {
  const productId = positiveDatabaseId(raw.productId);
  const warehouseId = positiveDatabaseId(raw.warehouseId);
  if (!productId || !warehouseId) {
    throw new InventoryProblem("راجع الصنف والمستودع المختارين.", {
      ...(!productId ? { productId: "اختر صنفًا متاحًا." } : {}),
      ...(!warehouseId ? { warehouseId: "اختر مستودعًا متاحًا." } : {}),
    });
  }

  let requestId: string | null = null;
  let requestHash: string | null = null;
  try {
    return await withSerializableRetry(db, async (tx) => {
      // Re-read permissions inside the write transaction, not just from the UI.
      const actor = await tx.user.findUnique({ where: { id: actorId }, select: { status: true, roleCode: true, branchId: true, mustChangePassword: true, canCancelSales: true } });
      if (!actor || actor.status !== "ACTIVE" || actor.mustChangePassword || !["MANAGER", "CS_AGENT"].includes(actor.roleCode)) {
        throw new InventoryProblem("تسجيل التوريد متاح للمدير وموظف الفرع فقط.");
      }
      const warehouse = await tx.warehouse.findUnique({ where: { id: BigInt(warehouseId) }, include: { branch: { select: { isActive: true } } } });
      if (!warehouse || !warehouse.isActive || !warehouse.holdsStock || !warehouse.branch.isActive) {
        throw new InventoryProblem("المستودع أو الفرع غير نشط، أو لا يحتفظ بمخزون.");
      }
      if (!canPerformCommerce({ role: actor.roleCode, status: actor.status, mustChangePassword: actor.mustChangePassword, branchId: actor.branchId, canCancelSales: actor.canCancelSales }, "RECEIVE_STOCK", warehouse.branchId, warehouse.branch.isActive)) {
        throw new InventoryProblem("موظف الفرع يسجّل التوريد لمستودعات فرعه فقط.");
      }
      const product = await tx.product.findUnique({ where: { id: BigInt(productId) }, select: { id: true, category: true, isSerialized: true, isActive: true } });
      if (!product || !product.isActive || product.category === "SERVICE") throw new InventoryProblem("الصنف غير متاح أو لا يحتفظ بمخزون.");
      const parsed = parseReceiptInput(raw, product.isSerialized || product.category === "HEARING_AID");
      if (!parsed.ok) throw new InventoryProblem("راجع البيانات المحددة ثم حاول مجددًا.", parsed.errors);
      const input = parsed.value;
      requestId = input.requestId;
      requestHash = digest({ actorId: actorId.toString(), ...input });
      const prior = await tx.inventoryReceipt.findUnique({ where: { requestId: input.requestId } });
      if (prior) {
        ensureMatchingRequest(prior, actorId, requestHash);
        return { id: prior.id.toString(), replayed: true };
      }
      if (input.serials.length) {
        const duplicate = await tx.inventorySerial.findFirst({ where: { serialKey: { in: input.serials.map((serial) => serial.key) } }, select: { id: true } });
        if (duplicate) throw new InventoryProblem("أحد الأرقام التسلسلية مسجّل بالفعل. لم يُحفظ التوريد.", { serialNumbers: "راجع الأرقام في سجل السيريالات." });
      }

      const receipt = await tx.inventoryReceipt.create({
        data: {
          requestId: input.requestId, requestHash, warehouseId: BigInt(warehouseId), productId: BigInt(productId),
          quantity: input.quantity, unitCost: input.unitCost, sourceReference: input.sourceReference, createdById: actorId,
        },
        select: { id: true },
      });

      // A single upsert locks the warehouse/product row. PostgreSQL NUMERIC and
      // ROUND keep four-decimal weighted costs exact, including concurrent receipts.
      // Existing negative/corrupt values and overflows fail instead of being hidden.
      const changed = await tx.$queryRaw<Array<{ id: bigint }>>`
        INSERT INTO "stock_levels" ("warehouse_id", "product_id", "qty_on_hand", "avg_cost", "updated_at")
        VALUES (${BigInt(warehouseId)}, ${BigInt(productId)}, CAST(${input.quantity} AS numeric(12,2)), CAST(${input.unitCost} AS numeric(14,4)), CURRENT_TIMESTAMP)
        ON CONFLICT ("warehouse_id", "product_id") DO UPDATE SET
          "avg_cost" = ROUND(
            ("stock_levels"."qty_on_hand" * "stock_levels"."avg_cost" + EXCLUDED."qty_on_hand" * EXCLUDED."avg_cost") /
            NULLIF("stock_levels"."qty_on_hand" + EXCLUDED."qty_on_hand", 0), 4),
          "qty_on_hand" = "stock_levels"."qty_on_hand" + EXCLUDED."qty_on_hand",
          "updated_at" = CURRENT_TIMESTAMP
        WHERE "stock_levels"."qty_on_hand" >= 0 AND "stock_levels"."avg_cost" >= 0
          AND "stock_levels"."qty_on_hand" + EXCLUDED."qty_on_hand" <= 9999999999.99
        RETURNING "id"
      `;
      if (changed.length !== 1) throw new InventoryProblem("الرصيد الحالي غير صالح أو الكمية تتجاوز الحد. لم يُحفظ التوريد.");
      if (input.serials.length) {
        await tx.inventorySerial.createMany({ data: input.serials.map((serial) => ({ receiptId: receipt.id, serialNumber: serial.number, serialKey: serial.key })) });
      }
      return { id: receipt.id.toString(), replayed: false };
    });
  } catch (error) {
    if (!isCode(error, "P2002")) throw error;
    // A concurrently completed identical request is safe to replay; a new request
    // that collides with an existing serial must not partially change stock.
    if (requestId && requestHash) {
      const prior = await db.inventoryReceipt.findUnique({ where: { requestId } });
      if (prior) {
        ensureMatchingRequest(prior, actorId, requestHash);
        return { id: prior.id.toString(), replayed: true };
      }
    }
    throw new InventoryProblem("أحد الأرقام التسلسلية سُجّل بالتزامن. لم يُحفظ التوريد.", { serialNumbers: "راجع الأرقام في سجل السيريالات." });
  }
}
