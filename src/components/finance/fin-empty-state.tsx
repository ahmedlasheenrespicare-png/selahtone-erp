/* حالة فارغة موحّدة لصفحات المالية — الأيقونة والإطار والصيغة الواحدة لكل الوحدة،
   مع ممر للمحتوى الحر (أزرار/تفصيل) داخل البطاقة وخصائص توضيع للحالات الخاصة. */
import type { CSSProperties, ReactNode } from "react";
import { AppIcon, type AppIconName } from "@/components/app-icon";

export function FinEmptyState({
  icon = "expenses",
  title,
  children,
  className,
  style,
}: {
  icon?: AppIconName;
  title: ReactNode;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={`fin-panel fin-empty fin-empty-state${className ? ` ${className}` : ""}`} style={style}>
      <span className="fin-empty-state__icon" aria-hidden="true">
        <AppIcon name={icon} />
      </span>
      <h2>{title}</h2>
      {children}
    </div>
  );
}
