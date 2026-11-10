import { InventoryProblem } from "../inventory-operations";
import { financePort } from "./port";

/**
 * Temporary safeguard, not the final cash-account integration.
 * Caller already authorized the actor and must use the same serializable
 * transaction for the collection and finishCashCustodyCollection. Invoices
 * and payments must replay before invoking this guard.
 */
export async function lockCashCollectorCustody(tx: unknown, branchId: bigint, actorId: bigint, method: string): Promise<string | null> {
  if (process.env.FINANCE_ENABLED !== "true" || method !== "CASH") return null;
  const rows = await financePort(tx).query<{ id: string }>(`SELECT id::text AS id
    FROM finance.accounts WHERE branch_id=$1::bigint AND holder_id=$2::bigint AND kind='CUSTODY' AND closed_at IS NULL ORDER BY id FOR UPDATE`, [branchId.toString(), actorId.toString()]);
  if (rows.rows.length !== 1)
    throw new InventoryProblem("يلزم وجود عهدة مفتوحة للمسجّل في فرع الفاتورة للتحصيل النقدي مؤقتًا؛ راجع الإدارة.");
  const accountId = rows.rows[0].id;
  const pending = await financePort(tx).query<{ settlement: boolean; count: boolean }>(`SELECT
    EXISTS(SELECT 1 FROM finance.settlements WHERE account_id=$1::bigint AND status='OPEN') AS settlement,
    EXISTS(SELECT 1 FROM finance.cash_counts WHERE account_id=$1::bigint AND status='OPEN') AS count`, [accountId]);
  if (pending.rows[0]?.settlement || pending.rows[0]?.count)
    throw new InventoryProblem("لا يمكن التحصيل النقدي مؤقتًا مع طلب تسوية أو جرد مفتوح لهذه العهدة؛ راجعه أو ألغِه أولًا.");
  return accountId;
}

/** Invalidate account-based count checkpoints, with no immediate cash movement. */
export async function finishCashCustodyCollection(tx: unknown, accountId: string | null): Promise<void> {
  if (accountId) await financePort(tx).query(`UPDATE finance.accounts SET revision=revision+1 WHERE id=$1::bigint`, [accountId]);
}
