-- ترقية المالية — ملف يدوي للتنفيذ على قاعدة الإنتاج بعد موافقة منفصلة.
-- لا يُشغَّل تلقائيًا، ولا ضمن نشر الموقع. اقرأه كاملًا قبل التشغيل.
--
-- sha256: 6f00bfa0054533e8d653ca93d9ef9d176437d838b06b1ea990ad98f95eef0ed8
--
-- شروط قبل التشغيل (كلها لازمة):
--   1. نسخة حديثة من قاعدة البيانات، ويفضَّل اختبار استعادتها في بيئة معزولة.
--   2. تشغيل prisma/manual-finance-release-preflight.sql أولًا وحفظ نتيجته للمقارنة.
--   3. موافقة صريحة على تشغيل SQL للإنتاج، منفصلة عن موافقة النشر.
--   4. عدم وجود كتابات مالية أو بيع جارٍ أثناء التشغيل (نافذة تحويل متفق عليها).
--
-- كيف يُشغَّل: الملف كله دفعة واحدة في Neon SQL Editor بعد اختيار الفرع
-- (production) وقاعدة البيانات (neondb). لا يُلصق في Terminal. يبدأ بـBEGIN
-- وينتهي بـCOMMIT؛ إن فشل أي جزء يُلغى كل شيء. عند الفشل نفّذ ROLLBACK; إن
-- بقيت المعاملة مفتوحة، ولا تُعد المحاولة قبل مراجعة السبب.
--
-- ما يفعله: ينشئ مخطط finance وجداول المالية، ويستخدم جداول المستخدمين
-- والفروع والبنود الحالية كما هي دون نسخها أو تعديلها، ويسجّل نفسه في
-- finance_release.migrations. إعادة تشغيل الملف نفسه بلا أثر، وتغييره يُرفض.
--
-- ما لا يفعله عن قصد: لا ينشئ جداول المرفقات، ولا يضيف قيودًا مؤجلة، ولا يمنح
-- صلاحيات أو يفعّل RLS، ولا يحوّل أو يحذف المصروفات والقيود القديمة.

BEGIN;

-- تحققات قبل إنشاء أي كائن؛ أي فشل يُلغي الترقية بالكامل.
DO $$
DECLARE missing TEXT; conflicts TEXT; previous CHAR(64);
BEGIN
  SELECT string_agg(obj, ', ') INTO missing FROM (VALUES ('public.branches'),('public.users'),('public.expense_categories')) AS v(obj)
   WHERE to_regclass(obj) IS NULL;
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'baseline object missing: %', missing; END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='expense_categories'
        AND column_name IN ('id','code','name_ar','is_active')) <> 4 THEN
    RAISE EXCEPTION 'public.expense_categories shape changed';
  END IF;
  SELECT string_agg(c.relname::text, ', ') INTO conflicts FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m') AND c.relname IN (
     'accounts','payments','movements','cash_counts','opening_corrections','historical_commerce',
     'reconciliation_cases','reconciliation_notes','expense_corrections','expense_reviews',
     'requests','audit_events','category_revisions');
  IF conflicts IS NOT NULL THEN RAISE EXCEPTION 'conflicting public objects: %', conflicts; END IF;
  IF to_regnamespace('finance') IS NOT NULL AND to_regclass('finance_release.migrations') IS NULL THEN
    RAISE EXCEPTION 'schema finance exists without the migration ledger; stop and review';
  END IF;
  IF to_regclass('finance_release.migrations') IS NOT NULL THEN
    SELECT checksum INTO previous FROM finance_release.migrations WHERE name='finance_release_upgrade';
    IF previous IS NOT NULL AND previous <> '6f00bfa0054533e8d653ca93d9ef9d176437d838b06b1ea990ad98f95eef0ed8' THEN
      RAISE EXCEPTION 'this upgrade file changed after it was applied; stop and review';
    END IF;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS finance;
CREATE SCHEMA IF NOT EXISTS finance_release;
CREATE TABLE IF NOT EXISTS finance_release.migrations (
  name TEXT PRIMARY KEY,
  checksum CHAR(64) NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  applied_by NAME NOT NULL DEFAULT session_user
);

-- An account exists only after a counted, explicitly recorded opening.
CREATE TABLE IF NOT EXISTS finance.accounts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch_id BIGINT NOT NULL REFERENCES public.branches(id),
  kind VARCHAR(8) NOT NULL CHECK (kind IN ('VAULT','CUSTODY')),
  holder_id BIGINT REFERENCES public.users(id),
  opening_amount NUMERIC(14,2) NOT NULL CHECK (opening_amount >= 0),
  opening_date DATE NOT NULL,
  opened_by BIGINT NOT NULL REFERENCES public.users(id),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
  CHECK ((kind='VAULT' AND holder_id IS NULL) OR (kind='CUSTODY' AND holder_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS finance_vault_per_branch ON finance.accounts (branch_id) WHERE kind='VAULT';
CREATE UNIQUE INDEX IF NOT EXISTS finance_custody_per_holder ON finance.accounts (branch_id, holder_id) WHERE kind='CUSTODY';

CREATE TABLE IF NOT EXISTS finance.expenses (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch_id BIGINT NOT NULL REFERENCES public.branches(id),
  category_id INTEGER NOT NULL REFERENCES public.expense_categories(id),
  category_snapshot VARCHAR(120) NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  expense_date DATE NOT NULL,
  description VARCHAR(180) NOT NULL CHECK (length(trim(description)) > 0),
  beneficiary VARCHAR(120),
  document_number VARCHAR(120),
  tax_amount NUMERIC(14,2),
  status VARCHAR(12) NOT NULL CHECK (status IN ('PENDING','APPROVED','PAID')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  requested_by BIGINT NOT NULL REFERENCES public.users(id),
  approved_by BIGINT REFERENCES public.users(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (tax_amount IS NULL OR (tax_amount >= 0 AND tax_amount <= amount)),
  CHECK ((status='PENDING' AND approved_by IS NULL AND approved_at IS NULL) OR
         (status IN ('APPROVED','PAID') AND approved_by IS NOT NULL AND approved_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS finance.payments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  expense_id BIGINT NOT NULL UNIQUE REFERENCES finance.expenses(id),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  method VARCHAR(16) NOT NULL CHECK (method IN ('CASH','CARD','BANK_TRANSFER','WALLET')),
  account_id BIGINT REFERENCES finance.accounts(id),
  payment_date DATE NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  recorded_by BIGINT NOT NULL REFERENCES public.users(id),
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
CREATE TABLE IF NOT EXISTS finance.expense_reviews (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  expense_id BIGINT NOT NULL REFERENCES finance.expenses(id),
  expense_revision INTEGER NOT NULL CHECK (expense_revision > 0),
  proposed_amount NUMERIC(14,2) CHECK (proposed_amount IS NULL OR proposed_amount >= 0),
  reason VARCHAR(300) NOT NULL CHECK (length(trim(reason)) > 0),
  original_snapshot JSONB NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CORRECTED','CLOSED')),
  created_by BIGINT NOT NULL REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_by BIGINT REFERENCES public.users(id),
  resolved_at TIMESTAMPTZ,
  resolution_reason VARCHAR(300),
  CHECK ((status='OPEN' AND resolved_by IS NULL AND resolved_at IS NULL AND resolution_reason IS NULL) OR
         (status IN ('CORRECTED','CLOSED') AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL AND resolution_reason IS NOT NULL AND length(trim(resolution_reason)) > 0))
);
CREATE UNIQUE INDEX IF NOT EXISTS finance_one_open_review_per_expense ON finance.expense_reviews(expense_id) WHERE status='OPEN';

-- Physical count requests are observations first; a second explicit action is
-- required before a discrepancy affects the ledger. A match is also recorded.
CREATE TABLE IF NOT EXISTS finance.cash_counts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES finance.accounts(id),
  counted_amount NUMERIC(14,2) NOT NULL CHECK (counted_amount >= 0),
  observed_balance NUMERIC(22,2) NOT NULL,
  difference NUMERIC(22,2) NOT NULL CHECK (difference = counted_amount-observed_balance),
  account_revision BIGINT NOT NULL CHECK (account_revision >= 0),
  counted_on DATE NOT NULL,
  reason VARCHAR(300) NOT NULL CHECK (length(trim(reason)) > 0),
  status VARCHAR(12) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CONFIRMED','CANCELLED')),
  created_by BIGINT NOT NULL REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_by BIGINT REFERENCES public.users(id),
  resolved_at TIMESTAMPTZ,
  resolution_reason VARCHAR(300),
  CHECK ((status='OPEN' AND resolved_by IS NULL AND resolved_at IS NULL AND resolution_reason IS NULL) OR
         (status IN ('CONFIRMED','CANCELLED') AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL AND resolution_reason IS NOT NULL AND length(trim(resolution_reason)) > 0))
);
CREATE UNIQUE INDEX IF NOT EXISTS finance_one_open_count_per_account ON finance.cash_counts(account_id) WHERE status='OPEN';

DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='finance' AND table_name='payments' AND column_name='after_cash_count_id') THEN
    ALTER TABLE finance.payments ADD COLUMN after_cash_count_id BIGINT REFERENCES finance.cash_counts(id);
    ALTER TABLE finance.payments ADD CONSTRAINT finance_payment_count_order
      CHECK (after_cash_count_id IS NULL OR (method='CASH' AND NOT historical));
  END IF;
END $guard$;

-- A verified correction never rewrites the opening anchor. If a later
-- confirmed count has already covered the difference, it is an auditable
-- historical annotation with *zero* new cash movement. Otherwise a single
-- book adjustment carries the difference; it is not a transfer of cash.
CREATE TABLE IF NOT EXISTS finance.opening_corrections (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES finance.accounts(id),
  before_amount NUMERIC(14,2) NOT NULL CHECK (before_amount >= 0),
  after_amount NUMERIC(14,2) NOT NULL CHECK (after_amount >= 0 AND after_amount <> before_amount),
  book_difference NUMERIC(22,2) NOT NULL CHECK (book_difference = after_amount-before_amount),
  resolution VARCHAR(16) NOT NULL CHECK (resolution IN ('BOOK','COUNT_COVERED')),
  covered_count_id BIGINT REFERENCES finance.cash_counts(id),
  balance_before NUMERIC(22,2) NOT NULL,
  balance_after NUMERIC(22,2) NOT NULL,
  reason VARCHAR(300) NOT NULL CHECK (length(trim(reason)) > 0),
  created_by BIGINT NOT NULL REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((resolution='BOOK' AND covered_count_id IS NULL AND balance_after=balance_before+book_difference) OR
         (resolution='COUNT_COVERED' AND covered_count_id IS NOT NULL AND balance_after=balance_before))
);
CREATE INDEX IF NOT EXISTS finance_opening_correction_account ON finance.opening_corrections(account_id,id);

-- The commerce bridge writes these *together* with the original CASH
-- collection/refund row. The user attests the real event preceded and is
-- included in the selected checkpoint. There is deliberately no cash movement.
-- The engine cannot independently prove the real-world event or detect a
-- duplicate deliberately entered with a different request ID.
CREATE TABLE IF NOT EXISTS finance.historical_commerce (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type VARCHAR(12) NOT NULL CHECK (event_type IN ('COLLECTION','REFUND')),
  event_id BIGINT NOT NULL,
  sale_id BIGINT NOT NULL,
  branch_id BIGINT NOT NULL REFERENCES public.branches(id),
  account_id BIGINT NOT NULL REFERENCES finance.accounts(id),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  actual_date DATE NOT NULL,
  checkpoint_type VARCHAR(8) NOT NULL CHECK (checkpoint_type IN ('OPENING','COUNT')),
  checkpoint_count_id BIGINT REFERENCES finance.cash_counts(id),
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
  created_by BIGINT NOT NULL REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (actual_date <= checkpoint_date),
  CHECK ((checkpoint_type='OPENING' AND checkpoint_count_id IS NULL) OR (checkpoint_type='COUNT' AND checkpoint_count_id IS NOT NULL)),
  UNIQUE (event_type,event_id)
);
CREATE INDEX IF NOT EXISTS finance_historical_sale ON finance.historical_commerce(sale_id,id);

-- Uncertain situations are saved as *claims*, not financial events. There may
-- be several unrelated historical claims on one invoice; an opening account
-- has at most one open case. Only a separately confirmed linked operation or an
-- explicit no-change closure resolves a case. No cascade/deletion is provided.
CREATE TABLE IF NOT EXISTS finance.reconciliation_cases (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind VARCHAR(12) NOT NULL CHECK (kind IN ('OPENING','COLLECTION','REFUND')),
  branch_id BIGINT NOT NULL REFERENCES public.branches(id),
  account_id BIGINT REFERENCES finance.accounts(id),
  sale_id BIGINT, -- application bridge verifies invoice and branch in the same transaction
  proposed_amount NUMERIC(14,2) CHECK (proposed_amount IS NULL OR proposed_amount >= 0),
  possible_date DATE,
  possible_handler VARCHAR(120),
  reason VARCHAR(300) NOT NULL CHECK (length(trim(reason)) > 0),
  opening_snapshot NUMERIC(14,2),
  balance_snapshot NUMERIC(22,2),
  status VARCHAR(12) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CONFIRMED','CLOSED')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by BIGINT NOT NULL REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_by BIGINT REFERENCES public.users(id),
  resolved_at TIMESTAMPTZ,
  resolution_reason VARCHAR(300),
  opening_correction_id BIGINT UNIQUE REFERENCES finance.opening_corrections(id),
  historical_id BIGINT UNIQUE REFERENCES finance.historical_commerce(id),
  CHECK ((kind='OPENING' AND account_id IS NOT NULL AND sale_id IS NULL AND possible_date IS NULL AND possible_handler IS NULL AND opening_snapshot IS NOT NULL AND balance_snapshot IS NOT NULL) OR
         (kind IN ('COLLECTION','REFUND') AND sale_id IS NOT NULL AND opening_snapshot IS NULL AND balance_snapshot IS NULL AND (proposed_amount IS NULL OR proposed_amount > 0))),
  CHECK ((status='OPEN' AND resolved_by IS NULL AND resolved_at IS NULL AND resolution_reason IS NULL AND opening_correction_id IS NULL AND historical_id IS NULL) OR
         (status='CLOSED' AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL AND resolution_reason IS NOT NULL AND length(trim(resolution_reason)) > 0 AND opening_correction_id IS NULL AND historical_id IS NULL) OR
         (status='CONFIRMED' AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL AND resolution_reason IS NOT NULL AND length(trim(resolution_reason)) > 0 AND
          ((kind='OPENING' AND opening_correction_id IS NOT NULL AND historical_id IS NULL) OR
           (kind IN ('COLLECTION','REFUND') AND historical_id IS NOT NULL AND opening_correction_id IS NULL))))
);
CREATE UNIQUE INDEX IF NOT EXISTS finance_one_open_opening_case ON finance.reconciliation_cases(account_id) WHERE kind='OPENING' AND status='OPEN';
CREATE INDEX IF NOT EXISTS finance_reconciliation_sale ON finance.reconciliation_cases(sale_id,id);
CREATE TABLE IF NOT EXISTS finance.reconciliation_notes (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id BIGINT NOT NULL REFERENCES finance.reconciliation_cases(id),
  note VARCHAR(300) NOT NULL CHECK (length(trim(note)) > 0),
  created_by BIGINT NOT NULL REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS finance_reconciliation_notes_case ON finance.reconciliation_notes(case_id,id);

-- Append-only *book* correction after an explicit review. The original expense,
-- payment and original movement remain untouched; this is never a cash refund.
CREATE TABLE IF NOT EXISTS finance.expense_corrections (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  expense_id BIGINT NOT NULL REFERENCES finance.expenses(id),
  payment_id BIGINT NOT NULL REFERENCES finance.payments(id),
  review_id BIGINT NOT NULL UNIQUE REFERENCES finance.expense_reviews(id),
  before_amount NUMERIC(14,2) NOT NULL CHECK (before_amount > 0),
  after_amount NUMERIC(14,2) NOT NULL CHECK (after_amount > 0 AND after_amount <> before_amount),
  reason VARCHAR(300) NOT NULL CHECK (length(trim(reason)) > 0),
  account_id BIGINT REFERENCES finance.accounts(id),
  book_difference NUMERIC(22,2),
  balance_before NUMERIC(22,2),
  balance_after NUMERIC(22,2),
  created_by BIGINT NOT NULL REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((account_id IS NULL AND book_difference IS NULL AND balance_before IS NULL AND balance_after IS NULL) OR
         (account_id IS NOT NULL AND book_difference IS NOT NULL AND balance_before IS NOT NULL AND balance_after IS NOT NULL AND
          book_difference=before_amount-after_amount AND balance_after=balance_before+book_difference))
);
CREATE INDEX IF NOT EXISTS finance_correction_expense ON finance.expense_corrections(expense_id,id);

-- One movement is a transfer between two accounts, or a cash inflow/outflow.
-- It is not an additional sale or revenue event. Old payments are never backfilled.
CREATE TABLE IF NOT EXISTS finance.movements (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind VARCHAR(20) NOT NULL CHECK (kind IN ('TRANSFER','EXPENSE','COLLECTION','REFUND','COUNT_ADJUSTMENT','EXPENSE_CORRECTION','OPENING_CORRECTION')),
  branch_id BIGINT NOT NULL REFERENCES public.branches(id),
  source_id BIGINT REFERENCES finance.accounts(id),
  destination_id BIGINT REFERENCES finance.accounts(id),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  expense_payment_id BIGINT UNIQUE REFERENCES finance.payments(id),
  cash_count_id BIGINT UNIQUE REFERENCES finance.cash_counts(id),
  expense_correction_id BIGINT UNIQUE REFERENCES finance.expense_corrections(id),
  opening_correction_id BIGINT UNIQUE REFERENCES finance.opening_corrections(id),
  after_cash_count_id BIGINT REFERENCES finance.cash_counts(id),
  after_opening BOOLEAN NOT NULL DEFAULT FALSE,
  external_ref VARCHAR(80),
  actor_id BIGINT NOT NULL REFERENCES public.users(id),
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
CREATE UNIQUE INDEX IF NOT EXISTS finance_movement_external_key ON finance.movements (kind, external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS finance_movement_source ON finance.movements (source_id, id);
CREATE INDEX IF NOT EXISTS finance_movement_destination ON finance.movements (destination_id, id);

-- Shared idempotency keys cover all finance commands; no duplicate request creates a second movement.
CREATE TABLE IF NOT EXISTS finance.requests (
  request_id UUID PRIMARY KEY,
  request_hash CHAR(64) NOT NULL,
  actor_id BIGINT NOT NULL REFERENCES public.users(id),
  action VARCHAR(40) NOT NULL,
  result_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS finance.audit_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_type VARCHAR(20) NOT NULL,
  entity_id BIGINT NOT NULL,
  action VARCHAR(24) NOT NULL,
  actor_id BIGINT NOT NULL REFERENCES public.users(id),
  reason VARCHAR(300),
  before_data JSONB,
  after_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS finance_audit_entity ON finance.audit_events(entity_type, entity_id, id);

-- Category metadata for the EXISTING public.expense_categories table.
-- Categories themselves are not copied, renamed or rewritten.
-- Existing categories have unknown origin, so an absent row means revision 1;
-- do not invent a creator or timestamp. This table is filled only on an actual
-- test operation, not by the candidate migration.
CREATE TABLE IF NOT EXISTS finance.category_revisions (
  category_id INTEGER PRIMARY KEY REFERENCES public.expense_categories(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision > 0),
  created_by BIGINT REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ,
  updated_by BIGINT REFERENCES public.users(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ,
  CHECK ((created_by IS NULL) = (created_at IS NULL)),
  CHECK ((updated_by IS NULL) = (updated_at IS NULL))
);

CREATE TABLE IF NOT EXISTS finance.category_audit (
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
CREATE TABLE IF NOT EXISTS finance.category_requests (
  request_id UUID PRIMARY KEY,
  request_hash CHAR(64) NOT NULL,
  actor_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  action VARCHAR(8) NOT NULL CHECK (action IN ('CREATE','EDIT')),
  category_id INTEGER NOT NULL REFERENCES public.expense_categories(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Record the applied script. A replay with the same checksum is a no-op; the
-- same script name with a different checksum is refused instead of diverging.
-- The checksum covers this file with the literal below replaced by zeros, so it
-- stays verifiable; the tests recompute it the same way.
DO $$
DECLARE previous CHAR(64);
BEGIN
  SELECT checksum INTO previous FROM finance_release.migrations WHERE name='finance_release_upgrade';
  IF previous IS NOT NULL AND previous <> '6f00bfa0054533e8d653ca93d9ef9d176437d838b06b1ea990ad98f95eef0ed8' THEN
    RAISE EXCEPTION 'finance release candidate checksum changed since it was applied';
  END IF;
  INSERT INTO finance_release.migrations(name,checksum) VALUES ('finance_release_upgrade','6f00bfa0054533e8d653ca93d9ef9d176437d838b06b1ea990ad98f95eef0ed8')
    ON CONFLICT (name) DO NOTHING;
END $$;

COMMIT;
