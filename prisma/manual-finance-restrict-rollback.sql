-- إعادة حالة صلاحيات مخطط finance إلى أصلها — نُفِّذ على production/neondb في
-- 2026-10-30T15:36:48Z بعد تبيّن أن التقييد بلا أثر. محفوظ للتوثيق وإعادة التنفيذ إن لزم.
--
-- ما يعيده: صلاحية الحذف والتفريغ لدور neondb_owner على جداول finance، والصلاحيات
-- الافتراضية لأي جدول يُنشأ لاحقًا في المخطط.
GRANT DELETE, TRUNCATE ON ALL TABLES IN SCHEMA finance TO neondb_owner;
ALTER DEFAULT PRIVILEGES IN SCHEMA finance GRANT ALL ON TABLES TO neondb_owner;

-- تحقق: finance_tables=16، والقائمتان الأوليان فارغتان، والثالثة ت列出 الجداول الـ16،
-- وdefault_privileges_finance = {neondb_owner=arwdDxtm/neondb_owner}
SELECT jsonb_build_object(
  'checked_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'database', current_database(),
  'finance_tables', (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'finance' AND c.relkind = 'r'),
  'finance_missing_select', (
    SELECT COALESCE(jsonb_agg(c.relname ORDER BY c.relname), '[]'::jsonb) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'finance' AND c.relkind = 'r' AND NOT has_table_privilege('neondb_owner', c.oid, 'SELECT')),
  'finance_missing_write', (
    SELECT COALESCE(jsonb_agg(c.relname ORDER BY c.relname), '[]'::jsonb) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'finance' AND c.relkind = 'r'
      AND NOT (has_table_privilege('neondb_owner', c.oid, 'INSERT') AND has_table_privilege('neondb_owner', c.oid, 'UPDATE'))),
  'finance_with_delete', (
    SELECT COALESCE(jsonb_agg(c.relname ORDER BY c.relname), '[]'::jsonb) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'finance' AND c.relkind = 'r' AND has_table_privilege('neondb_owner', c.oid, 'DELETE')),
  'default_privileges_finance', (
    SELECT COALESCE(jsonb_agg(d.defaclacl::text), '[]'::jsonb) FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace WHERE n.nspname = 'finance')
)::text AS restore_check;
