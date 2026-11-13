import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { expensePaidRingPercent, statRingAngleDegrees } from "../src/components/stat-ring-pill-model";

const page = readFileSync(new URL("../src/app/(app)/finance/expenses/page.tsx", import.meta.url), "utf8");
const strip = readFileSync(new URL("../src/components/finance/fin-kpi-strip.tsx", import.meta.url), "utf8");
const ring = readFileSync(new URL("../src/components/stat-ring-pill.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/components/stat-ring-pill.css", import.meta.url), "utf8");
const financeCss = readFileSync(new URL("../src/app/(app)/finance/finance.css", import.meta.url), "utf8");

test("نسبة المدفوع تعتمد مجموع القرش لا عدد المصروفات، وتُقرَّب لجزء من عشرة", () => {
  assert.equal(expensePaidRingPercent({ expenseCount: 3, totalCents: 235000n, paidCents: 30000n }), 12.8);
  assert.equal(expensePaidRingPercent({ expenseCount: 2, totalCents: 33333n, paidCents: 11111n }), 33.3);
  assert.equal(expensePaidRingPercent({ expenseCount: 1, totalCents: 100n, paidCents: 0n }), 0);
  assert.equal(expensePaidRingPercent({ expenseCount: 1, totalCents: 100n, paidCents: 100n }), 100);
  assert.equal(statRingAngleDegrees(12.8), 46.1);
});

test("السجل الفارغ والمقام غير الموجب لا يعرضان نسبة مضللة", () => {
  assert.equal(expensePaidRingPercent({ expenseCount: 0, totalCents: 0n, paidCents: 0n }), null);
  assert.equal(expensePaidRingPercent({ expenseCount: 2, totalCents: 0n, paidCents: 0n }), null);
  assert.equal(expensePaidRingPercent({ expenseCount: 2, totalCents: -100n, paidCents: 0n }), null);
  assert.equal(expensePaidRingPercent({ expenseCount: 1, totalCents: 100n, paidCents: -1n }), null);
  assert.equal(expensePaidRingPercent({ expenseCount: Number.NaN, totalCents: 100n, paidCents: 0n }), null);
  assert.equal(expensePaidRingPercent({ expenseCount: 1, totalCents: 100n, paidCents: 150n }), 100);
});

test("الحلقة اختيارية في شريط المالية ولا تغيّر البطاقات الأخرى أو الروابط", () => {
  assert.match(strip, /ring\?: \{/);
  assert.match(strip, /item\.ring \? \(/);
  assert.match(strip, /<AppIcon name=\{item\.icon\} \/>/);
  assert.match(strip, /item\.href \? \(/);
  assert.match(strip, /fin-kpi-card--ring/);
  assert.match(ring, /export function StatRing\(/);
  assert.match(ring, /data-empty=\{isEmpty \? "true" : "false"\}/);
});

test("حلقة المدفوع في الشريط وحلقة المعلق الشهرية تحفظان المجاميع والصلاحيات", () => {
  // حلقة الشريط للمدفوع من إجمالي السجل، وحلقة بطاقة المؤشر للمعلق من إجمالي الشهر.
  assert.equal((page.match(/ring: \{/g) ?? []).length, 2);
  assert.match(page, /expensePaidRingPercent\(\{ expenseCount: rows\.length, totalCents, paidCents \}\)/);
  assert.match(page, /label: "مدفوع فعليًا"/);
  assert.match(page, /displayMoney\(paidCents\)/);
  assert.match(page, /عدد المصروفات المدفوعة: \$\{paidCount\}/);
  assert.match(page, /emptyLabel: rows\.length === 0 \? "لا مصروفات" : "غير متاح"/);
  assert.match(page, /await requirePageAccess\("\/finance\/expenses"\)/);
  assert.match(page, /financePage\(\)/);
  assert.match(page, /listExpenses\(\{ serializable: \(work\) => work\(tx\) \}, session\.id\)/);
  assert.match(page, /totalCents \+= cents/);
  assert.match(page, /paidCents \+= cents/);
});

test("الحلقة ترث توكنز المالية والليلي وتبقى ثابتة عند تقليل الحركة والطباعة", () => {
  assert.match(css, /\.finance-suite \.stat-ring-pill__ring-wrap/);
  assert.match(css, /var\(--fn-primary-btn/);
  assert.match(css, /var\(--fn-accent/);
  assert.match(css, /\.workspace-shell\[data-color-mode="dark"\] \.finance-suite \.stat-ring-pill__ring-wrap/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /@media print/);
  assert.match(financeCss, /\.fin-kpi-card--ring/);
  assert.match(financeCss, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(financeCss, /@media print/);
});
