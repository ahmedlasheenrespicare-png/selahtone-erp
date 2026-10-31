import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { listAccounts, listExpenses } from "@/lib/finance/engine";
import { cairoDate } from "@/lib/finance/validation";
import { positiveDatabaseId } from "@/lib/inventory-validation";
import { prisma } from "@/lib/prisma";
import { formatMoney } from "../../format";
import { financePage, financeRead } from "../../page-context";
import { ApproveForm, PayForm, ReviewForm, type AccountOption } from "./expense-actions";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ expenseId: string }> };
const STATUS_LABEL: Record<string, string> = { PENDING: "بانتظار الاعتماد", APPROVED: "معتمد", PAID: "مدفوع" };

export default async function ExpenseDetailPage({ params }: Props) {
  const { session, canManage } = await financePage();
  const id = positiveDatabaseId((await params).expenseId);
  if (!id) notFound();
  if (!canManage) {
    return (
      <div className="fin-page">
        <Link href="/finance" className="fin-back">العودة إلى المالية</Link>
        <div className="fin-alert fin-alert--error">مصروفات الفروع وتفاصيلها متاحة للمدير والمحاسب فقط.</div>
      </div>
    );
  }

  const [expenses, accounts, branches, users] = await Promise.all([
    financeRead(session, (tx) => listExpenses({ serializable: (work) => work(tx) }, session.id)),
    financeRead(session, (tx) => listAccounts({ serializable: (work) => work(tx) }, session.id)),
    prisma.branch.findMany({ select: { id: true, nameAr: true } }),
    prisma.user.findMany({ select: { id: true, fullName: true } }),
  ]);
  const expense = expenses.find((item) => item.id === id);
  if (!expense) notFound();

  const branchNames = new Map(branches.map((branch) => [branch.id.toString(), branch.nameAr]));
  const userNames = new Map(users.map((user) => [user.id.toString(), user.fullName]));
  const accountOptions: AccountOption[] = accounts.map((account) => ({
    id: account.id,
    branchId: account.branchId,
    kind: account.kind,
    branchName: branchNames.get(account.branchId) ?? "الفرع",
    holderName: account.holderId ? userNames.get(account.holderId) ?? "موظف" : null,
    balance: account.balance,
    openingDate: account.openingDate,
  }));
  const today = cairoDate();

  return (
    <div className="fin-page">
      <Link href="/finance/expenses" className="fin-back">العودة إلى المصروفات</Link>
      <div className="fin-heading">
        <div>
          <p className="fin-heading__eyebrow">مصروف رقم {expense.id}</p>
          <h1>{expense.description}</h1>
          <p>الحالة: {STATUS_LABEL[expense.status] ?? expense.status} · الإصدار {expense.revision}</p>
        </div>
      </div>

      <div className="fin-panel">
        <div className="fin-panel__heading">
          <h2>بيانات المصروف</h2>
          <p>المبلغ الفعال يظهر بعد أي تصحيح مؤكد؛ الأصل محفوظ دائمًا.</p>
        </div>
        <div className="fin-table-wrap">
          <table className="fin-table">
            <tbody>
              <tr><th>الفرع</th><td>{branchNames.get(expense.branchId) ?? "الفرع"}</td></tr>
              <tr><th>البند</th><td>{expense.categorySnapshot}</td></tr>
              <tr><th>المبلغ الفعال</th><td>{formatMoney(expense.amount)}</td></tr>
              {expense.amount !== expense.originalAmount ? <tr><th>المبلغ الأصلي</th><td>{formatMoney(expense.originalAmount)}</td></tr> : null}
              <tr><th>الضريبة</th><td>{expense.taxAmount === null ? "غير مُدخلة" : formatMoney(expense.taxAmount)}</td></tr>
              <tr><th>تاريخ المصروف</th><td>{expense.expenseDate}</td></tr>
              <tr><th>وقت التسجيل</th><td>{expense.createdAt}</td></tr>
              <tr><th>المستفيد</th><td>{expense.beneficiary ?? "—"}</td></tr>
              <tr><th>رقم المستند</th><td>{expense.documentNumber ?? "—"}</td></tr>
              <tr><th>المُدخل</th><td>{userNames.get(expense.requestedBy) ?? expense.requestedBy}</td></tr>
              <tr><th>المعتمد</th><td>{expense.approvedBy ? userNames.get(expense.approvedBy) ?? expense.approvedBy : "لم يُعتمد بعد"}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      {expense.status === "PENDING" ? (
        <div className="fin-panel">
          <div className="fin-panel__heading">
            <h2>الاعتماد</h2>
            <p>الاعتماد لا يصرف المبلغ. الصرف الفعلي خطوة منفصلة تُسجَّل وحدها.</p>
          </div>
          <div className="fin-panel__body">
            <ApproveForm requestId={randomUUID()} expenseId={expense.id} revision={String(expense.revision)} />
          </div>
        </div>
      ) : null}

      {expense.status === "APPROVED" ? (
        <div className="fin-panel">
          <div className="fin-panel__heading">
            <h2>الصرف الفعلي</h2>
            <p>الأصل أن المصروف صُرف من نقد الموظف فيُسوّى في التسوية ولا يُخصم الآن. الخصم الفوري من حساب يحرك رصيده فورًا. غير النقدي لا يحرك النقد ولا يفترض رصيدًا بنكيًا.</p>
          </div>
          <div className="fin-panel__body">
            {accountOptions.length === 0 ? (
              <div className="fin-alert fin-alert--warning">
                لا يوجد حساب نقدي مفتوح بعد. افتح حسابًا بجرد فعلي قبل تسجيل صرف نقدي.
              </div>
            ) : (
              <PayForm
                requestId={randomUUID()}
                expenseId={expense.id}
                revision={String(expense.revision)}
                amount={expense.amount}
                today={today}
                accounts={accountOptions}
                branchId={expense.branchId}
              />
            )}
          </div>
        </div>
      ) : null}

      {expense.status === "PAID" ? (
        <div className="fin-panel">
          <div className="fin-panel__heading">
            <h2>مراجعة مبلغ مدفوع</h2>
            <p>المراجعة لا تغيّر الرصيد تلقائيًا ولا تُنشئ رد مال. بعد تحقق الإدارة يُؤكد تصحيح منفصل.</p>
          </div>
          <div className="fin-panel__body">
            <ReviewForm requestId={randomUUID()} expenseId={expense.id} revision={String(expense.revision)} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
