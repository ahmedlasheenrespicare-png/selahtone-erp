import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../src/app/(app)/workspace.css", import.meta.url), "utf8");
const block = css.match(/@media screen and \(max-width: 820px\) \{[\s\S]*?\n\}/)?.[0] ?? "";

test("mobile form text is large enough to avoid iOS focus zoom", () => {
  assert.ok(block, "mobile form media query exists");
  assert.match(block, /\.workspace-content input:not/);
  assert.match(block, /\.workspace-content select/);
  assert.match(block, /\.workspace-content textarea/);
  assert.match(block, /font-size: 16px !important/);
});

test("mobile inputs and selects provide a 44px touch target", () => {
  assert.match(block, /min-height: 44px !important/);
  assert.match(block, /screen and \(max-width: 820px\)/);
});

test("mobile form rules exclude non-text controls and do not affect print", () => {
  for (const type of ["checkbox", "radio", "range", "hidden"]) {
    assert.ok(block.includes(`:not([type="${type}"])`), `excludes ${type}`);
  }
  assert.doesNotMatch(block, /@media print/);
});
