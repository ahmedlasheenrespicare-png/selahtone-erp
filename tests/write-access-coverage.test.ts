import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const app = join(process.cwd(), "src/app/(app)");
const read = (file: string) => readFileSync(join(app, file), "utf8");

test("single-purpose write pages hide their forms when page writing is denied", () => {
  const cases: Array<[string, string, string]> = [
    ["sales/new/page.tsx", "/sales/new", "<CatalogSaleForm"],
    ["inventory/new/page.tsx", "/inventory/new", "<ProductForm"],
    ["inventory/opening/page.tsx", "/inventory/opening", "<OpeningForm"],
    ["inventory/receipts/new/page.tsx", "/inventory/receipts/new", "<ReceiptForm"],
  ];
  for (const [file, route, form] of cases) {
    const source = read(file);
    const guard = source.indexOf(`if (!(await writeAccessAllowed("${route}"))) return <WriteLockedNotice`);
    assert.ok(guard >= 0, `${file}: missing read-only guard`);
    assert.ok(source.indexOf(form, guard) > guard, `${file}: guard must precede the form`);
  }
});

test("expense and sales settings controls are conditioned on write permission", () => {
  const expense = read("finance/expenses/new/page.tsx");
  assert.ok(expense.includes('writeAccessAllowed("/finance/expenses/new")'));
  assert.ok(expense.includes("!canWrite ?"));
  const settings = read("sales/settings/page.tsx");
  assert.ok(settings.includes('writeAccessAllowed("/sales/settings")'));
  assert.ok(settings.includes("!canWrite ?"));
 });

test("catalog actions and UI use the same independent operation keys", () => {
  const page = read("sales/catalog/page.tsx");
  const forms = read("sales/catalog/catalog-forms.tsx");
  const actions = read("sales/catalog/actions.ts");
  assert.match(actions, /writeAccessAllowed\(key\)/);
  const cases = [
    ["create-category", "canCreateCategory", "CatalogCreateForms", "createCategoryAction"],
    ["edit-category", "canEditCategory", "CategoryEditForm", "updateCategoryAction"],
    ["change-category-status", "canChangeCategoryStatus", "CategoryActiveForm", "setCategoryActiveAction"],
    ["create-type", "canCreateType", "CatalogCreateForms", "createTypeAction"],
    ["edit-type", "canEditType", "TypeEditForm", "updateTypeAction"],
    ["change-type-status", "canChangeTypeStatus", "TypeActiveForm", "setTypeActiveAction"],
    ["create-field", "canCreateField", "CatalogCreateForms", "createFieldAction"],
    ["edit-field", "canEditField", "FieldEditForm", "updateFieldAction"],
    ["change-field-status", "canChangeFieldStatus", "FieldActiveForm", "setFieldActiveAction"],
  ];
  for (const [suffix, variable, component, action] of cases) {
    const key = `/sales/catalog#${suffix}`;
    assert.ok(page.includes(`writeAccessAllowed("${key}")`), key);
    if (component === "CatalogCreateForms") {
      assert.ok(forms.includes(`${variable} && <section`), variable);
      assert.ok(page.includes(`${variable}={${variable}}`), variable);
    } else assert.ok(page.includes(`${variable} && <${component}`), variable);
    const start = actions.indexOf(`export async function ${action}(`);
    assert.ok(start >= 0, action);
    const next = actions.indexOf("export async function ", start + 1);
    assert.ok(actions.slice(start, next === -1 ? undefined : next).includes(`run("${key}",`), `${action}: wrong key`);
  }
});

test("partial returns and cancellations use separate validated operation permissions", () => {
  const actions = read("sales/actions.ts");
  const start = actions.indexOf("export async function returnAction(");
  const next = actions.indexOf("export async function ", start + 1);
  const action = actions.slice(start, next);
  assert.ok(start >= 0);
  assert.ok(action.indexOf("parseReturnInput(payload(formData))") < action.indexOf('writeAccessAllowed(parsed.value.cancel ? "/sales#cancel" : "/sales#return")'));
  assert.ok(action.indexOf('writeAccessAllowed(parsed.value.cancel ? "/sales#cancel" : "/sales#return")') < action.indexOf("returnCommerceSale("));
  assert.ok(action.includes("parsed.value)"));
  const page = read("sales/[saleId]/page.tsx");
  for (const key of ["/sales#return", "/sales#cancel"]) assert.ok(page.includes(`writeAllowedForKeys(access.hidden, "${key}")`));
  assert.ok(page.includes("(canReturn || canCancel) && <ReturnForm"));
  const form = read("sales/[saleId]/return-form.tsx");
  assert.ok(form.includes("useState(!canReturn && canCancel)"));
  assert.ok(form.includes("{canReturn && <label>"));
  assert.ok(form.includes("{canCancel && <label>"));
});

test("dashboard hint is conditionally rendered and offered without an editable dashboard page", () => {
  const page = read("dashboard/page.tsx");
  const switcher = read("dashboard/dashboard-section-switcher.tsx");
  const panel = read("admin/permissions-panel.tsx");
  assert.ok(page.includes('["/dashboard#focus-hint", "part-focus-hint"]'));
  assert.ok(switcher.includes('!forcedHiddenElements.includes("part-focus-hint") && <div className="dash-focus-hint'));
  assert.ok(panel.includes('isEditableAccessKey(page.route) || page.elements.some((el) => isEditableAccessKey(el.key))'));
  assert.ok(panel.includes('{isEditableAccessKey(page.route) && <option value={page.route}>'));
});

test("a failed permission store has a workspace-wide warning", () => {
  const layout = read("layout.tsx");
  assert.match(layout, /!access\.storeHealthy\s*&&/);
  assert.match(layout, /role="alert">تعذّرت قراءة إعدادات الصلاحيات/);
  assert.match(layout, /أُغلق الوصول المقيّد مؤقتًا/);
});

test("discount settings action forwards both reviewed percentage fields to validation", () => {
  const source = read("sales/actions.ts");
  const start = source.indexOf("export async function discountSettingAction(");
  assert.ok(start >= 0);
  const body = source.slice(start);
  assert.ok(body.includes('writeAccessAllowed("/sales/settings")'));
  assert.ok(body.includes('percent: text(formData, "percent")'));
  assert.ok(body.includes('managerPercent: text(formData, "managerPercent")'));
});

test("dashboard expense detail permission removes every audited detail-bearing slot", () => {
  const page = read("dashboard/page.tsx");
  assert.ok(page.includes('access.isAllowed("/dashboard#expense-details")'));
  assert.match(page, /if \(finOn && showExpenseDetails\)\s*\{\s*try\s*\{\s*todayExpenses = await loadTodayExpenses/);
  assert.ok(page.includes('.filter((item) => showExpenseDetails || item.kind !== "expense")'));
  assert.ok(page.includes('monthlyExpensesNode: ReactNode = showExpenseDetails && financeSpotlights?.monthlyExpenses ?'));
  assert.ok(page.includes('todayExpensesNode: ReactNode = !showExpenseDetails ? null :'));
});

test("invoice detail permission removes audited dashboard slots and search before serialization", () => {
  const page = read("dashboard/page.tsx");
  assert.ok(page.includes('access.isAllowed("/dashboard#invoice-details")'));
  assert.ok(page.includes('searchQuery: showInvoiceDetails ? rawSearchQ || null : null'));
  assert.ok(page.includes('dashboardOmniSearchForm: ReactNode = showInvoiceDetails ?'));
  assert.ok(page.includes('showInvoiceDetails ? pulseData?.recentCommerceEvents ?? [] : []'));
  assert.ok(page.includes('monthlySalesNode: ReactNode = showInvoiceDetails && monthSales ?'));
  assert.ok(page.includes('collectionsNode: ReactNode = showInvoiceDetails && collectionsSpotlight ?'));
  assert.ok(page.includes('agingRadarNode: ReactNode = showInvoiceDetails && execSuite?.agingRadar ?'));
  assert.ok(page.includes('{showInvoiceDetails && <>'));
});

test("sales today renders invoice links only when the detail page is accessible", () => {
  const today = read("sales/today/page.tsx");
  const table = read("sales/sales-invoices-view.tsx");
  assert.ok(today.includes('const canOpenInvoice = canOpen("/sales/1")'));
  assert.ok(today.includes('{canOpenInvoice && <Link'));
  assert.ok(today.includes('canOpenInvoice={canOpenInvoice}'));
  assert.ok(table.includes('{canOpenInvoice ? <Link href={`/sales/${sale.id}`}'));
  assert.ok(table.includes('{canOpenInvoice && <Link href={`/sales/${sale.id}`}'));
  assert.ok(today.includes('writeAllowedForKeys(access.hidden, "/sales/new")'));
});

test("inventory cost visibility does not change branch scope or operation role", () => {
  const page = read("inventory/page.tsx");
  assert.ok(page.includes('const canSeeCost = canSeeAll && access.isAllowed("/inventory#cost-details")'));
  assert.ok(page.includes('where: canSeeAll ? {} :'));
  assert.ok(page.includes('const canCreateProduct = canSeeAll && writeAllowedForKeys'));
  assert.ok(page.includes('const canCreateOpening = canSeeAll && writeAllowedForKeys'));
  assert.ok(page.includes('purchaseCostFormatted: canSeeCost'));
  assert.ok(page.includes('<InventoryProductsView rows={productRows} canSeeCost={canSeeCost} />'));
});

test("inventory receipt cost and product hints are removed before serialization", () => {
  const receipts = read("inventory/receipts/page.tsx");
  assert.ok(receipts.includes('access.isAllowed("/inventory/receipts#unit-cost")'));
  assert.ok(receipts.includes('{showUnitCost && <td>'));
  for (const [page, form, key] of [
    ["inventory/opening/page.tsx", "inventory/opening/opening-form.tsx", "/inventory/opening#purchase-cost-hint"],
    ["inventory/receipts/new/page.tsx", "inventory/receipts/new/receipt-form.tsx", "/inventory/receipts/new#purchase-cost-hint"],
  ]) {
    const source = read(page);
    assert.ok(source.includes(`isAllowed("${key}")`));
    assert.ok(source.includes('purchaseCost: showPurchaseCostHint ? product.purchaseCost.toString() : null'));
    assert.ok(read(form).includes('selectedProduct?.purchaseCost != null'));
  }
});

test("dashboard stock value is not loaded when hidden and is guarded across metric and pulse slots", () => {
  const page = read("dashboard/page.tsx");
  assert.ok(page.includes('access.isAllowed("/dashboard#stock-value")'));
  assert.ok(page.includes('showStockValue ? prisma.stockLevel.findMany'));
  assert.ok(page.includes('...(showStockValue ? [{ label: "قيمة المخزون"'));
  assert.equal((page.match(/isEmployee \|\| !showStockValue \? \(/g) ?? []).length, 4);
});

test("dashboard profitability card and chart data are not serialized when hidden", () => {
  const page = read("dashboard/page.tsx");
  assert.ok(page.includes('session.role === "CS_AGENT" || access.isAllowed("/dashboard#profitability")'));
  assert.ok(page.includes('const fifthSeries = showFifthSpotlight && execSuite?.fifthSpotlight'));
  assert.ok(page.includes('const profitabilityNode: ReactNode = showFifthSpotlight && execSuite?.fifthSpotlight'));
});

test("catalog field editor submits the label expected by its server action", () => {
  const forms = read("sales/catalog/catalog-forms.tsx");
  const actions = read("sales/catalog/actions.ts");
  assert.ok(forms.includes('name={withRequired ? "labelAr" : "nameAr"}'));
  assert.ok(actions.includes('labelAr: text(formData, "labelAr")'));
});


test("permissions panel presents rules, not promises about role or record eligibility", () => {
  const panel = read("admin/permissions-panel.tsx");
  assert.ok(panel.includes('accessRulesAllowKey(hidden, key)'));
  assert.ok(panel.includes('نتيجة قواعد الصلاحيات'));
  assert.ok(panel.includes('قيود الدور أو حالة السجل أو تفعيل الوحدة'));
  assert.ok(!panel.includes('النتيجة الفعلية'));
});


test("sales statistics profitability is guarded before passing data to client components", () => {
  const page = read("sales/stats/page.tsx");
  const ui = read("sales/stats/sales-stats-interactive.tsx");
  assert.ok(page.includes('isAllowed("/sales/stats#profitability")'));
  assert.ok(page.includes('const topItems = showProfitability ? exec.topItems : exec.topItems.map'));
  assert.ok(page.includes('<SalesStatsTopItemsPanel items={topItems} showProfitability={showProfitability} />'));
  assert.ok(page.includes('showProfitability ? { profitability:'));
  assert.ok(ui.includes('exportPayload.profitability ? ["التكلفة (ج.م)"'));
});
