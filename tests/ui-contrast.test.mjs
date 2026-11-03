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

test("تباين الوضع النهاري والليلي (dark-mode.css) يحقق ٤.٥:١ ولا يتبع وضع الجهاز التلقائي", () => {
  const darkCss = readFileSync(new URL("../src/app/(app)/dark-mode.css", import.meta.url), "utf8");
  assert.ok(!darkCss.includes("prefers-color-scheme"), "يجب ألا يتبع الوضع اللوني إعداد الجهاز تلقائيًا");

  const readVar = (block, name) => {
    const m = block[1].match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
    assert.ok(m, `المتغيّر --${name} غير معرَّف`);
    return m[1];
  };

  // ١. فحص بطاقات المؤشرات في الوضع النهاري («light»)
  const lightDefault = darkCss.match(
    /\.workspace-shell\[data-color-mode="light"\]\s+\.monthly-panther\s*\{([\s\S]*?)\n\}/,
  );
  const lightSelatone = darkCss.match(
    /\.workspace-shell\[data-color-mode="light"\]\[data-theme="wallet-selahtone"\]\s+\.monthly-panther\s*\{([\s\S]*?)\n\}/,
  );
  assert.ok(lightDefault, "كتلة المؤشر النهاري الافتراضي غير موجودة");
  assert.ok(lightSelatone, "كتلة المؤشر النهاري لصلة تون غير موجودة");

  for (const [label, block] of [
    ["المؤشر النهاري الافتراضي", lightDefault],
    ["المؤشر النهاري لصلة تون", lightSelatone],
  ]) {
    const bgs = [
      ["node-bg", readVar(block, "mp-node-bg")],
      ["tab-bg", readVar(block, "mp-tab-bg")],
      ["hud-bg", readVar(block, "mp-hud-bg")],
    ];
    const fgs = ["mp-title", "mp-value", "mp-muted", "mp-accent", "mp-danger"].map((n) => [
      n,
      readVar(block, n),
    ]);
    const failures = [];
    for (const [fgName, fg] of fgs) {
      for (const [bgName, bg] of bgs) {
        const r = contrast(fg, bg);
        if (r < MIN) failures.push(`${label}: --${fgName} (${fg}) على ${bgName} (${bg}) = ${r.toFixed(2)}`);
      }
    }
    assert.deepEqual(failures, [], `أزواج نهارية تحت ${MIN}:1:\n  ${failures.join("\n  ")}`);
  }

  // ٢. فحص الوضع الليلي («dark»)
  const defaultBlock = darkCss.match(/\.workspace-shell\[data-color-mode="dark"\]\s*\{([\s\S]*?)\n\}/);
  const selatoneBlock = darkCss.match(
    /\.workspace-shell\[data-color-mode="dark"\]\[data-theme="wallet-selahtone"\]\s*\{([\s\S]*?)\n\}/,
  );
  assert.ok(defaultBlock, "كتلة الوضع الليلي الافتراضي غير موجودة");
  assert.ok(selatoneBlock, "كتلة الوضع الليلي لصلة تون غير موجودة");

  for (const [label, block] of [
    ["الافتراضي الليلي", defaultBlock],
    ["صلة تون الليلي", selatoneBlock],
  ]) {
    const bgs = ["ws-canvas", "dm-surface", "dm-surface-soft", "dm-surface-tint"].map((n) => [
      n,
      readVar(block, n),
    ]);
    const fgs = ["dm-ink", "dm-ink-soft", "dm-muted", "dm-accent", "dm-code-ink", "dm-wallet-hint"].map(
      (n) => [n, readVar(block, n)],
    );
    const failures = [];
    for (const [fgName, fg] of fgs) {
      for (const [bgName, bg] of bgs) {
        const r = contrast(fg, bg);
        if (r < MIN) failures.push(`${label}: --${fgName} (${fg}) على --${bgName} (${bg}) = ${r.toFixed(2)}`);
      }
    }
    const btnRatio = contrast("#ffffff", readVar(block, "dm-primary-btn"));
    if (btnRatio < MIN) failures.push(`${label}: زر أساسي أبيض على --dm-primary-btn = ${btnRatio.toFixed(2)}`);
    assert.deepEqual(failures, [], `أزواج ليلية تحت ${MIN}:1:\n  ${failures.join("\n  ")}`);
  }
});

test("التحول التلقائي بين النهاري والليلي يتبع وقت النهار والليل (Africa/Cairo)", async () => {
  const {
    getWorkspaceClockSnapshot,
    resolveWorkspaceColorModeState,
    serializeWorkspaceColorModeCookie,
    WORKSPACE_TIMEZONE,
  } = await import("../src/lib/workspace-theme.ts");

  // 07:00 صباحًا بتوقيت القاهرة (05:00 UTC في الشتاء UTC+2) -> شروق النهار (light + dawn)
  const dawn = getWorkspaceClockSnapshot(new Date("2026-11-03T05:00:00Z"), WORKSPACE_TIMEZONE);
  assert.equal(dawn.skyPhase, "dawn");
  assert.equal(dawn.autoColorMode, "light");
  assert.equal(dawn.periodKey, "2026-11-03-day");

  // 13:00 ظهرًا بتوقيت القاهرة (11:00 UTC) -> نهار صافي (light + day)
  const noon = getWorkspaceClockSnapshot(new Date("2026-11-03T11:00:00Z"), WORKSPACE_TIMEZONE);
  assert.equal(noon.skyPhase, "day");
  assert.equal(noon.autoColorMode, "light");
  assert.equal(resolveWorkspaceColorModeState(undefined, new Date("2026-11-03T11:00:00Z"), WORKSPACE_TIMEZONE).colorMode, "light");

  // 17:00 عصرًا بتوقيت القاهرة (15:00 UTC) -> شفق الغروب (light + dusk)
  const dusk = getWorkspaceClockSnapshot(new Date("2026-11-03T15:00:00Z"), WORKSPACE_TIMEZONE);
  assert.equal(dusk.skyPhase, "dusk");
  assert.equal(dusk.autoColorMode, "light");

  // 18:05 مساءً بتوقيت القاهرة (16:05 UTC) -> حلول الليل تلقائيًا (dark + night)
  const night = getWorkspaceClockSnapshot(new Date("2026-11-03T16:05:00Z"), WORKSPACE_TIMEZONE);
  assert.equal(night.skyPhase, "night");
  assert.equal(night.autoColorMode, "dark");
  assert.equal(night.periodKey, "2026-11-03-night");
  assert.equal(resolveWorkspaceColorModeState("auto", new Date("2026-11-03T16:05:00Z"), WORKSPACE_TIMEZONE).colorMode, "dark");

  // 02:30 فجر اليوم التالي (00:30 UTC) -> لا يزال في نفس دورة الليل حتى شروق 06:00
  const postMidnight = getWorkspaceClockSnapshot(new Date("2026-11-04T00:30:00Z"), WORKSPACE_TIMEZONE);
  assert.equal(postMidnight.periodKey, "2026-11-03-night");
  assert.equal(postMidnight.autoColorMode, "dark");

  // تبديل يدوي نهارًا إلى الليلي يستمر خلال النهار، ثم يعود للنهاري تلقائيًا مع شروق اليوم التالي
  const manualNightCookie = serializeWorkspaceColorModeCookie("dark", noon);
  assert.equal(manualNightCookie, "manual:dark:2026-11-03-day");
  assert.equal(
    resolveWorkspaceColorModeState(manualNightCookie, new Date("2026-11-03T13:00:00Z"), WORKSPACE_TIMEZONE).colorMode,
    "dark",
  );
  const nextMorningState = resolveWorkspaceColorModeState(
    manualNightCookie,
    new Date("2026-11-04T04:10:00Z"), // 06:10 صباحًا بالقاهرة
    WORKSPACE_TIMEZONE,
  );
  assert.equal(nextMorningState.colorMode, "light");
  assert.equal(nextMorningState.isAutoTimeMode, true);
});


