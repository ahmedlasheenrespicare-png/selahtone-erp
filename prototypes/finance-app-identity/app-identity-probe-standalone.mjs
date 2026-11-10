#!/usr/bin/env node
/**
 * TEST ONLY — SINGLE-FILE, PORTABLE app-connection identity probe.
 * Reviewed 2026-11-05. The reviewed SQL is embedded below verbatim; its sha256
 * is pinned so any edit is refused. Run on a machine that has the application's
 * OWN pooled DATABASE_URL in its environment (see
 * docs/finance-app-connection-access-ar.md). Never run from SQL Editor, never
 * with DIRECT_URL, never send the connection string to anyone.
 *
 *   FINANCE_IDENTITY_PROBE_CONFIRM="I reviewed the SQL" node app-identity-probe-standalone.mjs
 *
 * Requires Node.js >= 18 and the `pg` package (`npm i pg@8` in a temp folder,
 * or run from a checkout where npm ci was executed). Prints ONLY the aggregate
 * `app_connection_probe` column; on any error it prints a fixed code, never
 * driver text (which can echo host/user). Not a migration, not a deployment.
 */
import { createHash } from "node:crypto";
import path from "node:path";

const REVIEWED_SHA256 = "d960c559927eda3117b1793f5ff46249be81c2923b3e2233cfcb4f953b9d83eb";
const SQL = "-- فحص هوية اتصال التطبيق — للقراءة فقط، للمراجعة المخبرية، وليس ترقية.\n-- الإصدار 1.1 بعد مراجعة 2026-11-05 بإجازة المستخدم (مراجعة النص أولًا).\n--\n-- TEST ONLY. لا يُنشئ جدولًا، ولا يعدّل صفًا، ولا يكشف سلسلة الاتصال أو كلمة مرور\n-- أو اسم قاعدة أو مضيف أو بيانات عملاء أو مبالغ. يُشغَّل الملف كاملًا من\n-- **اتصال التطبيق نفسه** (DATABASE_URL عبر pgbouncer، وليس DIRECT_URL، وليس\n-- SQL Editor) داخل معاملة للقراءة فقط تنتهي بـ ROLLBACK.\n--\n-- لماذا يختلف عن prisma/manual-finance-release-audit.sql: ذلك الفحص يعلن\n-- inspection_role_only=true لأنه يعمل بدور SQL Editor، ولا يثبت هوية دور التطبيق\n-- ولا صلاحياته. هذا الفحص يجيب عن: من هو الدور الفعلي للاتصال؟ هل يرث عضوية\n-- تمنحه كتابة شاملة تتجاوز REVOKE؟ هل يملك مخطط finance؟ هل RLS مفعّل؟\n--\n-- مراجعة 1.1 (ما تغيّر ولماذا):\n--  1. حُذف current_database() وcurrent_schema() من المخرجات؛ الأول يُستخدم فقط\n--     كوسيط داخل has_database_privilege ولا يُعرض، لأن اسم القاعدة جزء من هوية\n--     البيئة ولا حاجة لعرضه. لا تُعرض أي قيمة من سلسلة الاتصال.\n--  2. استُبدل pg_has_role(current_user,'<اسم دور>',...) بصيغة تعتمد على oid مع\n--     COALESCE. الصيغة القديمة قد تُخطئ عند تحليل الاستعلام إن لم يكن الدور\n--     المعرَّف مسبقًا موجودًا على بيئة مُدارة؛ الجديدة تُرجع false بأمان.\n--  3. أُضيف read_only_transaction للتحقق فعليًا أن المعاملة للقراءة فقط،\n--     وSET LOCAL statement_timeout لحماية الإنتاج من استعلام طويل؛ SET LOCAL\n--     مقصود بدل SET لأن تجميع pgbouncer قد يعيد استخدام الاتصال.\n--  4. أُضيف probe_version، وتنبيه بأن pg_has_role يثبت العضوية لا الصلاحية\n--     الفعلية الموروثة (PG16 inherit_option)؛ الفيصل هو has_table_privilege.\n--\n-- انتُقيت حقول pg_roles صراحةً بدل to_jsonb(pg_roles) لأن العمود rolpassword\n-- قد يحمل قيمة هاش حقيقية لدور فائق؛ لا يُخرَج هنا أبدًا. أسماء الأدوار فقط\n-- تُجمع، دون أي مفتاح أو بيانات جلسة حساسة.\n\nBEGIN TRANSACTION READ ONLY;\nSET LOCAL statement_timeout = '15s';\n\nWITH RECURSIVE role_chain AS (\n  SELECT r.oid, r.rolname::text AS role_name\n  FROM pg_catalog.pg_roles r WHERE r.rolname = current_user\n  UNION\n  SELECT parent.oid, parent.rolname::text AS role_name\n  FROM pg_catalog.pg_auth_members m\n  JOIN pg_catalog.pg_roles parent ON parent.oid = m.roleid\n  JOIN role_chain child ON child.oid = m.member\n), flags AS (\n  SELECT jsonb_build_object(\n    'superuser', r.rolsuper,\n    'inherit', r.rolinherit,\n    'create_role', r.rolcreaterole,\n    'create_db', r.rolcreatedb,\n    'can_login', r.rolcanlogin,\n    'replication', r.rolreplication,\n    'bypass_rls', r.rolbypassrls\n  ) AS value\n  FROM pg_catalog.pg_roles r WHERE r.rolname = current_user\n), finance_ns AS (\n  SELECT n.oid, (n.nspowner = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user)) AS owned_by_current_user\n  FROM pg_catalog.pg_namespace n WHERE n.nspname = 'finance'\n), finance_objects AS (\n  SELECT c.relname::text AS table_name,\n         (c.relowner = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user)) AS owned_by_current_user,\n         pg_catalog.has_table_privilege(current_user, c.oid, 'SELECT') AS can_select,\n         pg_catalog.has_table_privilege(current_user, c.oid, 'INSERT') AS can_insert,\n         pg_catalog.has_table_privilege(current_user, c.oid, 'UPDATE') AS can_update,\n         pg_catalog.has_table_privilege(current_user, c.oid, 'DELETE') AS can_delete,\n         pg_catalog.has_table_privilege(current_user, c.oid, 'TRUNCATE') AS can_truncate,\n         pg_catalog.row_security_active(c.oid) AS rls_active\n  FROM pg_catalog.pg_class c\n  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace\n  WHERE n.nspname = 'finance' AND c.relkind IN ('r', 'p')\n)\nSELECT jsonb_build_object(\n  'probe_scope', 'APP_CONNECTION_ONLY',\n  'probe_version', '1.1',\n  'read_only_transaction', current_setting('transaction_read_only') = 'on',\n  'current_user', current_user::text,\n  'session_user', session_user::text,\n  'role_flags', (SELECT value FROM flags),\n  'inherited_roles', (SELECT COALESCE(jsonb_agg(role_name ORDER BY role_name), '[]'::jsonb)\n                      FROM role_chain WHERE role_name <> current_user::text),\n  'inherits_write_all_data', COALESCE((SELECT pg_catalog.pg_has_role(current_user, r.oid, 'MEMBER')\n                                       FROM pg_catalog.pg_roles r WHERE r.rolname = 'pg_write_all_data'), false),\n  'inherits_read_all_data', COALESCE((SELECT pg_catalog.pg_has_role(current_user, r.oid, 'MEMBER')\n                                      FROM pg_catalog.pg_roles r WHERE r.rolname = 'pg_read_all_data'), false),\n  'can_create_schema', pg_catalog.has_database_privilege(current_user, current_database(), 'CREATE'),\n  'finance_schema_present', EXISTS (SELECT 1 FROM finance_ns),\n  'finance_schema_owned_by_current_user', (SELECT owned_by_current_user FROM finance_ns),\n  'can_create_in_finance', CASE WHEN EXISTS (SELECT 1 FROM finance_ns)\n                                THEN pg_catalog.has_schema_privilege(current_user, 'finance', 'CREATE') ELSE null END,\n  'finance_object_count', (SELECT count(*) FROM finance_objects),\n  'finance_objects', (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.table_name), '[]'::jsonb) FROM finance_objects x),\n  'limitations', jsonb_build_array(\n    'ROLE_IDENTITY_ONLY_NOT_A_PROOF_OF_THE_DEPLOYED_APP',\n    'ACL_REVOKE_IS_INEFFECTIVE_WHEN_A_WRITE_ALL_DATA_ROLE_IS_INHERITED',\n    'SESSION_USER_IS_NOT_A_TRUSTED_APP_IDENTITY_UNDER_A_POOLER',\n    'PG_HAS_ROLE_SHOWS_MEMBERSHIP_NOT_EFFECTIVE_PRIVILEGE_USE_HAS_TABLE_PRIVILEGE',\n    'NO_PROOF_OF_CASH_MOVEMENT_OR_HUMAN_REVIEW'\n  )\n)::text AS app_connection_probe;\n\nROLLBACK;\n";

const REVIEWED_SQL_SHA256 = REVIEWED_SHA256;
function fail(code) { console.error(`APP_IDENTITY_PROBE_${code}`); process.exitCode = 1; }
function stop(code) { fail(code); process.exit(1); }

if (createHash("sha256").update(SQL).digest("hex") !== REVIEWED_SQL_SHA256) stop("TEXT_CHANGED_REVIEW_REQUIRED");
if (process.env.FINANCE_IDENTITY_PROBE_CONFIRM !== "I reviewed the SQL") stop("CONFIRMATION_REQUIRED");
if (!process.env.DATABASE_URL) stop("NO_APP_CONNECTION_IN_THIS_ENVIRONMENT");
if (process.env.FINANCE_IDENTITY_PROBE_ALLOW_DIRECT === "yes") stop("DIRECT_URL_IS_NOT_THE_APP_CONNECTION");

// Strip comments AND quoted literals before looking for writing verbs:
// has_table_privilege(...,'INSERT') is a privilege name, not a statement.
const body = SQL.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n").replace(/'(?:[^']|'')*'/g, "''");
if (!/^\s*BEGIN TRANSACTION READ ONLY;/i.test(body) || !/ROLLBACK;\s*$/i.test(body)) stop("NOT_READ_ONLY_TRANSACTION");
if (/\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|GRANT|REVOKE|TRUNCATE|COPY)\b/i.test(body)) stop("WRITING_STATEMENT_FOUND");

let pg;
try {
  pg = await import("pg");
} catch {
  // ESM resolution ignores NODE_PATH. On a paid Render Shell, `pg` may be
  // absent from the deployed artifact (it is a devDependency here). Allow an
  // explicit module directory WITHOUT touching the application's files:
  //   PG_MODULE_PATH=/tmp/probe-pg/node_modules
  const alt = process.env.PG_MODULE_PATH;
  if (!alt) stop("PG_DRIVER_UNAVAILABLE");
  try {
    const { createRequire } = await import("node:module");
    pg = createRequire(path.join(alt, "..", "noop.js"))("pg");
  } catch { stop("PG_DRIVER_UNAVAILABLE"); }
}
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10_000 });
try {
  await client.connect();
  const results = await client.query(SQL);
  const list = Array.isArray(results) ? results : [results];
  const row = list.find((r) => r?.rows?.[0] && Object.hasOwn(r.rows[0], "app_connection_probe"))?.rows?.[0];
  if (!row) stop("NO_RESULT");
  const parsed = JSON.parse(String(row.app_connection_probe));
  if (parsed.probe_scope !== "APP_CONNECTION_ONLY" || parsed.probe_version !== "1.1" || parsed.read_only_transaction !== true) stop("UNEXPECTED_RESULT");
  const output = JSON.stringify(parsed);
  if (/postgresql:\/\/|postgres:\/\/|sslmode|password|@/i.test(output)) stop("UNSAFE_OUTPUT");
  process.stdout.write(output + "\n");
} catch { fail("QUERY_FAILED_NO_DETAILS"); }
finally { await client.end().catch(() => {}); }
