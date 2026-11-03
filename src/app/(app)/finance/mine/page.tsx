import { randomUUID } from "node:crypto";
import Link from "next/link";
import type { SessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AppIcon } from "@/components/app-icon";
import PantherSpotlightCard from "@/components/panther-spotlight-card";
import { listAccountActivity, listAccounts, listMyCountRequests } from "@/lib/finance/engine";
import { loadEmployeeCash } from "@/lib/finance/dashboard";
import { formatMoney } from "../format";
import { financePage, financeRead } from "../page-context";
import { CustodyRequestForm, HolderCountForm } from "./custody-forms";
import { requireMenuScopeAccess } from "@/lib/menu-scope-guard";

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
  await requireMenuScopeAccess("/finance/mine");
  if (canManage) redirect("/finance");

  const accounts = await financeRead(session, (tx) => listAccounts({ serializable: (work) => work(tx) }, session.id));
  const account = accounts.find((item) => item.kind === "CUSTODY" && item.holderId === session.id) ?? null;
  // الجرود التي طُلِبت مني ولم أعدّها بعد
  const countRequests = await financeRead(session, (tx) => listMyCountRequests({ serializable: (work) => work(tx) }, session.id));
  // «المتوقَّع بيدك» يُقرأ من الوحدة نفسها التي تعرضها اللوحة، لا يُحسب هنا
  // مرة أخرى: فحسابه في موضعين يعني احتمال اختلافهما، والرقم الذي يُسأل عنه
  // الموظف عند التسليم يجب أن يكون واحدًا أينما رآه.
  const cash = await loadEmployeeCash(session);

  return (
    <div className="fin-page">
      {countRequests.length > 0 ? (
        <div className="fin-form-stack">
          {countRequests.map((item) => (
            <HolderCountForm key={String(item.id)} requestId={randomUUID()} countId={String(item.id)} reason={item.reason ? String(item.reason) : null} />
          ))}
        </div>
      ) : null}

      {account === null ? <CustodyRequestForm requestId={randomUUID()} /> : null}

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
          <Link className="fin-button" href="/finance/settlements">
            <AppIcon name="cash" />
            <span>طلبات التسوية</span>
          </Link>
          <Link className="fin-button fin-button--secondary" href="/dashboard">
            <span>لوحة القيادة</span>
          </Link>
        </div>
      </div>

      {!account ? (
        <div className="fin-panel fin-empty fin-empty-state">
          <span className="fin-empty-state__icon" aria-hidden="true">
            <AppIcon name="cash" />
          </span>
          <h2>لا توجد عهدة مفتوحة باسمك بعد</h2>
          <p>تُفتح العهدة بجرد فعلي يسجّله المدير أو المحاسب.</p>
        </div>
      ) : (
        <>
          {cash?.openSettlementId ? (
            <div className={`fin-alert${cash?.settlementStale ? " fin-alert--warning" : ""}`} role="status" style={{ marginBottom: 18 }}>
              {cash?.settlementStale ? (
                <span>
                  <strong>طلب التسوية المعلق قد بطل.</strong>{" "}
                  وقعت حركة نقدية بعد تقديمه — بيع أو تحصيل أو مصروف أو رد — فلم يعد المعدود مطابقًا للنقد في يدك.
                  ألغِ الطلب بسبب وأعد الجرد بطلب جديد.
                </span>
              ) : (
                <span>
                  لديك طلب تسوية معلق بانتظار اعتماد المدير. أي حركة نقدية جديدة بعد تقديمه — بيع أو تحصيل أو مصروف أو رد —
                  تُبطل النقد المعدود، وسيحتاج الطلب إلى إلغاء بسبب وإعادة جرد بطلب جديد.
                </span>
              )}
            </div>
          ) : null}
          {cash ? (
            <>
              <div className="fin-panel" style={{ marginBottom: 18 }}>
                <div className="fin-panel__heading">
                  <h2>المتوقَّع بيدك الآن</h2>
                  <p>هذا ما يُفترض أن يكون في يدك عند التسليم.</p>
                </div>
                <div className="fin-panel__body">
                  <div className="fin-expected-voucher">
                    <p className="fin-expected">
                      <strong>{formatMoney(cash.expected)}</strong>
                      <span>ج.م</span>
                    </p>
                    <p className="fin-expected__how">
                      = رصيد عهدتك {formatMoney(cash.balance)}
                      <span aria-hidden="true"> + </span>
                      ما قبضته من العملاء {formatMoney(cash.sales)}
                      <span aria-hidden="true"> − </span>
                      ما صرفته منها {formatMoney(cash.expenses)}
                    </p>
                  </div>
                </div>
              </div>

              <PantherSpotlightCard
                title="ميزان حركة العهدة"
                subtitle="محدّث الآن · المقبوضات والمنصرفات النقدية منذ آخر تسوية"
                pill={`${cash.todaySalesCount} بيع اليوم`}
                primary={{
                  label: "ما قبضته نقدًا من العملاء",
                  value: formatMoney(cash.sales),
                  unit: "ج.م",
                  delta: `منها مبيعات اليوم نقدًا: ${formatMoney(cash.todaySales)} ج.م`,
                  tone: "positive",
                }}
                secondary={{
                  label: "ما صرفته من نقد العهدة",
                  value: formatMoney(cash.expenses),
                  unit: "ج.م",
                  delta:
                    Number(cash.expenses) > 0
                      ? `منها مصروفات اليوم: ${formatMoney(cash.todayExpenses)} ج.م · يُسوّى عند التسليم`
                      : "0 منصرفات · لم يُصرف نقد من العهدة في هذه الفترة",
                  tone: Number(cash.expenses) > 0 ? "negative" : "positive",
                }}
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
  return (
    <div className="fin-panel">
      <div className="fin-panel__heading">
        <h2>حركات العهدة</h2>
        <p>الأحدث أولًا. الحركة التي تخرج من العهدة تُعرض بعلامة سالب.</p>
      </div>
      {activity.length === 0 ? (
        <div className="fin-panel__body"><p>لا توجد حركات مسجلة على العهدة بعد.</p></div>
      ) : (
        <div className="fin-table-wrap">
          <table className="fin-table">
            <thead>
              <tr>
                <th>التاريخ والوقت</th>
                <th>النوع</th>
                <th>الاتجاه</th>
                <th>المبلغ</th>
              </tr>
            </thead>
            <tbody>
              {activity.map((movement) => (
                <tr key={movement.id}>
                  <td><bdi dir="ltr">{movement.recordedAt}</bdi></td>
                  <td>{KIND_LABELS[movement.kind] ?? movement.kind}</td>
                  <td>
                    <span className={`fin-badge ${movement.direction === "OUT" ? "fin-badge--out" : "fin-badge--in"}`}>
                      {movement.direction === "OUT" ? "خارج" : "داخل"}
                    </span>
                  </td>
                  <td>
                    <span className={`fin-money${movement.direction === "OUT" ? " fin-money--negative" : ""}`}>
                      <bdi dir="ltr">{movement.direction === "OUT" ? `-${formatMoney(movement.amount)}` : formatMoney(movement.amount)}</bdi>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
