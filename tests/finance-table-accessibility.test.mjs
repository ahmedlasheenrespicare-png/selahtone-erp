import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

function tsxFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? tsxFiles(path) : entry.name.endsWith(".tsx") ? [path] : [];
  });
}

const financeRoot = new URL("../src/app/(app)/finance/", import.meta.url).pathname;
const financeFiles = tsxFiles(financeRoot);
const wrappers = financeFiles.flatMap((path) => {
  const source = readFileSync(path, "utf8");
  return [...source.matchAll(/<div\b[^>]*className="fin-table-wrap"[^>]*>/g)].map((match) => ({
    path,
    tag: match[0],
  }));
});
const sharedTables = financeFiles.filter((path) => {
  const source = readFileSync(path, "utf8");
  return source.includes("<DataTable") && source.includes('regionClassName="fin-table-wrap"');
});

test("every finance table scroller is a named keyboard-accessible region", () => {
  assert.ok(wrappers.length + sharedTables.length >= 23, `expected the existing finance tables, found ${wrappers.length + sharedTables.length}`);
  for (const { path, tag } of wrappers) {
    assert.match(tag, /role="region"/, path);
    assert.match(tag, /aria-label="[^"]+"/, path);
    assert.match(tag, /tabIndex=\{0\}/, path);
  }
  const shared = readFileSync(new URL("../src/components/data-driven/data-table.tsx", import.meta.url), "utf8");
  assert.ok(shared.includes('className={regionClassName} role="region" aria-label={regionLabel} tabIndex={0}'));
  for (const path of sharedTables) {
    assert.ok(readFileSync(path, "utf8").includes("regionLabel="), path);
  }
});

test("finance table scrolling remains touch friendly and keyboard focused", () => {
  const css = readFileSync(new URL("../src/app/(app)/finance/finance.css", import.meta.url), "utf8");
  const wrap = css.match(/\.finance-suite \.fin-table-wrap \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(wrap, /overflow-x: auto/);
  assert.match(wrap, /overscroll-behavior-inline: contain/);
  assert.match(wrap, /-webkit-overflow-scrolling: touch/);
  assert.match(css, /\.fin-table-wrap:focus-visible/);
});

test("catalog sale cart is keyboard accessible", () => {
  const source = readFileSync(new URL("../src/app/(app)/sales/new/catalog-sale-form.tsx", import.meta.url), "utf8");
  const cart = source.match(/<div\b[^>]*className="inv-table-wrap table-wrap"[^>]*>/)?.[0] ?? "";
  assert.match(cart, /role="region"/);
  assert.match(cart, /aria-label="بنود سلة البيع"/);
  assert.match(cart, /tabIndex=\{0\}/);
});
