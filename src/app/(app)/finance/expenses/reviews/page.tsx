import Link from "next/link";
import { writeAllowedForKeys } from "@/lib/access-control";
import { getAccessContext, requirePageAccess } from "@/lib/access-control-server";
import { listOpenExpenseReviewQueue } from "@/lib/finance/engine";
import { positiveDatabaseId } from "@/lib/inventory-validation";
import { prisma } from "@/lib/prisma";
import { financePage, financeRead } from "../../page-context";
import { formatMoney } from "../../format";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ before?: string | string[] }> };

export default async function OpenExpenseReviewsPage({ searchParams }: Props) {
  await requirePageAccess("/finance/expenses");
  const { session, canManage } = await financePage();
  const access = await getAccessContext();
  // Gate before any review or branch query. A hidden component is not a data
  // boundary; denying write access conservatively denies this read as well.
  if (!canManage || !writeAllowedForKeys(access.hidden, "/finance/expenses#review")) {
    return <div className="fin-page"><Link href="/finance/expenses" className="fin-back">العودة إلى المصروفات</Link><div className="fin-alert fin-alert--warning">قائمة مراجعات المصروفات غير متاحة لهذا الحساب أو مقفلة بالصلاحيات.</div></div>;
  }
  const raw = (await searchParams).before;
  const before = typeof raw === "string" ? positiveDatabaseId(raw) : null;
  if (raw !== undefined && before === null) {
    return <div className="fin-page"><Link href="/finance/expenses/reviews" className="fin-back">بداية قائمة المراجعات</Link><div className="fin-alert fin-alert--warning">مؤشر الصفحة غير صالح؛ لم تُقرأ المراجعات.</div></div>;
  }
  const [queue, branches] = await Promise.all([
    financeRead(session, (tx) => listOpenExpenseReviewQueue({ serializable: (work) => work(tx) }, session.id, before)),
    prisma.branch.findMany({ select: { id: true, nameAr: true, code: true } }),
  ]);
  const branchNames = new Map(branches.map(branch => [String(branch.id), `${branch.nameAr} · ${branch.code}`]));
  return <div className="fin-page">
    <Link href="/finance/expenses" className="fin-back">العودة إلى المصروفات</Link>
    <div className="fin-heading"><div><h1>طلبات مراجعة المصروفات المفتوحة</h1><p>للمدير والمحاسب المصرّح لهما؛ تشمل القائمة جميع الفروع المتاحة للإدارة، وليست مرتبطة بمرشحات سجل المصروفات.</p></div></div>
    <div className="fin-alert fin-alert--warning">هذه طلبات للفحص فقط: المبلغ المقترح ليس تصحيحًا، ووجود نقد الموظف لا يثبت حامل النقد أو الفترة أو أثر التسوية. افتح المصروف لمراجعة الطلب؛ يمكن لمدير أو محاسب مخوّل غير منشئه إغلاقه دون تغيير بعد الفحص وبسبب إلزامي. الإغلاق لا يثبت الدفع أو التسوية ولا يرفع حراسة التصحيح، ولا يؤكد تصحيحًا.</div>
    {queue.rows.length ? <div className="fin-table-wrap" role="region" aria-label="جدول مالي قابل للتمرير" tabIndex={0}><table className="fin-table">
      <caption>طلبات المراجعة المفتوحة، أحدث معرّف أولًا</caption>
      <thead><tr><th scope="col">الطلب والمصروف</th><th scope="col">الفرع والحالة</th><th scope="col">السبب والمقترح</th><th scope="col">بيانات الدفع المسجلة</th><th scope="col">التسجيل</th></tr></thead>
      <tbody>{queue.rows.map(row => <tr key={row.id}>
        <td>طلب #{row.id} · <Link href={`/finance/expenses/${row.expenseId}`}>مصروف #{row.expenseId}</Link></td>
        <td>{branchNames.get(row.branchId) ?? `فرع #${row.branchId}`} · {row.expenseStatus === "PAID" ? "مدفوع" : `حالة مسجلة ${row.expenseStatus} — تحتاج مراجعة`}{row.expenseRevision !== row.reviewRevision ? " · إصدار الطلب لا يطابق المصروف الحالي" : ""}</td>
        <td>{row.reason} · {row.proposedAmount === null ? "بلا مبلغ مقترح" : formatMoney(row.proposedAmount)}</td>
        <td>{!row.hasPayment ? "لا يوجد دفع مسجّل — يحتاج مراجعة" : row.hasHolderCash ? "يتضمن مصدر نقد الموظف — يحتاج مراجعة" : "لا يظهر مصدر نقد الموظف في الدفعات المسجّلة"}</td>
        <td>مسجّل #{row.createdBy} · {row.createdAt}</td>
      </tr>)}</tbody>
    </table></div> : <p className="fin-alert">لا توجد طلبات مفتوحة في هذه الصفحة.</p>}
    <div className="fin-actions">
      {before ? <Link className="fin-button fin-button--secondary" href="/finance/expenses/reviews">العودة إلى أحدث الطلبات</Link> : null}
      {queue.nextBefore ? <Link className="fin-button" href={`/finance/expenses/reviews?before=${queue.nextBefore}`}>الطلبات الأقدم</Link> : null}
    </div>
    <p>تُعرض حتى ٢٥ مراجعة في الصفحة بترتيب المعرّف، وقد تتغير القائمة بين الصفحات مع العمل المتزامن. غياب سجل هنا لا يثبت اكتمال الأدلة أو عدم وجود حالة تحتاج مراجعة.</p>
  </div>;
}
