"use client";

import { useActionState } from "react";
import { PasswordField } from "@/app/login/password-field";
import { changePasswordAction } from "./actions";
import { initialChangePasswordState } from "./change-password-state";

export function ChangePasswordForm({ next, required }: { next: string; required: boolean }) {
  const [state, action, pending] = useActionState(changePasswordAction, initialChangePasswordState);
  return (
    <>
      {required && <div className="auth-message auth-message-info">لحماية حسابك، اختر كلمة مرور جديدة قبل استخدام النظام.</div>}
      {state.message && <div className="auth-message auth-message-error" role="alert">{state.message}</div>}
      <form action={action} className="auth-form" aria-busy={pending}>
        <input type="hidden" name="next" value={next} />
        <PasswordField id="current-password" name="currentPassword" label="كلمة المرور الحالية" autoComplete="current-password" error={state.errors?.currentPassword} />
        <PasswordField id="new-password" name="newPassword" label="كلمة المرور الجديدة" autoComplete="new-password" hint="استخدم ١٢ حرفًا على الأقل؛ يمكنك استخدام عبارة طويلة." error={state.errors?.newPassword} />
        <PasswordField id="confirm-password" name="confirmPassword" label="تأكيد كلمة المرور الجديدة" autoComplete="new-password" error={state.errors?.confirmPassword} />
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
