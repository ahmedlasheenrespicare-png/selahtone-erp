"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { AppIcon } from "@/components/app-icon";
import { displayMoney } from "@/lib/commerce-display";
import {
  calculateInclusiveTaxExtract,
  detectExpenseDuplicateRisk,
  extractFrequentBeneficiaries,
  normalizeMoneyInput,
  parseOptionalMoneyCents,
  parsePositiveMoneyCents,
  shiftIsoDateDays,
  suggestCategoryTemplates,
} from "@/lib/finance/new-expense-helpers";
import { createExpenseAction } from "../../actions";
import { initialFinanceActionState } from "../../finance-state";

export type BranchOption = { id: string; name: string };
export type CategoryOption = {
  id: string;
  name: string;
  active: boolean;
  lastAmountHint?: string;
};
export type ExistingExpenseHint = {
  id: string;
  branchId: string;
  categoryName: string;
  expenseDate: string;
  amount: string;
  description: string;
  beneficiary?: string | null;
  documentNumber?: string | null;
};

type Props = {
  requestId: string;
  today: string;
  canManage: boolean;
  branches: BranchOption[];
  categories: CategoryOption[];
  existingHints?: ExistingExpenseHint[];
  initialCategoryId?: string;
  userScopeKey?: string;
};

type SavedExpenseDraft = {
  branchId?: string;
  categoryId?: string;
  amount?: string;
  taxAmount?: string;
  expenseDate?: string;
  description?: string;
  beneficiary?: string;
  documentNumber?: string;
};

export default function ExpenseForm({
  requestId,
  today,
  canManage,
  branches,
  categories,
  existingHints = [],
  initialCategoryId = "",
  userScopeKey = "default",
}: Props) {
  const draftStorageKey = `selahtone:new-expense-draft:${userScopeKey}`;
  const yesterday = useMemo(() => shiftIsoDateDays(today, -1), [today]);

  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState(() =>
    categories.some((c) => c.active && c.id === initialCategoryId)
      ? initialCategoryId
      : "",
  );
  const [amount, setAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(today);
  const [description, setDescription] = useState("");
  const [beneficiary, setBeneficiary] = useState("");
  const [documentNumber, setDocumentNumber] = useState("");
  const [taxAmount, setTaxAmount] = useState("");
  const [review, setReview] = useState(false);

  const [draftHydrated, setDraftHydrated] = useState(false);
  const [restoredFromDraft, setRestoredFromDraft] = useState(false);
  const [copiedVoucher, setCopiedVoucher] = useState(false);

  const [state, formAction, pending] = useActionState(
    createExpenseAction,
    initialFinanceActionState,
  );
  const amountInputRef = useRef<HTMLInputElement>(null);

  const activeCategories = useMemo(
    () => categories.filter((category) => category.active),
    [categories],
  );

  // استعادة المسودة المحفوظة تلقائيًا عند فتح الشاشة (مع احترام initialCategoryId إن مرّ من الرابط)
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(draftStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as SavedExpenseDraft;
        if (parsed && typeof parsed === "object") {
          const hasData =
            Boolean(parsed.amount?.trim()) ||
            Boolean(parsed.description?.trim()) ||
            Boolean(parsed.beneficiary?.trim()) ||
            Boolean(parsed.documentNumber?.trim());
          if (hasData) {
            if (parsed.branchId && branches.some((b) => b.id === parsed.branchId)) {
              setBranchId(parsed.branchId);
            }
            if (
              !initialCategoryId &&
              parsed.categoryId &&
              activeCategories.some((c) => c.id === parsed.categoryId)
            ) {
              setCategoryId(parsed.categoryId);
            }
            if (typeof parsed.amount === "string") setAmount(parsed.amount);
            if (typeof parsed.taxAmount === "string") setTaxAmount(parsed.taxAmount);
            if (
              typeof parsed.expenseDate === "string" &&
              /^\d{4}-\d{2}-\d{2}$/.test(parsed.expenseDate) &&
              parsed.expenseDate <= today
            ) {
              setExpenseDate(parsed.expenseDate);
            }
            if (typeof parsed.description === "string") setDescription(parsed.description);
            if (typeof parsed.beneficiary === "string") setBeneficiary(parsed.beneficiary);
            if (typeof parsed.documentNumber === "string") {
              setDocumentNumber(parsed.documentNumber);
            }
            setRestoredFromDraft(true);
          }
        }
      }
    } catch {
      // تجاهل أخطاء التخزين المؤقت
    } finally {
      setDraftHydrated(true);
    }
  }, [draftStorageKey, branches, activeCategories, initialCategoryId, today]);

  // حفظ المسودة تلقائيًا وحذفها فور نجاح تسجيل المصروف
  useEffect(() => {
    if (!draftHydrated) return;
    try {
      if (state.status === "success") {
        window.sessionStorage.removeItem(draftStorageKey);
        return;
      }
      const isEmpty =
        !amount.trim() &&
        !description.trim() &&
        !beneficiary.trim() &&
        !documentNumber.trim() &&
        !taxAmount.trim();
      if (isEmpty) {
        window.sessionStorage.removeItem(draftStorageKey);
        return;
      }
      const payload: SavedExpenseDraft = {
        branchId,
        categoryId,
        amount,
        taxAmount,
        expenseDate,
        description,
        beneficiary,
        documentNumber,
      };
      window.sessionStorage.setItem(draftStorageKey, JSON.stringify(payload));
    } catch {
      // ignore
    }
  }, [
    draftHydrated,
    draftStorageKey,
    state.status,
    branchId,
    categoryId,
    amount,
    taxAmount,
    expenseDate,
    description,
    beneficiary,
    documentNumber,
  ]);

  const normalizedAmount = useMemo(() => normalizeMoneyInput(amount), [amount]);
  const normalizedTaxAmount = useMemo(
    () => normalizeMoneyInput(taxAmount),
    [taxAmount],
  );

  const amountCents = useMemo(() => parsePositiveMoneyCents(amount), [amount]);
  const amountValid = amountCents !== null;

  const parsedTax = useMemo(() => parseOptionalMoneyCents(taxAmount), [taxAmount]);
  const taxValid =
    parsedTax !== null &&
    (parsedTax.empty || (amountCents !== null && parsedTax.cents <= amountCents));

  const netBeforeTaxCents =
    amountCents !== null && parsedTax !== null && !parsedTax.empty && parsedTax.cents <= amountCents
      ? amountCents - parsedTax.cents
      : amountCents ?? 0n;

  const selectedCategoryName =
    categories.find((category) => category.id === categoryId)?.name ?? "";
  const selectedBranchName =
    branches.find((branch) => branch.id === branchId)?.name ?? "الفرع";

  const descriptionTemplates = useMemo(
    () => suggestCategoryTemplates(selectedCategoryName),
    [selectedCategoryName],
  );

  const beneficiarySuggestions = useMemo(() => {
    const base = extractFrequentBeneficiaries(existingHints, branchId);
    const q = beneficiary.trim().toLowerCase();
    if (!q) return base.slice(0, 6);
    return base
      .filter((b) => b.name.toLowerCase().includes(q) && b.name !== beneficiary.trim())
      .slice(0, 6);
  }, [existingHints, branchId, beneficiary]);

  const duplicateRisk = useMemo(
    () =>
      detectExpenseDuplicateRisk(
        {
          branchId,
          categoryName: selectedCategoryName,
          expenseDate,
          amountCents,
          documentNumber,
        },
        existingHints,
      ),
    [branchId, selectedCategoryName, expenseDate, amountCents, documentNumber, existingHints],
  );

  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(expenseDate) && expenseDate <= today;
  const ready =
    Boolean(branchId) &&
    Boolean(categoryId) &&
    amountValid &&
    taxValid &&
    dateValid &&
    description.trim().length > 0;

  const hasDraftData =
    Boolean(amount.trim()) ||
    Boolean(description.trim()) ||
    Boolean(beneficiary.trim()) ||
    Boolean(documentNumber.trim());

  function clearDraft() {
    setReview(false);
    setAmount("");
    setTaxAmount("");
    setExpenseDate(today);
    setDescription("");
    setBeneficiary("");
    setDocumentNumber("");
    setRestoredFromDraft(false);
    try {
      window.sessionStorage.removeItem(draftStorageKey);
    } catch {
      // ignore
    }
  }

  function applyInclusiveTax(rate: 14 | 5) {
    if (amountCents === null) return;
    const res = calculateInclusiveTaxExtract(amountCents, rate);
    setTaxAmount(res.taxInputString);
    setReview(false);
  }

  // ==================== شاشة سند القيد الفوري عقب الحفظ بنجاح ====================
  if (state.status === "success") {
    const savedTotalLabel =
      amountCents !== null ? `${displayMoney(amountCents)} ج.م` : `${normalizedAmount} ج.م`;
    const savedTaxLabel =
      parsedTax && !parsedTax.empty
        ? `${displayMoney(parsedTax.cents)} ج.م`
        : "غير مُدخلة";
    const voucherSummaryText = [
      `سند قيد مصروف — صلة تون (#${state.id ?? "—"})`,
      `• الفرع: ${selectedBranchName}`,
      `• البند: ${selectedCategoryName || "—"}`,
      `• المبلغ الإجمالي: ${savedTotalLabel} (الضريبة: ${savedTaxLabel})`,
      `• التاريخ: ${expenseDate}`,
      `• الوصف: ${description.trim()}`,
      ...(beneficiary.trim() ? [`• المستفيد: ${beneficiary.trim()}`] : []),
      ...(documentNumber.trim() ? [`• رقم المستند: ${documentNumber.trim()}`] : []),
      "• الحالة: بانتظار الاعتماد",
    ].join("\n");

    return (
      <div className="exp-instant-voucher" role="status">
        <div className="exp-instant-voucher__banner">
          <div>
            <p className="fin-heading__eyebrow" style={{ color: "var(--fn-muted)", marginBottom: 4 }}>
              تم حفظ طلب المصروف في سجل التدقيق
            </p>
            <h2 style={{ margin: 0 }}>سند قيد مصروف بانتظار الاعتماد</h2>
          </div>
          {state.id ? (
            <span className="exp-instant-voucher__code" dir="ltr">
              <AppIcon name="expenses" />
              <span>#{state.id}</span>
            </span>
          ) : null}
        </div>

        <p style={{ margin: "0 0 12px", color: "var(--fn-muted)", fontSize: 13 }}>
          {state.message}
        </p>

        <div className="exp-instant-voucher__grid">
          <div className="exp-instant-voucher__stat">
            <span>الفرع والبند</span>
            <strong>{selectedCategoryName || "—"}</strong>
            <small style={{ color: "var(--fn-muted)" }}>{selectedBranchName}</small>
          </div>
          <div className="exp-instant-voucher__stat">
            <span>المبلغ الإجمالي</span>
            <strong dir="ltr">{savedTotalLabel}</strong>
            <small style={{ color: "var(--fn-muted)" }}>الضريبة: {savedTaxLabel}</small>
          </div>
          <div className="exp-instant-voucher__stat">
            <span>تاريخ المصروف</span>
            <strong dir="ltr">{expenseDate}</strong>
          </div>
          <div className="exp-instant-voucher__stat">
            <span>المستفيد والمستند</span>
            <strong>{beneficiary.trim() || "غير محدّد"}</strong>
            {documentNumber.trim() ? (
              <small dir="ltr" style={{ color: "var(--fn-muted)" }}>
                مستند: {documentNumber.trim()}
              </small>
            ) : null}
          </div>
        </div>

        <div className="fin-actions" style={{ flexWrap: "wrap", gap: 10 }}>
          {canManage && state.id ? (
            <Link className="fin-button" href={`/finance/expenses/${state.id}`}>
              <AppIcon name="check" />
              <span>فتح المصروف للاعتماد أو الصرف الآن (#{state.id})</span>
            </Link>
          ) : null}

          <a
            className={canManage && state.id ? "fin-button fin-button--secondary" : "fin-button"}
            href={categoryId ? `/finance/expenses/new?categoryId=${encodeURIComponent(categoryId)}` : "/finance/expenses/new"}
          >
            <AppIcon name="plusCircle" />
            <span>تسجيل مصروف آخر</span>
          </a>

          <button
            type="button"
            className="fin-button fin-button--secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(voucherSummaryText);
                setCopiedVoucher(true);
                setTimeout(() => setCopiedVoucher(false), 2500);
              } catch {
                // ignore
              }
            }}
          >
            <AppIcon name="receipt" />
            <span>{copiedVoucher ? "تم نسخ السند ✓" : "نسخ ملخص السند"}</span>
          </button>

          <Link className="fin-button fin-button--secondary" href="/finance/expenses">
            سجل المصروفات
          </Link>
        </div>
      </div>
    );
  }

  // ==================== نموذج تسجيل المصروف الرئيسي ====================
  return (
    <form
      action={formAction}
      className="exp-new-grid"
      onSubmit={(event) => {
        if (!review) {
          event.preventDefault();
          if (ready) setReview(true);
        }
      }}
    >
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="branchId" value={branchId} />
      <input type="hidden" name="categoryId" value={categoryId} />
      <input type="hidden" name="amount" value={normalizedAmount} />
      <input type="hidden" name="expenseDate" value={expenseDate} />
      <input type="hidden" name="description" value={description.trim()} />
      <input type="hidden" name="beneficiary" value={beneficiary.trim()} />
      <input type="hidden" name="documentNumber" value={documentNumber.trim()} />
      <input type="hidden" name="taxAmount" value={normalizedTaxAmount} />

      <div className="exp-new-main">
        {hasDraftData ? (
          <div className="exp-draft-bar no-print">
            <span className="exp-draft-bar__info">
              <span className="exp-draft-bar__dot" aria-hidden="true" />
              <span>
                {restoredFromDraft
                  ? "استُعيدت مسودة المصروف غير المحفوظة تلقائيًا."
                  : "المسودة محفوظة تلقائيًا في الجلسة حتى تأكيد التسجيل."}
              </span>
            </span>
            <button
              type="button"
              className="exp-draft-reset"
              disabled={pending}
              onClick={clearDraft}
            >
              <AppIcon name="close" />
              <span>تفريغ النموذج</span>
            </button>
          </div>
        ) : null}

        {duplicateRisk ? (
          <div
            className={`exp-dup-banner ${
              duplicateRisk.kind === "DOCUMENT" ? "is-doc" : "is-day"
            }`}
            role="status"
          >
            <span>
              {duplicateRisk.kind === "DOCUMENT" ? (
                <>
                  <strong>تحذير تكرار رقم مستند:</strong> رقم المستند{" "}
                  <bdi dir="ltr">{duplicateRisk.matched.documentNumber}</bdi> مسجّل مسبقًا في مصروف رقم{" "}
                  <strong>#{duplicateRisk.matched.id}</strong> بتاريخ{" "}
                  <bdi dir="ltr">{duplicateRisk.matched.expenseDate}</bdi> بقيمة{" "}
                  <bdi dir="ltr">{duplicateRisk.matched.amount}</bdi> ج.م («
                  {duplicateRisk.matched.description}»).
                </>
              ) : (
                <>
                  <strong>تنبيه تشابه في نفس اليوم:</strong> يوجد مصروف مسجّل بتاريخ{" "}
                  <bdi dir="ltr">{duplicateRisk.matched.expenseDate}</bdi> بنفس القيمة (
                  <bdi dir="ltr">{duplicateRisk.matched.amount}</bdi> ج.م — «
                  {duplicateRisk.matched.description}»). تحقق قبل الحفظ لمنع التكرار.
                </>
              )}
            </span>
            {canManage ? (
              <Link
                className="exp-draft-reset"
                href={`/finance/expenses/${duplicateRisk.matched.id}`}
              >
                فتح #{duplicateRisk.matched.id}
              </Link>
            ) : null}
          </div>
        ) : null}

        {state.status === "error" ? (
          <div className="fin-alert fin-alert--error" role="alert">
            {state.message}
          </div>
        ) : null}

        {/* ١) التصنيف والفرع والمبلغ */}
        <div className="fin-panel">
          <div className="fin-panel__heading">
            <h2>١. البند المحاسبي والمبلغ والتاريخ</h2>
            <p>
              اختر البند بنقرة واحدة أو من القائمة، وأدخل المبلغ الإجمالي (يقبل الأرقام العربية والإنجليزية).
            </p>
          </div>
          <div className="fin-panel__body">
            {activeCategories.length > 0 ? (
              <div className="exp-cat-bar" aria-label="اختيار سريع لبند المصروف">
                <span className="exp-cat-bar__label">اختيار سريع للبند:</span>
                <div className="exp-cat-chips">
                  {activeCategories.map((cat) => {
                    const isSelected = categoryId === cat.id;
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        disabled={pending}
                        className={`exp-cat-chip${isSelected ? " is-active" : ""}`}
                        onClick={() => {
                          setCategoryId(cat.id);
                          setReview(false);
                          setTimeout(() => amountInputRef.current?.focus(), 20);
                        }}
                      >
                        <span>{cat.name}</span>
                        {cat.lastAmountHint ? (
                          <small dir="ltr">آخر قيد: {cat.lastAmountHint}</small>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="fin-fields">
              <label className="field fin-field">
                <span className="fin-field__label">الفرع *</span>
                <select
                  value={branchId}
                  disabled={pending}
                  onChange={(event) => {
                    setBranchId(event.target.value);
                    setReview(false);
                  }}
                >
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field fin-field">
                <span className="fin-field__label">البند المحاسبي *</span>
                <select
                  value={categoryId}
                  disabled={pending}
                  onChange={(event) => {
                    setCategoryId(event.target.value);
                    setReview(false);
                  }}
                >
                  <option value="">— اختر بندًا نشطًا —</option>
                  {activeCategories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
                {activeCategories.length === 0 ? (
                  <span className="fin-field__error">لا يوجد بند نشط؛ أضف بندًا أولًا.</span>
                ) : null}
              </label>

              <label className="field fin-field">
                <span className="fin-field__label">المبلغ الإجمالي (ج.م) *</span>
                <input
                  ref={amountInputRef}
                  inputMode="decimal"
                  dir="ltr"
                  disabled={pending}
                  value={amount}
                  onChange={(event) => {
                    setAmount(event.target.value);
                    setReview(false);
                  }}
                  placeholder="0.00"
                />
                {amount.trim() !== "" && !amountValid ? (
                  <span className="fin-field__error">
                    أدخل مبلغًا موجبًا صالحًا بحد أقصى منزلتين عشريتين.
                  </span>
                ) : (
                  <span className="fin-field__hint">
                    يشمل الضريبة إن وُجدت في المستند الورقي.
                  </span>
                )}
              </label>

              <div className="field fin-field">
                <div className="exp-field-head">
                  <label htmlFor="expense-tax-input" className="fin-field__label">
                    ضريبة ضمن الإجمالي (اختياري)
                  </label>
                  {amountValid ? (
                    <div className="exp-mini-presets" role="group" aria-label="حاسبة ضريبة استرشادية">
                      <button
                        type="button"
                        className="exp-mini-btn"
                        disabled={pending}
                        onClick={() => applyInclusiveTax(14)}
                        title="استخراج ضريبة 14% المشمولة داخل المبلغ الإجمالي"
                      >
                        14% ض.ق.م
                      </button>
                      <button
                        type="button"
                        className="exp-mini-btn"
                        disabled={pending}
                        onClick={() => applyInclusiveTax(5)}
                        title="استخراج ضريبة جدول 5% المشمولة داخل المبلغ الإجمالي"
                      >
                        5% جدول
                      </button>
                      {taxAmount.trim() !== "" ? (
                        <button
                          type="button"
                          className="exp-mini-btn"
                          disabled={pending}
                          onClick={() => {
                            setTaxAmount("");
                            setReview(false);
                          }}
                        >
                          مسح
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <input
                  id="expense-tax-input"
                  inputMode="decimal"
                  dir="ltr"
                  disabled={pending}
                  value={taxAmount}
                  onChange={(event) => {
                    setTaxAmount(event.target.value);
                    setReview(false);
                  }}
                  placeholder="بدون (غير مُدخلة)"
                />
                {!taxValid ? (
                  <span className="fin-field__error">
                    أدخل ضريبة صحيحة لا تتجاوز المبلغ الإجمالي.
                  </span>
                ) : parsedTax && !parsedTax.empty && parsedTax.cents > 0n && amountCents !== null ? (
                  <div className="exp-tax-breakdown">
                    <span>
                      الأصل قبل الضريبة: <bdi dir="ltr">{displayMoney(netBeforeTaxCents)}</bdi> ج.م
                    </span>
                    <span>
                      الضريبة: <bdi dir="ltr">{displayMoney(parsedTax.cents)}</bdi> ج.م
                    </span>
                  </div>
                ) : (
                  <span className="fin-field__hint">
                    تُدخل يدويًا أو بالأزرار الاسترشادية؛ الفارغ يُحفظ «غير مُدخلة».
                  </span>
                )}
              </div>

              <div className="field fin-field fin-field--wide">
                <div className="exp-field-head">
                  <label htmlFor="expense-date-input" className="fin-field__label">
                    تاريخ المصروف الفعلي *
                  </label>
                  <div className="exp-mini-presets">
                    <button
                      type="button"
                      className={`exp-mini-btn${expenseDate === today ? " is-active" : ""}`}
                      disabled={pending}
                      onClick={() => {
                        setExpenseDate(today);
                        setReview(false);
                      }}
                    >
                      اليوم ({today})
                    </button>
                    <button
                      type="button"
                      className={`exp-mini-btn${expenseDate === yesterday ? " is-active" : ""}`}
                      disabled={pending}
                      onClick={() => {
                        setExpenseDate(yesterday);
                        setReview(false);
                      }}
                    >
                      أمس ({yesterday})
                    </button>
                  </div>
                </div>
                <input
                  id="expense-date-input"
                  type="date"
                  value={expenseDate}
                  max={today}
                  disabled={pending}
                  onChange={(event) => {
                    setExpenseDate(event.target.value);
                    setReview(false);
                  }}
                />
                {!dateValid ? (
                  <span className="fin-field__error">
                    اختر تاريخًا صحيحًا لا يتجاوز تاريخ اليوم ({today}).
                  </span>
                ) : (
                  <span className="fin-field__hint">
                    وقت وتوقيت الإدخال الفعلي يُحفظان تلقائيًا بشكل منفصل للتدقيق.
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ٢) الوصف والمستفيد ورقم المستند */}
        <div className="fin-panel">
          <div className="fin-panel__heading">
            <h2>٢. البيان التفصيلي والمستند المؤيّد</h2>
            <p>
              اكتب بيانًا واضحًا للمراجع، وأضف اسم المستفيد ورقم الفاتورة أو الإيصال الورقي متى وُجد.
            </p>
          </div>
          <div className="fin-panel__body">
            <div className="fin-fields">
              <div className="field fin-field fin-field--wide">
                <label htmlFor="expense-description-input" className="fin-field__label">
                  الوصف والبيان * ({description.trim().length}/180)
                </label>
                <input
                  id="expense-description-input"
                  value={description}
                  maxLength={180}
                  disabled={pending}
                  placeholder="مثال: فاتورة كهرباء الفرع لشهر نوفمبر…"
                  onChange={(event) => {
                    setDescription(event.target.value);
                    setReview(false);
                  }}
                />
                <div className="sale-quick-chips" role="group" aria-label="قوالب وصف سريعة">
                  {descriptionTemplates.map((tpl) => (
                    <button
                      key={tpl}
                      type="button"
                      disabled={pending}
                      className={`sale-quick-chip${description === tpl ? " is-active" : ""}`}
                      onClick={() => {
                        setDescription(tpl);
                        setReview(false);
                      }}
                    >
                      <span>{tpl}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="field fin-field">
                <label htmlFor="expense-beneficiary-input" className="fin-field__label">
                  المستفيد / المورّد (اختياري)
                </label>
                <input
                  id="expense-beneficiary-input"
                  value={beneficiary}
                  maxLength={120}
                  disabled={pending}
                  placeholder="مثال: شركة الكهرباء / شركة الشحن"
                  onChange={(event) => {
                    setBeneficiary(event.target.value);
                    setReview(false);
                  }}
                />
                {beneficiarySuggestions.length > 0 ? (
                  <div className="sale-quick-chips" aria-label="مستفيدون سابقون">
                    {beneficiarySuggestions.map((b) => (
                      <button
                        key={b.name}
                        type="button"
                        disabled={pending}
                        className="sale-quick-chip"
                        onClick={() => {
                          setBeneficiary(b.name);
                          setReview(false);
                        }}
                      >
                        <span>{b.name}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="field fin-field">
                <label htmlFor="expense-doc-input" className="fin-field__label">
                  رقم الفاتورة / المستند الورقي (اختياري)
                </label>
                <input
                  id="expense-doc-input"
                  value={documentNumber}
                  maxLength={120}
                  dir="ltr"
                  disabled={pending}
                  placeholder="INV-2026-..."
                  onChange={(event) => {
                    setDocumentNumber(event.target.value);
                    setReview(false);
                  }}
                />
                <span className="fin-field__hint">
                  يُفحص تلقائيًا مقابل السجل السابق لمنع صرف نفس الفاتورة مرتين.
                </span>
              </div>
            </div>
          </div>
        </div>

        {review ? (
          <div className="fin-review" role="status">
            <h2>راجع بيانات سند المصروف قبل التأكيد النهائي</h2>
            <ul>
              <li>الفرع: {selectedBranchName}</li>
              <li>البند: {selectedCategoryName || "—"}</li>
              <li>
                المبلغ الإجمالي:{" "}
                <bdi dir="ltr">
                  {amountCents !== null ? displayMoney(amountCents) : normalizedAmount}
                </bdi>{" "}
                ج.م
                {parsedTax && !parsedTax.empty
                  ? ` (منها ضريبة ${displayMoney(parsedTax.cents)} ج.م · الصافي قبل الضريبة ${displayMoney(netBeforeTaxCents)} ج.م)`
                  : " (الضريبة: غير مُدخلة)"}
              </li>
              <li>تاريخ المصروف: {expenseDate}</li>
              <li>الوصف: {description.trim()}</li>
              {beneficiary.trim() ? <li>المستفيد: {beneficiary.trim()}</li> : null}
              {documentNumber.trim() ? (
                <li>
                  رقم المستند: <bdi dir="ltr">{documentNumber.trim()}</bdi>
                </li>
              ) : null}
            </ul>
            <p className="fin-field__hint">
              يُسجَّل المصروف بحالة «بانتظار الاعتماد»؛ لا يُخصم من أي خزنة أو عهدة إلا بخطوة الصرف اللاحقة.
            </p>
          </div>
        ) : null}

        <div className="fin-form-actions">
          {!review ? (
            <button
              type="button"
              className="fin-button"
              disabled={!ready}
              onClick={() => setReview(true)}
            >
              <AppIcon name="expenses" />
              <span>مراجعة سند المصروف</span>
            </button>
          ) : (
            <>
              <button
                type="submit"
                className="fin-button"
                disabled={pending || !ready}
              >
                <AppIcon name="check" />
                <span>{pending ? "جارٍ الحفظ…" : "تأكيد تسجيل المصروف"}</span>
              </button>
              <button
                type="button"
                className="fin-button fin-button--secondary"
                disabled={pending}
                onClick={() => setReview(false)}
              >
                تعديل البيانات
              </button>
            </>
          )}
          <Link className="fin-button fin-button--text" href="/finance/expenses">
            إلغاء
          </Link>
        </div>
      </div>

      {/* ==================== معاينة سند قيد المصروف المثبّتة ==================== */}
      <aside className="fin-side exp-live-voucher" aria-label="معاينة سند قيد المصروف">
        <div className="exp-voucher-head">
          <h2>سند قيد مصروف</h2>
          <span className="exp-voucher-status">بانتظار الاعتماد</span>
        </div>

        <dl className="exp-voucher-list">
          <div>
            <dt>الفرع</dt>
            <dd>{selectedBranchName}</dd>
          </div>
          <div>
            <dt>البند المحاسبي</dt>
            <dd>{selectedCategoryName || "لم يُختر بعد"}</dd>
          </div>
          <div>
            <dt>تاريخ المصروف</dt>
            <dd dir="ltr">{expenseDate || "—"}</dd>
          </div>
          <div>
            <dt>المستفيد</dt>
            <dd>{beneficiary.trim() || "—"}</dd>
          </div>
          <div>
            <dt>رقم المستند</dt>
            <dd dir="ltr">{documentNumber.trim() || "—"}</dd>
          </div>
          {parsedTax && !parsedTax.empty && amountCents !== null ? (
            <>
              <div>
                <dt>الأصل قبل الضريبة</dt>
                <dd dir="ltr">{displayMoney(netBeforeTaxCents)} ج.م</dd>
              </div>
              <div>
                <dt>الضريبة المشمولة</dt>
                <dd dir="ltr">{displayMoney(parsedTax.cents)} ج.م</dd>
              </div>
            </>
          ) : (
            <div>
              <dt>الضريبة</dt>
              <dd>غير مُدخلة</dd>
            </div>
          )}
          <div className="exp-voucher-total">
            <dt>الإجمالي</dt>
            <dd dir="ltr">
              {amountCents !== null ? `${displayMoney(amountCents)} ج.م` : "0.00 ج.م"}
            </dd>
          </div>
        </dl>

        <div className="exp-voucher-cta no-print">
          {!review ? (
            <button
              type="button"
              className="fin-button"
              disabled={!ready || pending}
              onClick={() => setReview(true)}
            >
              <AppIcon name="expenses" />
              <span>مراجعة سند المصروف</span>
            </button>
          ) : (
            <button
              type="submit"
              className="fin-button"
              disabled={pending || !ready}
            >
              <AppIcon name="check" />
              <span>{pending ? "جارٍ الحفظ…" : "تأكيد التسجيل الآن"}</span>
            </button>
          )}
        </div>

        <p style={{ margin: 0, fontSize: 11.5 }}>
          <strong>دورة الرقابة:</strong> ١. تسجيل القيد ← ٢. اعتماد المدير/المحاسب ← ٣. الصرف الفعلي من العهدة أو الخزنة.
        </p>
      </aside>
    </form>
  );
}
