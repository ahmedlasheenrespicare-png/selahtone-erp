# النص المُراجَع للمراجعة فقط — مسار فحص هوية الاتصال داخل الخدمة

**REVIEWED TEXT · FOR REVIEW ONLY · NOT EXECUTABLE · NOT AN EXECUTION APPROVAL · TEST ONLY**

- **التاريخ:** 2026-11-05
- **السند:** تكليف **منفصل صريح** بإعداد نص مُراجَع لمسار الفحص داخل الخدمة (مراجعة فقط) — الخطوة ٢ من ترتيب §٨٤.
- **بصمة المواصفات (SHA-256):** `629e28dfa63aae13714a3858c7df0484a1a2486bd03b0db133aa37dcfbd62f1e`
- **الحالة:** `REVIEWED_TEXT_PREPARED_FOR_REVIEW_ONLY_NO_GATE_OPENED` · `blockers_resolved=0` · `gates_opened=0` · `NOT_READY`.

## ١. ما هذا النص
مواصفات تصميم **وصفية** لمسار تشخيص داخل العملية الشغّالة نفسها، تُثبَّت ببصمتها قبل أي مراجعة. ليس SQL تنفيذيًا، وليس كودًا، ولا يُطبَّق في `src` الآن. الغرض: إثبات أن الاتصال الذي تُنشئه الخدمة من إعداداتها الفعلية يستخدم `selahtone_app` — لا جلسة SQL Editor ولا جهاز محلي.

## ٢. المواصفات المُثبَّتة (للمراجعة فقط)

```text
IN_SERVICE_IDENTITY_PROBE_SPEC v1.0 / REVIEW ONLY / NOT EXECUTABLE / TEST ONLY

PURPOSE
Prove the identity of the connection that the deployed Next.js process itself
creates from its own runtime configuration, not an admin SQL Editor session.

DESIGN (descriptive only; no source file is modified at this stage)
1. A protected diagnostic path inside the SAME running service process.
2. It reuses the service's existing database client / pool as configured in
   the deployed environment. No new credential, no SET ROLE, no external URL.
3. The observation runs inside a read-only transaction that is rolled back.
4. A short statement timeout applies; no writes, no DDL, no COMMIT.
5. Output is descriptive metadata only, never table rows or secrets:
   current_user, session_user, role attribute flags, inherited roles,
   privileged built-in roles, count of finance objects owned by the session,
   the CREATE privilege on the finance schema, transaction read-only state,
   UTC timestamp with year, and a descriptive deployment commit identifier.
6. Pooled connection only; never print any connection value, password,
   SSL mode, or credential. On a connection error revert to the old pooled
   value immediately and keep FINANCE_ENABLED=false.

ACCEPTANCE CRITERIA (six)
A1 current_user = session_user = selahtone_app, observed from the service.
A2 read-only transaction on; superuser, bypassrls, createrole, createdb,
   replication all false; canlogin and inherit true.
A3 privileged built-in roles empty; no inherited write-all-data role.
A4 finance objects owned by current_user = 0; CREATE on finance = false.
A5 ROLLBACK observed; UTC timestamp, year and deployment commit present;
   zero secrets, zero rows and zero connection values in the output.
A6 The result is bound to the live service process, not to SQL Editor,
   a local machine, a UI page, a deploy log, or an operator report.

OUT OF SCOPE
RLS enforcement, trigger enforcement, atomic access_control, PrismaPg 6.19.3
transaction-commit failure behaviour, rollback rehearsal, cash-movement
timing, human review, conversion window, log year/timestamps,
FINANCE_ENABLED=true.

BOUNDARIES
NO_SRC_NO_RENDER_YAML_NO_PRODUCTION_SQL_NO_DEPLOY_NO_SYNC_NO_TRUE
SESSION_NEVER_EXECUTES_PRODUCTION_SQL_OR_DEPLOYS_OR_SETS_ENV_VARS
This specification is NOT executable SQL and NOT an execution approval.
```

## ٣. شروط جوهرية
- `A_LOCAL_PROBE_PROVES_THE_URL_ROLE_NOT_THE_DEPLOYED_APP_IDENTITY`؛ ونتيجة §٧٥/§٧٦ من SQL Editor خارج النطاق.
- البصمة `629e28dfa63aae13714a3858c7df0484a1a2486bd03b0db133aa37dcfbd62f1e` تُحسب من كتلة المواصفات نفسها؛ أي تعديل ⇒ رفض.
- الرابط **Pooled** فقط؛ الرجوع للرابط القديم فور خطأ اتصال؛ إبقاء `false`.
- المخرج وصفي فقط: **صفر صفوف بيانات، صفر أسرار، صفر قيم اتصال**.
- لا قيمة اتصال ولا كلمة مرور ولا تدوير `neondb_owner` ولا حذف أدوار ولا ترقية بيانات.

## ٤. حدود الرجوع (وصف أولي يُستكمل في مرحلة منفصلة)
لا أثر بياناتي (قراءة-only + رجوع). خطة الرجوع **تُعد وتُعتمد في الخطوة ٦ المنفصلة** بعد الموافقة الحرفية على هذا النص؛ لا تُجمَع معه الآن (`ROLLBACK_PLAN_MUST_FOLLOW_THE_SEPARATE_VERBATIM_APPROVAL`).

## ٥. البوابات المنفصلة المتبقية (لم تصل)
1. مراجعتك لهذا النص.
2. **موافقة حرفية منفصلة** على هذا النص بالذات ببصمته.
3. خطة رجوع منفصلة ⇒ موافقة منفصلة عليها.
4. موافقة منفصلة على المسار داخل الخدمة.
5. موافقتا `src` ونشر منفصلتان إن لزم (لا تعديل `src` الآن).
6. التنفيذ **من المشغّل لا من الجلسة** ⇒ تقييم أوفلاين ⇒ قرار إعادة تفعيل منفصل لا يُطلب الآن.

## ٦. ما لا يفعله هذا النص
لا يُنفَّذ، ولا يُثبت هوية، ولا يُغلق المانع ١، ولا يُجيز نشرًا أو إعادة تفعيل، ولا يُغيّر `src`/`render.yaml`، ولا يلمس قاعدة الإنتاج. `SESSION_NEVER_EXECUTES_PRODUCTION_SQL_OR_DEPLOYS_OR_SETS_ENV_VARS`.

`STRICT_REJECT_POLICY_STILL_IN_FORCE`: «تعذّر التحقق من نتيجة الطلب المحفوظ؛ يلزم مراجعة أو ترحيل الطلب القديم.»

**الحكم:** `IDENTITY_GAP_CONFIRMED` / `C1/C2=FAIL` / `NOT_READY` — المالية تبقى `FINANCE_ENABLED=false`.
