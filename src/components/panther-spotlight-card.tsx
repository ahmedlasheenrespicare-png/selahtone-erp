import { useId } from "react";
import Link from "next/link";

export type PantherMetricBlock = {
  label: string;
  value: string;
  unit?: string;
  delta: string;
  tone: "positive" | "negative";
};

export type PantherSpotlightCardProps = {
  title: string;
  subtitle: string;
  pill?: string;
  primary: PantherMetricBlock;
  secondary: PantherMetricBlock;
  actionHref: string;
  actionLabel: string;
  layout?: "wallet" | "section";
};

/**
 * بطاقة المؤشرات المزدوجة المضيئة — مبنية على تصميم Gidarx «clever-panther-6» (MIT)
 * ومتكيّفة تلقائيًا مع ثيمَي الحافظة (الافتراضي الأخضر الليموني، وصلة تون السماوي الكحلي).
 */
export default function PantherSpotlightCard({
  title,
  subtitle,
  pill,
  primary,
  secondary,
  actionHref,
  actionLabel,
  layout = "section",
}: PantherSpotlightCardProps) {
  const titleId = useId();
  const gradientId = useId();

  return (
    <section
      className={`monthly-panther${layout === "section" ? " is-section" : ""}`}
      aria-labelledby={titleId}
    >
      <div className="monthly-panther__glow" aria-hidden="true" />

      <div className="monthly-panther__inner">
        <div className="monthly-panther__head">
          <div className="monthly-panther__brand">
            <div className="monthly-panther__icon" aria-hidden="true">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                strokeWidth="1.6"
                stroke="currentColor"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path stroke="none" d="M0 0h24v24H0z" fill="none" />
                <path d="M3 12m0 1a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z" />
                <path d="M9 8m0 1a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z" />
                <path d="M15 4m0 1a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z" />
                <path d="M4 20l14 0" />
              </svg>
            </div>
            <div>
              <h2 id={titleId} className="monthly-panther__title">
                {title}
              </h2>
              <p className="monthly-panther__subtitle">{subtitle}</p>
            </div>
          </div>

          {pill ? <span className="monthly-panther__pill">{pill}</span> : null}
        </div>

        <div className="monthly-panther__metrics">
          <div className="monthly-panther__metric">
            <p className="monthly-panther__metric-label">{primary.label}</p>
            <p className="monthly-panther__metric-value">
              <bdi dir="ltr">{primary.value}</bdi>
              {primary.unit ? <> <small>{primary.unit}</small></> : null}
            </p>
            <p className={`monthly-panther__metric-delta is-${primary.tone}`}>{primary.delta}</p>
          </div>

          <div className="monthly-panther__metric">
            <p className="monthly-panther__metric-label">{secondary.label}</p>
            <p className="monthly-panther__metric-value">
              <bdi dir="ltr">{secondary.value}</bdi>
              {secondary.unit ? <> <small>{secondary.unit}</small></> : null}
            </p>
            <p className={`monthly-panther__metric-delta is-${secondary.tone}`}>{secondary.delta}</p>
          </div>
        </div>

        <div className="monthly-panther__chart" dir="ltr" aria-hidden="true">
          <svg viewBox="0 0 300 100" preserveAspectRatio="none">
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" style={{ stopColor: "var(--mp-accent)", stopOpacity: 0.24 }} />
                <stop offset="100%" style={{ stopColor: "var(--mp-accent)", stopOpacity: 0 }} />
              </linearGradient>
            </defs>
            <path
              d="M0,65 C50,20 80,80 150,70 S250,50 300,85"
              fill="none"
              style={{ stroke: "var(--mp-accent)" }}
              strokeWidth="2.2"
            />
            <path
              d="M0,100 L0,65 C50,20 80,80 150,70 S250,50 300,85 L300,100 Z"
              fill={`url(#${gradientId})`}
            />
          </svg>
          <div className="monthly-panther__dot-anchor">
            <span className="monthly-panther__dot-pulse" />
            <span className="monthly-panther__dot" />
          </div>
        </div>

        <div className="monthly-panther__foot">
          <Link href={actionHref} className="monthly-panther__btn">
            {actionLabel}
          </Link>
        </div>
      </div>
    </section>
  );
}
