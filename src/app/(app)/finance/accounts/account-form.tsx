"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { AppIcon } from "@/components/app-icon";
import { displayMoney } from "@/lib/commerce-display";
import {
  CASH_DENOMINATIONS,
  calculateDenominationTotal,
  type CashDenomination,
  normalizeAccountMoneyInput,
  parseNonNegativeMoneyCents,
  shiftIsoDateDays,
} from "@/lib/finance/new-account-helpers";
import { openAccountAction } from "../actions";
import { initialFinanceActionState } from "../finance-state";

export type BranchOption = { id: string; name: string; code: string };
export type StaffOption = { id: string; name: string; branchId: string };

type Props = {
  requestId: string;
  today: string;
  branches: BranchOption[];
  staff: StaffOption[];
  vaultBranches: string[];
  custodyStaff: string[];
  closedCustodyStaff?: string[];
  missingVaultBranches?: BranchOption[];
  initialKind?: "VAULT" | "CUSTODY";
  initialBranchId?: string;
  initialHolderId?: string;
  userScopeKey?: string;
};

type SavedAccountDraft = {
  kind?: "VAULT" | "CUSTODY";
  branchId?: string;
  holderId?: string;
  openingAmount?: string;
  openingDate?: string;
};

export default function AccountForm({
  requestId,
  today,
  branches,
  staff,
  vaultBranches,
  custodyStaff,
  closedCustodyStaff = [],
  missingVaultBranches = [],
  initialKind,
  initialBranchId,
  initialHolderId,
  userScopeKey = "default",
}: Props) {
  const draftStorageKey = `selahtone:new-account-draft:${userScopeKey}`;
  const yesterday = useMemo(() => shiftIsoDateDays(today, -1), [today]);

  const defaultBranchId = useMemo(() => {
    if (initialBranchId && branches.some((b) => b.id === initialBranchId)) {
      return initialBranchId;
    }
    if (missingVaultBranches[0]?.id) {
      return missingVaultBranches[0].id;
    }
    return branches[0]?.id ?? "";
  }, [initialBranchId, missingVaultBranches, branches]);

  const [kind, setKind] = useState<"VAULT" | "CUSTODY">(initialKind ?? "VAULT");
  const [branchId, setBranchId] = useState(defaultBranchId);
  const [holderId, setHolderId] = useState(() =>
    initialHolderId && staff.some((s) => s.id === initialHolderId && s.branchId === defaultBranchId)
      ? initialHolderId
      : "",
  );
  const [openingAmount, setOpeningAmount] = useState("");
  const [openingDate, setOpeningDate] = useState(today);
  const [counted, setCounted] = useState(false);
  const [review, setReview] = useState(false);

  // حاسبة فئات النقد الاختيارية للجرد الفعلي
  const [showDenomCalc, setShowDenomCalc] = useState(false);
  const [billCounts, setBillCounts] = useState<Partial<Record<CashDenomination, string>>>({});
  const [coinsInput, setCoinsInput] = useState("");

  const [draftHydrated, setDraftHydrated] = useState(false);
  const [restoredFromDraft, setRestoredFromDraft] = useState(false);
  const [copiedProtocol, setCopiedProtocol] = useState(false);

  const [state, formAction, pending] = useActionState(
    openAccountAction,
    initialFinanceActionState,
  );
  const amountInputRef = useRef<HTMLInputElement>(null);

  // استعادة المسودة غير المحفوظة (مع إعطاء الأولوية للمعاملات القادمة من الرابط إن وُجدت)
  useEffect(() => {
    try {
      const hasUrlPreset = Boolean(initialKind || initialBranchId || initialHolderId);
      const raw = window.sessionStorage.getItem(draftStorageKey);
      if (raw && !hasUrlPreset) {
        const parsed = JSON.parse(raw) as SavedAccountDraft;
        if (parsed && typeof parsed === "object" && parsed.openingAmount?.trim()) {
          if (parsed.kind === "VAULT" || parsed.kind === "CUSTODY") setKind(parsed.kind);
          if (parsed.branchId && branches.some((b) => b.id === parsed.branchId)) {
            setBranchId(parsed.branchId);
          }
          if (parsed.holderId && staff.some((s) => s.id === parsed.holderId)) {
            setHolderId(parsed.holderId);
          }
          if (typeof parsed.openingAmount === "string") setOpeningAmount(parsed.openingAmount);
          if (
            typeof parsed.openingDate === "string" &&
            /^\d{4}-\d{2}-\d{2}$/.test(parsed.openingDate) &&
            parsed.openingDate <= today
          ) {
            setOpeningDate(parsed.openingDate);
          }
          setRestoredFromDraft(true);
        }
      }
    } catch {
      // ignore
    } finally {
      setDraftHydrated(true);
    }
  }, [draftStorageKey, branches, staff, initialKind, initialBranchId, initialHolderId, today]);

  useEffect(() => {
    if (!draftHydrated) return;
    try {
      if (state.status === "success") {
        window.sessionStorage.removeItem(draftStorageKey);
        return;
      }
      if (!openingAmount.trim() && !holderId) {
        window.sessionStorage.removeItem(draftStorageKey);
        return;
      }
      const payload: SavedAccountDraft = {
        kind,
        branchId,
        holderId,
        openingAmount,
        openingDate,
      };
      window.sessionStorage.setItem(draftStorageKey, JSON.stringify(payload));
    } catch {
      // ignore
    }
  }, [draftHydrated, draftStorageKey, state.status, kind, branchId, holderId, openingAmount, openingDate]);

  const branchStaff = useMemo(
    () => staff.filter((member) => member.branchId === branchId),
    [staff, branchId],
  );

  const duplicate =
    kind === "VAULT"
      ? vaultBranches.includes(branchId)
      : Boolean(holderId) && custodyStaff.includes(holderId);

  const hasPriorClosedCustody =
    kind === "CUSTODY" && Boolean(holderId) && closedCustodyStaff.includes(holderId);

  const normalizedAmount = useMemo(
    () => normalizeAccountMoneyInput(openingAmount),
    [openingAmount],
  );
  const amountCents = useMemo(
    () => parseNonNegativeMoneyCents(openingAmount),
    [openingAmount],
  );
  const amountValid = amountCents !== null;

  const denomSummary = useMemo(
    () => calculateDenominationTotal(billCounts, coinsInput),
    [billCounts, coinsInput],
  );

  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(openingDate) && openingDate <= today;
  const ready =
    Boolean(branchId) &&
    amountValid &&
    dateValid &&
    counted &&
    !duplicate &&
    (kind === "VAULT" || Boolean(holderId));

  const selectedBranch = branches.find((b) => b.id === branchId);
  const selectedHolder = branchStaff.find((m) => m.id === holderId);

  function clearDraft() {
    setReview(false);
    setOpeningAmount("");
    setOpeningDate(today);
    setCounted(false);
    setBillCounts({});
    setCoinsInput("");
    setRestoredFromDraft(false);
    try {
      window.sessionStorage.removeItem(draftStorageKey);
    } catch {
      // ignore
    }
  }

  // ==================== شاشة محضر الافتتاح الفوري عقب النجاح ====================
  if (state.status === "success") {
    const savedAmountLabel =
      amountCents !== null ? `${displayMoney(amountCents)} ج.م` : `${normalizedAmount} ج.م`;
    const protocolText = [
      `محضر فتح حساب نقدي — صلة تون (#${state.id ?? "—"})`,
      `• النوع: ${kind === "VAULT" ? "خزنة الفرع الرئيسية" : "عهدة نقدية لموظف"}`,
      `• الفرع: ${selectedBranch ? `${selectedBranch.name} (${selectedBranch.code})` : "—"}`,
      ...(kind === "CUSTODY" ? [`• صاحب العهدة: ${selectedHolder?.name ?? "—"}`] : []),
      `• رصيد البداية الفعلي: ${savedAmountLabel}`,
      `• تاريخ الجرد: ${openingDate}`,
      "• حالة الجرد: مُقرّ فعليًا وموثّق في سجل التدقيق",
    ].join("\n");

    return (
      <div className="acc-instant-protocol" role="status">
        <div className="acc-instant-protocol__banner">
          <div>
            <p className="fin-heading__eyebrow" style={{ color: "var(--fn-muted)", marginBottom: 4 }}>
              تم توثيق الحساب النقدي في سجل التدقيق
            </p>
            <h2 style={{ margin: 0 }}>
              {kind === "VAULT" ? "تم فتح خزنة الفرع بنجاح" : "تم فتح عهدة الموظف بنجاح"}
            </h2>
          </div>
          {state.id ? (
            <span className="acc-instant-protocol__code" dir="ltr">
              <AppIcon name="cash" />
              <span>#{state.id}</span>
            </span>
          ) : null}
        </div>

        <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--fn-muted)" }}>
          {state.message}
        </p>

        <div className="acc-instant-protocol__grid">
          <div className="acc-instant-protocol__stat">
            <span>نوع الحساب</span>
            <strong>{kind === "VAULT" ? "خزنة الفرع" : "عهدة موظف"}</strong>
          </div>
          <div className="acc-instant-protocol__stat">
            <span>الفرع{kind === "CUSTODY" ? " والموظف" : ""}</span>
            <strong>{selectedBranch?.name ?? "—"}</strong>
            {kind === "CUSTODY" && selectedHolder ? (
              <small style={{ color: "var(--fn-muted)" }}>{selectedHolder.name}</small>
            ) : null}
          </div>
          <div className="acc-instant-protocol__stat">
            <span>رصيد البداية الفعلي</span>
            <strong dir="ltr">{savedAmountLabel}</strong>
          </div>
          <div className="acc-instant-protocol__stat">
            <span>تاريخ الجرد الفعلي</span>
            <strong dir="ltr">{openingDate}</strong>
          </div>
        </div>

        <div className="fin-actions" style={{ flexWrap: "wrap", gap: 10 }}>
          <Link className="fin-button" href="/finance">
            <AppIcon name="cash" />
            <span>عرض الحسابات النقدية</span>
          </Link>
          <Link className="fin-button fin-button--secondary" href="/finance/transfers">
            <AppIcon name="arrow" />
            <span>تسليم وتحويل النقد</span>
          </Link>
          <a className="fin-button fin-button--secondary" href="/finance/accounts">
            <AppIcon name="plusCircle" />
            <span>فتح حساب آخر</span>
          </a>
          <button
            type="button"
            className="fin-button fin-button--secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(protocolText);
                setCopiedProtocol(true);
                setTimeout(() => setCopiedProtocol(false), 2500);
              } catch {
                // ignore
              }
            }}
          >
            <AppIcon name="receipt" />
            <span>{copiedProtocol ? "تم نسخ المحضر ✓" : "نسخ ملخص المحضر"}</span>
          </button>
        </div>
      </div>
    );
  }

  // ==================== نموذج فتح الخزنة أو العهدة الرئيسي ====================
  return (
    <form
      action={formAction}
      className="acc-open-grid"
      onSubmit={(event) => {
        if (!review) {
          event.preventDefault();
          if (ready) setReview(true);
        }
      }}
    >
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="branchId" value={branchId} />
      <input type="hidden" name="holderId" value={kind === "CUSTODY" ? holderId : ""} />
      <input type="hidden" name="openingAmount" value={normalizedAmount} />
      <input type="hidden" name="openingDate" value={openingDate} />
      <input type="hidden" name="counted" value={counted ? "yes" : "no"} />

      <div className="acc-open-main">
        {missingVaultBranches.length > 0 ? (
          <div className="acc-missing-vaults no-print" role="status">
            <div className="acc-missing-vaults__info">
              <strong>
                {missingVaultBranches.length === 1
                  ? "يوجد فرع نشط واحد بدون خزنة مفتوحة"
                  : `توجد ${missingVaultBranches.length} فروع نشطة بدون خزنة مفتوحة`}
              </strong>
              <span>اختر الفرع بنقرة واحدة لتجهيز فتح خزنته الرئيسية فورًا:</span>
            </div>
            <div className="acc-missing-vaults__chips">
              {missingVaultBranches.map((mb) => (
                <button
                  key={mb.id}
                  type="button"
                  disabled={pending}
                  className="acc-missing-chip"
                  onClick={() => {
                    setKind("VAULT");
                    setBranchId(mb.id);
                    setHolderId("");
                    setReview(false);
                    setTimeout(() => amountInputRef.current?.focus(), 20);
                  }}
                >
                  <AppIcon name="plusCircle" />
                  <span>
                    فتح خزنة {mb.name} ({mb.code})
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {openingAmount.trim() !== "" || restoredFromDraft ? (
          <div className="acc-draft-bar no-print">
            <span className="acc-draft-bar__info">
              <span className="acc-draft-bar__dot" aria-hidden="true" />
              <span>
                {restoredFromDraft
                  ? "استُعيدت مسودة فتح الحساب غير المحفوظة تلقائيًا."
                  : "المسودة محفوظة تلقائيًا في الجلسة حتى تأكيد فتح الحساب."}
              </span>
            </span>
            <button
              type="button"
              className="acc-draft-reset"
              disabled={pending}
              onClick={clearDraft}
            >
              <AppIcon name="close" />
              <span>تفريغ النموذج</span>
            </button>
          </div>
        ) : null}

        {state.status === "error" ? (
          <div className="fin-alert fin-alert--error" role="alert">
            {state.message}
            {state.details?.currentBalance
              ? ` الرصيد الحالي كما تراه قاعدة البيانات: ${state.details.currentBalance}.`
              : ""}
          </div>
        ) : null}

        {/* ١) نوع الحساب والفرع والموظف */}
        <div className="fin-panel">
          <div className="fin-panel__heading">
            <h2>١. نوع الحساب النقدي والفرع</h2>
            <p>خزنة رئيسية واحدة لكل فرع نشط، وعهدة نقدية واحدة مفتوحة لكل موظف نشط في فرعه.</p>
          </div>
          <div className="fin-panel__body">
            <div className="acc-kind-cards" role="radiogroup" aria-label="نوع الحساب النقدي">
              <button
                type="button"
                role="radio"
                aria-checked={kind === "VAULT"}
                disabled={pending}
                className={`acc-kind-card${kind === "VAULT" ? " is-active" : ""}`}
                onClick={() => {
                  setKind("VAULT");
                  setReview(false);
                }}
              >
                <span className="acc-kind-card__icon" aria-hidden="true">
                  <AppIcon name="shield" />
                </span>
                <span className="acc-kind-card__body">
                  <strong>خزنة الفرع الرئيسية</strong>
                  <small>الحساب المركزي للفرع لتجميع التسويات وتغذية العُهَد وصرف المصروفات المعتمدة.</small>
                </span>
              </button>

              <button
                type="button"
                role="radio"
                aria-checked={kind === "CUSTODY"}
                disabled={pending}
                className={`acc-kind-card${kind === "CUSTODY" ? " is-active" : ""}`}
                onClick={() => {
                  setKind("CUSTODY");
                  setReview(false);
                }}
              >
                <span className="acc-kind-card__icon" aria-hidden="true">
                  <AppIcon name="cash" />
                </span>
                <span className="acc-kind-card__body">
                  <strong>عهدة نقدية لموظف</strong>
                  <small>ذمّة نقدية باسم موظف الفرع لتحصيل المبيعات النقدية أو المصروفات ثم تسويتها للخزنة.</small>
                </span>
              </button>
            </div>

            {branches.length > 0 ? (
              <div className="acc-chip-bar" aria-label="اختيار سريع للفرع">
                <span className="acc-chip-bar__label">اختيار سريع للفرع:</span>
                <div className="acc-chip-grid">
                  {branches.map((branch) => {
                    const hasVault = vaultBranches.includes(branch.id);
                    const isSelected = branchId === branch.id;
                    return (
                      <button
                        key={branch.id}
                        type="button"
                        disabled={pending}
                        className={`acc-entity-chip${isSelected ? " is-active" : ""}`}
                        onClick={() => {
                          setBranchId(branch.id);
                          setHolderId("");
                          setReview(false);
                        }}
                      >
                        <span>
                          {branch.name} ({branch.code})
                        </span>
                        <small>
                          {kind === "VAULT"
                            ? hasVault
                              ? "خزنته مفتوحة ✓"
                              : "متاح للفتح"
                            : `${staff.filter((s) => s.branchId === branch.id).length} موظف`}
                        </small>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="fin-fields">
              <label className="field fin-field">
                <span className="fin-field__label">النوع *</span>
                <select
                  value={kind}
                  disabled={pending}
                  onChange={(event) => {
                    setKind(event.target.value as "VAULT" | "CUSTODY");
                    setReview(false);
                  }}
                >
                  <option value="VAULT">خزنة الفرع</option>
                  <option value="CUSTODY">عهدة موظف</option>
                </select>
              </label>

              <label className="field fin-field">
                <span className="fin-field__label">الفرع *</span>
                <select
                  value={branchId}
                  disabled={pending}
                  onChange={(event) => {
                    setBranchId(event.target.value);
                    setHolderId("");
                    setReview(false);
                  }}
                >
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name} ({branch.code})
                      {vaultBranches.includes(branch.id) && kind === "VAULT"
                        ? " — خزنته مفتوحة"
                        : ""}
                    </option>
                  ))}
                </select>
              </label>

              {kind === "CUSTODY" ? (
                <div className="field fin-field fin-field--wide">
                  <label htmlFor="account-holder-select" className="fin-field__label">
                    الموظف صاحب العهدة *
                  </label>
                  {branchStaff.length > 0 ? (
                    <div className="acc-chip-grid" style={{ marginBottom: 8 }}>
                      {branchStaff.map((member) => {
                        const hasOpen = custodyStaff.includes(member.id);
                        const hasClosed = closedCustodyStaff.includes(member.id);
                        const isSelected = holderId === member.id;
                        return (
                          <button
                            key={member.id}
                            type="button"
                            disabled={pending}
                            className={`acc-entity-chip${isSelected ? " is-active" : ""}`}
                            onClick={() => {
                              setHolderId(member.id);
                              setReview(false);
                              if (!hasOpen) {
                                setTimeout(() => amountInputRef.current?.focus(), 20);
                              }
                            }}
                          >
                            <span>{member.name}</span>
                            <small>
                              {hasOpen
                                ? "لديه عهدة مفتوحة"
                                : hasClosed
                                  ? "عهدة سابقة مقفلة"
                                  : "متاح للفتح"}
                            </small>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}

                  <select
                    id="account-holder-select"
                    value={holderId}
                    disabled={pending}
                    onChange={(event) => {
                      setHolderId(event.target.value);
                      setReview(false);
                    }}
                  >
                    <option value="">— اختر موظفًا نشطًا في الفرع —</option>
                    {branchStaff.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                        {custodyStaff.includes(member.id)
                          ? " — لديه عهدة مفتوحة"
                          : closedCustodyStaff.includes(member.id)
                            ? " — عهدة سابقة مقفلة (متاح)"
                            : ""}
                      </option>
                    ))}
                  </select>
                  {branchStaff.length === 0 ? (
                    <span className="fin-field__error">
                      لا يوجد موظف فرع نشط منسوب لهذا الفرع حاليًا.
                    </span>
                  ) : hasPriorClosedCustody && !duplicate ? (
                    <span className="fin-field__hint">
                      لهذا الموظف عهدة سابقة مقفلة بعد تصفيتها؛ يمكن فتح عهدة جديدة له بجرد فعلي جديد.
                    </span>
                  ) : (
                    <span className="fin-field__hint">
                      يظهر الموظفون النشطون المنسوبون إلى هذا الفرع فقط.
                    </span>
                  )}
                </div>
              ) : null}

              {duplicate ? (
                <div className="fin-alert fin-alert--warning fin-field--wide" role="status">
                  {kind === "VAULT"
                    ? "لهذا الفرع خزنة مفتوحة بالفعل؛ لا يمكن فتح خزنة ثانية لنفس الفرع."
                    : "لهذا الموظف عهدة مفتوحة بالفعل؛ صفِّها وأقفلها أولًا قبل فتح عهدة جديدة."}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {/* ٢) رصيد البداية الفعلي وحاسبة فئات النقد */}
        <div className="fin-panel">
          <div className="fin-panel__heading">
            <h2>٢. رصيد البداية وتأكيد الجرد الفعلي</h2>
            <p>
              يُسجَّل الرصيد بعد عدّ النقد فعليًا (يقبل الأرقام العربية والإنجليزية). الصفر مقبول فقط إن كانت الخزنة أو العهدة فارغة فعليًا وقت الفتح.
            </p>
          </div>
          <div className="fin-panel__body">
            <div className="fin-fields">
              <div className="field fin-field">
                <div className="acc-field-head">
                  <label htmlFor="account-opening-amount" className="fin-field__label">
                    رصيد البداية الفعلي (ج.م) *
                  </label>
                  <div className="acc-mini-presets">
                    <button
                      type="button"
                      disabled={pending}
                      className={`acc-mini-btn${normalizedAmount === "0" || normalizedAmount === "0.00" ? " is-active" : ""}`}
                      onClick={() => {
                        setOpeningAmount("0.00");
                        setReview(false);
                      }}
                    >
                      رصيد صفري (0.00)
                    </button>
                  </div>
                </div>
                <input
                  id="account-opening-amount"
                  ref={amountInputRef}
                  inputMode="decimal"
                  dir="ltr"
                  disabled={pending}
                  value={openingAmount}
                  onChange={(event) => {
                    setOpeningAmount(event.target.value);
                    setReview(false);
                  }}
                  placeholder="0.00"
                />
                {openingAmount.trim() !== "" && !amountValid ? (
                  <span className="fin-field__error">
                    أدخل مبلغًا غير سالب بحد أقصى منزلتين عشريتين.
                  </span>
                ) : (
                  <span className="fin-field__hint">
                    استخدم حاسبة فئات النقد بالأسفل لجمع الأوراق النقدية تلقائيًا دون خطأ يدوي.
                  </span>
                )}
              </div>

              <div className="field fin-field">
                <div className="acc-field-head">
                  <label htmlFor="account-opening-date" className="fin-field__label">
                    تاريخ الجرد الفعلي *
                  </label>
                  <div className="acc-mini-presets">
                    <button
                      type="button"
                      disabled={pending}
                      className={`acc-mini-btn${openingDate === today ? " is-active" : ""}`}
                      onClick={() => {
                        setOpeningDate(today);
                        setReview(false);
                      }}
                    >
                      اليوم ({today})
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      className={`acc-mini-btn${openingDate === yesterday ? " is-active" : ""}`}
                      onClick={() => {
                        setOpeningDate(yesterday);
                        setReview(false);
                      }}
                    >
                      أمس ({yesterday})
                    </button>
                  </div>
                </div>
                <input
                  id="account-opening-date"
                  type="date"
                  value={openingDate}
                  max={today}
                  disabled={pending}
                  onChange={(event) => {
                    setOpeningDate(event.target.value);
                    setReview(false);
                  }}
                />
                {!dateValid ? (
                  <span className="fin-field__error">
                    اختر تاريخ جرد صحيحًا لا يتجاوز تاريخ اليوم ({today}).
                  </span>
                ) : null}
              </div>

              {/* حاسبة فئات النقد الورقية والمعدنية */}
              <div className="fin-field--wide no-print">
                <button
                  type="button"
                  className="acc-denom-toggle"
                  onClick={() => setShowDenomCalc((prev) => !prev)}
                >
                  <AppIcon name="cash" />
                  <span>
                    {showDenomCalc
                      ? "إخفاء حاسبة فئات النقد للجرد الفعلي"
                      : "فتح حاسبة فئات النقد للجرد الفعلي (200 · 100 · 50 · 20 · 10 · 5 · 1 ج.م)"}
                  </span>
                </button>

                {showDenomCalc ? (
                  <div className="acc-denom-box" aria-label="حاسبة فئات النقد">
                    <div className="acc-denom-grid">
                      {CASH_DENOMINATIONS.map((denom) => (
                        <label key={denom} className="acc-denom-cell">
                          <span>فئة {denom} ج.م</span>
                          <input
                            inputMode="numeric"
                            dir="ltr"
                            disabled={pending}
                            value={billCounts[denom] ?? ""}
                            placeholder="عدد الأوراق"
                            onChange={(e) =>
                              setBillCounts((prev) => ({
                                ...prev,
                                [denom]: e.target.value,
                              }))
                            }
                          />
                        </label>
                      ))}
                      <label className="acc-denom-cell">
                        <span>عملات وفكة (ج.م)</span>
                        <input
                          inputMode="decimal"
                          dir="ltr"
                          disabled={pending}
                          value={coinsInput}
                          placeholder="0.00"
                          onChange={(e) => setCoinsInput(e.target.value)}
                        />
                      </label>
                    </div>

                    <div className="acc-denom-footer">
                      {denomSummary.valid ? (
                        <span className="acc-denom-total">
                          <span>إجمالي العدّ ({denomSummary.totalBillsCount} ورقة):</span>
                          <bdi dir="ltr">{displayMoney(denomSummary.totalCents)} ج.م</bdi>
                        </span>
                      ) : (
                        <span className="fin-field__error">
                          تحقق من إدخال أعداد صحيحة للأوراق النقدية ومبلغ صالح للفكة.
                        </span>
                      )}

                      <div className="fin-actions" style={{ gap: 8 }}>
                        <button
                          type="button"
                          className="fin-button fin-button--secondary"
                          disabled={pending || !denomSummary.valid}
                          onClick={() => {
                            setOpeningAmount(denomSummary.totalInputString);
                            setCounted(true);
                            setReview(false);
                          }}
                        >
                          <AppIcon name="check" />
                          <span>اعتماد المجموع في رصيد البداية</span>
                        </button>
                        <button
                          type="button"
                          className="acc-draft-reset"
                          disabled={pending}
                          onClick={() => {
                            setBillCounts({});
                            setCoinsInput("");
                          }}
                        >
                          تصفير الحاسبة
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>

              <label className="fin-check fin-field--wide">
                <input
                  type="checkbox"
                  checked={counted}
                  disabled={pending}
                  onChange={(event) => {
                    setCounted(event.target.checked);
                    setReview(false);
                  }}
                />
                <span>أقرّ بأنني جردتُ النقد فعليًا وأن هذا هو الرصيد الواقعي وقت الفتح.</span>
              </label>
            </div>
          </div>
        </div>

        {review ? (
          <div className="fin-review" role="status">
            <h2>راجع بيانات محضر فتح الحساب قبل التأكيد النهائي</h2>
            <ul>
              <li>النوع: {kind === "VAULT" ? "خزنة الفرع الرئيسية" : "عهدة نقدية لموظف"}</li>
              <li>
                الفرع: {selectedBranch ? `${selectedBranch.name} (${selectedBranch.code})` : "—"}
              </li>
              {kind === "CUSTODY" ? (
                <li>صاحب العهدة: {selectedHolder?.name ?? "—"}</li>
              ) : null}
              <li>
                رصيد البداية الفعلي:{" "}
                <bdi dir="ltr">
                  {amountCents !== null ? displayMoney(amountCents) : normalizedAmount}
                </bdi>{" "}
                ج.م
              </li>
              <li>تاريخ الجرد الفعلي: {openingDate}</li>
              <li>الإقرار بالجرد: مؤكّد فعليًا</li>
            </ul>
            <p className="fin-field__hint">
              بعد الحفظ لا يمكن تعديل رصيد البداية إلا بتصحيح افتتاح موثّق بسبب في سجل التدقيق.
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
              <AppIcon name="cash" />
              <span>مراجعة محضر الفتح</span>
            </button>
          ) : (
            <>
              <button type="submit" className="fin-button" disabled={pending || !ready}>
                <AppIcon name="check" />
                <span>{pending ? "جارٍ الحفظ…" : "تأكيد فتح الحساب النقدي"}</span>
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
          <Link className="fin-button fin-button--text" href="/finance">
            إلغاء
          </Link>
        </div>
      </div>

      {/* ==================== معاينة محضر فتح الحساب المثبّتة ==================== */}
      <aside className="fin-side acc-live-protocol" aria-label="معاينة محضر فتح الحساب">
        <div className="acc-protocol-head">
          <h2>محضر فتح حساب</h2>
          <span className={`acc-protocol-badge${counted ? " is-counted" : ""}`}>
            {counted ? "جرد مؤكّد ✓" : "بانتظار إقرار الجرد"}
          </span>
        </div>

        <dl className="acc-protocol-list">
          <div>
            <dt>نوع الحساب</dt>
            <dd>{kind === "VAULT" ? "خزنة الفرع" : "عهدة موظف"}</dd>
          </div>
          <div>
            <dt>الفرع</dt>
            <dd>{selectedBranch ? `${selectedBranch.name} (${selectedBranch.code})` : "—"}</dd>
          </div>
          {kind === "CUSTODY" ? (
            <div>
              <dt>صاحب العهدة</dt>
              <dd>{selectedHolder?.name ?? "لم يُختر بعد"}</dd>
            </div>
          ) : null}
          <div>
            <dt>تاريخ الجرد</dt>
            <dd dir="ltr">{openingDate || "—"}</dd>
          </div>
          <div>
            <dt>حالة التكرار</dt>
            <dd>{duplicate ? "مفتوح مسبقًا ⚠" : "متاح للفتح ✓"}</dd>
          </div>
          <div className="acc-protocol-total">
            <dt>رصيد البداية</dt>
            <dd dir="ltr">
              {amountCents !== null ? `${displayMoney(amountCents)} ج.م` : "—"}
            </dd>
          </div>
        </dl>

        <div className="acc-protocol-cta no-print">
          {!review ? (
            <button
              type="button"
              className="fin-button"
              disabled={!ready || pending}
              onClick={() => setReview(true)}
            >
              <AppIcon name="cash" />
              <span>مراجعة محضر الفتح</span>
            </button>
          ) : (
            <button type="submit" className="fin-button" disabled={pending || !ready}>
              <AppIcon name="check" />
              <span>{pending ? "جارٍ الحفظ…" : "تأكيد الفتح الآن"}</span>
            </button>
          )}
        </div>

        <p style={{ margin: 0, fontSize: 11.5 }}>
          <strong>قاعدة الجرد:</strong> يُثبَّت رصيد البداية بشهادة الجرد الفعلي، وتُبنى عليه كافة حركات التحصيل والتحويل والصرف اللاحقة.
        </p>
      </aside>
    </form>
  );
}
