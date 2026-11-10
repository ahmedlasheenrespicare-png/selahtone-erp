-- فحص هوية اتصال التطبيق — للقراءة فقط، للمراجعة المخبرية، وليس ترقية.
-- الإصدار 1.1 بعد مراجعة 2026-11-05 بإجازة المستخدم (مراجعة النص أولًا).
--
-- TEST ONLY. لا يُنشئ جدولًا، ولا يعدّل صفًا، ولا يكشف سلسلة الاتصال أو كلمة مرور
-- أو اسم قاعدة أو مضيف أو بيانات عملاء أو مبالغ. يُشغَّل الملف كاملًا من
-- **اتصال التطبيق نفسه** (DATABASE_URL عبر pgbouncer، وليس DIRECT_URL، وليس
-- SQL Editor) داخل معاملة للقراءة فقط تنتهي بـ ROLLBACK.
--
-- لماذا يختلف عن prisma/manual-finance-release-audit.sql: ذلك الفحص يعلن
-- inspection_role_only=true لأنه يعمل بدور SQL Editor، ولا يثبت هوية دور التطبيق
-- ولا صلاحياته. هذا الفحص يجيب عن: من هو الدور الفعلي للاتصال؟ هل يرث عضوية
-- تمنحه كتابة شاملة تتجاوز REVOKE؟ هل يملك مخطط finance؟ هل RLS مفعّل؟
--
-- مراجعة 1.1 (ما تغيّر ولماذا):
--  1. حُذف current_database() وcurrent_schema() من المخرجات؛ الأول يُستخدم فقط
--     كوسيط داخل has_database_privilege ولا يُعرض، لأن اسم القاعدة جزء من هوية
--     البيئة ولا حاجة لعرضه. لا تُعرض أي قيمة من سلسلة الاتصال.
--  2. استُبدل pg_has_role(current_user,'<اسم دور>',...) بصيغة تعتمد على oid مع
--     COALESCE. الصيغة القديمة قد تُخطئ عند تحليل الاستعلام إن لم يكن الدور
--     المعرَّف مسبقًا موجودًا على بيئة مُدارة؛ الجديدة تُرجع false بأمان.
--  3. أُضيف read_only_transaction للتحقق فعليًا أن المعاملة للقراءة فقط،
--     وSET LOCAL statement_timeout لحماية الإنتاج من استعلام طويل؛ SET LOCAL
--     مقصود بدل SET لأن تجميع pgbouncer قد يعيد استخدام الاتصال.
--  4. أُضيف probe_version، وتنبيه بأن pg_has_role يثبت العضوية لا الصلاحية
--     الفعلية الموروثة (PG16 inherit_option)؛ الفيصل هو has_table_privilege.
--
-- انتُقيت حقول pg_roles صراحةً بدل to_jsonb(pg_roles) لأن العمود rolpassword
-- قد يحمل قيمة هاش حقيقية لدور فائق؛ لا يُخرَج هنا أبدًا. أسماء الأدوار فقط
-- تُجمع، دون أي مفتاح أو بيانات جلسة حساسة.

BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '15s';

WITH RECURSIVE role_chain AS (
  SELECT r.oid, r.rolname::text AS role_name
  FROM pg_catalog.pg_roles r WHERE r.rolname = current_user
  UNION
  SELECT parent.oid, parent.rolname::text AS role_name
  FROM pg_catalog.pg_auth_members m
  JOIN pg_catalog.pg_roles parent ON parent.oid = m.roleid
  JOIN role_chain child ON child.oid = m.member
), flags AS (
  SELECT jsonb_build_object(
    'superuser', r.rolsuper,
    'inherit', r.rolinherit,
    'create_role', r.rolcreaterole,
    'create_db', r.rolcreatedb,
    'can_login', r.rolcanlogin,
    'replication', r.rolreplication,
    'bypass_rls', r.rolbypassrls
  ) AS value
  FROM pg_catalog.pg_roles r WHERE r.rolname = current_user
), finance_ns AS (
  SELECT n.oid, (n.nspowner = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user)) AS owned_by_current_user
  FROM pg_catalog.pg_namespace n WHERE n.nspname = 'finance'
), finance_objects AS (
  SELECT c.relname::text AS table_name,
         (c.relowner = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user)) AS owned_by_current_user,
         pg_catalog.has_table_privilege(current_user, c.oid, 'SELECT') AS can_select,
         pg_catalog.has_table_privilege(current_user, c.oid, 'INSERT') AS can_insert,
         pg_catalog.has_table_privilege(current_user, c.oid, 'UPDATE') AS can_update,
         pg_catalog.has_table_privilege(current_user, c.oid, 'DELETE') AS can_delete,
         pg_catalog.has_table_privilege(current_user, c.oid, 'TRUNCATE') AS can_truncate,
         pg_catalog.row_security_active(c.oid) AS rls_active
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'finance' AND c.relkind IN ('r', 'p')
)
SELECT jsonb_build_object(
  'probe_scope', 'APP_CONNECTION_ONLY',
  'probe_version', '1.1',
  'read_only_transaction', current_setting('transaction_read_only') = 'on',
  'current_user', current_user::text,
  'session_user', session_user::text,
  'role_flags', (SELECT value FROM flags),
  'inherited_roles', (SELECT COALESCE(jsonb_agg(role_name ORDER BY role_name), '[]'::jsonb)
                      FROM role_chain WHERE role_name <> current_user::text),
  'inherits_write_all_data', COALESCE((SELECT pg_catalog.pg_has_role(current_user, r.oid, 'MEMBER')
                                       FROM pg_catalog.pg_roles r WHERE r.rolname = 'pg_write_all_data'), false),
  'inherits_read_all_data', COALESCE((SELECT pg_catalog.pg_has_role(current_user, r.oid, 'MEMBER')
                                      FROM pg_catalog.pg_roles r WHERE r.rolname = 'pg_read_all_data'), false),
  'can_create_schema', pg_catalog.has_database_privilege(current_user, current_database(), 'CREATE'),
  'finance_schema_present', EXISTS (SELECT 1 FROM finance_ns),
  'finance_schema_owned_by_current_user', (SELECT owned_by_current_user FROM finance_ns),
  'can_create_in_finance', CASE WHEN EXISTS (SELECT 1 FROM finance_ns)
                                THEN pg_catalog.has_schema_privilege(current_user, 'finance', 'CREATE') ELSE null END,
  'finance_object_count', (SELECT count(*) FROM finance_objects),
  'finance_objects', (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.table_name), '[]'::jsonb) FROM finance_objects x),
  'limitations', jsonb_build_array(
    'ROLE_IDENTITY_ONLY_NOT_A_PROOF_OF_THE_DEPLOYED_APP',
    'ACL_REVOKE_IS_INEFFECTIVE_WHEN_A_WRITE_ALL_DATA_ROLE_IS_INHERITED',
    'SESSION_USER_IS_NOT_A_TRUSTED_APP_IDENTITY_UNDER_A_POOLER',
    'PG_HAS_ROLE_SHOWS_MEMBERSHIP_NOT_EFFECTIVE_PRIVILEGE_USE_HAS_TABLE_PRIVILEGE',
    'NO_PROOF_OF_CASH_MOVEMENT_OR_HUMAN_REVIEW'
  )
)::text AS app_connection_probe;

ROLLBACK;
