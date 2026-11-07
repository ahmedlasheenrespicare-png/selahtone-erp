/* هيكل تحميل وحدة المالية — يُعرض أثناء جلب البيانات بدل شاشة بيضاء،
   بلا تمييز للحالة ولا صلاحيات: مجرد أجزاء مكانية تنتظر المحتوى الحقيقي. */

import { AppIcon } from "@/components/app-icon";

const VISUALLY_HIDDEN: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
};

export default function FinanceLoading() {
  return (
    <div className="fin-page" aria-busy="true" role="status" aria-label="جارٍ تحميل وحدة المالية">
      <span style={VISUALLY_HIDDEN}>جارٍ تحميل بيانات وحدة المالية…</span>
      <div className="fin-heading" aria-hidden="true">
        <div style={{ flex: 1 }}>
          <p className="fin-heading__eyebrow">
            <span className="fin-eyebrow-dot" aria-hidden="true" />
            وحدة المالية
          </p>
          <h1>جارٍ التحميل…</h1>
        </div>
      </div>

      <section className="fin-kpi-strip" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <article key={i} className="fin-kpi-card">
            <span className="fin-kpi-card__icon">
              <AppIcon name="cash" />
            </span>
            <div className="fin-kpi-card__body">
              <span className="fin-kpi-card__label">جارٍ القراءة…</span>
              <strong className="fin-kpi-card__value">
                <bdi dir="ltr">0.00</bdi> <small>ج.م</small>
              </strong>
              <small className="fin-kpi-card__sub">جارٍ استرجاع البيانات من الخادم</small>
            </div>
          </article>
        ))}
      </section>

      <div className="fin-panel" aria-hidden="true" style={{ display: "grid", gap: 14, padding: 24 }}>
        {[280, 420, 360, 220].map((width, i) => (
          <div
            key={i}
            style={{
              height: 18,
              width,
              maxWidth: "100%",
              borderRadius: 8,
              background: "var(--fn-surface-soft, rgba(127, 127, 127, 0.16))",
            }}
          />
        ))}
      </div>
    </div>
  );
}
