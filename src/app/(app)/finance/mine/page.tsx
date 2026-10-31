import Link from "next/link";
import type { SessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { listAccountActivity, listAccounts } from "@/lib/finance/engine";
import { loadEmployeeCash } from "@/lib/finance/dashboard";
import { formatMoney } from "../format";
import { financePage, financeRead } from "../page-context";
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
  // «المتوقَّع بيدك» يُقرأ من الوحدة نفسها التي تعرضها اللوحة، لا يُحسب هنا
  // مرة أخرى: فحسابه في موضعين يعني احتمال اختلافهما، والرقم الذي يُسأل عنه
  // الموظف عند التسليم يجب أن يكون واحدًا أينما رآه.
  const cash = await loadEmployeeCash(session);

  return (
    <div className="fin-page">
      <div className="fin-heading">
        <div>
          <p className="fin-heading__eyebrow">عهدة الموظف</p>
          <h1>عهدتي النقدية</h1>
          <p>ما يُتوقَّع في يدك الآن، وحركات العهدة. سجل المصروفات وتفاصيلها لا يظهر هنا.</p>
        </div>
      </div>

      {!account ? (
        <div className="fin-panel fin-empty">
          لا توجد عهدة مفتوحة باسمك بعد. تُفتح العهدة بجرد فعلي يسجّله المدير أو المحاسب.
        </div>
      ) : (
        <>
          {cash?.openSettlementId ? (
            <div className={`fin-alert${cash?.settlementStale ? " fin-alert--warning" : ""}`} role="status" style={{ marginBottom: 18 }}>
              {cash?.settlementStale ? (
                <>
                  <strong>طلب التسوية المعلق قد بطل.</strong>{" "}
                  وقعت حركة نقدية بعد تقديمه — بيع أو تحصيل أو مصروف أو رد — فلم يعد المعدود مطابقًا للنقد في يدك.
                  ألغِ الطلب بسبب وأعد الجرد بطلب جديد.
                </>
              ) : (
                <>
                  لديك طلب تسوية معلق بانتظار اعتماد المدير. أي حركة نقدية جديدة بعد تقديمه — بيع أو تحصيل أو مصروف أو رد —
                  تُبطل النقد المعدود، وسيحتاج الطلب إلى إلغاء بسبب وإعادة جرد بطلب جديد.
                </>
              )}
            </div>
          ) : null}
          {cash ? (
          <div className="fin-panel" style={{ marginBottom: 18 }}>
            <div className="fin-panel__heading">
              <h2>المتوقَّع بيدك الآن</h2>
              <p>
                هذا ما يُفترض أن يكون في يدك عند التسليم، وهو <strong>غير</strong> الرصيد الدفتري:
                فالرصيد لا يحسب مبيعات الفترة ولا ما صرفته منها، والموظف يُسأل عن هذا الرقم لا عن الرصيد.
              </p>
            </div>
            <div className="fin-panel__body">
              <div className="fin-fields">
                <div className="field fin-field">
                  <span className="fin-field__label">المتوقَّع بيدك</span>
                  <span className="fin-field__hint">{formatMoney(cash.expected)}</span>
                </div>
                <div className="field fin-field">
                  <span className="fin-field__label">الرصيد الدفتري</span>
                  <span className="fin-field__hint">{formatMoney(cash.balance)}</span>
                </div>
                <div className="field fin-field">
                  <span className="fin-field__label">+ مبيعات الفترة نقدًا</span>
                  <span className="fin-field__hint">{formatMoney(cash.sales)}</span>
                </div>
                <div className="field fin-field">
                  <span className="fin-field__label">− مصروفات الفترة من نقدك</span>
                  <span className="fin-field__hint">{formatMoney(cash.expenses)}</span>
                </div>
              </div>
            </div>
          </div>
          ) : null}

          <div className="fin-panel" style={{ marginBottom: 18 }}>
            <div className="fin-panel__heading">
              <h2>رصيد الجرد</h2>
              <p>الرصيد الدفتري = رصيد الجرد المسجَّل + الحركات اللاحقة.</p>
            </div>
            <div className="fin-panel__body">
              <div className="fin-fields">
                <div className="field fin-field">
                  <span className="fin-field__label">الرصيد الدفتري</span>
                  <span className="fin-field__hint">{formatMoney(account.balance)}</span>
                </div>
                <div className="field fin-field">
                  <span className="fin-field__label">رصيد الجرد</span>
                  <span className="fin-field__hint">{formatMoney(account.recordedOpening)}</span>
                </div>
                <div className="field fin-field">
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
                  <td>{movement.recordedAt}</td>
                  <td>{KIND_LABELS[movement.kind] ?? movement.kind}</td>
                  <td>{movement.direction === "OUT" ? "خارج" : "داخل"}</td>
                  <td>{movement.direction === "OUT" ? `-${formatMoney(movement.amount)}` : formatMoney(movement.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
