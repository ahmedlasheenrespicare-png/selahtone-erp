-- TEST-ONLY CATEGORY BRIDGE; NOT a production migration.
-- It must never run on Neon or a database containing business data.
-- This candidate references the existing public categories/users rather than
-- copying or modifying them while installing the experimental schema.
DO $$
BEGIN
  IF current_setting('selahtone.finance_candidate_test_only',true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'finance_candidate requires an explicitly opted-in disposable database';
  END IF;
END $$;

CREATE SCHEMA finance_candidate;

-- Existing categories have unknown origin, so an absent row means revision 1;
-- do not invent a creator or timestamp. This table is filled only on an actual
-- test operation, not by the candidate migration.
CREATE TABLE finance_candidate.category_revisions (
  category_id INTEGER PRIMARY KEY REFERENCES public.expense_categories(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision > 0),
  created_by BIGINT REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ,
  updated_by BIGINT REFERENCES public.users(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ,
  CHECK ((created_by IS NULL) = (created_at IS NULL)),
  CHECK ((updated_by IS NULL) = (updated_at IS NULL))
);

-- These are experimental standalone tables; the final integration must share
-- the production finance request/audit model and may use a different schema.
CREATE TABLE finance_candidate.category_audit (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES public.expense_categories(id) ON DELETE RESTRICT,
  actor_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  action VARCHAR(8) NOT NULL CHECK (action IN ('CREATE','EDIT')),
  reason VARCHAR(300),
  before_data JSONB,
  after_data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((action='CREATE' AND before_data IS NULL AND reason IS NULL) OR
         (action='EDIT' AND before_data IS NOT NULL AND reason IS NOT NULL AND length(trim(reason))>0))
);
CREATE TABLE finance_candidate.category_requests (
  request_id UUID PRIMARY KEY,
  request_hash CHAR(64) NOT NULL,
  actor_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  action VARCHAR(8) NOT NULL CHECK (action IN ('CREATE','EDIT')),
  category_id INTEGER NOT NULL REFERENCES public.expense_categories(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
