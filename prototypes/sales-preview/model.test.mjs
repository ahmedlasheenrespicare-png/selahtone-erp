import test from "node:test";
import assert from "node:assert/strict";
import {
  createInitialState, initialDraft, createSale, validateDraft, draftAmounts, invoiceAmounts,
  recordPayment, registerReturn, returnPreview, setDiscountLimit, distributeDiscount,
  parseHundredths, formatMoney, canSeeInvoice, availableFor,
} from "./model.mjs";

const seed = (state) => state.invoices.find((invoice) => invoice.id === "DEMO-1001");

test("النقود والأرقام العربية تُقرأ دون حساب كسري عشري", () => {
  assert.equal(parseHundredths("١٢٣٤٫٥٦"), 123456);
  assert.equal(parseHundredths("5"), 500);
  assert.equal(parseHundredths("0.09"), 9);
  for (const input of ["", "-1", "1.234", "1,000", "NaN", "12e2"]) assert.equal(parseHundredths(input), null);
  assert.equal(formatMoney(123456789), "1,234,567.89");
});

test("توزيع الخصم يحافظ على كل قرش ولا يتجاوز قيمة أي وحدة", () => {
  for (let a = 0; a <= 15; a++) for (let b = 0; b <= 15; b++) for (let c = 0; c <= 5; c++) {
    const gross = [a, b, c];
    const sum = a + b + c;
    for (let discount = 0; discount <= sum; discount++) {
      const shares = distributeDiscount(gross, discount);
      assert.equal(shares.reduce((n, value) => n + value, 0), discount);
      shares.forEach((value, index) => assert.ok(value >= 0 && value <= gross[index]));
    }
  }
  assert.throws(() => distributeDiscount([1, 2], 4));
});

test("المثال الأول مفصول في الذاكرة ويحتوي فاتورة وعينة جاهزة", () => {
  const state = createInitialState();
  assert.equal(state.role, "staff");
  assert.equal(state.invoices.length, 1);
  const totals = invoiceAmounts(seed(state));
  assert.equal(totals.subtotal, 604000);
  assert.equal(totals.discount, 10000);
  assert.equal(totals.total, 594000);
  assert.equal(totals.paid, 200000);
  assert.equal(totals.due, 394000);
  assert.equal(totals.credit, 0);
  assert.deepEqual(availableFor(state, "demo-a", "aid"), ["SN-DEMO-A101", "SN-DEMO-A102", "SN-DEMO-A103"]);
  assert.equal(availableFor(state, "demo-a", "battery"), 12);
  assert.notEqual(createInitialState(), state);
});

test("البيع يخصم المخزون التجريبي ويحتفظ بالسيريال والضريبة ضمن السعر", () => {
  const before = createInitialState();
  const values = validateDraft(before);
  assert.equal(values.subtotal, 604000);
  assert.equal(values.total, 594000);
  assert.equal(values.paid, 150000);
  assert.equal(values.remaining, 444000);
  assert.ok(values.tax > 0 && values.tax < values.total);
  const result = createSale(before);
  const invoice = result.state.invoices[0];
  assert.equal(result.invoiceId, "DEMO-1002");
  assert.equal(invoice.units.filter((unit) => unit.serial).length, 1);
  assert.equal(invoice.units[0].serial, "SN-DEMO-A101");
  assert.equal(invoiceAmounts(invoice).due, 444000);
  assert.deepEqual(availableFor(result.state, "demo-a", "aid"), ["SN-DEMO-A102", "SN-DEMO-A103"]);
  assert.equal(availableFor(result.state, "demo-a", "battery"), 10);
  assert.equal(availableFor(before, "demo-a", "battery"), 12, "the input state is untouched");
});

test("القيود تمنع البيع دون عميل أو هاتف أو دفعة، والزيادة أو المخزون غير المتاح", () => {
  const state = createInitialState();
  state.draft.customerName = " ";
  assert.throws(() => createSale(state), /اسم العميل/);
  state.draft.customerName = "عميل تجريبي";
  state.draft.phone = "";
  assert.throws(() => createSale(state), /هاتف/);
  state.draft.phone = "01000000000";
  state.draft.initialPayment = "0";
  assert.throws(() => createSale(state), /دفعة أولى/);
  state.draft.initialPayment = "99999";
  assert.throws(() => createSale(state), /لا يمكن أن تزيد/);
  state.draft.initialPayment = "1";
  state.draft.cart[0].serials = ["SN-DEMO-A100"];
  assert.throws(() => createSale(state), /غير متاح/);
  state.draft.cart[0].serials = ["SN-DEMO-A101", "SN-DEMO-A101"];
  assert.throws(() => createSale(state), /مكرر/);
  state.draft.cart[0].serials = ["SN-DEMO-A101"];
  state.draft.cart[1].quantity = 999;
  assert.throws(() => createSale(state), /أكبر من المتاح/);
});

test("الموظف يلتزم بحد الخصم والفرع؛ المدير وحده يغير الحد", () => {
  const state = createInitialState();
  state.draft.discount = "302.00";
  assert.doesNotThrow(() => validateDraft(state));
  state.draft.discount = "302.01";
  assert.throws(() => validateDraft(state), /يتجاوز حد الموظف/);
  assert.throws(() => setDiscountLimit(state, "10"), /للمدير فقط/);
  state.role = "manager";
  const changed = setDiscountLimit(state, "10");
  assert.equal(changed.discountLimitBps, 1000);
  assert.equal(state.discountLimitBps, 500);
  assert.doesNotThrow(() => validateDraft(changed));
  assert.throws(() => setDiscountLimit(state, "100.01"), /من 0 إلى 100/);
  changed.role = "staff";
  changed.draft.branchId = "demo-b";
  assert.throws(() => validateDraft(changed), /فرعه التجريبي فقط/);
});

test("المحاسب يرى الفواتير ويحصّل لكنه لا ينشئ مبيعات", () => {
  const state = createInitialState();
  state.role = "accountant";
  assert.throws(() => createSale(state), /المحاسب لا ينشئ/);
  const after = recordPayment(state, "DEMO-1001", "1000", "wallet").state;
  assert.equal(invoiceAmounts(seed(after)).due, 294000);
  assert.equal(seed(after).payments.at(-1).method, "wallet");
  assert.equal(invoiceAmounts(seed(state)).due, 394000);
  assert.throws(() => recordPayment(state, "DEMO-1001", "0", "cash"), /أكبر من صفر/);
  assert.throws(() => recordPayment(state, "DEMO-1001", "3940.01", "card"), /يزيد على المتبقي/);
});

test("موظف الفرع لا يرى أو يحصّل فاتورة فرع آخر", () => {
  const state = createInitialState();
  state.role = "manager";
  state.draft = { ...initialDraft("demo-b"), customerName: "عميل وهمي", phone: "01000000000", cart: [{ productId: "aid", serials: ["SN-DEMO-B201"] }], discount: "0", initialPayment: "500", method: "card" };
  const result = createSale(state);
  const invoice = result.state.invoices[0];
  result.state.role = "staff";
  assert.equal(canSeeInvoice(result.state, invoice), false);
  assert.throws(() => recordPayment(result.state, invoice.id, "1", "cash"), /خارج نطاق/);
  result.state.role = "accountant";
  assert.equal(canSeeInvoice(result.state, invoice), true);
  assert.doesNotThrow(() => recordPayment(result.state, invoice.id, "1", "cash"));
});

test("المرتجع الجزئي يسدد الباقي أولًا ويعيد المخزون، ولا يكرر المرتجع", () => {
  const state = createInitialState();
  const invoice = seed(state);
  const battery = invoice.units.find((unit) => unit.productId === "battery");
  assert.throws(() => registerReturn(state, invoice.id, [battery.id]), /للمدير فقط/);
  state.role = "manager";
  const before = invoiceAmounts(invoice);
  const outcome = returnPreview(invoice, [battery.id]);
  assert.equal(outcome.dueAfter, before.due - battery.net);
  assert.equal(outcome.creditAfter, 0);
  const next = registerReturn(state, invoice.id, [battery.id], { reason: "تجربة" }).state;
  assert.equal(availableFor(next, "demo-a", "battery"), 13);
  assert.equal(availableFor(state, "demo-a", "battery"), 12);
  assert.equal(invoiceAmounts(seed(next)).due, before.due - battery.net);
  assert.throws(() => registerReturn(next, invoice.id, [battery.id]), /أُرجع بالفعل/);
});

test("مرتجع جهاز مدفوع جزئيًا يحسب المستحق للعميل دون الادعاء برده", () => {
  const state = createInitialState();
  state.role = "manager";
  const invoice = seed(state);
  const aid = invoice.units.find((unit) => unit.productId === "aid");
  const outcome = returnPreview(invoice, [aid.id]);
  assert.equal(outcome.dueAfter, 0);
  assert.ok(outcome.creditAfter > 0);
  const next = registerReturn(state, invoice.id, [aid.id]).state;
  assert.ok(availableFor(next, "demo-a", "aid").includes(aid.serial));
  assert.equal(invoiceAmounts(seed(next)).credit, outcome.creditAfter);
  assert.equal(seed(next).payments.length, 1, "a refund payment is not fabricated");
  assert.throws(() => recordPayment(next, invoice.id, "1", "cash"), /يزيد على المتبقي/);
});

test("الإلغاء الكامل يعيد كل الوحدات ويمنع تحصيلًا إضافيًا", () => {
  const state = createInitialState();
  state.role = "manager";
  const result = registerReturn(state, "DEMO-1001", [], { cancel: true });
  const invoice = seed(result.state);
  assert.equal(invoice.canceled, true);
  assert.equal(invoice.units.filter((unit) => !unit.returned).length, 0);
  assert.equal(invoiceAmounts(invoice).total, 0);
  assert.equal(invoiceAmounts(invoice).credit, 200000);
  assert.equal(availableFor(result.state, "demo-a", "battery"), 14);
  assert.ok(availableFor(result.state, "demo-a", "aid").includes("SN-DEMO-A100"));
  assert.throws(() => recordPayment(result.state, invoice.id, "1", "cash"), /ملغاة/);
  assert.throws(() => registerReturn(result.state, invoice.id, [], { cancel: true }), /لا توجد أصناف/);
});
