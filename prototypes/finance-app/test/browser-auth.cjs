/** Authentication regression test after dependency updates. Only uses the
 * disposable finance lab and its fictional staff2 account; it changes the demo
 * account's password, so restart the lab afterward. Never target production. */
const assert = require("node:assert/strict");
const path = require("node:path");
const { createRequire } = require("node:module");
const tools = process.env.BROWSER_TOOLS_DIR;
if (!tools || !path.isAbsolute(tools)) throw new Error("BROWSER_TOOLS_DIR must be an absolute directory containing puppeteer-core and @sparticuz/chromium");
const external = createRequire(path.join(tools, "package.json"));
const puppeteer = external("puppeteer-core"), chromium = external("@sparticuz/chromium");
const base = process.env.FINANCE_LAB_BASE ?? "http://127.0.0.1:4187";
const parsed = new URL(base);
if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(parsed.hostname)) throw new Error("Only a local disposable lab is permitted");
const text = (page, value) => page.waitForFunction((value) => document.body.innerText.includes(value), {timeout:30000}, value);
async function replace(page, selector, value) {
  await page.$eval(selector, el => { el.value = ""; el.dispatchEvent(new Event("input", {bubbles:true})); });
  await page.type(selector, value);
}
async function submitLogin(page, email, password) {
  await page.goto(`${base}/login`, {waitUntil:"networkidle0",timeout:120000});
  await page.type("#email", email); await page.type("#password", password);
  await page.click('button[type="submit"]');
}
(async () => {
  const browser = await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH ?? await chromium.executablePath(), args:chromium.args.filter(a=>a!=="--single-process"),headless:true,env:process.env});
  try {
    const page = await browser.newPage(); const errors=[];
    page.on("pageerror",error=>errors.push(error.message));
    await submitLogin(page,"staff2@example.test","DemoOnly-2026!");
    await page.waitForFunction(()=>location.pathname==="/dashboard",{timeout:60000});
    await page.goto(`${base}/change-password`,{waitUntil:"networkidle0",timeout:120000});
    await page.type("#current-password","DemoOnly-2026!");
    await page.type("#new-password","A-long-demo-pass-2026!");
    await page.type("#confirm-password","a-different-password");
    await page.click('button[type="submit"]');await text(page,"كلمتا المرور غير متطابقتين.");
    await replace(page,"#current-password","DemoOnly-2026!");
    await replace(page,"#new-password","short");await replace(page,"#confirm-password","short");
    await page.click('button[type="submit"]');await text(page,"استخدم 12 حرفًا على الأقل.");
    await replace(page,"#current-password","DemoOnly-2026!");
    await replace(page,"#new-password","A-long-demo-pass-2026!");await replace(page,"#confirm-password","A-long-demo-pass-2026!");
    await page.click('button[type="submit"]');await page.waitForFunction(()=>location.pathname==="/dashboard",{timeout:60000});
    const newContext=await browser.createBrowserContext(), fresh=await newContext.newPage();
    await submitLogin(fresh,"staff2@example.test","DemoOnly-2026!");await text(fresh,"البريد الإلكتروني أو كلمة المرور غير صحيحة.");
    await replace(fresh,"#password","A-long-demo-pass-2026!");await fresh.click('button[type="submit"]');
    await fresh.waitForFunction(()=>location.pathname==="/dashboard",{timeout:60000});
    assert.deepEqual(errors,[]);await newContext.close();
    console.log("demo login, Arabic validation, password change, old password rejection and new login: OK");
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
