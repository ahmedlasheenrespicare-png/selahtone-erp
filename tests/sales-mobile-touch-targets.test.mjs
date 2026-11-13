import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(
  new URL("../src/app/(app)/sales/new/new-sale.css", import.meta.url),
  "utf8",
);
const mobileBlock = css.slice(css.lastIndexOf("@media screen and (max-width: 820px)"));

test("sales actions and selection controls have 44px mobile targets", () => {
  for (const selector of [
    ".sales-suite .inv-button",
    ".sale-draft-reset",
    ".sale-price-hint-btn",
    ".sale-line-edit",
    ".sale-customer-hint",
    ".sale-quick-chip",
    ".sale-mode-switch button",
    ".sale-fill-btn",
    ".sale-product__remove",
    ".sale-serials__list label",
  ]) {
    assert.ok(mobileBlock.includes(selector), `missing ${selector}`);
  }
  assert.match(mobileBlock, /min-height:\s*44px/);
  assert.match(mobileBlock, /\.sale-catalog-search input\s*\{\s*min-height:\s*44px;/);
});

test("serial choices become flex targets and print and desktop styles remain unchanged", () => {
  assert.match(mobileBlock, /\.sale-serials__list label\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;/s);
  assert.doesNotMatch(mobileBlock, /@media print/);
  assert.match(css, /\.sale-draft-reset\s*\{[^}]*padding:\s*5px 11px/s);
  assert.match(css, /\.sale-price-hint-btn\s*\{[^}]*padding:\s*3px 10px/s);
});
