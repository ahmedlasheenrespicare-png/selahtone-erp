-- ============================================================================
--  ترقية يدوية: أصناف البيع الفنية + عزل المخزون والمستودعات عن المبيعات
-- ============================================================================
--  الحالة: مسودة للمراجعة — تُشغَّل مرة واحدة على production/neondb، وبموافقة
--  منفصلة، وقبل نشر الكود الذي يقرأ الجداول والأعمدة الجديدة.
--
--  ما تفعله:
--    ١) ثلاثة جداول جديدة لأصناف البيع (تصنيف ← نوع ← حقول نصية)، وسجل
--       تاريخ لكل تغيير يحدث عليها، مع بيانات البداية التي أقرّها صاحب العمل.
--    ٢) البيع بلا مستودع: عامود المستودع في الفواتير يصير اختياريًا.
--    ٣) الضريبة «غير محددة»: أعمدة الضريبة في الفاتورة وبنودها تقبل الفراغ،
--       والفراغ ليس صفرًا ولا إعفاءً — تحقّق (CHECK) يمنع الخلط بينهما.
--    ٤) بند الفاتورة يقبل صنفًا فنيًا بدل المنتج، مع لقطة للاسم والتصنيف
--       والنوع وقيم الحقول النصية كما كتبها الموظف.
--
--  ما لا تفعله: لا تحذف جدولًا ولا عامودًا ولا صفًا، ولا تعدّل الفواتير أو
--  المخزون القائم. الفواتير القديمة تبقى كما هي بمستودعها وضريبتها.
--
--  التراجع: في نهاية الملف تعليقات جاهزة لإعادة الحالة السابقة.
-- ============================================================================

DO $catalog_upgrade$
BEGIN
PERFORM pg_catalog.set_config('lock_timeout', '5s', true);

-- ١) تصنيفات البيع (بطاريات، قوالب، صيانة، سماعة، أخرى)
CREATE TABLE IF NOT EXISTS public."sales_item_categories" (
  "id" BIGSERIAL PRIMARY KEY,
  "code" VARCHAR(40) NOT NULL,
  "name_ar" VARCHAR(120) NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_by_id" BIGINT REFERENCES public."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "updated_by_id" BIGINT REFERENCES public."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sales_item_categories_code_check" CHECK (btrim("code") ~ '^[A-Z0-9_]{2,40}$'),
  CONSTRAINT "sales_item_categories_name_check" CHECK (length(btrim("name_ar")) > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS "sales_item_categories_code_key" ON public."sales_item_categories"("code");
CREATE INDEX IF NOT EXISTS "sales_item_categories_sort_idx" ON public."sales_item_categories"("sort_order", "id");

-- ٢) الأنواع داخل كل تصنيف (مقاس ١٣، سوفت، تيوب، …)
CREATE TABLE IF NOT EXISTS public."sales_item_types" (
  "id" BIGSERIAL PRIMARY KEY,
  "category_id" BIGINT NOT NULL REFERENCES public."sales_item_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "name_ar" VARCHAR(120) NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_by_id" BIGINT REFERENCES public."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "updated_by_id" BIGINT REFERENCES public."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sales_item_types_name_check" CHECK (length(btrim("name_ar")) > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS "sales_item_types_category_id_name_ar_key" ON public."sales_item_types"("category_id", "name_ar");
CREATE INDEX IF NOT EXISTS "sales_item_types_sort_idx" ON public."sales_item_types"("category_id", "sort_order", "id");

-- ٣) الحقول النصية التي يكتبها الموظف داخل نوع (نوع السماعة، بيان الحالة، …)
CREATE TABLE IF NOT EXISTS public."sales_item_fields" (
  "id" BIGSERIAL PRIMARY KEY,
  "type_id" BIGINT NOT NULL REFERENCES public."sales_item_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "field_key" VARCHAR(60) NOT NULL,
  "label_ar" VARCHAR(120) NOT NULL,
  "is_required" BOOLEAN NOT NULL DEFAULT TRUE,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_by_id" BIGINT REFERENCES public."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "updated_by_id" BIGINT REFERENCES public."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sales_item_fields_key_check" CHECK (btrim("field_key") ~ '^[a-z0-9_]{2,60}$'),
  CONSTRAINT "sales_item_fields_label_check" CHECK (length(btrim("label_ar")) > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS "sales_item_fields_type_id_field_key_key" ON public."sales_item_fields"("type_id", "field_key");
CREATE INDEX IF NOT EXISTS "sales_item_fields_sort_idx" ON public."sales_item_fields"("type_id", "sort_order", "id");

-- ٤) سجل التغيير: كل إضافة أو تعديل أو إيقاف يُحفظ بسببه وقبلَه وبعده،
--    ولا يُحذف شيء من الأصناف أبدًا — الإيقاف فقط.
CREATE TABLE IF NOT EXISTS public."sales_catalog_audit" (
  "id" BIGSERIAL PRIMARY KEY,
  "request_id" UUID NOT NULL,
  "entity" VARCHAR(12) NOT NULL CHECK ("entity" IN ('CATEGORY', 'TYPE', 'FIELD')),
  "entity_id" BIGINT NOT NULL,
  "action" VARCHAR(12) NOT NULL CHECK ("action" IN ('CREATE', 'UPDATE', 'ACTIVATE', 'DEACTIVATE')),
  "before_data" JSONB,
  "after_data" JSONB,
  "reason" VARCHAR(300) NOT NULL,
  "actor_id" BIGINT NOT NULL REFERENCES public."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sales_catalog_audit_reason_check" CHECK (length(btrim("reason")) > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS "sales_catalog_audit_request_id_key" ON public."sales_catalog_audit"("request_id");
CREATE INDEX IF NOT EXISTS "sales_catalog_audit_created_at_idx" ON public."sales_catalog_audit"("created_at" DESC, "id" DESC);

-- ٥) بيانات البداية كما أقرّها صاحب العمل (إعادة التشغيل آمنة)
INSERT INTO public."sales_item_categories"("code", "name_ar", "sort_order") VALUES
  ('BATTERY', 'بطاريات', 10), ('MOLD', 'قوالب', 20), ('MAINTENANCE', 'صيانة', 30),
  ('HEARING_AID', 'سماعة', 40), ('OTHER', 'أخرى', 50)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO public."sales_item_types"("category_id", "name_ar", "sort_order")
SELECT c."id", v."name_ar", v."sort_order" FROM public."sales_item_categories" c
JOIN (VALUES
  ('BATTERY', 'مقاس 13', 10), ('BATTERY', 'مقاس 675', 20), ('BATTERY', 'مقاس 10', 30), ('BATTERY', 'مقاس 312', 40),
  ('MOLD', 'سوفت', 10), ('MOLD', 'هارد', 20), ('MOLD', 'شل', 30),
  ('MAINTENANCE', 'صيانة', 10),
  ('HEARING_AID', 'سماعة', 10),
  ('OTHER', 'تيوب', 10), ('OTHER', 'إير تيب', 20), ('OTHER', 'فلتر', 30),
  ('OTHER', 'ماسك', 40), ('OTHER', 'حافظة سماعة', 50), ('OTHER', 'سماعة', 60)
) AS v("code", "name_ar", "sort_order") ON v."code" = c."code"
ON CONFLICT ("category_id", "name_ar") DO NOTHING;

INSERT INTO public."sales_item_fields"("type_id", "field_key", "label_ar", "is_required", "sort_order")
SELECT t."id", v."field_key", v."label_ar", TRUE, v."sort_order" FROM public."sales_item_types" t
JOIN public."sales_item_categories" c ON c."id" = t."category_id"
JOIN (VALUES
  ('MAINTENANCE', 'صيانة', 'device_type', 'نوع السماعة', 10),
  ('MAINTENANCE', 'صيانة', 'condition_note', 'بيان الحالة', 20),
  ('MAINTENANCE', 'صيانة', 'work_note', 'بيان الصيانة', 30),
  ('HEARING_AID', 'سماعة', 'device_type', 'نوع السماعة', 10)
) AS v("code", "type_name", "field_key", "label_ar", "sort_order")
  ON v."code" = c."code" AND v."type_name" = t."name_ar"
ON CONFLICT ("type_id", "field_key") DO NOTHING;

-- ٦) البيع بلا مستودع ولا مخزون: المستودع اختياري (فواتير قديمة تبقى كما هي)
ALTER TABLE public."commerce_sales" ALTER COLUMN "warehouse_id" DROP NOT NULL;

-- ٧) الضريبة «غير محددة» على مستوى الفاتورة: الفراغ مسموح ولا يعني صفرًا
ALTER TABLE public."commerce_sales" ALTER COLUMN "taxable_base" DROP NOT NULL;
ALTER TABLE public."commerce_sales" ALTER COLUMN "tax_total" DROP NOT NULL;
ALTER TABLE public."commerce_sales" DROP CONSTRAINT IF EXISTS "commerce_sales_amounts_check";
ALTER TABLE public."commerce_sales" ADD CONSTRAINT "commerce_sales_amounts_check"
  CHECK ("subtotal" >= 0 AND "discount" >= 0 AND "total" > 0 AND "subtotal" = "discount" + "total"
    AND (("taxable_base" IS NULL AND "tax_total" IS NULL)
      OR ("taxable_base" >= 0 AND "tax_total" >= 0 AND "taxable_base" + "tax_total" = "total")));

-- ٨) بند الفاتورة يقبل صنفًا فنيًا بدل المنتج، مع لقطة كاملة
ALTER TABLE public."commerce_sale_lines" ALTER COLUMN "product_id" DROP NOT NULL;
ALTER TABLE public."commerce_sale_lines" ALTER COLUMN "tax_rate_id" DROP NOT NULL;
ALTER TABLE public."commerce_sale_lines" ALTER COLUMN "sku_snapshot" DROP NOT NULL;
ALTER TABLE public."commerce_sale_lines" ALTER COLUMN "tax_code_snapshot" DROP NOT NULL;
ALTER TABLE public."commerce_sale_lines" ALTER COLUMN "tax_kind_snapshot" DROP NOT NULL;
ALTER TABLE public."commerce_sale_lines" ALTER COLUMN "tax_rate_snapshot" DROP NOT NULL;
ALTER TABLE public."commerce_sale_lines" ALTER COLUMN "taxable_base" DROP NOT NULL;
ALTER TABLE public."commerce_sale_lines" ALTER COLUMN "tax_amount" DROP NOT NULL;
ALTER TABLE public."commerce_sale_lines" ADD COLUMN IF NOT EXISTS "catalog_type_id" BIGINT
  REFERENCES public."sales_item_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public."commerce_sale_lines" ADD COLUMN IF NOT EXISTS "category_snapshot" VARCHAR(120);
ALTER TABLE public."commerce_sale_lines" ADD COLUMN IF NOT EXISTS "type_snapshot" VARCHAR(120);
ALTER TABLE public."commerce_sale_lines" ADD COLUMN IF NOT EXISTS "details" JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS "commerce_sale_lines_catalog_type_id_idx" ON public."commerce_sale_lines"("catalog_type_id");

ALTER TABLE public."commerce_sale_lines" DROP CONSTRAINT IF EXISTS "commerce_sale_lines_tax_check";
ALTER TABLE public."commerce_sale_lines" ADD CONSTRAINT "commerce_sale_lines_tax_check" CHECK (
  ("tax_kind_snapshot" IS NULL AND "tax_rate_snapshot" IS NULL AND "tax_rate_id" IS NULL
    AND "tax_code_snapshot" IS NULL AND "taxable_base" IS NULL AND "tax_amount" IS NULL)
  OR ("tax_kind_snapshot" IN ('VAT', 'SCHEDULE', 'EXEMPT') AND "tax_rate_snapshot" BETWEEN 0 AND 100
    AND ("tax_kind_snapshot" <> 'EXEMPT' OR "tax_rate_snapshot" = 0)
    AND "tax_rate_id" IS NOT NULL AND "tax_code_snapshot" IS NOT NULL
    AND "taxable_base" IS NOT NULL AND "tax_amount" IS NOT NULL));

ALTER TABLE public."commerce_sale_lines" DROP CONSTRAINT IF EXISTS "commerce_sale_lines_amounts_check";
ALTER TABLE public."commerce_sale_lines" ADD CONSTRAINT "commerce_sale_lines_amounts_check"
  CHECK ("unit_price" >= 0 AND "gross" >= 0 AND "discount" >= 0 AND "total" >= 0 AND "gross" = "discount" + "total"
    AND (("taxable_base" IS NULL AND "tax_amount" IS NULL)
      OR ("taxable_base" >= 0 AND "tax_amount" >= 0 AND "taxable_base" + "tax_amount" = "total")));

-- بند الصنف الفني لا يمسّ المخزون أبدًا: لا منتج ولا رصيد ولا سيريال
ALTER TABLE public."commerce_sale_lines" DROP CONSTRAINT IF EXISTS "commerce_sale_lines_catalog_check";
ALTER TABLE public."commerce_sale_lines" ADD CONSTRAINT "commerce_sale_lines_catalog_check"
  CHECK ("catalog_type_id" IS NULL OR ("product_id" IS NULL AND "is_stock" = FALSE AND "is_serialized" = FALSE));

END;
$catalog_upgrade$;

-- ============================================================================
--  التحقق (اقرأ فقط): يجب أن تكون كل القيم 1، وأن يكون عدد التصنيفات ٥
--  والأنواع ١٥ والحقول ٤، والفواتير القديمة كما هي بلا تغيير.
-- ============================================================================
SELECT jsonb_build_object(
  'checked_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'database', current_database(),
  'categories_table', (SELECT count(*)::int FROM pg_catalog.pg_class WHERE relnamespace = 'public'::regnamespace AND relname = 'sales_item_categories'),
  'types_table', (SELECT count(*)::int FROM pg_catalog.pg_class WHERE relnamespace = 'public'::regnamespace AND relname = 'sales_item_types'),
  'fields_table', (SELECT count(*)::int FROM pg_catalog.pg_class WHERE relnamespace = 'public'::regnamespace AND relname = 'sales_item_fields'),
  'audit_table', (SELECT count(*)::int FROM pg_catalog.pg_class WHERE relnamespace = 'public'::regnamespace AND relname = 'sales_catalog_audit'),
  'catalog_line_column', (SELECT count(*)::int FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'commerce_sale_lines' AND column_name = 'catalog_type_id'),
  'details_column', (SELECT count(*)::int FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'commerce_sale_lines' AND column_name = 'details'),
  'warehouse_optional', (SELECT count(*)::int FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'commerce_sales' AND column_name = 'warehouse_id' AND is_nullable = 'YES'),
  'counts', jsonb_build_object(
    'categories', (SELECT count(*)::int FROM public."sales_item_categories"),
    'types', (SELECT count(*)::int FROM public."sales_item_types"),
    'fields', (SELECT count(*)::int FROM public."sales_item_fields"),
    'sales', (SELECT count(*)::int FROM public."commerce_sales"),
    'sale_lines', (SELECT count(*)::int FROM public."commerce_sale_lines"))
)::text AS catalog_upgrade;

-- ============================================================================
--  تعليقات التراجع — لا تُشغَّل تلقائيًا، وبموافقة منفصلة فقط:
--    ALTER TABLE public."commerce_sale_lines" DROP CONSTRAINT "commerce_sale_lines_catalog_check";
--    ALTER TABLE public."commerce_sale_lines" DROP COLUMN "details", "type_snapshot", "category_snapshot", "catalog_type_id";
--    ALTER TABLE public."commerce_sales" ALTER COLUMN "warehouse_id" SET NOT NULL;
--    DROP TABLE public."sales_catalog_audit", public."sales_item_fields", public."sales_item_types", public."sales_item_categories";
--  ملاحظة: إعادة عامود المستودع إلزاميًا تفشل إن وُجدت فاتورة بلا مستودع،
--  وإعادة الأعمدة إلزاميةً تفشل إن وُجد بند بضريبة غير محددة. راجع قبل التراجع.
-- ============================================================================
