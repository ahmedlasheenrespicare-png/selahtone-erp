# صلة تون — نظام الإيرادات والمصروفات (الخطوة 1)

تطبيق **Next.js 15** جاهز للعمل على **خطة صفر جنيه**: Netlify (استضافة) + Neon (قاعدة بيانات) + Cloudflare R2 (ملفات ونسخ).

## ما يعمل الآن

| الصفحة | ماذا تفعل |
|---|---|
| `/login` | دخول بالبريد وكلمة المرور · جلسة مشفّرة (JWT في HttpOnly Cookie) |
| `/dashboard` | لوحة القيادة: الفروع، المستودعات، عدد الأصناف، قيمة المخزون، جاهزية الإعداد |
| `/inventory` | الأصناف ومعدلات ضريبتها وأرصدة كل مستودع (الكاونتر يرى فرعه فقط) |
| `/setup` | **قائمة تحقق حيّة**: 9 فحوصات على قاعدة البيانات، أهمها التحقق الحقيقي من محرك الضريبة (5% → 925 والمركبة 14%+8% → 4,277.20) |
| `/api/health` | فحص صحة للمراقبة (UptimeRobot) |

**محرك الضريبة** (`src/lib/tax.ts`): يدعم معدلًا واحدًا أو مكوّنات مركّبة، ويوزّع خصم الفاتورة قبل الضريبة، ويقرّب لخانتين في كل خطوة.
**17 اختبارًا** في `scripts/check-tax.ts` — شغّلها بـ `npm run check:tax`.

## التشغيل المحلي (5 دقائق)

```bash
npm install
cp .env.example .env          # ثم املأ DATABASE_URL و AUTH_SECRET
npx prisma db push            # إنشاء الجداول
npm run db:seed               # الفروع + المستودعات + الضرائب + المستخدمون
npm run dev                   # http://localhost:3000
```

حسابات البداية بعد `db:seed` (كلمة المرور `Sel@2026!` — **غيّرها فورًا**):

| الدور | البريد |
|---|---|
| مدير الشركة | `manager@selahtone.local` |
| المحاسب | `accountant@selahtone.local` |
| كاونتر العريش | `arh@selahtone.local` |

## النشر على Netlify (مجانًا)

1. ارفع المشروع إلى مستودع GitHub **خاص**.
2. Netlify ← Add new site ← Import from Git ← اختر المستودع.
3. Environment variables: انسخ كل قيم `.env.example` بعد تعبئتها (بما فيها `AUTH_SECRET`).
4. Deploy ← ثم افتح `/api/health` للتأكد، ثم `/login`.

> ملاحظة: لا تستخدم Vercel Hobby — خطتها المجانية تمنع الاستخدام التجاري.

## النسخ الاحتياطي (يوميًا، مجانًا)

- `scripts/backup-to-r2.sh` — نسخة `pg_dump` مضغوطة ومشفّرة AES-256 إلى R2 مع احتفاظ 30 يومًا.
- `.github/workflows/nightly-backup.yml` — يشغّلها يوميًا 01:00 UTC، ينبّه عند الفشل، ويعمل تمرين استرجاع أول كل شهر.

أضف في GitHub ← Settings ← Secrets: `DATABASE_URL`, `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `BACKUP_PASSPHRASE`.

## بنية المشروع

```
prisma/
  schema.prisma        # فروع · مستودعات · مخزون · ضرائب · مصروفات · قيود
  seed.ts              # بيانات البداية
src/
  app/(app)/           # الصفحات المحمية (لوحة، مخزون، إعداد)
  app/login/           # صفحة الدخول
  app/api/health|logout
  lib/tax.ts           # محرك الضريبة
  lib/auth.ts          # الجلسات والصلاحيات
  lib/prisma.ts
  middleware.ts        # حماية المسارات
scripts/
  check-tax.ts         # 17 اختبارًا للضريبة
  backup-to-r2.sh
```

## الخطوة التالية

الخطوة 2 في الخطة: **ترحيل المخزون من Excel** (قالب + استيراد + أرصدة افتتاحية)، ثم الخطوة 3: **كاونتر البيع** بفاتورة وضريبة وطباعة.
