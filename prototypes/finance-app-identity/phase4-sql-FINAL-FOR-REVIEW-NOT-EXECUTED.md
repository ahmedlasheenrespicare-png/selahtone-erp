# FINAL FOR REVIEW — دفعة المرحلة ٤ (لم تُنفَّذ / لا تُنفَّذ قبل موافقة منفصلة)

> **للمراجعة فقط.** صيغت بإجازة صريحة: «راجعتُ مسودة المرحلة ٤ وخطة الرجوع،
> وأُجيز صياغة نص SQL النهائي للمراجعة». هذه الإجازة **ليست** موافقة تنفيذ.
> كلمة المرور عنصر نائب `<GENERATED_LOCALLY>` ⇒ النص **غير قابل للّصق كما هو**،
> ولا تُرسل كلمة المرور إلى المحادثة أبدًا. النسخة التنفيذية تُعرض بعد
> **موافقة SQL صريحة منفصلة**؛ الفرق الوحيد في السطر الأخير (`ROLLBACK` ⇒ `COMMIT`
> بعد نجاح التحقق). يبقى بعدها **موافقة نشر منفصلة** ثم `C4`/`C5`.

## ١. تصحيح قرار الإنشاء (مهم قبل أي نقرة في Neon)

| المسار | النتيجة حسب وثائق Neon | الحكم |
|---|---|---|
| **Neon Console ← Add role** | يُمنح `neon_superuser` تلقائيًا ⇒ `BYPASSRLS`, `CREATEDB`, `CREATEROLE`, `REPLICATION`, `pg_read_all_data`, `pg_write_all_data`، و`GRANT ALL ON TABLES/SEQUENCES` في `public` مع `WITH GRANT OPTION` | **مرفوض**: يُعيد إنتاج `C1/C2=FAIL` |
| `neon roles create` (بلا `--access`) | نفس عضوية `neon_superuser` | **مرفوض** |
| API «Create role» | نفس عضوية `neon_superuser` | **مرفوض** |
| **`CREATE ROLE … WITH LOGIN PASSWORD` من Neon SQL Editor** | **لا** عضوية `neon_superuser`؛ صلاحيات `public` الأساسية فقط، ويجب منح الباقي انتقائيًا | **المسار المعتمد** |
| `neon roles create --access read_write` | دور مقيّد بجداول قاعدة واحدة؛ لا يغطي نقل ملكية `finance` وتتابعاتها | بديل جزئي، غير معتمد هنا |

> كانت توصية شفهية سابقة بـ«Console» **خاطئة**؛ تُصحَّح هنا صراحةً.
> المصدر: `content/docs/manage/roles.md` في `neondatabase/website` (تحديث 2026-11-05)،
> أقسام «The neon_superuser role» و«Manage roles with SQL» و«Reserved role names».
> `has_admin_option=false` المكتشف في الجرد يعني أيضًا استحالة سحب تلك العضوية لاحقًا
> من هذا الدور ⇒ **يجب الإنشاء بالطريقة الصحيحة من البداية**.

## ١أ. تصحيح تقني مُتحقَّق مخبريًا على PG18.6 (2026-11-05)

قبل إرسال النص إلى المحادثة، اختُبرت ميكانيكا نقل الملكية على مثيل PG18 مخبري
معزول (`initdb -A trust`، دور غير `superuser` بصفات `CREATEROLE/CREATEDB/BYPASSRLS`
يمثّل `neondb_owner`)، فظهر أن **النسخة السابقة كانت ستفشل**:

| المحاولة | النتيجة المخبرية | التصحيح |
|---|---|---|
| `ALTER TABLE … OWNER TO selahtone_finance_admin` بلا تمهيد | `must be able to SET ROLE "selahtone_finance_admin"` | أُضيف `GRANT selahtone_finance_admin TO neondb_owner` |
| عضوية فقط، بلا `CREATE` على المخطط | `permission denied for schema finance` | أُضيف `GRANT CREATE ON SCHEMA finance TO selahtone_finance_admin` |
| `CREATE` فقط، بلا عضوية | `must be able to SET ROLE` | **الشرطان لازمان معًا** |
| `ALTER SEQUENCE finance.accounts_id_seq OWNER TO …` على `GENERATED … AS IDENTITY` | `cannot change owner of sequence "accounts_id_seq"` | **حُذفت أوامر التتابعات الـ15**؛ ملكيتها تتبع الجدول تلقائيًا |
| بعد نقل ملكية الجدول فقط | الجدول + التتابع + الفهرس ⇒ كلها `selahtone_finance_admin` | تأكيد أن 18 + 15 + 47 = 80 بلا أوامر إضافية |

نمط التتابعات مُطابق لمخطط المختبر: `id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY`
في `prototypes/finance-release/release-candidate.test-only.sql`؛ والجرد الفعلي
يؤكد 18 جدولًا و15 تابعًا، والجداول الثلاثة بلا تابع هي `category_requests`,
`category_revisions`, `requests`. **`REVOKE CREATE` بعد النقل** يعيد أقل صلاحية.

## ٢. الأسماء المختارة (غير محجوزة، ≤63 بايت، lowercase)

| العنصر | الاسم |
|---|---|
| `<FINANCE_APP_ROLE>` | **`selahtone_app`** |
| `<FINANCE_ADMIN_ROLE>` | **`selahtone_finance_admin`** (`NOLOGIN`) |

محجوزة لا تُستخدم: أي اسم يبدأ `pg_`، `neon_superuser`، `cloud_admin`,
`zenith_admin`، `public`، `none`، `web_access`، `token_roles`.
كلمة المرور: ≥12 حرفًا بتنوع أحرف/أرقام/رموز و≈60 بت إنتروبيا، من مدير كلمات مرور،
**لا تُكتب في Git ولا في الشات**؛ تُستبدل محليًا في النص عند التنفيذ فقط.

## ٣. النص النهائي للمراجعة

```sql
-- FINAL FOR REVIEW / NOT EXECUTED / password must be generated locally
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

ROLLBACK;   -- نسخة المراجعة. بعد موافقة SQL منفصلة ونجاح التحقق ⇒ COMMIT;
```

## ٤. خطوات الإنشاء للمشغّل (بعد الموافقة المنفصلة فقط)

1. **لا** تفتح Console ← Roles ← Add role (يُورّث `neon_superuser`).
2. افتح **Neon SQL Editor** على **نفس الفرع/القاعدة** التي فُحصت.
3. ولّد كلمة مرور في مدير كلمات المرور (≥12 حرفًا، تنوع، ≈60 بت) — **لا ترسلها إليّ**.
4. استبدل `<GENERATED_LOCALLY>` محليًا فقط، ثم نفّذ الدفعة **كاملة مرة واحدة**.
5. راقب التحقق: استعلام ٢ كل القيم `false`؛ `app_can_connect=true`؛
   `false/true/false`؛ `80/80/0`؛ و**صفر صفوف** في فحص المالك. أي اختلاف ⇒
   `ROLLBACK` فورًا وأبلغني قبل أي إعادة محاولة.
6. أرسل **ملخصًا وصفيًا فقط** (نجاح/فشل، الأعداد، أسماء الأدوار) بلا كلمة مرور ولا رابط.
7. **لا تُغيّر `DATABASE_URL` ولا `FINANCE_ENABLED` ولا `render.yaml`** في هذه الخطوة.
   الرابط المجمّع للدور الجديد يُجهَّز لكن **يُستخدم في المرحلة ٥ بموافقة نشر منفصلة**.

## ٥. خطة الرجوع (جاهزة قبل التنفيذ)

- **الأساسي**: إعادة `DATABASE_URL` القديم في Render ⇒ يعود التطبيق للعمل، لأن
  `neondb_owner` ما زال مالك `public` وله كل الصلاحيات.
- **لا تُدوَّر كلمة مرور `neondb_owner`، ولا تُقيَّد عضوياته، ولا يُحذف** قبل نجاح
  `C4`/`C5` وفحص ما بعد التشغيل؛ فهو وسيلة الرجوع الوحيدة.
- **رجوع الملكية**: دفعة معكوسة على `finance` فقط، ولا تُنفَّذ إلا إن فشل الأساسي.
- **شرط إيقاف**: أي فشل ⇒ `ROLLBACK`؛ وكل منح/عضوية داخل المعاملة يُلغى معها،
  ولا نشر، ولا تغيير متغيرات.

## ٦. ما لا يفعله هذا الملف

- لم يُنفَّذ، ولم يُنشأ دور، ولم تُمنح صلاحية، ولم تُنقل ملكية، ولم تُغيَّر
  `src` أو `render.yaml` أو أي متغير، ولا نشر/commit/push.
- لا يُفعّل RLS ولا يختبر المحفّزات الـ19 بأدوار حقيقية (`C4` لاحقًا).
- لا يُثبت هوية التطبيق المنشور، ولا نقل نقد مادي أو توقيته، ولا مراجعة بشرية،
  ولا ذرية `access_control`، ولا سلامة نافذة التحويل.
- الحكم يبقى `IDENTITY_GAP_CONFIRMED` / `NOT_READY`؛ **المالية غير جاهزة للنشر**.
