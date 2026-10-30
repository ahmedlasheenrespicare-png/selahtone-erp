"use client";

import { startTransition, useActionState, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { financeAction } from "./actions";
import { initialFinanceState } from "./state";
import { CaseList, OpeningCaseForm } from "./case-components";
import type { CaseView } from "./case-view";

export type BranchView = { id: string; name: string; active: boolean };
export type UserView = { id: string; branchId: string | null; name: string };
type Activity = { id: string; kind: string; amount: string; direction: string; recordedAt: string };
export type AccountView = { id: string; branchId: string; kind: "VAULT" | "CUSTODY"; holderId: string | null; label: string; branchActive: boolean; balance: string; openingDate: string; recordedOpening: string; currentOpening: string; openingRequest: string; caseRequest:string; openingCorrections: OpeningCorrectionView[]; activity: Activity[] };
export type OpeningCorrectionView = { id:string; beforeAmount:string; afterAmount:string; bookDifference:string; resolution:"BOOK"|"COUNT_COVERED"; coveredCountId:string|null; balanceBefore:string; balanceAfter:string; reason:string; createdBy:string; createdAt:string };
export type CategoryView = { id: string; name: string; active: boolean; revision: number; editRequest: string };
export type ExpenseView = {
  id: string; branchId: string; categoryId: string; categorySnapshot: string; amount: string; originalAmount: string; expenseDate: string; description: string;
  beneficiary: string | null; documentNumber: string | null; taxAmount: string | null; status: "PENDING" | "APPROVED" | "PAID"; revision: number;
  requestedBy: string; approvedBy: string | null; approvedAt: string | null; createdAt: string; paymentMethod: string | null; paymentDate: string | null;
  paymentAccountId: string | null; paymentRecordedAt: string | null; paymentRecordedBy: string | null; paymentHistorical: boolean | null; paymentAfterCountId: string | null; hasOpenReview: boolean;
  approveRequest: string; editRequest: string; payRequest: string; reviewRequest: string; attachmentRequest: string;
  corrections: Array<{ id: string; reviewId: string; beforeAmount: string; afterAmount: string; reason: string; accountId: string | null; bookDifference: string | null; balanceBefore: string | null; balanceAfter: string | null; createdBy: string; createdAt: string; reviewReason: string; proposedAmount: string | null; reviewCreatedBy: string; reviewCreatedAt: string }>;
  attachment: { filename: string; size: number; createdBy: string; createdAt: string } | null;
  audit: Array<{ id: string; action: string; actorId: string; reason: string | null; before: string | null; after: string | null; createdAt: string }>;
};
export type ReviewView = { id: string; expenseId: string; proposedAmount: string | null; reason: string; createdBy: string; createdAt: string; confirmRequest: string; closeRequest: string };
export type CountView = { id: string; accountId: string; countedAmount: string; observedBalance: string; difference: string; countedOn: string; reason: string; status: "OPEN" | "CONFIRMED" | "CANCELLED"; createdBy: string; createdAt: string; resolvedBy: string | null; resolvedAt: string | null; resolutionReason: string | null; confirmRequest: string; cancelRequest: string };
type Props = { accounts: AccountView[]; branches: BranchView[]; users: UserView[]; userNames:Record<string,string>; categories: CategoryView[]; expenses: ExpenseView[]; reviews: ReviewView[]; counts: CountView[]; cases:CaseView[]; requests: { expense: string; category: string; transfer: string; open: string; count: string } };

function ActionForm({ command, requestId, submit, children }: { command: string; requestId: string; submit: string; children?: ReactNode }) {
  const [state, action, pending] = useActionState(financeAction, initialFinanceState);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state.status === "success") { formRef.current?.reset(); router.refresh(); } }, [state, router]);
  // React automatically resets uncontrolled inputs when an action resolves,
  // even when it returns a validation error. Keep values on failure so the
  // operator can review them; clear only after confirmed success.
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => action(data));
  }
  return <form ref={formRef} action={action} onSubmit={handleSubmit}>
    <input type="hidden" name="command" value={command} /><input type="hidden" name="requestId" value={requestId} />
    {children}
    {state.status !== "idle" && <div className={`lab-alert ${state.status}`} role={state.status === "error" ? "alert" : "status"}>{state.message}</div>}
    <div className="lab-actions"><button className="inv-button" type="submit" disabled={pending}>{pending ? "جارٍ الحفظ…" : submit}</button></div>
  </form>;
}
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="inv-field"><span>{label}</span>{children}</label>; }
function Check({ name, children }: { name: string; children: ReactNode }) { return <label className="lab-check"><input type="checkbox" name={name} value="yes" /> <span>{children}</span></label>; }
const statusLabel = { PENDING: "بانتظار الاعتماد", APPROVED: "معتمد — لم يُصرف", PAID: "مدفوع" };
const methods: Record<string, string> = { CASH: "نقدي", CARD: "بطاقة", BANK_TRANSFER: "تحويل بنكي", WALLET: "محفظة" };
const movements: Record<string, string> = { TRANSFER: "تسليم نقد", COLLECTION: "تحصيل نقدي", REFUND: "رد نقدي", EXPENSE: "صرف مصروف", COUNT_ADJUSTMENT: "تسوية فرق جرد", EXPENSE_CORRECTION: "تصحيح دفتري لمصروف", OPENING_CORRECTION: "تصحيح دفتري لرصيد البداية" };
function today() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts();
  return `${parts.find((p) => p.type === "year")?.value}-${parts.find((p) => p.type === "month")?.value}-${parts.find((p) => p.type === "day")?.value}`;
}
function cents(v: string): bigint | null {
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(v)) return null;
  const negative = v.startsWith("-"); const [whole, dec = ""] = (negative ? v.slice(1) : v).split(".");
  const n = BigInt(whole) * 100n + BigInt((dec + "00").slice(0, 2)); return negative ? -n : n;
}
function format(n: bigint) { const sign = n < 0n ? "−" : ""; const v = n < 0n ? -n : n; return `${sign}${v / 100n}.${String(v % 100n).padStart(2, "0")}`; }
function Projection({ balance, amount, acknowledged, onAcknowledge }: { balance: string; amount: string; acknowledged: boolean; onAcknowledge: (v: boolean) => void }) {
  const a = cents(amount), b = cents(balance); if (a === null || b === null) return null;
  const projected = b - a;
  return <div className={projected < 0n ? "lab-negative" : "lab-hint"}>الرصيد المتوقع بعد العملية: <bdi dir="ltr">{format(projected)}</bdi> ج.م{projected < 0n && <label className="lab-check"><input type="checkbox" name="negativeAcknowledged" value="yes" checked={acknowledged} onChange={(e) => onAcknowledge(e.target.checked)} /><span>أقر بأن الرصيد سيصبح سالبًا ويحتاج مراجعة.</span></label>}</div>;
}
function ExpenseFields({ branches, categories, expense }: { branches: BranchView[]; categories: CategoryView[]; expense?: ExpenseView }) {
  return <div className="lab-fields">
    <Field label="الفرع *"><select name="branchId" defaultValue={expense?.branchId ?? ""} required><option value="">اختر الفرع</option>{branches.filter((b) => b.active || b.id === expense?.branchId).map((b) => <option value={b.id} key={b.id} disabled={!b.active}>{b.name}{!b.active ? " (موقوف)" : ""}</option>)}</select></Field>
    <Field label="البند *"><select name="categoryId" defaultValue={expense?.categoryId ?? ""} required><option value="">اختر البند</option>{categories.filter((c) => c.active || c.id === expense?.categoryId).map((c) => <option key={c.id} value={c.id} disabled={!c.active}>{c.name}{!c.active ? " (موقوف)" : ""}</option>)}</select></Field>
    <Field label="المبلغ الإجمالي *"><input name="amount" defaultValue={expense?.amount ?? ""} dir="ltr" inputMode="decimal" required /></Field>
    <Field label="تاريخ المصروف *"><input name="expenseDate" type="date" defaultValue={expense?.expenseDate ?? today()} required /></Field>
    <Field label="الوصف *"><input name="description" defaultValue={expense?.description ?? ""} maxLength={180} required /></Field>
    <Field label="المستفيد (اختياري)"><input name="beneficiary" defaultValue={expense?.beneficiary ?? ""} maxLength={120} /></Field>
    <Field label="رقم المستند (اختياري)"><input name="documentNumber" defaultValue={expense?.documentNumber ?? ""} maxLength={120} /></Field>
    <Field label="الضريبة من المستند (اختياري)"><input name="taxAmount" defaultValue={expense?.taxAmount ?? ""} dir="ltr" inputMode="decimal" /></Field>
    {expense && <Field label="سبب التصحيح *"><input name="reason" maxLength={300} required /></Field>}
  </div>;
}
function OpeningCorrection({ account, counts, pendingCase }: { account: AccountView; counts: CountView[]; pendingCase:CaseView|null }) {
  const [amount, setAmount] = useState(""); const [negative, setNegative] = useState(false); const [caseReviewed,setCaseReviewed]=useState(false);
  const latest = counts.filter((c) => c.accountId === account.id && c.status === "CONFIRMED").sort((a,b) => BigInt(a.id) < BigInt(b.id) ? 1 : -1)[0];
  const before = cents(account.currentOpening), current = cents(account.balance), entered = cents(amount);
  const projected = !latest && before !== null && current !== null && entered !== null ? current + entered - before : null;
  return <ActionForm command="correctOpeningBalance" requestId={account.openingRequest} submit="تأكيد تصحيح رصيد البداية">
    <input type="hidden" name="accountId" value={account.id} /><input type="hidden" name="expectedOpening" value={account.currentOpening} /><input type="hidden" name="expectedBalance" value={account.balance} />
    {latest && <input type="hidden" name="coveredCountId" value={latest.id} />}
    <div className="lab-fields"><Field label="رصيد البداية الصحيح بعد التحقق *"><input name="correctedOpening" inputMode="decimal" dir="ltr" value={amount} onChange={(e) => { setAmount(e.target.value); setNegative(false); setCaseReviewed(false); }} required /></Field>
    <Field label="السبب ومرجع المراجعة *"><input name="reason" maxLength={300} onChange={()=>setCaseReviewed(false)} required /></Field></div>
    {pendingCase && <><input type="hidden" name="pendingCaseId" value={pendingCase.id}/><input type="hidden" name="expectedCaseRevision" value={pendingCase.revision}/><p className="lab-hint">الحالة المعلقة #{pendingCase.id}: {pendingCase.reason} · الرصيد المحتمل عند الإبلاغ: {pendingCase.proposedAmount ?? "غير محدد"}. راجع ملاحظاتها؛ الرقم المحتمل غير مؤكد.</p><label className="lab-check"><input type="checkbox" name="caseReviewed" value="yes" checked={caseReviewed} onChange={e=>setCaseReviewed(e.target.checked)}/><span>راجعت الحالة المعلقة وملاحظاتها وربطت هذا التصحيح بها.</span></label></>}
    <p className="lab-hint">البداية المسجلة الأصلية: <bdi dir="ltr">{account.recordedOpening}</bdi> · البداية الحالية بعد المراجعات: <bdi dir="ltr">{account.currentOpening}</bdi> · الرصيد الحالي: <bdi dir="ltr">{account.balance}</bdi> ج.م. يُحفظ الأصل ولا يُعاد حساب التاريخ.</p>
    <Check name="verifiedOpening">تحققت من رصيد البداية الفعلي ومن سبب خطأ الإدخال.</Check>
    {latest ? <><p className="lab-negative">يوجد جرد مؤكد #{latest.id} بتاريخ {latest.countedOn}. يمكن توثيق الخطأ دون حركة جديدة فقط إذا تحققت أن هذا الجرد عالج الفرق. إن لم تتأكد فاحفظ حالة معلقة بدلًا من تأكيد التصحيح.</p>
      <Check name="countCovered">أؤكد بعد المراجعة أن الجرد المحدد عالج فرق الافتتاح بالكامل، ولن يُضاف فرق نقدي جديد.</Check></> : <><p className="lab-hint">لا يوجد جرد لاحق مؤكد لهذا الحساب. فرق البداية سيُسجل دفتريًا مرة واحدة؛ ليس استلامًا أو تسليمًا نقديًا.</p>
      <Check name="noPriorSettlement">تحققت أن فرق البداية لم يُسوَّ سابقًا بأي طريقة.</Check>
      {projected !== null && <p className={projected < 0n ? "lab-negative" : "lab-hint"}>الرصيد المتوقع بعد التصحيح: <bdi dir="ltr">{format(projected)}</bdi> ج.م.</p>}
      {projected !== null && projected < 0n && <label className="lab-check"><input type="checkbox" name="negativeAcknowledged" value="yes" checked={negative} onChange={(e) => setNegative(e.target.checked)} /><span>أقر بمراجعة الرصيد السالب.</span></label>}</>}
  </ActionForm>;
}
function Transfer({ accounts, requestId }: { accounts: AccountView[]; requestId: string }) {
  const [fromId, setFrom] = useState(""); const [toId, setTo] = useState(""); const [amount, setAmount] = useState(""); const [negative, setNegative] = useState(false);
  const source = accounts.find((a) => a.id === fromId); const destinations = accounts.filter((a) => source && a.branchActive && a.branchId === source.branchId && a.kind !== source.kind);
  return <ActionForm command="transferCash" requestId={requestId} submit="تسجيل التسليم الفعلي">
    <div className="lab-fields"><Field label="من حساب *"><select name="fromId" value={fromId} onChange={(e) => { setFrom(e.target.value); setTo(""); setNegative(false); }} required><option value="">اختر المصدر</option>{accounts.filter((a) => a.branchActive).map((a) => <option value={a.id} key={a.id}>{a.label} · {a.balance}</option>)}</select></Field>
    <Field label="إلى حساب في الفرع نفسه *"><select name="toId" value={toId} onChange={(e) => { setTo(e.target.value); setNegative(false); }} required><option value="">اختر المستلم</option>{destinations.map((a) => <option value={a.id} key={a.id}>{a.label}</option>)}</select></Field>
    <Field label="المبلغ *"><input name="amount" dir="ltr" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setNegative(false); }} required /></Field></div>
    <input type="hidden" name="expectedBalance" value={source?.balance ?? ""} />
    {source && <p className="lab-hint">الرصيد المعروض: <bdi dir="ltr">{source.balance}</bdi> ج.م. إن تغيّر، أعد المراجعة.</p>}
    {source && <Projection balance={source.balance} amount={amount} acknowledged={negative} onAcknowledge={setNegative} />}
    <Check name="actuallyTransferred">أؤكد تسليم النقد فعليًا بين الخزنة والعهدة.</Check>
  </ActionForm>;
}
function Payment({ expense, accounts, counts }: { expense: ExpenseView; accounts: AccountView[]; counts: CountView[] }) {
  const [method, setMethod] = useState("CASH"); const [accountId, setAccount] = useState(""); const [paymentDate, setDate] = useState(today()); const [order, setOrder] = useState(""); const [negative, setNegative] = useState(false); const [afterCount, setAfterCount] = useState(false);
  const choices = accounts.filter((a) => a.branchId === expense.branchId); const account = choices.find((a) => a.id === accountId);
  const sameDay = Boolean(account && paymentDate === account.openingDate);
  const historical = Boolean(account && (paymentDate < account.openingDate || (sameDay && order === "BEFORE")));
  const latest = counts.filter((c) => c.accountId === accountId && c.status === "CONFIRMED" && c.countedOn >= paymentDate)
    .sort((a,b) => b.countedOn.localeCompare(a.countedOn) || (BigInt(a.id) < BigInt(b.id) ? 1 : -1))[0];
  return <ActionForm command="payExpense" requestId={expense.payRequest} submit="تسجيل الدفع الفعلي">
    <input type="hidden" name="expenseId" value={expense.id} /><input type="hidden" name="expectedRevision" value={expense.revision} />
    <div className="lab-fields"><Field label="الوسيلة *"><select name="method" value={method} onChange={(e) => { setMethod(e.target.value); setAccount(""); setOrder(""); setNegative(false); setAfterCount(false); }}>{Object.entries(methods).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></Field>
    <Field label="تاريخ الدفع الفعلي *"><input name="paymentDate" type="date" value={paymentDate} onChange={(e) => { setDate(e.target.value); setOrder(""); setNegative(false); setAfterCount(false); }} required /></Field>
    {method === "CASH" && <Field label="مصدر النقد في فرع المصروف *"><select name="accountId" value={accountId} onChange={(e) => { setAccount(e.target.value); setOrder(""); setNegative(false); setAfterCount(false); }} required><option value="">اختر الحساب</option>{choices.map((a) => <option value={a.id} key={a.id}>{a.label} · {a.balance}</option>)}</select></Field>}
    {method === "CASH" && sameDay && <Field label="ترتيب الدفع والجرد *"><select name="openingOrder" value={order} onChange={(e) => { setOrder(e.target.value); setNegative(false); setAfterCount(false); }} required><option value="">حدد الترتيب</option><option value="BEFORE">قبل الجرد</option><option value="AFTER">بعد الجرد</option></select></Field>}</div>
    {method === "CASH" && account && !historical && <>
      {latest && latest.countedOn > paymentDate && <p className="lab-negative">يوجد جرد مؤكد بعد يوم الدفع؛ قد يكون الدفع انعكس فيه. أوقف العملية للفحص اليدوي.</p>}
      {latest && latest.countedOn === paymentDate && <><p className="lab-hint">آخر جرد مؤكد اليوم هو #{latest.id}، سُجل {latest.createdAt} وأُكد {latest.resolvedAt}. إذا سبق الدفع هذا الجرد أو لم تتأكد من الترتيب فأوقف العملية للمراجعة.</p><input type="hidden" name="afterCountId" value={latest.id} /><label className="lab-check"><input type="checkbox" name="afterCount" value="yes" checked={afterCount} onChange={(e) => setAfterCount(e.target.checked)} /><span>تحققت أن الدفع الفعلي حدث بعد هذا الجرد المؤكد، لا قبله.</span></label></>}
      <input type="hidden" name="expectedBalance" value={account.balance} /><p className="lab-hint">الرصيد الحالي المعروض: {account.balance} ج.م.</p><Projection balance={account.balance} amount={expense.amount} acknowledged={negative} onAcknowledge={setNegative} /></>}
    {method === "CASH" && historical && <><p className="lab-hint">دفع سابق للجرد؛ لن يُخصم مرة أخرى.</p><Check name="includedInOpening">أؤكد أنه سبق الجرد واحتُسب ضمن رصيد البداية.</Check></>}
    <Check name="actuallyPaid">أؤكد أن المصروف دُفع فعليًا بهذه الوسيلة.</Check>
    {method !== "CASH" && <p className="lab-hint">هذه الوسيلة لا تحرك النقد، ولا يفترض النظام رصيدًا بنكيًا.</p>}
  </ActionForm>;
}
function CashCount({ accounts, requestId }: { accounts: AccountView[]; requestId: string }) {
  const [accountId, setAccount] = useState(""); const [counted, setCounted] = useState("");
  const account = accounts.find((a) => a.id === accountId && a.branchActive);
  const actual = cents(counted), system = account ? cents(account.balance) : null;
  const difference = actual === null || system === null ? null : actual - system;
  return <ActionForm command="requestCashCount" requestId={requestId} submit="تسجيل الجرد للمراجعة فقط">
    <div className="lab-fields"><Field label="الحساب *"><select name="accountId" value={accountId} onChange={(e) => setAccount(e.target.value)} required><option value="">اختر الحساب</option>{accounts.filter((a) => a.branchActive).map((a) => <option value={a.id} key={a.id}>{a.label} · {a.balance}</option>)}</select></Field>
    <Field label="النقد المعدود فعليًا *"><input name="countedAmount" value={counted} onChange={(e) => setCounted(e.target.value)} dir="ltr" inputMode="decimal" required /></Field>
    <Field label="سبب الجرد *"><input name="reason" required maxLength={300} /></Field></div>
    <input type="hidden" name="expectedBalance" value={account?.balance ?? ""} />
    {account && <p className="lab-hint">رصيد النظام قبل الجرد: <bdi dir="ltr">{account.balance}</bdi> ج.م{difference !== null && <> · الفرق (المعدود − النظام): <bdi dir="ltr">{format(difference)}</bdi> ج.م</>}</p>}
    <p className="lab-hint">الخطوة الأولى تحفظ نتيجة الجرد فقط، ولا تغير الرصيد. يسجل التاريخ الحالي ووقت الإدخال منفصلًا.</p>
    <Check name="actuallyCounted">أؤكد أنني جردت النقد الفعلي الآن لهذا الحساب.</Check>
  </ActionForm>;
}
function PaidCorrection({ review, expense, accounts }: { review: ReviewView; expense: ExpenseView; accounts: AccountView[] }) {
  const [value, setValue] = useState(review.proposedAmount ?? expense.amount); const [negative, setNegative] = useState(false);
  const adjustsCash = expense.paymentMethod === "CASH" && !expense.paymentHistorical;
  const account = adjustsCash ? accounts.find((a) => a.id === expense.paymentAccountId) : undefined;
  const before = cents(expense.amount), after = cents(value), current = account ? cents(account.balance) : null;
  const difference = before !== null && after !== null ? before - after : null;
  const projected = current !== null && difference !== null ? current + difference : null;
  return <ActionForm command="confirmPaidExpenseCorrection" requestId={review.confirmRequest} submit="تأكيد التصحيح بعد المراجعة">
    <input type="hidden" name="reviewId" value={review.id} />
    {adjustsCash && account && <input type="hidden" name="expectedBalance" value={account.balance} />}
    <div className="lab-fields"><Field label="المبلغ الفعلي المؤكد *"><input name="confirmedAmount" value={value} onChange={(e) => { setValue(e.target.value); setNegative(false); }} dir="ltr" inputMode="decimal" required /></Field>
    <Field label="سبب تأكيد التصحيح *"><input name="reason" required maxLength={300} /></Field></div>
    <p className="lab-hint">المبلغ الحالي: <bdi dir="ltr">{expense.amount}</bdi> ج.م · المبلغ الأصلي عند التسجيل: <bdi dir="ltr">{expense.originalAmount}</bdi> ج.م · وسيلة الدفع: {methods[expense.paymentMethod ?? ""] ?? "—"} · تاريخ الدفع: {expense.paymentDate ?? "—"}.</p>
    {adjustsCash ? account ? <div className={projected !== null && projected < 0n ? "lab-negative" : "lab-hint"}>
      حساب الدفع: {account.label} · رصيده الحالي <bdi dir="ltr">{account.balance}</bdi> ج.م.
      {difference !== null && projected !== null && <> الفرق الدفتري على الحساب: <bdi dir="ltr">{format(difference)}</bdi> ج.م · الرصيد المتوقع: <bdi dir="ltr">{format(projected)}</bdi> ج.م.</>}
      {projected !== null && projected < 0n && <label className="lab-check"><input type="checkbox" name="negativeAcknowledged" value="yes" checked={negative} onChange={(e) => setNegative(e.target.checked)} /><span>أقر بأن الرصيد سيصبح سالبًا ويحتاج مراجعة.</span></label>}
    </div> : <p className="lab-negative">مصدر النقد غير ظاهر؛ لا تؤكد التصحيح قبل مراجعته.</p> : <p className="lab-hint">{expense.paymentHistorical ? "الدفع التاريخي محسوب في جرد البداية؛ لا تعديل على النقد." : "الدفع غير نقدي؛ لا تعديل على النقد ولا افتراض رصيد بنكي."}</p>}
    <p className="lab-hint">أي فرق نقدي هنا تصحيح دفتري لما دُفع أصلًا، وليس حركة نقد جديدة أو إثبات رد مال. إذا وُجد جرد قد يكون عالج الفرق، أو كان ترتيب الدفع والجرد في اليوم نفسه غير محسوم، تُحجب الحالة للفحص اليدوي.</p>
    <Check name="verifiedPayment">تحققت من المبلغ المدفوع فعليًا ووسيلة الدفع ومصدره.</Check>
    <Check name="noPriorSettlement">تحققت أن الفرق لم يُسوَّ مسبقًا بتعديل آخر، ولا أفترض استردادًا للنقد.</Check>
  </ActionForm>;
}
function OpenAccount({ branches, users, requestId }: { branches: BranchView[]; users: UserView[]; requestId: string }) {
  const [branch, setBranch] = useState(""); const [kind, setKind] = useState("VAULT");
  return <ActionForm command="openAccount" requestId={requestId} submit="فتح الحساب بعد الجرد"><div className="lab-fields">
    <Field label="الفرع *"><select name="branchId" value={branch} onChange={(e) => setBranch(e.target.value)} required><option value="">اختر الفرع</option>{branches.filter((b) => b.active).map((b) => <option value={b.id} key={b.id}>{b.name}</option>)}</select></Field>
    <Field label="نوع الحساب *"><select name="kind" value={kind} onChange={(e) => setKind(e.target.value)}><option value="VAULT">خزنة الفرع</option><option value="CUSTODY">عهدة موظف</option></select></Field>
    {kind === "CUSTODY" && <Field label="الموظف *"><select name="holderId" defaultValue="" required><option value="">اختر الموظف</option>{users.filter((u) => u.branchId === branch).map((u) => <option value={u.id} key={u.id}>{u.name}</option>)}</select></Field>}
    <Field label="رصيد الجرد *"><input name="openingAmount" dir="ltr" inputMode="decimal" required /></Field>
    <Field label="تاريخ الجرد *"><input name="openingDate" type="date" defaultValue={today()} required /></Field></div>
    <p className="lab-hint">الصفر فقط إذا كان هو الرصيد الفعلي بعد الجرد؛ لا تعديل آلي لرصيد البداية.</p><Check name="counted">أؤكد جرد هذا الرصيد فعليًا.</Check>
  </ActionForm>;
}
export default function FinanceWorkspace({ accounts, branches, users, userNames, categories, expenses, reviews, counts, cases, requests }: Props) {
  const name = (id: string | null) => id ? userNames[id] ?? `مستخدم ${id}` : "—";
  const branch = (id: string) => branches.find((b) => b.id === id)?.name ?? `فرع ${id}`;
  return <div className="inv-page lab-finance lab-stack">
    <div className="inv-heading"><div><p className="inv-heading__eyebrow">المالية · معمل تجريبي</p><h1>المصروفات والخزائن والعهد</h1><p>التسجيل والاعتماد منفصلان عن الصرف الفعلي. لا تُنفذ هذه التجربة تحويلات مالية.</p></div></div>
    <section><h2>الخزائن والعهد</h2><div className="lab-grid">{accounts.map((a) => <article className="lab-metric" key={a.id} id={`account-${a.id}`}><span>{a.label}</span><strong dir="ltr" className={a.balance.startsWith("-") ? "lab-negative" : ""}>{a.balance} <small>ج.م</small></strong><span className="lab-hint">جرد البداية {a.openingDate}</span><span className="lab-hint">البداية المسجلة: {a.recordedOpening} ج.م{a.currentOpening !== a.recordedOpening && <> · بعد التحقق: {a.currentOpening} ج.م</>}</span>
          {a.branchActive && <details><summary>تصحيح رصيد البداية بعد المراجعة</summary><OpeningCorrection key={a.openingRequest} account={a} counts={counts} pendingCase={cases.find(c=>c.kind==="OPENING" && c.accountId===a.id && c.status==="OPEN") ?? null} /></details>}
          {cases.some(c=>c.kind==="OPENING" && c.accountId===a.id && c.status==="OPEN") ? <p className="lab-negative">توجد حالة افتتاح معلقة لهذا الحساب؛ راجعها أدناه.</p> : <details><summary>حفظ اشتباه خطأ البداية للمراجعة</summary><OpeningCaseForm key={a.caseRequest} accountId={a.id} branchId={a.branchId} requestId={a.caseRequest} /></details>}
          {a.openingCorrections.length > 0 && <details><summary>سجل تصحيحات البداية ({a.openingCorrections.length})</summary>{a.openingCorrections.map((c) => <div className="lab-correction" key={c.id}><p>من <bdi dir="ltr">{c.beforeAmount}</bdi> إلى <bdi dir="ltr">{c.afterAmount}</bdi> ج.م · فرق الافتتاح <bdi dir="ltr">{c.bookDifference}</bdi></p><p>{c.resolution === "BOOK" ? "تعديل دفتري مرة واحدة، وليس حركة نقد فعلية." : `وثّق المؤكد أن الجرد #${c.coveredCountId} عالج الفرق؛ بلا حركة نقد جديدة.`}</p><p>الرصيد قبل: <bdi dir="ltr">{c.balanceBefore}</bdi> · بعد: <bdi dir="ltr">{c.balanceAfter}</bdi> · {name(c.createdBy)} · {c.createdAt} · السبب: {c.reason}</p></div>)}</details>}{a.balance.startsWith("-") && <p className="lab-negative">رصيد سالب يحتاج مراجعة.</p>}
      <details><summary>حركات الحساب ({a.activity.length})</summary>{a.activity.length ? <ul className="lab-activity">{a.activity.map((m) => <li key={m.id}><span>{movements[m.kind] ?? "حركة"}<small>{m.recordedAt}</small></span><strong style={{ fontSize: "1rem" }} dir="ltr">{m.direction === "OUT" ? "−" : "+"}{m.amount}</strong></li>)}</ul> : <p>لا توجد حركات.</p>}</details></article>)}</div></section>
    <CaseList cases={cases} accounts={accounts} users={userNames} branches={Object.fromEntries(branches.map(b=>[b.id,b.name]))} />
    <div className="lab-grid"><details><summary>تسجيل تسليم نقدي بين الخزنة والعهدة</summary><p className="lab-hint">التسليم من وإلى خزنة الفرع وعهدة في الفرع نفسه فقط؛ ليس إيرادًا جديدًا.</p><Transfer key={requests.transfer} accounts={accounts} requestId={requests.transfer} /></details>
      <details><summary>فتح خزنة أو عهدة بعد الجرد</summary><OpenAccount key={requests.open} branches={branches} users={users} requestId={requests.open} /></details></div>
    <section className="inv-panel"><div className="inv-panel__heading"><h2>جرد الخزائن والعهد</h2><p>سجّل الجرد أولًا، ثم راجع وأكد تسوية مستقلة. تأكيد التسوية دفتري ولا ينقل نقدًا فعليًا.</p></div><div className="inv-panel__body lab-stack">
      <details><summary>الخطوة ١: تسجيل جرد جديد</summary><CashCount key={requests.count} accounts={accounts} requestId={requests.count} /></details>
      {counts.length ? counts.map((c) => { const account=accounts.find((a) => a.id === c.accountId); return <article className="lab-expense" key={c.id}>
        <div className="lab-expense-head"><strong>{account?.label ?? `حساب ${c.accountId}`} · جرد #{c.id}</strong><span className="lab-status">{c.status === "OPEN" ? "بانتظار المراجعة" : c.status === "CONFIRMED" ? "تم التأكيد" : "ملغى"}</span></div>
        <div className="lab-meta"><span>رصيد النظام قبل: <bdi dir="ltr">{c.observedBalance}</bdi> ج.م</span><span>{c.status === "CONFIRMED" ? "المعدود والرصيد بعد التسوية" : "النقد المعدود (لم يُسوَّ)"}: <bdi dir="ltr">{c.countedAmount}</bdi> ج.م</span><span>الفرق: <bdi dir="ltr">{c.difference}</bdi> ج.م</span><span>تاريخ الجرد: {c.countedOn}</span><span>المُدخل: {name(c.createdBy)}</span><span>وقت الإدخال: {c.createdAt}</span><span>السبب: {c.reason}</span>{c.resolvedBy && <><span>{c.status === "CONFIRMED" ? "المؤكد" : "ألغاه"}: {name(c.resolvedBy)}</span><span>الوقت: {c.resolvedAt}</span><span>سبب الإجراء: {c.resolutionReason}</span></>}</div>
        {c.status === "OPEN" && <>{account && account.balance !== c.observedBalance && <p className="lab-negative">تغيّر الرصيد منذ الجرد. ألغِ الطلب بسبب وأعد الجرد؛ لا تؤكد نتيجة قديمة.</p>}
          {account && !account.branchActive && <p className="lab-negative">الفرع موقوف؛ لا يمكن تأكيد جرد جديد له في هذه التجربة، ويمكن إلغاء الطلب بسبب.</p>}
          <details><summary>الخطوة ٢: مراجعة وتأكيد التسوية</summary><p className="lab-hint">{c.difference === "0.00" ? "المعدود يطابق الرصيد؛ سيُحفظ تأكيد الجرد دون حركة تسوية." : "سيساوي رصيد النظام النقد المعدود، بفرق دفتري فقط وليس تسليمًا أو تحصيلًا أو مصروفًا."} إذا حدثت أي حركة بعد الجرد سيرفض النظام التأكيد حتى لو عاد الرصيد لقيمته السابقة.</p>
            <ActionForm key={c.confirmRequest} command="confirmCashCount" requestId={c.confirmRequest} submit="تأكيد تسوية الجرد"><input type="hidden" name="countId" value={c.id} /><Field label="سبب التأكيد *"><input name="reason" maxLength={300} required /></Field><Check name="stillCurrent">راجعت الجرد وأؤكد أن النقد المعدود ما زال فعليًا ولم تقع حركة بعده.</Check></ActionForm>
          </details><details><summary>إلغاء طلب الجرد وإعادة الجرد</summary><p className="lab-hint">الإلغاء لا يغير الرصيد ويُحفظ سببه.</p><ActionForm key={c.cancelRequest} command="cancelCashCount" requestId={c.cancelRequest} submit="إلغاء طلب الجرد"><input type="hidden" name="countId" value={c.id} /><Field label="سبب الإلغاء *"><input name="reason" maxLength={300} required /></Field></ActionForm></details></>}
      </article>; }) : <p>لا توجد طلبات جرد في التجربة.</p>}
    </div></section>
    <section className="inv-panel"><div className="inv-panel__heading"><h2>مصروف جديد</h2><p>المُدخل والمعتمد محفوظان. ترك الضريبة فارغة لا يعني صفرًا أو إعفاءً.</p></div><div className="inv-panel__body"><ActionForm key={requests.expense} command="createExpense" requestId={requests.expense} submit="تسجيل المصروف"><ExpenseFields branches={branches} categories={categories} /></ActionForm><p className="lab-hint">يمكن إضافة مرفق وهمي بعد تسجيل المصروف. المعاينة عامة والملفات غير مفحوصة أمنيًا؛ لا ترفع بيانات حقيقية ولا تفتح إلا ملفًا وهميًا تعرف مصدره.</p></div></section>
    <section className="inv-panel"><div className="inv-panel__heading"><h2>المصروفات</h2><p>الاعتماد لا يعني الدفع. أي تعديل قبل الصرف يعيد السجل للاعتماد.</p></div><div className="inv-panel__body lab-stack">
      {!expenses.length && <p>لم تُسجّل مصروفات وهمية بعد.</p>}{expenses.map((e) => <article className="lab-expense" key={e.id}><div className="lab-expense-head"><div><strong>{e.description}</strong><div className="lab-hint">{branch(e.branchId)} · {e.categorySnapshot} · {e.expenseDate}</div></div><div><span className="lab-status">{statusLabel[e.status]}</span> <strong dir="ltr">{e.amount} ج.م</strong></div></div>
        <div className="lab-meta"><span>المُدخل: {name(e.requestedBy)}</span><span>التسجيل: {e.createdAt}</span><span>المعتمد: {name(e.approvedBy)}</span><span>وقت الاعتماد: {e.approvedAt ?? "—"}</span><span>المستفيد: {e.beneficiary ?? "—"}</span><span>المستند: {e.documentNumber ?? "—"}</span><span>الضريبة المدخلة: {e.taxAmount ?? "غير محددة"}</span>
          {e.status === "PAID" && <><span>وسيلة الدفع: {methods[e.paymentMethod ?? ""]}</span><span>تاريخ الدفع: {e.paymentDate}</span><span>سجّل الصرف: {name(e.paymentRecordedBy)}</span><span>وقت التسجيل: {e.paymentRecordedAt}</span><span>الحساب: {accounts.find((a) => a.id === e.paymentAccountId)?.label ?? "غير نقدي"}</span>{e.paymentHistorical && <span>دفع تاريخي محتسب في الجرد</span>}{e.paymentAfterCountId && <span>دفع بعد جرد مؤكد #{e.paymentAfterCountId}</span>}{e.originalAmount !== e.amount && <span>المبلغ الأصلي عند التسجيل: <bdi dir="ltr">{e.originalAmount}</bdi> ج.م</span>}</>}</div>
        <div className="lab-attachment">
          {e.attachment ? <p>مرفق تجريبي: <a href={`/finance/attachments/${e.id}`}>{e.attachment.filename}</a> · {(e.attachment.size / 1000).toFixed(1)} KB · {name(e.attachment.createdBy)} · {e.attachment.createdAt}</p> : <details><summary>إضافة مرفق وهمي اختياري</summary>
            <p className="lab-hint">ملف واحد فقط بصيغة JPG أو PNG أو PDF، حتى 5 MB. ممنوع استخدام مستندات أو بيانات حقيقية؛ لا تُفحص الملفات من البرمجيات الخبيثة، والحذف والاستبدال غير متاحين في المختبر.</p>
            <ActionForm key={e.attachmentRequest} command="addExpenseAttachment" requestId={e.attachmentRequest} submit="حفظ الملف الوهمي"><input type="hidden" name="expenseId" value={e.id} /><Field label="ملف وهمي واحد *"><input type="file" name="attachment" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" required /></Field></ActionForm>
          </details>}
        </div>
        {e.status === "PENDING" && <ActionForm key={e.approveRequest} command="approveExpense" requestId={e.approveRequest} submit="اعتماد المصروف"><input type="hidden" name="expenseId" value={e.id} /><input type="hidden" name="expectedRevision" value={e.revision} /></ActionForm>}
        {e.status !== "PAID" && <details><summary>تصحيح المصروف بسبب واضح</summary><ActionForm key={e.editRequest} command="editUnpaidExpense" requestId={e.editRequest} submit="حفظ التصحيح وإعادة الاعتماد"><input type="hidden" name="expenseId" value={e.id} /><input type="hidden" name="expectedRevision" value={e.revision} /><ExpenseFields branches={branches} categories={categories} expense={e} /></ActionForm></details>}
        {e.status === "APPROVED" && <details><summary>تسجيل الصرف الفعلي</summary><Payment key={e.payRequest} expense={e} accounts={accounts} counts={counts} /></details>}
        {e.status === "PAID" && (e.hasOpenReview ? <p className="lab-negative">توجد مراجعة مفتوحة؛ لم يتغير الأصل أو الرصيد.</p> : <details><summary>الإبلاغ عن خطأ في مبلغ مصروف مدفوع</summary><p className="lab-hint">تُسجل مراجعة فقط، بلا تعديل تلقائي أو افتراض استرداد. يمكن تأكيد التصحيح لاحقًا بعد التحقق.</p><ActionForm key={e.reviewRequest} command="requestPaidExpenseReview" requestId={e.reviewRequest} submit="إحالة للمراجعة"><input type="hidden" name="expenseId" value={e.id} /><input type="hidden" name="expectedRevision" value={e.revision} /><div className="lab-fields"><Field label="سبب المراجعة *"><input name="reason" required maxLength={300} /></Field><Field label="المبلغ المقترح (اختياري)"><input name="proposedAmount" dir="ltr" inputMode="decimal" /></Field></div></ActionForm></details>)}
        {e.corrections.length > 0 && <details><summary>تصحيحات المبلغ المدفوع ({e.corrections.length})</summary>{e.corrections.map((c) => <div className="lab-correction" key={c.id}>
          <p><strong>تصحيح #{c.id}:</strong> المبلغ السابق <bdi dir="ltr">{c.beforeAmount}</bdi> ← المبلغ المؤكد <bdi dir="ltr">{c.afterAmount}</bdi> ج.م.</p>
          <p>سبب المراجعة: {c.reviewReason} · المقترح: {c.proposedAmount ?? "غير محدد"} · المُدخل: {name(c.reviewCreatedBy)} · {c.reviewCreatedAt}</p>
          <p>سبب التأكيد: {c.reason} · المؤكد: {name(c.createdBy)} · {c.createdAt}</p>
          {c.accountId ? <p>الأثر الدفتري على {accounts.find((a) => a.id === c.accountId)?.label ?? `حساب ${c.accountId}`}: <bdi dir="ltr">{c.bookDifference}</bdi> ج.م · الرصيد قبل: <bdi dir="ltr">{c.balanceBefore}</bdi> · بعد: <bdi dir="ltr">{c.balanceAfter}</bdi>. ليس إثبات رد مال.</p> : <p>لم يُجرَ تعديل على النقد.</p>}
        </div>)}</details>}
        <details><summary>سجل التدقيق ({e.audit.length})</summary>{e.audit.map((a) => <div key={a.id} className="lab-hint"><strong>{a.action}</strong> · {name(a.actorId)} · {a.createdAt}{a.reason && <p>السبب: {a.reason}</p>}{a.before && <><span>قبل:</span><pre dir="ltr" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{a.before}</pre></>}{a.after && <><span>بعد:</span><pre dir="ltr" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{a.after}</pre></>}</div>)}</details>
      </article>)}
    </div></section>
    <section className="inv-panel"><div className="inv-panel__heading"><h2>طلبات مراجعة المصروفات المدفوعة</h2><p>فتح المراجعة لا يغير السجل أو النقد. تأكيد التصحيح خطوة منفصلة بعد التحقق.</p></div><div className="inv-panel__body lab-stack">{reviews.length ? reviews.map((r) => { const e=expenses.find((item) => item.id === r.expenseId); return <div className="lab-expense" key={r.id}><strong>المصروف #{r.expenseId} · {e?.description ?? "مصروف"} · مراجعة مفتوحة</strong><span>سبب المراجعة: {r.reason} · المقترح: {r.proposedAmount ?? "غير محدد"}</span><small>{name(r.createdBy)} · {r.createdAt}</small>
      {e && <><details><summary>مراجعة وتأكيد تصحيح المبلغ المدفوع</summary><PaidCorrection key={r.confirmRequest} review={r} expense={e} accounts={accounts} /></details>
        <details><summary>إغلاق المراجعة دون تصحيح</summary><p className="lab-hint">إذا انتهت المراجعة دون تصحيح، يمكن إغلاقها بسبب واضح دون تغيير المصروف أو الرصيد. يمكن فتح مراجعة جديدة لاحقًا.</p><ActionForm key={r.closeRequest} command="closePaidExpenseReview" requestId={r.closeRequest} submit="إغلاق دون تغيير"><input type="hidden" name="reviewId" value={r.id} /><Field label="سبب الإغلاق *"><input name="reason" maxLength={300} required /></Field></ActionForm></details></>}</div>; }) : <p>لا توجد مراجعات مفتوحة.</p>}</div></section>
    <section className="inv-panel"><div className="inv-panel__heading"><h2>بنود المصروفات</h2><p>يمكن تعديل البند أو إيقافه دون حذف تاريخه.</p></div><div className="inv-panel__body lab-stack"><ActionForm key={requests.category} command="addCategory" requestId={requests.category} submit="إضافة بند"><div className="lab-fields"><Field label="اسم البند *"><input name="name" required maxLength={120} /></Field></div></ActionForm>
      {categories.map((c) => <details key={c.id}><summary>{c.name} · {c.active ? "نشط" : "موقوف"}</summary><ActionForm key={c.editRequest} command="editCategory" requestId={c.editRequest} submit="حفظ تعديل البند"><input type="hidden" name="categoryId" value={c.id} /><input type="hidden" name="expectedRevision" value={c.revision} /><div className="lab-fields"><Field label="اسم البند *"><input name="name" defaultValue={c.name} required maxLength={120} /></Field><Field label="الحالة"><select name="active" defaultValue={String(c.active)}><option value="true">نشط</option><option value="false">موقوف</option></select></Field><Field label="سبب التعديل *"><input name="reason" required maxLength={300} /></Field></div></ActionForm></details>)}
    </div></section>
  </div>;
}
