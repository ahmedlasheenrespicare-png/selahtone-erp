import { PeriodSourceWarning } from "../period-source-warning";
import { PeriodEstimateNotice } from "../period-estimate-notice";
import { writeAllowedForKeys } from "@/lib/access-control";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppIcon } from "@/components/app-icon";
import { FinEmptyState } from "@/components/finance/fin-empty-state";
import { FinStepper } from "@/components/finance/fin-stepper";
import { settlementLifecycleSteps } from "@/components/finance/fin-stepper-model";
import PrintPageButton from "@/components/print-page-button";

import { prisma } from "@/lib/prisma";
import { listSettlements, settlementOverview } from "@/lib/finance/engine";
import { getAccessContext, requirePageAccess } from "@/lib/access-control-server";

import { formatMoney } from "../format";
import { financePage, financeRead } from "../page-context";
import { SETTLEMENT_STATUS_LABEL, SettlementCancelForm } from "./settlement-forms";

export const dynamic = "force-dynamic";

/**
 * شاشة الموظف: مؤشر الفترة التقديري (عهدة + تحصيلات محسوبة − مصروفات محسوبة) وطلبات التسوية الخاصة به.
 * الإدارة ترى الطلبات في شاشة التسليم والتحويل لإقرارها.
 */
export default async function SettlementsPage() {
  const { session, canManage } = await financePage();
  await requirePageAccess("/finance/settlements");
  const access = await getAccessContext();
  const canCancel = writeAllowedForKeys(access.hidden, "/finance/settlements#cancel");
  const canRequest = writeAllowedForKeys(access.hidden, "/finance/settlements/new#request");
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
          <p>مؤشر الفترة = رصيد العهدة الدفتري + التحصيلات المحسوبة − المصروفات المحسوبة. طلب التسوية لا يغيّر الرصيد حتى الاعتماد.</p>
        </div>
        <div className="fin-actions">
          <PrintPageButton
            label="طباعة محضر التسوية"
            className="fin-button fin-button--secondary"
            title="طباعة محضر وطلبات التسوية النقدية"
          />
        </div>
      </div>

      {overview.multipleCustodies ? (
        <div className="fin-alert fin-alert--warning" role="alert">توجد أكثر من عهدة مفتوحة باسمك؛ يتوقف الجرد والتسوية والإقفال للمراجعة. يمكن إلغاء الطلبات المفتوحة بسبب.</div>
      ) : !overview.account ? (
        <FinEmptyState icon="cash" title="لا توجد عهدة مفتوحة باسمك بعد">
          <p>تُفتح العهدة بجرد فعلي يسجّله المدير أو المحاسب.</p>
        </FinEmptyState>
      ) : (
          <div className="fin-panel">
            <div className="fin-panel__heading">
              <h2>مؤشر الفترة التقديري</h2>
              <p>تقدير محسوب منذ آخر تسوية مؤكدة{overview.since ? ` في ${overview.since.slice(0, 10)}` : " (منذ فتح العهدة)"}.</p>
            </div>
            <div className="fin-panel__body">
              <PeriodEstimateNotice />
              {overview.sourceRecorderMismatch && <PeriodSourceWarning />}
              {overview.holderCorrectionInPeriod && <p className="fin-alert fin-alert--warning">يوجد تصحيح مرتبط بدفع نقد موظف مسجّل عند حد الفترة أو بعده في الفرع؛ الأرقام غير مؤكدة، وتوقف الجرد والتسوية والإقفال للمراجعة.</p>}
              {overview.boundaryAmbiguous && <p className="fin-alert fin-alert--warning">يوجد تحصيل أو صرف نقدي في الفرع يساوي وقت بداية الفترة. الأرقام التالية غير مؤكدة؛ توقفت التسوية والجرد والإقفال للمراجعة.</p>}
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
                  <span className="fin-field__label">مؤشر الفترة التقديري</span>
                  <span className="fin-field__hint">{formatMoney(overview.expected)} ج.م</span>
                </div>
              </div>
              {overview.openRequestId ? (
                <p className="fin-alert fin-alert--warning" style={{ marginTop: 14 }}>
                  لديك طلب تسوية مفتوح بانتظار اعتماد المدير. ألغِهِ بسبب إن أردت تقديم طلب جديد.
                </p>
              ) : canRequest && !overview.boundaryAmbiguous && !overview.holderCorrectionInPeriod ? (
                <div className="fin-actions" style={{ marginTop: 16 }}>
                  <Link className="fin-button" href="/finance/settlements/new">
                    <span className="fin-button__plus" aria-hidden="true">+</span>
                    <span>طلب تسوية جديدة</span>
                  </Link>
                </div>
              ) : null}
            </div>
          </div>
      )}

          <div className="fin-panel">
            <div className="fin-panel__heading">
              <h2>سجل الطلبات</h2>
              <p>الطلب لا يغيّر الرصيد؛ عند الاعتماد قد يُسجّل تعديل دفتري أو تحويل غير صفري. السجل لا يثبت انتقال النقد فعليًا.</p>
            </div>
            <div className="fin-panel__body">
              {settlements.length > 0 ? (
                <FinStepper
                  className="fin-stepper--panel"
                  label={`مسار طلب التسوية #${settlements[0].id}`}
                  steps={settlementLifecycleSteps({
                    status: String(settlements[0].status),
                    transferAmount: settlements[0].transferAmount,
                    resolutionReason: settlements[0].resolutionReason,
                  })}
                />
              ) : null}
              {settlements.length === 0 ? (
                <p className="fin-empty">لا توجد طلبات بعد.</p>
              ) : (
                <div className="fin-table-wrap">
                  <table className="fin-table">
                    <caption>تسويات العهد — مؤشر الفترة مقابل المعدود والفرق عنه</caption>
                    <thead>
                      <tr>
                        <th scope="col">التاريخ</th>
                        <th scope="col">الرصيد النظامي</th>
                        <th scope="col">المبيعات</th>
                        <th scope="col">المصروفات</th>
                        <th scope="col">مؤشر الفترة</th>
                        <th scope="col">المعدود</th>
                        <th scope="col">الفرق عن المؤشر</th>
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
                            {settlement.status === "OPEN" && canCancel ? (
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
    </div>
  );
}
