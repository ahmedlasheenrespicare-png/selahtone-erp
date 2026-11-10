import { PeriodSourceWarning } from "../period-source-warning";
import { PeriodEstimateNotice } from "../period-estimate-notice";
import { writeAllowedForKeys } from "@/lib/access-control";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import type { SessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AppIcon } from "@/components/app-icon";
import { FinEmptyState } from "@/components/finance/fin-empty-state";
import PantherSpotlightCard from "@/components/panther-spotlight-card";
import PrintPageButton from "@/components/print-page-button";
import { getMyPendingCustodyRequest, listAccountActivity, listAccounts, listMyCountRequests, settlementOverview } from "@/lib/finance/engine";
import { loadEmployeeCash } from "@/lib/finance/dashboard";
import { formatMoney } from "../format";
import { financePage, financeRead } from "../page-context";
import CustodyActivityView, { type CustodyMovementItem } from "./custody-activity-view";
import { CustodyRequestForm, HolderCountForm } from "./custody-forms";
import { getAccessContext, requirePageAccess } from "@/lib/access-control-server";

export const dynamic = "force-dynamic";

const KIND_LABELS: Record<string, string> = {
  DEBIT: "مصروف",
  EXPENSE: "مصروف",
  COLLECTION: "تحصيل",
  REFUND: "رد",
  TRANSFER: "تحويل",
  COUNT_ADJUSTMENT: "تسوية جرد",
  OPENING_CORRECTION: "تصحيح رصيد البداية",
  EXPENSE_CORRECTION: "تصحيح مصروف",
};

/** Staff view: the custody account and its movements only.
 * The engine never joins expenses here, so no description, beneficiary, tax or
 * payment detail can reach this screen, and the branch filter is applied in SQL. */
export default async function MyCustodyPage() {
  const { session, canManage } = await financePage();
  await requirePageAccess("/finance/mine");
  const access = await getAccessContext();
  const canRequestCustody = writeAllowedForKeys(access.hidden, "/finance/mine#request-custody");
  const canSubmitCount = writeAllowedForKeys(access.hidden, "/finance/mine#submit-count");
  if (canManage) redirect("/finance");

  const accounts = await financeRead(session, (tx) => listAccounts({ serializable: (work) => work(tx) }, session.id));
  const account = accounts.find((item) => item.kind === "CUSTODY" && item.holderId === session.id && !item.closedAt) ?? null;
  const closedAccount = accounts.find((item) => item.kind === "CUSTODY" && item.holderId === session.id && item.closedAt) ?? null;
  const custodyRequest = canRequestCustody
    ? await financeRead(session, tx => getMyPendingCustodyRequest({ serializable: work => work(tx) }, session.id)).catch(() => ({ available: false, pending: null }))
    : { available: false, pending: null };
  // Presentation hint only; the action locks and checks the branch again.
  const requestBranchActive = account === null && canRequestCustody && session.branchId
    ? await financeRead(session, async tx => (await tx.query<{ active: boolean }>(`SELECT is_active AS active FROM public.branches WHERE id=$1::bigint`, [session.branchId])).rows[0]?.active === true).catch(() => false)
    : false;
  // الجرود التي طُلِبت مني ولم أعدّها بعد
  const countRequests = await financeRead(session, (tx) => listMyCountRequests({ serializable: (work) => work(tx) }, session.id));
  // «المتوقَّع بيدك» يُقرأ من الوحدة نفسها التي تعرضها اللوحة، لا يُحسب هنا
  // مرة أخرى: فحسابه في موضعين يعني احتمال اختلافهما، والرقم الذي يُسأل عنه
  // الموظف عند التسليم يجب أن يكون واحدًا أينما رآه.
  const cash = await loadEmployeeCash(session);
  const period = account ? await financeRead(session, (tx) => settlementOverview({ serializable: (work) => work(tx) }, session.id, account.id)) : null;
  const cashUnavailable = Boolean(account && (!cash || cash.accountId !== account.id));
  const visibleCountRequests = account ? countRequests.filter(item => String(item.accountId) === account.id) : [];
  const periodAmbiguous = Boolean(account && (cashUnavailable || !period?.account || period.boundaryAmbiguous || period.holderCorrectionInPeriod || cash?.boundaryAmbiguous || cash?.holderCorrectionInPeriod));

  return (
    <div className="fin-page">
      {cashUnavailable && <div className="fin-alert fin-alert--warning" role="alert">تعذّر التحقق من عهدة نقدية واحدة مطابقة لفرعك؛ لا تعتمد الأرقام وراجع الإدارة قبل الجرد أو التسوية.</div>}
      {periodAmbiguous && !cashUnavailable && <div className="fin-alert fin-alert--warning" role="alert">يوجد تحصيل أو صرف نقدي في الفرع يساوي وقت بداية الفترة، أو يوجد تصحيح مرتبط بدفع نقد موظف عند حد الفترة أو بعده، أو تعذرت مراجعة الفترة. الأرقام أدناه غير مؤكدة؛ توقف الجرد والتسوية والإقفال للمراجعة.</div>}
      {canSubmitCount && !periodAmbiguous && visibleCountRequests.length > 0 ? (
        <div className="fin-form-stack">
          {visibleCountRequests.map((item) => (
            <HolderCountForm key={String(item.id)} requestId={randomUUID()} countId={String(item.id)} reason={item.reason ? String(item.reason) : null} />
          ))}
        </div>
      ) : null}

      {account === null && canRequestCustody && requestBranchActive && custodyRequest.available && !custodyRequest.pending ? <CustodyRequestForm requestId={randomUUID()} /> : null}
      {canRequestCustody && custodyRequest.available && custodyRequest.pending ? <div className="fin-alert fin-alert--warning" role="status">لديك طلب عهدة معلّق #{custodyRequest.pending.id} بمبلغ مقترح {formatMoney(custodyRequest.pending.amount)}. راجع الإدارة قبل تقديم طلب آخر{custodyRequest.pending.branchId !== session.branchId ? "؛ الطلب مسجّل في فرع آخر" : ""}.</div> : null}
      {canRequestCustody && !custodyRequest.available ? <div className="fin-alert fin-alert--warning" role="status">تعذّر التحقق من طلبات العهدة؛ لا يمكن تقديم طلب من هذه الصفحة الآن.</div> : null}
      {account === null && closedAccount ? <div className="fin-alert fin-alert--warning" role="status">عهدتك السابقة في هذا الفرع مقفلة. يمكنك تقديم طلب للمراجعة إن لم يكن لديك طلب معلّق، لكن تقديمه لا يفتح عهدة؛ القيد الحالي قد يمنع اعتماد عهدة بديلة. راجع الإدارة.</div> : null}
      {account === null && canRequestCustody && !requestBranchActive ? <div className="fin-alert fin-alert--warning" role="status">تعذّر التحقق من فرع نشط لحسابك؛ طلب عهدة جديدة متوقف. راجع الإدارة.</div> : null}

      <div className="fin-heading">
        <div>
          <p className="fin-heading__eyebrow">
            <span className="fin-eyebrow-dot" aria-hidden="true" />
            عهدة الموظف
          </p>
          <h1>عهدتي النقدية</h1>
          <p>ما يُتوقَّع في يدك الآن، وحركات العهدة. سجل المصروفات وتفاصيلها لا يظهر هنا.</p>
        </div>
        <div className="fin-actions">
          <PrintPageButton
            label="طباعة كشف العهدة"
            className="fin-button fin-button--secondary"
            title="طباعة ملخص وحركات العهدة"
          />
          <Link className="fin-button" href="/finance/settlements">
            <AppIcon name="cash" />
            <span>طلبات التسوية</span>
          </Link>
          <Link className="fin-button fin-button--secondary" href="/finance/help">
            <span>دليل الاستخدام</span>
          </Link>
          <Link className="fin-button fin-button--secondary" href="/dashboard">
            <span>لوحة القيادة</span>
          </Link>
        </div>
      </div>

      {!account ? (
        <>
          <FinEmptyState icon="cash" title="لا توجد عهدة مفتوحة باسمك بعد">
            <p>تُفتح العهدة بجرد فعلي يسجّله المدير أو المحاسب.</p>
          </FinEmptyState>
          {closedAccount ? <section className="fin-panel"><div className="fin-panel__heading"><h2>سجل العهدة المقفلة #{closedAccount.id}</h2><p>حركات تاريخية مسجلة، وليست عهدة مفتوحة أو إثباتًا للنقد الحالي.</p></div><div className="fin-panel__body"><CustodyActivity session={session} accountId={closedAccount.id} /></div></section> : null}
        </>
      ) : (
        <>
          {cash?.openSettlementId ? (
            <div className={`fin-alert${cash?.settlementStale || periodAmbiguous ? " fin-alert--warning" : ""}`} role="status" style={{ marginBottom: 18 }}>
              {periodAmbiguous ? (
                <span><strong>طلب التسوية المعلق متوقف للمراجعة.</strong> لا يمكن اعتماده الآن؛ قد يظل سبب المنع قائمًا حتى بعد إلغاء الطلب وإعادة الجرد. يمكن إلغاء الطلب بسبب، وراجِع المسؤول المخوّل.</span>
              ) : cash?.settlementStale ? (
                <span>
                  <strong>طلب التسوية المعلق متوقف عن الاعتماد احتياطًا.</strong>{" "}
                  تغيّرت مراجعة العهدة أو لا تتوفر مراجعة موثوقة للطلب، أو سُجّل مصدر نقدي في الفرع أو حركة على العهدة بعده. السجل وحده لا يثبت تغير النقد الفعلي.
                  ألغِ الطلب بسبب وراجع المسؤول قبل إعادة الجرد بطلب جديد.
                </span>
              ) : (
                <span>
                  لديك طلب تسوية معلق بانتظار اعتماد المدير. تسجيل مصدر نقدي في الفرع أو حركة على العهدة بعد الطلب، أو تغيّر مراجعة العهدة، قد يمنع الاعتماد احتياطًا؛ التسجيل وحده لا يثبت تغير النقد الفعلي. راجع المسؤول وأعد الجرد بعد إلغاء الطلب بسبب إذا لزم.
                </span>
              )}
            </div>
          ) : null}
          {cash ? (
            <>
              <div className="fin-panel" style={{ marginBottom: 18 }}>
                <div className="fin-panel__heading">
                  <h2>مؤشر الفترة التقديري</h2>
                  <p>حساب دفتري للمراجعة وليس إثباتًا لما بيدك.</p>
                </div>
                <div className="fin-panel__body">
                  <PeriodEstimateNotice />
                  {period?.sourceRecorderMismatch && <PeriodSourceWarning />}
                  <div className="fin-expected-voucher">
                    <p className="fin-expected">
                      <strong>{formatMoney(cash.expected)}</strong>
                      <span>ج.م</span>
                    </p>
                    <p className="fin-expected__how">
                      = رصيد عهدتك {formatMoney(cash.balance)}
                      <span aria-hidden="true"> + </span>
                      التحصيلات المحسوبة {formatMoney(cash.sales)}
                      <span aria-hidden="true"> − </span>
                      المصروفات المحسوبة {formatMoney(cash.expenses)}
                    </p>
                  </div>
                </div>
              </div>

              <PantherSpotlightCard
                icon="cashConversion"
                chartVariant="waterfall"
                title="ميزان حركة العهدة"
                subtitle="محدّث الآن · مؤشرات سجلات الفترة للمراجعة"
                pill={`${cash.todaySalesCount} بيع اليوم`}
                primary={{
                  label: "التحصيلات النقدية المحسوبة",
                  value: formatMoney(cash.sales),
                  unit: "ج.م",
                  delta: `منها مبيعات اليوم نقدًا: ${formatMoney(cash.todaySales)} ج.م`,
                  tone: "positive",
                }}
                secondary={{
                  label: "مصروفات نقد الموظف المحسوبة",
                  value: formatMoney(cash.expenses),
                  unit: "ج.م",
                  delta:
                    Number(cash.expenses) > 0
                      ? `منها مصروفات اليوم: ${formatMoney(cash.todayExpenses)} ج.م · حسب السجلات`
                      : "0 مصروفات محسوبة · لا يثبت عدم حدوث صرف",
                  tone: Number(cash.expenses) > 0 ? "negative" : "positive",
                }}
                series={[
                  {
                    id: "custody-equation",
                    label: "معادلة العهدة",
                    chartVariant: "waterfall",
                    points: [
                      {
                        label: "رصيد العهدة الدفتري",
                        shortLabel: "الرصيد",
                        value: Number(cash.balance),
                        formattedValue: `${formatMoney(cash.balance)} ج.م`,
                        detail: "نقطة البداية قبل مبيعات ومصروفات الفترة",
                      },
                      {
                        label: "مقبوضات مبيعات الفترة نقدًا",
                        shortLabel: "+المبيعات",
                        value: Number(cash.sales),
                        formattedValue: `+${formatMoney(cash.sales)} ج.م`,
                        detail: `الإجمالي قبل الصرف: ${formatMoney((Number(cash.balance) + Number(cash.sales)).toFixed(2))} ج.م`,
                        tone: "alt",
                      },
                      {
                        label: "منصرفات من نقد العهدة",
                        shortLabel: "−المصروفات",
                        value: Number(cash.expenses),
                        formattedValue: `−${formatMoney(cash.expenses)} ج.م`,
                        detail: "دفع مسجّل؛ لا يثبت الحيازة أو وقوع الدفع",
                        tone: "danger",
                      },
                      {
                        label: "مؤشر الفترة التقديري",
                        shortLabel: "=المتوقَّع",
                        value: Number(cash.expected),
                        formattedValue: `${formatMoney(cash.expected)} ج.م`,
                        detail: `بعد خصم المصروفات المحسوبة: −${formatMoney(cash.expenses)} ج.م`,
                      },
                    ],
                  },
                  {
                    id: "today-vs-period",
                    label: "اليوم والفترة",
                    points: [
                      {
                        label: "مبيعات اليوم نقدًا",
                        shortLabel: "بيع اليوم",
                        value: Number(cash.todaySales),
                        formattedValue: `${formatMoney(cash.todaySales)} ج.م`,
                        detail: `${cash.todaySalesCount} عملية بيع نقدي اليوم`,
                      },
                      {
                        label: "مصروفات اليوم من نقدك",
                        shortLabel: "صرف اليوم",
                        value: Number(cash.todayExpenses),
                        formattedValue: `${formatMoney(cash.todayExpenses)} ج.م`,
                        detail: "دفعات مسجّلة اليوم لا تثبت وقوع الدفع",
                      },
                      {
                        label: "إجمالي مقبوضات الفترة",
                        shortLabel: "بيع الفترة",
                        value: Number(cash.sales),
                        formattedValue: `${formatMoney(cash.sales)} ج.م`,
                        detail: "منذ آخر تسوية معتمدة للعهدة",
                      },
                      {
                        label: "إجمالي منصرفات الفترة",
                        shortLabel: "صرف الفترة",
                        value: Number(cash.expenses),
                        formattedValue: `${formatMoney(cash.expenses)} ج.م`,
                        detail: "مصروفات محسوبة منذ حد الفترة",
                      },
                    ],
                  },
                ]}
                actionHref={cash.openSettlementId ? "/finance/settlements" : "/finance/settlements/new"}
                actionLabel={
                  cash.openSettlementId ? "متابعة طلب التسوية المعلّق" : "تقديم طلب تسوية جديد"
                }
              />
            </>
          ) : null}

          <div className="fin-panel" style={{ marginBottom: 18 }}>
            <div className="fin-panel__heading">
              <h2>رصيد الجرد</h2>
              <p>ما سُجِّل آخر مرة عُدّ فيها النقد فعليًا.</p>
            </div>
            <div className="fin-panel__body">
              <div className="fin-fields">
                <div className="field fin-field fin-metric-tile is-highlight">
                  <span className="fin-field__label">رصيد الجرد</span>
                  <span className="fin-field__hint">{formatMoney(account.recordedOpening)} ج.م</span>
                </div>
                <div className="field fin-field fin-metric-tile">
                  <span className="fin-field__label">تاريخ الجرد</span>
                  <span className="fin-field__hint">{account.openingDate}</span>
                </div>
              </div>
            </div>
          </div>

          <CustodyActivity session={session} accountId={account.id} />
        </>
      )}

      <div className="fin-form-actions">
        <Link className="fin-button" href="/finance/settlements">طلبات التسوية</Link>
        <Link className="fin-button fin-button--text" href="/dashboard">العودة إلى لوحة القيادة</Link>
      </div>
    </div>
  );
}

async function CustodyActivity({ session, accountId }: { session: SessionUser; accountId: string }) {
  const activity = await financeRead(session, (tx) =>
    listAccountActivity({ serializable: (work) => work(tx) }, session.id, accountId),
  );
  const items: CustodyMovementItem[] = activity.map((movement) => ({
    id: String(movement.id),
    recordedAt: String(movement.recordedAt),
    kindLabel: KIND_LABELS[movement.kind] ?? String(movement.kind),
    direction: movement.direction === "OUT" ? "OUT" : "IN",
    formattedAmount: formatMoney(movement.amount),
  }));
  return (
    <div className="fin-panel">
      <div className="fin-panel__heading">
        <h2>حركات العهدة</h2>
        <p>الأحدث أولًا. الحركة التي تخرج من العهدة تُعرض بعلامة سالب.</p>
      </div>
      <CustodyActivityView items={items} />
    </div>
  );
}
