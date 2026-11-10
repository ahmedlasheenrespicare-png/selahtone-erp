# DRAFT — جرد تكميلي لمخطط `public` (غير مُجاز للتنفيذ / TEST ONLY)

> ⚠️ **للمراجعة فقط. لا تُلصق هذا النص في SQL Editor قبل عبارة الموافقة الصريحة.**
> قراءة-only داخل `BEGIN TRANSACTION READ ONLY … ROLLBACK`، بلا كتابة/DDL/DCL،
> بلا اسم قاعدة أو مضيف أو رابط، ولا يقرأ صفوف عمل. البصمة المعتمدة للفحص السابق
> `d960c559…83eb` لا تتغيّر؛ هذا **نص جديد** يحتاج مراجعة وموافقة جديدتين.

## لماذا يلزم هذا الجرد

جرد المرحلة ٢ أعاد `public_relation_count=63` **عددًا فقط**. لا نعرف أسماء الكائنات،
ولا أنواعها، ولا ملاكها، ولا حالة RLS/المحفّزات عليها. أي منح ناقص عند تغيير
`DATABASE_URL` يُعطّل `/login` والمبيعات لا المالية وحدها. لا يجوز تخمين هذه
المعلومات، ولا استنتاج ملكية `public` من ملكية `finance`.

## الطلب الواحد المطلوب من المشغّل

> **راجعتُ نص جرد `public` التكميلي وأُجيز تشغيله قراءةً فقط**

تُكتب في المحادثة **قبل** أي `Run`. هذه العبارة **ليست** موافقة SQL على تغيير الأدوار،
ولا موافقة نشر، ولا إعادة `FINANCE_ENABLED=true`.

## خطوة المشغّل بالتفصيل

1. يقرأ النص أدناه في الشات (لا يفتح ملفًا).
2. يكتب العبارة أعلاه هنا، فيرسل الجلسة ردًا واحدًا: «نفّذ الآن».
3. يفتح **Neon SQL Editor** نفسه الذي استخدمه في المرحلة ٢.
4. يلصق النص **كاملًا** دفعة واحدة ويضغط `Run` **مرة واحدة**.
5. ينسخ **نتائج الاستعلامات الأربعة فقط** ويلصقها هنا — بلا اسم قاعدة، بلا رابط،
   بلا كلمة مرور، بلا أي صف بيانات عمل.
6. لا يضغط أي شيء آخر، ولا `Sync` في Render، ولا يُغيّر أي متغير.

## ما تفعله الجلسة بعد وصول النتيجة (أوفلاين، بلا اتصال)

1. تمريرها على مُقيِّم أوفلاين يرفض الروابط/الصفوف، ويطابق العدد 63، ويصنّف
   الأنواع والملاك والتتابعات والدوال.
2. تحديث `role-change-DRAFT-NOT-EXECUTABLE.md` بقائمة المنح الدقيقة وخطة الرجوع.
3. صياغة **نص SQL المرحلة ٤ للمراجعة فقط** في الشات (بأسماء أدوار معلّقة، بلا كلمة مرور).
4. عندها فقط: **موافقة SQL صريحة منفصلة** للتنفيذ، ثم **موافقة نشر منفصلة**
   لتغيير `DATABASE_URL`، ثم `C4`/`C5`.

## النص المُراجَع (DRAFT / NOT AUTHORIZED FOR EXECUTION)

```sql
-- DRAFT / NOT AUTHORIZED FOR EXECUTION / reviewed text required first
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '15s';

-- ١) ملخص أنواع وملاك كائنات public، بلا اسم قاعدة أو مضيف
SELECT c.relkind AS kind,
       pg_get_userbyid(c.relowner) AS owner,
       count(*)::int AS object_count
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','S')
GROUP BY c.relkind, pg_get_userbyid(c.relowner)
ORDER BY c.relkind, owner;

-- ٢) قائمة الكائنات: الاسم، النوع، المالك، حالة RLS
SELECT c.relname AS object_name, c.relkind AS kind,
       pg_get_userbyid(c.relowner) AS owner,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','S')
ORDER BY c.relkind, c.relname;

-- ٣) التتابعات التي تحتاج USAGE/SELECT/UPDATE عند تغيير الدور
SELECT c.relname AS sequence_name, pg_get_userbyid(c.relowner) AS owner
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'S'
ORDER BY c.relname;

-- ٤) دوال public التي قد تحتاج EXECUTE، والمحفّزات غير الداخلية
SELECT (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public') AS public_function_count,
       (SELECT count(*)::int FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND NOT t.tgisinternal) AS public_user_trigger_count;

ROLLBACK;
```

## حدود صريحة

- لا يثبت هذا الجرد هوية التطبيق المنشور، ولا نقل نقد مادي أو توقيته، ولا مراجعة بشرية،
  ولا ذرية `access_control`، ولا سلامة نافذة التحويل.
- يبقى `role-change-DRAFT-NOT-EXECUTABLE.md` **بلا أي SQL قابل للّصق**.
- الحكم `IDENTITY_GAP_CONFIRMED` / `NOT_READY`؛ **المالية ما زالت غير جاهزة للنشر**.
