import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  countShareRingPercent,
  expenseWaitingRingPercent,
  outstandingShareRingPercent,
  statRingAngleDegrees,
} from "../src/components/stat-ring-pill-model";
import { computeBranchAccountCoverage } from "../src/lib/finance/new-account-helpers";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const expensesPage = read("src/app/(app)/finance/expenses/page.tsx");
const expensesTodayPage = read("src/app/(app)/finance/expenses/today/page.tsx");
const inventoryPage = read("src/app/(app)/inventory/page.tsx");
const accountsPage = read("src/app/(app)/finance/accounts/page.tsx");
const adminPage = read("src/app/(app)/admin/page.tsx");
const dashboardPage = read("src/app/(app)/dashboard/page.tsx");
const dashboardPulse = read("src/lib/dashboard-pulse.ts");
const financeDashboard = read("src/lib/finance/dashboard.ts");
const salesTodayPage = read("src/app/(app)/sales/today/page.tsx");

test("المعلق للاعتماد أو الصرف ÷ إجمالي المصروفات بدقة جزء من عشرة", () => {
  assert.equal(expenseWaitingRingPercent({ expenseCount: 3, totalCents: 235000n, waitingCents: 61000n }), 26);
  assert.equal(expenseWaitingRingPercent({ expenseCount: 3, totalCents: 33333n, waitingCents: 11111n }), 33.3);
  assert.equal(statRingAngleDegrees(33.3), 119.9);
  assert.equal(expenseWaitingRingPercent({ expenseCount: 2, totalCents: 100000n, waitingCents: 0n }), 0);
  assert.equal(expenseWaitingRingPercent({ expenseCount: 2, totalCents: 100000n, waitingCents: 100000n }), 100);
  // تصحيح/رد غير متماثل: الحلقة تقف عند 100% ولا تتجاوزها.
  assert.equal(expenseWaitingRingPercent({ expenseCount: 2, totalCents: 100n, waitingCents: 150n }), 100);
});

test("لا مصروفات أو مقام غير موجب أو معلق سالب ⇒ لا نسبة مضللة", () => {
  assert.equal(expenseWaitingRingPercent({ expenseCount: 0, totalCents: 0n, waitingCents: 0n }), null);
  assert.equal(expenseWaitingRingPercent({ expenseCount: 0, totalCents: 1000n, waitingCents: 100n }), null);
  assert.equal(expenseWaitingRingPercent({ expenseCount: 2, totalCents: 0n, waitingCents: 0n }), null);
  assert.equal(expenseWaitingRingPercent({ expenseCount: 2, totalCents: -100n, waitingCents: 0n }), null);
  assert.equal(expenseWaitingRingPercent({ expenseCount: 2, totalCents: 1000n, waitingCents: -1n }), null);
  assert.equal(expenseWaitingRingPercent({ expenseCount: Number.NaN, totalCents: 1000n, waitingCents: 100n }), null);
  assert.equal(expenseWaitingRingPercent({ expenseCount: 1.5, totalCents: 1000n, waitingCents: 100n }), null);
});

test("مصروفات الشهر: الحلقة على المعلق بمقام إجمالي الشهر في السجل واللوحة", () => {
  assert.match(expensesPage, /monthWaitingRingPercent = expenseWaitingRingPercent\(\{/);
  assert.match(expensesPage, /expenseCount: monthCount/);
  assert.match(expensesPage, /totalCents: monthTotalCents/);
  assert.match(expensesPage, /waitingCents: monthPendingAndApprovedCents/);
  assert.match(expensesPage, /percent: monthWaitingRingPercent/);
  assert.match(expensesPage, /percentLabel: "نسبة المعلق للاعتماد أو الصرف من إجمالي مصروفات الشهر"/);
  assert.match(expensesPage, /emptyLabel: monthCount === 0 \? "لا مصروفات" : "غير متاح"/);
  assert.match(expensesPage, /label: "معلّق للاعتماد أو الصرف"/);
  assert.match(expensesPage, /value: displayMoney\(monthPendingAndApprovedCents\)/);
  // حلقة الشريط السابقة للمدفوع من إجمالي السجل تبقى كما هي، ولا تُستبدل بحلقة الشهر.
  assert.match(expensesPage, /percent: paidRingPercent/);
  assert.match(expensesPage, /percentLabel: "نسبة المدفوع فعليًا من إجمالي مصروفات السجل"/);

  assert.match(financeDashboard, /expenseWaitingRingPercent\(\{/);
  assert.match(financeDashboard, /expenseCount: monthCount/);
  assert.match(financeDashboard, /totalCents: monthTotalCents/);
  assert.match(financeDashboard, /waitingCents: monthUnpaidCents/);
  assert.match(financeDashboard, /percentLabel: canManage/);
  assert.match(financeDashboard, /نسبة المعلق للاعتماد أو الصرف من إجمالي مصروفاتك هذا الشهر/);
  assert.match(financeDashboard, /emptyLabel: monthCount === 0 \? "لا مصروفات" : "غير متاح"/);
  assert.match(financeDashboard, /value: displayMoney\(monthUnpaidCents\)/);
});

test("مصروفات اليوم: الحلقة على بانتظار التنفيذ بمقام إجمالي اليوم في الصفحة واللوحة", () => {
  assert.match(expensesTodayPage, /waitingRingPercent = expenseWaitingRingPercent\(\{ expenseCount: count, totalCents, waitingCents \}\)/);
  assert.match(expensesTodayPage, /percent: waitingRingPercent/);
  assert.match(expensesTodayPage, /percentLabel: "نسبة المعلق للاعتماد أو الصرف من إجمالي مصروفات اليوم"/);
  assert.match(expensesTodayPage, /emptyLabel: count === 0 \? "لا مصروفات" : "غير متاح"/);
  assert.match(expensesTodayPage, /label: "بانتظار التنفيذ"/);
  assert.match(expensesTodayPage, /value: waitingFormatted/);
  assert.match(expensesTodayPage, /percent: paidRingPercent/);

  assert.match(dashboardPage, /todayExpensesWaitingRingPercent = expenseWaitingRingPercent\(\{/);
  assert.match(dashboardPage, /expenseCount: todayExpenses\?\.count \?\? 0/);
  assert.match(dashboardPage, /totalCents: todayExpenses\?\.totalCents \?\? 0n/);
  assert.match(dashboardPage, /waitingCents: todayExpenses\?\.waitingCents \?\? 0n/);
  assert.match(dashboardPage, /percent: todayExpensesWaitingRingPercent/);
  assert.match(dashboardPage, /emptyLabel: todayExpensesWaitingRingEmptyLabel/);
  assert.match(dashboardPage, /todayExpenses\.count === 0\s*\?\s*"لا مصروفات"/);
});

test("مبيعات اليوم في اللوحة: المتبقي على فواتير اليوم ÷ صافي مبيعات اليوم من القرش الخام", () => {
  assert.equal(outstandingShareRingPercent({ invoiceCount: 4, netSalesCents: 14795000n, outstandingCents: 7400000n }), 50);
  assert.match(dashboardPulse, /todayNetSalesCents: string;/);
  assert.match(dashboardPulse, /todayRemainingCents: string;/);
  assert.match(dashboardPulse, /todayNetSalesCents: todayNetSalesCents\.toString\(\)/);
  assert.match(dashboardPulse, /todayRemainingCents: todayRemainingCents\.toString\(\)/);
  assert.match(dashboardPage, /todayOutstandingRingPercent = pulseData/);
  assert.match(dashboardPage, /invoiceCount: pulseData\.todayInvoicesCount/);
  assert.match(dashboardPage, /netSalesCents: BigInt\(pulseData\.todayNetSalesCents\)/);
  assert.match(dashboardPage, /outstandingCents: BigInt\(pulseData\.todayRemainingCents\)/);
  assert.match(dashboardPage, /percent: todayOutstandingRingPercent/);
  assert.match(dashboardPage, /percentLabel: "نسبة المتبقي على فواتير اليوم من صافي مبيعات اليوم"/);
  assert.match(dashboardPage, /pulseData\.todayInvoicesCount === 0\s*\?\s*"لا مبيعات"/);
  assert.match(dashboardPage, /label: "المتبقي على فواتير اليوم"/);
  assert.match(dashboardPage, /value: pulseData\.todayRemainingFormatted/);
  // صفحة /sales/today خارج المجموعة الآمنة: لا حلقة متبقي جديدة فيها.
  assert.doesNotMatch(salesTodayPage, /outstandingShareRingPercent/);
  assert.doesNotMatch(salesTodayPage, /todayOutstandingRingPercent/);
});

test("نواقص المخزون: البسط النواقص والمقام الأصناف المخزنية النشطة لا كل الأصناف", () => {
  assert.equal(countShareRingPercent({ partCount: 2, totalCount: 8 }), 25);
  assert.match(inventoryPage, /zeroStockRingPercent = countShareRingPercent\(\{/);
  assert.match(inventoryPage, /partCount: zeroStockCount/);
  assert.match(inventoryPage, /totalCount: stockableProducts\.length/);
  assert.doesNotMatch(inventoryPage, /totalCount: products\.length/);
  assert.match(inventoryPage, /percent: zeroStockRingPercent/);
  assert.match(inventoryPage, /percentLabel: "نسبة نواقص المخزون من إجمالي الأصناف المخزنية النشطة"/);
  assert.match(inventoryPage, /emptyLabel: stockableProducts\.length === 0 \? "لا أصناف" : "غير متاح"/);
  assert.match(inventoryPage, /label: "أصناف رصيدها صفر \(نواقص\)"/);
  assert.match(inventoryPage, /value: nf\.format\(zeroStockCount\)/);
  assert.match(inventoryPage, /await requirePageAccess\("\/inventory"\)/);
});

test("تغطية الخزائن: فرع واحد لكل خزنة مفتوحة، والمقام الفروع النشطة فقط", () => {
  const branches = [
    { id: "1", name: "ألف", code: "A" },
    { id: "2", name: "باء", code: "B" },
    { id: "3", name: "جيم", code: "C" },
  ];
  const accounts = [
    // خزنتان مفتوحتان لنفس الفرع لا ترفعان التغطية فوق 100%.
    { id: "10", branchId: "1", kind: "VAULT" as const, holderId: null, balance: "0", closedAt: null },
    { id: "11", branchId: "1", kind: "VAULT" as const, holderId: null, balance: "0", closedAt: null },
    // خزنة مغلقة أو لفرع غير نشط لا تدخل البسط.
    { id: "12", branchId: "2", kind: "VAULT" as const, holderId: null, balance: "0", closedAt: "2026-01-01" },
    { id: "13", branchId: "9", kind: "VAULT" as const, holderId: null, balance: "0", closedAt: null },
    // العهدة ليست خزنة فرع.
    { id: "14", branchId: "3", kind: "CUSTODY" as const, holderId: "5", balance: "0", closedAt: null },
  ];
  const coverage = computeBranchAccountCoverage(branches, [], accounts);
  assert.equal(coverage.totalActiveBranches, 3);
  assert.equal(coverage.openVaultCount, 1);
  assert.equal(countShareRingPercent({ partCount: coverage.openVaultCount, totalCount: coverage.totalActiveBranches }), 33.3);
  assert.equal(countShareRingPercent({ partCount: 0, totalCount: 0 }), null);

  assert.match(accountsPage, /vaultCoverageRingPercent = countShareRingPercent\(\{/);
  assert.match(accountsPage, /partCount: coverage\.openVaultCount/);
  assert.match(accountsPage, /totalCount: coverage\.totalActiveBranches/);
  assert.match(accountsPage, /percent: vaultCoverageRingPercent/);
  assert.match(accountsPage, /percentLabel: "نسبة الفروع النشطة المغطاة بخزنة مفتوحة من إجمالي الفروع النشطة"/);
  assert.match(accountsPage, /emptyLabel: coverage\.totalActiveBranches === 0 \? "لا فروع" : "غير متاح"/);
  assert.match(accountsPage, /await requirePageAccess\("\/finance\/accounts"\)/);

  // نظير الإدارة يستخدم نفس المقام، ويظهر فقط عندما يكون الملخص المالي متاحًا.
  assert.match(adminPage, /\.\.\.\(financeSummaryVisible/);
  assert.match(adminPage, /partCount: vaultsReadyCount/);
  assert.match(adminPage, /totalCount: activeBranches\.length/);
  assert.match(adminPage, /emptyLabel: activeBranches\.length === 0 \? "لا فروع" : "غير متاح"/);
  assert.match(adminPage, /await requireSystemAdminOrRedirect\(\)/);
});

test("المجموعة الآمنة لا تغيّر الصلاحيات ولا حمولة CSV ولا محركات الحساب", () => {
  assert.match(expensesPage, /await requirePageAccess\("\/finance\/expenses"\)/);
  assert.match(expensesTodayPage, /await requirePageAccess\("\/finance\/expenses\/today"\)/);
  assert.match(expensesPage, /listExpenses\(\{ serializable: \(work\) => work\(tx\) \}, session\.id\)/);
  assert.match(expensesTodayPage, /loadTodayExpenses\(session\)/);
  assert.match(financeDashboard, /const monthUnpaidCents = monthApprovedCents \+ monthPendingCents;/);
  assert.match(expensesPage, /const monthPendingAndApprovedCents = monthPendingCents \+ monthApprovedCents;/);
  // الحقول الخام الجديدة في نبض اليوم نسخ نصي للقرش، لا إعادة حساب ولا تقريب.
  assert.match(dashboardPulse, /todayNetSalesCents: todayNetSalesCents\.toString\(\)/);
  assert.match(dashboardPulse, /todayRemainingCents: todayRemainingCents\.toString\(\)/);
  assert.doesNotMatch(dashboardPage, /percent=\{[^}]*todayGrowthPct/);
  assert.doesNotMatch(dashboardPage, /percent=\{[^}]*outstandingChangePct/);
});
