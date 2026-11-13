import type { CSSProperties, ReactNode } from "react";
import { normalizeStatRingPercent, statRingAngleDegrees } from "./stat-ring-pill-model";
import "./stat-ring-pill.css";

/**
 * بطاقة مؤشر عرض فقط: لا حالة عميل، لا جلب بيانات، ولا منطق حفظ.
 * الإلهام البصري: zeeshan_2112/gentle-treefrog-69 على Uiverse (MIT).
 * النص الكامل للإسناد في stat-ring-pill.LICENSE.txt بجانب هذا الملف.
 */
export type StatRingPillProps = {
  label: string;
  value: string;
  unit?: string;
  /** نسبة محسوبة مسبقًا. null يعني أن المقام غير صالح، وليس 0% أو 100%. */
  percent: number | null;
  /** وصف واضح للنسبة ومقامها، يظهر لقارئ الشاشة. */
  percentLabel: string;
  hint?: ReactNode;
  /** نص قصير داخل الحلقة عند غياب النسبة، مثل «لا فواتير». */
  emptyLabel?: string;
  className?: string;
};

const nf = new Intl.NumberFormat("ar-EG-u-nu-latn", { maximumFractionDigits: 1 });

export type StatRingProps = {
  percent: number | null;
  percentLabel: string;
  emptyLabel?: string;
  className?: string;
};

/** الحلقة وحدها، كي تُستخدم داخل بطاقة قائمة مثل FinKpiStrip بلا تكرار markup. */
export function StatRing({ percent, percentLabel, emptyLabel = "غير متاح", className }: StatRingProps) {
  const normalized = normalizeStatRingPercent(percent);
  const isEmpty = normalized === null;
  const ringStyle = { "--ring-angle": `${statRingAngleDegrees(normalized)}deg` } as CSSProperties;
  const accessiblePercent = isEmpty
    ? `${percentLabel}: ${emptyLabel}`
    : `${percentLabel}: ${nf.format(normalized)}%`;

  return (
    <div
      className={className ? `stat-ring-pill__ring-wrap ${className}` : "stat-ring-pill__ring-wrap"}
      data-empty={isEmpty ? "true" : "false"}
    >
      <div className="stat-ring-pill__ring" style={ringStyle} role="img" aria-label={accessiblePercent}>
        <span className="stat-ring-pill__core" aria-hidden="true">
          {isEmpty ? (
            <span className="stat-ring-pill__empty">{emptyLabel}</span>
          ) : (
            <bdi dir="ltr">{nf.format(normalized)}%</bdi>
          )}
        </span>
      </div>
    </div>
  );
}

export default function StatRingPill({
  label,
  value,
  unit,
  percent,
  percentLabel,
  hint,
  emptyLabel = "غير متاح",
  className,
}: StatRingPillProps) {
  const isEmpty = normalizeStatRingPercent(percent) === null;

  return (
    <article
      className={className ? `stat-ring-pill ${className}` : "stat-ring-pill"}
      aria-label={label}
      data-empty={isEmpty ? "true" : "false"}
    >
      <div className="stat-ring-pill__content">
        <StatRing percent={percent} percentLabel={percentLabel} emptyLabel={emptyLabel} />
        <div className="stat-ring-pill__meta">
          <span className="stat-ring-pill__label">{label}</span>
          <strong className="stat-ring-pill__value">
            <bdi dir="ltr">{value}</bdi>{" "}
            {unit ? <small>{unit}</small> : null}
          </strong>
          {hint ? <small className="stat-ring-pill__hint">{hint}</small> : null}
        </div>
      </div>
    </article>
  );
}
