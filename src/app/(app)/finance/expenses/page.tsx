import Link from "next/link";
import { listExpenses } from "@/lib/finance/engine";
import { prisma } from "@/lib/prisma";
import { financePage, financeRead } from "../page-context";
import { formatMoney } from "../format";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = { PENDING: "بانتظار الاعتماد", APPROVED: "معتمد", PAID: "مدفوع" };

export default async function ExpensesPage() {
  // الموظف يرى مصروفاته هو فقط؛ الحجب في الخادم داخل listExpenses.
  const { session, canManage } = await financePage();

  const [expenses, branches] = await Promise.all([
    financeRead(session, (tx) => listExpenses({ serializable: (work) => work(tx) }, session.id)),
    prisma.branch.findMany({ select: { id: true, nameAr: true } }),
  ]);
  const branchNames = new Map(branches.map((branch) => [branch.id.toString(), branch.nameAr]));

  return (
    <div className="fin-page">
      <Link href="/finance" className="fin-back">العودة إلى المالية</Link>
      <div className="fin-heading">
        <div>
          <p className="fin-heading__eyebrow">المصروفات</p>
          <h1>{canManage ? "سجل المصروفات" : "مصروفاتي"}</h1>
          <p>{canManage
            ? "التسجيل والاعتماد والصرف الفعلي ثلاث خطوات منفصلة. الاعتماد الذاتي جائز مع حفظ المُدخل والمعتمد."
            : "هذه المصروفات التي سجلتها أنت فقط مع حالتها أمام الإدارة. الاعتماد والصرف للمدير والمحاسب."}</p>
        </div>
        <div className="fin-actions">
          <Link className="fin-button" href="/finance/expenses/new">تسجيل مصروف</Link>
        </div>
      </div>

      {expenses.length === 0 ? (
        <div className="fin-panel fin-empty">لا توجد مصروفات مسجلة بعد.</div>
      ) : (
        <div className="fin-panel">
          <div className="fin-panel__heading">
            <h2>كل المصروفات</h2>
            <p>المبلغ الظاهر هو المبلغ الفعال بعد أي تصحيح مؤكد.</p>
          </div>
          <div className="fin-table-wrap">
            <table className="fin-table">
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>الفرع</th>
                  <th>البند</th>
                  <th>الوصف</th>
                  <th>المبلغ</th>
                  <th>الحالة</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {expenses.map((expense) => (
                  <tr key={expense.id}>
                    <td>{expense.expenseDate}</td>
                    <td>{branchNames.get(expense.branchId) ?? "الفرع"}</td>
                    <td>{expense.categorySnapshot}</td>
                    <td>{expense.description}</td>
                    <td>{formatMoney(expense.amount)}</td>
                    <td>{STATUS_LABEL[expense.status] ?? expense.status}</td>
                    <td><Link className="fin-button fin-button--text" href={`/finance/expenses/${expense.id}`}>تفاصيل</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
