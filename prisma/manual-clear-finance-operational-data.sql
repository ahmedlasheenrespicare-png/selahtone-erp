-- ============================================================================
-- مسح بيانات التجربة في الوحدة المالية (مخطط finance) — الإصدار الرابع
-- ----------------------------------------------------------------------------
-- تاريخ الأخطاء الثلاثة، فإن في كلٍّ منها درسًا:
--   الأول  (23503): ترتيبٌ من CREATE TABLE فأغفل قيدًا أُضيف بـALTER TABLE.
--   الثاني (23514): تفريغ أعمدة الارتباط فمنعه قيد تحقق، والحل كان رهانًا
--                   على خاصيةٍ لم تتحقق.
--   الثالث (23503): وُضع الجدولان المتعالقان في آخر الأمر، وmovements ابنٌ
--                   لخزينة الجرد والمدفوعات والتصحيحات، فحُذف الأب قبل ابنه.
--
-- والرابع: الترتيب محسوب من القيود كلها، ومتحقَّقٌ منه آليًّا — أن كل جدولٍ
-- يسبق كل أبٍ له — قبل أن يُكتب. والدورة بين movements و settlements تُعامل
-- كعقدةٍ واحدة (بيان TRUNCATE واحد) فلا يعود لها أثر في الترتيب.
--
-- المستثنى: الخزائن (accounts) والسجلات الثلاثة.
-- الأمان: معاملة واحدة · to_regclass لكل جدول · TRUNCATE بلا CASCADE.
-- ============================================================================

BEGIN;
-- الحركات والتسويات: بينهما دورة، فيُحذفان معًا ببيان واحد وبلا CASCADE
DO $brk$ BEGIN
  IF to_regclass('finance.movements') IS NOT NULL AND to_regclass('finance.settlements') IS NOT NULL THEN
    TRUNCATE finance.movements, finance.settlements;
  END IF;
END $brk$;
DO $clr$ BEGIN IF to_regclass('finance.category_requests') IS NOT NULL THEN DELETE FROM finance.category_requests; END IF; END $clr$;
DO $clr$ BEGIN IF to_regclass('finance.expense_corrections') IS NOT NULL THEN DELETE FROM finance.expense_corrections; END IF; END $clr$;
DO $clr$ BEGIN IF to_regclass('finance.expense_reviews') IS NOT NULL THEN DELETE FROM finance.expense_reviews; END IF; END $clr$;
DO $clr$ BEGIN IF to_regclass('finance.payments') IS NOT NULL THEN DELETE FROM finance.payments; END IF; END $clr$;
DO $clr$ BEGIN IF to_regclass('finance.reconciliation_notes') IS NOT NULL THEN DELETE FROM finance.reconciliation_notes; END IF; END $clr$;
DO $clr$ BEGIN IF to_regclass('finance.requests') IS NOT NULL THEN DELETE FROM finance.requests; END IF; END $clr$;
DO $clr$ BEGIN IF to_regclass('finance.expenses') IS NOT NULL THEN DELETE FROM finance.expenses; END IF; END $clr$;
DO $clr$ BEGIN IF to_regclass('finance.reconciliation_cases') IS NOT NULL THEN DELETE FROM finance.reconciliation_cases; END IF; END $clr$;
DO $clr$ BEGIN IF to_regclass('finance.historical_commerce') IS NOT NULL THEN DELETE FROM finance.historical_commerce; END IF; END $clr$;
DO $clr$ BEGIN IF to_regclass('finance.opening_corrections') IS NOT NULL THEN DELETE FROM finance.opening_corrections; END IF; END $clr$;
DO $clr$ BEGIN IF to_regclass('finance.cash_counts') IS NOT NULL THEN DELETE FROM finance.cash_counts; END IF; END $clr$;

COMMIT;

-- تقرير التحقق: الأصفار متوقعة إلا المستثناة
SELECT t.table_name AS "الجدول",
       (xpath('/row/c/text()',
          query_to_xml(format('select count(*) as c from %I.%I', t.table_schema, t.table_name),
                       false, true, '')))[1]::text::bigint AS "عدد الصفوف"
FROM information_schema.tables t
WHERE t.table_schema='finance' AND t.table_type='BASE TABLE'
ORDER BY 2 DESC, 1;
