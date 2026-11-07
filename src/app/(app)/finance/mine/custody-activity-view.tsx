"use client";

import { useMemo, useState } from "react";

export type CustodyMovementItem = {
  id: string;
  recordedAt: string;
  kindLabel: string;
  direction: "IN" | "OUT";
  formattedAmount: string;
};

export default function CustodyActivityView({ items }: { items: CustodyMovementItem[] }) {
  const [dirFilter, setDirFilter] = useState<"ALL" | "IN" | "OUT">("ALL");
  const [query, setQuery] = useState("");

  const counts = useMemo(() => {
    let inCount = 0;
    let outCount = 0;
    for (const item of items) {
      if (item.direction === "IN") inCount += 1;
      else outCount += 1;
    }
    return { all: items.length, inCount, outCount };
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (dirFilter !== "ALL" && item.direction !== dirFilter) return false;
      if (q) {
        const hay = `${item.recordedAt} ${item.kindLabel} ${item.formattedAmount}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, dirFilter, query]);

  if (items.length === 0) {
    return (
      <div className="fin-panel__body">
        <p>لا توجد حركات مسجلة على العهدة بعد.</p>
      </div>
    );
  }

  return (
    <>
      <div className="fin-panel__body no-print" style={{ paddingBottom: 0 }}>
        <div className="fin-toolbar__row" style={{ gap: 10, flexWrap: "wrap" }}>
          <div className="fin-filter-pills" role="tablist" aria-label="اتجاه الحركة">
            <button
              type="button"
              role="tab"
              aria-selected={dirFilter === "ALL"}
              className={`fin-filter-pill${dirFilter === "ALL" ? " is-active" : ""}`}
              onClick={() => setDirFilter("ALL")}
            >
              <span>الكل</span>
              <span className="fin-filter-pill__count">{counts.all}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={dirFilter === "IN"}
              className={`fin-filter-pill${dirFilter === "IN" ? " is-active" : ""}`}
              onClick={() => setDirFilter("IN")}
            >
              <span>داخل (مقبوض)</span>
              <span className="fin-filter-pill__count">{counts.inCount}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={dirFilter === "OUT"}
              className={`fin-filter-pill${dirFilter === "OUT" ? " is-active" : ""}`}
              onClick={() => setDirFilter("OUT")}
            >
              <span>خارج (منصرف/مسلَّم)</span>
              <span className="fin-filter-pill__count">{counts.outCount}</span>
            </button>
          </div>

          <div className="fin-search-box" style={{ minWidth: 210 }}>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="بحث بنوع الحركة أو التاريخ…"
              aria-label="بحث في حركات العهدة"
            />
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="fin-empty">لا توجد حركات تطابق التصفية المختارة.</div>
      ) : (
        <div className="fin-table-wrap">
          <table className="fin-table">
            <caption>حركة عهدتي — الوارد والصادر بالتاريخ والمبلغ</caption>
            <thead>
              <tr>
                <th scope="col">التاريخ والوقت</th>
                <th scope="col">النوع</th>
                <th scope="col">الاتجاه</th>
                <th scope="col">المبلغ</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((movement) => (
                <tr key={movement.id}>
                  <td><bdi dir="ltr">{movement.recordedAt}</bdi></td>
                  <td>{movement.kindLabel}</td>
                  <td>
                    <span className={`fin-badge ${movement.direction === "OUT" ? "fin-badge--out" : "fin-badge--in"}`}>
                      {movement.direction === "OUT" ? "خارج" : "داخل"}
                    </span>
                  </td>
                  <td>
                    <span className={`fin-money${movement.direction === "OUT" ? " fin-money--negative" : ""}`}>
                      <bdi dir="ltr">{movement.direction === "OUT" ? `-${movement.formattedAmount}` : movement.formattedAmount}</bdi>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
