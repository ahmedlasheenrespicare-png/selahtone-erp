-- ترقية إضافة نطاق القائمة لكل مستخدم — ملف يدوي، لا يُشغَّل إلا بموافقة منفصلة.
--
-- لماذا أولًا: الكود الذي يقرأ هذا العمود لا يُنشر إلا بعد تشغيل هذا الملف، لأن برisma
-- يختار العمود في كل استعلام مستخدم؛ وتشغيله قبل النشر يجعل الترقية بلا أي توقف.
--
-- ما يفعله: إضافة عمود واحد بقيمة افتراضية، وقيد تحقق بقيمتين فقط. لا يعدّل أي صف،
-- ولا يغيّر الأدوار أو الصلاحيات، ولا يمس جداول البيع أو المخزون أو المالية.
--
-- التراجع (عند الحاجة فقط):
--   ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_menu_scope_check;
--   ALTER TABLE public.users DROP COLUMN IF EXISTS menu_scope;

BEGIN;

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS menu_scope varchar(16) NOT NULL DEFAULT 'FULL';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_menu_scope_check' AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_menu_scope_check CHECK (menu_scope IN ('FULL', 'LIMITED'));
  END IF;
END $$;

COMMIT;

-- تحقق بعد التنفيذ: column_exists = 1، وcheck_constraint = 1، وكل القيم FULL.
SELECT jsonb_build_object(
  'checked_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'database', current_database(),
  'column_exists', (
    SELECT count(*)::int FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'menu_scope'),
  'column_default', (
    SELECT column_default FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'menu_scope'),
  'check_constraint', (
    SELECT count(*)::int FROM pg_constraint
    WHERE conname = 'users_menu_scope_check' AND conrelid = 'public.users'::regclass),
  'users_total', (SELECT count(*)::int FROM public.users),
  'values', (
    SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM (
      SELECT menu_scope, count(*)::int AS users FROM public.users GROUP BY 1 ORDER BY 1
    ) x)
)::text AS menu_scope_upgrade;
