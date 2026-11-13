import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const component = readFileSync(
  new URL("../src/app/(app)/finance/finance-cash-layers.tsx", import.meta.url),
  "utf8",
);
const css = readFileSync(
  new URL("../src/app/(app)/finance/finance-cash-layers.css", import.meta.url),
  "utf8",
);
const page = readFileSync(
  new URL("../src/app/(app)/finance/page.tsx", import.meta.url),
  "utf8",
);

test("طبقات العرض عميل مستقل ولا يستدعي محرك المالية أو Prisma", () => {
  assert.match(component, /^"use client";/);
  assert.doesNotMatch(component, /@\/lib\/finance\/engine|@\/lib\/prisma|financeDb|server-only/);
  assert.doesNotMatch(component, /fetch\(|axios|useEffect\(/);
});

test("ترتيب الطبقات مطابق لمسار النقد المعروض", () => {
  const ids = [...component.matchAll(/id: "(invoice|collection|custody|vault|settlement)"/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(ids, ["invoice", "collection", "custody", "vault", "settlement"]);
});

test("العرض يحترم تقليل الحركة والطباعة ويوفر وضعًا ثابتًا يدويًا", () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /@media print/);
  assert.match(css, /\[data-static="true"\]/);
  assert.match(component, /عرض ثابت/);
  assert.match(component, /aria-pressed=\{staticMode\}/);
});

test("روابط الطبقات تمر من فحص الصلاحيات ولا تظهر لغير المدير/المحاسب", () => {
  assert.match(page, /canManage \? \(\s*<FinanceCashLayers/);
  assert.match(page, /access\.isAllowed\("\/sales"\)/);
  assert.match(page, /access\.isAllowed\("\/finance\/accounts"\)/);
  assert.match(page, /access\.isAllowed\("\/finance\/settlements"\)/);
  assert.match(component, /الرابط المباشر غير متاح/);
});

test("العرض التوضيحي لا يدّعي تأكيد حركة مالية", () => {
  assert.match(component, /ليس تأكيد تحصيل أو تسليم أو تسوية/);
  assert.match(component, /aria-live="polite"/);
  assert.match(component, /aria-label="طبقات مسار النقد"/);
});
