"use client";

import { useActionState, useState } from "react";
import { parseDiscountSetting } from "@/lib/commerce-validation";
import { discountSettingAction } from "../actions";
import { initialSalesActionState, type SalesActionState } from "../sales-state";

const SAMPLE_AMOUNTS = [1000, 5000, 10000, 25000] as const;
const nf = new Intl.NumberFormat("ar-EG-u-nu-latn", { maximumFractionDigits: 2 });

export default function SettingForm({
  requestId,
  initialPercent,
  initialManagerPercent,
}: {
  requestId: string;
  initialPercent: string;
  initialManagerPercent: string;
}) {
  const [percent, setPercent] = useState(initialPercent);
  const [managerPercent, setManagerPercent] = useState(initialManagerPercent);
  const [sampleAmount, setSampleAmount] = useState("10000");
  const [review, setReview] = useState(false);
  const [error, setError] = useState("");
  const [state, action, pending] = useActionState(discountSettingAction, initialSalesActionState);
  const [dismissed, setDismissed] = useState<SalesActionState | null>(null);

  const sampleNum = Math.max(0, Number(sampleAmount) || 0);
  const staffPctNum = Math.min(100, Math.max(0, Number(percent) || 0));
  const mgrPctNum = Math.min(100, Math.max(0, Number(managerPercent) || 0));
  const staffMaxDisc = (sampleNum * staffPctNum) / 100;
  const mgrMaxDisc = (sampleNum * mgrPctNum) / 100;

  function reviewValue() {
    const parsed = parseDiscountSetting({ requestId, percent, managerPercent });
    if (!parsed.ok) {
      setError(Object.values(parsed.errors).join(" "));
      return;
    }
    setError("");
    setReview(true);
  }

  if (state.status === "success") {
    return (
      <div className="inv-panel inv-success" role="status">
        <h2>تم تحديث الحد</h2>
        <p>{state.message}</p>
        <a className="inv-button inv-button--secondary" href="/sales/settings">
          عرض الإعداد الحالي
        </a>
      </div>
    );
  }

  return (
    <form
      className="inv-panel"
      action={action}
      onSubmit={(event) => {
        if (!review) {
          event.preventDefault();
          reviewValue();
        }
      }}
      noValidate
    >
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="reviewed" value={review ? "yes" : "no"} />
      <div className="inv-panel__body sale-stack">
        {state.status === "error" && state !== dismissed && (
          <div className="inv-alert inv-alert--error" role="alert">
            {state.message}
          </div>
        )}
        {error && (
          <div className="inv-alert inv-alert--error" role="alert">
            {error}
          </div>
        )}

        <div className="inv-fields">
          <div className="inv-field">
            <label htmlFor="staff-discount-percent">حد الموظف والمحاسب (%)</label>
            <input
              id="staff-discount-percent"
              name="percent"
              inputMode="decimal"
              dir="ltr"
              value={percent}
              disabled={pending}
              onChange={(event) => {
                setPercent(event.target.value);
                setReview(false);
                setError("");
                setDismissed(state);
              }}
            />
            <p className="inv-field__hint">
              من 0 إلى 100، بحد أقصى منزلتين عشريتين. يسري على موظف الفرع والمحاسب.
            </p>
          </div>
          <div className="inv-field">
            <label htmlFor="manager-discount-percent">سقف المدير (%)</label>
            <input
              id="manager-discount-percent"
              name="managerPercent"
              inputMode="decimal"
              dir="ltr"
              value={managerPercent}
              disabled={pending}
              onChange={(event) => {
                setManagerPercent(event.target.value);
                setReview(false);
                setError("");
                setDismissed(state);
              }}
            />
            <p className="inv-field__hint">
              المدير وحده يتجاوز حد الموظف إلى هذا السقف، ولا يجوز أن يقل عنه.
            </p>
          </div>
        </div>

        {/* حاسبة معاينة حيّة لأثر حدود الخصم بالجنيه */}
        <div className="sale-discount-sim" aria-label="حاسبة معاينة أثر الخصم">
          <div className="sale-discount-sim__head">
            <div>
              <strong>حاسبة المعاينة الفورية بالجنيه</strong>
              <p>اختبر أقصى خصم مسموح على أي قيمة فاتورة قبل اعتماد النسب الجديدة.</p>
            </div>
            <div className="sale-quick-chips">
              {SAMPLE_AMOUNTS.map((amt) => (
                <button
                  key={amt}
                  type="button"
                  className={`sale-quick-chip${Number(sampleAmount) === amt ? " is-active" : ""}`}
                  onClick={() => setSampleAmount(String(amt))}
                >
                  {nf.format(amt)} ج.م
                </button>
              ))}
            </div>
          </div>

          <div className="inv-fields">
            <div className="inv-field">
              <label htmlFor="sim-invoice-amount">قيمة الفاتورة التجريبية (ج.م)</label>
              <input
                id="sim-invoice-amount"
                inputMode="decimal"
                dir="ltr"
                value={sampleAmount}
                onChange={(e) => setSampleAmount(e.target.value)}
              />
            </div>
            <div className="sale-discount-sim__cards">
              <div className="sale-discount-sim__card">
                <span>أقصى خصم للموظف ({nf.format(staffPctNum)}%)</span>
                <strong>
                  <bdi dir="ltr">{nf.format(staffMaxDisc)}</bdi> ج.م
                </strong>
                <small>
                  صافي الفاتورة بعده: <bdi dir="ltr">{nf.format(Math.max(0, sampleNum - staffMaxDisc))}</bdi> ج.م
                </small>
              </div>
              <div className="sale-discount-sim__card is-manager">
                <span>أقصى خصم للمدير ({nf.format(mgrPctNum)}%)</span>
                <strong>
                  <bdi dir="ltr">{nf.format(mgrMaxDisc)}</bdi> ج.م
                </strong>
                <small>
                  صافي الفاتورة بعده: <bdi dir="ltr">{nf.format(Math.max(0, sampleNum - mgrMaxDisc))}</bdi> ج.م
                </small>
              </div>
            </div>
          </div>
        </div>

        {review && (
          <div className="inv-review" aria-live="polite">
            <h2>مراجعة التغيير</h2>
            <p>
              سيصبح حد الموظف والمحاسب {percent}%، وسقف المدير {managerPercent}% من قيمة الفاتورة قبل الخصم.
            </p>
          </div>
        )}
        <div className="inv-form-actions">
          {review ? (
            <>
              <button className="inv-button" type="submit" disabled={pending} aria-busy={pending}>
                <span aria-live="polite">{pending ? "جارٍ الحفظ…" : "تأكيد التغيير"}</span>
              </button>
              <button
                className="inv-button inv-button--secondary"
                type="button"
                disabled={pending}
                onClick={() => setReview(false)}
              >
                تعديل
              </button>
            </>
          ) : (
            <button
              className="inv-button"
              type="button"
              disabled={pending}
              onClick={(event) => {
                event.preventDefault();
                reviewValue();
              }}
            >
              مراجعة التغيير
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
