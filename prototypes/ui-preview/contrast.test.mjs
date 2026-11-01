/**
 * اختبار التباين — يحرس ألا تتدهور قراءة الواجهة عند تغيير الألوان.
 *
 * يقرأ الألوان من styles.css نفسه (لا نسخة منها هنا)، فإذا غُيّر لون
 * إلى درجة أضعف فشل الاختبار قبل أن يصل التغيير إلى المستخدم.
 * الحد: ٤٫٥:١ لكل نص — فمعظم نصوص هذه الواجهة صغير (١٠–١٢px)،
 * والنص الصغير لا يُعفى في WCAG بل يحتاج التباين الأعلى.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf-8");

const hex = (value) => {
  let h = value.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const luminance = (rgb) => {
  const a = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
};
export function contrast(fg, bg) {
  const [hi, lo] = [luminance(hex(fg)), luminance(hex(bg))].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

function token(name) {
  const match = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`));
  assert.ok(match, `المتغيّر --${name} غير موجود في styles.css`);
  return match[1];
}

/** يقرأ لونًا من قاعدة CSS، ويحلّ المتغيّرات إن وُجدت. */
function fromRule(selector, property) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rule = css.match(new RegExp(`${escaped}\\{([^}]*)\\}`));
  assert.ok(rule, `القاعدة ${selector} غير موجودة`);
  const value = rule[1].match(new RegExp(`${property}:\\s*([^;}]+)`));
  assert.ok(value, `${property} غير موجود في ${selector}`);
  const raw = value[1].trim();
  const asVar = raw.match(/^var\(--([a-z0-9-]+)\)$/);
  return asVar ? token(asVar[1]) : raw;
}

const MIN = 4.5;

test("تباين النصوص الأساسية والثانوية على الأبيض", () => {
  for (const name of ["ink", "ink-2", "muted", "faint"]) {
    const ratio = contrast(token(name), "#ffffff");
    assert.ok(ratio >= MIN, `--${name} تباينه ${ratio.toFixed(2)} وهو أقل من ${MIN}`);
  }
});

test("تباين النص الثانوي على خلفية البطاقة الفاتحة", () => {
  const ratio = contrast(token("muted"), "#fbfcfe");
  assert.ok(ratio >= MIN, `--muted على #fbfcfe تباينه ${ratio.toFixed(2)}`);
});

test("تباين رأس الجدول والتلميحات الصغيرة", () => {
  assert.ok(contrast(fromRule(".table th", "color"), fromRule(".table th", "background")) >= MIN, "رأس الجدول");
  assert.ok(contrast(fromRule(".nav-item", "color"), "#ffffff") >= MIN, "عنصر القائمة");
  assert.ok(contrast(fromRule(".nav-item.is-active", "color"), fromRule(".nav-item.is-active", "background")) >= MIN, "عنصر القائمة النشط");
});

test("تباين الشارات على خلفياتها الملونة", () => {
  for (const tone of ["is-teal", "is-amber", "is-red", "is-blue", "is-gray", "is-copper"]) {
    const ratio = contrast(fromRule(`.tag.${tone}`, "color"), fromRule(`.tag.${tone}`, "background"));
    assert.ok(ratio >= MIN, `الشارة .tag.${tone} تباينها ${ratio.toFixed(2)}`);
  }
});

test("تباين التنبيهات داخل الصفحة", () => {
  for (const kind of ["warning", "info", "danger"]) {
    const ratio = contrast(fromRule(`.alert--${kind}`, "color"), fromRule(`.alert--${kind}`, "background"));
    assert.ok(ratio >= MIN, `.alert--${kind} تباينه ${ratio.toFixed(2)}`);
  }
});

test("تباين الأزرار: الأبيض على الأزرق، والأزرق على الأبيض", () => {
  assert.ok(contrast("#ffffff", token("blue")) >= MIN, "نص الزر");
  assert.ok(contrast(token("blue"), "#ffffff") >= MIN, "الرابط الأزرق");
});

test("تباين شريط التنبيه الأصفر أعلى المعاينة", () => {
  const ratio = contrast(fromRule(".preview-banner", "color"), fromRule(".preview-banner", "background"));
  assert.ok(ratio >= MIN, `شريط التنبيه تباينه ${ratio.toFixed(2)}`);
});
