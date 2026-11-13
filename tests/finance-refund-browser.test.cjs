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

test('refund browser: blind balance, timing review and account changes', { timeout: 180000 }, async () => {
  const browserDir = process.env.SYNTHETIC_BROWSER_DIR;
  assert.ok(browserDir, 'Set SYNTHETIC_BROWSER_DIR to a separate installation containing playwright-core and @sparticuz/chromium');
  const external = createRequire(join(browserDir, 'package.json'));
  const { chromium } = external('playwright-core');
  const chromiumModule = external('@sparticuz/chromium');
  const chromiumBinary = chromiumModule.default ?? chromiumModule;
  const dir = mkdtempSync(join(tmpdir(), 'selahtone-refund-browser-'));
  const password = 'Synthetic-Browser-Test-2026!';
  let child, browser; let logs = '';
  try {
    execFileSync(process.execPath, [join(root, 'scripts/local-pglite-preview.cjs')], { cwd: root, env: { ...process.env, PREVIEW_PGLITE_DIR: dir, PREVIEW_PASSWORD: password }, stdio: 'pipe', timeout: 60000 });
    const db = new PGlite(dir);
    try {
      await db.exec(readFileSync(join(root, 'prisma/manual-access-control-upgrade.sql'), 'utf8'));
      await db.exec("SET selahtone.finance_release_candidate_test_only='yes'");
      for (const file of ['prototypes/finance-release/release-candidate.test-only.sql', 'prisma/manual-settlement-upgrade.sql', 'prisma/manual-custody-closure-upgrade.sql', 'prisma/manual-custody-and-count-requests.sql']) await db.exec(readFileSync(join(root, file), 'utf8'));
      await db.exec(`INSERT INTO finance.accounts (branch_id,kind,holder_id,opening_amount,opening_date,opened_by)
        VALUES (1,'VAULT',NULL,98765.43,DATE '2020-02-01',1),(1,'CUSTODY',3,10,DATE '2020-03-01',1);
        INSERT INTO finance.cash_counts(account_id,counted_amount,observed_balance,difference,account_revision,counted_on,reason,status,created_by,resolved_by,resolved_at,resolution_reason)
        VALUES(2,10,10,0,0,DATE '2020-04-01','جرد اصطناعي','CONFIRMED',1,1,TIMESTAMPTZ '2020-04-02 10:30:00+00','اعتماد اصطناعي');
        INSERT INTO public.access_control(subject_kind,subject,key,allowed) VALUES('role','ACCOUNTANT','/sales#refund-balances',false);
        UPDATE commerce_refunds SET amount=21900 WHERE id=10;`);
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
    await page.goto(`${base}/login?next=%2Fsales%2F6`);
    await page.locator('#email').fill('accountant@selahtone.local');
    await page.locator('#password').fill(password);
    await Promise.all([page.waitForURL('**/sales/6', { timeout: 30000 }), page.locator('button[type=submit]').click()]);
    const refund = page.locator('form').filter({ hasText: 'تسجيل رد مبلغ للعميل' });
    await refund.waitFor();
    assert.doesNotMatch(await page.content(), /98,765\.43|98765\.43/, 'balance must not be serialized to the browser');
    await page.locator('#refund-amount').fill('1');
    await page.locator('#refund-account').selectOption('1');
    assert.match(await refund.innerText(), /2020-02-01/, 'checkpoint date must be shown without balance permission');
    const timing = page.locator('#refund-timing');
    await timing.selectOption('BEFORE_REVIEWED_CHECKPOINT');
    await refund.getByRole('button', { name: 'مراجعة الرد' }).click();
    assert.match(await refund.innerText(), /متوقف للمراجعة/);
    await timing.selectOption('UNKNOWN');
    await refund.getByRole('button', { name: 'مراجعة الرد' }).click();
    assert.match(await refund.innerText(), /متوقف للمراجعة/);
    await timing.selectOption('AFTER_REVIEWED_CHECKPOINT');
    await page.locator('#refund-account').selectOption('2');
    assert.equal(await timing.inputValue(), '', 'changing accounts clears the timing assertion');
    assert.match(await refund.innerText(), /2020-04-01/, 'confirmed count date must be visible without balance permission');
    assert.match(await refund.innerText(), /2020-04-02 12:30:00/, 'confirmed time must be displayed in Cairo time');
    await page.locator('#refund-account').selectOption('1');
    assert.equal(await timing.inputValue(), '');
    await timing.selectOption('AFTER_REVIEWED_CHECKPOINT');
    await refund.locator('input[name=actuallyPaid]').check();
    await refund.getByRole('button', { name: 'مراجعة الرد' }).click();
    assert.match(await refund.innerText(), /مراجعة الرد/);
    await refund.getByRole('button', { name: 'تأكيد التسجيل' }).click();
    await page.getByRole('status').filter({ hasText: 'تم تسجيل المبلغ الذي دُفع للعميل بالفعل' }).waitFor({ timeout: 30000 });
    assert.doesNotMatch(await page.content(), /98,765\.43|98765\.43/, 'success must not expose the account balance');
  } catch (error) {
    throw new Error(`synthetic browser test failed: ${error.stack || error}\nserver log tail:\n${logs}`, { cause: error });
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
