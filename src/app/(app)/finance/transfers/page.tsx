import { randomUUID } from "node:crypto";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppIcon } from "@/components/app-icon";
import PrintPageButton from "@/components/print-page-button";
import { getSession } from "@/lib/auth";
import { requireMenuScopeAccess } from "@/lib/menu-scope-guard";
import { assertFinanceActor, financeDb, financeEnabled } from "@/lib/finance/db";
import { financeRead } from "../page-context";
import { listAccounts, listSettlements } from "@/lib/finance/engine";
import { prisma } from "@/lib/prisma";
import { accountLabel, formatMoney } from "../format";
import TransferForm, { type AccountOption } from "./transfer-form";
import { SettlementDecisionCard, type SettlementDecisionItem } from "./settlement-decisions";

export const dynamic = "force-dynamic";

export default async function FinanceTransfersPage() {
  const session = await getSession();
  await requireMenuScopeAccess("/finance/transfers");
  if (!session) redirect("/login");
  if (session.mustChangePassword) redirect("/change-password");
  if (!financeEnabled()) redirect("/dashboard");
  const canManage = session.role === "MANAGER" || session.role === "ACCOUNTANT";

  const [branches, users, accounts] = await Promise.all([
    prisma.branch.findMany({ select: { id: true, nameAr: true } }),
    prisma.user.findMany({ where: { roleCode: "CS_AGENT" }, select: { id: true, fullName: true } }),
    financeDb.serializable(async (tx) => {
      await assertFinanceActor(tx, { id: session.id, role: session.role, branchId: session.branchId });
      return listAccounts({ serializable: (work) => work(tx) }, session.id);
    }),
  ]);
  // طلبات التسوية للإدارة فقط، وتُقرأ في معاملة منفصلة بعد التحقق من الجلسة.
  const settlements = canManage
    ? await financeRead(session, (tx) => listSettlements({ serializable: (work) => work(tx) }, session.id))
    : [];
  const branchNames = new Map(branches.map((branch) => [branch.id.toString(), branch.nameAr]));
  const userNames = new Map(users.map((user) => [user.id.toString(), user.fullName]));
  // الاعتماد يحتاج خزنة للفرع؛ التنبيه يسبق النموذج بدل أن يكتشفه المدير عند الفشل.
  const branchesWithVault = new Set(accounts.filter((account) => String(account.kind) === "VAULT").map((account) => String(account.branchId)));
  const balanceByAccount = new Map(accounts.map((account) => [account.id, account.balance]));
  const holderByAccount = new Map(accounts.map((account) => [account.id, account.holderId ? userNames.get(account.holderId) ?? null : null]));
  const pendingSettlements: SettlementDecisionItem[] = settlements
    .filter((settlement) => String(settlement.status) === "OPEN")
    .map((settlement) => ({
      id: String(settlement.id),
      branchId: String(settlement.branchId),
      branchName: branchNames.get(String(settlement.branchId)) ?? "فرع",
      holderName: holderByAccount.get(String(settlement.accountId)) ?? null,
      systemBalance: String(settlement.systemBalance),
      countedAmount: String(settlement.countedAmount),
      salesTotal: String(settlement.salesTotal),
      expensesTotal: String(settlement.expensesTotal),
      expectedAmount: String(settlement.expectedAmount),
      deviation: String(settlement.deviation),
      adjustment: String(settlement.adjustment),
      reason: String(settlement.reason),
      createdAt: String(settlement.createdAt),
      // الرصيد الفعلي الآن لا وقت الطلب: أي تغيّر يُرفض في الخادم لإعادة المراجعة.
      expectedBalance: balanceByAccount.get(String(settlement.accountId)) ?? String(settlement.systemBalance),
    }));

  // المعدود لقطة زمنية: تُعلَّم الطلبات التي وقعت بعدها حركة نقدية، ليُعرف
  // ذلك قبل محاولة الاعتماد لا بعد رفضه.
  const staleSettlements = canManage && pendingSettlements.length
    ? await financeRead(session, (tx) => tx.query<{ id: string }>(`
        SELECT s.id::text AS id FROM finance.settlements s
        JOIN finance.accounts a ON a.id = s.account_id
        WHERE s.status = 'OPEN' AND (
          EXISTS (SELECT 1 FROM finance.movements m
                   WHERE (m.source_id = a.id OR m.destination_id = a.id) AND m.created_at > s.created_at)
          OR EXISTS (SELECT 1 FROM public.commerce_collections c JOIN public.commerce_sales sl ON sl.id = c.sale_id
                     WHERE sl.branch_id = a.branch_id AND c.method = 'CASH' AND c.created_at > s.created_at)
          OR EXISTS (SELECT 1 FROM finance.payments p JOIN finance.expenses e ON e.id = p.expense_id
                     WHERE e.branch_id = a.branch_id AND p.source = 'HOLDER_CASH' AND p.recorded_at > s.created_at)
        )`))
    : { rows: [] };
  const staleSettlementIds = new Set(staleSettlements.rows.map((row) => row.id));

  // الموظف يسلّم من عهدته إلى خزنة فرعه: والحسابات التي يراها مقيَّدة سلفًا
  // من listAccounts (عهدة نفسه وخزنة فرعه)، والمحرك يرفض أيَّ جهةٍ سواهما.
  const ownCustody = accounts.find((item) => item.kind === "CUSTODY" && String(item.holderId ?? "") === String(session.id)) ?? null;
  if (!canManage && !ownCustody) {
    return (
      <div className="fin-page">
        <Link href="/finance/mine" className="fin-back">العودة إلى عهدتي</Link>
        <div className="fin-alert fin-alert--error">لا عهدة مفتوحة باسمك. تُفتح العهدة بجرد فعلي يسجّله المدير أو المحاسب.</div>
      </div>
    );
  }

  const options: AccountOption[] = accounts.map((account) => ({
    id: account.id,
    kind: account.kind,
    branchId: account.branchId,
    branchName: branchNames.get(account.branchId) ?? "فرع",
    holderName: account.holderId ? userNames.get(account.holderId) ?? "موظف" : null,
    balance: account.balance,
  }));

  const optionById = new Map(options.map((opt) => [opt.id, opt]));
  const recentTransfersRes =
    options.length > 0
      ? await financeRead(session, (tx) =>
          tx.query<{
            id: string;
            sourceId: string;
            destId: string;
            amount: string;
            createdAt: string;
          }>(
            `SELECT m.id::text AS id,
                    m.source_id::text AS "sourceId",
                    m.destination_id::text AS "destId",
                    m.amount::text AS amount,
                    m.created_at::text AS "createdAt"
               FROM finance.movements m
              WHERE m.kind = 'TRANSFER'
                ${canManage ? "" : "AND m.branch_id = $1::bigint"}
              ORDER BY m.id DESC
              LIMIT 20`,
            canManage ? [] : [session.branchId],
          ),
        ).catch(() => ({ rows: [] }))
      : { rows: [] };
  const recentTransfers = recentTransfersRes.rows.filter(
    (r) => optionById.has(r.sourceId) || optionById.has(r.destId),
  );
  const transferDateFmt = new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Cairo",
  });

  return (
    <div className="fin-page">
      <Link href={canManage ? "/finance" : "/finance/mine"} className="fin-back no-print">
        <AppIcon name="arrow" />
        <span>{canManage ? "العودة إلى المالية" : "العودة إلى عهدتي"}</span>
      </Link>
      <div className="fin-heading">
        <div>
          <p className="fin-heading__eyebrow">
            <span className="fin-eyebrow-dot" aria-hidden="true" />
            تسليم فعلي
          </p>
          <h1>تسليم نقد بين الحسابات</h1>
          <p>خطوة واحدة بين خزنة الفرع وعهدة موظف في الفرع نفسه. التسليم بين فرعين غير مسموح.</p>
        </div>
        <div className="fin-actions">
          <PrintPageButton
            label="طباعة سند التسليم"
            className="fin-button fin-button--secondary"
            title="طباعة سجل وسندات التسليم النقدي"
          />
        </div>
      </div>

      {options.length < 2 ? (
        <div className="fin-panel fin-empty">
          يحتاج التسليم إلى حسابين مفتوحين على الأقل في الفرع نفسه (خزنة الفرع وعهدة موظف).
          <div className="fin-actions" style={{ justifyContent: "center", marginTop: 14 }}>
            <Link className="fin-button" href="/finance/accounts">فتح حساب بجرد فعلي</Link>
            <Link className="fin-button fin-button--secondary" href="/finance">العودة إلى المالية</Link>
          </div>
        </div>
      ) : (
        <TransferForm requestId={randomUUID()} accounts={options} />
      )}

      {pendingSettlements.length > 0 ? (
        <div className="fin-page__section">
          <div className="fin-heading">
            <div>
              <p className="fin-heading__eyebrow">
                <span className="fin-eyebrow-dot" aria-hidden="true" />
                عهدة الموظف
              </p>
              <h2>طلبات التسوية المعلقة</h2>
              <p>اعتماد التسوية يسجّل حركتين في خطوة واحدة: مطابقة الدفتر مع الواقع، ثم تحويل الفرق كاملًا.</p>
            </div>
            <div className="fin-actions">
              <span className="fin-badge fin-badge--pending">
                {pendingSettlements.length} بانتظار القرار
              </span>
            </div>
          </div>
          {pendingSettlements.map((item) => (
            <div key={item.id} className="fin-page__section">
              {staleSettlementIds.has(item.id) ? (
                <div className="fin-alert fin-alert--warning" role="status">
                  وقعت حركة نقدية على هذه العهدة بعد تقديم الطلب، فالمعدود لم يعد مطابقًا للنقد في اليد.
                  الاعتماد سيُرفض حتى يُلغى الطلب بسبب واضح ويُعاد الجرد بطلب جديد.
                </div>
              ) : null}
              {!branchesWithVault.has(item.branchId) ? (
                <div className="fin-alert fin-alert--warning" role="status">
                  لا توجد خزنة مفتوحة لفرع {item.branchName}. الاعتماد يحتاج خزنة تُحوَّل إليها أو منها، فسيُرفض بدونها.
                  افتح الخزنة بجرد فعلي من «الحسابات النقدية» أولًا.
                </div>
              ) : null}
              <SettlementDecisionCard item={item} />
            </div>
          ))}
        </div>
      ) : null}

      <div className="fin-page__section">
        <div className="fin-panel">
          <div className="fin-panel__heading">
            <h2>سجل حركات التسليم النقدي الأخيرة</h2>
            <p>أحدث عمليات التسليم الفعلي بين خزنة الفرع وعُهَد الموظفين مع إمكانية طباعة السجل كسند مراجعة.</p>
          </div>
          {recentTransfers.length === 0 ? (
            <div className="fin-empty">لم تُسجَّل حركات تسليم نقدي بعد ضمن الحسابات المتاحة.</div>
          ) : (
            <div className="fin-table-wrap">
              <table className="fin-table">
                <thead>
                  <tr>
                    <th>رقم الحركة</th>
                    <th>من (المسلِّم)</th>
                    <th>إلى (المستلِم)</th>
                    <th>المبلغ</th>
                    <th>التوقيت</th>
                  </tr>
                </thead>
                <tbody>
                  {recentTransfers.map((tr) => {
                    const src = optionById.get(tr.sourceId);
                    const dst = optionById.get(tr.destId);
                    const dt = new Date(tr.createdAt);
                    return (
                      <tr key={tr.id}>
                        <td><bdi dir="ltr">#{tr.id}</bdi></td>
                        <td>
                          {src
                            ? `${src.branchName} · ${accountLabel(src.kind)}${src.holderName ? ` (${src.holderName})` : ""}`
                            : `حساب #${tr.sourceId}`}
                        </td>
                        <td>
                          {dst
                            ? `${dst.branchName} · ${accountLabel(dst.kind)}${dst.holderName ? ` (${dst.holderName})` : ""}`
                            : `حساب #${tr.destId}`}
                        </td>
                        <td>
                          <strong className="fin-money"><bdi dir="ltr">{formatMoney(tr.amount)}</bdi></strong>
                        </td>
                        <td>
                          <bdi dir="ltr">{Number.isNaN(dt.getTime()) ? tr.createdAt : transferDateFmt.format(dt)}</bdi>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
