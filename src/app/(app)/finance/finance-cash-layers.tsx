"use client";

import { useId, useState, type CSSProperties } from "react";
import Link from "next/link";
import { AppIcon, type AppIconName } from "@/components/app-icon";
import "./finance-cash-layers.css";

export type CashLayerId = "invoice" | "collection" | "custody" | "vault" | "settlement";

type CashLayer = {
  id: CashLayerId;
  title: string;
  subtitle: string;
  description: string;
  actionLabel: string;
  icon: AppIconName;
};

const LAYERS: readonly CashLayer[] = [
  {
    id: "invoice",
    title: "الفاتورة",
    subtitle: "حدث البيع",
    description:
      "نقطة البداية التجارية: أصناف وخصم وإجمالي. وجود الفاتورة وحده لا يعني أن النقد دخل الخزنة.",
    actionLabel: "فتح سجل المبيعات",
    icon: "receipt",
  },
  {
    id: "collection",
    title: "التحصيل",
    subtitle: "دخول النقد",
    description:
      "المبلغ المقبوض فعليًا ووسيلة الدفع. قد يكون نقدًا أو بطاقة أو تحويلًا، ويظل مرتبطًا بالفاتورة عند التسجيل.",
    actionLabel: "مراجعة التحصيل في المبيعات",
    icon: "cash",
  },
  {
    id: "custody",
    title: "العهدة",
    subtitle: "النقد لدى الموظف",
    description:
      "ما يُنسب إلى موظف أو حساب وسيط قبل التسليم. المؤشر التقديري ليس دليلًا وحده على أن النقد جاهز للتسليم.",
    actionLabel: "فتح الحسابات النقدية",
    icon: "lock",
  },
  {
    id: "vault",
    title: "الخزنة",
    subtitle: "نقد الفرع",
    description:
      "الرصيد الدفتري لخزنة الفرع بعد الحركات المؤكدة. التسليم الفعلي ينقل النقد من العهدة إلى الخزنة وفق الإجراء المعتمد.",
    actionLabel: "عرض الخزائن والعهد",
    icon: "warehouse",
  },
  {
    id: "settlement",
    title: "التسوية",
    subtitle: "معالجة الفرق",
    description:
      "عند الجرد يظهر فرق بين المعدود والمتوقع. التسوية توثّق المعالجة بعد المراجعة، ولا تُنشأ تلقائيًا من هذا العرض.",
    actionLabel: "فتح التسويات",
    icon: "check",
  },
];

export type CashLayerLinks = Partial<Record<CashLayerId, string>>;

/**
 * طبقة عرض تعليمية فقط: لا تقرأ قاعدة البيانات، لا تؤكد حركة، ولا تغيّر صلاحيات.
 * الروابط تُمرَّر من الخادم بعد فحص access.isAllowed.
 */
export default function FinanceCashLayers({ links = {} }: { links?: CashLayerLinks }) {
  const [activeId, setActiveId] = useState<CashLayerId>("custody");
  const [exploded, setExploded] = useState(true);
  const [staticMode, setStaticMode] = useState(false);
  const [open, setOpen] = useState(true);
  const uid = useId().replace(/:/g, "");
  const titleId = `cash-layers-title-${uid}`;
  const detailId = `cash-layers-detail-${uid}`;
  const detailHeadingId = `cash-layers-detail-heading-${uid}`;
  const activeIndex = LAYERS.findIndex((layer) => layer.id === activeId);
  const activeLayer = LAYERS[activeIndex] ?? LAYERS[0];
  const activeHref = links[activeLayer.id];

  return (
    <section
      className="cash-layers"
      data-exploded={exploded ? "true" : "false"}
      data-static={staticMode ? "true" : "false"}
      data-open={open ? "true" : "false"}
      aria-labelledby={titleId}
    >
      <header className="cash-layers__header">
        <div className="cash-layers__intro">
          <p className="cash-layers__eyebrow">
            <span className="cash-layers__dot" aria-hidden="true" />
            مسار النقد · عرض توضيحي
          </p>
          <h2 id={titleId}>الدقة في كل طبقة</h2>
          <p>
            افصل الطبقات لتفهم العلاقة بين الفاتورة والتحصيل والعهدة والخزنة والتسوية، ثم ارجع إلى
            السجلات الفعلية عند تنفيذ أي إجراء.
          </p>
        </div>
        <div className="cash-layers__controls" role="group" aria-label="خيارات عرض الطبقات">
          <button
            type="button"
            className="cash-layers__control"
            aria-pressed={exploded}
            onClick={() => setExploded((value) => !value)}
          >
            {exploded ? "تجميع الطبقات" : "تفكيك الطبقات"}
          </button>
          <button
            type="button"
            className="cash-layers__control"
            aria-pressed={staticMode}
            onClick={() => setStaticMode((value) => !value)}
          >
            عرض ثابت
          </button>
          <button
            type="button"
            className="cash-layers__control cash-layers__control--ghost"
            aria-expanded={open}
            aria-controls={detailId}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? "طي العرض" : "فتح العرض"}
          </button>
        </div>
      </header>

      {open ? (
        <div className="cash-layers__body">
          <div className="cash-layers__stage">
            <ol className="cash-layers__stack" aria-label="طبقات مسار النقد">
              {LAYERS.map((layer, index) => {
                const isActive = layer.id === activeId;
                return (
                  <li
                    key={layer.id}
                    className="cash-layers__item"
                    data-active={isActive ? "true" : "false"}
                    style={{ "--cash-layer-index": index } as CSSProperties}
                  >
                    <button
                      type="button"
                      className="cash-layers__plate"
                      aria-pressed={isActive}
                      aria-controls={detailId}
                      onClick={() => setActiveId(layer.id)}
                    >
                      <span className="cash-layers__plate-index" aria-hidden="true">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="cash-layers__plate-icon" aria-hidden="true">
                        <AppIcon name={layer.icon} />
                      </span>
                      <span className="cash-layers__plate-text">
                        <strong>{layer.title}</strong>
                        <small>{layer.subtitle}</small>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>

          <div
            className="cash-layers__detail"
            id={detailId}
            role="region"
            aria-live="polite"
            aria-labelledby={detailHeadingId}
          >
            <p className="cash-layers__detail-index">الطبقة {String(activeIndex + 1).padStart(2, "0")}</p>
            <h3 id={detailHeadingId}>{activeLayer.title}</h3>
            <p className="cash-layers__detail-description">{activeLayer.description}</p>
            {activeHref ? (
              <Link className="cash-layers__link" href={activeHref}>
                <span>{activeLayer.actionLabel}</span>
                <AppIcon name="arrow" aria-hidden="true" />
              </Link>
            ) : (
              <p className="cash-layers__no-link">الرابط المباشر غير متاح لدورك أو إعدادات الصلاحية الحالية.</p>
            )}
            <p className="cash-layers__note">
              هذا شكل توضيحي للعلاقة بين السجلات، وليس تأكيد تحصيل أو تسليم أو تسوية. الإجراء الفعلي
              يتم من صفحات النظام بعد نجاح الحفظ والمراجعة.
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
