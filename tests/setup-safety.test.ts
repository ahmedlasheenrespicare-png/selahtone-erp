import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

test("setup page does not recommend seeding an existing database", () => {
  const source = readFileSync(path.join(process.cwd(), "src/app/(app)/setup/page.tsx"), "utf8");
  assert.doesNotMatch(source, /db:seed|prisma\s+db\s+seed/);
  assert.match(source, /لا تُشغّل تهيئة البيانات على قاعدة قائمة/);
});
