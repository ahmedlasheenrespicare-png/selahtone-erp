"use client";

import { useCallback, useRef } from "react";
import Link from "next/link";
import { AppIcon } from "@/components/app-icon";
import type { DashboardTodayInvoiceItem } from "@/lib/dashboard-pulse";

/* شريط تمرير أفقي لكل فواتير اليوم — كل فاتورة إيصال مصغّر (RTL، لمس/سحب، أسهم، snap) */

const timeFormatter = new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Africa/Cairo",
});

const GAP = 14;

export default function TodayInvoiceRail({
  invoices,
  canOpen,
}: {
  invoices: DashboardTodayInvoiceItem[];
  canOpen: boolean;
}) {
  const railRef = useRef<HTMLDivElement | null>(null);

  const cardStep = useCallback(() => {
    const el = railRef.current;
    if (!el) return 232;
    const card = el.querySelector<HTMLElement>(".dash-receipt");
    return card ? card.getBoundingClientRect().width + GAP : 232;
  }, []);

  const scrollRail = useCallback(
    (direction: "next" | "prev") => {
      const el = railRef.current;
      if (!el) return;
      const rtl = getComputedStyle(el).direction === "rtl";
      const sign = direction === "next" ? 1 : -1;
      el.scrollBy({ left: sign * (rtl ? -1 : 1) * cardStep(), behavior: "smooth" });
    },
    [cardStep],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        scrollRail("next");
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        scrollRail("prev");
      }
    },
    [scrollRail],
  );

  return (
    <div className="dash-invoice-rail-wrap">
      <button
        type="button"
        className="dash-rail-btn dash-rail-btn--prev"
        onClick={() => scrollRail("prev")}
        aria-label="السابق (فواتير يمين)"
      >
        <AppIcon name="chevronRight" aria-hidden="true" />
      </button>

      <div
        ref={railRef}
        className="dash-invoice-rail"
        role="region"
        aria-label="فواتير اليوم داخل إيصالات قابلة للتمرير يمينًا ويسارًا"
        tabIndex={0}
        onKeyDown={onKeyDown}
      >
        {invoices.map((inv) => {
          const href = `/sales/${inv.saleId}`;
          const badge =
            inv.badge === "cancelled"
              ? { label: "ملغاة", cls: "is-cancelled" }
              : inv.badge === "credit"
                ? { label: "آجلة", cls: "is-credit" }
                : { label: "مدفوعة", cls: "is-paid" };

          const body = (
            <>
              <span className="dash-receipt__brand">صلة تون للخدمات السمعية</span>
              <span className="dash-receipt__branch">{inv.branchName} · إيصال مراجعة</span>
              <div className="dash-receipt__headrow">
                <strong className="dash-receipt__number">ST-{inv.saleId}</strong>
                <time className="dash-receipt__time" dateTime={inv.timestampIso}>
                  {timeFormatter.format(new Date(inv.timestampIso))}
                </time>
              </div>
              <div className="dash-receipt__meta">
                <span>العميل: {inv.customerName}</span>
                <span>سجّلها: {inv.staffName}</span>
              </div>
              <hr className="dash-receipt__sep" />
              {inv.lines.length > 0 ? (
                <ul className="dash-receipt__items">
                  {inv.lines.map((line, index) => (
                    <li key={`${inv.key}-l${index}`}>
                      <span className="dash-receipt__item-name" title={line.name}>
                        {line.name}
                      </span>
                      <span className="dash-receipt__item-qty">
                        ×<bdi dir="ltr">{line.quantityFormatted}</bdi>
                      </span>
                      <bdi dir="ltr" className="dash-receipt__item-total">
                        {line.totalFormatted}
                      </bdi>
                    </li>
                  ))}
                  {inv.extraLinesCount > 0 ? (
                    <li className="dash-receipt__more">+{inv.extraLinesCount} أصناف أخرى — افتح الفاتورة</li>
                  ) : null}
                </ul>
              ) : (
                <p className="dash-receipt__no-items">لا توجد بنود مسجّلة</p>
              )}
              <hr className="dash-receipt__sep" />
              <div className="dash-receipt__totalrow">
                <span>الإجمالي</span>
                <strong>
                  <bdi dir="ltr">{inv.totalFormatted}</bdi> ج.م
                </strong>
              </div>
              <div className="dash-receipt__remainrow">
                <span>المتبقي على العميل</span>
                <span>
                  <bdi dir="ltr">{inv.remainingFormatted}</bdi> ج.م
                </span>
              </div>
              <span className={`dash-receipt__badge ${badge.cls}`}>{badge.label}</span>
            </>
          );

          const className = `dash-receipt${inv.badge === "cancelled" ? " is-cancelled" : ""}`;
          return canOpen ? (
            <Link key={inv.key} href={href} className={className} aria-label={`فتح فاتورة ST-${inv.saleId} — ${inv.customerName}`}>
              {body}
            </Link>
          ) : (
            <div key={inv.key} className={className} aria-label={`فاتورة ST-${inv.saleId} — ${inv.customerName}`}>
              {body}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        className="dash-rail-btn dash-rail-btn--next"
        onClick={() => scrollRail("next")}
        aria-label="التالي (فواتير يسار)"
      >
        <AppIcon name="chevronLeft" aria-hidden="true" />
      </button>
    </div>
  );
}
