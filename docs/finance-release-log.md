# سجل بروفة ترقية المالية

سجل تنفيذي لما جرى فعليًا، بالأرقام، دون ادّعاءات. كل ما هنا على فرع تجريبي معزول،
ولم يُنفَّذ أي شيء على فرع `production` حتى لحظة كتابة هذا السجل.

## ١. البيئة

- المزوّد: Neon، القاعدة `neondb`، إصدار الخادم `18.6 (4e5fd08)`.
- دور الفحص والتنفيذ: `neondb_owner` (دور SQL Editor، لا يثبت هوية دور التطبيق).
- الفرع التجريبي: `pre-finance-20261030`، أُنشئ من `production` بالبيانات «حتى الآن».
- الملفات: `prisma/manual-finance-release-preflight.sql`،
  `manual-finance-release-upgrade.sql` (sha256 للسجل `6f00bfa0054533e8d653ca93d9ef9d176437d838b06b1ea990ad98f95eef0ed8`)،
  واستعلام تحقق مكافئ لـ`manual-finance-release-postflight.sql`.

## ٢. فحص ما قبل الترقية (الفرع مقابل الإنتاج)

| البند | `production` 14:01:45Z | الفرع `pre-finance-20261030` 14:03:23Z |
|---|---|---|
| `expense_categories` | 7 | 7 |
| `expenses` | 0 | 0 |
| `journal_entries` | 0 | 0 |
| بصمة البنود | `ed8672be49119218479e2f56aaa90754` | `ed8672be49119218479e2f56aaa90754` |
| بصمة المصروفات | `d41d8cd98f00b204e9800998ecf8427e` | `d41d8cd98f00b204e9800998ecf8427e` |
| بصمة القيود | `d41d8cd98f00b204e9800998ecf8427e` | `d41d8cd98f00b204e9800998ecf8427e` |
| `missing_required_objects` | `[]` | `[]` |
| `conflicting_public_names` | `[]` | `[]` |
| `finance_namespaces` | `[]` | `[]` |
| أعمدة البنود | `id:integer, code:varchar, name_ar:varchar, is_active:boolean` | نفسها |
| صلاحية إنشاء مخطط | `true` | `true` |

النتيجة: **متطابقان** — الفرع نسخة صالحة للبروفة. (البصمة `d41d8cd9…` هي بصمة النص الفارغ،
أي لا صفوف؛ وليست نتيجة حجب بـRLS لأن الدور مالك.)

## ٣. تنفيذ الترقية على الفرع

- التوقيت: `2026-10-30T14:11:35.879863+00:00`، المُنفِّذ `neondb_owner`.
- الناتج كما ورد: **Statement executed successfully** (لا أخطاء، لا تحذيرات).
- السجل: صف واحد في `finance_release.migrations` باسم `finance_release_upgrade`
  والبصمة `6f00bfa0054533e8d653ca93d9ef9d176437d838b06b1ea990ad98f95eef0ed8`.

## ٤. فحص ما بعد الترقية (14:14:40Z)

| البند | النتيجة | الحكم |
|---|---|---|
| `finance_tables` | 16 | ✅ |
| أسماء الجداول | accounts, expenses, payments, expense_reviews, cash_counts, opening_corrections, historical_commerce, reconciliation_cases, reconciliation_notes, expense_corrections, movements, requests, audit_events, category_revisions, category_audit, category_requests | ✅ |
| كل `finance_rows` | 0 لكل جدول | ✅ |
| `migration_ledger` | `finance_release_upgrade` بالبصمة الصحيحة | ✅ |
| `finance_foreign_keys` | 55 | ✅ (كالمختبر محليًا) |
| `finance_deferred_triggers` | 0 | ✅ لا قيود مؤجلة |
| `finance_rls_tables` | 0 | ✅ لم يُفعَّل RLS |
| `legacy_user_triggers` | 0 | ✅ لم تُضف محفّزات على الجداول القديمة |
| `legacy_counts.expense_categories` | 7 | ✅ |
| `legacy_digests.expense_categories` | `ed8672be49119218479e2f56aaa90754` | ✅ **مطابقة لما قبل الترقية** |

النتيجة: **البروفة ناجحة بالكامل**.

## ٥. ما لم يُثبت بعد (بصراحة)

1. **هوية وصلاحيات دور التطبيق:** كل ما سبق نُفّذ بدور `neondb_owner` عبر SQL Editor.
   لم نتأكد أن التطبيق يتصل بالقاعدة نفسها ولا أن دوره يملك الصلاحيات على `finance`.
   هذا شرط قبل **فتح الواجهة**، لا قبل الترقية نفسها.
2. **المرفقات:** لا جداول ولا تخزين في هذه الترقية (مؤجل بقرار سابق).
3. **القيود المؤجلة:** غير مفعّلة بسبب مانع `PrismaPg 6.19.3` المعروف عند `COMMIT`.
4. **نسخة خارج Neon:** لم تُنفَّذ بعد (تحتاج طرفية أو Docker). شبكة الأمان الحالية هي
   الفرع التجريبي، ونافذة استرجاع Neon على خطة Free ست ساعات فقط.
5. **المرفقات والبيانات الحقيقية:** لم تُدخل أي بيانات مالية بعد؛ كل الأعداد صفر.

## ٦. الحالة

بانتظار **موافقة منفصلة وصريحة** لتشغيل نفس الملف على فرع `production`. عند الموافقة:
نفس الملف بنفس البصمة، ثم استعلام التحقق نفسه، ومقارنة البصمات بنتيجة القسم ٢.
