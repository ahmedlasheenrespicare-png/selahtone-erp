import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(
  new URL("../src/app/(app)/inventory/inventory.css", import.meta.url),
  "utf8",
);
const mobileBlock = css.slice(css.lastIndexOf("@media screen and (max-width: 620px)"));

test("inventory buttons, back links, search and confirmations have 44px mobile targets", () => {
  for (const selector of [
    ".inv-page .inv-button",
    ".inv-page .inv-back",
    ".inv-page .inv-search input",
    ".inv-page .inv-check",
  ]) {
    assert.ok(mobileBlock.includes(selector), `missing ${selector}`);
  }
  assert.match(mobileBlock, /min-height:\s*44px/);
});

test("inventory touch rules are screen-only and preserve desktop sizing", () => {
  assert.doesNotMatch(mobileBlock, /@media print/);
  assert.match(css, /\.inv-button\s*\{\s*min-height:\s*42px/);
  assert.match(css, /\.inv-search input\s*\{[^}]*min-height:\s*42px/s);
  assert.ok(css.includes("@media (max-width: 620px)"));
});
