#!/usr/bin/env node
/**
 * Builds the MANUAL production scripts from the reviewed candidate:
 *   prisma/manual-finance-release-upgrade.sql    (run only after approval)
 *   prisma/manual-finance-release-rollback.sql   (emergency, empty data only)
 *
 * It never runs SQL and never connects to a database. Each generated file is
 * stamped with a sha256 of itself (with the literal zeroed) so the database
 * ledger and the file reviewers use can be compared.
 *
 *   node prototypes/finance-release/tools/build-release-scripts.mjs
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const candidatePath = "prototypes/finance-release/release-candidate.test-only.sql";
const upgradePath = "prisma/manual-finance-release-upgrade.sql";
const rollbackPath = "prisma/manual-finance-release-rollback.sql";
const zeros = "0".repeat(64);

const candidate = readFileSync(candidatePath, "utf8");
const bodyStart = candidate.indexOf("CREATE SCHEMA IF NOT EXISTS finance;");
const ledgerStart = candidate.indexOf("-- Record the applied script.");
if (bodyStart < 0 || ledgerStart < 0 || ledgerStart < bodyStart) throw new Error("candidate layout changed");
const body = candidate.slice(bodyStart, ledgerStart).trimEnd();
let ledger = candidate.slice(ledgerStart).trimEnd();
if (!ledger.includes("finance_release_candidate")) throw new Error("ledger block not found");
if (/selahtone\.finance_release_candidate_test_only/.test(body)) throw new Error("the body still carries the disposable test guard");
ledger = ledger.split("finance_release_candidate").join("finance_release_upgrade");
// The candidate ships with its own digest baked in; neutralise it so this file is
// stamped with a digest of itself instead of the candidate's.
ledger = ledger.replace(/[0-9a-f]{64}/g, zeros);

const upgrade = `-- ترقية المالية — ملف يدوي للتنفيذ على قاعدة الإنتاج بعد موافقة منفصلة.
-- لا يُشغَّل تلقائيًا، ولا ضمن نشر الموقع. اقرأه كاملًا قبل التشغيل.
--
-- sha256: ${zeros}
--
-- شروط قبل التشغيل (كلها لازمة):
--   1. نسخة حديثة من قاعدة البيانات، ويفضَّل اختبار استعادتها في بيئة معزولة.
--   2. تشغيل ${"prisma/manual-finance-release-preflight.sql"} أولًا وحفظ نتيجته للمقارنة.
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
    IF previous IS NOT NULL AND previous <> '${zeros}' THEN
      RAISE EXCEPTION 'this upgrade file changed after it was applied; stop and review';
    END IF;
  END IF;
END $$;

${body}

${ledger}

COMMIT;
`;

const rollback = `-- رجوع طارئ عن ترقية المالية — يُستخدم فقط قبل إدخال أي بيانات مالية.
-- لا يُشغَّل تلقائيًا. يحذف مخططي finance وfinance_release بالكامل، ولن يعمل
-- إن وُجد أي صف في جداول المالية. لا يتراجع عن تغييرات خارج هذين المخططين.
--
-- sha256: ${zeros}
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
`;

function stamp(file, text) {
  const found = text.match(new RegExp(zeros, "g")) ?? [];
  const expected = file === upgradePath ? 4 : 1;
  if (found.length !== expected) throw new Error(`${file}: expected ${expected} checksum placeholders, found ${found.length}`);
  const digest = createHash("sha256").update(text).digest("hex");
  return text.split(zeros).join(digest);
}
for (const [file, text] of [[upgradePath, upgrade], [rollbackPath, rollback]]) {
  const stamped = stamp(file, text);
  writeFileSync(file, stamped);
  const digest = createHash("sha256").update(text).digest("hex");
  if (createHash("sha256").update(stamped.split(digest).join(zeros)).digest("hex") !== digest) {
    throw new Error(`${file}: stamp verification failed`);
  }
  console.log(`wrote ${file} (${stamped.length} bytes) sha256 ${digest}`);
}
