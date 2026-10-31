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
