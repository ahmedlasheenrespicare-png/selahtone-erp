import { writeAllowedForKeys } from "@/lib/access-control";
import { getAccessContext, requirePageAccess } from "@/lib/access-control-server";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppIcon } from "@/components/app-icon";
import DataTable from "@/components/data-driven/data-table";
import PrintPageButton from "@/components/print-page-button";
import { FinStepper } from "@/components/finance/fin-stepper";
import type { FinStep } from "@/components/finance/fin-stepper-model";
import { expenseReviewSnapshot } from "@/lib/finance/expense-review-snapshot";
import { listAccounts, listExpenses } from "@/lib/finance/engine";
import { cairoDate } from "@/lib/finance/validation";
import { positiveDatabaseId } from "@/lib/inventory-validation";
import { prisma } from "@/lib/prisma";
import { formatMoney } from "../../format";
import { financePage, financeRead } from "../../page-context";
import { ApproveForm, PayForm, ReviewForm, CloseReviewForm, type AccountOption } from "./expense-actions";
import { paymentAccountLabel, paymentSourceLabel } from "./payment-presentation";
import {
  expenseCorrectionColumns,
  expenseInformationColumns,
  type ExpenseInformationRow,
  expenseCorrectionMovementColumns,
  expensePaymentColumns,
  expenseReviewHistoryColumns,
  openExpenseReviewColumns,
  type ExpenseCorrectionMovementRow,
  type ExpenseCorrectionRow,
  type ExpensePaymentDetailRow,
  type ExpenseReviewHistoryRow,
  type OpenExpenseReviewRow,
} from "./expense-detail-tables-metadata";

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
  const paymentRows: ExpensePaymentDetailRow[] = payments.rows.map((payment) => ({
    id: payment.id,
    amountFormatted: formatMoney(payment.amount),
    sourceLabel: paymentSourceLabel(payment),
    accountLabel: paymentAccountLabel(payment, accountOptions.find((option) => option.id === payment.accountId) ?? null),
    methodLabel: payment.method === "CASH" ? "نقدًا" : payment.method === "CARD" ? "بطاقة" : payment.method === "BANK_TRANSFER" ? "تحويل بنكي" : payment.method === "WALLET" ? "محفظة" : payment.method,
    paymentDate: payment.paymentDate,
    recordedByLabel: userNames.get(payment.recordedBy) ?? "—",
  }));
  const openReviewRows: OpenExpenseReviewRow[] = openReviews.slice(0, 20).map((review) => ({
    id: review.id, reason: review.reason,
    proposedAmountLabel: review.proposedAmount === null ? "—" : formatMoney(review.proposedAmount),
    createdByLabel: userNames.get(review.createdBy) ?? review.createdBy,
    createdAt: review.createdAt, revisionMismatch: review.expenseRevision !== expense.revision,
  }));
  const reviewHistoryRows: ExpenseReviewHistoryRow[] = reviewData.history.slice(0, 20).map((review) => ({
    id: review.id,
    statusLabel: review.status === "CORRECTED" ? "صُحّح" : review.status === "CLOSED" ? "أُغلق دون تصحيح" : review.status,
    reasonAndAmount: `${review.reason} · ${review.proposedAmount === null ? "بلا مبلغ مقترح" : formatMoney(review.proposedAmount)}`,
    createdLabel: `${userNames.get(review.createdBy) ?? review.createdBy} · ${review.createdAt}`,
    decisionLabel: `${review.resolutionReason ?? "—"} · ${review.resolvedBy ? userNames.get(review.resolvedBy) ?? review.resolvedBy : "—"} · ${review.resolvedAt ?? "—"}`,
  }));
  const correctionRows: ExpenseCorrectionRow[] = reviewData.corrections.slice(0, 20).map((correction) => ({
    id: correction.id, reviewId: correction.reviewId, paymentId: correction.paymentId,
    beforeAmountFormatted: formatMoney(correction.beforeAmount), afterAmountFormatted: formatMoney(correction.afterAmount),
    accountAndDifferenceLabel: `${correction.accountId ? `حساب #${correction.accountId}` : "لا حساب مسجل"} · ${correction.bookDifference === null ? "لا فرق دفتري مسجل" : formatMoney(correction.bookDifference)}`,
    reasonAndCreatedLabel: `${correction.reason} · ${userNames.get(correction.createdBy) ?? correction.createdBy} · ${correction.createdAt}`,
  }));
  const movementRows: ExpenseCorrectionMovementRow[] = reviewData.movements.slice(0, 20).map((movement) => ({
    id: movement.id, correctionId: movement.correctionId, kind: movement.kind, branchId: movement.branchId,
    sourceAndDestinationLabel: `${movement.sourceId ? `من حساب #${movement.sourceId}` : "بلا مصدر حساب مسجل"} · ${movement.destinationId ? `إلى حساب #${movement.destinationId}` : "بلا وجهة حساب مسجلة"}`,
    amountFormatted: formatMoney(movement.amount),
    actorAndCreatedLabel: `${userNames.get(movement.actorId) ?? movement.actorId} · ${movement.createdAt}`,
  }));

  const expenseInformationRows: ExpenseInformationRow[] = [
    { id: "branch", label: "الفرع", value: branchNames.get(expense.branchId) ?? "الفرع" },
    { id: "category", label: "البند", value: expense.categorySnapshot },
    { id: "amount", label: "المبلغ الفعال", value: formatMoney(expense.amount) },
    ...(expense.amount !== expense.originalAmount ? [{ id: "original", label: "المبلغ الأصلي", value: formatMoney(expense.originalAmount) }] : []),
    { id: "tax", label: "الضريبة", value: expense.taxAmount === null ? "غير مُدخلة" : formatMoney(expense.taxAmount) },
    { id: "date", label: "تاريخ المصروف", value: expense.expenseDate },
    { id: "created", label: "وقت التسجيل", value: expense.createdAt },
    { id: "beneficiary", label: "المستفيد", value: expense.beneficiary ?? "—" },
    { id: "document", label: "رقم المستند", value: expense.documentNumber ?? "—" },
    { id: "requester", label: "المُدخل", value: userNames.get(expense.requestedBy) ?? expense.requestedBy },
    { id: "approver", label: "المعتمد", value: expense.approvedBy ? userNames.get(expense.approvedBy) ?? expense.approvedBy : "لم يُعتمد بعد" },
  ];

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

      <FinStepper
        className="fin-stepper--page"
        label="دورة حياة المصروف"
        steps={[
          {
            key: "register",
            title: "تسجيل المصروف",
            description: `${userNames.get(expense.requestedBy) ?? "مُسجَّل"} · ${expense.expenseDate}`,
            status: "done",
          },
          {
            key: "approve",
            title: "اعتماد الإدارة",
            description: expense.approvedBy
              ? `اعتمد بواسطة ${userNames.get(expense.approvedBy) ?? expense.approvedBy}`
              : "بانتظار الاعتماد",
            status: expense.status === "APPROVED" || expense.status === "PAID" ? "done" : "current",
          },
          {
            key: "pay",
            title: "الصرف الفعلي",
            description: expense.status === "PAID" ? `${payments.rows.length} سجل دفع` : "بانتظار تسجيل الصرف",
            status: expense.status === "PAID" ? "done" : expense.status === "APPROVED" ? "current" : "pending",
          },
          {
            key: "document",
            title: "التوثيق والمراجعة",
            description: `الإصدار #${expense.revision}`,
            status: expense.status === "PAID" && payments.rows.length > 0 ? "done" : "pending",
          },
        ] satisfies FinStep[]}
      />

      <div className="fin-panel">
        <div className="fin-panel__heading">
          <h2>بيانات المصروف</h2>
          <p>المبلغ الفعال يظهر بعد أي تصحيح مؤكد؛ الأصل محفوظ دائمًا.</p>
        </div>
        <DataTable rows={expenseInformationRows} columns={expenseInformationColumns} rowKey={(row) => row.id}
          regionLabel="جدول مالي قابل للتمرير" regionClassName="fin-table-wrap" tableClassName="fin-table"
          caption="بيانات المصروف الموثّقة بعد أي تصحيح مؤكد" showColumnHeaders={false} />
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
          <DataTable rows={paymentRows} columns={expensePaymentColumns} rowKey={(row) => row.id}
  regionLabel="جدول مالي قابل للتمرير" regionClassName="fin-table-wrap" tableClassName="fin-table"
  caption="بيانات الصرف المسجّلة — المصدر والطريقة والمسجّل" />
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
                <DataTable rows={openReviewRows} columns={openExpenseReviewColumns} rowKey={(row) => row.id}
  regionLabel="جدول مالي قابل للتمرير" regionClassName="fin-table-wrap" tableClassName="fin-table"
  caption="طلبات المراجعة المفتوحة للمصروف" />
                {openReviews.slice(0, 20).map((review) => review.createdBy === session.id
                  ? <p key={review.id}>يجب أن يغلق الطلب #{review.id} مراجع مخوّل آخر غير منشئه.</p>
                  : <CloseReviewForm key={review.id} requestId={randomUUID()} reviewId={review.id} expenseId={expense.id} revision={String(expense.revision)} reviewSnapshot={expenseReviewSnapshot({ ...review, expenseId: expense.id })} />)}
                {openReviews.length > 20 ? <p>تُعرض أحدث ٢٠ مراجعة مفتوحة فقط؛ تحتاج السجلات الإضافية إلى فحص منفصل.</p> : null}
              </>
            ) : (
              <ReviewForm requestId={randomUUID()} expenseId={expense.id} revision={String(expense.revision)} />
            )}
            {reviewData.history.length > 0 ? (
              <>
                <DataTable rows={reviewHistoryRows} columns={expenseReviewHistoryColumns} rowKey={(row) => row.id}
                  regionLabel="جدول مالي قابل للتمرير" regionClassName="fin-table-wrap" tableClassName="fin-table"
                  caption="المراجعات غير المفتوحة المسجلة للمصروف" />
                {reviewData.history.length > 20 ? <p>تُعرض أحدث ٢٠ مراجعة غير مفتوحة فقط؛ السجل هنا غير كامل.</p> : null}
              </>
            ) : null}
            {reviewData.corrections.length > 0 ? (
              <>
                <DataTable rows={correctionRows} columns={expenseCorrectionColumns} rowKey={(row) => row.id}
                  regionLabel="جدول مالي قابل للتمرير" regionClassName="fin-table-wrap" tableClassName="fin-table"
                  caption="تصحيحات المبلغ المسجلة للمصروف" />
                {reviewData.corrections.length > 20 ? <p>تُعرض أحدث ٢٠ عملية تصحيح فقط؛ السجل هنا غير كامل.</p> : null}
                <p>المبالغ المسجّلة لا تثبت حركة نقد فعلية أو شمول فرق التصحيح في جرد أو تسوية.</p>
              </>
            ) : null}
            {reviewData.movements.length > 0 ? (
              <>
                <DataTable rows={movementRows} columns={expenseCorrectionMovementColumns} rowKey={(row) => row.id}
                  regionLabel="جدول مالي قابل للتمرير" regionClassName="fin-table-wrap" tableClassName="fin-table"
                  caption="الحركات المسجّلة المرتبطة بتصحيحات هذا المصروف" />
                {reviewData.movements.length > 20 ? <p>تُعرض أحدث ٢٠ حركة مرتبطة فقط؛ السجل هنا غير كامل.</p> : null}
              </>
            ) : reviewData.corrections.length > 0 ? <p>لا توجد حركة مرتبطة مسجلة لهذه التصحيحات في النطاق المعروض؛ لا يثبت ذلك أثر الفرق على التسوية.</p> : null}
            {reviewData.corrections.length > 0 || reviewData.movements.length > 0 ? <p>الحركات المعروضة مرتبطة بتصحيحات مسجلة لهذا المصروف فقط؛ قد تتضمن السجلات روابط غير متطابقة تحتاج مراجعة. لا يثبت وجود حركة أو غيابها دفعًا ماديًا أو شمول الفرق في جرد أو تسوية.</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
