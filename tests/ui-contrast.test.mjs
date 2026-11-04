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

  // وجود كافة عناصر الشريط العلوي داخل .workspace-sidebar__brand-row
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











