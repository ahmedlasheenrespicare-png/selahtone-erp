import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDashboardSidebarChildren,
  resolveActiveSidebarHref,
  sidebarNavigationGroups,
} from "../src/app/(app)/navigation-items";
import {
  DASHBOARD_SECTION_IDS,
  type DashboardSectionId,
  type DashboardSectionMeta,
  getDashboardSectionGuide,
  groupDashboardSections,
  resolveDashboardSectionId,
  stepDashboardSection,
} from "../src/lib/dashboard-sections";

const SAMPLE_AVAILABLE: DashboardSectionId[] = ["pulse-wallet", "all", "pulse", "wallet", "monthly-sales", "aging-radar", "live-feed"];

test("resolveDashboardSectionId accepts valid available section and falls back cleanly for unknown or unauthorized sections", () => {
  assert.equal(resolveDashboardSectionId("aging-radar", SAMPLE_AVAILABLE), "aging-radar");
  assert.equal(resolveDashboardSectionId("all", SAMPLE_AVAILABLE), "all");
  assert.equal(resolveDashboardSectionId("governance", SAMPLE_AVAILABLE), "pulse-wallet");
  assert.equal(resolveDashboardSectionId("unknown-key", SAMPLE_AVAILABLE), "pulse-wallet");
  assert.equal(resolveDashboardSectionId(null, SAMPLE_AVAILABLE), "pulse-wallet");
});

test("stepDashboardSection moves next and previous with circular wrap-around", () => {
  assert.equal(stepDashboardSection("pulse-wallet", SAMPLE_AVAILABLE, 1), "all");
  assert.equal(stepDashboardSection("pulse-wallet", SAMPLE_AVAILABLE, -1), "live-feed");
  assert.equal(stepDashboardSection("live-feed", SAMPLE_AVAILABLE, 1), "pulse-wallet");
  assert.equal(stepDashboardSection("wallet", SAMPLE_AVAILABLE, 1), "monthly-sales");
});

test("groupDashboardSections groups items in canonical executive order", () => {
  const metas: DashboardSectionMeta[] = [
    { id: "live-feed", group: "operations", label: "السجل الحي", description: "آخر الحركات", icon: "receipt", stageKind: "wide" },
    { id: "pulse-wallet", group: "modes", label: "نبض اليوم والحافظة", description: "الوضع المركّز", icon: "dashboard", stageKind: "pulse-wallet" },
    { id: "monthly-sales", group: "spotlights", label: "مبيعات الشهر", description: "منحنى الشهر", icon: "sales", stageKind: "card" },
  ];
  const grouped = groupDashboardSections(metas);
  assert.deepEqual(grouped.map((g) => g.group), ["modes", "spotlights", "operations"]);
  assert.equal(grouped[0].items[0].id, "pulse-wallet");
});

test("كل خيار في لوحة القيادة موثق وله إعدادات إظهار وإخفاء مشروحة", () => {
  for (const id of DASHBOARD_SECTION_IDS) {
    const guide = getDashboardSectionGuide(id);
    assert.ok(guide.summary.length > 20, `${id} يحتاج شرحًا واضحًا`);
    assert.ok(guide.howToRead.length > 15, `${id} يحتاج طريقة قراءة`);
    assert.ok(guide.whenToAct.length > 15, `${id} يحتاج إرشادًا عمليًا`);
    assert.ok(guide.toggles.length >= 2, `${id} يحتاج إعدادات فرعية`);
    assert.equal(new Set(guide.toggles.map((item) => item.key)).size, guide.toggles.length);
    for (const item of guide.toggles) {
      assert.ok(item.label.length > 2);
      assert.ok(item.explanation.length > 8);
    }
  }
  assert.ok(getDashboardSectionGuide("profitability").summary.includes("الربحية"));
  assert.ok(getDashboardSectionGuide("pulse").toggles.some((item) => item.key === "pulse-comparison"));
});

test("لوحة القيادة في الشريط الجانبي تضم قائمة منسدلة بجميع أقسام اللوحة حسب الدور وتفعّل القسم النشط بدقة", () => {
  const managerGroups = sidebarNavigationGroups("MANAGER", { financeEnabled: true, menuScope: "FULL", inventoryEnabled: true });
  const dashboardItem = managerGroups[0]?.items.find((i) => i.label === "لوحة القيادة");
  assert.ok(dashboardItem?.children && dashboardItem.children.length >= 16);
  assert.ok(dashboardItem.children.some((c) => c.href === "/dashboard?section=aging-radar"));
  assert.ok(dashboardItem.children.some((c) => c.href === "/dashboard?section=governance"));
  const staffChildren = buildDashboardSidebarChildren("CS_AGENT", true);
  assert.equal(staffChildren.some((c) => c.href === "/dashboard?section=governance"), false);
  assert.ok(staffChildren.some((c) => c.label === "حركة الأصناف والسيريالات"));
  assert.equal(resolveActiveSidebarHref("/dashboard", managerGroups), "/dashboard");
  assert.equal(resolveActiveSidebarHref("/dashboard", managerGroups, "pulse-wallet"), "/dashboard");
  assert.equal(resolveActiveSidebarHref("/dashboard", managerGroups, "aging-radar"), "/dashboard?section=aging-radar");
});
