import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(
  new URL("../src/app/(app)/dashboard/dashboard-switcher.css", import.meta.url),
  "utf8",
);
const finalMobileBlock = css.slice(css.lastIndexOf("@media (max-width: 820px)"));

test("dashboard section controls provide 44px targets only on mobile", () => {
  const controls = finalMobileBlock.match(
    /\.dashboard-heading__selector-controls \.dash-step-btn,[\s\S]*?\{([^}]*)\}/,
  )?.[1] ?? "";
  assert.match(controls, /width:\s*44px/);
  assert.match(controls, /min-width:\s*44px/);
  assert.match(controls, /min-height:\s*44px/);
  assert.match(controls, /height:\s*44px/);
  assert.match(finalMobileBlock, /\.dash-dropdown-trigger,[\s\S]*?min-height:\s*44px/);
  assert.match(finalMobileBlock, /\.dashboard-design-menu__option[\s\S]*?min-height:\s*44px/);
});

test("dashboard mobile controls keep their single-row layout and desktop sizing", () => {
  assert.match(finalMobileBlock, /\.dashboard-heading__selector-controls \.dash-step-group/);
  const desktopControls = css.match(
    /\.dashboard-heading__selector-controls \.dash-step-btn,[\s\S]*?\{([^}]*)\}/,
  )?.[1] ?? "";
  assert.match(desktopControls, /width:\s*30px/);
  assert.match(desktopControls, /height:\s*30px/);
});
