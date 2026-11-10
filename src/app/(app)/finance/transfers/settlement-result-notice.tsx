"use client";

import { useEffect, useState } from "react";

/** A browser hint only: success is shown exclusively for a server-read confirmed
 * settlement resolved by the current actor, not for an in-flight submission. */
export function SettlementResultNotice({ actorId, confirmedIds }: { actorId: string; confirmedIds: string[] }) {
  const [id, setId] = useState<string | null>(null);
  const confirmed = confirmedIds.join(",");
  const key = `finance-settlement-pending:${actorId}`;
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(key);
      const pending = stored ? JSON.parse(stored) : null;
      if (!pending || typeof pending.id !== "string" || !/^[1-9]\d{0,17}$/.test(pending.id) ||
          typeof pending.at !== "number" || Date.now() < pending.at || Date.now() - pending.at > 10 * 60_000) {
        if (stored) sessionStorage.removeItem(key);
        setId(null);
        return;
      }
      setId(confirmed.split(",").includes(pending.id) ? pending.id : null);
    } catch { setId(null); }
  }, [confirmed, key]);
  if (!id) return null;
  return <div className="fin-alert fin-alert--success no-print" role="status">
    يظهر في السجل أن التسوية #{id} اعتُمدت بواسطة حسابك. راجع الأرشيف والمبالغ المسجلة؛ هذا لا يثبت انتقال النقد فعليًا.
    <button type="button" onClick={() => { try { sessionStorage.removeItem(key); } catch { /* optional */ } setId(null); }}>إخفاء التنبيه</button>
  </div>;
}
