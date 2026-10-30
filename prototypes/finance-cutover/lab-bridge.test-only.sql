-- TEST-ONLY: connect the fictional cutover experiment to the existing
-- finance_lab engine schema. NEVER run on Neon or any business database.
-- Install atomically on the disposable fixture, after BOTH test-only schemas.
DO $$
DECLARE obj TEXT; owner_oid OID; legacy_oid OID; new_oid OID;
BEGIN
 IF current_setting('selahtone.finance_cutover_lab_test_only',true) IS DISTINCT FROM 'yes'
    OR current_setting('selahtone.finance_cutover_test_only',true) IS DISTINCT FROM 'yes'
    OR current_setting('selahtone.finance_lab_test_only',true) IS DISTINCT FROM 'yes' THEN
  RAISE EXCEPTION 'cutover lab bridge requires a separately opted-in disposable database';
 END IF;
 IF to_regclass('finance_cutover_test.control') IS NULL OR to_regclass('finance_lab.movements') IS NULL THEN
  RAISE EXCEPTION 'both disposable fixture schemas are required';
 END IF;
 SELECT oid INTO legacy_oid FROM pg_catalog.pg_roles WHERE rolname='cutover_legacy_test';
 SELECT oid INTO new_oid FROM pg_catalog.pg_roles WHERE rolname='cutover_new_test';
 FOREACH obj IN ARRAY ARRAY[
  'finance_lab.branches','finance_lab.users','finance_lab.categories','finance_lab.accounts','finance_lab.expenses',
  'finance_lab.attachment_quota','finance_lab.expense_attachments','finance_lab.payments','finance_lab.expense_reviews',
  'finance_lab.cash_counts','finance_lab.opening_corrections','finance_lab.historical_commerce',
  'finance_lab.reconciliation_cases','finance_lab.reconciliation_notes','finance_lab.expense_corrections',
  'finance_lab.movements','finance_lab.requests','finance_lab.audit_events'
 ] LOOP
  SELECT c.relowner INTO owner_oid FROM pg_catalog.pg_class c WHERE c.oid=pg_catalog.to_regclass(obj) AND c.relkind='r';
  IF NOT FOUND OR owner_oid IN (legacy_oid,new_oid) THEN RAISE EXCEPTION 'lab fixture missing or owned by application role: %',obj; END IF;
  EXECUTE format('CREATE TRIGGER finance_cutover_lab_guard BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON %s FOR EACH STATEMENT EXECUTE FUNCTION finance_cutover_test.guard_write()',obj);
 END LOOP;
END $$;

-- Replace only the artificial fixture's commerce validators. The old fixture
-- tables remain guarded but are not a ledger for this independent scenario.
DROP TRIGGER finance_cutover_test_check_collection ON public.commerce_collections;
DROP TRIGGER finance_cutover_test_check_refund ON public.commerce_refunds;
DROP TRIGGER finance_cutover_test_check_movement ON finance_cutover_fixture.movements;
DROP TRIGGER finance_cutover_test_check_historical ON finance_cutover_fixture.historical;

-- Records must agree with both fictional user tables. This checks an asserted
-- actor id, NOT an authenticated user session or the truth of attestations.
CREATE FUNCTION finance_cutover_test.lab_actor(p_actor BIGINT,p_type TEXT,p_branch BIGINT,p_kind TEXT,p_holder BIGINT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,finance_cutover_test AS $$
DECLARE r RECORD;
BEGIN
 SELECT p.role_code::text AS role,p.status::text AS status,p.branch_id,p.must_change_password,
        l.role_code AS lab_role,l.status AS lab_status,l.branch_id AS lab_branch,l.must_change_password AS lab_change
 INTO r FROM public.users p JOIN finance_lab.users l ON l.id=p.id WHERE p.id=p_actor FOR SHARE OF p,l;
 IF NOT FOUND OR r.status<>'ACTIVE' OR r.lab_status<>'ACTIVE' OR r.must_change_password OR r.lab_change
    OR r.role<>r.lab_role OR r.branch_id IS DISTINCT FROM r.lab_branch THEN
  RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='FINANCE_LAB_ACTOR_INVALID';
 END IF;
 IF p_type IN ('HISTORY','REFUND','MANAGEMENT') AND r.role NOT IN ('MANAGER','ACCOUNTANT') THEN
  RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='FINANCE_LAB_ACTOR_INVALID';
 END IF;
 IF p_type='COLLECTION' AND NOT (
   r.role IN ('MANAGER','ACCOUNTANT') OR
   (r.role='CS_AGENT' AND r.branch_id=p_branch AND (p_kind='VAULT' OR (p_kind='CUSTODY' AND p_holder=p_actor)))
 ) THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='FINANCE_LAB_ACTOR_INVALID'; END IF;
END $$;

CREATE FUNCTION finance_cutover_test.verify_lab_event(p_type TEXT,p_id BIGINT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,finance_cutover_test AS $$
DECLARE c finance_cutover_test.control%ROWTYPE;
 event_amount NUMERIC(14,2);event_method TEXT;event_branch BIGINT;event_sale BIGINT;event_actor BIGINT;
 m RECORD;h RECORD;a RECORD;has_m BOOLEAN;has_h BOOLEAN;v_account BIGINT;latest BIGINT;checkpoint_day DATE;
BEGIN
 SELECT * INTO c FROM finance_cutover_test.control WHERE singleton FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='FINANCE_CUTOVER_BLOCKED'; END IF;
 IF c.phase<>'NEW' THEN RETURN; END IF;
 IF p_type NOT IN ('COLLECTION','REFUND') OR p_id IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='FINANCE_LAB_EVENT_INVALID';
 END IF;
 -- Serialize the two evidence paths, even if the source is an old event.
 INSERT INTO finance_cutover_test.event_locks(event_type,event_id) VALUES(p_type,p_id)
 ON CONFLICT(event_type,event_id) DO UPDATE SET revision=finance_cutover_test.event_locks.revision+1;
 IF p_type='COLLECTION' THEN
  SELECT x.amount,x.method,s.branch_id,s.id,x.created_by_id INTO event_amount,event_method,event_branch,event_sale,event_actor
   FROM public.commerce_collections x JOIN public.commerce_sales s ON s.id=x.sale_id WHERE x.id=p_id;
 ELSE
  SELECT x.amount,x.method,s.branch_id,s.id,x.created_by_id INTO event_amount,event_method,event_branch,event_sale,event_actor
   FROM public.commerce_refunds x JOIN public.commerce_sales s ON s.id=x.sale_id WHERE x.id=p_id;
 END IF;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='FINANCE_LAB_EVENT_INVALID'; END IF;
 SELECT x.amount,x.branch_id,CASE WHEN p_type='COLLECTION' THEN x.destination_id ELSE x.source_id END AS account_id,
        x.actor_id,x.after_cash_count_id,x.after_opening
  INTO m FROM finance_lab.movements x WHERE x.kind=p_type AND x.external_ref=lower(p_type)||':'||p_id::TEXT;
 has_m:=FOUND;
 SELECT x.amount,x.sale_id,x.branch_id,x.account_id,x.actual_date,x.checkpoint_type,x.checkpoint_count_id,x.checkpoint_date,
        x.created_by,x.verified_actual,x.before_checkpoint,x.included_in_checkpoint,x.not_previously_recorded
  INTO h FROM finance_lab.historical_commerce x WHERE x.event_type=p_type AND x.event_id=p_id;
 has_h:=FOUND;
 IF event_method<>'CASH' THEN
  IF has_m OR has_h THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='FINANCE_LAB_NONCASH_INVALID'; END IF;
  RETURN;
 END IF;
 IF has_m=has_h THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='FINANCE_LAB_CASH_LINK_REQUIRED'; END IF;
 v_account:=CASE WHEN has_m THEN m.account_id ELSE h.account_id END;
 INSERT INTO finance_cutover_test.account_locks(account_id) VALUES(v_account)
 ON CONFLICT(account_id) DO UPDATE SET revision=finance_cutover_test.account_locks.revision+1;
 SELECT x.id,x.branch_id,x.kind,x.holder_id,x.opening_date INTO a FROM finance_lab.accounts x WHERE x.id=v_account;
 IF NOT FOUND OR a.branch_id<>event_branch THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='FINANCE_LAB_ACCOUNT_INVALID'; END IF;
 IF has_m THEN
  PERFORM finance_cutover_test.lab_actor(m.actor_id,p_type,event_branch,a.kind,a.holder_id);
  SELECT x.id INTO latest FROM finance_lab.cash_counts x WHERE x.account_id=v_account AND x.status='CONFIRMED' ORDER BY x.id DESC LIMIT 1;
  IF m.amount<>event_amount OR m.branch_id<>event_branch OR m.actor_id<>event_actor OR
     (latest IS NULL AND (NOT m.after_opening OR m.after_cash_count_id IS NOT NULL)) OR
     (latest IS NOT NULL AND (m.after_opening OR m.after_cash_count_id IS DISTINCT FROM latest)) THEN
   RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='FINANCE_LAB_MOVEMENT_INVALID';
  END IF;
 ELSE
  PERFORM finance_cutover_test.lab_actor(h.created_by,'HISTORY',event_branch,a.kind,a.holder_id);
  IF h.checkpoint_type='OPENING' AND h.checkpoint_count_id IS NULL THEN checkpoint_day:=a.opening_date;
  ELSIF h.checkpoint_type='COUNT' AND h.checkpoint_count_id IS NOT NULL THEN
   SELECT x.counted_on INTO checkpoint_day FROM finance_lab.cash_counts x
    WHERE x.id=h.checkpoint_count_id AND x.account_id=v_account AND x.status='CONFIRMED';
  END IF;
  IF checkpoint_day IS NULL OR h.checkpoint_date<>checkpoint_day OR h.actual_date>checkpoint_day OR
     NOT (h.verified_actual AND h.before_checkpoint AND h.included_in_checkpoint AND h.not_previously_recorded) OR
     h.amount<>event_amount OR h.branch_id<>event_branch OR h.sale_id<>event_sale OR h.created_by<>event_actor THEN
   RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='FINANCE_LAB_HISTORY_INVALID';
  END IF;
 END IF;
END $$;

-- A separate lock namespace prevents an expense payment and its cash movement
-- from being validated against competing snapshots. This does not yet cover
-- every kind of adjustment or transfer in finance_lab.
CREATE TABLE finance_cutover_test.payment_locks (payment_id BIGINT PRIMARY KEY,revision BIGINT NOT NULL DEFAULT 1);
REVOKE ALL ON finance_cutover_test.payment_locks FROM PUBLIC;
CREATE FUNCTION finance_cutover_test.verify_lab_payment(p_id BIGINT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,finance_cutover_test AS $$
DECLARE c finance_cutover_test.control%ROWTYPE;p RECORD;m RECORD;a RECORD;overlap RECORD;has_m BOOLEAN;
BEGIN
 SELECT * INTO c FROM finance_cutover_test.control WHERE singleton FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='FINANCE_CUTOVER_BLOCKED'; END IF;
 IF c.phase<>'NEW' THEN RETURN; END IF;
 INSERT INTO finance_cutover_test.payment_locks(payment_id) VALUES(p_id)
  ON CONFLICT(payment_id) DO UPDATE SET revision=finance_cutover_test.payment_locks.revision+1;
 SELECT x.amount,x.method,x.account_id,x.payment_date,x.recorded_by,x.actually_paid,x.historical,x.opening_order,
        x.included_in_opening,x.after_cash_count_id,e.branch_id,e.amount AS expense_amount,e.status
  INTO p FROM finance_lab.payments x JOIN finance_lab.expenses e ON e.id=x.expense_id WHERE x.id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='FINANCE_LAB_PAYMENT_INVALID'; END IF;
 PERFORM finance_cutover_test.lab_actor(p.recorded_by,'MANAGEMENT',p.branch_id,NULL,NULL);
 SELECT x.amount,x.branch_id,x.source_id,x.actor_id INTO m FROM finance_lab.movements x
  WHERE x.expense_payment_id=p_id AND x.kind='EXPENSE';has_m:=FOUND;
 IF p.status<>'PAID' OR p.amount<>p.expense_amount OR NOT p.actually_paid THEN
  RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='FINANCE_LAB_PAYMENT_INVALID';
 END IF;
 IF p.method<>'CASH' THEN
  IF has_m OR p.account_id IS NOT NULL OR p.historical OR p.included_in_opening OR p.after_cash_count_id IS NOT NULL THEN
   RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='FINANCE_LAB_PAYMENT_INVALID';
  END IF;
  RETURN;
 END IF;
 INSERT INTO finance_cutover_test.account_locks(account_id) VALUES(p.account_id)
  ON CONFLICT(account_id) DO UPDATE SET revision=finance_cutover_test.account_locks.revision+1;
 SELECT x.branch_id,x.opening_date INTO a FROM finance_lab.accounts x WHERE x.id=p.account_id;
 IF NOT FOUND OR a.branch_id<>p.branch_id THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='FINANCE_LAB_ACCOUNT_INVALID'; END IF;
 IF p.historical THEN
  IF has_m OR NOT p.included_in_opening OR p.after_cash_count_id IS NOT NULL OR p.payment_date>a.opening_date OR
     (p.payment_date=a.opening_date AND p.opening_order IS DISTINCT FROM 'BEFORE') OR
     (p.payment_date<a.opening_date AND p.opening_order IS NOT NULL) THEN
   RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='FINANCE_LAB_PAYMENT_INVALID';
  END IF;
 ELSE
  IF NOT has_m OR p.included_in_opening OR p.payment_date<a.opening_date OR
     (p.payment_date=a.opening_date AND p.opening_order IS DISTINCT FROM 'AFTER') OR
     (p.payment_date>a.opening_date AND p.opening_order IS NOT NULL) OR
     m.amount<>p.amount OR m.branch_id<>p.branch_id OR m.source_id<>p.account_id OR m.actor_id<>p.recorded_by THEN
   RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='FINANCE_LAB_PAYMENT_INVALID';
  END IF;
  SELECT x.id,x.counted_on INTO overlap FROM finance_lab.cash_counts x
   WHERE x.account_id=p.account_id AND x.status='CONFIRMED' AND x.counted_on>=p.payment_date
   ORDER BY x.counted_on DESC,x.id DESC LIMIT 1;
  IF FOUND THEN
   IF overlap.counted_on>p.payment_date OR p.after_cash_count_id IS DISTINCT FROM overlap.id THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='FINANCE_LAB_PAYMENT_INVALID';
   END IF;
  ELSIF p.after_cash_count_id IS NOT NULL THEN
   RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='FINANCE_LAB_PAYMENT_INVALID';
  END IF;
 END IF;
END $$;
CREATE FUNCTION finance_cutover_test.check_lab_payment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,finance_cutover_test AS $$
DECLARE p_id BIGINT;
BEGIN
 IF TG_TABLE_NAME='payments' THEN p_id:=NEW.id;
 ELSIF TG_TABLE_NAME='movements' THEN
  IF NEW.kind<>'EXPENSE' THEN RETURN NULL; END IF; p_id:=NEW.expense_payment_id;
 ELSE
  IF NEW.status<>'PAID' THEN RETURN NULL; END IF;
  SELECT id INTO p_id FROM finance_lab.payments WHERE expense_id=NEW.id;
 END IF;
 IF p_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='FINANCE_LAB_PAYMENT_INVALID'; END IF;
 PERFORM finance_cutover_test.verify_lab_payment(p_id);RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER finance_cutover_lab_payment AFTER INSERT ON finance_lab.payments
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_cutover_test.check_lab_payment();
CREATE CONSTRAINT TRIGGER finance_cutover_lab_expense_payment AFTER INSERT OR UPDATE ON finance_lab.expenses
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.status='PAID') EXECUTE FUNCTION finance_cutover_test.check_lab_payment();
CREATE CONSTRAINT TRIGGER finance_cutover_lab_expense_movement AFTER INSERT ON finance_lab.movements
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.kind='EXPENSE') EXECUTE FUNCTION finance_cutover_test.check_lab_payment();

CREATE FUNCTION finance_cutover_test.check_lab_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,finance_cutover_test AS $$
DECLARE prefix TEXT;event_id BIGINT;
BEGIN
 IF TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME='commerce_collections' THEN
  PERFORM finance_cutover_test.verify_lab_event('COLLECTION',NEW.id);
 ELSIF TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME='commerce_refunds' THEN
  PERFORM finance_cutover_test.verify_lab_event('REFUND',NEW.id);
 ELSIF TG_TABLE_NAME='historical_commerce' THEN
  PERFORM finance_cutover_test.verify_lab_event(NEW.event_type,NEW.event_id);
 ELSIF NEW.kind IN ('COLLECTION','REFUND') THEN
  prefix:=lower(NEW.kind)||':';
  IF NEW.external_ref !~ ('^'||prefix||'[1-9][0-9]{0,18}$') THEN
   RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='FINANCE_LAB_EVENT_INVALID';
  END IF;
  event_id:=substring(NEW.external_ref FROM length(prefix)+1)::BIGINT;
  PERFORM finance_cutover_test.verify_lab_event(NEW.kind,event_id);
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER finance_cutover_lab_collection AFTER INSERT ON public.commerce_collections
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_cutover_test.check_lab_event();
CREATE CONSTRAINT TRIGGER finance_cutover_lab_refund AFTER INSERT ON public.commerce_refunds
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_cutover_test.check_lab_event();
CREATE CONSTRAINT TRIGGER finance_cutover_lab_movement AFTER INSERT ON finance_lab.movements
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_cutover_test.check_lab_event();
CREATE CONSTRAINT TRIGGER finance_cutover_lab_history AFTER INSERT ON finance_lab.historical_commerce
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_cutover_test.check_lab_event();

-- The engine bumps account revision, and resolves OPEN counts separately;
-- keep those operations while protecting the opening anchor and confirmed data.
CREATE FUNCTION finance_cutover_test.lab_account_immutable() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,finance_cutover_test AS $$
DECLARE phase TEXT;
BEGIN
 SELECT c.phase INTO phase FROM finance_cutover_test.control c WHERE singleton FOR SHARE;
 IF phase IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='FINANCE_CUTOVER_BLOCKED'; END IF;
 IF phase='NEW' AND (TG_OP='DELETE' OR ROW(OLD.id,OLD.branch_id,OLD.kind,OLD.holder_id,OLD.opening_amount,OLD.opening_date,OLD.opened_by,OLD.opened_at)
   IS DISTINCT FROM ROW(NEW.id,NEW.branch_id,NEW.kind,NEW.holder_id,NEW.opening_amount,NEW.opening_date,NEW.opened_by,NEW.opened_at)) THEN
  RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='FINANCE_LAB_IMMUTABLE';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE FUNCTION finance_cutover_test.lab_count_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,finance_cutover_test AS $$
DECLARE phase TEXT;
BEGIN
 SELECT c.phase INTO phase FROM finance_cutover_test.control c WHERE singleton FOR SHARE;
 IF phase IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='FINANCE_CUTOVER_BLOCKED'; END IF;
 IF TG_OP='DELETE' THEN
  IF phase='NEW' THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='FINANCE_LAB_IMMUTABLE'; END IF; RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND phase='NEW' THEN
  IF OLD.status<>'OPEN' OR ROW(OLD.id,OLD.account_id,OLD.counted_amount,OLD.observed_balance,OLD.difference,OLD.account_revision,OLD.counted_on,OLD.reason,OLD.created_by,OLD.created_at)
     IS DISTINCT FROM ROW(NEW.id,NEW.account_id,NEW.counted_amount,NEW.observed_balance,NEW.difference,NEW.account_revision,NEW.counted_on,NEW.reason,NEW.created_by,NEW.created_at) THEN
   RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='FINANCE_LAB_IMMUTABLE';
  END IF;
 END IF;
 IF NEW.status='CONFIRMED' THEN
  PERFORM finance_cutover_test.lab_actor(NEW.resolved_by,'MANAGEMENT',NULL,NULL,NULL);
  INSERT INTO finance_cutover_test.account_locks(account_id) VALUES(NEW.account_id)
   ON CONFLICT(account_id) DO UPDATE SET revision=finance_cutover_test.account_locks.revision+1;
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION finance_cutover_test.lab_opening_actor() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,finance_cutover_test AS $$
BEGIN
 PERFORM finance_cutover_test.lab_actor(NEW.opened_by,'MANAGEMENT',NEW.branch_id,NEW.kind,NEW.holder_id);RETURN NEW;
END $$;
CREATE FUNCTION finance_cutover_test.lab_paid_expense_immutable() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,finance_cutover_test AS $$
DECLARE phase TEXT;
BEGIN
 SELECT c.phase INTO phase FROM finance_cutover_test.control c WHERE singleton FOR SHARE;
 IF phase IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='FINANCE_CUTOVER_BLOCKED'; END IF;
 IF phase='NEW' AND OLD.status='PAID' THEN
  IF TG_OP='DELETE' OR ROW(OLD.id,OLD.branch_id,OLD.category_id,OLD.category_snapshot,OLD.amount,OLD.expense_date,
       OLD.description,OLD.beneficiary,OLD.document_number,OLD.tax_amount,OLD.status,OLD.requested_by,OLD.approved_by,OLD.approved_at,OLD.created_at)
   IS DISTINCT FROM ROW(NEW.id,NEW.branch_id,NEW.category_id,NEW.category_snapshot,NEW.amount,NEW.expense_date,
       NEW.description,NEW.beneficiary,NEW.document_number,NEW.tax_amount,NEW.status,NEW.requested_by,NEW.approved_by,NEW.approved_at,NEW.created_at) THEN
   RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='FINANCE_LAB_IMMUTABLE';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER finance_cutover_lab_account_immutable BEFORE UPDATE OR DELETE ON finance_lab.accounts FOR EACH ROW EXECUTE FUNCTION finance_cutover_test.lab_account_immutable();
CREATE TRIGGER finance_cutover_lab_opening_actor BEFORE INSERT ON finance_lab.accounts FOR EACH ROW EXECUTE FUNCTION finance_cutover_test.lab_opening_actor();
CREATE TRIGGER finance_cutover_lab_count_guard BEFORE INSERT OR UPDATE OR DELETE ON finance_lab.cash_counts FOR EACH ROW EXECUTE FUNCTION finance_cutover_test.lab_count_guard();
CREATE TRIGGER finance_cutover_lab_movement_immutable BEFORE UPDATE OR DELETE ON finance_lab.movements FOR EACH ROW EXECUTE FUNCTION finance_cutover_test.immutable_cash_evidence();
CREATE TRIGGER finance_cutover_lab_history_immutable BEFORE UPDATE OR DELETE ON finance_lab.historical_commerce FOR EACH ROW EXECUTE FUNCTION finance_cutover_test.immutable_cash_evidence();
CREATE TRIGGER finance_cutover_lab_payment_immutable BEFORE UPDATE OR DELETE ON finance_lab.payments FOR EACH ROW EXECUTE FUNCTION finance_cutover_test.immutable_cash_evidence();
CREATE TRIGGER finance_cutover_lab_expense_immutable BEFORE UPDATE OR DELETE ON finance_lab.expenses FOR EACH ROW EXECUTE FUNCTION finance_cutover_test.lab_paid_expense_immutable();

REVOKE ALL ON FUNCTION finance_cutover_test.lab_actor(BIGINT,TEXT,BIGINT,TEXT,BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION finance_cutover_test.verify_lab_event(TEXT,BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION finance_cutover_test.verify_lab_payment(BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION finance_cutover_test.check_lab_payment() FROM PUBLIC;
REVOKE ALL ON FUNCTION finance_cutover_test.check_lab_event() FROM PUBLIC;
REVOKE ALL ON FUNCTION finance_cutover_test.lab_paid_expense_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION finance_cutover_test.lab_account_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION finance_cutover_test.lab_count_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION finance_cutover_test.lab_opening_actor() FROM PUBLIC;
