#!/usr/bin/env node
// LOCAL PGlite preview bootstrap (NOT for production).
// Why this exists: this environment cannot download Prisma engine binaries, so the
// regular Postgres client cannot run. The app has a local-only branch in src/lib/prisma.ts
// (enabled solely by PRISMA_PGLITE_DIR) that uses the generated WASM client + PGlite.
// This script makes that path reproducible:
//   1) verifies the generated client is present,
//   2) patches node_modules/.prisma/client/wasm-worker-loader.mjs from workerd semantics
//      to a Node-native WebAssembly.Module loader (idempotent, backup kept),
//   3) creates the PGlite database and applies DDL generated from the DMMF,
//   4) applies the synthetic demo fixture (3 users / 9 sales / 7 collections / 5 expenses).
// Usage:
//   node scripts/local-pglite-preview.cjs [--reset]
// Env:
//   PREVIEW_PGLITE_DIR   database directory (default: <os.tmpdir()>/pglite-preview)
//   PREVIEW_PASSWORD     demo user password (default: Preview@2026!)
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const REPO = path.join(__dirname, '..');
const PGLITE_DIR = process.env.PREVIEW_PGLITE_DIR || path.join(os.tmpdir(), 'pglite-preview');
const RESET = process.argv.includes('--reset');
const PASSWORD = process.env.PREVIEW_PASSWORD || 'Preview@2026!';
const step = (msg) => console.log('[preview]', msg);

const LOADER_MARKER = 'Local PGlite preview loader';
const PATCHED_LOADER = `// ${LOADER_MARKER} (patched by scripts/local-pglite-preview.cjs).
// The generated loader expects workerd semantics (default export = the wasm
// module namespace whose '.default' is the WebAssembly.Module). Node's native
// ESM wasm namespace has NO 'default' export, so we build the module from bytes.
import { readFileSync } from 'node:fs';
const engineWasmModule = new WebAssembly.Module(
  readFileSync(new URL('./query_engine_bg.wasm', import.meta.url))
);
export default Promise.resolve({ default: engineWasmModule });
`;

(async () => {
  const clientWasm = path.join(REPO, 'node_modules', '.prisma', 'client', 'query_engine_bg.wasm');
  if (!fs.existsSync(clientWasm)) {
    console.error('[preview] generated client missing — run: npx prisma generate');
    process.exit(2);
  }

  const loaderPath = path.join(REPO, 'node_modules', '.prisma', 'client', 'wasm-worker-loader.mjs');
  const current = fs.existsSync(loaderPath) ? fs.readFileSync(loaderPath, 'utf8') : '';
  if (!current.includes(LOADER_MARKER)) {
    if (current) fs.writeFileSync(loaderPath + '.orig', current);
    fs.writeFileSync(loaderPath, PATCHED_LOADER);
    step('patched generated wasm-worker-loader.mjs (backup: wasm-worker-loader.mjs.orig)');
  } else {
    step('wasm-worker-loader.mjs already patched — skipped');
  }

  if (RESET && fs.existsSync(PGLITE_DIR)) {
    fs.rmSync(PGLITE_DIR, { recursive: true, force: true });
    step('removed existing PGlite dir (--reset)');
  }

  const { PGlite } = require(path.join(REPO, 'node_modules', '@electric-sql', 'pglite'));
  const pg = new PGlite(PGLITE_DIR);

  const tables = await pg.query(
    "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'"
  );
  if (Number(tables.rows[0].n) === 0) {
    step('applying DDL generated from DMMF ...');
    const { buildDdl } = require('./local-pglite-ddl.cjs');
    await pg.exec(buildDdl());
    step('schema applied');
  } else {
    step(`schema present (${tables.rows[0].n} tables) — skipped DDL (use --reset to rebuild)`);
  }

  const users = await pg.query('SELECT count(*)::int AS n FROM users');
  if (Number(users.rows[0].n) === 0) {
    const bcrypt = require(path.join(REPO, 'node_modules', 'bcryptjs'));
    const hash = (await bcrypt.hash(PASSWORD, 10)).replace(/'/g, "''");
    const sql = fs
      .readFileSync(path.join(__dirname, 'local-pglite-seed.sql'), 'utf8')
      .split('__PREVIEW_BCRYPT__')
      .join(hash);
    await pg.exec(sql);
    step('synthetic fixture applied; demo password for all users: ' + PASSWORD);
  } else {
    step('fixture already present — skipped (use --reset to rebuild)');
  }

  const counts = await pg.query(
    "SELECT (SELECT count(*)::int FROM commerce_sales) AS sales, (SELECT count(*)::int FROM commerce_collections) AS collections, (SELECT count(*)::int FROM users) AS users, (SELECT count(*)::int FROM expenses) AS expenses"
  );
  console.log('[preview] counts:', counts.rows[0]);
  await pg.close();

  console.log(`
[preview] Done — local synthetic database at: ${PGLITE_DIR}

Run the preview:
  PRISMA_PGLITE_DIR=${PGLITE_DIR} AUTH_SECRET=<32+ char secret> npm run dev

Mint a manager session cookie:
  PREVIEW_PGLITE_DIR=${PGLITE_DIR} AUTH_SECRET=<same secret> npm run preview:local:session 1

Demo logins: manager@selahtone.local / accountant@selahtone.local / arh@selahtone.local
This is synthetic local data for visual verification only — not production, not a performance signal.
`);
})().catch((e) => {
  console.error('[preview] FAILED:', e);
  process.exit(1);
});
