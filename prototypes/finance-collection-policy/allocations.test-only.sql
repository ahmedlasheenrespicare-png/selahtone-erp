-- Experimental, disposable database only. Not a migration or deploy script.
DO $$ BEGIN
  IF current_setting('selahtone.collection_policy_test_only', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'collection allocation prototype requires explicit disposable database opt-in';
  END IF;
END $$;
CREATE TABLE finance.collection_allocations_test_only (
  collection_id BIGINT PRIMARY KEY REFERENCES public.commerce_collections(id),
  account_id BIGINT NOT NULL REFERENCES finance.accounts(id),
  treatment TEXT NOT NULL CHECK (treatment IN ('CUSTODY_PENDING', 'VAULT_MOVEMENT')),
  movement_id BIGINT UNIQUE REFERENCES finance.movements(id),
  assigned_by BIGINT NOT NULL REFERENCES public.users(id),
  vault_received_attested BOOLEAN,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  settlement_id BIGINT REFERENCES finance.settlements(id),
  CHECK ((treatment='CUSTODY_PENDING' AND movement_id IS NULL AND vault_received_attested IS NULL)
    OR (treatment='VAULT_MOVEMENT' AND movement_id IS NOT NULL AND settlement_id IS NULL AND vault_received_attested IS TRUE))
);
CREATE INDEX ON finance.collection_allocations_test_only (account_id, collection_id) WHERE treatment='CUSTODY_PENDING' AND settlement_id IS NULL;

-- Experimental holder-cash assignment and per-settlement receipt. Neither is
-- connected to the application; historical rows must never be auto-assigned.
CREATE TABLE finance.holder_payment_allocations_test_only (
  payment_id BIGINT PRIMARY KEY REFERENCES finance.payments(id),
  account_id BIGINT NOT NULL REFERENCES finance.accounts(id),
  assigned_by BIGINT NOT NULL REFERENCES public.users(id),
  settlement_id BIGINT REFERENCES finance.settlements(id)
);
CREATE INDEX ON finance.holder_payment_allocations_test_only (account_id,payment_id) WHERE settlement_id IS NULL;
CREATE TABLE finance.settlement_allocation_receipts_test_only (
  settlement_id BIGINT PRIMARY KEY REFERENCES finance.settlements(id),
  account_id BIGINT NOT NULL REFERENCES finance.accounts(id),
  collection_ids JSONB NOT NULL,
  payment_ids JSONB NOT NULL,
  snapshot_hash CHAR(64) NOT NULL,
  sales_total NUMERIC(22,2) NOT NULL,
  expenses_total NUMERIC(22,2) NOT NULL
);

-- Test-only request review snapshot. Not evidence of a human review, not a
-- production migration, and never attached to legacy requests automatically.
CREATE TABLE finance.settlement_request_reviews_test_only (
  settlement_id BIGINT PRIMARY KEY REFERENCES finance.settlements(id),
  account_id BIGINT NOT NULL REFERENCES finance.accounts(id),
  collection_ids JSONB NOT NULL,
  payment_ids JSONB NOT NULL,
  snapshot_hash CHAR(64) NOT NULL
);
