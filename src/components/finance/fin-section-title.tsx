/* ترويسة قسم موحّدة لوحدة المالية: سطر عيّنة + عنوان + فقرة وصف + ممر أيقونات جانبي.
   «as» يختار مستوى العنوان (h1 للصفحة، h2 للأقسام الفرعية). */
import type { ReactNode } from "react";

export function FinSectionTitle({
  eyebrow,
  title,
  description,
  actions,
  as = "h1",
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: string;
  actions?: ReactNode;
  as?: "h1" | "h2";
}) {
  const Heading = as;
  return (
    <div className="fin-heading">
      <div>
        {eyebrow ? (
          <p className="fin-heading__eyebrow">
            <span className="fin-eyebrow-dot" aria-hidden="true" />
            {eyebrow}
          </p>
        ) : null}
        <Heading>{title}</Heading>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="fin-actions">{actions}</div> : null}
    </div>
  );
}
