import type { ReactNode } from "react";

export function LoginFrame({ children }: { children: ReactNode }) {
  return (
    <main className="login-wrap signin-page">
      <div className="login-shell signin-shell">
        <div className="signin-card-frame">
          <section className="signin-card" aria-labelledby="signin-title">
            <header className="signin-heading">
              <div className="signin-avatar" aria-hidden="true">
                {/* شعار الموقع الأصلي: selatone-website7/src/components/Header.tsx */}
                <svg viewBox="0 0 46 46" fill="none">
                  <rect width="46" height="46" rx="7" fill="#3156A3" />
                  <path d="M14 29c0-9 4-15 10-15 4 0 7 3 7 7 0 6-6 6-6 11a3.5 3.5 0 0 1-7 0" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
                  <path d="M33 14c3 3 4.5 7 3.5 11M37 10c4.5 4.5 6 10.5 4.5 16" stroke="#42B3E5" strokeWidth="2.4" strokeLinecap="round" />
                  <circle cx="24" cy="23" r="2.2" fill="#42B3E5" />
                </svg>
              </div>
              <p className="signin-brand">
                <span className="signin-brand-ar">صله <span>تون</span></span>
                <span className="signin-brand-en" dir="ltr">Selatone Hearing</span>
              </p>
              <h1 id="signin-title">تسجيل الدخول</h1>
              <p className="signin-intro">أهلًا بك مجددًا في مساحة عملك.</p>
            </header>
            {children}
          </section>
        </div>
        <p className="login-footer"><span>صلة تون للسمعيات</span><span aria-hidden="true">·</span><span>عملك، بصورة أوضح</span></p>
      </div>
    </main>
  );
}
