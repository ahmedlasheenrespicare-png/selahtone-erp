import { randomUUID } from "node:crypto";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { scopedFinanceDb } from "@/lib/finance-lab";
import { listExpenseAttachments, listAccountActivity, listAccounts, listCategories, listExpenses, listPaidExpenseReviews, listCashCounts, listExpenseCorrections, listOpeningCorrections, listExpenseAudit, listReconciliationCases, listReconciliationNotes } from "../../../../prototypes/finance-engine/engine";
import FinanceWorkspace, { type AccountView, type BranchView, type CategoryView, type CountView, type ExpenseView, type ReviewView, type UserView } from "./workspace";
import "../inventory/inventory.css";
import "./finance.css";
import { caseViews } from "./case-view";

export const dynamic = "force-dynamic";
const uid = () => randomUUID();
const labels: Record<string, string> = { TRANSFER: "تسليم نقد", COLLECTION: "تحصيل نقدي", REFUND: "رد نقدي", EXPENSE: "صرف مصروف", DEBIT: "خصم من العهدة", BALANCE_ADJUSTMENT: "تعديل رصيد بعد مراجعة" };

export default async function FinancePage() {
  const session = await requireSession();
  const financeDb = scopedFinanceDb(session);
  const accounts = await listAccounts(financeDb, session.id);
  if (session.role === "CS_AGENT") {
    // The core does not query the expense table for this view.
    const activities = [];
    for (const account of accounts) activities.push({ account, rows: await listAccountActivity(financeDb, session.id, account.id) });
    return <div className="inv-page lab-finance">
      <div className="inv-heading"><div><p className="inv-heading__eyebrow">نسخة تجريبية</p><h1>عهدتي النقدية</h1><p>رصيد عهدتك وحركاتها فقط.</p></div></div>
      {!activities.length && <div className="inv-panel inv-empty">لم تُفتح عهدة لك في هذه التجربة.</div>}
      {activities.map(({ account, rows }) => <section className="inv-panel" key={account.id}><div className="inv-panel__heading"><h2>عهدتي</h2><p>الرصيد الحالي <strong dir="ltr">{account.balance}</strong> ج.م · جرد البداية {account.openingDate}</p>{account.balance.startsWith("-") && <p className="lab-negative">الرصيد سالب ويحتاج مراجعة.</p>}</div>
        <div className="inv-panel__body"><h3>الحركات</h3>{rows.length ? <ul className="lab-activity">{rows.map((row) => <li key={row.id}><span>{labels[row.kind] ?? "حركة نقدية"}<small>{row.recordedAt}</small></span><strong dir="ltr">{row.direction === "OUT" ? "−" : "+"}{row.amount} ج.م</strong></li>)}</ul> : <p>لا توجد حركات بعد.</p>}</div>
      </section>)}
    </div>;
  }
  // Query functions independently enforce the manager/accountant policy.
  const categories = await listCategories(financeDb, session.id);
  const expenses = await listExpenses(financeDb, session.id);
  const attachments = await listExpenseAttachments(financeDb, session.id);
  const reviews = await listPaidExpenseReviews(financeDb, session.id);
  const counts = await listCashCounts(financeDb, session.id);
  const corrections = await listExpenseCorrections(financeDb, session.id);
  const openingCorrections = await listOpeningCorrections(financeDb, session.id);
  const cases = caseViews(await listReconciliationCases(financeDb,session.id),await listReconciliationNotes(financeDb,session.id));
  const branches = await prisma.branch.findMany({ orderBy: { id: "asc" }, select: { id: true, nameAr: true, isActive: true } });
  // Keep names of inactive users in the audit trail, but offer only active
  // employees as holders when opening a new custody account.
  const users = await prisma.user.findMany({ orderBy: { id: "asc" }, select: { id: true, branchId: true, fullName: true, status:true } });
  const branchViews: BranchView[] = branches.map((b) => ({ id: b.id.toString(), name: b.nameAr, active: b.isActive }));
  const userViews: UserView[] = users.filter(u=>u.status==="ACTIVE").map((u) => ({ id: u.id.toString(), branchId: u.branchId?.toString() ?? null, name: u.fullName }));
  const userNames = Object.fromEntries(users.map(u=>[u.id.toString(),u.fullName]));
  const accountViews: AccountView[] = [];
  for (const a of accounts) {
    const b = branchViews.find((branch) => branch.id === a.branchId);
    const label = a.kind === "VAULT" ? `خزنة ${b?.name ?? "الفرع"}` : `عهدة ${a.holderId ? userNames[a.holderId] ?? "موظف" : "موظف"} — ${b?.name ?? "الفرع"}`;
    accountViews.push({ ...a, branchActive: Boolean(b?.active), label: `${label}${b && !b.active ? " (موقوف)" : ""}`, activity: await listAccountActivity(financeDb, session.id, a.id), openingRequest: uid(), caseRequest:uid(), openingCorrections: openingCorrections.filter((c) => c.accountId === a.id).map((c) => ({ id:c.id, beforeAmount:c.beforeAmount, afterAmount:c.afterAmount, bookDifference:c.bookDifference, resolution:c.resolution, coveredCountId:c.coveredCountId, balanceBefore:c.balanceBefore, balanceAfter:c.balanceAfter, reason:c.reason, createdBy:c.createdBy, createdAt:c.createdAt })) });
  }
  const categoryViews: CategoryView[] = categories.map((c) => ({ id: c.id, name: c.name, active: c.active, revision: c.revision, editRequest: uid() }));
  const expenseViews: ExpenseView[] = [];
  for (const e of expenses) expenseViews.push({
    id: e.id, branchId: e.branchId, categoryId: e.categoryId, categorySnapshot: e.categorySnapshot, amount: e.amount, originalAmount: e.originalAmount, expenseDate: e.expenseDate,
    description: e.description, beneficiary: e.beneficiary, documentNumber: e.documentNumber, taxAmount: e.taxAmount, status: e.status, revision: e.revision,
    requestedBy: e.requestedBy, approvedBy: e.approvedBy, approvedAt: e.approvedAt, createdAt: e.createdAt,
    paymentMethod: e.paymentMethod, paymentDate: e.paymentDate, paymentAccountId: e.paymentAccountId, paymentRecordedAt: e.paymentRecordedAt,
    paymentRecordedBy: e.paymentRecordedBy, paymentHistorical: e.paymentHistorical, paymentAfterCountId: e.paymentAfterCountId, hasOpenReview: e.hasOpenReview,
    approveRequest: uid(), editRequest: uid(), payRequest: uid(), reviewRequest: uid(), attachmentRequest: uid(),
    corrections: corrections.filter((c) => c.expenseId === e.id).map((c) => ({ id: c.id, reviewId: c.reviewId, beforeAmount: c.beforeAmount, afterAmount: c.afterAmount, reason: c.reason, accountId: c.accountId, bookDifference: c.bookDifference, balanceBefore: c.balanceBefore, balanceAfter: c.balanceAfter, createdBy: c.createdBy, createdAt: c.createdAt, reviewReason: c.reviewReason, proposedAmount: c.proposedAmount, reviewCreatedBy: c.reviewCreatedBy, reviewCreatedAt: c.reviewCreatedAt })),
    attachment: (() => { const a = attachments.find((item) => item.expenseId === e.id); return a ? { filename: a.filename, size: a.size, createdBy: a.createdBy, createdAt: a.createdAt } : null; })(),
    audit: (await listExpenseAudit(financeDb, session.id, e.id)).map((a) => ({ id: String(a.id), action: String(a.action), actorId: String(a.actorId), reason: typeof a.reason === "string" ? a.reason : null, before: a.beforeData == null ? null : JSON.stringify(a.beforeData), after: a.afterData == null ? null : JSON.stringify(a.afterData), createdAt: String(a.createdAt) })),
  });
  const reviewViews: ReviewView[] = reviews.map((r) => ({ id: r.id, expenseId: r.expenseId, proposedAmount: r.proposedAmount, reason: r.reason, createdBy: r.createdBy, createdAt: r.createdAt, confirmRequest: uid(), closeRequest: uid() }));
  const countViews: CountView[] = counts.map((c) => ({ id: c.id, accountId: c.accountId, countedAmount: c.countedAmount, observedBalance: c.observedBalance, difference: c.difference, countedOn: c.countedOn, reason: c.reason, status: c.status, createdBy: c.createdBy, createdAt: c.createdAt, resolvedBy: c.resolvedBy, resolvedAt: c.resolvedAt, resolutionReason: c.resolutionReason, confirmRequest: uid(), cancelRequest: uid() }));
  return <FinanceWorkspace accounts={accountViews} branches={branchViews} users={userViews} userNames={userNames} categories={categoryViews} expenses={expenseViews} reviews={reviewViews} counts={countViews} cases={cases}
    requests={{ expense: uid(), category: uid(), transfer: uid(), open: uid(), count: uid() }} />;
}
