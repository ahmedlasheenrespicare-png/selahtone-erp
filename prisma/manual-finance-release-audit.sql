-- فحص قراءة فقط للتحضير المالي؛ ليس ترقية ولا ينشئ بيانات أو جداول.
-- مخصص للقاعدة التي يختارها المسؤول في Neon SQL Editor بعد مراجعة الاستعلام.
-- يعرض أعدادًا مجمعة وأسماء كائنات المخطط فقط؛ لا يعرض أسماء العملاء أو
-- أرقام السيريال أو وصف المصروفات أو أي مبالغ. لا يثبت أن التطبيق يستخدم
-- نفس القاعدة أو أن حساب التطبيق يملك الصلاحيات المذكورة.
-- إذا كان RLS نشطًا فقد تكون الأعداد محجوبة عن دور الفحص؛ لا تُفسَّر كأصفار مؤكدة.
-- يتوقع وجود جداول البيع والمصروفات القديمة التي ظهرت في الفحص السابق؛
-- إذا فشل لغياب جدول أو صلاحية، أوقف العمل وراجع النتيجة، ولا تنشئ جدولًا.
-- شغّل الملف كله معًا؛ معاملته للقراءة فقط وتُغلق دون حفظ أي تغيير.
BEGIN TRANSACTION READ ONLY;

WITH relevant AS (
  SELECT c.oid, n.nspname::text AS schema_name, c.relname::text AS table_name,
         c.relkind::text AS kind, c.relrowsecurity, c.relforcerowsecurity
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname IN (
    'branches','users','expenses','expense_categories','journal_entries',
    'commerce_sales','commerce_collections','commerce_refunds'
  ) AND c.relkind IN ('r','p')
), capabilities AS (
  SELECT schema_name,table_name,kind,relrowsecurity,relforcerowsecurity,
         pg_catalog.row_security_active(oid) AS row_security_active_for_inspector,
         pg_catalog.has_table_privilege(current_user,oid,'SELECT') AS can_select,
         pg_catalog.has_table_privilege(current_user,oid,'INSERT') AS can_insert,
         pg_catalog.has_table_privilege(current_user,oid,'UPDATE') AS can_update,
         pg_catalog.has_table_privilege(current_user,oid,'DELETE') AS can_delete
  FROM relevant
), user_triggers AS (
  SELECT r.schema_name,r.table_name,t.tgname::text AS trigger_name,t.tgenabled::text AS enabled,
         (t.tgtype & 1)<>0 AS row_level,
         (t.tgtype & 4)<>0 AS on_insert,
         (t.tgtype & 8)<>0 AS on_delete,
         (t.tgtype & 16)<>0 AS on_update,
         (t.tgtype & 32)<>0 AS on_truncate
  FROM relevant r JOIN pg_catalog.pg_trigger t ON t.tgrelid=r.oid
  WHERE NOT t.tgisinternal
), incoming_foreign_keys AS (
  SELECT ns.nspname::text AS source_schema, src.relname::text AS source_table,
         dst.table_name AS referenced_table, con.conname::text AS constraint_name
  FROM relevant dst
  JOIN pg_catalog.pg_constraint con ON con.confrelid=dst.oid AND con.contype='f'
  JOIN pg_catalog.pg_class src ON src.oid=con.conrelid
  JOIN pg_catalog.pg_namespace ns ON ns.oid=src.relnamespace
  WHERE dst.table_name IN ('expenses','expense_categories','journal_entries')
), dependent_views AS (
  SELECT DISTINCT ns.nspname::text AS view_schema,v.relname::text AS view_name,
         v.relkind::text AS view_kind,dst.table_name AS referenced_table
  FROM relevant dst
  JOIN pg_catalog.pg_depend d ON d.refobjid=dst.oid AND d.classid='pg_catalog.pg_rewrite'::regclass
  JOIN pg_catalog.pg_rewrite rw ON rw.oid=d.objid
  JOIN pg_catalog.pg_class v ON v.oid=rw.ev_class AND v.relkind IN ('v','m')
  JOIN pg_catalog.pg_namespace ns ON ns.oid=v.relnamespace
  WHERE dst.table_name IN ('expenses','expense_categories','journal_entries')
    AND ns.nspname NOT IN ('pg_catalog','information_schema')
), existing_finance_namespaces AS (
  SELECT nspname::text AS name FROM pg_catalog.pg_namespace
  WHERE nspname IN ('finance','finance_lab','finance_core')
), existing_public_finance_objects AS (
  SELECT c.relname::text AS name,c.relkind::text AS kind
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname LIKE 'finance\_%' ESCAPE '\'
    AND c.relkind IN ('r','p','v','m','f')
)
SELECT jsonb_build_object(
  'database',current_database(),
  'current_schema',current_schema(),
  'inspection_role_can_create_schema',pg_catalog.has_database_privilege(current_user,current_database(),'CREATE'),
  'inspection_role_only',true,
  'objects',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.table_name),'[]'::jsonb) FROM capabilities x),
  'existing_finance_namespaces',(SELECT COALESCE(jsonb_agg(name ORDER BY name),'[]'::jsonb) FROM existing_finance_namespaces),
  'existing_public_finance_objects',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.name),'[]'::jsonb) FROM existing_public_finance_objects x),
  'user_triggers',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.table_name,x.trigger_name),'[]'::jsonb) FROM user_triggers x),
  'incoming_legacy_foreign_keys',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.referenced_table,x.source_schema,x.source_table,x.constraint_name),'[]'::jsonb) FROM incoming_foreign_keys x),
  'dependent_legacy_views',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.referenced_table,x.view_schema,x.view_name),'[]'::jsonb) FROM dependent_views x),
  'legacy_counts',jsonb_build_object(
    'expenses',(SELECT count(*) FROM public.expenses),
    'expense_categories',(SELECT count(*) FROM public.expense_categories),
    'journal_entries',(SELECT count(*) FROM public.journal_entries)
  ),
  'commerce_counts',jsonb_build_object(
    'sales',(SELECT count(*) FROM public.commerce_sales),
    'collections',(SELECT count(*) FROM public.commerce_collections),
    'cash_collections',(SELECT count(*) FROM public.commerce_collections WHERE method='CASH'),
    'refunds',(SELECT count(*) FROM public.commerce_refunds),
    'cash_refunds',(SELECT count(*) FROM public.commerce_refunds WHERE method='CASH')
  )
)::text AS finance_release_audit;

ROLLBACK;
