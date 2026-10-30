-- TEST-ONLY CUTOVER EXPERIMENT. NEVER RUN ON NEON OR A BUSINESS DATABASE.
-- The roles, protected objects and finance schema below are fictional fixtures.
-- Install ONLY inside a transaction on a fresh disposable local PostgreSQL.
-- This is neither an approved migration nor a production security boundary.
DO $$
BEGIN
  IF current_setting('selahtone.finance_cutover_test_only',true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'finance cutover experiment requires an opted-in disposable database';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='cutover_legacy_test' AND rolcanlogin AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls)
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='cutover_new_test' AND rolcanlogin AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls)
    OR pg_catalog.pg_has_role('cutover_legacy_test','cutover_new_test','MEMBER')
    OR pg_catalog.pg_has_role('cutover_new_test','cutover_legacy_test','MEMBER') THEN
    RAISE EXCEPTION 'two separate, restricted fixture login roles are required';
  END IF;
END $$;

CREATE SCHEMA finance_cutover_test;
REVOKE ALL ON SCHEMA finance_cutover_test FROM PUBLIC;
CREATE TABLE finance_cutover_test.control (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  phase VARCHAR(8) NOT NULL CHECK (phase IN ('LEGACY','FROZEN','NEW')),
  revision INTEGER NOT NULL CHECK (revision > 0),
  legacy_login NAME NOT NULL,
  new_login NAME NOT NULL,
  ever_new BOOLEAN NOT NULL DEFAULT FALSE,
  CHECK (legacy_login <> new_login),
  CHECK (phase <> 'NEW' OR ever_new)
);
INSERT INTO finance_cutover_test.control(singleton,phase,revision,legacy_login,new_login)
 VALUES(TRUE,'LEGACY',1,'cutover_legacy_test','cutover_new_test');

CREATE TABLE finance_cutover_test.transitions (
  request_id UUID PRIMARY KEY,
  actor NAME NOT NULL,
  previous_phase VARCHAR(8) NOT NULL,
  next_phase VARCHAR(8) NOT NULL,
  expected_revision INTEGER NOT NULL,
  result_revision INTEGER NOT NULL UNIQUE,
  reason VARCHAR(300) NOT NULL CHECK (length(btrim(reason))>0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
-- One capability belongs to a transaction and backend, not a browser, user,
-- connection pool, custom GUC, or application_name. This private row is deleted
-- by the deferred trigger before commit, or rolls back with the transaction.
CREATE TABLE finance_cutover_test.account_locks (account_id BIGINT PRIMARY KEY,revision BIGINT NOT NULL DEFAULT 1);
CREATE TABLE finance_cutover_test.event_locks (
  event_type VARCHAR(12) NOT NULL CHECK (event_type IN ('COLLECTION','REFUND')),
  event_id BIGINT NOT NULL,revision BIGINT NOT NULL DEFAULT 1,
  PRIMARY KEY (event_type,event_id)
);
CREATE TABLE finance_cutover_test.transaction_permits (
  xid XID8 NOT NULL,
  backend_pid INTEGER NOT NULL,
  login NAME NOT NULL,
  PRIMARY KEY (xid,backend_pid)
);
REVOKE ALL ON ALL TABLES IN SCHEMA finance_cutover_test FROM PUBLIC;

CREATE FUNCTION finance_cutover_test.clean_permit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,finance_cutover_test AS $$
BEGIN
  DELETE FROM finance_cutover_test.transaction_permits WHERE xid=NEW.xid AND backend_pid=NEW.backend_pid;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER finance_cutover_test_clean_permit
 AFTER INSERT ON finance_cutover_test.transaction_permits DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION finance_cutover_test.clean_permit();

-- The future application must call this inside EACH real transaction before
-- writing any protected object. It distinguishes the old program even if it
-- accidentally receives the new DB login. A holder of the new DB credentials
-- can deliberately invoke it: it does NOT prove a ledger entry exists.
CREATE FUNCTION finance_cutover_test.begin_new_transaction() RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,finance_cutover_test AS $$
DECLARE c finance_cutover_test.control%ROWTYPE;
BEGIN
  SELECT * INTO c FROM finance_cutover_test.control WHERE singleton FOR SHARE;
  IF NOT FOUND OR c.phase<>'NEW' OR session_user<>c.new_login THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='FINANCE_CUTOVER_BLOCKED';
  END IF;
  INSERT INTO finance_cutover_test.transaction_permits(xid,backend_pid,login)
    VALUES(pg_current_xact_id(),pg_backend_pid(),session_user) ON CONFLICT DO NOTHING;
END $$;

-- A shared row lock is held until commit. Transitioning takes an exclusive row
-- lock, so it waits for in-flight writes and old serializable snapshots abort.
CREATE FUNCTION finance_cutover_test.guard_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,finance_cutover_test AS $$
DECLARE c finance_cutover_test.control%ROWTYPE;
BEGIN
  SELECT * INTO c FROM finance_cutover_test.control WHERE singleton FOR SHARE;
  IF NOT FOUND OR TG_OP='TRUNCATE' THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='FINANCE_CUTOVER_BLOCKED';
  END IF;
  IF c.phase='LEGACY' AND session_user=c.legacy_login THEN RETURN NULL; END IF;
  IF c.phase='NEW' AND session_user=c.new_login AND EXISTS (
    SELECT 1 FROM finance_cutover_test.transaction_permits
    WHERE xid=pg_current_xact_id() AND backend_pid=pg_backend_pid() AND login=session_user
  ) THEN RETURN NULL; END IF;
  RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='FINANCE_CUTOVER_BLOCKED';
END $$;

-- A transition is administrative, audited and idempotent. The result reports
-- BOTH the original transition and current state on a later replay. Returning
-- to the legacy application is prohibited once NEW has ever been activated.
CREATE FUNCTION finance_cutover_test.transition(
  p_request UUID,p_expected_revision INTEGER,p_from TEXT,p_to TEXT,p_reason TEXT
) RETURNS TABLE(applied_revision INTEGER,current_revision INTEGER,current_phase TEXT,replayed BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,finance_cutover_test AS $$
DECLARE c finance_cutover_test.control%ROWTYPE; prior finance_cutover_test.transitions%ROWTYPE;
BEGIN
  IF p_request IS NULL OR p_expected_revision IS NULL OR p_from IS NULL OR p_to IS NULL
     OR p_reason IS NULL OR length(btrim(p_reason))=0 OR length(p_reason)>300 THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='FINANCE_CUTOVER_INVALID';
  END IF;
  SELECT * INTO c FROM finance_cutover_test.control WHERE singleton FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='FINANCE_CUTOVER_BLOCKED'; END IF;
  SELECT * INTO prior FROM finance_cutover_test.transitions WHERE request_id=p_request;
  IF FOUND THEN
    IF prior.actor<>session_user OR prior.previous_phase<>p_from OR prior.next_phase<>p_to
       OR prior.expected_revision<>p_expected_revision OR prior.reason<>p_reason THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='FINANCE_CUTOVER_REQUEST_CONFLICT';
    END IF;
    RETURN QUERY SELECT prior.result_revision,c.revision,c.phase::TEXT,TRUE;
    RETURN;
  END IF;
  IF c.phase<>p_from OR c.revision<>p_expected_revision THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='FINANCE_CUTOVER_STALE';
  END IF;
  IF NOT ((c.phase='LEGACY' AND p_to='FROZEN') OR
          (c.phase='FROZEN' AND p_to='NEW') OR
          (c.phase='FROZEN' AND p_to='LEGACY' AND NOT c.ever_new) OR
          (c.phase='NEW' AND p_to='FROZEN')) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='FINANCE_CUTOVER_INVALID_TRANSITION';
  END IF;
  UPDATE finance_cutover_test.control SET phase=p_to,revision=c.revision+1,ever_new=c.ever_new OR p_to='NEW'
    WHERE singleton;
  INSERT INTO finance_cutover_test.transitions(request_id,actor,previous_phase,next_phase,expected_revision,result_revision,reason)
    VALUES(p_request,session_user,c.phase,p_to,c.revision,c.revision+1,p_reason);
  RETURN QUERY SELECT c.revision+1,c.revision+1,p_to,FALSE;
END $$;

REVOKE ALL ON FUNCTION finance_cutover_test.clean_permit() FROM PUBLIC;
REVOKE ALL ON FUNCTION finance_cutover_test.guard_write() FROM PUBLIC;
REVOKE ALL ON FUNCTION finance_cutover_test.transition(UUID,INTEGER,TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION finance_cutover_test.begin_new_transaction() FROM PUBLIC;
GRANT USAGE ON SCHEMA finance_cutover_test TO cutover_new_test;
GRANT EXECUTE ON FUNCTION finance_cutover_test.begin_new_transaction() TO cutover_new_test;

-- The list is deliberately explicit and is tested against the FICTIONAL legacy
-- fixture. Real dependencies, owners, RLS, triggers and additional tables are
-- unknown until a separately approved release audit and review.
DO $$
DECLARE obj TEXT; owner_oid OID; legacy_oid OID; new_oid OID;
BEGIN
  SELECT oid INTO legacy_oid FROM pg_catalog.pg_roles WHERE rolname='cutover_legacy_test';
  SELECT oid INTO new_oid FROM pg_catalog.pg_roles WHERE rolname='cutover_new_test';
  FOREACH obj IN ARRAY ARRAY[
    'public.commerce_settings','public.commerce_settings_changes','public.commerce_sales',
    'public.commerce_sale_lines','public.commerce_sale_line_serials','public.commerce_collections',
    'public.commerce_returns','public.commerce_return_lines','public.commerce_return_serials','public.commerce_refunds',
    'public.stock_levels','public.inventory_serials','public.inventory_openings','public.inventory_receipts','public.inventory_product_creations',
    'public.expense_categories','public.expenses','public.journal_entries',
    'finance_cutover_fixture.accounts','finance_cutover_fixture.checkpoints','finance_cutover_fixture.expenses','finance_cutover_fixture.payments',
    'finance_cutover_fixture.movements','finance_cutover_fixture.historical','finance_cutover_fixture.requests','finance_cutover_fixture.audit_events'
  ] LOOP
    SELECT c.relowner INTO owner_oid FROM pg_catalog.pg_class c WHERE c.oid=pg_catalog.to_regclass(obj) AND c.relkind='r';
    IF NOT FOUND OR owner_oid IN (legacy_oid,new_oid) THEN
      RAISE EXCEPTION 'fixture object missing or owned by an app login: %',obj;
    END IF;
    EXECUTE format('CREATE TRIGGER finance_cutover_test_guard BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON %I.%I FOR EACH STATEMENT EXECUTE FUNCTION finance_cutover_test.guard_write()',split_part(obj,'.',1),split_part(obj,'.',2));
  END LOOP;
END $$;

-- Test-only *additional* ledger invariant. The marker is not trusted to mean
-- that a financial hook actually ran. A CASH collection/refund must have ONE
-- matching current movement OR ONE documented historical record at COMMIT;
-- non-cash events must have neither. This model does not prove physical facts.
CREATE FUNCTION finance_cutover_test.verify_cash_event(p_type TEXT,p_id BIGINT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,finance_cutover_test AS $$
DECLARE
 c finance_cutover_test.control%ROWTYPE;
 event_amount NUMERIC(14,2);event_method TEXT;event_branch BIGINT;
 m RECORD;h RECORD;has_m BOOLEAN;has_h BOOLEAN;v_account_id BIGINT;latest_checkpoint BIGINT;
 account_branch BIGINT;checkpoint_account BIGINT;checkpoint_day DATE;
BEGIN
 SELECT * INTO c FROM finance_cutover_test.control WHERE singleton FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='FINANCE_CUTOVER_BLOCKED'; END IF;
 IF c.phase<>'NEW' THEN RETURN; END IF;
 IF p_type NOT IN ('COLLECTION','REFUND') OR p_id IS NULL THEN
   RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='FINANCE_CASH_SOURCE_INVALID';
 END IF;
 -- The upsert serializes a normal movement versus a historical annotation for
 -- the same event, including on a stale SERIALIZABLE snapshot.
 INSERT INTO finance_cutover_test.event_locks(event_type,event_id) VALUES(p_type,p_id)
 ON CONFLICT(event_type,event_id) DO UPDATE SET revision=finance_cutover_test.event_locks.revision+1;
 IF p_type='COLLECTION' THEN
   SELECT x.amount,x.method,s.branch_id INTO event_amount,event_method,event_branch
    FROM public.commerce_collections x JOIN public.commerce_sales s ON s.id=x.sale_id WHERE x.id=p_id;
 ELSE
   SELECT x.amount,x.method,s.branch_id INTO event_amount,event_method,event_branch
    FROM public.commerce_refunds x JOIN public.commerce_sales s ON s.id=x.sale_id WHERE x.id=p_id;
 END IF;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='FINANCE_CASH_SOURCE_INVALID'; END IF;
 SELECT x.amount,x.account_id,x.checkpoint_id INTO m FROM finance_cutover_fixture.movements x
  WHERE (p_type='COLLECTION' AND x.collection_id=p_id) OR (p_type='REFUND' AND x.refund_id=p_id);
 has_m:=FOUND;
 SELECT x.amount,x.account_id,x.checkpoint_id,x.actual_date,x.same_day_before INTO h FROM finance_cutover_fixture.historical x
  WHERE (p_type='COLLECTION' AND x.collection_id=p_id) OR (p_type='REFUND' AND x.refund_id=p_id);
 has_h:=FOUND;
 IF event_method<>'CASH' THEN
   IF has_m OR has_h THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='FINANCE_NONCASH_LEDGER_INVALID'; END IF;
   RETURN;
 END IF;
 IF has_m=has_h THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='FINANCE_CASH_LINK_REQUIRED'; END IF;
 v_account_id:=CASE WHEN has_m THEN m.account_id ELSE h.account_id END;
 -- The count writer and this verifier touch the same private row. An older
 -- snapshot must retry, rather than use an obsolete reviewed checkpoint.
 INSERT INTO finance_cutover_test.account_locks(account_id) VALUES(v_account_id)
 ON CONFLICT(account_id) DO UPDATE SET revision=finance_cutover_test.account_locks.revision+1;
 SELECT a.branch_id,cp.account_id,cp.counted_on INTO account_branch,checkpoint_account,checkpoint_day
  FROM finance_cutover_fixture.accounts a JOIN finance_cutover_fixture.checkpoints cp
    ON cp.id=CASE WHEN has_m THEN m.checkpoint_id ELSE h.checkpoint_id END
  WHERE a.id=v_account_id;
 IF NOT FOUND OR account_branch<>event_branch OR checkpoint_account<>v_account_id THEN
   RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='FINANCE_CASH_ACCOUNT_INVALID';
 END IF;
 IF has_m THEN
   SELECT cp.id INTO latest_checkpoint FROM finance_cutover_fixture.checkpoints cp WHERE cp.account_id=v_account_id ORDER BY cp.id DESC LIMIT 1;
   IF m.amount<>event_amount OR m.checkpoint_id<>latest_checkpoint THEN
     RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='FINANCE_CASH_MOVEMENT_INVALID';
   END IF;
 ELSE
   IF h.amount<>event_amount OR h.actual_date>checkpoint_day OR (h.actual_date=checkpoint_day AND NOT h.same_day_before) THEN
     RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='FINANCE_HISTORICAL_LINK_INVALID';
   END IF;
 END IF;
END $$;

CREATE FUNCTION finance_cutover_test.check_cash_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,finance_cutover_test AS $$
BEGIN
 IF TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME='commerce_collections' THEN
   PERFORM finance_cutover_test.verify_cash_event('COLLECTION',NEW.id);
 ELSIF TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME='commerce_refunds' THEN
   PERFORM finance_cutover_test.verify_cash_event('REFUND',NEW.id);
 ELSIF NEW.collection_id IS NOT NULL THEN
   PERFORM finance_cutover_test.verify_cash_event('COLLECTION',NEW.collection_id);
 ELSE
   PERFORM finance_cutover_test.verify_cash_event('REFUND',NEW.refund_id);
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER finance_cutover_test_check_collection AFTER INSERT ON public.commerce_collections
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_cutover_test.check_cash_event();
CREATE CONSTRAINT TRIGGER finance_cutover_test_check_refund AFTER INSERT ON public.commerce_refunds
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_cutover_test.check_cash_event();
CREATE CONSTRAINT TRIGGER finance_cutover_test_check_movement AFTER INSERT ON finance_cutover_fixture.movements
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_cutover_test.check_cash_event();
CREATE CONSTRAINT TRIGGER finance_cutover_test_check_historical AFTER INSERT ON finance_cutover_fixture.historical
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_cutover_test.check_cash_event();

-- Confirmed ledger evidence and commerce money events are append-only in NEW;
-- later corrections need their own audited records, not UPDATE/DELETE.
CREATE FUNCTION finance_cutover_test.immutable_cash_evidence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,finance_cutover_test AS $$
DECLARE c finance_cutover_test.control%ROWTYPE;
BEGIN
 SELECT * INTO c FROM finance_cutover_test.control WHERE singleton FOR SHARE;
 IF NOT FOUND OR c.phase='NEW' THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='FINANCE_CASH_EVIDENCE_IMMUTABLE'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER finance_cutover_test_immutable_collection BEFORE UPDATE OR DELETE ON public.commerce_collections
 FOR EACH ROW EXECUTE FUNCTION finance_cutover_test.immutable_cash_evidence();
CREATE TRIGGER finance_cutover_test_immutable_refund BEFORE UPDATE OR DELETE ON public.commerce_refunds
 FOR EACH ROW EXECUTE FUNCTION finance_cutover_test.immutable_cash_evidence();
CREATE TRIGGER finance_cutover_test_immutable_movement BEFORE UPDATE OR DELETE ON finance_cutover_fixture.movements
 FOR EACH ROW EXECUTE FUNCTION finance_cutover_test.immutable_cash_evidence();
CREATE TRIGGER finance_cutover_test_immutable_historical BEFORE UPDATE OR DELETE ON finance_cutover_fixture.historical
 FOR EACH ROW EXECUTE FUNCTION finance_cutover_test.immutable_cash_evidence();
CREATE TRIGGER finance_cutover_test_immutable_account BEFORE UPDATE OR DELETE ON finance_cutover_fixture.accounts
 FOR EACH ROW EXECUTE FUNCTION finance_cutover_test.immutable_cash_evidence();
CREATE TRIGGER finance_cutover_test_immutable_checkpoint BEFORE UPDATE OR DELETE ON finance_cutover_fixture.checkpoints
 FOR EACH ROW EXECUTE FUNCTION finance_cutover_test.immutable_cash_evidence();
-- Sale totals/revision may still change, but changing its branch would silently
-- invalidate all of its already checked cash links.
CREATE FUNCTION finance_cutover_test.immutable_sale_branch() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,finance_cutover_test AS $$
DECLARE c finance_cutover_test.control%ROWTYPE;
BEGIN
 SELECT * INTO c FROM finance_cutover_test.control WHERE singleton FOR SHARE;
 IF NOT FOUND OR (c.phase='NEW' AND OLD.branch_id IS DISTINCT FROM NEW.branch_id) THEN
  RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='FINANCE_CASH_EVIDENCE_IMMUTABLE';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER finance_cutover_test_immutable_sale_branch BEFORE UPDATE OF branch_id ON public.commerce_sales
 FOR EACH ROW EXECUTE FUNCTION finance_cutover_test.immutable_sale_branch();

-- A role check over fictional user records; NOT an authenticated session.
CREATE FUNCTION finance_cutover_test.require_manager_actor(p_actor BIGINT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,finance_cutover_test AS $$
DECLARE actor_role TEXT;actor_status TEXT;must_change BOOLEAN;
BEGIN
 SELECT role_code::TEXT,status::TEXT,must_change_password INTO actor_role,actor_status,must_change
  FROM public.users WHERE id=p_actor FOR SHARE;
 IF NOT FOUND OR actor_role NOT IN ('MANAGER','ACCOUNTANT') OR actor_status<>'ACTIVE' OR must_change THEN
  RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='FINANCE_MANAGER_REQUIRED';
 END IF;
END $$;
CREATE FUNCTION finance_cutover_test.authorize_opening() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,finance_cutover_test AS $$
BEGIN
 PERFORM finance_cutover_test.require_manager_actor(NEW.counted_by);RETURN NEW;
END $$;
CREATE TRIGGER finance_cutover_test_opening_actor BEFORE INSERT ON finance_cutover_fixture.accounts
 FOR EACH ROW EXECUTE FUNCTION finance_cutover_test.authorize_opening();
CREATE FUNCTION finance_cutover_test.verify_account_opening() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,finance_cutover_test AS $$
DECLARE c finance_cutover_test.control%ROWTYPE;
BEGIN
 SELECT * INTO c FROM finance_cutover_test.control WHERE singleton FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='FINANCE_CUTOVER_BLOCKED'; END IF;
 IF c.phase='NEW' AND NOT EXISTS(SELECT 1 FROM finance_cutover_fixture.checkpoints
   WHERE account_id=NEW.id AND kind='OPENING') THEN
   RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='FINANCE_OPENING_CHECKPOINT_REQUIRED';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER finance_cutover_test_opening_required AFTER INSERT ON finance_cutover_fixture.accounts
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_cutover_test.verify_account_opening();

-- Serialize creation of a later count with verification of a cash movement.
CREATE FUNCTION finance_cutover_test.lock_checkpoint() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,finance_cutover_test AS $$
DECLARE opening_day DATE;opening_amount NUMERIC(14,2);last_day DATE;
BEGIN
 PERFORM finance_cutover_test.require_manager_actor(NEW.confirmed_by);
 INSERT INTO finance_cutover_test.account_locks(account_id) VALUES(NEW.account_id)
 ON CONFLICT(account_id) DO UPDATE SET revision=finance_cutover_test.account_locks.revision+1;
 SELECT a.opening_date,a.opening_amount INTO opening_day,opening_amount
  FROM finance_cutover_fixture.accounts a WHERE a.id=NEW.account_id;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='FINANCE_CHECKPOINT_INVALID'; END IF;
 SELECT cp.counted_on INTO last_day FROM finance_cutover_fixture.checkpoints cp
  WHERE cp.account_id=NEW.account_id ORDER BY cp.id DESC LIMIT 1;
 IF NEW.kind='OPENING' THEN
   IF last_day IS NOT NULL OR NEW.counted_on<>opening_day OR NEW.observed_amount<>opening_amount THEN
     RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='FINANCE_CHECKPOINT_INVALID';
   END IF;
 ELSIF NEW.kind='COUNT' THEN
   IF last_day IS NULL OR NEW.counted_on<last_day THEN
     RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='FINANCE_CHECKPOINT_INVALID';
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER finance_cutover_test_checkpoint_lock BEFORE INSERT ON finance_cutover_fixture.checkpoints
 FOR EACH ROW EXECUTE FUNCTION finance_cutover_test.lock_checkpoint();

-- This checks the actor record in the fixture, not the authenticity of a
-- browser-supplied ID. The real application must derive it from its session.
CREATE FUNCTION finance_cutover_test.authorize_historical() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,finance_cutover_test AS $$
BEGIN
 PERFORM finance_cutover_test.require_manager_actor(NEW.confirmed_by);RETURN NEW;
END $$;
CREATE TRIGGER finance_cutover_test_history_actor BEFORE INSERT ON finance_cutover_fixture.historical
 FOR EACH ROW EXECUTE FUNCTION finance_cutover_test.authorize_historical();

REVOKE ALL ON FUNCTION finance_cutover_test.verify_cash_event(TEXT,BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION finance_cutover_test.check_cash_event() FROM PUBLIC;
REVOKE ALL ON FUNCTION finance_cutover_test.immutable_cash_evidence() FROM PUBLIC;
REVOKE ALL ON FUNCTION finance_cutover_test.immutable_sale_branch() FROM PUBLIC;
REVOKE ALL ON FUNCTION finance_cutover_test.require_manager_actor(BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION finance_cutover_test.authorize_opening() FROM PUBLIC;
REVOKE ALL ON FUNCTION finance_cutover_test.verify_account_opening() FROM PUBLIC;
REVOKE ALL ON FUNCTION finance_cutover_test.lock_checkpoint() FROM PUBLIC;
REVOKE ALL ON FUNCTION finance_cutover_test.authorize_historical() FROM PUBLIC;
