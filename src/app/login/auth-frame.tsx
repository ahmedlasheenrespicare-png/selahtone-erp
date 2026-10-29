import type { ReactNode } from "react";

type AuthFrameProps = {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
};

export function AuthFrame({ eyebrow, title, description, children }: AuthFrameProps) {
  return (
    <main className="login-wrap">
      <div className="login-shell">
        <div className="login-card">
          <div className="login-brand">
            <div className="login-mark" aria-hidden="true">ص</div>
            <div className="login-brand-text">
              <span>صلة تون</span>
              <small>نظام الإيرادات والمصروفات</small>
            </div>
            <span className="login-brand-badge" aria-hidden="true">
              <svg viewBox="0 0 20 20" fill="none"><path d="M10 2.4 16 5v4.5c0 3.7-2.4 6.5-6 8.1-3.6-1.6-6-4.4-6-8.1V5l6-2.6Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><path d="m7.4 9.8 1.7 1.7 3.6-3.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              مساحة عملك
            </span>
          </div>

          <div className="login-heading">
            <div className="login-eyebrow"><span aria-hidden="true" />{eyebrow}</div>
            <h1>{title}</h1>
            <p>{description}</p>
          </div>
          {children}
        </div>
        <p className="login-footer"><span>صلة تون للسمعيات</span><span aria-hidden="true">·</span><span>عملك، بصورة أوضح</span></p>
      </div>
    </main>
  );
}
