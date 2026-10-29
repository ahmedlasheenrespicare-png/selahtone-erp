"use client";

import { useState, type KeyboardEvent } from "react";

type PasswordFieldProps = {
  id: string;
  name: string;
  label: string;
  autoComplete: "current-password" | "new-password";
  error?: string;
  hint?: string;
};

export function PasswordField({ id, name, label, autoComplete, error, hint }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [containsArabic, setContainsArabic] = useState(false);
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null, capsLock || containsArabic ? `${id}-keyboard` : null].filter(Boolean).join(" ") || undefined;
  const checkCapsLock = (event: KeyboardEvent<HTMLInputElement>) => setCapsLock(event.getModifierState("CapsLock"));

  return (
    <div className="field auth-field">
      <label htmlFor={id}>{label}</label>
      <div className="password-control">
        <input
          id={id} name={name} type={visible ? "text" : "password"} required
          autoComplete={autoComplete} dir="ltr" maxLength={72} spellCheck={false}
          aria-invalid={Boolean(error)} aria-describedby={describedBy}
          onKeyDown={checkCapsLock} onKeyUp={checkCapsLock}
          onBlur={() => { setCapsLock(false); setContainsArabic(false); }}
          onChange={(event) => setContainsArabic(/\p{Script=Arabic}/u.test(event.currentTarget.value))}
        />
        <button
          className="password-toggle" type="button" onClick={() => setVisible(!visible)}
          aria-label={visible ? `إخفاء ${label}` : `إظهار ${label}`} aria-pressed={visible}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
            <path d="M2.5 12s3.5-5.5 9.5-5.5 9.5 5.5 9.5 5.5-3.5 5.5-9.5 5.5S2.5 12 2.5 12Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
            <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.6"/>
            {visible && <path d="m4 20 16-16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>}
          </svg>
        </button>
      </div>
      {hint && <p className="field-hint" id={`${id}-hint`}>{hint}</p>}
      {(capsLock || containsArabic) && (
        <p className="field-keyboard" id={`${id}-keyboard`} role="status">
          {capsLock ? "مفتاح Caps Lock مفعّل. " : ""}{containsArabic ? "تأكد من لغة لوحة المفاتيح." : ""}
        </p>
      )}
      {error && <p className="field-error" id={`${id}-error`} role="alert">{error}</p>}
    </div>
  );
}
