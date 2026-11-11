# DRAFT v1.1 — استعلامات `C4` للمراجعة فقط (قراءة-only / TEST ONLY)

> ⚠️ **غير مُجاز للتنفيذ بعد التصحيح.** كل استعلام داخل
> `BEGIN TRANSACTION READ ONLY … ROLLBACK`، بلا `COMMIT`، بلا كتابة،
> بلا قراءة صفوف عمل أو قيم مالية، وبلا أي تغيير أدوار/ملكية/RLS.
> `C4` يصف **حالة الكائنات**؛ **لا يُثبت اتصال التطبيق بالدور `selahtone_app`**.

## سجل التصحيح — 2026-11-05

| | |
|---|---|
| `C4_APPROVAL_PHRASE_RECEIVED_BEFORE_EXECUTION` | ✅ وصلت «راجعتُ نص فحص `C4` وأُجيز تشغيله قراءةً فقط» **قبل** التنفيذ |
| عيب v1.0 | الاستعلام ١ استخدم `r.rolsuper …` **بلا** `FROM pg_roles r` |
| النتيجة | `ERROR: missing FROM-clause entry for table "r" (SQLSTATE 42P01)` |
| التصنيف | `C4_DRAFT_QUERY1_DEFECT_MISSING_FROM_CLAUSE` — **عيب في مسودة الجلسة**، لا خطأ صلاحية، ولا دليل على غياب دور، ولا نتيجة فحص |
| الأثر | المعاملة **أُبطلت** (`25P02` للعبارات التالية)؛ **لا نتيجة `C4` صالحة** من هذه الجولة |
| v1.1 | أُضيف `FROM pg_roles r`، وفُكَّ الاستعلام ١ إلى أربعة استعلامات لا تشير إلى أدوار قد لا تكون موجودة، وجُعل الاستعلام ٥ يتحمل غياب جدول بلا خطأ |
| البوابة | النص المُصحَّح **نص مختلف** ⇒ يلزم إقرار منفصل قصير قبل إعادة التشغيل |

**أول خطوة تشغيلية:** `ROLLBACK;` لإنهاء المعاملة المُبطَلة، ثم بدء معاملة جديدة.

## ⚠️ التحذير التقني الأهم

**Neon SQL Editor يعمل عادةً بهوية `neondb_owner` لا `selahtone_app`.**
⇒ الاستعلام ١أ سيُظهر `current_user = neondb_owner`، ولن يُثبت هوية الدور الجديد.
~~و`SET ROLE selahtone_app` قد يفشل لأن `neondb_owner` ليس عضوًا في `selahtone_app`.~~
**تصحيح §٥٦:** نتيجة `١ج` أظهرت `pg_has_role(..., 'selahtone_app', 'MEMBER') = true`
⇒ القول السابق **خاطئ**؛ العضوية موجودة، لكن خياراتها (`INHERIT`/`SET`/`ADMIN`)
ومصدرها (يُرجَّح أثر `CREATEROLE` التلقائي) **غير محدَّدة** من هذه النتائج.
المنح الصريح الوحيد في دفعة المرحلة ٤ كان `GRANT selahtone_finance_admin TO neondb_owner`.

⇒ `C4` يُثبت: حالة RLS، الملكية، الصلاحيات الممنوحة، وتعريف المحفّزات.
أما **إثبات اتصال التطبيق بالدور الجديد** فهو **`C5`** ويلزم مسار اتصال فعلي
بالدور `selahtone_app` (أداة من جهاز المشغّل أو فحص بعد التشغيل)، لا SQL Editor.

## الاستعلامات المُصحَّحة (للمراجعة)

```sql
-- C4 / DRAFT v1.1 / NOT AUTHORIZED FOR EXECUTION / READ ONLY ONLY
ROLLBACK;                       -- إنهاء أي معاملة مُبطَلة من الجولة الفاشلة
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '30s';

-- ١أ) هوية الجلسة التي تُجري الفحص + صفاتها (قد تكون neondb_owner: انظر التحذير)
SELECT current_user  AS editor_current_user,
       session_user  AS editor_session_user,
       r.rolsuper, r.rolbypassrls, r.rolcreatedb, r.rolcreaterole,
       r.rolreplication, r.rolcanlogin
FROM pg_roles r
WHERE r.rolname = current_user;

-- ١ب) صفات الدورين الجديدين (لا يُقيّم، يُسجَّل فقط)
SELECT a.rolname, a.rolcanlogin, a.rolsuper, a.rolbypassrls,
       a.rolcreatedb, a.rolcreaterole, a.rolreplication
FROM pg_roles a
WHERE a.rolname IN ('selahtone_app', 'selahtone_finance_admin')
ORDER BY 1;

-- ١ج) عضويات الجلسة الحالية — يُستخدم oid من pg_roles فلا يخطئ إن غاب دور بعينه
SELECT p.rolname AS role_name,
       pg_has_role(current_user, p.oid, 'MEMBER') AS is_member
FROM pg_roles p
WHERE p.rolname IN ('neon_superuser', 'pg_read_all_data', 'pg_write_all_data',
                    'selahtone_finance_admin', 'selahtone_app')
ORDER BY 1;

-- ١د) app_can_connect — صفر صفوف إن غاب الدور، بلا خطأ
SELECT has_database_privilege('selahtone_app', current_database()::text, 'CONNECT')
       AS app_can_connect
FROM pg_roles a
WHERE a.rolname = 'selahtone_app';

-- ٢) حالة RLS على المخططين — تسجيل وصفي فقط، بلا تفعيل
SELECT n.nspname,
       count(*) FILTER (WHERE c.relkind = 'r')::int AS tables,
       count(*) FILTER (WHERE c.relkind = 'S')::int AS sequences,
       count(*) FILTER (WHERE c.relrowsecurity)::int AS rls_enabled,
       count(*) FILTER (WHERE c.relforcerowsecurity)::int AS rls_forced
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public', 'finance') AND c.relkind IN ('r', 'S')
GROUP BY n.nspname ORDER BY n.nspname;
-- المتوقع: public 33/30 وfinance 18/15، وrls_enabled/rls_forced = 0 حاليًا

-- ٣) السياسات الفعّالة (وصف فقط)
SELECT n.nspname, c.relname, p.polname, p.polcmd, p.polpermissive
FROM pg_policy p
JOIN pg_class c ON c.oid = p.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public', 'finance')
ORDER BY 1, 2, 3;
-- المتوقع: صفر صفوف حاليًا؛ أي صف ⇒ يُسجَّل ولا يُغيَّر هنا

-- ٤أ) ملكية كائنات finance
SELECT count(*)::int AS finance_object_count,
       count(*) FILTER (WHERE pg_get_userbyid(c.relowner) = 'selahtone_finance_admin')::int AS owned_by_admin,
       count(*) FILTER (WHERE pg_get_userbyid(c.relowner) = 'selahtone_app')::int AS owned_by_app
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'finance';
-- المتوقع: 80 / 80 / 0

-- ٤ب) فحص «صفر صفوف»
SELECT c.relname, c.relkind, pg_get_userbyid(c.relowner) AS owner
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'finance'
  AND pg_get_userbyid(c.relowner) <> 'selahtone_finance_admin';
-- المتوقع: صفر صفوف

-- ٥أ) صلاحيات الدور — أسماء مؤهلة بالمخطط، ومتحمّلة لغياب جدول بلا خطأ
SELECT n.nspname || '.' || c.relname AS qualified_table,
       has_table_privilege('selahtone_app', n.nspname || '.' || c.relname, 'SELECT')   AS sel,
       has_table_privilege('selahtone_app', n.nspname || '.' || c.relname, 'INSERT')   AS ins,
       has_table_privilege('selahtone_app', n.nspname || '.' || c.relname, 'DELETE')   AS del,
       has_table_privilege('selahtone_app', n.nspname || '.' || c.relname, 'TRUNCATE') AS trunc
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'
  AND ((n.nspname = 'finance' AND c.relname = 'expenses')
    OR (n.nspname = 'public'  AND c.relname IN ('users', 'expenses')))
ORDER BY 1;
-- المتوقع: finance.expenses: sel=true, ins=true, del=false, trunc=false

-- ٥ب) صلاحية CREATE على المخطط
SELECT has_schema_privilege('selahtone_app', 'finance', 'CREATE') AS create_in_finance;
-- المتوقع: false

-- ٦) المحفّزات الـ19: الوجود والتعريف والتمكين فقط — بلا أي كتابة أو إجراء مالي
SELECT n.nspname, c.relname AS table_name, t.tgname, t.tgenabled,
       pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'finance' AND NOT t.tgisinternal
ORDER BY 2, 3;
-- المتوقع: 19 صفًا؛ يُسجَّل التعريف والتمكين فقط، ولا يُستدعى أي محفّز

ROLLBACK;
```

## البوابات بعد المراجعة

1. **إقرار منفصل قصير** للنص المُصحَّح (لأنه يختلف عن النص المُجاز).
2. `ROLLBACK;` للمعاملة المُبطَلة ⇒ تشغيل الدفعة المُصحَّحة من طرف المشغّل ⇒
   إرسال المخارج وصفيًا ⇒ **تقييم أوفلاين**.
3. **`C5`**: اتصال فعلي بالدور `selahtone_app` + فحص بعد التشغيل — بمسار يُحدَّد لاحقًا.
4. **قرار منفصل صريح** بـ`FINANCE_ENABLED`.

## ما لا يفعله هذا الملف

- لا يُنفَّذ، ولا يُفعّل RLS، ولا يضيف سياسات، ولا يُغيّر ملكية أو منحًا،
  ولا يُغيّر `src`/`render.yaml`/أي متغير، ولا نشر/commit/push.
- لا يُثبت نقل نقد مادي أو توقيته، ولا مراجعة بشرية، ولا ذرية `access_control`،
  ولا سلامة نافذة تحويل، ولا يحل فجوة `PrismaPg 6.19.3` عند فشل `COMMIT`.
- `strict_reject` سارية: أي طلب/صف قديم أو ناقص أو مختلف يُرفض بـ«تعذّر التحقق
  من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.»

**الحكم يبقى `IDENTITY_GAP_CONFIRMED` / `NOT_READY`؛ المالية غير جاهزة للنشر.**

## تصحيح نطاق المحفّزات الـ19 (§٦٣، 2026-11-05)

**تصحيح لافتراض سابق في هذه المسودة:** الرقم **19** يعود إلى محفّزات **مخبرية** في `finance_lab` / `finance_cutover_test` داخل `prototypes/finance-cutover/lab-bridge.test-only.sql` و`prototypes/finance-app/test/cutover-integration.test.ts` (و`tests/finance-cutover-guard.test.ts`)، **لا** إلى مخطط `finance` الإنتاجي. نتيجة فحص `C5` المحلي: `triggers_19=0` في مخطط `finance` الإنتاجي ⇒ `TRIGGERS_19_ARE_LAB_ONLY_FINANCE_LAB_NOT_PRODUCTION` و`ZERO_PRODUCTION_TRIGGERS_IS_NOT_A_TRIGGER_ENFORCEMENT_TEST`. لا يُقرأ الصفر كفشل للأداة ولا كإثبات عمل أي محفّز؛ ولا يُنشأ أي محفّز إنتاجي من هذه الجلسة. RLS ما زالت معطّلة وعدد السياسات صفر ⇒ لا يُختبر تنفيذ RLS بالدور الجديد.
