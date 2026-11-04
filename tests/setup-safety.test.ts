import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

test("setup page does not recommend seeding an existing database", () => {
  const source = readFileSync(path.join(process.cwd(), "src/app/(app)/setup/page.tsx"), "utf8");
  assert.doesNotMatch(source, /db:seed|prisma\s+db\s+seed/);
  assert.match(source, /لا تُشغّل تهيئة البيانات على قاعدة قائمة/);
});

test("setup page audits all 4 readiness axes without leaking secrets or prototype placeholders", () => {
  const pageSource = readFileSync(path.join(process.cwd(), "src/app/(app)/setup/page.tsx"), "utf8");
  const viewSource = readFileSync(
    path.join(process.cwd(), "src/app/(app)/setup/setup-readiness-view.tsx"),
    "utf8",
  );

  for (const axis of ["INFRA", "SECURITY", "COMMERCE", "FINANCE"]) {
    assert.ok(pageSource.includes(`axis: "${axis}"`), `missing axis ${axis}`);
  }

  // Never serialize raw AUTH_SECRET or DATABASE_URL values; only boolean validity
  assert.ok(pageSource.includes("isValidAuthSecret(process.env.AUTH_SECRET)"));
  assert.doesNotMatch(pageSource, /process\.env\.DATABASE_URL/);
  assert.doesNotMatch(pageSource, /أرسل لي لقطة هذه الصفحة/);
  assert.doesNotMatch(pageSource, /مستخدمو البذرة/);
  assert.doesNotMatch(viewSource, /db:seed|prisma\s+db\s+seed/);
});
