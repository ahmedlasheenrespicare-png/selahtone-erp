/**
 * نموذج نقي لجدول السجلات الموحّد: فرز بالنقر على رأس العمود + ترقيم صفحات.
 * لا يقرأ بيانات ولا يعرف شيئًا عن المالية/المبيعات، ولا يغيّر أي مبلغ أو صلاحية.
 * كل الفرز يجري على قيم خام (قرش/تاريخ/نص) لا على النصوص المنسّقة المعروضة.
 */

export type DataTableSortDirection = "asc" | "desc";

export type DataTableSort = { key: string; direction: DataTableSortDirection } | null;

/** نوع القيمة الخام المستخدمة في المقارنة. "cents" يقارن BigInt بلا فقدان دقة. */
export type DataTableValueKind = "text" | "number" | "cents" | "date";

export type DataTableSortValue = string | number | bigint | null | undefined;

export type DataTableSortColumn = {
  key: string;
  kind?: DataTableValueKind;
  sortValue?: (row: never) => DataTableSortValue;
};

export type DataTableRange = {
  /** الصفحة الفعلية بعد التقييد بحدود النتائج. */
  page: number;
  pageCount: number;
  total: number;
  /** أول صف معروض (1-based)، وصفر عند غياب النتائج. */
  from: number;
  to: number;
};

/**
 * دورة النقر على رأس العمود: بلا فرز ← الاتجاه المبدئي ← الاتجاه المعاكس ← بلا فرز.
 * العودة إلى «بلا فرز» تُعيد ترتيب الخادم الأصلي كما هو.
 */
export function nextDataTableSort(
  current: DataTableSort,
  key: string,
  initialDirection: DataTableSortDirection = "asc",
): DataTableSort {
  if (!current || current.key !== key) return { key, direction: initialDirection };
  if (current.direction === initialDirection) {
    return { key, direction: initialDirection === "asc" ? "desc" : "asc" };
  }
  return null;
}

export function dataTableAriaSort(
  sort: DataTableSort,
  key: string,
): "ascending" | "descending" | "none" {
  if (!sort || sort.key !== key) return "none";
  return sort.direction === "asc" ? "ascending" : "descending";
}

function isEmptyValue(value: DataTableSortValue): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

/** القيم الفارغة أو غير الصالحة تُعامل كـ null وتأتي في الآخر دائمًا. */
function normalizeValue(value: DataTableSortValue, kind: DataTableValueKind): number | bigint | string | null {
  if (isEmptyValue(value)) return null;
  if (kind === "cents") {
    if (typeof value === "bigint") return value;
    const raw = String(value).trim();
    if (!/^-?\d+$/.test(raw)) return null;
    try {
      return BigInt(raw);
    } catch {
      return null;
    }
  }
  if (kind === "number") {
    const num = typeof value === "number" ? value : Number(String(value).trim());
    return Number.isFinite(num) ? num : null;
  }
  if (kind === "date") {
    const ms = typeof value === "number" ? value : Date.parse(String(value).trim());
    return Number.isFinite(ms) ? ms : null;
  }
  return String(value);
}

export function compareDataTableValues(
  a: DataTableSortValue,
  b: DataTableSortValue,
  kind: DataTableValueKind = "text",
): number {
  const left = normalizeValue(a, kind);
  const right = normalizeValue(b, kind);
  // الفراغ يأتي بعد القيم الحقيقية في الاتجاهين، فلا يتصدّر سجلٌ ناقص.
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  if (typeof left === "string" || typeof right === "string") {
    return String(left).localeCompare(String(right), "ar", { numeric: true, sensitivity: "base" });
  }
  if (typeof left === "bigint" || typeof right === "bigint") {
    const l = BigInt(left as bigint | number);
    const r = BigInt(right as bigint | number);
    return l === r ? 0 : l < r ? -1 : 1;
  }
  return left === right ? 0 : left < right ? -1 : 1;
}

/**
 * فرز مستقر: القيم المتساوية تحافظ على ترتيب الخادم الأصلي في الاتجاهين.
 * يمرّر بلا فرز نفس المصفوفة كما هي (بلا نسخة) لتفادي عمل زائد.
 */
export function sortDataTableRows<T>(
  rows: readonly T[],
  sort: DataTableSort,
  columns: ReadonlyArray<{
    key: string;
    kind?: DataTableValueKind;
    sortValue?: (row: T) => DataTableSortValue;
  }>,
): readonly T[] {
  if (!sort) return rows;
  const column = columns.find((item) => item.key === sort.key);
  if (!column?.sortValue) return rows;
  const kind = column.kind ?? "text";
  const readValue = column.sortValue;
  const factor = sort.direction === "asc" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, value: readValue(row) }))
    .sort((a, b) => {
      const emptyA = isEmptyValue(a.value);
      const emptyB = isEmptyValue(b.value);
      if (emptyA !== emptyB) return emptyA ? 1 : -1;
      const cmp = compareDataTableValues(a.value, b.value, kind);
      return cmp !== 0 ? cmp * factor : a.index - b.index;
    })
    .map((entry) => entry.row);
}

/** pageSize صفر أو أقل = كل النتائج في صفحة واحدة (مفيد قبل الطباعة). */
export function dataTableRange(total: number, page: number, pageSize: number): DataTableRange {
  const safeTotal = Number.isSafeInteger(total) && total > 0 ? total : 0;
  const size = Number.isSafeInteger(pageSize) && pageSize > 0 ? pageSize : safeTotal || 1;
  const pageCount = Math.max(1, Math.ceil(safeTotal / size));
  const safePage = Number.isSafeInteger(page) ? Math.min(Math.max(1, page), pageCount) : 1;
  if (safeTotal === 0) return { page: 1, pageCount: 1, total: 0, from: 0, to: 0 };
  const from = (safePage - 1) * size + 1;
  const to = Math.min(safeTotal, safePage * size);
  return { page: safePage, pageCount, total: safeTotal, from, to };
}

export function paginateDataTableRows<T>(
  rows: readonly T[],
  page: number,
  pageSize: number,
): { pageRows: readonly T[]; range: DataTableRange } {
  const range = dataTableRange(rows.length, page, pageSize);
  if (rows.length === 0) return { pageRows: [], range };
  const size = Number.isSafeInteger(pageSize) && pageSize > 0 ? pageSize : rows.length;
  const start = (range.page - 1) * size;
  return { pageRows: rows.slice(start, start + size), range };
}
