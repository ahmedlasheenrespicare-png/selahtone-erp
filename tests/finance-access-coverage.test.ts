import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { ACCESS_PAGES } from "../src/lib/access-control";

const financeDir = join(process.cwd(), "src/app/(app)/finance");
const paths: Record<string, string> = {
  "page.tsx": "/finance", "accounts/page.tsx": "/finance/accounts", "categories/page.tsx": "/finance/categories",
  "counts/page.tsx": "/finance/counts", "expenses/page.tsx": "/finance/expenses",
  "expenses/[expenseId]/page.tsx": "/finance/expenses", "expenses/reviews/page.tsx": "/finance/expenses", "expenses/new/page.tsx": "/finance/expenses/new",
  "expenses/today/page.tsx": "/finance/expenses/today", "help/page.tsx": "/finance/help",
  "mine/page.tsx": "/finance/mine", "reports/page.tsx": "/finance/reports",
  "settlements/page.tsx": "/finance/settlements", "settlements/new/page.tsx": "/finance/settlements/new",
  "transfers/page.tsx": "/finance/transfers",
};
const actions: Record<string, string> = {
  openAccountAction: "/finance/accounts#open", closeAccountAction: "/finance#close-custody", transferCashAction: "/finance/transfers#transfer",
  createExpenseAction: "/finance/expenses/new", approveExpenseAction: "/finance/expenses#approve", payExpenseAction: "/finance/expenses#pay", requestExpenseReviewAction: "/finance/expenses#review", closeExpenseReviewAction: "/finance/expenses#review",
  requestCountAction: "/finance/counts#request", confirmCountAction: "/finance/counts#confirm", cancelCountAction: "/finance/counts#cancel",
  createCategoryAction: "/finance/categories#create", editCategoryAction: "/finance/categories#edit", requestSettlementAction: "/finance/settlements/new#request",
  confirmSettlementAction: "/finance/transfers#confirm-settlement", rejectSettlementAction: "/finance/transfers#reject-settlement", cancelSettlementAction: "/finance/settlements#cancel",
  requestCustodyAction: "/finance/mine#request-custody", decideCustodyRequestAction: "/finance/accounts#decide-custody", requestCountFromHolderAction: "/finance/counts#request-holder", submitHolderCountAction: "/finance/mine#submit-count",
};

test("each financial page applies its own page guard", () => {
  for (const [file, route] of Object.entries(paths)) {
    const source = readFileSync(join(financeDir, file), "utf8");
    assert.ok(source.includes(`await requirePageAccess("${route}")`), `${file} missing ${route}`);
  }
});

test("each finance server action uses a fixed, registered route and common write guard", () => {
  const source = readFileSync(join(financeDir, "actions.ts"), "utf8");
  const exported = [...source.matchAll(/export async function (\w+)\(/g)].map((match) => match[1]);
  assert.deepEqual([...exported].sort(), Object.keys(actions).sort());
  assert.equal((source.match(/await writeAccessAllowed\(route\)/g) ?? []).length, 2);
  for (const [name, route] of Object.entries(actions)) {
    const start = source.indexOf(`export async function ${name}(`);
    const next = source.indexOf("export async function ", start + 1);
    const definition = source.slice(start, next < 0 ? undefined : next);
    const firstGuard = definition.match(/const guard = await requireFinance(?:Manager|Writer)\("([^"]+)"\)/);
    assert.equal(firstGuard?.[1], route, `${name} must use ${route}`);
    const pageRoute = route.split("#")[0];
    assert.ok(ACCESS_PAGES.some((page) => page.route === pageRoute && page.elements.some((item) => item.key === `${pageRoute}#write`) && (!route.includes("#") || page.elements.some((item) => item.key === route))), `${route} needs registered keys`);
  }
});


test("count and transfer forms receive independent server-computed permissions", () => {
  const counts = readFileSync(join(financeDir, "counts/page.tsx"), "utf8");
  const countForm = readFileSync(join(financeDir, "counts/count-forms.tsx"), "utf8");
  const transfers = readFileSync(join(financeDir, "transfers/page.tsx"), "utf8");
  const decisions = readFileSync(join(financeDir, "transfers/settlement-decisions.tsx"), "utf8");
  for (const key of ["request", "confirm", "cancel", "request-holder"]) assert.ok(counts.includes(`writeAllowedForKeys(access.hidden, "/finance/counts#${key}")`));
  assert.ok(countForm.includes('canConfirm ? "CONFIRM" : "CANCEL"'));
  assert.ok(countForm.includes("canCancel ? <button"));
  assert.ok(countForm.includes("canConfirm ? <button"));
  for (const key of ["transfer", "confirm-settlement", "reject-settlement"]) assert.ok(transfers.includes(`writeAllowedForKeys(access.hidden, "/finance/transfers#${key}")`));
  assert.ok(decisions.includes("{canConfirm ? <form action={confirmAction}"));
  assert.ok(decisions.includes("{canReject ? <form action={rejectAction}"));
});

test("account, custody, settlement and category forms are gated by their operation keys", () => {
  const pairs: Array<[string, string]> = [
    ["page.tsx", "/finance#close-custody"],
    ["accounts/page.tsx", "/finance/accounts#open"],
    ["accounts/page.tsx", "/finance/accounts#decide-custody"],
    ["mine/page.tsx", "/finance/mine#request-custody"],
    ["mine/page.tsx", "/finance/mine#submit-count"],
    ["settlements/page.tsx", "/finance/settlements#cancel"],
    ["settlements/new/page.tsx", "/finance/settlements/new#request"],
    ["categories/page.tsx", "/finance/categories#create"],
    ["categories/page.tsx", "/finance/categories#edit"],
  ];
  for (const [file, key] of pairs) {
    const source = readFileSync(join(financeDir, file), "utf8");
    assert.ok(source.includes(`writeAllowedForKeys(access.hidden, "${key}")`), `${file}: ${key}`);
  }
  const accountView = readFileSync(join(financeDir, "finance-accounts-view.tsx"), "utf8");
  const categoryView = readFileSync(join(financeDir, "categories/categories-directory-view.tsx"), "utf8");
  assert.ok(accountView.includes("account.canClose && canCloseCustody"));
  assert.ok(categoryView.includes("canEdit && isEditing"));
});
