# EXECUTABLE — النسخة المُجازة للتنفيذ (2026-11-05)

> **الإجازة وصلت مطابقة حرفيًا وقبل التنفيذ:**
> «راجعتُ النص النهائي للمراجعة وأُجيز تنفيذه كدفعة واحدة بـ`ROLLBACK` عند أي فشل».
> هذه الإجازة **SQL فقط**؛ لا تشمل تغيير `DATABASE_URL`، ولا نشرًا، ولا إعادة `true`،
> ولا تعديل `src`/`render.yaml`. **كلمة المرور ما زالت عنصرًا نائبًا**
> `<GENERATED_LOCALLY>` تُستبدل محليًا فقط ولا تُرسل إلى المحادثة.
>
> **الفرق عن نص المراجعة (فرقان معلنان فقط، يتحقق منهما اختبار آلي):**
> (١) التعليق الأول حُدِّث من `NOT EXECUTED` إلى `APPROVED`;
> (٢) سطر `ROLLBACK` النهائي نُقل إلى «السطر الأخير» أدناه ليصبح `COMMIT`
> **بعد** مراجعة مخارج التحقق، أو `ROLLBACK` عند أي فشل.
> **كل الأسطر التنفيذية الأخرى مطابقة حرفيًا**. الدفعة كلها معاملة واحدة.

## الدفعة (الصقها كاملة في Neon SQL Editor — لا Console — واضغط Run مرة واحدة)

```sql
-- PHASE 4 / APPROVED 2026-11-05 / EXECUTE AS ONE BATCH / password must be generated locally
BEGIN;
SET LOCAL statement_timeout = '60s';

-- ١) الدوران: من SQL Editor، بلا أي عضوية شاملة
CREATE ROLE selahtone_app WITH LOGIN PASSWORD '<GENERATED_LOCALLY>';
CREATE ROLE selahtone_finance_admin NOLOGIN;

-- ٢) تحقق مبكر: لا عضوية neon_superuser ولا صفات مديرية
--    المتوقع: كل القيم false (أي true ⇒ ROLLBACK فورًا ولا تُكمل الدفعة)
SELECT r.rolname,
       r.rolsuper, r.rolbypassrls, r.rolcreatedb, r.rolcreaterole, r.rolreplication,
       pg_has_role(r.rolname, 'neon_superuser', 'MEMBER') AS inherits_neon_superuser
FROM pg_roles r
WHERE r.rolname IN ('selahtone_app', 'selahtone_finance_admin');

-- ٣) منح انتقائي مؤهَّل باسم المخطط (expenses موجود في المخططين)
GRANT USAGE ON SCHEMA public, finance TO selahtone_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO selahtone_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO selahtone_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA finance TO selahtone_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA finance TO selahtone_app;
-- بلا DELETE/TRUNCATE على finance، وبلا CREATE على أي مخطط لدور التطبيق،
-- وبلا GRANT على الفهارس. تحقق CONNECT (قراءة-only):
SELECT has_database_privilege('selahtone_app', current_database(), 'CONNECT') AS app_can_connect;
-- المتوقع: true (إن ظهر false ⇒ ROLLBACK ويُلحق منح CONNECT في نص مُراجَع جديد)

-- ٤) تمهيد نقل الملكية — الشرطان لازمان معًا (مُتحقق مخبريًا §١أ)
GRANT selahtone_finance_admin TO neondb_owner;
GRANT CREATE ON SCHEMA finance TO selahtone_finance_admin;

-- ٥) نقل ملكية جداول finance الـ18 فقط. التتابعات الـ15 (IDENTITY) والفهارس الـ47
--    تتبع مالك الجدول تلقائيًا؛ ALTER SEQUENCE عليها يفشل بcannot change owner of sequence.
ALTER TABLE finance.accounts OWNER TO selahtone_finance_admin;
ALTER TABLE finance.audit_events OWNER TO selahtone_finance_admin;
ALTER TABLE finance.cash_counts OWNER TO selahtone_finance_admin;
ALTER TABLE finance.category_audit OWNER TO selahtone_finance_admin;
ALTER TABLE finance.category_requests OWNER TO selahtone_finance_admin;
ALTER TABLE finance.category_revisions OWNER TO selahtone_finance_admin;
ALTER TABLE finance.custody_requests OWNER TO selahtone_finance_admin;
ALTER TABLE finance.expense_corrections OWNER TO selahtone_finance_admin;
ALTER TABLE finance.expense_reviews OWNER TO selahtone_finance_admin;
ALTER TABLE finance.expenses OWNER TO selahtone_finance_admin;
ALTER TABLE finance.historical_commerce OWNER TO selahtone_finance_admin;
ALTER TABLE finance.movements OWNER TO selahtone_finance_admin;
ALTER TABLE finance.opening_corrections OWNER TO selahtone_finance_admin;
ALTER TABLE finance.payments OWNER TO selahtone_finance_admin;
ALTER TABLE finance.reconciliation_cases OWNER TO selahtone_finance_admin;
ALTER TABLE finance.reconciliation_notes OWNER TO selahtone_finance_admin;
ALTER TABLE finance.requests OWNER TO selahtone_finance_admin;
ALTER TABLE finance.settlements OWNER TO selahtone_finance_admin;

-- لا REASSIGN OWNED شامل: قد يسحب ملكية public التي يعتمدها /login والمبيعات.
-- إزالة صلاحية CREATE المؤقتة بعد النقل (أقل صلاحية):
REVOKE CREATE ON SCHEMA finance FROM selahtone_finance_admin;

-- ٦) تحقق نهائي داخل نفس المعاملة قبل أي COMMIT
SELECT has_table_privilege('selahtone_app', 'finance.expenses', 'DELETE') AS app_can_delete_finance,
       has_table_privilege('selahtone_app', 'public.users', 'SELECT') AS app_can_read_public,
       has_schema_privilege('selahtone_app', 'finance', 'CREATE') AS app_can_create_in_finance;
-- المتوقع: false / true / false
SELECT count(*)::int AS finance_object_count,
       count(*) FILTER (WHERE pg_get_userbyid(c.relowner) = 'selahtone_finance_admin')::int AS owned_by_admin,
       count(*) FILTER (WHERE pg_get_userbyid(c.relowner) = 'selahtone_app')::int AS owned_by_app
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'finance';
-- المتوقع: 80 / 80 / 0
SELECT c.relname, c.relkind, pg_get_userbyid(c.relowner) AS owner
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'finance' AND c.relkind IN ('r','S')
  AND pg_get_userbyid(c.relowner) <> 'selahtone_finance_admin';
-- المتوقع: صفر صفوف (أي صف ⇒ ROLLBACK ويُبلَّغ قبل إعادة المحاولة)
```

## السطر الأخير — لا تُنفّذه مع الدفعة؛ نفّذه وحده بعد مراجعة المخارج

راجع مخارج الاستعلامات الثلاثة الأخيرة: `false / true / false`، و`80 / 80 / 0`،
و**صفر صفوف**، و`app_can_connect=true`، وكل صفات الأدوار `false`. عندئذٍ فقط:

```sql
COMMIT;
```

وإن ظهر أي خطأ أو أي قيمة مختلفة:

```sql
ROLLBACK;
```

**لماذا يكفي هذا لتحقيق «`ROLLBACK` عند أي فشل»؟** مُتحقَّق مخبريًا على PG18.6:
أي خطأ SQL داخل المعاملة يجعلها `aborted`، وحينها يُنفَّذ `COMMIT` كـ`ROLLBACK`
(`command tag = ROLLBACK`) ولا يثبت أي دور أو منح أو نقل ملكية. والمعاملة الواحدة
تضمن عدم وجود حالة نصف مكتملة.

## تحقق مخبري قبل التسليم (PG18.6، مخطط 80 كائنًا مطابق للجرد)

| الفحص | النتيجة |
|---|---|
| تنفيذ 35 عبارة في معاملة واحدة | نجحت بلا أي خطأ |
| صفات الأدوار + عضوية `neon_superuser` | كلها `false` |
| `has_database_privilege(... CONNECT)` | `true` |
| `false / true / false` | مطابق |
| `finance_object_count / owned_by_admin / owned_by_app` | `80 / 80 / 0` |
| فحص «صفر صفوف» للمالك المختلف | صفر صفوف |
| مسار `COMMIT` | `80/80/0`، بلا `CREATE` متبقٍ على دور الإدارة، بلا `DELETE` لدور التطبيق على `finance` |
| مسار `ROLLBACK` | عدد الأدوار الجديدة = 0 |
| خطأ مُحقَن ثم `COMMIT` | `command tag = ROLLBACK`، ولا دور يثبت |

## خطوات التنفيذ (أنت، لا الجلسة)

1. **لا Console**؛ افتح **Neon SQL Editor** على نفس الفرع/القاعدة التي فُحصت.
2. ولّد كلمة المرور محليًا (≥12 حرفًا، ≈60 بت) — **لا ترسلها إليّ** — واستبدل العنصر النائب.
3. الصق الدفعة كاملة واضغط Run **مرة واحدة**.
4. راجع المخارج، ثم نفّذ `COMMIT;` وحده، أو `ROLLBACK;` وحده عند أي فشل.
5. أرسل **ملخصًا وصفيًا فقط** (نجاح/فشل، الأعداد، أسماء الأدوار) بلا كلمة مرور ولا رابط ولا صفوف.
6. **لا تُغيّر `DATABASE_URL` ولا `FINANCE_ENABLED` ولا `render.yaml`**، ولا تضغط `Sync`.

## الرجوع (جاهز قبل التنفيذ)

الرابط القديم في Render هو وسيلة الرجوع؛ لا تُدوَّر كلمة مرور `neondb_owner` ولا تُقيَّد
عضوياته قبل نجاح `C4`/`C5`؛ دفعة ملكية معكوسة على `finance` فقط إن لزم؛ أي فشل ⇒ `ROLLBACK`.

## ما بعد التنفيذ (بوابات منفصلة لم تُفتح)

**موافقة نشر منفصلة** لتغيير `DATABASE_URL` ⇒ ثم `C4` (إعادة اختبار RLS والمحفّزات الـ19
بأدوار حقيقية) و`C5` ⇒ فحص بعد التشغيل. الحكم يبقى
`IDENTITY_GAP_CONFIRMED` / `NOT_READY`؛ **المالية غير جاهزة للنشر**.
