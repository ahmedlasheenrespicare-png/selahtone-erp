import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(
  new URL("../src/app/(app)/finance/finance.css", import.meta.url),
  "utf8",
);
const mobileBlock = css.slice(css.lastIndexOf("@media screen and (max-width: 720px)"));

test("finance actions, filters and voucher buttons have 44px mobile targets", () => {
  for (const selector of [
    ".finance-suite .fin-button",
    ".finance-suite .fin-filter-pill",
    ".finance-suite .fin-voucher-print-btn",
    ".fin-branch-select",
  ]) {
    assert.ok(mobileBlock.includes(selector), `missing ${selector}`);
  }
  assert.match(mobileBlock, /min-height:\s*44px/);
  assert.match(mobileBlock, /\.fin-search-box input,\s*\.fin-search-box__clear/);
  assert.match(mobileBlock, /\.fin-search-box__clear\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;/s);
});

test("finance touch overrides are screen-only and preserve desktop and print rules", () => {
  assert.ok(css.includes("@media screen and (max-width: 720px)"));
  assert.doesNotMatch(mobileBlock, /@media print/);
  assert.match(css, /\.finance-suite \.fin-button\s*\{[^}]*min-height:\s*42px/s);
  assert.match(css, /\.fin-filter-pill\s*\{[^}]*min-height:\s*34px/s);
  assert.ok(css.includes("@media print"));
});
