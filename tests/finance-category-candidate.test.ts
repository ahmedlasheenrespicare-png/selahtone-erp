/** Disposable category-bridge tests. No DATABASE_URL, Prisma client or network. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID,createHash } from "node:crypto";
import { readFileSync,mkdtempSync,mkdirSync,rmSync,existsSync } from "node:fs";
import { execFileSync,spawn,type ChildProcess } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { PGlite } from "@electric-sql/pglite";
import { FinanceProblem,type FinanceDatabase,type FinanceTransaction } from "../prototypes/finance-engine/types";
import { listCandidateCategories,createCandidateCategory,editCandidateCategory,candidateCategoryPort } from "../prototypes/finance-release/categories";
import { addCategory,editCategory,createExpense,approveExpense,payExpense,openAccount,listCategories,listExpenses,listAccounts,listAccountActivity } from "../prototypes/finance-engine/engine";

const legacy=readFileSync("tests/fixtures/inventory-baseline.sql","utf8")+"\n"+readFileSync("tests/fixtures/finance-legacy-categories.sql","utf8");
const schema=readFileSync("prototypes/finance-release/category-schema.test-only.sql","utf8");
const req=()=>randomUUID();
const make=(name:string)=>({requestId:req(),name});
const edit=(category:{id:string;name:string;active:boolean;snapshot:string},name=category.name,active=category.active)=>({
 requestId:req(),categoryId:category.id,expectedSnapshot:category.snapshot,name,active,reason:"تصحيح تجريبي"
});
async function rejectsCode(fn:()=>Promise<unknown>,code:string){await assert.rejects(fn,(error:unknown)=>error instanceof FinanceProblem&&error.code===code,`expected ${code}`);}
function pgliteAdapter(pg:PGlite):FinanceDatabase{return {serializable:work=>pg.transaction(async tx=>{
 await tx.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
 const executor:FinanceTransaction={query:async(sql,parameters=[])=>({rows:(await tx.query(sql,parameters)).rows as never[]})};
 return work(executor);
})};}
/** Construct a throwaway schema ONLY inside these tests, not a release SQL file.
 * The lab's fake users/branches/categories and its BYTEA attachments are omitted;
 * the remaining finance FKs point directly at the fictional public fixture. */
function candidateCoreSchema():string{
 let source=readFileSync("prototypes/finance-engine/schema.test-only.sql","utf8");
 const remove=(pattern:RegExp,label:string)=>{const next=source.replace(pattern,"");if(next===source)throw new Error(`test schema shape changed: ${label}`);source=next;};
 remove(/CREATE SCHEMA finance_lab;/,"schema");
 for(const table of ["branches","users","categories","attachment_quota","expense_attachments"]){
  remove(new RegExp(`CREATE TABLE finance_lab\\.${table} \\([\\s\\S]*?\\n\\);`),table);
 }
 remove(/CREATE UNIQUE INDEX finance_lab_categories_name_key[^;]*;/,"category index");
 remove(/INSERT INTO finance_lab\.attachment_quota\(singleton\) VALUES \(1\);/,"attachment quota row");
 source=source.replaceAll("REFERENCES finance_lab.branches(id)","REFERENCES public.branches(id)")
  .replaceAll("REFERENCES finance_lab.users(id)","REFERENCES public.users(id)")
  .replaceAll("REFERENCES finance_lab.categories(id)","REFERENCES public.expense_categories(id)")
  .replaceAll("finance_lab_test_only","finance_candidate_test_only")
  .replaceAll("finance_lab.","finance_candidate.");
 if(/finance_candidate\.(users|branches|categories|expense_attachments|attachment_quota)\b/.test(source))throw new Error("test schema still refers to removed lab objects");
 return source;
}
/** This rewriting is only an experiment; it is not a production SQL adapter. */
function candidateCoreDatabase(base:FinanceDatabase):FinanceDatabase{return {serializable:work=>base.serializable(async original=>{
 const tx:FinanceTransaction={query:(sql,parameters=[])=>{
  if(/finance_lab\.categories\b/.test(sql))throw new Error("categories must use the explicit candidate port");
  const scoped=sql.replaceAll("finance_lab.users","public.users").replaceAll("finance_lab.branches","public.branches").replaceAll("finance_lab.","finance_candidate.");
  return original.query(scoped,parameters);
 }};
 const allowed=await tx.query<{enabled:boolean|null}>("SELECT current_setting('selahtone.finance_candidate_test_only',true)='yes' AS enabled");
 if(allowed.rows[0]?.enabled!==true)throw new FinanceProblem("test_only","يتطلب الاختبار قاعدة معزولة.");
 tx.categoryPort=candidateCategoryPort(tx);return work(tx);
})};}

test("experimental category schema refuses a database without explicit opt-in",async()=>{
 const pg=new PGlite();try{
  await pg.exec(legacy);
  await assert.rejects(()=>pg.exec(schema),/explicitly opted-in disposable database/);
  assert.equal((await pg.query<{schema:string|null}>("SELECT to_regnamespace('finance_candidate')::text AS schema")).rows[0].schema,null);
 }finally{await pg.close();}
});

test("a failed candidate schema transaction leaves no partial objects or changed legacy rows",{timeout:120_000},async()=>{
 const pg=new PGlite();try{
  await pg.exec(legacy);await pg.exec("SET selahtone.finance_candidate_test_only='yes'");
  const before=await pg.query("SELECT to_jsonb(c) AS value FROM public.expense_categories c ORDER BY id");
  const broken=schema.replace("CREATE TABLE finance_candidate.category_audit", "SELECT 1/0; CREATE TABLE finance_candidate.category_audit");
  assert.notEqual(broken,schema);
  await assert.rejects(()=>pg.transaction(async tx=>{await tx.exec(broken);}),/division by zero/);
  assert.equal((await pg.query<{schema:string|null}>("SELECT to_regnamespace('finance_candidate')::text AS schema")).rows[0].schema,null);
  assert.deepEqual((await pg.query("SELECT to_jsonb(c) AS value FROM public.expense_categories c ORDER BY id")).rows,before.rows);
 }finally{await pg.close();}
});

test("existing fictional categories are referenced without copying or altering them on installation",{timeout:120_000},async t=>{
 const pg=new PGlite();try{
  await pg.exec(legacy);
  // Regression against data being present even though the production audit saw
  // zero legacy expenses/journals. All these records are fictional.
  await pg.exec(`INSERT INTO public.expenses(branch_id,category_id,amount,expense_date,requested_by) VALUES(1,1,42,'2026-01-01',1);
   INSERT INTO public.journal_entries(entry_no,entry_date,source_type,source_id) VALUES('TEST-1','2026-01-01','TEST',1)`);
  const before=await pg.query(`SELECT to_jsonb(c) AS value FROM public.expense_categories c ORDER BY id`);
  const legacyBefore=await pg.query(`SELECT (SELECT count(*)::int FROM public.expenses) AS expenses,(SELECT count(*)::int FROM public.journal_entries) AS journals`);
  const columnsBefore=await pg.query(`SELECT column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='expense_categories' ORDER BY ordinal_position`);
  await pg.exec("SET selahtone.finance_candidate_test_only='yes'");await pg.exec(schema);
  assert.equal(before.rows.length,7);assert.deepEqual((await pg.query(`SELECT to_jsonb(c) AS value FROM public.expense_categories c ORDER BY id`)).rows,before.rows);
  assert.deepEqual((await pg.query(`SELECT column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='expense_categories' ORDER BY ordinal_position`)).rows,columnsBefore.rows);
  assert.deepEqual((await pg.query(`SELECT (SELECT count(*)::int FROM public.expenses) AS expenses,(SELECT count(*)::int FROM public.journal_entries) AS journals`)).rows,legacyBefore.rows);
  assert.equal((await pg.query<{n:number}>("SELECT count(*)::int AS n FROM finance_candidate.category_revisions")).rows[0].n,0);
  const db=pgliteAdapter(pg);

  await t.test("reads use public users, restrict access, and do not fabricate old creators",async()=>{
   const rows=await listCandidateCategories(db,"1");assert.equal(rows.length,7);assert(rows.every(r=>r.revision===1&&r.createdBy===null&&r.updatedBy===null));
   assert.equal((await listCandidateCategories(db,"2")).length,7);
   await rejectsCode(()=>listCandidateCategories(db,"3"),"forbidden");
   await rejectsCode(()=>listCandidateCategories(db,"4"),"forbidden");
   await pg.exec(`INSERT INTO public.users(role_code,full_name,email,password_hash,status,must_change_password)
    VALUES('MANAGER','مستخدم تجريبي','mustchange@example.test','fixture','ACTIVE',TRUE)`);
   await rejectsCode(()=>listCandidateCategories(db,"5"),"forbidden");
  });
  await t.test("the guard protects reads and writes at runtime too",async()=>{
   await pg.exec("RESET selahtone.finance_candidate_test_only");
   try{await rejectsCode(()=>listCandidateCategories(db,"1"),"test_only");await rejectsCode(()=>createCandidateCategory(db,"1",make("محظور")),"test_only");}
   finally{await pg.exec("SET selahtone.finance_candidate_test_only='yes'");}
   assert.equal((await pg.query<{n:number}>("SELECT count(*)::int AS n FROM public.expense_categories")).rows[0].n,7);
  });
  await t.test("new category is atomic, has a unique legacy-compatible code, and retries once",async()=>{
   const input=make("بند تجريبي جديد");
   await rejectsCode(()=>createCandidateCategory(db,"3",input),"forbidden");
   const result=await createCandidateCategory(db,"1",input),again=await createCandidateCategory(db,"1",input);
   assert.equal(result.id,again.id);assert.equal(result.replayed,false);assert.equal(again.replayed,true);
   await rejectsCode(()=>createCandidateCategory(db,"1",{...input,name:"اسم آخر"}),"request_conflict");
   await rejectsCode(()=>createCandidateCategory(db,"2",input),"request_conflict");
   const created=(await listCandidateCategories(db,"2")).find(r=>r.id===result.id)!;
   assert.equal(created.createdBy,"1");assert.equal(created.revision,1);assert.match(created.code,/^F-[a-f0-9]{28}$/);
   const audits=await pg.query<{action:string;actor_id:string;before_data:unknown;after_data:{name:string}}>(`SELECT action,actor_id::text,before_data,after_data FROM finance_candidate.category_audit WHERE category_id=$1::int`,[result.id]);
   assert.equal(audits.rows.length,1);assert.equal(audits.rows[0].action,"CREATE");assert.equal(audits.rows[0].actor_id,"1");assert.equal(audits.rows[0].before_data,null);assert.equal(audits.rows[0].after_data.name,input.name);
   await pg.exec("UPDATE public.users SET status='SUSPENDED' WHERE id=1");
   try{await rejectsCode(()=>createCandidateCategory(db,"1",input),"forbidden");}finally{await pg.exec("UPDATE public.users SET status='ACTIVE' WHERE id=1");}
  });
  await t.test("old category editing preserves id/code and unknown creator; audit records before/after and reason",async()=>{
   const old=(await listCandidateCategories(db,"1")).find(r=>r.id==="1")!;
   const input=edit(old,"اسم قديم بعد التصحيح",false),out=await editCandidateCategory(db,"2",input);
   assert.equal(out.id,old.id);assert.equal((await editCandidateCategory(db,"2",input)).replayed,true);
   const current=(await listCandidateCategories(db,"1")).find(r=>r.id===old.id)!;
   assert.equal(current.code,old.code);assert.equal(current.name,input.name);assert.equal(current.active,false);assert.equal(current.revision,2);
   assert.equal(current.createdBy,null);assert.equal(current.updatedBy,"2");
   const history=(await pg.query<{actor_id:string;reason:string;before_data:{name:string};after_data:{name:string}}>(`SELECT actor_id::text,reason,before_data,after_data
    FROM finance_candidate.category_audit WHERE category_id=1 AND action='EDIT'`)).rows;
   assert.equal(history.length,1);assert.equal(history[0].actor_id,"2");assert.equal(history[0].reason,input.reason);
   assert.equal(history[0].before_data.name,old.name);assert.equal(history[0].after_data.name,input.name);
   assert.equal((await pg.query<{category_id:number}>("SELECT category_id FROM public.expenses WHERE id=1")).rows[0].category_id,1);
   await rejectsCode(()=>editCandidateCategory(db,"1",edit(old,"مراجعة قديمة")),"category_changed");
   await rejectsCode(()=>editCandidateCategory(db,"1",{...edit(current),reason:""}),"invalid_input");
   await rejectsCode(()=>editCandidateCategory(db,"1",{...edit(current),categoryId:"2147483648"}),"not_found");
  });
  await t.test("a direct outside change is detected even when no metadata revision was incremented",async()=>{
   const old=(await listCandidateCategories(db,"1")).find(r=>r.id==="2")!;
   await pg.exec("UPDATE public.expense_categories SET name_ar='تغيير خارجي تجريبي' WHERE id=2");
   await rejectsCode(()=>editCandidateCategory(db,"1",edit(old,"لا تطبق")),"category_changed");
   const now=(await listCandidateCategories(db,"1")).find(r=>r.id==="2")!;
   assert.equal(now.revision,1);assert.notEqual(now.snapshot,old.snapshot);assert.equal(now.createdBy,null);
   assert.equal((await pg.query<{n:number}>("SELECT count(*)::int AS n FROM finance_candidate.category_audit WHERE category_id=2")).rows[0].n,0);
  });
  await t.test("legacy duplicate names stay intact; new duplicates are rejected without blocking deactivation",async()=>{
   const old=(await listCandidateCategories(db,"1")).find(r=>r.id==="4")!;
   await pg.query("INSERT INTO public.expense_categories(code,name_ar) VALUES('OLD-DUP',$1)",[old.name]);
   await rejectsCode(()=>createCandidateCategory(db,"1",make(old.name)),"category_duplicate");
   await editCandidateCategory(db,"1",edit(old,old.name,false));
   assert.equal((await listCandidateCategories(db,"2")).find(r=>r.id===old.id)?.active,false);
   const second=(await listCandidateCategories(db,"2")).find(r=>r.id==="5")!;
   await rejectsCode(()=>editCandidateCategory(db,"2",edit(second,old.name)),"category_duplicate");
  });
  await t.test("generated-code collision with an old category fails without writing audit or request",async()=>{
   const input=make("اسم رمز متعارض"),code="F-"+createHash("sha256").update(input.requestId).digest("hex").slice(0,28);
   await pg.query("INSERT INTO public.expense_categories(code,name_ar) VALUES($1,'رمز قديم تجريبي')",[code]);
   await rejectsCode(()=>createCandidateCategory(db,"1",input),"duplicate");
   assert.equal((await pg.query<{n:number}>("SELECT count(*)::int AS n FROM finance_candidate.category_requests WHERE request_id=$1::uuid",[input.requestId])).rows[0].n,0);
   assert.equal((await pg.query<{n:number}>("SELECT count(*)::int AS n FROM public.expense_categories WHERE name_ar=$1",[input.name])).rows[0].n,0);
  });
  await t.test("late audit failure rolls back the original row, metadata, and idempotency together",async()=>{
   await pg.exec(`CREATE FUNCTION finance_candidate.reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$;
     CREATE TRIGGER reject_audit BEFORE INSERT ON finance_candidate.category_audit FOR EACH ROW EXECUTE FUNCTION finance_candidate.reject_audit()`);
   try{
    const before=(await listCandidateCategories(db,"1")).find(r=>r.id==="3")!,input=edit(before,"لا تحفظ",false);
    await assert.rejects(()=>editCandidateCategory(db,"1",input),/synthetic audit failure/);
    assert.deepEqual((await listCandidateCategories(db,"1")).find(r=>r.id==="3"),before);
    assert.equal((await pg.query<{n:number}>("SELECT count(*)::int AS n FROM finance_candidate.category_revisions WHERE category_id=3")).rows[0].n,0);
    assert.equal((await pg.query<{n:number}>("SELECT count(*)::int AS n FROM finance_candidate.category_requests WHERE request_id=$1::uuid",[input.requestId])).rows[0].n,0);
    const creation=make("لا تنشئ"),count=(await pg.query<{n:number}>("SELECT count(*)::int AS n FROM public.expense_categories")).rows[0].n;
    await assert.rejects(()=>createCandidateCategory(db,"1",creation),/synthetic audit failure/);
    assert.equal((await pg.query<{n:number}>("SELECT count(*)::int AS n FROM public.expense_categories")).rows[0].n,count);
   }finally{await pg.exec("DROP TRIGGER reject_audit ON finance_candidate.category_audit; DROP FUNCTION finance_candidate.reject_audit()");}
  });
 }finally{await pg.close();}
});

type RawQuery=(sql:string,parameters?:unknown[])=>Promise<Array<Record<string,unknown>>>;
async function exerciseCandidateCore(db:FinanceDatabase,raw:RawQuery):Promise<void>{
 const opening=(kind:"VAULT"|"CUSTODY",holderId:string|null,branchId="1")=>({requestId:req(),branchId,kind,holderId,openingAmount:"100",openingDate:"2026-10-20",counted:true});
 const expense=(categoryId:string,branchId="1")=>({requestId:req(),branchId,categoryId,amount:"20",expenseDate:"2026-10-21",description:"تفاصيل مالية وهمية سرية",beneficiary:"",documentNumber:"",taxAmount:""});
 const initial=(await listCategories(db,"1")).find(x=>x.id==="1")!;assert(initial?.snapshot);
 await rejectsCode(()=>listCategories(db,"3"),"forbidden");
 await rejectsCode(()=>openAccount(db,"1",opening("CUSTODY","3","2"),"2026-10-29"),"holder_unavailable");
 const vault=await openAccount(db,"1",opening("VAULT",null),"2026-10-29");
 const custody=await openAccount(db,"2",opening("CUSTODY","3"),"2026-10-29");
 await rejectsCode(()=>createExpense(db,"3",expense(initial.id)),"forbidden");
 const saved=await createExpense(db,"1",expense(initial.id));
 const editInput={requestId:req(),categoryId:initial.id,expectedRevision:String(initial.revision),expectedSnapshot:initial.snapshot,
  name:"تعديل بند قديم تجريبي",active:false,reason:"تصحيح تسمية"};
 await editCategory(db,"2",editInput);assert.equal((await editCategory(db,"2",editInput)).replayed,true);
 const current=(await listCategories(db,"1")).find(x=>x.id===initial.id)!;assert.equal(current.revision,initial.revision+1);assert.equal(current.active,false);
 const stored=(await listExpenses(db,"1")).find(x=>x.id===saved.id)!;
 assert.equal(stored.categorySnapshot,initial.name);assert.equal(stored.categoryId,initial.id);assert.equal(stored.requestedBy,"1");
 await rejectsCode(()=>createExpense(db,"1",expense(initial.id)),"category_inactive");
 await rejectsCode(()=>editCategory(db,"1",{...editInput,requestId:req(),expectedRevision:String(current.revision),expectedSnapshot:null}),"invalid_input");
 await editCategory(db,"1",{...editInput,requestId:req(),expectedRevision:String(current.revision),expectedSnapshot:current.snapshot,active:true,reason:"إعادة التفعيل"});
 const createdInput=make("بند مضاف عبر النواة"),created=await addCategory(db,"1",createdInput);
 assert.equal((await addCategory(db,"1",createdInput)).replayed,true);
 const createdRow=(await listCategories(db,"1")).find(x=>x.id===created.id)!;assert.equal(createdRow.createdBy,"1");
 await rejectsCode(()=>addCategory(db,"1",make(createdInput.name)),"category_duplicate");
 await approveExpense(db,"2",{requestId:req(),expenseId:saved.id,expectedRevision:"1"});
 const payment={requestId:req(),expenseId:saved.id,expectedRevision:"2",method:"CASH",accountId:custody.id,paymentDate:"2026-10-21",actuallyPaid:true,expectedBalance:"100",negativeAcknowledged:false};
 const paid=await payExpense(db,"1",payment,"2026-10-29");assert.equal((await payExpense(db,"1",payment,"2026-10-29")).id,paid.id);
 const own=await listAccounts(db,"3");assert.deepEqual(own.map(x=>x.id),[custody.id]);assert.equal(own[0].balance,"80.00");
 await rejectsCode(()=>listExpenses(db,"3"),"forbidden");await rejectsCode(()=>listAccountActivity(db,"3",vault.id),"forbidden");
 const activity=await listAccountActivity(db,"3",custody.id);assert.equal(activity[0].kind,"DEBIT");
 assert.deepEqual(Object.keys(activity[0]).sort(),["amount","direction","id","kind","recordedAt"]);assert(!JSON.stringify(activity).includes("تفاصيل مالية"));
 const audit=await raw("SELECT actor_id::text,reason,before_data,after_data FROM finance_candidate.audit_events WHERE entity_type='CATEGORY' AND entity_id=$1::bigint AND action='EDIT' ORDER BY id",[initial.id]);
 assert.equal(audit[0].actor_id,"2");assert.equal(audit[0].reason,"تصحيح تسمية");
 const counts=(await raw(`SELECT (SELECT count(*)::int FROM public.expenses) AS legacy_expenses,
  (SELECT count(*)::int FROM public.journal_entries) AS legacy_journals,(SELECT count(*)::int FROM finance_candidate.expenses) AS finance_expenses`))[0];
 assert.equal(counts.finance_expenses,1);assert.equal(counts.legacy_expenses,1);assert.equal(counts.legacy_journals,1);
}

test("finance core can exercise the proposed category/user/branch mapping on an isolated fixture",{timeout:120_000},async()=>{
 const pg=new PGlite();try{
  await pg.exec(legacy);
  await pg.exec(`INSERT INTO public.expenses(branch_id,category_id,amount,expense_date,requested_by) VALUES(1,1,42,'2026-01-01',1);
   INSERT INTO public.journal_entries(entry_no,entry_date,source_type,source_id) VALUES('TEST-1','2026-01-01','TEST',1)`);
  const before=await pg.query("SELECT to_jsonb(c) AS value FROM public.expense_categories c ORDER BY id");
  await pg.exec("SET selahtone.finance_candidate_test_only='yes'");await pg.exec(schema);await pg.exec(candidateCoreSchema());
  assert.deepEqual((await pg.query("SELECT to_jsonb(c) AS value FROM public.expense_categories c ORDER BY id")).rows,before.rows);
  const absent=await pg.query<{users:string|null;branches:string|null;categories:string|null;files:string|null}>(`SELECT to_regclass('finance_candidate.users')::text AS users,
   to_regclass('finance_candidate.branches')::text AS branches,to_regclass('finance_candidate.categories')::text AS categories,to_regclass('finance_candidate.expense_attachments')::text AS files`);
  assert.deepEqual(absent.rows[0],{users:null,branches:null,categories:null,files:null});
  const raw:RawQuery=async(sql,parameters=[])=>((await pg.query(sql,parameters)).rows as Array<Record<string,unknown>>);
  await exerciseCandidateCore(candidateCoreDatabase(pgliteAdapter(pg)),raw);
 }finally{await pg.close();}
});

function launch(bin:string,data:string,socket:string):Promise<ChildProcess>{
 const child=spawn(path.join(bin,"postgres"),["-D",data,"-k",socket,"-h","","-p","55434","-c","unix_socket_permissions=0700"],{stdio:["ignore","ignore","pipe"],env:process.env});
 return new Promise((resolve,reject)=>{let logs="",settled=false;
  const timeout=setTimeout(()=>{if(!settled){settled=true;child.kill("SIGKILL");reject(new Error("temporary PostgreSQL did not start"));}},30_000);
  child.stderr?.on("data",chunk=>{logs=(logs+String(chunk)).slice(-5000);if(!settled&&logs.includes("database system is ready to accept connections")){settled=true;clearTimeout(timeout);resolve(child);}});
  child.once("error",error=>{if(!settled){settled=true;clearTimeout(timeout);reject(error);}});
  child.once("exit",code=>{if(!settled){settled=true;clearTimeout(timeout);reject(new Error(`temporary PostgreSQL exited (${code}): ${logs}`));}});
 });
}
async function stop(child:ChildProcess):Promise<void>{
 if(child.exitCode!==null||child.signalCode!==null)return;
 const exited=new Promise<void>(resolve=>child.once("exit",()=>resolve()));child.kill("SIGTERM");let timeout:NodeJS.Timeout|undefined;
 const clean=await Promise.race([exited.then(()=>true),new Promise<boolean>(resolve=>{timeout=setTimeout(()=>resolve(false),5000);})]);
 if(timeout)clearTimeout(timeout);if(!clean){child.kill("SIGKILL");await exited;}
}
type Hook=(sql:string)=>Promise<void>;
function postgresAdapter(pool:Pool,before?:Hook,after?:Hook):FinanceDatabase{return {serializable:async work=>{
 const client=await pool.connect();try{
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");await client.query("SET LOCAL selahtone.finance_candidate_test_only='yes'");
  const tx:FinanceTransaction={query:async(sql,parameters=[])=>{if(before)await before(sql);const rows=(await client.query(sql,parameters)).rows;if(after)await after(sql);return {rows};}};
  const result=await work(tx);await client.query("COMMIT");return result;
 }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error;}finally{client.release();}
}};}
// Gate the first two reads/locks; it stays open for retry transactions.
function gate(fragment:string){let count=0,release!:()=>void;let promise:Promise<void>|undefined,timeout:NodeJS.Timeout|undefined;
 return {hook:async(sql:string)=>{if(count>=2||!sql.includes(fragment))return;
  if(!promise)promise=new Promise<void>((resolve,reject)=>{release=resolve;timeout=setTimeout(()=>reject(new Error("race gate timed out")),5000);});
  count++;if(count===2){if(timeout)clearTimeout(timeout);release();}await promise;
 },assert:()=>assert.equal(count,2,"both transactions must overlap")};
}
function problem(error:unknown){return error instanceof FinanceProblem?error.code:undefined;}
function signalOn(fragment:string){let seen=false,resolve!:()=>void;let timeout:NodeJS.Timeout;
 const reached=new Promise<void>((ok,fail)=>{resolve=ok;timeout=setTimeout(()=>fail(new Error("expected database lock was not reached")),5000);});
 return {reached,hook:async(sql:string)=>{if(!seen&&sql.includes(fragment)){seen=true;clearTimeout(timeout);resolve();}}};
}
const pgBin=process.env.FINANCE_TEST_PG_BIN;
test("real local PostgreSQL serializable category writes resist races",{timeout:120_000,skip:!pgBin},async t=>{
 if(!pgBin||!path.isAbsolute(pgBin)||!existsSync(path.join(pgBin,"postgres"))||!existsSync(path.join(pgBin,"initdb")))throw new Error("FINANCE_TEST_PG_BIN must be a local PostgreSQL bin directory");
 if(typeof process.getuid==="function"&&process.getuid()===0){t.skip("initdb requires an unprivileged OS user");return;}
 const tmp=mkdtempSync(path.join(os.tmpdir(),"selahtone-category-candidate-")),data=path.join(tmp,"data"),socket=path.join(tmp,"socket");mkdirSync(socket,{mode:0o700});
 let server:ChildProcess|undefined,pool:Pool|undefined;
 try{
  execFileSync(path.join(pgBin,"initdb"),["-D",data,"--no-locale","--encoding=UTF8","--auth-local=trust","--auth-host=reject","--username=finance_candidate_test"],{env:process.env,stdio:"pipe",timeout:30_000});
  server=await launch(pgBin,data,socket);pool=new Pool({host:socket,port:55434,user:"finance_candidate_test",database:"postgres",max:5});
  const admin=await pool.connect();try{await admin.query(legacy);
   await admin.query(`INSERT INTO public.expenses(branch_id,category_id,amount,expense_date,requested_by) VALUES(1,1,42,'2026-01-01',1);
    INSERT INTO public.journal_entries(entry_no,entry_date,source_type,source_id) VALUES('TEST-1','2026-01-01','TEST',1)`);
   await admin.query("BEGIN");await admin.query("SET LOCAL selahtone.finance_candidate_test_only='yes'");
   await assert.rejects(()=>admin.query(schema.replace("CREATE TABLE finance_candidate.category_audit", "SELECT 1/0; CREATE TABLE finance_candidate.category_audit")),/division by zero/);
   await admin.query("ROLLBACK");assert.equal((await admin.query("SELECT to_regnamespace('finance_candidate') AS schema")).rows[0].schema,null);
   await admin.query("SET selahtone.finance_candidate_test_only='yes'");await admin.query(schema);await admin.query(candidateCoreSchema());
  }finally{admin.release();}
  const db=postgresAdapter(pool);
  await t.test("simultaneous equal names with different requests cannot create duplicates",async()=>{
   const g=gate("WHERE lower(btrim(name_ar))"),racing=postgresAdapter(pool!,undefined,g.hook);
   const result=await Promise.allSettled([createCandidateCategory(racing,"1",make("اسم متزامن")),createCandidateCategory(racing,"2",make("اسم متزامن"))]);
   g.assert();assert.equal(result.filter(x=>x.status==="fulfilled").length,1);
   assert.equal(problem((result.find(x=>x.status==="rejected") as PromiseRejectedResult).reason),"category_duplicate");
   assert.equal(Number((await pool!.query("SELECT count(*) AS n FROM public.expense_categories WHERE name_ar='اسم متزامن'")).rows[0].n),1);
  });
  await t.test("simultaneous identical requests create one category and one audit",async()=>{
   const g=gate("FROM finance_candidate.category_requests WHERE request_id"),racing=postgresAdapter(pool!,undefined,g.hook),input=make("طلب متزامن");
   const result=await Promise.all([createCandidateCategory(racing,"1",input),createCandidateCategory(racing,"1",input)]);
   g.assert();assert.equal(result[0].id,result[1].id);assert.equal(result.filter(x=>x.replayed).length,1);
   assert.equal(Number((await pool!.query("SELECT count(*) AS n FROM finance_candidate.category_audit WHERE category_id=$1::int",[result[0].id])).rows[0].n),1);
   assert.equal(Number((await pool!.query("SELECT count(*) AS n FROM finance_candidate.category_requests WHERE request_id=$1::uuid",[input.requestId])).rows[0].n),1);
  });
  await t.test("simultaneous edits of the same old snapshot cannot overwrite each other",async()=>{
   const original=(await listCandidateCategories(db,"1")).find(r=>r.id==="1")!;
   const g=gate("LEFT JOIN finance_candidate.category_revisions r ON r.category_id=p.id WHERE p.id"),racing=postgresAdapter(pool!,g.hook);
   const out=await Promise.allSettled([editCandidateCategory(racing,"1",edit(original,"تعديل ألف")),editCandidateCategory(racing,"2",edit(original,"تعديل باء"))]);
   g.assert();assert.equal(out.filter(x=>x.status==="fulfilled").length,1);
   assert.equal(problem((out.find(x=>x.status==="rejected") as PromiseRejectedResult).reason),"category_changed");
   const current=(await listCandidateCategories(db,"1")).find(r=>r.id==="1")!;assert.equal(current.revision,2);assert.equal(current.createdBy,null);
   assert.equal(Number((await pool!.query("SELECT count(*) AS n FROM finance_candidate.category_audit WHERE category_id=1 AND action='EDIT'")).rows[0].n),1);
  });
  await t.test("a concurrent request key reused with changed input fails instead of replaying",async()=>{
   const input=make("المحاولة الأولى"),g=gate("FROM finance_candidate.category_requests WHERE request_id"),racing=postgresAdapter(pool!,undefined,g.hook);
   const out=await Promise.allSettled([createCandidateCategory(racing,"1",input),createCandidateCategory(racing,"1",{...input,name:"المحاولة الثانية"})]);
   g.assert();assert.equal(out.filter(x=>x.status==="fulfilled").length,1);
   assert.equal(problem((out.find(x=>x.status==="rejected") as PromiseRejectedResult).reason),"request_conflict");
   assert.equal(Number((await pool!.query("SELECT count(*) AS n FROM finance_candidate.category_requests WHERE request_id=$1::uuid",[input.requestId])).rows[0].n),1);
  });
  await t.test("finance core uses existing fictional users, branches and categories on PostgreSQL",async()=>{
   const raw:RawQuery=async(sql,parameters=[])=>((await pool!.query(sql,parameters)).rows as Array<Record<string,unknown>>);
   await exerciseCandidateCore(candidateCoreDatabase(db),raw);
  });
  await t.test("a real user suspension committed while a finance action waits prevents the action",async()=>{
   const blocker=await pool!.connect(),input=make("لا يُنشأ بعد إيقاف المستخدم");let open=false;
   try{
    await blocker.query("BEGIN");open=true;await blocker.query("UPDATE public.users SET status='SUSPENDED' WHERE id=1");
    const signal=signalOn("FROM public.users WHERE id=$1::bigint FOR SHARE"),core=candidateCoreDatabase(postgresAdapter(pool!,signal.hook));
    const result=addCategory(core,"1",input).then(value=>({value,error:null}),error=>({value:null,error}));
    await signal.reached;await blocker.query("COMMIT");open=false;
    assert.equal(problem((await result).error),"forbidden");
    assert.equal(Number((await pool!.query("SELECT count(*) AS n FROM public.expense_categories WHERE name_ar=$1",[input.name])).rows[0].n),0);
   }finally{if(open)await blocker.query("ROLLBACK");blocker.release();await pool!.query("UPDATE public.users SET status='ACTIVE' WHERE id=1");}
  });
  await t.test("a branch stopped while an opening waits is not opened",async()=>{
   const blocker=await pool!.connect();let open=false;
   try{
    await blocker.query("BEGIN");open=true;await blocker.query("UPDATE public.branches SET is_active=false WHERE id=2");
    const signal=signalOn("FROM public.branches WHERE id=$1::bigint FOR SHARE"),core=candidateCoreDatabase(postgresAdapter(pool!,signal.hook));
    const input={requestId:req(),branchId:"2",kind:"VAULT",holderId:null,openingAmount:"10",openingDate:"2026-10-20",counted:true};
    const result=openAccount(core,"1",input,"2026-10-29").then(value=>({value,error:null}),error=>({value:null,error}));
    await signal.reached;await blocker.query("COMMIT");open=false;
    assert.equal(problem((await result).error),"branch_unavailable");
    assert.equal(Number((await pool!.query("SELECT count(*) AS n FROM finance_candidate.accounts WHERE branch_id=2")).rows[0].n),0);
   }finally{if(open)await blocker.query("ROLLBACK");blocker.release();await pool!.query("UPDATE public.branches SET is_active=true WHERE id=2");}
  });
  await t.test("a finance audit failure rolls back public category edits and core metadata together",async()=>{
   await pool!.query(`CREATE FUNCTION finance_candidate.reject_core_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.entity_type='CATEGORY' THEN RAISE EXCEPTION 'synthetic core audit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_core_audit BEFORE INSERT ON finance_candidate.audit_events FOR EACH ROW EXECUTE FUNCTION finance_candidate.reject_core_audit()`);
   try{
    const core=candidateCoreDatabase(db),before=(await listCategories(core,"1")).find(x=>x.id==="2")!,input={
     requestId:req(),categoryId:before.id,expectedRevision:String(before.revision),expectedSnapshot:before.snapshot,name:"لن يُحفظ",active:false,reason:"فشل اختباري"};
    await assert.rejects(()=>editCategory(core,"1",input),/synthetic core audit failure/);
    assert.deepEqual((await listCategories(core,"1")).find(x=>x.id==="2"),before);
    assert.equal(Number((await pool!.query("SELECT count(*) AS n FROM finance_candidate.requests WHERE request_id=$1::uuid",[input.requestId])).rows[0].n),0);
    const creation=make("إنشاء لن يُحفظ");await assert.rejects(()=>addCategory(core,"1",creation),/synthetic core audit failure/);
    assert.equal(Number((await pool!.query("SELECT count(*) AS n FROM public.expense_categories WHERE name_ar=$1",[creation.name])).rows[0].n),0);
   }finally{await pool!.query("DROP TRIGGER reject_core_audit ON finance_candidate.audit_events; DROP FUNCTION finance_candidate.reject_core_audit()");}
  });
  await t.test("concurrent core and candidate commands cannot create the same category name",async()=>{
   const g=gate("WHERE lower(btrim(name_ar))"),racing=postgresAdapter(pool!,undefined,g.hook),name="اسم مشترك متزامن";
   const out=await Promise.allSettled([addCategory(candidateCoreDatabase(racing),"1",make(name)),createCandidateCategory(racing,"2",make(name))]);
   g.assert();assert.equal(out.filter(x=>x.status==="fulfilled").length,1);
   assert.equal(problem((out.find(x=>x.status==="rejected") as PromiseRejectedResult).reason),"category_duplicate");
   assert.equal(Number((await pool!.query("SELECT count(*) AS n FROM public.expense_categories WHERE name_ar=$1",[name])).rows[0].n),1);
  });
 }finally{if(pool)await pool.end();if(server)await stop(server);rmSync(tmp,{recursive:true,force:true});}
});
