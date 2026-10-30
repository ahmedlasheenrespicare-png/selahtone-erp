/*
 * Fictional, in-memory design prototype ONLY. No database, network, persistence,
 * real payment, authentication, or secure authorization. All amounts are fictional.
 */
export const BRANCHES = Object.freeze([
  { id: "branch-a", name: "الفرع التجريبي الأول" },
  { id: "branch-b", name: "الفرع التجريبي الثاني" },
]);
export const CATEGORIES = Object.freeze([
  { id: "maintenance", name: "صيانة تجريبية" },
  { id: "supplies", name: "مستلزمات تجريبية" },
  { id: "utilities", name: "خدمات تجريبية" },
]);
export const METHODS = Object.freeze([
  { id: "CASH", label: "نقدي" },
  { id: "CARD", label: "بطاقة" },
  { id: "BANK_TRANSFER", label: "تحويل بنكي" },
  { id: "WALLET", label: "محفظة" },
]);
export const ROLE_NAMES = Object.freeze({ manager: "مدير تجريبي", accountant: "محاسب تجريبي", staff: "موظف تجريبي" });
const MAX_CENTS = 99_999_999_999_999n;
const managerRoles = new Set(["manager", "accountant"]);
const supportedRoles = new Set([...managerRoles, "staff"]);

export class DemoProblem extends Error {
  constructor(message, code = "invalid") { super(message); this.name = "DemoProblem"; this.code = code; }
}
const clone = (state) => structuredClone(state);
const branch = (id) => BRANCHES.find((item) => item.id === id);
const method = (id) => METHODS.find((item) => item.id === id);
const account = (state, id) => state.accounts.find((item) => item.id === id);
const expense = (state, id) => state.expenses.find((item) => item.id === id);
const stamp = () => new Date().toISOString();
function ensureManager(role) {
  if (!managerRoles.has(role)) throw new DemoProblem("المصروفات وحركات التسليم للمدير أو المحاسب التجريبي فقط.", "permission");
}
function ensureBranch(id) {
  if (!branch(id)) throw new DemoProblem("اختر فرعًا تجريبيًا صحيحًا.");
}
function ensureValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new DemoProblem("أدخل تاريخًا صحيحًا.");
  const d = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== value) throw new DemoProblem("أدخل تاريخًا صحيحًا.");
  return value;
}
function parseCents(input, allowZero = false) {
  const text = String(input ?? "").trim().replace(/[٠-٩۰-۹]/g, (d) => String(d.charCodeAt(0) >= 0x06f0 ? d.charCodeAt(0) - 0x06f0 : d.charCodeAt(0) - 0x0660)).replace(/٫/g, ".");
  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new DemoProblem("أدخل مبلغًا صحيحًا حتى منزلتين عشريتين.");
  const cents = BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
  if ((!allowZero && cents === 0n) || cents > MAX_CENTS) throw new DemoProblem("يجب أن يكون المبلغ أكبر من صفر وضمن الحد المسموح.");
  return cents;
}
export function parseMoney(input) { return parseCents(input); }
function optionalText(value, maxLength, name) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > maxLength) throw new DemoProblem(`أدخل ${name} مختصرًا.`);
  return value.trim() || null;
}
export function formatMoney(cents) {
  if (typeof cents !== "bigint") throw new Error("Expected integer cents");
  const negative = cents < 0n;
  const value = negative ? -cents : cents;
  return `${negative ? "−" : ""}${(value / 100n).toLocaleString("en-US")}.${(value % 100n).toString().padStart(2, "0")}`;
}
export function createInitialState() {
  return {
    role: "manager", staffBranch: "branch-a", staffUser: "staff-a",
    accounts: [
      { id: "vault-a", branchId: "branch-a", kind: "vault", label: "خزنة الفرع الأول", openingCents: 500_000n, openingDate: "2026-10-25" },
      { id: "custody-a", branchId: "branch-a", kind: "custody", holderId: "staff-a", label: "عهدة الموظف التجريبي", openingCents: 80_000n, openingDate: "2026-10-25" },
      { id: "vault-b", branchId: "branch-b", kind: "vault", label: "خزنة الفرع الثاني", openingCents: 250_000n, openingDate: "2026-10-25" },
      { id: "custody-b", branchId: "branch-b", kind: "custody", holderId: "staff-b", label: "عهدة موظف تجريبي آخر", openingCents: 30_000n, openingDate: "2026-10-25" },
    ],
    expenses: [
      { id: "exp-1001", branchId: "branch-a", categoryId: "maintenance", amountCents: 75_000n, date: "2026-10-20", description: "صيانة توضيحية", status: "PENDING", createdBy: "manager", approvedBy: null, payment: null },
      { id: "exp-1002", branchId: "branch-b", categoryId: "supplies", amountCents: 25_000n, date: "2026-10-21", description: "مستلزمات توضيحية", status: "APPROVED", createdBy: "accountant", approvedBy: "accountant", payment: null },
    ],
    movements: [], collections: [], paidReviews: [], nextExpense: 1003, nextMovement: 1, nextCollection: 1, nextPaidReview: 1,
  };
}
export function setRole(state, role) {
  if (!supportedRoles.has(role)) throw new DemoProblem("الدور التجريبي غير معروف.");
  const next = clone(state); next.role = role; return next;
}
export function visibleAccounts(state, role = state.role) {
  if (managerRoles.has(role)) return [...state.accounts];
  if (role === "staff") return state.accounts.filter((a) => a.kind === "custody" && a.holderId === state.staffUser && a.branchId === state.staffBranch);
  return [];
}
export function selectableCashAccounts(state, branchId, role = state.role) {
  if (!branch(branchId) || !supportedRoles.has(role)) return [];
  if (role === "staff" && branchId !== state.staffBranch) return [];
  return state.accounts.filter((a) => a.branchId === branchId && (role !== "staff" || a.kind === "vault" || a.holderId === state.staffUser));
}
export function balanceOf(state, accountId) {
  const target = account(state, accountId);
  if (!target) throw new DemoProblem("الحساب التجريبي غير موجود.");
  return state.movements.reduce((balance, movement) => balance + (movement.toId === accountId ? movement.amountCents : 0n) - (movement.fromId === accountId ? movement.amountCents : 0n), target.openingCents);
}
export function totalCash(state, branchId = null) {
  return state.accounts.filter((a) => branchId === null || a.branchId === branchId).reduce((sum, a) => sum + balanceOf(state, a.id), 0n);
}
function pushMovement(state, entry) {
  state.movements.unshift({ id: `move-${state.nextMovement++}`, createdAt: stamp(), ...entry });
}
function requireAcknowledgement(projected, confirmed) {
  if (projected < 0n && confirmed !== true) throw new DemoProblem("الرصيد سيصبح سالبًا. راجع الفرق وأكد التحذير أولًا.", "negative_warning");
}
export function inspectTransfer(state, input) {
  ensureManager(state.role);
  const from = account(state, input.fromId), to = account(state, input.toId);
  if (!from || !to || from.id === to.id || from.branchId !== to.branchId || from.kind === to.kind) {
    throw new DemoProblem("اختر خزنة وعهدة مختلفتين في الفرع نفسه.");
  }
  const amount = parseMoney(input.amount);
  return { from, to, amount, projected: balanceOf(state, from.id) - amount };
}
export function recordTransfer(state, input) {
  const { from, to, amount, projected } = inspectTransfer(state, input);
  if (input.actuallyTransferred !== true) throw new DemoProblem("أكد أن تسليم النقد حدث فعليًا.");
  requireAcknowledgement(projected, input.negativeAcknowledged);
  const next = clone(state);
  pushMovement(next, { kind: "TRANSFER", branchId: from.branchId, fromId: from.id, toId: to.id, amountCents: amount, actor: state.role });
  return next;
}
export function inspectExpense(state, input) {
  ensureManager(state.role); ensureBranch(input.branchId);
  if (!CATEGORIES.some((item) => item.id === input.categoryId)) throw new DemoProblem("اختر بند مصروف تجريبيًا.");
  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (description.length < 2 || description.length > 180) throw new DemoProblem("أدخل وصفًا تجريبيًا مختصرًا للمصروف.");
  const amountCents = parseMoney(input.amount);
  const taxCents = input.taxAmount === undefined || input.taxAmount === null || String(input.taxAmount).trim() === "" ? null : parseCents(input.taxAmount, true);
  if (taxCents !== null && taxCents > amountCents) throw new DemoProblem("قيمة الضريبة المدخلة لا يمكن أن تتجاوز المبلغ الإجمالي.");
  return {
    branchId: input.branchId, categoryId: input.categoryId, amountCents, date: ensureValidDate(input.date), description,
    beneficiary: optionalText(input.beneficiary, 120, "اسم المستفيد"), documentNumber: optionalText(input.documentNumber, 120, "رقم المستند"), taxCents,
  };
}
export function createExpense(state, input) {
  const data = inspectExpense(state, input);
  const next = clone(state);
  next.expenses.unshift({ id: `exp-${next.nextExpense++}`, ...data, status: "PENDING", createdBy: state.role, approvedBy: null, payment: null });
  return next;
}
export function approveExpense(state, expenseId) {
  ensureManager(state.role);
  const found = expense(state, expenseId);
  if (!found || found.status !== "PENDING") throw new DemoProblem("المصروف غير موجود أو لا ينتظر الاعتماد.");
  const next = clone(state);
  const target = expense(next, expenseId); target.status = "APPROVED"; target.approvedBy = state.role;
  return next;
}
export function inspectExpensePayment(state, input) {
  ensureManager(state.role);
  const found = expense(state, input.expenseId);
  if (!found || found.status !== "APPROVED") throw new DemoProblem("يمكن تسجيل صرف مصروف معتمد لم يُدفع سابقًا فقط.");
  if (!method(input.method)) throw new DemoProblem("اختر وسيلة دفع تجريبية.");
  const paymentDate = ensureValidDate(input.paymentDate);
  if (input.method !== "CASH") {
    if (input.accountId) throw new DemoProblem("وسيلة الدفع غير النقدية لا تخصم من خزنة أو عهدة.");
    return { expense: found, account: null, projected: null, paymentDate, historical: false };
  }
  const source = account(state, input.accountId);
  if (!source || source.branchId !== found.branchId) throw new DemoProblem("اختر مصدرًا نقديًا في فرع المصروف.");
  if (paymentDate === source.openingDate && input.openingOrder !== "before" && input.openingOrder !== "after") {
    throw new DemoProblem("حدد هل حدث الدفع في يوم الجرد قبله أم بعده.");
  }
  const historical = paymentDate < source.openingDate || (paymentDate === source.openingDate && input.openingOrder === "before");
  if (historical && input.includedInOpening !== true) {
    throw new DemoProblem("أكد أن الدفع سبق الجرد وأن الرصيد الافتتاحي يعكسه قبل تسجيله تاريخيًا.");
  }
  return { expense: found, account: source, projected: historical ? null : balanceOf(state, source.id) - found.amountCents, paymentDate, historical };
}
export function payExpense(state, input) {
  const examined = inspectExpensePayment(state, input);
  if (input.actuallyPaid !== true) throw new DemoProblem("أكد أن المصروف دُفع فعليًا قبل تسجيل الصرف.");
  if (examined.projected !== null) requireAcknowledgement(examined.projected, input.negativeAcknowledged);
  const next = clone(state), target = expense(next, input.expenseId);
  target.status = "PAID"; target.payment = { method: input.method, accountId: examined.account?.id ?? null, paidBy: state.role, paymentDate: examined.paymentDate, recordedAt: stamp(), historical: examined.historical };
  if (examined.account && !examined.historical) pushMovement(next, { kind: "EXPENSE", branchId: target.branchId, fromId: examined.account.id, toId: null, amountCents: target.amountCents, actor: state.role, reference: target.id });
  return next;
}
export function inspectPaidExpenseReview(state, input) {
  ensureManager(state.role);
  const item = expense(state, input.expenseId);
  if (!item || item.status !== "PAID") throw new DemoProblem("طلب المراجعة يخص مصروفًا تجريبيًا مدفوعًا فقط.");
  if (state.paidReviews.some((entry) => entry.expenseId === item.id)) throw new DemoProblem("يوجد طلب مراجعة مفتوح لهذا المصروف التجريبي.");
  const reason = optionalText(input.reason, 300, "سبب المراجعة");
  if (!reason) throw new DemoProblem("أدخل سبب طلب المراجعة أولًا.");
  const proposed = input.proposedAmount === undefined || input.proposedAmount === null || String(input.proposedAmount).trim() === "" ? null : parseCents(input.proposedAmount, true);
  return { expense: item, reason, proposedAmountCents: proposed };
}
export function requestPaidExpenseReview(state, input) {
  const inspected = inspectPaidExpenseReview(state, input), next = clone(state);
  next.paidReviews.unshift({ id: `review-${next.nextPaidReview++}`, expenseId: inspected.expense.id, reason: inspected.reason,
    originalAmountCents: inspected.expense.amountCents, proposedAmountCents: inspected.proposedAmountCents, requestedBy: state.role, createdAt: stamp() });
  return next;
}
export function inspectCollection(state, input) {
  if (!supportedRoles.has(state.role)) throw new DemoProblem("الدور التجريبي غير معروف.");
  ensureBranch(input.branchId);
  if (state.role === "staff" && input.branchId !== state.staffBranch) throw new DemoProblem("الموظف التجريبي في فرعه فقط.", "permission");
  if (!method(input.method)) throw new DemoProblem("اختر وسيلة تحصيل تجريبية.");
  const amount = parseMoney(input.amount);
  if (input.method !== "CASH") {
    if (input.accountId) throw new DemoProblem("التحصيل غير النقدي لا يُضاف إلى الخزنة أو العهدة.");
    return { amount, account: null };
  }
  const target = selectableCashAccounts(state, input.branchId).find((a) => a.id === input.accountId);
  if (!target) throw new DemoProblem("اختر مكان النقد الفعلي المسموح في الفرع.");
  return { amount, account: target };
}
export function recordCollection(state, input) {
  const { amount, account: target } = inspectCollection(state, input);
  if (input.actuallyReceived !== true) throw new DemoProblem("أكد أن التحصيل التجريبي قد تم.");
  const next = clone(state), id = `collection-${next.nextCollection++}`;
  next.collections.unshift({ id, branchId: input.branchId, method: input.method, amountCents: amount, accountId: target?.id ?? null, actor: state.role, createdAt: stamp() });
  if (target) pushMovement(next, { kind: "COLLECTION", branchId: input.branchId, fromId: null, toId: target.id, amountCents: amount, actor: state.role, reference: id });
  return next;
}
export function branchName(id) { return branch(id)?.name ?? "فرع غير معروف"; }
export function categoryName(id) { return CATEGORIES.find((item) => item.id === id)?.name ?? "بند غير معروف"; }
export function methodName(id) { return method(id)?.label ?? "وسيلة غير معروفة"; }
export function accountName(state, id) { return account(state, id)?.label ?? "—"; }
