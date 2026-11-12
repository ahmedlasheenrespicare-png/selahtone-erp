import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workspaceCss = readFileSync(
  new URL("../src/app/(app)/workspace.css", import.meta.url),
  "utf8",
);
const darkModeCss = readFileSync(
  new URL("../src/app/(app)/dark-mode.css", import.meta.url),
  "utf8",
);
const mobileCss = workspaceCss.slice(workspaceCss.indexOf("@media (max-width: 820px)"));

function declarations(css, selector) {
  const selectorIndex = css.indexOf(selector);
  assert.notEqual(selectorIndex, -1, `Missing CSS rule: ${selector}`);
  const openingBrace = css.indexOf("{", selectorIndex + selector.length);
  const closingBrace = css.indexOf("}", openingBrace);
  assert.ok(openingBrace > selectorIndex && closingBrace > openingBrace);
  return css.slice(openingBrace + 1, closingBrace);
}

function assertMinimumTarget(css, selector, { width = true } = {}) {
  const rule = declarations(css, selector);
  assert.match(rule, /(?:min-)?height:\s*(?:4[4-9]|[5-9]\d|\d{3,})px\s*;/, `${selector} must be at least 44px tall`);
  if (width) {
    assert.match(rule, /(?:min-)?width:\s*(?:4[4-9]|[5-9]\d|\d{3,})px\s*;/, `${selector} must be at least 44px wide`);
  }
}

test("mobile navigation, account, theme and logout controls have 44px touch targets", () => {
  assertMinimumTarget(mobileCss, ".workspace-nav-toggle");
  assertMinimumTarget(mobileCss, ".workspace-account-link--compact");
  assertMinimumTarget(mobileCss, ".workspace-mobile-strip__inline-actions .workspace-logout");
  assert.match(
    darkModeCss,
    /\.workspace-topbar__skydate\.is-compact \.sky-cycle-card,[\s\S]*?height:\s*44px\s*;/,
  );
  assertMinimumTarget(darkModeCss, ".workspace-topbar__skydate.is-compact .sky-cycle-reset", { width: false });
});

test("the mobile brand row contains its enlarged controls without wrapping", () => {
  for (const selector of [
    ".workspace-sidebar__brand-row",
    ".workspace-sidebar__brand-row.is-selahtone-brand",
  ]) {
    const rule = declarations(mobileCss, selector);
    assert.match(rule, /height:\s*52px\s*;/);
    assert.match(rule, /min-height:\s*52px\s*;/);
    assert.match(rule, /max-height:\s*52px\s*;/);
  }
  assert.match(declarations(mobileCss, ".workspace-sidebar__brand-row"), /flex-wrap:\s*nowrap\s*;/);
});

test("touch-target changes stay in compact/mobile styles and preserve automatic theme recovery", () => {
  const compactReset = declarations(darkModeCss, ".workspace-topbar__skydate.is-compact .sky-cycle-reset");
  assert.doesNotMatch(compactReset, /display:\s*none/);
  assert.ok(darkModeCss.includes(".workspace-topbar__skydate.is-compact .sky-cycle-reset"));
  assert.ok(workspaceCss.includes(".workspace-mobile-strip__inline-actions .workspace-logout"));
});
