-- رجوع مستقل عن manual-finance-controls-upgrade.sql — للمراجعة فقط.
-- يزيل السياسات والمحفزات وجدول request_results الفارغ فقط، ولا يحذف صفًا ماليًا.
-- يرفض العمل إذا وُجد أي رابط نتيجة، أو اختلف سجل الترقية/البصمة. لا يغير FINANCE_ENABLED.
-- sha256: bfd2a22620deb37369539b541778457fa877b748c80f0f6591d826a61f6c52be
-- upgrade_sha256: 710bafab25399e44c80e28984028c6691f608362346bb37b8bab318bcde83a75
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '3s';

DO $$
DECLARE recorded CHAR(64);
BEGIN
 IF current_user <> session_user OR session_user <> 'neondb_owner' THEN
  RAISE EXCEPTION 'finance controls rollback: expected neondb_owner with no SET ROLE';
 END IF;
 SELECT checksum INTO recorded FROM finance_release.migrations WHERE name='finance_controls_upgrade';
 IF recorded IS DISTINCT FROM '710bafab25399e44c80e28984028c6691f608362346bb37b8bab318bcde83a75' THEN
  RAISE EXCEPTION 'finance controls rollback: migration checksum mismatch';
 END IF;
 IF has_schema_privilege('selahtone_finance_admin','finance','USAGE') THEN
  RAISE EXCEPTION 'finance controls rollback: unexpected admin USAGE; review before temporary grant';
 END IF;
 GRANT USAGE ON SCHEMA finance TO selahtone_finance_admin;
END $$;
SET LOCAL ROLE selahtone_finance_admin;

DO $$
BEGIN
 IF current_user <> 'selahtone_finance_admin' THEN
  RAISE EXCEPTION 'finance controls rollback: admin role required';
 END IF;
 IF to_regclass('finance.request_results') IS NULL THEN
  RAISE EXCEPTION 'finance controls rollback: request_results is absent';
 END IF;
 IF EXISTS (SELECT 1 FROM finance.request_results) THEN
  RAISE EXCEPTION 'finance controls rollback: request results exist; refusing data loss';
 END IF;
END $$;

DO $$
DECLARE tbl TEXT;
BEGIN
 FOREACH tbl IN ARRAY ARRAY['movements','requests','request_results','audit_events',
  'category_audit','category_requests','expense_corrections','opening_corrections',
  'historical_commerce','reconciliation_notes']
 LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS finance_append_only_guard ON finance.%I',tbl);
 END LOOP;
 FOR tbl IN SELECT c.relname::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='finance' AND c.relkind='r'
 LOOP
  EXECUTE format('DROP POLICY IF EXISTS selahtone_app_all ON finance.%I',tbl);
  EXECUTE format('ALTER TABLE finance.%I DISABLE ROW LEVEL SECURITY',tbl);
 END LOOP;
END $$;
DROP FUNCTION finance.append_only_guard();
DROP TABLE finance.request_results;
RESET ROLE;
DELETE FROM finance_release.migrations WHERE name='finance_controls_upgrade';
REVOKE USAGE ON SCHEMA finance FROM selahtone_finance_admin;

SELECT jsonb_build_object(
 'status','CONTROLS_ROLLED_BACK_FINANCE_STILL_DISABLED',
 'request_results_present',to_regclass('finance.request_results') IS NOT NULL,
 'rls_enabled',(SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='finance' AND c.relkind='r' AND c.relrowsecurity),
 'policies',(SELECT count(*)::int FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='finance'),
 'user_triggers',(SELECT count(*)::int FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='finance' AND NOT t.tgisinternal)
)::text AS finance_controls_rollback;
COMMIT;
