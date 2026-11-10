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

test('finance transfers browser: duplicate branch names totals, ledgers and exports', { timeout: 180000 }, async () => {
  const browserDir = process.env.SYNTHETIC_BROWSER_DIR;
  assert.ok(browserDir, 'Set SYNTHETIC_BROWSER_DIR to a separate installation containing playwright-core and @sparticuz/chromium');
  const external = createRequire(join(browserDir, 'package.json'));
  const { chromium } = external('playwright-core');
  const chromiumBinary = external('@sparticuz/chromium');
  const dir = mkdtempSync(join(tmpdir(), 'selahtone-transfers-browser-'));
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
        INSERT INTO public.users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
        SELECT 5,2,'CS_AGENT','حامل الفرع الثاني','same-name-transfer@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3;
        INSERT INTO finance.accounts (branch_id,kind,holder_id,opening_amount,opening_date,opened_by) VALUES
        (1,'VAULT',NULL,1000,CURRENT_DATE,1),(1,'CUSTODY',3,1000,CURRENT_DATE,1),
        (2,'VAULT',NULL,2000,CURRENT_DATE,1),(2,'CUSTODY',5,2000,CURRENT_DATE,1);
        INSERT INTO finance.movements (kind,branch_id,source_id,destination_id,amount,actor_id) VALUES
        ('TRANSFER',1,2,1,111.11,1),('TRANSFER',2,4,3,222.22,1);
        INSERT INTO finance.settlements (account_id,branch_id,requested_by,system_balance,counted_amount,sales_total,expenses_total,expected_amount,deviation,adjustment,reason,status,resolved_by,resolved_at,resolution_reason) VALUES
        (2,1,3,1000,1000,0,0,1000,0,0,'طلب فرع ألف','REJECTED',1,now(),'رفض فرع ألف'),
        (4,2,5,2000,2000,0,0,2000,0,0,'طلب فرع باء','REJECTED',1,now(),'رفض فرع باء');`);
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
    const browserPackage = dirname(external.resolve('@sparticuz/chromium/package.json'));
    const archive = join(dir, 'browser-libs.tar');
    writeFileSync(archive, brotliDecompressSync(readFileSync(join(browserPackage, 'bin/al2023.tar.br'))));
    execFileSync('tar', ['-xf', archive, '-C', dir]);
    browser = await chromium.launch({ executablePath: await chromiumBinary.executablePath(), args: chromiumBinary.args, headless: true,
      env: { ...process.env, LD_LIBRARY_PATH: `${join(dir, 'lib')}:${process.env.LD_LIBRARY_PATH || ''}` } });
    const page = await browser.newPage();
    await page.goto(`${base}/login?next=%2Ffinance%2Ftransfers`);
    await page.locator('#email').fill('manager@selahtone.local');
    await page.locator('#password').fill(password);
    await Promise.all([page.waitForURL('**/finance/transfers', { timeout: 30000 }), page.locator('button[type=submit]').click()]);
    assert.match(await page.locator('body').innerText(), /حركات مسجّلة بتوقيت القاهرة حتى وقت القراءة/);
    assert.match(await page.locator('body').innerText(), /قد لا يشمل السجل كل الحركات/);
    const branchTabs = page.getByRole('tablist', { name: 'اختيار الفرع' });
    await branchTabs.getByRole('tab', { name: /فرع متطابق · ARH/ }).click();
    const source = page.getByLabel('من (المسلِّم — مصدر النقد)');
    assert.equal(await source.inputValue(), '2');
    await branchTabs.getByRole('tab', { name: /فرع متطابق · SHM/ }).click();
    assert.equal(await source.inputValue(), '4');
    await page.getByRole('tab', { name: 'حسب الفرع', exact: true }).click();
    const chartBlock = page.getByRole('tablist', {name: /طريقة عرض مؤشر حركة التسليم/}).locator('..');
    assert.match(await chartBlock.innerText(), /فرع متطابق · ARH[\s\S]*111\.11 ج\.م/);
    const chart = chartBlock.locator('[role=group]');
    await chart.focus(); await chart.press('ArrowRight');
    assert.match(await chartBlock.innerText(), /فرع متطابق · SHM[\s\S]*222\.22 ج\.م/);
    const filter = page.getByRole('combobox', { name: 'تصفية حسب الفرع' });
    await filter.waitFor();
    const options = await filter.locator('option').allTextContents();
    assert.ok(options.includes('فرع متطابق · ARH') && options.includes('فرع متطابق · SHM'));
    async function checkRows(caption, entries) {
      const table = page.locator('table').filter({ has: page.locator('caption', { hasText: caption }) });
      for (const [id, code, expected, excluded] of entries) {
        await filter.selectOption(id);
        await page.waitForFunction(([caption, expected, excluded]) => {
          const table = [...document.querySelectorAll('table')].find(t => t.caption?.textContent?.includes(caption));
          return table?.innerText.includes(expected) && !table.innerText.includes(excluded);
        }, [caption, expected, excluded]);
        assert.equal(await table.locator('tbody tr').count(), 1);
        assert.match(await table.innerText(), new RegExp(code));
        const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /تصدير CSV/ }).click()]);
        const csv = readFileSync(await download.path(), 'utf8');
        assert.ok(csv.includes(code) && csv.includes(expected));
        assert.ok(!csv.includes(excluded) && !csv.includes(code === 'ARH' ? 'SHM' : 'ARH'));
      }
      await filter.selectOption('all');
      await page.waitForFunction((caption) => [...document.querySelectorAll('table')].some(t => t.caption?.textContent?.includes(caption) && t.querySelectorAll('tbody tr').length === 2), caption);
    }
    await checkRows('سجل الحركات النقدية', [
      ['1','ARH','111.11','222.22'], ['2','SHM','222.22','111.11'],
    ]);
    await filter.selectOption('2');
    await page.waitForFunction(() => [...document.querySelectorAll('table')].some(t => t.caption?.textContent?.includes('سجل الحركات النقدية') && t.querySelectorAll('tbody tr').length === 1 && t.innerText.includes('222.22')));
    await page.evaluate(() => { window.print = () => {}; });
    await page.getByRole('button', { name: 'طباعة سند', exact: true }).click();
    const voucher = page.locator('.fin-handover-voucher.is-active-voucher');
    assert.match(await voucher.innerText(), /فرع متطابق · SHM/);
    assert.doesNotMatch(await voucher.innerText(), /ARH/);
    await filter.selectOption('all');
    await page.getByRole('tab', { name: /أرشيف التسويات/ }).click();
    await checkRows('طلبات التسوية', [
      ['1','ARH','رفض فرع ألف','رفض فرع باء'], ['2','SHM','رفض فرع باء','رفض فرع ألف'],
    ]);
  } catch (error) {
    throw new Error(`synthetic finance transfers browser test failed: ${error.stack || error}\nserver log tail:\n${logs}`, { cause: error });
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
