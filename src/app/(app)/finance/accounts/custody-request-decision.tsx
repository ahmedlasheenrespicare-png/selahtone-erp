"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { AppIcon } from "@/components/app-icon";
import { decideCustodyRequestAction } from "../actions";
import { initialFinanceActionState } from "../finance-state";
import { formatMoney } from "../format";

export type PendingCustodyRequest = {
  id: string;
  amount: string;
  reason: string;
  requesterName: string;
  branchName?: string;
  createdAt: string;
};

const APPROVE_REASON_PRESETS = [
  "تم جرد النقد وتسليمه فعليًا للموظف",
  "اعتماد فتح عهدة تشغيلية لمصروفات الفرع",
];

const REJECT_REASON_PRESETS = [
  "الاكتفاء بالصرف المباشر من خزنة الفرع حاليًا",
  "تأجيل فتح العهدة لحين استكمال الجرد",
];

/** البتّ في طلب عهدة: بالموافقة تُفتح العهدة بجرد فعلي، أو بالرفض بسبب مدوّن. */
export function CustodyRequestDecision({
  requestId,
  request,
  today,
}: {
  requestId: string;
  request: PendingCustodyRequest;
  today: string;
}) {
  const [state, formAction, pending] = useActionState(
    decideCustodyRequestAction,
    initialFinanceActionState,
  );
  const [decision, setDecision] = useState<"APPROVE" | "REJECT" | "">("");
  const [openingDate, setOpeningDate] = useState(today);
  const [reason, setReason] = useState("");
  const [counted, setCounted] = useState(false);

  const createdDay = request.createdAt ? request.createdAt.slice(0, 10) : today;
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(openingDate) && openingDate <= today;
  const canSubmit =
    !pending &&
    decision !== "" &&
    reason.trim().length > 0 &&
    (decision === "REJECT" || (counted && dateValid));

  if (state.status === "success") {
    return (
      <div className="acc-instant-protocol" role="status">
        <div className="acc-instant-protocol__banner">
          <div>
            <p className="fin-heading__eyebrow" style={{ color: "var(--fn-muted)", marginBottom: 4 }}>
              قرار طلب عهدة · {request.requesterName}
            </p>
            <h2 style={{ margin: 0 }}>
              {decision === "APPROVE" ? "اعتُمد الطلب وفُتحت العهدة" : "تم رفض طلب العهدة"}
            </h2>
          </div>
          {decision === "APPROVE" && state.id ? (
            <span className="acc-instant-protocol__code" dir="ltr">
              <AppIcon name="cash" />
              <span>حساب #{state.id}</span>
            </span>
          ) : null}
        </div>
        <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--fn-muted)" }}>
          {state.message}
        </p>
        <div className="fin-actions">
          <Link className="fin-button fin-button--secondary" href="/finance">
            عرض الحسابات النقدية
          </Link>
          {decision === "APPROVE" ? (
            <Link className="fin-button fin-button--secondary" href="/finance/transfers">
              تسليم وتحويل النقد
            </Link>
          ) : null}
        </div>
      </div>
    );
  }

  const activePresets =
    decision === "REJECT" ? REJECT_REASON_PRESETS : APPROVE_REASON_PRESETS;

  return (
    <form action={formAction} className="fin-form-stack">
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="requestDbId" value={request.id} />
      <input type="hidden" name="decision" value={decision} />
      <input type="hidden" name="openingDate" value={openingDate} />
      <input type="hidden" name="reason" value={reason.trim()} />
      <input type="hidden" name="counted" value={counted ? "yes" : "no"} />

      <div className="fin-panel">
        <div className="fin-panel__heading">
          <h2>
            طلب عهدة #{request.id} · {request.requesterName}
            {request.branchName ? ` (${request.branchName})` : ""}
          </h2>
          <p>
            المبلغ المطلوب: <strong dir="ltr">{formatMoney(request.amount)}</strong> · تاريخ الطلب:{" "}
            <span dir="ltr">{createdDay}</span> — السبب: «{request.reason}»
          </p>
        </div>
        <div className="fin-panel__body">
          <div className="acc-decision-toggles" role="group" aria-label="قرار طلب العهدة">
            <button
              type="button"
              disabled={pending}
              className={`acc-decision-btn${decision === "APPROVE" ? " is-approve" : ""}`}
              onClick={() => setDecision("APPROVE")}
            >
              <AppIcon name="check" />
              <span>موافقة وفتح العهدة بجرد فعلي</span>
            </button>
            <button
              type="button"
              disabled={pending}
              className={`acc-decision-btn${decision === "REJECT" ? " is-reject" : ""}`}
              onClick={() => {
                setDecision("REJECT");
                setCounted(false);
              }}
            >
              <AppIcon name="close" />
              <span>رفض الطلب بسبب مدوّن</span>
            </button>
          </div>

          {decision !== "" ? (
            <div className="fin-fields">
              {decision === "APPROVE" ? (
                <>
                  <label className="field fin-field">
                    <span className="fin-field__label">تاريخ الجرد الفعلي *</span>
                    <input
                      type="date"
                      value={openingDate}
                      max={today}
                      disabled={pending}
                      onChange={(event) => setOpeningDate(event.target.value)}
                    />
                  </label>
                  <label className="fin-check fin-field--wide">
                    <input
                      type="checkbox"
                      checked={counted}
                      disabled={pending}
                      onChange={(event) => setCounted(event.target.checked)}
                    />
                    <span>
                      أقرّ بأنني أجريتُ جردًا فعليًا لمبلغ (<bdi dir="ltr">{formatMoney(request.amount)}</bdi>) وسلّمته لصاحب العهدة.
                    </span>
                  </label>
                </>
              ) : null}

              <div className="field fin-field fin-field--wide">
                <label className="fin-field__label">
                  {decision === "REJECT" ? "سبب الرفض *" : "ملاحظة الاعتماد والجرد *"}
                </label>
                <input
                  value={reason}
                  disabled={pending}
                  onChange={(event) => setReason(event.target.value)}
                  maxLength={300}
                  placeholder={
                    decision === "REJECT"
                      ? "اذكر سبب رفض فتح العهدة للتوثيق…"
                      : "مثال: تم جرد المبلغ وتسليمه فعليًا…"
                  }
                />
                <div className="sale-quick-chips">
                  {activePresets.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      disabled={pending}
                      className={`sale-quick-chip${reason === preset ? " is-active" : ""}`}
                      onClick={() => setReason(preset)}
                    >
                      <span>{preset}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {state.status === "error" ? (
            <div className="fin-alert fin-alert--error" role="alert">
              {state.message}
            </div>
          ) : null}

          <div className="fin-actions" style={{ marginTop: 12 }}>
            <button type="submit" className="fin-button" disabled={!canSubmit}>
              {pending
                ? "جارٍ الحفظ…"
                : decision === "REJECT"
                  ? "تأكيد رفض الطلب"
                  : "اعتماد الطلب وفتح العهدة"}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
