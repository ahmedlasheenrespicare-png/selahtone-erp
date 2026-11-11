-- اختبار enforcement للمراجعة فقط؛ لا يُشغَّل إلا بموافقة إنتاجية منفصلة.
-- يستخدم selahtone_app الفعلي، ويدرج رابطًا اصطناعيًا واحدًا ثم يختبر منع
-- UPDATE على المحفزات العشرة ومنع DELETE/TRUNCATE. ينتهي بـROLLBACK ولا يترك صفًا.
-- يغيّر SET على عضوية neondb_owner في دور التطبيق مؤقتًا داخل المعاملة فقط؛
-- ROLLBACK يعيد SET=false وINHERIT إلى حالتهما الأصلية. لا تفعيل ولا دليل اتصال Render.
-- sha256: 678ff5ba77a1a0d6e522f15c47cd3dfd27c9fbe56f7561fe6b91766e656269f6
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '3s';

DO $$
BEGIN
 IF current_user <> session_user OR session_user <> 'neondb_owner' THEN
  RAISE EXCEPTION 'finance enforcement: expected neondb_owner with no SET ROLE';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_auth_members m
   JOIN pg_roles granted ON granted.oid=m.roleid
   JOIN pg_roles member ON member.oid=m.member
   WHERE granted.rolname='selahtone_app' AND member.rolname=session_user
     AND m.admin_option AND NOT m.set_option) THEN
  RAISE EXCEPTION 'finance enforcement: expected ADMIN_OPTION=true and SET=false before temporary grant';
 END IF;
 IF to_regclass('finance.request_results') IS NULL THEN
  RAISE EXCEPTION 'finance enforcement: request_results is missing';
 END IF;
 IF EXISTS (SELECT 1 FROM finance.request_results
   WHERE request_id='33333333-3333-4333-8333-333333333333') THEN
  RAISE EXCEPTION 'finance enforcement: fixed probe UUID already exists';
 END IF;
 GRANT selahtone_app TO neondb_owner WITH INHERIT FALSE, SET TRUE;
END $$;

SET LOCAL ROLE selahtone_app;
DO $$
DECLARE actor BIGINT; denied BOOLEAN; tbl TEXT; mutable_column TEXT;
BEGIN
 IF current_user <> 'selahtone_app' OR session_user <> 'neondb_owner' THEN
  RAISE EXCEPTION 'finance enforcement: application role was not selected';
 END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='selahtone_app'
   AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication)) THEN
  RAISE EXCEPTION 'finance enforcement: application role attributes are unsafe';
 END IF;
 SELECT id INTO actor FROM public.users ORDER BY id LIMIT 1;
 IF actor IS NULL THEN
  RAISE EXCEPTION 'finance enforcement: no existing user for the FK-only probe';
 END IF;

 -- مسارا SELECT/INSERT المسموحان. لا توجد كتابة مالية تشغيلية.
 PERFORM count(*) FROM finance.request_results;
 INSERT INTO finance.request_results(request_id,action,actor_id,result_table,result_id)
 VALUES('33333333-3333-4333-8333-333333333333','CONTROLS_PROBE',actor,'requests',1);

 -- كل UPDATE يلغي نفسه في savepoint داخلي؛ لا يمكن أن ينجو تعديل ناجح.
 FOREACH tbl IN ARRAY ARRAY['movements','requests','request_results','audit_events',
  'category_audit','category_requests','expense_corrections','opening_corrections',
  'historical_commerce','reconciliation_notes']
 LOOP
  denied := false;
  BEGIN
   IF tbl = 'request_results' THEN
    UPDATE finance.request_results SET action='MUST_NOT_PERSIST'
    WHERE request_id='33333333-3333-4333-8333-333333333333';
   ELSE
    SELECT a.attname INTO mutable_column FROM pg_attribute a
    WHERE a.attrelid=format('finance.%I',tbl)::regclass
      AND a.attnum>0 AND NOT a.attisdropped AND a.attgenerated='' AND a.attname<>'id'
    ORDER BY a.attnum LIMIT 1;
    IF mutable_column IS NULL THEN
     RAISE EXCEPTION 'finance enforcement: no ordinary mutable column on %',tbl;
    END IF;
    EXECUTE format('UPDATE finance.%I SET %I=%I WHERE false',tbl,mutable_column,mutable_column);
   END IF;
  EXCEPTION WHEN OTHERS THEN
   IF SQLERRM = 'FINANCE_APPEND_ONLY_IMMUTABLE' THEN denied := true;
   ELSE RAISE EXCEPTION 'finance enforcement: unexpected UPDATE error on %: %',tbl,SQLERRM;
   END IF;
  END;
  IF NOT denied THEN
   RAISE EXCEPTION 'finance enforcement: UPDATE was not rejected on %',tbl;
  END IF;
 END LOOP;

 denied := false;
 BEGIN
  DELETE FROM finance.request_results
  WHERE request_id='33333333-3333-4333-8333-333333333333';
 EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE='42501' OR SQLERRM='FINANCE_APPEND_ONLY_IMMUTABLE' THEN denied := true;
  ELSE RAISE EXCEPTION 'finance enforcement: unexpected DELETE error: %',SQLERRM;
  END IF;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'finance enforcement: DELETE was not rejected'; END IF;

 denied := false;
 BEGIN
  TRUNCATE finance.request_results;
 EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE='42501' OR SQLERRM='FINANCE_APPEND_ONLY_IMMUTABLE' THEN denied := true;
  ELSE RAISE EXCEPTION 'finance enforcement: unexpected TRUNCATE error: %',SQLERRM;
  END IF;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'finance enforcement: TRUNCATE was not rejected'; END IF;
END $$;
ROLLBACK;

SELECT jsonb_build_object(
 'status','PASS_APP_ROLE_CONTROLS_ROLLED_BACK',
 'select_allowed',true,
 'insert_allowed',true,
 'append_only_update_denials',10,
 'delete_denied',true,
 'truncate_denied',true,
 'probe_rows_after_rollback',(SELECT count(*)::int FROM finance.request_results
   WHERE request_id='33333333-3333-4333-8333-333333333333'),
 'app_set_option_after_rollback',pg_has_role('neondb_owner','selahtone_app','SET'),
 'finance_enabled_unchanged',true,
 'proof_scope','SQL_EDITOR_APP_ROLE_NOT_DEPLOYED_CONNECTION_NOT_DEFAULT_DENY_OTHER_ROLE'
)::text AS finance_controls_enforcement;
