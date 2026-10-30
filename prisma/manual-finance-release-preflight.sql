-- فحص ما قبل ترقية المالية — قراءة فقط، وليس ترقية ولا إنشاء أي كائن.
-- شغّل الملف كله دفعة واحدة في Neon SQL Editor بعد اختيار الفرع وقاعدة البيانات،
-- ثم شارك عمود finance_release_preflight فقط. لا تُلصقه في Terminal، ولا تشارك
-- روابط اتصال أو كلمات مرور. المعاملة للقراءة فقط وتُغلق بـROLLBACK تلقائيًا.
-- يعرض أعدادًا وبصمات مجمّعة فقط: لا أسماء عملاء، ولا أرقام سيريال، ولا مبالغ،
-- ولا أوصاف مصروفات. البصمة تتيح مقارنة ما قبل الترقية بما بعدها دون كشف المحتوى.
-- لا يثبت هذا الفحص أن التطبيق يستخدم القاعدة نفسها أو أن دوره يملك الصلاحيات؛
-- دور الفحص هنا هو دور SQL Editor فقط. إذا كان RLS نشطًا فقد تُحجب صفوف عنه،
-- فلا تُفسَّر الأعداد على أنها أصفار مؤكدة.
BEGIN TRANSACTION READ ONLY;

WITH category_digest AS (
  SELECT md5(COALESCE(string_agg(id || '|' || code || '|' || name_ar || '|' || is_active::text, '#' ORDER BY id), '')) AS value
  FROM public.expense_categories
), expense_digest AS (
  SELECT md5(COALESCE(string_agg(id || '|' || branch_id || '|' || category_id || '|' || amount::text || '|' || expense_date || '|' || status, '#' ORDER BY id), '')) AS value
  FROM public.expenses
), journal_digest AS (
  SELECT md5(COALESCE(string_agg(id || '|' || entry_no || '|' || entry_date || '|' || source_type || '|' || source_id, '#' ORDER BY id), '')) AS value
  FROM public.journal_entries
), required AS (
  SELECT obj, to_regclass(obj) IS NOT NULL AS present
  FROM (VALUES ('public.branches'),('public.users'),('public.expense_categories'),
               ('public.expenses'),('public.journal_entries')) AS v(obj)
), category_columns AS (
  SELECT string_agg(column_name || ':' || data_type, ', ' ORDER BY ordinal_position) AS value
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='expense_categories'
), conflicting_public_names AS (
  SELECT c.relname::text AS name, c.relkind::text AS kind
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m') AND c.relname IN (
    'accounts','payments','movements','cash_counts','opening_corrections',
    'historical_commerce','reconciliation_cases','reconciliation_notes',
    'expense_corrections','expense_reviews','requests','audit_events','category_revisions')
), finance_namespaces AS (
  SELECT nspname::text AS name FROM pg_catalog.pg_namespace
  WHERE nspname IN ('finance','finance_release','finance_lab','finance_core','finance_candidate')
), legacy_foreign_keys AS (
  SELECT src.relname::text AS source_table, dst.relname::text AS referenced_table
  FROM pg_catalog.pg_constraint con
  JOIN pg_catalog.pg_class dst ON dst.oid=con.confrelid
  JOIN pg_catalog.pg_class src ON src.oid=con.conrelid
  JOIN pg_catalog.pg_namespace ns ON ns.oid=src.relnamespace
  WHERE con.contype='f' AND ns.nspname='public'
    AND dst.relname IN ('expenses','expense_categories','journal_entries')
)
SELECT jsonb_build_object(
  'checked_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'database', current_database(),
  'server_version', current_setting('server_version'),
  'inspection_role', current_user::text,
  'inspection_role_can_create_schema', pg_catalog.has_database_privilege(current_user, current_database(), 'CREATE'),
  'inspection_role_only', true,
  'required_objects', (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.obj), '[]'::jsonb) FROM required x),
  'missing_required_objects', (SELECT COALESCE(jsonb_agg(x.obj ORDER BY x.obj), '[]'::jsonb) FROM required x WHERE NOT x.present),
  'expense_categories_columns', (SELECT value FROM category_columns),
  'legacy_counts', jsonb_build_object(
    'expense_categories', (SELECT count(*) FROM public.expense_categories),
    'expenses', (SELECT count(*) FROM public.expenses),
    'journal_entries', (SELECT count(*) FROM public.journal_entries)
  ),
  'legacy_digests', jsonb_build_object(
    'expense_categories', (SELECT value FROM category_digest),
    'expenses', (SELECT value FROM expense_digest),
    'journal_entries', (SELECT value FROM journal_digest)
  ),
  'finance_namespaces', (SELECT COALESCE(jsonb_agg(name ORDER BY name), '[]'::jsonb) FROM finance_namespaces),
  'conflicting_public_names', (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.name), '[]'::jsonb) FROM conflicting_public_names x),
  'legacy_foreign_keys', (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.referenced_table,x.source_table), '[]'::jsonb) FROM legacy_foreign_keys x),
  'note', 'البصمات والأعداد تخص دور الفحص ولحظة تشغيله فقط، وقد تحجبها سياسات RLS.'
)::text AS finance_release_preflight;

ROLLBACK;
