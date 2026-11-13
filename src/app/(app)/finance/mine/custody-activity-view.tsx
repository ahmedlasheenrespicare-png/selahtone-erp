"use client";

import { useMemo, useState } from "react";
import DataTable from "@/components/data-driven/data-table";
import { filterRowsBySearch } from "@/lib/data-driven-ui";
import {
  custodyMovementColumns,
  custodyMovementFilters,
  custodyMovementSearch,
  type CustodyDirectionFilter,
  type CustodyMovementItem,
} from "./custody-activity-metadata";

export type { CustodyMovementItem } from "./custody-activity-metadata";

export default function CustodyActivityView({ items }: { items: CustodyMovementItem[] }) {
  const [dirFilter, setDirFilter] = useState<CustodyDirectionFilter>("ALL");
  const [query, setQuery] = useState("");

  const counts = useMemo(() => Object.fromEntries(
    custodyMovementFilters.map((filter) => [filter.id, items.filter(filter.matches).length]),
  ) as Record<CustodyDirectionFilter, number>, [items]);

  const filtered = useMemo(() => {
    const filter = custodyMovementFilters.find((item) => item.id === dirFilter) ?? custodyMovementFilters[0];
    return filterRowsBySearch(items.filter(filter.matches), query, custodyMovementSearch.text);
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
            {custodyMovementFilters.map((filter) => (
              <button
                key={filter.id}
                type="button"
                role="tab"
                aria-selected={dirFilter === filter.id}
                className={`fin-filter-pill${dirFilter === filter.id ? " is-active" : ""}`}
                onClick={() => setDirFilter(filter.id)}
              >
                <span>{filter.label}</span>
                <span className="fin-filter-pill__count">{counts[filter.id]}</span>
              </button>
            ))}
          </div>

          <div className="fin-search-box" style={{ minWidth: 210 }}>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={custodyMovementSearch.placeholder}
              aria-label="بحث في حركات العهدة"
            />
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="fin-empty">لا توجد حركات تطابق التصفية المختارة.</div>
      ) : (
        <DataTable
          rows={filtered}
          columns={custodyMovementColumns}
          rowKey={(item) => item.id}
          regionLabel="جدول مالي قابل للتمرير"
          regionClassName="fin-table-wrap"
          tableClassName="fin-table"
          caption="حركة عهدتي — الوارد والصادر بالتاريخ والمبلغ"
        />
      )}
    </>
  );
}
