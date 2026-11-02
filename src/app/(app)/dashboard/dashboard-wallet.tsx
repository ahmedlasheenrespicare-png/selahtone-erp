"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AppIcon } from "@/components/app-icon";

/* الحافظة: قسمٌ واحدٌ معروض، والغلافُ يُمرَّر أفقيًّا — باللمس أو بالسهمين.
   وكلاهما يعمل في الجوال، فلا تُستثنى منه شاشة.

   والاتجاه عربيّ: فحافةُ البداية هي اليمين، وعليها يُقاس أيّ قسمٍ أقرب.
   ولذلك تُرِك تحديدُ الموضع لـ scrollIntoView يحسبه، ولم تُكتب إزاحةٌ
   بيدٍ فإنّ الإشارةَ تنقلب بين يمينٍ ويسار.

   والجيبُ يبقى ثابتًا أسفلها: فإنّه ملخّصُ كل الأقسام لا واحدًا منها،
   فلا يُمرَّر معها. */

export default function DashboardWallet({
  children,
  pocket,
}: {
  children: React.ReactNode;
  pocket?: React.ReactNode;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [index, setIndex] = useState(0);
  const [count, setCount] = useState(0);

  // عدد الأقسام لا يُعرف إلا عند العرض: فبعضها مشروطٌ بالدور.
  useEffect(() => {
    const el = trackRef.current;
    if (el) setCount(el.children.length);
  });

  const goTo = useCallback((next: number) => {
    const el = trackRef.current;
    if (!el) return;
    const slides = Array.from(el.children) as HTMLElement[];
    if (slides.length === 0) return;
    const clamped = Math.max(0, Math.min(next, slides.length - 1));
    setIndex(clamped);
    slides[clamped].scrollIntoView({
      behavior: "smooth",
      inline: "start",
      block: "nearest",
    });
  }, []);

  // إن مرّر المستخدم بيده، تَبِعَ المؤشّرُ موضعه ولم يبقَ where تركه السهم.
  const handleScroll = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const slides = Array.from(el.children) as HTMLElement[];
    const start = el.getBoundingClientRect().right; // RTL: البداية يمين
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

  return (
    <div className="dashboard-wallet">
      <div className="dashboard-wallet__viewport">
        <div className="dashboard-wallet__track" ref={trackRef} onScroll={handleScroll}>
          {children}
        </div>
      </div>

      <div className="dashboard-wallet__controls">
        <button
          type="button"
          className="dashboard-wallet__nav is-prev"
          onClick={() => goTo(index - 1)}
          disabled={index <= 0}
          aria-label="القسم السابق"
        >
          <AppIcon name="arrow" />
        </button>

        <div className="dashboard-wallet__dots" aria-hidden="true">
          {Array.from({ length: count }, (_, i) => (
            <span key={i} className={i === index ? "is-active" : undefined} />
          ))}
        </div>

        <button
          type="button"
          className="dashboard-wallet__nav is-next"
          onClick={() => goTo(index + 1)}
          disabled={index >= count - 1}
          aria-label="القسم التالي"
        >
          <AppIcon name="arrow" />
        </button>
      </div>

      {pocket}
    </div>
  );
}
