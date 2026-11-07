"use client";

import Link from "next/link";
import { Fragment, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { AppIcon } from "@/components/app-icon";
import { downloadCsvFile } from "@/lib/csv-export";
import { EditCategoryForm, type CategoryOption } from "./category-forms";

export type CategoryDirectoryItem = CategoryOption & {
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

type ActiveTab = "directory" | "audit";
type CategoryFilter = "all" | "active" | "inactive" | "month_spend" | "unused";
type CategorySort =
  | "month_desc"
  | "total_desc"
  | "name_asc"
  | "revision_desc"
  | "recent_use";
type AuditFilter = "all" | "CREATE" | "RENAME" | "STATUS";

type Props = {
  categories: CategoryDirectoryItem[];
  auditRows: CategoryAuditItem[];
  currentMonthLabel: string;
  prevMonthLabel: string;
  seedRequestId: string;
};

export default function CategoriesDirectoryView({
  categories,
  auditRows,
  currentMonthLabel,
  prevMonthLabel,
  seedRequestId,
}: Props) {
  const [tab, setTab] = useState<ActiveTab>("directory");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<CategoryFilter>("all");
  const [sortBy, setSortBy] = useState<CategorySort>("month_desc");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [auditQuery, setAuditQuery] = useState("");
  const [auditFilter, setAuditFilter] = useState<AuditFilter>("all");

  const existingNames = useMemo(
    () => categories.map((c) => c.name),
    [categories],
  );

  const counts = useMemo(() => {
    let active = 0;
    let inactive = 0;
    let monthSpend = 0;
    let unused = 0;
    for (const c of categories) {
      if (c.active) active += 1;
      else inactive += 1;
      if (c.monthPaidNum > 0 || c.monthPendingNum > 0) monthSpend += 1;
      if (c.totalCount === 0) unused += 1;
    }
    return {
      all: categories.length,
      active,
      inactive,
      monthSpend,
      unused,
    };
  }, [categories]);

  const filteredCategories = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = categories.filter((c) => {
      if (filter === "active" && !c.active) return false;
      if (filter === "inactive" && c.active) return false;
      if (
        filter === "month_spend" &&
        c.monthPaidNum <= 0 &&
        c.monthPendingNum <= 0
      ) {
        return false;
      }
      if (filter === "unused" && c.totalCount > 0) return false;
      if (q) {
        const hay = `${c.name} ${c.code} ${c.shortCode} ${c.createdByName ?? ""} ${c.updatedByName ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    list.sort((a, b) => {
      if (sortBy === "month_desc") {
        const diff = b.monthPaidNum - a.monthPaidNum;
        if (Math.abs(diff) > 0.001) return diff;
        const pendDiff = b.monthPendingNum - a.monthPendingNum;
        if (Math.abs(pendDiff) > 0.001) return pendDiff;
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
        const da = a.lastExpenseDate ?? "";
        const db = b.lastExpenseDate ?? "";
        if (da !== db) return db.localeCompare(da);
        return a.name.localeCompare(b.name, "ar");
      }
      return a.name.localeCompare(b.name, "ar");
    });

    return list;
  }, [categories, query, filter, sortBy]);

  const auditCounts = useMemo(() => {
    let create = 0;
    let rename = 0;
    let status = 0;
    for (const r of auditRows) {
      if (r.actionKind === "CREATE") create += 1;
      else if (r.actionKind === "RENAME") rename += 1;
      else status += 1;
    }
    return { all: auditRows.length, create, rename, status };
  }, [auditRows]);

  const filteredAudit = useMemo(() => {
    const q = auditQuery.trim().toLowerCase();
    return auditRows.filter((r) => {
      if (auditFilter === "CREATE" && r.actionKind !== "CREATE") return false;
      if (auditFilter === "RENAME" && r.actionKind !== "RENAME") return false;
      if (
        auditFilter === "STATUS" &&
        r.actionKind !== "DEACTIVATE" &&
        r.actionKind !== "REACTIVATE"
      ) {
        return false;
      }
      if (q) {
        const hay = `${r.id} ${r.categoryName} ${r.shortCode} ${r.actionLabel} ${r.diffSummary} ${r.reasonText} ${r.actorName} ${r.dateKey}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [auditRows, auditQuery, auditFilter]);

  function handleCopyCode(cat: CategoryDirectoryItem) {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(cat.code).catch(() => {});
      setCopiedId(cat.id);
      setTimeout(() => {
        setCopiedId((prev) => (prev === cat.id ? null : prev));
      }, 1800);
    }
  }

  function jumpToCategoryAudit(categoryName: string) {
    setTab("audit");
    setAuditFilter("all");
    setAuditQuery(categoryName);
  }

  function handleMainTabKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    // قائمة RTL: الأيسر للتالي والأيمن للسابق (ترتيب القراءة العربية).
    const delta = event.key === "ArrowLeft" ? 1 : event.key === "ArrowRight" ? -1 : 0;
    if (delta === 0) return;
    event.preventDefault();
    const next = tab === "directory" ? "audit" : "directory";
    setTab(next);
    document.getElementById(`fin-cat-tab-${next}`)?.focus();
  }

  function handleExportCategoriesCsv() {
    downloadCsvFile(
      `selahtone-expense-categories-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        "اسم البند",
        "الرمز المحاسبي",
        "الحالة",
        "الإصدار",
        `المدفوع فعليًا (${currentMonthLabel})`,
        `تحت الإجراء (${currentMonthLabel})`,
        `المدفوع بالشهر السابق (${prevMonthLabel})`,
        "التغيّر الشهري",
        "الحصة من مدفوعات الشهر (%)",
        "إجمالي المدفوع بالسجل",
        "إجمالي العمليات",
        "آخر استخدام",
      ],
      filteredCategories.map((c) => [
        c.name,
        c.code,
        c.active ? "نشط" : "موقوف",
        String(c.revision),
        c.monthPaidFormatted,
        c.monthPendingFormatted,
        c.prevMonthPaidFormatted,
        c.momDeltaLabel,
        `${c.sharePct}%`,
        c.allTimePaidFormatted,
        String(c.totalCount),
        c.lastExpenseDate ?? "لم يُستخدم",
      ]),
    );
  }

  function handleExportAuditCsv() {
    downloadCsvFile(
      `selahtone-category-audit-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        "رقم القيد",
        "البند",
        "الرمز المختصر",
        "نوع الإجراء",
        "التفاصيل (قبل ← بعد)",
        "سبب التعديل",
        "المنفِّذ",
        "التاريخ والوقت",
      ],
      filteredAudit.map((r) => [
        `#${r.id}`,
        r.categoryName,
        r.shortCode,
        r.actionLabel,
        r.diffSummary,
        r.reasonText,
        r.actorName,
        r.timestampFormatted,
      ]),
    );
  }

  function auditBadgeClass(kind: CategoryAuditItem["actionKind"]): string {
    if (kind === "CREATE") return "fin-badge fin-badge--active";
    if (kind === "DEACTIVATE") return "fin-badge fin-badge--closed";
    if (kind === "REACTIVATE") return "fin-badge fin-badge--approved";
    return "fin-badge fin-badge--vault";
  }

  return (
    <section id="categories-directory" aria-label="دليل البنود وسجل التدقيق">
      <div className="fin-toolbar no-print">
        <div className="fin-toolbar__row">
          <div className="fin-filter-pills" role="tablist" aria-label="عرض البنود أو سجل التعديلات" onKeyDown={handleMainTabKeyDown}>
            <button
              type="button"
              role="tab"
              id="fin-cat-tab-directory"
              aria-controls="fin-cat-directory-panel"
              tabIndex={tab === "directory" ? 0 : -1}
              aria-selected={tab === "directory"}
              className={`fin-filter-pill${tab === "directory" ? " is-active" : ""}`}
              onClick={() => setTab("directory")}
            >
              <span>دليل البنود والإنفاق</span>
              <span className="fin-filter-pill__count">{categories.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              id="fin-cat-tab-audit"
              aria-controls="fin-cat-audit-panel"
              tabIndex={tab === "audit" ? 0 : -1}
              aria-selected={tab === "audit"}
              className={`fin-filter-pill${tab === "audit" ? " is-active" : ""}`}
              onClick={() => setTab("audit")}
            >
              <span>سجل تعديلات البنود</span>
              <span className="fin-filter-pill__count">{auditRows.length}</span>
            </button>
          </div>
        </div>

        {tab === "directory" ? (
          <>
            <div className="fin-toolbar__row">
              <div className="fin-search-box">
                <svg
                  className="fin-search-box__icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <circle cx="11" cy="11" r="7" />
                  <line x1="20" y1="20" x2="16.3" y2="16.3" />
                </svg>
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="ابحث باسم البند أو الرمز المحاسبي…"
                  aria-label="بحث في بنود المصروفات"
                />
                {query ? (
                  <button
                    type="button"
                    className="fin-search-box__clear"
                    onClick={() => setQuery("")}
                    aria-label="مسح البحث"
                  >
                    <AppIcon name="close" />
                  </button>
                ) : null}
              </div>

              <select
                className="fin-branch-select"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as CategorySort)}
                aria-label="ترتيب البنود"
              >
                <option value="month_desc">الترتيب: الأعلى مدفوعًا بالشهر</option>
                <option value="total_desc">الترتيب: الأعلى إجماليًا بالسجل</option>
                <option value="name_asc">الترتيب: الأبجدية (أ — ي)</option>
                <option value="recent_use">الترتيب: الأحدث استخدامًا</option>
                <option value="revision_desc">الترتيب: الأكثر تعديلًا (الإصدار)</option>
              </select>

              <button
                type="button"
                className="fin-button fin-button--secondary"
                onClick={handleExportCategoriesCsv}
                disabled={filteredCategories.length === 0}
              >
                <AppIcon name="download" />
                <span>تصدير CSV ({filteredCategories.length})</span>
              </button>
            </div>

            <div className="fin-toolbar__row">
              <div className="fin-filter-pills" role="group" aria-label="تصفية البنود">
                <button
                  type="button"
                  aria-pressed={filter === "all"}
                  className={`fin-filter-pill${filter === "all" ? " is-active" : ""}`}
                  onClick={() => setFilter("all")}
                >
                  <span>الكل</span>
                  <span className="fin-filter-pill__count">{counts.all}</span>
                </button>
                <button
                  type="button"
                  aria-pressed={filter === "active"}
                  className={`fin-filter-pill${filter === "active" ? " is-active" : ""}`}
                  onClick={() => setFilter("active")}
                >
                  <span>نشط</span>
                  <span className="fin-filter-pill__count">{counts.active}</span>
                </button>
                <button
                  type="button"
                  aria-pressed={filter === "inactive"}
                  className={`fin-filter-pill${filter === "inactive" ? " is-active" : ""}`}
                  onClick={() => setFilter("inactive")}
                >
                  <span>موقوف</span>
                  <span className="fin-filter-pill__count">{counts.inactive}</span>
                </button>
                <button
                  type="button"
                  aria-pressed={filter === "month_spend"}
                  className={`fin-filter-pill${filter === "month_spend" ? " is-active" : ""}`}
                  onClick={() => setFilter("month_spend")}
                >
                  <span>ذات حركة بالشهر</span>
                  <span className="fin-filter-pill__count">{counts.monthSpend}</span>
                </button>
                <button
                  type="button"
                  aria-pressed={filter === "unused"}
                  className={`fin-filter-pill${filter === "unused" ? " is-active" : ""}`}
                  onClick={() => setFilter("unused")}
                >
                  <span>غير مستخدمة</span>
                  <span className="fin-filter-pill__count">{counts.unused}</span>
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="fin-toolbar__row">
              <div className="fin-search-box">
                <svg
                  className="fin-search-box__icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <circle cx="11" cy="11" r="7" />
                  <line x1="20" y1="20" x2="16.3" y2="16.3" />
                </svg>
                <input
                  type="search"
                  value={auditQuery}
                  onChange={(e) => setAuditQuery(e.target.value)}
                  placeholder="ابحث باسم البند أو السبب أو المنفِّذ…"
                  aria-label="بحث في سجل تعديلات البنود"
                />
                {auditQuery ? (
                  <button
                    type="button"
                    className="fin-search-box__clear"
                    onClick={() => setAuditQuery("")}
                    aria-label="مسح البحث"
                  >
                    <AppIcon name="close" />
                  </button>
                ) : null}
              </div>

              <button
                type="button"
                className="fin-button fin-button--secondary"
                onClick={handleExportAuditCsv}
                disabled={filteredAudit.length === 0}
              >
                <AppIcon name="download" />
                <span>تصدير سجل التدقيق CSV ({filteredAudit.length})</span>
              </button>
            </div>

            <div className="fin-toolbar__row">
              <div className="fin-filter-pills" role="group" aria-label="نوع التعديل">
                <button
                  type="button"
                  aria-pressed={auditFilter === "all"}
                  className={`fin-filter-pill${auditFilter === "all" ? " is-active" : ""}`}
                  onClick={() => setAuditFilter("all")}
                >
                  <span>الكل</span>
                  <span className="fin-filter-pill__count">{auditCounts.all}</span>
                </button>
                <button
                  type="button"
                  aria-pressed={auditFilter === "CREATE"}
                  className={`fin-filter-pill${auditFilter === "CREATE" ? " is-active" : ""}`}
                  onClick={() => setAuditFilter("CREATE")}
                >
                  <span>إضافة بند</span>
                  <span className="fin-filter-pill__count">{auditCounts.create}</span>
                </button>
                <button
                  type="button"
                  aria-pressed={auditFilter === "RENAME"}
                  className={`fin-filter-pill${auditFilter === "RENAME" ? " is-active" : ""}`}
                  onClick={() => setAuditFilter("RENAME")}
                >
                  <span>تعديل مسمى</span>
                  <span className="fin-filter-pill__count">{auditCounts.rename}</span>
                </button>
                <button
                  type="button"
                  aria-pressed={auditFilter === "STATUS"}
                  className={`fin-filter-pill${auditFilter === "STATUS" ? " is-active" : ""}`}
                  onClick={() => setAuditFilter("STATUS")}
                >
                  <span>إيقاف / تفعيل</span>
                  <span className="fin-filter-pill__count">{auditCounts.status}</span>
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {tab === "directory" ? (
        <div className="fin-panel" role="tabpanel" id="fin-cat-directory-panel" aria-labelledby="fin-cat-tab-directory">
          <div className="fin-panel__heading">
            <h2>دليل البنود وتحليل الإنفاق الفعلي ({currentMonthLabel})</h2>
            <p>
              يُحتسب «المدفوع فعليًا» من المصروفات المصروفة (`PAID`) فقط، ويُعرض المعلّق تحت الإجراء منفصلًا دون خلط محاسبي.
            </p>
          </div>

          {filteredCategories.length === 0 ? (
            <div className="fin-empty">
              لا توجد بنود تطابق معايير البحث أو التصفية المحددة حاليًا.
            </div>
          ) : (
            <div className="fin-table-wrap">
              <table className="fin-table">
                <caption>دليل البنود ومدفوعات الشهر مع مقارنة الشهر السابق</caption>
                <thead>
                  <tr>
                    <th scope="col">البند والرمز</th>
                    <th scope="col">المدفوع الفعلي ({currentMonthLabel})</th>
                    <th scope="col">مقارنة بالشهر السابق</th>
                    <th scope="col">إجمالي السجل وآخر استخدام</th>
                    <th scope="col">الحالة والإصدار</th>
                    <th scope="col" className="no-print">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCategories.map((cat) => {
                    const isEditing = editingId === cat.id;
                    return (
                      <Fragment key={cat.id}>
                        <tr className={isEditing ? "fin-cat-row--editing" : undefined}>
                          <td>
                            <div className="fin-cat-identity">
                              <strong>{cat.name}</strong>
                              <div className="fin-cat-code-line">
                                <button
                                  type="button"
                                  className="fin-cat-code-btn"
                                  title={`نسخ الرمز الكامل: ${cat.code}`}
                                  onClick={() => handleCopyCode(cat)}
                                >
                                  <bdi dir="ltr">{cat.shortCode}</bdi>
                                  <span className="fin-cat-code-btn__hint no-print">
                                    {copiedId === cat.id ? "نُسخ ✓" : "نسخ"}
                                  </span>
                                </button>
                              </div>
                            </div>
                          </td>

                          <td>
                            <div className="fin-cat-spend">
                              <div className="fin-cat-spend__line">
                                <strong className="fin-money">
                                  <bdi dir="ltr">{cat.monthPaidFormatted}</bdi> ج.م
                                </strong>
                                {cat.sharePct > 0 ? (
                                  <span className="fin-cat-share-pct">
                                    {cat.sharePct}%
                                  </span>
                                ) : null}
                              </div>
                              {cat.monthPaidNum > 0 ? (
                                <div
                                  className="fin-cat-share-bar"
                                  aria-label={`حصة البند ${cat.sharePct}%`}
                                >
                                  <span
                                    style={{
                                      width: `${Math.max(cat.sharePct, 4)}%`,
                                    }}
                                  />
                                </div>
                              ) : null}
                              {cat.monthPendingNum > 0 ? (
                                <small className="fin-cat-pending-note">
                                  + <bdi dir="ltr">{cat.monthPendingFormatted}</bdi> ج.م تحت الإجراء ({cat.pendingCount})
                                </small>
                              ) : null}
                            </div>
                          </td>

                          <td>
                            <div className="fin-cat-mom">
                              <span
                                className={`fin-cat-mom-pill fin-cat-mom-pill--${cat.momTone}`}
                              >
                                {cat.momDeltaLabel}
                              </span>
                              <small className="fin-field__hint" style={{ display: "block", marginTop: 3 }}>
                                {prevMonthLabel}: <bdi dir="ltr">{cat.prevMonthPaidFormatted}</bdi> ج.م
                              </small>
                            </div>
                          </td>

                          <td>
                            <span className="fin-money">
                              <bdi dir="ltr">{cat.allTimePaidFormatted}</bdi> ج.م
                            </span>
                            <small className="fin-field__hint" style={{ display: "block" }}>
                              {cat.totalCount > 0 ? (
                                <>
                                  {cat.totalCount} عملية · آخر استخدام:{" "}
                                  <bdi dir="ltr">{cat.lastExpenseDate ?? "—"}</bdi>
                                </>
                              ) : (
                                "لم يُستخدم في أي مصروف بعد"
                              )}
                            </small>
                          </td>

                          <td>
                            <div className="fin-cat-status-stack">
                              <span
                                className={`fin-badge ${
                                  cat.active ? "fin-badge--active" : "fin-badge--closed"
                                }`}
                              >
                                {cat.active ? "نشط" : "موقوف"}
                              </span>
                              <button
                                type="button"
                                className="fin-cat-rev-btn no-print"
                                onClick={() => jumpToCategoryAudit(cat.name)}
                                title="عرض سجل تعديلات هذا البند"
                              >
                                إصدار #{cat.revision}
                              </button>
                            </div>
                          </td>

                          <td className="no-print">
                            <div className="fin-cat-actions">
                              <button
                                type="button"
                                className={`fin-voucher-print-btn${
                                  isEditing ? " is-active" : ""
                                }`}
                                onClick={() =>
                                  setEditingId((prev) =>
                                    prev === cat.id ? null : cat.id,
                                  )
                                }
                              >
                                <span>{isEditing ? "إغلاق التحرير" : "تعديل"}</span>
                              </button>

                              {cat.active ? (
                                <Link
                                  className="fin-voucher-print-btn"
                                  href={`/finance/expenses/new?categoryId=${encodeURIComponent(cat.id)}`}
                                  title={`تسجيل مصروف جديد على بند ${cat.name}`}
                                >
                                  <span>+ مصروف</span>
                                </Link>
                              ) : null}

                              {cat.totalCount > 0 ? (
                                <Link
                                  className="fin-button fin-button--text"
                                  href={`/finance/expenses?category=${encodeURIComponent(cat.name)}`}
                                >
                                  المصروفات ({cat.totalCount})
                                </Link>
                              ) : null}
                            </div>
                          </td>
                        </tr>

                        {isEditing ? (
                          <tr className="fin-cat-edit-row no-print">
                            <td colSpan={6}>
                              <EditCategoryForm
                                requestId={seedRequestId}
                                category={cat}
                                existingNames={existingNames}
                                onCancel={() => setEditingId(null)}
                                onSaved={() => setEditingId(null)}
                              />
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="fin-panel" role="tabpanel" id="fin-cat-audit-panel" aria-labelledby="fin-cat-tab-audit">
          <div className="fin-panel__heading">
            <h2>سجل التدقيق وتعديلات بنود المصروفات</h2>
            <p>
              سجل رقابي غير قابل للحذف أو التعديل من جدول <code>finance.category_audit</code> يوثّق كل إنشاء أو تغيير مسمى أو إيقاف/تفعيل بسببه ومنفِّذه.
            </p>
          </div>

          {filteredAudit.length === 0 ? (
            <div className="fin-empty">
              {auditRows.length === 0
                ? "لا توجد تعديلات مسجّلة في سجل التدقيق بعد؛ سيُوثَّق هنا كل بند يُضاف أو يُعدَّل."
                : "لا توجد قيود تدقيق تطابق البحث أو التصفية الحالية."}
            </div>
          ) : (
            <div className="fin-table-wrap">
              <table className="fin-table">
                <caption>سجل تدقيق بنود المصروفات — إنشاء وتعديل مسمى وإيقاف وتفعيل</caption>
                <thead>
                  <tr>
                    <th scope="col">قيد #</th>
                    <th scope="col">البند</th>
                    <th scope="col">نوع الإجراء</th>
                    <th scope="col">التغيير (قبل ← بعد)</th>
                    <th scope="col">السبب الموثّق</th>
                    <th scope="col">المنفِّذ</th>
                    <th scope="col">التاريخ والوقت</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAudit.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <span className="fin-code-pill">#{row.id}</span>
                      </td>
                      <td>
                        <strong>{row.categoryName}</strong>
                        <small className="fin-field__hint" style={{ display: "block" }}>
                          <bdi dir="ltr">{row.shortCode}</bdi>
                        </small>
                      </td>
                      <td>
                        <span className={auditBadgeClass(row.actionKind)}>
                          {row.actionLabel}
                        </span>
                      </td>
                      <td>{row.diffSummary}</td>
                      <td>{row.reasonText}</td>
                      <td>{row.actorName}</td>
                      <td>
                        <bdi dir="ltr">{row.timestampFormatted}</bdi>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
