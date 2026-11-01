-- ============================================================================
-- مسح بيانات التجربة التشغيلية في الوحدة المالية (مخطط finance)
-- ----------------------------------------------------------------------------
-- تُشغَّل بعد manual-clear-operational-data.sql (مخطط public).
--
-- ما لا يُمسح هنا:
--   · finance.audit_events و finance.category_audit — سجلات تدقيق،
--     وبقاعدة نافذة: السجلات لا تُمسح.
--   · finance.category_revisions — نسخ التصنيفات القديمة (أثر لا عملية).
--
-- الأمان:
--   · DELETE صريح لا TRUNCATE، وبلا CASCADE: فلا تجاوز صامت للقيود.
--   · الترتيب طوبولوجي: الأبناء قبل الآباء، مستخرج من قيود CREATE TABLE
--     نفسها. فـfinance.accounts (الخزائن) آخرًا؛ إذ تشير إليه ثمانية جداول.
--   · كل حذف داخل DO يتحقق بـto_regclass أولًا: فإن كان جدولٌ غير مطبَّق
--     ترحيلُه، تُتخطّى ولا يُلغى كل شيء (خلافًا لـDELETE المباشر).
--   · معاملة واحدة: إن فشل سطر أُلغي الكل ولم يُمسح شيء.
-- ============================================================================

BEGIN;

DO $clr$ BEGIN IF to_regclass('finance.category_requests') IS NOT NULL THEN DELETE FROM finance.category_requests; END IF; END $clr$;
DO $clr$ BEGIN IF to_regclass('finance.reconciliation_notes') IS NOT NULL THEN DELETE FROM finance.reconciliation_notes; END IF; END $clr$;
DO $clr$ BEGIN IF to_regclass('finance.requests') IS NOT NULL THEN DELETE FROM finance.requests; END IF; END $clr$;
DO $clr$ BEGIN IF to_regclass('finance.settlements') IS NOT NULL THEN DELETE FROM finance.settlements; END IF; END $clr$;
DO $clr$ BEGIN IF to_regclass('finance.movements') IS NOT NULL THEN DELETE FROM finance.movements; END IF; END $clr$;
DO $clr$ BEGIN IF to_regclass('finance.reconciliation_cases') IS NOT NULL THEN DELETE FROM finance.reconciliation_cases; END IF; END $clr$;
DO $clr$ BEGIN IF to_regclass('finance.expense_corrections') IS NOT NULL THEN DELETE FROM finance.expense_corrections; END IF; END $clr$;
DO $clr$ BEGIN IF to_regclass('finance.expense_reviews') IS NOT NULL THEN DELETE FROM finance.expense_reviews; END IF; END $clr$;
DO $clr$ BEGIN IF to_regclass('finance.historical_commerce') IS NOT NULL THEN DELETE FROM finance.historical_commerce; END IF; END $clr$;
DO $clr$ BEGIN IF to_regclass('finance.opening_corrections') IS NOT NULL THEN DELETE FROM finance.opening_corrections; END IF; END $clr$;
DO $clr$ BEGIN IF to_regclass('finance.payments') IS NOT NULL THEN DELETE FROM finance.payments; END IF; END $clr$;
DO $clr$ BEGIN IF to_regclass('finance.cash_counts') IS NOT NULL THEN DELETE FROM finance.cash_counts; END IF; END $clr$;
DO $clr$ BEGIN IF to_regclass('finance.expenses') IS NOT NULL THEN DELETE FROM finance.expenses; END IF; END $clr$;
DO $clr$ BEGIN IF to_regclass('finance.accounts') IS NOT NULL THEN DELETE FROM finance.accounts; END IF; END $clr$;

COMMIT;

-- ============================================================================
-- تقرير التحقق: الأصفار متوقعة في كل جدول (إلا المستثناة الثلاثة)
-- ============================================================================
SELECT t.table_name AS "الجدول",
       (xpath('/row/c/text()',
          query_to_xml(format('select count(*) as c from %I.%I', t.table_schema, t.table_name),
                       false, true, '')))[1]::text::bigint AS "عدد الصفوف"
FROM information_schema.tables t
WHERE t.table_schema = 'finance' AND t.table_type = 'BASE TABLE'
ORDER BY 2 DESC, 1;

