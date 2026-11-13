"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  dataTableRange,
  nextDataTableSort,
  paginateDataTableRows,
  sortDataTableRows,
  type DataTableSort,
  type DataTableSortDirection,
  type DataTableSortValue,
  type DataTableValueKind,
} from "./data-table-model";

/** نفس وصف العمود في ملفات الـMetadata: الفرز جزء من بيانات العمود لا من الماركأب. */
export type DataTableSortConfig<T> = {
  id: string;
  sortKind?: DataTableValueKind;
  sortValue?: (row: T) => DataTableSortValue;
  initialSortDirection?: DataTableSortDirection;
};

export type DataTableState<T> = {
  sort: DataTableSort;
  toggleSort: (key: string, initialDirection?: DataTableSortDirection) => void;
  /** كل النتائج بعد التصفية والفرز — وهي مصدر التصدير، لا الصفحة المعروضة وحدها. */
  sortedRows: readonly T[];
  pageRows: readonly T[];
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  from: number;
  to: number;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
};

/**
 * حالة الجدول: الفرز والترقيم في مكان واحد لكل الشاشات.
 * تغيير النتائج أو الفرز أو حجم الصفحة يعيد المستخدم إلى الصفحة الأولى.
 */
export function useDataTable<T>({
  rows,
  columns,
  initialSort = null,
  initialPageSize = 25,
  resetKey = "",
}: {
  rows: readonly T[];
  columns: ReadonlyArray<DataTableSortConfig<T>>;
  initialSort?: DataTableSort;
  initialPageSize?: number;
  /** بصمة فلاتر الشاشة (بحث/فترة/فرع/حالة). تغيّرها يعيد الصفحة الأولى. */
  resetKey?: string;
}): DataTableState<T> {
  const [sort, setSort] = useState<DataTableSort>(initialSort);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(initialPageSize);
  const resetSignature = `${resetKey}\u0000${rows.length}`;

  // نموذج الفرز النقي يعمل بمفاتيح؛ نترجم وصف الـMetadata إليه بلا تكرار المنطق.
  const sortColumns = useMemo(
    () => columns.map((column) => ({ key: column.id, kind: column.sortKind, sortValue: column.sortValue })),
    [columns],
  );
  const sortedRows = useMemo(() => sortDataTableRows(rows, sort, sortColumns), [rows, sort, sortColumns]);
  const { pageRows, range } = useMemo(
    () => paginateDataTableRows(sortedRows, page, pageSize),
    [sortedRows, page, pageSize],
  );

  // تصفير الصفحة عند تغيّر مجموعة النتائج أو الفرز، حتى لا يقف المستخدم على صفحة لم تعد موجودة.
  // نعتمد على قيم الفلاتر لا هوية المصفوفة: تمرير rows inline لا يجوز أن يعيد الصفحة الأولى كل render.
  useEffect(() => {
    setPage(1);
  }, [resetSignature, sort, pageSize]);

  const toggleSort = useCallback(
    (key: string, initialDirection: DataTableSortDirection = "asc") => {
      setSort((current) => nextDataTableSort(current, key, initialDirection));
    },
    [],
  );

  const setPageSize = useCallback((size: number) => {
    setPageSizeState(Number.isSafeInteger(size) && size >= 0 ? size : 25);
  }, []);

  const clampedSetPage = useCallback(
    (next: number) => {
      const { pageCount } = dataTableRange(sortedRows.length, next, pageSize);
      setPage(Number.isSafeInteger(next) ? Math.min(Math.max(1, next), pageCount) : 1);
    },
    [sortedRows.length, pageSize],
  );

  return {
    sort,
    toggleSort,
    sortedRows,
    pageRows,
    page: range.page,
    pageCount: range.pageCount,
    pageSize,
    total: range.total,
    from: range.from,
    to: range.to,
    setPage: clampedSetPage,
    setPageSize,
  };
}
