/** Direct HTTP checks on disposable PGlite data; never connects to DATABASE_URL. */
import assert from "node:assert/strict";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { ACCESS_PAGES } from "../src/lib/access-control";
const root = process.cwd(), secret = "synthetic-pages-only-secret-2026-testing", password = "Synthetic-Access-Test-2026!";
const groups = [
  { name: "sales", routes: ACCESS_PAGES.filter(p => p.group === "المبيعات").map(p => p.route), dynamic: ["/sales/2"], allow: "/sales" },
  { name: "inventory", routes: ACCESS_PAGES.filter(p => p.group === "المخزون").map(p => p.route), dynamic: [], allow: "/inventory" },
  { name: "finance", routes: ACCESS_PAGES.filter(p => p.group === "المالية").map(p => p.route), dynamic: ["/finance/expenses/1"], allow: "/finance/reports" },
];
function forms(html: string): string[] { return [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)].map(m => m[0]); }
function hidden(form: string): FormData {
  const data = new FormData();
  for (const [tag] of form.matchAll(/<input\b[^>]*>/g)) {
    if (!tag.includes('type="hidden"')) continue;
    const name = tag.match(/name="([^"]+)"/)?.[1], value = tag.match(/value="([^"]*)"/)?.[1] ?? "";
    if (name) data.set(name,value.replaceAll("&quot;",'"').replaceAll("&amp;","&"));
  }
  return data;
}
async function portNumber() {
  const socket = createServer(); await new Promise<void>((r,j) => socket.once("error",j).listen(0,"127.0.0.1",r));
  const address = socket.address(); if (!address || typeof address === "string") throw new Error("no test port");
  await new Promise<void>((r,j) => socket.close(e => e ? j(e) : r())); return address.port;
}
async function wait(base: string, child: ChildProcess) {
  const deadline = Date.now()+60000;
  while (Date.now()<deadline) {
    if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}`);
    try { if ((await fetch(`${base}/login`)).ok) return; } catch { /* starting */ }
    await new Promise(r => setTimeout(r,250));
  }
  throw new Error("server startup timeout");
}
for (const group of groups) test(`page guard direct HTTP inventory: ${group.name}`, { timeout: 180_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(),`selahtone-page-${group.name}-`)); let child: ChildProcess | undefined; let logs = "";
  try {
    execFileSync(process.execPath,[join(root,"scripts/local-pglite-preview.cjs")],{ cwd: root, env: { ...process.env, PREVIEW_PGLITE_DIR: dir, PREVIEW_PASSWORD: password }, stdio:"pipe",timeout:60000 });
    const pg = new PGlite(dir);
    try {
      await pg.exec(readFileSync(join(root,"prisma/manual-access-control-upgrade.sql"),"utf8"));
      await pg.exec("SET selahtone.finance_release_candidate_test_only='yes'");
      for (const file of ["prototypes/finance-release/release-candidate.test-only.sql","prisma/manual-settlement-upgrade.sql","prisma/manual-custody-closure-upgrade.sql","prisma/manual-custody-and-count-requests.sql"]) await pg.exec(readFileSync(join(root,file),"utf8"));
      await pg.exec(`UPDATE users SET branch_id=1 WHERE id=2;
        UPDATE commerce_sales SET customer_name='PAGEGUARDCANARY' WHERE id=2;
        INSERT INTO users (id,branch_id,role_code,full_name,email,password_hash,status,must_change_password,menu_scope,can_cancel_sales,created_at)
          SELECT 4,1,'MANAGER','مدير غير أدمن','page-manager@selahtone.local',password_hash,'ACTIVE',false,'FULL',false,now() FROM users WHERE id=1;
        INSERT INTO finance.expenses(branch_id,category_id,category_snapshot,amount,expense_date,description,status,requested_by)
          VALUES(1,1,'تجريبي',10,CURRENT_DATE,'FINANCEPAGECANARY','PENDING',2);`);
      for (const route of group.routes) for (const role of ["ACCOUNTANT", "MANAGER"]) await pg.query("INSERT INTO access_control(subject_kind,subject,key,allowed,updated_by) VALUES('role',$1,$2,false,1)",[role,route]);
    } finally { await pg.close(); }
    const base = `http://127.0.0.1:${await portNumber()}`;
    child = spawn(process.execPath,[join(root,"node_modules/next/dist/bin/next"),"dev","--hostname","127.0.0.1","--port",base.split(":").at(-1)!],{
      cwd:root,env:{...process.env,DATABASE_URL:"",PRISMA_PGLITE_DIR:dir,AUTH_SECRET:secret,FINANCE_ENABLED:"true",INVENTORY_ENABLED:"true",ADMIN_EMAILS:"manager@selahtone.local"},stdio:["ignore","pipe","pipe"] });
    child.stdout?.on("data",d => { logs=(logs+d).slice(-10000); }); child.stderr?.on("data",d => { logs=(logs+d).slice(-10000); });
    await wait(base,child);
    async function login(email: string) {
      const form = forms(await (await fetch(`${base}/login?next=%2Fadmin`)).text())[0]; assert.ok(form);
      const data = hidden(form); data.set("email",email); data.set("password",password);
      const res = await fetch(`${base}/login?next=%2Fadmin`,{method:"POST",headers:{origin:base},body:data,redirect:"manual"});
      assert.equal(res.status,303); return res.headers.getSetCookie().map(v => v.split(";")[0]).join("; ");
    }
    const admin = await login("manager@selahtone.local"), accountant = await login("accountant@selahtone.local"), manager = await login("page-manager@selahtone.local");
    for (const path of [...group.routes,...group.dynamic]) {
      const res = await fetch(`${base}${path}`,{headers:{cookie:accountant},redirect:"manual"}); const body = await res.text();
      assert.ok((res.status === 307 && res.headers.get("location")?.includes("/dashboard")) || (res.status === 200 && /NEXT_REDIRECT|url=\/dashboard/i.test(body)), `${path}: expected server redirect, got ${res.status}`);
      assert.ok(!body.includes("PAGEGUARDCANARY") && !body.includes("FINANCEPAGECANARY"), `${path}: denied response leaked canary`);
    }
    const managerDenied = await fetch(`${base}${group.allow}`, { headers: { cookie: manager }, redirect: "manual" });
    const managerBody = await managerDenied.text();
    assert.ok((managerDenied.status === 307 && managerDenied.headers.get("location")?.includes("/dashboard")) || (managerDenied.status === 200 && /NEXT_REDIRECT|url=\/dashboard/i.test(managerBody)), "non-admin manager must obey the manager role denial");
    // An explicit account exception and system admin bypass both restore the
    // page; the other parent route denials remain independent.
    const adminPage = await (await fetch(`${base}/admin`,{headers:{cookie:admin}})).text();
    const ruleForm = forms(adminPage).find(f => f.includes('name="kind"')); assert.ok(ruleForm);
    const data = hidden(ruleForm);
    for (const [k,v] of Object.entries({kind:"user",subject:"2",key:group.allow,value:"allow"})) data.set(k,v);
    const saved = await fetch(`${base}/admin`,{method:"POST",headers:{cookie:admin,origin:base},body:data});
    assert.match(await saved.text(), /حُفظت الصلاحية/);
    for (const cookie of [accountant,admin]) {
      const res = await fetch(`${base}${group.allow}`,{headers:{cookie},redirect:"manual"});
      assert.equal(res.status,200); const body = await res.text();
      assert.ok(!body.includes("NEXT_REDIRECT") && !/url=\/dashboard/i.test(body), `${group.allow}: allowed user still redirected`);
    }
  } catch (e) { throw new Error(`page guard ${group.name} failed: ${e instanceof Error ? e.stack : String(e)}; logs:\n${logs}`,{cause:e}); }
  finally {
    if (child && child.exitCode === null) {
      const exited = new Promise<void>(r => child!.once("exit",() => r())); child.kill("SIGTERM");
      await Promise.race([exited,new Promise<void>(r => { setTimeout(r,5000).unref(); })]);
      if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; }
    }
    rmSync(dir,{recursive:true,force:true});
  }
});
