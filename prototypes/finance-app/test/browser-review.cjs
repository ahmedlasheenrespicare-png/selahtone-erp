/** Optional UI test of reviewed corrections/counts. Uses ONLY a fresh local lab. */
const assert=require("node:assert/strict");
const path=require("node:path");
const {createRequire}=require("node:module");
const tools=process.env.BROWSER_TOOLS_DIR;
if(!tools || !path.isAbsolute(tools)) throw new Error("BROWSER_TOOLS_DIR must be an absolute path");
const ext=createRequire(path.join(tools,"package.json"));
const puppeteer=ext("puppeteer-core"),chromium=ext("@sparticuz/chromium");
const base=process.env.FINANCE_LAB_BASE ?? "http://127.0.0.1:4187",parsed=new URL(base);
if(parsed.protocol!=="http:" || !["localhost","127.0.0.1"].includes(parsed.hostname)) throw new Error("Only a disposable local lab is permitted");
const form=(page,cmd)=>page.$(`form:has(input[name=command][value="${cmd}"])`);
const wait=(page,text)=>page.waitForFunction(t=>document.body.innerText.includes(t),{timeout:30000},text);
const select=async(el,selector,value)=>(await el.$(selector)).select(value);
const submit=async(el)=>el.$eval('button[type="submit"]',e=>e.click());
const set=async(el,selector,value)=>(await el.$(selector)).evaluate((e,v)=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;setter.call(e,v);e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));},value);
async function login(page,email){await page.goto(`${base}/login`,{waitUntil:"networkidle0",timeout:120000});await page.type("#email",email);await page.type("#password","DemoOnly-2026!");await Promise.all([page.waitForNavigation({waitUntil:"networkidle0",timeout:120000}),page.click('button[type=submit]')]);}
async function article(page,text){for(const el of await page.$$("article.lab-expense"))if((await el.evaluate(e=>e.innerText)).includes(text))return el;throw Error(`article not found: ${text}`);}
async function state(page,name,text){await page.waitForFunction((a,b)=>[...document.querySelectorAll("article.lab-expense")].some(e=>e.innerText.includes(a)&&e.innerText.includes(b)),{timeout:30000},name,text);}
async function detailsForm(container,cmd){const d=await container.$(`details:has(form input[name=command][value="${cmd}"])`);assert(d,`missing details for ${cmd}`);if(!await d.evaluate(e=>e.open))await d.$eval("summary",e=>e.click());return d.$("form");}
async function optionBalance(page,id){const text=await page.$eval(`form:has(input[name=command][value=requestCashCount]) option[value="${id}"]`,e=>e.textContent);const m=text.match(/·\s*(-?\d+\.\d{2})/);assert(m,`no account balance in ${text}`);return m[1];}
function capture(page){let listener;const result=new Promise(resolve=>{listener=req=>{if(req.method()==="POST"&&new URL(req.url()).pathname==="/finance"&&req.headers()["next-action"])req.fetchPostData().then(body=>{page.off("request",listener);resolve({headers:req.headers(),body});});};page.on("request",listener);});return result;}
async function replay(page,request){return page.evaluate(async ({headers,body})=>{const h={"content-type":headers["content-type"],"next-action":headers["next-action"]};if(headers["next-router-state-tree"])h["next-router-state-tree"]=headers["next-router-state-tree"];const r=await fetch("/finance",{method:"POST",headers:h,body});return {status:r.status,text:await r.text()};},request);}
async function expense(page,name,amount,branch="1",date){const f=await form(page,"createExpense");await select(f,"[name=branchId]",branch);await select(f,"[name=categoryId]","1");await set(f,"[name=amount]",amount);await set(f,"[name=description]",name);if(date)await set(f,"[name=expenseDate]",date);await submit(f);await state(page,name,"بانتظار الاعتماد");const a=await article(page,name);await submit(await a.$('form:has(input[name=command][value=approveExpense])'));await state(page,name,"معتمد — لم يُصرف");}
async function report(page,name,proposed){const a=await article(page,name),f=await detailsForm(a,"requestPaidExpenseReview");await set(f,"[name=reason]",`مراجعة ${name}`);await set(f,"[name=proposedAmount]",proposed);await submit(f);await state(page,name,"توجد مراجعة مفتوحة");}
async function reviewForm(page,name){for(const el of await page.$$("div.lab-expense"))if((await el.evaluate(e=>e.innerText)).includes(name))return detailsForm(el,"confirmPaidExpenseCorrection");throw Error(`review not found: ${name}`);}
async function countForm(page){const d=await page.$('details:has(form input[name=command][value=requestCashCount])');if(!await d.evaluate(e=>e.open))await d.$eval("summary",e=>e.click());return d.$("form");}
async function requestCount(page,reason,actual){const f=await countForm(page);await select(f,"[name=accountId]","2");await set(f,"[name=countedAmount]",actual);await set(f,"[name=reason]",reason);await f.$eval("[name=actuallyCounted]",e=>e.click());const pending=capture(page);await submit(f);const sent=await pending;await state(page,reason,"بانتظار المراجعة");return sent;}
async function approveCount(page,reason){const a=await article(page,reason),f=await detailsForm(a,"confirmCashCount");await set(f,"[name=reason]","تأكيد بعد العد");await f.$eval("[name=stillCurrent]",e=>e.click());await submit(f);await state(page,reason,"تم التأكيد");}

(async()=>{
 const errors=[],browser=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH ?? await chromium.executablePath(),args:chromium.args.filter(a=>a!=="--single-process"),headless:true,env:process.env});
 try{
  const manager=await browser.newPage();manager.on("pageerror",e=>errors.push(`manager: ${e.message}`));manager.on("response",r=>{if(r.status()>=500)errors.push(`HTTP ${r.status()} ${r.url()}`)});
  const accountantCtx=await browser.createBrowserContext(),accountant=await accountantCtx.newPage();accountant.on("pageerror",e=>errors.push(`accountant: ${e.message}`));
  const staffCtx=await browser.createBrowserContext(),staff=await staffCtx.newPage();staff.on("pageerror",e=>errors.push(`staff: ${e.message}`));
  await login(manager,"manager@example.test");await manager.goto(`${base}/finance`,{waitUntil:"networkidle0",timeout:120000});
  assert.equal(await optionBalance(manager,"2"),"800.00","start a fresh finance lab first");
  await login(accountant,"accountant@example.test");await login(staff,"staff@example.test");await staff.goto(`${base}/finance`,{waitUntil:"networkidle0",timeout:120000});

  await expense(manager,"مصروف سري وهمي","120");let a=await article(manager,"مصروف سري وهمي"),f=await detailsForm(a,"payExpense");
  await select(f,"[name=accountId]","2");await f.$eval("[name=actuallyPaid]",e=>e.click());await submit(f);await state(manager,"مصروف سري وهمي","مدفوع");assert.equal(await optionBalance(manager,"2"),"680.00");
  await report(manager,"مصروف سري وهمي","100");assert.equal(await optionBalance(manager,"2"),"680.00","review request alone must not change cash");
  f=await reviewForm(manager,"مصروف سري وهمي");await set(f,"[name=reason]","تدقيق مستند وهمي");await submit(f);await wait(manager,"أكد التحقق من مبلغ الدفع");
  assert.equal(await optionBalance(manager,"2"),"680.00");await f.$eval("[name=verifiedPayment]",e=>e.click());await f.$eval("[name=noPriorSettlement]",e=>e.click());
  let capturedPromise=capture(manager);await submit(f);const corrected=await capturedPromise;await state(manager,"مصروف سري وهمي","المبلغ الأصلي عند التسجيل");assert.equal(await optionBalance(manager,"2"),"700.00");
  a=await article(manager,"مصروف سري وهمي");assert((await a.evaluate(e=>e.innerText)).includes("100.00"));const history=await a.evaluate(e=>e.textContent);assert(history.includes('"actualCashMoved":false'));assert(history.includes("تصحيحات المبلغ المدفوع")&&history.includes("مراجعة مصروف سري وهمي")&&history.includes("تدقيق مستند وهمي")&&history.includes("700.00"));
  const same=await replay(manager,corrected);assert.equal(same.status,200);assert(same.text.includes("سبق حفظ الطلب"));assert.equal(await optionBalance(manager,"2"),"700.00");
  const forged=await replay(staff,corrected);assert.equal(forged.status,200);assert(forged.text.includes("هذه العملية للمدير والمحاسب فقط"));
  await staff.goto(`${base}/finance`,{waitUntil:"networkidle0",timeout:120000});let staffText=await staff.$eval("body",e=>e.innerText),staffHtml=await staff.content();
  assert(staffText.includes("تعديل رصيد بعد مراجعة"));assert(!staffHtml.includes("مصروف سري وهمي")&&!staffHtml.includes("تدقيق مستند وهمي")&&!staffHtml.includes("EXPENSE_CORRECTION"));
  console.log("paid correction: review then explicit confirmation, preserved original, idempotency, staff privacy/forgery: OK");

  await expense(manager,"قديم قبل الافتتاح","20","1","2019-12-31");a=await article(manager,"قديم قبل الافتتاح");f=await detailsForm(a,"payExpense");
  await select(f,"[name=accountId]","1");await set(f,"[name=paymentDate]","2019-12-31");await f.$eval("[name=includedInOpening]",e=>e.click());await f.$eval("[name=actuallyPaid]",e=>e.click());await submit(f);await state(manager,"قديم قبل الافتتاح","دفع تاريخي محتسب في الجرد");
  await report(manager,"قديم قبل الافتتاح","15");f=await reviewForm(manager,"قديم قبل الافتتاح");assert(!(await f.$('[name=expectedBalance]')));await set(f,"[name=reason]","تدقيق مصروف قديم");await f.$eval("[name=verifiedPayment]",e=>e.click());await f.$eval("[name=noPriorSettlement]",e=>e.click());await submit(f);await state(manager,"قديم قبل الافتتاح","المبلغ الأصلي عند التسجيل");
  assert.equal(await optionBalance(manager,"1"),"5000.00");assert.equal(await optionBalance(manager,"2"),"700.00");
  console.log("historical paid correction: no second cash movement: OK");

  await expense(manager,"تصحيح برصيد سالب","100","2");a=await article(manager,"تصحيح برصيد سالب");f=await detailsForm(a,"payExpense");await select(f,"[name=accountId]","3");await f.$eval("[name=actuallyPaid]",e=>e.click());await submit(f);await state(manager,"تصحيح برصيد سالب","مدفوع");assert.equal(await optionBalance(manager,"3"),"2400.00");
  await report(manager,"تصحيح برصيد سالب","3000");f=await reviewForm(manager,"تصحيح برصيد سالب");await set(f,"[name=reason]","مراجعة رقم يؤدي لسالب");await f.$eval("[name=verifiedPayment]",e=>e.click());await f.$eval("[name=noPriorSettlement]",e=>e.click());assert(await f.$("[name=negativeAcknowledged]"));await submit(f);await wait(manager,"سيصبح رصيد الحساب سالبًا بعد التصحيح الدفتري");assert.equal(await optionBalance(manager,"3"),"2400.00");
  assert(await f.$eval("[name=verifiedPayment]",e=>e.checked),"confirmation must survive a rejected submission");await f.$eval("[name=negativeAcknowledged]",e=>e.click());await submit(f);await state(manager,"تصحيح برصيد سالب","المبلغ الأصلي عند التسجيل");assert.equal(await optionBalance(manager,"3"),"-500.00");
  console.log("negative paid correction: explicit warning and acknowledgment: OK");

  const countAction=await requestCount(manager,"فرق جرد وهمي","690");assert.equal(await optionBalance(manager,"2"),"700.00","recording a count alone must not settle it");
  const forgedCount=await replay(staff,countAction);assert.equal(forgedCount.status,200);assert(forgedCount.text.includes("هذه العملية للمدير والمحاسب فقط"));
  await accountant.goto(`${base}/finance`,{waitUntil:"networkidle0",timeout:120000});await approveCount(accountant,"فرق جرد وهمي");assert.equal(await optionBalance(accountant,"2"),"690.00");
  a=await article(accountant,"فرق جرد وهمي");const countText=await a.evaluate(e=>e.innerText);assert(countText.includes("700.00")&&countText.includes("690.00")&&countText.includes("-10.00"));
  await manager.goto(`${base}/finance`,{waitUntil:"networkidle0",timeout:120000});assert.equal(await optionBalance(manager,"2"),"690.00");
  console.log("count: separate manager entry/accountant confirmation; before/after and staff-forged denial: OK");

  await requestCount(manager,"جرد قديم لإلغائه","680");assert.equal(await optionBalance(manager,"2"),"690.00");
  f=await detailsForm(manager,"transferCash");await select(f,"[name=fromId]","2");await select(f,"[name=toId]","1");await set(f,"[name=amount]","1");await f.$eval("[name=actuallyTransferred]",e=>e.click());await submit(f);await manager.waitForFunction(()=>[...document.querySelectorAll('form:has(input[name=command][value=requestCashCount]) option')].some(x=>x.value==='2'&&x.textContent.includes('689.00')),{timeout:30000});
  a=await article(manager,"جرد قديم لإلغائه");f=await detailsForm(a,"confirmCashCount");await set(f,"[name=reason]","تأكيد قديم");await f.$eval("[name=stillCurrent]",e=>e.click());await submit(f);await wait(manager,"حدثت حركة بعد الجرد");assert.equal(await optionBalance(manager,"2"),"689.00");
  a=await article(manager,"جرد قديم لإلغائه");f=await detailsForm(a,"cancelCashCount");await set(f,"[name=reason]","تغير النقد بعد العد");await submit(f);await state(manager,"جرد قديم لإلغائه","ملغى");assert.equal(await optionBalance(manager,"2"),"689.00");
  console.log("stale count rejected, cancelled with reason, no settlement: OK");

  await expense(manager,"دفع بعد الجرد","10");a=await article(manager,"دفع بعد الجرد");f=await detailsForm(a,"payExpense");await select(f,"[name=accountId]","2");assert(await f.$("[name=afterCount]"),"same-day count ordering is required");await f.$eval("[name=actuallyPaid]",e=>e.click());await submit(f);await wait(manager,"أكد ترتيب الدفع بعد الجرد");assert.equal(await optionBalance(manager,"2"),"689.00");
  await f.$eval("[name=afterCount]",e=>e.click());await submit(f);await state(manager,"دفع بعد الجرد","دفع بعد جرد مؤكد");assert.equal(await optionBalance(manager,"2"),"679.00");
  await report(manager,"دفع بعد الجرد","8");f=await reviewForm(manager,"دفع بعد الجرد");await set(f,"[name=reason]","تدقيق الدفع بعد الجرد");await f.$eval("[name=verifiedPayment]",e=>e.click());await f.$eval("[name=noPriorSettlement]",e=>e.click());await submit(f);await state(manager,"دفع بعد الجرد","المبلغ الأصلي عند التسجيل");assert.equal(await optionBalance(manager,"2"),"681.00");
  await report(manager,"دفع بعد الجرد","7");await requestCount(manager,"جرد لاحق متطابق","681");await approveCount(manager,"جرد لاحق متطابق");assert.equal(await optionBalance(manager,"2"),"681.00");
  f=await reviewForm(manager,"دفع بعد الجرد");await set(f,"[name=reason]","فحص فرق لاحق");await f.$eval("[name=verifiedPayment]",e=>e.click());await f.$eval("[name=noPriorSettlement]",e=>e.click());await submit(f);await wait(manager,"قد يكون الفرق سُوّي بالفعل");assert.equal(await optionBalance(manager,"2"),"681.00");
  let reviewBlock;for(const el of await manager.$$("div.lab-expense"))if((await el.evaluate(e=>e.innerText)).includes("دفع بعد الجرد")){reviewBlock=el;break;}assert(reviewBlock);
  f=await detailsForm(reviewBlock,"closePaidExpenseReview");await set(f,"[name=reason]","تم الفحص دون تعديل إضافي");await submit(f);await state(manager,"دفع بعد الجرد","الإبلاغ عن خطأ");assert.equal(await optionBalance(manager,"2"),"681.00");a=await article(manager,"دفع بعد الجرد");assert((await a.evaluate(e=>e.textContent)).includes("تم الفحص دون تعديل إضافي"));
  await report(manager,"دفع بعد الجرد","7");assert.equal(await optionBalance(manager,"2"),"681.00");
  console.log("same-day order, ambiguous correction blocked, explicit no-change review closure and reopen: OK");

  await expense(manager,"دفع مؤرخ قبل جرد لاحق","5");a=await article(manager,"دفع مؤرخ قبل جرد لاحق");f=await detailsForm(a,"payExpense");await select(f,"[name=accountId]","2");await set(f,"[name=paymentDate]","2021-01-01");await f.$eval("[name=actuallyPaid]",e=>e.click());await submit(f);await wait(manager,"قد يكون الدفع انعكس فيه");assert.equal(await optionBalance(manager,"2"),"681.00");await state(manager,"دفع مؤرخ قبل جرد لاحق","معتمد — لم يُصرف");
  await manager.setViewport({width:320,height:640});const dims=await manager.evaluate(()=>[document.documentElement.scrollWidth,document.documentElement.clientWidth]);assert(dims[0]<=dims[1],`mobile overflow ${dims}`);
  await staff.goto(`${base}/finance`,{waitUntil:"networkidle0",timeout:120000});staffHtml=await staff.content();assert(!staffHtml.includes("جرد لاحق متطابق")&&!staffHtml.includes("دفع بعد الجرد")&&!staffHtml.includes("مصروف سري وهمي"));
  console.log("late backdated payment blocked, 320px layout, staff count/expense privacy: OK");
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
