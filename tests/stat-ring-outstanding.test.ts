import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { outstandingShareRingPercent, statRingAngleDegrees } from "../src/components/stat-ring-pill-model";

const model = readFileSync(new URL("../src/components/stat-ring-pill-model.ts", import.meta.url), "utf8");
const card = readFileSync(new URL("../src/components/panther-spotlight-card.tsx", import.meta.url), "utf8");
const monthly = readFileSync(new URL("../src/app/(app)/dashboard/monthly-sales-panther.tsx", import.meta.url), "utf8");
const salesPage = readFileSync(new URL("../src/app/(app)/sales/page.tsx", import.meta.url), "utf8");
const salesTodayPage = readFileSync(new URL("../src/app/(app)/sales/today/page.tsx", import.meta.url), "utf8");
const dashboardPage = readFileSync(new URL("../src/app/(app)/dashboard/page.tsx", import.meta.url), "utf8");
const workspaceCss = readFileSync(new URL("../src/app/(app)/workspace.css", import.meta.url), "utf8");

test("نسبة المتبقي على العملاء = المتبقي ÷ صافي المبيعات بدقة جزء من عشرة", () => {
  assert.equal(
    outstandingShareRingPercent({ invoiceCount: 9, netSalesCents: 235000n, outstandingCents: 61000n }),
    26,
  );
  assert.equal(
    outstandingShareRingPercent({ invoiceCount: 3, netSalesCents: 33333n, outstandingCents: 11111n }),
    33.3,
  );
  assert.equal(statRingAngleDegrees(33.3), 119.9);
  assert.equal(
    outstandingShareRingPercent({ invoiceCount: 2, netSalesCents: 100000n, outstandingCents: 0n }),
    0,
  );
  assert.equal(
    outstandingShareRingPercent({ invoiceCount: 2, netSalesCents: 100000n, outstandingCents: 100000n }),
    100,
  );
  // المتبقي أكبر من الصافي (مرتجع/تصحيح غير متماثل): الحلقة تقف عند 100% لا تتجاوزها.
  assert.equal(
    outstandingShareRingPercent({ invoiceCount: 2, netSalesCents: 100n, outstandingCents: 150n }),
    100,
  );
});

test("لا فواتير أو صافي غير موجب أو متبقٍ سالب ⇒ لا نسبة مضللة", () => {
  assert.equal(
    outstandingShareRingPercent({ invoiceCount: 0, netSalesCents: 0n, outstandingCents: 0n }),
    null,
  );
  assert.equal(
    outstandingShareRingPercent({ invoiceCount: 0, netSalesCents: 1000n, outstandingCents: 100n }),
    null,
  );
  assert.equal(
    outstandingShareRingPercent({ invoiceCount: 3, netSalesCents: 0n, outstandingCents: 0n }),
    null,
  );
  assert.equal(
    outstandingShareRingPercent({ invoiceCount: 3, netSalesCents: -500n, outstandingCents: 100n }),
    null,
  );
  assert.equal(
    outstandingShareRingPercent({ invoiceCount: 3, netSalesCents: 1000n, outstandingCents: -100n }),
    null,
  );
  assert.equal(
    outstandingShareRingPercent({ invoiceCount: Number.NaN, netSalesCents: 1000n, outstandingCents: 100n }),
    null,
  );
  assert.match(model, /لا فواتير أو صافي غير موجب ⇒ لا نسبة/);
});

test("الحلقة اختيارية في بطاقة المؤشر ولا تلمس الرقم الأول ولا باقي المؤشرات", () => {
  assert.match(card, /ring\?: \{/);
  assert.match(card, /percent: number \| null;/);
  assert.match(card, /secondary\.ring \? \(/);
  assert.match(card, /monthly-panther__metric--ring/);
  assert.match(card, /className="monthly-panther__metric-ring"/);
  // الرقم الأول (صافي المبيعات) يبقى بلا حلقة كما كان.
  assert.doesNotMatch(card, /primary\.ring/);
  assert.match(card, /<p className="monthly-panther__metric-label">\{primary\.label\}<\/p>/);
  // باقي المؤشرات ترسل primary/secondary بلا ring، فلا يتغيّر رسمها.
  assert.match(card, /\{secondary\.ring \? \(\s*<StatRing/);
});

test("مبيعات الشهر: الحلقة على المتبقي على العملاء بمقام صافي المبيعات", () => {
  assert.match(monthly, /outstandingRingPercent: number \| null;/);
  assert.equal((monthly.match(/ring: \{/g) ?? []).length, 1);
  assert.match(monthly, /percent: outstandingRingPercent/);
  assert.match(monthly, /percentLabel: "نسبة المتبقي على العملاء من صافي مبيعات الشهر"/);
  assert.match(monthly, /emptyLabel: hasSales \? "غير متاح" : "لا مبيعات"/);
  assert.match(monthly, /label: "المتبقي على العملاء"/);
  // النص والقيمة الأصليان كما هما: لا تغيير في المجاميع ولا في وصف النسبة.
  assert.match(monthly, /value: outstandingFormatted/);
  assert.match(monthly, /`\$\{outstandingPercent\}% آجل/);
});

test("صفحتا مبيعات الشهر تحسبان النسبة من مجاميع القرش وتصونان الصلاحيات والمجاميع", () => {
  for (const page of [salesPage, dashboardPage]) {
    assert.match(page, /outstandingShareRingPercent\(\{/);
    assert.match(page, /invoiceCount: monthSales\.invoiceCount/);
    assert.match(page, /netSalesCents: scaledInteger\(monthSales\.total, 2\)/);
    assert.match(page, /outstandingCents: scaledInteger\(monthSales\.outstandingTotal, 2\)/);
    assert.match(page, /outstandingRingPercent=\{monthOutstandingRingPercent\}/);
  }
  assert.match(salesPage, /await requirePageAccess\("\/sales"\)/);
  // «مبيعات اليوم» خارج نطاق هذا الطلب: تبقى بلا حلقة المتبقي، وبلا تغيير في صلاحياتها أو حلقة فواتيرها السابقة.
  assert.doesNotMatch(salesTodayPage, /outstandingShareRingPercent/);
  assert.doesNotMatch(salesTodayPage, /نسبة المتبقي على العملاء من صافي مبيعات اليوم/);
  assert.match(salesTodayPage, /await requirePageAccess\("\/sales\/today"\)/);
  assert.match(salesTodayPage, /countShareRingPercent\(\{/);
  // الحلقة الجديدة لا تُدخل <StatRing> إضافيًا في الصفحات: المكوّن المشترك يرسمها.
  assert.equal((salesPage.match(/<StatRing/g) ?? []).length, 1);
  assert.equal((salesTodayPage.match(/<StatRing/g) ?? []).length, 1);
  assert.equal((dashboardPage.match(/<StatRing/g) ?? []).length, 2);
});

test("حلقة المؤشر ترث توكنز --mp-* وتراعي العمود الضيق وتقليل الحركة والطباعة", () => {
  assert.match(workspaceCss, /\.monthly-panther__metric--ring/);
  assert.match(workspaceCss, /--stat-ring-progress: var\(--mp-accent\)/);
  assert.match(workspaceCss, /--stat-ring-track: var\(--mp-track\)/);
  assert.match(workspaceCss, /--stat-ring-core: var\(--mp-node-bg, var\(--mp-bg\)\)/);
  assert.match(workspaceCss, /\.workspace-shell\[data-color-mode="dark"\] \.monthly-panther \.monthly-panther__metric--ring/);
  assert.match(workspaceCss, /@container \(max-width: 410px\)[\s\S]*?\.monthly-panther__metric--ring/);
  assert.match(workspaceCss, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.monthly-panther__metric--ring/);
  assert.match(workspaceCss, /@media print[\s\S]*?\.monthly-panther__metric--ring/);
});
