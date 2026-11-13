import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  amountShareRingPercent,
  cashCollectionRingPercent,
  countShareRingPercent,
  expensePaidRingPercent,
} from "../src/components/stat-ring-pill-model";

const salesPage = readFileSync(new URL("../src/app/(app)/sales/page.tsx", import.meta.url), "utf8");
const salesTodayPage = readFileSync(new URL("../src/app/(app)/sales/today/page.tsx", import.meta.url), "utf8");
const expensesTodayPage = readFileSync(new URL("../src/app/(app)/finance/expenses/today/page.tsx", import.meta.url), "utf8");
const dashboardPage = readFileSync(new URL("../src/app/(app)/dashboard/page.tsx", import.meta.url), "utf8");
const dashboardPulse = readFileSync(new URL("../src/lib/dashboard-pulse.ts", import.meta.url), "utf8");
const salesCss = readFileSync(new URL("../src/app/(app)/sales/sales.css", import.meta.url), "utf8");
const workspaceCss = readFileSync(new URL("../src/app/(app)/workspace.css", import.meta.url), "utf8");

test("حصة المبلغ وحصة العدد لا تعرضان نسبة مضللة عند غياب المقام", () => {
  assert.equal(amountShareRingPercent({ partCents: 30000n, totalCents: 235000n }), 12.8);
  assert.equal(amountShareRingPercent({ partCents: 0n, totalCents: 100n }), 0);
  assert.equal(amountShareRingPercent({ partCents: 100n, totalCents: 100n }), 100);
  assert.equal(amountShareRingPercent({ partCents: 150n, totalCents: 100n }), 100);
  assert.equal(amountShareRingPercent({ partCents: 0n, totalCents: 0n }), null);
  assert.equal(amountShareRingPercent({ partCents: 1n, totalCents: -100n }), null);
  assert.equal(amountShareRingPercent({ partCents: -1n, totalCents: 100n }), null);

  assert.equal(countShareRingPercent({ partCount: 7, totalCount: 9 }), 77.8);
  assert.equal(countShareRingPercent({ partCount: 0, totalCount: 5 }), 0);
  assert.equal(countShareRingPercent({ partCount: 5, totalCount: 5 }), 100);
  assert.equal(countShareRingPercent({ partCount: 6, totalCount: 5 }), 100);
  assert.equal(countShareRingPercent({ partCount: 0, totalCount: 0 }), null);
  assert.equal(countShareRingPercent({ partCount: -1, totalCount: 5 }), null);
  assert.equal(countShareRingPercent({ partCount: Number.NaN, totalCount: 5 }), null);
  assert.equal(countShareRingPercent({ partCount: 1, totalCount: Number.POSITIVE_INFINITY }), null);
});

test("حصة النقدي من تحصيل اليوم ترفض الصافي غير الموجب أو النقدي الخارج عن الصافي", () => {
  assert.equal(cashCollectionRingPercent({ cashCents: 30000n, netCollectedCents: 100000n }), 30);
  assert.equal(cashCollectionRingPercent({ cashCents: 0n, netCollectedCents: 100000n }), 0);
  assert.equal(cashCollectionRingPercent({ cashCents: 100000n, netCollectedCents: 100000n }), 100);
  assert.equal(cashCollectionRingPercent({ cashCents: 0n, netCollectedCents: 0n }), null);
  assert.equal(cashCollectionRingPercent({ cashCents: 10n, netCollectedCents: -5n }), null);
  assert.equal(cashCollectionRingPercent({ cashCents: -10n, netCollectedCents: 100n }), null);
  assert.equal(cashCollectionRingPercent({ cashCents: 120n, netCollectedCents: 100n }), null);
});

test("مصروفات اليوم: حلقة المدفوع في الشريط وحلقة المعلق في بطاقة المؤشر", () => {
  assert.equal(expensePaidRingPercent({ expenseCount: 2, totalCents: 33333n, paidCents: 11111n }), 33.3);
  assert.equal((expensesTodayPage.match(/ring: \{/g) ?? []).length, 2);
  assert.match(expensesTodayPage, /expensePaidRingPercent\(\{ expenseCount: count, totalCents, paidCents \}\)/);
  assert.match(expensesTodayPage, /نسبة المدفوع فعليًا من إجمالي مصروفات اليوم/);
  assert.match(expensesTodayPage, /emptyLabel: count === 0 \? "لا مصروفات" : "غير متاح"/);
  assert.match(expensesTodayPage, /await requirePageAccess\("\/finance\/expenses\/today"\)/);
});

test("حلقتا المبيعات محصورتان في عدد الفواتير النشطة من إجمالي السجل المعروض", () => {
  for (const page of [salesPage, salesTodayPage]) {
    assert.equal((page.match(/<StatRing/g) ?? []).length, 1);
    assert.match(page, /countShareRingPercent\(\{/);
    assert.match(page, /partCount: activeInvoicesCount/);
    assert.match(page, /totalCount: sales\.length/);
    assert.match(page, /emptyLabel=\{sales\.length === 0 \? "لا فواتير" : "غير متاح"\}/);
    assert.match(page, /sales-kpi-card--ring/);
  }
  assert.match(salesPage, /نسبة الفواتير النشطة من إجمالي الفواتير المعروضة/);
  assert.match(salesTodayPage, /نسبة فواتير اليوم النشطة من إجمالي فواتير اليوم/);
});

test("حلقتا لوحة القيادة تستخدمان حصة النقدي لا نسبة النمو عن الأمس", () => {
  assert.equal((dashboardPage.match(/<StatRing/g) ?? []).length, 2);
  assert.match(dashboardPage, /cashCollectionRingPercent\(\{/);
  assert.match(dashboardPage, /cashCents: BigInt\(pulseData\.todayCashCollectedCents\)/);
  assert.match(dashboardPage, /netCollectedCents: BigInt\(pulseData\.todayNetCollectedCents\)/);
  assert.equal((dashboardPage.match(/percent=\{todayCashRingPercent\}/g) ?? []).length, 2);
  assert.equal((dashboardPage.match(/emptyLabel=\{todayCashRingEmptyLabel\}/g) ?? []).length, 2);
  assert.equal((dashboardPage.match(/percentLabel="حصة النقدي من صافي تحصيلات اليوم"/g) ?? []).length, 2);
  assert.match(dashboardPage, /dashboard-pulse-card--ring/);
  assert.match(dashboardPage, /pulse-cell--collections pulse-cell--ring/);
  assert.match(dashboardPage, /className="pulse-cell__ring"/);
  assert.match(dashboardPage, /<h3 id="pulse-slide-title">نبض اليوم<\/h3>/);
  assert.doesNotMatch(dashboardPage, /percent=\{[^}]*todayGrowthPct/);
  assert.match(dashboardPulse, /todayNetCollectedCents: todayNetCollectedCents\.toString\(\)/);
  assert.match(dashboardPulse, /todayCashCollectedCents: todayCashCents\.toString\(\)/);
});

test("بطاقات الحلقات الجديدة تحترم تقليل الحركة والطباعة ولا تغيّر باقي البطاقات", () => {
  assert.match(salesCss, /\.sales-kpi-card--ring/);
  assert.match(salesCss, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(salesCss, /@media print/);
  assert.match(workspaceCss, /\.dashboard-pulse-card--ring/);
  assert.match(workspaceCss, /--stat-ring-progress: var\(--db-primary\)/);
  assert.match(workspaceCss, /\.dashboard-wallet \.pulse-cell--ring/);
  assert.match(workspaceCss, /\.dashboard-wallet \.pulse-cell__ring/);
  assert.match(workspaceCss, /--stat-ring-progress: var\(--wc-ink\)/);
  assert.match(workspaceCss, /--stat-ring-track: var\(--wc-surface-hover\)/);
  assert.match(workspaceCss, /--stat-ring-core: var\(--wc-bg\)/);
  assert.match(workspaceCss, /@container \(max-width: 470px\)/);
  assert.match(workspaceCss, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(workspaceCss, /@media print/);
  assert.match(workspaceCss, /القائمة الجانبية مخفية أعلاه؛ لا تترك عمودها فارغًا فتضغط المحتوى والحلقات على الورق\./);
  assert.match(salesPage, /<AppIcon name="sales" \/>/);
  assert.match(salesPage, /<AppIcon name="cash" \/>/);
  assert.match(dashboardPage, /<AppIcon name="sales" \/>/);
});
