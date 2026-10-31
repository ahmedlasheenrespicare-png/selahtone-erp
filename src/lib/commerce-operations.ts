import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { InventoryProblem } from "./inventory-operations";
import { scaledInteger } from "./inventory-math";
import { canPerformCommerce, type CommerceAction } from "./commerce-policy";
import { CommerceMathError, allocatePartialReturn, calculateInclusiveSale, customerPosition, staffDiscountAllowed, validateCollectionAmount, validateRefundAmount, type ReviewedTax } from "./commerce-math";
import { postCashRefundInTransaction } from "./finance/engine";
import { financePort } from "./finance/port";
import { FinanceProblem } from "./finance/types";
import { parseDiscountSetting, parseMoneyMovement, parseReturnInput, parseSaleInput, type ReturnLineInput, type SaleInput } from "./commerce-validation";

type Db = PrismaClient;
type Transaction = Parameters<Parameters<Db["$transaction"]>[0]>[0];
type WriteResult = { id: string; replayed: boolean };
type DecimalLike = { toFixed: (places: number) => string };

function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function isCode(error: unknown, code: string): boolean { return typeof error === "object" && error !== null && "code" in error && error.code === code; }
function scaled(value: DecimalLike | null | undefined, places: number): bigint { return value ? scaledInteger(value.toFixed(places), places) : 0n; }
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
function businessDate(): Date {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = (key: string) => parts.find((part) => part.type === key)?.value;
  return new Date(`${value("year")}-${value("month")}-${value("day")}T00:00:00.000Z`);
}
function knownMath(error: unknown): never {
  if (error instanceof CommerceMathError) throw new InventoryProblem(error.message);
  throw error;
}

/** Record a sale, its first collection, serial assignments and stock decrement atomically. */
export async function createCommerceSale(db: Db, actorId: bigint, raw: unknown): Promise<WriteResult> {
  const parsed = parseSaleInput(raw);
  if (!parsed.ok) throw new InventoryProblem("راجع بيانات البيع ثم حاول مجددًا.", parsed.errors);
  const input: SaleInput = parsed.value;
  const requestHash = digest({ actorId: actorId.toString(), ...input });
  try {
    return await withSerializableRetry(db, async (tx) => {
      const warehouse = await tx.warehouse.findUnique({ where: { id: BigInt(input.warehouseId) }, include: { branch: { select: { isActive: true } } } });
      if (!warehouse || !warehouse.isActive || !warehouse.holdsStock || !warehouse.branch.isActive) throw new InventoryProblem("المستودع أو الفرع غير نشط، أو لا يحتفظ بمخزون.");
      await authorize(tx, actorId, "CREATE_SALE", warehouse.branchId, warehouse.branch.isActive);
      const prior = await tx.commerceSale.findUnique({ where: { requestId: input.requestId } });
      if (prior) { ensureMatchingRequest(prior, actorId, requestHash); return { id: prior.id.toString(), replayed: true }; }
      const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId }, select: { roleCode: true } });
      // Serialize a staff sale's limit with manager changes to the global setting.
      await tx.$queryRaw`SELECT "id" FROM "commerce_settings" WHERE "id" = 1 FOR SHARE`;
      const settings = await tx.commerceSettings.findUnique({ where: { id: 1 } });
      if (!settings || settings.staffDiscountBps < 0 || settings.staffDiscountBps > 10000) throw new InventoryProblem("إعداد حد الخصم غير صالح؛ راجع المدير.");

      const products = await tx.product.findMany({ where: { id: { in: input.lines.map((line) => BigInt(line.productId)) } }, include: { taxRate: true } });
      const productMap = new Map(products.map((product) => [product.id.toString(), product]));
      const today = businessDate();
      const prepared = input.lines.map((line) => {
        const product = productMap.get(line.productId);
        if (!product || !product.isActive) throw new InventoryProblem("أحد الأصناف غير متاح أو لم يعد نشطًا.");
        const tax = product.taxRate;
        if (!tax || !tax.isActive || tax.effectiveFrom > today || (tax.effectiveTo && tax.effectiveTo < today)) throw new InventoryProblem(`ضريبة الصنف ${product.nameAr} غير محددة أو غير سارية؛ راجع المحاسب.`);
        if (tax.kind !== "VAT" && tax.kind !== "SCHEDULE" && tax.kind !== "EXEMPT") throw new InventoryProblem(`نوع ضريبة الصنف ${product.nameAr} يحتاج معالجة ومراجعة منفصلتين.`);
        if (scaled(product.salePrice, 2) !== scaledInteger(line.expectedUnitPrice, 2) || tax.id !== line.expectedTaxRateId || tax.kind !== line.expectedTaxKind || scaled(tax.rate, 3) !== scaledInteger(line.expectedTaxRate, 3)) {
          throw new InventoryProblem("تغيّر السعر أو الضريبة بعد فتح النموذج. افتح نموذجًا جديدًا وراجع الفاتورة.");
        }
        const quantity = scaledInteger(line.quantity, 2);
        const isStock = product.category !== "SERVICE";
        const isSerialized = isStock && (product.isSerialized || product.category === "HEARING_AID");
        if (isSerialized && (quantity % 100n !== 0n || BigInt(line.serialIds.length) * 100n !== quantity)) throw new InventoryProblem(`اختر رقمًا تسلسليًا واحدًا لكل جهاز من ${product.nameAr}.`);
        if (!isSerialized && line.serialIds.length) throw new InventoryProblem(`الصنف ${product.nameAr} لا يتطلب أرقامًا تسلسلية.`);
        const reviewedTax: ReviewedTax = tax.kind === "EXEMPT" ? { kind: "EXEMPT", rateThousandthPercent: scaled(tax.rate, 3) as 0n } : { kind: tax.kind, rateThousandthPercent: scaled(tax.rate, 3) };
        return { line, product, tax, quantity, isStock, isSerialized, reviewedTax };
      });
      const discount = scaledInteger(input.discount, 2);
      const calculation = calculateInclusiveSale(prepared.map((item) => ({ quantityHundredths: item.quantity, unitPriceCents: scaled(item.product.salePrice, 2), tax: item.reviewedTax })), discount);
      if (actor.roleCode === "CS_AGENT" && !staffDiscountAllowed(calculation.subtotalCents, discount, BigInt(settings.staffDiscountBps))) throw new InventoryProblem("الخصم يتجاوز الحد المسموح لموظف الفرع.");
      const firstPayment = scaledInteger(input.initialPayment, 2);
      validateCollectionAmount(calculation.finalCents, firstPayment);

      const sale = await tx.commerceSale.create({ data: {
        requestId: input.requestId, requestHash, branchId: warehouse.branchId, warehouseId: warehouse.id,
        customerName: input.customerName, customerPhone: input.customerPhone, subtotal: fixed(calculation.subtotalCents, 2), discount: fixed(discount, 2),
        taxableBase: fixed(calculation.baseCents, 2), taxTotal: fixed(calculation.taxCents, 2), total: fixed(calculation.finalCents, 2), createdById: actorId,
      }, select: { id: true } });

      for (const [index, item] of prepared.entries()) {
        const computed = calculation.lines[index];
        let unitCost: string | null = null;
        if (item.isStock) {
          // Conditional decrement protects against overselling; the returned cost is
          // the actual warehouse average at the instant this row is locked.
          const updated = await tx.$queryRaw<Array<{ avg_cost: DecimalLike }>>`
            UPDATE "stock_levels" SET "qty_on_hand" = "qty_on_hand" - CAST(${item.line.quantity} AS numeric(12,2)), "updated_at" = CURRENT_TIMESTAMP
            WHERE "warehouse_id" = ${warehouse.id} AND "product_id" = ${item.product.id}
              AND "qty_on_hand" >= CAST(${item.line.quantity} AS numeric(12,2)) AND "avg_cost" >= 0
            RETURNING "avg_cost"
          `;
          if (updated.length !== 1) throw new InventoryProblem(`الكمية المتاحة من ${item.product.nameAr} لا تكفي أو الرصيد غير صالح.`);
          unitCost = updated[0].avg_cost.toFixed(4);
        }
        const line = await tx.commerceSaleLine.create({ data: {
          saleId: sale.id, productId: item.product.id, skuSnapshot: item.product.sku, nameSnapshot: item.product.nameAr,
          quantity: item.line.quantity, unitPrice: item.product.salePrice, taxRateId: item.tax.id, taxCodeSnapshot: item.tax.code,
          taxKindSnapshot: item.tax.kind, taxRateSnapshot: item.tax.rate, gross: fixed(computed.grossCents, 2), discount: fixed(computed.discountCents, 2),
          taxableBase: fixed(computed.baseCents, 2), taxAmount: fixed(computed.taxCents, 2), total: fixed(computed.finalCents, 2),
          unitCost, isStock: item.isStock, isSerialized: item.isSerialized,
        }, select: { id: true } });
        if (item.isSerialized) {
          const serialIds = item.line.serialIds.map(BigInt);
          const changed = await tx.inventorySerial.updateMany({
            where: { id: { in: serialIds }, currentSaleLineId: null, OR: [
              { opening: { warehouseId: warehouse.id, productId: item.product.id } },
              { receipt: { warehouseId: warehouse.id, productId: item.product.id } },
            ] }, data: { currentSaleLineId: line.id },
          });
          if (changed.count !== serialIds.length) throw new InventoryProblem(`أحد سيريالات ${item.product.nameAr} غير متاح أو لا ينتمي للمستودع.`);
          await tx.commerceSaleLineSerial.createMany({ data: serialIds.map((serialId) => ({ saleLineId: line.id, serialId })) });
        }
      }
      await tx.commerceCollection.create({ data: {
        requestId: input.requestId, requestHash, saleId: sale.id, amount: fixed(firstPayment, 2), method: input.method, isInitial: true, createdById: actorId,
      } });
      return { id: sale.id.toString(), replayed: false };
    });
  } catch (error) {
    if (isCode(error, "P2002")) {
      const prior = await db.commerceSale.findUnique({ where: { requestId: input.requestId } });
      if (prior) { ensureMatchingRequest(prior, actorId, requestHash); return { id: prior.id.toString(), replayed: true }; }
      throw new InventoryProblem("تعارض البيع مع عملية أخرى. لم يُحفظ أي جزء؛ راجع المخزون والسيريالات ثم أعد المحاولة.");
    }
    return knownMath(error);
  }
}

async function lockSale(tx: Transaction, actorId: bigint, saleId: bigint, action: CommerceAction) {
  const sale = await tx.commerceSale.findUnique({ where: { id: saleId }, include: { branch: { select: { isActive: true } } } });
  if (!sale) throw new InventoryProblem("الفاتورة غير موجودة أو غير متاحة.");
  await authorize(tx, actorId, action, sale.branchId, sale.branch.isActive);
  // Serialize return, collection and refund calculations for this invoice.
  const locked = await tx.$queryRaw<Array<{ id: bigint }>>`SELECT "id" FROM "commerce_sales" WHERE "id" = ${saleId} FOR UPDATE`;
  if (locked.length !== 1) throw new InventoryProblem("الفاتورة غير متاحة.");
  // Changing the row forces an older SERIALIZABLE snapshot that waited on this
  // lock to retry rather than calculating against stale payment/return aggregates.
  await tx.commerceSale.update({ where: { id: saleId }, data: { revision: { increment: 1 } } });
  return sale;
}

async function position(tx: Transaction, saleId: bigint, total: DecimalLike) {
  const [returned, collected, refunded] = await Promise.all([
    tx.commerceReturnLine.aggregate({ where: { returned: { saleId } }, _sum: { total: true } }),
    tx.commerceCollection.aggregate({ where: { saleId }, _sum: { amount: true } }),
    tx.commerceRefund.aggregate({ where: { saleId }, _sum: { amount: true } }),
  ]);
  return customerPosition({ originalTotalCents: scaled(total, 2), returnedCents: scaled(returned._sum.total, 2), collectedCents: scaled(collected._sum.amount, 2), refundedCents: scaled(refunded._sum.amount, 2) });
}

/** A later collection records receipt of funds; it never initiates a payment. */
export async function recordCommerceCollection(db: Db, actorId: bigint, raw: unknown): Promise<WriteResult> {
  const parsed = parseMoneyMovement(raw, false);
  if (!parsed.ok) throw new InventoryProblem("راجع التحصيل ثم حاول مجددًا.", parsed.errors);
  const input = parsed.value;
  const requestHash = digest({ actorId: actorId.toString(), type: "COLLECTION", ...input });
  try {
    return await withSerializableRetry(db, async (tx) => {
      const sale = await lockSale(tx, actorId, BigInt(input.saleId), "RECORD_COLLECTION");
      const prior = await tx.commerceCollection.findUnique({ where: { requestId: input.requestId } });
      if (prior) { ensureMatchingRequest(prior, actorId, requestHash); return { id: prior.id.toString(), replayed: true }; }
      const current = await position(tx, sale.id, sale.total);
      validateCollectionAmount(current.dueFromCustomerCents, scaledInteger(input.amount, 2));
      const collection = await tx.commerceCollection.create({ data: { requestId: input.requestId, requestHash, saleId: sale.id, amount: input.amount, method: input.method, isInitial: false, createdById: actorId }, select: { id: true } });
      return { id: collection.id.toString(), replayed: false };
    });
  } catch (error) {
    if (isCode(error, "P2002")) {
      const prior = await db.commerceCollection.findUnique({ where: { requestId: input.requestId } });
      if (prior) { ensureMatchingRequest(prior, actorId, requestHash); return { id: prior.id.toString(), replayed: true }; }
    }
    return knownMath(error);
  }
}

/** This records a refund already paid outside the system. It does not transfer money. */
/**
 * A cash refund is money leaving the branch right now, so it must leave the
 * account that held it in the same transaction. Recording it only as a
 * customer-position row leaves the employee's custody holding cash he already
 * paid out, and the difference resurfaces later as an unexplained shortage.
 */
async function postRefundMovement(
  tx: Transaction, actorId: bigint, branchId: bigint, accountId: string,
  amount: string, refundId: string, negativeAcknowledged: boolean,
): Promise<void> {
  if (process.env.FINANCE_ENABLED !== "true") return;
  const port = financePort(tx);
  const rows = await port.query<{ branch: string; balance: string }>(
    `SELECT a.branch_id::text AS branch,
       (a.opening_amount + COALESCE((SELECT SUM(CASE WHEN m.destination_id=a.id THEN m.amount ELSE -m.amount END)
         FROM finance.movements m WHERE m.source_id=a.id OR m.destination_id=a.id),0))::text AS balance
     FROM finance.accounts a WHERE a.id=$1::bigint`, [accountId]);
  const account = rows.rows[0];
  if (!account) throw new InventoryProblem("الحساب الذي يخرج منه الرد غير موجود.");
  if (account.branch !== branchId.toString()) throw new InventoryProblem("الحساب الذي يخرج منه الرد ليس في فرع الفاتورة.");
  try {
    await postCashRefundInTransaction(port, actorId.toString(), {
      branchId: branchId.toString(), accountId, amount, refundId,
      expectedBalance: account.balance, negativeAcknowledged,
    });
  } catch (error) {
    if (error instanceof FinanceProblem) throw new InventoryProblem(error.message);
    throw error;
  }
}

export async function recordCommerceRefund(db: Db, actorId: bigint, raw: unknown): Promise<WriteResult> {
  const parsed = parseMoneyMovement(raw, true);
  if (!parsed.ok) throw new InventoryProblem("راجع رد المبلغ ثم حاول مجددًا.", parsed.errors);
  const input = parsed.value;
  const requestHash = digest({ actorId: actorId.toString(), type: "REFUND", ...input });
  try {
    return await withSerializableRetry(db, async (tx) => {
      const sale = await lockSale(tx, actorId, BigInt(input.saleId), "RECORD_REFUND");
      const prior = await tx.commerceRefund.findUnique({ where: { requestId: input.requestId } });
      if (prior) { ensureMatchingRequest(prior, actorId, requestHash); return { id: prior.id.toString(), replayed: true }; }
      const current = await position(tx, sale.id, sale.total);
      validateRefundAmount(current.dueToCustomerCents, scaledInteger(input.amount, 2));
      const refund = await tx.commerceRefund.create({ data: { requestId: input.requestId, requestHash, saleId: sale.id, amount: input.amount, method: input.method, createdById: actorId }, select: { id: true } });
      if (input.method === "CASH" && input.accountId) {
        await postRefundMovement(tx, actorId, sale.branchId, input.accountId, input.amount, refund.id.toString(), input.negativeAcknowledged);
      }
      return { id: refund.id.toString(), replayed: false };
    });
  } catch (error) {
    if (isCode(error, "P2002")) {
      const prior = await db.commerceRefund.findUnique({ where: { requestId: input.requestId } });
      if (prior) { ensureMatchingRequest(prior, actorId, requestHash); return { id: prior.id.toString(), replayed: true }; }
    }
    return knownMath(error);
  }
}

/**
 * Manager-only partial return or cancellation. A return decreases the amount due
 * before producing a customer liability; it never claims that a refund was paid.
 * Physical items are restored at their snapshotted sale cost, blended with the
 * current warehouse average (which may have changed due to later receipts).
 */
export async function returnCommerceSale(db: Db, actorId: bigint, raw: unknown): Promise<WriteResult> {
  const parsed = parseReturnInput(raw);
  if (!parsed.ok) throw new InventoryProblem("راجع المرتجع ثم حاول مجددًا.", parsed.errors);
  const input = parsed.value;
  const requestHash = digest({ actorId: actorId.toString(), ...input });
  try {
    return await withSerializableRetry(db, async (tx) => {
      const sale = await lockSale(tx, actorId, BigInt(input.saleId), "RETURN_OR_CANCEL");
      const prior = await tx.commerceReturn.findUnique({ where: { requestId: input.requestId } });
      if (prior) { ensureMatchingRequest(prior, actorId, requestHash); return { id: prior.id.toString(), replayed: true }; }
      if (sale.cancelledAt) throw new InventoryProblem("الفاتورة ملغاة بالفعل.");
      const lines = await tx.commerceSaleLine.findMany({
        where: { saleId: sale.id }, orderBy: { id: "asc" },
        include: { returnLines: { select: { quantity: true } }, serialLinks: { include: { serial: { select: { currentSaleLineId: true } }, returnSerial: { select: { id: true } } } } },
      });
      const lineMap = new Map(lines.map((line) => [line.id.toString(), line]));
      let selected: ReturnLineInput[];
      if (input.cancel) {
        selected = [];
        for (const line of lines) {
          const returned = line.returnLines.reduce((sum, part) => sum + scaled(part.quantity, 2), 0n);
          const remaining = scaled(line.quantity, 2) - returned;
          if (remaining < 0n) throw new InventoryProblem("كمية المرتجعات السابقة غير متطابقة؛ راجع المدير.");
          if (!remaining) continue;
          const ids = line.isSerialized ? line.serialLinks.filter((link) => !link.returnSerial && link.serial.currentSaleLineId === line.id).map((link) => link.serialId.toString()) : [];
          selected.push({ saleLineId: line.id.toString(), quantity: fixed(remaining, 2), serialIds: ids });
        }
      } else selected = input.lines;
      if (!selected.length) throw new InventoryProblem("لا توجد كمية متبقية للإرجاع في الفاتورة.");

      const prepared = selected.map((selection) => {
        const line = lineMap.get(selection.saleLineId);
        if (!line) throw new InventoryProblem("أحد البنود لا ينتمي إلى هذه الفاتورة.");
        const quantity = scaledInteger(selection.quantity, 2);
        const previous = line.returnLines.reduce((sum, part) => sum + scaled(part.quantity, 2), 0n);
        const amounts = allocatePartialReturn({ originalQuantityHundredths: scaled(line.quantity, 2), previousReturnedHundredths: previous, returnQuantityHundredths: quantity, originalFinalCents: scaled(line.total, 2), originalTaxCents: scaled(line.taxAmount, 2) });
        if (line.isSerialized && (quantity % 100n !== 0n || BigInt(selection.serialIds.length) * 100n !== quantity)) throw new InventoryProblem(`اختر رقمًا تسلسليًا واحدًا لكل جهاز مرتجع من ${line.nameSnapshot}.`);
        if (!line.isSerialized && selection.serialIds.length) throw new InventoryProblem("السيريالات المحددة لا تطابق البند.");
        const links = selection.serialIds.map((serialId) => line.serialLinks.find((link) => link.serialId.toString() === serialId));
        if (links.some((link) => !link || link.returnSerial || link.serial.currentSaleLineId !== line.id)) throw new InventoryProblem("أحد السيريالات غير متاح للمرتجع أو أُرجع سابقًا.");
        if (line.isStock && (!line.unitCost || scaled(line.unitCost, 4) < 0n)) throw new InventoryProblem("تكلفة البيع المحفوظة غير صالحة؛ لم يُحفظ المرتجع.");
        return { selection, line, quantity, amounts, links: links.filter((link): link is NonNullable<typeof link> => Boolean(link)) };
      });
      const returned = await tx.commerceReturn.create({ data: { requestId: input.requestId, requestHash, saleId: sale.id, isCancellation: input.cancel, createdById: actorId }, select: { id: true } });
      for (const item of prepared) {
        const returnLine = await tx.commerceReturnLine.create({ data: { returnId: returned.id, saleLineId: item.line.id, quantity: item.selection.quantity, total: fixed(item.amounts.finalCents, 2), taxAmount: fixed(item.amounts.taxCents, 2) }, select: { id: true } });
        if (item.line.isSerialized) {
          const ids = item.selection.serialIds.map(BigInt);
          const changed = await tx.inventorySerial.updateMany({ where: { id: { in: ids }, currentSaleLineId: item.line.id }, data: { currentSaleLineId: null } });
          if (changed.count !== ids.length) throw new InventoryProblem("تغيّرت حالة أحد السيريالات؛ لم يُحفظ المرتجع.");
          await tx.commerceReturnSerial.createMany({ data: item.links.map((link) => ({ returnLineId: returnLine.id, saleLineSerialId: link.id })) });
        }
        if (item.line.isStock) {
          const cost = item.line.unitCost!.toFixed(4);
          const changed = await tx.$queryRaw<Array<{ id: bigint }>>`
            INSERT INTO "stock_levels" ("warehouse_id", "product_id", "qty_on_hand", "avg_cost", "updated_at")
            VALUES (${sale.warehouseId}, ${item.line.productId}, CAST(${item.selection.quantity} AS numeric(12,2)), CAST(${cost} AS numeric(14,4)), CURRENT_TIMESTAMP)
            ON CONFLICT ("warehouse_id", "product_id") DO UPDATE SET
              "avg_cost" = ROUND(("stock_levels"."qty_on_hand" * "stock_levels"."avg_cost" + EXCLUDED."qty_on_hand" * EXCLUDED."avg_cost") /
                NULLIF("stock_levels"."qty_on_hand" + EXCLUDED."qty_on_hand", 0), 4),
              "qty_on_hand" = "stock_levels"."qty_on_hand" + EXCLUDED."qty_on_hand", "updated_at" = CURRENT_TIMESTAMP
            WHERE "stock_levels"."qty_on_hand" >= 0 AND "stock_levels"."avg_cost" >= 0
              AND "stock_levels"."qty_on_hand" + EXCLUDED."qty_on_hand" <= 9999999999.99
            RETURNING "id"
          `;
          if (changed.length !== 1) throw new InventoryProblem("رصيد المستودع غير صالح أو يتجاوز الحد؛ لم يُحفظ المرتجع.");
        }
      }
      if (input.cancel) await tx.commerceSale.update({ where: { id: sale.id }, data: { cancelledAt: new Date() } });
      return { id: returned.id.toString(), replayed: false };
    });
  } catch (error) {
    if (isCode(error, "P2002")) {
      const prior = await db.commerceReturn.findUnique({ where: { requestId: input.requestId } });
      if (prior) { ensureMatchingRequest(prior, actorId, requestHash); return { id: prior.id.toString(), replayed: true }; }
      throw new InventoryProblem("أحد السيريالات أُرجع بالتزامن؛ لم يُحفظ أي جزء من المرتجع.");
    }
    return knownMath(error);
  }
}

/** Manager-only setting; each change is idempotent and retains an audit row. */
export async function changeStaffDiscountLimit(db: Db, actorId: bigint, raw: unknown): Promise<WriteResult> {
  const parsed = parseDiscountSetting(raw);
  if (!parsed.ok) throw new InventoryProblem("راجع نسبة الخصم.", parsed.errors);
  const input = parsed.value;
  const requestHash = digest({ actorId: actorId.toString(), ...input });
  try {
    return await withSerializableRetry(db, async (tx) => {
      await authorize(tx, actorId, "CONFIGURE_DISCOUNT", null, false);
      const prior = await tx.commerceSettingsChange.findUnique({ where: { requestId: input.requestId } });
      if (prior) { ensureMatchingRequest(prior, actorId, requestHash); return { id: prior.id.toString(), replayed: true }; }
      const locked = await tx.$queryRaw<Array<{ id: number }>>`SELECT "id" FROM "commerce_settings" WHERE "id" = 1 FOR UPDATE`;
      if (locked.length !== 1) throw new InventoryProblem("إعداد حد الخصم غير موجود.");
      await tx.commerceSettings.update({ where: { id: 1 }, data: { staffDiscountBps: input.basisPoints, updatedById: actorId, updatedAt: new Date() } });
      const change = await tx.commerceSettingsChange.create({ data: { requestId: input.requestId, requestHash, staffDiscountBps: input.basisPoints, createdById: actorId }, select: { id: true } });
      return { id: change.id.toString(), replayed: false };
    });
  } catch (error) {
    if (isCode(error, "P2002")) {
      const prior = await db.commerceSettingsChange.findUnique({ where: { requestId: input.requestId } });
      if (prior) { ensureMatchingRequest(prior, actorId, requestHash); return { id: prior.id.toString(), replayed: true }; }
    }
    return knownMath(error);
  }
}
