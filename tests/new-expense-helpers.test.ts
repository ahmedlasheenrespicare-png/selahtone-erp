import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculateInclusiveTaxExtract,
  detectExpenseDuplicateRisk,
  extractFrequentBeneficiaries,
  normalizeMoneyInput,
  parseOptionalMoneyCents,
  parsePositiveMoneyCents,
  shiftIsoDateDays,
  suggestCategoryTemplates,
} from "../src/lib/finance/new-expense-helpers";

test("normalizeMoneyInput and parsePositiveMoneyCents accept Arabic-Indic digits and separators", () => {
  assert.equal(normalizeMoneyInput("١,٢٥٠٫٥٠"), "1250.50");
  assert.equal(parsePositiveMoneyCents("٢٥٠"), 25000n);
  assert.equal(parsePositiveMoneyCents("0"), null);
  assert.deepEqual(parseOptionalMoneyCents("  "), { empty: true, cents: 0n });
  assert.deepEqual(parseOptionalMoneyCents("١٤٠"), { empty: false, cents: 14000n });
});

test("calculateInclusiveTaxExtract extracts exact 14% VAT and 5% schedule tax from gross amount", () => {
  const vat14 = calculateInclusiveTaxExtract(114000n, 14); // 1,140.00 EGP gross
  assert.equal(vat14.taxCents, 14000n);
  assert.equal(vat14.netBeforeTaxCents, 100000n);
  assert.equal(vat14.taxInputString, "140");
  assert.equal(vat14.netFormatted, "1,000.00");

  const sch5 = calculateInclusiveTaxExtract(105000n, 5); // 1,050.00 EGP gross
  assert.equal(sch5.taxCents, 5000n);
  assert.equal(sch5.netBeforeTaxCents, 100000n);
  assert.equal(sch5.taxInputString, "50");
});

test("detectExpenseDuplicateRisk prioritizes document number collision then same-day amount collision", () => {
  const samples = [
    {
      id: "12",
      branchId: "1",
      categoryName: "إيجار ومرافق",
      expenseDate: "2026-11-04",
      amount: "450.00",
      description: "فاتورة كهرباء",
      beneficiary: "شركة الكهرباء",
      documentNumber: "INV-9981",
    },
  ];

  const docDup = detectExpenseDuplicateRisk(
    {
      branchId: "2",
      categoryName: "شحن",
      expenseDate: "2026-11-01",
      amountCents: 10000n,
      documentNumber: "inv-9981",
    },
    samples,
  );
  assert.equal(docDup?.kind, "DOCUMENT");
  assert.equal(docDup?.matched.id, "12");

  const amtDup = detectExpenseDuplicateRisk(
    {
      branchId: "1",
      categoryName: "إيجار ومرافق",
      expenseDate: "2026-11-04",
      amountCents: 45000n,
      documentNumber: "",
    },
    samples,
  );
  assert.equal(amtDup?.kind, "SAME_DAY_AMOUNT");
});

test("suggestCategoryTemplates, extractFrequentBeneficiaries and shiftIsoDateDays work accurately", () => {
  const rentTemplates = suggestCategoryTemplates("إيجار ومرافق");
  assert.ok(rentTemplates.some((t) => t.includes("كهرباء") || t.includes("إيجار")));

  const bens = extractFrequentBeneficiaries([
    {
      id: "1",
      branchId: "1",
      categoryName: "شحن",
      expenseDate: "2026-11-04",
      amount: "90.00",
      description: "شحن",
      beneficiary: "أرامكس",
    },
    {
      id: "2",
      branchId: "1",
      categoryName: "شحن",
      expenseDate: "2026-11-03",
      amount: "110.00",
      description: "شحن",
      beneficiary: "أرامكس",
    },
  ]);
  assert.equal(bens[0]?.name, "أرامكس");
  assert.equal(bens[0]?.count, 2);

  assert.equal(shiftIsoDateDays("2026-11-04", -1), "2026-11-03");
});
