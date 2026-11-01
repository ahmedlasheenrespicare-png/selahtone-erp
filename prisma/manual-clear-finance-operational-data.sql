-- ============================================================================
-- مسح بيانات التجربة في الوحدة المالية (مخطط finance) — الإصدار الثالث
-- ----------------------------------------------------------------------------
-- الإصدار الأول: ترتيبٌ من جمل CREATE TABLE فأغفل ما أُضيف بـALTER TABLE ⇒ 23503
-- الإصدار الثاني: تفريغ أعمدة الارتباط لكسر الدورة ⇒ 23514، إذ يشترط القيد
--   movements_shape_check أن تشير حركة التسوية إلى تسوية، فالتفريغ يجعلها
--   غير متسقة فيُرفض.
--
-- الإصدار الثالث: لا يعتمد على خاصيةٍ لم تتحقق منها. الدورة بين movements
-- و settlements تُكسر بحذفهما معًا في بيان TRUNCATE واحد:
--   TRUNCATE finance.movements, finance.settlements;
-- فيُمحى الاثنان معًا بلا حالةٍ وسيطة، وبلا CASCADE، لأن أحدًا غيرهما لا
-- يشير إليهما — فلا يمسح البيان إلّا ما سُمِّي فيه. وهو داخل المعاملة فيجري
-- له ما يجري لسائرها من تراجعٍ إن فشل سطر.
--
-- المستثنى: الخزائن (accounts) والسجلات الثلاثة.
--
-- الأمان: DELETE لبقية الجداول · TRUNCATE بلا CASCADE للجدولين المتعالقين فقط
-- معاملة واحدة · to_regclass لكل جدول فما لم يُطبَّق ترحيله يُتجاوز.
-- ============================================================================

BEGIN;
DO $clr$ BEGIN IF to_regclass('finance.category_requests') IS NOT NULL THEN DELETE FROM finance.category_requests; END IF; END $clr$;
DO $clr$ BEGIN IF to_regclass('finance.reconciliation_notes') IS NOT NULL THEN DELETE FROM finance.reconciliation_notes; END IF; END $clr$;
DO $clr$ BEGIN IF to_regclass('finance.requests') IS NOT NULL THEN DELETE FROM finance.requests; END IF; END $clr$;
DO $clr$ BEGIN IF to_regclass('finance.reconciliation_cases') IS NOT NULL THEN DELETE FROM finance.reconciliation_cases; END IF; END $clr$;
DO $clr$ BEGIN IF to_regclass('finance.historical_commerce') IS NOT NULL THEN DELETE FROM finance.historical_commerce; END IF; END $clr$;
DO $clr$ BEGIN IF to_regclass('finance.expense_corrections') IS NOT NULL THEN DELETE FROM finance.expense_corrections; END IF; END $clr$;
DO $clr$ BEGIN IF to_regclass('finance.expense_reviews') IS NOT NULL THEN DELETE FROM finance.expense_reviews; END IF; END $clr$;
DO $clr$ BEGIN IF to_regclass('finance.opening_corrections') IS NOT NULL THEN DELETE FROM finance.opening_corrections; END IF; END $clr$;
DO $clr$ BEGIN IF to_regclass('finance.payments') IS NOT NULL THEN DELETE FROM finance.payments; END IF; END $clr$;
DO $clr$ BEGIN IF to_regclass('finance.cash_counts') IS NOT NULL THEN DELETE FROM finance.cash_counts; END IF; END $clr$;
DO $clr$ BEGIN IF to_regclass('finance.expenses') IS NOT NULL THEN DELETE FROM finance.expenses; END IF; END $clr$;

-- الجدولان المتعالقان (دورة): يُحذفان معًا في بيان واحد، بلا CASCADE
DO $brk$ BEGIN
  IF to_regclass('finance.movements') IS NOT NULL AND to_regclass('finance.settlements') IS NOT NULL THEN
    TRUNCATE finance.movements, finance.settlements;
  END IF;
END $brk$;

COMMIT;

-- تقرير التحقق: الأصفار متوقعة إلا المستثناة
SELECT t.table_name AS "الجدول",
       (xpath('/row/c/text()',
          query_to_xml(format('select count(*) as c from %I.%I', t.table_schema, t.table_name),
                       false, true, '')))[1]::text::bigint AS "عدد الصفوف"
FROM information_schema.tables t
WHERE t.table_schema='finance' AND t.table_type='BASE TABLE'
ORDER BY 2 DESC, 1;
