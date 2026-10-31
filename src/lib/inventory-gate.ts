import "server-only";

import { redirect } from "next/navigation";

import { inventoryEnabled } from "./feature-flags";
import { InventoryProblem } from "./inventory-operations";

/**
 * حارس المخزون والمستودعات. النمط نفسه المعتمد في بقية الشاشات: الحارس داخل
 * الصفحة أو الإجراء نفسه، لا في وسيط (middleware)، حتى يبقى صحيحًا مهما
 * اختلفت بيئة النشر.
 *
 * - `requireInventoryEnabled` للصفحات: تحوّل إلى لوحة القيادة.
 * - `assertInventoryEnabled` لإجراءات الخادم وواجهات برمجة التطبيق: ترفض
 *   العملية بخطأ واضح بدل تنفيذ أي كتابة على المخزون.
 */
export async function requireInventoryEnabled(): Promise<void> {
  if (inventoryEnabled()) return;
  redirect("/dashboard");
}

export function assertInventoryEnabled(): void {
  if (inventoryEnabled()) return;
  throw new InventoryProblem("المخزون والمستودعات معطّلة حاليًا في هذا النظام. سجّل البيع من شاشة البيع الجديدة.");
}
