import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  compareDataTableValues,
  dataTableAriaSort,
  dataTableRange,
  nextDataTableSort,
  paginateDataTableRows,
  sortDataTableRows,
} from "../src/components/data-table/data-table-model";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const component = read("src/components/data-table/data-table.tsx");
const hook = read("src/components/data-table/use-data-table.ts");
const css = read("src/components/data-table/data-table.css");
const salesView = read("src/app/(app)/sales/sales-invoices-view.tsx");
const expensesView = read("src/app/(app)/finance/expenses/finance-expenses-view.tsx");

type Row = { id: string; name: string; cents: string; date: string };

test("دورة النقر على رأس العمود: بلا فرز ← مبدئي ← معاكس ← بلا فرز", () => {
  assert.deepEqual(nextDataTableSort(null, "name"), { key: "name", direction: "asc" });
  assert.deepEqual(nextDataTableSort({ key: "name", direction: "asc" }, "name"), { key: "name", direction: "desc" });
  assert.equal(nextDataTableSort({ key: "name", direction: "desc" }, "name"), null);
  // عمود مالي يبدأ تنازليًا ثم يصاعد ثم يعود لترتيب الخادم.
  assert.deepEqual(nextDataTableSort(null, "amount", "desc"), { key: "amount", direction: "desc" });
  assert.deepEqual(nextDataTableSort({ key: "amount", direction: "desc" }, "amount", "desc"), { key: "amount", direction: "asc" });
  assert.equal(nextDataTableSort({ key: "amount", direction: "asc" }, "amount", "desc"), null);
  // الانتقال إلى عمود آخر يبدأ دورته من جديد.
  assert.deepEqual(nextDataTableSort({ key: "name", direction: "desc" }, "amount", "desc"), { key: "amount", direction: "desc" });
});

test("aria-sort يعكس العمود النشط فقط", () => {
  assert.equal(dataTableAriaSort(null, "name"), "none");
  assert.equal(dataTableAriaSort({ key: "name", direction: "asc" }, "name"), "ascending");
  assert.equal(dataTableAriaSort({ key: "name", direction: "desc" }, "name"), "descending");
  assert.equal(dataTableAriaSort({ key: "name", direction: "asc" }, "amount"), "none");
});

test("مقارنة القرش دقيقة بعد حدّ الأمان الرقمي، والتاريخ والنص لهما دلالتهما", () => {
  // أرقام تتجاوز Number.MAX_SAFE_INTEGER: BigInt يقارنها صحيحة.
  assert.equal(compareDataTableValues("9007199254740993", "9007199254740992", "cents"), 1);
  assert.equal(compareDataTableValues("100", "100", "cents"), 0);
  assert.equal(compareDataTableValues("-5", "5", "cents"), -1);
  assert.equal(compareDataTableValues(150n, 200n, "cents"), -1);
  // قيم غير صالحة تُعامل كفراغ لا كصفر.
  assert.equal(compareDataTableValues("abc", "10", "cents"), 1);
  assert.equal(compareDataTableValues("1.5", "10", "cents"), 1);
  assert.equal(compareDataTableValues("10", "20", "number"), -1);
  assert.equal(compareDataTableValues("2026-11-12", "2026-01-05", "date"), 1);
  assert.equal(compareDataTableValues("ليس تاريخًا", "2026-01-05", "date"), 1);
  // الفرز النصي العربي يفهم الأرقام داخل النص: ST-2 قبل ST-10.
  assert.ok(compareDataTableValues("ST-2", "ST-10", "text") < 0);
  assert.ok(compareDataTableValues("أحمد", "ياسر", "text") < 0);
});

test("الفرز مستقر ويُبقي الفراغ في الآخر بالاتجاهين، وبلا فرز لا يمسّ الترتيب", () => {
  const rows: Row[] = [
    { id: "1", name: "equal", cents: "100", date: "2026-01-01" },
    { id: "2", name: "equal", cents: "300", date: "2026-02-01" },
    { id: "3", name: "equal", cents: "", date: "2026-03-01" },
    { id: "4", name: "equal", cents: "200", date: "2026-04-01" },
  ];
  const columns = [{ key: "cents", kind: "cents" as const, sortValue: (row: Row) => row.cents }];

  const asc = sortDataTableRows(rows, { key: "cents", direction: "asc" }, columns);
  assert.deepEqual(asc.map((row) => row.id), ["1", "4", "2", "3"]);
  const desc = sortDataTableRows(rows, { key: "cents", direction: "desc" }, columns);
  // الفراغ يبقى أخيرًا، والمتساويات تحافظ على ترتيب الخادم.
  assert.deepEqual(desc.map((row) => row.id), ["2", "4", "1", "3"]);

  const ties = [{ key: "name", sortValue: (row: Row) => row.name }];
  assert.deepEqual(sortDataTableRows(rows, { key: "name", direction: "desc" }, ties).map((r) => r.id), ["1", "2", "3", "4"]);
  // بلا فرز أو عمود بلا sortValue: نفس المرجع، بلا عمل ولا إعادة ترتيب.
  assert.equal(sortDataTableRows(rows, null, columns), rows);
  assert.equal(sortDataTableRows(rows, { key: "unknown", direction: "asc" }, columns), rows);
});

test("ترقيم الصفحات يقيّد الصفحة بحدود النتائج، وحجم صفر يعرض الكل", () => {
  const rows = Array.from({ length: 12 }, (_, index) => index + 1);
  assert.deepEqual(paginateDataTableRows(rows, 1, 5).pageRows, [1, 2, 3, 4, 5]);
  assert.deepEqual(paginateDataTableRows(rows, 3, 5).pageRows, [11, 12]);
  assert.deepEqual(paginateDataTableRows(rows, 3, 5).range, { page: 3, pageCount: 3, total: 12, from: 11, to: 12 });
  // صفحة خارج المدى تُقيَّد لآخر صفحة بدل شاشة فارغة.
  assert.deepEqual(paginateDataTableRows(rows, 99, 5).range, { page: 3, pageCount: 3, total: 12, from: 11, to: 12 });
  assert.deepEqual(paginateDataTableRows(rows, 0, 5).range.page, 1);
  assert.deepEqual(paginateDataTableRows(rows, Number.NaN, 5).range.page, 1);
  // «كل النتائج» قبل الطباعة.
  assert.equal(paginateDataTableRows(rows, 1, 0).pageRows.length, 12);
  assert.deepEqual(paginateDataTableRows(rows, 1, 0).range, { page: 1, pageCount: 1, total: 12, from: 1, to: 12 });
  // لا نتائج: نطاق صريح بلا أرقام مضللة.
  assert.deepEqual(dataTableRange(0, 3, 25), { page: 1, pageCount: 1, total: 0, from: 0, to: 0 });
  assert.deepEqual(paginateDataTableRows([], 2, 25).pageRows, []);
});

test("المكوّن يعرض رأسًا قابلًا للنقر مع aria-sort وترقيمًا بلوحة المفاتيح", () => {
  assert.match(component, /aria-sort=\{ariaSort\}/);
  assert.match(component, /scope="col"/);
  assert.match(component, /className="data-table__sort"/);
  assert.match(component, /onClick=\{\(\) => toggleSort\(column\.key, column\.initialDirection\)\}/);
  assert.match(component, /aria-label=\{`ترتيب حسب /);
  assert.match(component, /aria-label="الصفحة السابقة"/);
  assert.match(component, /aria-label="الصفحة التالية"/);
  assert.match(component, /disabled=\{page <= 1\}/);
  assert.match(component, /disabled=\{page >= pageCount\}/);
  assert.match(component, /aria-live="polite"/);
  // عمود بلا sortValue يبقى عمودًا ثابتًا (عمود الإجراءات مثلًا).
  assert.match(component, /const sortable = Boolean\(column\.sortValue\);/);
  assert.doesNotMatch(component, /fetch\(|@\/lib\/prisma|useEffect\(/);
});

test("الشاشتان تستخدمان المكوّن نفسه، والفرز على قيم خام لا نصوص منسّقة", () => {
  for (const view of [salesView, expensesView]) {
    assert.match(view, /import DataTable, \{ type DataTableColumn \} from "@\/components\/data-table\/data-table";/);
    assert.match(view, /useDataTable\(\{ rows: filtered, columns, initialPageSize: 25, resetKey: /);
    assert.match(view, /<DataTable/);
    assert.doesNotMatch(view, /<thead>/);
    assert.doesNotMatch(view, /<tbody>/);
    // التصدير من كل النتائج المرتّبة، لا من صفحة العرض.
    assert.match(view, /table\.sortedRows\.map/);
    assert.doesNotMatch(view, /table\.pageRows\.map/);
  }
  assert.match(salesView, /sortValue: \(sale\) => sale\.originalCents/);
  assert.match(salesView, /sortValue: \(sale\) => sale\.dueFromCustomerCents/);
  assert.match(salesView, /sortValue: \(sale\) => sale\.createdAtIso/);
  assert.doesNotMatch(salesView, /sortValue: \(sale\) => sale\.originalFormatted/);
  assert.match(expensesView, /sortValue: \(row\) => row\.amountCents/);
  assert.doesNotMatch(expensesView, /sortValue: \(row\) => row\.amountFormatted/);
  assert.match(expensesView, /kind: "cents"/);
  assert.match(expensesView, /caption="سجل المصروفات المعروض حسب حالة التصفية/);
  // الثيمات كما هي: الجدول يرث فئات القسم المضيف.
  assert.match(salesView, /tableClassName="inv-table sales-invoices-table"/);
  assert.match(expensesView, /tableClassName="fin-table"/);
});

test("الصلاحيات وحمولة CSV تبقيان كما كانتا", () => {
  // روابط الفواتير محكومة بنفس الشرطين السابقين حرفيًا.
  assert.match(salesView, /\{canOpenInvoice \? <Link href=\{`\/sales\/\$\{sale\.id\}`\}/);
  assert.match(salesView, /\{canOpenInvoice && <Link href=\{`\/sales\/\$\{sale\.id\}`\}/);
  assert.match(expensesView, /\.\.\.\(canManage/);
  assert.match(expensesView, /href=\{`\/finance\/expenses\/\$\{row\.id\}`\}/);
  // رؤوس CSV وقيمها لم تتغيّر.
  assert.match(expensesView, /\["رقم المصروف", "التاريخ", "الفرع", "البند", "الوصف", "المبلغ \(ج\.م\)", "الحالة"\]/);
  assert.match(salesView, /"الإجمالي الأصلي \(ج\.م\)"/);
  assert.match(salesView, /r\.originalFormatted/);
  assert.match(expensesView, /r\.amountFormatted/);
});

test("الحالة تعيد الصفحة الأولى عند تغيّر الفلاتر أو الفرز أو حجم الصفحة، لا عند كل render", () => {
  assert.match(hook, /const resetSignature = `\$\{resetKey\}\\u0000\$\{rows\.length\}`;/);
  assert.match(hook, /setPage\(1\);/);
  assert.match(hook, /\}, \[resetSignature, sort, pageSize\]\);/);
  assert.doesNotMatch(hook, /\}, \[rows, sort, pageSize\]\);/);
  assert.match(hook, /Math\.min\(Math\.max\(1, next\), pageCount\)/);
  // الشاشتان تمرّران قيم الفلاتر فعلًا، فلا تعلقان على هوية مصفوفة النتائج.
  assert.match(salesView, /resetKey: \[query, branchFilter, periodFilter, activeTab\]\.join/);
  assert.match(expensesView, /resetKey: \[query, filter, branchFilter, categoryFilter\]\.join/);
});

test("CSS المكوّن يرث توكنز الأقسام ويدعم الليل والجوال وتقليل الحركة والطباعة", () => {
  assert.match(css, /var\(--fn-ink, var\(--sl-ink/);
  assert.match(css, /var\(--fn-primary-btn, var\(--sl-primary-btn/);
  assert.match(css, /\.workspace-shell\[data-color-mode="dark"\] \.data-table/);
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.match(css, /@media print/);
  assert.match(css, /\.data-table__print-note/);
  assert.doesNotMatch(css, /infinite|@keyframes/);
});
