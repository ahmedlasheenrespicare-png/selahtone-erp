-- فحص ما بعد ترقية المالية — قراءة فقط، ولا يصلح أو يكمل ترقية ناقصة.
-- يُشغّل بعد تثبيت ترقية المالية المراجَعة، وقبل فتح المالية للمستخدمين. شغّل
-- الملف كله دفعة واحدة في Neon SQL Editor، ثم شارك عمود
-- finance_release_postflight فقط. يقارن المراجع بين هذا العمود وعمود
-- finance_release_preflight: يجب أن تتطابق البصمات والأعداد القديمة تمامًا.
-- إذا فشل بعبارة "relation does not exist" فالمخطط غير مثبت أو ناقص: أوقف
-- العمل ولا تُكمل التثبيت يدويًا. لا يثبت الفحص صلاحيات دور التطبيق أو أن
-- التطبيق يستخدم القاعدة نفسها؛ دور الفحص هنا هو دور SQL Editor فقط.
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
), finance_tables AS (
  SELECT c.relname::text AS name
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='finance' AND c.relkind='r'
), finance_foreign_keys AS (
  SELECT count(*)::integer AS n
  FROM pg_catalog.pg_constraint con
  JOIN pg_catalog.pg_class src ON src.oid=con.conrelid
  JOIN pg_catalog.pg_namespace ns ON ns.oid=src.relnamespace
  WHERE con.contype='f' AND ns.nspname='finance'
), finance_deferred_triggers AS (
  SELECT count(*)::integer AS n
  FROM pg_catalog.pg_trigger t
  JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='finance' AND NOT t.tgisinternal AND t.tgdeferrable
), finance_rls_tables AS (
  SELECT count(*)::integer AS n
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='finance' AND c.relkind='r' AND c.relrowsecurity
), legacy_user_triggers AS (
  SELECT count(*)::integer AS n
  FROM pg_catalog.pg_trigger t
  JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND NOT t.tgisinternal
    AND c.relname IN ('expenses','expense_categories','journal_entries')
)
SELECT jsonb_build_object(
  'checked_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'database', current_database(),
  'server_version', current_setting('server_version'),
  'inspection_role', current_user::text,
  'inspection_role_only', true,
  'migration_ledger', (SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM finance_release.migrations x),
  'finance_tables', (SELECT COALESCE(jsonb_agg(name ORDER BY name), '[]'::jsonb) FROM finance_tables),
  'finance_table_count', (SELECT count(*) FROM finance_tables),
  'finance_row_counts', jsonb_build_object(
    'accounts', (SELECT count(*) FROM finance.accounts),
    'cash_counts', (SELECT count(*) FROM finance.cash_counts),
    'expenses', (SELECT count(*) FROM finance.expenses),
    'payments', (SELECT count(*) FROM finance.payments),
    'expense_reviews', (SELECT count(*) FROM finance.expense_reviews),
    'expense_corrections', (SELECT count(*) FROM finance.expense_corrections),
    'opening_corrections', (SELECT count(*) FROM finance.opening_corrections),
    'historical_commerce', (SELECT count(*) FROM finance.historical_commerce),
    'reconciliation_cases', (SELECT count(*) FROM finance.reconciliation_cases),
    'reconciliation_notes', (SELECT count(*) FROM finance.reconciliation_notes),
    'movements', (SELECT count(*) FROM finance.movements),
    'requests', (SELECT count(*) FROM finance.requests),
    'audit_events', (SELECT count(*) FROM finance.audit_events)
  ),
  'finance_foreign_keys', (SELECT n FROM finance_foreign_keys),
  'finance_deferred_triggers', (SELECT n FROM finance_deferred_triggers),
  'finance_rls_tables', (SELECT n FROM finance_rls_tables),
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
  'legacy_user_triggers', (SELECT n FROM legacy_user_triggers),
  'note', 'يجب أن تتطابق الأعداد والبصمات القديمة مع نتيجة فحص ما قبل الترقية؛ وأي فرق يعني إيقاف العمل ومراجعته.'
)::text AS finance_release_postflight;

ROLLBACK;
