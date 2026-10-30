import { randomUUID } from "node:crypto";
import Link from "next/link";
import { listAppCategories } from "@/lib/finance/app-categories";
import { financePage, financeRead } from "../page-context";
import { CreateCategoryForm, EditCategoryForm, type CategoryOption } from "./category-forms";

export const dynamic = "force-dynamic";

/** Management of the EXISTING expense categories: add, edit, deactivate.
 * Nothing is copied or deleted, and every edit keeps a reason and an audit row. */
export default async function CategoriesPage() {
  const { session, canManage } = await financePage();
  if (!canManage) {
    return (
      <div className="fin-page">
        <Link href="/finance" className="fin-back">العودة إلى المالية</Link>
        <div className="fin-alert fin-alert--error">إدارة بنود المصروفات متاحة للمدير والمحاسب فقط.</div>
      </div>
    );
  }

  const categories = await financeRead(session, (tx) => listAppCategories({ serializable: (work) => work(tx) }, session.id));
  const options: CategoryOption[] = categories.map((category) => ({
    id: category.id,
    code: category.code,
    name: category.name,
    active: category.active,
    revision: category.revision,
    snapshot: category.snapshot,
  }));

  return (
    <div className="fin-page">
      <Link href="/finance" className="fin-back">العودة إلى المالية</Link>
      <div className="fin-heading">
        <div>
          <p className="fin-heading__eyebrow">البنود</p>
          <h1>بنود المصروفات</h1>
          <p>البنود الحالية تُستخدم كما هي. التعديل يحفظ السبب والنسخة السابقة، والإيقاف يمنع المصروفات الجديدة فقط.</p>
        </div>
      </div>

      <div className="fin-panel" style={{ marginBottom: 18 }}>
        <div className="fin-panel__heading">
          <h2>إضافة بند</h2>
          <p>الاسم فريد. الرمز يُولَّد تلقائيًا ولا يُعاد استخدامه.</p>
        </div>
        <div className="fin-panel__body">
          <CreateCategoryForm requestId={randomUUID()} />
        </div>
      </div>

      <div className="fin-panel">
        <div className="fin-panel__heading">
          <h2>كل البنود</h2>
          <p>{options.filter((category) => category.active).length} نشط من {options.length}.</p>
        </div>
        <div className="fin-table-wrap">
          <table className="fin-table">
            <thead>
              <tr>
                <th>البند</th>
                <th>الرمز</th>
                <th>الحالة</th>
                <th>الإصدار</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {options.map((category) => (
                <tr key={category.id}>
                  <td>{category.name}</td>
                  <td>{category.code}</td>
                  <td>{category.active ? "نشط" : "موقوف"}</td>
                  <td>{category.revision}</td>
                  <td>
                    <details>
                      <summary className="fin-button fin-button--text">تعديل</summary>
                      <div style={{ padding: "12px 4px" }}>
                        <EditCategoryForm requestId={randomUUID()} category={category} />
                      </div>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
