/* 404 عربي داخل وحدة المالية — بدل غلاف Next.js الافتراضي بالإنجليزية. */

import Link from "next/link";
import { FinEmptyState } from "@/components/finance/fin-empty-state";

export default function FinanceNotFound() {
  return (
    <div className="fin-page">
      <FinEmptyState icon="cash" title="لا توجد هذه الصفحة">
        <p>لا توجد شاشة بهذا العنوان داخل وحدة المالية — ربما تغيّر الرابط أو أُزيلت الشاشة.</p>
        <div className="fin-actions" style={{ gap: 10 }}>
          <Link className="fin-button" href="/finance">
            العودة إلى الحسابات
          </Link>
          <Link className="fin-button fin-button--secondary" href="/dashboard">
            لوحة القيادة
          </Link>
        </div>
      </FinEmptyState>
    </div>
  );
}
