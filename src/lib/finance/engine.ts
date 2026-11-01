/**
 * Ported finance engine for the real application. SQL targets the reviewed
 * candidate schema `finance` and the real `public.users`, `public.branches`
 * and `public.expense_categories` tables. It is STAGED code: nothing in the
 * deployed app reaches it while the FINANCE_ENABLED flag is off, and the schema
 * must be installed by a separately reviewed migration before it is switched on.
 * All queries are parameterized; callers must supply a SERIALIZABLE adapter and
 * must derive actor identifiers from a verified session, never from the browser.
 */
import { createHash } from "node:crypto";
import { canCollectTo, canManageFinance, canViewAccount, activeActor } from "./policy";
import { FinanceProblem, type AccountKind, type AccountScope, type Actor, type FinanceCategoryRow, type FinanceDatabase, type FinanceTransaction, type Method, type WriteResult } from "./types";
import { cairoDate, caseSnapshot, confirmation, date, exactCents, flag, formatCents, identifier, inputObject, kind, method, money, openingOrder, optionalIdentifier, optionalMoney, requestId, revision, signedMoney, text, type Input } from "./validation";

type Row = Record<string, unknown>;
type ActorRow = Row & Actor;
type BranchRow = Row & { id: string; active: boolean };
type CategoryRow = FinanceCategoryRow;
type AccountRow = Row & AccountScope & { openingAmount: string; openingDate: string; revision: string };
type ExpenseRow = Row & {
  id: string; branchId: string; categoryId: string; categorySnapshot: string; amount: string; expenseDate: string;
  description: string; beneficiary: string | null; documentNumber: string | null; taxAmount: string | null;
  status: "PENDING" | "APPROVED" | "PAID"; revision: number; requestedBy: string; approvedBy: string | null; approvedAt: string | null; createdAt: string;
};
type ExpenseListRow = ExpenseRow & {
  paymentId: string | null; paymentAmount: string | null; paymentMethod: Method | null; paymentDate: string | null;
  paymentAccountId: string | null; paymentRecordedAt: string | null; paymentRecordedBy: string | null;
  paymentHistorical: boolean | null; paymentOpeningOrder: "BEFORE" | "AFTER" | null; paymentAfterCountId: string | null; hasOpenReview: boolean; originalAmount: string;
};
type PaidExpenseReviewRow = Row & {
  id: string; expenseId: string; expenseRevision: number; proposedAmount: string | null; reason: string;
  originalSnapshot: Record<string, unknown>; status: "OPEN" | "CORRECTED" | "CLOSED"; createdBy: string; createdAt: string;
};
export type ReconciliationKind = "OPENING" | "COLLECTION" | "REFUND";
export type ReconciliationCase = Row & {
  id:string; kind:ReconciliationKind; branchId:string; accountId:string|null; saleId:string|null;
  proposedAmount:string|null; possibleDate:string|null; possibleHandler:string|null; reason:string;
  openingSnapshot:string|null; balanceSnapshot:string|null; status:"OPEN"|"CONFIRMED"|"CLOSED"; revision:number;
  createdBy:string; createdAt:string; resolvedBy:string|null; resolvedAt:string|null; resolutionReason:string|null;
  openingCorrectionId:string|null; historicalId:string|null;
};
export type ReconciliationNote = Row & { id:string; caseId:string; note:string; createdBy:string; createdAt:string };
type OpeningCorrectionRow = Row & { id: string; accountId: string; beforeAmount: string; afterAmount: string; bookDifference: string; resolution: "BOOK" | "COUNT_COVERED"; coveredCountId: string | null; balanceBefore: string; balanceAfter: string; reason: string; createdBy: string; createdAt: string };
type ExpenseCorrectionRow = Row & { id: string; expenseId: string; reviewId: string; beforeAmount: string; afterAmount: string; reason: string; accountId: string | null; bookDifference: string | null; balanceBefore: string | null; balanceAfter: string | null; createdBy: string; createdAt: string; reviewReason: string; proposedAmount: string | null; reviewCreatedBy: string; reviewCreatedAt: string };
type PaymentRow = Row & { id: string; amount: string; method: Method; accountId: string | null; paymentDate: string; recordedAt: string; recordedBy: string; historical: boolean; openingOrder: "BEFORE" | "AFTER" | null; afterCountId: string | null };
type CashCountRow = Row & { id: string; accountId: string; countedAmount: string; observedBalance: string; difference: string; accountRevision: string; countedOn: string; reason: string; status: "OPEN" | "CONFIRMED" | "CANCELLED"; createdBy: string; createdAt: string; resolvedBy: string | null; resolvedAt: string | null; resolutionReason: string | null };
type PriorRow = Row & { requestHash: string; actorId: string; action: string; resultId: string };
type IdRow = Row & { id: string };
type BalanceRow = Row & { balance: string };

function digest(actorId: string, action: string, payload: unknown): string {
  return createHash("sha256").update(JSON.stringify({ actorId, action, payload })).digest("hex");
}
function dbCode(error: unknown): string | null {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : null;
}
function dbConstraint(error: unknown): string | null {
  return typeof error === "object" && error !== null && "constraint" in error && typeof error.constraint === "string" ? error.constraint : null;
}
function ensureNotFuture(day: string, today: string): void {
  if (day > today) throw new FinanceProblem("future_date", "لا يمكن تسجيل جرد أو دفع فعلي بتاريخ مستقبلي.");
}
async function loadActor(tx: FinanceTransaction, actorId: string): Promise<Actor> {
  const rows = await tx.query<ActorRow>(`SELECT id::text AS id, role_code::text AS role, branch_id::text AS "branchId", status::text AS status,
    must_change_password AS "mustChangePassword" FROM public.users WHERE id=$1::bigint FOR SHARE`, [actorId]);
  const actor = rows.rows[0] ?? null;
  if (!activeActor(actor)) throw new FinanceProblem("forbidden", "الحساب غير نشط أو لا يملك صلاحية لهذه العملية.");
  return actor;
}
/** التسليم مفتوح للمدير والمحاسب بين حسابات الفرع، ولموظف الفرع من عهدته
 *  إلى خزنة فرعه فقط. وفحصُ الجهة لا يتم هنا — إذ الحسابان لا يُعرفان قبل
 *  قفلهما داخل المعاملة — بل بعد القفل، فلا يُترك الباب مفتوحًا بحال. */
function transferActor(actor: Actor): void {
  if (canManageFinance(actor)) return;
  if (actor.role === "CS_AGENT" && actor.branchId) return;
  throw new FinanceProblem("forbidden", "التسليم للمدير والمحاسب، أو لموظف الفرع من عهدته.");
}

function manage(actor: Actor): void {
  if (!canManageFinance(actor)) throw new FinanceProblem("forbidden", "هذه العملية للمدير والمحاسب فقط.");
}
/** Recording an expense is open to management for every branch, and to branch
 * staff for their own branch only. Approval and payment stay management-only,
 * so a staff entry always lands in PENDING with its author recorded. */
function expenseCreator(branchId: string): (actor: Actor) => void {
  return (actor: Actor): void => {
    if (canManageFinance(actor)) return;
    if (actor.role === "CS_AGENT" && actor.branchId && actor.branchId === branchId) return;
    throw new FinanceProblem("forbidden", "تسجيل المصروف للمدير والمحاسب، أو لموظف الفرع في فرعه فقط.");
  };
}
async function activeBranch(tx: FinanceTransaction, branchId: string): Promise<void> {
  const rows = await tx.query<BranchRow>(`SELECT id::text AS id, is_active AS active FROM public.branches WHERE id=$1::bigint FOR SHARE`, [branchId]);
  if (!rows.rows[0]?.active) throw new FinanceProblem("branch_unavailable", "الفرع غير موجود أو غير نشط.");
  await tx.verifyBranchState?.(branchId,true);
}
/** Existing-invoice settlement may continue after a branch stops, but only
 * management can record it. Opening accounts, new sales and transfers retain
 * their separate active-branch rules. The row lock orders a concurrent stop. */
async function settlementBranch(tx: FinanceTransaction, branchId: string, actor: Actor): Promise<void> {
  const rows = await tx.query<BranchRow>(`SELECT id::text AS id,is_active AS active FROM public.branches WHERE id=$1::bigint FOR SHARE`, [branchId]);
  if (!rows.rows[0]) throw new FinanceProblem("branch_unavailable", "الفرع غير موجود في المختبر.");
  await tx.verifyBranchState?.(branchId,rows.rows[0].active);
  if (!rows.rows[0].active && !canManageFinance(actor)) throw new FinanceProblem("forbidden", "تسوية فواتير الفرع الموقوف للمدير والمحاسب فقط.");
}
async function priorRequest(tx: FinanceTransaction, id: string): Promise<PriorRow | null> {
  const result = await tx.query<PriorRow>(`SELECT request_hash AS "requestHash", actor_id::text AS "actorId", action, result_id::text AS "resultId" FROM finance.requests WHERE request_id=$1::uuid`, [id]);
  return result.rows[0] ?? null;
}
function replay(prior: PriorRow, actorId: string, action: string, hash: string): WriteResult {
  if (prior.actorId !== actorId || prior.action !== action || prior.requestHash.trim() !== hash) throw new FinanceProblem("request_conflict", "استُخدم معرّف الطلب ببيانات مختلفة؛ افتح نموذجًا جديدًا.");
  return { id: prior.resultId, replayed: true };
}
async function command(
  db: FinanceDatabase, actorIdRaw: unknown, action: string, id: string, payload: unknown,
  authorize: (actor: Actor) => void, work: (tx: FinanceTransaction, actor: Actor) => Promise<string>,
): Promise<WriteResult> {
  const actorId = identifier(actorIdRaw, "المستخدم"), hash = digest(actorId, action, payload);
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await db.serializable(async (tx) => {
        const actor = await loadActor(tx, actorId); authorize(actor);
        const prior = await priorRequest(tx, id);
        if (prior) return replay(prior, actorId, action, hash);
        const resultId = await work(tx, actor);
        await tx.query(`INSERT INTO finance.requests (request_id,request_hash,actor_id,action,result_id) VALUES ($1::uuid,$2,$3::bigint,$4,$5::bigint)`, [id, hash, actorId, action, resultId]);
        return { id: resultId, replayed: false };
      });
    } catch (error) {
      const code = dbCode(error);
      if (code === "40001" || code === "40P01") {
        if (attempt < 3) continue;
        throw new FinanceProblem("concurrency", "تغيّرت البيانات بالتزامن؛ راجعها وأعد المحاولة.");
      }
      if (code === "23505") {
        // The competing request must have committed before PostgreSQL reports the unique conflict.
        let old: PriorRow | null;
        try { old = await db.serializable(async (tx) => { const actor = await loadActor(tx, actorId); authorize(actor); return priorRequest(tx, id); }); }
        catch (readError) {
          if (dbCode(readError) === "40001" || dbCode(readError) === "40P01") {
            if (attempt < 3) continue;
            throw new FinanceProblem("concurrency", "تغيّرت البيانات بالتزامن؛ راجعها وأعد المحاولة.");
          }
          throw readError;
        }
        if (old) return replay(old, actorId, action, hash);
        if (action === "RECON_CASE_CREATE" && dbConstraint(error) === "finance_one_open_opening_case") throw new FinanceProblem("case_exists", "توجد حالة افتتاح معلقة لهذا الحساب؛ أضف إليها ملاحظة أو راجعها أولًا.");
        if (action === "EXPENSE_REVIEW_CREATE" && dbConstraint(error) === "finance_one_open_review_per_expense") throw new FinanceProblem("review_exists", "يوجد طلب مراجعة مفتوح لهذا المصروف؛ راجعه قبل إنشاء طلب آخر.");
        if (action === "CASH_COUNT_CREATE" && dbConstraint(error) === "finance_one_open_count_per_account") throw new FinanceProblem("count_exists", "يوجد جرد مفتوح لهذا الحساب؛ راجعه أو ألغِه بسبب قبل تسجيل جرد آخر.");
        throw new FinanceProblem("duplicate", "الحساب أو البند أو الحركة مسجّل بالفعل؛ لم يُحفظ طلب مكرر.");
      }
      throw error;
    }
  }
  throw new FinanceProblem("concurrency", "تغيّرت البيانات بالتزامن؛ راجعها وأعد المحاولة.");
}
async function audit(tx: FinanceTransaction, entity: string, entityId: string, action: string, actorId: string, reason: string | null, before: unknown, after: unknown): Promise<void> {
  await tx.query(`INSERT INTO finance.audit_events(entity_type,entity_id,action,actor_id,reason,before_data,after_data)
    VALUES($1,$2::bigint,$3,$4::bigint,$5,$6::jsonb,$7::jsonb)`, [entity, entityId, action, actorId, reason, JSON.stringify(before), JSON.stringify(after)]);
}
async function lockCategory(tx: FinanceTransaction, categoryId: string): Promise<CategoryRow> {
  if (tx.categoryPort) return tx.categoryPort.lock(categoryId);
  const result = await tx.query<CategoryRow>(`SELECT c.id::text AS id,c.name_ar AS name,c.is_active AS active,COALESCE(r.revision,1) AS revision
      FROM public.expense_categories c LEFT JOIN finance.category_revisions r ON r.category_id=c.id
      WHERE c.id=$1::bigint FOR UPDATE OF c`, [categoryId]);
  if (!result.rows[0]) throw new FinanceProblem("not_found", "بند المصروف غير موجود.");
  return result.rows[0];
}
async function lockAccounts(tx: FinanceTransaction, ids: string[]): Promise<AccountRow[]> {
  const ordered = [...new Set(ids)].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);
  const rows: AccountRow[] = [];
  for (const id of ordered) {
    const result = await tx.query<AccountRow>(`SELECT id::text AS id,branch_id::text AS "branchId",kind,holder_id::text AS "holderId",
      opening_amount::text AS "openingAmount",opening_date::text AS "openingDate",revision::text AS revision
      FROM finance.accounts WHERE id=$1::bigint FOR UPDATE`, [id]);
    if (!result.rows[0]) throw new FinanceProblem("account_unopened", "الحساب غير موجود أو لم يُفتح برصيد جرد بعد.");
    rows.push(result.rows[0]);
  }
  return rows;
}
async function balance(tx: FinanceTransaction, accountId: string): Promise<bigint> {
  const result = await tx.query<BalanceRow>(`SELECT (a.opening_amount + COALESCE((SELECT SUM(CASE
      WHEN m.destination_id=a.id THEN m.amount ELSE -m.amount END)
      FROM finance.movements m WHERE m.source_id=a.id OR m.destination_id=a.id),0))::text AS balance
    FROM finance.accounts a WHERE a.id=$1::bigint`, [accountId]);
  if (!result.rows[0]) throw new FinanceProblem("account_unopened", "الحساب لم يُفتح بعد.");
  return exactCents(result.rows[0].balance);
}
async function bumpAccounts(tx: FinanceTransaction, ids: string[]): Promise<void> {
  for (const id of [...new Set(ids)].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1)) {
    await tx.query(`UPDATE finance.accounts SET revision=revision+1 WHERE id=$1::bigint`, [id]);
  }
}
function checkBalance(current: bigint, expected: string | null, amount: bigint, acknowledged: boolean): bigint {
  if (expected === null) throw new FinanceProblem("balance_review_required", "راجع رصيد الحساب قبل تأكيد الصرف.");
  if (current !== exactCents(expected)) throw new FinanceProblem("balance_changed", "تغيّر الرصيد منذ المراجعة؛ راجع العملية من جديد.", { currentBalance: formatCents(current) });
  const projected = current - amount;
  if (projected < 0n && !acknowledged) throw new FinanceProblem("negative_warning", "سيصبح الرصيد سالبًا؛ راجع الفرق وأكد التحذير.", { currentBalance: formatCents(current), projectedBalance: formatCents(projected) });
  return projected;
}
function parseExpenseFields(raw: Input) {
  const amount = money(raw.amount, "المبلغ");
  const taxAmount = optionalMoney(raw.taxAmount, "قيمة الضريبة");
  if (taxAmount !== null && exactCents(taxAmount) > exactCents(amount)) throw new FinanceProblem("invalid_input", "الضريبة المدخلة لا تتجاوز المبلغ الإجمالي.");
  return {
    branchId: identifier(raw.branchId, "الفرع"), categoryId: identifier(raw.categoryId, "البند"), amount,
    expenseDate: date(raw.expenseDate, "تاريخ المصروف"), description: text(raw.description, "الوصف", 180, true)!,
    beneficiary: text(raw.beneficiary, "المستفيد", 120), documentNumber: text(raw.documentNumber, "رقم المستند", 120), taxAmount,
  };
}
async function lockExpense(tx: FinanceTransaction, expenseId: string): Promise<ExpenseRow> {
  const result = await tx.query<ExpenseRow>(`SELECT id::text AS id,branch_id::text AS "branchId",category_id::text AS "categoryId",
    category_snapshot AS "categorySnapshot",amount::text AS amount,expense_date::text AS "expenseDate",description,beneficiary,
    document_number AS "documentNumber",tax_amount::text AS "taxAmount",status,revision,requested_by::text AS "requestedBy",approved_by::text AS "approvedBy",approved_at::text AS "approvedAt",created_at::text AS "createdAt"
    FROM finance.expenses WHERE id=$1::bigint FOR UPDATE`, [expenseId]);
  if (!result.rows[0]) throw new FinanceProblem("not_found", "المصروف غير موجود.");
  return result.rows[0];
}
function checkRevision(actual: number, expected: number): void {
  if (actual !== expected) throw new FinanceProblem("revision_changed", "تغيّر السجل منذ عرضه؛ راجعه قبل المحاولة من جديد.");
}

const caseColumns = `id::text AS id,kind,branch_id::text AS "branchId",account_id::text AS "accountId",sale_id::text AS "saleId",
  proposed_amount::text AS "proposedAmount",possible_date::text AS "possibleDate",possible_handler AS "possibleHandler",reason,
  opening_snapshot::text AS "openingSnapshot",balance_snapshot::text AS "balanceSnapshot",status,revision,
  created_by::text AS "createdBy",created_at::text AS "createdAt",resolved_by::text AS "resolvedBy",resolved_at::text AS "resolvedAt",
  resolution_reason AS "resolutionReason",opening_correction_id::text AS "openingCorrectionId",historical_id::text AS "historicalId"`;
async function lockReconciliationCase(tx: FinanceTransaction, id: string): Promise<ReconciliationCase> {
  const result = await tx.query<ReconciliationCase>(`SELECT ${caseColumns} FROM finance.reconciliation_cases WHERE id=$1::bigint FOR UPDATE`, [id]);
  const item=result.rows[0];
  if (!item) throw new FinanceProblem("case_not_found","الحالة المعلقة غير موجودة.");
  if (item.status !== "OPEN") throw new FinanceProblem("case_resolved","هذه الحالة لم تعد معلقة؛ راجع نتيجتها قبل بدء عملية أخرى.");
  return item;
}
async function confirmReconciliationCase(tx:FinanceTransaction, item:ReconciliationCase, actorId:string, reason:string, target:{openingCorrectionId?:string;historicalId?:string}): Promise<void> {
  await tx.query(`UPDATE finance.reconciliation_cases SET status='CONFIRMED',resolved_by=$1::bigint,resolved_at=CURRENT_TIMESTAMP,
    resolution_reason=$2,opening_correction_id=$3::bigint,historical_id=$4::bigint,revision=revision+1 WHERE id=$5::bigint`,
    [actorId,reason,target.openingCorrectionId ?? null,target.historicalId ?? null,item.id]);
  await audit(tx,"RECON_CASE",item.id,"CONFIRM",actorId,reason,{status:"OPEN"},{status:"CONFIRMED",...target});
}

/** A case is an uncertain claim. It does not record a collection, refund,
 * adjustment, cash movement or customer payment. All optional facts remain
 * hypotheses until a separate, fully verified operation is linked to it. */
export async function createReconciliationCase(db:FinanceDatabase,actorId:string,raw:unknown,today=cairoDate()):Promise<WriteResult> {
  const value=inputObject(raw);
  if (value.kind!=="OPENING" && value.kind!=="COLLECTION" && value.kind!=="REFUND") throw new FinanceProblem("invalid_input","اختر نوع الحالة المعلقة.");
  const caseKind:ReconciliationKind=value.kind;
  const input={requestId:requestId(value.requestId),kind:caseKind,branchId:identifier(value.branchId,"الفرع"),
    accountId:optionalIdentifier(value.accountId,"الحساب المحتمل"),saleId:optionalIdentifier(value.saleId,"الفاتورة"),
    proposedAmount:optionalMoney(value.proposedAmount,"المبلغ المحتمل"),
    possibleDate:value.possibleDate===undefined||value.possibleDate===null||value.possibleDate==="" ? null : date(value.possibleDate,"التاريخ المحتمل"),
    possibleHandler:text(value.possibleHandler,"من تعامل بالنقد محتملًا",120),reason:text(value.reason,"سبب المراجعة",300,true)!};
  if (input.kind==="OPENING" && (!input.accountId || input.saleId || input.possibleDate || input.possibleHandler)) throw new FinanceProblem("invalid_input","حالة البداية تتطلب حسابًا واحدًا ولا ترتبط بفاتورة.");
  if (input.kind!=="OPENING" && (!input.saleId || (input.proposedAmount!==null && exactCents(input.proposedAmount)===0n))) throw new FinanceProblem("invalid_input","اختر الفاتورة، واترك المبلغ مجهولًا أو أدخل مبلغًا أكبر من صفر.");
  if (input.possibleDate) ensureNotFuture(input.possibleDate,today);
  return command(db,actorId,"RECON_CASE_CREATE",input.requestId,input,manage,async(tx,actor)=>{
    await settlementBranch(tx,input.branchId,actor);
    if (input.saleId) {
      if (!tx.verifySaleBranch) throw new FinanceProblem("sale_verification_required","تعذر التحقق من الفاتورة؛ لم تُحفظ الحالة.");
      await tx.verifySaleBranch(input.saleId,input.branchId);
    }
    let openingSnapshot:string|null=null,balanceSnapshot:string|null=null;
    if (input.accountId) {
      const account=(await lockAccounts(tx,[input.accountId]))[0];
      if (account.branchId!==input.branchId) throw new FinanceProblem("account_branch","الحساب المحتمل يجب أن ينتمي إلى فرع الحالة.");
      if (input.kind==="OPENING") {
        const open=await tx.query<IdRow>(`SELECT id::text AS id FROM finance.reconciliation_cases WHERE kind='OPENING' AND account_id=$1::bigint AND status='OPEN'`,[account.id]);
        if (open.rows[0]) throw new FinanceProblem("case_exists","توجد حالة افتتاح معلقة لهذا الحساب؛ أضف إليها ملاحظة أو راجعها أولًا.");
        const previous=await tx.query<Row & {amount:string}>(`SELECT after_amount::text AS amount FROM finance.opening_corrections WHERE account_id=$1::bigint ORDER BY id DESC LIMIT 1`,[account.id]);
        openingSnapshot=previous.rows[0]?.amount ?? account.openingAmount; balanceSnapshot=formatCents(await balance(tx,account.id));
      }
    }
    const saved=await tx.query<IdRow>(`INSERT INTO finance.reconciliation_cases(kind,branch_id,account_id,sale_id,proposed_amount,possible_date,possible_handler,reason,opening_snapshot,balance_snapshot,created_by)
      VALUES($1,$2::bigint,$3::bigint,$4::bigint,$5::numeric,$6::date,$7,$8,$9::numeric,$10::numeric,$11::bigint) RETURNING id::text AS id`,
      [input.kind,input.branchId,input.accountId,input.saleId,input.proposedAmount,input.possibleDate,input.possibleHandler,input.reason,openingSnapshot,balanceSnapshot,actor.id]);
    // Touch, without changing revision or balance, so an older SERIALIZABLE
    // correction snapshot waiting on this account must retry and see the case.
    if (input.kind==="OPENING") await tx.query(`UPDATE finance.accounts SET revision=revision WHERE id=$1::bigint RETURNING id`,[input.accountId]);
    await audit(tx,"RECON_CASE",saved.rows[0].id,"CREATE",actor.id,input.reason,null,{...input,requestId:undefined,openingSnapshot,balanceSnapshot,financialChange:false});
    return saved.rows[0].id;
  });
}
export async function addReconciliationNote(db:FinanceDatabase,actorId:string,raw:unknown):Promise<WriteResult> {
  const value=inputObject(raw),input={requestId:requestId(value.requestId),caseId:identifier(value.caseId,"الحالة"),note:text(value.note,"ملاحظة المراجعة",300,true)!};
  return command(db,actorId,"RECON_CASE_NOTE",input.requestId,input,manage,async(tx,actor)=>{
    const item=await lockReconciliationCase(tx,input.caseId);await settlementBranch(tx,item.branchId,actor);
    const saved=await tx.query<IdRow>(`INSERT INTO finance.reconciliation_notes(case_id,note,created_by) VALUES($1::bigint,$2,$3::bigint) RETURNING id::text AS id`,[item.id,input.note,actor.id]);
    await tx.query(`UPDATE finance.reconciliation_cases SET revision=revision+1 WHERE id=$1::bigint`,[item.id]);
    await audit(tx,"RECON_CASE",item.id,"NOTE",actor.id,input.note,{revision:item.revision},{noteId:saved.rows[0].id,status:"OPEN",revision:item.revision+1,financialChange:false});
    return saved.rows[0].id;
  });
}
/** Closing without a linked action is an explicit reviewed decision, not a
 * financial adjustment. If uncertain, the case should remain OPEN. */
export async function closeReconciliationCase(db:FinanceDatabase,actorId:string,raw:unknown):Promise<WriteResult> {
  const value=inputObject(raw),input={requestId:requestId(value.requestId),caseId:identifier(value.caseId,"الحالة"),
    reason:text(value.reason,"سبب الإغلاق دون تغيير",300,true)!,expectedRevision:revision(value.expectedRevision),verifiedNoChange:confirmation(value.verifiedNoChange,"مراجعة الحالة وأنها لا تتطلب إجراءً ماليًا")};
  return command(db,actorId,"RECON_CASE_CLOSE",input.requestId,input,manage,async(tx,actor)=>{
    const item=await lockReconciliationCase(tx,input.caseId);await settlementBranch(tx,item.branchId,actor);
    if (item.revision!==input.expectedRevision) throw new FinanceProblem("case_changed","أُضيفت ملاحظة أو تغيرت الحالة منذ مراجعتها؛ افتحها وراجعها مجددًا.");
    await tx.query(`UPDATE finance.reconciliation_cases SET status='CLOSED',resolved_by=$1::bigint,resolved_at=CURRENT_TIMESTAMP,resolution_reason=$2,revision=revision+1 WHERE id=$3::bigint`,[actor.id,input.reason,item.id]);
    await audit(tx,"RECON_CASE",item.id,"CLOSE",actor.id,input.reason,{status:"OPEN"},{status:"CLOSED",financialChange:false});
    return item.id;
  });
}
export async function listReconciliationCases(db:FinanceDatabase,actorIdRaw:string,saleIdRaw?:string):Promise<ReconciliationCase[]> {
  const actorId=identifier(actorIdRaw,"المستخدم"),saleId=saleIdRaw===undefined?null:identifier(saleIdRaw,"الفاتورة");
  return db.serializable(async tx=>{const actor=await loadActor(tx,actorId);manage(actor);
    return (await tx.query<ReconciliationCase>(`SELECT ${caseColumns} FROM finance.reconciliation_cases c WHERE ($1::bigint IS NULL OR sale_id=$1::bigint) ORDER BY c.id DESC`,[saleId])).rows;
  });
}
export async function listReconciliationNotes(db:FinanceDatabase,actorIdRaw:string,saleIdRaw?:string):Promise<ReconciliationNote[]> {
  const actorId=identifier(actorIdRaw,"المستخدم"),saleId=saleIdRaw===undefined?null:identifier(saleIdRaw,"الفاتورة");
  return db.serializable(async tx=>{const actor=await loadActor(tx,actorId);manage(actor);
    return (await tx.query<ReconciliationNote>(`SELECT n.id::text AS id,n.case_id::text AS "caseId",n.note,n.created_by::text AS "createdBy",n.created_at::text AS "createdAt"
      FROM finance.reconciliation_notes n JOIN finance.reconciliation_cases c ON c.id=n.case_id WHERE ($1::bigint IS NULL OR c.sale_id=$1::bigint) ORDER BY n.id`,[saleId])).rows;
  });
}

export async function openAccount(db: FinanceDatabase, actorId: string, raw: unknown, today = cairoDate()): Promise<WriteResult> {
  const value = inputObject(raw);
  const input = {
    requestId: requestId(value.requestId), branchId: identifier(value.branchId, "الفرع"), kind: kind(value.kind),
    holderId: optionalIdentifier(value.holderId, "الموظف"), openingAmount: money(value.openingAmount, "رصيد البداية", true),
    openingDate: date(value.openingDate, "تاريخ الجرد"), counted: confirmation(value.counted, "الجرد الفعلي"),
  };
  if ((input.kind === "VAULT" && input.holderId !== null) || (input.kind === "CUSTODY" && input.holderId === null)) throw new FinanceProblem("invalid_input", "اختر موظف العهدة فقط، دون تعيين موظف لخزنة الفرع.");
  ensureNotFuture(input.openingDate, today);
  return command(db, actorId, "OPEN_ACCOUNT", input.requestId, input, manage, async (tx, actor) => {
    await activeBranch(tx, input.branchId);
    if (input.holderId) {
      const holder = await tx.query<Row & { id: string }>(`SELECT id::text AS id FROM public.users WHERE id=$1::bigint AND branch_id=$2::bigint AND status::text='ACTIVE' FOR SHARE`, [input.holderId, input.branchId]);
      if (!holder.rows[0]) throw new FinanceProblem("holder_unavailable", "الموظف غير نشط أو لا ينتمي إلى الفرع.");
    }
    const saved = await tx.query<IdRow>(`INSERT INTO finance.accounts (branch_id,kind,holder_id,opening_amount,opening_date,opened_by)
      VALUES($1::bigint,$2,$3::bigint,$4::numeric,$5::date,$6::bigint) RETURNING id::text AS id`, [input.branchId, input.kind, input.holderId, input.openingAmount, input.openingDate, actor.id]);
    const id = saved.rows[0].id;
    await audit(tx, "ACCOUNT", id, "OPEN", actor.id, null, null, { ...input, requestId: undefined });
    return id;
  });
}

/**
 * إقفال عهدة موظف. الإقفال **تسجيل لحالة، لا حركة مال**: فالعهدة تُصفَّر
 * بتسوية قبل إقفالها، ويُشترط رصيدها صفرًا — فلو أُقفل حسابٌ في ذمته نقد
 * لضاع الأثر على أن العهدة خرجت إلى الخزنة.
 *
 * ووُجد هذا الأمر لأن العهدة كانت تبقى إلى الأبد: فمن أخذ إجازة أو ترك العمل
 * بقيت عهدته تُحصى في «العهد القائمة» وتظهر له في «عهدتي» برصيد صفر، وإن
 * فُتحت له عهدة جديدة صار له حسابان، ولا يُعرف أيهما يُقرأ عند الجرد.
 *
 * وخزنة الفرع لا تُقفل: فهي واحدة لكل فرع بقيد في الجدول، وإقفالها يترك
 * الفرع بلا خزنة.
 */
export async function closeAccount(db: FinanceDatabase, actorId: string, raw: unknown): Promise<WriteResult> {
  const value = inputObject(raw);
  const input = {
    requestId: requestId(value.requestId),
    accountId: identifier(value.accountId, "الحساب"),
    reason: text(value.reason, "سبب الإقفال", 300),
  };
  return command(db, actorId, "CLOSE_ACCOUNT", input.requestId, input, manage, async (tx, actor) => {
    const found = await tx.query<Row & { id: string; kind: string; closedAt: string | null }>(`SELECT id::text AS id,
      kind, closed_at::text AS "closedAt" FROM finance.accounts WHERE id=$1::bigint FOR SHARE`, [input.accountId]);
    const account = found.rows[0];
    if (!account) throw new FinanceProblem("not_found", "الحساب غير موجود.");
    if (account.kind !== "CUSTODY") throw new FinanceProblem("invalid_input", "خزنة الفرع لا تُقفل؛ تُقفل عهد الموظفين فقط.");
    if (account.closedAt) throw new FinanceProblem("already_closed", "هذه العهدة مقفلة بالفعل.");
    const current = await balance(tx, input.accountId);
    if (current !== 0n) throw new FinanceProblem("balance_not_zero", `لا تُقفل العهدة وفي ذمتها ${formatCents(current)}. صفِّها بتسوية تحوّل رصيدها إلى الخزنة أولًا.`);
    await tx.query(`UPDATE finance.accounts SET closed_at=CURRENT_TIMESTAMP, closed_by=$2::bigint WHERE id=$1::bigint`, [input.accountId, actor.id]);
    await audit(tx, "ACCOUNT", input.accountId, "CLOSE", actor.id, input.reason || null, { closedAt: null }, { closedAt: "now" });
    return input.accountId;
  });
}

/** Verified correction of the recorded opening, not a physical cash event.
 * A later confirmed count is a checkpoint: only a documented, explicitly
 * attested zero-cash resolution is supported. Unknown/uncovered overlap stays
 * outside this command for a separately designed reconciliation. */
export async function correctOpeningBalance(db: FinanceDatabase, actorId: string, raw: unknown): Promise<WriteResult> {
  const value = inputObject(raw);
  const input = {
    requestId: requestId(value.requestId), accountId: identifier(value.accountId, "الحساب"),
    expectedOpening: money(value.expectedOpening, "رصيد البداية المعروض", true),
    correctedOpening: money(value.correctedOpening, "رصيد البداية الصحيح", true),
    expectedBalance: signedMoney(value.expectedBalance, "الرصيد الحالي الذي روجع"),
    coveredCountId: optionalIdentifier(value.coveredCountId, "الجرد الذي عالج الفرق"),
    pendingCaseId: optionalIdentifier(value.pendingCaseId,"الحالة المعلقة"),
    expectedCaseRevision:value.expectedCaseRevision===undefined||value.expectedCaseRevision===null||value.expectedCaseRevision==="" ? null : revision(value.expectedCaseRevision), caseReviewed: flag(value.caseReviewed),
    verifiedOpening: confirmation(value.verifiedOpening, "التحقق من رصيد البداية الفعلي"),
    noPriorSettlement: flag(value.noPriorSettlement), countCovered: flag(value.countCovered),
    negativeAcknowledged: flag(value.negativeAcknowledged),
    reason: text(value.reason, "سبب التصحيح ومرجع المراجعة", 300, true)!,
  };
  return command(db, actorId, "OPENING_CORRECTION", input.requestId, input, manage, async (tx, actor) => {
    const account = (await lockAccounts(tx, [input.accountId]))[0];
    await activeBranch(tx, account.branchId);
    const openCase=await tx.query<ReconciliationCase>(`SELECT ${caseColumns} FROM finance.reconciliation_cases WHERE kind='OPENING' AND account_id=$1::bigint AND status='OPEN' FOR UPDATE`,[account.id]);
    const linked=openCase.rows[0] ?? null;
    if (linked && (!input.pendingCaseId || linked.id!==input.pendingCaseId || !input.caseReviewed)) throw new FinanceProblem("case_review_required","توجد حالة افتتاح معلقة لهذا الحساب؛ راجعها واربطها بالتصحيح قبل التأكيد.");
    if (linked && linked.revision!==input.expectedCaseRevision) throw new FinanceProblem("case_changed","أُضيفت ملاحظة أو تغيرت الحالة منذ مراجعتها؛ افتحها وراجعها مجددًا.");
    if (!linked && input.pendingCaseId) throw new FinanceProblem("case_resolved","الحالة المحددة لم تعد معلقة لهذا الحساب.");
    const previous = await tx.query<Row & { amount: string }>(`SELECT after_amount::text AS amount FROM finance.opening_corrections WHERE account_id=$1::bigint ORDER BY id DESC LIMIT 1`, [account.id]);
    const before = previous.rows[0]?.amount ?? account.openingAmount;
    if (exactCents(before) !== exactCents(input.expectedOpening)) throw new FinanceProblem("revision_changed", "تغيّر رصيد البداية الذي روجع؛ افتح النموذج من جديد.");
    const diff = exactCents(input.correctedOpening) - exactCents(before);
    if (diff === 0n) throw new FinanceProblem("no_change", "رصيد البداية المؤكد يساوي الرصيد المسجّل حاليًا.");
    const current = await balance(tx, account.id);
    if (current !== exactCents(input.expectedBalance)) throw new FinanceProblem("balance_changed", "تغيّر رصيد الحساب؛ راجعه قبل التصحيح.", { currentBalance: formatCents(current) });
    const latest = await tx.query<IdRow>(`SELECT id::text AS id FROM finance.cash_counts WHERE account_id=$1::bigint AND status='CONFIRMED' ORDER BY id DESC LIMIT 1`, [account.id]);
    const countId = latest.rows[0]?.id ?? null;
    let resolution: "BOOK" | "COUNT_COVERED", projected: bigint;
    if (countId) {
      if (input.coveredCountId !== countId || !input.countCovered || input.noPriorSettlement || input.negativeAcknowledged) {
        throw new FinanceProblem("count_overlap", "يوجد جرد مؤكد بعد الافتتاح؛ لا يُسجل فرق دفتري جديد. إن ثبت أنه عالج الفرق، حدده وأكد ذلك؛ وإلا تبقى الحالة للمراجعة.");
      }
      resolution = "COUNT_COVERED"; projected = current;
    } else {
      if (input.coveredCountId || input.countCovered || !input.noPriorSettlement) throw new FinanceProblem("settlement_review_required", "أكد أن الفرق لم يُسوَّ سابقًا، أو اترك الحالة للمراجعة.");
      resolution = "BOOK"; projected = current + diff;
      if (projected < 0n && !input.negativeAcknowledged) throw new FinanceProblem("negative_warning", "سيصبح الرصيد سالبًا بعد التصحيح الدفتري؛ راجع الفرق وأكد التحذير.");
    }
    const saved = await tx.query<IdRow>(`INSERT INTO finance.opening_corrections(account_id,before_amount,after_amount,book_difference,resolution,covered_count_id,balance_before,balance_after,reason,created_by)
      VALUES($1::bigint,$2::numeric,$3::numeric,$4::numeric,$5,$6::bigint,$7::numeric,$8::numeric,$9,$10::bigint) RETURNING id::text AS id`,
      [account.id,before,input.correctedOpening,formatCents(diff),resolution,countId,formatCents(current),formatCents(projected),input.reason,actor.id]);
    let movementId: string | null = null;
    if (resolution === "BOOK") {
      const out = diff < 0n, amount = money(formatCents(out ? -diff : diff), "فرق الافتتاح");
      const movement = await tx.query<IdRow>(`INSERT INTO finance.movements(kind,branch_id,source_id,destination_id,amount,opening_correction_id,actor_id)
        VALUES('OPENING_CORRECTION',$1::bigint,$2::bigint,$3::bigint,$4::numeric,$5::bigint,$6::bigint) RETURNING id::text AS id`,
        [account.branchId,out ? account.id : null,out ? null : account.id,amount,saved.rows[0].id,actor.id]);
      movementId = movement.rows[0].id;
    }
    // Even a zero-cash annotation invalidates a pending count snapshot, so its
    // reviewer must reopen it after the account's audited state has changed.
    await bumpAccounts(tx,[account.id]);
    await audit(tx,"ACCOUNT",account.id,"CORRECT_OPENING",actor.id,input.reason,
      { recordedOpening: account.openingAmount, previousVerifiedOpening: before, balance: formatCents(current) },
      { correctionId: saved.rows[0].id, correctedOpening: input.correctedOpening, bookDifference: formatCents(diff), resolution,
        coveredCountId: countId, balanceBefore: formatCents(current), balanceAfter: formatCents(projected), movementId, actualCashMoved: false, pendingCaseId:linked?.id ?? null });
    if (linked) await confirmReconciliationCase(tx,linked,actor.id,input.reason,{openingCorrectionId:saved.rows[0].id});
    return saved.rows[0].id;
  });
}

export async function addCategory(db: FinanceDatabase, actorId: string, raw: unknown): Promise<WriteResult> {
  const value = inputObject(raw);
  const input = { requestId: requestId(value.requestId), name: text(value.name, "اسم البند", 120, true)! };
  return command(db, actorId, "CATEGORY_CREATE", input.requestId, input, manage, async (tx, actor) => {
    const id = tx.categoryPort
      ? await tx.categoryPort.create(input.name, actor.id, input.requestId)
      : (() => { throw new FinanceProblem("category_port_required", "إدارة البنود تحتاج منفذ البنود المعتمد؛ لم يُنفَّذ أي تغيير."); })();
    await audit(tx, "CATEGORY", id, "CREATE", actor.id, null, null, { name: input.name, active: true }); return id;
  });
}
export async function editCategory(db: FinanceDatabase, actorId: string, raw: unknown): Promise<WriteResult> {
  const value = inputObject(raw);
  if (typeof value.active !== "boolean") throw new FinanceProblem("invalid_input", "حدد حالة البند.");
  const expectedSnapshot = value.expectedSnapshot === undefined || value.expectedSnapshot === null ? null : value.expectedSnapshot;
  if (expectedSnapshot !== null && (typeof expectedSnapshot !== "string" || !/^[a-f0-9]{64}$/.test(expectedSnapshot))) throw new FinanceProblem("invalid_input", "راجع البند من جديد.");
  const input = { requestId: requestId(value.requestId), categoryId: identifier(value.categoryId, "البند"), expectedRevision: revision(value.expectedRevision), expectedSnapshot, name: text(value.name, "اسم البند", 120, true)!, active: value.active, reason: text(value.reason, "سبب التعديل", 300, true)! };
  return command(db, actorId, "CATEGORY_EDIT", input.requestId, input, manage, async (tx, actor) => {
    const category = await lockCategory(tx, input.categoryId); checkRevision(category.revision, input.expectedRevision);
    if (tx.categoryPort) await tx.categoryPort.edit(category, input, actor.id);
    else throw new FinanceProblem("category_port_required", "تعديل البنود يحتاج منفذ البنود المعتمد؛ لم يُنفَّذ أي تغيير.");
    await audit(tx, "CATEGORY", input.categoryId, "EDIT", actor.id, input.reason, category, { name: input.name, active: input.active });
    return input.categoryId;
  });
}

export async function createExpense(db: FinanceDatabase, actorId: string, raw: unknown): Promise<WriteResult> {
  const value = inputObject(raw), input = { requestId: requestId(value.requestId), ...parseExpenseFields(value) };
  return command(db, actorId, "EXPENSE_CREATE", input.requestId, input, expenseCreator(input.branchId), async (tx, actor) => {
    await activeBranch(tx, input.branchId); const category = await lockCategory(tx, input.categoryId);
    if (!category.active) throw new FinanceProblem("category_inactive", "بند المصروف متوقف؛ اختر بندًا آخر.");
    const result = await tx.query<IdRow>(`INSERT INTO finance.expenses(branch_id,category_id,category_snapshot,amount,expense_date,description,beneficiary,document_number,tax_amount,status,requested_by)
      VALUES($1::bigint,$2::bigint,$3,$4::numeric,$5::date,$6,$7,$8,$9::numeric,'PENDING',$10::bigint) RETURNING id::text AS id`,
      [input.branchId,input.categoryId,category.name,input.amount,input.expenseDate,input.description,input.beneficiary,input.documentNumber,input.taxAmount,actor.id]);
    const id = result.rows[0].id; await audit(tx, "EXPENSE", id, "CREATE", actor.id, null, null, { ...input, categorySnapshot: category.name, status: "PENDING", requestId: undefined }); return id;
  });
}

export async function editUnpaidExpense(db: FinanceDatabase, actorId: string, raw: unknown): Promise<WriteResult> {
  const value = inputObject(raw), input = { requestId: requestId(value.requestId), expenseId: identifier(value.expenseId, "المصروف"), expectedRevision: revision(value.expectedRevision), reason: text(value.reason, "سبب التصحيح", 300, true)!, ...parseExpenseFields(value) };
  return command(db, actorId, "EXPENSE_EDIT", input.requestId, input, manage, async (tx, actor) => {
    const old = await lockExpense(tx, input.expenseId); checkRevision(old.revision, input.expectedRevision);
    if (old.status === "PAID") throw new FinanceProblem("paid_correction_not_designed", "تصحيح المصروف المدفوع يحتاج مسار تسوية موثقًا لم يُعتمد بعد؛ لم يتغير السجل.");
    await activeBranch(tx, input.branchId); const category = await lockCategory(tx, input.categoryId);
    if (!category.active) throw new FinanceProblem("category_inactive", "بند المصروف متوقف؛ اختر بندًا آخر.");
    await tx.query(`UPDATE finance.expenses SET branch_id=$1::bigint,category_id=$2::bigint,category_snapshot=$3,amount=$4::numeric,
      expense_date=$5::date,description=$6,beneficiary=$7,document_number=$8,tax_amount=$9::numeric,status='PENDING',approved_by=NULL,approved_at=NULL,revision=revision+1 WHERE id=$10::bigint`,
      [input.branchId,input.categoryId,category.name,input.amount,input.expenseDate,input.description,input.beneficiary,input.documentNumber,input.taxAmount,input.expenseId]);
    await audit(tx, "EXPENSE", input.expenseId, "EDIT", actor.id, input.reason, old, { ...input, categorySnapshot: category.name, status: "PENDING", requestId: undefined }); return input.expenseId;
  });
}

export async function approveExpense(db: FinanceDatabase, actorId: string, raw: unknown): Promise<WriteResult> {
  const value = inputObject(raw), input = { requestId: requestId(value.requestId), expenseId: identifier(value.expenseId, "المصروف"), expectedRevision: revision(value.expectedRevision) };
  return command(db, actorId, "EXPENSE_APPROVE", input.requestId, input, manage, async (tx, actor) => {
    const expense = await lockExpense(tx, input.expenseId); checkRevision(expense.revision, input.expectedRevision);
    if (expense.status !== "PENDING") throw new FinanceProblem("wrong_status", "المصروف لا ينتظر الاعتماد.");
    await tx.query(`UPDATE finance.expenses SET status='APPROVED',approved_by=$1::bigint,approved_at=CURRENT_TIMESTAMP,revision=revision+1 WHERE id=$2::bigint`, [actor.id,input.expenseId]);
    await audit(tx, "EXPENSE", input.expenseId, "APPROVE", actor.id, null, { status: expense.status, revision: expense.revision }, { status: "APPROVED", approvedBy: actor.id }); return input.expenseId;
  });
}

export async function transferCash(db: FinanceDatabase, actorId: string, raw: unknown): Promise<WriteResult> {
  const value = inputObject(raw), input = {
    requestId: requestId(value.requestId), fromId: identifier(value.fromId, "مصدر النقد"), toId: identifier(value.toId, "مستلم النقد"),
    amount: money(value.amount, "المبلغ"), expectedBalance: signedMoney(value.expectedBalance, "الرصيد الذي روجع"),
    actuallyTransferred: confirmation(value.actuallyTransferred, "التسليم الفعلي"), negativeAcknowledged: flag(value.negativeAcknowledged),
  };
  if (input.fromId === input.toId) throw new FinanceProblem("invalid_transfer", "اختر حسابين مختلفين.");
  return command(db, actorId, "TRANSFER", input.requestId, input, transferActor, async (tx, actor) => {
    const locked = await lockAccounts(tx, [input.fromId,input.toId]), from = locked.find((a) => a.id === input.fromId)!, to = locked.find((a) => a.id === input.toId)!;
    if (from.branchId !== to.branchId || from.kind === to.kind) throw new FinanceProblem("invalid_transfer", "التسليم بين خزنة وعهدة في الفرع نفسه فقط.");
    // الموظف: عهدته وحدها، وإلى خزنة فرعه وحدها. فلا يمسّ خزنةً يَقبض منها،
    // ولا عهدة زميلٍ له في الفرع نفسه.
    if (actor.role === "CS_AGENT") {
      if (from.kind !== "CUSTODY" || String(from.holderId ?? "") !== String(actor.id))
        throw new FinanceProblem("forbidden", "لا يمكنك التسليم إلا من عهدتك أنت.");
      if (to.kind !== "VAULT" || to.branchId !== actor.branchId)
        throw new FinanceProblem("forbidden", "تُسلَّم العهدة إلى خزنة فرعك فقط.");
    }
    await activeBranch(tx, from.branchId);
    const current = await balance(tx, from.id), projected = checkBalance(current, input.expectedBalance, exactCents(input.amount), input.negativeAcknowledged);
    const result = await tx.query<IdRow>(`INSERT INTO finance.movements(kind,branch_id,source_id,destination_id,amount,actor_id)
      VALUES('TRANSFER',$1::bigint,$2::bigint,$3::bigint,$4::numeric,$5::bigint) RETURNING id::text AS id`, [from.branchId,from.id,to.id,input.amount,actor.id]);
    await bumpAccounts(tx, [from.id,to.id]);
    const id = result.rows[0].id; await audit(tx, "MOVEMENT", id, "TRANSFER", actor.id, null, { sourceBalance: formatCents(current) }, { fromId: from.id, toId: to.id, amount: input.amount, projectedBalance: formatCents(projected), negativeAcknowledged: input.negativeAcknowledged }); return id;
  });
}

export async function payExpense(db: FinanceDatabase, actorId: string, raw: unknown, today = cairoDate()): Promise<WriteResult> {
  const value = inputObject(raw);
  const input = {
    requestId: requestId(value.requestId), expenseId: identifier(value.expenseId, "المصروف"), expectedRevision: revision(value.expectedRevision),
    method: method(value.method), accountId: optionalIdentifier(value.accountId, "مصدر النقد"), paymentDate: date(value.paymentDate, "تاريخ الدفع الفعلي"),
    actuallyPaid: confirmation(value.actuallyPaid, "الدفع الفعلي"), openingOrder: openingOrder(value.openingOrder), includedInOpening: flag(value.includedInOpening),
    afterCountId: optionalIdentifier(value.afterCountId, "آخر جرد مؤكد"), afterCount: flag(value.afterCount),
    expectedBalance: value.expectedBalance === null || value.expectedBalance === undefined || value.expectedBalance === "" ? null : signedMoney(value.expectedBalance, "الرصيد الذي روجع"),
    negativeAcknowledged: flag(value.negativeAcknowledged),
    // ACCOUNT = خصم فوري من حساب (السلوك السابق). HOLDER_CASH = صُرف من نقد الموظف ويُسوّى في التسوية.
    source: paymentSource(value.source),
  };
  ensureNotFuture(input.paymentDate, today);
  if (input.source === "HOLDER_CASH") {
    if (input.method !== "CASH") throw new FinanceProblem("invalid_input", "الصرف من نقد الموظف نقدي فقط.");
    if (input.accountId) throw new FinanceProblem("invalid_input", "الصرف من نقد الموظف لا يستخدم حسابًا نقديًا.");
    if (input.openingOrder !== null || input.includedInOpening || input.afterCountId !== null || input.expectedBalance !== null || input.negativeAcknowledged)
      throw new FinanceProblem("invalid_input", "الصرف من نقد الموظف يُسوّى في التسوية، فلا يرتبط بجرد أو برصيد افتتاحي.");
  } else if ((input.method === "CASH" && !input.accountId) || (input.method !== "CASH" && input.accountId)) {
    throw new FinanceProblem("invalid_input", "اختر مصدرًا للنقد فقط عند الدفع النقدي.");
  }
  if (Boolean(input.afterCountId) !== input.afterCount) throw new FinanceProblem("invalid_input", "أكد ترتيب الدفع بعد الجرد وحدد الجرد الذي راجعته معًا.");
  if (input.method !== "CASH" && (input.openingOrder !== null || input.includedInOpening || input.afterCountId !== null || input.expectedBalance !== null || input.negativeAcknowledged)) throw new FinanceProblem("invalid_input", "الدفع غير النقدي لا يستخدم حسابًا نقديًا أو جردًا نقديًا.");
  return command(db, actorId, "EXPENSE_PAY", input.requestId, input, expensePayer(input.source), async (tx, actor) => {
    const expense = await lockExpense(tx, input.expenseId); checkRevision(expense.revision, input.expectedRevision);
    if (expense.status !== "APPROVED") throw new FinanceProblem("wrong_status", "يمكن تسجيل صرف مصروف معتمد لم يُدفع سابقًا فقط.");
    await settlementBranch(tx,expense.branchId,actor);
    if (input.source === "HOLDER_CASH" && !canManageFinance(actor) && !(actor.role === "CS_AGENT" && expense.requestedBy === actor.id))
      throw new FinanceProblem("forbidden", "الصرف من نقد الموظف للإدارة، أو للموظف عن مصروف أنشأه هو وصرفه من نقده.");
    let source: AccountRow | null = null, historical = false, current: bigint | null = null, projected: bigint | null = null;
    if (input.source === "HOLDER_CASH") {
      // النقد خرج من يد الموظف فعلًا: بلا حركة نقدية، ويُجمع ضمن مصروفات فترته في التسوية.
    } else if (input.method === "CASH") {
      source = (await lockAccounts(tx, [input.accountId!]))[0];
      if (source.branchId !== expense.branchId) throw new FinanceProblem("account_branch", "مصدر النقد يجب أن يكون في فرع المصروف.");
      await activeBranch(tx, expense.branchId);
      if (input.paymentDate === source.openingDate && input.openingOrder === null) throw new FinanceProblem("opening_order_required", "حدد هل الدفع في يوم الجرد قبله أم بعده.");
      if (input.paymentDate !== source.openingDate && input.openingOrder !== null) throw new FinanceProblem("invalid_input", "تحديد قبل أو بعد الجرد مطلوب في يوم الجرد نفسه فقط.");
      historical = input.paymentDate < source.openingDate || (input.paymentDate === source.openingDate && input.openingOrder === "BEFORE");
      if (historical) {
        if (!input.includedInOpening) throw new FinanceProblem("historical_confirmation", "أكد أن الدفع سبق الجرد وأن الرصيد الافتتاحي يعكسه.");
        if (input.negativeAcknowledged || input.expectedBalance !== null || input.afterCountId !== null) throw new FinanceProblem("invalid_input", "الدفع التاريخي لا يحتاج تأكيد رصيد أو ينشئ خصمًا جديدًا.");
      } else {
        if (input.includedInOpening) throw new FinanceProblem("invalid_input", "لا يمكن اعتبار دفع بعد الجرد مشمولًا في رصيد بدايته.");
        // A count after actual payment may already include it. On the same day,
        // permit a new debit only with explicit evidence that the physical payment
        // occurred AFTER the latest confirmed count the operator actually saw.
        const overlap = await tx.query<Row & { id: string; countedOn: string }>(`SELECT id::text AS id,counted_on::text AS "countedOn" FROM finance.cash_counts WHERE account_id=$1::bigint AND status='CONFIRMED' AND counted_on >= $2::date ORDER BY counted_on DESC,id DESC LIMIT 1`, [source.id,input.paymentDate]);
        const latest = overlap.rows[0];
        if (latest && latest.countedOn > input.paymentDate) throw new FinanceProblem("count_overlap", "يوجد جرد مؤكد بعد يوم الدفع؛ قد يكون الدفع انعكس فيه. لن يُخصم مجددًا قبل المراجعة اليدوية.");
        if (latest && (input.afterCountId !== latest.id || !input.afterCount)) throw new FinanceProblem("count_order_required", "راجع آخر جرد مؤكد اليوم وأكد أن الدفع الفعلي حدث بعده، أو أوقف العملية للمراجعة اليدوية.");
        if (!latest && input.afterCountId !== null) throw new FinanceProblem("count_order_required", "تغير الجرد الذي روجع؛ افتح النموذج وراجع ترتيب الدفع مجددًا.");
        current = await balance(tx, source.id); projected = checkBalance(current, input.expectedBalance, exactCents(expense.amount), input.negativeAcknowledged);
      }
    }
    const payment = await tx.query<IdRow>(`INSERT INTO finance.payments(expense_id,amount,method,account_id,payment_date,recorded_by,actually_paid,historical,opening_order,included_in_opening,after_cash_count_id,source)
      VALUES($1::bigint,$2::numeric,$3,$4::bigint,$5::date,$6::bigint,$7,$8,$9,$10,$11::bigint,$12) RETURNING id::text AS id`,
      [expense.id,expense.amount,input.method,source?.id ?? null,input.paymentDate,actor.id,input.actuallyPaid,historical,input.openingOrder,input.includedInOpening,input.afterCountId,input.source]);
    if (source && !historical) {
      await tx.query(`INSERT INTO finance.movements(kind,branch_id,source_id,amount,expense_payment_id,actor_id)
        VALUES('EXPENSE',$1::bigint,$2::bigint,$3::numeric,$4::bigint,$5::bigint)`, [expense.branchId,source.id,expense.amount,payment.rows[0].id,actor.id]);
      await bumpAccounts(tx, [source.id]);
    }
    await tx.query(`UPDATE finance.expenses SET status='PAID',revision=revision+1 WHERE id=$1::bigint`, [expense.id]);
    await audit(tx, "EXPENSE", expense.id, "PAY", actor.id, null, { status: expense.status, revision: expense.revision },
      { paymentId: payment.rows[0].id, amount: expense.amount, method: input.method, source: input.source, accountId: source?.id ?? null, paymentDate: input.paymentDate, historical, openingOrder: input.openingOrder, includedInOpening: input.includedInOpening, afterCountId: input.afterCountId, currentBalance: current === null ? null : formatCents(current), projectedBalance: projected === null ? null : formatCents(projected), negativeAcknowledged: input.negativeAcknowledged });
    return payment.rows[0].id;
  });
}

/**
 * Open a manual review for a paid record. Proposed values are unverified and
 * never change the original expense, payment, cash account, or movements.
 * Resolution is a separate, explicit command; opening the review never changes money.
 */
export async function requestPaidExpenseReview(db: FinanceDatabase, actorId: string, raw: unknown): Promise<WriteResult> {
  const value = inputObject(raw), input = {
    requestId: requestId(value.requestId), expenseId: identifier(value.expenseId, "المصروف"),
    expectedRevision: revision(value.expectedRevision), reason: text(value.reason, "سبب المراجعة", 300, true)!,
    proposedAmount: optionalMoney(value.proposedAmount, "المبلغ المقترح للمراجعة"),
  };
  return command(db, actorId, "EXPENSE_REVIEW_CREATE", input.requestId, input, manage, async (tx, actor) => {
    const expense = await lockExpense(tx, input.expenseId); checkRevision(expense.revision, input.expectedRevision);
    if (expense.status !== "PAID") throw new FinanceProblem("wrong_status", "طلب المراجعة هذا يخص مصروفًا مسجلًا كمدفوع فقط.");
    const existing = await tx.query<IdRow>(`SELECT id::text AS id FROM finance.expense_reviews WHERE expense_id=$1::bigint AND status='OPEN'`, [expense.id]);
    if (existing.rows[0]) throw new FinanceProblem("review_exists", "يوجد طلب مراجعة مفتوح لهذا المصروف؛ راجعه قبل إنشاء طلب آخر.");
    const result = await tx.query<Row>(`SELECT id::text AS id,amount::text AS amount,method,account_id::text AS "accountId",payment_date::text AS "paymentDate",
      recorded_at::text AS "recordedAt",recorded_by::text AS "recordedBy",historical,opening_order AS "openingOrder",after_cash_count_id::text AS "afterCountId"
      FROM finance.payments WHERE expense_id=$1::bigint FOR SHARE`, [expense.id]);
    if (!result.rows[0]) throw new FinanceProblem("inconsistent_record", "تفاصيل الدفع غير مكتملة؛ لم يُنشأ طلب مراجعة.");
    const previous = await tx.query<Row & { amount: string }>(`SELECT after_amount::text AS amount FROM finance.expense_corrections WHERE expense_id=$1::bigint ORDER BY id DESC LIMIT 1`, [expense.id]);
    const snapshot = { expense, payment: result.rows[0], effectiveAmount: previous.rows[0]?.amount ?? expense.amount };
    const saved = await tx.query<IdRow>(`INSERT INTO finance.expense_reviews(expense_id,expense_revision,proposed_amount,reason,original_snapshot,created_by)
      VALUES($1::bigint,$2,$3::numeric,$4,$5::jsonb,$6::bigint) RETURNING id::text AS id`,
      [expense.id,expense.revision,input.proposedAmount,input.reason,JSON.stringify(snapshot),actor.id]);
    const id = saved.rows[0].id;
    await audit(tx, "EXPENSE_REVIEW", id, "CREATE", actor.id, input.reason, null, { expenseId: expense.id, expenseRevision: expense.revision, proposedAmount: input.proposedAmount, status: "OPEN" });
    return id;
  });
}

/** A counted observation does not change money; it snapshots a locked account.
 * Only a later, separately confirmed review may post its signed difference. */
export async function requestCashCount(db: FinanceDatabase, actorId: string, raw: unknown, today = cairoDate()): Promise<WriteResult> {
  const value = inputObject(raw), input = {
    requestId: requestId(value.requestId), accountId: identifier(value.accountId, "الحساب"),
    expectedBalance: signedMoney(value.expectedBalance, "الرصيد المعروض"), countedAmount: money(value.countedAmount, "النقد المعدود", true),
    reason: text(value.reason, "سبب الجرد", 300, true)!, actuallyCounted: confirmation(value.actuallyCounted, "الجرد الفعلي الحالي"),
  };
  return command(db, actorId, "CASH_COUNT_CREATE", input.requestId, input, manage, async (tx, actor) => {
    const account = (await lockAccounts(tx,[input.accountId]))[0];
    await activeBranch(tx, account.branchId);
    const pending = await tx.query<IdRow>(`SELECT id::text AS id FROM finance.cash_counts WHERE account_id=$1::bigint AND status='OPEN'`, [account.id]);
    if (pending.rows[0]) throw new FinanceProblem("count_exists", "يوجد جرد مفتوح لهذا الحساب؛ راجعه أو ألغِه بسبب قبل تسجيل جرد آخر.");
    const current = await balance(tx, account.id);
    // الجرد يقيس «ما يجب أن يكون في اليد» لا الرصيد الدفتري وحده. مبيعات الفترة
    // ومصروفاتها من نقد الموظف لم تُسوَ بعد، فالرصيد الدفتري يتجاهلها: المقارنة
    // به تخترع عجزًا بقيمة المصروف، ثم تخصمه التسوية مرة أخرى فينقص رصيد العهدة
    // بلا سبب ولا يُردّ المصروف للموظف. العهدة وحدها تحمل مبيعات ومصروفات؛
    // خزنة الفرع لا تُسوّى، فمرجعها رصيدها الدفتري.
    const period = account.kind === "CUSTODY" ? await settlementPeriod(tx, account.id, account.branchId) : null;
    const expectedInHand = current + (period?.sales ?? 0n) - (period?.expenses ?? 0n);
    if (expectedInHand !== exactCents(input.expectedBalance)) throw new FinanceProblem("balance_changed", "تغير الرصيد المتوقع في اليد؛ أعد الجرد والمراجعة قبل التسجيل.");
    const difference = exactCents(input.countedAmount) - expectedInHand;
    // One movement has a bounded NUMERIC(14,2) amount; don't partially settle an extreme difference.
    if (difference !== 0n) money(formatCents(difference < 0n ? -difference : difference), "فرق الجرد");
    const saved = await tx.query<IdRow>(`INSERT INTO finance.cash_counts(account_id,counted_amount,observed_balance,difference,account_revision,counted_on,reason,created_by)
      VALUES($1::bigint,$2::numeric,$3::numeric,$4::numeric,$5::bigint,$6::date,$7,$8::bigint) RETURNING id::text AS id`,
      [account.id,input.countedAmount,formatCents(current),formatCents(difference),account.revision,today,input.reason,actor.id]);
    await audit(tx, "CASH_COUNT", saved.rows[0].id, "CREATE", actor.id, input.reason, null,
      { accountId: account.id, observedBalance: formatCents(current), countedAmount: input.countedAmount, difference: formatCents(difference), accountRevision: account.revision, countedOn: today, status: "OPEN" });
    return saved.rows[0].id;
  });
}

/** Confirm only if the account has not had ANY intervening movement, even if
 * the resulting balance happens to match. The operator must affirm the count
 * still reflects actual cash; a posted adjustment is not revenue or an expense. */
export async function confirmCashCount(db: FinanceDatabase, actorId: string, raw: unknown): Promise<WriteResult> {
  const value = inputObject(raw), input = { requestId: requestId(value.requestId), countId: identifier(value.countId, "الجرد"),
    reason: text(value.reason, "سبب تأكيد الجرد", 300, true)!, stillCurrent: confirmation(value.stillCurrent, "أن النقد المعدود ما زال فعليًا ولم تقع حركة بعد الجرد") };
  return command(db, actorId, "CASH_COUNT_CONFIRM", input.requestId, input, manage, async (tx, actor) => {
    const ref = await tx.query<Row & { accountId: string }>(`SELECT account_id::text AS "accountId" FROM finance.cash_counts WHERE id=$1::bigint`, [input.countId]);
    if (!ref.rows[0]) throw new FinanceProblem("not_found", "طلب الجرد غير موجود.");
    const account = (await lockAccounts(tx,[ref.rows[0].accountId]))[0];
    await activeBranch(tx, account.branchId);
    const counts = await tx.query<CashCountRow>(`SELECT id::text AS id,account_id::text AS "accountId",counted_amount::text AS "countedAmount",observed_balance::text AS "observedBalance",
      difference::text AS difference,account_revision::text AS "accountRevision",counted_on::text AS "countedOn",reason,status,created_by::text AS "createdBy",created_at::text AS "createdAt",
      resolved_by::text AS "resolvedBy",resolved_at::text AS "resolvedAt",resolution_reason AS "resolutionReason" FROM finance.cash_counts WHERE id=$1::bigint FOR UPDATE`, [input.countId]);
    const count = counts.rows[0];
    if (!count || count.status !== "OPEN") throw new FinanceProblem("count_closed", "طلب الجرد غير مفتوح؛ راجع سجله.");
    const current = await balance(tx,account.id);
    const period = account.kind === "CUSTODY" ? await settlementPeriod(tx, account.id, account.branchId) : null;
    const expectedInHand = current + (period?.sales ?? 0n) - (period?.expenses ?? 0n);
    if (account.revision !== count.accountRevision || expectedInHand !== exactCents(count.observedBalance)) throw new FinanceProblem("count_stale", "حدثت حركة أو تحصيل أو مصروف بعد الجرد؛ ألغِ الطلب بسبب واضح وأعد الجرد قبل التسوية.");
    const difference = exactCents(count.difference);
    if (difference !== exactCents(count.countedAmount) - expectedInHand) throw new FinanceProblem("inconsistent_record", "بيانات فرق الجرد غير متطابقة؛ لم تُحفظ التسوية.");
    let movementId: string | null = null;
    if (difference !== 0n) {
      const out = difference < 0n, amount = formatCents(out ? -difference : difference);
      money(amount, "فرق الجرد");
      const movement = await tx.query<IdRow>(`INSERT INTO finance.movements(kind,branch_id,source_id,destination_id,amount,cash_count_id,actor_id)
        VALUES('COUNT_ADJUSTMENT',$1::bigint,$2::bigint,$3::bigint,$4::numeric,$5::bigint,$6::bigint) RETURNING id::text AS id`,
        [account.branchId,out ? account.id : null,out ? null : account.id,amount,count.id,actor.id]);
      movementId = movement.rows[0].id;
    }
    // A matching count is still an explicit reconciliation checkpoint.
    await bumpAccounts(tx,[account.id]);
    await tx.query(`UPDATE finance.cash_counts SET status='CONFIRMED',resolved_by=$1::bigint,resolved_at=CURRENT_TIMESTAMP,resolution_reason=$2 WHERE id=$3::bigint`, [actor.id,input.reason,count.id]);
    await audit(tx, "CASH_COUNT", count.id, "CONFIRM", actor.id, input.reason, { ...count, currentBalance: formatCents(current) },
      { status: "CONFIRMED", countedAmount: count.countedAmount, difference: count.difference, movementId, actualCashMoved: false });
    return count.id;
  });
}

/** Allow a stale or mistaken observation to be abandoned without touching cash. */
export async function cancelCashCount(db: FinanceDatabase, actorId: string, raw: unknown): Promise<WriteResult> {
  const value = inputObject(raw), input = { requestId: requestId(value.requestId), countId: identifier(value.countId, "الجرد"), reason: text(value.reason, "سبب إلغاء طلب الجرد", 300, true)! };
  return command(db, actorId, "CASH_COUNT_CANCEL", input.requestId, input, manage, async (tx, actor) => {
    const rows = await tx.query<Row & { id: string; status: string }>(`SELECT id::text AS id,status FROM finance.cash_counts WHERE id=$1::bigint FOR UPDATE`, [input.countId]);
    if (!rows.rows[0] || rows.rows[0].status !== "OPEN") throw new FinanceProblem("count_closed", "طلب الجرد غير مفتوح؛ راجع سجله.");
    await tx.query(`UPDATE finance.cash_counts SET status='CANCELLED',resolved_by=$1::bigint,resolved_at=CURRENT_TIMESTAMP,resolution_reason=$2 WHERE id=$3::bigint`, [actor.id,input.reason,input.countId]);
    await audit(tx,"CASH_COUNT",input.countId,"CANCEL",actor.id,input.reason,{status:"OPEN"},{status:"CANCELLED",actualCashMoved:false});
    return input.countId;
  });
}

/** Confirm a corrected paid amount only after a separate reviewed request.
 * Original expense/payment rows are never rewritten; a book-only delta can
 * affect the original cash account. Historical and noncash payments never do. */
export async function confirmPaidExpenseCorrection(db: FinanceDatabase, actorId: string, raw: unknown): Promise<WriteResult> {
  const value = inputObject(raw), input = {
    requestId: requestId(value.requestId), reviewId: identifier(value.reviewId, "المراجعة"), confirmedAmount: money(value.confirmedAmount, "المبلغ الفعلي المصحح"),
    reason: text(value.reason, "سبب التصحيح", 300, true)!, verifiedPayment: confirmation(value.verifiedPayment, "التحقق من مبلغ الدفع الأصلي ووسيلته ومصدره"),
    noPriorSettlement: confirmation(value.noPriorSettlement, "أن الفرق لم يُسوَّ سابقًا"),
    expectedBalance: value.expectedBalance === null || value.expectedBalance === undefined || value.expectedBalance === "" ? null : signedMoney(value.expectedBalance, "الرصيد المعروض"),
    negativeAcknowledged: flag(value.negativeAcknowledged),
  };
  return command(db, actorId, "EXPENSE_REVIEW_CONFIRM", input.requestId, input, manage, async (tx, actor) => {
    const ref = await tx.query<Row & { expenseId: string }>(`SELECT expense_id::text AS "expenseId" FROM finance.expense_reviews WHERE id=$1::bigint`, [input.reviewId]);
    if (!ref.rows[0]) throw new FinanceProblem("not_found", "المراجعة غير موجودة.");
    const expense = await lockExpense(tx,ref.rows[0].expenseId);
    const reviews = await tx.query<PaidExpenseReviewRow>(`SELECT id::text AS id,expense_id::text AS "expenseId",expense_revision AS "expenseRevision",proposed_amount::text AS "proposedAmount",
      reason,original_snapshot AS "originalSnapshot",status,created_by::text AS "createdBy",created_at::text AS "createdAt" FROM finance.expense_reviews WHERE id=$1::bigint FOR UPDATE`, [input.reviewId]);
    const review=reviews.rows[0];
    if (!review || review.status !== "OPEN" || expense.status !== "PAID") throw new FinanceProblem("review_closed", "المراجعة ليست مفتوحة لمصروف مدفوع.");
    await settlementBranch(tx,expense.branchId,actor);
    checkRevision(expense.revision,review.expenseRevision);
    const payments=await tx.query<PaymentRow>(`SELECT id::text AS id,amount::text AS amount,method,account_id::text AS "accountId",payment_date::text AS "paymentDate",
      recorded_at::text AS "recordedAt",recorded_by::text AS "recordedBy",historical,opening_order AS "openingOrder",after_cash_count_id::text AS "afterCountId"
      FROM finance.payments WHERE expense_id=$1::bigint FOR SHARE`,[expense.id]);
    const payment=payments.rows[0]; if (!payment) throw new FinanceProblem("inconsistent_record", "تفاصيل الدفع غير مكتملة؛ لم يُحفظ التصحيح.");
    const previous=await tx.query<Row & { amount:string }>(`SELECT after_amount::text AS amount FROM finance.expense_corrections WHERE expense_id=$1::bigint ORDER BY id DESC LIMIT 1`,[expense.id]);
    const before=previous.rows[0]?.amount ?? expense.amount, difference=exactCents(before)-exactCents(input.confirmedAmount);
    if (difference === 0n) throw new FinanceProblem("no_change", "المبلغ المؤكد يساوي المبلغ الحالي؛ لا يوجد تصحيح لحفظه.");
    if (expense.taxAmount !== null && exactCents(expense.taxAmount) > exactCents(input.confirmedAmount)) throw new FinanceProblem("tax_review_required", "الضريبة المسجلة تتجاوز المبلغ المصحح؛ راجع الضريبة منفصلًا قبل التصحيح.");
    let account:AccountRow | null=null,current:bigint | null=null,projected:bigint | null=null;
    if (payment.method === "CASH" && !payment.historical) {
      if (!payment.accountId) throw new FinanceProblem("inconsistent_record", "مصدر الدفع غير محفوظ؛ لم يُحفظ التصحيح.");
      account=(await lockAccounts(tx,[payment.accountId]))[0];
      if (account.branchId !== expense.branchId) throw new FinanceProblem("inconsistent_record", "مصدر الدفع لا يطابق فرع المصروف.");
      const original=await tx.query<Row & { sourceId:string; amount:string }>(`SELECT source_id::text AS "sourceId",amount::text AS amount FROM finance.movements WHERE kind='EXPENSE' AND expense_payment_id=$1::bigint`,[payment.id]);
      if (!original.rows[0] || original.rows[0].sourceId !== account.id || exactCents(original.rows[0].amount) !== exactCents(payment.amount)) throw new FinanceProblem("inconsistent_record", "حركة الدفع الأصلية غير متطابقة؛ تحتاج مراجعة يدوية.");
      // A later (or same-day ambiguous) confirmed count may already include this
      // difference. Refuse to post a second book adjustment automatically.
      const overlap=await tx.query<IdRow>(`SELECT id::text AS id FROM finance.cash_counts WHERE account_id=$1::bigint AND status='CONFIRMED' AND counted_on >= $2::date
        AND (counted_on > $2::date OR $3::bigint IS NULL OR id > $3::bigint) LIMIT 1`,[account.id,payment.paymentDate,payment.afterCountId]);
      if (overlap.rows[0]) throw new FinanceProblem("count_overlap", "يوجد جرد مؤكد بعد الدفع أو في يوم ترتيبُه غير محسوم؛ قد يكون الفرق سُوّي بالفعل، فتبقى المراجعة مفتوحة للفحص اليدوي.");
      current=await balance(tx,account.id);
      if (input.expectedBalance === null || current !== exactCents(input.expectedBalance)) throw new FinanceProblem("balance_changed", "راجع رصيد حساب الدفع الحالي قبل تأكيد التصحيح.");
      projected=current+difference;
      if (projected < 0n && !input.negativeAcknowledged) throw new FinanceProblem("negative_warning", "سيصبح رصيد الحساب سالبًا بعد التصحيح الدفتري؛ راجع الفرق وأكد التحذير.");
    } else if (input.expectedBalance !== null || input.negativeAcknowledged) throw new FinanceProblem("invalid_input", "التصحيح غير النقدي أو المحتسب في الجرد لا يستخدم تأكيد رصيد نقدي.");
    const saved=await tx.query<IdRow>(`INSERT INTO finance.expense_corrections(expense_id,payment_id,review_id,before_amount,after_amount,reason,created_by,account_id,book_difference,balance_before,balance_after)
      VALUES($1::bigint,$2::bigint,$3::bigint,$4::numeric,$5::numeric,$6,$7::bigint,$8::bigint,$9::numeric,$10::numeric,$11::numeric) RETURNING id::text AS id`,
      [expense.id,payment.id,review.id,before,input.confirmedAmount,input.reason,actor.id,account?.id ?? null,account ? formatCents(difference) : null,current===null?null:formatCents(current),projected===null?null:formatCents(projected)]);
    let movementId:string|null=null;
    if (account) {
      const out=difference<0n, amount=formatCents(out?-difference:difference);
      const movement=await tx.query<IdRow>(`INSERT INTO finance.movements(kind,branch_id,source_id,destination_id,amount,expense_correction_id,actor_id)
        VALUES('EXPENSE_CORRECTION',$1::bigint,$2::bigint,$3::bigint,$4::numeric,$5::bigint,$6::bigint) RETURNING id::text AS id`,
        [account.branchId,out?account.id:null,out?null:account.id,amount,saved.rows[0].id,actor.id]);
      movementId=movement.rows[0].id;await bumpAccounts(tx,[account.id]);
    }
    await tx.query(`UPDATE finance.expenses SET revision=revision+1 WHERE id=$1::bigint`,[expense.id]);
    await tx.query(`UPDATE finance.expense_reviews SET status='CORRECTED',resolved_by=$1::bigint,resolved_at=CURRENT_TIMESTAMP,resolution_reason=$2 WHERE id=$3::bigint`,[actor.id,input.reason,review.id]);
    const outcome={ correctionId:saved.rows[0].id, reviewId:review.id, beforeAmount:before, afterAmount:input.confirmedAmount, paymentId:payment.id, accountId:account?.id ?? null,
      cashDifference:account?formatCents(difference):null, beforeBalance:current===null?null:formatCents(current), afterBalance:projected===null?null:formatCents(projected), movementId, historical:payment.historical, actualCashMoved:false };
    await audit(tx,"EXPENSE",expense.id,"CORRECT_PAID",actor.id,input.reason,{ expense, payment, effectiveAmount:before, review: { id:review.id, reason:review.reason, proposedAmount:review.proposedAmount, createdBy:review.createdBy, createdAt:review.createdAt } },outcome);
    await audit(tx,"EXPENSE_REVIEW",review.id,"CONFIRM",actor.id,input.reason,{ status:"OPEN" },outcome);
    return saved.rows[0].id;
  });
}

/** Close an investigated report without changing the paid record or balance.
 * This is explicit and reasoned, not an automatic resolution of overlap. */
export async function closePaidExpenseReview(db: FinanceDatabase, actorId: string, raw: unknown): Promise<WriteResult> {
  const value=inputObject(raw),input={requestId:requestId(value.requestId),reviewId:identifier(value.reviewId,"المراجعة"),reason:text(value.reason,"سبب إغلاق المراجعة دون تصحيح",300,true)!};
  return command(db,actorId,"EXPENSE_REVIEW_CLOSE",input.requestId,input,manage,async(tx,actor)=>{
    const ref=await tx.query<Row & {expenseId:string}>(`SELECT expense_id::text AS "expenseId" FROM finance.expense_reviews WHERE id=$1::bigint`,[input.reviewId]);
    if(!ref.rows[0]) throw new FinanceProblem("not_found","المراجعة غير موجودة.");
    const expense=await lockExpense(tx,ref.rows[0].expenseId);
    const rows=await tx.query<PaidExpenseReviewRow>(`SELECT id::text AS id,expense_id::text AS "expenseId",expense_revision AS "expenseRevision",proposed_amount::text AS "proposedAmount",reason,original_snapshot AS "originalSnapshot",status,created_by::text AS "createdBy",created_at::text AS "createdAt" FROM finance.expense_reviews WHERE id=$1::bigint FOR UPDATE`,[input.reviewId]);
    const review=rows.rows[0];if(!review || review.status!=="OPEN" || expense.status!=="PAID") throw new FinanceProblem("review_closed","المراجعة ليست مفتوحة لمصروف مدفوع.");
    await tx.query(`UPDATE finance.expense_reviews SET status='CLOSED',resolved_by=$1::bigint,resolved_at=CURRENT_TIMESTAMP,resolution_reason=$2 WHERE id=$3::bigint`,[actor.id,input.reason,review.id]);
    const old={reviewId:review.id,reason:review.reason,proposedAmount:review.proposedAmount,createdBy:review.createdBy,createdAt:review.createdAt};
    const outcome={status:"CLOSED",correctionMade:false,actualCashMoved:false};
    await audit(tx,"EXPENSE",expense.id,"CLOSE_REVIEW_NO_CHANGE",actor.id,input.reason,old,outcome);
    await audit(tx,"EXPENSE_REVIEW",review.id,"CLOSE_NO_CHANGE",actor.id,input.reason,old,outcome);
    return review.id;
  });
}

/** Query functions are also server-policy guarded; staff receives neither expense data nor other accounts. */
export async function listAccounts(db: FinanceDatabase, actorIdRaw: string): Promise<Array<AccountScope & { balance: string; openingDate: string; recordedOpening: string; currentOpening: string; closedAt: string | null }>> {
  const actorId = identifier(actorIdRaw, "المستخدم");
  return db.serializable(async (tx) => {
    const actor = await loadActor(tx, actorId);
    const result = await tx.query<AccountRow & { currentOpening: string; closedAt: string | null }>(`SELECT id::text AS id,branch_id::text AS "branchId",kind,holder_id::text AS "holderId",opening_amount::text AS "openingAmount",opening_date::text AS "openingDate",revision::text AS revision,
      COALESCE((SELECT c.after_amount FROM finance.opening_corrections c WHERE c.account_id=a.id ORDER BY c.id DESC LIMIT 1),a.opening_amount)::text AS "currentOpening",
      closed_at::text AS "closedAt"
      FROM finance.accounts a WHERE $1::boolean OR (kind='CUSTODY' AND holder_id=$2::bigint AND branch_id=$3::bigint) ORDER BY a.id`, [canManageFinance(actor),actor.id,actor.branchId]);
    const visible: Array<AccountScope & { balance: string; openingDate: string; recordedOpening: string; currentOpening: string; closedAt: string | null }> = [];
    for (const account of result.rows) if (canViewAccount(actor,account)) visible.push({ id: account.id, branchId: account.branchId, kind: account.kind, holderId: account.holderId, balance: formatCents(await balance(tx,account.id)), openingDate: account.openingDate, recordedOpening: account.openingAmount, currentOpening: account.currentOpening, closedAt: account.closedAt ?? null });
    return visible;
  });
}
export async function listOpeningCorrections(db: FinanceDatabase, actorIdRaw: string): Promise<OpeningCorrectionRow[]> {
  const actorId = identifier(actorIdRaw, "المستخدم");
  return db.serializable(async (tx) => {
    const actor = await loadActor(tx,actorId); manage(actor);
    return (await tx.query<OpeningCorrectionRow>(`SELECT id::text AS id,account_id::text AS "accountId",before_amount::text AS "beforeAmount",after_amount::text AS "afterAmount",book_difference::text AS "bookDifference",resolution,covered_count_id::text AS "coveredCountId",balance_before::text AS "balanceBefore",balance_after::text AS "balanceAfter",reason,created_by::text AS "createdBy",created_at::text AS "createdAt" FROM finance.opening_corrections ORDER BY id DESC`)).rows;
  });
}

export async function listCashCounts(db: FinanceDatabase, actorIdRaw: string): Promise<CashCountRow[]> {
  const actorId=identifier(actorIdRaw,"المستخدم");
  return db.serializable(async tx=>{const actor=await loadActor(tx,actorId);manage(actor);
    return (await tx.query<CashCountRow>(`SELECT id::text AS id,account_id::text AS "accountId",counted_amount::text AS "countedAmount",observed_balance::text AS "observedBalance",
      difference::text AS difference,account_revision::text AS "accountRevision",counted_on::text AS "countedOn",reason,status,created_by::text AS "createdBy",created_at::text AS "createdAt",
      resolved_by::text AS "resolvedBy",resolved_at::text AS "resolvedAt",resolution_reason AS "resolutionReason" FROM finance.cash_counts c ORDER BY c.id DESC`)).rows;
  });
}
/**
 * Categories an ACTIVE finance actor may pick while recording an expense:
 * the active ones only. This is a read for any active account, so a branch
 * employee can record an expense; managing categories (adding, editing,
 * stopping, and seeing the stopped ones) stays with management through
 * listCategories, and deactivating a category never deletes it.
 */
export async function listSelectableCategories(db: FinanceDatabase, actorIdRaw: string): Promise<CategoryRow[]> {
  const actorId = identifier(actorIdRaw, "المستخدم");
  return db.serializable(async (tx) => {
    await loadActor(tx, actorId);
    if (tx.categoryPort) return (await tx.categoryPort.list()).filter((category) => category.active);
    return (await tx.query<CategoryRow>(`SELECT c.id::text AS id,c.name_ar AS name,c.is_active AS active,COALESCE(r.revision,1) AS revision
      FROM public.expense_categories c LEFT JOIN finance.category_revisions r ON r.category_id=c.id WHERE c.is_active ORDER BY c.id`)).rows;
  });
}

export async function listCategories(db: FinanceDatabase, actorIdRaw: string): Promise<CategoryRow[]> {
  const actorId = identifier(actorIdRaw, "المستخدم");
  return db.serializable(async (tx) => {
    const actor = await loadActor(tx, actorId); manage(actor);
    if (tx.categoryPort) return tx.categoryPort.list();
    return (await tx.query<CategoryRow>(`SELECT c.id::text AS id,c.name_ar AS name,c.is_active AS active,COALESCE(r.revision,1) AS revision
      FROM public.expense_categories c LEFT JOIN finance.category_revisions r ON r.category_id=c.id ORDER BY c.id`)).rows;
  });
}
export async function listExpenses(db: FinanceDatabase, actorIdRaw: string): Promise<ExpenseListRow[]> {
  const actorId = identifier(actorIdRaw, "المستخدم");
  return db.serializable(async (tx) => {
    const actor = await loadActor(tx, actorId);
    // الموظف يرى مصروفاته هو فقط، بلا سجل الفرع أو تفاصيل الاعتماد والصرف.
    const ownOnly = !canManageFinance(actor);
    if (ownOnly && !(actor.role === "CS_AGENT" && actor.branchId)) throw new FinanceProblem("forbidden", "عرض سجل المصروفات للمدير والمحاسب فقط.");
    const result = await tx.query<ExpenseListRow>(`SELECT e.id::text AS id,e.branch_id::text AS "branchId",e.category_id::text AS "categoryId",e.category_snapshot AS "categorySnapshot",
      COALESCE((SELECT c.after_amount FROM finance.expense_corrections c WHERE c.expense_id=e.id ORDER BY c.id DESC LIMIT 1),e.amount)::text AS amount,
      e.amount::text AS "originalAmount",e.expense_date::text AS "expenseDate",e.description,e.beneficiary,e.document_number AS "documentNumber",e.tax_amount::text AS "taxAmount",
      e.status,e.revision,e.requested_by::text AS "requestedBy",e.created_at::text AS "createdAt",e.approved_by::text AS "approvedBy",e.approved_at::text AS "approvedAt",
      p.id::text AS "paymentId",p.amount::text AS "paymentAmount",p.method AS "paymentMethod",p.account_id::text AS "paymentAccountId",p.payment_date::text AS "paymentDate",
      p.recorded_at::text AS "paymentRecordedAt",p.recorded_by::text AS "paymentRecordedBy",p.historical AS "paymentHistorical",p.opening_order AS "paymentOpeningOrder",p.after_cash_count_id::text AS "paymentAfterCountId",
      EXISTS(SELECT 1 FROM finance.expense_reviews r WHERE r.expense_id=e.id AND r.status='OPEN') AS "hasOpenReview"
      FROM finance.expenses e LEFT JOIN finance.payments p ON p.expense_id=e.id
      ${ownOnly ? "WHERE e.requested_by=$1::bigint" : ""} ORDER BY e.id DESC`, ownOnly ? [actorId] : []);
    return result.rows;
  });
}
export async function listPaidExpenseReviews(db: FinanceDatabase, actorIdRaw: string): Promise<PaidExpenseReviewRow[]> {
  const actorId = identifier(actorIdRaw, "المستخدم");
  return db.serializable(async (tx) => {
    const actor = await loadActor(tx, actorId); manage(actor);
    return (await tx.query<PaidExpenseReviewRow>(`SELECT id::text AS id,expense_id::text AS "expenseId",expense_revision AS "expenseRevision",
      proposed_amount::text AS "proposedAmount",reason,original_snapshot AS "originalSnapshot",status,created_by::text AS "createdBy",created_at::text AS "createdAt"
      FROM finance.expense_reviews r WHERE status='OPEN' ORDER BY r.id DESC`)).rows;
  });
}
export async function listExpenseCorrections(db: FinanceDatabase, actorIdRaw: string): Promise<ExpenseCorrectionRow[]> {
  const actorId=identifier(actorIdRaw,"المستخدم");return db.serializable(async tx=>{const actor=await loadActor(tx,actorId);manage(actor);
    return (await tx.query<ExpenseCorrectionRow>(`SELECT c.id::text AS id,c.expense_id::text AS "expenseId",c.review_id::text AS "reviewId",
      c.before_amount::text AS "beforeAmount",c.after_amount::text AS "afterAmount",c.reason,c.account_id::text AS "accountId",c.book_difference::text AS "bookDifference",
      c.balance_before::text AS "balanceBefore",c.balance_after::text AS "balanceAfter",c.created_by::text AS "createdBy",c.created_at::text AS "createdAt",
      r.reason AS "reviewReason",r.proposed_amount::text AS "proposedAmount",r.created_by::text AS "reviewCreatedBy",r.created_at::text AS "reviewCreatedAt"
      FROM finance.expense_corrections c JOIN finance.expense_reviews r ON r.id=c.review_id ORDER BY c.id DESC`)).rows;
  });
}
export async function listExpenseAudit(db: FinanceDatabase, actorIdRaw: string, expenseIdRaw: string): Promise<Array<Row>> {
  const actorId = identifier(actorIdRaw, "المستخدم"), expenseId = identifier(expenseIdRaw, "المصروف");
  return db.serializable(async (tx) => {
    const actor = await loadActor(tx, actorId); manage(actor);
    return (await tx.query(`SELECT id::text AS id,action,actor_id::text AS "actorId",reason,before_data AS "beforeData",after_data AS "afterData",created_at::text AS "createdAt"
      FROM finance.audit_events a WHERE entity_type='EXPENSE' AND entity_id=$1::bigint ORDER BY a.id`, [expenseId])).rows;
  });
}
export async function listAccountActivity(db: FinanceDatabase, actorIdRaw: string, accountIdRaw: string): Promise<Array<{ id: string; kind: string; amount: string; direction: string; recordedAt: string }>> {
  const actorId = identifier(actorIdRaw, "المستخدم"), accountId = identifier(accountIdRaw, "الحساب");
  return db.serializable(async (tx) => {
    const actor = await loadActor(tx,actorId);
    const found = await tx.query<AccountRow>(`SELECT id::text AS id,branch_id::text AS "branchId",kind,holder_id::text AS "holderId",opening_amount::text AS "openingAmount",opening_date::text AS "openingDate",revision::text AS revision
      FROM finance.accounts WHERE id=$1::bigint AND ($2::boolean OR (kind='CUSTODY' AND holder_id=$3::bigint AND branch_id=$4::bigint))`, [accountId,canManageFinance(actor),actor.id,actor.branchId]);
    const account = found.rows[0];
    if (!account || !canViewAccount(actor,account)) throw new FinanceProblem("forbidden", "لا تملك صلاحية عرض هذا الحساب.");
    // No join to expenses: the staff result never contains a description, tax, beneficiary, or payment ID.
    const result = await tx.query<Row & { id: string; kind: string; amount: string; direction: string; recordedAt: string }>(`SELECT id::text AS id,
      CASE WHEN $2::boolean AND kind='EXPENSE' THEN 'DEBIT' WHEN $2::boolean AND kind IN ('EXPENSE_CORRECTION','COUNT_ADJUSTMENT','OPENING_CORRECTION') THEN 'BALANCE_ADJUSTMENT' ELSE kind END AS kind,amount::text AS amount,
      CASE WHEN source_id=$1::bigint THEN 'OUT' ELSE 'IN' END AS direction,created_at::text AS "recordedAt"
      FROM finance.movements m WHERE source_id=$1::bigint OR destination_id=$1::bigint ORDER BY m.id DESC`, [accountId,actor.role === "CS_AGENT"]);
    return result.rows;
  });
}

/** A normal CASH collection/refund must be physically after the latest
 * reviewed checkpoint. Compare its snapshot under the account lock: if a count
 * was confirmed concurrently the operator must review again. This attestation
 * cannot prove when cash physically changed hands. */
export async function assertAfterLatestCheckpointInTransaction(tx: FinanceTransaction, actorIdRaw: string, raw: unknown): Promise<void> {
  const value = inputObject(raw), actor = await loadActor(tx,identifier(actorIdRaw,"المستخدم"));
  const branchId=identifier(value.branchId,"الفرع"), accountId=identifier(value.accountId,"الحساب");
  const refund=value.refund === true;
  if (value.refund !== true && value.refund !== false) throw new FinanceProblem("invalid_input","نوع العملية غير صالح.");
  if (refund) manage(actor);
  confirmation(value.afterCheckpoint,"أن العملية الفعلية بعد آخر جرد محدد");
  const checkpoint = value.checkpointRef === "OPENING" ? "OPENING" : identifier(value.checkpointRef,"آخر جرد روجع");
  await settlementBranch(tx,branchId,actor);
  const account=(await lockAccounts(tx,[accountId]))[0];
  if (refund && account.branchId !== branchId) throw new FinanceProblem("account_branch","مصدر الرد يجب أن يكون في فرع الفاتورة.");
  if (!refund && !canCollectTo(actor,branchId,account)) throw new FinanceProblem("forbidden","اختر خزنة فرعك أو عهدتك الخاصة للتحصيل النقدي.");
  const latest=await tx.query<IdRow>(`SELECT id::text AS id FROM finance.cash_counts WHERE account_id=$1::bigint AND status='CONFIRMED' ORDER BY id DESC LIMIT 1`,[account.id]);
  if ((latest.rows[0]?.id ?? "OPENING") !== checkpoint) throw new FinanceProblem("checkpoint_changed","تغيّر آخر جرد لهذا الحساب؛ افتح الفاتورة وراجع ترتيب العملية قبل التسجيل.");
}

/** Test-only bridge hook. The caller MUST validate a real CASH invoice event,
 * create it and invoke this hook in the very same transaction. These attestations
 * are operator statements, not proof of a real payment or uniqueness. */
export async function recordHistoricalCommerceInTransaction(tx: FinanceTransaction, actorIdRaw: string, raw: unknown, today = cairoDate()): Promise<string> {
  const value = inputObject(raw);
  if (value.eventType !== "COLLECTION" && value.eventType !== "REFUND") throw new FinanceProblem("invalid_input", "نوع العملية التاريخية غير صالح.");
  const input = {
    eventType: value.eventType, eventId: identifier(value.eventId,"العملية"), saleId: identifier(value.saleId,"الفاتورة"),
    branchId: identifier(value.branchId,"الفرع"), accountId: identifier(value.accountId,"الحساب"), amount: money(value.amount,"المبلغ"),
    actualDate: date(value.actualDate,"تاريخ التحصيل أو الرد الفعلي"), checkpointType: value.checkpointType,
    checkpointCountId: optionalIdentifier(value.checkpointCountId,"الجرد"), handler: text(value.handler,"من استلم أو دفع النقد",120,true)!,
    reason: text(value.reason,"سبب التسجيل ومرجع التحقق",300,true)!,
    verifiedActual: confirmation(value.verifiedActual,"أن العملية حدثت فعليًا"),
    beforeCheckpoint: confirmation(value.beforeCheckpoint,"أن العملية سبقت الجرد المحدد"),
    includedInCheckpoint: confirmation(value.includedInCheckpoint,"أن العملية انعكست في الجرد المحدد"),
    notPreviouslyRecorded: confirmation(value.notPreviouslyRecorded,"عدم تسجيل العملية سابقًا على الفاتورة"),
    pendingCaseId:optionalIdentifier(value.pendingCaseId,"الحالة المعلقة"),caseReviewed:flag(value.caseReviewed),distinctFromPending:flag(value.distinctFromPending),
    caseSnapshot:caseSnapshot(value.caseSnapshot),
  };
  ensureNotFuture(input.actualDate,today);
  if ((input.checkpointType !== "OPENING" && input.checkpointType !== "COUNT") ||
      (input.checkpointType === "OPENING" && input.checkpointCountId) ||
      (input.checkpointType === "COUNT" && !input.checkpointCountId)) throw new FinanceProblem("invalid_input","حدد جرد البداية أو جردًا مؤكدًا واحدًا.");
  const actor = await loadActor(tx,identifier(actorIdRaw,"المستخدم")); manage(actor);
  await settlementBranch(tx,input.branchId,actor);
  // Lock all open cases for this invoice/type. The reviewed snapshot includes
  // revisions, so new cases or notes cannot be silently skipped by an old form.
  const pending=await tx.query<Row & {id:string;revision:number}>(`SELECT c.id::text AS id,c.revision FROM finance.reconciliation_cases c WHERE c.sale_id=$1::bigint AND c.kind=$2 AND c.status='OPEN' ORDER BY c.id FOR UPDATE`,[input.saleId,input.eventType]);
  let linked:ReconciliationCase|null=null;
  if (input.pendingCaseId) {
    linked=await lockReconciliationCase(tx,input.pendingCaseId);
    if (linked.kind!==input.eventType || linked.saleId!==input.saleId || linked.branchId!==input.branchId || !input.caseReviewed || input.distinctFromPending)
      throw new FinanceProblem("case_review_required","راجع الحالة المفتوحة المرتبطة بنوع العملية والفاتورة قبل التأكيد.");
  } else if (pending.rows.length && !input.distinctFromPending) {
    throw new FinanceProblem("case_review_required","توجد حالة معلقة لهذا النوع على الفاتورة. اربطها أو أكد أن هذه الواقعة مختلفة عنها بعد المراجعة.");
  }
  const currentSnapshot=pending.rows.map(c=>`${c.id}:${c.revision}`).join(",");
  if (currentSnapshot!==input.caseSnapshot) throw new FinanceProblem("cases_changed","تغيرت الحالات أو ملاحظاتها منذ مراجعتها؛ أعد فتح الفاتورة وراجعها قبل التأكيد.");
  const account = (await lockAccounts(tx,[input.accountId]))[0];
  if (account.branchId !== input.branchId) throw new FinanceProblem("account_branch","حساب النقد يجب أن يكون في فرع الفاتورة.");
  let checkpointDate = account.openingDate;
  if (input.checkpointType === "COUNT") {
    const count = await tx.query<Row & { countedOn: string }>(`SELECT counted_on::text AS "countedOn" FROM finance.cash_counts WHERE id=$1::bigint AND account_id=$2::bigint AND status='CONFIRMED' FOR SHARE`,[input.checkpointCountId,account.id]);
    if (!count.rows[0]) throw new FinanceProblem("checkpoint_unavailable","اختر جردًا مؤكدًا لهذا الحساب.");
    checkpointDate = count.rows[0].countedOn;
  }
  if (input.actualDate > checkpointDate) throw new FinanceProblem("checkpoint_order","تاريخ العملية بعد الجرد المختار؛ لا يمكن احتسابها فيه.");
  const existing = await tx.query<IdRow>(`SELECT id::text AS id FROM finance.movements WHERE kind=$1 AND external_ref=$2`,[input.eventType,`${input.eventType.toLowerCase()}:${input.eventId}`]);
  if (existing.rows[0]) throw new FinanceProblem("duplicate","توجد حركة نقد لهذا السجل؛ لا يمكن اعتباره تاريخيًا دون مراجعة.");
  const saved = await tx.query<IdRow>(`INSERT INTO finance.historical_commerce(event_type,event_id,sale_id,branch_id,account_id,amount,actual_date,checkpoint_type,checkpoint_count_id,checkpoint_date,verified_actual,before_checkpoint,included_in_checkpoint,not_previously_recorded,handler,reason,created_by)
    VALUES($1,$2::bigint,$3::bigint,$4::bigint,$5::bigint,$6::numeric,$7::date,$8,$9::bigint,$10::date,$11,$12,$13,$14,$15,$16,$17::bigint) RETURNING id::text AS id`,
    [input.eventType,input.eventId,input.saleId,input.branchId,input.accountId,input.amount,input.actualDate,input.checkpointType,input.checkpointCountId,checkpointDate,
      input.verifiedActual,input.beforeCheckpoint,input.includedInCheckpoint,input.notPreviouslyRecorded,input.handler,input.reason,actor.id]);
  await audit(tx,"HISTORICAL_COMMERCE",saved.rows[0].id,"RECORD",actor.id,input.reason,null,
    { eventType:input.eventType,eventId:input.eventId,saleId:input.saleId,accountId:input.accountId,amount:input.amount,actualDate:input.actualDate,
      checkpointType:input.checkpointType,checkpointCountId:input.checkpointCountId,checkpointDate,handler:input.handler,
      verifiedActual:input.verifiedActual,beforeCheckpoint:input.beforeCheckpoint,includedInCheckpoint:input.includedInCheckpoint,
      notPreviouslyRecorded:input.notPreviouslyRecorded,actualCashMoved:false,pendingCaseId:linked?.id ?? null,reviewedCaseSnapshot:input.caseSnapshot });
  if (linked) await confirmReconciliationCase(tx,linked,actor.id,input.reason,{historicalId:saved.rows[0].id});
  return saved.rows[0].id;
}

/**
 * Test-only stand-in for a sale collection inside the same SQL transaction.
 * The real sales service MUST verify that the collection is actual CASH, validate
 * and save it, and call an equivalent hook in the SAME transaction. This hook does
 * not inspect the method or validate invoices; it must not be called for noncash.
 * Nothing here creates revenue or integrates with the deployed sales service.
 */
export async function postCashCollectionInTransaction(tx: FinanceTransaction, actorIdRaw: string, inputRaw: { branchId: string; accountId: string; amount: string; collectionId: string; checkpointRef?: string; afterCheckpoint?: boolean }): Promise<string> {
  const actor = await loadActor(tx, identifier(actorIdRaw, "المستخدم"));
  const branchId = identifier(inputRaw.branchId, "الفرع"), accountId = identifier(inputRaw.accountId, "الحساب"), collectionId = identifier(inputRaw.collectionId, "التحصيل"), amount = money(inputRaw.amount, "المبلغ");
  if (inputRaw.checkpointRef !== undefined || inputRaw.afterCheckpoint !== undefined) {
    await assertAfterLatestCheckpointInTransaction(tx,actorIdRaw,{branchId,accountId,checkpointRef:inputRaw.checkpointRef,afterCheckpoint:inputRaw.afterCheckpoint,refund:false});
  }
  await settlementBranch(tx,branchId,actor);
  const account = (await lockAccounts(tx,[accountId]))[0];
  if (!canCollectTo(actor,branchId,account)) throw new FinanceProblem("forbidden", "اختر خزنة فرعك أو عهدتك الخاصة للتحصيل النقدي.");
  const historic = await tx.query<IdRow>(`SELECT id::text AS id FROM finance.historical_commerce WHERE event_type='COLLECTION' AND event_id=$1::bigint`,[collectionId]);
  if (historic.rows[0]) throw new FinanceProblem("duplicate","التحصيل مسجل كمحتسب في الجرد؛ لم تُنشأ حركة ثانية.");
  const saved = await tx.query<IdRow>(`INSERT INTO finance.movements(kind,branch_id,destination_id,amount,external_ref,actor_id,after_cash_count_id,after_opening)
    VALUES('COLLECTION',$1::bigint,$2::bigint,$3::numeric,$4,$5::bigint,$6::bigint,$7) RETURNING id::text AS id`, [branchId,accountId,amount,`collection:${collectionId}`,actor.id,inputRaw.checkpointRef && inputRaw.checkpointRef !== "OPENING" ? inputRaw.checkpointRef : null,inputRaw.checkpointRef === "OPENING"]);
  if (inputRaw.checkpointRef) await audit(tx,"MOVEMENT",saved.rows[0].id,"COLLECTION",actor.id,null,null,{accountId,amount,collectionId,checkpointRef:inputRaw.checkpointRef,attestedAfterCheckpoint:true});
  await bumpAccounts(tx,[accountId]); return saved.rows[0].id;
}

/** Test-only: caller must verify the refund is CASH and actually paid, save it,
 * and call this hook within the same transaction. This hook does not check method. */
export async function postCashRefundInTransaction(tx: FinanceTransaction, actorIdRaw: string, inputRaw: { branchId: string; accountId: string; amount: string; refundId: string; expectedBalance: string; negativeAcknowledged: boolean; checkpointRef?: string; afterCheckpoint?: boolean }): Promise<string> {
  const actor = await loadActor(tx, identifier(actorIdRaw,"المستخدم")); manage(actor);
  const branchId = identifier(inputRaw.branchId,"الفرع"), accountId = identifier(inputRaw.accountId,"الحساب"), refundId = identifier(inputRaw.refundId,"الرد"), amount = money(inputRaw.amount,"المبلغ"), expected = signedMoney(inputRaw.expectedBalance,"الرصيد الذي روجع");
  if (inputRaw.checkpointRef !== undefined || inputRaw.afterCheckpoint !== undefined) {
    await assertAfterLatestCheckpointInTransaction(tx,actorIdRaw,{branchId,accountId,checkpointRef:inputRaw.checkpointRef,afterCheckpoint:inputRaw.afterCheckpoint,refund:true});
  }
  await settlementBranch(tx,branchId,actor);
  const account = (await lockAccounts(tx,[accountId]))[0];
  if (account.branchId !== branchId) throw new FinanceProblem("account_branch", "مصدر الرد يجب أن يكون في فرع الفاتورة.");
  const current = await balance(tx,accountId); checkBalance(current, expected, exactCents(amount), inputRaw.negativeAcknowledged === true);
  const historic = await tx.query<IdRow>(`SELECT id::text AS id FROM finance.historical_commerce WHERE event_type='REFUND' AND event_id=$1::bigint`,[refundId]);
  if (historic.rows[0]) throw new FinanceProblem("duplicate","الرد مسجل كمحتسب في الجرد؛ لم تُنشأ حركة ثانية.");
  const saved = await tx.query<IdRow>(`INSERT INTO finance.movements(kind,branch_id,source_id,amount,external_ref,actor_id,after_cash_count_id,after_opening)
    VALUES('REFUND',$1::bigint,$2::bigint,$3::numeric,$4,$5::bigint,$6::bigint,$7) RETURNING id::text AS id`, [branchId,accountId,amount,`refund:${refundId}`,actor.id,inputRaw.checkpointRef && inputRaw.checkpointRef !== "OPENING" ? inputRaw.checkpointRef : null,inputRaw.checkpointRef === "OPENING"]);
  if (inputRaw.checkpointRef) await audit(tx,"MOVEMENT",saved.rows[0].id,"REFUND",actor.id,null,null,{accountId,amount,refundId,checkpointRef:inputRaw.checkpointRef,attestedAfterCheckpoint:true});
  await bumpAccounts(tx,[accountId]); return saved.rows[0].id;
}

/* ===========================================================================
 * تسوية عهدة الموظف — الإجمالي = العهدة + المبيعات − المصروفات
 *
 * القواعد الحاكمة (موثّقة في docs/branch-custody-settlement.md):
 *  - الطلب لا يغيّر النقد ولا العهدة؛ الاعتماد وحده يحرّكهما.
 *  - الاعتماد بيد المدير أو المحاسب فقط، ولا اعتماد ذاتي.
 *  - الفرق يُسدَّد كاملًا: زيادة ← من العهدة إلى الخزنة؛ عجز ← من الخزنة إلى العهدة.
 *  - المصروف المصروف من نقد الموظف (`HOLDER_CASH`) لا يُخصم مرتين: بلا حركة هنا،
 *    ويُجمع ضمن مصروفات الفترة في التسوية.
 * ========================================================================= */

export type SettlementListRow = Row & {
  id: string; accountId: string; branchId: string; requestedBy: string;
  systemBalance: string; countedAmount: string; salesTotal: string; expensesTotal: string;
  expectedAmount: string; deviation: string; adjustment: string;
  status: "OPEN" | "CONFIRMED" | "REJECTED" | "CANCELLED"; reason: string; createdAt: string;
  resolvedBy: string | null; resolvedAt: string | null; resolutionReason: string | null;
  transferAmount: string | null; transferDirection: "TO_VAULT" | "TO_CUSTODY" | null;
};

export type SettlementOverview = {
  account: { id: string; branchId: string; balance: string } | null;
  since: string | null; sales: string; expenses: string; expected: string; openRequestId: string | null;
};

const SETTLEMENT_SELECT = `s.id::text AS id,s.account_id::text AS "accountId",s.branch_id::text AS "branchId",
  s.requested_by::text AS "requestedBy",s.system_balance::text AS "systemBalance",s.counted_amount::text AS "countedAmount",
  s.sales_total::text AS "salesTotal",s.expenses_total::text AS "expensesTotal",s.expected_amount::text AS "expectedAmount",
  s.deviation::text AS deviation,s.adjustment::text AS adjustment,s.status AS status,s.reason AS reason,
  s.created_at::text AS "createdAt",s.resolved_by::text AS "resolvedBy",s.resolved_at::text AS "resolvedAt",
  s.resolution_reason AS "resolutionReason",s.transfer_amount::text AS "transferAmount",s.transfer_direction AS "transferDirection"`;

function anyFinanceActor(actor: Actor): void {
  if (!activeActor(actor)) throw new FinanceProblem("forbidden", "الحساب غير نشط أو لا يملك صلاحية لهذه العملية.");
}

/** الإدارة تصرف دائمًا؛ والموظف فقط عند الصرف من نقده (مِلكية المصروف تُتحقق داخل المعاملة). */
function expensePayer(source: "ACCOUNT" | "HOLDER_CASH"): (actor: Actor) => void {
  return source === "HOLDER_CASH" ? anyFinanceActor : manage;
}

function paymentSource(value: unknown): "ACCOUNT" | "HOLDER_CASH" {
  if (value === null || value === undefined || value === "" || value === "ACCOUNT") return "ACCOUNT";
  if (value === "HOLDER_CASH") return "HOLDER_CASH";
  throw new FinanceProblem("invalid_input", "مصدر الصرف غير صالح.");
}

function settlementDirection(value: unknown): "TO_VAULT" | "TO_CUSTODY" {
  if (value === "TO_VAULT" || value === "TO_CUSTODY") return value;
  throw new FinanceProblem("invalid_input", "اختر اتجاه التحويل: إلى خزنة الفرع أو إلى العهدة.");
}

/** مبيعات الفرع النقدية ومصروفاته من نقد الموظف منذ آخر تسوية مؤكدة (أو since فتح العهدة). */
async function settlementPeriod(
  tx: FinanceTransaction,
  accountId: string,
  branchId: string,
): Promise<{ since: string; sales: bigint; expenses: bigint }> {
  const since = await tx.query<Row & { since: string }>(`SELECT COALESCE(
      (SELECT resolved_at::text FROM finance.settlements WHERE account_id=$1::bigint AND status='CONFIRMED' ORDER BY resolved_at DESC, id DESC LIMIT 1),
      (SELECT opened_at::text FROM finance.accounts WHERE id=$1::bigint)) AS since`, [accountId]);
  const from = since.rows[0].since;
  const sales = await tx.query<Row & { total: string }>(`SELECT COALESCE(SUM(c.amount),0)::text AS total
      FROM public.commerce_collections c
      JOIN public.commerce_sales s ON s.id = c.sale_id
      WHERE s.branch_id=$1::bigint AND c.method='CASH' AND c.created_at > $2::timestamptz`, [branchId, from]);
  const expenses = await tx.query<Row & { total: string }>(`SELECT COALESCE(SUM(p.amount),0)::text AS total
      FROM finance.payments p
      JOIN finance.expenses e ON e.id = p.expense_id
      WHERE e.branch_id=$1::bigint AND p.source='HOLDER_CASH' AND p.recorded_at > $2::timestamptz`, [branchId, from]);
  return { since: from, sales: exactCents(sales.rows[0].total), expenses: exactCents(expenses.rows[0].total) };
}

/** ملخّص الشاشة: رصيد العهدة، ومبيعات الفترة، ومصروفاتها، والإجمالي المتوقع. */
export async function settlementOverview(db: FinanceDatabase, actorIdRaw: string, accountIdRaw?: unknown): Promise<SettlementOverview> {
  const actorId = identifier(actorIdRaw, "المستخدم");
  const wanted = accountIdRaw === undefined || accountIdRaw === null || accountIdRaw === "" ? null : identifier(accountIdRaw, "العهدة");
  return db.serializable(async (tx) => {
    const actor = await loadActor(tx, actorId);
    const rows = await tx.query<AccountRow>(`SELECT id::text AS id,branch_id::text AS "branchId",kind,holder_id::text AS "holderId",
      opening_amount::text AS "openingAmount",opening_date::text AS "openingDate",revision::text AS revision
      FROM finance.accounts
      WHERE ($1::boolean AND ($2::bigint IS NULL OR id=$2::bigint)) OR (kind='CUSTODY' AND holder_id=$3::bigint)
      ORDER BY id`, [canManageFinance(actor), wanted, actor.id]);
    const account = rows.rows.find((row) => row.kind === "CUSTODY" && (wanted ? row.id === wanted : true)) ?? null;
    if (!account) return { account: null, since: null, sales: "0.00", expenses: "0.00", expected: "0.00", openRequestId: null };
    const current = await balance(tx, account.id);
    const period = await settlementPeriod(tx, account.id, account.branchId);
    const open = await tx.query<IdRow>(`SELECT id::text AS id FROM finance.settlements WHERE account_id=$1::bigint AND status='OPEN' ORDER BY id DESC LIMIT 1`, [account.id]);
    return {
      account: { id: account.id, branchId: account.branchId, balance: formatCents(current) },
      since: period.since,
      sales: formatCents(period.sales),
      expenses: formatCents(period.expenses),
      expected: formatCents(current + period.sales - period.expenses),
      openRequestId: open.rows[0]?.id ?? null,
    };
  });
}

/** الموظف يرى طلباته؛ والإدارة ترى كل الطلبات (تُعرض في شاشة التسليم والتحويل). */
export async function listSettlements(db: FinanceDatabase, actorIdRaw: string): Promise<SettlementListRow[]> {
  const actorId = identifier(actorIdRaw, "المستخدم");
  return db.serializable(async (tx) => {
    const actor = await loadActor(tx, actorId);
    const result = await tx.query<SettlementListRow>(`SELECT ${SETTLEMENT_SELECT} FROM finance.settlements s
      WHERE $1::boolean OR s.requested_by=$2::bigint ORDER BY s.id DESC`, [canManageFinance(actor), actor.id]);
    return result.rows;
  });
}

/** طلب تسوية: لا يغيّر النقد ولا العهدة، ويمنع وجود أكثر من طلب مفتوح لنفس العهدة. */
export async function requestSettlement(db: FinanceDatabase, actorId: string, raw: unknown): Promise<WriteResult> {
  const value = inputObject(raw), input = {
    requestId: requestId(value.requestId),
    accountId: identifier(value.accountId, "العهدة"),
    countedAmount: money(value.countedAmount, "النقد المعدود", true),
    expectedBalance: signedMoney(value.expectedBalance, "الرصيد المعروض"),
    reason: text(value.reason, "سبب التسوية", 300, true)!,
    actuallyCounted: confirmation(value.actuallyCounted, "الجرد الفعلي"),
  };
  return command(db, actorId, "SETTLEMENT_CREATE", input.requestId, input, anyFinanceActor, async (tx, actor) => {
    const account = (await lockAccounts(tx, [input.accountId]))[0];
    if (account.kind !== "CUSTODY" || !canViewAccount(actor, account)) throw new FinanceProblem("forbidden", "طلب التسوية متاح لعهدة الموظف نفسه فقط.");
    await activeBranch(tx, account.branchId);
    const open = await tx.query<IdRow>(`SELECT id::text AS id FROM finance.settlements WHERE account_id=$1::bigint AND status='OPEN'`, [account.id]);
    if (open.rows[0]) throw new FinanceProblem("settlement_exists", "يوجد طلب تسوية مفتوح لهذه العهدة؛ راجعه أو ألغِه بسبب قبل طلب آخر.");
    const current = await balance(tx, account.id);
    if (current !== exactCents(input.expectedBalance)) throw new FinanceProblem("balance_changed", "تغيّر رصيد العهدة منذ عرضه؛ أعد فتح النموذج وراجعه.", { currentBalance: formatCents(current) });
    const period = await settlementPeriod(tx, account.id, account.branchId);
    const counted = exactCents(input.countedAmount);
    const expected = current + period.sales - period.expenses;
    const saved = await tx.query<IdRow>(`INSERT INTO finance.settlements
      (account_id,branch_id,requested_by,system_balance,counted_amount,sales_total,expenses_total,expected_amount,deviation,adjustment,reason)
      VALUES($1::bigint,$2::bigint,$3::bigint,$4::numeric,$5::numeric,$6::numeric,$7::numeric,$8::numeric,$9::numeric,$10::numeric,$11)
      RETURNING id::text AS id`,
      [account.id, account.branchId, actor.id, formatCents(current), input.countedAmount, formatCents(period.sales),
       formatCents(period.expenses), formatCents(expected), formatCents(counted - expected), formatCents(counted - current), input.reason]);
    const id = saved.rows[0].id;
    await audit(tx, "SETTLEMENT", id, "CREATE", actor.id, input.reason, null,
      { accountId: account.id, branchId: account.branchId, systemBalance: formatCents(current), countedAmount: input.countedAmount,
        salesTotal: formatCents(period.sales), expensesTotal: formatCents(period.expenses), expected: formatCents(expected),
        deviation: formatCents(counted - expected), adjustment: formatCents(counted - current), moneyMoved: false });
    return id;
  });
}

/**
 * اعتماد التسوية: حركة تسوية تُطابق الدفتر مع الواقع، ثم تحويل الفرق كاملًا في
 * الاتجاه الصحيح (زيادة ← للخزنة، عجز ← من الخزنة)، بخطوة واحدة ذرّية.
 */
export async function confirmSettlement(db: FinanceDatabase, actorId: string, raw: unknown): Promise<WriteResult> {
  const value = inputObject(raw), input = {
    requestId: requestId(value.requestId),
    settlementId: identifier(value.settlementId, "طلب التسوية"),
    expectedBalance: signedMoney(value.expectedBalance, "الرصيد المعروض"),
    transferAmount: money(value.transferAmount, "مبلغ التحويل", true),
    transferDirection: settlementDirection(value.transferDirection),
    reason: text(value.reason, "سبب الاعتماد", 300, true)!,
    actuallyTransferred: confirmation(value.actuallyTransferred, "التسليم الفعلي"),
    negativeAcknowledged: flag(value.negativeAcknowledged),
  };
  return command(db, actorId, "SETTLEMENT_CONFIRM", input.requestId, input, manage, async (tx, actor) => {
    const rows = await tx.query<SettlementListRow>(`SELECT ${SETTLEMENT_SELECT} FROM finance.settlements s WHERE s.id=$1::bigint FOR UPDATE`, [input.settlementId]);
    const settlement = rows.rows[0];
    if (!settlement) throw new FinanceProblem("not_found", "طلب التسوية غير موجود.");
    if (settlement.status !== "OPEN") throw new FinanceProblem("settlement_closed", "طلب التسوية ليس مفتوحًا؛ راجع سجله.");
    if (settlement.requestedBy === actor.id) throw new FinanceProblem("forbidden", "لا اعتماد ذاتي: من أنشأ الطلب لا يعتمده.");
    const custody = (await lockAccounts(tx, [settlement.accountId]))[0];
    await activeBranch(tx, custody.branchId);
    if (custody.kind !== "CUSTODY") throw new FinanceProblem("invalid_settlement", "التسوية للعهدة فقط.");
    const vaultRows = await tx.query<AccountRow>(`SELECT id::text AS id,branch_id::text AS "branchId",kind,holder_id::text AS "holderId",
      opening_amount::text AS "openingAmount",opening_date::text AS "openingDate",revision::text AS revision
      FROM finance.accounts WHERE branch_id=$1::bigint AND kind='VAULT' FOR UPDATE`, [custody.branchId]);
    const vault = vaultRows.rows[0];
    if (!vault) throw new FinanceProblem("account_unopened", "لا توجد خزنة مفتوحة لهذا الفرع؛ افتحها بجرد فعلي قبل تأكيد التسوية.");

    const current = await balance(tx, custody.id);
    if (current !== exactCents(input.expectedBalance)) throw new FinanceProblem("balance_changed", "تغيّر رصيد العهدة منذ المراجعة؛ أعد فتح الطلب وراجعه.", { currentBalance: formatCents(current) });
    // المعدود لقطة زمنية: أي حركة نقدية بعد تقديم الطلب تعني أن النقد في اليد
    // تغيّر منذ عُدّ. الاعتماد حينها يجعل الرصيد يطابق واقعًا قديمًا، فتُرفض
    // العملية ليُعاد الجرد بطلب جديد بدل تسوية فرق لا أحد يعرف مصدره.
    const stale = await tx.query<Row & { n: number }>(`SELECT ((
        SELECT count(*) FROM finance.movements
         WHERE (source_id=$1::bigint OR destination_id=$1::bigint) AND created_at > $2::timestamptz)
      + (SELECT count(*) FROM public.commerce_collections c JOIN public.commerce_sales s ON s.id=c.sale_id
          WHERE s.branch_id=$3::bigint AND c.method='CASH' AND c.created_at > $2::timestamptz)
      + (SELECT count(*) FROM finance.payments p JOIN finance.expenses e ON e.id=p.expense_id
          WHERE e.branch_id=$3::bigint AND p.source='HOLDER_CASH' AND p.recorded_at > $2::timestamptz)
      )::int AS n`, [custody.id, settlement.createdAt, custody.branchId]);
    if (Number(stale.rows[0].n) > 0)
      throw new FinanceProblem("count_stale", "وقعت حركة نقدية بعد تقديم الطلب، فالمعدود لم يعد مطابقًا للنقد في اليد. ألغِ الطلب بسبب واضح وأعد الجرد، ثم قدّم طلبًا جديدًا.");

    // الأرقام تُعاد حسابها لحظة الاعتماد لا لحظة الطلب: أي تحصيل أو صرف وقع بين
    // اللحظتين يدخل هذه التسوية، فلا يضيع في الفراغ بين نهاية فترة وبداية أخرى.
    const period = await settlementPeriod(tx, custody.id, custody.branchId);
    const expectedNow = current + period.sales - period.expenses;
    const recalculated = period.sales !== exactCents(settlement.salesTotal)
      || period.expenses !== exactCents(settlement.expensesTotal)
      || expectedNow !== exactCents(settlement.expectedAmount);
    if (recalculated) await tx.query(`UPDATE finance.settlements
      SET sales_total=$1::numeric,expenses_total=$2::numeric,expected_amount=$3::numeric,
          deviation=$4::numeric,adjustment=$5::numeric WHERE id=$6::bigint`,
      [formatCents(period.sales), formatCents(period.expenses), formatCents(expectedNow),
       formatCents(exactCents(settlement.countedAmount) - expectedNow), formatCents(exactCents(settlement.countedAmount) - current), input.settlementId]);
    const counted = exactCents(settlement.countedAmount);
    const adjustment = counted - current;
    if (adjustment > 0n && input.transferDirection !== "TO_VAULT") throw new FinanceProblem("invalid_direction", "العهدة زائدة؛ التحويل يكون من العهدة إلى خزنة الفرع.");
    if (adjustment < 0n && input.transferDirection !== "TO_CUSTODY") throw new FinanceProblem("invalid_direction", "العهدة عاجزة؛ التحويل يكون من خزنة الفرع إلى العهدة.");

    let adjustmentMovementId: string | null = null;
    if (adjustment !== 0n) {
      const amount = formatCents(adjustment < 0n ? -adjustment : adjustment);
      const saved = await tx.query<IdRow>(`INSERT INTO finance.movements(kind,branch_id,source_id,destination_id,amount,settlement_id,actor_id)
        VALUES('SETTLEMENT',$1::bigint,$2::bigint,$3::bigint,$4::numeric,$5::bigint,$6::bigint) RETURNING id::text AS id`,
        [custody.branchId, adjustment > 0n ? null : custody.id, adjustment > 0n ? custody.id : null, amount, input.settlementId, actor.id]);
      adjustmentMovementId = saved.rows[0].id;
      await bumpAccounts(tx, [custody.id]);
    }

    let handoverMovementId: string | null = null;
    const transfer = exactCents(input.transferAmount);
    if (transfer > 0n) {
      const projected = input.transferDirection === "TO_VAULT" ? counted - transfer : counted + transfer;
      if (projected < 0n && !input.negativeAcknowledged) throw new FinanceProblem("negative_warning", "سيصبح رصيد العهدة سالبًا؛ راجع الفرق وأكد التحذير.", { currentBalance: formatCents(counted), projectedBalance: formatCents(projected) });
      // الخزنة تُفحص كذلك: تغطية عجز من خزنة لا تكفي كانت تصير سالبًا بلا تنبيه.
      if (input.transferDirection === "TO_CUSTODY") {
        const vaultBalance = await balance(tx, vault.id);
        if (vaultBalance - transfer < 0n && !input.negativeAcknowledged)
          throw new FinanceProblem("negative_warning", "سيصبح رصيد خزنة الفرع سالبًا؛ راجع الفرق وأكد التحذير.",
            { currentBalance: formatCents(vaultBalance), projectedBalance: formatCents(vaultBalance - transfer) });
      }
      const fromId = input.transferDirection === "TO_VAULT" ? custody.id : vault.id;
      const toId = input.transferDirection === "TO_VAULT" ? vault.id : custody.id;
      const saved = await tx.query<IdRow>(`INSERT INTO finance.movements(kind,branch_id,source_id,destination_id,amount,settlement_id,actor_id)
        VALUES('TRANSFER',$1::bigint,$2::bigint,$3::bigint,$4::numeric,$5::bigint,$6::bigint) RETURNING id::text AS id`,
        [custody.branchId, fromId, toId, input.transferAmount, input.settlementId, actor.id]);
      handoverMovementId = saved.rows[0].id;
      await bumpAccounts(tx, [custody.id, vault.id]);
    }

    await tx.query(`UPDATE finance.settlements SET status='CONFIRMED',resolved_by=$1::bigint,resolved_at=CURRENT_TIMESTAMP,
      resolution_reason=$2,transfer_amount=$3::numeric,transfer_direction=$4,adjustment_movement_id=$5::bigint,handover_movement_id=$6::bigint
      WHERE id=$7::bigint`,
      [actor.id, input.reason, input.transferAmount, input.transferDirection, adjustmentMovementId, handoverMovementId, input.settlementId]);
    await audit(tx, "SETTLEMENT", input.settlementId, "CONFIRM", actor.id, input.reason,
      { status: "OPEN", systemBalance: settlement.systemBalance, salesTotal: settlement.salesTotal,
        expensesTotal: settlement.expensesTotal, expectedAmount: settlement.expectedAmount },
      { status: "CONFIRMED", systemBalance: formatCents(current), countedAmount: settlement.countedAmount,
        adjustment: formatCents(adjustment), transferAmount: input.transferAmount, transferDirection: input.transferDirection,
        adjustmentMovementId, handoverMovementId,
        recalculatedAtConfirm: recalculated ? { salesTotal: formatCents(period.sales), expensesTotal: formatCents(period.expenses), expectedAmount: formatCents(expectedNow) } : null });
    return input.settlementId;
  });
}

/** رفض الطلب بسبب: بلا أي أثر مالي، ويبقى في السجل. */
export async function rejectSettlement(db: FinanceDatabase, actorId: string, raw: unknown): Promise<WriteResult> {
  const value = inputObject(raw), input = {
    requestId: requestId(value.requestId),
    settlementId: identifier(value.settlementId, "طلب التسوية"),
    reason: text(value.reason, "سبب الرفض", 300, true)!,
  };
  return command(db, actorId, "SETTLEMENT_REJECT", input.requestId, input, manage, async (tx, actor) => {
    const rows = await tx.query<SettlementListRow>(`SELECT ${SETTLEMENT_SELECT} FROM finance.settlements s WHERE s.id=$1::bigint FOR UPDATE`, [input.settlementId]);
    const settlement = rows.rows[0];
    if (!settlement) throw new FinanceProblem("not_found", "طلب التسوية غير موجود.");
    if (settlement.status !== "OPEN") throw new FinanceProblem("settlement_closed", "طلب التسوية ليس مفتوحًا؛ راجع سجله.");
    await tx.query(`UPDATE finance.settlements SET status='REJECTED',resolved_by=$1::bigint,resolved_at=CURRENT_TIMESTAMP,resolution_reason=$2 WHERE id=$3::bigint`,
      [actor.id, input.reason, input.settlementId]);
    await audit(tx, "SETTLEMENT", input.settlementId, "REJECT", actor.id, input.reason, { status: "OPEN" }, { status: "REJECTED", moneyMoved: false });
    return input.settlementId;
  });
}

/** إلغاء الطلب من صاحبه قبل الاعتماد: بلا أي أثر مالي. */
export async function cancelSettlement(db: FinanceDatabase, actorId: string, raw: unknown): Promise<WriteResult> {
  const value = inputObject(raw), input = {
    requestId: requestId(value.requestId),
    settlementId: identifier(value.settlementId, "طلب التسوية"),
    reason: text(value.reason, "سبب الإلغاء", 300, true)!,
  };
  return command(db, actorId, "SETTLEMENT_CANCEL", input.requestId, input, anyFinanceActor, async (tx, actor) => {
    const rows = await tx.query<SettlementListRow>(`SELECT ${SETTLEMENT_SELECT} FROM finance.settlements s WHERE s.id=$1::bigint FOR UPDATE`, [input.settlementId]);
    const settlement = rows.rows[0];
    if (!settlement) throw new FinanceProblem("not_found", "طلب التسوية غير موجود.");
    if (settlement.status !== "OPEN") throw new FinanceProblem("settlement_closed", "طلب التسوية ليس مفتوحًا؛ راجع سجله.");
    if (settlement.requestedBy !== actor.id && !canManageFinance(actor)) throw new FinanceProblem("forbidden", "إلغاء الطلب لصاحبه أو للإدارة فقط.");
    await tx.query(`UPDATE finance.settlements SET status='CANCELLED',resolved_by=$1::bigint,resolved_at=CURRENT_TIMESTAMP,resolution_reason=$2 WHERE id=$3::bigint`,
      [actor.id, input.reason, input.settlementId]);
    await audit(tx, "SETTLEMENT", input.settlementId, "CANCEL", actor.id, input.reason, { status: "OPEN" }, { status: "CANCELLED", moneyMoved: false });
    return input.settlementId;
  });
}
