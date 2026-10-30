# أوامر جاهزة للنسخ قبل ترقية المالية

كل ما تحتاجه هنا: **تنفيذ الأوامر كما هي، ثم إرسال الناتج إليّ**. لا ترسل أي أسرار أو
قيم اتصال؛ الأوامر تقرأ `DATABASE_URL` من بيئتك ولا تطبعها.

> قاعدة عامة: لا تُكمل كتلة قبل أن أرد على ناتجها. الكتلة الأخيرة (التنفيذ) لن تصلها
> إلا بعد موافقتك المنفصلة.

> **التحقق من الملف قبل تشغيله:** لكل ملف بصمتان مختلفتان عن قصد — `sha256` **للملف
> نفسه** (تتحقق أنك نسخته بلا تغيير) و**بصمة السجل** المدوّنة داخله والمقارَنة في القاعدة.
> - الترقية: ملف `67aa97b986cbf620a3083744ddcab8c579fcb2d17c6aa413d69484347fa6517e`، سجل `6f00bfa0054533e8d653ca93d9ef9d176437d838b06b1ea990ad98f95eef0ed8`.
> - الرجوع: ملف `4a8eb8abc8eafb83402be39c03ba9781bf273d390f46b1b042ac840e069a1178`، سجل `a503a87a73df0b1b28d4e65b427e0041b59143db111609fad8c8936b16ac1ed8`.

## أي مسار تختار؟

| المسار | أين يُنفَّذ | ماذا يغطي |
|---|---|---|
| **أ — المتصفح فقط (موصى به الآن)** | Neon Console + SQL Editor | فرع تجريبي من الإنتاج + بروفة كاملة للترقية عليه، دون طرفية |
| **ب — الطرفية على جهازك** | Terminal | `pg_dump` واستعادة حقيقية لملف نسخة |

**Neon SQL Editor لا يستطيع** تنفيذ `pg_dump` أو `psql` أو سكربتات bash، ولا يقرأ ملفًا
من جهازك، ولا ينشئ ملفات. لذلك مسار النسخة والاستعادة (الكتل ٠–٤) يحتاج طرفية أو Docker،
أو يستبدله المسار (أ) بفرع تجريبي. ملفات SQL نفسها (فحص قبل/بعد، الترقية، الرجوع) تعمل
في SQL Editor في المسارين.

---

# المسار أ — المتصفح فقط (فرع تجريبي + بروفة)

## الكتلة أ١ — إنشاء فرع تجريبي من الإنتاج

١. لوحة Neon ← **Branches** ← **New branch**.
٢. الأب: الفرع **production**؛ الاسم: `pre-finance-20261030`.
٣. البيانات: «حتى الآن» (اللحظة الحالية) — لا تختر وقتًا قديمًا.
٤. فعّل **Create compute endpoint** (بدونه لا يمكنك الاستعلام من SQL Editor).
٥. أنشئ الفرع.

هذا الفرع نسخة copy-on-write معزولة تمامًا: أي شيء نجربه عليه **لا يمسّ الإنتاج**،
ولا يُنسخ منه شيء عند الإنشاء. على خطة Free: حتى 10 فروع لكل مشروع، ونافذة استرجاع
للإنتاج 6 ساعات فقط — لذا ننشئه قبل الترقية مباشرة ونبقيه حتى نطمئن.

## الكتلة أ٢ — فحص الفرع ومقارنته بالإنتاج

في **SQL Editor** نفّذ `prisma/manual-finance-release-preflight.sql` مرتين، وبدّل أعلى
الصفحة بين الفرعين:

1. الفرع `production` / القاعدة `neondb` ← العمود `finance_release_preflight`.
2. الفرع `pre-finance-20261030` / القاعدة `neondb` ← العمود `finance_release_preflight`.

أرسل لي الناتجين. **يجب أن تتطابق الأعداد والبصمات القديمة تمامًا**؛ هذا هو إثبات أن
الفرع يحمل نفس بيانات الإنتاج (وهو بديل تجربة الاستعادة في هذا المسار).

## الكتلة أ٣ — البروفة الكاملة على الفرع (وليس على الإنتاج)

على الفرع `pre-finance-20261030` فقط، بالترتيب:

1. `prisma/manual-finance-release-upgrade.sql` كاملًا ← أرسل لي ناتج التشغيل.
2. `prisma/manual-finance-release-postflight.sql` ← أرسل لي العمود
   `finance_release_postflight` (يجب: 16 جدولًا، كل الأعداد صفر، سجل `finance_release_upgrade`).
3. اختياري للتأكد من الرجوع: `prisma/manual-finance-release-rollback.sql` ← يجب أن ينجح
   لأنه لا توجد بيانات مالية بعد. أرسل لي الناتج.

إن ظهر أي خطأ في أي خطوة: أوقف، وأرسل لي نص الخطأ كما هو. لا تُعد المحاولة وحدك.

## الكتلة أ٤ — بعد نجاح البروفة

- **لا تحذف الفرع فورًا**؛ اتركه شبكة أمان حتى نتحقق من الإنتاج.
- إن أردت استعادة الإنتاج فعلًا لاحقًا فهذا قرار منفصل (إعادة توجيه نقطة الاتصال)،
  ولا يُتخذ تلقائيًا أبدًا.

---

# المسار ب — الطرفية على جهازك (نسخة واستعادة حقيقية)

متى احتجته: إن أردت نسخة **خارج Neon** (الفرع لا يحميك من فقدان المشروع أو الحساب،
ونافذة الاسترجاع على Free ست ساعات فقط). يمكن تنفيذه لاحقًا بالتوازي.

## الكتلة ب٠ — تشخيص الأدوات (أرسل لي الناتج)

```bash
for c in psql pg_dump pg_restore gzip openssl docker; do
  if command -v "$c" >/dev/null 2>&1; then echo "موجود: $c ($( { $c --version 2>/dev/null || echo '?'; } | head -1))"; else echo "غير موجود: $c"; fi
done
```

## الكتلة ب١ — النسخة

ضع رابط قاعدة الإنتاج في متغير بيئة داخل جلستك فقط (لا ترسله لي، ولا تكتبه في ملف):

```bash
export DATABASE_URL='<رابط الاتصال المباشر بقاعدة الإنتاج>'
export DUMP="selahtone-prefinance-$(date +%F).sql"
pg_dump "$DATABASE_URL" --no-owner --no-privileges --format=plain -f "$DUMP"
```

ثم أرسل لي هذا الناتج فقط:

```bash
echo "الملف: $DUMP"; echo "الحجم: $(wc -c < "$DUMP") بايت"; echo "الأسطر: $(wc -l < "$DUMP")"
echo "عدد CREATE TABLE: $(grep -c '^CREATE TABLE' "$DUMP")"
echo "sha256: $(sha256sum "$DUMP" | cut -d' ' -f1)"
```

## الكتلة ب٢ — فحص سلامة النسخة بلا قاعدة بيانات

```bash
bash scripts/restore-drill.sh --file "$DUMP"
```

للأثر المشفّر الليلي (`*.sql.gz.enc`) استخدم `BACKUP_PASSPHRASE` بدل كلمة المرور:

```bash
BACKUP_PASSPHRASE='<كلمة مرور النسخة>' bash scripts/restore-drill.sh --file selahtone-20261030-010000.sql.gz.enc
```

أرسل لي الناتج (عدد عبارات `CREATE TABLE` وحجم SQL بعد الفك).

## الكتلة ب٣ — استعادة حقيقية على قاعدة مؤقتة

اختر مسارًا واحدًا فقط.

**المسار أ — Docker محلي (الأفضل، لا يمسّ Neon إطلاقًا):**

```bash
docker run --rm -d --name selahtone_drill -e POSTGRES_PASSWORD=drillonly \
  -e POSTGRES_DB=selahtone_drill -p 55432:5432 postgres:16-alpine
sleep 10
bash scripts/restore-drill.sh --file "$DUMP" \
  --target "postgres://postgres:drillonly@localhost:55432/selahtone_drill"
```

**المسار ب — قاعدة مؤقتة داخل Neon (إن لم يتوفر Docker):**

```bash
psql "$DATABASE_URL" -c "CREATE DATABASE selahtone_drill"
export DRILL_URL="$(printf '%s' "$DATABASE_URL" | sed 's#/neondb#/selahtone_drill#')"
bash scripts/restore-drill.sh --file "$DUMP" --target "$DRILL_URL" --allow-neon-target
```

> ملاحظات المسار ب: القاعدة المؤقتة على الخادم نفسه لكنها معزولة تمامًا عن `neondb`،
> وتستهلك مساحة مؤقتة من مساحة المشروع. **لا تستخدم `--unsafe-target-db` أبدًا.**

أرسل لي ناتج الاستعادة كاملًا (أعداد الفروع والمستخدمين والبنود وحالة مخطط `finance`).

## الكتلة ب٤ — التنظيف

```bash
# مسار Docker — بعد أن أؤكد لك أن النتيجة مطابقة
docker rm -f selahtone_drill

# مسار قاعدة Neon المؤقتة — بعد أن أؤكد لك أن النتيجة مطابقة
psql "$DATABASE_URL" -c "DROP DATABASE selahtone_drill"
```

## الكتلة ب٥ — فحص ما قبل الترقية على الإنتاج (SQL Editor)

1. افتح Neon SQL Editor ← الفرع `production` ← القاعدة `neondb`.
2. الصق محتوى `prisma/manual-finance-release-preflight.sql` كاملًا وشغّله دفعة واحدة.
3. انسخ عمود `finance_release_preflight` وأرسله لي.

**نقاط توقف:** أي اختلاف في عدد البنود (7 الآن) أو بصمتها عن آخر فحص، أو وجود اسم
محجوز في `public`، أو اختلاف الفرع/القاعدة → نتوقف ولا نكمل.

## الكتلة ب٦ — التنفيذ على الإنتاج وفحص ما بعده (مؤجلة، لا تشغّلها الآن)

لن أطلب منك هذه الكتلة إلا بعد: نسخة مؤكدة + استعادة ناجحة + فحص قبل مطابق + موافقتك
الصريحة. توقّع ترتيبها:

1. `prisma/manual-finance-release-upgrade.sql` كاملًا في SQL Editor (الفرع production/neondb).
2. فورًا: `prisma/manual-finance-release-postflight.sql`، وأرسل لي عمود `finance_release_postflight`.
3. أقارن البصمات والأعداد بفحص ما قبل الترقية قبل أن نفتح أي واجهة.

وإن احتجنا إيقافًا قبل إدخال بيانات: `prisma/manual-finance-release-rollback.sql`
(يرفض العمل إن وُجد أي صف في جداول المالية).
