export type DataFilterTab<Row, Id extends string> = {
  id: Id;
  label: string;
  matches: (row: Row) => boolean;
  isVisible?: (rows: readonly Row[]) => boolean;
};

export type DataSelectOption<Id extends string> = {
  value: Id;
  label: string;
};

export type DataCsvColumn<Row> = {
  header: string;
  value: (row: Row) => string | number | null | undefined;
};

/** Search is a presentation concern; authorization and data scope stay on the server. */
export function filterRowsBySearch<Row>(
  rows: readonly Row[],
  query: string,
  searchText: (row: Row) => readonly string[],
): Row[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [...rows];
  return rows.filter((row) =>
    searchText(row).some((value) => value.toLowerCase().includes(normalized)),
  );
}

export function csvHeaders<Row>(columns: readonly DataCsvColumn<Row>[]): string[] {
  return columns.map((column) => column.header);
}

export function csvRows<Row>(
  rows: readonly Row[],
  columns: readonly DataCsvColumn<Row>[],
): Array<Array<string | number | null | undefined>> {
  return rows.map((row) => columns.map((column) => column.value(row)));
}
