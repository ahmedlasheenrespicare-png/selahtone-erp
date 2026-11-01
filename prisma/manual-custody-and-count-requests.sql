-- ============================================================================
-- طلب العهدة · وطلب الجرد الموجَّه
-- ----------------------------------------------------------------------------
-- ميزتان لا إصلاحان، كشفهما اختبارُ النظام خطوةً بخطوة:
--
--   1. العهدة لا يفتحها الموظف لنفسه؛ فتحها حِكرٌ على المدير والمحاسب. فإن
--      أراد موظفٌ عهدة فليس له إلا أن يطلبها شفويًّا. فصار له بابٌ يقرعه.
--   2. الجرد يسجّله المدير وحده، والعهدة في يد الموظف — أي أنّ المدير يكتب
--      روايةً عن يدٍ لا يشهدها. فصار الجردُ طلبًا موجَّهًا: المدير يطلب،
--      والموظف يعدّ ويُقرّ، والمدير يؤكد.
--
-- أثر هذا الملف: لا يغيّر سلوكًا قائمًا. فهو يضيف جدولًا جديدًا وثلاثة
-- أعمدة، ولا يمسّ قيدًا ولا يعدّل حالة. وكل إضافةٍ مشروطة بـIF NOT EXISTS
-- فيما يقبلها، وبـto_regclass فيما لا يقبله، فيمكن إعادةُ تنفيذه بأمان.
-- ============================================================================

BEGIN;

-- ١) طلب العهدة: يقدّمه الموظف، ويبتّ فيه المدير أو المحاسب
CREATE TABLE IF NOT EXISTS finance.custody_requests (
  id                BIGSERIAL PRIMARY KEY,
  branch_id         BIGINT        NOT NULL REFERENCES public.branches(id),
  requester_id      BIGINT        NOT NULL REFERENCES public.users(id),
  requested_amount  NUMERIC(14,2) NOT NULL,
  reason            TEXT          NOT NULL,
  status            TEXT          NOT NULL DEFAULT 'PENDING',
  decided_by        BIGINT        REFERENCES public.users(id),
  decided_at        TIMESTAMPTZ,
  decision_reason   TEXT,
  account_id        BIGINT        REFERENCES finance.accounts(id),
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- طلبٌ واحدٌ معلَّق لكل موظف: فلا تتكدّس الطلبات بضغطاتٍ متكررة
CREATE UNIQUE INDEX IF NOT EXISTS finance_custody_request_one_pending
  ON finance.custody_requests (requester_id) WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS finance_custody_request_branch_status
  ON finance.custody_requests (branch_id, status, created_at DESC);

-- ٢) الجرد الموجَّه: أعمدة على الجرد القائم بلا تعديلِ حالاتِه
--    counter_id فارغ ⇒ بانتظار أن يعدّ الموظف
--    counter_id ممتلئ ⇒ عدّه، وهو بانتظار تأكيد المدير
ALTER TABLE finance.cash_counts ADD COLUMN IF NOT EXISTS counter_id      BIGINT REFERENCES public.users(id);
ALTER TABLE finance.cash_counts ADD COLUMN IF NOT EXISTS requested_by    BIGINT REFERENCES public.users(id);
ALTER TABLE finance.cash_counts ADD COLUMN IF NOT EXISTS request_reason  TEXT;

CREATE INDEX IF NOT EXISTS finance_cash_counts_counter_open
  ON finance.cash_counts (counter_id) WHERE status = 'OPEN';

COMMIT;

-- تقرير التحقق: الأعمدة والجدول كما ينبغي
SELECT 'finance.custody_requests' AS "الجدول", count(*)::text AS "الصفوف"
  FROM finance.custody_requests
UNION ALL
SELECT 'finance.cash_counts', count(*)::text FROM finance.cash_counts;

SELECT column_name AS "العمود الجديد", data_type AS "النوع"
  FROM information_schema.columns
  WHERE table_schema = 'finance' AND table_name = 'cash_counts'
    AND column_name IN ('counter_id', 'requested_by', 'request_reason')
  ORDER BY 1;
