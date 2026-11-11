import type { Prisma } from "@prisma/client";

import {
  isSystemAdmin,
  parseAdminEmails,
  resolveHiddenKeys,
  writeAllowedForKeys,
} from "./access-control";
import { InventoryProblem } from "./inventory-operations";

type AccessRuleRow = { subject_kind: "role" | "user"; key: string; allowed: boolean };

/** Re-read and lock the current role/user permission rows inside a commerce
 * transaction. The HTTP guard remains an early UX check, not the final write
 * authorization. System-admin identity is re-read from the actor row too. */
export async function assertTransactionWriteAccess(
  tx: Prisma.TransactionClient,
  actorId: bigint,
  accessKey: string,
): Promise<void> {
  const actor = await tx.user.findUnique({
    where: { id: actorId },
    select: { email: true, roleCode: true },
  });
  if (!actor) throw new InventoryProblem("تعذّر التحقق من صلاحية الحساب؛ أعد الدخول ثم حاول مرة أخرى.");
  if (isSystemAdmin(actor.roleCode, actor.email, parseAdminEmails(process.env.ADMIN_EMAILS))) return;

  const rows = await tx.$queryRaw<AccessRuleRow[]>`
    SELECT subject_kind, key, allowed FROM public.access_control
    WHERE (subject_kind='role' AND subject=${actor.roleCode})
       OR (subject_kind='user' AND subject=${actorId.toString()})
    FOR SHARE`;
  const roleRows = new Map<string, boolean>();
  const userRows = new Map<string, boolean>();
  for (const row of rows) {
    if (row.subject_kind === "role") roleRows.set(row.key, row.allowed);
    else userRows.set(row.key, row.allowed);
  }
  if (!writeAllowedForKeys(resolveHiddenKeys(roleRows, userRows), accessKey)) {
    throw new InventoryProblem("تغيّرت صلاحية هذه العملية؛ راجع الصفحة قبل إعادة المحاولة.");
  }
}
