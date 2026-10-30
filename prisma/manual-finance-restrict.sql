-- ⚠️ مؤرشف — غير فعّال على Neon مع الدور الحالي (2026-10-30)، ومحفوظ للتوثيق فقط.
--   السحب طُبِّق على مستوى ACL (neondb_owner=arwxtm بلا d/D) لكنه بلا أثر، لأن الدور
--   يرث pg_write_all_data عبر عضوية يديرها Neon في neon_superuser. ولا يمكن سحب تلك
--   العضوية (لا ADMIN OPTION) ولا SET ROLE إلى neon_superuser (ممنوع من Neon).
--   أُعيدت القاعدة إلى حالتها الأصلية: prisma/manual-finance-restrict-rollback.sql
--   المسار الفعّال الوحيد: دور تطبيق منفصل + تغيير DATABASE_URL (راجع سجل الإصدار قسم ١١).

-- تقييد دور التطبيق على مخطط finance — ملف يدوي، لا يُشغَّل إلا بموافقة منفصلة.
--
-- السياق (من فحص 2026-10-30T15:13:18Z على production/neondb):
--   * مالك كل جداول مخطط finance هو neondb_owner، وهو دور الفحص نفسه.
--   * أدوار القاعدة: cloud_admin وneon_service وneon_superuser وneondb_owner وtoken_roles.
--   * جدول finance = 16 جدولًا، وكلها تملك SELECT/INSERT/UPDATE/DELETE، ولا RLS على أي منها.
--   * لا قيود مؤجلة، ولا جداول مرفقات.
--
-- النتيجة العملية: إن كان التطبيق يتصل بالدور نفسه (وهو الظاهر حتى الآن) فالمنح تحصيل
-- حاصل، ولا يبقى إلا التقييد. هذا الملف **يسحب الحذف والتفريغ فقط**؛ لأن تصحيحات
-- المالية تُسجَّل بالإضافة فقط، ولا يوجد أي مسار حذف في كود التطبيق
-- (فحصنا: لا DELETE/TRUNCATE على مخطط finance في src/).
--
-- حدود أمنية مهمة تُقرأ قبل الموافقة:
--   * المالك يستطيع دائمًا إعادة منح الصلاحية لنفسه، فهذا الملف **حاجز ضد أخطاء
--     الكود** لا حد أمام مهاجم يملك دور المالك أو يستطيع تنفيذ SQL به.
--   * لا يسحب CREATE على المخطط: ملفات الترقية اليدوية تحتاجه لإنشاء الجداول.
--   * لا يفعّل RLS، ولا يغيّر الملكية، ولا يمس جداول البيع والمخزون في public.
--
-- تأكيد دور التطبيق (2026-10-30، فحص pg_stat_activity بعد فتح الموقع):
--   * neondb_owner من neon-internal-sql-editor (جلسة الفحص نفسها)
--   * neondb_owner من 127.0.0.1 عبر pgbouncer (اتصال التطبيق المجمَّع)
--   أي أن التطبيق يتصل بدور neondb_owner نفسه، فلا حاجة لأي تبديل اسم.
--
-- التشغيل: شغّل الملف كله دفعة واحدة في Neon SQL Editor على الفرع production
-- والقاعدة neondb. التراجع عند الحاجة:
--   GRANT DELETE, TRUNCATE ON ALL TABLES IN SCHEMA finance TO neondb_owner;
DO $$
DECLARE app_role NAME := 'neondb_owner';  -- مؤكَّد بفحص pg_stat_activity
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = app_role) THEN
    RAISE EXCEPTION 'الدور % غير موجود في هذه القاعدة.', app_role;
  END IF;
  IF to_regnamespace('finance') IS NULL THEN
    RAISE EXCEPTION 'مخطط finance غير مثبت؛ شغّل ترقية المالية أولًا.';
  END IF;

  EXECUTE format('REVOKE DELETE, TRUNCATE ON ALL TABLES IN SCHEMA finance FROM %I', app_role);
  -- أي جدول يُنشأ لاحقًا في المخطط (بترقية مراجَعة) يولد بلا صلاحية حذف.
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA finance REVOKE DELETE, TRUNCATE ON TABLES FROM %I', app_role);
END $$;

-- تحقق بعد التنفيذ: يجب أن تكون القائمتان الأوليان فارغتين، والثالثة فارغة كذلك.
SELECT jsonb_build_object(
  'restricted_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'restricted_by', current_user::text,
  'database', current_database(),
  'finance_table_count', (
    SELECT count(*)::int FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
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
  'note', 'المطلوب: tables_with_delete=[] مع بقاء القراءة والكتابة كاملتين.'
)::text AS finance_restrict_check;
