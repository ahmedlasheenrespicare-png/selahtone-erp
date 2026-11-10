// TEST ONLY — C5 local app-role probe + C4 completion. SINGLE FILE, PORTABLE.
// No secrets in this file. The pooled DATABASE_URL is supplied by the operator
// locally via a hidden prompt; it is never printed, logged, or sent anywhere.
// It runs the SHA-PINNED reviewed probe SQL (unchanged) and the three C4
// statements copied verbatim from the approved v1.1 text, each batch inside a
// READ ONLY transaction ending in ROLLBACK. It cannot write, commit or deploy.
import { createHash } from "node:crypto";
import path from "node:path";

const REVIEWED_PROBE_SQL_SHA256 = "d960c559927eda3117b1793f5ff46249be81c2923b3e2233cfcb4f953b9d83eb";
const REVIEWED_C4_SQL_SHA256 = "ec6926aa0397e236a31db710706b75749fd4d291375c80c33b6fa0cab748083d";
const PROBE_SQL = "-- فحص هوية اتصال التطبيق — للقراءة فقط، للمراجعة المخبرية، وليس ترقية.\n-- الإصدار 1.1 بعد مراجعة 2026-11-05 بإجازة المستخدم (مراجعة النص أولًا).\n--\n-- TEST ONLY. لا يُنشئ جدولًا، ولا يعدّل صفًا، ولا يكشف سلسلة الاتصال أو كلمة مرور\n-- أو اسم قاعدة أو مضيف أو بيانات عملاء أو مبالغ. يُشغَّل الملف كاملًا من\n-- **اتصال التطبيق نفسه** (DATABASE_URL عبر pgbouncer، وليس DIRECT_URL، وليس\n-- SQL Editor) داخل معاملة للقراءة فقط تنتهي بـ ROLLBACK.\n--\n-- لماذا يختلف عن prisma/manual-finance-release-audit.sql: ذلك الفحص يعلن\n-- inspection_role_only=true لأنه يعمل بدور SQL Editor، ولا يثبت هوية دور التطبيق\n-- ولا صلاحياته. هذا الفحص يجيب عن: من هو الدور الفعلي للاتصال؟ هل يرث عضوية\n-- تمنحه كتابة شاملة تتجاوز REVOKE؟ هل يملك مخطط finance؟ هل RLS مفعّل؟\n--\n-- مراجعة 1.1 (ما تغيّر ولماذا):\n--  1. حُذف current_database() وcurrent_schema() من المخرجات؛ الأول يُستخدم فقط\n--     كوسيط داخل has_database_privilege ولا يُعرض، لأن اسم القاعدة جزء من هوية\n--     البيئة ولا حاجة لعرضه. لا تُعرض أي قيمة من سلسلة الاتصال.\n--  2. استُبدل pg_has_role(current_user,'<اسم دور>',...) بصيغة تعتمد على oid مع\n--     COALESCE. الصيغة القديمة قد تُخطئ عند تحليل الاستعلام إن لم يكن الدور\n--     المعرَّف مسبقًا موجودًا على بيئة مُدارة؛ الجديدة تُرجع false بأمان.\n--  3. أُضيف read_only_transaction للتحقق فعليًا أن المعاملة للقراءة فقط،\n--     وSET LOCAL statement_timeout لحماية الإنتاج من استعلام طويل؛ SET LOCAL\n--     مقصود بدل SET لأن تجميع pgbouncer قد يعيد استخدام الاتصال.\n--  4. أُضيف probe_version، وتنبيه بأن pg_has_role يثبت العضوية لا الصلاحية\n--     الفعلية الموروثة (PG16 inherit_option)؛ الفيصل هو has_table_privilege.\n--\n-- انتُقيت حقول pg_roles صراحةً بدل to_jsonb(pg_roles) لأن العمود rolpassword\n-- قد يحمل قيمة هاش حقيقية لدور فائق؛ لا يُخرَج هنا أبدًا. أسماء الأدوار فقط\n-- تُجمع، دون أي مفتاح أو بيانات جلسة حساسة.\n\nBEGIN TRANSACTION READ ONLY;\nSET LOCAL statement_timeout = '15s';\n\nWITH RECURSIVE role_chain AS (\n  SELECT r.oid, r.rolname::text AS role_name\n  FROM pg_catalog.pg_roles r WHERE r.rolname = current_user\n  UNION\n  SELECT parent.oid, parent.rolname::text AS role_name\n  FROM pg_catalog.pg_auth_members m\n  JOIN pg_catalog.pg_roles parent ON parent.oid = m.roleid\n  JOIN role_chain child ON child.oid = m.member\n), flags AS (\n  SELECT jsonb_build_object(\n    'superuser', r.rolsuper,\n    'inherit', r.rolinherit,\n    'create_role', r.rolcreaterole,\n    'create_db', r.rolcreatedb,\n    'can_login', r.rolcanlogin,\n    'replication', r.rolreplication,\n    'bypass_rls', r.rolbypassrls\n  ) AS value\n  FROM pg_catalog.pg_roles r WHERE r.rolname = current_user\n), finance_ns AS (\n  SELECT n.oid, (n.nspowner = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user)) AS owned_by_current_user\n  FROM pg_catalog.pg_namespace n WHERE n.nspname = 'finance'\n), finance_objects AS (\n  SELECT c.relname::text AS table_name,\n         (c.relowner = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user)) AS owned_by_current_user,\n         pg_catalog.has_table_privilege(current_user, c.oid, 'SELECT') AS can_select,\n         pg_catalog.has_table_privilege(current_user, c.oid, 'INSERT') AS can_insert,\n         pg_catalog.has_table_privilege(current_user, c.oid, 'UPDATE') AS can_update,\n         pg_catalog.has_table_privilege(current_user, c.oid, 'DELETE') AS can_delete,\n         pg_catalog.has_table_privilege(current_user, c.oid, 'TRUNCATE') AS can_truncate,\n         pg_catalog.row_security_active(c.oid) AS rls_active\n  FROM pg_catalog.pg_class c\n  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace\n  WHERE n.nspname = 'finance' AND c.relkind IN ('r', 'p')\n)\nSELECT jsonb_build_object(\n  'probe_scope', 'APP_CONNECTION_ONLY',\n  'probe_version', '1.1',\n  'read_only_transaction', current_setting('transaction_read_only') = 'on',\n  'current_user', current_user::text,\n  'session_user', session_user::text,\n  'role_flags', (SELECT value FROM flags),\n  'inherited_roles', (SELECT COALESCE(jsonb_agg(role_name ORDER BY role_name), '[]'::jsonb)\n                      FROM role_chain WHERE role_name <> current_user::text),\n  'inherits_write_all_data', COALESCE((SELECT pg_catalog.pg_has_role(current_user, r.oid, 'MEMBER')\n                                       FROM pg_catalog.pg_roles r WHERE r.rolname = 'pg_write_all_data'), false),\n  'inherits_read_all_data', COALESCE((SELECT pg_catalog.pg_has_role(current_user, r.oid, 'MEMBER')\n                                      FROM pg_catalog.pg_roles r WHERE r.rolname = 'pg_read_all_data'), false),\n  'can_create_schema', pg_catalog.has_database_privilege(current_user, current_database(), 'CREATE'),\n  'finance_schema_present', EXISTS (SELECT 1 FROM finance_ns),\n  'finance_schema_owned_by_current_user', (SELECT owned_by_current_user FROM finance_ns),\n  'can_create_in_finance', CASE WHEN EXISTS (SELECT 1 FROM finance_ns)\n                                THEN pg_catalog.has_schema_privilege(current_user, 'finance', 'CREATE') ELSE null END,\n  'finance_object_count', (SELECT count(*) FROM finance_objects),\n  'finance_objects', (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.table_name), '[]'::jsonb) FROM finance_objects x),\n  'limitations', jsonb_build_array(\n    'ROLE_IDENTITY_ONLY_NOT_A_PROOF_OF_THE_DEPLOYED_APP',\n    'ACL_REVOKE_IS_INEFFECTIVE_WHEN_A_WRITE_ALL_DATA_ROLE_IS_INHERITED',\n    'SESSION_USER_IS_NOT_A_TRUSTED_APP_IDENTITY_UNDER_A_POOLER',\n    'PG_HAS_ROLE_SHOWS_MEMBERSHIP_NOT_EFFECTIVE_PRIVILEGE_USE_HAS_TABLE_PRIVILEGE',\n    'NO_PROOF_OF_CASH_MOVEMENT_OR_HUMAN_REVIEW'\n  )\n)::text AS app_connection_probe;\n\nROLLBACK;\n";
const C4_SQL = "BEGIN TRANSACTION READ ONLY;\nSET LOCAL statement_timeout = '30s';\n\n-- ٣) السياسات الفعّالة (وصف فقط)\nSELECT n.nspname, c.relname, p.polname, p.polcmd, p.polpermissive\nFROM pg_policy p\nJOIN pg_class c ON c.oid = p.polrelid\nJOIN pg_namespace n ON n.oid = c.relnamespace\nWHERE n.nspname IN ('public', 'finance')\nORDER BY 1, 2, 3;\n\n-- ٤ب) فحص «صفر صفوف»\nSELECT c.relname, c.relkind, pg_get_userbyid(c.relowner) AS owner\nFROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace\nWHERE n.nspname = 'finance'\n  AND pg_get_userbyid(c.relowner) <> 'selahtone_finance_admin';\n\n-- ٦) المحفّزات الـ19: الوجود والتعريف والتمكين فقط — بلا أي كتابة أو إجراء مالي\nSELECT n.nspname, c.relname AS table_name, t.tgname, t.tgenabled,\n       pg_get_triggerdef(t.oid) AS definition\nFROM pg_trigger t\nJOIN pg_class c ON c.oid = t.tgrelid\nJOIN pg_namespace n ON n.oid = c.relnamespace\nWHERE n.nspname = 'finance' AND NOT t.tgisinternal\nORDER BY 2, 3;\n\nROLLBACK;\n";

function fail(code) { console.error(`C5_LOCAL_PROBE_${code}`); process.exitCode = 1; }
function stop(code) { fail(code); process.exit(1); }
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
if (sha(PROBE_SQL) !== REVIEWED_PROBE_SQL_SHA256) stop("PROBE_SQL_TEXT_CHANGED_REVIEW_REQUIRED");
if (sha(C4_SQL) !== REVIEWED_C4_SQL_SHA256) stop("C4_SQL_TEXT_CHANGED_REVIEW_REQUIRED");
if (process.env.FINANCE_IDENTITY_PROBE_CONFIRM !== "I reviewed the SQL") stop("CONFIRMATION_REQUIRED");
if (!process.env.DATABASE_URL) stop("NO_APP_CONNECTION_IN_THIS_ENVIRONMENT");
if (process.env.FINANCE_IDENTITY_PROBE_ALLOW_DIRECT === "yes") stop("DIRECT_URL_IS_NOT_THE_APP_CONNECTION");
let parsedUrl;
try { parsedUrl = new URL(process.env.DATABASE_URL); } catch { stop("UNPARSEABLE_CONNECTION_STRING"); }
if (!parsedUrl.hostname.includes("pooler")) stop("POOLED_ENDPOINT_REQUIRED");

// Strip comments AND quoted literals before looking for writing verbs.
const scrub = (s) => s.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n").replace(/'(?:[^']|'')*'/g, "''");
for (const [label, sql] of [["PROBE", PROBE_SQL], ["C4", C4_SQL]]) {
  const body = scrub(sql);
  if (/\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|GRANT|REVOKE|TRUNCATE|COPY|COMMIT)\b/i.test(body)) stop(`${label}_WRITING_STATEMENT_FOUND`);
}
if (!/^\s*BEGIN TRANSACTION READ ONLY;/i.test(scrub(C4_SQL)) || !/ROLLBACK;\s*$/i.test(scrub(C4_SQL))) stop("C4_NOT_READ_ONLY_TRANSACTION");

let pg;
try { pg = await import("pg"); }
catch {
  const alt = process.env.PG_MODULE_PATH;
  if (!alt) stop("PG_DRIVER_UNAVAILABLE");
  try { const { createRequire } = await import("node:module"); pg = createRequire(path.join(alt, "..", "noop.js"))("pg"); }
  catch { stop("PG_DRIVER_UNAVAILABLE"); }
}
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10_000 });
const pick = (list, key) => (Array.isArray(list) ? list : [list]).find((r) => r?.rows?.[0] && Object.hasOwn(r.rows[0], key))?.rows ?? null;
try {
  await client.connect();
  const probeResults = await client.query(PROBE_SQL);
  const probeRow = (Array.isArray(probeResults) ? probeResults : [probeResults]).find((r) => r?.rows?.[0] && Object.hasOwn(r.rows[0], "app_connection_probe"))?.rows?.[0];
  if (!probeRow) stop("NO_PROBE_RESULT");
  const appConnectionProbe = JSON.parse(String(probeRow.app_connection_probe));
  if (appConnectionProbe.probe_scope !== "APP_CONNECTION_ONLY" || appConnectionProbe.probe_version !== "1.1" || appConnectionProbe.read_only_transaction !== true) stop("UNEXPECTED_PROBE_RESULT");

  const c4Results = await client.query(C4_SQL);
  const list = Array.isArray(c4Results) ? c4Results : [c4Results];
  if (!list.some((r) => r?.command === "ROLLBACK")) stop("C4_ROLLBACK_NOT_CONFIRMED");
  const policies = pick(list, "polname") ?? [];
  const zeroRows = pick(list, "owner") ?? [];
  const triggers = pick(list, "tgname") ?? [];

  const output = JSON.stringify({
    scope: "C5_LOCAL_PROBE_PLUS_C4_COMPLETION",
    probe_version: "1.1",
    pinned_probe_sha: REVIEWED_PROBE_SQL_SHA256,
    c4_sql_sha: REVIEWED_C4_SQL_SHA256,
    c4_read_only_rollback: true,
    app_connection_probe: appConnectionProbe,
    c4_completion: {
      counts: { policies: policies.length, zero_rows: zeroRows.length, triggers_19: triggers.length },
      policies_rows: policies,
      zero_rows_rows: zeroRows,
      triggers_19_rows: triggers,
    },
    limitations: [
      "ROLE_IDENTITY_ONLY_NOT_A_PROOF_OF_THE_DEPLOYED_APP",
      "RLS_DISABLED_SO_RLS_ENFORCEMENT_REMAINS_UNVERIFIABLE",
      "DATABASE_URL_SWITCH_STILL_UNVERIFIED_FROM_LOG",
      "NO_PROOF_OF_CASH_MOVEMENT_TIMING_OR_HUMAN_REVIEW",
      "REQUIRES_SEPARATE_POST_RUN_CHECK_AND_REENABLE_DECISION",
    ],
  });
  const secrets = [process.env.DATABASE_URL, parsedUrl.password].filter(Boolean);
  const unsafe = secrets.some((s) => s && output.includes(s)) || /postgresql:\/\/|postgres:\/\/|sslmode=|password=/i.test(output);
  if (unsafe) { fail("UNSAFE_OUTPUT_NOT_PRINTED"); }
  else process.stdout.write(output + "\n");
} catch (e) {
  await client.query("ROLLBACK").catch(() => {});
  fail("QUERY_FAILED_NO_DETAILS");
} finally { await client.end().catch(() => {}); }
