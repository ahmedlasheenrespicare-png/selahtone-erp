import "server-only";
import type { SessionUser } from "@/lib/auth";
import { financeDb, assertFinanceActor, financeEnabled } from "./db";
import { cairoDate } from "./validation";
import { RECORDED_FLOW_SQL } from "./recorded-flow-sql";

type FlowRow = { kind: string; method: string; amount: string; count: number; flagged: number };
export async function loadRecordedFlow(session: SessionUser, branchFilterId: string | null): Promise<FlowRow[]> {
  if (!financeEnabled()) throw new Error("finance disabled");
  if (session.role !== "MANAGER" && session.role !== "ACCOUNTANT" && session.role !== "CS_AGENT") throw new Error("forbidden role");
  if (session.role === "CS_AGENT" && !session.branchId) throw new Error("employee without branch");
  const branch = session.branchId ?? branchFilterId;
  const actor = session.role === "CS_AGENT" ? session.id : null;
  return financeDb.serializable(async tx => {
    await assertFinanceActor(tx, { id: session.id, role: session.role, branchId: session.branchId });
    const result = await tx.query<FlowRow>(RECORDED_FLOW_SQL, [branch, actor, `${cairoDate().slice(0,7)}-01`]);
    if (result.rows.some(r => !["COLLECTION", "REFUND", "PAYMENT"].includes(r.kind) || !["CASH", "CARD", "BANK_TRANSFER", "WALLET"].includes(r.method) || !/^\d+(?:\.\d{1,2})?$/.test(r.amount))) throw new Error("unsupported recorded flow row");
    return result.rows;
  });
}
