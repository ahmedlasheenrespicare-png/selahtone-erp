#!/usr/bin/env bash
# =============================================================================
#  صلة تون · تجربة استعادة النسخة الاحتياطية (اختبار لا ينقل بيانات الإنتاج)
#
#  النسخة الليلية الحالية (scripts/backup-to-r2.sh) تنتج ملفًا بالنمط:
#      selahtone-<stamp>.sql.gz.enc        (plain SQL ← gzip ← AES-256-CBC)
#  وهذا السكربت يتعامل مع ثلاثة أنواع من الملفات:
#      *.sql.gz.enc   يفك التشفير والضغط ثم يعرض/يستعيد
#      *.sql / *.sql.gz  يعرض أو يستعيد مباشرة
#      *.dump / غير ذلك (custom format) يعرض محتواه عبر pg_restore -l
#
#  الاستخدام:
#    # ١) فحص بلا قاعدة بيانات: يفك التشفير ويتحقق أن الملف مقروء ويحصي محتواه
#    BACKUP_PASSPHRASE=... bash scripts/restore-drill.sh --file backup.sql.gz.enc
#
#    # ٢) استعادة حقيقية في قاعدة مؤقتة تسميها أنت (ممنوع أن تكون قاعدة الإنتاج)
#    BACKUP_PASSPHRASE=... bash scripts/restore-drill.sh --file backup.sql.gz.enc \
#        --target "postgres://user:pass@host/drilldb?sslmode=require"
#
#    # ٣) نسخة custom من pg_dump -Fc
#    bash scripts/restore-drill.sh --file backup.dump --target "postgres://.../drilldb"
#
#  ملاحظات أمان:
#    - لا يقرأ هذا السكربت أي متغير إنتاج تلقائيًا، ولا يكتب على قاعدة الإنتاج.
#    - يرفض الاسترجاع على أي هدف يحمل نطاق neon.tech أو اسم قاعدة معروف للإنتاج
#      إلا إذا مررت --allow-neon-target وأنت متأكد.
#    - ملفات النسخ تبقى محلية؛ لا تُرفع أو تُشارك.
# =============================================================================
set -euo pipefail

FILE=""
TARGET=""
ALLOW_NEON=0
UNSAFE_DB=0

usage() { sed -n '3,30p' "$0"; exit 1; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --file|-f) FILE="${2:-}"; shift 2 ;;
    --target|-t) TARGET="${2:-}"; shift 2 ;;
    --allow-neon-target) ALLOW_NEON=1; shift ;;
    --unsafe-target-db) UNSAFE_DB=1; shift ;;
    -h|--help) usage ;;
    *) echo "❌ وسيط غير معروف: $1"; usage ;;
  esac
done

[[ -n "$FILE" ]] || { echo "❌ --file مطلوب (مسار ملف النسخة)"; usage; }
[[ -f "$FILE" ]] || { echo "❌ الملف غير موجود: $FILE"; exit 1; }
SIZE_KB=$(( $(wc -c < "$FILE") / 1024 ))
echo "▶ ملف النسخة: $FILE (${SIZE_KB} ك.ب)"

TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

# ── ١) تجهيز ملف SQL قابل للقراءة ──────────────────────────────────────────
case "$FILE" in
  *.sql.gz.enc)
    : "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE مطلوب لفك تشفير النسخة}"
    echo "▶ فك التشفير والضغط…"
    openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in "$FILE" \
      | gunzip > "$TMP/restore.sql"
    ;;
  *.sql.gz)
    echo "▶ فك الضغط…"; gunzip -c "$FILE" > "$TMP/restore.sql" ;;
  *.sql)
    cp "$FILE" "$TMP/restore.sql" ;;
  *)
    if command -v pg_restore >/dev/null 2>&1; then
      if [[ -n "$TARGET" ]]; then command -v psql >/dev/null 2>&1 || { echo "❌ psql غير مثبت (apt-get install postgresql-client)"; exit 1; }; fi
      echo "▶ نسخة بتنسيق pg_dump؛ سرد المحتوى فقط:"
      pg_restore -l "$FILE" | tail -n 20
      echo "  ✓ عدد العناصر: $(pg_restore -l "$FILE" | grep -c '^[0-9]' || true)"
      if [[ -n "$TARGET" ]]; then
        echo "▶ استعادة على الهدف المطلوب…"
        pg_restore --no-owner --no-privileges -d "$TARGET" "$FILE"
        echo "  ✓ تمت الاستعادة بالكامل."
      else
        echo "ℹ️  مرر --target لقاعدة مؤقتة لتجربة استعادة حقيقية."
      fi
      exit 0
    fi
    echo "❌ صيغة غير مدعومة وpg_restore غير مثبت"; exit 1 ;;
esac

LINES=$(wc -l < "$TMP/restore.sql")
TABLES=$(grep -c '^CREATE TABLE' "$TMP/restore.sql" || true)
echo "  ✓ حجم SQL بعد الفك: $(( $(wc -c < "$TMP/restore.sql") / 1024 )) ك.ب / $LINES سطر"
echo "  ✓ عدد عبارات CREATE TABLE: $TABLES"
[[ "$TABLES" -gt 0 ]] || { echo "❌ الملف لا يحتوي أي CREATE TABLE؛ النسخة تالفة أو فك التشفير فشل"; exit 1; }

if [[ -z "$TARGET" ]]; then
  echo "ℹ️  لم يُمرر --target؛ تم التحقق من أن الملف قابل للفك والقراءة فقط."
  echo "    لتجربة استعادة حقيقية مرر هدفًا مؤقتًا: --target \"postgres://…/drilldb\""
  exit 0
fi

# ── ٢) حماية الهدف ─────────────────────────────────────────────────────────
# الحظر على مستويين: نطاق Neon يتطلب تأكيدًا، واسم قاعدة الإنتاج ممنوع تمامًا
# إلا بتأكيد أقوى. قاعدة التدريب يجب أن تُسمى مثل selahtone_drill لا neondb.
if [[ "$TARGET" == *neon.tech* && "$ALLOW_NEON" -ne 1 ]]; then
  echo "❌ الهدف على نطاق Neon. إن كان فرعًا أو قاعدة تدريب مؤقتة أكد بـ--allow-neon-target."
  exit 1
fi
if [[ "$TARGET" == */neondb* || "$TARGET" == */production* || "$TARGET" == */postgres?* || "$TARGET" == */postgres ]]; then
  if [[ "$UNSAFE_DB" -ne 1 ]]; then
    echo "❌ يبدو أن الهدف قاعدة الإنتاج نفسها (neondb/production/postgres)."
    echo "   أنشئ قاعدة مؤقتة باسم آخر مثل selahtone_drill، أو أكد صراحة بـ--unsafe-target-db."
    exit 1
  fi
  echo "⚠️⚠️  استعادة على قاعدة تحمل اسم الإنتاج بناءً على تأكيدك الصريح."
fi
if [[ "$ALLOW_NEON" -eq 1 ]]; then echo "⚠️  هدف على نطاق Neon بناءً على تأكيدك — تأكد أنه فرع أو قاعدة تدريب لا الإنتاج."; fi

# ── ٣) الاستعادة ───────────────────────────────────────────────────────────
command -v psql >/dev/null 2>&1 || { echo "❌ psql غير مثبت (apt-get install postgresql-client)"; exit 1; }
echo "▶ الاستعادة على قاعدة مؤقتة (لن أعرض الرابط)…"
psql "$TARGET" -v ON_ERROR_STOP=1 -q -f "$TMP/restore.sql" > "$TMP/psql.log" 2>&1 || {
  echo "❌ فشلت الاستعادة؛ آخر 20 سطرًا من السجل:"; tail -n 20 "$TMP/psql.log"; exit 1; }

echo "▶ التحقق بعد الاستعادة:"
psql "$TARGET" -v ON_ERROR_STOP=1 -t -A -F' | ' <<'SQL'
SELECT 'public_tables', count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p');
SELECT 'branches', count(*)::text FROM public.branches;
SELECT 'users', count(*)::text FROM public.users;
SELECT 'expense_categories', count(*)::text FROM public.expense_categories;
SELECT 'finance_schema', COALESCE(to_regnamespace('finance')::text, 'غير مثبت');
SQL

echo
echo "✓ اكتملت تجربة الاستعادة. احذف القاعدة المؤقتة بعد المراجعة:"
echo "    dropdb \"<اسم القاعدة المؤقتة>\""
echo "⚠️  تذكّر: هذه الاستعادة على قاعدة مستقلة، وليست اختبارًا لصلاحيات دور التطبيق."
