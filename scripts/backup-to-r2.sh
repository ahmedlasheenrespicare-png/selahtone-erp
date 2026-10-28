#!/usr/bin/env bash
# =============================================================================
#  صلة تون · نسخ احتياطي مجاني لقاعدة البيانات إلى Cloudflare R2
#  يعمل من GitHub Actions (بلا سيرفر) أو من أي جهاز Linux/Mac.
#
#  المتطلبات (متغيرات بيئة):
#    DATABASE_URL          رابط الاتصال المباشر بقاعدة البيانات (Neon/Supabase)
#    R2_ENDPOINT           https://<account_id>.r2.cloudflarestorage.com
#    R2_BUCKET             selahtone-backups
#    R2_ACCESS_KEY_ID      من Cloudflare R2 → Manage API Tokens
#    R2_SECRET_ACCESS_KEY
#    BACKUP_PASSPHRASE     كلمة مرور تشفير النسخة (احفظها في مكان آمن!)
#    RETENTION_DAYS        عدد أيام الاحتفاظ (افتراضي 30)
# =============================================================================
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL مطلوب}"
: "${R2_ENDPOINT:?R2_ENDPOINT مطلوب}"
: "${R2_BUCKET:?R2_BUCKET مطلوب}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE مطلوب}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

STAMP="$(date -u +%Y%m%d-%H%M%S)"
NAME="selahtone-${STAMP}.sql.gz.enc"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "▶ بدء النسخ: $NAME"

# 1) تفريغ القاعدة (schema + data) مع ضغط وتشفير
#    --no-owner / --no-privileges حتى يمكن الاسترجاع على قاعدة أخرى بسهولة
pg_dump "$DATABASE_URL" \
  --no-owner --no-privileges --format=plain --clean --if-exists \
  | gzip -9 \
  | openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000 \
      -pass env:BACKUP_PASSPHRASE \
  > "$TMP/$NAME"

SIZE_KB=$(( $(wc -c < "$TMP/$NAME") / 1024 ))
echo "  ✓ الحجم بعد الضغط والتشفير: ${SIZE_KB} ك.ب"

# 2) الرفع إلى R2 (S3-compatible) — لا رسوم خروج
AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
aws s3 cp "$TMP/$NAME" "s3://${R2_BUCKET}/db/${NAME}" \
  --endpoint-url "$R2_ENDPOINT" --only-show-errors

echo "  ✓ تم الرفع إلى r2://${R2_BUCKET}/db/${NAME}"

# 3) تنظيف النسخ الأقدم من مدة الاحتفاظ
CUTOFF="$(date -u -d "${RETENTION_DAYS} days ago" +%Y-%m-%d 2>/dev/null \
          || date -u -v-"${RETENTION_DAYS}"d +%Y-%m-%d)"
echo "▶ حذف النسخ الأقدم من $CUTOFF"
AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
aws s3 ls "s3://${R2_BUCKET}/db/" --endpoint-url "$R2_ENDPOINT" \
  | awk '{print $1, $4}' \
  | while read -r d f; do
      [[ -z "${f:-}" ]] && continue
      if [[ "$d" < "$CUTOFF" ]]; then
        echo "  - حذف $f"
        AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
        AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
        aws s3 rm "s3://${R2_BUCKET}/db/$f" --endpoint-url "$R2_ENDPOINT" --only-show-errors
      fi
    done

# 4) ملف تعريف بالنسخة (لمراجعة بشرية سهلة)
cat > "$TMP/last-backup.json" <<JSON
{
  "file": "${NAME}",
  "created_utc": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "size_kb": ${SIZE_KB},
  "retention_days": ${RETENTION_DAYS},
  "encrypted": "AES-256-CBC (pbkdf2, 200k iter)",
  "restore_hint": "openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in FILE | gunzip | psql \\$TARGET_URL"
}
JSON
AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
aws s3 cp "$TMP/last-backup.json" "s3://${R2_BUCKET}/db/last-backup.json" \
  --endpoint-url "$R2_ENDPOINT" --only-show-errors

echo "✅ اكتمل النسخ بنجاح: $NAME"
