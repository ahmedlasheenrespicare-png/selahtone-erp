"use client";

/* غلاف خطأ وحدة المالية — بديل الغلاف العام (إنجليزي): رسالة عربية هادئة،
   زر إعادة محاولة يعيد بناء الشجرة، ومرجع فني اختياري (digest) للمراجعة لا للعرض. */

import Link from "next/link";
import { AppIcon } from "@/components/app-icon";
import { FinEmptyState } from "@/components/finance/fin-empty-state";

export default function FinanceError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="fin-page">
      <FinEmptyState icon="expenses" title="تعذّرت قراءة بيانات وحدة المالية">
        <p>
          حدث خطأ أثناء تحميل هذه الصفحة. جرّب مرة أخرى — إن تكرر الخلل فأبلغ مدير النظام مع ذكر الصفحة والوقت.
        </p>
        <div className="fin-actions" style={{ gap: 10 }}>
          <button className="fin-button" type="button" onClick={reset}>
            حاول مرة أخرى
          </button>
          <Link className="fin-button fin-button--secondary" href="/finance">
            العودة إلى الحسابات
          </Link>
        </div>
        {error.digest ? (
          <p className="fin-page__foot" dir="ltr">
            مرجع فني: {error.digest}
          </p>
        ) : null}
      </FinEmptyState>
    </div>
  );
}
