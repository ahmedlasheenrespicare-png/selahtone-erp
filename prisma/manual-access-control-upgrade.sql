-- ترقية جدول التحكم الكامل بالصلاحيات (الصفحات + العناصر الداخلية + مفتاح الكتابة) — ملف يدوي، لا يُشغَّل إلا بموافقة منفصلة.
--
-- لماذا أولًا: الكود الجديد يقرأ هذا الجدول في كل طلب لأي صفحة داخل مساحة العمل؛
-- وتشغيله قبل النشر ضروري لتفادي انقطاع الوصول. بدون الجدول أو عند فشل قراءته،
-- تُمنع الصفحات والعناصر والإجراءات المقيّدة لغير أدمن النظام، وتظهر لوحة آمنة وتنبيه.
--
-- ما يفعله: إنشاء جدول public.access_control فقط. لا يعدّل أي صف، ولا يغيّر الأدوار
-- أو الصلاحيات الحالية، ولا يمس menu_scope (يبقى قائمًا للتوافق الخلفي فقط)،
-- ولا يمس جداول البيع أو المخزون أو المالية.
--
-- كيف تُقرأ الصفوف:
--   subject_kind='role' → قالب دور ('MANAGER' | 'ACCOUNTANT' | 'CS_AGENT'): يسري على كل حساباته.
--   subject_kind='user' → استثناء لحساب بعينه (قيمة user.id::text): يعلو قالب الدور في الاتجاهين.
--   key                → مفتاح تدفق: '/sales/new' (الصفحة)، '/sales/new#write' (مفتاح الكتابة)،
--                        '/dashboard#part-wallet' (عنصر داخلي)…
--   allowed=false      → ممنوع. allowed=true → مسموح (يمحى به منع القالب الدور للحساب).
--
-- الافتراضي بلا صفوف: كل شيء مسموح لكل الأدوار (قالب جاهز = الوضع الحالي) — يشغّل الأدمن الترقية ثم يشدّد ما يريد.
--
-- التراجع عن الجدول فقط بعد إعادة الكود المتوافق السابق والتحقق منه وبموافقة منفصلة؛
-- حذف الجدول مع الكود الحالي يمنع الوصول المقيّد لغير الأدمن ولا يعيد التشغيل الطبيعي:
--   (راجع خطة الانتقال والتراجع قبل أي تنفيذ فعلي.)
-- مثال إزالة الجدول، وليس تعليمات تشغيل فورية:
--   DROP INDEX IF EXISTS public.access_control_key;
--   DROP TABLE IF EXISTS public.access_control;

BEGIN;

CREATE TABLE IF NOT EXISTS public.access_control (
  subject_kind varchar(8)  NOT NULL CHECK (subject_kind IN ('role', 'user')),
  subject      varchar(64) NOT NULL,
  key          varchar(130) NOT NULL,
  allowed      boolean     NOT NULL,
  updated_by   varchar(64),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subject_kind, subject, key)
);

CREATE INDEX IF NOT EXISTS access_control_key ON public.access_control (key);

COMMIT;

-- تحقق بعد التنفيذ: table_exists = 1، وrows_total = عدد الاستثناءات المطبّقة (افتراضيًا ٠).
SELECT jsonb_build_object(
  'checked_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'database', current_database(),
  'table_exists', (
    SELECT count(*)::int FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'access_control'),
  'key_lengths_ok', (
    SELECT count(*)::int FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'access_control' AND column_name = 'key' AND character_maximum_length >= 130),
  'rows_total', (SELECT count(*)::int FROM public.access_control),
  'rows_by_kind', (
    SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM (
      SELECT subject_kind, count(*)::int AS rows FROM public.access_control GROUP BY 1 ORDER BY 1
    ) x)
)::text AS access_control_upgrade;
