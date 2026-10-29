"use client";

import { useActionState, useState } from "react";
import { loginAction } from "./actions";
import { initialLoginState } from "./login-state";
import { PasswordField } from "./password-field";

export function LoginForm({ next, logoutUnconfirmed = false }: { next: string; logoutUnconfirmed?: boolean }) {
  const [state, action, pending] = useActionState(loginAction, initialLoginState);
  const [email, setEmail] = useState("");
  const [remember, setRemember] = useState(false);

  return (
    <>
      {logoutUnconfirmed && !state.message && (
        <div className="auth-message auth-message-warning" role="alert">تم الخروج من هذا الجهاز، لكن تعذّر تأكيد إلغاء الجلسة على الخادم. تواصل مع مسؤول النظام.</div>
      )}
      {state.message && <div className="auth-message auth-message-error" role="alert">{state.message}</div>}
      <form action={action} className="auth-form" aria-busy={pending}>
        <input type="hidden" name="next" value={next} />
        <div className="field auth-field">
          <label htmlFor="email">البريد الإلكتروني</label>
          <input
            id="email" name="email" type="email" required autoComplete="username" autoFocus
            placeholder="name@example.com" dir="ltr" maxLength={160} spellCheck={false}
            autoCapitalize="none" autoCorrect="off" value={email} onChange={(event) => setEmail(event.target.value)}
            aria-invalid={Boolean(state.errors?.email)} aria-describedby={state.errors?.email ? "email-error" : undefined}
          />
          {state.errors?.email && <p className="field-error" id="email-error" role="alert">{state.errors.email}</p>}
        </div>
        <PasswordField id="password" name="password" label="كلمة المرور" autoComplete="current-password" error={state.errors?.password} />
        <div className="auth-options">
          <label className="remember-option">
            <input type="checkbox" name="remember" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
            <span>تذكرني لمدة ٧ أيام</span>
          </label>
          <span className="auth-options-hint">للأجهزة الشخصية فقط</span>
        </div>
        <button className="btn auth-submit" type="submit" disabled={pending}>
          {pending ? <><span className="auth-spinner" aria-hidden="true" /> جارٍ تسجيل الدخول…</> : <>تسجيل الدخول <svg className="submit-arrow" aria-hidden="true" viewBox="0 0 20 20" fill="none"><path d="M16 10H4m0 0 5-5m-5 5 5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg></>}
        </button>
        <span className="sr-only" role="status" aria-live="polite">{pending ? "جارٍ تسجيل الدخول" : ""}</span>
      </form>
      <div className="auth-support">
        <span className="auth-support-icon" aria-hidden="true">؟</span>
        <p><strong>تواجه مشكلة في الدخول؟</strong><br />تواصل مع مسؤول النظام لمساعدتك.</p>
      </div>
    </>
  );
}
