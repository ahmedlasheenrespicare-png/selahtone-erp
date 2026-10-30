-- رجوع طارئ عن ترقية المالية — يُستخدم فقط قبل إدخال أي بيانات مالية.
-- لا يُشغَّل تلقائيًا. يحذف مخططي finance وfinance_release بالكامل، ولن يعمل
-- إن وُجد أي صف في جداول المالية. لا يتراجع عن تغييرات خارج هذين المخططين.
--
-- sha256: a503a87a73df0b1b28d4e65b427e0041b59143db111609fad8c8936b16ac1ed8
--
-- متى يُستخدم: فقط إذا فشل فحص ما بعد الترقية، أو تقرر التوقف قبل بدء الاستخدام،
-- ولم تُدخل أي حسابات أو مصروفات أو حركات بعد.
-- كيف يُشغَّل: الملف كله دفعة واحدة في Neon SQL Editor بعد اختيار الفرع والقاعدة.
-- يبدأ بـBEGIN وينتهي بـCOMMIT. عند الفشل نفّذ ROLLBACK;.

BEGIN;

DO $$
DECLARE tbl TEXT; rows BIGINT; total BIGINT := 0;
BEGIN
  IF to_regnamespace('finance') IS NULL THEN
    RAISE EXCEPTION 'لا يوجد مخطط finance؛ لا شيء للرجوع عنه.';
  END IF;
  IF to_regclass('finance_release.migrations') IS NULL THEN
    RAISE EXCEPTION 'لا يوجد سجل ترقية؛ أوقف العمل وراجع من نفّذ الترقية.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM finance_release.migrations WHERE name='finance_release_upgrade') THEN
    RAISE EXCEPTION 'سجل الترقية لا يطابق هذا الملف؛ أوقف العمل ولا تحذف شيئًا.';
  END IF;
  FOR tbl IN SELECT c.relname::text FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
             WHERE n.nspname='finance' AND c.relkind='r'
  LOOP
    EXECUTE format('SELECT count(*) FROM finance.%I', tbl) INTO rows;
    total := total + rows;
  END LOOP;
  IF total > 0 THEN
    RAISE EXCEPTION 'توجد بيانات مالية مسجلة؛ هذا الملف سيفقدها. أوقف العمل فورًا ولا تكمل.';
  END IF;
END $$;

DROP SCHEMA finance CASCADE;
DROP SCHEMA finance_release CASCADE;

COMMIT;
