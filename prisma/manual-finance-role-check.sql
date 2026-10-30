-- فحص هوية دور التطبيق وصلاحياته على مخطط finance — قراءة فقط.
-- شغّل الملف كله دفعة واحدة في Neon SQL Editor (الفرع production، القاعدة neondb)،
-- ثم شارك عمود finance_role_check فقط. لا تشارك روابط اتصال أو كلمات مرور.
--
-- لماذا هذا الفحص: ترقية المالية نُفِّذت بدور neondb_owner من SQL Editor، وهذا
-- لا يثبت أن التطبيق يتصل بالدور نفسه. العمود recent_connections يعرض أدوار
-- الاتصالات الفعلية على هذه القاعدة (من pg_stat_activity)، فنعرف دور التطبيق
-- دون كشف أي سر.
--
-- ملاحظة: قد تظهر الاتصالات فارغة إن كان الموقع في حالة سكون (Scale to zero).
-- في هذه الحالة افتح الموقع وانتظر قليلًا ثم أعد الفحص.
BEGIN TRANSACTION READ ONLY;

WITH finance_tables AS (
  SELECT c.oid, c.relname::text AS name, c.relowner, c.relrowsecurity
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'finance' AND c.relkind = 'r'
), missing AS (
  SELECT name,
    has_table_privilege(current_user, oid, 'SELECT') AS can_select,
    has_table_privilege(current_user, oid, 'INSERT') AS can_insert,
    has_table_privilege(current_user, oid, 'UPDATE') AS can_update,
    has_table_privilege(current_user, oid, 'DELETE') AS can_delete
  FROM finance_tables
), owners AS (
  SELECT DISTINCT pg_catalog.pg_get_userbyid(c.relowner)::text AS owner FROM finance_tables c
), roles AS (
  SELECT rolname::text AS name FROM pg_catalog.pg_roles WHERE rolname NOT LIKE 'pg\_%' ORDER BY 1
), connections AS (
  SELECT jsonb_agg(x) FROM (
    SELECT DISTINCT usename::text AS role, application_name AS application, state,
      client_addr::text AS client, count(*)::int AS sessions
    FROM pg_catalog.pg_stat_activity
    WHERE datname = current_database() AND usename IS NOT NULL
    GROUP BY 1, 2, 3, 4 ORDER BY 1
  ) x
)
SELECT jsonb_build_object(
  'checked_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'database', current_database(),
  'server_version', current_setting('server_version'),
  'inspection_role', current_user::text,
  'session_role', session_user::text,
  'inspection_role_only', true,
  'finance_namespace_exists', to_regnamespace('finance') IS NOT NULL,
  'finance_table_count', (SELECT count(*) FROM finance_tables),
  'finance_object_owners', (SELECT COALESCE(jsonb_agg(owner), '[]'::jsonb) FROM owners),
  'can_use_finance_schema', pg_catalog.has_schema_privilege(current_user, 'finance', 'USAGE'),
  'can_create_in_finance_schema', pg_catalog.has_schema_privilege(current_user, 'finance', 'CREATE'),
  'tables_missing_select', (SELECT COALESCE(jsonb_agg(name ORDER BY name), '[]'::jsonb) FROM missing WHERE NOT can_select),
  'tables_missing_insert', (SELECT COALESCE(jsonb_agg(name ORDER BY name), '[]'::jsonb) FROM missing WHERE NOT can_insert),
  'tables_missing_update', (SELECT COALESCE(jsonb_agg(name ORDER BY name), '[]'::jsonb) FROM missing WHERE NOT can_update),
  'tables_with_delete', (SELECT COALESCE(jsonb_agg(name ORDER BY name), '[]'::jsonb) FROM missing WHERE can_delete),
  'rls_enabled_tables', (
    SELECT COALESCE(jsonb_agg(name ORDER BY name), '[]'::jsonb) FROM finance_tables WHERE relrowsecurity
  ),
  'database_roles', (SELECT COALESCE(jsonb_agg(name), '[]'::jsonb) FROM roles),
  'recent_connections', (SELECT COALESCE((SELECT jsonb_agg FROM connections), '[]'::jsonb)),
  'note', 'recent_connections يعرض أدوار الاتصالات الفعلية على القاعدة؛ إن كان الموقع نائمًا فافتحه وأعد الفحص.'
)::text AS finance_role_check;

ROLLBACK;
