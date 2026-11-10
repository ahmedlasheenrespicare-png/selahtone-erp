# كيف تصل إلى «داخل بيئة التطبيق» لتشغيل فحص الهوية — **Render**

> أُكّد للمستخدم في 2026-11-05 أن التطبيق الشغّال على **Render**، لا Netlify.
> دليل تنفيذ للمشغّل فقط: **قراءة فقط، بلا ترقية، بلا نشر، بلا تعديل `src`**.
> لا يُرسل إلى المحادثة أي رابط اتصال أو كلمة مرور أو اسم قاعدة أو بيانات صفوف؛
> يُرسل عمود `app_connection_probe` وحده. راجع أولًا
> `docs/finance-app-identity-readiness-ar.md`.

## ١. الحكم الفاصل: لا توجد طرفية داخل الخدمة الحالية

`render.yaml` يعلن `plan: free`، ووثائق Render الرسمية تُدرج **Free web service**
بعلامة ❌ لكلّ من **Dashboard shell** و**SSH**؛ والدعم يبدأ من **Paid web service**
[وثائق SSH والـShell](https://render.com/docs/ssh). أي أن المسار الذي اقترحناه سابقًا
لـNetlify (`netlify dev:exec`) **لا ينطبق هنا أصلًا**، ولا يمكن فتح صدفة داخل الخدمة
الحالية دون **ترقية الخطة** — وهو قرار تشغيل وتكلفة يخصّك، لم أتخذه ولم أوصِ به ضمن
هذه الجولة.

إذن «داخل بيئة التطبيق» له مستويان، ويجب التمييز بينهما بصدق:

| المستوى | ماذا يُثبت | الثمن |
|---|---|---|
| **١ — نفس الرابط المجمَّع محليًا** | هوية **الدور** وصلاحياته ومسار الـpooler | بلا ترقية ولا نشر؛ لكن يعتمد على **تأكيدك** أن القيمة هي نفسها التي تستخدمها الخدمة |
| **٢ — داخل الخدمة فعلًا** | هوية اتصال التطبيق المنشور نفسه | ترقية لخطة مدفوعة (Shell/SSH)، أو نشر نقطة نهاية مؤقتة بموافقة منفصلة |

المستوى ١ كافٍ للإجابة عن معظم معيار القبول (`current_user`، العضويات الموروثة،
`can_delete`، RLS)، لكنه **لا يُسقط** القيد
`ROLE_IDENTITY_ONLY_NOT_A_PROOF_OF_THE_DEPLOYED_APP`.

## ٢. أربع حقائق من المستودع غيّرت التوجيه

1. **الخدمة تنشر الفرع `main`** (`render.yaml: branch: main`). كل ملفات جولة الفحص
   **غير متتبَّعة وغير مدفوعة** (HEAD `751d4e5`)، فهي **غير موجودة في نسخة Render
   المنشورة**. لا تبحث عنها داخل الخدمة، ولا تفترض أن `git pull` سيُحضرها.
2. **الأسرار `sync: false`**: `DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`,
   `SEED_PASSWORD` أُدخلت يدويًا عند إنشاء الـBlueprint مرة واحدة، ولا تُكتب في Git،
   وتُتجاهل عند تحديث Blueprint لاحقًا [مواصفة Blueprint](https://render.com/docs/blueprint-spec).
   لا تعتمد على لوحة Render كمصدر لقراءة القيمة؛ استخدم **نسختك الخاصة** التي أدخلتها
   أو أنشئها من Neon. لا تُرسلها إليّ ولا تُلصقها في الطرفية ثم تنسخها.
3. **تعارض مؤكَّد ثم معكوس (2026-11-05):** كانت قيمة `FINANCE_ENABLED` الفعلية
   **`true`** و`render.yaml` يضبطها كقيمة صريحة، بينما `docs/finance-release-runbook.md:130`
   يسجّل أن «مفتاح `FINANCE_ENABLED` غير مضبوط في الإنتاج»، وتعليق
   `src/lib/finance/db.ts` يقول إن مخطط `finance` **غير مُثبَّت في الإنتاج بعد**.
   عمود الفحص أكّد `finance_schema_present=true`. **ثم أطفأ المشغّل المفتاح إلى
   `false`** من تبويب Environment؛ فصار التعارض: **القيمة الفعلية `false` بينما
   `render.yaml:31` ما زال `"true"`**. أي `Sync` للـBlueprint قد يُعيد تفعيل المالية،
   فلا تضغط `Sync`/`Update` قبل تعديل الملف أو قرار موثّق. عند `false` يُرفض أي رد
   نقدي جديد، والتحصيل النقدي يُسجَّل بلا ربط عُهدة، لكن مخطط `finance` والدور الواسع
   و`bypass_rls` تبقى؛ فالإطفاء تجميد واجهة لا إصلاح هوية. يُسجَّل كله في
   `docs/finance-app-connection-probe-result-ar.md` ولا يُحلّ ضمن جولة الفحص.
4. **الاعتماد `pg` في `devDependencies`**: داخل صدفة Render المدفوعة قد لا يكون مثبَّتًا
   إن كان البناء استثنى حزم التطوير. تحقق بـ`node -e "require('pg')"`، وإن غاب
   فثبّته في مجلد مؤقت بلا لمس ملفات التطبيق (المسار ب أدناه).

## ٣. ما لا يصلح

| المسار | السبب |
|---|---|
| Neon SQL Editor | دور فحص مختلف؛ `inspection_role_only=true` لا يُثبت دور التطبيق |
| `DIRECT_URL` | اتصال مباشر بلا pooler؛ يغيّر `session_user` ودورة الاتصال محلّ القياس |
| `SET ROLE` من جلسة أدمن | يحاكي الدور؛ القيد `SESSION_USER_IS_NOT_A_TRUSTED_APP_IDENTITY_UNDER_A_POOLER` |
| `netlify dev:exec` | منصة أخرى غير المنشورة |
| فرع Neon تجريبي | بروفة ترقية، لا إثبات هوية التطبيق المنشور |
| `psql` بالرابط كما هو | `pgbouncer=true` وسيط خاص بـPrisma قد يرفضه الخادم؛ الأداة المحمولة تتجاهله (تحققنا محليًا أن `node-postgres` لا يمرّره) |
| إضافة نقطة نهاية للفحص الآن | تعديل `src` + دفع إلى `main` + نشر = موافقة منفصلة لم تُؤخذ |

**لا أستطيع أنا التنفيذ من هذه الجلسة:** لا `DATABASE_URL` في المعمل، ولا تطبيقات موصولة
(تحقّقنا: موصّلات Netlify وNeon وGitHub غير مدعومة في هذه المحادثة)، والوصول الشبكي
محصور في `github.com`/`registry.npmjs.org`/`pypi.org` ومضيفيها. لا أطلب بيانات الاتصال.

---

## المسار أ — الموصى به الآن: نفس الرابط المجمَّع على جهاز موثوق (بلا ترقية ولا نشر)

١. احصل على **نفس** قيمة `DATABASE_URL` التي أدخلتها عند إنشاء الـBlueprint من سجلك
   الخاص، أو من Neon Console ← **Connection details** ← **Pooled connection**
   (المضيف يحوي `-pooler`)، بنفس الدور ونفس قاعدة التطبيق. **لا** Direct.
٢. خزّنها في متغير بيئة محلي **دون طباعتها**: `read -rs DATABASE_URL; export DATABASE_URL`
   (أو ملف `.env` محلي مُستثنى من Git). لا `echo $DATABASE_URL`.
٣. جهّز ملفًا واحدًا من مساحة العمل (ليس على GitHub):
   `prototypes/finance-app-identity/app-identity-probe-standalone.mjs` — يحمل SQL
   المُراجَع كلمة بكلمة والبصمة `d960c559…83eb` ونفس بوابات الرفض
   (`tests/finance-app-identity-standalone.test.ts` 4/4).
٤. شغّل (Node ≥ 18، و`pg` عبر `npm ci` في نسخة المستودع أو `npm i pg@8` في مجلد مؤقت):

```bash
export FINANCE_IDENTITY_PROBE_CONFIRM="I reviewed the SQL"   # ليس سرًا
node app-identity-probe-standalone.mjs
```

**النتيجة:** سطر JSON واحد = عمود `app_connection_probe`. أرسل هذا السطر فقط.

**حدّ الأمانة:** لأن Render لا يتيح قراءة قيمة السر بعد حفظها، لا أستطيع التحقق من أن
القيمة التي استخدمتها محليًا هي نفسها التي تحقنها الخدمة المنشورة. سجّل ذلك صراحةً
عند تسليم النتيجة؛ لن أدّعي أن المستوى ٢ تحقق.

## المسار ب — داخل الخدمة حرفيًا (يتطلب خطة مدفوعة؛ قرارك وحدك)

إن رقّيت الخدمة إلى خطة مدفوعة، يصبح **Shell** متاحًا من لوحة Render، أو عبر
`render ssh <service-id>` من الـCLI، مع حقن متغيرات الخدمة في الجلسة بلا حاجة لرؤية
الرابط. يوجد أيضًا `render ssh <service-id> --ephemeral` الذي ينشئ نسخة معزولة من
نفس صورة البناء **دون تشغيل أمر البدء** ودون لمس حركة الإنتاج، ويمكن تمرير أمر غير
تفاعلي عبر `--output text -- '<command>'`
[وثائق الـCLI](https://render.com/docs/cli) · [مرجع الأوامر](https://render.com/docs/cli-reference).

داخل الصدفة:

```bash
# الملف المحمول ليس في نسخة main المنشورة: الصق محتواه (لا أسرار فيه) في /tmp
cat > /tmp/probe.mjs <<'PROBE_EOF'
 ... محتوى app-identity-probe-standalone.mjs كما هو ...
PROBE_EOF
npm i pg@8 --prefix /tmp/probe-pg --silent        # لا يلمس ملفات التطبيق
export PG_MODULE_PATH=/tmp/probe-pg/node_modules  # ESM يتجاهل NODE_PATH
export FINANCE_IDENTITY_PROBE_CONFIRM="I reviewed the SQL"
node /tmp/probe.mjs
```

`DATABASE_URL` محقون أصلًا في الجلسة، فلا تُكتب ولا تُعرض. `PG_MODULE_PATH` بديل
`NODE_PATH` لأن الاستيراد ESM لا يقرأ `NODE_PATH`؛ أُضيف وأُثبت باختبار 4/4. هذا هو
المسار الوحيد الذي يُثبت اتصال التطبيق المنشور دون نشر كود جديد. إن استخدمت الـCLI،
فـ`render ssh <service> --ephemeral` يتطلب **خطة مدفوعة مع نشر ناجح واحد على الأقل**
[وثائق SSH](https://render.com/docs/ssh).

## المسار ج — نقطة نهاية مؤقتة أو مهمة لمرة واحدة (موافقة نشر منفصلة، لم تُنفَّذ)

إضافة route محمي بجلسة أدمن ورمز استخدام واحد يعيد العمود المجمَّع فقط، أو خدمة
cron/job مؤقتة تطبعه في السجلات. كلاهما يعني **تعديل/دفع إلى `main` ثم نشر**، أي
موافقة مستقلة وخطة إزالة وسجل تدقيق. **لم يُنفَّذ ولا يُنفَّذ دون موافقة صريحة.**
لا تُضف مسارًا بلا مصادقة: سيكشف هوية القاعدة للعموم.

> للمقارنة فقط: لو انتقل التطبيق يومًا إلى Netlify، فالمسار المقابل هو
> `netlify dev:exec --context production node app-identity-probe-standalone.mjs`
> [1](https://cli.netlify.com/commands/dev/)
> [2](https://docs.netlify.com/api-and-cli-guides/cli-guides/local-development/).

---

## ٤. خطوة بخطوة من `https://dashboard.render.com/blueprints`

> لا أرى شاشتك؛ أسماء التبويبات من وثائق Render وقد تختلف قليلًا بين إصدارات اللوحة.
> **القاعدة الذهبية: قراءة فقط.** لا تضغط `Save` ولا `Sync` ولا `Update` ولا
> `Manual Deploy` ولا `New Blueprint` — مزامنة الـBlueprint تُعيد نشر `render.yaml`
> من الفرع `main` (الذي لا يحوي ملف الفحص أصلًا) وقد تُعيد تطبيق `FINANCE_ENABLED=true` **وتُعيد فتح المالية بعد أن أطفأها المشغّل إلى `false`**.

**المرحلة ١ — من قائمة Blueprints إلى الخدمة**

١. في صفحة **Blueprints**، ابحث عن الـBlueprint المرتبط بمستودع
   `ahmedlasheenrespicare-png/selahtone-erp` والفرع `main`، واضغط **اسمه** لا زر
   إجراء بجانبه. الـBlueprint هو مصدر واحد لإعداد الخدمات والمتغيرات
   [وثائق Blueprints](https://render.com/docs/infrastructure-as-code).
٢. في صفحة الـBlueprint افتح قائمة **Resources / Services** واضغط خدمة الويب
   **`selahtone-erp`**. إن تعذّر العثور عليها، استخدم **البحث العام** أعلى اللوحة
   واكتب `selahtone-erp` ثم اختر الخدمة من النتائج
   [1](https://render.com/blog/introducing-renders-new-cli-and-refreshed-dashboard).
٣. أنت الآن في صفحة الخدمة: قائمة سياقية على اليسار (Logs / Metrics / Settings / ...)
   وزر **Connect** أعلى اليمين [2](https://render.com/docs/ssh).

**المرحلة ٢ — ثلاثة فحوص بلا أي تغيير**

٤. **Settings**: سجّل **Instance Type / Plan** (هل `Free` أم `Starter`؟)، و**Branch**
   (`main`)، و**Region** (`frankfurt`). لا تحفظ شيئًا.
٥. **Environment**: تأكد وجود المفاتيح `DATABASE_URL` و`DIRECT_URL` و`AUTH_SECRET`
   و`FINANCE_ENABLED`. اقرأ **قيمة `FINANCE_ENABLED` وحدها** (قيمة عادية غير سرية)
   وسجّلها ليُقارَن بتعارض القسم ٢. **لا تنسخ ولا تصوّر قيم الأسرار**، ولا تضغط
   `Edit` / `Add` / `Delete`.
٦. ابحث عن تبويب **Shell** في القائمة، ثم افتح **Connect** ← تبويب **SSH**:
   - **إن غاب الاثنان (المتوقع مع `plan: free`)**: توقّف هنا. الخطة المجانية بلا
     Dashboard shell وبلا SSH وبلا one-off jobs/cron، فلا يوجد أي مكان لتنفيذ أمر
     داخل الخدمة [وثائق SSH](https://render.com/docs/ssh). → المرحلة ٣.
   - **إن وُجدا (خطة مدفوعة)**: → المرحلة ٤.

**المرحلة ٣ — المسار المتاح على Free (داخل Render للتحقق، وخارجه للتنفيذ)**

٧. افتح **Neon Console** في تبويب آخر (لا تغلق Render): اختر المشروع ← **Connect**
   من شريط التنقل ← في نافذة *Connect to your branch* اختر **Branch** و**Compute**
   و**Database** و**Role** **نفس** قيم التطبيق ← شغّل **Connection pooling**
   (المضيف يحوي `-pooler`) ← **Copy**
   [1](https://neon.com/docs/connect/connection-pooling). لا تُلصق الرابط في المحادثة.
٨. على جهازك: `read -rs DATABASE_URL; export DATABASE_URL` (بلا `echo`)، ثم حمّل
   `app-identity-probe-standalone.mjs` من مساحة العمل ونفّذ أمر المسار أ أعلاه.
   أرسل سطر `app_connection_probe` فقط. سجّل أن المطابقة بين قيمة Neon وقيمة
   `DATABASE_URL` المحقونة في Render هي **تأكيد منك** لا إثبات من اللوحة.

**المرحلة ٤ — إن كانت الخطة مدفوعة: Shell داخل الخدمة**

٩. افتح **Shell** من القائمة (أو `render ssh <service-id>` / `--ephemeral` من الـCLI).
   المتغيرات محقونة تلقائيًا، فلا حاجة لرؤية الرابط. انسخ محتوى الملف المحمول إلى
   `/tmp/probe.mjs` ثم نفّذ أوامر المسار ب أعلاه. الجلسة تُسجَّل في سجل التدقيق،
   والنسخة `--ephemeral` معزولة لا تستقبل حركة ولا تُشغّل أمر البدء.

## ٥. قواعد التنفيذ

- أرسل **عمود `app_connection_probe` فقط**؛ لا روابط، لا كلمات مرور، لا أسماء قواعد،
  لا بيانات صفوف، لا نصوص أخطاء السائق.
- إن ظهر رمز `APP_IDENTITY_PROBE_*` فأرسل **الرمز وحده**؛ لا تُعد المحاولة بتغيير
  النص، ولا تستخدم `DIRECT_URL`، ولا تضع `FINANCE_IDENTITY_PROBE_ALLOW_DIRECT=yes`.
- لا `SET ROLE`، لا SQL Editor، لا تشغيل على فرع تجريبي كبديل، ولا تغيير
  `FINANCE_ENABLED` أو أي متغير في Render ضمن هذه الجولة.
- بعد وصول العمود يُشغَّل
  `prototypes/finance-app-identity/evaluate-app-connection-probe.mjs` أوفلاين في
  المعمل؛ لا يُعاد إرسال التقرير إلى أي خدمة.

## ٦. إن ظهر `Error: Cannot find module ... app-identity-probe-standalone.mjs`

هذا يعني **فقط** أن الملف لم يُنقل إلى المجلد الذي شغّلت منه الأمر (في المثال: `~`). لا علاقة للخطأ بالقاعدة أو الصلاحيات، ولم يُنفَّذ أي استعلام، ولم يُلمس الإنتاج. حتى بعد نقله كان سيتوقف عند غياب `DATABASE_URL` وحزمة `pg`، فالأمر الذي أُعطي سابقًا كان ناقصًا من ثلاث جهات؛ هذا القسم يغلقها كلها.

**أ — سكربت واحد (موصى به):** حمّل `prototypes/finance-app-identity/install-and-run-on-mac.sh` من مساحة العمل إلى جهازك، ثم:

```bash
bash ~/Downloads/install-and-run-on-mac.sh
```

ينشئ `~/finance-probe`، يفكّ الحمولة المضغوطة إلى **الملف الأصلي بايت ببايت**، يثبّت `pg@8` محليًا، يطلب `DATABASE_URL` بـ`read -r -s` دون طباعته، يضبط التأكيد، ثم يشغّل الفحص ويطبع العمود المجمَّع فقط. لا يحتوي السكربت أي سرّ. (`base64 -D` خاص بـmacOS؛ على Linux استبدله بـ`base64 -d`.)

**ب — إن لم تستطع تنزيل الملف:** الحمولة نفسها محفوظة في `prototypes/finance-app-identity/probe-payload.b64`، ويمكن لصقها كلها في أمر واحد:

```bash
mkdir -p ~/finance-probe && cd ~/finance-probe && printf '%s' '<محتوى probe-payload.b64>' | base64 -D | gunzip > app-identity-probe-standalone.mjs && npm init -y >/dev/null 2>&1 && npm i pg@8 --silent && printf 'Paste pooled DATABASE_URL (hidden): ' && read -r -s DATABASE_URL && printf '\n' && export DATABASE_URL && export FINANCE_IDENTITY_PROBE_CONFIRM="I reviewed the SQL" && node app-identity-probe-standalone.mjs
```

`tests/finance-app-identity-standalone.test.ts` **5/5** يُثبت أن فكّ الحمولة يطابق الملف الأصلي والبصمة، وأن السكربت يضمّن الحمولة ويقرأ الرابط دون `echo`. عند المطالبة، الصق **الرابط المجمَّع** نفسه (`-pooler`) الذي أدخلته في Render؛ لا يظهر على الشاشة ولا يُرسل إليّ. أرسل بعدها **سطر `app_connection_probe` فقط**، أو رمز `APP_IDENTITY_PROBE_*` إن ظهر.

## ٧. حدود

نُفّذ الفحص بالفعل من جهاز المشغّل بالرابط المجمَّع (النتيجة `IDENTITY_GAP_CONFIRMED`؛
`docs/finance-app-connection-probe-result-ar.md`)، لكنه لم يُشغَّل بعد من داخل دوال Render،
فلا يُثبت هوية التطبيق المنشور إثباتًا كاملًا. هذا الدليل لا يُثبت نقل نقد مادي أو
توقيته، ولا جردًا أو مراجعة بشرية، ولا ذرية `access_control`، ولا سلامة نافذة التحويل،
ولا محرك Prisma الأصلي أو مجمّع Neon. لا ترقية، لا بيانات فعلية، لا نشر، لا commit/push.
**المالية ما زالت غير جاهزة للنشر.**
