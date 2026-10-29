import { test } from "node:test";
import assert from "node:assert/strict";
import { isCurrentPath, navigationGroups } from "../src/app/(app)/navigation-items";

test("manager and accountant navigation retains the existing available pages", () => {
  const items = navigationGroups(true).flatMap((group) => group.items);
  assert.deepEqual(items.filter((item) => item.href).map((item) => item.href), ["/dashboard", "/inventory", "/sales", "/setup"]);
  assert.deepEqual(items.filter((item) => !item.href).map((item) => item.label), ["المصروفات", "العهد النقدية", "التقارير الضريبية"]);
});

test("counter navigation does not expose the management setup link", () => {
  const items = navigationGroups(false).flatMap((group) => group.items);
  assert.deepEqual(items.filter((item) => item.href).map((item) => item.href), ["/dashboard", "/inventory", "/sales"]);
  assert.deepEqual(items.filter((item) => !item.href).map((item) => item.label), ["عهدتي", "إيرادي اليومي"]);
});

test("the current navigation entry matches only its route and nested routes", () => {
  assert.equal(isCurrentPath("/inventory", "/inventory"), true);
  assert.equal(isCurrentPath("/inventory/123", "/inventory"), true);
  assert.equal(isCurrentPath("/inventory-extra", "/inventory"), false);
  assert.equal(isCurrentPath("/dashboard", "/inventory"), false);
});
