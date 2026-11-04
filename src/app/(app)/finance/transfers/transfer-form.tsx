"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { AppIcon } from "@/components/app-icon";
import { transferCashAction } from "../actions";
import { initialFinanceActionState } from "../finance-state";
import { accountLabel, formatMoney } from "../format";
import HandoverVoucher, { triggerVoucherPrint } from "./handover-voucher";

export type AccountOption = {
  id: string;
  kind: "VAULT" | "CUSTODY";
  branchId: string;
  branchName: string;
  holderName: string | null;
  /** null عندما يكون رصيد الخزنة سريًا لموظف الفرع */
  balance: string | null;
};

type TransferDirectionMode = "CUSTODY_TO_VAULT" | "VAULT_TO_CUSTODY";

type Props = {
  requestId: string;
  accounts: AccountOption[];
  canManage: boolean;
  actorName: string;
};

function describeAccountParty(acc: AccountOption | null): string {
  if (!acc) return "—";
  if (acc.kind === "VAULT") return `خزنة ${acc.branchName}`;
  return `عهدة ${acc.holderName ?? "الموظف"} (${acc.branchName})`;
}

export default function TransferForm({
  requestId,
  accounts,
  canManage,
  actorName,
}: Props) {
  const branches = useMemo(() => {
    const map = new Map<string, string>();
    for (const acc of accounts) {
      if (!map.has(acc.branchId)) map.set(acc.branchId, acc.branchName);
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [accounts]);

  const initialBranchId = branches[0]?.id ?? "";
  const staffCustody = !canManage
    ? accounts.find((a) => a.kind === "CUSTODY") ?? null
    : null;
  const staffVault = !canManage
    ? accounts.find((a) => a.kind === "VAULT") ?? null
    : null;

  const [selectedBranchId, setSelectedBranchId] = useState<string>(initialBranchId);
  const [directionMode, setDirectionMode] =
    useState<TransferDirectionMode>("CUSTODY_TO_VAULT");

  const defaultPair = useMemo(() => {
    if (!canManage) {
      return {
        from: staffCustody?.id ?? "",
        to: staffVault?.id ?? "",
      };
    }
    const branchAccounts = accounts.filter((a) => a.branchId === initialBranchId);
    const vault = branchAccounts.find((a) => a.kind === "VAULT") ?? null;
    const custodies = branchAccounts.filter((a) => a.kind === "CUSTODY");
    return {
      from: custodies.length === 1 ? custodies[0].id : "",
      to: vault?.id ?? "",
    };
  }, [accounts, canManage, initialBranchId, staffCustody, staffVault]);

  const [fromId, setFromId] = useState<string>(defaultPair.from);
  const [toId, setToId] = useState<string>(defaultPair.to);
  const [amount, setAmount] = useState("");
  const [negativeAcknowledged, setNegativeAcknowledged] = useState(false);
  const [review, setReview] = useState(false);
  const [state, formAction, pending] = useActionState(
    transferCashAction,
    initialFinanceActionState,
  );

  const branchAccounts = useMemo(
    () =>
      canManage
        ? accounts.filter((a) => a.branchId === selectedBranchId)
        : accounts,
    [accounts, canManage, selectedBranchId],
  );

  const branchVault = useMemo(
    () => branchAccounts.find((a) => a.kind === "VAULT") ?? null,
    [branchAccounts],
  );
  const branchCustodies = useMemo(
    () => branchAccounts.filter((a) => a.kind === "CUSTODY"),
    [branchAccounts],
  );

  function applyBranchAndDirection(
    nextBranchId: string,
    nextDirection: TransferDirectionMode,
  ) {
    setSelectedBranchId(nextBranchId);
    setDirectionMode(nextDirection);
    setReview(false);
    setNegativeAcknowledged(false);

    const scoped = accounts.filter((a) => a.branchId === nextBranchId);
    const v = scoped.find((a) => a.kind === "VAULT") ?? null;
    const cs = scoped.filter((a) => a.kind === "CUSTODY");
    const singleCustody = cs.length === 1 ? cs[0].id : "";

    if (nextDirection === "CUSTODY_TO_VAULT") {
      setFromId(singleCustody);
      setToId(v?.id ?? "");
    } else {
      setFromId(v?.id ?? "");
      setToId(singleCustody);
    }
  }

  const sourceOptions = useMemo(() => {
    if (!canManage) return staffCustody ? [staffCustody] : [];
    return directionMode === "CUSTODY_TO_VAULT"
      ? branchCustodies
      : branchVault
        ? [branchVault]
        : [];
  }, [canManage, staffCustody, directionMode, branchCustodies, branchVault]);

  const targetOptions = useMemo(() => {
    if (!canManage) return staffVault ? [staffVault] : [];
    return directionMode === "CUSTODY_TO_VAULT"
      ? branchVault
        ? [branchVault]
        : []
      : branchCustodies;
  }, [canManage, staffVault, directionMode, branchCustodies, branchVault]);

  const source = accounts.find((a) => a.id === fromId) ?? null;
  const target = accounts.find((a) => a.id === toId) ?? null;

  const sourceBalanceNum =
    source && source.balance !== null ? Number(source.balance) : null;
  const targetBalanceNum =
    target && target.balance !== null ? Number(target.balance) : null;

  const amountNumber = Number(amount);
  const amountValid =
    amount.trim() !== "" && Number.isFinite(amountNumber) && amountNumber > 0;
  const projectedSource =
    sourceBalanceNum !== null && amountValid
      ? sourceBalanceNum - amountNumber
      : null;
  const projectedTarget =
    targetBalanceNum !== null && amountValid
      ? targetBalanceNum + amountNumber
      : null;
  const needsWarning = projectedSource !== null && projectedSource < 0;

  if (state.status === "success") {
    const nowFormatted = new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Africa/Cairo",
    }).format(new Date());

    return (
      <div className="fin-panel fin-success" role="status">
        <div className="no-print">
          <h2>تم تسجيل التسليم الفعلي</h2>
          <p>{state.message}</p>
        </div>

        <HandoverVoucher
          active
          voucher={{
            voucherNumber: state.id ?? "—",
            branchName: source?.branchName ?? target?.branchName ?? "الفرع",
            timestampLabel: nowFormatted,
            fromLabel: describeAccountParty(source),
            toLabel: describeAccountParty(target),
            amount,
            originLabel:
              source?.kind === "CUSTODY"
                ? "توريد نقدي من عهدة إلى خزنة الفرع"
                : "تغذية نقدية من خزنة الفرع إلى عهدة",
            actorName,
          }}
        />

        <div className="fin-actions no-print" style={{ marginTop: 16 }}>
          <button
            type="button"
            className="fin-button"
            onClick={() => triggerVoucherPrint()}
          >
            <AppIcon name="printer" />
            <span>طباعة سند التسليم الرسمي</span>
          </button>
          <a className="fin-button fin-button--secondary" href="/finance/transfers">
            تسليم جديد
          </a>
          <Link
            className="fin-button fin-button--secondary"
            href={canManage ? "/finance" : "/finance/mine"}
          >
            {canManage ? "الحسابات النقدية" : "العودة إلى عهدتي"}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="fin-form-stack no-print">
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="fromId" value={fromId} />
      <input type="hidden" name="toId" value={toId} />
      <input type="hidden" name="amount" value={amount} />
      <input type="hidden" name="expectedBalance" value={source?.balance ?? ""} />
      <input
        type="hidden"
        name="negativeAcknowledged"
        value={negativeAcknowledged ? "yes" : "no"}
      />

      <div className="fin-panel">
        <div className="fin-panel__heading">
          <h2>
            {canManage
              ? "تسجيل تسليم نقدي فعلي بين الخزنة والعهدة"
              : "توريد نقد فعلي من عهدتك إلى خزنة فرعك"}
          </h2>
          <p>
            {canManage
              ? "اختر اتجاه الحركة والفرع ثم حدّد المبلغ المسلَّم يدًا بيد. العُهَد المقفلة مستبعدة تلقائيًا."
              : "عهدتك مثبّتة كمصدر، وخزنة فرعك مثبّتة كوجهة استلام دون كشف أرصدة الخزنة."}
          </p>
        </div>

        <div className="fin-panel__body">
          {canManage ? (
            <div className="fin-transfer-controls">
              {branches.length > 1 ? (
                <div className="fin-transfer-branch-bar" role="tablist" aria-label="اختيار الفرع">
                  {branches.map((b) => {
                    const isAct = b.id === selectedBranchId;
                    return (
                      <button
                        key={b.id}
                        type="button"
                        role="tab"
                        aria-selected={isAct}
                        className={`fin-filter-pill${isAct ? " is-active" : ""}`}
                        onClick={() => applyBranchAndDirection(b.id, directionMode)}
                      >
                        {b.name}
                      </button>
                    );
                  })}
                </div>
              ) : null}

              <div className="fin-transfer-dir-tabs" role="tablist" aria-label="اتجاه حركة النقد">
                <button
                  type="button"
                  role="tab"
                  aria-selected={directionMode === "CUSTODY_TO_VAULT"}
                  className={`fin-transfer-dir-btn${
                    directionMode === "CUSTODY_TO_VAULT" ? " is-active" : ""
                  }`}
                  onClick={() =>
                    applyBranchAndDirection(selectedBranchId, "CUSTODY_TO_VAULT")
                  }
                >
                  <strong>توريد للخزنة</strong>
                  <small>من عهدة موظف ← إلى خزنة الفرع</small>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={directionMode === "VAULT_TO_CUSTODY"}
                  className={`fin-transfer-dir-btn${
                    directionMode === "VAULT_TO_CUSTODY" ? " is-active" : ""
                  }`}
                  onClick={() =>
                    applyBranchAndDirection(selectedBranchId, "VAULT_TO_CUSTODY")
                  }
                >
                  <strong>تغذية عهدة</strong>
                  <small>من خزنة الفرع ← إلى عهدة موظف</small>
                </button>
              </div>
            </div>
          ) : null}

          {canManage && (!branchVault || branchCustodies.length === 0) ? (
            <div className="fin-alert fin-alert--warning" style={{ marginBottom: 14 }}>
              {!branchVault
                ? "لا توجد خزنة مفتوحة لهذا الفرع بعد — افتح خزنة الفرع بجرد فعلي من «الحسابات النقدية»."
                : "لا توجد عُهَد موظفين مفتوحة في هذا الفرع حاليًا."}
            </div>
          ) : null}

          <div className="fin-fields">
            {canManage ? (
              <>
                <label className="field fin-field">
                  <span className="fin-field__label">من (المسلِّم — مصدر النقد)</span>
                  <select
                    value={fromId}
                    onChange={(event) => {
                      setFromId(event.target.value);
                      setReview(false);
                    }}
                  >
                    <option value="">— اختر حساب المصدر —</option>
                    {sourceOptions.map((account) => (
                      <option key={account.id} value={account.id}>
                        {accountLabel(account.kind)}
                        {account.kind === "CUSTODY" && account.holderName
                          ? ` · ${account.holderName}`
                          : ` (${account.branchName})`}
                        {account.balance !== null
                          ? ` · الرصيد: ${formatMoney(account.balance)} ج.م`
                          : ""}
                      </option>
                    ))}
                  </select>
                  {source && source.balance !== null ? (
                    <span className="fin-field__hint">
                      الرصيد الدفتري الحالي: <bdi dir="ltr">{formatMoney(source.balance)}</bdi> ج.م
                    </span>
                  ) : null}
                </label>

                <label className="field fin-field">
                  <span className="fin-field__label">إلى (المستلِم — وعاء الاستلام)</span>
                  <select
                    value={toId}
                    onChange={(event) => {
                      setToId(event.target.value);
                      setReview(false);
                    }}
                  >
                    <option value="">— اختر حساب الاستلام —</option>
                    {targetOptions.map((account) => (
                      <option key={account.id} value={account.id}>
                        {accountLabel(account.kind)}
                        {account.kind === "CUSTODY" && account.holderName
                          ? ` · ${account.holderName}`
                          : ` (${account.branchName})`}
                        {account.balance !== null
                          ? ` · الرصيد: ${formatMoney(account.balance)} ج.م`
                          : ""}
                      </option>
                    ))}
                  </select>
                  {target && target.balance !== null ? (
                    <span className="fin-field__hint">
                      الرصيد الدفتري الحالي: <bdi dir="ltr">{formatMoney(target.balance)}</bdi> ج.م
                    </span>
                  ) : null}
                </label>
              </>
            ) : (
              <>
                <div className="field fin-field fin-metric-tile is-highlight">
                  <span className="fin-field__label">من (مصدر النقد المثبّت)</span>
                  <span className="fin-field__hint">
                    {describeAccountParty(source)}
                    {source?.balance !== null && source?.balance !== undefined
                      ? ` · رصيدك الدفتري: ${formatMoney(source.balance)} ج.م`
                      : ""}
                  </span>
                </div>
                <div className="field fin-field fin-metric-tile">
                  <span className="fin-field__label">إلى (وجهة التوريد المثبّتة)</span>
                  <span className="fin-field__hint">{describeAccountParty(target)}</span>
                </div>
              </>
            )}

            <div className="field fin-field fin-field--wide">
              <div className="sale-field-head">
                <label htmlFor="transfer-amount-input" className="fin-field__label">
                  المبلغ المسلَّم نقدًا (ج.م)
                </label>
                {sourceBalanceNum !== null && sourceBalanceNum > 0 ? (
                  <div className="fin-quick-amounts">
                    <button
                      type="button"
                      className="sale-fill-btn"
                      onClick={() => {
                        setAmount(sourceBalanceNum.toFixed(2).replace(/\.00$/, ""));
                        setReview(false);
                      }}
                    >
                      كامل الرصيد (<bdi dir="ltr">{formatMoney(source?.balance)}</bdi>)
                    </button>
                    {sourceBalanceNum >= 2 ? (
                      <button
                        type="button"
                        className="sale-fill-btn"
                        onClick={() => {
                          const half = Math.round((sourceBalanceNum / 2) * 100) / 100;
                          setAmount(half.toFixed(2).replace(/\.00$/, ""));
                          setReview(false);
                        }}
                      >
                        نصف الرصيد (<bdi dir="ltr">{formatMoney(halfAmountString(sourceBalanceNum))}</bdi>)
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <input
                id="transfer-amount-input"
                inputMode="decimal"
                value={amount}
                onChange={(event) => {
                  setAmount(event.target.value);
                  setReview(false);
                }}
                placeholder="0.00"
              />
              {amount.trim() !== "" && !amountValid ? (
                <span className="fin-field__error">أدخل مبلغًا أكبر من صفر.</span>
              ) : null}
            </div>

            {source && target ? (
              <div className="fin-transfer-bridge fin-field--wide" aria-live="polite">
                <div className="fin-transfer-bridge__party">
                  <span className="fin-transfer-bridge__role">المسلِّم</span>
                  <strong>{describeAccountParty(source)}</strong>
                  <span className="fin-transfer-bridge__bal">
                    {sourceBalanceNum !== null ? (
                      <>
                        قبل: <bdi dir="ltr">{formatMoney(source.balance)}</bdi> ← بعد:{" "}
                        <bdi
                          dir="ltr"
                          className={needsWarning ? "is-neg" : "is-pos"}
                        >
                          {projectedSource !== null
                            ? formatMoney(projectedSource.toFixed(2))
                            : formatMoney(source.balance)}
                        </bdi>{" "}
                        ج.م
                      </>
                    ) : (
                      "وعاء مصدر معتمد"
                    )}
                  </span>
                </div>

                <div className="fin-transfer-bridge__arrow" aria-hidden="true">
                  <span className="fin-transfer-bridge__amt">
                    <bdi dir="ltr">{amountValid ? formatMoney(amount) : "0.00"}</bdi> ج.م
                  </span>
                  <span className="fin-transfer-bridge__line">⟵</span>
                </div>

                <div className="fin-transfer-bridge__party">
                  <span className="fin-transfer-bridge__role">المستلِم</span>
                  <strong>{describeAccountParty(target)}</strong>
                  <span className="fin-transfer-bridge__bal">
                    {targetBalanceNum !== null ? (
                      <>
                        قبل: <bdi dir="ltr">{formatMoney(target.balance)}</bdi> ← بعد:{" "}
                        <bdi dir="ltr" className="is-pos">
                          {projectedTarget !== null
                            ? formatMoney(projectedTarget.toFixed(2))
                            : formatMoney(target.balance)}
                        </bdi>{" "}
                        ج.م
                      </>
                    ) : (
                      "توريد مباشر إلى خزنة الفرع"
                    )}
                  </span>
                </div>
              </div>
            ) : null}

            {needsWarning ? (
              <label className="fin-check fin-field--wide">
                <input
                  type="checkbox"
                  checked={negativeAcknowledged}
                  onChange={(event) => {
                    setNegativeAcknowledged(event.target.checked);
                    setReview(false);
                  }}
                />
                <span>
                  سيصبح رصيد المصدر الدفتري سالبًا (ربما لوجود مقبوضات نقدية لم تُسجَّل تسويتها بعد). أقر بأنني راجعت الفرق قبل التسجيل.
                </span>
              </label>
            ) : null}
          </div>
        </div>
      </div>

      {state.status === "error" ? (
        <div className="fin-alert fin-alert--error" role="alert">
          {state.message}
          {state.details?.currentBalance
            ? ` الرصيد الحالي كما تراه قاعدة البيانات: ${state.details.currentBalance}.`
            : ""}
        </div>
      ) : null}

      {review ? (
        <div className="fin-review" role="status">
          <h2>راجع بيانات السند قبل الحفظ النهائي</h2>
          <ul>
            <li>
              من (المسلِّم): {describeAccountParty(source)}
              {source?.balance !== null && source?.balance !== undefined
                ? ` — الرصيد الحالي ${formatMoney(source.balance)} ج.م`
                : ""}
            </li>
            <li>إلى (المستلِم): {describeAccountParty(target)}</li>
            <li>
              المبلغ المسلَّم نقدًا: <bdi dir="ltr">{formatMoney(amount)}</bdi> ج.م
            </li>
            <li>الفرع: {source?.branchName ?? target?.branchName ?? "—"}</li>
          </ul>
          <label className="fin-check">
            <input type="checkbox" name="actuallyTransferred" value="yes" required />
            <span>أقر بأن النقد سُلِّم واستُلم فعليًا يدًا بيد في هذه اللحظة.</span>
          </label>
        </div>
      ) : null}

      <div className="fin-form-actions">
        {!review ? (
          <button
            type="button"
            className="fin-button"
            disabled={
              !source ||
              !target ||
              !amountValid ||
              (needsWarning && !negativeAcknowledged)
            }
            onClick={() => setReview(true)}
          >
            مراجعة سند التسليم
          </button>
        ) : (
          <button type="submit" className="fin-button" disabled={pending}>
            {pending ? "جارٍ الحفظ…" : "تأكيد التسليم وإصدار السند"}
          </button>
        )}
        {review ? (
          <button
            type="button"
            className="fin-button fin-button--secondary"
            onClick={() => setReview(false)}
          >
            تعديل المبلغ
          </button>
        ) : null}
        <Link
          className="fin-button fin-button--text"
          href={canManage ? "/finance" : "/finance/mine"}
        >
          إلغاء
        </Link>
      </div>
    </form>
  );
}

function halfAmountString(balanceNum: number): string {
  return (Math.round((balanceNum / 2) * 100) / 100).toFixed(2);
}
