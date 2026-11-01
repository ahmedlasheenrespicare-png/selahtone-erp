/**
 * اختبارات نموذج معاينة لوحة القيادة — تحرس الأرقام التي تُعرض:
 * المتوقَّع في اليد، ومجاميع الفروع، وأثر تصفية المدير بفرع واحد،
 * ومطابقة مجموع أسبوع الموظف للمحصَّل في فترته.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  BRANCHES,
  CUSTODIES,
  MONTH,
  SELF_TODAY_INVOICES,
  SELF_WEEK,
  buildDashboard,
  expectedInHand,
  formatMoney,
  sum,
} from "./model.mjs";

const NOW = new Date("2026-11-01T12:00:00Z");

test("المتوقَّع في اليد = الرصيد + المحصَّل − المصروف من نقد الموظف", () => {
  const self = CUSTODIES.find((item) => item.isSelf);
  // 1,000.00 + 2,450.00 − 300.00 = 3,150.00
  assert.equal(expectedInHand(self), 315_000);
  assert.equal(formatMoney(expectedInHand(self)), "3,150.00");
});

test("لوحة الموظف: الرقم الكبير هو المتوقَّع بيده، ومجموع أسبوعه يساوي محصَّل فترته", () => {
  const view = buildDashboard({ role: "CS_AGENT", now: NOW });
  assert.equal(view.money.label, "المتوقَّع بيدك الآن");
  assert.equal(view.money.value, 315_000);
  assert.equal(sum(SELF_WEEK.sales), 245_000);
  assert.equal(view.chart.total, 245_000);
  // مبيعات اليوم هي آخر يوم في السلسلة، وهي نفسها في بطاقة الأرقام الصغيرة.
  assert.equal(view.chart.days[6].value, SELF_WEEK.sales[6]);
  assert.equal(formatMoney(view.chart.days[6].value), view.tiles[1].value);
  assert.ok(view.chart.days[6].isToday);
});

test("فواتير اليوم للموظف: الظاهر + المخفي = مبيعات اليوم", () => {
  const shown = sum(SELF_TODAY_INVOICES.shown.map((row) => row.amount));
  const total = shown + SELF_TODAY_INVOICES.hiddenTotal;
  assert.equal(total, SELF_WEEK.sales[6]);
  const view = buildDashboard({ role: "CS_AGENT", now: NOW });
  assert.equal(view.table.footerTotal, formatMoney(SELF_WEEK.sales[6]));
});

test("لوحة المدير: النقد تحت الإدارة = خزن الفروع + المتوقَّع في العهد", () => {
  const view = buildDashboard({ role: "MANAGER", now: NOW });
  const vault = sum(BRANCHES.map((branch) => branch.vault));
  const custody = sum(CUSTODIES.map(expectedInHand));
  assert.equal(vault, 5_545_000);
  assert.equal(custody, 925_500);
  assert.equal(view.money.value, vault + custody);
  assert.equal(formatMoney(view.money.value), "64,705.00");
});

test("تصفية المدير بفرع واحد تُعيد أرقام ذلك الفرع لا أرقام الشركة", () => {
  const all = buildDashboard({ role: "MANAGER", now: NOW });
  const arh = buildDashboard({ role: "MANAGER", branchId: "ARH", now: NOW });
  const arhBranch = BRANCHES.find((branch) => branch.id === "ARH");
  const arhCustody = sum(CUSTODIES.filter((item) => item.branchId === "ARH").map(expectedInHand));

  assert.equal(arh.money.value, arhBranch.vault + arhCustody);
  assert.equal(formatMoney(arh.money.value), "39,225.00");
  assert.equal(arh.chart.total, sum(arhBranch.weekSales));
  assert.equal(arh.table.rows.length, 1);
  assert.ok(arh.focus.count < all.focus.count);
  assert.equal(arh.tiles[0].value, "1");
});

test("ما يحتاج إجراءً: لكل دور ما يخصه، والعدد هو مجموع ما في النطاق", () => {
  const manager = buildDashboard({ role: "MANAGER", now: NOW });
  assert.equal(manager.focus.count, 11);
  assert.equal(manager.focus.items.length, 4);

  const accountant = buildDashboard({ role: "ACCOUNTANT", now: NOW });
  assert.equal(accountant.focus.count, 5);
  assert.equal(accountant.money.value, 502_500);

  const employee = buildDashboard({ role: "CS_AGENT", now: NOW });
  assert.equal(employee.focus.count, 5);
  // لا يرى الموظف أرقام الشركة: لا خزن ولا مخزون ولا إجمالي فروع.
  assert.ok(!JSON.stringify(employee.tiles).includes("قيمة المخزون"));
});

test("المحاسب لا يتجاوز نطاق فرعه حتى لو طُلب منه فرع آخر", () => {
  const view = buildDashboard({ role: "ACCOUNTANT", branchId: "SHM", now: NOW });
  assert.equal(view.branchId, "ARH");
  assert.equal(view.scope.label, "فرع العريش");
});

test("الرسم: ٧ أيام، وأطول شريط هو ١٠٠٪", () => {
  const view = buildDashboard({ role: "MANAGER", now: NOW });
  assert.equal(view.chart.days.length, 7);
  assert.equal(Math.max(...view.chart.days.map((day) => day.pct)), 100);
  assert.equal(view.chart.total, 884_000);
  assert.equal(formatMoney(view.chart.total), "8,840.00");
});

test("تنسيق المبالغ: خانتان عشريتان وأرقام لاتينية", () => {
  assert.equal(formatMoney(0), "0.00");
  assert.equal(formatMoney(6470500), "64,705.00");
  assert.equal(formatMoney(4500), "45.00");
  assert.equal(formatMoney(MONTH.net), "51,240.00");
  assert.equal(formatMoney(MONTH.outstanding), "18,450.00");
});

/* ---------- الهيكل العام والأنماط المشتركة ---------- */
import {
  NAV,
  NOTIFICATIONS,
  SETTLEMENT_ROWS,
  navFor,
  badgesFor,
  unreadCount,
  settlementTable,
  settlementTotals,
  shellStats,
  formatInt,
} from "./model.mjs";

test("القائمة: كل دور يرى ما يفتحه فقط، والشارات من مصدر واحد", () => {
  const manager = navFor("MANAGER");
  const accountant = navFor("ACCOUNTANT");
  const employee = navFor("CS_AGENT");

  const ids = (groups) => groups.flatMap((group) => group.items.map((item) => item.id));
  assert.ok(ids(employee).includes("sales-new"));
  assert.ok(!ids(employee).includes("expenses"), "الموظف لا يفتح المصروفات");
  assert.ok(!ids(employee).includes("setup"), "الموظف لا يفتح الإعدادات");
  assert.ok(!ids(accountant).includes("users"), "المحاسب لا يدير المستخدمين");
  assert.ok(ids(manager).includes("users"));

  // شارة «مهامي» تساوي مجموع «ما يحتاج إجراءً» للدور نفسه
  assert.equal(badgesFor("MANAGER").tasks, 11);
  assert.equal(badgesFor("ACCOUNTANT").tasks, 5);
  assert.equal(badgesFor("CS_AGENT").tasks, 5);
  assert.equal(badgesFor("MANAGER").settlements, 4);

  // كل عنصر في القائمة له أيقونة ومسار، ولا مجموعة بلا عناصر
  for (const group of NAV) {
    assert.ok(group.items.length > 0);
    for (const item of group.items) {
      assert.ok(item.icon && item.href, `عنصر ناقص: ${item.id}`);
    }
  }
});

test("التنبيهات: غير المقروء يحسب، والأحدث أولًا", () => {
  assert.equal(unreadCount(), 3);
  assert.equal(NOTIFICATIONS[0].unread, true);
  assert.equal(NOTIFICATIONS.at(-1).unread, false);
});

test("جدول التسويات: الفرق = المعدود − المتوقَّع، والمعلّق هو ما ينتظر إجراءً", () => {
  const row = SETTLEMENT_ROWS.find((item) => item.id === "ST-1039");
  assert.equal(settlementTable.diff(row), -8_400); // عجز ٨٤.٠٠ جنيهًا
  assert.equal(settlementTable.isOpen(row), true);

  const cancelled = SETTLEMENT_ROWS.find((item) => item.id === "ST-1035");
  assert.equal(settlementTable.isOpen(cancelled), false);

  const totals = settlementTotals();
  assert.equal(totals.open, 4);
  assert.equal(totals.openValue, 925_500); // يساوي المتوقَّع في العهد على مستوى الشركة
  assert.equal(totals.shortage, 11_400);
  assert.equal(formatMoney(totals.openValue), "9,255.00");
  assert.equal(formatMoney(totals.shortage), "114.00");
});

test("شريط الأرقام الكثيف: ستة أرقام، وقيمها من مجاميع الجدول نفسها", () => {
  const stats = shellStats();
  assert.equal(stats.length, 6);
  const totals = settlementTotals();
  assert.equal(stats[0].value, formatInt(totals.open));
  assert.equal(stats[1].value, formatMoney(totals.openValue));
  assert.equal(stats[3].value, formatMoney(totals.shortage));
  for (const stat of stats) {
    assert.ok(stat.label && stat.value && stat.hint, `رقم ناقص: ${stat.label}`);
  }
});
