import Link from "next/link";

/** Read-only notice for a page whose write operation is disabled by the administrator. */
export function WriteLockedNotice({ backHref, backLabel }: { backHref: string; backLabel: string }) {
  return <div className="inv-page"><div className="inv-alert inv-alert--error" role="status">التعديل والحفظ في هذه الصفحة معطّل بالصلاحيات. راجع الأدمن إن احتجت إجراءها.</div><Link className="inv-back" href={backHref}>{backLabel}</Link></div>;
}
