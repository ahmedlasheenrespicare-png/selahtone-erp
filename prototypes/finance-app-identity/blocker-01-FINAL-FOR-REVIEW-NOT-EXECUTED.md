# النص النهائي للمراجعة فقط — المانع ١: هوية اتصال التطبيق المنشور

**FINAL FOR REVIEW · NOT EXECUTED · NOT APPROVED FOR EXECUTION · TEST ONLY**

- **التاريخ:** 2026-11-05
- **السند:** قبول المشغّل «قبلتها» لمسودة §٧٢ (التي كانت «للمراجعة فقط، دون تنفيذ»). القبول **ليس** موافقة تنفيذ ولا يفتح بوابة.
- **المانع:** `DEPLOYED_APP_ROLE_IDENTITY_READ_ONLY_PROOF` — ما زال `UNRESOLVED`.
- **بصمة نص SQL (SHA-256):** `da711cb371184fcf680808355f55514f8804a13d24316aec76dcbd34ab69ef4a`
- **الحالة:** `FINAL_FOR_REVIEW_NOT_EXECUTED` · `blockers_resolved=0` · `gates_opened=0` · `NOT_READY`.

## ١. ما هو هذا النص

نص SQL **قراءة-only** واحد، يُثبَّت ببصمته قبل أي مراجعة، داخل معاملة `READ ONLY` تُرجَّع. الغرض: إثبات أن **الاتصال الذي تُنشئه العملية الشغّالة نفسها** يستخدم `selahtone_app`. لا يُنفَّذ من الجلسة، ولا يُرسل كأمر للمشغّل الآن، ولا يحوي أي سرّ.

## ٢. النص (للمراجعة فقط — لا تُنفّذه)

```sql
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '15s';
SELECT json_build_object(
  'probe_scope', 'DEPLOYED_APP_IDENTITY_READ_ONLY',
  'probe_version', '1.2',
  'read_only_transaction', current_setting('transaction_read_only'),
  'current_user', current_user::text,
  'session_user', session_user::text,
  'role_flags', (
    SELECT json_build_object(
      'superuser', r.rolsuper,
      'bypass_rls', r.rolbypassrls,
      'create_role', r.rolcreaterole,
      'create_db', r.rolcreatedb,
      'replication', r.rolreplication,
      'can_login', r.rolcanlogin,
      'inherit', r.rolinherit
    )
    FROM pg_roles r
    WHERE r.rolname = current_user
  ),
  'inherited_roles', (
    SELECT COALESCE(json_agg(m.roleid::regrole::text ORDER BY m.roleid::regrole::text), '[]'::json)
    FROM pg_auth_members m
    WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = current_user)
  ),
  'privileged_builtin_roles', (
    SELECT COALESCE(json_agg(r.rolname ORDER BY r.rolname), '[]'::json)
    FROM pg_roles r
    WHERE r.rolname IN ('pg_read_all_data', 'pg_write_all_data', 'neon_superuser')
      AND pg_has_role(current_user, r.rolname, 'MEMBER')
  ),
  'finance_objects_owned_by_current_user', (
    SELECT count(*)
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'finance'
      AND c.relkind IN ('r', 'S', 'i')
      AND c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
  ),
  'can_create_in_finance', has_schema_privilege(current_user, 'finance', 'CREATE'),
  'statement_timeout', current_setting('statement_timeout')
) AS app_identity_probe;
ROLLBACK;
```

## ٣. شروط الإثبات (جوهرية)

1. يُنشأ الاتصال **داخل العملية الشغّالة** من إعداداتها الفعلية (لا Mac، لا SQL Editor، لا Shell).
2. البصمة `da711cb371184fcf680808355f55514f8804a13d24316aec76dcbd34ab69ef4a` تُحسب من النص نفسه قبل التنفيذ؛ أي تعديل ⇒ رفض.
3. الرابط **Pooled** فقط لدور `selahtone_app`؛ يُمنع الرابط المباشر.
4. لا يُقرأ `neondb_owner`/`C5` المحلي كبديل: `A_LOCAL_PROBE_PROVES_THE_URL_ROLE_NOT_THE_DEPLOYED_APP_IDENTITY`.

## ٤. معايير القبول الستة (بعد execution مُجاز لاحقًا)

| # | المعيار |
|---|---|
| ١ | `current_user = session_user = selahtone_app` من اتصال العملية الشغّالة |
| ٢ | `read_only_transaction`=`on`، و`superuser`/`bypass_rls`/`create_role`/`create_db`/`replication` كلها `false` |
| ٣ | `privileged_builtin_roles` خالٍ، ولا عضويات موروثة ممنوحة |
| ٤ | `finance_objects_owned_by_current_user=0` و`can_create_in_finance=false` |
| ٥ | وصول وسم `ROLLBACK` فعلًا، وصفر أسرار/روابط/`@`/`sslmode` في المخرج |
| ٦ | طابع زمني وسنة يربطان النتيجة بضبط المتغير؛ ولا استنتاج عن RLS/المحفّزات/النقد/المراجعة البشرية |

## ٥. خطة الرجوع (وصفية، تُطلَب موافقة منفصلة عليها)

لا أثر بياناتي (قراءة-only + `ROLLBACK`). عند خطأ اتصال ⇒ إعادة قيمة `DATABASE_URL` إلى الرابط القديم المجمّع فورًا، وإبقاء `FINANCE_ENABLED=false`، وتسجيل صنف الخطأ وصفيًا. لا ترقية، ولا كلمة مرور جديدة، ولا تدوير `neondb_owner`، ولا حذف أدوار، ولا `COMMIT`.

## ٦. البوابات المنفصلة المطلوبة قبل أي تنفيذ (لم تصل)

1. **موافقة حرفية منفصلة** على هذا النص النهائي وخطة الرجوع.
2. **موافقة منفصلة** على مسار التنفيذ داخل الخدمة.
3. **موافقتا `src` ونشر منفصلتان** إن تطلب المسار كودًا.
4. بعد التنفيذ: **تقييم أوفلاين** للمخرج ⇒ المانع ١ يبقى مفتوحًا حتى تُستوفى المعايير الستة.

## ٧. ما لا يفعله هذا النص

لا يُنفَّذ، ولا يُثبت هوية، ولا يُغلق المانع، ولا يُجيز نشرًا أو إعادة تفعيل، ولا يُغيّر `src`/`render.yaml`، ولا يلمس قاعدة الإنتاج. `SESSION_NEVER_EXECUTES_PRODUCTION_SQL_OR_DEPLOYS_OR_SETS_ENV_VARS`.

`STRICT_REJECT_POLICY_STILL_IN_FORCE`: «تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.»

**الحكم:** `IDENTITY_GAP_CONFIRMED` / `NOT_READY` — المالية تبقى `FINANCE_ENABLED=false`.
