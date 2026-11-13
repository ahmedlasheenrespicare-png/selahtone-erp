import Link from "next/link";
import type { DataColumn } from "@/components/data-driven/data-table";
import type { DataCsvColumn, DataFilterTab, DataSelectOption } from "@/lib/data-driven-ui";
export type CategoryDirectoryItem = {
  id: string;
  code: string;
  name: string;
  active: boolean;
  revision: number;
  snapshot: string;
  shortCode: string;
  monthPaidNum: number;
  monthPaidFormatted: string;
  monthPendingNum: number;
  monthPendingFormatted: string;
  prevMonthPaidNum: number;
  prevMonthPaidFormatted: string;
  momDeltaLabel: string;
  momTone: "up" | "down" | "flat";
  sharePct: number;
  allTimePaidNum: number;
  allTimePaidFormatted: string;
  allTimeTotalFormatted: string;
  totalCount: number;
  paidCount: number;
  pendingCount: number;
  lastExpenseDate: string | null;
  createdByName: string | null;
  updatedByName: string | null;
};

export type CategoryAuditItem = {
  id: string;
  categoryId: string;
  categoryName: string;
  shortCode: string;
  actionKind: "CREATE" | "RENAME" | "DEACTIVATE" | "REACTIVATE";
  actionLabel: string;
  diffSummary: string;
  reasonText: string;
  actorName: string;
  timestampFormatted: string;
  dateKey: string;
};

export type CategoryFilter = "all" | "active" | "inactive" | "month_spend" | "unused";
export type CategorySort = "month_desc" | "total_desc" | "name_asc" | "revision_desc" | "recent_use";
export type AuditFilter = "all" | "CREATE" | "RENAME" | "STATUS";

export const categoryFilters: Array<DataFilterTab<CategoryDirectoryItem, CategoryFilter>> = [
  { id: "all", label: "الكل", matches: () => true },
  { id: "active", label: "نشط", matches: (item) => item.active },
  { id: "inactive", label: "موقوف", matches: (item) => !item.active },
  { id: "month_spend", label: "ذات حركة بالشهر", matches: (item) => item.monthPaidNum > 0 || item.monthPendingNum > 0 },
  { id: "unused", label: "غير مستخدمة", matches: (item) => item.totalCount === 0 },
];

export const categorySortOptions: Array<DataSelectOption<CategorySort>> = [
  { value: "month_desc", label: "الترتيب: الأعلى مدفوعًا بالشهر" },
  { value: "total_desc", label: "الترتيب: الأعلى إجماليًا بالسجل" },
  { value: "name_asc", label: "الترتيب: الأبجدية (أ — ي)" },
  { value: "recent_use", label: "الترتيب: الأحدث استخدامًا" },
  { value: "revision_desc", label: "الترتيب: الأكثر تعديلًا (الإصدار)" },
];

export const categoryAuditFilters: Array<DataFilterTab<CategoryAuditItem, AuditFilter>> = [
  { id: "all", label: "الكل", matches: () => true },
  { id: "CREATE", label: "إضافة بند", matches: (item) => item.actionKind === "CREATE" },
  { id: "RENAME", label: "تعديل مسمى", matches: (item) => item.actionKind === "RENAME" },
  { id: "STATUS", label: "إيقاف / تفعيل", matches: (item) => item.actionKind === "DEACTIVATE" || item.actionKind === "REACTIVATE" },
];

export const categoryDirectorySearch = {
  placeholder: "ابحث باسم البند أو الرمز المحاسبي…",
  text: (item: CategoryDirectoryItem): readonly string[] => [[
    item.name, item.code, item.shortCode, item.createdByName ?? "", item.updatedByName ?? "",
  ].join(" ")],
};

export const categoryAuditSearch = {
  placeholder: "ابحث باسم البند أو السبب أو المنفِّذ…",
  text: (item: CategoryAuditItem): readonly string[] => [[
    item.id, item.categoryName, item.shortCode, item.actionLabel, item.diffSummary,
    item.reasonText, item.actorName, item.dateKey,
  ].join(" ")],
};

export function sortCategoryDirectory(items: CategoryDirectoryItem[], sortBy: CategorySort): CategoryDirectoryItem[] {
  return items.sort((a, b) => {
    if (sortBy === "month_desc") {
      const diff = b.monthPaidNum - a.monthPaidNum;
      if (Math.abs(diff) > 0.001) return diff;
      const pendingDiff = b.monthPendingNum - a.monthPendingNum;
      if (Math.abs(pendingDiff) > 0.001) return pendingDiff;
      return b.allTimePaidNum - a.allTimePaidNum;
    }
    if (sortBy === "total_desc") {
      const diff = b.allTimePaidNum - a.allTimePaidNum;
      if (Math.abs(diff) > 0.001) return diff;
      return b.totalCount - a.totalCount;
    }
    if (sortBy === "revision_desc") {
      if (b.revision !== a.revision) return b.revision - a.revision;
      return a.name.localeCompare(b.name, "ar");
    }
    if (sortBy === "recent_use") {
      const dateA = a.lastExpenseDate ?? "";
      const dateB = b.lastExpenseDate ?? "";
      if (dateA !== dateB) return dateB.localeCompare(dateA);
      return a.name.localeCompare(b.name, "ar");
    }
    return a.name.localeCompare(b.name, "ar");
  });
}

export function createCategoryCsvColumns(currentMonthLabel: string, prevMonthLabel: string): DataCsvColumn<CategoryDirectoryItem>[] {
  return [
    { header: "اسم البند", value: (item) => item.name },
    { header: "الرمز المحاسبي", value: (item) => item.code },
    { header: "الحالة", value: (item) => item.active ? "نشط" : "موقوف" },
    { header: "الإصدار", value: (item) => String(item.revision) },
    { header: `المدفوع فعليًا (${currentMonthLabel})`, value: (item) => item.monthPaidFormatted },
    { header: `تحت الإجراء (${currentMonthLabel})`, value: (item) => item.monthPendingFormatted },
    { header: `المدفوع بالشهر السابق (${prevMonthLabel})`, value: (item) => item.prevMonthPaidFormatted },
    { header: "التغيّر الشهري", value: (item) => item.momDeltaLabel },
    { header: "الحصة من مدفوعات الشهر (%)", value: (item) => `${item.sharePct}%` },
    { header: "إجمالي المدفوع بالسجل", value: (item) => item.allTimePaidFormatted },
    { header: "إجمالي العمليات", value: (item) => String(item.totalCount) },
    { header: "آخر استخدام", value: (item) => item.lastExpenseDate ?? "لم يُستخدم" },
  ];
}

export const categoryAuditCsvColumns: DataCsvColumn<CategoryAuditItem>[] = [
  { header: "رقم القيد", value: (item) => `#${item.id}` },
  { header: "البند", value: (item) => item.categoryName },
  { header: "الرمز المختصر", value: (item) => item.shortCode },
  { header: "نوع الإجراء", value: (item) => item.actionLabel },
  { header: "التفاصيل (قبل ← بعد)", value: (item) => item.diffSummary },
  { header: "سبب التعديل", value: (item) => item.reasonText },
  { header: "المنفِّذ", value: (item) => item.actorName },
  { header: "التاريخ والوقت", value: (item) => item.timestampFormatted },
];

type CategoryColumnOptions = {
  currentMonthLabel: string;
  prevMonthLabel: string;
  editingId: string | null;
  copiedId: string | null;
  canEdit: boolean;
  canCreateExpense: boolean;
  canOpenExpenses: boolean;
  onCopyCode: (item: CategoryDirectoryItem) => void;
  onToggleEdit: (id: string) => void;
  onOpenAudit: (name: string) => void;
};

export function createCategoryDirectoryColumns(options: CategoryColumnOptions): DataColumn<CategoryDirectoryItem>[] {
  return [
    {
      id: "category", header: "البند والرمز", renderCell: (item) => (
        <div className="fin-cat-identity">
          <strong>{item.name}</strong>
          <div className="fin-cat-code-line">
            <button type="button" className="fin-cat-code-btn" title={`نسخ الرمز الكامل: ${item.code}`} onClick={() => options.onCopyCode(item)}>
              <bdi dir="ltr">{item.shortCode}</bdi>
              <span className="fin-cat-code-btn__hint no-print">{options.copiedId === item.id ? "نُسخ ✓" : "نسخ"}</span>
            </button>
          </div>
        </div>
      ),
    },
    {
      id: "month", header: `المدفوع الفعلي (${options.currentMonthLabel})`, renderCell: (item) => (
        <div className="fin-cat-spend">
          <div className="fin-cat-spend__line">
            <strong className="fin-money"><bdi dir="ltr">{item.monthPaidFormatted}</bdi> ج.م</strong>
            {item.sharePct > 0 ? <span className="fin-cat-share-pct">{item.sharePct}%</span> : null}
          </div>
          {item.monthPaidNum > 0 ? <div className="fin-cat-share-bar" aria-label={`حصة البند ${item.sharePct}%`}><span style={{ width: `${Math.max(item.sharePct, 4)}%` }} /></div> : null}
          {item.monthPendingNum > 0 ? <small className="fin-cat-pending-note">+ <bdi dir="ltr">{item.monthPendingFormatted}</bdi> ج.م تحت الإجراء ({item.pendingCount})</small> : null}
        </div>
      ),
    },
    {
      id: "comparison", header: "مقارنة بالشهر السابق", renderCell: (item) => (
        <div className="fin-cat-mom">
          <span className={`fin-cat-mom-pill fin-cat-mom-pill--${item.momTone}`}>{item.momDeltaLabel}</span>
          <small className="fin-field__hint" style={{ display: "block", marginTop: 3 }}>{options.prevMonthLabel}: <bdi dir="ltr">{item.prevMonthPaidFormatted}</bdi> ج.م</small>
        </div>
      ),
    },
    {
      id: "total", header: "إجمالي السجل وآخر استخدام", renderCell: (item) => (
        <><span className="fin-money"><bdi dir="ltr">{item.allTimePaidFormatted}</bdi> ج.م</span>
          <small className="fin-field__hint" style={{ display: "block" }}>{item.totalCount > 0 ? <>{item.totalCount} عملية · آخر استخدام: <bdi dir="ltr">{item.lastExpenseDate ?? "—"}</bdi></> : "لم يُستخدم في أي مصروف بعد"}</small></>
      ),
    },
    {
      id: "status", header: "الحالة والإصدار", renderCell: (item) => (
        <div className="fin-cat-status-stack">
          <span className={`fin-badge ${item.active ? "fin-badge--active" : "fin-badge--closed"}`}>{item.active ? "نشط" : "موقوف"}</span>
          <button type="button" className="fin-cat-rev-btn no-print" onClick={() => options.onOpenAudit(item.name)} title="عرض سجل تعديلات هذا البند">إصدار #{item.revision}</button>
        </div>
      ),
    },
    {
      id: "actions", header: "إجراءات", headerClassName: "no-print", cellClassName: "no-print", renderCell: (item) => {
        const isEditing = options.editingId === item.id;
        return <div className="fin-cat-actions">
          {options.canEdit ? <button type="button" className={`fin-voucher-print-btn${isEditing ? " is-active" : ""}`} onClick={() => options.onToggleEdit(item.id)}><span>{isEditing ? "إغلاق التحرير" : "تعديل"}</span></button> : null}
          {item.active && options.canCreateExpense ? <Link className="fin-voucher-print-btn" href={`/finance/expenses/new?categoryId=${encodeURIComponent(item.id)}`} title={`تسجيل مصروف جديد على بند ${item.name}`}><span>+ مصروف</span></Link> : null}
          {item.totalCount > 0 && options.canOpenExpenses ? <Link className="fin-button fin-button--text" href={`/finance/expenses?category=${encodeURIComponent(item.name)}`}>المصروفات ({item.totalCount})</Link> : null}
        </div>;
      },
    },
  ];
}

function auditBadgeClass(kind: CategoryAuditItem["actionKind"]): string {
  if (kind === "CREATE") return "fin-badge fin-badge--active";
  if (kind === "DEACTIVATE") return "fin-badge fin-badge--closed";
  if (kind === "REACTIVATE") return "fin-badge fin-badge--approved";
  return "fin-badge fin-badge--vault";
}

export const categoryAuditColumns: DataColumn<CategoryAuditItem>[] = [
  { id: "audit", header: "قيد #", renderCell: (item) => <span className="fin-code-pill">#{item.id}</span> },
  { id: "category", header: "البند", renderCell: (item) => <><strong>{item.categoryName}</strong><small className="fin-field__hint" style={{ display: "block" }}><bdi dir="ltr">{item.shortCode}</bdi></small></> },
  { id: "action", header: "نوع الإجراء", renderCell: (item) => <span className={auditBadgeClass(item.actionKind)}>{item.actionLabel}</span> },
  { id: "difference", header: "التغيير (قبل ← بعد)", renderCell: (item) => item.diffSummary },
  { id: "reason", header: "السبب الموثّق", renderCell: (item) => item.reasonText },
  { id: "actor", header: "المنفِّذ", renderCell: (item) => item.actorName },
  { id: "timestamp", header: "التاريخ والوقت", renderCell: (item) => <bdi dir="ltr">{item.timestampFormatted}</bdi> },
];
