import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  collectionRingPercent,
  normalizeStatRingPercent,
  statRingAngleDegrees,
} from "../src/components/stat-ring-pill-model";

const component = readFileSync(new URL("../src/components/stat-ring-pill.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/components/stat-ring-pill.css", import.meta.url), "utf8");
const page = readFileSync(new URL("../src/app/(app)/sales/stats/page.tsx", import.meta.url), "utf8");
const license = readFileSync(new URL("../src/components/stat-ring-pill.LICENSE.txt", import.meta.url), "utf8");

test("تقييد النسبة وزاوية الحلقة يتبعان القيمة الحقيقية بلا نسب ثابتة", () => {
  assert.equal(normalizeStatRingPercent(67.3), 67.3);
  assert.equal(normalizeStatRingPercent(-4), 0);
  assert.equal(normalizeStatRingPercent(140), 100);
  assert.equal(normalizeStatRingPercent(null), null);
  assert.equal(normalizeStatRingPercent(undefined), null);
  assert.equal(normalizeStatRingPercent(Number.NaN), null);
  assert.equal(normalizeStatRingPercent(Number.POSITIVE_INFINITY), null);
  assert.equal(statRingAngleDegrees(0), 0);
  assert.equal(statRingAngleDegrees(50), 180);
  assert.equal(statRingAngleDegrees(67.3), 242.3);
  assert.equal(statRingAngleDegrees(100), 360);
  assert.equal(statRingAngleDegrees(null), 0);
  assert.doesNotMatch(component, /67%|72%|241\.2deg|259\.2deg/);
});

test("حلقة التحصيل تخفي نسبة المحرك عند غياب الفواتير أو المقام الموجب", () => {
  assert.equal(collectionRingPercent({ invoiceCount: 0, netSalesNum: 0, collectionRatePct: 100 }), null);
  assert.equal(collectionRingPercent({ invoiceCount: 3, netSalesNum: 0, collectionRatePct: 100 }), null);
  assert.equal(collectionRingPercent({ invoiceCount: 3, netSalesNum: -10, collectionRatePct: 100 }), null);
  assert.equal(collectionRingPercent({ invoiceCount: 3, netSalesNum: 1000, collectionRatePct: 67.3 }), 67.3);
  assert.equal(collectionRingPercent({ invoiceCount: 1, netSalesNum: 100, collectionRatePct: 0 }), 0);
  assert.equal(collectionRingPercent({ invoiceCount: 1, netSalesNum: 100, collectionRatePct: 100 }), 100);
});

test("المكوّن عرض خادمي خفيف ومتاح، ولا يجلب بيانات ولا يغيّر الحفظ", () => {
  assert.doesNotMatch(component, /^"use client"/m);
  assert.doesNotMatch(component, /fetch\(|useEffect\(|useState\(|@\/lib\/prisma|server-only/);
  assert.match(component, /role="img"/);
  assert.match(component, /aria-label=\{accessiblePercent\}/);
  assert.match(component, /<bdi dir="ltr">/);
  assert.match(component, /data-empty=\{isEmpty \? "true" : "false"\}/);
  assert.match(component, /import "\.\/stat-ring-pill\.css"/);
});

test("CSS يرث الثيمين والليلي ويحترم تقليل الحركة والطباعة وألوان النظام", () => {
  assert.match(css, /conic-gradient\(/);
  assert.match(css, /var\(--ring-angle/);
  assert.match(css, /var\(--sl-primary-btn/);
  assert.match(css, /var\(--sl-accent/);
  assert.match(css, /\.workspace-shell\[data-color-mode="dark"\] \.stat-ring-pill/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.match(css, /@media print/);
  assert.match(css, /font-variant-numeric: tabular-nums/);
  assert.doesNotMatch(css, /infinite|@keyframes/);
});

test("الإدراج محصور في بطاقة التحصيل ولا يمس حمولة CSV أو الصلاحيات", () => {
  assert.equal((page.match(/<StatRingPill/g) ?? []).length, 1);
  assert.match(page, /percent=\{collectionPercent\}/);
  assert.match(page, /value=\{exec\.netCollectedFormatted\}/);
  assert.match(page, /emptyLabel=\{collectionEmptyLabel\}/);
  assert.match(page, /ملغى \{nf\.format\(exec\.cancelledCount\)\}/);
  assert.match(page, /collectionRatePct: exec\.collectionRatePct/);
  assert.match(page, /await requirePageAccess\("\/sales\/stats"\)/);
  assert.match(page, /session\.role !== "MANAGER"/);
});

test("إسناد MIT موجود للمصدر المقتبس", () => {
  assert.match(license, /MIT License/);
  assert.match(license, /zeeshan_2112\/gentle-treefrog-69/);
  assert.match(license, /Permission is hereby granted/);
  assert.match(component, /stat-ring-pill\.LICENSE\.txt/);
});
