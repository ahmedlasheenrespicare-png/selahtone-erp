-- SYNTHETIC DATABASE ONLY. Not a production migration.
-- Alters an index; never run this on existing or real databases.
DO $$ BEGIN
  IF current_setting('selahtone.custody_reopen_test_only', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'synthetic custody reopening test requires explicit opt-in';
  END IF;
END $$;
DROP INDEX finance.finance_custody_per_holder;
CREATE UNIQUE INDEX finance_custody_open_per_holder_test_only
  ON finance.accounts (branch_id,holder_id)
  WHERE kind='CUSTODY' AND closed_at IS NULL;
