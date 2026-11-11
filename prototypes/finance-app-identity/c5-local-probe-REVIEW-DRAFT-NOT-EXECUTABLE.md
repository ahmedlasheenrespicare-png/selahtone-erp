# `C5` + إكمال `C4` — نص للمراجعة فقط (DRAFT / غير مُجاز / غير قابل للتنفيذ)

> ⚠️ **لا تُنفَّذ أي خطوة هنا قبل عبارة موافقة صريحة منفصلة.**
> لا يوجد في هذا الملف أمر جاهز للّصق ولا قيمة اتصال. كل شيء محلي على جهاز المشغّل.
> أُعدّ بعد تأكيد «نعم، الرسالة وحدها» ⇒ SQL Editor لا يُعطي مخرجات `C4`.

## ١. ما الذي تأكَّد للتو

`YES_THE_MESSAGE_APPEARS_ALONE` ⇒ `SQL_EDITOR_CANNOT_SUPPLY_C4_RESULTS`.
إذن لا تُطلب المخارج الثلاثة من SQL Editor مرة أخرى؛ تُؤخذ من **اتصال فعلي
بدور `selahtone_app`** على جهاز المشغّل، داخل معاملة قراءة-only تُنتهى بـ`ROLLBACK`.

## ٢. الأصل المستخدم (بلا تعديل)

| الأصل | الحالة |
|---|---|
| `app-connection-probe.test-only.sql` v1.1 | **بصمة ثابتة** `d960c559…83eb`، لا تُعدَّل |
| `app-identity-probe-standalone.mjs` + `probe-payload.b64` (5764) + `install-and-run-on-mac.sh` | موجودة على جهاز المشغّل من جولات سابقة |
| بوابة الأداة `FINANCE_IDENTITY_PROBE_CONFIRM="I reviewed the SQL"` | بوابة تقنية فقط، **لا تُغني عن عبارة الموافقة المنفصلة** |
| مانع `DIRECT_URL` | الأداة ترفض الرابط غير المجمّع تلقائيًا |

الاستعلام داخل الأداة: `BEGIN TRANSACTION READ ONLY` + `SET LOCAL
statement_timeout='15s'` + `SELECT` واحد يُرجع كائن هوية/صلاحيات + `ROLLBACK`.
لا يُنشئ جدولًا، ولا يعدّل صفًا، ولا يُخرج اسم قاعدة/مضيف/سلسلة اتصال/هاش كلمة مرور.

## ٣. ما الذي سيتغيّر في التشغيل (محليًا فقط)

- تُضبط متغيرة البيئة `DATABASE_URL` **محليًا في الترمينال على جهازك** بإدخال مخفي،
  بالرابط **المجمّع Pooled** الخاص بدور `selahtone_app` — **لا تُرسل إلى الشات أبدًا**.
- **لا كلمة مرور جديدة ولا تدوير:** استخدم كلمة المرور التي أنشأتها محليًا عند
  `CREATE ROLE selahtone_app` في المرحلة ٤؛ لا تُنشئ غيرها ولا تُدوّر `neondb_owner`.
- لا `DIRECT_URL`، لا `Sync`، لا نشر، لا `Manual Deploy`، لا تغيير متغير في Render،
  لا `src`/`render.yaml`، لا commit/push، ولا إعادة `FINANCE_ENABLED=true`.

## ٤. ما سيفحصه (وصف المخارج المتوقعة، بلا بيانات عمل)

**أ — `C5` هوية الاتصال الحي:** `current_user = session_user = selahtone_app`؛
`read_only_transaction = true`؛ `bypass_rls/superuser/create_role/create_db/replication = false`؛
`inherits_write_all_data` و`inherits_read_all_data` = `false`؛
`can_create_in_finance = false`؛ `finance_schema_owned_by_current_user = false`؛
`finance_object_count = 18`؛ ولكل جدول في `finance`: `can_select/can_insert/can_update = true`
و`can_delete/can_truncate = false`، و`rls_active = false`.

**ب — إكمال `C4`:** الاستعلامات الثلاثة نفسها من **نص v1.1 المُجاز** (السياسات،
«صفر صفوف»، والمحفّزات الـ19) تُنفَّذ من الاتصال المحلي نفسه داخل
`BEGIN TRANSACTION READ ONLY … ROLLBACK`؛ المتوقع `0` / `0` / `19`.
⚠️ تغيّر **هوية الاتصال** (لا نص SQL) ⇒ مُدرَجة في عبارة الموافقة نفسها.

## ٥. خطة الرجوع

1. أي خطأ اتصال ⇒ **الرجوع فورًا بالرابط القديم المجمّع** (`neondb_owner`)،
   وإغلاق العميل، بلا أي إعادة محاولة كتابة أو إجراء مالي.
2. لا تغيير في قاعدة البيانات: المعاملة قراءة-only وتنتهي بـ`ROLLBACK`؛
   لا `COMMIT` ولا `INSERT/UPDATE/DELETE` ولا `GRANT/REVOKE` ولا تفعيل RLS.
3. لا أثر على Render: المتغيرة محلية في الترمينال فقط وتزول بإغلاقه.

## ٦. ما لا يُثبته هذا الفحص

- **ليس إثباتًا لهوية التطبيق المنشور**: الأداة نفسها تُعلن
  `ROLE_IDENTITY_ONLY_NOT_A_PROOF_OF_THE_DEPLOYED_APP`؛ يلزم **فحص بعد التشغيل** منفصل.
- ضبط `DATABASE_URL` في Render ما زال `UNVERIFIED_FROM_LOG`؛ لا يُستنتج من نجاح الاتصال المحلي.
- RLS معطّلة في `public` و`finance` ⇒ **تنفيذ RLS بالدور الجديد يبقى غير مُختبَر**؛
  تفعيلها تغيير مخطط خارج النطاق ويحتاج قرارًا منفصلًا.
- لا يُثبت نقل نقد مادي/توقيته، ولا مراجعة بشرية، ولا ذرية `access_control`،
  ولا معالجة التحصيل/بديل الخزنة/إسناد الفترة/التاريخ/الانتقال/إعادة فتح العهدة،
  ولا نافذة تحويل مُعتمدة، ولا نسخة مُختبَرة/استعادة مُجرَّبة، ولا حل فجوة
  `PrismaPg 6.19.3` عند فشل `COMMIT`.

## ٧. البوابة المطلوبة (قبل أي تنفيذ)

> **راجعتُ نص فحص `C5` المحلي وخطة الرجوع، وأُجيز تشغيله قراءةً فقط من اتصال
> دور `selahtone_app`، دون نشر أو إعادة تفعيل.**

بعدها: أُرسل الأمر كاملًا هنا في الشات ⇒ تنفيذ محلي ⇒ إرسال المخارج وصفيًا ⇒
**تقييم أوفلاين** ⇒ **فحص بعد التشغيل** ⇒ **قرار منفصل صريح** بـ`FINANCE_ENABLED`.

`strict_reject` سارية: أي طلب/صف قديم أو ناقص أو مختلف يُرفض بـ«تعذّر التحقق
من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.»

**الحكم يبقى `IDENTITY_GAP_CONFIRMED` / `NOT_READY`؛ المالية غير جاهزة للنشر.**

## تصحيح نطاق المحفّزات الـ19 (§٦٣، 2026-11-05)

**تصحيح لافتراض سابق في هذه المسودة:** الرقم **19** يعود إلى محفّزات **مخبرية** في `finance_lab` / `finance_cutover_test` داخل `prototypes/finance-cutover/lab-bridge.test-only.sql` و`prototypes/finance-app/test/cutover-integration.test.ts` (و`tests/finance-cutover-guard.test.ts`)، **لا** إلى مخطط `finance` الإنتاجي. نتيجة فحص `C5` المحلي: `triggers_19=0` في مخطط `finance` الإنتاجي ⇒ `TRIGGERS_19_ARE_LAB_ONLY_FINANCE_LAB_NOT_PRODUCTION` و`ZERO_PRODUCTION_TRIGGERS_IS_NOT_A_TRIGGER_ENFORCEMENT_TEST`. لا يُقرأ الصفر كفشل للأداة ولا كإثبات عمل أي محفّز؛ ولا يُنشأ أي محفّز إنتاجي من هذه الجلسة. RLS ما زالت معطّلة وعدد السياسات صفر ⇒ لا يُختبر تنفيذ RLS بالدور الجديد.
