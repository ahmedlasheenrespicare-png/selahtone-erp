-- مرشح ضوابط المالية — للمراجعة فقط؛ لا يُشغَّل إلا بموافقة SQL إنتاجية منفصلة.
-- يطابق الجرد المنشور 2026-11-11T02:39:41.168Z: 18 جدولًا، بلا RLS/سياسات/محفزات،
-- وrequest_results غير موجود. لا يرحّل طلبات قديمة ولا يملأ روابطها اصطناعيًا.
-- يضيف request_results، وRLS بمنع افتراضي مع سياسة لدور التطبيق وحده، ومحفزات
-- منع UPDATE/DELETE/TRUNCATE على السجلات المحددة أدناه. لا يفعل FINANCE_ENABLED.
-- sha256: fbad5e09bc5ba66658407e2c4876180c15c602f6fa91b8a9d887a8aeae22cb02
--
-- التنفيذ المستقبلي: الملف كاملًا في Neon SQL Editor داخل نافذة متفق عليها.
-- يعمل بدور SQL Editor neondb_owner الذي ثبت أنه يملك USAGE/CREATE ويرث الإدارة.
-- لا SET ROLE ولا منح مؤقت؛ ينقل ملكية الكائنات الجديدة للإدارة صراحةً.
-- إعادة التشغيل مرفوضة؛ الرجوع له ملف مستقل ولا يعمل إذا احتوى request_results على صفوف.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '3s';

DO $$
DECLARE actual TEXT[]; expected CONSTANT TEXT[] := ARRAY[
 'accounts','audit_events','cash_counts','category_audit','category_requests','category_revisions',
 'custody_requests','expense_corrections','expense_reviews','expenses','historical_commerce',
 'movements','opening_corrections','payments','reconciliation_cases','reconciliation_notes',
 'requests','settlements'
];
BEGIN
 IF NOT pg_has_role(session_user,'selahtone_finance_admin','MEMBER') THEN
  RAISE EXCEPTION 'finance controls: session_user lacks the finance admin role';
 END IF;
 IF current_user <> session_user OR session_user <> 'neondb_owner'
    OR NOT has_schema_privilege(session_user,'finance','USAGE')
    OR NOT has_schema_privilege(session_user,'finance','CREATE') THEN
  RAISE EXCEPTION 'finance controls: expected neondb_owner with USAGE and CREATE and no SET ROLE';
 END IF;
 IF to_regclass('finance_release.migrations') IS NULL THEN
  RAISE EXCEPTION 'finance controls: migration ledger is missing';
 END IF;
 IF EXISTS (SELECT 1 FROM finance_release.migrations WHERE name='finance_controls_upgrade') THEN
  RAISE EXCEPTION 'finance controls: already applied; do not replay';
 END IF;
 IF to_regclass('finance.request_results') IS NOT NULL THEN
  RAISE EXCEPTION 'finance controls: request_results already exists; review instead of overwriting';
 END IF;
 SELECT array_agg(c.relname::text ORDER BY c.relname) INTO actual
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='finance' AND c.relkind='r';
 IF actual IS DISTINCT FROM expected THEN
  RAISE EXCEPTION 'finance controls: expected the observed 18-table schema, found %',actual;
 END IF;
 IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='finance' AND pg_get_userbyid(c.relowner)<>'selahtone_finance_admin') THEN
  RAISE EXCEPTION 'finance controls: finance ownership differs from the observed baseline';
 END IF;
 IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='finance' AND c.relkind='r' AND (c.relrowsecurity OR c.relforcerowsecurity)) THEN
  RAISE EXCEPTION 'finance controls: RLS already enabled; review existing controls first';
 END IF;
 IF EXISTS (SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
   JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='finance') THEN
  RAISE EXCEPTION 'finance controls: policies already exist; review them first';
 END IF;
 IF EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
   JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='finance' AND NOT t.tgisinternal) THEN
  RAISE EXCEPTION 'finance controls: user triggers already exist; review them first';
 END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='selahtone_app'
   AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication OR NOT rolcanlogin)) THEN
  RAISE EXCEPTION 'finance controls: application role attributes are unsafe';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='selahtone_app') THEN
  RAISE EXCEPTION 'finance controls: selahtone_app is missing';
 END IF;
 IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='finance' AND c.relkind='r' AND (
    NOT has_table_privilege('selahtone_app',c.oid,'SELECT') OR
    NOT has_table_privilege('selahtone_app',c.oid,'INSERT') OR
    NOT has_table_privilege('selahtone_app',c.oid,'UPDATE') OR
    has_table_privilege('selahtone_app',c.oid,'DELETE') OR
    has_table_privilege('selahtone_app',c.oid,'TRUNCATE'))) THEN
  RAISE EXCEPTION 'finance controls: application table privileges differ from the observed baseline';
 END IF;
END $$;

-- الروابط الجديدة فقط. الطلبات القديمة بلا رابط تبقى مرفوضة ولا تُخمن نتائجها.
-- ينشئ neondb_owner الجدول والـFK والمنح ثم ينقل الملكية للإدارة بلا تبديل دور.
DO $$
BEGIN
 CREATE TABLE finance.request_results (
  request_id UUID PRIMARY KEY,
  action VARCHAR(40) NOT NULL,
  actor_id BIGINT NOT NULL REFERENCES public.users(id),
  result_table VARCHAR(64) NOT NULL,
  result_id BIGINT NOT NULL CHECK (result_id > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
 );
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'FINANCE_STAGE_CREATE_REQUEST_RESULTS: %',SQLERRM;
END $$;
DO $$
BEGIN
 REVOKE ALL ON finance.request_results FROM PUBLIC;
 GRANT SELECT,INSERT,UPDATE ON finance.request_results TO selahtone_app;
 ALTER TABLE finance.request_results OWNER TO selahtone_finance_admin;
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'FINANCE_STAGE_REQUEST_RESULTS_ACL_OWNER: %',SQLERRM;
END $$;

-- هذه ليست عزلة فروع؛ التطبيق يحتاج كل الصفوف ويقرر صلاحية المستخدم داخل معاملته.
-- RLS يضيف منعًا افتراضيًا لأي دور غير مالك حتى لو مُنح ACL بالخطأ مستقبلًا.
-- لا FORCE: دور الإدارة المالك يحتاج الصيانة، بينما selahtone_app غير مالك وبلا BYPASSRLS.
DO $$
DECLARE tbl TEXT;
BEGIN
 FOR tbl IN SELECT c.relname::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='finance' AND c.relkind='r' ORDER BY c.relname
 LOOP
  EXECUTE format('ALTER TABLE finance.%I ENABLE ROW LEVEL SECURITY',tbl);
  EXECUTE format('CREATE POLICY selahtone_app_all ON finance.%I FOR ALL TO selahtone_app USING (true) WITH CHECK (true)',tbl);
 END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'FINANCE_STAGE_RLS_POLICIES: %',SQLERRM;
END $$;

-- الجداول ذات التاريخ الذي لا يجوز تعديله أو محوه؛ بقية الجداول لها تحديثات مشروعة.
DO $$
BEGIN
 EXECUTE $function$CREATE FUNCTION finance.append_only_guard() RETURNS trigger
 LANGUAGE plpgsql AS $body$
 BEGIN
  RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='FINANCE_APPEND_ONLY_IMMUTABLE';
 END $body$ $function$;
 EXECUTE 'ALTER FUNCTION finance.append_only_guard() OWNER TO selahtone_finance_admin';
 EXECUTE 'REVOKE ALL ON FUNCTION finance.append_only_guard() FROM PUBLIC';
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'FINANCE_STAGE_APPEND_ONLY_FUNCTION: %',SQLERRM;
END $$;

DO $$
DECLARE tbl TEXT;
BEGIN
 FOREACH tbl IN ARRAY ARRAY['movements','requests','request_results','audit_events',
  'category_audit','category_requests','expense_corrections','opening_corrections',
  'historical_commerce','reconciliation_notes']
 LOOP
  EXECUTE format('CREATE TRIGGER finance_append_only_guard BEFORE UPDATE OR DELETE OR TRUNCATE ON finance.%I FOR EACH STATEMENT EXECUTE FUNCTION finance.append_only_guard()',tbl);
 END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'FINANCE_STAGE_APPEND_ONLY_TRIGGERS: %',SQLERRM;
END $$;

DO $$
BEGIN
 INSERT INTO finance_release.migrations(name,checksum)
 VALUES('finance_controls_upgrade','fbad5e09bc5ba66658407e2c4876180c15c602f6fa91b8a9d887a8aeae22cb02');
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'FINANCE_STAGE_MIGRATION_LEDGER: %',SQLERRM;
END $$;

SELECT jsonb_build_object(
 'status','CONTROLS_INSTALLED_NOT_AN_APPLICATION_ACTIVATION',
 'finance_enabled_unchanged',true,
 'tables',(SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='finance' AND c.relkind='r'),
 'rls_enabled',(SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='finance' AND c.relkind='r' AND c.relrowsecurity),
 'policies',(SELECT count(*)::int FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='finance'),
 'append_only_triggers',(SELECT count(*)::int FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='finance' AND NOT t.tgisinternal),
 'request_results_rows',(SELECT count(*)::int FROM finance.request_results)
)::text AS finance_controls_upgrade;
COMMIT;
