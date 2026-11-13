"use client";

import { useId, useRef, useState, type ReactNode, type KeyboardEvent } from "react";
import "./record-detail-tabs.css";

type RecordTab = { id: string; label: string; children: ReactNode };

export default function RecordDetailTabs({ label, tabs }: { label: string; tabs: RecordTab[] }) {
  const baseId = useId();
  const [active, setActive] = useState(0);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    let next = active;
    if (event.key === "ArrowLeft") next = (active + 1) % tabs.length;
    else if (event.key === "ArrowRight") next = (active - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    setActive(next);
    refs.current[next]?.focus();
  }

  return (
    <div className="record-detail-tabs">
      <div className="record-detail-tabs__list no-print" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
        {tabs.map((tab, index) => {
          const selected = active === index;
          return (
            <button
              key={tab.id}
              ref={(node) => { refs.current[index] = node; }}
              id={`${baseId}-tab-${tab.id}`}
              className={`record-detail-tabs__tab${selected ? " is-active" : ""}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(index)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {tabs.map((tab, index) => (
        <section
          key={tab.id}
          id={`${baseId}-panel-${tab.id}`}
          className="record-detail-tabs__panel"
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${tab.id}`}
          hidden={active !== index}
          tabIndex={0}
        >
          {tab.children}
        </section>
      ))}
    </div>
  );
}
