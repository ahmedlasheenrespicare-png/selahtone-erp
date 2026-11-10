import assert from "node:assert/strict";
import test from "node:test";

import {
  ACCESS_PAGES,
  accessKeyAllowed,
  accessRulesAllowKey,
  ALL_ACCESS_KEYS,
  DEFAULT_ADMIN_EMAILS,
  KNOWN_ACCESS_KEYS,
  canonicalPageForRoute,
  hiddenAccessCss,
  isSystemAdmin,
  isEditableAccessKey,
  parseAdminEmails,
  resolveHiddenKeys,
  writeAllowedForKeys,
} from "../src/lib/access-control";

test("registry keys are unique and every key is known", () => {
  const seen = new Set<string>();
  for (const key of ALL_ACCESS_KEYS) {
    assert.equal(seen.has(key), false, `duplicate key: ${key}`);
    seen.add(key);
    assert.equal(KNOWN_ACCESS_KEYS.has(key), true);
  }
});

test("no known key hides the admin or setup system areas", () => {
  for (const key of ALL_ACCESS_KEYS) {
    assert.equal(key === "/admin" || key === "/setup", false);
    assert.equal(key.startsWith("/admin#") || key.startsWith("/setup#"), false);
  }
});

test("the dashboard can never be hidden but its inside parts can", () => {
  const dashboard = ACCESS_PAGES.find((page) => page.route === "/dashboard");
  assert.equal(dashboard?.always, true);
  assert.equal(dashboard?.elements.some((el) => el.key.startsWith("/dashboard#")), true);
  // مفتاح الكتابة لا يُضاف للبلوحة الدائمة المسموحة.
  assert.equal(dashboard?.elements.some((el) => el.key === "/dashboard#write"), false);
});

test("default resolution hides nothing (current behavior for all roles)", () => {
  const hidden = resolveHiddenKeys(new Map(), new Map());
  assert.equal(hidden.size, 0);
});

test("a role template hides, an account override re-opens or tightens", () => {
  const role = new Map<string, boolean>([
    ["/finance/expenses", false],
    ["/sales/new#write", false],
  ]);
  const userAllow = new Map<string, boolean>([["/finance/expenses", true]]);
  const userDeny = new Map<string, boolean>([["/sales/new", false]]);

  // قالب الدور يطبَّق حرفيًا.
  assert.equal(resolveHiddenKeys(role, new Map()).has("/finance/expenses"), true);
  assert.equal(resolveHiddenKeys(role, new Map()).has("/sales/new#write"), true);
  // استثناء الحساب يفتح صفحة أغلقها قالب دور (الاتجاه الإيجابي يعمل).
  assert.equal(resolveHiddenKeys(role, userAllow).has("/finance/expenses"), false);
  // استثناء الحساب يغلق صفحة لم يغلقها قالب الدور (الاتجاه السلبي يعمل).
  assert.equal(resolveHiddenKeys(role, userDeny).has("/sales/new"), true);
});

test("stored keys that no longer exist in the registry are ignored", () => {
  const stale = new Map<string, boolean>([
    ["/legacy-screen", false],
    ["/old/page#write", false],
  ]);
  const hidden = resolveHiddenKeys(stale, stale);
  assert.equal(hidden.size, 0);
});

test("system admin is the MANAGER role with an allow-listed email only", () => {
  const emails = ["manager@selahtone.local"];
  assert.equal(isSystemAdmin("MANAGER", "manager@selahtone.local", emails), true);
  assert.equal(isSystemAdmin("MANAGER", "  Manager@Selahtone.Local  ", emails), true);
  assert.equal(isSystemAdmin("ACCOUNTANT", "manager@selahtone.local", emails), false);
  assert.equal(isSystemAdmin("MANAGER", "arh@selahtone.local", emails), false);
  assert.equal(isSystemAdmin("CS_AGENT", "manager@selahtone.local", emails), false);
  assert.equal(isSystemAdmin(null, null, emails), false);
});

test("ADMIN_EMAILS env parsing trims, lowercases and falls back to the default", () => {
  assert.deepEqual(parseAdminEmails(undefined), [...DEFAULT_ADMIN_EMAILS]);
  assert.deepEqual(parseAdminEmails(""), [...DEFAULT_ADMIN_EMAILS]);
  assert.deepEqual(parseAdminEmails("   , , "), [...DEFAULT_ADMIN_EMAILS]);
  assert.deepEqual(parseAdminEmails("Owner@x.test,  other@y.test "), ["owner@x.test", "other@y.test"]);
});

test("dynamic subroutes canonicalize to their parent registry key", () => {
  assert.equal(canonicalPageForRoute("/sales"), "/sales");
  assert.equal(canonicalPageForRoute("/sales/123"), "/sales");
  assert.equal(canonicalPageForRoute("/sales/123?tab=refund"), "/sales");
  assert.equal(canonicalPageForRoute("/finance/expenses/456"), "/finance/expenses");
  assert.equal(canonicalPageForRoute("/finance/expenses/new"), "/finance/expenses/new");
  assert.equal(canonicalPageForRoute("/sales/"), "/sales");
  assert.equal(canonicalPageForRoute("/nothing/here"), null);
  assert.equal(canonicalPageForRoute("/salesX"), null);
  assert.equal(canonicalPageForRoute("/"), null);
});

test("hidden CSS covers registered selectors and the generic data-ac rule", () => {
  const hidden = new Set(["/dashboard#part-wallet", "/sales/new#write"]);
  const css = hiddenAccessCss(hidden);
  assert.match(css, /data-dash-part="wallet"\]\{display:none !important\}/);
  assert.match(css, /\[data-ac="\/dashboard#part-wallet"\]\{display:none !important\}/);
  // مفتاح كتابة بلا عنصر واجهة: يُفرض خادميًا فقط، لا قواعد CSS.
  assert.equal(css.includes("/sales/new#write"), false);
  assert.equal(hiddenAccessCss(new Set()), "");
});


test("the partial admin panel exposes only implemented permission keys", () => {
  for (const key of ["/sales", "/sales/new", "/sales/new#write", "/inventory/opening#write", "/finance", "/finance#write", "/finance/expenses/new#write", "/sales#collect", "/sales#refund", "/sales#return", "/finance/expenses#approve", "/finance/expenses#pay", "/finance/expenses#review"]) assert.equal(isEditableAccessKey(key), true, key);
  for (const key of ["/dashboard", "/dashboard#part-wallet", "/finance/reports#write", "/sales/stats#write", "/invented"]) assert.equal(isEditableAccessKey(key), false, key);
});


test("write policy enforces page, page-write and the finance-wide write lock", () => {
  assert.equal(writeAllowedForKeys(new Set(), "/finance/expenses/new"), true);
  assert.equal(writeAllowedForKeys(new Set(["/finance/expenses/new"]), "/finance/expenses/new"), false);
  assert.equal(writeAllowedForKeys(new Set(["/finance/expenses/new#write"]), "/finance/expenses/new"), false);
  assert.equal(writeAllowedForKeys(new Set(["/finance#write"]), "/finance/expenses/new"), false);
  assert.equal(writeAllowedForKeys(new Set(["/finance#write"]), "/sales/new"), true);
  assert.equal(writeAllowedForKeys(new Set(["/finance/expenses#write"]), "/finance/expenses/new"), true);
  assert.equal(writeAllowedForKeys(new Set(["/finance#write"]), "/finance"), false);
});


test("an individual action needs page permission, write permission and its own permission", () => {
  const key = "/sales#collect";
  assert.equal(writeAllowedForKeys(new Set(), key), true);
  assert.equal(writeAllowedForKeys(new Set(["/sales#collect"]), key), false);
  assert.equal(writeAllowedForKeys(new Set(["/sales#write"]), key), false);
  assert.equal(writeAllowedForKeys(new Set(["/sales"]), key), false);
  assert.equal(writeAllowedForKeys(new Set(["/sales#refund"]), key), true);
});


test("finance action permissions also respect finance and page write locks", () => {
  const key = "/finance/expenses#approve";
  for (const denied of ["/finance#write", "/finance/expenses", "/finance/expenses#write", key]) {
    assert.equal(writeAllowedForKeys(new Set([denied]), key), false, denied);
  }
  assert.equal(writeAllowedForKeys(new Set(["/finance/expenses#pay"]), key), true);
});


test("count permissions remain independent while higher write locks take precedence", () => {
  assert.equal(isEditableAccessKey("/finance/counts#request"), true);
  assert.equal(writeAllowedForKeys(new Set(["/finance/counts#confirm"]), "/finance/counts#cancel"), true);
  assert.equal(writeAllowedForKeys(new Set(["/finance/counts#write"]), "/finance/counts#cancel"), false);
  assert.equal(writeAllowedForKeys(new Set(["/finance#write"]), "/finance/counts#request-holder"), false);
});


test("transfer and settlement decisions have independent operation keys", () => {
  for (const key of ["/finance/transfers#transfer", "/finance/transfers#confirm-settlement", "/finance/transfers#reject-settlement"]) assert.equal(isEditableAccessKey(key), true);
  assert.equal(writeAllowedForKeys(new Set(["/finance/transfers#confirm-settlement"]), "/finance/transfers#reject-settlement"), true);
  assert.equal(writeAllowedForKeys(new Set(["/finance/transfers#write"]), "/finance/transfers#transfer"), false);
});


test("custody and settlement action keys obey the finance-wide lock", () => {
  for (const key of ["/finance#close-custody", "/finance/accounts#open", "/finance/accounts#decide-custody", "/finance/mine#request-custody", "/finance/mine#submit-count", "/finance/settlements#cancel", "/finance/settlements/new#request"]) {
    assert.equal(isEditableAccessKey(key), true, key);
    assert.equal(writeAllowedForKeys(new Set(["/finance#write"]), key), false, key);
  }
});


test("category creation and editing are independent", () => {
  for (const key of ["/finance/categories#create", "/finance/categories#edit"]) assert.equal(isEditableAccessKey(key), true);
  assert.equal(writeAllowedForKeys(new Set(["/finance/categories#create"]), "/finance/categories#edit"), true);
  assert.equal(writeAllowedForKeys(new Set(["/finance/categories#write"]), "/finance/categories#edit"), false);
});


test("dynamic links obey their registered page permission without blocking allowed siblings", () => {
  const hidden = new Set(["/sales", "/finance/expenses", "/dashboard"]);
  assert.equal(accessKeyAllowed(hidden, "/sales/123?tab=payments"), false);
  assert.equal(accessKeyAllowed(hidden, "/sales/new"), true);
  assert.equal(accessKeyAllowed(hidden, "/finance/expenses/99?view=1"), false);
  assert.equal(accessKeyAllowed(hidden, "/finance/expenses/new"), true);
  assert.equal(accessKeyAllowed(hidden, "/dashboard"), true);
  assert.equal(accessKeyAllowed(hidden, "/unknown"), true);
});


test("sales catalog operations are editable, independent and obey parent locks", () => {
  const keys = ["create-category", "edit-category", "change-category-status", "create-type", "edit-type", "change-type-status", "create-field", "edit-field", "change-field-status"].map(suffix => `/sales/catalog#${suffix}`);
  for (const key of keys) {
    assert.equal(isEditableAccessKey(key), true, key);
    assert.equal(writeAllowedForKeys(new Set([key]), key), false, key);
    assert.equal(writeAllowedForKeys(new Set(["/sales/catalog#write"]), key), false, key);
    assert.equal(writeAllowedForKeys(new Set(["/sales/catalog"]), key), false, key);
    assert.equal(writeAllowedForKeys(new Set(keys.filter(other => other !== key)), key), true, key);
  }
});

test("partial return and cancellation permissions are independent under the sales write lock", () => {
  const ret = "/sales#return", cancel = "/sales#cancel";
  assert.equal(isEditableAccessKey(ret), true);
  assert.equal(isEditableAccessKey(cancel), true);
  assert.equal(writeAllowedForKeys(new Set([ret]), cancel), true);
  assert.equal(writeAllowedForKeys(new Set([cancel]), ret), true);
  for (const parent of ["/sales", "/sales#write"]) {
    assert.equal(writeAllowedForKeys(new Set([parent]), ret), false);
    assert.equal(writeAllowedForKeys(new Set([parent]), cancel), false);
  }
});

test("the always-open dashboard exposes only the implemented hint permission", () => {
  assert.equal(isEditableAccessKey("/dashboard"), false);
  assert.equal(isEditableAccessKey("/dashboard#focus-hint"), true);
  assert.equal(isEditableAccessKey("/dashboard#part-today-invoices"), false);
  assert.equal(writeAllowedForKeys(new Set(["/dashboard"]), "/dashboard#focus-hint"), true);
  assert.equal(writeAllowedForKeys(new Set(["/dashboard#focus-hint"]), "/dashboard#focus-hint"), false);
});

test("dashboard expense card stays unavailable until duplicate details are protected", () => {
  assert.equal(isEditableAccessKey("/dashboard#part-today-expenses"), false);
});

test("dashboard expense detail access is independent of other dashboard elements", () => {
  const key = "/dashboard#expense-details";
  assert.equal(isEditableAccessKey(key), true);
  assert.equal(accessKeyAllowed(new Set(), key), true);
  assert.equal(accessKeyAllowed(new Set([key]), key), false);
  assert.equal(accessKeyAllowed(new Set(["/dashboard#focus-hint"]), key), true);
  assert.equal(isEditableAccessKey("/dashboard#part-today-expenses"), false);
});

test("dashboard invoice details have an independent implemented permission", () => {
  const key = "/dashboard#invoice-details";
  assert.equal(isEditableAccessKey(key), true);
  assert.equal(accessKeyAllowed(new Set(), key), true);
  assert.equal(accessKeyAllowed(new Set([key]), key), false);
  assert.equal(accessKeyAllowed(new Set(["/dashboard#expense-details"]), key), true);
  for (const card of ["/dashboard#part-today-invoices", "/dashboard#part-today-collections"]) assert.equal(isEditableAccessKey(card), false);
});

test("inventory page cost permission is editable and independent", () => {
  const key = "/inventory#cost-details";
  assert.equal(isEditableAccessKey(key), true);
  assert.equal(accessKeyAllowed(new Set(), key), true);
  assert.equal(accessKeyAllowed(new Set([key]), key), false);
  assert.equal(accessKeyAllowed(new Set([key]), "/inventory"), true);
});

test("inventory receipt and form cost permissions are independent", () => {
  const keys = ["/inventory/receipts#unit-cost", "/inventory/opening#purchase-cost-hint", "/inventory/receipts/new#purchase-cost-hint"];
  for (const key of keys) {
    assert.equal(isEditableAccessKey(key), true);
    assert.equal(accessKeyAllowed(new Set(), key), true);
    assert.equal(accessKeyAllowed(new Set([key]), key), false);
    for (const other of keys.filter((candidate) => candidate !== key)) assert.equal(accessKeyAllowed(new Set([key]), other), true);
  }
});

test("dashboard stock value permission is independent and editable", () => {
  const key = "/dashboard#stock-value";
  assert.equal(isEditableAccessKey(key), true);
  assert.equal(accessKeyAllowed(new Set(), key), true);
  assert.equal(accessKeyAllowed(new Set([key]), key), false);
  assert.equal(accessKeyAllowed(new Set([key]), "/dashboard#invoice-details"), true);
  assert.equal(accessKeyAllowed(new Set([key]), "/inventory#cost-details"), true);
});

test("dashboard profitability is independent from stock and invoice permissions", () => {
  const key = "/dashboard#profitability";
  assert.equal(isEditableAccessKey(key), true);
  assert.equal(accessKeyAllowed(new Set(), key), true);
  assert.equal(accessKeyAllowed(new Set([key]), key), false);
  for (const other of ["/dashboard#stock-value", "/dashboard#invoice-details", "/inventory#cost-details"]) {
    assert.equal(accessKeyAllowed(new Set([key]), other), true);
  }
});


test("panel rule result distinguishes read-only data from write-locked forms", () => {
  assert.equal(accessRulesAllowKey(new Set(["/inventory#write"]), "/inventory#cost-details"), true);
  assert.equal(accessRulesAllowKey(new Set(["/inventory"]), "/inventory#cost-details"), false);
  assert.equal(accessRulesAllowKey(new Set(["/inventory#cost-details"]), "/inventory#cost-details"), false);
  assert.equal(accessRulesAllowKey(new Set(["/inventory/receipts#write"]), "/inventory/receipts#unit-cost"), true);
  assert.equal(accessRulesAllowKey(new Set(["/inventory/opening#write"]), "/inventory/opening#purchase-cost-hint"), false);
  assert.equal(accessRulesAllowKey(new Set(["/sales/catalog#write"]), "/sales/catalog#edit-field"), false);
  assert.equal(accessRulesAllowKey(new Set(["/finance#write"]), "/finance/expenses#pay"), false);
  assert.equal(accessRulesAllowKey(new Set(["/dashboard"]), "/dashboard#stock-value"), true);
  assert.equal(accessRulesAllowKey(new Set(), "/unknown#key"), false);
});


test("sales statistics profitability is an independent read-only permission", () => {
  const key = "/sales/stats#profitability";
  assert.ok(KNOWN_ACCESS_KEYS.has(key)); assert.ok(isEditableAccessKey(key));
  assert.equal(accessRulesAllowKey(new Set(["/sales/stats#write"]), key), true);
  assert.equal(accessRulesAllowKey(new Set(["/sales/stats"]), key), false);
  assert.equal(accessRulesAllowKey(new Set([key]), key), false);
});


test("refund balances are a separate permission scoped to the refund form", () => {
  const key = "/sales#refund-balances";
  assert.ok(isEditableAccessKey(key));
  assert.equal(accessRulesAllowKey(new Set(), key), true);
  for (const denied of [key, "/sales", "/sales#write", "/sales#refund"]) {
    assert.equal(accessRulesAllowKey(new Set([denied]), key), false, denied);
  }
  assert.equal(writeAllowedForKeys(new Set([key]), "/sales#refund"), true);
  assert.equal(accessRulesAllowKey(new Set(["/finance"]), key), true);
});

test("unknown authorization-call keys do not grant writes, including plausible typos", () => {
  const hidden = new Set<string>();
  for (const key of ["/sales#collec", "/finance/transfers#unknown", "/inventory/newww", "", "/sales/123", "/finance#WRITE"]) {
    assert.equal(writeAllowedForKeys(hidden, key), false, `${key} must fail closed`);
  }
  assert.equal(writeAllowedForKeys(hidden, "/sales#collect"), true);
  assert.equal(writeAllowedForKeys(hidden, "/inventory/new"), true);
});

test("permission store failure hides all registered restrictions except the safe redirect page", async () => {
  const { ACCESS_PAGES, hiddenOnAccessStoreFailure, accessKeyAllowed, writeAllowedForKeys } = await import("../src/lib/access-control");
  const hidden = hiddenOnAccessStoreFailure();
  for (const page of ACCESS_PAGES) {
    assert.equal(accessKeyAllowed(hidden, page.route), Boolean(page.always), page.route);
    for (const element of page.elements) {
      assert.equal(accessKeyAllowed(hidden, element.key), false, element.key);
      assert.equal(writeAllowedForKeys(hidden, element.key), false, element.key);
    }
    if (!page.always) assert.equal(writeAllowedForKeys(hidden, page.route), false, page.route);
  }
});
