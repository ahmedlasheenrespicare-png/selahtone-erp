import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const sql=readFileSync("prisma/manual-finance-release-audit.sql","utf8");
type Result={database:string;inspection_role_only:boolean;inspection_role_can_create_schema:boolean;
 objects:Array<{table_name:string;can_select:boolean;row_security_active_for_inspector:boolean}>;
 existing_finance_namespaces:string[];existing_public_finance_objects:Array<{name:string}>;
 user_triggers:Array<{table_name:string;on_insert:boolean;on_update:boolean;row_level:boolean}>;
 incoming_legacy_foreign_keys:Array<{source_table:string;referenced_table:string}>;
 dependent_legacy_views:Array<{view_name:string;referenced_table:string}>;
 legacy_counts:{expenses:number;expense_categories:number;journal_entries:number};
 commerce_counts:{sales:number;collections:number;cash_collections:number;refunds:number;cash_refunds:number}};
async function inspect(pg:PGlite):Promise<Result>{
  const results=await pg.exec(sql);
  assert.equal(results.length,3);
  return JSON.parse((results[1].rows[0] as {finance_release_audit:string}).finance_release_audit) as Result;
}
const fixtureSql=`
 CREATE TABLE public.branches(id bigint PRIMARY KEY);
 CREATE TABLE public.users(id bigint PRIMARY KEY,private_name text);
 CREATE TABLE public.expense_categories(id integer PRIMARY KEY,description text);
 CREATE TABLE public.expenses(id bigint PRIMARY KEY,category_id integer REFERENCES public.expense_categories(id),description text,amount numeric);
 CREATE TABLE public.journal_entries(id bigint PRIMARY KEY,source_data text);
 CREATE TABLE public.commerce_sales(id bigint PRIMARY KEY,customer_name text,customer_phone text);
 CREATE TABLE public.commerce_collections(id bigint PRIMARY KEY,method text,amount numeric);
 CREATE TABLE public.commerce_refunds(id bigint PRIMARY KEY,method text,amount numeric);
 CREATE TABLE public.legacy_reference(id bigint PRIMARY KEY, expense_id bigint REFERENCES public.expenses(id));
 CREATE VIEW public.legacy_expense_view AS SELECT id FROM public.expenses;
 CREATE SCHEMA finance_core;
 CREATE TABLE public.finance_old_state(id bigint);
 CREATE FUNCTION public.audit_trigger() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW; END$$;
 CREATE TRIGGER cash_audit BEFORE INSERT OR UPDATE ON public.commerce_sales FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
 INSERT INTO public.users VALUES(1,'USER_SECRET_FOR_TEST');
 INSERT INTO public.expense_categories VALUES(1,'CATEGORY_SECRET_FOR_TEST');
 INSERT INTO public.expenses VALUES(1,1,'EXPENSE_SECRET_FOR_TEST',9182.31);
 INSERT INTO public.journal_entries VALUES(1,'JOURNAL_SECRET_FOR_TEST');
 INSERT INTO public.commerce_sales VALUES(1,'CUSTOMER_SECRET_FOR_TEST','01099999999');
 INSERT INTO public.commerce_collections VALUES(1,'CASH',8182.29),(2,'CARD',232.21);
 INSERT INTO public.commerce_refunds VALUES(1,'CASH',982.25);
`;
async function fixture(pg:PGlite){await pg.exec(fixtureSql)}
test("finance release audit is read-only, aggregated, and reports dependencies without personal data",async()=>{
 const pg=new PGlite();try{await fixture(pg);const before=await pg.query("SELECT * FROM public.expenses"),result=await inspect(pg);
 assert.equal(result.inspection_role_only,true);assert.deepEqual(result.legacy_counts,{expenses:1,expense_categories:1,journal_entries:1});
 assert.deepEqual(result.commerce_counts,{sales:1,collections:2,cash_collections:1,refunds:1,cash_refunds:1});
 assert(result.existing_finance_namespaces.includes("finance_core"));assert(result.existing_public_finance_objects.some(x=>x.name==="finance_old_state"));
 assert(result.user_triggers.some(x=>x.table_name==="commerce_sales" && x.row_level && x.on_insert && x.on_update));
 assert(result.incoming_legacy_foreign_keys.some(x=>x.source_table==="legacy_reference"&&x.referenced_table==="expenses"));
 assert(result.dependent_legacy_views.some(x=>x.view_name==="legacy_expense_view"&&x.referenced_table==="expenses"));
 const serialized=JSON.stringify(result);for(const secret of ["USER_SECRET_FOR_TEST","CATEGORY_SECRET_FOR_TEST","EXPENSE_SECRET_FOR_TEST","JOURNAL_SECRET_FOR_TEST","CUSTOMER_SECRET_FOR_TEST","01099999999","9182.31","8182.29"])assert(!serialized.includes(secret));
 assert.deepEqual((await pg.query("SELECT * FROM public.expenses")).rows,before.rows);
 }finally{await pg.close()}
});
test("audit makes row-filtered counts and SQL editor role scope explicit",async()=>{
 const pg=new PGlite();try{await fixture(pg);await pg.exec(`
 CREATE ROLE finance_inspector NOLOGIN;
 GRANT USAGE ON SCHEMA public TO finance_inspector;
 GRANT SELECT ON public.branches,public.users,public.expenses,public.expense_categories,public.journal_entries,public.commerce_sales,public.commerce_collections,public.commerce_refunds TO finance_inspector;
 ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
 CREATE POLICY hide_expenses ON public.expenses FOR SELECT TO finance_inspector USING (false);
 SET ROLE finance_inspector;
 `);
 const result=await inspect(pg),expense=result.objects.find(x=>x.table_name==="expenses")!;
 assert.equal(expense.can_select,true);assert.equal(expense.row_security_active_for_inspector,true);assert.equal(result.legacy_counts.expenses,0);
 assert.equal(result.inspection_role_only,true);assert.equal(result.inspection_role_can_create_schema,false);
 }finally{await pg.close()}
});

// Optional native PostgreSQL run. The temporary server listens only on a private
// Unix socket and the connection is configured explicitly, never from DATABASE_URL.
test("release audit also works against isolated native PostgreSQL",{timeout:90_000,skip:!process.env.FINANCE_TEST_PG_BIN},async t=>{
 const {spawn,execFileSync}=await import("node:child_process");
 const {mkdtempSync,mkdirSync,rmSync,existsSync}=await import("node:fs");
 const path=await import("node:path"),os=await import("node:os"),{Client}=await import("pg");
 const bin=process.env.FINANCE_TEST_PG_BIN!;
 if(!path.isAbsolute(bin)||!existsSync(path.join(bin,"initdb"))||!existsSync(path.join(bin,"postgres"))) throw new Error("FINANCE_TEST_PG_BIN must be a local PostgreSQL binary directory");
 if(typeof process.getuid==="function"&&process.getuid()===0){t.skip("initdb requires an unprivileged OS user");return;}
 const tmp=mkdtempSync(path.join(os.tmpdir(),"finance-release-audit-")),data=path.join(tmp,"data"),socket=path.join(tmp,"socket");mkdirSync(socket,{mode:0o700});
 let server:import("node:child_process").ChildProcess|undefined,client:import("pg").Client|undefined;
 try{
  execFileSync(path.join(bin,"initdb"),["-D",data,"--no-locale","--encoding=UTF8","--auth-local=trust","--auth-host=reject","--username=finance_audit_test"],{env:process.env,stdio:"pipe",timeout:30_000});
  server=spawn(path.join(bin,"postgres"),["-D",data,"-k",socket,"-h","","-p","55432","-c","unix_socket_permissions=0700"],{stdio:["ignore","ignore","pipe"],env:process.env});
  await new Promise<void>((resolve,reject)=>{let settled=false,logs="";const timeout=setTimeout(()=>{if(!settled){settled=true;reject(new Error("temporary PostgreSQL did not start"));}},30_000);
   server!.stderr!.on("data",chunk=>{logs=(logs+String(chunk)).slice(-5000);if(!settled&&logs.includes("database system is ready to accept connections")){settled=true;clearTimeout(timeout);resolve();}});
   server!.once("error",error=>{if(!settled){settled=true;clearTimeout(timeout);reject(error);}});
   server!.once("exit",code=>{if(!settled){settled=true;clearTimeout(timeout);reject(new Error(`temporary PostgreSQL exited ${code}: ${logs}`));}});
  });
  client=new Client({host:socket,port:55432,user:"finance_audit_test",database:"postgres",connectionTimeoutMillis:5000});await client.connect();
  assert.equal((await client.query("SELECT current_setting('listen_addresses') AS listen")).rows[0].listen,"");
  await client.query(fixtureSql);
  const runs=await client.query(sql) as unknown as Array<{rows:Array<{finance_release_audit:string}>}>;assert.equal(runs.length,3);
  const result:Result=JSON.parse(runs[1].rows[0].finance_release_audit);
  assert.deepEqual(result.legacy_counts,{expenses:1,expense_categories:1,journal_entries:1});
  assert.deepEqual(result.commerce_counts,{sales:1,collections:2,cash_collections:1,refunds:1,cash_refunds:1});
  assert(result.user_triggers.some(x=>x.table_name==="commerce_sales"&&x.row_level&&x.on_insert&&x.on_update));
  assert(result.incoming_legacy_foreign_keys.some(x=>x.source_table==="legacy_reference"&&x.referenced_table==="expenses"));
  assert(result.dependent_legacy_views.some(x=>x.view_name==="legacy_expense_view"&&x.referenced_table==="expenses"));
  assert(!JSON.stringify(result).includes("CUSTOMER_SECRET_FOR_TEST"));
  await client.query(`CREATE ROLE finance_inspector NOLOGIN; GRANT USAGE ON SCHEMA public TO finance_inspector;
   GRANT SELECT ON public.branches,public.users,public.expenses,public.expense_categories,public.journal_entries,public.commerce_sales,public.commerce_collections,public.commerce_refunds TO finance_inspector;
   ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;CREATE POLICY hide_expenses ON public.expenses FOR SELECT TO finance_inspector USING (false);SET ROLE finance_inspector`);
  const restrictedRuns=await client.query(sql) as unknown as Array<{rows:Array<{finance_release_audit:string}>}>;
  const restricted:Result=JSON.parse(restrictedRuns[1].rows[0].finance_release_audit);
  assert.equal(restricted.legacy_counts.expenses,0);assert.equal(restricted.objects.find(x=>x.table_name==="expenses")!.row_security_active_for_inspector,true);
  assert.equal(restricted.inspection_role_can_create_schema,false);
  // Even an unexpected RLS function with side effects must fail instead of writing.
  await client.query(`RESET ROLE; DROP POLICY hide_expenses ON public.expenses;
   CREATE TABLE public.audit_side_effects(id integer);
   CREATE FUNCTION public.try_audit_side_effect() RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$BEGIN INSERT INTO public.audit_side_effects VALUES(1); RETURN true; END$$;
   CREATE POLICY side_effect_policy ON public.expenses FOR SELECT TO finance_inspector USING (public.try_audit_side_effect()); SET ROLE finance_inspector`);
  await assert.rejects(()=>client!.query(sql),/read-only transaction/);await client.query("ROLLBACK");await client.query("RESET ROLE");
  assert.equal((await client.query("SELECT count(*)::integer AS n FROM public.audit_side_effects")).rows[0].n,0);
 }finally{
  if(client)await client.end().catch(()=>{});
  if(server&&server.exitCode===null&&server.signalCode===null){const exited=new Promise<void>(resolve=>server!.once("exit",()=>resolve()));server.kill("SIGTERM");
   let timeout:NodeJS.Timeout|undefined;const clean=await Promise.race([exited.then(()=>true),new Promise<boolean>(resolve=>{timeout=setTimeout(()=>resolve(false),5000);})]);
   if(timeout)clearTimeout(timeout);if(!clean){server.kill("SIGKILL");await exited;}}
  rmSync(tmp,{recursive:true,force:true});
 }
});
