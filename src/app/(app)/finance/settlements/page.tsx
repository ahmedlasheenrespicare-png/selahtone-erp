import Link from "next/link";
import { redirect } from "next/navigation";
import { AppIcon } from "@/components/app-icon";
import PrintPageButton from "@/components/print-page-button";

import { prisma } from "@/lib/prisma";
import { listSettlements, settlementOverview } from "@/lib/finance/engine";
import { requireMenuScopeAccess } from "@/lib/menu-scope-guard";

import { formatMoney } from "../format";
import { financePage, financeRead } from "../page-context";
import { SETTLEMENT_STATUS_LABEL, SettlementCancelForm } from "./settlement-forms";

export const dynamic = "force-dynamic";

/**
 * شاشة الموظف: الإجمالي المتوقع (عهدة + مبيعات − مصروفات) وطلبات التسوية الخاصة به.
 * الإدارة ترى الطلبات في شاشة التسليم والتحويل لإقرارها.
 */
export default async function SettlementsPage() {
  const { session, canManage } = await financePage();
  await requireMenuScopeAccess("/finance/settlements");
  if (canManage) redirect("/finance/transfers");

  const [overview, settlements] = await Promise.all([
    financeRead(session, (tx) => settlementOverview({ serializable: (work) => work(tx) }, session.id)),
    financeRead(session, (tx) => listSettlements({ serializable: (work) => work(tx) }, session.id)),
  ]);
  const branches = await prisma.branch.findMany({ select: { id: true, nameAr: true } });
  const branchName = new Map(branches.map((branch) => [branch.id.toString(), branch.nameAr]));

  return (
    <div className="fin-page">
      <Link href="/finance/mine" className="fin-back no-print">
        <AppIcon name="arrow" />
        <span>العودة إلى عهدتي</span>
      </Link>
      <div className="fin-heading">
        <div>
          <p className="fin-heading__eyebrow">
            <span className="fin-eyebrow-dot" aria-hidden="true" />
            عهدة الموظف
          </p>
          <h1>طلبات التسوية</h1>
          <p>الإجمالي المتوقع بيدك = العهدة + المبيعات − المصروفات. طلب التسوية لا يغيّر شيئًا حتى يعتمده المدير.</p>
        </div>
        <div className="fin-actions">
          <PrintPageButton
            label="طباعة محضر التسوية"
            className="fin-button fin-button--secondary"
            title="طباعة محضر وطلبات التسوية النقدية"
          />
        </div>
      </div>

      {!overview.account ? (
        <div className="fin-panel fin-empty fin-empty-state">
          <span className="fin-empty-state__icon" aria-hidden="true">
            <AppIcon name="cash" />
          </span>
          <h2>لا توجد عهدة مفتوحة باسمك بعد</h2>
          <p>تُفتح العهدة بجرد فعلي يسجّله المدير أو المحاسب.</p>
        </div>
      ) : (
        <>
          <div className="fin-panel">
            <div className="fin-panel__heading">
              <h2>الإجمالي المتوقع</h2>
              <p>محسوب منذ آخر تسوية مؤكدة{overview.since ? ` في ${overview.since.slice(0, 10)}` : " (منذ فتح العهدة)"}.</p>
            </div>
            <div className="fin-panel__body">
              <div className="fin-fields">
                <div className="field fin-field fin-metric-tile">
                  <span className="fin-field__label">رصيد العهدة (النظامي)</span>
                  <span className="fin-field__hint">{formatMoney(overview.account.balance)} ج.م</span>
                </div>
                <div className="field fin-field fin-metric-tile">
                  <span className="fin-field__label">الفرع</span>
                  <span className="fin-field__hint">{branchName.get(overview.account.branchId) ?? "—"}</span>
                </div>
                <div className="field fin-field fin-metric-tile">
                  <span className="fin-field__label">مبيعات الفترة (نقدًا)</span>
                  <span className="fin-field__hint">{formatMoney(overview.sales)} ج.م</span>
                </div>
                <div className="field fin-field fin-metric-tile">
                  <span className="fin-field__label">مصروفات الفترة (من نقدك)</span>
                  <span className="fin-field__hint">{formatMoney(overview.expenses)} ج.م</span>
                </div>
                <div className="field fin-field fin-field--wide fin-metric-tile is-highlight">
                  <span className="fin-field__label">الإجمالي المتوقع بيدك</span>
                  <span className="fin-field__hint">{formatMoney(overview.expected)} ج.م</span>
                </div>
              </div>
              {overview.openRequestId ? (
                <p className="fin-alert fin-alert--warning" style={{ marginTop: 14 }}>
                  لديك طلب تسوية مفتوح بانتظار اعتماد المدير. ألغِهِ بسبب إن أردت تقديم طلب جديد.
                </p>
              ) : (
                <div className="fin-actions" style={{ marginTop: 16 }}>
                  <Link className="fin-button" href="/finance/settlements/new">
                    <span className="fin-button__plus" aria-hidden="true">+</span>
                    <span>طلب تسوية جديدة</span>
                  </Link>
                </div>
              )}
            </div>
          </div>

          <div className="fin-panel">
            <div className="fin-panel__heading">
              <h2>سجل الطلبات</h2>
              <p>الطلب لا يغيّر النقد ولا العهدة؛ الاعتماد وحده يحرّكهما.</p>
            </div>
            <div className="fin-panel__body">
              {settlements.length === 0 ? (
                <p className="fin-empty">لا توجد طلبات بعد.</p>
              ) : (
                <div className="fin-table-wrap">
                  <table className="fin-table">
                    <thead>
                      <tr>
                        <th scope="col">التاريخ</th>
                        <th scope="col">الرصيد النظامي</th>
                        <th scope="col">المبيعات</th>
                        <th scope="col">المصروفات</th>
                        <th scope="col">المتوقَّع بيده</th>
                        <th scope="col">المعدود</th>
                        <th scope="col">العجز أو الزيادة</th>
                        <th scope="col">الحالة</th>
                        <th scope="col">إجراء</th>
                      </tr>
                    </thead>
                    <tbody>
                      {settlements.map((settlement) => (
                        <tr key={settlement.id}>
                          <td>{String(settlement.createdAt).slice(0, 10)}</td>
                          <td>{formatMoney(String(settlement.systemBalance))}</td>
                          <td>{formatMoney(String(settlement.salesTotal))}</td>
                          <td>{formatMoney(String(settlement.expensesTotal))}</td>
                          <td>{formatMoney(String(settlement.expectedAmount))}</td>
                          <td>{formatMoney(String(settlement.countedAmount))}</td>
                          <td>{formatMoney(String(settlement.deviation))}</td>
                          <td>
                            <span
                              className={`fin-badge ${
                                String(settlement.status) === "OPEN"
                                  ? "fin-badge--pending"
                                  : String(settlement.status) === "CONFIRMED"
                                    ? "fin-badge--paid"
                                    : "fin-badge--closed"
                              }`}
                            >
                              {SETTLEMENT_STATUS_LABEL[String(settlement.status)] ?? String(settlement.status)}
                            </span>
                          </td>
                          <td>
                            {settlement.status === "OPEN" ? (
                              <SettlementCancelForm settlementId={String(settlement.id)} />
                            ) : (
                              <span className="fin-field__hint">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
