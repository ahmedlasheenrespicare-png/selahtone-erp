-- ترقية «عهدة الموظف وتسوية الإجمالي» — ملف يدوي، لا يُشغَّل إلا بموافقة منفصلة.
--
-- لماذا أولًا: الكود الذي يقرأ هذه الجداول والأعمدة لا يُنشر إلا بعد تشغيل هذا الملف،
-- حتى لا يتعطل الموقع لحظة النشر (نفس الترتيب المعتَمَد في ترقية نطاق القائمة).
--
-- ما يفعله (إضافة فقط، بلا حذف ولا تعديل أي صف قائم):
--   ١) جدول finance.settlements لطلبات التسوية + قيد تفرد لطلب مفتوح واحد لكل عهدة.
--   ٢) عمود finance.movements.settlement_id ونوع حركة جديد 'SETTLEMENT'.
--   ٣) عمود finance.payments.source للتفريق بين «نقد الموظف يُسوّى» و«خصم فوري من حساب».
--
-- القيود المُوسَّعة أوسع من السابقة (إضافة حالة جديدة فقط)، فكل الصفوف القائمة تبقى صالحة.
--
-- التراجع (عند الحاجة فقط وبموافقة منفصلة):
--   DROP INDEX IF EXISTS finance_one_open_settlement_per_account;
--   DROP TABLE IF EXISTS finance.settlements;
--   ALTER TABLE finance.movements DROP COLUMN IF EXISTS settlement_id;
--   ALTER TABLE finance.payments DROP COLUMN IF EXISTS source;
--   -- ثم إعادة قيدَي kind وshape إلى نصّهما السابق (بدون SETTLEMENT).

BEGIN;

-- ١) جدول طلبات التسوية --------------------------------------------------------
CREATE TABLE IF NOT EXISTS finance.settlements (
  id                     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id             BIGINT NOT NULL REFERENCES finance.accounts(id),
  branch_id              BIGINT NOT NULL REFERENCES public.branches(id),
  requested_by           BIGINT NOT NULL REFERENCES public.users(id),
  system_balance         NUMERIC(22,2) NOT NULL,
  counted_amount         NUMERIC(14,2) NOT NULL CHECK (counted_amount >= 0),
  sales_total            NUMERIC(22,2) NOT NULL,
  expenses_total         NUMERIC(22,2) NOT NULL,
  expected_amount        NUMERIC(22,2) NOT NULL,
  deviation              NUMERIC(22,2) NOT NULL,
  adjustment             NUMERIC(22,2) NOT NULL,
  status                 VARCHAR(12) NOT NULL DEFAULT 'OPEN'
                         CHECK (status IN ('OPEN', 'CONFIRMED', 'REJECTED', 'CANCELLED')),
  reason                 VARCHAR(300) NOT NULL CHECK (length(trim(reason)) > 0),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_by            BIGINT REFERENCES public.users(id),
  resolved_at            TIMESTAMPTZ,
  resolution_reason      VARCHAR(300),
  transfer_amount        NUMERIC(14,2) CHECK (transfer_amount IS NULL OR transfer_amount >= 0),
  transfer_direction     VARCHAR(10) CHECK (transfer_direction IN ('TO_VAULT', 'TO_CUSTODY')),
  adjustment_movement_id BIGINT REFERENCES finance.movements(id),
  handover_movement_id   BIGINT REFERENCES finance.movements(id),
  CHECK ((status = 'OPEN' AND resolved_by IS NULL AND resolved_at IS NULL
          AND resolution_reason IS NULL AND transfer_amount IS NULL AND transfer_direction IS NULL) OR
         (status <> 'OPEN' AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL
          AND resolution_reason IS NOT NULL AND length(trim(resolution_reason)) > 0)),
  CHECK (status <> 'CONFIRMED' OR (transfer_amount IS NOT NULL AND transfer_direction IS NOT NULL)),
  CHECK (adjustment = counted_amount - system_balance)
);

CREATE UNIQUE INDEX IF NOT EXISTS finance_one_open_settlement_per_account
  ON finance.settlements (account_id) WHERE status = 'OPEN';

CREATE INDEX IF NOT EXISTS finance_settlement_account
  ON finance.settlements (account_id, id DESC);

-- ٢) عمود الحركة + نوع 'SETTLEMENT' -------------------------------------------
-- التسوية تُنشئ حركتين: تسوية الدفتر مع الواقع، وتحويل الفرق؛ فالمرجع ليس فريدًا.
ALTER TABLE finance.movements
  ADD COLUMN IF NOT EXISTS settlement_id BIGINT REFERENCES finance.settlements(id);

CREATE INDEX IF NOT EXISTS finance_movement_settlement
  ON finance.movements (settlement_id) WHERE settlement_id IS NOT NULL;

-- PostgreSQL يسمّي القيد المجهول تلقائيًا (movements_kind_check) ويخزّن قائمة IN
-- بصيغة =ANY(ARRAY[...])، لذا يُسقط القيدان أيًا كان اسمهما أو صيغتهما المخزّنة.
ALTER TABLE finance.movements DROP CONSTRAINT IF EXISTS movements_kind_check;
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = 'finance.movements'::regclass AND contype = 'c'
  LOOP
    -- قيد قائمة الأنواع، وقيد شكل الحركة لكل نوع (كلاهما يذكر TRANSFER).
    IF c.def ILIKE '%TRANSFER%' THEN
      EXECUTE format('ALTER TABLE finance.movements DROP CONSTRAINT %I', c.conname);
    END IF;
  END LOOP;
END $$;

ALTER TABLE finance.movements
  ADD CONSTRAINT movements_kind_check CHECK (
    kind IN ('TRANSFER','EXPENSE','COLLECTION','REFUND','COUNT_ADJUSTMENT',
             'EXPENSE_CORRECTION','OPENING_CORRECTION','SETTLEMENT'));

ALTER TABLE finance.movements
  ADD CONSTRAINT movements_shape_check CHECK (
    -- حركة TRANSFER قد تُرتبط بطلب تسوية (تحويل الفرق) أو تكون تسليمًا عاديًا بلا طلب.
    (kind='TRANSFER' AND source_id IS NOT NULL AND destination_id IS NOT NULL
      AND expense_payment_id IS NULL AND cash_count_id IS NULL AND expense_correction_id IS NULL
      AND opening_correction_id IS NULL AND external_ref IS NULL) OR
    (kind='EXPENSE' AND source_id IS NOT NULL AND destination_id IS NULL
      AND expense_payment_id IS NOT NULL AND cash_count_id IS NULL AND expense_correction_id IS NULL
      AND opening_correction_id IS NULL AND external_ref IS NULL AND settlement_id IS NULL) OR
    (kind='COLLECTION' AND source_id IS NULL AND destination_id IS NOT NULL
      AND expense_payment_id IS NULL AND cash_count_id IS NULL AND expense_correction_id IS NULL
      AND opening_correction_id IS NULL AND external_ref IS NOT NULL AND settlement_id IS NULL) OR
    (kind='REFUND' AND source_id IS NOT NULL AND destination_id IS NULL
      AND expense_payment_id IS NULL AND cash_count_id IS NULL AND expense_correction_id IS NULL
      AND opening_correction_id IS NULL AND external_ref IS NOT NULL AND settlement_id IS NULL) OR
    (kind='COUNT_ADJUSTMENT' AND (source_id IS NULL) <> (destination_id IS NULL)
      AND expense_payment_id IS NULL AND cash_count_id IS NOT NULL AND expense_correction_id IS NULL
      AND opening_correction_id IS NULL AND external_ref IS NULL AND settlement_id IS NULL) OR
    (kind='EXPENSE_CORRECTION' AND (source_id IS NULL) <> (destination_id IS NULL)
      AND expense_payment_id IS NULL AND cash_count_id IS NULL AND expense_correction_id IS NOT NULL
      AND opening_correction_id IS NULL AND external_ref IS NULL AND settlement_id IS NULL) OR
    (kind='OPENING_CORRECTION' AND (source_id IS NULL) <> (destination_id IS NULL)
      AND expense_payment_id IS NULL AND cash_count_id IS NULL AND expense_correction_id IS NULL
      AND opening_correction_id IS NOT NULL AND external_ref IS NULL AND settlement_id IS NULL) OR
    (kind='SETTLEMENT' AND (source_id IS NULL) <> (destination_id IS NULL)
      AND expense_payment_id IS NULL AND cash_count_id IS NULL AND expense_correction_id IS NULL
      AND opening_correction_id IS NULL AND external_ref IS NULL AND settlement_id IS NOT NULL)
  );

-- ٣) مصدر صرف المصروف ---------------------------------------------------------
ALTER TABLE finance.payments
  ADD COLUMN IF NOT EXISTS source VARCHAR(16) NOT NULL DEFAULT 'ACCOUNT'
  CHECK (source IN ('ACCOUNT', 'HOLDER_CASH'));

DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = 'finance.payments'::regclass AND contype = 'c'
  LOOP
    IF c.def ILIKE '%account_id IS NOT NULL%' AND c.def ILIKE '%CASH%' THEN
      EXECUTE format('ALTER TABLE finance.payments DROP CONSTRAINT %I', c.conname);
    END IF;
  END LOOP;
END $$;

-- النقدي: إمّا من حساب (خصم فوري) أو من نقد الموظف (يُسوّى في التسوية). غير النقدي: بلا حساب.
ALTER TABLE finance.payments
  ADD CONSTRAINT payments_cash_source_check CHECK (
    (method = 'CASH' AND ((account_id IS NOT NULL AND source = 'ACCOUNT') OR
                          (account_id IS NULL AND source = 'HOLDER_CASH'))) OR
    (method <> 'CASH' AND account_id IS NULL AND source = 'ACCOUNT')
  );

COMMIT;

-- تحقق بعد التنفيذ -------------------------------------------------------------
SELECT jsonb_build_object(
  'checked_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'database', current_database(),
  'settlements_table', (
    SELECT count(*)::int FROM information_schema.tables
    WHERE table_schema = 'finance' AND table_name = 'settlements'),
  'settlement_index', (
    SELECT count(*)::int FROM pg_class WHERE relname = 'finance_one_open_settlement_per_account'),
  'movement_settlement_column', (
    SELECT count(*)::int FROM information_schema.columns
    WHERE table_schema = 'finance' AND table_name = 'movements' AND column_name = 'settlement_id'),
  'settlement_kind_allowed', (
    SELECT count(*)::int FROM pg_constraint
    WHERE conname = 'movements_kind_check'
      AND pg_get_constraintdef(oid) ILIKE '%SETTLEMENT%'),
  'payments_source_column', (
    SELECT count(*)::int FROM information_schema.columns
    WHERE table_schema = 'finance' AND table_name = 'payments' AND column_name = 'source'),
  'rows', jsonb_build_object(
    'accounts', (SELECT count(*)::int FROM finance.accounts),
    'movements', (SELECT count(*)::int FROM finance.movements),
    'settlements', (SELECT count(*)::int FROM finance.settlements),
    'payments', (SELECT count(*)::int FROM finance.payments))
)::text AS settlement_upgrade;
