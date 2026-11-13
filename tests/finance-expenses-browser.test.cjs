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

test('finance expenses browser: duplicate branch names totals, filters and exports', { timeout: 180000 }, async () => {
  const browserDir = process.env.SYNTHETIC_BROWSER_DIR;
  assert.ok(browserDir, 'Set SYNTHETIC_BROWSER_DIR to a separate installation containing playwright-core and @sparticuz/chromium');
  const external = createRequire(join(browserDir, 'package.json'));
  const { chromium } = external('playwright-core');
  const chromiumModule = external('@sparticuz/chromium');
  const chromiumBinary = chromiumModule.default ?? chromiumModule;
  const dir = mkdtempSync(join(tmpdir(), 'selahtone-expenses-browser-'));
  const password = 'Synthetic-Browser-Test-2026!';
  let child, browser; let logs = '';
  try {
    execFileSync(process.execPath, [join(root, 'scripts/local-pglite-preview.cjs')], { cwd: root, env: { ...process.env, PREVIEW_PGLITE_DIR: dir, PREVIEW_PASSWORD: password }, stdio: 'pipe', timeout: 60000 });
    const db = new PGlite(dir);
    try {
      await db.exec(readFileSync(join(root, 'prisma/manual-access-control-upgrade.sql'), 'utf8'));
      await db.exec("SET selahtone.finance_release_candidate_test_only='yes'");
      for (const file of ['prototypes/finance-release/release-candidate.test-only.sql', 'prisma/manual-settlement-upgrade.sql', 'prisma/manual-custody-closure-upgrade.sql', 'prisma/manual-custody-and-count-requests.sql']) await db.exec(readFileSync(join(root, file), 'utf8'));
      await db.exec(`UPDATE branches SET name_ar='فرع متطابق' WHERE id IN (1,2);
        INSERT INTO finance.expenses(branch_id,category_id,category_snapshot,amount,expense_date,description,status,requested_by)
        VALUES (1,1,'بند اصطناعي',111.11,(now() AT TIME ZONE 'Africa/Cairo')::date,'مصروف ألف اصطناعي','PENDING',3),
        (2,1,'بند اصطناعي',222.22,(now() AT TIME ZONE 'Africa/Cairo')::date,'مصروف باء اصطناعي','PENDING',3);`);
    } finally { await db.close(); }
    const port = await freePort(), base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [join(root, 'node_modules/next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', String(port)], {
      cwd: root, env: { ...process.env, DATABASE_URL: '', PRISMA_PGLITE_DIR: dir, AUTH_SECRET: 'synthetic-browser-only-2026-secret', FINANCE_ENABLED: 'true', INVENTORY_ENABLED: 'true', ADMIN_EMAILS: 'manager@selahtone.local' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', data => { logs = (logs + data).slice(-10000); });
    child.stderr.on('data', data => { logs = (logs + data).slice(-10000); });
    const deadline = Date.now() + 60000;
    let ready = false;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error('synthetic Next server stopped');
      try { if ((await fetch(`${base}/login`)).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(ready, 'synthetic Next server did not start');
    // Lambda's bundled NSS libraries are required on minimal Linux images.
    // Extract only into this disposable test directory, not the repository.
    const browserPackage = dirname(dirname(external.resolve('@sparticuz/chromium')));
    const archive = join(dir, 'browser-libs.tar');
    writeFileSync(archive, brotliDecompressSync(readFileSync(join(browserPackage, 'bin/al2023.tar.br'))));
    execFileSync('tar', ['-xf', archive, '-C', dir]);
    browser = await chromium.launch({ executablePath: await chromiumBinary.executablePath(), args: chromiumBinary.args, headless: true,
      env: { ...process.env, LD_LIBRARY_PATH: `${join(dir, 'lib')}:${process.env.LD_LIBRARY_PATH || ''}` } });
    const page = await browser.newPage();
    page.setDefaultTimeout(60000);
    await page.goto(`${base}/login?next=%2Ffinance%2Fexpenses`);
    await page.locator('#email').fill('manager@selahtone.local');
    await page.locator('#password').fill(password);
    await Promise.all([page.waitForURL('**/finance/expenses', { timeout: 60000 }), page.locator('button[type=submit]').click()]);
    const paidCard = page.locator('.fin-kpi-card--ring');
    await paidCard.waitFor();
    assert.equal(await page.locator('.fin-kpi-card--ring').count(), 1);
    assert.equal(await paidCard.locator('.stat-ring-pill__ring-wrap').getAttribute('data-empty'), 'false');
    assert.equal((await paidCard.locator('.stat-ring-pill__core').innerText()).trim(), '0%');
    assert.match(await paidCard.locator('.fin-kpi-card__value').innerText(), /0\.00/);
    await page.getByRole('tab', { name: 'حسب الفرع', exact: true }).click();
    const chartBlock = page.getByRole('tablist', {name: /طريقة عرض مؤشر مراحل الاعتماد/}).locator('..');
    assert.match(await chartBlock.innerText(), /فرع متطابق · SHM[\s\S]*222\.22 ج\.م/);
    const chart = chartBlock.locator('[role=group]');
    await chart.focus();
    await chart.press('ArrowRight');
    assert.match(await chartBlock.innerText(), /فرع متطابق · ARH[\s\S]*111\.11 ج\.م/);
    for (const path of ['/finance/expenses', '/finance/expenses/today']) {
      if (path.endsWith('/today')) await page.goto(`${base}${path}`);
      const filter = page.getByRole('combobox', { name: 'تصفية حسب الفرع' });
      await filter.waitFor();
      const options = await filter.locator('option').allTextContents();
      assert.equal(options.length, 3);
      assert.ok(options.includes('فرع متطابق · ARH'));
      assert.ok(options.includes('فرع متطابق · SHM'));
      const table = page.locator('table').filter({ has: page.locator('caption', { hasText: 'سجل المصروفات' }) });
      for (const [id, code, description, excluded] of [
        ['1', 'ARH', 'مصروف ألف اصطناعي', 'مصروف باء اصطناعي'],
        ['2', 'SHM', 'مصروف باء اصطناعي', 'مصروف ألف اصطناعي'],
      ]) {
        await filter.selectOption(id);
        await page.waitForFunction(([expected, excluded]) => {
          const table = [...document.querySelectorAll('table')].find(t => t.caption?.textContent?.includes('سجل المصروفات'));
          return table?.innerText.includes(expected) && !table.innerText.includes(excluded);
        }, [description, excluded]);
        assert.equal(await table.locator('tbody tr').count(), 1, path);
        assert.match(await table.innerText(), new RegExp(code));
        const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /تصدير CSV/ }).click()]);
        const csv = readFileSync(await download.path(), 'utf8');
        assert.ok(csv.includes(code) && csv.includes(description));
        assert.ok(!csv.includes(excluded) && !csv.includes(code === 'ARH' ? 'SHM' : 'ARH'));
      }
      await filter.selectOption('all');
      await page.waitForFunction(() => [...document.querySelectorAll('table')].some(t => t.caption?.textContent?.includes('سجل المصروفات') && t.querySelectorAll('tbody tr').length === 2));
    }

  } catch (error) {
    throw new Error(`synthetic finance expenses browser test failed: ${error.stack || error}\nserver log tail:\n${logs}`, { cause: error });
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
