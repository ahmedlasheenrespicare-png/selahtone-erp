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

test('settlement browser: partial and zero transfer review with server confirmation', { timeout: 180000 }, async () => {
  const browserDir = process.env.SYNTHETIC_BROWSER_DIR;
  assert.ok(browserDir, 'Set SYNTHETIC_BROWSER_DIR to a separate installation containing playwright-core and @sparticuz/chromium');
  const external = createRequire(join(browserDir, 'package.json'));
  const { chromium } = external('playwright-core');
  const chromiumModule = external('@sparticuz/chromium');
  const chromiumBinary = chromiumModule.default ?? chromiumModule;
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
      await db.exec(`INSERT INTO finance.accounts (branch_id,kind,holder_id,opening_amount,opening_date,opened_by,opened_at) VALUES
        (1,'VAULT',NULL,10000,CURRENT_DATE-1,1,now()-interval '1 day'),
        (1,'CUSTODY',3,1000,CURRENT_DATE-1,1,now()-interval '1 day');
        -- The request follows the seeded cash collections later in the day.
        -- An earlier request is genuinely stale and must remain blocked.
        INSERT INTO finance.settlements (account_id,branch_id,requested_by,created_at,system_balance,counted_amount,sales_total,expenses_total,expected_amount,deviation,adjustment,reason,account_revision)
        VALUES (2,1,3,date_trunc('day',now()) + interval '21 hours 30 minutes',1000,1500,0,0,1000,500,500,'تسوية اصطناعية',0);`);
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
    browser = await chromium.launch({ executablePath: await chromiumBinary.executablePath(), args: [...chromiumBinary.args, '--single-process'], headless: true,
      env: { ...process.env, LD_LIBRARY_PATH: `${join(dir, 'lib')}:${process.env.LD_LIBRARY_PATH || ''}` } });
    const page = await browser.newPage();
    await page.goto(`${base}/login?next=%2Ffinance%2Ftransfers`);
    await page.locator('#email').fill('manager@selahtone.local');
    await page.locator('#password').fill(password);
    await Promise.all([page.waitForURL('**/finance/transfers', { timeout: 30000 }), page.locator('button[type=submit]').click()]);
    // A pending local marker is never itself a success assertion.
    await page.evaluate(() => sessionStorage.setItem('finance-settlement-pending:1', JSON.stringify({ id: '1', at: Date.now() })));
    await page.reload();
    assert.equal(await page.getByText(/يظهر في السجل أن التسوية/).count(), 0);
    const card = page.locator('.fin-panel').filter({ has: page.getByText('سبب الموظف: تسوية اصطناعية') });
    await card.waitFor();
    const amount = card.getByLabel('مبلغ التحويل المُدخل');
    assert.equal(await amount.count(), 1, `confirm form missing; section text: ${await page.locator('#pending-settlements').innerText()}`);
    assert.equal(await amount.inputValue(), '500.00');
    await amount.fill('0');
    assert.match(await card.innerText(), /مبلغ التحويل يختلف عن القيمة الافتراضية/);
    assert.match(await card.innerText(), /1,500\.00/);
    await card.getByLabel('سبب الاعتماد').fill('تحويل جزئي اصطناعي');
    await card.getByRole('button', { name: 'مراجعة الاعتماد' }).click();
    assert.ok(await card.getByRole('checkbox', { name: /لا يوجد مبلغ تحويل مسجّل/ }).isVisible());
    await amount.fill('200');
    assert.match(await card.innerText(), /1,300\.00/);
    assert.equal(await card.getByRole('checkbox', { name: /أقر/ }).count(), 0, 'changing amount forces review again');
    await card.getByRole('button', { name: 'مراجعة الاعتماد' }).click();
    assert.match(await card.innerText(), /رصيد العهدة بعده/);
    const checkbox = card.getByRole('checkbox', { name: /أقر بأن مبلغ التحويل المُدخل انتقل فعليًا/ });
    assert.ok(await checkbox.isVisible());
    assert.equal(await checkbox.evaluate(node => node.checkValidity()), false, 'acknowledgment is required before submission');
    await checkbox.check();
    await card.getByRole('button', { name: 'تأكيد الاعتماد والتحويل' }).click();
    const success = page.getByRole('status').filter({ hasText: 'يظهر في السجل أن التسوية #1 اعتُمدت بواسطة حسابك' });
    await success.waitFor({ timeout: 30000 });
    assert.match(await success.innerText(), /لا يثبت انتقال النقد فعليًا/);
    await page.waitForFunction(() => document.body.innerText.includes('1,300.00') && document.body.innerText.includes('10,200.00'), null, { timeout: 30000 });
    assert.equal(await card.count(), 0, 'resolved request disappears after refreshing');
    await page.reload();
    await success.waitFor();
    await success.getByRole('button', { name: 'إخفاء التنبيه' }).click();
    assert.equal(await success.count(), 0);
    assert.match(await page.locator('body').innerText(), /عبر 1 حركة توريد مسجّلة/);
    assert.doesNotMatch(await page.locator('body').innerText(), /\{monthToVaultCount\}/);
    await page.getByRole('tab', { name: /أرشيف التسويات/ }).click();
    assert.match(await page.locator('body').innerText(), /تحويل جزئي اصطناعي/);
  } catch (error) {
    throw new Error(`synthetic settlement browser test failed: ${error.stack || error}\nserver log tail:\n${logs}`, { cause: error });
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
