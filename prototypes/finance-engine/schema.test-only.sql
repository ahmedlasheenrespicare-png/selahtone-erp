-- TEST-ONLY FINANCE LAB. This is NOT a production migration.
-- It is deliberately isolated from public and requires a session-local opt-in.
-- Never run it on Neon or any database containing actual business data.
DO $$
BEGIN
  IF current_setting('selahtone.finance_lab_test_only', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'finance_lab is for an explicitly opted-in disposable test database only';
  END IF;
END $$;

CREATE SCHEMA finance_lab;

-- Stand-ins for the real application tables. They contain fictional fixtures only.
CREATE TABLE finance_lab.branches (
  id BIGINT PRIMARY KEY,
  name_ar VARCHAR(120) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE finance_lab.users (
  id BIGINT PRIMARY KEY,
  branch_id BIGINT REFERENCES finance_lab.branches(id),
  role_code VARCHAR(16) NOT NULL CHECK (role_code IN ('MANAGER','ACCOUNTANT','CS_AGENT')),
  status VARCHAR(16) NOT NULL CHECK (status IN ('ACTIVE','SUSPENDED')),
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  full_name VARCHAR(120) NOT NULL
);

CREATE TABLE finance_lab.categories (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name_ar VARCHAR(120) NOT NULL CHECK (length(trim(name_ar)) > 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by BIGINT NOT NULL REFERENCES finance_lab.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX finance_lab_categories_name_key ON finance_lab.categories (lower(name_ar));

-- An account exists only after a counted, explicitly recorded opening.
CREATE TABLE finance_lab.accounts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch_id BIGINT NOT NULL REFERENCES finance_lab.branches(id),
  kind VARCHAR(8) NOT NULL CHECK (kind IN ('VAULT','CUSTODY')),
  holder_id BIGINT REFERENCES finance_lab.users(id),
  opening_amount NUMERIC(14,2) NOT NULL CHECK (opening_amount >= 0),
  opening_date DATE NOT NULL,
  opened_by BIGINT NOT NULL REFERENCES finance_lab.users(id),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
  CHECK ((kind='VAULT' AND holder_id IS NULL) OR (kind='CUSTODY' AND holder_id IS NOT NULL))
);
CREATE UNIQUE INDEX finance_lab_vault_per_branch ON finance_lab.accounts (branch_id) WHERE kind='VAULT';
CREATE UNIQUE INDEX finance_lab_custody_per_holder ON finance_lab.accounts (branch_id, holder_id) WHERE kind='CUSTODY';

CREATE TABLE finance_lab.expenses (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch_id BIGINT NOT NULL REFERENCES finance_lab.branches(id),
  category_id BIGINT NOT NULL REFERENCES finance_lab.categories(id),
  category_snapshot VARCHAR(120) NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  expense_date DATE NOT NULL,
  description VARCHAR(180) NOT NULL CHECK (length(trim(description)) > 0),
  beneficiary VARCHAR(120),
  document_number VARCHAR(120),
  tax_amount NUMERIC(14,2),
  status VARCHAR(12) NOT NULL CHECK (status IN ('PENDING','APPROVED','PAID')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  requested_by BIGINT NOT NULL REFERENCES finance_lab.users(id),
  approved_by BIGINT REFERENCES finance_lab.users(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (tax_amount IS NULL OR (tax_amount >= 0 AND tax_amount <= amount)),
  CHECK ((status='PENDING' AND approved_by IS NULL AND approved_at IS NULL) OR
         (status IN ('APPROVED','PAID') AND approved_by IS NOT NULL AND approved_at IS NOT NULL))
);

-- Disposable upload experiment ONLY: bytes stay in the in-memory lab database.
-- No production storage, backup, malware scanning, or replacement/deletion policy.
-- The quota protects this public demo from unlimited accumulated uploads.
CREATE TABLE finance_lab.attachment_quota (
  singleton SMALLINT PRIMARY KEY CHECK (singleton = 1),
  used_bytes INTEGER NOT NULL DEFAULT 0 CHECK (used_bytes BETWEEN 0 AND 20000000),
  used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count BETWEEN 0 AND 20)
);
INSERT INTO finance_lab.attachment_quota(singleton) VALUES (1);
CREATE TABLE finance_lab.expense_attachments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  expense_id BIGINT NOT NULL REFERENCES finance_lab.expenses(id),
  filename VARCHAR(120) NOT NULL,
  media_type VARCHAR(32) NOT NULL CHECK (media_type IN ('application/pdf','image/jpeg','image/png')),
  bytes BYTEA NOT NULL CHECK (octet_length(bytes) BETWEEN 5 AND 5000000),
  sha256 CHAR(64) NOT NULL,
  created_by BIGINT NOT NULL REFERENCES finance_lab.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT finance_lab_one_attachment_per_expense UNIQUE(expense_id)
);

CREATE TABLE finance_lab.payments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  expense_id BIGINT NOT NULL UNIQUE REFERENCES finance_lab.expenses(id),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  method VARCHAR(16) NOT NULL CHECK (method IN ('CASH','CARD','BANK_TRANSFER','WALLET')),
  account_id BIGINT REFERENCES finance_lab.accounts(id),
  payment_date DATE NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  recorded_by BIGINT NOT NULL REFERENCES finance_lab.users(id),
  actually_paid BOOLEAN NOT NULL CHECK (actually_paid),
  historical BOOLEAN NOT NULL DEFAULT FALSE,
  opening_order VARCHAR(8) CHECK (opening_order IN ('BEFORE','AFTER')),
  included_in_opening BOOLEAN NOT NULL DEFAULT FALSE,
  CHECK ((method='CASH' AND account_id IS NOT NULL) OR (method<>'CASH' AND account_id IS NULL)),
  CHECK (NOT historical OR method='CASH'),
  CHECK (included_in_opening=historical)
);

-- A reported paid-expense error is a review request, never an automatic
-- correction, refund, cash movement, or change to the original payment.
CREATE TABLE finance_lab.expense_reviews (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  expense_id BIGINT NOT NULL REFERENCES finance_lab.expenses(id),
  expense_revision INTEGER NOT NULL CHECK (expense_revision > 0),
  proposed_amount NUMERIC(14,2) CHECK (proposed_amount IS NULL OR proposed_amount >= 0),
  reason VARCHAR(300) NOT NULL CHECK (length(trim(reason)) > 0),
  original_snapshot JSONB NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CORRECTED','CLOSED')),
  created_by BIGINT NOT NULL REFERENCES finance_lab.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_by BIGINT REFERENCES finance_lab.users(id),
  resolved_at TIMESTAMPTZ,
  resolution_reason VARCHAR(300),
  CHECK ((status='OPEN' AND resolved_by IS NULL AND resolved_at IS NULL AND resolution_reason IS NULL) OR
         (status IN ('CORRECTED','CLOSED') AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL AND resolution_reason IS NOT NULL AND length(trim(resolution_reason)) > 0))
);
CREATE UNIQUE INDEX finance_lab_one_open_review_per_expense ON finance_lab.expense_reviews(expense_id) WHERE status='OPEN';

-- Physical count requests are observations first; a second explicit action is
-- required before a discrepancy affects the ledger. A match is also recorded.
CREATE TABLE finance_lab.cash_counts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES finance_lab.accounts(id),
  counted_amount NUMERIC(14,2) NOT NULL CHECK (counted_amount >= 0),
  observed_balance NUMERIC(22,2) NOT NULL,
  difference NUMERIC(22,2) NOT NULL CHECK (difference = counted_amount-observed_balance),
  account_revision BIGINT NOT NULL CHECK (account_revision >= 0),
  counted_on DATE NOT NULL,
  reason VARCHAR(300) NOT NULL CHECK (length(trim(reason)) > 0),
  status VARCHAR(12) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CONFIRMED','CANCELLED')),
  created_by BIGINT NOT NULL REFERENCES finance_lab.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_by BIGINT REFERENCES finance_lab.users(id),
  resolved_at TIMESTAMPTZ,
  resolution_reason VARCHAR(300),
  CHECK ((status='OPEN' AND resolved_by IS NULL AND resolved_at IS NULL AND resolution_reason IS NULL) OR
         (status IN ('CONFIRMED','CANCELLED') AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL AND resolution_reason IS NOT NULL AND length(trim(resolution_reason)) > 0))
);
CREATE UNIQUE INDEX finance_lab_one_open_count_per_account ON finance_lab.cash_counts(account_id) WHERE status='OPEN';

-- A same-day payment may be posted after a confirmed later count only when an
-- operator explicitly states that order and identifies that reviewed count.
ALTER TABLE finance_lab.payments ADD COLUMN after_cash_count_id BIGINT REFERENCES finance_lab.cash_counts(id);
ALTER TABLE finance_lab.payments ADD CONSTRAINT finance_lab_payment_count_order
  CHECK (after_cash_count_id IS NULL OR (method='CASH' AND NOT historical));

-- A verified correction never rewrites the opening anchor. If a later
-- confirmed count has already covered the difference, it is an auditable
-- historical annotation with *zero* new cash movement. Otherwise a single
-- book adjustment carries the difference; it is not a transfer of cash.
CREATE TABLE finance_lab.opening_corrections (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES finance_lab.accounts(id),
  before_amount NUMERIC(14,2) NOT NULL CHECK (before_amount >= 0),
  after_amount NUMERIC(14,2) NOT NULL CHECK (after_amount >= 0 AND after_amount <> before_amount),
  book_difference NUMERIC(22,2) NOT NULL CHECK (book_difference = after_amount-before_amount),
  resolution VARCHAR(16) NOT NULL CHECK (resolution IN ('BOOK','COUNT_COVERED')),
  covered_count_id BIGINT REFERENCES finance_lab.cash_counts(id),
  balance_before NUMERIC(22,2) NOT NULL,
  balance_after NUMERIC(22,2) NOT NULL,
  reason VARCHAR(300) NOT NULL CHECK (length(trim(reason)) > 0),
  created_by BIGINT NOT NULL REFERENCES finance_lab.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((resolution='BOOK' AND covered_count_id IS NULL AND balance_after=balance_before+book_difference) OR
         (resolution='COUNT_COVERED' AND covered_count_id IS NOT NULL AND balance_after=balance_before))
);
CREATE INDEX finance_lab_opening_correction_account ON finance_lab.opening_corrections(account_id,id);

-- The lab commerce bridge writes these *together* with the original CASH
-- collection/refund row. The user attests the real event preceded and is
-- included in the selected checkpoint. There is deliberately no cash movement.
-- The engine cannot independently prove the real-world event or detect a
-- duplicate deliberately entered with a different request ID.
CREATE TABLE finance_lab.historical_commerce (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type VARCHAR(12) NOT NULL CHECK (event_type IN ('COLLECTION','REFUND')),
  event_id BIGINT NOT NULL,
  sale_id BIGINT NOT NULL,
  branch_id BIGINT NOT NULL REFERENCES finance_lab.branches(id),
  account_id BIGINT NOT NULL REFERENCES finance_lab.accounts(id),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  actual_date DATE NOT NULL,
  checkpoint_type VARCHAR(8) NOT NULL CHECK (checkpoint_type IN ('OPENING','COUNT')),
  checkpoint_count_id BIGINT REFERENCES finance_lab.cash_counts(id),
  checkpoint_date DATE NOT NULL,
  -- These are user attestations, not proof of the physical event. Persist the
  -- reviewed ordering/inclusion, including same-day history, instead of losing
  -- the confirmations after the transaction returns.
  verified_actual BOOLEAN NOT NULL CHECK (verified_actual),
  before_checkpoint BOOLEAN NOT NULL CHECK (before_checkpoint),
  included_in_checkpoint BOOLEAN NOT NULL CHECK (included_in_checkpoint),
  not_previously_recorded BOOLEAN NOT NULL CHECK (not_previously_recorded),
  handler VARCHAR(120) NOT NULL CHECK (length(trim(handler)) > 0),
  reason VARCHAR(300) NOT NULL CHECK (length(trim(reason)) > 0),
  created_by BIGINT NOT NULL REFERENCES finance_lab.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (actual_date <= checkpoint_date),
  CHECK ((checkpoint_type='OPENING' AND checkpoint_count_id IS NULL) OR (checkpoint_type='COUNT' AND checkpoint_count_id IS NOT NULL)),
  UNIQUE (event_type,event_id)
);
CREATE INDEX finance_lab_historical_sale ON finance_lab.historical_commerce(sale_id,id);

-- Uncertain situations are saved as *claims*, not financial events. There may
-- be several unrelated historical claims on one invoice; an opening account
-- has at most one open case. Only a separately confirmed linked operation or an
-- explicit no-change closure resolves a case. No cascade/deletion is provided.
CREATE TABLE finance_lab.reconciliation_cases (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind VARCHAR(12) NOT NULL CHECK (kind IN ('OPENING','COLLECTION','REFUND')),
  branch_id BIGINT NOT NULL REFERENCES finance_lab.branches(id),
  account_id BIGINT REFERENCES finance_lab.accounts(id),
  sale_id BIGINT, -- application bridge verifies invoice and branch in the same transaction
  proposed_amount NUMERIC(14,2) CHECK (proposed_amount IS NULL OR proposed_amount >= 0),
  possible_date DATE,
  possible_handler VARCHAR(120),
  reason VARCHAR(300) NOT NULL CHECK (length(trim(reason)) > 0),
  opening_snapshot NUMERIC(14,2),
  balance_snapshot NUMERIC(22,2),
  status VARCHAR(12) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CONFIRMED','CLOSED')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by BIGINT NOT NULL REFERENCES finance_lab.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_by BIGINT REFERENCES finance_lab.users(id),
  resolved_at TIMESTAMPTZ,
  resolution_reason VARCHAR(300),
  opening_correction_id BIGINT UNIQUE REFERENCES finance_lab.opening_corrections(id),
  historical_id BIGINT UNIQUE REFERENCES finance_lab.historical_commerce(id),
  CHECK ((kind='OPENING' AND account_id IS NOT NULL AND sale_id IS NULL AND possible_date IS NULL AND possible_handler IS NULL AND opening_snapshot IS NOT NULL AND balance_snapshot IS NOT NULL) OR
         (kind IN ('COLLECTION','REFUND') AND sale_id IS NOT NULL AND opening_snapshot IS NULL AND balance_snapshot IS NULL AND (proposed_amount IS NULL OR proposed_amount > 0))),
  CHECK ((status='OPEN' AND resolved_by IS NULL AND resolved_at IS NULL AND resolution_reason IS NULL AND opening_correction_id IS NULL AND historical_id IS NULL) OR
         (status='CLOSED' AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL AND resolution_reason IS NOT NULL AND length(trim(resolution_reason)) > 0 AND opening_correction_id IS NULL AND historical_id IS NULL) OR
         (status='CONFIRMED' AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL AND resolution_reason IS NOT NULL AND length(trim(resolution_reason)) > 0 AND
          ((kind='OPENING' AND opening_correction_id IS NOT NULL AND historical_id IS NULL) OR
           (kind IN ('COLLECTION','REFUND') AND historical_id IS NOT NULL AND opening_correction_id IS NULL))))
);
CREATE UNIQUE INDEX finance_lab_one_open_opening_case ON finance_lab.reconciliation_cases(account_id) WHERE kind='OPENING' AND status='OPEN';
CREATE INDEX finance_lab_reconciliation_sale ON finance_lab.reconciliation_cases(sale_id,id);
CREATE TABLE finance_lab.reconciliation_notes (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id BIGINT NOT NULL REFERENCES finance_lab.reconciliation_cases(id),
  note VARCHAR(300) NOT NULL CHECK (length(trim(note)) > 0),
  created_by BIGINT NOT NULL REFERENCES finance_lab.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX finance_lab_reconciliation_notes_case ON finance_lab.reconciliation_notes(case_id,id);

-- Append-only *book* correction after an explicit review. The original expense,
-- payment and original movement remain untouched; this is never a cash refund.
CREATE TABLE finance_lab.expense_corrections (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  expense_id BIGINT NOT NULL REFERENCES finance_lab.expenses(id),
  payment_id BIGINT NOT NULL REFERENCES finance_lab.payments(id),
  review_id BIGINT NOT NULL UNIQUE REFERENCES finance_lab.expense_reviews(id),
  before_amount NUMERIC(14,2) NOT NULL CHECK (before_amount > 0),
  after_amount NUMERIC(14,2) NOT NULL CHECK (after_amount > 0 AND after_amount <> before_amount),
  reason VARCHAR(300) NOT NULL CHECK (length(trim(reason)) > 0),
  account_id BIGINT REFERENCES finance_lab.accounts(id),
  book_difference NUMERIC(22,2),
  balance_before NUMERIC(22,2),
  balance_after NUMERIC(22,2),
  created_by BIGINT NOT NULL REFERENCES finance_lab.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((account_id IS NULL AND book_difference IS NULL AND balance_before IS NULL AND balance_after IS NULL) OR
         (account_id IS NOT NULL AND book_difference IS NOT NULL AND balance_before IS NOT NULL AND balance_after IS NOT NULL AND
          book_difference=before_amount-after_amount AND balance_after=balance_before+book_difference))
);
CREATE INDEX finance_lab_correction_expense ON finance_lab.expense_corrections(expense_id,id);

-- One movement is a transfer between two accounts, or a cash inflow/outflow.
-- It is not an additional sale or revenue event. Old payments are never backfilled.
CREATE TABLE finance_lab.movements (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind VARCHAR(20) NOT NULL CHECK (kind IN ('TRANSFER','EXPENSE','COLLECTION','REFUND','COUNT_ADJUSTMENT','EXPENSE_CORRECTION','OPENING_CORRECTION')),
  branch_id BIGINT NOT NULL REFERENCES finance_lab.branches(id),
  source_id BIGINT REFERENCES finance_lab.accounts(id),
  destination_id BIGINT REFERENCES finance_lab.accounts(id),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  expense_payment_id BIGINT UNIQUE REFERENCES finance_lab.payments(id),
  cash_count_id BIGINT UNIQUE REFERENCES finance_lab.cash_counts(id),
  expense_correction_id BIGINT UNIQUE REFERENCES finance_lab.expense_corrections(id),
  opening_correction_id BIGINT UNIQUE REFERENCES finance_lab.opening_corrections(id),
  after_cash_count_id BIGINT REFERENCES finance_lab.cash_counts(id),
  after_opening BOOLEAN NOT NULL DEFAULT FALSE,
  external_ref VARCHAR(80),
  actor_id BIGINT NOT NULL REFERENCES finance_lab.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (source_id IS NULL OR source_id <> destination_id),
  CHECK (after_cash_count_id IS NULL OR kind IN ('COLLECTION','REFUND')),
  CHECK (NOT after_opening OR kind IN ('COLLECTION','REFUND')),
  CHECK (NOT (after_opening AND after_cash_count_id IS NOT NULL)),
  CHECK (
    (kind='TRANSFER' AND source_id IS NOT NULL AND destination_id IS NOT NULL AND expense_payment_id IS NULL AND cash_count_id IS NULL AND expense_correction_id IS NULL AND opening_correction_id IS NULL AND external_ref IS NULL) OR
    (kind='EXPENSE' AND source_id IS NOT NULL AND destination_id IS NULL AND expense_payment_id IS NOT NULL AND cash_count_id IS NULL AND expense_correction_id IS NULL AND opening_correction_id IS NULL AND external_ref IS NULL) OR
    (kind='COLLECTION' AND source_id IS NULL AND destination_id IS NOT NULL AND expense_payment_id IS NULL AND cash_count_id IS NULL AND expense_correction_id IS NULL AND opening_correction_id IS NULL AND external_ref IS NOT NULL) OR
    (kind='REFUND' AND source_id IS NOT NULL AND destination_id IS NULL AND expense_payment_id IS NULL AND cash_count_id IS NULL AND expense_correction_id IS NULL AND opening_correction_id IS NULL AND external_ref IS NOT NULL) OR
    (kind='COUNT_ADJUSTMENT' AND (source_id IS NULL) <> (destination_id IS NULL) AND expense_payment_id IS NULL AND cash_count_id IS NOT NULL AND expense_correction_id IS NULL AND opening_correction_id IS NULL AND external_ref IS NULL) OR
    (kind='EXPENSE_CORRECTION' AND (source_id IS NULL) <> (destination_id IS NULL) AND expense_payment_id IS NULL AND cash_count_id IS NULL AND expense_correction_id IS NOT NULL AND opening_correction_id IS NULL AND external_ref IS NULL) OR
    (kind='OPENING_CORRECTION' AND (source_id IS NULL) <> (destination_id IS NULL) AND expense_payment_id IS NULL AND cash_count_id IS NULL AND expense_correction_id IS NULL AND opening_correction_id IS NOT NULL AND external_ref IS NULL)
  )
);
CREATE UNIQUE INDEX finance_lab_movement_external_key ON finance_lab.movements (kind, external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX finance_lab_movement_source ON finance_lab.movements (source_id, id);
CREATE INDEX finance_lab_movement_destination ON finance_lab.movements (destination_id, id);

-- Shared idempotency keys cover all finance commands; no duplicate request creates a second movement.
CREATE TABLE finance_lab.requests (
  request_id UUID PRIMARY KEY,
  request_hash CHAR(64) NOT NULL,
  actor_id BIGINT NOT NULL REFERENCES finance_lab.users(id),
  action VARCHAR(40) NOT NULL,
  result_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE finance_lab.audit_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_type VARCHAR(20) NOT NULL,
  entity_id BIGINT NOT NULL,
  action VARCHAR(24) NOT NULL,
  actor_id BIGINT NOT NULL REFERENCES finance_lab.users(id),
  reason VARCHAR(300),
  before_data JSONB,
  after_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX finance_lab_audit_entity ON finance_lab.audit_events(entity_type, entity_id, id);
