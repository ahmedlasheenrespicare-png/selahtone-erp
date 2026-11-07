"use client";

/**
 * أزرار الدخول التجريبي للمعاينة المحلية فقط.
 * لا تُنقل هذه الواجهة إلى الإنتاج: تُعرض حصريًا حين يضبط الخادم
 * PREVIEW_QUICK_LOGIN=true مع PREVIEW_DEMO_PASSWORD، وكلاهما مخصص
 * لقاعدة بيانات معاينة قابلة للإتلاف لا لبيانات إنتاج.
 */
export type PreviewAccount = {
  key: string;
  label: string;
  description: string;
  email: string;
  password: string;
};

const nativeValueSetter = () =>
  typeof window === "undefined"
    ? undefined
    : Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;

export function PreviewAccounts({ accounts }: { accounts: PreviewAccount[] }) {
  if (!accounts.length) return null;

  const signIn = (account: PreviewAccount) => {
    const email = document.getElementById("email") as HTMLInputElement | null;
    const password = document.getElementById("password") as HTMLInputElement | null;
    if (!email || !password) return;
    const setValue = nativeValueSetter();
    // React controlled input: مرِّر القيمة عبر المُعيِّن الأصلي
    setValue?.call(email, account.email);
    password.value = account.password;
    // انتظر لتحديث React قبل إرسال النموذج
    setTimeout(() => {
      email.dispatchEvent(new Event("input", { bubbles: true }));
      password.dispatchEvent(new Event("input", { bubbles: true }));
      const form = email.closest("form");
      form?.requestSubmit();
    }, 0);
  };

  return (
    <div className="preview-accounts" role="group" aria-label="حسابات المعاينة">
      <p className="preview-accounts__title">دخول بنقرة للمعاينة</p>
      <div className="preview-accounts__row">
        {accounts.map((account) => (
          <button
            key={account.key}
            type="button"
            className={`preview-accounts__btn preview-accounts__btn--${account.key}`}
            onClick={() => signIn(account)}
          >
            <strong>{account.label}</strong>
            <small>{account.description}</small>
          </button>
        ))}
      </div>
    </div>
  );
}
