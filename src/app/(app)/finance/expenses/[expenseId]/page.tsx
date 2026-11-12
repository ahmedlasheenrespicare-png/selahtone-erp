import { writeAllowedForKeys } from "@/lib/access-control";
import { getAccessContext, requirePageAccess } from "@/lib/access-control-server";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppIcon } from "@/components/app-icon";
import PrintPageButton from "@/components/print-page-button";
import { expenseReviewSnapshot } from "@/lib/finance/expense-review-snapshot";
import { listAccounts, listExpenses } from "@/lib/finance/engine";
import { cairoDate } from "@/lib/finance/validation";
import { positiveDatabaseId } from "@/lib/inventory-validation";
import { prisma } from "@/lib/prisma";
import { formatMoney } from "../../format";
import { financePage, financeRead } from "../../page-context";
import { ApproveForm, PayForm, ReviewForm, CloseReviewForm, type AccountOption } from "./expense-actions";
import { paymentAccountLabel, paymentSourceLabel } from "./payment-presentation";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ expenseId: string }> };
const STATUS_LABEL: Record<string, string> = { PENDING: "بانتظار الاعتماد", APPROVED: "معتمد", PAID: "مدفوع" };

export default async function ExpenseDetailPage({ params }: Props) {
  await requirePageAccess("/finance/expenses");
  const { session, canManage } = await financePage();
  const access = await getAccessContext();
  const canApprove = writeAllowedForKeys(access.hidden, "/finance/expenses#approve");
  const canPay = writeAllowedForKeys(access.hidden, "/finance/expenses#pay");
  const canReview = writeAllowedForKeys(access.hidden, "/finance/expenses#review");
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

  // Payment records describe stored evidence; historical, noncash and holder
  // payments do not all imply an immediate account movement.
  type PaymentRow = { id: string; amount: string; method: string; source: string | null;
    accountId: string | null; historical: boolean; paymentDate: string; recordedBy: string; recordedAt: string };
  const payments = await financeRead(session, (tx) => tx.query<PaymentRow>(
    `SELECT p.id::text AS id, p.amount::text AS amount, p.method::text AS method,
            p.source::text AS source, p.account_id::text AS "accountId", p.historical,
            p.payment_date::text AS "paymentDate", p.recorded_by::text AS "recordedBy",
            p.recorded_at::text AS "recordedAt"
       FROM finance.payments p WHERE p.expense_id=$1::bigint
      ORDER BY p.recorded_at DESC`, [id]));

  type Review = { id: string; expenseRevision: number; status: string; reason: string; proposedAmount: string | null; createdBy: string; createdAt: string; resolvedBy: string | null; resolvedAt: string | null; resolutionReason: string | null };
  type Correction = { id: string; reviewId: string; paymentId: string; accountId: string | null; beforeAmount: string; afterAmount: string; bookDifference: string | null; reason: string; createdBy: string; createdAt: string };
  type CorrectionMovement = { id: string; correctionId: string; kind: string; branchId: string; sourceId: string | null; destinationId: string | null; amount: string; actorId: string; createdAt: string };
  // Do not query these sensitive records when permission or the finance-wide
  // write lock is denied; hiding components alone would leak via RSC.
  const reviewData = expense.status === "PAID" && canReview
    ? await financeRead(session, async (tx) => {
      const columns = `id::text AS id,expense_revision AS "expenseRevision",status,reason,proposed_amount::text AS "proposedAmount",
        created_by::text AS "createdBy",created_at::text AS "createdAt",resolved_by::text AS "resolvedBy",
        resolved_at::text AS "resolvedAt",resolution_reason AS "resolutionReason"`;
      const open = await tx.query<Review>(`SELECT ${columns} FROM finance.expense_reviews
        WHERE expense_id=$1::bigint AND status='OPEN' ORDER BY id DESC LIMIT 21`, [id]);
      const history = await tx.query<Review>(`SELECT ${columns} FROM finance.expense_reviews
        WHERE expense_id=$1::bigint AND status<>'OPEN' ORDER BY id DESC LIMIT 21`, [id]);
      const corrections = await tx.query<Correction>(`SELECT id::text AS id,review_id::text AS "reviewId",
        payment_id::text AS "paymentId",account_id::text AS "accountId",before_amount::text AS "beforeAmount",
        after_amount::text AS "afterAmount",book_difference::text AS "bookDifference",reason,
        created_by::text AS "createdBy",created_at::text AS "createdAt" FROM finance.expense_corrections
        WHERE expense_id=$1::bigint ORDER BY id DESC LIMIT 21`, [id]);
      // List stored linked movements independently: a missing movement is not
      // a zero settlement effect, nor does a link prove that records agree.
      const movements = await tx.query<CorrectionMovement>(`SELECT m.id::text AS id,m.expense_correction_id::text AS "correctionId",
        m.kind,m.branch_id::text AS "branchId",m.source_id::text AS "sourceId",m.destination_id::text AS "destinationId",
        m.amount::text AS amount,m.actor_id::text AS "actorId",m.created_at::text AS "createdAt"
        FROM finance.movements m JOIN finance.expense_corrections c ON c.id=m.expense_correction_id
        WHERE c.expense_id=$1::bigint ORDER BY m.id DESC LIMIT 21`, [id]);
      return { open: open.rows, history: history.rows, corrections: corrections.rows, movements: movements.rows };
    })
    : { open: [], history: [], corrections: [], movements: [] };
  const openReviews = reviewData.open;

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
      <Link href="/finance/expenses" className="fin-back no-print">
        <AppIcon name="arrow" />
        <span>العودة إلى المصروفات</span>
      </Link>
      <div className="fin-heading">
        <div>
          <p className="fin-heading__eyebrow">
            <span className="fin-eyebrow-dot" aria-hidden="true" />
            مصروف رقم {expense.id}
          </p>
          <h1>{expense.description}</h1>
          <p>الحالة: {STATUS_LABEL[expense.status] ?? expense.status} · الإصدار {expense.revision}</p>
        </div>
        <div className="fin-actions">
          <PrintPageButton
            label="طباعة إذن صرف"
            className="fin-button fin-button--secondary"
            title="طباعة إذن ومستند صرف المصروف"
          />
          <span
            className={`fin-badge ${
              expense.status === "PENDING"
                ? "fin-badge--pending"
                : expense.status === "APPROVED"
                  ? "fin-badge--approved"
                  : "fin-badge--paid"
            }`}
          >
            {STATUS_LABEL[expense.status] ?? expense.status}
          </span>
        </div>
      </div>

      <ol className="fin-stepper" aria-label="دورة حياة المصروف">
        <li className="fin-stepper__step is-done">
          <span className="fin-stepper__num">1</span>
          <div className="fin-stepper__body">
            <strong>تسجيل المصروف</strong>
            <small>{userNames.get(expense.requestedBy) ?? "مُسجَّل"} · {expense.expenseDate}</small>
          </div>
        </li>
        <li
          className={`fin-stepper__step${
            expense.status === "APPROVED" || expense.status === "PAID"
              ? " is-done"
              : " is-current"
          }`}
        >
          <span className="fin-stepper__num">2</span>
          <div className="fin-stepper__body">
            <strong>اعتماد الإدارة</strong>
            <small>
              {expense.approvedBy
                ? `اعتمد بواسطة ${userNames.get(expense.approvedBy) ?? expense.approvedBy}`
                : "بانتظار الاعتماد"}
            </small>
          </div>
        </li>
        <li
          className={`fin-stepper__step${
            expense.status === "PAID"
              ? " is-done"
              : expense.status === "APPROVED"
                ? " is-current"
                : ""
          }`}
        >
          <span className="fin-stepper__num">3</span>
          <div className="fin-stepper__body">
            <strong>الصرف الفعلي</strong>
            <small>
              {expense.status === "PAID"
                ? `${payments.rows.length} سجل دفع`
                : "بانتظار تسجيل الصرف"}
            </small>
          </div>
        </li>
        <li
          className={`fin-stepper__step${
            expense.status === "PAID" && payments.rows.length > 0 ? " is-done" : ""
          }`}
        >
          <span className="fin-stepper__num">4</span>
          <div className="fin-stepper__body">
            <strong>التوثيق والمراجعة</strong>
            <small>الإصدار #{expense.revision}</small>
          </div>
        </li>
      </ol>

      <div className="fin-panel">
        <div className="fin-panel__heading">
          <h2>بيانات المصروف</h2>
          <p>المبلغ الفعال يظهر بعد أي تصحيح مؤكد؛ الأصل محفوظ دائمًا.</p>
        </div>
        <div className="fin-table-wrap" role="region" aria-label="جدول مالي قابل للتمرير" tabIndex={0}>
          <table className="fin-table">
            <caption>بيانات المصروف الموثّقة بعد أي تصحيح مؤكد</caption>
            <tbody>
              <tr><th scope="row">الفرع</th><td>{branchNames.get(expense.branchId) ?? "الفرع"}</td></tr>
              <tr><th scope="row">البند</th><td>{expense.categorySnapshot}</td></tr>
              <tr><th scope="row">المبلغ الفعال</th><td>{formatMoney(expense.amount)}</td></tr>
              {expense.amount !== expense.originalAmount ? <tr><th scope="row">المبلغ الأصلي</th><td>{formatMoney(expense.originalAmount)}</td></tr> : null}
              <tr><th scope="row">الضريبة</th><td>{expense.taxAmount === null ? "غير مُدخلة" : formatMoney(expense.taxAmount)}</td></tr>
              <tr><th scope="row">تاريخ المصروف</th><td>{expense.expenseDate}</td></tr>
              <tr><th scope="row">وقت التسجيل</th><td>{expense.createdAt}</td></tr>
              <tr><th scope="row">المستفيد</th><td>{expense.beneficiary ?? "—"}</td></tr>
              <tr><th scope="row">رقم المستند</th><td>{expense.documentNumber ?? "—"}</td></tr>
              <tr><th scope="row">المُدخل</th><td>{userNames.get(expense.requestedBy) ?? expense.requestedBy}</td></tr>
              <tr><th scope="row">المعتمد</th><td>{expense.approvedBy ? userNames.get(expense.approvedBy) ?? expense.approvedBy : "لم يُعتمد بعد"}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      {expense.status === "PENDING" && canApprove ? (
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

      {expense.status === "APPROVED" && canPay ? (
        <div className="fin-panel">
          <div className="fin-panel__heading">
            <h2>الصرف الفعلي</h2>
            <p>عند اختيار نقد الموظف لا يُخصم من الحساب فورًا؛ وتُراعى حراسات الجرد والفترة قبل التسجيل. اختيار المصدر أو إقرار الصرف لا يثبت وقوع الدفع أو شمول تسوية سابقة. الخصم المباشر من حساب يحرّك رصيده الدفتري فورًا. غير النقدي لا يحرك النقد ولا يفترض رصيدًا بنكيًا.</p>
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

      {expense.status === "PAID" && payments.rows.length > 0 ? (
        <div className="fin-panel">
          <div className="fin-panel__heading">
            <h2>بيانات الصرف</h2>
            <p>بيانات الدفع المسجّلة؛ المصدر والتاريخ لا يثبتان وحدهما وقوع الدفع أو شمول تسوية سابقة.</p>
          </div>
          <div className="fin-table-wrap" role="region" aria-label="جدول مالي قابل للتمرير" tabIndex={0}>
            <table className="fin-table">
              <caption>بيانات الصرف المسجّلة — المصدر والطريقة والمسجّل</caption>
              <thead>
                <tr><th scope="col">المبلغ</th><th scope="col">المصدر</th><th scope="col">الحساب</th><th scope="col">الطريقة</th><th scope="col">التاريخ</th><th scope="col">مسجّل الدفع</th></tr>
              </thead>
              <tbody>
                {payments.rows.map((payment) => (
                  <tr key={payment.id}>
                    <td>{formatMoney(payment.amount)}</td>
                    <td>{paymentSourceLabel(payment)}</td>
                    <td>{paymentAccountLabel(payment, accountOptions.find((option) => option.id === payment.accountId) ?? null)}</td>
                    <td>{payment.method === "CASH" ? "نقدًا" : payment.method === "CARD" ? "بطاقة"
                      : payment.method === "BANK_TRANSFER" ? "تحويل بنكي" : payment.method === "WALLET" ? "محفظة" : payment.method}</td>
                    <td>{payment.paymentDate}</td>
                    <td>{userNames.get(payment.recordedBy) ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {expense.status === "PAID" && canReview ? (
        <div className="fin-panel">
          <div className="fin-panel__heading">
            <h2>مراجعة مبلغ مدفوع</h2>
            <p>الطلب لا يغيّر المبلغ أو الرصيد ولا يُنشئ رد مال؛ يمكن لمراجع آخر إغلاقه دون تصحيح بعد فحصه. لا توجد آلية لتأكيد التصحيح هنا.</p>
            {payments.rows.some((payment) => payment.source === "HOLDER_CASH") ? (
              <p>تصحيح نقد الموظف متوقف للمراجعة اليدوية؛ لا يوجد مسار آلي معتمد لربط الفرق بالفترة أو تسويته.</p>
            ) : null}
          </div>
          <div className="fin-panel__body">
            {openReviews.length > 0 ? (
              <>
                <div className="fin-alert fin-alert--warning" role="status">يوجد طلب مراجعة مفتوح؛ لا يمكن إرسال طلب آخر حتى يُعالج. لا يثبت ذلك شمول الفرق في أي تسوية.</div>
                <div className="fin-table-wrap" role="region" aria-label="جدول مالي قابل للتمرير" tabIndex={0}>
                  <table className="fin-table">
                    <caption>طلبات المراجعة المفتوحة للمصروف</caption>
                    <thead><tr><th scope="col">الطلب</th><th scope="col">السبب</th><th scope="col">المبلغ المقترح</th><th scope="col">المسجّل</th><th scope="col">وقت التسجيل</th></tr></thead>
                    <tbody>{openReviews.slice(0, 20).map((review) => (
                      <tr key={review.id}>
                        <td>#{review.id}{review.expenseRevision !== expense.revision ? <div>تنبيه: إصدار المصروف اختلف منذ الطلب؛ راجع الوضع الحالي قبل القرار.</div> : null}</td><td>{review.reason}</td>
                        <td>{review.proposedAmount === null ? "—" : formatMoney(review.proposedAmount)}</td>
                        <td>{userNames.get(review.createdBy) ?? review.createdBy}</td><td>{review.createdAt}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
                {openReviews.slice(0, 20).map((review) => review.createdBy === session.id
                  ? <p key={review.id}>يجب أن يغلق الطلب #{review.id} مراجع مخوّل آخر غير منشئه.</p>
                  : <CloseReviewForm key={review.id} requestId={randomUUID()} reviewId={review.id} expenseId={expense.id} revision={String(expense.revision)} reviewSnapshot={expenseReviewSnapshot({ ...review, expenseId: expense.id })} />)}
                {openReviews.length > 20 ? <p>تُعرض أحدث ٢٠ مراجعة مفتوحة فقط؛ تحتاج السجلات الإضافية إلى فحص منفصل.</p> : null}
              </>
            ) : (
              <ReviewForm requestId={randomUUID()} expenseId={expense.id} revision={String(expense.revision)} />
            )}
            {reviewData.history.length > 0 ? (
              <div className="fin-table-wrap" role="region" aria-label="جدول مالي قابل للتمرير" tabIndex={0}>
                <table className="fin-table">
                  <caption>المراجعات غير المفتوحة المسجلة للمصروف</caption>
                  <thead><tr><th scope="col">الطلب</th><th scope="col">الحالة</th><th scope="col">سبب الطلب والمبلغ المقترح</th><th scope="col">التسجيل</th><th scope="col">قرار المراجعة المسجل</th></tr></thead>
                  <tbody>{reviewData.history.slice(0, 20).map((review) => (
                    <tr key={review.id}>
                      <td>#{review.id}</td><td>{review.status === "CORRECTED" ? "صُحّح" : review.status === "CLOSED" ? "أُغلق دون تصحيح" : review.status}</td>
                      <td>{review.reason} · {review.proposedAmount === null ? "بلا مبلغ مقترح" : formatMoney(review.proposedAmount)}</td>
                      <td>{userNames.get(review.createdBy) ?? review.createdBy} · {review.createdAt}</td>
                      <td>{review.resolutionReason ?? "—"} · {review.resolvedBy ? userNames.get(review.resolvedBy) ?? review.resolvedBy : "—"} · {review.resolvedAt ?? "—"}</td>
                    </tr>
                  ))}</tbody>
                </table>
                {reviewData.history.length > 20 ? <p>تُعرض أحدث ٢٠ مراجعة غير مفتوحة فقط؛ السجل هنا غير كامل.</p> : null}
              </div>
            ) : null}
            {reviewData.corrections.length > 0 ? (
              <div className="fin-table-wrap" role="region" aria-label="جدول مالي قابل للتمرير" tabIndex={0}>
                <table className="fin-table">
                  <caption>تصحيحات المبلغ المسجلة للمصروف</caption>
                  <thead><tr><th scope="col">التصحيح والمراجعة والدفع</th><th scope="col">المبلغ السابق</th><th scope="col">المبلغ المسجل بعد التصحيح</th><th scope="col">الحساب والفرق الدفتري المسجل</th><th scope="col">السبب والتسجيل</th></tr></thead>
                  <tbody>{reviewData.corrections.slice(0, 20).map((correction) => (
                    <tr key={correction.id}>
                      <td>#{correction.id} · مراجعة #{correction.reviewId} · دفع #{correction.paymentId}</td>
                      <td>{formatMoney(correction.beforeAmount)}</td><td>{formatMoney(correction.afterAmount)}</td>
                      <td>{correction.accountId ? `حساب #${correction.accountId}` : "لا حساب مسجل"} · {correction.bookDifference === null ? "لا فرق دفتري مسجل" : formatMoney(correction.bookDifference)}</td>
                      <td>{correction.reason} · {userNames.get(correction.createdBy) ?? correction.createdBy} · {correction.createdAt}</td>
                    </tr>
                  ))}</tbody>
                </table>
                {reviewData.corrections.length > 20 ? <p>تُعرض أحدث ٢٠ عملية تصحيح فقط؛ السجل هنا غير كامل.</p> : null}
                <p>المبالغ المسجّلة لا تثبت حركة نقد فعلية أو شمول فرق التصحيح في جرد أو تسوية.</p>
              </div>
            ) : null}
            {reviewData.movements.length > 0 ? (
              <div className="fin-table-wrap" role="region" aria-label="جدول مالي قابل للتمرير" tabIndex={0}>
                <table className="fin-table">
                  <caption>الحركات المسجّلة المرتبطة بتصحيحات هذا المصروف</caption>
                  <thead><tr><th scope="col">الحركة والتصحيح</th><th scope="col">النوع والفرع</th><th scope="col">المصدر والوجهة المسجلان</th><th scope="col">المبلغ</th><th scope="col">المسجّل والوقت</th></tr></thead>
                  <tbody>{reviewData.movements.slice(0, 20).map((movement) => (
                    <tr key={movement.id}>
                      <td>#{movement.id} · تصحيح #{movement.correctionId}</td>
                      <td>{movement.kind} · فرع #{movement.branchId}</td>
                      <td>{movement.sourceId ? `من حساب #${movement.sourceId}` : "بلا مصدر حساب مسجل"} · {movement.destinationId ? `إلى حساب #${movement.destinationId}` : "بلا وجهة حساب مسجلة"}</td>
                      <td>{formatMoney(movement.amount)}</td>
                      <td>{userNames.get(movement.actorId) ?? movement.actorId} · {movement.createdAt}</td>
                    </tr>
                  ))}</tbody>
                </table>
                {reviewData.movements.length > 20 ? <p>تُعرض أحدث ٢٠ حركة مرتبطة فقط؛ السجل هنا غير كامل.</p> : null}
              </div>
            ) : reviewData.corrections.length > 0 ? <p>لا توجد حركة مرتبطة مسجلة لهذه التصحيحات في النطاق المعروض؛ لا يثبت ذلك أثر الفرق على التسوية.</p> : null}
            {reviewData.corrections.length > 0 || reviewData.movements.length > 0 ? <p>الحركات المعروضة مرتبطة بتصحيحات مسجلة لهذا المصروف فقط؛ قد تتضمن السجلات روابط غير متطابقة تحتاج مراجعة. لا يثبت وجود حركة أو غيابها دفعًا ماديًا أو شمول الفرق في جرد أو تسوية.</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
