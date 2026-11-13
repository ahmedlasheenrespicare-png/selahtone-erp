import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  FIN_STEP_STATUS_LABEL,
  invoiceLifecycleSteps,
  settlementLifecycleSteps,
  settlementRequestSteps,
  transferLifecycleSteps,
  type FinStep,
} from "../src/components/finance/fin-stepper-model";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const status = (steps: FinStep[], key: string) => steps.find((step) => step.key === key)?.status;

function assertSingleCurrent(steps: FinStep[]) {
  assert.ok(steps.filter((step) => step.status === "current").length <= 1, "أكثر من خطوة حالية واحدة");
  for (const step of steps) assert.ok(FIN_STEP_STATUS_LABEL[step.status], `حالة بلا نص: ${step.status}`);
}

test("الفاتورة: المتبقي/open رصيد لا يتحولان إلى اكتمال، والإلغاء ليس نجاحًا", () => {
  const due = invoiceLifecycleSteps({
    cancelled: false, hasReturns: false, allReturned: false,
    netCollectedCents: 400n, refundedCents: 0n,
    dueFromCustomerCents: 600n, dueToCustomerCents: 0n,
  });
  assert.equal(status(due, "collection"), "current");
  assert.equal(status(due, "balance"), "pending");
  assert.equal(status(due, "returns-refunds"), "skipped");
  assertSingleCurrent(due);

  const paid = invoiceLifecycleSteps({
    cancelled: false, hasReturns: false, allReturned: false,
    netCollectedCents: 1000n, refundedCents: 0n,
    dueFromCustomerCents: 0n, dueToCustomerCents: 0n,
  });
  assert.equal(status(paid, "collection"), "done");
  assert.equal(status(paid, "balance"), "done");

  const refundDue = invoiceLifecycleSteps({
    cancelled: false, hasReturns: true, allReturned: false,
    netCollectedCents: 1000n, refundedCents: 200n,
    dueFromCustomerCents: 0n, dueToCustomerCents: 300n,
  });
  assert.equal(status(refundDue, "returns-refunds"), "current");
  assert.equal(status(refundDue, "balance"), "pending");
  assertSingleCurrent(refundDue);

  const cancelled = invoiceLifecycleSteps({
    cancelled: true, hasReturns: true, allReturned: true,
    netCollectedCents: 0n, refundedCents: 0n,
    dueFromCustomerCents: 0n, dueToCustomerCents: 0n,
  });
  assert.equal(status(cancelled, "collection"), "stopped");
  assert.equal(status(cancelled, "balance"), "stopped");
  assert.equal(status(cancelled, "returns-refunds"), "done", "المرتجع المسجّل قبل الإلغاء يبقى حقيقة مكتملة");
  assert.notEqual(status(cancelled, "collection"), "done");
  assert.notEqual(status(cancelled, "balance"), "done");
});

test("التسوية: OPEN/CONFIRMED/REJECTED/CANCELLED والرفض لا يلون الأثر أخضر", () => {
  const open = settlementLifecycleSteps({ status: "OPEN" });
  assert.equal(status(open, "decision"), "current");
  assert.equal(status(open, "record"), "pending");
  assertSingleCurrent(open);

  const blocked = settlementLifecycleSteps({ status: "OPEN", blocked: true });
  assert.equal(status(blocked, "decision"), "blocked");
  assertSingleCurrent(blocked);

  const confirmed = settlementLifecycleSteps({ status: "CONFIRMED", transferAmount: "200.00", resolutionReason: "استلمت الفرق" });
  assert.ok(confirmed.every((step) => step.status === "done"));
  assert.match(confirmed[2].description ?? "", /200\.00/);
  const zero = settlementLifecycleSteps({ status: "CONFIRMED", transferAmount: "0.00" });
  assert.match(zero[2].description ?? "", /بلا مبلغ تحويل/);

  for (const s of ["REJECTED", "CANCELLED"] as const) {
    const steps = settlementLifecycleSteps({ status: s, resolutionReason: "سبب" });
    assert.equal(status(steps, "decision"), "stopped");
    assert.equal(status(steps, "record"), "skipped");
  }
  const unknown = settlementLifecycleSteps({ status: "MYSTERY" });
  assert.equal(status(unknown, "decision"), "blocked");
});

test("طلب التسوية وسند التحويل: المراجعة والحفظ والنجاح مراحل نصية بلا اعتماد ذاتي", () => {
  const request = settlementRequestSteps({ submitted: false, ready: false, reviewing: false, saving: false, hasError: false });
  assert.equal(status(request, "count"), "current");
  assert.equal(status(request, "decision"), "pending");
  assertSingleCurrent(request);
  const saving = settlementRequestSteps({ submitted: false, ready: true, reviewing: true, saving: true, hasError: false });
  assert.equal(status(saving, "submit"), "current");
  assertSingleCurrent(saving);
  const submitted = settlementRequestSteps({ submitted: true, ready: true, reviewing: true, saving: false, hasError: false });
  assert.equal(status(submitted, "decision"), "current");
  assertSingleCurrent(submitted);

  const transfer = transferLifecycleSteps({ saved: false, reviewing: false, saving: false, ready: false, hasError: false });
  assert.equal(status(transfer, "parties"), "current");
  assertSingleCurrent(transfer);
  const saved = transferLifecycleSteps({ saved: true, reviewing: true, saving: false, ready: true, hasError: false });
  assert.ok(saved.every((step) => step.status === "done"));
  assert.match(saved[3].description ?? "", /خارج النظام/);
});

test("المكوّن مشترك ومقروء نصيًا، والاستخدامات القديمة والجديدة تمر به", () => {
  const component = read("src/components/finance/fin-stepper.tsx");
  const css = read("src/components/finance/fin-stepper.css");
  assert.match(component, /aria-current=\{step\.status === "current" \? "step" : undefined\}/);
  assert.match(component, /FIN_STEP_STATUS_LABEL\[step\.status\]/);
  assert.match(css, /@media print/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /data-color-mode="dark"/);
  for (const path of [
    "src/app/(app)/sales/[saleId]/page.tsx",
    "src/app/(app)/finance/settlements/page.tsx",
    "src/app/(app)/finance/settlements/settlement-forms.tsx",
    "src/app/(app)/finance/transfers/settlement-decisions.tsx",
    "src/app/(app)/finance/transfers/transfer-form.tsx",
    "src/app/(app)/finance/expenses/new/page.tsx",
    "src/app/(app)/finance/expenses/[expenseId]/page.tsx",
    "src/app/(app)/finance/accounts/page.tsx",
  ]) {
    const src = read(path);
    assert.match(src, /FinStepper/, `${path} لا يستخدم المكوّن المشترك`);
    assert.ok(!src.includes('className="fin-stepper__step'), `${path} ما زال يكرر markup الخطوات`);
  }
  assert.ok(!read("src/app/(app)/workspace.css").includes(".fin-stepper__step"));
  assert.ok(!read("src/app/(app)/dark-mode.css").includes(".fin-stepper__step"));
});

test("تباين حالات الشريط نهارًا وليلًا >= 4.5:1", () => {
  const luminance = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const pairs: Array<[string, string, string]> = [
    ["مكتملة نهارًا", "#15803d", "#f0fdf4"],
    ["حالية نهارًا", "#b45309", "#fffbeb"],
    ["متوقفة نهارًا", "#9f1239", "#fff1f2"],
    ["منتهية نهارًا", "#475569", "#f8fafc"],
    ["مكتملة ليلًا", "#bbf7d0", "#10251a"],
    ["حالية ليلًا", "#fde68a", "#2b2113"],
    ["متوقفة ليلًا", "#fecaca", "#3b171b"],
  ];
  for (const [label, fg, bg] of pairs) assert.ok(contrast(fg, bg) >= 4.5, `${label}: ${contrast(fg, bg).toFixed(2)}`);
});
