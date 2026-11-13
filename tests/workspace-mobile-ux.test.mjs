import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const navigation = readFileSync(new URL("../src/app/(app)/app-navigation.tsx", import.meta.url), "utf8");
const workspaceCss = readFileSync(new URL("../src/app/(app)/workspace.css", import.meta.url), "utf8");

test("mobile overlays close on every pathname change, including browser navigation", () => {
  const routeEffect = navigation.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[pathname\]\);/)?.[0] ?? "";
  assert.match(routeEffect, /setAccountOpen\(false\)/);
  assert.match(routeEffect, /setMenuOpen\(false\)/);
});

test("mobile account trigger exposes its dialog semantics", () => {
  const trigger = navigation.match(/<button[\s\S]*?aria-controls="workspace-mobile-account-popover"[\s\S]*?onClick=/)?.[0] ?? "";
  assert.match(trigger, /aria-haspopup="dialog"/);
  assert.match(trigger, /aria-expanded=\{accountOpen\}/);
});

test("mobile menu and account dialog move focus on open and restore it on close", () => {
  assert.match(navigation, /const navigationRef = useRef<HTMLElement>\(null\)/);
  assert.match(navigation, /<nav ref=\{navigationRef\}/);

  const menuEffect = navigation.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[menuOpen\]\);/)?.[0] ?? "";
  assert.match(menuEffect, /menuWasOpenRef\.current\) toggleRef\.current\?\.focus\(\)/);
  assert.match(menuEffect, /querySelector<HTMLElement>\('\[aria-current="page"\], button, a\[href\]'\)/);
  assert.match(menuEffect, /cancelAnimationFrame/);

  const accountEffect = navigation.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[accountOpen\]\);/)?.[0] ?? "";
  assert.match(accountEffect, /accountWasOpenRef\.current\) accountTriggerRef\.current\?\.focus\(\)/);
  assert.match(accountEffect, /accountPopoverRef\.current\?\.querySelector<HTMLElement>\("a\[href\], button"\)\?\.focus\(\)/);
});

test("programmatic mobile scrolling respects reduced motion", () => {
  assert.match(navigation, /matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.matches/);
  assert.match(navigation, /behavior: reduceMotion \? "auto" : "smooth"/);
});

test("workspace uses dynamic viewport height with a fallback", () => {
  const shell = workspaceCss.match(/\.workspace-shell \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(shell.indexOf("min-height: 100vh;") >= 0);
  assert.ok(shell.indexOf("min-height: 100dvh;") > shell.indexOf("min-height: 100vh;"));
});

test("open mobile navigation stays scrollable within the dynamic viewport", () => {
  const mobileBlock = workspaceCss.match(/@media \(max-width: 820px\) \{[\s\S]*?@media \(max-width: 760px\)/)?.[0] ?? "";
  const openNavigation = mobileBlock.match(/\.workspace-navigation\.is-open \{[\s\S]*?\n  \}/)?.[0] ?? "";
  assert.match(openNavigation, /max-height: calc\(100vh - 150px\)/);
  assert.match(openNavigation, /max-height: calc\(100dvh - 150px\)/);
  assert.match(openNavigation, /overflow-y: auto/);
  assert.match(openNavigation, /overscroll-behavior: contain/);
  assert.match(mobileBlock, /padding-top: calc\(13px \+ env\(safe-area-inset-top, 0px\)\)/);
});
