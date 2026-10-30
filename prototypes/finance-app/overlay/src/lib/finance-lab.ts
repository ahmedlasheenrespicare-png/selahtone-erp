/** TEST ONLY: Prisma/PGlite bridge for the disposable finance laboratory. */
import "server-only";
import type { SessionUser } from "./auth";
import { prisma } from "./prisma";
import { listAccounts } from "../../prototypes/finance-engine/engine";
import type { FinanceDatabase } from "../../prototypes/finance-engine/types";
import { assertFinanceActor, financeTx, sqlError } from "./finance-bridge";

export function scopedFinanceDb(session: SessionUser): FinanceDatabase { return {
  serializable: async (work) => {
    try { return await prisma.$transaction(async (tx) => { await assertFinanceActor(tx, session.id, session); return work(financeTx(tx)); }, { isolationLevel: "Serializable", maxWait: 5000, timeout: 20000 }); }
    catch (error) { return sqlError(error); }
  },
}; }

export type CashTarget = { id: string; branchId: string; kind: "VAULT" | "CUSTODY"; holderId: string | null; label: string; balance?: string; openingDate?: string; checkpointRef: string; checkpointDate: string };
/** Server-filtered choices: employees get their branch vault's NAME (not balance)
 * and their own custody, never another employee's custody or branch. */
export async function cashTargets(session: SessionUser, branchId: string): Promise<CashTarget[]> {
  if (!/^[1-9]\d{0,18}$/.test(branchId)) return [];
  if (session.role === "CS_AGENT" && session.branchId !== branchId) return [];
  const branches = await prisma.branch.findMany({ select: { id: true, nameAr: true } });
  const users = await prisma.user.findMany({ where: { ...(session.role === "CS_AGENT" ? { id: BigInt(session.id) } : {}) }, select: { id: true, fullName: true } });
  const branchNames = new Map(branches.map((b) => [b.id.toString(), b.nameAr]));
  const userNames = new Map(users.map((u) => [u.id.toString(), u.fullName]));
  const visible = await listAccounts(scopedFinanceDb(session), session.id);
  const result: CashTarget[] = visible.filter((a) => a.branchId === branchId).map((a) => ({ ...a, checkpointRef:"OPENING", checkpointDate:a.openingDate, label: a.kind === "VAULT" ? `خزنة ${branchNames.get(a.branchId) ?? "الفرع"}` : `عهدة ${userNames.get(a.holderId ?? "") ?? "الموظف"}` }));
  if (session.role === "CS_AGENT") {
    // A target is selectable, not a balance disclosure. The policy is checked
    // again by the transaction hook, independently of this list.
    const vaults = await prisma.$queryRaw<Array<{ id: string; branchId: string }>>`
      SELECT id::text AS id,branch_id::text AS "branchId" FROM finance_lab.accounts
      WHERE branch_id=${BigInt(branchId)} AND kind='VAULT'`;
    for (const a of vaults) result.unshift({ id: a.id, branchId: a.branchId, kind: "VAULT", holderId: null, label: `خزنة ${branchNames.get(a.branchId) ?? "الفرع"}`, checkpointRef:"OPENING",checkpointDate:"" });
  }
  for (const a of result) {
    const rows = await prisma.$queryRaw<Array<{ref:string; day:string; openingDate:string}>>`
      SELECT COALESCE((SELECT c.id::text FROM finance_lab.cash_counts c WHERE c.account_id=a.id AND c.status='CONFIRMED' ORDER BY c.id DESC LIMIT 1),'OPENING') AS ref,
        COALESCE((SELECT c.counted_on::text FROM finance_lab.cash_counts c WHERE c.account_id=a.id AND c.status='CONFIRMED' ORDER BY c.id DESC LIMIT 1),a.opening_date::text) AS day,
        a.opening_date::text AS "openingDate" FROM finance_lab.accounts a WHERE a.id=${BigInt(a.id)}`;
    if (!rows[0]) continue;
    a.checkpointRef=rows[0].ref;a.checkpointDate=rows[0].day;
    // Opening dates identify ordering, not account balances.
    a.openingDate=rows[0].openingDate;
  }
  return result;
}
