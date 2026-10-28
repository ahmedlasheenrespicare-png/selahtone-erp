/**
 * اختبارات محرك الضريبة — تُشغّل بـ: npm run check:tax
 * الهدف: التأكد أن الأرقام المعلنة في وثيقة التصميم هي نفسها التي ينتجها الكود.
 */
import { lineTax, invoiceTotals, money, round2 } from "../src/lib/tax";

let passed = 0;
let failed = 0;

function expect(actual: number | string, expected: number | string, label: string) {
  const a = typeof actual === "number" ? money(actual) : actual;
  const e = typeof expected === "number" ? money(expected) : expected;
  if (a === e) {
    passed++;
    console.log(`  ✓ ${label}: ${a}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}: الناتج ${a} — المتوقع ${e}`);
  }
}

console.log("\n[1] ضريبة 14% على 18,500");
{
  const r = lineTax(18500, [{ code: "VAT14", rate: 0.14 }]);
  expect(r.total, 2590, "إجمالي الضريبة");
  expect(18500 + r.total, 21090, "الإجمالي مع الضريبة");
}

console.log("\n[2] ضريبة مركّبة 14% ثم 8% = 22% (تراكمية أو مركّبة)");
{
  const r = lineTax(18500, [
    { code: "VAT14", rate: 0.14 },
    { code: "COMP8", rate: 0.08, compoundOnPrevious: true },
  ]);
  expect(r.total, 4277.2, "إجمالي الضريبة");
  expect(18500 + r.total, 22777.2, "الإجمالي مع الضريبة");
  expect(r.detail[1].base, 21090, "وعاء المكوّن الثاني");
}

console.log("\n[3] مكوّنان مستقلان 14% + 8% على الوعاء نفسه = 22%");
{
  const r = lineTax(18500, [
    { code: "VAT14", rate: 0.14 },
    { code: "SCHED8", rate: 0.08 },
  ]);
  expect(r.total, 4070, "إجمالي الضريبة");
  expect(18500 + r.total, 22570, "الإجمالي مع الضريبة");
}

console.log("\n[4] ضريبة 5% على أجهزة طبية");
{
  const r = lineTax(18500, [{ code: "VAT5", rate: 0.05 }]);
  expect(r.total, 925, "إجمالي الضريبة");
}

console.log("\n[5] معفى");
{
  const r = lineTax(18500, [{ code: "EXEMPT", rate: 0 }]);
  expect(r.total, 0, "إجمالي الضريبة");
}

console.log("\n[6] فاتورة مختلطة: سماعة 5% + بطاريات 14% + خدمة معفاة");
{
  const t = invoiceTotals([
    { description: "سماعة Phonak A30", qty: 1, unitPrice: 18500, components: [{ code: "VAT5", rate: 0.05 }] },
    { description: "بطاريات 312 × 10", qty: 10, unitPrice: 45, components: [{ code: "VAT14", rate: 0.14 }] },
    { description: "جلسة ضبط", qty: 1, unitPrice: 150, components: [{ code: "EXEMPT", rate: 0 }] },
  ]);
  expect(t.subtotal, 19100, "الإجمالي قبل الضريبة");
  expect(t.taxTotal, round2(925 + 63), "إجمالي الضريبة (925 + 63)");
  expect(t.total, round2(19100 + 988), "الإجمالي النهائي");
  expect(t.taxByComponent.length, 3, "عدد مكوّنات الضريبة المحفوظة (بما فيها المعفى بضريبة صفر)");
}

console.log("\n[7] خصم فاتورة 1,000 على فاتورة مختلطة — يُوزّع قبل الضريبة");
{
  const t = invoiceTotals(
    [
      { description: "سماعة", qty: 1, unitPrice: 18500, components: [{ code: "VAT5", rate: 0.05 }] },
      { description: "بطاريات", qty: 10, unitPrice: 45, components: [{ code: "VAT14", rate: 0.14 }] },
    ],
    1000,
  );
  expect(t.discount, 1000, "إجمالي الخصم");
  expect(t.taxableBase, 17950, "الوعاء الخاضع بعد توزيع الخصم");
  // التقريب يتم على ضريبة كل بند قبل الجمع: 876.19 + 59.68
expect(t.taxTotal, 935.87, "الضريبة بعد توزيع الخصم (تقريب لكل بند)");
}

console.log("\n[8] رفض النسب غير الصالحة");
{
  let threw = false;
  try {
    lineTax(100, [{ code: "BAD", rate: 1.5 }]);
  } catch {
    threw = true;
  }
  if (threw) {
    passed++;
    console.log("  ✓ رفض نسبة > 100%");
  } else {
    failed++;
    console.error("  ✗ لم يرفض نسبة > 100%");
  }
}

console.log(`\n============================================`);
console.log(`النتيجة: ${passed} ناجح · ${failed} فاشل`);
console.log(`============================================\n`);
if (failed > 0) process.exit(1);
