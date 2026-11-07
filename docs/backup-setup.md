# إعداد النسخ الاحتياطي الليلي — خطوة بخطوة

> آخر تحديث: **٢٠٢٦-١١-٠٧** · الحالة: **النسخ لا يعمل منذ إنشائه** (١٠ تشغيلات، كلها فاشلة).

---

## ١. الوضع الحالي بالأرقام (قبل أي إصلاح)

| المقياس | القيمة |
|---|---|
| عدد تشغيلات `nightly-db-backup` منذ إنشائها | **١٠** |
| عدد الناجح منها | **٠** |
| أول تشغيل | ٢٠٢٦-١٠-٢٩ (سير العمل أُنشئ في `50f7bba7`، ٢٠٢٦-١٠-٢٨) |
| بصمة الفشل في كل مرة | الخطوة «Run encrypted backup…» تفشل بـ`exit 1` في **صفر ثانية** |

**السبب:** صفر ثانية تعني أنّ السكربت لم يفتح أيّ اتصال؛ مات في أول حارس:

```bash
: "${DATABASE_URL:?DATABASE_URL مطلوب}"
```

فأحد الأسرار الستة (أو كلها) **غير مضبوط** في إعدادات المستودع. ليس خطأ كود.

> حدود التوثيق: لم تُقرأ نصوص سجلات GitHub (الوصول إلى `results-receiver…` محجوب في بيئة العمل). التشخيص مبنيّ على توقيت الخطوات وبنية السكربت، ولذلك أُضيفت خطوة «فحص الأسرار» لتسمية الناقص يقينًا لا استنتاجًا.

**الأثر:** لا توجد نسخة احتياطية واحدة لقاعدة البيانات منذ عشرة أيام.

---

## ٢. الأسرار الستة المطلوبة

تُضاف في: **GitHub ← المستودع ← Settings ← Secrets and variables ← Actions ← New repository secret**

| السر | من أين تأتي به |
|---|---|
| `DATABASE_URL` | **الرابط المباشر** من لوحة Neon (التفاصيل أدناه) |
| `R2_ENDPOINT` | `https://<account_id>.r2.cloudflarestorage.com` |
| `R2_BUCKET` | اسم البكت (مثل `selahtone-backups`) |
| `R2_ACCESS_KEY_ID` | من R2 ← Manage R2 API Tokens |
| `R2_SECRET_ACCESS_KEY` | تظهر مرة واحدة عند إنشاء المفتاح — انسخها فورًا |
| `BACKUP_PASSPHRASE` | كلمة مرور تشفير قوية من عندك (التفاصيل أدناه) |

---

## ٣. الخطوة ١ — إنشاء البكت والمفتاح في Cloudflare R2

الخطة المجانية تكفي: **١٠ جيجابايت تخزين · مليون عملية Class A · ١٠ ملايين Class B شهريًا · بلا رسوم خروج**. نسخة يومية مضغوطة لقاعدة بهذا الحجم تبقى أقل من جيجابايت واحد بمدة احتفاظ ٣٠ يومًا.

1. سجّل الدخول إلى لوحة Cloudflare ← **R2**.
2. **Create bucket** — الاسم: `selahtone-backups`، المنطقة: أي منطقة (الأقرب أوروبا).
3. من صفحة R2 ← **Manage R2 API Tokens** ← **Create API token**:
   - الصلاحية: **Object Read & Write**
   - قيّدها على البكت `selahtone-backups` وحدها (أفضل من صلاحية عامة)
4. انسخ **Access Key ID** و**Secret Access Key** (الثانية لا تُعرض مرة أخرى).
5. `R2_ENDPOINT` تجده في صفحة البكت ← **Settings** بصيغة `https://<account_id>.r2.cloudflarestorage.com`.

---

## ٤. الخطوة ٢ — رابط Neon **المباشر** (أهم نقطة وأكثرها تسببًا للفشل)

`pg_dump` لا يعمل على الرابط المجمَّع (`-pooler`)؛ يحتاج الاتصال المباشر.

1. لوحة Neon ← مشروعك ← **Connection details**.
2. اختر **Direct connection** (لا Pooled connection).
3. انسخ الرابط — تأكد أنّ النطاق **لا** يحتوي كلمة `pooler`، وأضف `?sslmode=require` إن لم يكن موجودًا.
4. ضعه في سرّ `DATABASE_URL` **الخاص بـGitHub** (ليس بالضرورة أن يطابق ما في Render؛ فالتطبيق يستفيد من التجميع، والنسخ لا).

> حارسٌ في السكربت يرفض الآن أيّ رابط فيه `pooler` ويعطي رسالة واضحة. لتجاوزه في حالة واثقة: `ALLOW_POOLED_URL=1`.

---

## ٥. الخطوة ٣ — كلمة مرور التشفير

- أنشئ كلمة طويلة (٢٠ حرفًا فأكثر) في مدير كلمات المرور.
- **احفظها خارج Git، في مكانين.** ضياعها يعني أنّ كل النسخ المشفّرة تصبح بلا قيمة — ولا سبيل لاسترجاعها.
- لا تستخدمها لأي غرض آخر.

---

## ٦. الخطوة ٤ — إضافة الأسرار

أضف الأسماء الستة في **Settings ← Secrets and variables ← Actions ← New repository secret**، واحدًا واحدًا، ثم:

**Actions ← nightly-db-backup ← Run workflow ← Branch: الفرع الذي تريد اختباره ← Run workflow**

الخطوة الأولى الآن اسمها **«فحص الأسرار قبل النسخ»**، وستقول لك بالاسم ما الناقص:

- ظهر `أسرار ناقصة في GitHub: …` ⇒ أضف المسمّاة وأعد التشغيل.
- ظهر `مضبوط:` للستة ⇒ الأسرار كاملة، وسيبدأ التفريغ الفعلي.

---

## ٧. التحقق بعد أول نجاح

1. **من جهازك** (بعد تثبيت AWS CLI وضبط مفاتيح R2):
   ```bash
   aws s3 ls s3://selahtone-backups/db/ --endpoint-url https://<account_id>.r2.cloudflarestorage.com
   ```
   يجب أن ترى `selahtone-<تاريخ>.sql.gz.enc` وملف `last-backup.json`.
2. **اختبار استعادة حقيقي** — على قاعدة منفصلة، لا الإنتاج أبدًا:
   ```bash
   BACKUP_PASSPHRASE=... bash scripts/restore-drill.sh --file selahtone-<تاريخ>.sql.gz.enc
   ```
   ثم باستهداف قاعدة تجريبية:
   ```bash
   BACKUP_PASSPHRASE=... bash scripts/restore-drill.sh --file ... --target "postgres://…/drilldb?sslmode=require"
   ```
   السكربت يرفض أي هدف على نطاق `neon.tech` إلا بـ`--allow-neon-target` — احترس قبل تمريره.
3. **راقب التشغيل التالي في موعده** (٠١:٠٠ UTC = ٠٣:٠٠ القاهرة). الفشل يُعلَن بـ`::error::` في صفحة التشغيل.

---

## ٨. استكشاف الأخطاء

| الرسالة | السبب | الحل |
|---|---|---|
| `أسرار ناقصة …` | سرّ غير مضاف أو فارغ | أضفه من Settings |
| `رابط القاعدة مجمَّع (يحتوي 'pooler')` | استُخدم رابط Neon المجمَّع | استبدله بالمباشر |
| `pg_dump: error: connection to server failed` | الرابط خاطئ أو الشبكة/CIDR محجوب | جرّب الرابط من جهازك أولًا بـ`psql` |
| `An error occurred (InvalidAccessKeyId)` | مفتاح R2 خاطئ أو منسوخ ناقص | أنشئ مفتاحًا جديدًا |
| `upload failed: … NoSuchBucket` | اسم البكت خطأ أو المفتاح غير مقيّد عليه | طابق `R2_BUCKET` مع الاسم الحقيقي |
| نجح الرفع لكن الحجم ٠ ك.ب | `pg_dump` فشل بصمت أو صلاحيات ناقصة | راجع سجل الخطوة؛ جرّب `pg_dump` يدويًا |

---

## ٩. بديلٌ بلا حساب سحابي (إن لم ترغب بـR2)

يُرفع النسخ كملف **artifact** على GitHub مجانًا (مدة الاحتفاظ قابلة للضبط حتى ٩٠ يومًا)، ويُنزَّل من صفحة التشغيل. يكفي لقاعدة صغيرة، وحده الأهم: **نسخة موجودة تستطيع استرجاعها**. التحويل تغييرٌ صغير في `.github/workflows/nightly-backup.yml` (استبدال خطوة الرفع بـ`actions/upload-artifact@v4`) — يُنفَّذ عند الطلب.

> تنبيه دائم: قسم `restore-drill` في سير العمل **نصٌّ توضيحي فقط** ولا ينفّذ استعادة فعلية. النسخة غير المُختبرة ليست نسخة.

---

## ١٠. تصدير نسخة الآن (مرة واحدة) — قبل ضبط R2

طريقان: الأول بالمتصفح وحده (من الجوال أو الماك)، والثاني بطرفية الماك.

### الطريق أ — من المتصفح، بلا تثبيت شيء

يستخدم سير العمل `.github/workflows/manual-db-export.yml` (تشغيل يدوي فقط، لا جدولة، ولا يرفع إلى R2).

1. **بعد دمج هذا الفرع في `main`**: `Actions` ← «تصدير قاعدة البيانات» ← **Run workflow** ← اختر:
   - `retention_days`: مدة بقاء الملف على GitHub (٧ افتراضيًا، حتى ٩٠).
   - `encrypt`: صح ⇠ يُشفَّر الملف بـ`BACKUP_PASSPHRASE` إن كان مضبوطًا.
2. انتظر نحو دقيقة، ثم من أسفل صفحة التشغيل: قسم **Artifacts** ← `db-export-<رقم التشغيل>` ← تنزيل.
3. يلزمه سرّ واحد على الأقل: `DATABASE_URL` (المباشر). و`BACKUP_PASSPHRASE` إن أردت التشفير.
4. **الملف يحوي بيانات حقيقية**: نزّله، استخدمه، ثم احذفه. لا ترفعه إلى Git ولا تضعه في مجلد مشترك.

> ملاحظة: لا يظهر سير العمل في قائمة Actions إلا بعد وجوده على الفرع الافتراضي `main`؛ فادمج الفرع أولًا.

### الطريق ب — من طرفية الماك (بلا GitHub)

```bash
# مرة واحدة: تثبيت عميل PostgreSQL بلا خادم
brew install libpq
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"      # ماك بمعالج Intel: /usr/local/opt/libpq/bin

# التفريغ
pg_dump "الرابط_المباشر?sslmode=require" \
  --no-owner --no-privileges --format=plain --clean --if-exists \
  | gzip -9 > ~/Desktop/selahtone-$(date +%F).sql.gz
```

- الرابط **المباشر** لا المجمَّع: `pg_dump` يستخدم أوامر على مستوى الجلسة، وPgBouncer في Neon لا يدعمها، فالتفريغ عبر الرابط المجمَّع يفشل. [1](https://neon.com/faqs/export-database-sql-file)
- لا يصلح هذا الطريق من الجوال؛ استخدم الطريق أ.

### استرجاع الملف على قاعدة منفصلة (لا الإنتاج أبدًا)

```bash
# غير مشفَّر
gunzip -c selahtone-2026-11-07.sql.gz | psql "postgres://…/drilldb?sslmode=require"

# مشفَّر
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE \
  -in selahtone-2026-11-07.sql.gz.enc | gunzip | psql "postgres://…/drilldb?sslmode=require"

# أو بالسكربت الجاهز (يرفض أي هدف على نطاق neon.tech إلا بـ--allow-neon-target)
bash scripts/restore-drill.sh --file selahtone-2026-11-07.sql.gz.enc --target "postgres://…/drilldb?sslmode=require"
```

[1] Neon FAQ — تصدير قاعدة البيانات: https://neon.com/faqs/export-database-sql-file
