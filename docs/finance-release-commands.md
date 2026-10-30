# أوامر جاهزة للنسخ قبل ترقية المالية

كل ما تحتاجه هنا: **تنفيذ الأوامر كما هي، ثم إرسال الناتج إليّ**. لا ترسل أي أسرار أو
قيم اتصال؛ الأوامر تقرأ `DATABASE_URL` من بيئتك ولا تطبعها.

> قاعدة عامة: لا تُكمل كتلة قبل أن أرد على ناتجها. الكتلة الأخيرة (التنفيذ) لن تصلها
> إلا بعد موافقتك المنفصلة.

---

## الكتلة ٠ — تشخيص الأدوات (أرسل لي الناتج)

```bash
for c in psql pg_dump pg_restore gzip openssl docker; do
  if command -v "$c" >/dev/null 2>&1; then echo "موجود: $c ($( { $c --version 2>/dev/null || echo '?'; } | head -1))"; else echo "غير موجود: $c"; fi
done
```

## الكتلة ١ — النسخة

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

## الكتلة ٢ — فحص سلامة النسخة بلا قاعدة بيانات

```bash
bash scripts/restore-drill.sh --file "$DUMP"
```

للأثر المشفّر الليلي (`*.sql.gz.enc`) استخدم `BACKUP_PASSPHRASE` بدل كلمة المرور:

```bash
BACKUP_PASSPHRASE='<كلمة مرور النسخة>' bash scripts/restore-drill.sh --file selahtone-20261030-010000.sql.gz.enc
```

أرسل لي الناتج (عدد عبارات `CREATE TABLE` وحجم SQL بعد الفك).

## الكتلة ٣ — استعادة حقيقية على قاعدة مؤقتة

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

## الكتلة ٤ — التنظيف

```bash
# المسار أ
docker rm -f selahtone_drill

# المسار ب — بعد أن أؤكد لك أن النتيجة مطابقة
psql "$DATABASE_URL" -c "DROP DATABASE selahtone_drill"
```

## الكتلة ٥ — فحص ما قبل الترقية (في Neon SQL Editor)

1. افتح Neon SQL Editor ← الفرع `production` ← القاعدة `neondb`.
2. الصق محتوى `prisma/manual-finance-release-preflight.sql` كاملًا وشغّله دفعة واحدة.
3. انسخ عمود `finance_release_preflight` وأرسله لي.

**نقاط توقف:** أي اختلاف في عدد البنود (7 الآن) أو بصمتها عن آخر فحص، أو وجود اسم
محجوز في `public`، أو اختلاف الفرع/القاعدة → نتوقف ولا نكمل.

## الكتلة ٦ — التنفيذ وفحص ما بعده (مؤجلة، لا تشغّلها الآن)

لن أطلب منك هذه الكتلة إلا بعد: نسخة مؤكدة + استعادة ناجحة + فحص قبل مطابق + موافقتك
الصريحة. توقّع ترتيبها:

1. `prisma/manual-finance-release-upgrade.sql` كاملًا في SQL Editor (الفرع production/neondb).
2. فورًا: `prisma/manual-finance-release-postflight.sql`، وأرسل لي عمود `finance_release_postflight`.
3. أقارن البصمات والأعداد بفحص ما قبل الترقية قبل أن نفتح أي واجهة.

وإن احتجنا إيقافًا قبل إدخال بيانات: `prisma/manual-finance-release-rollback.sql`
(يرفض العمل إن وُجد أي صف في جداول المالية).
