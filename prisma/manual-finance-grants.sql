-- منح صلاحيات دور التطبيق على مخطط finance — ملف يدوي، لا يُشغَّل إلا بموافقة منفصلة.
--
-- قبل تشغيله:
--   1. شغّل prisma/manual-finance-role-check.sql وشارك نتيجته.
--   2. حدّد اسم دور التطبيق من النتيجة (أو من متغير DATABASE_URL في Netlify).
--   3. استبدل القيمة أدناه في السطر المعلّم، ثم شغّل الملف كله دفعة واحدة.
--
-- ما يمنحه: قراءة وكتابة مقيدة على جداول المالية (SELECT/INSERT/UPDATE)، وقراءة
-- سجل الترقية فقط. ما لا يمنحه عن قصد: الحذف (DELETE) أو التفريغ (TRUNCATE) أو
-- أي إنشاء كائنات (CREATE) — التصحيحات تُسجَّل بالإضافة فقط، ولا يُحذف سجل مالي.
--
-- إن كان دور التطبيق هو مالك الكائنات نفسه (neondb_owner مثلًا) فالمنح تحصيل حاصل،
-- ويصبح القرار المهم هو «تقييد» اختياري في نهاية الملف يحتاج موافقة منفصلة.
DO $$
DECLARE app_role NAME := 'neondb_owner';  -- ⬅︎ استبدل هذا الاسم باسم دور التطبيق بعد الفحص
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = app_role) THEN
    RAISE EXCEPTION 'الدور % غير موجود في هذه القاعدة؛ راجع نتيجة فحص الهوية أولًا.', app_role;
  END IF;
  IF to_regnamespace('finance') IS NULL THEN
    RAISE EXCEPTION 'مخطط finance غير مثبت؛ شغّل ترقية المالية أولًا.';
  END IF;

  EXECUTE format('GRANT USAGE ON SCHEMA finance TO %I', app_role);
  EXECUTE format('GRANT USAGE ON SCHEMA finance_release TO %I', app_role);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA finance TO %I', app_role);
  EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA finance TO %I', app_role);
  -- سجل الترقية للقراءة فقط: يكتبه ملف الترقية اليدوي، لا التطبيق.
  EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA finance_release TO %I', app_role);
  -- أي جدول يُضاف لاحقًا بترقية مراجَعة يحصل على المنح نفسه تلقائيًا.
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA finance GRANT SELECT, INSERT, UPDATE ON TABLES TO %I', app_role);
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA finance GRANT USAGE, SELECT ON SEQUENCES TO %I', app_role);
END $$;

-- تحقق بعد التنفيذ: يجب أن تكون كل القوائم التالية فارغة إلا owners.
SELECT jsonb_build_object(
  'granted_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'granted_by', current_user::text,
  'database', current_database(),
  'finance_object_owners', (
    SELECT COALESCE(jsonb_agg(DISTINCT pg_catalog.pg_get_userbyid(c.relowner)), '[]'::jsonb)
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'finance' AND c.relkind = 'r'
  ),
  'tables_missing_select', (
    SELECT COALESCE(jsonb_agg(c.relname ORDER BY c.relname), '[]'::jsonb)
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'finance' AND c.relkind = 'r' AND NOT has_table_privilege('neondb_owner', c.oid, 'SELECT')
  ),
  'tables_missing_write', (
    SELECT COALESCE(jsonb_agg(c.relname ORDER BY c.relname), '[]'::jsonb)
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'finance' AND c.relkind = 'r'
      AND NOT (has_table_privilege('neondb_owner', c.oid, 'INSERT') AND has_table_privilege('neondb_owner', c.oid, 'UPDATE'))
  ),
  'tables_with_delete', (
    SELECT COALESCE(jsonb_agg(c.relname ORDER BY c.relname), '[]'::jsonb)
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'finance' AND c.relkind = 'r' AND has_table_privilege('neondb_owner', c.oid, 'DELETE')
  ),
  'note', 'استبدل neondb_owner في كتل التحقق باسم دور التطبيق نفسه قبل التشغيل.'
)::text AS finance_grants_check;

-- اختيالي ويحتاج موافقة منفصلة: منع الحذف والتفريغ نهائيًا على جداول المالية.
-- التصحيحات في هذا النظام تُسجَّل بالإضافة فقط، فلا مسوّغ لحذف صف مالي.
-- إن كان دور التطبيق هو المالك نفسه، فهذا هو التقييد الفعّال الوحيد.
-- DO $$
-- DECLARE app_role NAME := 'neondb_owner';
-- BEGIN
--   EXECUTE format('REVOKE DELETE, TRUNCATE ON ALL TABLES IN SCHEMA finance FROM %I', app_role);
-- END $$;
