import assert from "node:assert/strict";
import test from "node:test";

import { navigationGroups } from "../src/app/(app)/navigation-items";

const labels = (groups: ReturnType<typeof navigationGroups>) => groups.map((group) => group.label);
const itemsOf = (groups: ReturnType<typeof navigationGroups>, label: string) =>
  groups.find((group) => group.label === label)?.items ?? [];
const hrefs = (groups: ReturnType<typeof navigationGroups>) =>
  groups.flatMap((group) => group.items.map((item) => item.href ?? ""));

test("management navigation is grouped, and every item has a real destination", () => {
  const groups = navigationGroups(true, true);
  assert.deepEqual(labels(groups), ["الرئيسية", "المبيعات والمخزون", "المالية", "الإدارة"]);

  // لا توجد عناصر نائبة بلا رابط في أي مجموعة.
  for (const group of groups) {
    for (const item of group.items) assert.ok(item.href, `العنصر «${item.label}» بلا رابط`);
  }

  assert.deepEqual(itemsOf(groups, "الرئيسية").map((item) => item.href), ["/dashboard"]);
  assert.deepEqual(itemsOf(groups, "المبيعات والمخزون").map((item) => item.href), ["/sales", "/inventory"]);
  assert.deepEqual(itemsOf(groups, "المالية").map((item) => item.href), [
    "/finance",
    "/finance/accounts",
    "/finance/transfers",
    "/finance/expenses",
    "/finance/counts",
    "/finance/categories",
  ]);
  assert.deepEqual(itemsOf(groups, "الإدارة").map((item) => item.href), ["/admin", "/setup"]);
});

test("management navigation hides the finance group while the module is off", () => {
  const groups = navigationGroups(true, false);
  assert.deepEqual(labels(groups), ["الرئيسية", "المبيعات والمخزون", "الإدارة"]);
  assert.equal(hrefs(groups).some((href) => href.startsWith("/finance")), false);
});

test("staff navigation shows branch work only, without management screens", () => {
  const groups = navigationGroups(false, true);
  assert.deepEqual(labels(groups), ["الرئيسية", "أعمال الفرع"]);
  assert.deepEqual(itemsOf(groups, "أعمال الفرع").map((item) => item.href), [
    "/sales",
    "/inventory",
    "/finance/mine",
    "/finance/expenses",
    "/finance/expenses/new",
    "/finance/settlements",
  ]);

  // لا يظهر للموظف أي شاشة إدارة: لا بنود ولا جرد ولا خزائن ولا تحويلات ولا إعداد.
  const all = hrefs(groups);
  for (const management of ["/finance/accounts", "/finance/counts", "/finance/categories", "/finance/transfers", "/admin", "/setup"]) {
    assert.equal(all.includes(management), false, `ظهور ${management} للموظف`);
  }
  for (const group of groups) for (const item of group.items) assert.ok(item.href, `العنصر «${item.label}» بلا رابط`);
});

test("staff navigation keeps sales and inventory while the module is off", () => {
  const groups = navigationGroups(false, false);
  assert.deepEqual(labels(groups), ["الرئيسية", "أعمال الفرع"]);
  assert.deepEqual(itemsOf(groups, "أعمال الفرع").map((item) => item.href), ["/sales", "/inventory"]);
  assert.equal(hrefs(groups).some((href) => href.startsWith("/finance")), false);
});

test("a limited manager sees the dashboard, sales and expenses only", () => {
  const groups = navigationGroups(true, true, "LIMITED");
  assert.deepEqual(labels(groups), ["الرئيسية", "المبيعات", "المالية"]);
  assert.deepEqual(itemsOf(groups, "الرئيسية").map((item) => item.href), ["/dashboard"]);
  assert.deepEqual(itemsOf(groups, "المبيعات").map((item) => item.href), ["/sales"]);
  assert.deepEqual(itemsOf(groups, "المالية").map((item) => item.href), ["/finance/expenses", "/finance/expenses/new"]);

  const all = hrefs(groups);
  for (const blocked of ["/admin", "/setup", "/inventory", "/finance/accounts", "/finance/counts", "/finance/categories", "/finance/transfers"]) {
    assert.equal(all.includes(blocked), false, `ظهور ${blocked} لحساب مختصر`);
  }
  for (const group of groups) for (const item of group.items) assert.ok(item.href, `العنصر «${item.label}» بلا رابط`);
});

test("a limited accountant hides the finance group while the module is off", () => {
  const groups = navigationGroups(true, false, "LIMITED");
  assert.deepEqual(labels(groups), ["الرئيسية", "المبيعات"]);
  assert.equal(hrefs(groups).some((href) => href.startsWith("/finance")), false);
});
