/* شريط مؤشرات وحدة المالية بطريقة واحدة: شبكة بطاقات موحّدة الشكل (أيقونة + عنوان + قيمة + فرع)،
   بثلاث نبرات (عادي / accent للأهم / alert لتنبيه الإجراء). عندما تحمل البطاقة `href`
   تصبح البطاقة كلها رابطًا إلى شاشتها — نفس شكل البطاقة، مع فائدة الوصول الكامل باللوحة. */
import Link from "next/link";
import type { ReactNode } from "react";
import { AppIcon, type AppIconName } from "@/components/app-icon";
import { StatRing } from "@/components/stat-ring-pill";

export type FinKpiItem = {
  icon: AppIconName;
  label: string;
  /** القيمة كاملة كما تُعرض (قد تحوي <bdi> و<small>ج.م</small>). */
  value: ReactNode;
  sub?: ReactNode;
  tone?: "default" | "accent" | "alert";
  /** عند التمرير تصبح البطاقة رابطًا كاملًا (مثال: «مصروفات بانتظار إجراء» → /finance/expenses). */
  href?: string;
  /** حلقة نسبة اختيارية تحل محل الأيقونة في هذه البطاقة فقط. null = مقام غير صالح. */
  ring?: {
    percent: number | null;
    percentLabel: string;
    emptyLabel?: string;
  };
};

function kpiClass(tone?: FinKpiItem["tone"], ring?: boolean): string {
  return `fin-kpi-card${tone === "accent" ? " is-accent" : ""}${tone === "alert" ? " is-alert" : ""}${ring ? " fin-kpi-card--ring" : ""}`;
}

export function FinKpiStrip({
  label,
  items,
  className,
}: {
  label: string;
  items: FinKpiItem[];
  /** فئة إضافية على الشريط (مثال: no-print لإخفائه عن الطباعة). */
  className?: string;
}) {
  return (
    <section className={`fin-kpi-strip${className ? ` ${className}` : ""}`} aria-label={label}>
      {items.map((item, index) => {
        const inner = (
          <>
            {item.ring ? (
              <StatRing
                percent={item.ring.percent}
                percentLabel={item.ring.percentLabel}
                emptyLabel={item.ring.emptyLabel}
                className="fin-kpi-card__ring"
              />
            ) : (
              <span className="fin-kpi-card__icon" aria-hidden="true">
                <AppIcon name={item.icon} />
              </span>
            )}
            <div className="fin-kpi-card__body">
              <span className="fin-kpi-card__label">{item.label}</span>
              <strong className="fin-kpi-card__value">{item.value}</strong>
              {item.sub ? <small className="fin-kpi-card__sub">{item.sub}</small> : null}
            </div>
          </>
        );
        return item.href ? (
          <Link key={index} href={item.href} className={kpiClass(item.tone, Boolean(item.ring))}>
            {inner}
          </Link>
        ) : (
          <article key={index} className={kpiClass(item.tone, Boolean(item.ring))}>
            {inner}
          </article>
        );
      })}
    </section>
  );
}
