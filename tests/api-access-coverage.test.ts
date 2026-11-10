import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

const root = join(process.cwd(), "src/app/api");
function routes(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? routes(path) : entry.name === "route.ts" ? [relative(root, path).replaceAll("\\", "/")] : [];
  });
}

test("API inventory has no unreviewed endpoints", () => {
  assert.deepEqual(routes(root).sort(), ["commerce/available-serials/route.ts", "health/route.ts", "logout/route.ts", "session/clear/route.ts"].sort());
});

test("serial search is authenticated and gated by both sales page and write permission", () => {
  const source = readFileSync(join(root, "commerce/available-serials/route.ts"), "utf8");
  assert.match(source, /!session\s*\|\|\s*session\.mustChangePassword/);
  assert.match(source, /apiAccessDenial\("\/sales\/new",\s*\{\s*write:\s*true\s*\}\)/);
  assert.ok(source.indexOf("if (denial) return denial") < source.indexOf("await searchAvailableSaleSerials"));
  const guard = readFileSync(join(process.cwd(), "src/lib/access-control-server.ts"), "utf8");
  const section = guard.slice(guard.indexOf("export async function apiAccessDenial"), guard.indexOf("/** للوحة الإدارة:"));
  assert.match(section, /!ctx\.session\s*\|\|\s*ctx\.session\.mustChangePassword/);
  assert.match(section, /!key\s*\|\|\s*!ctx\.isAllowed\(key\)/);
  assert.match(section, /options\?\.write\s*&&\s*!\(await writeAccessAllowed\(key\)\)/);
  assert.match(section, /private, no-store/);
});

test("public health probe does not return table counts or database error details", () => {
  const source = readFileSync(join(root, "health/route.ts"), "utf8");
  assert.match(source, /await Promise\.all/);
  assert.doesNotMatch(source, /counts:|error\.message/);
  assert.match(source, /Cache-Control.*no-store/);
});
