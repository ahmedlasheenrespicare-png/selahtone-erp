"use client";

import { useActionState, useMemo, useState } from "react";
import { PasswordField } from "@/app/login/password-field";
import { changePasswordAction } from "./actions";
import { initialChangePasswordState } from "./change-password-state";

function evaluatePasswordStrength(pw: string): {
  score: 0 | 1 | 2 | 3;
  label: string;
} {
  if (!pw) return { score: 0, label: "" };
  if (pw.length < 12) {
    return {
      score: 1,
      label: `قصيرة (${pw.length}/12 حرفًا مطلوبًا كحد أدنى)`,
    };
  }
  const variety =
    (/[a-z]/.test(pw) ? 1 : 0) +
    (/[A-Z]/.test(pw) ? 1 : 0) +
    (/[0-9]/.test(pw) ? 1 : 0) +
    (/[^a-zA-Z0-9]/.test(pw) ? 1 : 0);
  if (pw.length >= 16 || variety >= 3) {
    return { score: 3, label: "قوية وممتازة ✓" };
  }
  return { score: 2, label: "مقبولة (١٢ حرفًا فأكثر) — أضف رموزًا أو أرقامًا لتقويتها" };
}

export function ChangePasswordForm({ next, required }: { next: string; required: boolean }) {
  const [state, action, pending] = useActionState(changePasswordAction, initialChangePasswordState);
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");

  const strength = useMemo(() => evaluatePasswordStrength(newPw), [newPw]);
  const matchState = useMemo(() => {
    if (!confirmPw) return null;
    return newPw === confirmPw ? "match" : "mismatch";
  }, [newPw, confirmPw]);

  return (
    <>
      {required && <div className="auth-message auth-message-info">لحماية حسابك، اختر كلمة مرور جديدة قبل استخدام النظام.</div>}
      {state.message && <div className="auth-message auth-message-error" role="alert">{state.message}</div>}
      <form action={action} className="auth-form" aria-busy={pending}>
        <input type="hidden" name="next" value={next} />
        <PasswordField
          id="current-password"
          name="currentPassword"
          label="كلمة المرور الحالية"
          autoComplete="current-password"
          error={state.errors?.currentPassword}
        />
        <PasswordField
          id="new-password"
          name="newPassword"
          label="كلمة المرور الجديدة"
          autoComplete="new-password"
          hint="استخدم ١٢ حرفًا على الأقل؛ يمكنك استخدام عبارة طويلة."
          error={state.errors?.newPassword}
          onValueChange={setNewPw}
        />
        {strength.score > 0 ? (
          <div className="pw-strength" role="status" aria-live="polite" style={{ marginTop: -6, marginBottom: 6 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 6,
                marginBottom: 4,
              }}
            >
              {[1, 2, 3].map((step) => (
                <span
                  key={step}
                  style={{
                    height: 5,
                    borderRadius: 999,
                    background:
                      strength.score >= step
                        ? strength.score === 1
                          ? "#b91c1c"
                          : strength.score === 2
                            ? "#b45309"
                            : "#047857"
                        : "rgba(148, 163, 184, 0.35)",
                  }}
                />
              ))}
            </div>
            <p className="field-hint" style={{ margin: 0 }}>
              {strength.label}
            </p>
          </div>
        ) : null}

        <PasswordField
          id="confirm-password"
          name="confirmPassword"
          label="تأكيد كلمة المرور الجديدة"
          autoComplete="new-password"
          error={state.errors?.confirmPassword}
          onValueChange={setConfirmPw}
        />
        {matchState ? (
          <p
            className={matchState === "match" ? "field-hint" : "field-error"}
            role="status"
            style={{ marginTop: -6, marginBottom: 6 }}
          >
            {matchState === "match"
              ? "✓ كلمتا المرور متطابقتان."
              : "كلمتا المرور غير متطابقتين بعد."}
          </p>
        ) : null}

        <button className="btn auth-submit" type="submit" disabled={pending}>
          {pending ? <><span className="auth-spinner" aria-hidden="true" /> جارٍ حفظ كلمة المرور…</> : "حفظ كلمة المرور"}
        </button>
        <span className="sr-only" role="status" aria-live="polite">{pending ? "جارٍ حفظ كلمة المرور" : ""}</span>
      </form>
      <div className="change-password-footer">
        <p>سيتم تسجيل الخروج من أجهزتك الأخرى بعد تغيير كلمة المرور.</p>
        <form action="/api/logout" method="post"><button type="submit" className="auth-text-button">تسجيل الخروج</button></form>
      </div>
    </>
  );
}
