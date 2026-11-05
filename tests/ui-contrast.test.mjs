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

test("خلفية النجوم الليلية (red-duck-82) مقيّدة حصريًا بثيم الافتراضي وتفعيل الخلفية والوضع الليلي فقط", () => {
  const starCss = readFileSync(
    new URL("../src/app/(app)/red-duck-starfield.css", import.meta.url),
    "utf8",
  );

  assert.match(starCss, /\.workspace-starfield\s*\{\s*display:\s*none;\s*\}/);
  assert.ok(
    !starCss.includes("wallet-selahtone"),
    "يجب ألا تطبق خلفية red-duck-82 على ثيم صلة تون",
  );
  assert.ok(
    !starCss.includes('data-color-mode="light"'),
    "يجب ألا تطبق خلفية red-duck-82 في الوضع النهاري",
  );
  assert.match(
    starCss,
    /\.workspace-shell\[data-theme="wallet"\]\[data-dashboard-bg="on"\]\[data-color-mode="dark"\]\s+\.workspace-starfield\s*\{[\s\S]*?display:\s*block;/,
  );
  assert.ok(
    starCss.includes("radial-gradient(ellipse at bottom, #1b2735 0%, #090a0f 100%)"),
    "تدرّج الخلفية الأصلي لـ red-duck-82 مفقود",
  );
  for (const token of ["--rd82-stars-sm", "--rd82-stars-md", "--rd82-stars-lg", "50s", "100s", "150s"]) {
    assert.ok(starCss.includes(token), `عنصر حقل النجوم ${token} مفقود`);
  }

  // التحقق من تباين النصوص العائمة فوق سماء red-duck-82 (#1b2735 و#0d131c)
  assert.ok(contrast("#d4e8ce", "#1b2735") >= MIN, "تباين --cl-pill-ink غير كافٍ فوق #1b2735");
  assert.ok(contrast("#f2faef", "#1b2735") >= MIN, "تباين --cl-pill-strong غير كافٍ فوق #1b2735");
});

test("الشبكة المتجاوبة للمحفظة والمؤشرات موحّدة في لوحة القيادة والمبيعات وإحصائياتها والمصروفات", () => {
  const wsCss = readFileSync(
    new URL("../src/app/(app)/workspace.css", import.meta.url),
    "utf8",
  );
  for (const bp of ["min-width: 1640px", "max-width: 1279px", "max-width: 991px", "max-width: 680px"]) {
    assert.ok(wsCss.includes(bp), `نقطة الاستجابة ${bp} مفقودة في workspace.css`);
  }

  for (const relPath of [
    "../src/app/(app)/dashboard/page.tsx",
    "../src/app/(app)/sales/page.tsx",
    "../src/app/(app)/sales/stats/page.tsx",
    "../src/app/(app)/finance/expenses/page.tsx",
    "../src/app/(app)/finance/page.tsx",
  ]) {
    const src = readFileSync(new URL(relPath, import.meta.url), "utf8");
    assert.ok(src.includes("dashboard-cards-grid"), `${relPath} يفتقد الشبكة المتجاوبة الموحّدة`);
    assert.ok(src.includes("DashboardWallet"), `${relPath} يفتقد المحفظة داخل الشبكة`);
  }

  const salesStatsTs = readFileSync(
    new URL("../src/lib/sales-stats.ts", import.meta.url),
    "utf8",
  );
  assert.ok(salesStatsTs.includes('title: "التحصيل والعملاء"'));
  assert.ok(!salesStatsTs.includes("-infinity"), "يجب عدم استخدام -infinity غير المتوافق مع Date");
});

test("تباين وبنية لوحة القيادة التنفيذية (نبض اليوم · السجل الحيّ · صحّة الفروع) يحقق ٤.٥:١", () => {
  // التحقق من تباين ألوان البطاقات النهارية في الثيم الافتراضي وثيم صلة تون
  assert.ok(contrast("#132515", "#ffffff") >= MIN);
  assert.ok(contrast("#476049", "#ffffff") >= MIN);
  assert.ok(contrast("#476049", "#f5f9f4") >= MIN);
  assert.ok(contrast("#ffffff", "#1f5c2e") >= MIN);
  assert.ok(contrast("#6e4504", "#fff8eb") >= MIN);

  assert.ok(contrast("#0a203e", "#ffffff") >= MIN);
  assert.ok(contrast("#395875", "#ffffff") >= MIN);
  assert.ok(contrast("#395875", "#f2f8fc") >= MIN);
  assert.ok(contrast("#ffffff", "#0d5a78") >= MIN);

  const dashSrc = readFileSync(
    new URL("../src/app/(app)/dashboard/page.tsx", import.meta.url),
    "utf8",
  );
  for (const token of [
    "dashboard-quick-actions",
    "dashboard-pulse-strip",
    "dashboard-lower-grid",
    "آخر العمليات الحيّة",
    "صحّة الفروع وتنبيهات المخزون",
  ]) {
    assert.ok(dashSrc.includes(token), `لوحة القيادة تفتقد ${token}`);
  }

  // التأكد من بقاء «تاريخ اليوم» في الشريط العلوي دون مساس
  const topbarSkySrc = readFileSync(
    new URL("../src/components/color-mode-toggle.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(topbarSkySrc.includes("تاريخ اليوم"), "يجب الإبقاء على تاريخ اليوم في الشريط العلوي");
});

test("الحزمة التنفيذية الخماسية للوحة القيادة (المؤشر السادس · البحث الفوري · وتيرة الشهر · الرقابة · رادار التحصيل)", () => {
  // التحقق من تباين الشارات وأرقام الذمم في الوضع النهاري والليلي
  assert.ok(contrast("#145a36", "#e3f6ea") >= MIN);
  assert.ok(contrast("#8f2424", "#fde8e8") >= MIN);
  assert.ok(contrast("#9f2d2d", "#ffffff") >= MIN);
  assert.ok(contrast("#fca5a5", "#142216") >= MIN);
  assert.ok(contrast("#fca5a5", "#0f203d") >= MIN);

  const dashSrc = readFileSync(
    new URL("../src/app/(app)/dashboard/page.tsx", import.meta.url),
    "utf8",
  );
  for (const token of [
    "dashboard-omni-section",
    "dashboard-pace-strip",
    "dashboard-governance",
    "dashboard-aging-card",
    "fifthSpotlight",
    "رادار أولويات التحصيل وأعمار الذمم",
  ]) {
    assert.ok(dashSrc.includes(token), `لوحة القيادة تفتقد ${token}`);
  }

  const execSrc = readFileSync(
    new URL("../src/lib/dashboard-executive.ts", import.meta.url),
    "utf8",
  );
  assert.ok(execSrc.includes('title: "الربحية وصافي التشغيل"'));
  assert.ok(execSrc.includes('title: "حركة الأصناف والسيريالات"'));
  assert.ok(!execSrc.includes("-infinity"), "يجب عدم استخدام -infinity في استعلامات لوحة القيادة");
});

test("المؤشرات المركّبة الثلاثة (الكفاءة الشاملة · التحوّل النقدي الصافي · تقييم وكفاءة الفروع) موصولة في لوحة القيادة", () => {
  const dashSrc = readFileSync(
    new URL("../src/app/(app)/dashboard/page.tsx", import.meta.url),
    "utf8",
  );
  for (const token of [
    "compositeEfficiencySpotlight",
    "cashConversionSpotlight",
    "branchEfficiencySpotlight",
    "branchScoresById",
  ]) {
    assert.ok(dashSrc.includes(token), `لوحة القيادة تفتقد ${token}`);
  }

  const execSrc = readFileSync(
    new URL("../src/lib/dashboard-executive.ts", import.meta.url),
    "utf8",
  );
  for (const title of [
    'title: "مؤشر الكفاءة التشغيلية الشامل"',
    'title: "مؤشر التحوّل النقدي الصافي"',
    'title: "مؤشر تقييم وكفاءة الفروع"',
  ]) {
    assert.ok(execSrc.includes(title), `ملف المؤشرات التنفيذية يفتقد ${title}`);
  }
});

test("كل بطاقة مؤشر تملك أيقونة مخصّصة ومختلفة عن الأيقونة القديمة ذات الأعمدة الثلاثة", () => {
  const pantherSrc = readFileSync(
    new URL("../src/components/panther-spotlight-card.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(
    !pantherSrc.includes("M3 12m0 1a1 1 0 0 1 1 -1h4"),
    "يجب استبدال أيقونة الأعمدة الثلاثة القديمة بالكامل",
  );
  assert.ok(pantherSrc.includes("data-spotlight-icon={resolvedIcon}"));

  const dashSrc = readFileSync(
    new URL("../src/app/(app)/dashboard/page.tsx", import.meta.url),
    "utf8",
  );
  const salesPantherSrc = readFileSync(
    new URL("../src/app/(app)/dashboard/monthly-sales-panther.tsx", import.meta.url),
    "utf8",
  );

  for (const iconName of [
    'icon="efficiencyGauge"',
    'icon="customerCollection"',
    'icon="cashConversion"',
    'icon="balanceScale"',
    'icon="expenseReceipt"',
    'icon="branchScorecard"',
    '"serialScan"',
    '"netProfit"',
  ]) {
    assert.ok(dashSrc.includes(iconName), `لوحة القيادة تفتقد الأيقونة المخصّصة ${iconName}`);
  }
  assert.ok(salesPantherSrc.includes('icon="salesGrowth"'));
});

test("دمج عناصر الشريط العلوي داخل شريط صلة تون على الجوال والشاشات الضيقة مع ثبات الأبعاد", () => {
  const layoutSrc = readFileSync(
    new URL("../src/app/(app)/layout.tsx", import.meta.url),
    "utf8",
  );
  const navSrc = readFileSync(
    new URL("../src/app/(app)/app-navigation.tsx", import.meta.url),
    "utf8",
  );
  const workspaceCss = readFileSync(
    new URL("../src/app/(app)/workspace.css", import.meta.url),
    "utf8",
  );
  const darkModeCss = readFileSync(
    new URL("../src/app/(app)/dark-mode.css", import.meta.url),
    "utf8",
  );

  // تمرير بيانات المستخدم والدور والفرع إلى شريط التنقل الموحّد مع بقاء الشريط العلوي لسطح المكتب
  assert.ok(layoutSrc.includes("userName={session.name}"));
  assert.ok(layoutSrc.includes("roleLabel={roleLabel}"));
  assert.ok(layoutSrc.includes("branchLabel={branchLabel}"));
  assert.ok(layoutSrc.includes('className="workspace-topbar"'));

  // شريط الجوال الموحد والقائمة المنبثقة للحساب تُرسم في طبقة مساحة العمل لتتجاوز التراكب.
  assert.ok(navSrc.includes("createPortal(") && navSrc.includes('closest(".workspace-shell")'));
  for (const snippet of [
    'className="workspace-mobile-strip"',
    "نظام إدارة صلة تون",
    "مساحة العمل",
    "<ColorModeToggle compact />",
    'href="/change-password"',
    "<LogoutButton />",
    'className="workspace-mobile-popover"',
  ]) {
    assert.ok(navSrc.includes(snippet), `شريط الجوال الموحّد يفتقد ${snippet}`);
  }

  // ثبات أبعاد شريط صلة تون على الشاشات الضيقة والجوال (height: 42px / 48px, width: 100%, padding: 13px 18px) وإخفاء الشريط العلوي المنفصل
  assert.ok(workspaceCss.includes(".workspace-mobile-strip,\n.workspace-mobile-popover {\n  display: none;\n}"));
  const mobileBlock = workspaceCss.slice(workspaceCss.indexOf("@media (max-width: 820px)"));
  assert.ok(mobileBlock.includes("padding: 13px 18px;"));
  assert.ok(mobileBlock.includes("width: 100%;"));
  assert.ok(mobileBlock.includes("height: 42px;"));
  assert.ok(mobileBlock.includes("max-height: 42px;"));
  assert.ok(mobileBlock.includes("height: 48px;"));
  assert.ok(mobileBlock.includes("max-height: 48px;"));
  assert.ok(mobileBlock.includes("flex-wrap: nowrap;"));
  assert.ok(mobileBlock.includes(".workspace-topbar {\n    display: none !important;\n  }"));
  assert.match(mobileBlock, /\.workspace-mobile-popover \{[\s\S]*?position: fixed;/);
  assert.ok(mobileBlock.includes("z-index: 2000;"));

  // النسخة المدمجة لودجت التاريخ ودورة السماء دون الاعتماد على وضع الجهاز التلقائي
  assert.ok(darkModeCss.includes(".workspace-topbar__skydate.is-compact"));
  assert.ok(!darkModeCss.includes(["prefers", "color", "scheme"].join("-")));
});

test("الشريط السفلي المثبّت للجوال والشاشات الصغيرة يعرض أهم ٥ صفحات بأيقونة فوق كل اسم", async () => {
  const { mobileBottomDockItems, resolveActiveBottomDockHref } = await import(
    "../src/app/(app)/navigation-items.ts"
  );
  const layoutSrc = readFileSync(
    new URL("../src/app/(app)/layout.tsx", import.meta.url),
    "utf8",
  );
  const navSrc = readFileSync(
    new URL("../src/app/(app)/app-navigation.tsx", import.meta.url),
    "utf8",
  );
  const workspaceCss = readFileSync(
    new URL("../src/app/(app)/workspace.css", import.meta.url),
    "utf8",
  );

  assert.ok(layoutSrc.includes("role={session.role}"));
  assert.ok(navSrc.includes('className="workspace-bottom-dock"'));
  assert.ok(navSrc.includes('aria-label="التنقل السريع السفلي"'));

  // التحقق من ترتيب الأيقونة فوق الاسم مباشرةً داخل كل عنصر
  const iconIdx = navSrc.indexOf('className="workspace-bottom-dock__icon"');
  const labelIdx = navSrc.indexOf('className="workspace-bottom-dock__label"');
  assert.ok(iconIdx !== -1 && labelIdx !== -1 && iconIdx < labelIdx, "يجب أن تسبق الأيقونةُ اسمَ الصفحة في الشريط السفلي");

  // إخفاء الشريط على سطح المكتب والطباعة، وتثبيته أسفل الشاشة مع ترتيب عمودي (الأيقونة فوق النص) في الشاشات <= 820px
  assert.ok(workspaceCss.includes(".workspace-bottom-dock {\n  display: none;\n}"));
  const mobileBlock = workspaceCss.slice(workspaceCss.indexOf("@media (max-width: 820px)"));
  assert.ok(mobileBlock.includes(".workspace-bottom-dock {"));
  assert.ok(mobileBlock.includes("position: fixed;"));
  assert.ok(mobileBlock.includes("bottom: 0;"));
  assert.ok(mobileBlock.includes("flex-direction: column;"));
  assert.ok(mobileBlock.includes("padding-bottom: calc(92px + env(safe-area-inset-bottom, 0px));"));
  assert.ok(workspaceCss.includes("@media print {\n  .workspace-bottom-dock {\n    display: none !important;\n  }\n}"));

  // التحقق من الصفحات الخمس والأيقونات المستقلة وصلاحيات كل دور
  const managerDock = mobileBottomDockItems("MANAGER", true, "FULL", false);
  assert.equal(managerDock.length, 5);
  assert.deepEqual(managerDock.map((i) => i.href), [
    "/dashboard",
    "/sales",
    "/sales/new",
    "/finance",
    "/finance/expenses",
  ]);
  assert.equal(new Set(managerDock.map((i) => i.icon)).size, 5);

  const accountantDock = mobileBottomDockItems("ACCOUNTANT", true, "FULL", false);
  assert.equal(accountantDock.length, 5);
  assert.deepEqual(accountantDock.map((i) => i.href), [
    "/dashboard",
    "/sales",
    "/finance",
    "/finance/transfers",
    "/finance/expenses",
  ]);
  assert.equal(accountantDock.some((i) => i.href === "/sales/new"), false);
  assert.equal(accountantDock.some((i) => i.href === "/sales/stats"), false);
  assert.equal(new Set(accountantDock.map((i) => i.icon)).size, 5);

  const staffDock = mobileBottomDockItems("CS_AGENT", true, "FULL", false);
  assert.equal(staffDock.length, 5);
  assert.deepEqual(staffDock.map((i) => i.href), [
    "/dashboard",
    "/sales",
    "/sales/new",
    "/finance/mine",
    "/finance/expenses",
  ]);
  assert.equal(new Set(staffDock.map((i) => i.icon)).size, 5);

  const limitedManager = mobileBottomDockItems("MANAGER", true, "LIMITED", false);
  assert.equal(limitedManager.length, 5);
  for (const item of limitedManager) {
    if (item.href) {
      assert.ok(
        item.href.startsWith("/dashboard") ||
          item.href.startsWith("/sales") ||
          item.href.startsWith("/finance/expenses"),
      );
    }
  }

  assert.equal(resolveActiveBottomDockHref("/sales/new", managerDock), "/sales/new");
  assert.equal(resolveActiveBottomDockHref("/sales/42", managerDock), "/sales");
  assert.equal(resolveActiveBottomDockHref("/finance/expenses", accountantDock), "/finance/expenses");
  assert.equal(resolveActiveBottomDockHref("/finance/transfers", accountantDock), "/finance/transfers");
  assert.equal(resolveActiveBottomDockHref("/finance/accounts", accountantDock), "/finance");
});

test("حزم تطوير الصفحات الشاملة (١-٣) تحقق تباين WCAG ٤.٥:١ وتوحّد الأيقونات والتصدير والطباعة", async () => {
  const { buildCsvContent } = await import("../src/lib/csv-export.ts");
  const workspaceCss = readFileSync(
    new URL("../src/app/(app)/workspace.css", import.meta.url),
    "utf8",
  );
  const darkModeCss = readFileSync(
    new URL("../src/app/(app)/dark-mode.css", import.meta.url),
    "utf8",
  );

  // ١) قياس تباين العناصر الجديدة في الوضع النهاري والليلي (>= 4.5:1)
  const pairs = [
    ["شارة تقادم الفاتورة التحذيرية نهارًا", "#7c2d12", "#ffedd5"],
    ["شارة تقادم الفاتورة الحرجة نهارًا", "#991b1b", "#fee2e2"],
    ["شريحة الاختيار السريع النشطة نهارًا", "#115e59", "#f0fdfa"],
    ["رقم خطوة المصروف المكتملة", "#ffffff", "#15803d"],
    ["رقم خطوة المصروف الحالية", "#ffffff", "#b45309"],
    ["زر التبديل النشط في الوضع الليلي", "#ffffff", "#0f766e"],
    ["شارة التقادم التحذيرية ليلًا", "#fde68a", "#1e293b"],
    ["شارة التقادم الحرجة ليلًا", "#fecaca", "#1e293b"],
    ["شريحة الاختيار النشطة ليلًا", "#99f6e4", "#1e293b"],
  ];
  for (const [label, fg, bg] of pairs) {
    const c = contrast(fg, bg);
    assert.ok(c >= MIN, `${label}: التباين ${c.toFixed(2)} أقل من ${MIN}`);
  }

  // ٢) مُصدِّر CSV يدعم BOM للعربية وعلامات الاقتباس والفواصل
  const csvSample = buildCsvContent(["العميل", "المبلغ"], [['شركة "صلة"', "1,250.00"]]);
  assert.equal(csvSample.startsWith("\uFEFF"), true);
  assert.ok(csvSample.includes('"شركة ""صلة"""'));
  assert.ok(csvSample.includes('"1,250.00"'));

  // ٣) الطباعة المخصّصة (ملخص إغلاق اليوم + الإيصال الحراري 80mm) وعدم وجود prefers-color-scheme
  assert.ok(workspaceCss.includes(".print-only-brief"));
  assert.ok(workspaceCss.includes('html[data-print-mode="thermal"]'));
  assert.ok(workspaceCss.includes(".fin-stepper"));
  assert.ok(workspaceCss.includes(".fin-denom-grid"));
  assert.ok(!darkModeCss.includes(["prefers", "color", "scheme"].join("-")));

  // ٤) توحيد الأيقونات الدلالية المخصّصة في جميع صفحات المؤشرات
  const iconChecks = [
    ["../src/app/(app)/sales/page.tsx", 'icon="customerCollection"'],
    ["../src/app/(app)/sales/stats/page.tsx", 'icon="salesGrowth"'],
    ["../src/app/(app)/finance/page.tsx", 'icon="balanceScale"'],
    ["../src/app/(app)/finance/expenses/page.tsx", 'icon="expenseReceipt"'],
    ["../src/app/(app)/finance/expenses/page.tsx", 'icon="approvalFlow"'],
    ["../src/app/(app)/finance/mine/page.tsx", 'icon="cashConversion"'],
    ["../src/app/(app)/inventory/page.tsx", 'icon="inventoryCube"'],
  ];
  for (const [relPath, expectedSnippet] of iconChecks) {
    const fileContent = readFileSync(new URL(relPath, import.meta.url), "utf8");
    assert.ok(fileContent.includes(expectedSnippet), `الأيقونة المخصّصة مفقودة في ${relPath}: ${expectedSnippet}`);
  }
});

test("القائمة الجانبية المنظّمة حسب الدور تفصل المدير عن المحاسب والموظف وتمنع تداخل التفعيل وتدعم الشارات", async () => {
  const { sidebarNavigationGroups, resolveActiveSidebarHref } = await import(
    "../src/app/(app)/navigation-items.ts"
  );
  const navSrc = readFileSync(
    new URL("../src/app/(app)/app-navigation.tsx", import.meta.url),
    "utf8",
  );

  // ١) تباين شارة العدّاد في القائمة الجانبية (>= 4.5:1)
  assert.ok(contrast("#78350f", "#fffbeb") >= MIN);
  assert.ok(contrast("#ffffff", "#1e293b") >= MIN);

  // ٢) قسم المظهر مطوي افتراضيًا ومعرّب
  assert.ok(navSrc.includes("const [themeOpen, setThemeOpen] = useState(false);"));
  assert.ok(navSrc.includes("المظهر والسمات"));

  // ٣) المدير: «بيع جديد» ظاهر مباشرة في الأعلى، والإعدادات مطويّة تحت «إعدادات البيع» و«تهيئة المالية»
  const managerGroups = sidebarNavigationGroups("MANAGER", {
    financeEnabled: true,
    menuScope: "FULL",
    inventoryEnabled: true,
    badges: { pendingExpenses: 4, openSettlements: 2 },
  });
  assert.deepEqual(managerGroups.map((g) => g.label), [
    "المتابعة التنفيذية",
    "المبيعات والمخزون",
    "المالية والخزينة",
    "الإدارة والنظام",
  ]);
  const mgrSales = managerGroups.find((g) => g.label === "المبيعات والمخزون").items;
  assert.equal(mgrSales[0].href, "/sales/new");
  assert.equal(mgrSales[0].featured, true);
  assert.equal(mgrSales[1].href, "/sales");
  assert.equal(mgrSales[2].label, "إعدادات البيع");
  assert.deepEqual(mgrSales[2].children.map((c) => c.href), ["/sales/catalog", "/sales/settings"]);

  const mgrFinance = managerGroups.find((g) => g.label === "المالية والخزينة").items;
  assert.equal(mgrFinance.find((i) => i.href === "/finance/transfers").badgeCount, 2);
  assert.equal(mgrFinance.find((i) => i.href === "/finance/expenses").badgeCount, 4);
  assert.equal(mgrFinance.find((i) => i.label === "تهيئة المالية").children.length, 2);

  // ٤) المحاسب: لا تظهر له روابط المدير الحصرية (/sales/new, /sales/stats, /sales/catalog, /sales/settings)
  const accountantGroups = sidebarNavigationGroups("ACCOUNTANT", {
    financeEnabled: true,
    menuScope: "FULL",
    inventoryEnabled: true,
  });
  const accAllHrefs = accountantGroups.flatMap((g) =>
    g.items.flatMap((it) => [it.href, ...(it.children?.map((c) => c.href) ?? [])].filter(Boolean)),
  );
  for (const managerOnly of ["/sales/new", "/sales/stats", "/sales/catalog", "/sales/settings", "/inventory/receipts/new"]) {
    assert.equal(accAllHrefs.includes(managerOnly), false, `ظهور رابط محجوب للمحاسب: ${managerOnly}`);
  }
  assert.equal(accAllHrefs.includes("/sales"), true);
  assert.equal(accAllHrefs.includes("/finance"), true);
  assert.equal(accAllHrefs.includes("/finance/transfers"), true);

  // ٥) موظف الفرع: رحلة الوردية اليومية («بيع جديد» في الصدارة، وتوريد للخزنة، دون شاشات الإدارة)
  const staffGroups = sidebarNavigationGroups("CS_AGENT", {
    financeEnabled: true,
    menuScope: "FULL",
    inventoryEnabled: false,
    badges: { pendingExpenses: 1 },
  });
  assert.deepEqual(staffGroups.map((g) => g.label), [
    "الرئيسية",
    "الكاونتر والمبيعات",
    "العهدة والمصروفات",
  ]);
  const staffHrefs = staffGroups.flatMap((g) => g.items.map((it) => it.href));
  assert.equal(staffHrefs.includes("/sales/new"), true);
  assert.equal(staffHrefs.includes("/finance/mine"), true);
  assert.equal(staffHrefs.includes("/finance/transfers"), true);
  for (const forbidden of ["/admin", "/setup", "/finance/accounts", "/finance/counts", "/finance/categories"]) {
    assert.equal(staffHrefs.includes(forbidden), false);
  }

  // ٦) دقة التفعيل الوحيد (منع إضاءة رابطين معًا عند تداخل البادئات)
  assert.equal(resolveActiveSidebarHref("/sales/new", managerGroups), "/sales/new");
  assert.equal(resolveActiveSidebarHref("/sales/99", managerGroups), "/sales");
  assert.equal(resolveActiveSidebarHref("/sales/catalog", managerGroups), "/sales/catalog");
  assert.equal(resolveActiveSidebarHref("/finance/expenses/new", managerGroups), "/finance/expenses/new");
  assert.equal(resolveActiveSidebarHref("/finance/expenses/15", managerGroups), "/finance/expenses");
  assert.equal(resolveActiveSidebarHref("/finance", managerGroups), "/finance");
  assert.equal(resolveActiveSidebarHref("/finance/accounts", managerGroups), "/finance/accounts");
});

test("الأنماط البصرية الستة للمؤشرات التفاعلية موصولة بالصفحات وتحقق تباين WCAG >= 4.5:1 نهارًا وليلًا", () => {
  const pantherSrc = readFileSync(
    new URL("../src/components/panther-spotlight-card.tsx", import.meta.url),
    "utf8",
  );
  const wsCss = readFileSync(
    new URL("../src/app/(app)/workspace.css", import.meta.url),
    "utf8",
  );
  const dmCss = readFileSync(
    new URL("../src/app/(app)/dark-mode.css", import.meta.url),
    "utf8",
  );

  // ١) توافر الأنماط البصرية الستة في المكوّن الموحّد
  for (const variant of ["area", "gauge", "donut", "columns", "waterfall", "bars"]) {
    assert.ok(
      pantherSrc.includes(`"${variant}"`),
      `المكوّن PantherSpotlightCard يفتقد نمط الرسم ${variant}`,
    );
  }
  assert.ok(pantherSrc.includes("data-chart-variant={activeVariant}"));
  assert.ok(pantherSrc.includes("monthly-panther__gauge"));
  assert.ok(pantherSrc.includes("monthly-panther__donut"));
  assert.ok(pantherSrc.includes("monthly-panther__bars"));

  // ٢) توصيل الأنماط المتخصّصة بصفحة لوحة القيادة وبقية الوحدات
  const dashSrc = readFileSync(
    new URL("../src/app/(app)/dashboard/page.tsx", import.meta.url),
    "utf8",
  );
  for (const expected of [
    'chartVariant="gauge"',
    'chartVariant="donut"',
    'chartVariant="waterfall"',
    'chartVariant="area"',
    'chartVariant="bars"',
    'chartVariant={isEmployee ? "columns" : "waterfall"}',
  ]) {
    assert.ok(dashSrc.includes(expected), `لوحة القيادة تفتقد ${expected}`);
  }

  const pageChecks = [
    ["../src/app/(app)/sales/page.tsx", 'chartVariant="donut"'],
    ["../src/app/(app)/sales/stats/page.tsx", 'chartVariant="bars"'],
    ["../src/app/(app)/finance/page.tsx", 'chartVariant="donut"'],
    ["../src/app/(app)/finance/expenses/page.tsx", 'chartVariant="donut"'],
    ["../src/app/(app)/finance/mine/page.tsx", 'chartVariant="waterfall"'],
    ["../src/app/(app)/inventory/page.tsx", 'chartVariant="columns"'],
  ];
  for (const [relPath, snippet] of pageChecks) {
    const src = readFileSync(new URL(relPath, import.meta.url), "utf8");
    assert.ok(src.includes(snippet), `الملف ${relPath} يفتقد ${snippet}`);
  }

  // ٣) تباين الألوان المرافقة للرسوم (--mp-alt و --mp-warn و --mp-accent و --mp-danger) في الثيمين والوضعين
  function extractBlock(source, selectorRegex) {
    const m = source.match(selectorRegex);
    assert.ok(m, `تعذّر العثور على الكتلة: ${selectorRegex}`);
    return m[1];
  }
  function hexVar(block, varName) {
    const m = block.match(new RegExp(`${varName}:\\s*(#[0-9a-fA-F]{6})`));
    assert.ok(m, `المتغيّر ${varName} مفقود`);
    return normalize(m[1]);
  }

  const walletDarkBlock = extractBlock(wsCss, /\n\.monthly-panther\s*\{([\s\S]*?)\n\}/);
  const selahtoneDarkBlock = extractBlock(
    wsCss,
    /\.workspace-shell\[data-theme="wallet-selahtone"\]\s+\.monthly-panther\s*\{([\s\S]*?)\n\}/,
  );
  const walletLightBlock = extractBlock(
    dmCss,
    /\.workspace-shell\[data-color-mode="light"\]\s+\.monthly-panther\s*\{([\s\S]*?)\n\}/,
  );
  const selahtoneLightBlock = extractBlock(
    dmCss,
    /\.workspace-shell\[data-color-mode="light"\]\[data-theme="wallet-selahtone"\]\s+\.monthly-panther\s*\{([\s\S]*?)\n\}/,
  );

  const matrices = [
    { name: "wallet (ليلي)", block: walletDarkBlock, surfaces: ["#0a0f0a"] },
    { name: "wallet-selahtone (ليلي)", block: selahtoneDarkBlock, surfaces: ["#050e29"] },
    { name: "wallet (نهاري)", block: walletLightBlock, surfaces: ["#ffffff", "#f5faf3", "#eef5eb"] },
    { name: "wallet-selahtone (نهاري)", block: selahtoneLightBlock, surfaces: ["#ffffff", "#f1f9fd", "#e9f4fa"] },
  ];

  for (const m of matrices) {
    for (const tokenName of ["--mp-accent", "--mp-danger", "--mp-alt", "--mp-warn", "--mp-title", "--mp-value", "--mp-muted"]) {
      const fg = hexVar(m.block, tokenName);
      for (const bg of m.surfaces) {
        const ratio = contrast(fg, bg);
        assert.ok(
          ratio >= MIN,
          `تباين ${tokenName} (${fg}) على ${bg} في ${m.name} = ${ratio.toFixed(2)} وهو أقل من ${MIN}`,
        );
      }
    }
  }
});

test("صفحة تسليم وتحويل النقد تدعم تمكين الموظف بأمان واستبعاد المقفلة وأرشيف التسويات وسند الطباعة وتباين WCAG >= 4.5:1", () => {
  const pageSrc = readFileSync(
    new URL("../src/app/(app)/finance/transfers/page.tsx", import.meta.url),
    "utf8",
  );
  const formSrc = readFileSync(
    new URL("../src/app/(app)/finance/transfers/transfer-form.tsx", import.meta.url),
    "utf8",
  );
  const ledgerSrc = readFileSync(
    new URL("../src/app/(app)/finance/transfers/transfers-ledger-view.tsx", import.meta.url),
    "utf8",
  );
  const voucherSrc = readFileSync(
    new URL("../src/app/(app)/finance/transfers/handover-voucher.tsx", import.meta.url),
    "utf8",
  );

  // ١) استبعاد الحسابات المقفلة وعدم كشف رصيد الخزنة للموظف (balance: null)
  assert.ok(pageSrc.includes("!account.closedAt"));
  assert.ok(pageSrc.includes("balance: null"));
  assert.ok(pageSrc.includes("PantherSpotlightCard"));
  assert.ok(pageSrc.includes("fin-kpi-strip"));
  assert.ok(pageSrc.includes('id="pending-settlements"'));

  // ٢) نموذج ذكي باتجاه الحركة وجسر محاكاة حي وسند رسمي بعد الحفظ
  assert.ok(formSrc.includes("CUSTODY_TO_VAULT"));
  assert.ok(formSrc.includes("VAULT_TO_CUSTODY"));
  assert.ok(formSrc.includes("fin-transfer-bridge"));
  assert.ok(formSrc.includes("HandoverVoucher"));

  // ٣) سجل رقابي قابل للتصفية وتصدير CSV + أرشيف قرارات التسوية + سند توقيعين
  assert.ok(ledgerSrc.includes("downloadCsvFile"));
  assert.ok(ledgerSrc.includes("أرشيف التسويات"));
  assert.ok(voucherSrc.includes("توقيع المسلِّم"));
  assert.ok(voucherSrc.includes("توقيع المستلِم"));

  // ٤) تباين ألوان جسر المحاكاة نهارًا وليلًا >= 4.5:1
  assert.ok(contrast("#166534", "#f5f9f3") >= MIN);
  assert.ok(contrast("#b42a2a", "#f5f9f3") >= MIN);
  assert.ok(contrast("#86efac", "#0f1c11") >= MIN);
  assert.ok(contrast("#fca5a5", "#0f1c11") >= MIN);
});

test("صفحة بنود المصروفات تفصل المدفوع عن المعلّق وتعرض سجل التدقيق وتدعم التصدير والتكامل وتباين WCAG >= 4.5:1", () => {
  const catPageSrc = readFileSync(
    new URL("../src/app/(app)/finance/categories/page.tsx", import.meta.url),
    "utf8",
  );
  const catDirSrc = readFileSync(
    new URL("../src/app/(app)/finance/categories/categories-directory-view.tsx", import.meta.url),
    "utf8",
  );
  const catFormsSrc = readFileSync(
    new URL("../src/app/(app)/finance/categories/category-forms.tsx", import.meta.url),
    "utf8",
  );

  // ١) فصل محاسبي صريح للمدفوع (PAID) + استعلام سجل التدقيق + المؤشر التفاعلي
  assert.ok(catPageSrc.includes('exp.status === "PAID"'));
  assert.ok(catPageSrc.includes("finance.category_audit"));
  assert.ok(catPageSrc.includes("PantherSpotlightCard"));
  assert.ok(catPageSrc.includes("fin-kpi-strip"));
  assert.ok(catPageSrc.includes("PrintPageButton"));

  // ٢) سجل تعديلات البنود + البحث والفلترة والتصدير + تكامل روابط المصروفات
  assert.ok(catDirSrc.includes("سجل تعديلات البنود"));
  assert.ok(catDirSrc.includes("downloadCsvFile"));
  assert.ok(catDirSrc.includes("/finance/expenses/new?categoryId="));
  assert.ok(catDirSrc.includes("/finance/expenses?category="));

  // ٣) كشف التكرار الحي ودعم الإضافة المتتالية ومعاينة التغيير قبل الحفظ
  assert.ok(catFormsSrc.includes("isDuplicate"));
  assert.ok(catFormsSrc.includes("fin-cat-diff-preview"));

  // ٤) تباين شارات التغيّر الشهري والمعلّق نهارًا وليلًا >= 4.5:1
  assert.ok(contrast("#991b1b", "#fef2f2") >= MIN);
  assert.ok(contrast("#166534", "#ecfdf5") >= MIN);
  assert.ok(contrast("#92400e", "#ffffff") >= MIN);
  assert.ok(contrast("#fecaca", "#1f1416") >= MIN);
  assert.ok(contrast("#bbf7d0", "#112217") >= MIN);
  assert.ok(contrast("#fde68a", "#0f1c11") >= MIN);
});

test("صفحة الفروع والمستخدمون تحمي تراتبية الصلاحيات والعُهَد المفتوحة وتعرض سجل الأمان وتباين WCAG >= 4.5:1", () => {
  const adminPageSrc = readFileSync(
    new URL("../src/app/(app)/admin/page.tsx", import.meta.url),
    "utf8",
  );
  const adminActionsSrc = readFileSync(
    new URL("../src/app/(app)/admin/actions.ts", import.meta.url),
    "utf8",
  );
  const adminHubSrc = readFileSync(
    new URL("../src/app/(app)/admin/admin-hub-view.tsx", import.meta.url),
    "utf8",
  );
  const adminFormsSrc = readFileSync(
    new URL("../src/app/(app)/admin/admin-forms.tsx", import.meta.url),
    "utf8",
  );

  // ١) حوكمة الصلاحيات وفحص العهدة المفتوحة قبل النقل أو الإيقاف
  assert.ok(adminActionsSrc.includes("requireManagerOnly"));
  assert.ok(adminActionsSrc.includes("canManageTargetUser"));
  assert.ok(adminActionsSrc.includes("findOpenCustodyForUser"));

  // ٢) المؤشر التفاعلي + ٣ تبويبات (مستخدمون / فروع / أمان) + مولّد كلمات مرور وتصدير CSV
  assert.ok(adminPageSrc.includes("PantherSpotlightCard"));
  assert.ok(adminHubSrc.includes("الأمان وسجل الدخول"));
  assert.ok(adminHubSrc.includes("downloadCsvFile"));
  assert.ok(adminFormsSrc.includes("generateStrongPassword"));
  assert.ok(adminFormsSrc.includes("بطاقة الدخول"));

  // ٣) تباين الشارات الإدارية والأمنية نهارًا وليلًا >= 4.5:1
  assert.ok(contrast("#1e3a8a", "#dbeafe") >= MIN);
  assert.ok(contrast("#0f766e", "#ccfbf1") >= MIN);
  assert.ok(contrast("#166534", "#dcfce7") >= MIN);
  assert.ok(contrast("#991b1b", "#fee2e2") >= MIN);
  assert.ok(contrast("#92400e", "#fef3c7") >= MIN);
  assert.ok(contrast("#bfdbfe", "#16263f") >= MIN);
  assert.ok(contrast("#99f6e4", "#112d2c") >= MIN);
  assert.ok(contrast("#0b1512", "#86efac") >= MIN);
});

test("صفحة فحص الجاهزية والأمان تفحص المحاور الأربعة وتعرض مصفوفة الفروع ومسبار الصحة وتباين WCAG >= 4.5:1", () => {
  const setupPageSrc = readFileSync(
    new URL("../src/app/(app)/setup/page.tsx", import.meta.url),
    "utf8",
  );
  const setupViewSrc = readFileSync(
    new URL("../src/app/(app)/setup/setup-readiness-view.tsx", import.meta.url),
    "utf8",
  );

  // ١) مؤشر الجاهزية (gauge) + المحاور الأربعة + قاعدة عدم تشغيل تهيئة البيانات على قاعدة قائمة
  assert.ok(setupPageSrc.includes("PantherSpotlightCard"));
  assert.ok(setupPageSrc.includes('chartVariant="gauge"'));
  assert.ok(setupPageSrc.includes("isValidAuthSecret"));
  assert.ok(setupPageSrc.includes("لا تُشغّل تهيئة البيانات على قاعدة قائمة"));
  assert.ok(!setupPageSrc.includes("أرسل لي لقطة هذه الصفحة"));

  // ٢) التبويبات الثلاثة + مسبار /api/health + تصدير CSV
  assert.ok(setupViewSrc.includes("مصفوفة جاهزية الفروع"));
  assert.ok(setupViewSrc.includes("بيئة التشغيل والوحدات"));
  assert.ok(setupViewSrc.includes("/api/health"));
  assert.ok(setupViewSrc.includes("downloadCsvFile"));

  // ٣) تباين شارات الفحص نهارًا وليلًا >= 4.5:1
  assert.ok(contrast("#166534", "#dcfce7") >= MIN);
  assert.ok(contrast("#92400e", "#fef3c7") >= MIN);
  assert.ok(contrast("#991b1b", "#fee2e2") >= MIN);
  assert.ok(contrast("#bbf7d0", "#112418") >= MIN);
  assert.ok(contrast("#fde68a", "#251f12") >= MIN);
  assert.ok(contrast("#fecaca", "#241416") >= MIN);
});

test("صفحة بيع جديد تعرض نبض الكاونتر والتسعير الاسترشادي وبطاقات الدفع والإيصال المثبّت والفوري بتباين WCAG >= 4.5:1", () => {
  const newSalePageSrc = readFileSync(
    new URL("../src/app/(app)/sales/new/page.tsx", import.meta.url),
    "utf8",
  );
  const catalogFormSrc = readFileSync(
    new URL("../src/app/(app)/sales/new/catalog-sale-form.tsx", import.meta.url),
    "utf8",
  );

  // ١) شريط نبض الكاونتر + التسعير الاسترشادي + حفظ صلاحية المدير وموظف الفرع فقط
  assert.ok(newSalePageSrc.includes("sales-kpi-strip"));
  assert.ok(newSalePageSrc.includes("buildTypePriceHints"));
  assert.ok(newSalePageSrc.includes("إنشاء البيع متاح للمدير وموظف الفرع فقط"));

  // ٢) ترجمة عناوين الحقول بالعربية + بطاقات وسائل الدفع + المسودة + الإيصال اللحظي والفوري
  assert.ok(catalogFormSrc.includes("formatCartFieldEntries"));
  assert.ok(catalogFormSrc.includes("evaluateLiveDiscountStatus"));
  assert.ok(catalogFormSrc.includes("sale-pay-cards"));
  assert.ok(catalogFormSrc.includes("sale-live-receipt"));
  assert.ok(catalogFormSrc.includes("sale-instant-receipt"));
  assert.ok(catalogFormSrc.includes("sessionStorage"));

  // ٣) تباين بطاقات الدفع وحارس الخصم وشارات المتبقي نهارًا وليلًا >= 4.5:1
  assert.ok(contrast("#ffffff", "#1e341e") >= MIN);
  assert.ok(contrast("#e2f3df", "#1e341e") >= MIN);
  assert.ok(contrast("#ffffff", "#0d465d") >= MIN);
  assert.ok(contrast("#e0f2fe", "#0d465d") >= MIN);
  assert.ok(contrast("#166534", "#dcfce7") >= MIN);
  assert.ok(contrast("#991b1b", "#fee2e2") >= MIN);
  assert.ok(contrast("#92400e", "#fef3c7") >= MIN);
  assert.ok(contrast("#ecfdf5", "#13393c") >= MIN);
  assert.ok(contrast("#ccfbf1", "#13393c") >= MIN);
});

test("صفحة تسجيل مصروف (/finance/expenses/new) تعرض شريط النبض وسند القيد المثبت وتباين >= 4.5:1", () => {
  const newExpensePageSrc = readFileSync(
    new URL("../src/app/(app)/finance/expenses/new/page.tsx", import.meta.url),
    "utf8",
  );
  const expenseFormSrc = readFileSync(
    new URL("../src/app/(app)/finance/expenses/new/expense-form.tsx", import.meta.url),
    "utf8",
  );
  const newExpenseCss = readFileSync(
    new URL("../src/app/(app)/finance/expenses/new/new-expense.css", import.meta.url),
    "utf8",
  );

  // ١) شريط نبض المصروفات + خطوات دورة الرقابة + سجل آخر ٥ قيود + التقييد بصلاحيات المدير والمحاسب وموظف الفرع
  assert.ok(newExpensePageSrc.includes("fin-kpi-strip"));
  assert.ok(newExpensePageSrc.includes("fin-stepper"));
  assert.ok(newExpensePageSrc.includes("آخر ٥ مصروفات"));
  assert.ok(newExpensePageSrc.includes("تسجيل المصروفات متاح للمدير والمحاسب"));

  // ٢) اختيار البند السريع + حاسبة الضريبة المشمولة + كاشف التكرار + سند القيد المثبت والفوري + المسودة
  assert.ok(expenseFormSrc.includes("expense-description-input"));
  assert.ok(expenseFormSrc.includes("calculateInclusiveTaxExtract"));
  assert.ok(expenseFormSrc.includes("detectExpenseDuplicateRisk"));
  assert.ok(expenseFormSrc.includes("exp-live-voucher"));
  assert.ok(expenseFormSrc.includes("exp-instant-voucher"));
  assert.ok(expenseFormSrc.includes("sessionStorage"));

  // ٣) تباين شرائح البند وشريط التكرار وسند القيد المثبت نهارًا وليلًا >= 4.5:1
  assert.ok(newExpenseCss.includes("exp-cat-chip"));
  assert.ok(contrast("#ffffff", "#1e341e") >= MIN);
  assert.ok(contrast("#e2f3df", "#1e341e") >= MIN);
  assert.ok(contrast("#ffffff", "#0d465d") >= MIN);
  assert.ok(contrast("#e0f2fe", "#0d465d") >= MIN);
  assert.ok(contrast("#991b1b", "#fee2e2") >= MIN);
  assert.ok(contrast("#fecaca", "#3b171b") >= MIN);
  assert.ok(contrast("#92400e", "#fef3c7") >= MIN);
  assert.ok(contrast("#fde68a", "#3a2912") >= MIN);
  assert.ok(contrast("#fef3c7", "#3b2c12") >= MIN);
});

test("صفحة فتح خزنة أو عهدة (/finance/accounts) تعرض نبض التغطية وحاسبة الفئات ومحضر الفتح المثبت بتباين >= 4.5:1", () => {
  const accountsPageSrc = readFileSync(
    new URL("../src/app/(app)/finance/accounts/page.tsx", import.meta.url),
    "utf8",
  );
  const accountFormSrc = readFileSync(
    new URL("../src/app/(app)/finance/accounts/account-form.tsx", import.meta.url),
    "utf8",
  );
  const decisionSrc = readFileSync(
    new URL("../src/app/(app)/finance/accounts/custody-request-decision.tsx", import.meta.url),
    "utf8",
  );
  const actionsSrc = readFileSync(
    new URL("../src/app/(app)/finance/actions.ts", import.meta.url),
    "utf8",
  );
  const accountsCss = readFileSync(
    new URL("../src/app/(app)/finance/accounts/accounts.css", import.meta.url),
    "utf8",
  );

  // ١) شريط نبض التغطية + استبعاد العُهَد المقفلة + الحراسة المبكرة لصلاحية المدير والمحاسب
  assert.ok(accountsPageSrc.includes("fin-kpi-strip"));
  assert.ok(accountsPageSrc.includes("fin-stepper"));
  assert.ok(accountsPageSrc.includes("computeBranchAccountCoverage"));
  assert.ok(accountsPageSrc.includes("فتح الحسابات النقدية متاح للمدير والمحاسب فقط"));

  // ٢) بطاقات النوع + حاسبة فئات النقد + محضر الافتتاح المثبت والفوري + إصلاح قرار طلب العهدة
  assert.ok(accountFormSrc.includes("acc-kind-cards"));
  assert.ok(accountFormSrc.includes("calculateDenominationTotal"));
  assert.ok(accountFormSrc.includes("acc-live-protocol"));
  assert.ok(accountFormSrc.includes("acc-instant-protocol"));
  assert.ok(accountFormSrc.includes("sessionStorage"));
  assert.ok(decisionSrc.includes("acc-decision-toggles"));
  assert.ok(actionsSrc.includes("buildCustodyDecisionPayload"));

  // ٣) تباين بطاقات النوع وشريط الفروع الناقصة وحاسبة الفئات نهارًا وليلًا >= 4.5:1
  assert.ok(accountsCss.includes("acc-denom-box"));
  assert.ok(contrast("#ffffff", "#1e341e") >= MIN);
  assert.ok(contrast("#e2f3df", "#1e341e") >= MIN);
  assert.ok(contrast("#ffffff", "#0d465d") >= MIN);
  assert.ok(contrast("#e0f2fe", "#0d465d") >= MIN);
  assert.ok(contrast("#ffffff", "#166534") >= MIN);
  assert.ok(contrast("#ffffff", "#991b1b") >= MIN);
  assert.ok(contrast("#92400e", "#fef3c7") >= MIN);
  assert.ok(contrast("#fde68a", "#3a2912") >= MIN);
  assert.ok(contrast("#451a03", "#fef3c7") >= MIN);
  assert.ok(contrast("#166534", "#dcfce7") >= MIN);
  assert.ok(contrast("#bbf7d0", "#143524") >= MIN);
});

test("قائمة أقسام لوحة القيادة المنسدلة (/dashboard) تفرد كل محتوى على حدة وتحقق تباين >= 4.5:1 نهارًا وليلًا", () => {
  const dashPageSrc = readFileSync(
    new URL("../src/app/(app)/dashboard/page.tsx", import.meta.url),
    "utf8",
  );
  const switcherSrc = readFileSync(
    new URL("../src/app/(app)/dashboard/dashboard-section-switcher.tsx", import.meta.url),
    "utf8",
  );
  const switcherCss = readFileSync(
    new URL("../src/app/(app)/dashboard/dashboard-switcher.css", import.meta.url),
    "utf8",
  );

  // ١) ربط القائمة المنسدلة بكل محتويات لوحة القيادة منفردة + العرض الشامل
  assert.ok(dashPageSrc.includes("DashboardSectionSwitcher"));
  for (const sectionId of [
    '"pulse-wallet"',
    '"all"',
    '"pulse"',
    '"wallet"',
    '"efficiency"',
    '"monthly-sales"',
    '"collections"',
    '"cash-conversion"',
    '"cash-balance"',
    '"monthly-expenses"',
    '"profitability"',
    '"branch-efficiency"',
    '"aging-radar"',
    '"live-feed"',
    '"branch-health"',
  ]) {
    assert.ok(dashPageSrc.includes(sectionId), `القسم ${sectionId} مفقود من قائمة لوحة القيادة`);
  }

  // ٢) القائمة المنسدلة (listbox) + المزامنة مع القائمة المنسدلة لـ «لوحة القيادة» في الشريط الجانبي
  const appNavSrc = readFileSync(
    new URL("../src/app/(app)/app-navigation.tsx", import.meta.url),
    "utf8",
  );
  const navItemsSrc = readFileSync(
    new URL("../src/app/(app)/navigation-items.ts", import.meta.url),
    "utf8",
  );
  assert.ok(switcherSrc.includes('role="listbox"'));
  assert.ok(switcherSrc.includes("stepDashboardSection"));
  assert.ok(switcherSrc.includes("sessionStorage"));
  assert.ok(switcherSrc.includes("replaceState"));
  assert.ok(navItemsSrc.includes("buildDashboardSidebarChildren"));
  assert.ok(appNavSrc.includes("selahtone:dashboard-section-select"));
  assert.ok(appNavSrc.includes("selahtone:dashboard-section-changed"));

  // ٣) تباين الشارات والخيار المحدّد نهارًا وليلًا >= 4.5:1 وإخفاء الشريط عند الطباعة
  assert.ok(switcherCss.includes("@media print"));
  assert.ok(contrast("#991b1b", "#fee2e2") >= MIN);
  assert.ok(contrast("#fecaca", "#3b171b") >= MIN);
  assert.ok(contrast("#ffffff", "#1f5c2e") >= MIN);
  assert.ok(contrast("#ffffff", "#0d5a78") >= MIN);
});















test("لوحة شرح إعدادات أقسام لوحة القيادة تستخدم ألوانًا دلالية مقروءة نهارًا وليلًا", () => {
  const switcherSrc = readFileSync(new URL("../src/app/(app)/dashboard/dashboard-section-switcher.tsx", import.meta.url), "utf8");
  const switcherCss = readFileSync(new URL("../src/app/(app)/dashboard/dashboard-switcher.css", import.meta.url), "utf8");
  const workspaceCss = readFileSync(new URL("../src/app/(app)/workspace.css", import.meta.url), "utf8");
  assert.ok(switcherSrc.includes("dash-settings-panel"));
  assert.ok(switcherSrc.includes("إظهار الكل (استعادة الافتراضي)"));
  assert.ok(switcherSrc.includes("selahtone:dashboard-visibility:"));
  assert.ok(switcherSrc.includes("شرح بقية خيارات لوحة القيادة"));
  assert.ok(switcherCss.includes(".dash-settings-option__copy small{color:var(--db-muted)"));
  assert.ok(switcherCss.includes("background:var(--db-surface-soft)"));
  assert.ok(switcherCss.includes("data-hidden-toggles"));

  const dayBlock = workspaceCss.match(/\.dashboard\s*\{(?=[^}]*--db-surface:)([\s\S]*?)\n\}/);
  const selatoneBlock = workspaceCss.match(/\.workspace-shell\[data-theme="wallet-selahtone"\]\s+\.dashboard\s*\{([\s\S]*?)\n\}/);
  assert.ok(dayBlock && selatoneBlock, "رموز ألوان لوحة القيادة النهارية مفقودة");
  for (const [name, block] of [["wallet", dayBlock], ["wallet-selahtone", selatoneBlock]]) {
    const color = (tokenName) => {
      const match = block[1].match(new RegExp(`--${tokenName}:\\s*(#[0-9a-fA-F]{6})`));
      assert.ok(match, `رمز --${tokenName} مفقود من ثيم ${name}`);
      return match[1];
    };
    assert.ok(contrast(color("db-ink"), color("db-surface")) >= MIN, `${name}: نص اللوحة على سطحها`);
    assert.ok(contrast(color("db-muted"), color("db-surface-soft")) >= MIN, `${name}: النص التوضيحي على سطحه`);
  }
});

test("تصميم الدمج الأخير يضع الحافظة داخل الشبكة، والشبكة المضغوطة تضعها فوق اللوحة", () => {
  const dashboard = readFileSync(new URL("../src/app/(app)/dashboard/page.tsx", import.meta.url), "utf8");
  const switcher = readFileSync(new URL("../src/app/(app)/dashboard/dashboard-section-switcher.tsx", import.meta.url), "utf8");
  const switcherCss = readFileSync(new URL("../src/app/(app)/dashboard/dashboard-switcher.css", import.meta.url), "utf8");
  const walletStart = dashboard.indexOf("const fullDashboardWallet");
  const spaciousStart = dashboard.indexOf("const fullDashboardView");
  const compactStart = dashboard.indexOf("const compactDashboardView", spaciousStart);
  const renderEnd = dashboard.indexOf("return (\n          <DashboardSectionSwitcher", compactStart);
  assert.ok(spaciousStart >= 0 && compactStart > spaciousStart && renderEnd > compactStart);
  const spacious = dashboard.slice(spaciousStart, compactStart);
  const compact = dashboard.slice(compactStart, renderEnd);
  assert.ok(dashboard.slice(walletStart, spaciousStart).includes("dashboard-cards-grid__wallet"));
  assert.ok(spacious.includes("className=\"dashboard-cards-grid\"") && spacious.includes("fullDashboardWallet"), "التصميم الواسع يضم الحافظة في الشبكة");
  assert.ok(spacious.indexOf("fullDashboardWallet") < spacious.indexOf("allSpotlightCards"), "الحافظة أول بطاقة في الشبكة الواسعة");
  assert.ok(!compact.includes("dashboard-cards-grid__wallet"), "التصميم المضغوط لا يضع الحافظة داخل شبكة المؤشرات");
  assert.ok(dashboard.includes("fullViewWallet={fullDashboardWallet}"));
  assert.ok(dashboard.includes("compactView={compactDashboardView}"));
  assert.ok(switcher.includes('selahtone:dashboard-all-layout:${userScopeKey}'));
  assert.ok(switcher.includes('window.localStorage.getItem(layoutStorageKey) === "spacious"'));
  assert.ok(switcher.includes('chooseAllLayout("spacious")'));
  assert.ok(switcher.includes('chooseAllLayout("compact")'));
  assert.ok(switcher.includes(">واسع</span>"));
  assert.ok(switcher.includes(">مضغوط</span>"));
  assert.ok(switcher.includes("data-dashboard-layout={allLayout}"));
  assert.ok(switcher.includes('{allLayout === "compact" ? fullViewWallet : null}'));
  assert.ok(switcher.includes('{allLayout === "compact" ? compactView : fullView}'));
  assert.ok(spacious.includes("allPanelBeforeCards") && spacious.includes("allPanelAfterCards"));
  for (const content of ["pulseNode", "paceNode", "governanceNode", "agingRadarNode", "liveFeedNode", "branchHealthNode"]) {
    assert.ok(dashboard.includes(content), `${content} يجب أن يبقى موصولًا بلوحة المتابعة`);
  }
  assert.ok(switcherCss.includes(".dashboard-all-panel"));
  assert.ok(switcherCss.includes(".dashboard-all-wallet"));
  assert.ok(switcherCss.includes("grid-template-columns: repeat(2, minmax(0, 1fr))"), "الشبكة المضغوطة تتكون من عمودين على المقاسات المتوسطة");
  assert.ok(switcherCss.includes('@media (min-width: 1280px) {\n  .dash-single-stage--all[data-dashboard-layout="compact"] .dashboard-all-panel .dashboard-cards-grid.dashboard-all-panel__spotlights {\n    grid-template-columns: repeat(4, minmax(0, 1fr));'), "أربعة أعمدة على الشاشات الكبيرة");
  assert.ok(switcherCss.includes('.dash-single-stage--all[data-dashboard-layout="compact"] .dashboard-all-panel .monthly-panther__chart { height: 96px; }'), "تصغير الرسوم محصور بخيار الشبكة المضغوطة");
  assert.ok(switcherCss.includes('.dash-single-stage--all[data-dashboard-layout="compact"] .dashboard-all-panel .monthly-panther__metrics,'), "ملخص الأرقام مخفي في الشبكة المضغوطة فقط");
  assert.ok(switcherCss.includes('.dash-single-stage--all[data-dashboard-layout="compact"] .dashboard-all-panel .monthly-panther__foot,'), "روابط إجراءات المؤشر مخفية في الشبكة المضغوطة فقط");
  assert.ok(switcherCss.includes('.dash-single-stage--all[data-dashboard-layout="compact"] .dashboard-all-panel .monthly-panther__subtitle { display: none !important; }'), "الوصف أسفل اسم المؤشر مخفي في الشبكة المضغوطة فقط");
  assert.ok(switcherCss.includes("@media (max-width: 760px)"), "تعود الشبكة إلى عمود واحد على الهاتف");
  assert.ok(switcherCss.includes(".dashboard-design-menu"));
});

test("اتجاه مبيعات اليوم يظهر في ملخص الجيب فقط عند التصميم المضغوط للوضع المركّز", () => {
  const dashboard = readFileSync(new URL("../src/app/(app)/dashboard/page.tsx", import.meta.url), "utf8");
  const switcher = readFileSync(new URL("../src/app/(app)/dashboard/dashboard-section-switcher.tsx", import.meta.url), "utf8");
  const switcherCss = readFileSync(new URL("../src/app/(app)/dashboard/dashboard-switcher.css", import.meta.url), "utf8");
  const wallet = readFileSync(new URL("../src/app/(app)/dashboard/dashboard-wallet.tsx", import.meta.url), "utf8");
  const workspaceCss = readFileSync(new URL("../src/app/(app)/workspace.css", import.meta.url), "utf8");
  assert.ok(switcher.includes('data-dashboard-layout={allLayout}'), "التصميم الحالي متاح للقسم المركّز");
  assert.ok(switcherCss.includes('.dash-single-stage--pulse-wallet[data-dashboard-layout="compact"] .dashboard-pulse-strip > :nth-child(1)'), "بطاقة صافي مبيعات اليوم مخفية فقط في المركّز المضغوط");
  assert.ok(dashboard.includes('`${pulseData.todayGrowthPct >= 0 ? "↑ +" : "↓ "}${nf.format(pulseData.todayGrowthPct)}% عن الأمس`'), "النسبة والسهم يستخدمان صيغة المقارنة نفسها مع الأمس");
  assert.ok(wallet.includes('data-pocket-item={item.key}') && wallet.includes('dashboard-pocket__trend'), "اتجاه المبيعات مرتبط بعنصر مبيعات اليوم داخل الجيب");
  assert.ok(workspaceCss.includes(".dashboard-pocket__trend {\n  display: none;"), "الاتجاه مخفي خارج السياق المطلوب");
  assert.ok(switcherCss.includes('.dashboard-wallet.is-revealed .dashboard-pocket__metric[data-pocket-item="today-sales"] .dashboard-pocket__trend') && switcherCss.includes('.dashboard-pocket:focus-visible .dashboard-pocket__metric[data-pocket-item="today-sales"] .dashboard-pocket__trend'), "النسبة تظهر مع كشف أرقام الجيب أو تركيز لوحة المفاتيح");
});

test("بطاقة تحصيلات الحافظة محصورة بالموظف والمدير والوضع المركّز المضغوط", () => {
  const dashboard = readFileSync(new URL("../src/app/(app)/dashboard/page.tsx", import.meta.url), "utf8");
  const switcher = readFileSync(new URL("../src/app/(app)/dashboard/dashboard-section-switcher.tsx", import.meta.url), "utf8");
  const switcherCss = readFileSync(new URL("../src/app/(app)/dashboard/dashboard-switcher.css", import.meta.url), "utf8");
  const wallet = readFileSync(new URL("../src/app/(app)/dashboard/dashboard-wallet.tsx", import.meta.url), "utf8");
  assert.ok(dashboard.includes('(isEmployee || session.role === "MANAGER") && pulseData ?'));
  assert.ok(dashboard.includes("wallet-today-collections-title"));
  assert.ok(dashboard.includes("pulseData.todayNetCollectedFormatted") && dashboard.includes("pulseData.todayCashCollectedFormatted") && dashboard.includes("pulseData.todayElectronicCollectedFormatted"));
  assert.ok(switcher.includes('data-collection-wallet={compactCollectionsAvailable ? "true" : "false"}'));
  assert.ok(switcherCss.includes('.dash-single-stage--pulse-wallet[data-dashboard-layout="compact"][data-collection-wallet="true"] .dashboard-wallet__compact-collections'));
  assert.ok(switcherCss.includes('.dash-single-stage--pulse-wallet[data-dashboard-layout="compact"][data-collection-wallet="true"] .dashboard-pulse-strip > :nth-child(2)'), "بطاقة النبض لا تتكرر حين تنتقل التحصيلات إلى الحافظة");
  assert.ok(wallet.includes("visibleWalletSlides(el)") && wallet.includes("new MutationObserver(refreshSlides)"), "مؤشر شرائح الحافظة يتحدّث عند تبديل التصميم");
});

test("ترويسة صفحة لوحة القيادة تمتد بعرض مساحة العمل مع مراعاة القائمة الجانبية والجوال", () => {
  const switcherCss = readFileSync(new URL("../src/app/(app)/dashboard/dashboard-switcher.css", import.meta.url), "utf8");
  assert.ok(switcherCss.includes(".dashboard > .dashboard-heading"));
  assert.ok(switcherCss.includes("width: calc(100vw - var(--dashboard-sidebar-width))"));
  assert.ok(switcherCss.includes("--dashboard-sidebar-width: 256px"));
  assert.ok(switcherCss.includes("@media (max-width: 820px)"));
  assert.ok(switcherCss.includes("--dashboard-sidebar-width: 0px"));
  assert.ok(switcherCss.includes("width: 100vw"));
});

test("ترويسة لوحة القيادة تحتوي محدد نطاق الفرع والبحث الفوري داخلها", () => {
  const dashboard = readFileSync(new URL("../src/app/(app)/dashboard/page.tsx", import.meta.url), "utf8");
  const switcherCss = readFileSync(new URL("../src/app/(app)/dashboard/dashboard-switcher.css", import.meta.url), "utf8");
  const sectionSwitcher = readFileSync(new URL("../src/app/(app)/dashboard/dashboard-section-switcher.tsx", import.meta.url), "utf8");
  const appIcon = readFileSync(new URL("../src/components/app-icon.tsx", import.meta.url), "utf8");
  assert.ok(dashboard.includes("const dashboardScopeControl"));
  assert.ok(dashboard.includes("const dashboardOmniSearchForm"));
  assert.ok(dashboard.includes("{dashboardScopeControl}"));
  assert.ok(dashboard.includes("{dashboardOmniSearchForm}"));
  assert.ok(dashboard.includes('<details className="dashboard-scope-menu">'));
  assert.ok(dashboard.includes('className="dashboard-omni-form" role="search"'));
  assert.ok(dashboard.includes('<details className="dashboard-quick-menu">'));
  assert.ok(!dashboard.includes("dashboard-heading__description"), "وصف الدور محذوف من الترويسة نهائيًا");
  assert.ok(!dashboard.includes("ⓘ"), "رمز المعلومات محذوف من الترويسة");
  assert.ok(sectionSwitcher.includes('<details className="dashboard-design-menu">'));
  assert.ok(sectionSwitcher.includes('name={allLayout === "spacious" ? "layoutWide" : "layoutCompact"}'));
  assert.ok(sectionSwitcher.includes('<AppIcon name="layoutWide" aria-hidden="true" />'));
  assert.ok(sectionSwitcher.includes('<AppIcon name="layoutCompact" aria-hidden="true" />'));
  assert.ok(appIcon.includes('"layoutWide"'));
  assert.ok(appIcon.includes('"layoutCompact"'));
  assert.ok(appIcon.includes('case "layoutWide"'));
  assert.ok(appIcon.includes('case "layoutCompact"'));
  assert.ok(sectionSwitcher.includes('aria-label="اختيار تصميم لوحة القيادة"'));
  assert.ok(switcherCss.includes(".dashboard-heading__top {"));
  assert.match(switcherCss, /\.dashboard > \.dashboard-heading\s*\{[^}]*flex-direction:\s*column/s, "تبقى صفوف الترويسة متتابعة عموديًا");
  assert.ok(switcherCss.includes("z-index: 1000;"), "الترويسة فوق بطاقات اللوحة ذات طبقات 60 وما دون");
  assert.ok(switcherCss.includes("z-index: 1001;"), "قوائم النطاق والمزيد فوق الترويسة وبطاقات اللوحة");
  assert.ok(switcherCss.includes("@media (max-width: 760px)"));
  assert.ok(dashboard.includes("headerContent={dashboardHeaderContent}"));
  assert.ok(dashboard.includes("headerTools={dashboardHeaderTools}"));
  assert.ok(dashboard.includes("beforeContent={dashboardPrelude}"));
  const introPosition = sectionSwitcher.indexOf("{headerContent}");
  const sectionPickerPosition = sectionSwitcher.indexOf("dash-switcher-bar--header");
  const toolsPosition = sectionSwitcher.indexOf("{headerTools}");
  assert.ok(introPosition < sectionPickerPosition && sectionPickerPosition < toolsPosition, "محتوى اللوحة يأتي مباشرة بعد العنوان وقبل النطاق والبحث");
  assert.ok(sectionSwitcher.includes('className="dash-switcher-bar dash-switcher-bar--header no-print"'));
  const modeButtonPosition = sectionSwitcher.indexOf("className={`dash-mode-toggle");
  const designMenuPosition = sectionSwitcher.indexOf('<details className="dashboard-design-menu">');
  assert.ok(modeButtonPosition < designMenuPosition, "أيقونة التصميم تأتي بعد زر العودة إلى العرض المركّز");
  assert.ok(switcherCss.includes("direction: rtl;"), "أيقونة التصميم تقع بصريًا إلى يسار زر العرض المركّز");
  assert.ok(switcherCss.includes("stroke-width: 2.35;") && switcherCss.includes("color: currentColor;"), "أيقونات التنقل واضحة وتحافظ على تباين لون الزر");
  assert.ok(switcherCss.includes("grid-template-columns: minmax(0, 1fr) auto;") && switcherCss.includes("grid-column: 2;") && switcherCss.includes("border: 1.5px solid var(--db-border-strong);"), "محدد القسم يعرض النص والأزرار في صف واحد داخل الإطار نفسه");
  assert.ok(sectionSwitcher.includes('className="dash-step-btn dash-step-btn--previous"'));
  assert.ok(sectionSwitcher.includes('className="dash-step-btn dash-step-btn--next"'));
  assert.ok(sectionSwitcher.includes('<AppIcon name="chevronRight" aria-hidden="true" />'));
  assert.ok(sectionSwitcher.includes('<AppIcon name="chevronLeft" aria-hidden="true" />'));
  assert.ok(sectionSwitcher.includes('name={selectedId === "all" ? "focus" : "dashboard"}'), "يتبدل الرمز بين التركيز والشبكة بحسب العرض الحالي");
  assert.ok(appIcon.includes('case "focus"') && appIcon.includes('case "chevronLeft"') && appIcon.includes('case "chevronRight"'));
  assert.ok(sectionSwitcher.includes('aria-label={selectedId === "all" ? "العودة إلى العرض المركّز" : "عرض شامل، كل الأقسام"}'));
  assert.ok(switcherCss.includes(".dashboard-heading > .dash-switcher-bar--header"));
  const controlsPosition = sectionSwitcher.indexOf("{renderSwitcherControls()}");
  const dropdownButtonPosition = sectionSwitcher.indexOf('className="dash-dropdown-trigger"');
  const menuPosition = sectionSwitcher.indexOf("{open ? (");
  assert.ok(sectionPickerPosition < dropdownButtonPosition && dropdownButtonPosition < controlsPosition && controlsPosition < menuPosition, "الأزرار بجوار نص محتوى لوحة القيادة داخل محدد القسم");
  assert.ok(!sectionSwitcher.includes("{renderSwitcherControls()}\n        </div>"), "نسخة الأزرار ليست أسفل محدد القسم");
  assert.ok(switcherCss.includes(".dashboard-switcher-bar--header .dashboard-heading__selector-controls") && switcherCss.includes("width: 30px;") && switcherCss.includes("@media (max-width: 820px)"), "أزرار محدد القسم مضغوطة ومناسبة للشاشات الصغيرة");
});
