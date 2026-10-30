#!/usr/bin/env node
/** Disposable, deliberately isolated Next.js finance laboratory. Never uses a
 * DATABASE_URL from the parent process, .env files, production seeds, or a
 * network database. Restarting it destroys every fictional record. */
import { cpSync, existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const bin = join(root, "node_modules", ".bin");
if (!existsSync(join(bin, "next")) || !existsSync(join(bin, "prisma"))) {
  console.error("Install project dependencies first (npm ci). No production database is required.");
  process.exit(1);
}
const appTest = process.argv.includes("--test");
const cutoverTest = process.argv.includes("--test-cutover");
const testMode = appTest || cutoverTest;
const buildMode = process.argv.includes("--build");
if (Number(appTest) + Number(cutoverTest) + Number(buildMode) > 1) throw new Error("Choose only one disposable test or build mode");
const port = process.env.FINANCE_LAB_PORT ?? "4187";
if (!/^\d{2,5}$/.test(port) || +port < 1024 || +port > 65535) throw new Error("FINANCE_LAB_PORT must be between 1024 and 65535");
const dir = mkdtempSync(join(tmpdir(), "selahtone-finance-app-"));
let child;
let cleaning = false;
function clean() {
  if (cleaning) return;
  cleaning = true;
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* disposable; OS may clean later */ }
}
function copy(rel) {
  const target = join(dir, rel);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(join(root, rel), target, { recursive: true, filter: (source) => {
    const name = basename(source);
    return !lstatSync(source).isSymbolicLink() && !/^\.env(?:\..*)?$/.test(name) && ![".git", ".next", "node_modules"].includes(name);
  } });
}
for (const rel of ["src", "prisma/schema.prisma", "prisma/manual-inventory-upgrade.sql", "prisma/manual-receiving-upgrade.sql", "prisma/manual-commerce-upgrade.sql", "tests/fixtures/inventory-baseline.sql", "prototypes/finance-engine", "package.json", "tsconfig.json"]) copy(rel);
cpSync(join(root, "prototypes/finance-app/overlay"), dir, { recursive: true });
if (appTest) cpSync(join(root, "prototypes/finance-app/test/integration.test.ts"), join(dir, "tests/finance-lab-app.test.ts"));
if (cutoverTest) {
  for (const rel of ["prototypes/finance-cutover", "tests/fixtures/finance-cutover.sql", "tests/fixtures/finance-legacy-categories.sql"]) copy(rel);
  cpSync(join(root, "prototypes/finance-app/test/cutover-integration.test.ts"), join(dir, "tests/finance-cutover-lab.test.ts"));
}
symlinkSync(join(root, "node_modules"), join(dir, "node_modules"), "dir");
// A separate PGlite-compatible client; the project's generated client is never changed.
const schemaPath = join(dir, "prisma/schema.prisma");
const originalSchema = readFileSync(schemaPath, "utf8");
const generator = 'provider = "prisma-client-js"';
if (originalSchema.split(generator).length !== 2) { clean(); throw new Error("Expected exactly one Prisma client generator; lab generation was stopped."); }
const schema = originalSchema.replace(generator, 'provider = "prisma-client-js"\n  output = "../.finance-client"\n  engineType = "client"');
writeFileSync(schemaPath, schema);
// Deliberate allowlist: in particular, never inherit DATABASE_URL, DIRECT_URL,
// authentication secrets, deployment tokens, or any production .env file.
const env = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  HOME: dir,
  TMPDIR: tmpdir(),
  LANG: process.env.LANG ?? "C.UTF-8",
  NODE_ENV: "development",
  NEXT_TELEMETRY_DISABLED: "1",
  DATABASE_URL: "postgresql://unused.invalid/finance_lab",
  DIRECT_URL: "postgresql://unused.invalid/finance_lab",
  AUTH_SECRET: randomBytes(48).toString("base64url"),
  FINANCE_LAB_ONLY: "disposable-in-memory",
  FINANCE_LAB_PROJECT_DIR: dir,
  // Prisma's generator is WASM here. Dummy executables suppress network engine
  // downloads, not a real DB connection; no Prisma native engine is used.
  PRISMA_SCHEMA_ENGINE_BINARY: "/usr/bin/true",
  PRISMA_QUERY_ENGINE_LIBRARY: "/usr/bin/true",
};
if (buildMode) {
  // Build in this throw-away directory only. Next forces NODE_ENV=production
  // while collecting pages; relax the dev-only guard in this temporary copy,
  // not in the overlay or deployable application. The dummy URLs and PGlite
  // in-memory adapter remain mandatory. Keep worker count bounded for the lab.
  const labPrisma = join(dir, "src/lib/prisma.ts");
  const guarded = 'process.env.NODE_ENV !== "development"';
  const content = readFileSync(labPrisma, "utf8");
  if (content.split(guarded).length !== 2) { clean(); throw new Error("Expected the lab development-only guard"); }
  writeFileSync(labPrisma, content.replace(guarded, "false"));
  writeFileSync(join(dir, "next.config.js"), 'module.exports = { experimental: { cpus: 2 }, serverExternalPackages: ["@electric-sql/pglite", "pglite-prisma-adapter"] };\n');
  env.NODE_ENV = "production";
}
if (testMode && process.env.FINANCE_TEST_PG_BIN) {
  env.FINANCE_TEST_PG_BIN = process.env.FINANCE_TEST_PG_BIN;
  if (process.env.LD_LIBRARY_PATH) env.LD_LIBRARY_PATH = process.env.LD_LIBRARY_PATH;
}
console.log("\nمعمل المالية: نسخة مؤقتة بقاعدة في الذاكرة وبيانات وهمية فقط؛ لا تحفظ بيانات حقيقية.\n");
const generated = spawnSync(join(bin, "prisma"), ["generate", "--schema", schemaPath], { cwd: dir, env, stdio: "inherit" });
if (generated.status !== 0) { clean(); process.exit(generated.status || 1); }
if (testMode || buildMode) {
  // The overlay is intentionally excluded from the production tsconfig; check
  // the generated disposable app and its integration test independently.
  const checked = spawnSync(join(bin, "tsc"), ["--noEmit", "--incremental", "false", "--pretty", "false"], { cwd: dir, env, stdio: "inherit" });
  if (checked.status !== 0) { clean(); process.exit(checked.status || 1); }
}
child = testMode
  ? spawn(join(bin, "tsx"), ["--test", cutoverTest ? "tests/finance-cutover-lab.test.ts" : "tests/finance-lab-app.test.ts"], { cwd: dir, env, stdio: "inherit" })
  : buildMode
    ? spawn(join(bin, "next"), ["build", dir], { cwd: dir, env, stdio: "inherit" })
    : spawn(join(bin, "next"), ["dev", dir, "--hostname", "0.0.0.0", "--port", port], { cwd: dir, env, stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { if (child && !child.killed) child.kill(signal); });
child.on("error", (error) => { console.error(error); clean(); process.exitCode = 1; });
child.on("exit", (code, signal) => { clean(); process.exitCode = signal ? 0 : (code ?? 1); });
