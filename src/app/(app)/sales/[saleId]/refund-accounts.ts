import { prisma } from "@/lib/prisma";
import type { MovementAccountOption } from "./movement-form";

/**
 * Cash accounts of the sale's branch, for the refund form to choose from.
 *
 * A cash refund leaves real money now, so the form must say which account it
 * leaves. Read only when the finance schema is enabled; otherwise the refund
 * form simply offers no accounts and non-cash refunds still record.
 */
export async function loadRefundAccounts(branchId: bigint, canViewBalances: boolean): Promise<MovementAccountOption[]> {
  if (process.env.FINANCE_ENABLED !== "true") return [];
  type AccountRow = { id: bigint; kind: string; holderId: bigint | null; checkpointRef: string; checkpointDate: string; checkpointConfirmedAt: string | null; balance?: unknown };
  const rows = canViewBalances ? await prisma.$queryRaw<AccountRow[]>`
    SELECT a.id, a.kind::text AS kind, a.holder_id AS "holderId",
      COALESCE((SELECT c.id::text FROM finance.cash_counts c WHERE c.account_id=a.id AND c.status='CONFIRMED' ORDER BY c.id DESC LIMIT 1), 'OPENING') AS "checkpointRef",
      COALESCE((SELECT c.counted_on::text FROM finance.cash_counts c WHERE c.account_id=a.id AND c.status='CONFIRMED' ORDER BY c.id DESC LIMIT 1), a.opening_date::text) AS "checkpointDate",
      (SELECT to_char(c.resolved_at AT TIME ZONE 'Africa/Cairo','YYYY-MM-DD HH24:MI:SS') FROM finance.cash_counts c WHERE c.account_id=a.id AND c.status='CONFIRMED' ORDER BY c.id DESC LIMIT 1) AS "checkpointConfirmedAt",
      (a.opening_amount + COALESCE((SELECT SUM(CASE WHEN m.destination_id=a.id THEN m.amount ELSE -m.amount END)
        FROM finance.movements m WHERE m.source_id=a.id OR m.destination_id=a.id), 0)) AS balance
    FROM finance.accounts a WHERE a.branch_id = ${branchId} AND a.closed_at IS NULL ORDER BY a.id` :
    await prisma.$queryRaw<AccountRow[]>`
    SELECT a.id, a.kind::text AS kind, a.holder_id AS "holderId",
      COALESCE((SELECT c.id::text FROM finance.cash_counts c WHERE c.account_id=a.id AND c.status='CONFIRMED' ORDER BY c.id DESC LIMIT 1), 'OPENING') AS "checkpointRef",
      COALESCE((SELECT c.counted_on::text FROM finance.cash_counts c WHERE c.account_id=a.id AND c.status='CONFIRMED' ORDER BY c.id DESC LIMIT 1), a.opening_date::text) AS "checkpointDate",
      (SELECT to_char(c.resolved_at AT TIME ZONE 'Africa/Cairo','YYYY-MM-DD HH24:MI:SS') FROM finance.cash_counts c WHERE c.account_id=a.id AND c.status='CONFIRMED' ORDER BY c.id DESC LIMIT 1) AS "checkpointConfirmedAt"
    FROM finance.accounts a WHERE a.branch_id = ${branchId} AND a.closed_at IS NULL ORDER BY a.id`;
  if (!rows.length) return [];
  const holders = await prisma.user.findMany({
    where: { id: { in: rows.map((row) => row.holderId).filter((value): value is bigint => value !== null) } },
    select: { id: true, fullName: true },
  });
  const names = new Map(holders.map((holder) => [holder.id.toString(), holder.fullName]));
  return rows.map((row) => {
    const holder = row.holderId ? names.get(row.holderId.toString()) ?? "موظف" : null;
    const option = { id: row.id.toString(), checkpointRef: row.checkpointRef, checkpointDate: row.checkpointDate, checkpointConfirmedAt: row.checkpointConfirmedAt, label: row.kind === "VAULT" ? "خزنة الفرع" : `عهدة${holder ? ` · ${holder}` : ""}` };
    if (!canViewBalances) return option;
    const balance = typeof row.balance === "object" && row.balance !== null && "toFixed" in row.balance
      ? (row.balance as { toFixed: (places: number) => string }).toFixed(2)
      : String(row.balance ?? "0.00");
    return { ...option, balance };
  });
}
