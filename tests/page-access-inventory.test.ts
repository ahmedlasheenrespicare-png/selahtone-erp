/** Source inventory, not a substitute for direct HTTP authorization tests. */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import test from "node:test";
import { ACCESS_PAGES, canonicalPageForRoute } from "../src/lib/access-control";
const root = join(process.cwd(), "src/app/(app)");
function findPages(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? findPages(join(dir, e.name)) : e.name === "page.tsx" ? [join(dir,e.name)] : []);
}
const dynamic: Record<string, string> = { "/sales/[saleId]": "/sales", "/finance/expenses/[expenseId]": "/finance/expenses", "/finance/expenses/reviews": "/finance/expenses" };

test("every app page is explicitly catalogued and guarded, including dynamic pages", () => {
  const files = findPages(root);
  const registered = new Set(ACCESS_PAGES.map(p => p.route));
  const seen = new Set<string>();
  for (const file of files) {
    const path = `/${relative(root, file).split(sep).slice(0,-1).join("/")}`;
    const source = readFileSync(file,"utf8");
    if (["/admin", "/setup"].includes(path)) {
      assert.ok(source.includes("await requireSystemAdminOrRedirect()"), `${path}: system-admin guard missing`);
      continue;
    }
    if (path === "/dashboard") {
      assert.ok(source.includes("await requireSession()"), "dashboard requires a session");
      seen.add(path); continue;
    }
    const route = dynamic[path] ?? path;
    assert.ok(registered.has(route), `${path}: explicitly register its own access route or document dynamic parent`);
    assert.ok(source.includes(`await requirePageAccess("${route}")`), `${path}: expected page guard ${route}`);
    if (dynamic[path]) {
      const example = path.replace(/\[[^\]]+\]/g, "123");
      assert.equal(canonicalPageForRoute(example), route, `${path}: canonical route mismatch`);
    } else seen.add(path);
  }
  assert.deepEqual([...registered].sort(), [...seen].sort(), "registered pages and actual static routes must match");
  for (const dynamicPath of Object.keys(dynamic)) assert.ok(files.some(f => `/${relative(root,f).split(sep).slice(0,-1).join("/")}` === dynamicPath), `${dynamicPath} is stale`);
});

test("server guard rejects unknown call-site keys independently of admin or store health", () => {
  const server = readFileSync(join(process.cwd(),"src/lib/access-control-server.ts"),"utf8");
  const start = server.indexOf("export async function writeAccessAllowed(");
  const end = server.indexOf("export async function apiAccessDenial(", start);
  const body = server.slice(start,end);
  assert.ok(body.indexOf("if (!KNOWN_ACCESS_KEYS.has(key)) return false") < body.indexOf("if (ctx.isSystemAdmin) return true"));
  assert.ok(body.includes("if (!ctx.storeHealthy) return false"));
  assert.ok(server.includes('if (!key || !ctx.isAllowed(key)) redirect("/dashboard")'));
});

test("outage dashboard and layout fail closed before loading operational metrics", () => {
  const dashboard = readFileSync(join(root, "dashboard/page.tsx"), "utf8");
  const layout = readFileSync(join(root, "layout.tsx"), "utf8");
  const start = dashboard.indexOf("export default async function DashboardPage");
  const guard = dashboard.indexOf("if (!access.storeHealthy && !access.isSystemAdmin)", start);
  assert.ok(start >= 0 && guard > start);
  assert.ok(guard < dashboard.indexOf("prisma.", start), "dashboard must exit before first Prisma query");
  const financeQuery = dashboard.indexOf("financeDb.", start);
  assert.ok(financeQuery < 0 || guard < financeQuery, "dashboard must exit before first finance query");
  assert.match(layout, /if \(isFinanceEnabled && \(access\.storeHealthy \|\| access\.isSystemAdmin\)\)/);
});
