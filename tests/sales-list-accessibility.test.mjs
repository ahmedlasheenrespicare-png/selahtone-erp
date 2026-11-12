import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("invoice filtering announces the result count", () => {
  const source = read("../src/app/(app)/sales/sales-invoices-view.tsx");
  assert.ok(source.includes('className="sr-only" role="status" aria-live="polite" aria-atomic="true">عدد الفواتير المطابقة: {filtered.length}</p>'));
  assert.ok(source.includes('className="inv-panel sales-empty-filter" role="status"'));
  assert.ok(source.includes('role="region" aria-label="جدول فواتير البيع" tabIndex={0}'));
});

test("invoice CSV export announces the filtered download", () => {
  const source = read("../src/app/(app)/sales/sales-invoices-view.tsx");
  assert.ok(source.includes('const [exportMessage, setExportMessage] = useState("")'));
  assert.ok(source.includes('setExportMessage(`تم بدء تنزيل ملف CSV ويضم ${filtered.length} فاتورة.`)'));
  assert.ok(source.includes('className="sr-only" role="status" aria-live="polite" aria-atomic="true">{exportMessage}</p>'));
  assert.ok(source.includes('disabled={filtered.length === 0}'));
});

test("invoice list and detail tables expose column headers", () => {
  const list = read("../src/app/(app)/sales/sales-invoices-view.tsx");
  const detail = read("../src/app/(app)/sales/[saleId]/page.tsx");
  assert.equal((list.match(/<th(?: scope="col")?(?: aria-label="تفاصيل")?\s*\/?>/g) ?? []).length, 9);
  assert.equal((list.match(/<th scope="col"/g) ?? []).length, 9);
  assert.equal((detail.match(/<th scope="col">/g) ?? []).length, 6);
  assert.ok(detail.includes('role="region" aria-label="بنود الفاتورة" tabIndex={0}'));
});

test("sales statistics empty states are announced", () => {
  const source = read("../src/app/(app)/sales/stats/sales-stats-interactive.tsx");
  assert.ok(source.includes('className="inv-field__hint" role="status">لا توجد مبيعات مسجلة في هذه الفترة أو النطاق المختار.</p>'));
  assert.ok(source.includes('className="inv-field__hint" role="status">لا توجد أصناف مطابقة للفلتر أو عبارة البحث الحالية.</p>'));
  assert.ok(source.includes('function resetItemFilters(): void'));
  assert.ok(source.includes('setKindFilter("all")'));
  assert.ok(source.includes('setSortBy("revenue")'));
  assert.ok(source.includes('onClick={resetItemFilters}>مسح البحث والفلاتر</button>'));
});

test("sales statistics CSV export announces the report download", () => {
  const source = read("../src/app/(app)/sales/stats/sales-stats-interactive.tsx");
  assert.ok(source.includes('const [exportMessage, setExportMessage] = useState("")'));
  assert.ok(source.includes('setExportMessage(`تم بدء تنزيل تقرير CSV ويضم ${exportPayload.invoiceCount} فاتورة نشطة.`)'));
  assert.ok(source.includes('className="sr-only" role="status" aria-live="polite" aria-atomic="true">{exportMessage}</p>'));
});

test("catalog initial and filtered empty states are announced", () => {
  const source = read("../src/app/(app)/sales/catalog/page.tsx");
  assert.ok(source.includes('className="inv-panel inv-empty" role="status">لا توجد أصناف بعد.</div>'));
  assert.ok(source.includes('className="inv-panel inv-empty" role="status">لا توجد تصنيفات أو أنواع مطابقة للبحث الحالي.</div>'));
});
