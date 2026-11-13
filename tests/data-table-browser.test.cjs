/** Disposable UI test; requires a separately installed synthetic browser bundle. */
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { createServer } = require('node:net');
const { tmpdir } = require('node:os');
const { join, dirname } = require('node:path');
const { brotliDecompressSync } = require('node:zlib');
const { createRequire } = require('node:module');
const test = require('node:test');
const { PGlite } = require('@electric-sql/pglite');
const root = process.cwd();

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

const money = (text) => {
  const match = String(text).match(/-?[0-9][0-9,]*(?:\.[0-9]+)?/);
  return match ? Number(match[0].replace(/,/g, '')) : Number.NaN;
};

test('data table browser: sorting, pagination, CSV and filter reset on sales and expenses', { timeout: 360000 }, async (t) => {
  const trace = (message) => t.diagnostic(message);
  const browserDir = process.env.SYNTHETIC_BROWSER_DIR;
  assert.ok(browserDir, 'Set SYNTHETIC_BROWSER_DIR to a separate installation containing playwright-core and @sparticuz/chromium');
  const external = createRequire(join(browserDir, 'package.json'));
  const { chromium } = external('playwright-core');
  const chromiumModule = external('@sparticuz/chromium');
  const chromiumBinary = chromiumModule.default ?? chromiumModule;
  const dir = mkdtempSync(join(tmpdir(), 'selahtone-data-table-browser-'));
  const password = 'Synthetic-Browser-Test-2026!';
  let child, browser; let logs = '';
  try {
    execFileSync(process.execPath, [join(root, 'scripts/local-pglite-preview.cjs')], { cwd: root, env: { ...process.env, PREVIEW_PGLITE_DIR: dir, PREVIEW_PASSWORD: password }, stdio: 'pipe', timeout: 60000 });
    const db = new PGlite(dir);
    try {
      await db.exec(readFileSync(join(root, 'prisma/manual-access-control-upgrade.sql'), 'utf8'));
      await db.exec("SET selahtone.finance_release_candidate_test_only='yes'");
      for (const file of ['prototypes/finance-release/release-candidate.test-only.sql', 'prisma/manual-settlement-upgrade.sql', 'prisma/manual-custody-closure-upgrade.sql', 'prisma/manual-custody-and-count-requests.sql']) await db.exec(readFileSync(join(root, file), 'utf8'));
      // ثلاثون سجلًا اصطناعيًا في كل شاشة لتجاوز حجم الصفحة الافتراضي (25).
      await db.exec(`
        INSERT INTO commerce_sales (id, request_id, request_hash, branch_id, warehouse_id, customer_name, customer_phone,
          subtotal, discount, taxable_base, tax_total, total, revision, created_by_id, created_at)
        SELECT 1000 + g,
          ('10000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
          rpad('dt' || g::text, 64, 'x'),
          1, 1, 'عميل اصطناعي ' || g::text, '01000000' || lpad(g::text, 3, '0'),
          (g * 100 + 0.25), 0, (g * 100 + 0.25), 0, (g * 100 + 0.25), 1, 1,
          now() - (g || ' days')::interval
        FROM generate_series(1, 30) AS g;
        INSERT INTO commerce_sale_lines (id, sale_id, name_snapshot, quantity, unit_price, gross, discount, total, is_stock, is_serialized)
        SELECT 1000 + g, 1000 + g, 'بند اصطناعي ' || g::text, 1, (g * 100 + 0.25), (g * 100 + 0.25), 0, (g * 100 + 0.25), false, false
        FROM generate_series(1, 30) AS g;
        INSERT INTO finance.expenses (branch_id, category_id, category_snapshot, amount, expense_date, description, status, requested_by)
        SELECT 1, 1, 'بند اصطناعي', (g * 10.15), CURRENT_DATE - (g || ' days')::interval, 'مصروف اصطناعي ' || g::text,
          'PENDING', 3
        FROM generate_series(1, 30) AS g;
      `);
    } finally { await db.close(); }
    trace('synthetic database seeded');
    const port = await freePort(), base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [join(root, 'node_modules/next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', String(port)], {
      cwd: root, env: { ...process.env, DATABASE_URL: '', PRISMA_PGLITE_DIR: dir, AUTH_SECRET: 'synthetic-browser-only-2026-secret', FINANCE_ENABLED: 'true', INVENTORY_ENABLED: 'true', ADMIN_EMAILS: 'manager@selahtone.local' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', data => { logs = (logs + data).slice(-12000); });
    child.stderr.on('data', data => { logs = (logs + data).slice(-12000); });
    const deadline = Date.now() + 90000;
    let ready = false;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error('synthetic Next server stopped');
      try { if ((await fetch(`${base}/login`)).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(ready, 'synthetic Next server did not start');
    trace('next server ready');
    const browserPackage = dirname(dirname(external.resolve('@sparticuz/chromium')));
    const archive = join(dir, 'browser-libs.tar');
    writeFileSync(archive, brotliDecompressSync(readFileSync(join(browserPackage, 'bin/al2023.tar.br'))));
    execFileSync('tar', ['-xf', archive, '-C', dir]);
    browser = await chromium.launch({ executablePath: await chromiumBinary.executablePath(), args: chromiumBinary.args, headless: true,
      env: { ...process.env, LD_LIBRARY_PATH: `${join(dir, 'lib')}:${process.env.LD_LIBRARY_PATH || ''}` } });
    trace('browser launched');
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'ar-EG' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(60000);
    await page.goto(`${base}/login?next=%2Fsales`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    trace('login page loaded');
    await page.locator('#email').fill('manager@selahtone.local');
    await page.locator('#password').fill(password);
    await Promise.all([page.waitForURL('**/sales', { timeout: 90000 }), page.locator('button[type=submit]').click()]);
    trace('logged in');

    async function exercise({ path, tableSelector, sortHeader, moneyIndex, total, csvColumns, emptySelector }) {
      trace(`open ${path}`);
      await page.goto(base + path, { waitUntil: 'domcontentloaded', timeout: 90000 });
      const table = page.locator(tableSelector);
      await table.waitFor();
      trace(`${path}: table ready`);
      const bar = page.locator('.data-table__bar');
      assert.equal(await table.locator('tbody tr').count(), 25, `${path}: default page size`);
      assert.match(await bar.innerText(), new RegExp(`عرض 1–25 من ${total}`));
      assert.equal(await page.getByRole('button', { name: 'الصفحة السابقة' }).isDisabled(), true);
      await page.getByRole('button', { name: 'الصفحة التالية' }).click();
      await page.waitForFunction((expected) => document.querySelector('.data-table__range')?.textContent?.includes(`عرض 26–${expected} من ${expected}`), total);
      assert.equal(await table.locator('tbody tr').count(), total - 25);
      assert.equal(await page.getByRole('button', { name: 'الصفحة التالية' }).isDisabled(), true);

      await page.getByRole('combobox', { name: 'عدد الصفوف في الصفحة' }).selectOption('10');
      await page.waitForFunction(() => document.querySelector('.data-table__range')?.textContent?.includes('عرض 1–10'));
      assert.equal(await table.locator('tbody tr').count(), 10);
      await page.getByRole('button', { name: 'الصفحة التالية' }).click();
      await page.getByRole('button', { name: 'الصفحة التالية' }).click();
      await page.waitForFunction(() => document.querySelector('.data-table__range')?.textContent?.includes('عرض 21–30'));

      // الفرز يعيد الصفحة الأولى، ويعمل بلوحة المفاتيح، ويقارن المبالغ لا النصوص.
      trace(`${path}: pagination ok`);
      const sortButton = page.getByRole('button', { name: `ترتيب حسب ${sortHeader}`, exact: true });
      await sortButton.focus();
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('.data-table__range')?.textContent?.includes('عرض 1–10'));
      const header = page.locator(`${tableSelector} th`).filter({ has: sortButton });
      assert.equal(await header.getAttribute('aria-sort'), 'descending');
      const descending = (await table.locator('tbody tr').evaluateAll((rows, index) => rows.map(row => row.children[index]?.textContent ?? ''), moneyIndex)).map(money);
      for (let i = 1; i < descending.length; i++) assert.ok(descending[i - 1] >= descending[i], `${path}: descending cents`);
      await page.keyboard.press('Space');
      await page.waitForFunction(() => [...document.querySelectorAll('th')].some(th => th.getAttribute('aria-sort') === 'ascending'));
      const ascending = (await table.locator('tbody tr').evaluateAll((rows, index) => rows.map(row => row.children[index]?.textContent ?? ''), moneyIndex)).map(money);
      for (let i = 1; i < ascending.length; i++) assert.ok(ascending[i - 1] <= ascending[i], `${path}: ascending cents`);

      // التصدير من صفحة ثانية يشمل كل النتائج المرتّبة، لا صفوف الصفحة المعروضة فقط.
      await page.getByRole('button', { name: 'الصفحة التالية' }).click();
      await page.waitForFunction(() => document.querySelector('.data-table__range')?.textContent?.includes('عرض 11–20'));
      trace(`${path}: sort ok`);
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /تصدير CSV/ }).click()]);
      const csv = readFileSync(await download.path(), 'utf8');
      const lines = csv.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
      assert.equal(lines.length, total + 1, `${path}: CSV exports every filtered row`);
      assert.equal(lines[0].split(',').length, csvColumns);

      // تغيير التصفية يعيد الصفحة الأولى؛ وحالة الفراغ لا تعرض جدولًا مكررًا.
      trace(`${path}: csv ok`);
      const search = page.getByRole('searchbox');
      await search.fill('عميل اصطناعي 7');
      if (path === '/finance/expenses') await search.fill('مصروف اصطناعي 7');
      await page.waitForFunction(() => document.querySelector('.data-table__range')?.textContent?.includes('عرض 1–1 من 1'));
      assert.equal(await table.locator('tbody tr').count(), 1);
      await search.fill('لا-يوجد-مثل-هذا-السجل-أبدًا');
      await page.locator(emptySelector).waitFor();
      assert.equal(await page.locator(tableSelector).count(), 0);
      assert.equal(await page.locator('.data-table__empty-row').count(), 0);
    }

    await exercise({ path: '/sales', tableSelector: '.sales-invoices-table', sortHeader: 'الإجمالي الأصلي', moneyIndex: 3, total: 39, csvColumns: 10, emptySelector: '.sales-empty-filter' });
    await exercise({ path: '/finance/expenses', tableSelector: '.fin-table', sortHeader: 'المبلغ', moneyIndex: 4, total: 30, csvColumns: 7, emptySelector: '.fin-empty' });
    trace('all assertions passed');
    assert.deepEqual(errors, []);
  } catch (error) {
    throw new Error(`synthetic data table browser test failed: ${error.stack || error}\nserver log tail:\n${logs}`, { cause: error });
  } finally {
    if (browser) await browser.close();
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill('SIGTERM');
      await Promise.race([exited, new Promise(resolve => { const t = setTimeout(resolve, 5000); t.unref(); })]);
      if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; }
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
