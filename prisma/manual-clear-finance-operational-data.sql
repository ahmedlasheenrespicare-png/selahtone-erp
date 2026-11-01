-- ============================================================================
-- مسح بيانات التجربة في الوحدة المالية (مخطط finance)
-- ----------------------------------------------------------------------------
-- مبني على القيود الفعلية المقروءة من قاعدة البيانات (٦٩ قيدًا)، لا على ملفات
-- الترحيل: فقد أُضيف بعضُها بـALTER TABLE بعد إنشاء الجدول، فأغفله مصدرٌ سابق
-- وفشل المسح بخطأ 23503.
--
-- الدورة: finance.movements و finance.settlements يشير كلٌّ منهما إلى الآخر:
--   movements.settlement_id          → settlements
--   settlements.handover_movement_id → movements
--   settlements.adjustment_movement_id → movements
-- فلا ترتيب حذفٍ ينجح: حذف أيٍّ منهما أولًا يمنعه الآخر. لذلك تُفرَّغ أعمدة
-- الارتباط أولًا (تفريغ ارتباط لا تغيير بيانات)، ثم يُحذف كل جدول.
--
-- المستثنى: الخزائن (accounts) بنصيحةٍ سابقة، والسجلات (audit_events،
-- category_audit، category_revisions) فحرمة السجلات قائمة.
--
-- الأمان: DELETE لا TRUNCATE وبلا CASCADE · معاملة واحدة (إن فشل سطر أُلغي
-- الكل) · to_regclass لكل جدول فما لم يُطبَّق ترحيله يُتجاوز ولا يُبطل
-- المعاملة · UPDATE لتفريغ الارتباط مشروط بكون العمود يقبل الفراغ.
-- ============================================================================

BEGIN;

-- ٠) كسر الدورة: تفريغ أعمدة الارتباط بين movements و settlements
DO $brk$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='finance' AND table_name='movements'
               AND column_name='settlement_id' AND is_nullable='YES')
  THEN UPDATE finance.movements SET settlement_id = NULL WHERE settlement_id IS NOT NULL; END IF;
END $brk$;
DO $brk$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='finance' AND table_name='settlements'
               AND column_name='handover_movement_id' AND is_nullable='YES')
  THEN UPDATE finance.settlements SET handover_movement_id = NULL WHERE handover_movement_id IS NOT NULL; END IF;
END $brk$;
DO $brk$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='finance' AND table_name='settlements'
               AND column_name='adjustment_movement_id' AND is_nullable='YES')
  THEN UPDATE finance.settlements SET adjustment_movement_id = NULL WHERE adjustment_movement_id IS NOT NULL; END IF;
END $brk$;

-- ١) الحذف: الأبناء قبل الآباء، بالترتيب المستخرج من القيود
DO $clr$ BEGIN IF to_regclass('finance.category_requests') IS NOT NULL THEN DELETE FROM finance.category_requests; END IF; END $clr$;
DO $clr$ BEGIN IF to_regclass('finance.reconciliation_notes') IS NOT NULL THEN DELETE FROM finance.reconciliation_notes; END IF; END $clr$;
DO $clr$ BEGIN IF to_regclass('finance.requests') IS NOT NULL THEN DELETE FROM finance.requests; END IF; END $clr$;
DO $clr$ BEGIN IF to_regclass('finance.reconciliation_cases') IS NOT NULL THEN DELETE FROM finance.reconciliation_cases; END IF; END $clr$;
DO $clr$ BEGIN IF to_regclass('finance.historical_commerce') IS NOT NULL THEN DELETE FROM finance.historical_commerce; END IF; END $clr$;
DO $clr$ BEGIN IF to_regclass('finance.movements') IS NOT NULL THEN DELETE FROM finance.movements; END IF; END $clr$;
DO $clr$ BEGIN IF to_regclass('finance.expense_corrections') IS NOT NULL THEN DELETE FROM finance.expense_corrections; END IF; END $clr$;
DO $clr$ BEGIN IF to_regclass('finance.expense_reviews') IS NOT NULL THEN DELETE FROM finance.expense_reviews; END IF; END $clr$;
DO $clr$ BEGIN IF to_regclass('finance.opening_corrections') IS NOT NULL THEN DELETE FROM finance.opening_corrections; END IF; END $clr$;
DO $clr$ BEGIN IF to_regclass('finance.payments') IS NOT NULL THEN DELETE FROM finance.payments; END IF; END $clr$;
DO $clr$ BEGIN IF to_regclass('finance.settlements') IS NOT NULL THEN DELETE FROM finance.settlements; END IF; END $clr$;
DO $clr$ BEGIN IF to_regclass('finance.cash_counts') IS NOT NULL THEN DELETE FROM finance.cash_counts; END IF; END $clr$;
DO $clr$ BEGIN IF to_regclass('finance.expenses') IS NOT NULL THEN DELETE FROM finance.expenses; END IF; END $clr$;

COMMIT;

-- ٢) تقرير التحقق: الأصفار متوقعة إلا المستثناة
SELECT t.table_name AS "الجدول",
       (xpath('/row/c/text()',
          query_to_xml(format('select count(*) as c from %I.%I', t.table_schema, t.table_name),
                       false, true, '')))[1]::text::bigint AS "عدد الصفوف"
FROM information_schema.tables t
WHERE t.table_schema='finance' AND t.table_type='BASE TABLE'
ORDER BY 2 DESC, 1;
