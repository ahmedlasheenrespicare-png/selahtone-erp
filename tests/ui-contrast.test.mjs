/**
 * تباين ألوان الواجهة الحقيقية (نص على خلفية) — مقيس بحساب WCAG.
 *
 * يقرأ المتغيّرات من src/app/globals.css نفسها، فلا يفوت أي تعديل لاحق:
 * إن غُيّر لون إلى درجة أضعف من ٤.٥:١ فشل الاختبار.
 *
 * التشغيل: npm run check:ui:contrast
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const MIN = 4.5;
const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

const root = css.match(/:root\s*\{([\s\S]*?)\n\}/);
assert.ok(root, "لا توجد قاعدة :root في globals.css");

/** لون متغيّر من :root — يفشل إن لم يكن معرَّفًا. */
function token(name) {
  const value = root[1].match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  assert.ok(value, `المتغيّر --${name} غير معرَّف في :root`);
  return value[1];
}

function channel(hex, index) {
  return parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
}

function luminance(hex) {
  const gamma = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [0, 1, 2].map((i) => gamma(channel(hex, i)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** #abc و #aabbcc سيّان — تُطبَّع قبل القياس. */
function normalize(hex) {
  const h = hex.slice(1).toLowerCase();
  return "#" + (h.length === 3 ? h.split("").map((c) => c + c).join("") : h);
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// النص مقروء على الخلفيات الثلاث المستخدمة فعليًا في الواجهة.
const BACKGROUNDS = [
  ["البطاقة", "card"],
  ["خلفية الصفحة", "bg"],
  ["الصف الفاتح", "line-2"],
];

// ألوان النص والحالة — لا تُقاس الخلفيات والخطوط والظلال.
const TEXT = ["ink", "ink-2", "ink-3", "teal", "copper", "green", "red", "amber", "navy"];

test("كل لون نص في :root مقروء على كل خلفية مستخدمة (٤.٥:١ على الأقل)", () => {
  const failures = [];
  for (const name of TEXT) {
    const fg = token(name);
    for (const [label, bgName] of BACKGROUNDS) {
      const bg = token(bgName);
      const ratio = contrast(fg, bg);
      if (ratio < MIN) failures.push(`--${name} ${fg} على ${label} (${bg}) = ${ratio.toFixed(2)}`);
    }
  }
  assert.deepEqual(failures, [], `أزواج تحت ${MIN}:1:\n  ${failures.join("\n  ")}`);
});

test("الألوان الأساسية معرَّفة وصريحة (لا متغيّرات مكسورة)", () => {
  for (const name of [...TEXT, ...BACKGROUNDS.map(([, n]) => n)]) {
    assert.match(token(name), /^#[0-9a-fA-F]{6}$/, `--${name}`);
  }
});

test("تباين نص الترويسة الملوّنة في طبقة التصميم الجديد (site-design.css)", () => {
  const design = readFileSync(new URL("../prototypes/ui-preview/site-design.css", import.meta.url), "utf8");

  const hero = design.match(
    /linear-gradient\(115deg,\s*(#[0-9a-f]{6})\s+0%,\s*(#[0-9a-f]{6})\s+\d*%?,\s*(#[0-9a-f]{6})\s+100%\)/i,
  );
  assert.ok(hero, "لا يوجد تدرّج الترويسة (linear-gradient 115deg) في site-design.css");

  // النص فاتح على متدرّج داكن → أسوأ حالة هي أفتح نقطة في المتدرّج.
  const lightest = hero.slice(1, 4).reduce((best, stop) => (luminance(stop) > luminance(best) ? stop : best));

  const selectors = [".dashboard-heading h1", ".dashboard-eyebrow", ".dashboard-heading__description"];
  for (const selector of selectors) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rule = design.match(new RegExp(`\\[data-design="new"\\]\\s+${escaped}\\{[^}]*color:\\s*(#[0-9a-fA-F]{3,6})`, "i"));
    assert.ok(rule, `لا لون نص لِـ ${selector}`);
    const ratio = contrast(normalize(rule[1]), normalize(lightest));
    assert.ok(ratio >= MIN, `${selector}: ${rule[1]} على ${lightest} = ${ratio.toFixed(2)}`);
  }
});

test("تباين نص ترويسة المالية في طبقة التصميم (site-finance-design.css)", () => {
  const design = readFileSync(new URL("../prototypes/ui-preview/site-finance-design.css", import.meta.url), "utf8");

  const hero = design.match(
    /linear-gradient\(115deg,\s*(#[0-9a-f]{6})\s+0%,\s*(#[0-9a-f]{6})\s+\d*%?,\s*(#[0-9a-f]{6})\s+100%\)/i,
  );
  assert.ok(hero, "لا يوجد تدرّج الترويسة في site-finance-design.css");

  // النص فاتح على متدرّج داكن → أسوأ حالة هي أفتح نقطة في المتدرّج.
  const lightest = hero.slice(1, 4).reduce((best, stop) => (luminance(stop) > luminance(best) ? stop : best));

  for (const selector of [".fin-heading h1", ".fin-heading__eyebrow"]) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rule = design.match(
      new RegExp(`\\[data-design="new"\\]\\s+${escaped}\\{[^}]*color:\\s*(#[0-9a-fA-F]{3,6})`, "i"),
    );
    assert.ok(rule, `لا لون نص لِـ ${selector}`);
    const ratio = contrast(normalize(rule[1]), normalize(lightest));
    assert.ok(ratio >= MIN, `${selector}: ${rule[1]} على ${lightest} = ${ratio.toFixed(2)}`);
  }

  // زر الترويسة الأبيض: نصه داكن على أبيض
  const button = design.match(
    /\[data-design="new"\]\s+\.fin-heading\s+\.fin-button\{[^}]*color:\s*(#[0-9a-fA-F]{3,6})/i,
  );
  assert.ok(button, "لا لوم نص لزر الترويسة");
  const buttonRatio = contrast(normalize(button[1]), "#ffffff");
  assert.ok(buttonRatio >= MIN, `زر الترويسة: ${button[1]} على أبيض = ${buttonRatio.toFixed(2)}`);
});
