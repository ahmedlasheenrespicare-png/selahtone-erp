import { randomUUID } from "node:crypto";
import Link from "next/link";
import { redirect } from "next/navigation";

import { settlementOverview } from "@/lib/finance/engine";
import { requireMenuScopeAccess } from "@/lib/menu-scope-guard";

import { financePage, financeRead } from "../../page-context";
import { SettlementRequestForm } from "../settlement-forms";

export const dynamic = "force-dynamic";

export default async function NewSettlementPage() {
  const { session, canManage } = await financePage();
  await requireMenuScopeAccess("/finance/settlements/new");
  if (canManage) redirect("/finance/transfers");

  const overview = await financeRead(session, (tx) => settlementOverview({ serializable: (work) => work(tx) }, session.id));

  return (
    <div className="fin-page">
      <Link href="/finance/settlements" className="fin-back">العودة إلى طلبات التسوية</Link>
      <div className="fin-heading">
        <div>
          <p className="fin-heading__eyebrow">عهدة الموظف</p>
          <h1>طلب تسوية</h1>
          <p>عدد النقد بيدك الآن وأرسل الطلب. لا يخصم الطلب شيئًا ولا يضيف؛ المدير يعتمده ويسجّل التحويل الفعلي.</p>
        </div>
      </div>

      {!overview.account ? (
        <div className="fin-panel fin-empty">
          لا توجد عهدة مفتوحة باسمك بعد. تُفتح العهدة بجرد فعلي يسجّله المدير أو المحاسب.
          <div className="fin-actions" style={{ justifyContent: "center", marginTop: 14 }}>
            <Link className="fin-button" href="/finance/mine">عهدة الموظف</Link>
          </div>
        </div>
      ) : overview.openRequestId ? (
        <div className="fin-panel fin-empty">
          لديك طلب تسوية مفتوح بانتظار الاعتماد. راجعه أو ألغِهِ بسبب من صفحة الطلبات قبل تقديم طلب جديد.
          <div className="fin-actions" style={{ justifyContent: "center", marginTop: 14 }}>
            <Link className="fin-button" href="/finance/settlements">طلباتي</Link>
          </div>
        </div>
      ) : (
        <SettlementRequestForm
          requestId={randomUUID()}
          accountId={overview.account.id}
          systemBalance={overview.account.balance}
          sales={overview.sales}
          expenses={overview.expenses}
          expected={overview.expected}
        />
      )}
    </div>
  );
}
