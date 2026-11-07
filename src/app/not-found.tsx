/* 404 عربي عام — بديل الغلاف الافتراضي بالإنجليزية لكل رابط لا يطابق شاشة،
   داخل وحدة المالية أو خارجها. */

import Link from "next/link";
import { FinEmptyState } from "@/components/finance/fin-empty-state";

export default function NotFound() {
  return (
    <div className="fin-page" style={{ minHeight: "60vh", display: "grid", placeItems: "center", padding: 24 }}>
      <FinEmptyState icon="cash" title="لا توجد هذه الصفحة">
        <p>لا توجد شاشة بهذا العنوان في النظام — ربما تغيّر الرابط أو أُزيلت الشاشة.</p>
        <div className="fin-actions" style={{ gap: 10 }}>
          <Link className="fin-button" href="/dashboard">
            لوحة القيادة
          </Link>
          <Link className="fin-button fin-button--secondary" href="/finance">
            وحدة المالية
          </Link>
        </div>
      </FinEmptyState>
    </div>
  );
}
