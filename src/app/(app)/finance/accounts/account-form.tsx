"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { openAccountAction } from "../actions";
import { initialFinanceActionState } from "../finance-state";

export type BranchOption = { id: string; name: string; code: string };
export type StaffOption = { id: string; name: string; branchId: string };
type Props = { requestId: string; today: string; branches: BranchOption[]; staff: StaffOption[]; vaultBranches: string[]; custodyStaff: string[] };

function todayValue(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export default function AccountForm({ requestId, today, branches, staff, vaultBranches, custodyStaff }: Props) {
  const [kind, setKind] = useState<"VAULT" | "CUSTODY">("VAULT");
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [holderId, setHolderId] = useState("");
  const [openingAmount, setOpeningAmount] = useState("");
  const [openingDate, setOpeningDate] = useState(today);
  const [counted, setCounted] = useState(false);
  const [review, setReview] = useState(false);
  const [state, formAction, pending] = useActionState(openAccountAction, initialFinanceActionState);

  const branchStaff = staff.filter((member) => member.branchId === branchId);
  const duplicate = kind === "VAULT" ? vaultBranches.includes(branchId) : custodyStaff.includes(holderId);
  const amountNumber = Number(openingAmount);
  const amountValid = openingAmount.trim() !== "" && Number.isFinite(amountNumber) && amountNumber >= 0;
  const ready = Boolean(branchId) && amountValid && /^\d{4}-\d{2}-\d{2}$/.test(openingDate) && counted && !duplicate &&
    (kind === "VAULT" || Boolean(holderId));

  if (state.status === "success") {
    return (
      <div className="fin-panel fin-success" role="status">
        <h2>تم فتح الحساب</h2>
        <p>{state.message}</p>
        <div className="fin-actions">
          <a className="fin-button" href="/finance/accounts">فتح حساب آخر</a>
          <Link className="fin-button fin-button--secondary" href="/finance">الحسابات النقدية</Link>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="fin-form-stack">
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="branchId" value={branchId} />
      <input type="hidden" name="holderId" value={kind === "CUSTODY" ? holderId : ""} />
      <input type="hidden" name="openingAmount" value={openingAmount} />
      <input type="hidden" name="openingDate" value={openingDate} />
      <input type="hidden" name="counted" value={counted ? "yes" : "no"} />

      <div className="fin-panel">
        <div className="fin-panel__heading">
          <h2>نوع الحساب</h2>
          <p>خزنة واحدة لكل فرع، وعهدة واحدة لكل موظف في الفرع نفسه.</p>
        </div>
        <div className="fin-panel__body">
          <div className="fin-fields">
            <label className="field fin-field">
              <span className="fin-field__label">النوع</span>
              <select value={kind} onChange={(event) => { setKind(event.target.value as "VAULT" | "CUSTODY"); setReview(false); }}>
                <option value="VAULT">خزنة الفرع</option>
                <option value="CUSTODY">عهدة موظف</option>
              </select>
            </label>
            <label className="field fin-field">
              <span className="fin-field__label">الفرع</span>
              <select value={branchId} onChange={(event) => { setBranchId(event.target.value); setHolderId(""); setReview(false); }}>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name} ({branch.code}){vaultBranches.includes(branch.id) && kind === "VAULT" ? " — خزنته مفتوحة" : ""}
                  </option>
                ))}
              </select>
            </label>
            {kind === "CUSTODY" ? (
              <label className="field fin-field fin-field--wide">
                <span className="fin-field__label">الموظف صاحب العهدة</span>
                <select value={holderId} onChange={(event) => { setHolderId(event.target.value); setReview(false); }}>
                  <option value="">— اختر موظفًا نشطًا في الفرع —</option>
                  {branchStaff.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}{custodyStaff.includes(member.id) ? " — لديه عهدة مفتوحة" : ""}
                    </option>
                  ))}
                </select>
                <span className="fin-field__hint">يظهر الموظفون النشطون في هذا الفرع فقط.</span>
              </label>
            ) : null}
          </div>
        </div>
      </div>

      <div className="fin-panel">
        <div className="fin-panel__heading">
          <h2>رصيد البداية</h2>
          <p>الرصيد فعلي بعد الجرد. الصفر مقبول فقط إن كان هذا هو الواقع.</p>
        </div>
        <div className="fin-panel__body">
          <div className="fin-fields">
            <label className="field fin-field">
              <span className="fin-field__label">المبلغ</span>
              <input inputMode="decimal" value={openingAmount} onChange={(event) => { setOpeningAmount(event.target.value); setReview(false); }} placeholder="0.00" />
              {openingAmount.trim() !== "" && !amountValid ? <span className="fin-field__error">أدخل مبلغًا غير سالب بحد أقصى منزلتين عشريتين.</span> : null}
            </label>
            <label className="field fin-field">
              <span className="fin-field__label">تاريخ الجرد</span>
              <input type="date" value={openingDate} max={todayValue()} onChange={(event) => { setOpeningDate(event.target.value); setReview(false); }} />
            </label>
            <label className="fin-check fin-field--wide">
              <input type="checkbox" checked={counted} onChange={(event) => { setCounted(event.target.checked); setReview(false); }} />
              <span>أقر بأنني جردت النقد فعليًا وأن هذا هو الرصيد الواقعي.</span>
            </label>
            {duplicate ? (
              <p className="fin-alert fin-alert--warning">
                {kind === "VAULT" ? "لهذا الفرع خزنة مفتوحة بالفعل." : "لهذا الموظف عهدة مفتوحة بالفعل."}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {state.status === "error" ? (
        <div className="fin-alert fin-alert--error" role="alert">
          {state.message}
          {state.details?.currentBalance ? ` الرصيد الحالي كما تراه قاعدة البيانات: ${state.details.currentBalance}.` : ""}
        </div>
      ) : null}

      {review ? (
        <div className="fin-review" role="status">
          <h2>راجع قبل الحفظ</h2>
          <ul>
            <li>النوع: {kind === "VAULT" ? "خزنة الفرع" : "عهدة موظف"}</li>
            <li>الفرع: {branches.find((branch) => branch.id === branchId)?.name ?? "—"}</li>
            {kind === "CUSTODY" ? <li>الموظف: {branchStaff.find((member) => member.id === holderId)?.name ?? "—"}</li> : null}
            <li>رصيد البداية: {openingAmount || "—"}</li>
            <li>تاريخ الجرد: {openingDate}</li>
          </ul>
          <p className="fin-field__hint">بعد الحفظ لا يمكن تعديل رصيد البداية إلا بتصحيح موثق بسبب.</p>
        </div>
      ) : null}

      <div className="fin-form-actions">
        {!review ? (
          <button type="button" className="fin-button" disabled={!ready} onClick={() => setReview(true)}>مراجعة</button>
        ) : (
          <button type="submit" className="fin-button" disabled={pending || !ready}>{pending ? "جارٍ الحفظ…" : "تأكيد فتح الحساب"}</button>
        )}
        <Link className="fin-button fin-button--text" href="/finance">إلغاء</Link>
      </div>
    </form>
  );
}
