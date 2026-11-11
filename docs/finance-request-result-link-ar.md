# رابط طلب ← نتيجة لإعادة الأوامر المالية — مسودة مخبرية

> **حالة:** تصميم وكود واختبارات مخبرية فقط. لم تُشغَّل أي ترقية SQL على قاعدة أعمال، ولم تُستخدم بيانات فعلية، ولم يُدمج هذا في مسار إنتاج، ولا توجد موافقة نشر أو ترحيل. هذه الجولة ليست إكمالًا للمشروع كله.

## القرار المنفَّذ

بناءً على قراري `ask_user` السابقين:

- `replay_created_result_scope = full_with_schema`: تغطية **كل** إجراءات `command()` في `src/lib/finance/engine.ts` برابط مخطط جديد، مع اختبارات أوسع، بلا ترقية فعلية.
- `legacy_replay_policy = strict_reject`: أي طلب قديم محفوظ بلا رابط، أو برابط ناقص/مختلف، يُرفض برسالة مراجعة واضحة؛ بلا ترحيل مشتق ولا سماح مؤقت.

الرسالة الموحَّدة عند الرفض:

> «تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.»

وتُرمى كـ`FinanceProblem("forbidden", …)` داخل المعاملة نفسها، قبل أي كتابة جديدة.

## ما أُضيف

| الملف | الدور |
|---|---|
| `src/lib/finance/request-result-link.ts` | قائمة بيضاء بـ13 جدول نتيجة، خريطة صريحة لـ27 إجراءً، وحل ديناميكي لـ`CUSTODY_DECIDE`، مع `saveResultLink` و`requireSavedResultLink`. |
| `src/lib/finance/engine.ts` | `command()` يحفظ `finance.requests` ثم `finance.request_results` في **نفس المعاملة**؛ ويفحص الرابط في replay العادي وداخل استعادة تعارض التفرد `23505`. |
| `src/lib/finance/app-categories.ts` | `run()` يحفظ ويفحص الرابط لـ`CREATE`/`EDIT` على `public.expense_categories`؛ جدول الطلبات هنا `finance.category_requests` وليس `finance.requests`. |
| `src/lib/finance/types.ts` و`categories.ts` و`app-categories.ts` | أُضيف `FinanceCategoryPort.exists(id)` كقراءة هوية بلا قفل ولا كتابة، لفحص وجود البند في الجدول القديم ذي المعرّف `INTEGER`. |
| `prototypes/finance-engine/schema.test-only.sql` | أُضيف `finance_lab.request_results` ليكون أصل المخطط المخبري. |
| `prototypes/finance-release/release-candidate.test-only.sql` و`prisma/manual-finance-release-upgrade.sql` و`-rollback.sql` و`-postflight.sql` | وُلّدت من المخطط المخبري؛ الجدول الجديد ضمن 17 جدولًا في المسودة، ويظهر في عدّ ما بعد الترقية. **لم تُشغَّل على قاعدة أعمال.** |
| `tests/finance-request-result-link.test.ts` | اختبارات PGlite اصطناعية: تغطية الخريطة، حفظ الروابط، replay، العبث بـ`result_id`، غياب الرابط، الطلب القديم، وحقن `23505`، ثم اختبار جسر `src/lib/finance/categories.ts`. |
| `prototypes/finance-engine/request-result-link.ts` | رابط صارم مستقل للمعمل: 19 إجراءً، وجدول ديناميكي للفئات حسب `tx.categoryPort`، مع تمرير `FinanceCategoryPort.exists`. |
| `prototypes/finance-release/request-result-link.ts` | رابط صارم لجسر `finance_candidate`: `CREATE`/`EDIT` على `public.expense_categories` فقط. |
| `prototypes/finance-release/category-schema.test-only.sql` | `finance_candidate.request_results` مخبري؛ `refresh-candidate.mjs` يحذف هذا البلوك لأن المرشح يحمل `finance.request_results` أصلًا. |
| `tests/finance-engine-request-result-link.test.ts` | اختبارات المعمل المستقل: الخريطة، الحل الديناميكي، الحفظ/replay/العبث/القديم/`23505`. |
| `prototypes/finance-engine/transaction-callback-link.ts` | TEST ONLY: هوية UUID حتمية لاستدعاءات المعاملات الأكبر (`CASH_COLLECTION`/`CASH_REFUND` → `finance_lab.movements`، `HISTORICAL_COMMERCE` → `finance_lab.historical_commerce`)؛ يحفظ ويفحص الرابط في `finance_lab.request_results` بلا جدول أو ترقية أو تغيير توقيع. |
| `prototypes/finance-cutover/lab-bridge.test-only.sql` | حارس `finance_cutover` صار يقفل 19 كائنًا، ضمنها `finance_lab.request_results`. |
| `tests/finance-callback-result-link.test.ts` | 5 اختبارات PGlite: القائمة البيضاء/UUID، حفظ الروابط الثلاثة، العبث/الحذف/الصف القديم، الحركة الخارجة عن المعاملة، والإجراء المجهول وحارس القراءة. |
| `tests/finance-cutover-guard.test.ts` | اختباران: 19 كائنًا بلا تكرار، مطابقة توقع integration وREADME، وجود كل جدول وأعمدة `request_results` الستة على PGlite. |

### شكل الرابط

`finance.request_results(request_id, action, actor_id, result_table, result_id)`:

- `request_id` هو مفتاح الطلب نفسه.
- `result_table` من قائمة بيضاء فقط؛ لا يصل اسم جدول غير مُدرج إلى SQL.
- `result_id` هو معرّف الصف الذي أنشأه الأمر أو عدّله.
- **لا يوجد FK إلى `finance.requests`**: جدول الروابط مشترك أيضًا مع أوامر `finance.category_requests`، فالقيد سيمنعها. ولا يوجد FK متعدد الأشكال إلى صف النتيجة؛ الفحص الصريح في الكود هو المرجع داخل المعاملة.
- عند الحفظ يُتحقق من وجود صف النتيجة فعلًا؛ وعند الإعادة يُطابق `action` و`actor_id` و`result_id` و`result_table` ثم يُتحقق من وجود الصف مرة أخرى بقراءة عادية بلا قفل جديد.

### خريطة الجداول

| جدول النتيجة | الإجراءات |
|---|---|
| `finance.accounts` | `OPEN_ACCOUNT`، `CLOSE_ACCOUNT`، اعتماد `CUSTODY_DECIDE` |
| `finance.custody_requests` | `CUSTODY_REQUEST`، رفض `CUSTODY_DECIDE` |
| `finance.expenses` | `EXPENSE_CREATE`، `EXPENSE_EDIT`، `EXPENSE_APPROVE` |
| `finance.payments` | `EXPENSE_PAY` — لا يُقارن بمعرّف مُدخل لأن النتيجة دفعة جديدة |
| `finance.movements` | `TRANSFER` |
| `finance.cash_counts` | `HOLDER_COUNT`، `COUNT_REQUEST`، `CASH_COUNT_CREATE`، `CASH_COUNT_CONFIRM`، `CASH_COUNT_CANCEL` |
| `finance.expense_reviews` | `EXPENSE_REVIEW_CREATE`، `EXPENSE_REVIEW_CLOSE` |
| `finance.expense_corrections` | `EXPENSE_REVIEW_CONFIRM` |
| `finance.opening_corrections` | `OPENING_CORRECTION` |
| `finance.reconciliation_cases` | `RECON_CASE_CREATE`، `RECON_CASE_CLOSE` |
| `finance.reconciliation_notes` | `RECON_CASE_NOTE` |
| `finance.settlements` | `SETTLEMENT_CREATE`، `SETTLEMENT_CONFIRM`، `SETTLEMENT_REJECT`، `SETTLEMENT_CANCEL` |
| `public.expense_categories` | `CATEGORY_CREATE`، `CATEGORY_EDIT`، وأوامر `app-categories` |

`CUSTODY_DECIDE` هو الإجراء الديناميكي الوحيد: يُحسم جدوله من `decision` في حمولة الأمر، **لا من تصادف تساوي المعرّف** بين `finance.accounts` و`finance.custody_requests`. اكتُشف أثناء الاختبار أن الحل بالوجود المسبق للمعرّف قد يختار `finance.accounts` خطأً عند رفض طلب عهدة له نفس رقم حساب موجود؛ عُولج بإسناد القرار إلى الحمولة، وأُضيف اختبار تصادف صريح.

## السياسة عند الإعادة

1. replay العادي: بعد مطابقة بصمة الأمر، يُقرأ الرابط؛ إن غاب أو اختلف أو لم يوجد صف النتيجة → رفض `forbidden` بلا كتابة.
2. استعادة `23505`: تُفتح معاملة قراءة جديدة، ويُعاد **نفس** فحص الرابط قبل قبول إعادة الطلب؛ لا يُكتفى بوجود صف `finance.requests`.
3. طلب قديم بلا رابط: يُرفض صراحة، ولا يُشتق له رابط من `result_id` القديم ولا يُسمح مؤقتًا.
4. `authorizeReplay` السابق يظل بعد فحص الرابط؛ فحص `requireSavedDecisionResult` السابق يظل للقرارات، لكن الرابط الجديد يعمّم تغطية الصفوف المنشأة أيضًا.

لا يُعاد فحص الحالة أو الرصيد أو الفترة أو الخزنة أو الجرد في هذا الرابط، ولا يُثبت صحة القرار أو وقوع حركة نقدية مادية أو توقيتها.

## توسيع لاحق: المحركات والجسور المستقلة

بعد «نعم اكمل» وُسّع الرابط الصارم إلى المسارات التي كانت معلنة خارج القرار السابق، بلا ترقية SQL جديدة على الإنتاج ولا بيانات فعلية:

| المسار | جدول الطلبات | جدول الرابط | جدول النتيجة |
|---|---|---|---|
| `prototypes/finance-engine/engine.ts::command()` | `finance_lab.requests` | `finance_lab.request_results` | 19 إجراءً في قائمة بيضاء؛ `CATEGORY_CREATE`/`CATEGORY_EDIT` ديناميكيان |
| `prototypes/finance-release/categories.ts::run()` | `finance_candidate.category_requests` | `finance_candidate.request_results` | `public.expense_categories` فقط |
| `src/lib/finance/categories.ts::run()` | `finance.category_requests` | `finance.request_results` | `public.expense_categories` عبر `candidateCategoryPort(tx)` |

- في المعمل المستقل، `resolveResultTable` يختار `public.expense_categories` عند وجود `tx.categoryPort` وإلا `finance_lab.categories`؛ ويُمرَّر منفذ الفئات إلى `saveResultLink`/`requireSavedResultLink` لاستخدام قراءة `exists` بلا قفل بدل تخمين معرّف `INTEGER`. أُضيف `exists` إلى `prototypes/finance-engine/types.ts` وإلى منفذ المرشح.
- في اختبارات `finance_candidate`، يعيد `candidateCoreDatabase()` توجيه استعلامات `finance_lab.` إلى `finance_candidate.`؛ لذلك صار جدول الرابط مشتركًا بين نواة المعمل المُعاد كتابتها وجسر الفئات. أُضيف الجدول إلى `category-schema.test-only.sql`، وحُذف نظيره المُعاد توليده من `candidateCoreSchema()` لتجنب إنشاء الجدول مرتين. لم يتغير `release-candidate.test-only.sql` ولا ملفا الترقية/الرجوع: مولّد المرشح يحذف بلوك الرابط الخاص بالجسر، والبصمات أدناه باقية كما هي.
- `src/lib/finance/categories.ts` يعيد استخدام `src/lib/finance/request-result-link.ts` مباشرة؛ لا يحتاج جدولًا جديدًا لأن `finance.request_results` موجود أصلًا في المرشح والترقية المسودة. حارس الاختبار `finance_candidate_test_only` يُفعَّل في الاختبار فقط.
- السياسة واحدة في المسارات الثلاثة: حفظ الرابط بعد الطلب داخل المعاملة نفسها، وفحصه في replay العادي وفي استعادة `23505`، ورفض الغائب/الناقص/المختلف أو جدول النتيجة غير المسموح برسالة «تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.».

### تحقق الجولة الجديدة

- `npm run typecheck` و`git diff --check` ناجحان.
- `check:finance:engine:request-result-link` **3/3**، و`check:finance:request-result-link` **5/5** بعد إضافة اختبار الجسر المنقول.
- `check:finance:categories-candidate` **13 ناجح/1 متخطى** (PostgreSQL الاختياري) بعد إضافة اختبار رابط الجسر وتأكيد روابط نواة المعمل المُعاد كتابتها.
- `check:finance:engine` **34/34**، و`check:finance:release` بلا إخفاقات بنتائجها السابقة (7/6/0، 10/9/0، 3/3/0، 3/3/0)، و`check:finance:refund-checkpoint-prototype` **2/2** بعد إعادة توليد عميل Prisma محلي.
- لم تتغير بصمات `release-candidate.test-only.sql` و`manual-finance-release-upgrade.sql` و`manual-finance-release-rollback.sql` في هذه الجولة؛ أُعيد تشغيل المولّدين للتحقق فقط.

### حدود التوسيع

- لا يُثبت الرابط نقل نقد مادي أو توقيته، ولا يُعالج المراجعة البشرية، ولا ذرية `access_control`، ولا حراسة التحصيل/بديل الخزنة/إسناد الفترة/التاريخ/الانتقال/إعادة فتح العهدة. لا SQL إنتاجي جديد، ولا بيانات حقيقية، ولا commit/push أو نشر.

## جولة لاحقة: callbacks المعاملات الأكبر وحارس `finance_cutover` (2026-11-05)

بعد «نعم اكمل» الثانية أُغلقت الفجوتان المعلنتان أعلاه **داخل المعمل فقط**، بلا ترقية SQL ولا بيانات فعلية ولا تغيير بصمات الملفات المولّدة ولا لمس callbacks الإنتاج في `src/lib/finance/engine.ts` و`src/lib/commerce-operations.ts`.

### رابط الـcallbacks

`command()` يملك `request_id` UUID جاهزًا؛ أما callbacks داخل معاملة أكبر فلا تملكه، لكنها تحمل هوية طبيعية مستقرة: `postCashCollectionInTransaction`/`postCashRefundInTransaction` تكتبان `finance_lab.movements` بـ`external_ref` من `collection:<id>`/`refund:<id>`، و`recordHistoricalCommerceInTransaction` يكتب `finance_lab.historical_commerce` بـ`(event_type,event_id)`. اشتُقّ UUID حتمي من `sha256("selahtone-finance-callback:<action>:<externalRef>")`:

| الإجراء | جدول النتيجة | الهوية الطبيعية |
|---|---|---|
| `CASH_COLLECTION` | `finance_lab.movements` | `collection:<id>` مع `kind=COLLECTION` |
| `CASH_REFUND` | `finance_lab.movements` | `refund:<id>` مع `kind=REFUND` |
| `HISTORICAL_COMMERCE` | `finance_lab.historical_commerce` | `<event_type>:<event_id>` |

- الثلاثة في قائمة بيضاء صريحة (`CALLBACK_RESULT_TABLE_BY_ACTION`)؛ أي إجراء مجهول أو جدول غير مسموح يُرفض. أُضيف `finance_lab.historical_commerce` إلى whitelist المعمل.
- `refuseUnlinkedCallbackResult` يُشغَّل **قبل** الـINSERT داخل نفس المعاملة: أي صف قديم/خارج عن المعاملة/معدّل الهوية/بلا رابط مطابق يُرفض بـ`forbidden` والرسالة الموحّدة؛ والصف المرتبط correctly يُعامل `duplicate` بلا حركة ثانية.
- `saveCallbackResultLink` يُحفظ **بعد** إنشاء الصف داخل **نفس المعاملة**، ويتحقق أن `id` و`external_ref` الفعليين يطابقان الهوية المحسوبة قبل كتابة الرابط. `requireCallbackResultLink` يطابق `action`/`actor`/`table`/`row` **والهوية الطبيعية** للصف عند الإعادة.
- `assertAfterLatestCheckpointInTransaction` حارس قراءة لا ينشئ صفًا، فبقي بلا رابط.
- لا جدول جديد، ولا ترقية، ولا تغيير توقيع دالة، ولا تغيير بصمة: يُعاد استخدام `finance_lab.request_results` بوحدة `saveResultLink` نفسها.

### حارس `finance_cutover`

- `prototypes/finance-cutover/lab-bridge.test-only.sql` صار يقفل **19 كائنًا** (كان 18) ويضيف `finance_lab.request_results`، فلا يستطيع دور التطبيق القديم أو الجديد تزوير روابط الأوامر/الـcallbacks أو حذفها دون تصريح المعاملة.
- `prototypes/finance-app/test/cutover-integration.test.ts` يتوقع 19 محفّزًا بدل 18، و`prototypes/finance-cutover/README.md` يذكر 19.
- `tests/finance-cutover-guard.test.ts` يتحقق ثابتًا وعلى PGlite من 19/عدم التكرار/مطابقة التوقع وREADME/وجود كل جدول وأعمدة `request_results` الستة. `tsconfig.json` يستبعد `overlay`/`test`، فلا يثبت `npm run typecheck` تعديل ملف integration؛ عُوّض عنه بهذا الفحص المركّز.

### تحقق الجولة

- `npm run typecheck` = 0، و`git diff --check` ناجح.
- `check:finance:engine` **34/34**، `check:finance:engine:request-result-link` **3/3**، `check:finance:request-result-link` **5/5**، `check:finance:callback-result-link` **5/5**، `check:finance:cutover:guard` **2/2**، `check:finance:refund-checkpoint-prototype` **2/2**.
- PostgreSQL مؤقت معزول (ثنائيات 18.6 محلية في `/tmp`): `check:finance:routed-collection-postgres` و`check:finance:postgres-concurrency` و`check:finance:commerce-role-race-postgres` نجحت **1/1** لكل منها مع `SYNTHETIC_POSTGRES_BIN`، و`check:finance:native` **17/17**.
- لم تتغير بصمات `release-candidate.test-only.sql` و`manual-finance-release-upgrade.sql` و`manual-finance-release-rollback.sql` في هذه الجولة؛ SQL المولّد وبصماته كما في القسم السابق.

### جولة تالية: إصلاح درift نسخة التطبيق المؤقتة وتشغيل الحارس على PostgreSQL

بعد «اكمل» أُصلح درift **داخل المعمل فقط** (`prototypes/finance-app/`؛ لا ملف في `src` الإنتاجي، ولا SQL ترقية جديد):

- `run.mjs` كان ينسخ `src` كاملًا ثم ينسخ فوقه overlay قديمًا، فيبقى خليط من جيلين: `navigation-items` قديم مع `app-navigation` حديث، و`finance/actions` قديم مع صفحات finance حديثة، وصفحة مبيعات قديمة مع مخطط حديث. صار `testMode` يبني نسخة **متسقة من جيل واحد**: تُستبدل واجهة finance بواجهة المعمل (مع الإبقاء على مكوّنَي تنبيه الفترة المشتركين اللذين يستوردهما `dashboard`)، ويُمنع overlay من الكتابة فوق `navigation-items` الحديث، وتُحذف من النسخة المؤقتة فقط ثلاثة ملفات مبيعات يتيمة (`refund-accounts.ts`، `catalog-sale-form.tsx`، `warehouse-sale.tsx`) كانت تُفحص ضد واجهة قديمة.
- صُحّحت حقول `null` في صفحة المبيعات المخبرية (`taxAmount`، `taxTotal`، `taxRateSnapshot`، `warehouse`) بنفس أنماط `src` الحديث، وصار `ReturnForm` يستقبل `canReturn`/`canCancel`، و`commerce-operations` يُمرّر `canCancelSales` إلى `commerce-policy` الحديث. وأُضيف جسر `moneyPayload` يوفّر `accountId` إلى `parseMoneyMovement` مع الإبقاء على `cashAccountId` الذي يقرأه `parseCashChoice`؛ لا يتغير `requestHash` ولا `cashChoice`.
- طُبّقت في إعداد الاختبارين ملفات الترقية اليدوية **الموجودة أصلًا** في المستودع بالترتيب المعتمد في `tests/catalog-sales.test.ts` (`catalog-sales`، `menu-scope`، `cancel-permission`، `discount-ceiling`)، لأن عميل Prisma المولّد من المخطط الحالي يستعلم عن أعمدة لم تكن تُضاف في قاعدة الاختبار.

**النتيجة:** `check:finance:cutover-core` **11/11 بلا تخطٍّ** على PostgreSQL مؤقت حقيقي (يشمل تأكيد وجود 19 محفّزًا، ومنع الكود القديم، واستعادة الاتصال بعد فشل `COMMIT`، وثبات الأدلة)، و`check:finance:app` **52/52 بلا تخطٍّ** (PGlite + PostgreSQL). بذلك لم يعد التحقق من الحارس مقصورًا على PGlite.

### جولة تالية: إغلاق الاختبارين المعلّلين (`check:finance:cutover` و`check:finance:commerce-prototype`)

كان كلاهما يطبّق أربعة ملفات SQL قديمة فقط في قاعدة الاختبار، بينما عميل Prisma المولّد من المخطط الحالي و`src/lib/commerce-operations.ts` يقرآن `can_cancel_sales` و`menu_scope` و`manager_discount_bps` وأعمدة البيع الحديثة؛ فكانا يفشلان بـ`The column (not available) does not exist` و`column users.can_cancel_sales does not exist`، وفشل `commerce-prototype` أحيانًا في تنزيل محرك مخطط Prisma. طُبّقت في إعداد **الاختبارين فقط** ملفات الترقية اليدوية الموجودة أصلًا بترتيب `tests/catalog-sales.test.ts`، فارتفعا إلى 22/25 و3/5.

الثلاثة المتبقية كانت **درiftًا دلاليًا** لا عطبًا في الحارس: كود الإنتاج أضاف لاحقًا حارسًا في `recordCommerceRefund` يرفض أي رد نقدي **جديد** قبل أي كتابة عندما `FINANCE_ENABLED` معطّل («الرد النقدي متوقف للمراجعة عند تعطيل المالية؛ لم يُسجّل رد أو حركة نقدية.»)، فلم يعد الطلب يصل إلى مُحفّز قاعدة البيانات أو إلى جسر المعمل. عُولج ذلك داخل ملفّي الاختبار فقط:

- في `tests/finance-cutover.test.ts` صار استدعاء الرد النقدي القديم يفعّل المفتاح حوله وحده ويُرسل حمولة مُراجَعة، فيصل إلى الإدراج فيُمنع بـ`FINANCE_CUTOVER_BLOCKED` في طور التجميد. أما اختبار «التصريح وحده لا يسمح بنقد غير مرتبط» فقد صار يُثبت القيد المؤجّل `FINANCE_CASH_LINK_REQUIRED` مباشرةً عبر كتابة SQL داخل المعاملة، كما تفعل بقية اختبارات الحارس، لأن تفعيل المفتاح هناك يجعل كود الإنتاج يطلب مخطط `finance` الكامل الذي لا يُنصّب في هذا المعمل عن قصد.
- في `tests/finance-commerce-prototype.test.ts` صار الاختبار يُثبت صراحةً أن الرد النقدي الجديد يُرفض قبل أي كتابة (لا صف رد، ولا حركة، ولا تغيّر رصيد)، وأن الرد غير النقدي يُسجَّل بلا حركة، ثم يُثبت **الجسر المخبري مباشرةً** داخل معاملة واحدة: خصم مرة واحدة، وإعادة مرتبطة تُرفض `duplicate`، ورصيد مُراجَع مختلف يُرفض `balance_changed`. لم يعد الاختبار يدّعي أن خدمة الإنتاج توجّه النقد إلى `finance_lab`؛ callbacks الإنتاج ما زالت خارج النطاق.

النتيجة: `check:finance:cutover` **25/25 بلا تخطٍّ** و`check:finance:commerce-prototype` **5/5 بلا تخطٍّ**. لا تعديل في `src` الإنتاجي، ولا SQL ترقية أو جدول أو بصمة جديدة، ولا تغيير في مُحفّزات الحارس التسعة عشر.

### حدود الجولة

- الثنائيات ليست جزءًا من المستودع: استُعيدت محليًا في `/tmp` من حزمة `@embedded-postgres/linux-x64` على `registry.npmjs.org` ووُجّهت عبر `SYNTHETIC_POSTGRES_BIN`/`FINANCE_TEST_PG_BIN`. هذا **ليس** توفيرًا دائمًا لـ`FINANCE_TEST_PG_BIN`، ولا يُثبت محرك Prisma الأصلي ولا مجمّع Netlify/Neon؛ قاعدة الاختبار مؤقتة معزولة وبياناتها وهمية.
- التكييف أعلاه يوثّق سلوك كود الإنتاج الحالي ولا يُثبت أن الرد النقدي يمرّ عبر مسار المالية الإنتاجي؛ callbacks الإنتاج في `src/lib/finance/engine.ts` و`src/lib/commerce-operations.ts` **خارج النطاق** ولم تُلمس.
- الرابط لا يثبت نقلًا ماديًا أو توقيته، ولا مراجعة بشرية، ولا ذرية `access_control`، ولا معالجة التحصيل/بديل الخزنة/إسناد الفترة/التاريخ/الانتقال/إعادة فتح العهدة. لا SQL إنتاجي، ولا بيانات حقيقية، ولا commit/push أو موافقة نشر/ترحيل. المالية ما زالت غير جاهزة للنشر.

## البصمات الحالية للمسودة المخبرية

| الملف | بصمة السجل الداخلية | sha256 للملف نفسه | الحجم |
|---|---|---|---|
| `prototypes/finance-release/release-candidate.test-only.sql` | `63f0c0262861d048c2e9e5358e014f3f7a1617e35484508c09e8a06759e2af4c` | `5297b6956bfdaa362e9300c2ca3ad2734a09c833dcf95ab7582f3353b064e4e6` | 24639 بايت |
| `prisma/manual-finance-release-upgrade.sql` | `fdc9a14a8b655b77446bd82e8dac4b9fff22f1cce8123cbe65f118eb8a5191dd` | `46ea42baf0f6d256715293d3242892131193c7f0388e0b190077b96ad1c849b7` | 26306 بايت |
| `prisma/manual-finance-release-rollback.sql` | `a503a87a73df0b1b28d4e65b427e0041b59143db111609fad8c8936b16ac1ed8` | `4a8eb8abc8eafb83402be39c03ba9781bf273d390f46b1b042ac840e069a1178` | 2107 بايت |

بصمة السجل تُحسب على النص بعد استبدال البصمة نفسها بـ64 صفرًا؛ لذلك تختلف عن `sha256sum` للملف. أُعيد التوليد بـ`node prototypes/finance-release/tools/refresh-candidate.mjs` ثم `node prototypes/finance-release/tools/build-release-scripts.mjs`. ملفات `docs/finance-release-log.md` تحتفظ ببصمات التنفيذ التاريخي السابق كما هي، ولا تُعدّل لتُقرأ كأنها حديثة.

## التحقق المخبري

- `npm run typecheck` و`git diff --check` ناجحان.
- `check:finance:request-result-link` **4/4** في الجولة الأولى، و**5/5** بعد اختبار الجسر المنقول (راجع «تحقق الجولة الجديدة»).
- مباشرة على ملفات المحرك: 14/14 و12/12 و40/40 بلا إخفاقات، شملت أوامر الفتح والإقفال والمصروف والدفع والجرد والتسوية والتصحيح وطلبات العهدة والفئات والمراجعات والردود.
- `check:finance:release-candidate` و`check:finance:release-scripts` و`check:settlement:engine` و`check:finance:engine` و`check:finance:app-engine` و`check:finance:closure` و`check:finance:app-categories` و`check:finance:categories-candidate` و`check:finance:reviewed-close-prototype` و`check:pay:source` و`check:finance:transaction-retry` و`check:finance:session-transaction` و`check:finance:period-source-warning` و`check:finance:collection-audit` نجحت بلا إخفاقات؛ بعض المجموعات تتخطى اختبار PostgreSQL الاختياري عند غياب ثنائياته.
- PostgreSQL مؤقت معزول: `check:finance:postgres-concurrency` و`check:finance:routed-collection-postgres` و`check:finance:commerce-role-race-postgres` و`check:finance:session-postgres` نجحت 1/1 لكل منها مع `SYNTHETIC_POSTGRES_BIN`. يستخدم Prisma WASM لا محرك الإنتاج الأصلي.
- HTTP على PGlite وNext اصطناعيين: `check:finance:access:http` **14/14**، `check:finance:staff:http` **4/4**، و`expenses` و`period-notice` و`expense-create` و`account-open` و`expense-review-queue` و`admin:finance-disabled` نجحت بلا إخفاقات.

### تصحيحات اختبارية فقط أثناء الجولة

- `tests/finance-access-http.test.ts`: حُدّثت عبارة تقادم التسوية إلى النص العرضي الحالي؛ لم يتغير سلوك المحرك.
- `tests/finance-staff-write-http.test.ts`: ضُبطت بيانات التسوية الاصطناعية ليبقى طلب واحد قابلًا للاعتماد مع حراسات المراجعة/الفترة الحالية؛ لم يتغير كود الإنتاج.
- `tests/finance-refund-checkpoint-prototype.test.ts`: صار حقن `P2002` مرة واحدة لكل استدعاء، فيسمح لمعاملة الاستعادة بالقراءة بدل رفض كل `$transaction`.
- `tests/finance-request-result-link.test.ts`: صُحّحت قراءة `requestId` من الحمولة بدل نتيجة `WriteResult`، وأُضيف اختبار تصادف معرّفات `CUSTODY_DECIDE`.

هذه تعديلات على اختبارات/بيانات اصطناعية، وليست ترحيلًا أو إصلاحًا لبيانات فعلية.

## الفجوات المعلنة صراحة

- الرابط يغطي الآن `src/lib/finance/engine.ts::command()` و`src/lib/finance/app-categories.ts::run()` والمسارات الثلاثة الموضحة في «توسيع لاحق»، **إضافةً إلى** callbacks المعاملات الأكبر الثلاثة في المحرك المستقل وحارس `finance_cutover` لجدول `finance_lab.request_results` (19 كائنًا) الموضحين في «جولة لاحقة». تبقى callbacks الإنتاج الموازية في `src/lib/finance/engine.ts` و`src/lib/commerce-operations.ts` خارج النطاق المخبري؛ راجع حدود القسم السابق.
- لا FK من `finance.requests` إلى الرابط ولا إلى صف النتيجة؛ الاتساق يعتمد على المعاملة والفحص الصريح. لم تُختبر كتابة خارج `command()` تحذف صف النتيجة أو تُدرج طلبًا مباشرًا ثم تتوقع replay.
- لا يُعالج الرابط ذرية قواعد `access_control` مع الكتابة، ولا حراسة `collection-custody-guard.ts`، ولا بديل خزنة المدير/المحاسب، ولا إسناد الفترة، ولا عضوية التسوية، ولا التاريخ/الانتقال، ولا إعادة فتح العهدة، ولا الاختبار المتذبذب السابق.
- لا يُصحّح مجاميع تاريخية، ولا يُثبت نقل نقد مادي أو توقيته، ولا يُستخدم بيانات حقيقية، ولا يُطبّق SQL على Neon/أي قاعدة أعمال، ولا يُدمج في الإنتاج، ولا يوجد commit/push أو موافقة ترقية/نشر.
- العمل الكلي ما زال غير مكتمل قبل اعتماد عقد النسبة/الفترة، والدمج الذري في مسارات البيع والتحصيل، وإغلاق بقية فجوات replay والصلاحيات، ومعالجة الرد/الجرد/التاريخ، ثم بروفة انتقال واستعادة وموافقتَي SQL والنشر المنفصلتين.
