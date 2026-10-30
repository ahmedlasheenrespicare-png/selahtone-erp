import { randomUUID } from "node:crypto";
import Link from "next/link";
import { listCategories } from "@/lib/finance/engine";
import { cairoDate } from "@/lib/finance/validation";
import { prisma } from "@/lib/prisma";
import { financePage, financeRead } from "../../page-context";
import ExpenseForm, { type BranchOption, type CategoryOption } from "./expense-form";

export const dynamic = "force-dynamic";

export default async function NewExpensePage() {
  const { session, canManage } = await financePage();
  if (!canManage) {
    return (
      <div className="fin-page">
        <Link href="/finance" className="fin-back">العودة إلى المالية</Link>
        <div className="fin-alert fin-alert--error">تسجيل المصروفات متاح للمدير والمحاسب فقط.</div>
      </div>
    );
  }

  const [branches, categories] = await Promise.all([
    prisma.branch.findMany({ where: { isActive: true }, orderBy: { code: "asc" }, select: { id: true, nameAr: true } }),
    financeRead(session, (tx) => listCategories({ serializable: (work) => work(tx) }, session.id)),
  ]);

  const branchOptions: BranchOption[] = branches.map((branch) => ({ id: branch.id.toString(), name: branch.nameAr }));
  const categoryOptions: CategoryOption[] = categories.map((category) => ({ id: category.id, name: category.name, active: category.active }));

  return (
    <div className="fin-page">
      <Link href="/finance/expenses" className="fin-back">العودة إلى المصروفات</Link>
      <div className="fin-heading">
        <div>
          <p className="fin-heading__eyebrow">مصروف جديد</p>
          <h1>تسجيل مصروف</h1>
          <p>التسجيل الآن لا يعتمد ولا يصرف. المبلغ الإجمالي يشمل الضريبة إن أُدخلت.</p>
        </div>
      </div>

      {!branchOptions.length ? (
        <div className="fin-panel fin-empty">لا يوجد فرع نشط؛ أضف فرعًا نشطًا قبل تسجيل مصروف.</div>
      ) : (
        <ExpenseForm requestId={randomUUID()} today={cairoDate()} branches={branchOptions} categories={categoryOptions} />
      )}
    </div>
  );
}
