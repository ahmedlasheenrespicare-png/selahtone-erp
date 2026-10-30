/** Optional browser smoke test. Start a FRESH `npm run dev:finance:lab` first.
 * Uses only public demo credentials and fictional records. It requires external
 * puppeteer-core/Chromium; see README.md. Never targets a production URL. */
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { createHash } = require("node:crypto");
const { createRequire } = require("node:module");
const tools = process.env.BROWSER_TOOLS_DIR;
if (!tools || !path.isAbsolute(tools)) throw new Error("BROWSER_TOOLS_DIR must be an absolute directory with puppeteer-core and @sparticuz/chromium");
const external = createRequire(path.join(tools, "package.json"));
const puppeteer = external("puppeteer-core"), chromium = external("@sparticuz/chromium");
const base = process.env.FINANCE_LAB_BASE ?? "http://127.0.0.1:4187";
// Never allow accidentally pointing this scripted test at a deployed application.
const parsed = new URL(base);
if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(parsed.hostname)) throw new Error("Only a local disposable lab is permitted");
const waitText = (p, text) => p.waitForFunction((t) => document.body.innerText.includes(t), {timeout:30000}, text);
const form = (p, cmd) => p.$(`form:has(input[name="command"][value="${cmd}"])`);
async function select(f, sel, val) { await (await f.$(sel)).select(val); }
async function type(f, sel, val) { await (await f.$(sel)).type(val); }
async function submit(f) { await f.$eval('button[type="submit"]', e=>e.click()); }
async function login(p, email) {
  await p.goto(`${base}/login`, {waitUntil:"networkidle0",timeout:120000});
  await p.type("#email",email); await p.type("#password","DemoOnly-2026!");
  await Promise.all([p.waitForNavigation({waitUntil:"networkidle0",timeout:120000}),p.click('button[type="submit"]')]);
  assert.match(p.url(),/\/dashboard/);
}
async function run() {
  const failures = [];
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "selahtone-finance-browser-attachments-"));
  const pdf = Buffer.from("%PDF-1.4\n% fictional browser smoke test only\n%%EOF\n", "ascii");
  const pdfPath = path.join(temp,"fictional-invoice.pdf"), badPath = path.join(temp,"not-a-pdf.pdf"), largePath = path.join(temp,"too-large.png"), limitPath = path.join(temp,"at-limit.png");
  fs.writeFileSync(pdfPath,pdf); fs.writeFileSync(badPath,"This is not a PDF");
  const image = Buffer.alloc(5_000_001); Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(image); fs.writeFileSync(largePath,image); fs.writeFileSync(limitPath,image.subarray(0,5_000_000));
  const limitHash = createHash("sha256").update(image.subarray(0,5_000_000)).digest("hex");
  const browser = await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH ?? await chromium.executablePath(),args:chromium.args.filter(a=>a!=="--single-process"),headless:true,env:process.env});
  try {
    const manager = await browser.newPage();
    manager.on("pageerror",e=>failures.push(`manager: ${e.message}`));
    manager.on("response",r=>{if(r.status()>=500) failures.push(`HTTP ${r.status()} ${r.url()}`);});
    await manager.setViewport({width:1440,height:900}); await login(manager,"manager@example.test");
    await manager.goto(`${base}/finance`,{waitUntil:"networkidle0",timeout:120000});
    const pristine = await manager.$eval("body",e=>e.innerText);
    assert(pristine.includes("5000.00") && pristine.includes("800.00") && pristine.includes("لم تُسجّل مصروفات وهمية بعد"),"restart the disposable lab to get a fresh test database");
    let captureResolve;
    const capture = new Promise(resolve=>{captureResolve=resolve;});
    manager.on("request",request=>{
      if (request.method()==="POST" && new URL(request.url()).pathname==="/finance" && request.headers()["next-action"]) {
        request.fetchPostData().then(body=>captureResolve({headers:request.headers(),body}));
      }
    });
    let f=await form(manager,"createExpense"); await select(f,"[name=branchId]","1"); await select(f,"[name=categoryId]","1");
    await type(f,"[name=amount]","120"); await type(f,"[name=description]","وصف وهمي سري للفحص"); await type(f,"[name=beneficiary]","مستفيد وهمي");
    await submit(f); await waitText(manager,"بانتظار الاعتماد"); const captured = await capture; assert(captured.body && captured.headers["next-action"]);
    // Upload is optional and comes after saving the expense. Check invalid and
    // oversize files, then save harmless fictional bytes through the real UI.
    let attachmentDetail=await manager.$('details:has(form input[name=command][value=addExpenseAttachment])'); await attachmentDetail.$eval("summary",e=>e.click());
    f=await attachmentDetail.$("form"); await (await f.$('input[type=file]')).uploadFile(badPath); await submit(f); await waitText(manager,"نوع المرفق أو امتداده لا يطابق محتواه");
    await (await f.$('input[type=file]')).uploadFile(largePath); await submit(f); await waitText(manager,"الحد الأقصى للملف الوهمي 5 MB");
    await (await f.$('input[type=file]')).uploadFile(pdfPath); await submit(f); await waitText(manager,"fictional-invoice.pdf");
    const attachmentHref=await manager.$eval('a[href^="/finance/attachments/"]',e=>e.getAttribute("href"));
    const downloaded=await manager.evaluate(async href=>{const r=await fetch(href);return {status:r.status,type:r.headers.get("content-type"),disposition:r.headers.get("content-disposition"),cache:r.headers.get("cache-control"),csp:r.headers.get("content-security-policy"),nosniff:r.headers.get("x-content-type-options"),text:await r.text()};},attachmentHref);
    assert.equal(downloaded.status,200); assert.equal(downloaded.type,"application/pdf"); assert.match(downloaded.disposition,/^attachment;/); assert.match(downloaded.cache,/no-store/); assert.match(downloaded.csp,/sandbox/); assert.equal(downloaded.nosniff,"nosniff"); assert.equal(downloaded.text,pdf.toString("ascii"));
    const fileArticle=await manager.$('article.lab-expense'); assert(!(await fileArticle.$('form:has(input[name=command][value=addExpenseAttachment])')),"a second attachment must not be offered");
    const anonContext=await browser.createBrowserContext(), anon=await anonContext.newPage(); await anon.goto(`${base}/login`,{waitUntil:"networkidle0",timeout:120000});
    const anonymous=await anon.evaluate(async href=>{const manual=await fetch(href,{redirect:"manual"}),followed=await fetch(href);return {status:manual.status,type:manual.type,url:followed.url,text:await followed.text()};},attachmentHref);
    assert([301,302,303,307,308,401].includes(anonymous.status) || (anonymous.status===0 && anonymous.type==="opaqueredirect"));
    assert(new URL(anonymous.url).pathname==="/login" || anonymous.status===401);assert(!anonymous.text.includes("fictional browser smoke test")); await anonContext.close();
    console.log("fictional attachment: invalid and oversize denied; authenticated download with private headers: OK");
    f=await form(manager,"approveExpense"); await submit(f); await waitText(manager,"معتمد — لم يُصرف");
    let detail=await manager.$('details:has(form input[name=command][value=payExpense])'); await detail.$eval("summary",e=>e.click());
    f=await form(manager,"payExpense"); await select(f,"[name=accountId]","2"); await f.$eval("[name=actuallyPaid]",e=>e.click()); await submit(f);
    await manager.waitForFunction(()=>document.body.innerText.includes("680.00") && document.body.innerText.includes("الإبلاغ عن خطأ"),{timeout:30000});
    detail=await manager.$('details:has(form input[name=command][value=requestPaidExpenseReview])'); await detail.$eval("summary",e=>e.click());
    f=await form(manager,"requestPaidExpenseReview"); await type(f,"[name=reason]","تحقق وهمي من الرقم"); await type(f,"[name=proposedAmount]","100"); await submit(f); await waitText(manager,"توجد مراجعة مفتوحة");
    assert((await manager.$eval("body",e=>e.innerText)).includes("680.00"));
    detail=await manager.$('details:has(form input[name=command][value=transferCash])'); await detail.$eval("summary",e=>e.click());
    f=await form(manager,"transferCash"); await select(f,"[name=fromId]","1"); await select(f,"[name=toId]","2"); await type(f,"[name=amount]","50"); await f.$eval("[name=actuallyTransferred]",e=>e.click()); await submit(f); await waitText(manager,"730.00");
    console.log("manager: create, approve, pay, review without correction, and transfer: OK");
    const staffContext=await browser.createBrowserContext(), staff=await staffContext.newPage();
    staff.on("pageerror",e=>failures.push(`staff: ${e.message}`)); staff.on("response",r=>{if(r.status()>=500) failures.push(`HTTP ${r.status()} ${r.url()}`);});
    await staff.setViewport({width:320,height:640}); await login(staff,"staff@example.test"); await staff.goto(`${base}/finance`,{waitUntil:"networkidle0",timeout:120000});
    let body=await staff.$eval("body",e=>e.innerText);
    assert(body.includes("730.00") && body.includes("خصم من العهدة")); assert(!body.includes("وصف وهمي سري للفحص") && !body.includes("مستفيد وهمي") && !body.includes("المصروفات والخزائن"));
    const staffHtml = await staff.content(); assert(!staffHtml.includes("وصف وهمي سري للفحص") && !staffHtml.includes("مستفيد وهمي"),"private expense data must not occur in HTML or the RSC payload");
    const dims=await staff.evaluate(()=>[document.documentElement.scrollWidth,document.documentElement.clientWidth]); assert(dims[0]<=dims[1],`mobile overflow ${dims}`);
    const forged = await staff.evaluate(async ({headers,body}) => {
      const h={"content-type":headers["content-type"],"next-action":headers["next-action"]};
      if (headers["next-router-state-tree"]) h["next-router-state-tree"]=headers["next-router-state-tree"];
      const response=await fetch("/finance",{method:"POST",headers:h,body}); return {status:response.status,text:await response.text()};
    },captured);
    assert.equal(forged.status,200); assert(forged.text.includes("هذه العملية للمدير والمحاسب فقط"),"staff-forged manager action must be denied by server");
    assert(captured.body.includes("createExpense"));
    const forgedAttachment=await staff.evaluate(async ({headers,body})=>{const h={"content-type":headers["content-type"],"next-action":headers["next-action"]}; if(headers["next-router-state-tree"])h["next-router-state-tree"]=headers["next-router-state-tree"];const r=await fetch("/finance",{method:"POST",headers:h,body:body.replace("createExpense","addExpenseAttachment")});return {status:r.status,text:await r.text()};},captured);
    assert.equal(forgedAttachment.status,200); assert(forgedAttachment.text.includes("هذه العملية للمدير والمحاسب فقط"),"staff-forged attachment action must be denied by server");
    const staffDownload=await staff.evaluate(async href=>{const r=await fetch(href);return {status:r.status,text:await r.text()};},attachmentHref);assert.equal(staffDownload.status,403);assert(!staffDownload.text.includes("fictional browser smoke test"));
    assert(!staffHtml.includes("fictional-invoice.pdf") && !staffHtml.includes(attachmentHref),"attachment metadata must not occur in staff HTML/RSC");
    console.log("staff: private ledger, mobile width, and forged manager action denied: OK");
    await staff.goto(`${base}/sales/new?warehouseId=1`,{waitUntil:"networkidle0",timeout:120000});
    const staffSaleHtml = await staff.content(); assert(!staffSaleHtml.includes("4950.00") && !staffSaleHtml.includes("2500.00"),"branch-vault and other-branch balances must not be sent to staff");
    await staff.type("#sale-customer-name","عميل وهمي"); await staff.type("#sale-customer-phone","01000000000"); await staff.select("#sale-product","2");
    await staff.evaluate(()=>[...document.querySelectorAll("button")].find(e=>e.textContent.includes("إضافة الصنف")).click()); await staff.type("#sale-initial","40"); await staff.select("#sale-cash-account","2"); await staff.$eval('input[name="afterCheckpoint"]',e=>e.click());
    await staff.evaluate(()=>[...document.querySelectorAll("button")].find(e=>e.textContent.includes("مراجعة الفاتورة")).click()); await waitText(staff,"راجع الفاتورة قبل التأكيد");
    await staff.evaluate(()=>[...document.querySelectorAll("button")].find(e=>e.textContent.includes("تأكيد البيع")).click()); await waitText(staff,"تم تسجيل البيع");
    const href=await staff.$eval('a[href^="/sales/"]',e=>e.getAttribute("href"));
    await staff.goto(base+href,{waitUntil:"networkidle0",timeout:120000}); await staff.select("#collect-account","1"); await staff.$eval('form:has(#collect-amount) input[name="afterCheckpoint"]',e=>e.click());
    await staff.evaluate(()=>[...document.querySelectorAll("button")].find(e=>e.textContent.includes("مراجعة التحصيل")).click()); await waitText(staff,"مراجعة التحصيل");
    await staff.evaluate(()=>[...document.querySelectorAll("button")].find(e=>e.textContent.includes("تأكيد التسجيل")).click()); await waitText(staff,"تم تسجيل التحصيل");
    await staff.goto(`${base}/finance`,{waitUntil:"networkidle0",timeout:120000}); body=await staff.$eval("body",e=>e.innerText); assert(body.includes("770.00")&&!body.includes("وصف وهمي سري للفحص"));
    await manager.goto(base+href,{waitUntil:"networkidle0",timeout:120000}); await manager.$$eval('input[name="return-mode"]',els=>els[1].click());
    const returnForm=await manager.$('form:has(input[name="return-mode"])'); await returnForm.$eval('input[type="checkbox"]',e=>e.click());
    await returnForm.$$eval("button",els=>els.find(e=>e.textContent.includes("مراجعة المرتجع")).click()); await waitText(manager,"المستحق للعميل بعده");
    await returnForm.$$eval("button",els=>els.find(e=>e.textContent.includes("تأكيد الإلغاء")).click()); await waitText(manager,"تم تسجيل المرتجع");
    await manager.goto(`${base}/finance`,{waitUntil:"networkidle0",timeout:120000}); body=await manager.$eval("body",e=>e.innerText); assert(body.includes("5010.00")&&body.includes("770.00"),"return must not move cash");
    await manager.goto(base+href,{waitUntil:"networkidle0",timeout:120000}); await manager.select("#refund-account","1"); await manager.$eval('form:has(#refund-amount) input[name="afterCheckpoint"]',e=>e.click()); await manager.$eval('input[name="actuallyPaid"]',e=>e.click());
    await manager.evaluate(()=>[...document.querySelectorAll("button")].find(e=>e.textContent.includes("مراجعة الرد")).click()); await waitText(manager,"مراجعة الرد");
    await manager.evaluate(()=>[...document.querySelectorAll("button")].find(e=>e.textContent.includes("تأكيد التسجيل")).click()); await waitText(manager,"تم تسجيل المبلغ الذي دُفع");
    await manager.goto(`${base}/finance`,{waitUntil:"networkidle0",timeout:120000}); body=await manager.$eval("body",e=>e.innerText); assert(body.includes("4910.00")&&body.includes("770.00"));
    console.log("sale, later collection, return without cash, and actual refund: OK");
    // More form paths use the same real server actions and fictional database.
    const setValue = async (handle, selector, value) => { const input=await handle.$(selector); await input.evaluate((el,v)=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;setter.call(el,v);el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}));},value); };
    const article = async (label) => { for (const el of await manager.$$("article.lab-expense")) if ((await el.evaluate(e=>e.innerText)).includes(label)) return el; throw Error(`expense not found: ${label}`); };
    const stateOf = async (label, text) => manager.waitForFunction((label,text)=>[...document.querySelectorAll("article.lab-expense")].some(e=>e.innerText.includes(label)&&e.innerText.includes(text)),{timeout:30000},label,text);
    f=await form(manager,"createExpense"); await select(f,"[name=branchId]","1"); await select(f,"[name=categoryId]","1");
    await setValue(f,"[name=amount]","25"); await setValue(f,"[name=description]","تصحيح وهمي"); await submit(f); await stateOf("تصحيح وهمي","بانتظار الاعتماد");
    let a=await article("تصحيح وهمي");
    // Exactly 5,000,000 bytes must work through the Next multipart limit and
    // Prisma/PGlite bridge, not merely through the core signature validator.
    attachmentDetail=await a.$('details:has(form input[name=command][value=addExpenseAttachment])'); await attachmentDetail.$eval("summary",e=>e.click());
    f=await attachmentDetail.$("form"); await (await f.$('input[type=file]')).uploadFile(limitPath); await submit(f); await stateOf("تصحيح وهمي","at-limit.png");
    a=await article("تصحيح وهمي"); const limitHref=await a.$eval('a[href^="/finance/attachments/"]',e=>e.getAttribute("href"));
    const limitDownload=await manager.evaluate(async href=>{const r=await fetch(href);const bytes=await r.arrayBuffer();const digest=await crypto.subtle.digest("SHA-256",bytes);return {status:r.status,size:bytes.byteLength,hash:[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,"0")).join("")};},limitHref);
    assert.equal(limitDownload.status,200);assert.equal(limitDownload.size,5_000_000);assert.equal(limitDownload.hash,limitHash);
    console.log("attachment exactly 5 MB: real multipart upload/download and byte integrity: OK");
    a=await article("تصحيح وهمي"); f=await a.$('form:has(input[name=command][value=approveExpense])'); await submit(f); await stateOf("تصحيح وهمي","معتمد — لم يُصرف");
    a=await article("تصحيح وهمي"); detail=await a.$('details:has(form input[name=command][value=editUnpaidExpense])'); await detail.$eval("summary",e=>e.click());
    f=await detail.$("form"); await setValue(f,"[name=amount]","30"); await setValue(f,"[name=reason]","تصحيح رقم وهمي"); await submit(f); await stateOf("تصحيح وهمي","بانتظار الاعتماد");
    a=await article("تصحيح وهمي"); body=await a.evaluate(e=>e.innerText); assert(body.includes("30.00")&&body.includes("غير محددة"));
    f=await a.$('form:has(input[name=command][value=approveExpense])'); await submit(f); await stateOf("تصحيح وهمي","معتمد — لم يُصرف");
    a=await article("تصحيح وهمي"); detail=await a.$('details:has(form input[name=command][value=payExpense])'); await detail.$eval("summary",e=>e.click()); f=await detail.$("form");
    await select(f,"[name=method]","CARD"); await f.$eval("[name=actuallyPaid]",e=>e.click()); await submit(f); await stateOf("تصحيح وهمي","مدفوع");
    body=await manager.$eval("body",e=>e.innerText); assert(body.includes("4910.00")&&body.includes("770.00"),"card expense must not move cash");
    f=await form(manager,"createExpense"); await select(f,"[name=branchId]","1"); await select(f,"[name=categoryId]","1");
    await setValue(f,"[name=amount]","20"); await setValue(f,"[name=description]","دفع قديم وهمي"); await setValue(f,"[name=expenseDate]","2019-12-31"); await submit(f); await stateOf("دفع قديم وهمي","بانتظار الاعتماد");
    a=await article("دفع قديم وهمي"); f=await a.$('form:has(input[name=command][value=approveExpense])'); await submit(f); await stateOf("دفع قديم وهمي","معتمد — لم يُصرف");
    a=await article("دفع قديم وهمي"); detail=await a.$('details:has(form input[name=command][value=payExpense])'); await detail.$eval("summary",e=>e.click()); f=await detail.$("form");
    await select(f,"[name=accountId]","1"); await setValue(f,"[name=paymentDate]","2019-12-31"); await f.waitForSelector('[name="includedInOpening"]',{timeout:5000});
    await f.$eval('[name="includedInOpening"]',e=>e.click()); await f.$eval('[name="actuallyPaid"]',e=>e.click()); await submit(f); await stateOf("دفع قديم وهمي","دفع تاريخي محتسب في الجرد");
    body=await manager.$eval("body",e=>e.innerText); assert(body.includes("4910.00"),"historical payment must not be debited again");
    detail=await manager.$('details:has(form input[name=command][value=openAccount])'); await detail.$eval("summary",e=>e.click()); f=await detail.$("form");
    await select(f,"[name=branchId]","1"); await select(f,"[name=kind]","CUSTODY"); await select(f,"[name=holderId]","6"); await setValue(f,"[name=openingAmount]","0"); await f.$eval('[name="counted"]',e=>e.click()); await submit(f); await waitText(manager,"عهدة موظف إضافي وهمي");
    f=await form(manager,"addCategory"); await setValue(f,"[name=name]","بند وهمي جديد"); await submit(f); await waitText(manager,"بند وهمي جديد · نشط");
    let categoryDetail;
    for (const candidate of await manager.$$("details")) if ((await candidate.evaluate(e=>e.querySelector("summary")?.innerText ?? "")).includes("بند وهمي جديد")) { categoryDetail=candidate; break; }
    assert(categoryDetail,"new category edit control missing"); await categoryDetail.$eval("summary",e=>e.click()); f=await categoryDetail.$("form");
    await setValue(f,"[name=name]","بند وهمي معدل"); await select(f,"[name=active]","false"); await setValue(f,"[name=reason]","توقف تجريبي"); await submit(f); await waitText(manager,"بند وهمي معدل · موقوف");
    const available = await (await form(manager,"createExpense")).$eval('[name="categoryId"]',e=>[...e.options].map(o=>o.textContent)); assert(!available.includes("بند وهمي معدل"));
    detail=await manager.$('details:has(form input[name=command][value=transferCash])'); if(!(await detail.evaluate(e=>e.open))) await detail.$eval("summary",e=>e.click()); f=await detail.$("form");
    await select(f,"[name=fromId]","1"); await select(f,"[name=toId]","2"); await setValue(f,"[name=amount]","6000"); await f.waitForSelector('[name="negativeAcknowledged"]',{timeout:5000});
    await f.$eval('[name="actuallyTransferred"]',e=>{if(!e.checked)e.click();}); await submit(f); await waitText(manager,"سيصبح الرصيد سالبًا");
    body=await manager.$eval("body",e=>e.innerText); assert(body.includes("4910.00"),"negative transfer was committed without acknowledgment");
    assert(await f.$eval('[name="actuallyTransferred"]',e=>e.checked),"a validation error must preserve the form's confirmation");
    await f.$eval('[name="negativeAcknowledged"]',e=>e.click()); await select(f,"[name=fromId]","2");
    assert(!(await f.$eval('[name="negativeAcknowledged"]',e=>e.checked)),"changing source must clear the negative acknowledgment");
    await select(f,"[name=fromId]","1"); await select(f,"[name=toId]","2"); await f.$eval('[name="negativeAcknowledged"]',e=>e.click()); await submit(f); await waitText(manager,"-1090.00");
    await manager.setViewport({width:320,height:640});
    attachmentDetail=await manager.$('details:has(form input[name=command][value=addExpenseAttachment])'); assert(attachmentDetail); if(!(await attachmentDetail.evaluate(e=>e.open)))await attachmentDetail.$eval("summary",e=>e.click());
    const managerDims=await manager.evaluate(()=>[document.documentElement.scrollWidth,document.documentElement.clientWidth]); assert(managerDims[0]<=managerDims[1],`manager mobile overflow ${managerDims}`);
    console.log("correction and reapproval, noncash, historical payment, counted opening, category deactivation, negative acknowledgment, manager mobile: OK");
    // Dedicated stopped-branch fixtures are fictional. Exercise the chosen
    // policy in the actual browser and also forge the manager's request from
    // the stopped branch's employee session.
    await manager.setViewport({width:1440,height:900}); await manager.goto(`${base}/sales`,{waitUntil:"networkidle0",timeout:120000});
    const stoppedSales=await manager.evaluate(()=>{
      const rows=[...document.querySelectorAll("tr")];
      const href=name=>rows.find(row=>row.innerText.includes(name))?.querySelector('a[href^="/sales/"]')?.getAttribute("href");
      return {due:href("عميل تحصيل وهمي"),refund:href("عميل رد وهمي")};
    });
    assert(stoppedSales.due && stoppedSales.refund,"fictional stopped-branch invoices are missing");
    await manager.goto(base+stoppedSales.due,{waitUntil:"networkidle0",timeout:120000}); await waitText(manager,"فرع موقوف: تسوية الفواتير السابقة للمدير والمحاسب فقط");
    f=await manager.$('form:has(#collect-amount)'); assert(f); await setValue(f,"#collect-amount","10"); await select(f,"#collect-account","5"); await f.$eval('[name="afterCheckpoint"]',e=>e.click());
    await manager.evaluate(()=>[...document.querySelectorAll("button")].find(e=>e.textContent.includes("مراجعة التحصيل")).click()); await waitText(manager,"مراجعة التحصيل");
    let stoppedCaptureResolve;const stoppedCapture=new Promise(resolve=>{stoppedCaptureResolve=resolve;});
    const captureStopped=request=>{if(request.method()==="POST" && new URL(request.url()).pathname===stoppedSales.due && request.headers()["next-action"])request.fetchPostData().then(body=>stoppedCaptureResolve({headers:request.headers(),body}));};
    manager.on("request",captureStopped); await manager.evaluate(()=>[...document.querySelectorAll("button")].find(e=>e.textContent.includes("تأكيد التسجيل")).click()); await waitText(manager,"تم تسجيل التحصيل");
    const stoppedAction=await stoppedCapture;manager.off("request",captureStopped);assert(stoppedAction.body);
    const stoppedStaffContext=await browser.createBrowserContext(),stoppedStaff=await stoppedStaffContext.newPage();
    stoppedStaff.on("pageerror",e=>failures.push(`stopped staff: ${e.message}`));await login(stoppedStaff,"staff-stop@example.test");
    await stoppedStaff.goto(base+stoppedSales.due,{waitUntil:"networkidle0",timeout:120000});await waitText(stoppedStaff,"فرع موقوف: تسوية الفواتير السابقة للمدير والمحاسب فقط");
    assert(!(await stoppedStaff.$("#collect-amount")),"stopped-branch staff must not receive the collection form");
    const forgedStopped=await stoppedStaff.evaluate(async ({headers,body})=>{const h={"content-type":headers["content-type"],"next-action":headers["next-action"]};if(headers["next-router-state-tree"])h["next-router-state-tree"]=headers["next-router-state-tree"];const r=await fetch(location.pathname,{method:"POST",headers:h,body});return {status:r.status,text:await r.text()};},stoppedAction);
    assert.equal(forgedStopped.status,200);assert(forgedStopped.text.includes("تسوية فواتير الفرع الموقوف للمدير والمحاسب فقط"));await stoppedStaffContext.close();
    await manager.goto(`${base}/sales/new`,{waitUntil:"networkidle0",timeout:120000});
    assert(!(await manager.$eval("body",e=>e.innerText)).includes("مستودع تجريبي للفرع الموقوف"),"stopped branch must not offer a new sale");
    console.log("stopped-branch manager collection, employee form/action denial and new-sale exclusion: OK");
    const accountantContext=await browser.createBrowserContext(), accountant=await accountantContext.newPage();
    accountant.on("pageerror",e=>failures.push(`accountant: ${e.message}`)); await login(accountant,"accountant@example.test");
    await accountant.goto(`${base}/finance`,{waitUntil:"networkidle0",timeout:120000}); body=await accountant.$eval("body",e=>e.innerText); assert(body.includes("وصف وهمي سري للفحص"));
    const accountantDownload=await accountant.evaluate(async href=>{const r=await fetch(href);return {status:r.status,text:await r.text()};},attachmentHref);assert.equal(accountantDownload.status,200);assert.equal(accountantDownload.text,pdf.toString("ascii"));
    await accountant.goto(base+stoppedSales.refund,{waitUntil:"networkidle0",timeout:120000});await waitText(accountant,"فرع موقوف: تسوية الفواتير السابقة للمدير والمحاسب فقط");
    f=await accountant.$('form:has(#refund-amount)');assert(f);await setValue(f,"#refund-amount","30");await select(f,"#refund-account","5");await f.$eval('[name="afterCheckpoint"]',e=>e.click());await f.$eval('[name="actuallyPaid"]',e=>e.click());
    await accountant.evaluate(()=>[...document.querySelectorAll("button")].find(e=>e.textContent.includes("مراجعة الرد")).click());await waitText(accountant,"مراجعة الرد");
    await accountant.evaluate(()=>[...document.querySelectorAll("button")].find(e=>e.textContent.includes("تأكيد التسجيل")).click());await waitText(accountant,"تم تسجيل المبلغ الذي دُفع");
    await accountant.goto(`${base}/finance`,{waitUntil:"networkidle0",timeout:120000});
    const stoppedVault=await accountant.evaluate(()=>[...document.querySelectorAll("article.lab-metric")].find(e=>e.innerText.includes("خزنة فرع تجريبي موقوف"))?.innerText ?? "");
    assert(stoppedVault.includes("480.00"),`stopped branch vault must reflect only actual collection/refund: ${stoppedVault}`);
    console.log("stopped-branch accountant actual refund and same-branch vault balance: OK");
    await accountant.goto(`${base}/sales/new?warehouseId=1`,{waitUntil:"networkidle0",timeout:120000}); body=await accountant.$eval("body",e=>e.innerText); assert(body.includes("إنشاء البيع متاح للمدير وموظف الفرع فقط"));
    console.log("accountant: finance access and sale-creation restriction: OK");
    assert.deepEqual(failures,[]);
  } finally { await browser.close(); fs.rmSync(temp,{recursive:true,force:true}); }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
