"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AppIcon } from "@/components/app-icon";

/* الحافظة — مطابقة لتصميم byllzz «rude-bat-50» (MIT):
   ١. ظهر الحافظة الأخضر الداكن (#1e341e) بزوايا 22/22/60/60 وظلال داخلة عميقة.
   ٢. ثلاث طبقات بطاقات متدرجة الارتفاع بألوان التصميم الأصلية
      (#ffffff الأبيض، #9bd86a الأخضر، #635bff البنفسجي) مع شريحة البطاقة،
      ترتفع وتميل عند التمرير، وتُقلَّب أفقيًّا بالسحب أو بالأسهم.
   ٣. الجيب الجلدي الأمامي المنحني بتجويف المنتصف والغرز المتقطعة،
      يعرض المستحق للخزنة وصافي مبيعات اليوم والتسويات والمصروفات غير المعتمدة (إن وجدت)
      مستورةً بالنجوم، وتكشفها جميعًا عينٌ واحدة عند التمرير أو اللمس. */

const TONES = ["paypal", "wise", "stripe"] as const;

function toneFor(i: number) {
  return TONES[((i % 3) + 3) % 3];
}

export type WalletPocketItem = {
  key: string;
  label: string;
  value: string;
  kind?: "money" | "count";
};

export default function DashboardWallet({
  children,
  balanceValue,
  balanceLabel = "المستحق للخزنة",
  pocketItems,
  hint = "مرّر المؤشر أو المس الجيب لإظهار الأرقام",
}: {
  children: React.ReactNode;
  balanceValue: string;
  balanceLabel?: string;
  pocketItems?: WalletPocketItem[];
  hint?: string;
}) {
  const gradientId = useId();
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [index, setIndex] = useState(0);
  const [count, setCount] = useState(0);
  const [titles, setTitles] = useState<string[]>([]);
  const [revealed, setRevealed] = useState(false);

  const items: WalletPocketItem[] =
    pocketItems && pocketItems.length > 0
      ? pocketItems
      : [{ key: "balance", label: balanceLabel, value: balanceValue, kind: "money" }];

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const slides = Array.from(el.children) as HTMLElement[];
    setCount(slides.length);
    setTitles(
      slides.map((slide) => {
        const heading = slide.querySelector(".stat-card__head h3, .stat-card__head h2");
        return heading?.textContent?.trim() ?? "";
      }),
    );
  }, [children]);

  const goTo = useCallback((next: number) => {
    const el = trackRef.current;
    if (!el) return;
    const slides = Array.from(el.children) as HTMLElement[];
    if (slides.length === 0) return;
    const clamped = Math.max(0, Math.min(next, slides.length - 1));
    setIndex(clamped);
    const viewportRect = el.getBoundingClientRect();
    const slideRect = slides[clamped].getBoundingClientRect();
    el.scrollBy({
      left: slideRect.left - viewportRect.left,
      behavior: "smooth",
    });
  }, []);

  const handleScroll = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const slides = Array.from(el.children) as HTMLElement[];
    if (slides.length === 0) return;
    const start = el.getBoundingClientRect().right;
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    slides.forEach((slide, i) => {
      const distance = Math.abs(slide.getBoundingClientRect().right - start);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    });
    setIndex(best);
  }, []);

  const midIndex = count > 1 ? (index + 1) % count : 0;
  const backIndex = count > 2 ? (index + 2) % count : 0;
  const hasExtraPocket = items.length > 2;

  return (
    <div
      className={`dashboard-wallet${revealed ? " is-revealed" : ""}${hasExtraPocket ? " has-extra-pocket" : ""}`}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          goTo(index + 1);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          goTo(index - 1);
        }
      }}
    >
      <div className="dashboard-wallet__back" aria-hidden="true" />

      {count > 2 ? (
        <button
          type="button"
          className={`dashboard-wallet__peek is-back is-tone-${toneFor(backIndex)}`}
          onClick={() => goTo(backIndex)}
          tabIndex={-1}
          aria-hidden="true"
        >
          <span className="dashboard-wallet__peek-top">
            <span className="dashboard-wallet__peek-title">{titles[backIndex] ?? ""}</span>
            <span className="dashboard-wallet__chip" />
          </span>
        </button>
      ) : null}

      {count > 1 ? (
        <button
          type="button"
          className={`dashboard-wallet__peek is-mid is-tone-${toneFor(midIndex)}`}
          onClick={() => goTo(midIndex)}
          tabIndex={-1}
          aria-hidden="true"
        >
          <span className="dashboard-wallet__peek-top">
            <span className="dashboard-wallet__peek-title">{titles[midIndex] ?? ""}</span>
            <span className="dashboard-wallet__chip" />
          </span>
        </button>
      ) : null}

      <div className="dashboard-wallet__viewport">
        <div className="dashboard-wallet__track" ref={trackRef} onScroll={handleScroll}>
          {children}
        </div>
      </div>

      <div className="dashboard-pocket-wrap">
        <div
          className="dashboard-pocket"
          onClick={() => setRevealed((prev) => !prev)}
          role="button"
          tabIndex={0}
          aria-pressed={revealed}
          aria-label="ملخص الجيب: اضغط لإظهار أو إخفاء الأرقام"
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setRevealed((prev) => !prev);
            }
          }}
        >
          <svg
            className="dashboard-pocket__svg"
            viewBox="0 0 560 196"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" style={{ stopColor: "var(--wallet-pocket-top, #223a22)" }} />
                <stop offset="100%" style={{ stopColor: "var(--wallet-pocket-bottom, #182b18)" }} />
              </linearGradient>
            </defs>
            <path
              d="M 0,0 L 165,0 C 215,0 232,28 280,28 C 328,28 345,0 395,0 L 560,0 L 560,196 L 0,196 Z"
              fill={`url(#${gradientId})`}
            />
            <path
              d="M 0,1 L 165,1 C 215,1 232,29 280,29 C 328,29 345,1 395,1 L 560,1"
              fill="none"
              style={{ stroke: "var(--wallet-pocket-rim, rgba(195, 226, 187, 0.28))" }}
              strokeWidth="1.5"
            />
            <path
              d="M 18,9 L 162,9 C 210,9 229,37 280,37 C 331,37 350,9 398,9 L 542,9"
              fill="none"
              style={{ stroke: "var(--wallet-pocket-stitch, rgba(167, 197, 158, 0.34))" }}
              strokeWidth="1.5"
              strokeDasharray="5 5"
              strokeLinecap="round"
            />
          </svg>

          <div className="dashboard-pocket__content">
            <div className="dashboard-pocket__metrics" data-count={items.length}>
              {items.map((item) => (
                <div
                  key={item.key}
                  className={`dashboard-pocket__metric${item.kind === "count" ? " is-count" : ""}`}
                >
                  <div className="dashboard-pocket__stat">
                    <span className="dashboard-pocket__stars" aria-hidden="true">
                      {item.kind === "count" ? "***" : "******"}
                    </span>
                    <span className="dashboard-pocket__value">{item.value}</span>
                  </div>
                  <span className="dashboard-pocket__label">{item.label}</span>
                </div>
              ))}
            </div>

            <span className="dashboard-pocket__eye-wrap" aria-hidden="true">
              <svg
                className="dashboard-pocket__eye is-slash"
                viewBox="0 0 24 24"
                fill="none"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
              <svg
                className="dashboard-pocket__eye is-open"
                viewBox="0 0 24 24"
                fill="none"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </span>
          </div>

          {count > 1 ? (
            <div
              className="dashboard-wallet__controls"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="dashboard-wallet__nav is-prev"
                onClick={() => goTo(index - 1)}
                disabled={index <= 0}
                aria-label="البطاقة السابقة"
              >
                <AppIcon name="arrow" />
              </button>

              <div className="dashboard-wallet__dots" role="tablist" aria-label="بطاقات الحافظة">
                {Array.from({ length: count }, (_, i) => (
                  <button
                    key={i}
                    type="button"
                    role="tab"
                    aria-selected={i === index}
                    aria-label={titles[i] ? `بطاقة ${i + 1}: ${titles[i]}` : `بطاقة ${i + 1}`}
                    className={i === index ? "is-active" : undefined}
                    onClick={() => goTo(i)}
                  />
                ))}
              </div>

              <button
                type="button"
                className="dashboard-wallet__nav is-next"
                onClick={() => goTo(index + 1)}
                disabled={index >= count - 1}
                aria-label="البطاقة التالية"
              >
                <AppIcon name="arrow" />
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <p className="dashboard-wallet__hint">{hint}</p>
    </div>
  );
}
