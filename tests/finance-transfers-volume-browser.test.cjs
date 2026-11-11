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

test('finance transfers browser: monthly totals independent of latest 100 and staff scope', { timeout: 180000 }, async () => {
  const browserDir = process.env.SYNTHETIC_BROWSER_DIR;
  assert.ok(browserDir, 'Set SYNTHETIC_BROWSER_DIR to a separate installation containing playwright-core and @sparticuz/chromium');
  const external = createRequire(join(browserDir, 'package.json'));
  const { chromium } = external('playwright-core');
  const chromiumBinary = external('@sparticuz/chromium');
  const dir = mkdtempSync(join(tmpdir(), 'selahtone-transfers-volume-browser-'));
  const password = 'Synthetic-Browser-Test-2026!';
  let child, browser; let logs = '';
  try {
    execFileSync(process.execPath, [join(root, 'scripts/local-pglite-preview.cjs')], { cwd: root, env: { ...process.env, PREVIEW_PGLITE_DIR: dir, PREVIEW_PASSWORD: password }, stdio: 'pipe', timeout: 60000 });
    const db = new PGlite(dir);
    try {
      await db.exec(readFileSync(join(root, 'prisma/manual-access-control-upgrade.sql'), 'utf8'));
      await db.exec("SET selahtone.finance_release_candidate_test_only='yes'");
      for (const file of ['prototypes/finance-release/release-candidate.test-only.sql', 'prisma/manual-settlement-upgrade.sql', 'prisma/manual-custody-closure-upgrade.sql', 'prisma/manual-custody-and-count-requests.sql']) await db.exec(readFileSync(join(root, file), 'utf8'));
      await db.exec(`INSERT INTO public.users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
        SELECT 5,2,'CS_AGENT','حامل الفرع الثاني','volume-two@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3;
        INSERT INTO public.users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
        SELECT 6,1,'CS_AGENT','حامل آخر','volume-other@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=3;
        INSERT INTO finance.accounts (branch_id,kind,holder_id,opening_amount,opening_date,opened_by) VALUES
        (1,'VAULT',NULL,10000,CURRENT_DATE,1),(1,'CUSTODY',3,10000,CURRENT_DATE,1),
        (2,'VAULT',NULL,10000,CURRENT_DATE,1),(2,'CUSTODY',5,10000,CURRENT_DATE,1),(1,'CUSTODY',6,10000,CURRENT_DATE,1);
        INSERT INTO finance.movements (kind,branch_id,source_id,destination_id,amount,actor_id) VALUES
        ('TRANSFER',1,2,1,111.11,1),('TRANSFER',1,1,2,200,1),
        ('TRANSFER',1,5,1,555.55,1),('TRANSFER',2,4,3,777.77,1);
        INSERT INTO finance.movements (kind,branch_id,source_id,destination_id,amount,actor_id)
        SELECT 'TRANSFER',1,2,1,1.00,1 FROM generate_series(1,101);`);
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
    await page.locator('#email').fill('manager@selahtone.local'); await page.locator('#password').fill(password);
    await Promise.all([page.waitForURL('**/finance/transfers', { timeout: 30000 }), page.locator('button[type=submit]').click()]);
    assert.match(await page.locator('body').innerText(), /قد لا يشمل السجل كل الحركات/);
    await page.getByRole('tab', { name: 'حسب الفرع', exact: true }).click();
    const chartBlock = page.getByRole('tablist', {name: /طريقة عرض مؤشر حركة التسليم/}).locator('..');
    assert.match(await chartBlock.innerText(), /ARH[\s\S]*967\.66 ج\.م/);
    const chart = chartBlock.locator('[role=group]'); await chart.focus(); await chart.press('ArrowRight');
    assert.match(await chartBlock.innerText(), /SHM[\s\S]*777\.77 ج\.م/);
    const table = page.locator('table').filter({ has: page.locator('caption', { hasText: 'سجل الحركات النقدية' }) });
    assert.equal(await table.locator('tbody tr').count(), 100);
    assert.doesNotMatch(await table.innerText(), /111\.11|555\.55|777\.77/);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /تصدير CSV/ }).click()]);
    const csv = readFileSync(await download.path(), 'utf8');
    assert.ok(!csv.includes('111.11') && !csv.includes('777.77'), 'CSV stays limited to the ledger');
    await page.context().clearCookies();
    await page.goto(`${base}/login?next=%2Ffinance%2Ftransfers`);
    await page.locator('#email').fill('arh@selahtone.local'); await page.locator('#password').fill(password);
    await Promise.all([page.waitForURL('**/finance/transfers', { timeout: 30000 }), page.locator('button[type=submit]').click()]);
    const content = await page.locator('body').innerText();
    assert.match(content, /توريد عهدتك لخزنة الفرع بالشهر[\s\S]*212\.11/);
    assert.match(content, /عمليات التوريد المسجّلة اليوم[\s\S]*212\.11/);
    assert.doesNotMatch(content, /555\.55|777\.77/, 'staff must not receive movements of another custody or branch');
    assert.equal(await table.locator('tbody tr').count(), 100);
  } catch (error) {
    throw new Error(`synthetic transfer volume browser test failed: ${error.stack || error}\nserver log tail:\n${logs}`, { cause: error });
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
