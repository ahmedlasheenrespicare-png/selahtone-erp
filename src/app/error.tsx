"use client";

import Link from "next/link";
import { AuthFrame } from "./login/auth-frame";

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <AuthFrame eyebrow="تنبيه" title="حدث خطأ مؤقت" description="تعذّر تحميل الصفحة الآن. جرّب مرة أخرى، أو تواصل مع مسؤول النظام إذا استمرت المشكلة.">
      <div className="auth-form">
        <button className="btn auth-submit" type="button" onClick={reset}>حاول مرة أخرى</button>
        <Link className="auth-text-button" href="/login">العودة إلى تسجيل الدخول</Link>
      </div>
    </AuthFrame>
  );
}
