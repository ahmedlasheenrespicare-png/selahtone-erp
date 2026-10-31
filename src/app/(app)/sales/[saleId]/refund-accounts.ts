import { prisma } from "@/lib/prisma";
import type { MovementAccountOption } from "./movement-form";

/**
 * Cash accounts of the sale's branch, for the refund form to choose from.
 *
 * A cash refund leaves real money now, so the form must say which account it
 * leaves. Read only when the finance schema is enabled; otherwise the refund
 * form simply offers no accounts and non-cash refunds still record.
 */
export async function loadRefundAccounts(branchId: bigint): Promise<MovementAccountOption[]> {
  if (process.env.FINANCE_ENABLED !== "true") return [];
  const rows = await prisma.$queryRaw<Array<{ id: bigint; kind: string; holderId: bigint | null; balance: unknown }>>`
    SELECT a.id, a.kind::text AS kind, a.holder_id AS "holderId",
      (a.opening_amount + COALESCE((SELECT SUM(CASE WHEN m.destination_id=a.id THEN m.amount ELSE -m.amount END)
        FROM finance.movements m WHERE m.source_id=a.id OR m.destination_id=a.id), 0)) AS balance
    FROM finance.accounts a WHERE a.branch_id = ${branchId} ORDER BY a.id`;
  if (!rows.length) return [];
  const holders = await prisma.user.findMany({
    where: { id: { in: rows.map((row) => row.holderId).filter((value): value is bigint => value !== null) } },
    select: { id: true, fullName: true },
  });
  const names = new Map(holders.map((holder) => [holder.id.toString(), holder.fullName]));
  return rows.map((row) => {
    const holder = row.holderId ? names.get(row.holderId.toString()) ?? "موظف" : null;
    const balance = typeof row.balance === "object" && row.balance !== null && "toFixed" in row.balance
      ? (row.balance as { toFixed: (places: number) => string }).toFixed(2)
      : String(row.balance ?? "0.00");
    return { id: row.id.toString(), label: row.kind === "VAULT" ? "خزنة الفرع" : `عهدة${holder ? ` · ${holder}` : ""}`, balance };
  });
}
