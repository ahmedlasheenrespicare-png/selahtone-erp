import { requirePageAccess, writeAccessAllowed } from "@/lib/access-control-server";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { AppIcon } from "@/components/app-icon";
import { FinKpiStrip } from "@/components/finance/fin-kpi-strip";
import { FinStepper } from "@/components/finance/fin-stepper";
import { displayMoney } from "@/lib/commerce-display";
import { listExpenses, listSelectableCategories } from "@/lib/finance/engine";
import { parsePositiveMoneyCents } from "@/lib/finance/new-expense-helpers";
import { cairoDate } from "@/lib/finance/validation";
import { prisma } from "@/lib/prisma";
import { formatMoney } from "../../format";
import { financePage, financeRead } from "../../page-context";
import ExpenseForm, {
  type BranchOption,
  type CategoryOption,
  type ExistingExpenseHint,
} from "./expense-form";
import "./new-expense.css";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  PENDING: "بانتظار الاعتماد",
  APPROVED: "معتمد",
  PAID: "مدفوع",
};

export default async function NewExpensePage({
  searchParams,
}: {
  searchParams?: Promise<{ categoryId?: string }>;
}) {
  await requirePageAccess("/finance/expenses/new");
  const { session, canManage } = await financePage();
  const canWrite = await writeAccessAllowed("/finance/expenses/new");
  const resolvedParams = searchParams ? await searchParams : undefined;
  const requestedCategoryId =
    typeof resolvedParams?.categoryId === "string"
      ? resolvedParams.categoryId.trim()
      : "";

  if (!canManage && session.role !== "CS_AGENT") {
    return (
      <div className="fin-page">
        <Link href="/finance" className="fin-back">
          العودة إلى المالية
        </Link>
        <div className="fin-alert fin-alert--error">
          تسجيل المصروفات متاح للمدير والمحاسب، ولموظف الفرع في فرعه فقط.
        </div>
      </div>
    );
  }

  if (!canManage && !session.branchId) {
    return (
      <div className="fin-page">
        <Link href="/finance" className="fin-back">
          العودة إلى المالية
        </Link>
        <div className="fin-alert fin-alert--error">
          حسابك غير منسوب إلى فرع؛ أسند فرعك من شاشة «الفروع والمستخدمون» قبل تسجيل مصروف.
        </div>
      </div>
    );
  }

  const today = cairoDate();

  const [branches, categories, recentExpenses] = await Promise.all([
    prisma.branch.findMany({
      where: {
        isActive: true,
        ...(canManage ? {} : { id: BigInt(session.branchId as string) }),
      },
      orderBy: { code: "asc" },
      select: { id: true, nameAr: true },
    }),
    financeRead(session, (tx) =>
      listSelectableCategories({ serializable: (work) => work(tx) }, session.id),
    ),
    financeRead(session, (tx) =>
      listExpenses({ serializable: (work) => work(tx) }, session.id),
    ).catch(() => []),
  ]);

  const branchNameById = new Map(
    branches.map((b) => [b.id.toString(), b.nameAr]),
  );
  const branchOptions: BranchOption[] = branches.map((branch) => ({
    id: branch.id.toString(),
    name: branch.nameAr,
  }));

  // آخر مبلغ مسجّل لكل بند لإرشاد المُدخل عند اختيار البند
  const lastAmountByCategoryId = new Map<string, string>();
  let todayCount = 0;
  let todayCents = 0n;
  let pendingCount = 0;
  let pendingCents = 0n;
  let approvedCount = 0;
  let approvedCents = 0n;

  for (const exp of recentExpenses) {
    const cents = parsePositiveMoneyCents(String(exp.amount)) ?? 0n;
    if (!lastAmountByCategoryId.has(String(exp.categoryId)) && cents > 0n) {
      lastAmountByCategoryId.set(String(exp.categoryId), displayMoney(cents));
    }
    if (String(exp.expenseDate) === today) {
      todayCount += 1;
      todayCents += cents;
    }
    if (exp.status === "PENDING") {
      pendingCount += 1;
      pendingCents += cents;
    } else if (exp.status === "APPROVED") {
      approvedCount += 1;
      approvedCents += cents;
    }
  }

  const categoryOptions: CategoryOption[] = categories.map((category) => ({
    id: category.id,
    name: category.name,
    active: category.active,
    lastAmountHint: lastAmountByCategoryId.get(category.id),
  }));
  const activeCategoriesCount = categoryOptions.filter((c) => c.active).length;

  const existingHints: ExistingExpenseHint[] = recentExpenses.slice(0, 120).map((exp) => ({
    id: String(exp.id),
    branchId: String(exp.branchId),
    categoryName: String(exp.categorySnapshot),
    expenseDate: String(exp.expenseDate),
    amount: String(exp.amount),
    description: String(exp.description),
    beneficiary: exp.beneficiary,
    documentNumber: exp.documentNumber,
  }));

  const recentFive = recentExpenses.slice(0, 5);

  return (
    <div className="fin-page">
      <Link href="/finance/expenses" className="fin-back">
        <AppIcon name="arrow" />
        <span>العودة إلى سجل المصروفات</span>
      </Link>

      <div className="fin-heading">
        <div>
          <p className="fin-heading__eyebrow">
            <span className="fin-eyebrow-dot" aria-hidden="true" />
            قيد مصروف تشغيلي جديد
          </p>
          <h1>تسجيل مصروف</h1>
          <p>
            سجّل بيانات المصروف والمستند المؤيّد بدقة؛ يُحفظ القيد بانتظار الاعتماد ولا يُصرف إلا بخطوة منفصلة.
          </p>
        </div>
        <div className="fin-actions">
          {canManage ? (
            <Link href="/finance/categories" className="fin-button fin-button--secondary">
              <AppIcon name="settings" />
              <span>بنود المصروفات</span>
            </Link>
          ) : null}
          <Link href="/finance/expenses" className="fin-button fin-button--secondary">
            <AppIcon name="expenses" />
            <span>سجل المصروفات</span>
          </Link>
        </div>
      </div>

      {/* شريط نبض المصروفات العلوي */}
      <FinKpiStrip
        label="نبض المصروفات والاعتمادات"
        className="no-print"
        items={[
          {
            icon: "calendar",
            label: canManage ? "مصروفات مسجّلة اليوم" : "مصروفاتك المسجّلة اليوم",
            value: (
              <>
                {todayCount} <small>قيد</small>
              </>
            ),
            sub: (
              <>
                بإجمالي <bdi dir="ltr">{displayMoney(todayCents)}</bdi> ج.م اليوم
              </>
            ),
            tone: "accent",
          },
          {
            icon: "expenses",
            label: "بانتظار الاعتماد",
            value: (
              <>
                {pendingCount} <small>طلب</small>
              </>
            ),
            sub: (
              <>
                بقيمة <bdi dir="ltr">{displayMoney(pendingCents)}</bdi> ج.م قيد المراجعة
              </>
            ),
            tone: pendingCount > 0 ? "alert" : "default",
          },
          {
            icon: "check",
            label: "معتمدة بانتظار الصرف",
            value: (
              <>
                {approvedCount} <small>معتمد</small>
              </>
            ),
            sub: (
              <>
                بقيمة <bdi dir="ltr">{displayMoney(approvedCents)}</bdi> ج.م جاهزة للصرف
              </>
            ),
          },
          {
            icon: "shield",
            label: "البنود المحاسبية النشطة",
            value: (
              <>
                {activeCategoriesCount} <small>بند</small>
              </>
            ),
            sub: canManage ? "متاحة لكل الفروع النشطة" : "متاحة للتسجيل في فرعك",
          },
        ]}
      />

      <FinStepper
        className="no-print fin-stepper--page"
        label="دورة الرقابة على المصروف"
        steps={[
          { key: "register", title: "قيد المصروف والمستند", description: "إدخال المبلغ والبند ورقم الفاتورة الورقية", status: "current" },
          { key: "approve", title: "مراجعة واعتماد الإدارة", description: "تدقيق المدير أو المحاسب قبل الإذن بالصرف", status: "pending" },
          { key: "pay", title: "الصرف الفعلي والتقييد", description: "خصم المبلغ من العهدة أو الخزنة وتوثيق السند", status: "pending" },
        ]}
      />

      {!canManage && (
        <div className="fin-alert fin-alert--warning">
          يُسجَّل المصروف بانتظار الاعتماد، ولا يُصرف إلا بعد اعتماد المدير أو المحاسب.
        </div>
      )}

      {!canWrite ? (
        <div className="fin-alert fin-alert--warning" role="status">تسجيل المصروف معطّل بالصلاحيات.</div>
      ) : !branchOptions.length ? (
        <div className="fin-panel fin-empty">
          لا يوجد فرع نشط؛ أضف فرعًا نشطًا قبل تسجيل مصروف.
        </div>
      ) : (
        <ExpenseForm
          requestId={randomUUID()}
          today={today}
          canManage={canManage}
          branches={branchOptions}
          categories={categoryOptions}
          existingHints={existingHints}
          initialCategoryId={requestedCategoryId}
          userScopeKey={`${session.id}-${session.branchId ?? "all"}`}
        />
      )}

      {/* آخر ٥ مصروفات مسجّلة لتفادي التكرار ومتابعة الحالة فورًا */}
      {recentFive.length > 0 ? (
        <section className="fin-page__section no-print" aria-label="آخر المصروفات المسجلة">
          <div className="fin-panel">
            <div className="fin-panel__heading">
              <h2>
                {canManage
                  ? "آخر ٥ مصروفات مسجّلة في النظام"
                  : "آخر ٥ مصروفات سجّلتها"}
              </h2>
              <p>مراجعة سريعة لآخر القيود المسجّلة وحالتها لتفادي تكرار الإدخال.</p>
            </div>
            <div className="fin-table-wrap">
              <table className="fin-table">
                <caption>آخر خمسة مصروفات مسجّلة لتفادي التكرار ومتابعة الحال</caption>
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">التاريخ</th>
                    {canManage ? <th scope="col">الفرع</th> : null}
                    <th scope="col">البند</th>
                    <th scope="col">البيان والمستفيد</th>
                    <th scope="col">المبلغ</th>
                    <th scope="col">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {recentFive.map((exp) => (
                    <tr key={exp.id}>
                      <td dir="ltr">
                        {canManage ? (
                          <Link href={`/finance/expenses/${exp.id}`}>
                            <strong>#{exp.id}</strong>
                          </Link>
                        ) : (
                          <strong>#{exp.id}</strong>
                        )}
                      </td>
                      <td dir="ltr">{exp.expenseDate}</td>
                      {canManage ? (
                        <td>{branchNameById.get(exp.branchId) ?? "الفرع"}</td>
                      ) : null}
                      <td>{exp.categorySnapshot}</td>
                      <td>
                        <strong>{exp.description}</strong>
                        {exp.beneficiary || exp.documentNumber ? (
                          <div style={{ fontSize: 11.5, color: "var(--fn-muted)" }}>
                            {exp.beneficiary ? exp.beneficiary : ""}
                            {exp.beneficiary && exp.documentNumber ? " · " : ""}
                            {exp.documentNumber ? `مستند: ${exp.documentNumber}` : ""}
                          </div>
                        ) : null}
                      </td>
                      <td dir="ltr">
                        <strong>{formatMoney(exp.amount)}</strong>
                      </td>
                      <td>
                        <span
                          className={`fin-badge ${
                            exp.status === "PENDING"
                              ? "fin-badge--pending"
                              : exp.status === "APPROVED"
                                ? "fin-badge--approved"
                                : "fin-badge--paid"
                          }`}
                        >
                          {STATUS_LABEL[exp.status] ?? exp.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
