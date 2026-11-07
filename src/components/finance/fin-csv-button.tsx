/* زر تصدير CSV موحّد تستخدمه صفحات الخادم في وحدة المالية — يمرّر إلى downloadCsvFile
   (الذي يتصدى تلقائيًا لحقن معادلات الجداول) ويُعطّل نفسه عند غياب أي سجل قابل للتصدير. */
"use client";

import { AppIcon } from "@/components/app-icon";
import { downloadCsvFile } from "@/lib/csv-export";

export function FinCsvButton({
  filename,
  headers,
  rows,
  label = "تصدير CSV",
  className,
}: {
  filename: string;
  headers: readonly string[];
  rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>;
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`fin-button fin-button--secondary no-print${className ? ` ${className}` : ""}`}
      onClick={() => downloadCsvFile(filename, headers, rows)}
      disabled={rows.length === 0}
    >
      <AppIcon name="download" />
      <span>{label} ({rows.length})</span>
    </button>
  );
}
