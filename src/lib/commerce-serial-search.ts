import type { PrismaClient } from "@prisma/client";
import { InventoryProblem } from "./inventory-operations";
import { canPerformCommerce } from "./commerce-policy";
import { escapeLikeLiteral, latinDigits, positiveDatabaseId } from "./inventory-validation";

/** Authorized, literal, bounded search over currently available serials in one warehouse. */
export async function searchAvailableSaleSerials(db: PrismaClient, actorId: bigint, raw: { warehouseId: string; productId: string; query: string }) {
  const warehouseId = positiveDatabaseId(raw.warehouseId);
  const productId = positiveDatabaseId(raw.productId);
  const normalized = latinDigits(raw.query.normalize("NFKC").trim()).toUpperCase();
  if (!warehouseId || !productId || normalized.length > 80 || /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/u.test(normalized)) throw new InventoryProblem("راجع بحث السيريال والصنف والمستودع.");
  const [actor, warehouse, product] = await Promise.all([
    db.user.findUnique({ where: { id: actorId }, select: { status: true, roleCode: true, branchId: true, mustChangePassword: true, canCancelSales: true } }),
    db.warehouse.findUnique({ where: { id: BigInt(warehouseId) }, include: { branch: { select: { isActive: true } } } }),
    db.product.findUnique({ where: { id: BigInt(productId) }, select: { isActive: true, category: true, isSerialized: true } }),
  ]);
  if (!actor || !warehouse || !warehouse.isActive || !warehouse.holdsStock || !canPerformCommerce({ role: actor.roleCode, status: actor.status, mustChangePassword: actor.mustChangePassword, branchId: actor.branchId, canCancelSales: actor.canCancelSales }, "CREATE_SALE", warehouse.branchId, warehouse.branch.isActive)) {
    throw new InventoryProblem("ليس لديك صلاحية للبحث في سيريالات هذا المستودع.");
  }
  if (!product || !product.isActive || product.category === "SERVICE" || !(product.isSerialized || product.category === "HEARING_AID")) throw new InventoryProblem("الصنف غير متاح أو لا يتطلب سيريالًا.");
  const serials = await db.inventorySerial.findMany({
    where: {
      currentSaleLineId: null,
      ...(normalized ? { serialKey: { contains: escapeLikeLiteral(normalized) } } : {}),
      OR: [{ opening: { warehouseId: BigInt(warehouseId), productId: BigInt(productId) } }, { receipt: { warehouseId: BigInt(warehouseId), productId: BigInt(productId) } }],
    },
    orderBy: { id: "desc" }, take: 51, select: { id: true, serialNumber: true },
  });
  return { serials: serials.slice(0, 50).map((serial) => ({ id: serial.id.toString(), number: serial.serialNumber })), more: serials.length > 50 };
}
