import assert from "node:assert/strict";
import test from "node:test";

import { navigationGroups, type NavigationAccess } from "../src/app/(app)/navigation-items";

/** صلاحيات كاملة (الوضع الافتراضي في النظام). */
const FULL_ACCESS: NavigationAccess = { isPageAllowed: () => true, showAdministration: true };
/** مكافئ «النطاق المختصر» القديم: لوحة القيادة + المبيعات/الفواتير + المصروفات + دليل المالية، بلا صلاحيات إدارة. */
const LIMITED_ACCESS: NavigationAccess = {
  isPageAllowed: (href: string) =>
    ["/dashboard", "/sales", "/finance/expenses", "/finance/help"].some(
      (prefix) => href === prefix || href.startsWith(`${prefix}/`),
    ),
  showAdministration: false,
};

const labels = (groups: ReturnType<typeof navigationGroups>) => groups.map((group) => group.label);
const itemsOf = (groups: ReturnType<typeof navigationGroups>, label: string) =>
  groups.find((group) => group.label === label)?.items ?? [];
const hrefs = (groups: ReturnType<typeof navigationGroups>) =>
  groups.flatMap((group) => group.items.map((item) => item.href ?? ""));
const flatHrefs = (groups: ReturnType<typeof navigationGroups>) =>
  groups.flatMap((group) =>
    group.items.flatMap((item) =>
      item.children ? item.children.map((child) => child.href ?? "") : [item.href ?? ""],
    ),
  );
const assertDestinationRule = (groups: ReturnType<typeof navigationGroups>) => {
  for (const group of groups) {
    for (const item of group.items) {
      if (item.children) {
        assert.ok(item.children.length > 0, `العنصر «${item.label}» بلا أبناء`);
        for (const child of item.children) assert.ok(child.href, `العنصر «${child.label}» بلا رابط`);
      } else {
        assert.ok(item.href, `العنصر «${item.label}» بلا رابط`);
      }
    }
  }
};

test("management navigation is grouped, and every item has a real destination", () => {
  // المخزون معطّل افتراضيًا: يُمرَّر true لاختبار مساره صراحةً.
  const groups = navigationGroups(true, true, FULL_ACCESS, true);
  assert.deepEqual(labels(groups), ["الرئيسية", "المبيعات والمخزون", "المالية", "الإدارة"]);

  // لا توجد عناصر نائبة بلا وجهة: الأب يُقبل بأبنائه (لا آبائ بلا أبناء ولا أبناء بلا رابط).
  assertDestinationRule(groups);

  assert.deepEqual(itemsOf(groups, "الرئيسية").map((item) => item.href), ["/dashboard"]);
  const salesSection = itemsOf(groups, "المبيعات والمخزون");
  const salesParent = salesSection.find((item) => item.children);
  assert.deepEqual(
    salesParent?.children?.map((child) => child.href),
    ["/sales", "/sales/new", "/sales/stats", "/sales/catalog", "/sales/settings"],
  );
  assert.deepEqual(salesSection.filter((item) => !item.children).map((item) => item.href), ["/inventory"]);
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
  const groups = navigationGroups(true, false, FULL_ACCESS, true);
  assert.deepEqual(labels(groups), ["الرئيسية", "المبيعات والمخزون", "الإدارة"]);
  assert.equal(hrefs(groups).some((href) => href.startsWith("/finance")), false);
});

test("staff navigation shows branch work only, without management screens", () => {
  const groups = navigationGroups(false, true, FULL_ACCESS, true);
  assert.deepEqual(labels(groups), ["الرئيسية", "أعمال الفرع"]);
  assert.deepEqual(flatHrefs(groups), [
    "/dashboard",
    "/sales",
    "/sales/new",
    "/inventory",
    "/finance/mine",
    "/finance/expenses",
    "/finance/expenses/new",
    "/finance/settlements",
  ]);

  // لا يظهر للموظف أي شاشة إدارة: لا بنود ولا جرد ولا خزائن ولا تحويلات ولا إعداد.
  const all = flatHrefs(groups);
  for (const management of ["/finance/accounts", "/finance/counts", "/finance/categories", "/finance/transfers", "/admin", "/setup"]) {
    assert.equal(all.includes(management), false, `ظهور ${management} للموظف`);
  }
  assertDestinationRule(groups);
});

test("staff navigation keeps sales and inventory while the module is off", () => {
  const groups = navigationGroups(false, false, FULL_ACCESS, true);
  assert.deepEqual(labels(groups), ["الرئيسية", "أعمال الفرع"]);
  assert.deepEqual(flatHrefs(groups), ["/dashboard", "/sales", "/sales/new", "/inventory"]);
  assert.equal(hrefs(groups).some((href) => href.startsWith("/finance")), false);
});

test("a restricted manager sees only the permitted pages and never the administration", () => {
  const groups = navigationGroups(true, true, LIMITED_ACCESS, false);
  assert.deepEqual(labels(groups), ["الرئيسية", "المبيعات", "المالية"]);
  assert.deepEqual(itemsOf(groups, "الرئيسية").map((item) => item.href), ["/dashboard"]);
  assert.deepEqual(itemsOf(groups, "المالية").map((item) => item.href), ["/finance/expenses"]);

  const salesParent = itemsOf(groups, "المبيعات").find((item) => item.children);
  // ملاحظة: بادئة «/sales» تُبقي كل صفحات البيع نفسها مسموحة (كما كان في النطاق المختصر القديم).
  assert.deepEqual(salesParent?.children?.map((child) => child.href), [
    "/sales",
    "/sales/new",
    "/sales/stats",
    "/sales/catalog",
    "/sales/settings",
  ]);

  const all = flatHrefs(groups);
  for (const blocked of ["/admin", "/setup", "/inventory", "/finance", "/finance/accounts", "/finance/counts", "/finance/categories", "/finance/transfers"]) {
    assert.equal(all.includes(blocked), false, `ظهور ${blocked} لحساب صلاحياته مقيّدة`);
  }
  assertDestinationRule(groups);
});

test("a restricted accountant hides the finance group while the module is off", () => {
  const groups = navigationGroups(true, false, LIMITED_ACCESS, false);
  assert.deepEqual(labels(groups), ["الرئيسية", "المبيعات"]);
  assert.equal(hrefs(groups).some((href) => href.startsWith("/finance")), false);
});

test("management navigation hides inventory while it is switched off", () => {
  const groups = navigationGroups(true, true);
  assert.deepEqual(labels(groups), ["الرئيسية", "المبيعات", "المالية", "الإدارة"]);
  assert.equal(flatHrefs(groups).some((href) => href.startsWith("/inventory")), false);
  const salesParent = itemsOf(groups, "المبيعات").find((item) => item.children);
  assert.deepEqual(salesParent?.children?.map((child) => child.href), [
    "/sales",
    "/sales/new",
    "/sales/stats",
    "/sales/catalog",
    "/sales/settings",
  ]);
});

test("staff navigation hides inventory while it is switched off", () => {
  const groups = navigationGroups(false, true);
  assert.deepEqual(flatHrefs(groups), [
    "/dashboard",
    "/sales",
    "/sales/new",
    "/finance/mine",
    "/finance/expenses",
    "/finance/expenses/new",
    "/finance/settlements",
  ]);
  assert.equal(hrefs(groups).some((href) => href.startsWith("/inventory")), false);
});

test("administration screens exist only for the system admin", () => {
  const withAdmin = navigationGroups(true, true, FULL_ACCESS, true);
  const withoutAdmin = navigationGroups(true, true, { ...FULL_ACCESS, showAdministration: false }, true);
  assert.ok(hrefs(withAdmin).includes("/admin"), "الإدارة ظاهرة للأدمن");
  assert.ok(hrefs(withAdmin).includes("/setup"), "الجاهزية ظاهرة للأدمن");
  assert.equal(hrefs(withoutAdmin).includes("/admin"), false);
  assert.equal(hrefs(withoutAdmin).includes("/setup"), false);
});
