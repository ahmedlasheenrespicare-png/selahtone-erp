-- DISPOSABLE SYNTHETIC DATABASE ONLY. Not a production migration.
-- Does not alter the existing permanent branch/holder index.
BEGIN;
DO $$ BEGIN
  IF current_setting('selahtone.custody_uniqueness_test_only', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'synthetic custody uniqueness test requires explicit opt-in';
  END IF;
  IF EXISTS (SELECT 1 FROM finance.accounts WHERE kind='CUSTODY' AND closed_at IS NULL AND holder_id IS NULL) THEN
    RAISE EXCEPTION 'synthetic audit found an open custody without a holder';
  END IF;
  IF EXISTS (SELECT 1 FROM finance.accounts WHERE kind='CUSTODY' AND closed_at IS NULL
             GROUP BY holder_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'synthetic audit found multiple open custodies for a holder';
  END IF;
END $$;
-- No IF NOT EXISTS: an existing index with this name must not masquerade as
-- successful validation. PostgreSQL validates existing rows while building.
CREATE UNIQUE INDEX finance_one_open_custody_per_holder_test_only
  ON finance.accounts(holder_id) WHERE kind='CUSTODY' AND closed_at IS NULL;
COMMIT;
