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

## ٦. الموافقة والتنفيذ على الإنتاج

- **الموافقة:** وافق المستخدم صراحة وبشكل منفصل على تنفيذ نفس الملف على فرع
  `production` بتاريخ `2026-10-30`، بعد الاطلاع على نتائج البروفة أعلاه وعلى قائمة
  «ما لم يُثبت بعد» في القسم ٥. الموافقة تخص **ترقية القاعدة فقط**؛ فتح الواجهة
  وضبط الصلاحيات يحتاجان موافقة لاحقة مستقلة.
- **ما سيُنفَّذ:** الملف `prisma/manual-finance-release-upgrade.sql` كما هو بلا أي
  تعديل (بصمة السجل `6f00bfa0054533e8d653ca93d9ef9d176437d838b06b1ea990ad98f95eef0ed8`)،
  على الفرع `production` والقاعدة `neondb`، يليه استعلام التحقق نفسه.
- **شرط القبول:** تطابق `legacy_digests.expense_categories` مع
  `ed8672be49119218479e2f56aaa90754`، و16 جدولًا، وكل الأعداد صفر، وسجل واحد.
- **الرجوع:** إن ظهر أي فرق → إيقاف فوري، ثم `prisma/manual-finance-release-rollback.sql`
  صالح ما دامت جداول `finance` فارغة.

## ٧. نتيجة التنفيذ على الإنتاج (2026-10-30)

| البند | النتيجة | الحكم |
|---|---|---|
| ناتج التشغيل | **Statement executed successfully** | ✅ |
| التوقيت | `2026-10-30T14:20:13.630425+00:00`، المُنفِّذ `neondb_owner` | ✅ |
| `finance_tables` | 16 | ✅ |
| كل `finance_rows` | 0 | ✅ لا بيانات بعد |
| `migration_ledger` | `finance_release_upgrade` بالبصمة `6f00bfa0…ed8` | ✅ |
| `finance_foreign_keys` | 55 | ✅ مطابق للبروفة والمختبر |
| `finance_deferred_triggers` | 0 | ✅ |
| `finance_rls_tables` | 0 | ✅ |
| `legacy_user_triggers` | 0 | ✅ |
| `legacy_counts` | بنود 7، مصروفات 0، قيود 0 | ✅ |
| `legacy_digests.expense_categories` | **`ed8672be49119218479e2f56aaa90754`** | ✅ **مطابقة لما قبل الترقية** |

**الحالة: ترقية القاعدة منجزة ومتحقَّق منها على الإنتاج.** لا يوجد أي استعلام مالي في
التطبيق لأن مفتاح `FINANCE_ENABLED` غير مضبوط، فلا أثر على المستخدمين الآن.

## ٨. ما بُني من الواجهات بعد الترقية (خلف مفتاح `FINANCE_ENABLED`)

| المسار | الوظيفة |
|---|---|
| `/finance` | لوحة الحسابات: خزنة كل فرع وعهدة كل موظف مع الأرصدة |
| `/finance/accounts` | فتح حساب بجرد فعلي (خزنة فرع / عهدة موظف)، بلا تكرار |
| `/finance/transfers` | تسليم فعلي بخطوة واحدة في الفرع نفسه فقط |
| `/finance/expenses` و`/new` و`/[id]` | تسجيل مصروف → اعتماد → صرف فعلي → مراجعة مبلغ مدفوع |
| `/finance/counts` | جرد: تسجيل ملاحظة، ثم تأكيد تسوية أو إلغاء بسبب |
| `/finance/categories` | إضافة بند وتعديله وإيقافه مع حفظ السبب والتاريخ |
| `/finance/mine` | عهدة الموظف وحركاته فقط، دون المصروفات وتفاصيلها |

- إدارة البنود تمر بمنفذ تطبيقي جديد `src/lib/finance/app-categories.ts` (النموذج
  المعملی القديم محمي بحارس قاعدة اختبار). يكتب على جدول `public.expense_categories`
  الحقيقي دون نسخه أو حذفه، ويحفظ المراجعة والتدقيق ومعرّف الطلب.
- الاختبارات: `check:finance:app-categories` 3/3، `check:finance:app-engine` 1/1،
  `check:finance:release-scripts` 10/10 (مع PostgreSQL 18.4)،
  `check:finance:release-candidate` 9/9، `check:finance:cutover` 25/25، و`typecheck` و`build` سليمان.

### ما يليه (يحتاج موافقة منفصلة لكل بند)
1. حسم هوية وصلاحيات دور التطبيق على مخطط `finance` قبل فتح أي واجهة (البند الجاري).
2. ~~بناء واجهات الخزنة والعُهد والمصروفات للمدير والمحاسب خلف المفتاح~~ — أُنجز في القسم ٨.
3. ~~صلاحيات الموظف وحجبه على مستوى الخادم~~ — أُنجز في القسم ٨ (`/finance/mine` وفلاتر الخادم).
4. ~~المرفقات وتخزينها~~ — **أُلغيت نهائيًا**، راجع القسم ٩.
5. نسخة خارجية `pg_dump` + تجربة استعادة (يحتاج طرفية أو Docker).

## ٩. إلغاء المرفقات نهائيًا + بدء صلاحيات دور التطبيق (2026-10-30)

**قرار المستخدم:** «صلاحيات دور التطبيق لا اريد مرفقات ابدا» — المرفقات ملغاة نهائيًا.

### ما أُزيل من التطبيق (لا يُنشر أي مسار مرفقات)
- حُذف الملف `src/lib/finance/attachment-validation.ts` بالكامل.
- حُذف من `src/lib/finance/engine.ts`: استيراد وحدة المرفقات، ودوال
  `addExpenseAttachment` و`listExpenseAttachments` و`getExpenseAttachment` ونوع
  `AttachmentRow`، ومعالجة قيد `finance_one_attachment_per_expense`.
- حُذف مجلد `prototypes/finance-storage/` (تصميم تخزين الكائنات) واختباره
  `tests/finance-storage.test.ts`، وحُذف السكربت `check:finance:storage` من `package.json`.
- **القاعدة المثبتة في الإنتاج لم تكن تتضمن جداول مرفقات أصلًا**
  (`manual-finance-release-upgrade.sql` يستثنيها صراحة)، فلا يوجد ما يُحذف منها.
- أُضيف تنبيه في `prototypes/finance-engine/README.md` يمنع نقل تجربة المرفقات المختبرية
  إلى التطبيق أو إلى أي ترقية.

### صلاحيات دور التطبيق: التشخيص جاهز، والمنح ينتظر المراجعة
- `prisma/manual-finance-role-check.sql` (قراءة فقط داخل معاملة `ROLLBACK`): يخرج عمودًا
  واحدًا `finance_role_check` فيه دور الفحص، وملّاك مخطط `finance`، وصلاحيات
  SELECT/INSERT/UPDATE/DELETE، وجداول RLS، وأدوار القاعدة، و`recent_connections` من
  `pg_stat_activity` لمعرفة دور التطبيق الفعلي دون كشف أسرار. **ينتظر تشغيلك في Neon.**
- `prisma/manual-finance-grants.sql` (مسودة، **لم تُشغَّل**): يمنح `USAGE` على مخططي
  `finance` و`finance_release`، و`SELECT, INSERT, UPDATE` على جداول المالية وتسلسلاتها
  (بلا `DELETE` أو `TRUNCATE`: التصحيحات تُسجَّل بالإضافة فقط)، و`SELECT` فقط على سجل
  الترقية، و`ALTER DEFAULT PRIVILEGES` للجداول المستقبلية، مع كتلة تحقق بعد التنفيذ
  وكتلة `REVOKE DELETE, TRUNCATE` اختيارية معلّقة تحتاج موافقة منفصلة.
- لا يزال غير محسوم: هل دور التطبيق هو `neondb_owner` نفسه (فتكون المنح تحصيل حاصل
  والتقييد هو المهم)، أم دورًا آخر (فتكون المنح ضرورية قبل التشغيل).

### التحقق بعد التعديل
- `typecheck` سليم، و`build` ناجح.
- `check:finance:release`: مرشح الترقية 9/9، سكربتات الإصدار 10/10، نواة التطبيق 1/1،
  بنود التطبيق 3/3.
- `check:finance:cutover` 25/25.
