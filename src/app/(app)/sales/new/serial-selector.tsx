"use client";

import { useEffect, useState } from "react";

export type SerialOption = { id: string; number: string };
type Props = { productId: string; warehouseId: string; selected: SerialOption[]; pending: boolean; limitReached: boolean; onChange: (value: SerialOption[]) => void };

/** Search on the server, so a warehouse with more than 5000 serials remains usable. */
export default function SerialSelector({ productId, warehouseId, selected, pending, limitReached, onChange }: Props) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<SerialOption[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ warehouseId, productId, q: query });
        const response = await fetch(`/api/commerce/available-serials?${params.toString()}`, { signal: controller.signal, cache: "no-store" });
        const data = await response.json();
        if (!response.ok || !Array.isArray(data.serials)) throw new Error(typeof data.message === "string" ? data.message : "تعذر تحميل السيريالات.");
        setOptions(data.serials); setMore(data.more === true);
      } catch (problem) {
        if (!controller.signal.aborted) { setOptions([]); setMore(false); setError(problem instanceof Error ? problem.message : "تعذر تحميل السيريالات."); }
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, 200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [warehouseId, productId, query]);
  const chosen = new Set(selected.map((serial) => serial.id));
  const visible = [...selected, ...options.filter((serial) => !chosen.has(serial.id))];
  return <>
    <div className="inv-field"><label htmlFor={`sale-search-${productId}`}>بحث في السيريالات المتاحة</label><input id={`sale-search-${productId}`} disabled={pending} dir="ltr" value={query} maxLength={80} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث برقم السيريال" /></div>
    <fieldset className="sale-serials"><legend>اختر سيريالًا لكل جهاز ({selected.length} مختار)</legend><div className="sale-serials__list">
      {visible.map((serial) => <label key={serial.id}><input type="checkbox" checked={chosen.has(serial.id)} disabled={pending || (!chosen.has(serial.id) && limitReached)} onChange={() => onChange(chosen.has(serial.id) ? selected.filter((item) => item.id !== serial.id) : [...selected, serial])} /><bdi dir="ltr">{serial.number}</bdi></label>)}
    </div><p className="sale-note" aria-live="polite">{loading ? "جارٍ البحث…" : error || (more ? "تظهر أول 50 نتيجة؛ اكتب جزءًا أدق من الرقم للبحث." : !visible.length ? "لا توجد أرقام مطابقة متاحة." : "يمكن البحث برقم السيريال أو جزء منه.")}</p></fieldset>
  </>;
}
