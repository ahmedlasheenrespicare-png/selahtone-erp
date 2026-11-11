# DRAFT — دفعة المرحلة ٤ للمراجعة فقط (غير قابلة للتنفيذ / TEST ONLY)

> ⚠️ **لا تُلصق أي سطر من هذا الملف في SQL Editor.** كل عبارة تحوي عنصرًا نائبًا
> `<...>` يجعلها غير صالحة للتنفيذ قصدًا، ولا توجد كلمة مرور ولا رابط اتصال.
> وُضع **للمراجعة فقط** بعد أن صار نطاق المنح معلومًا من الجردين؛ ولا يُجيز
> إنشاء دور، ولا نقل ملكية، ولا تغيير `DATABASE_URL`، ولا نشرًا.
>
> البوابة التالية: **موافقة SQL صريحة منفصلة** بعد مراجعة هذا النص + اعتماد
> أسماء الأدوار ومسار إنشائها ← خطة الرجوع الجاهزة أدناه ← عند التنفيذ فقط
> تُملأ العناصر النائبة في نص نهائي يُراجَع مرة أخرى. ثم **موافقة نشر منفصلة**.

## ١. ما صار معلومًا (من الجردين، بيانات وصفية فقط)

| المخطط | جداول | تتابعات | فهارس | المالك | RLS |
|---|---|---|---|---|---|
| `public` | **33** | **30** | — | `neondb_owner` | 0، بلا forcing |
| `finance` | **18** | **15** | **47** | `neondb_owner` | 0 |

- `public`: 0 views/materialized، 0 دالة، 0 محفّز مستخدم، 3 جداول بلا تابع خاص.
- **`expenses` موجود في المخططين** ⇒ كل منح مُؤهَّل باسم المخطط.
- `public.expense_categories` و`public.journal_entries` جداول قديمة: لا تُحوَّل ولا تُحذف،
  وتأكيد خلوّ القاعدة من بيانات فعلية **غير متحقق** (7 بنود في فحص 2026-10-30).
- الدور الحالي `neondb_owner` ب`bypass_rls=true` وعضوية مباشرة `neon_superuser`
  ب`has_admin_option=false` ⇒ **لا يمكن سحبها** ⇒ دور تطبيق منفصل إلزامي.

## ٢. هيكل الدفعة (وصف + هيكل بعناصر نائبة، لا يُنفَّذ)

```sql
-- DRAFT / NOT AUTHORIZED FOR EXECUTION / every statement has a placeholder
BEGIN;
SET LOCAL statement_timeout = '60s';

-- ١) الدوران: كلمة المرور تُدار خارجيًا في Neon Console، لا تُكتب هنا ولا في الشات
--    بلا SUPERUSER / BYPASSRLS / CREATEROLE / CREATEDB / REPLICATION، وبلا أي عضوية شاملة
-- CREATE ROLE <FINANCE_APP_ROLE> LOGIN PASSWORD '<MANAGED_EXTERNALLY>';
-- CREATE ROLE <FINANCE_ADMIN_ROLE> NOLOGIN;

-- ٢) منح المخططين والكائنات (مُؤهَّلة بأسماء المخططات)
-- GRANT USAGE ON SCHEMA public, finance TO <FINANCE_APP_ROLE>;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO <FINANCE_APP_ROLE>;
-- GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO <FINANCE_APP_ROLE>;
-- GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA finance TO <FINANCE_APP_ROLE>;
-- GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA finance TO <FINANCE_APP_ROLE>;
-- ملاحظة: بلا DELETE/TRUNCATE على finance، وبلا CREATE على أي مخطط، وبلا GRANT على الفهارس.

-- ٣) نقل ملكية كائنات finance فقط (80 كائنًا) إلى دور الإدارة
--    لا REASSIGN OWNED شامل: قد يسحب ملكية كائنات public التي يعتمدها /login والمبيعات
-- ALTER TABLE finance.<EACH_OF_18_TABLES> OWNER TO <FINANCE_ADMIN_ROLE>;
-- ALTER SEQUENCE finance.<EACH_OF_15_SEQUENCES> OWNER TO <FINANCE_ADMIN_ROLE>;

-- ٤) تحقق داخل نفس الدفعة قبل COMMIT
-- SELECT has_table_privilege(<FINANCE_APP_ROLE>, 'finance.expenses', 'DELETE');  -- يجب false
-- SELECT pg_get_userbyid(c.relowner) FROM pg_class c ... ;  -- يجب ألا يعود دور التطبيق
-- SELECT count(*) FROM pg_class ... WHERE relrowsecurity;   -- يُسجَّل لـC4، لا يُفعَّل هنا

-- أي فشل ⇒ ROLLBACK فورًا ولا تُغيَّر DATABASE_URL
ROLLBACK;
```

**لماذا `ROLLBACK` حتى في النص النهائي المقترح؟** لأن الدفعة تُรاجَع أولًا؛
والنسخة التنفيذية تُعرض كاملًا قبل أي `COMMIT`، بقرار منفصل.

## ٣. خطة الرجوع (جاهزة قبل التنفيذ، شرط مسبق)

1. **الرجوع الأساسي**: إعادة `DATABASE_URL` إلى الرابط القديم في Render ⇒ يعود
   التطبيق للعمل، لأن `neondb_owner` ما زال مالكًا وله كل الصلاحيات.
2. **لا تُدوَّر كلمة مرور الدور القديم، ولا تُقيَّد عضوياته، ولا يُحذف** قبل نجاح
   `C4`/`C5` وفحص ما بعد التشغيل؛ فهو وسيلة الرجوع الوحيدة.
3. **رجوع الملكية**: دفعة معكوسة موثّقة تُعيد ملكية كائنات `finance` فقط، ولا
   تُنفَّذ إلا إن فشل الرجوع الأساسي.
4. **شرط إيقاف**: أي فشل في المنح أو الملكية أو ظهور مالك غير متوقع ⇒ `ROLLBACK`
   فورًا، ولا يُغيَّر `DATABASE_URL`، ولا يُنشر شيء.

## ٤. ما لا يفعله هذا الملف

- لا يُنشئ دورًا، ولا يمنح صلاحية، ولا ينقل ملكية، ولا يُغيّر `DATABASE_URL`
  أو `FINANCE_ENABLED` أو `render.yaml` أو أي ملف في `src`.
- لا يُفعّل RLS ولا يختبر المحفّزات الـ19 بأدوار حقيقية (`C4` لاحقًا).
- لا يُثبت هوية التطبيق المنشور، ولا نقل نقد مادي أو توقيته، ولا مراجعة بشرية،
  ولا ذرية `access_control`، ولا سلامة نافذة التحويل.
- لا يُقرأ كدليل جاهزية: `IDENTITY_GAP_CONFIRMED` / `NOT_READY` و**المالية غير
  جاهزة للنشر**.
