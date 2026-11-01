-- ============================================================================
-- أصناف البيع الفنية: ٥ تصنيفات وأنواعها وحقولها
-- ----------------------------------------------------------------------------
-- يُشغَّل مرة واحدة من لوحة Neon (SQL Editor)، وآمن إن شُغّل أكثر من مرة:
--   · التصنيفات تُطابق بالرمز (code)، والأنواع بالاسم داخل التصنيف،
--     والحقول بالمفتاح داخل النوع — فما كان موجودًا يُترك كما هو.
--   · لا DELETE ولا UPDATE في هذا الملف: إضافة فقط، ولا مساس بالفواتير.
--
-- المُدخل في سجل التدقيق = أول مستخدم في النظام. وإن أردت نسبة الإضافة إلى
-- مستخدم بعيْنه، فاستبدل (SELECT id FROM public."users" ORDER BY id LIMIT 1)
-- برقمه في العبارات الثلاث.
-- ============================================================================

BEGIN;

-- ١) التصنيفات الخمسة -------------------------------------------------------
INSERT INTO public."sales_item_categories"
  ("code", "name_ar", "sort_order", "is_active", "created_by_id", "updated_by_id")
SELECT v.code, v.name_ar, v.sort_order, TRUE, a.id, a.id
FROM (SELECT id FROM public."users" ORDER BY id LIMIT 1) a
CROSS JOIN (VALUES
  ('BATTERY',     'بطاريات', 1),
  ('MOLD',        'قوالب',   2),
  ('MAINTENANCE', 'صيانة',   3),
  ('OTHER',       'أخرى',    4),
  ('HEARING_AID', 'سماعة',   5)
) AS v(code, name_ar, sort_order)
ON CONFLICT ("code") DO NOTHING;

-- ٢) الأنواع داخل كل تصنيف --------------------------------------------------
INSERT INTO public."sales_item_types"
  ("category_id", "name_ar", "sort_order", "is_active", "created_by_id", "updated_by_id")
SELECT c.id, v.name_ar, v.sort_order, TRUE, a.id, a.id
FROM (SELECT id FROM public."users" ORDER BY id LIMIT 1) a
CROSS JOIN (VALUES
  -- بطاريات
  ('BATTERY',     'مقاس ١٣',  1),
  ('BATTERY',     '٦٧٥',      2),
  ('BATTERY',     '١٠',       3),
  ('BATTERY',     '٣١٢',      4),
  -- قوالب
  ('MOLD',        'سوفت',     1),
  ('MOLD',        'هارد',     2),
  ('MOLD',        'شل',       3),
  -- صيانة
  ('MAINTENANCE', 'صيانة',    1),
  -- أخرى
  ('OTHER',       'تيوب',            1),
  ('OTHER',       'ايرتب',           2),
  ('OTHER',       'فلتر',            3),
  ('OTHER',       'ماسك',            4),
  ('OTHER',       'حافظة سماعة',     5),
  -- سماعة
  ('HEARING_AID', 'سماعة',    1)
) AS v(code, name_ar, sort_order)
JOIN public."sales_item_categories" c ON c.code = v.code
ON CONFLICT ("category_id", "name_ar") DO NOTHING;

-- ٣) الحقول داخل الأنواع ----------------------------------------------------
INSERT INTO public."sales_item_fields"
  ("type_id", "field_key", "label_ar", "is_required", "sort_order", "is_active", "created_by_id", "updated_by_id")
SELECT t.id, v.field_key, v.label_ar, v.is_required, v.sort_order, TRUE, a.id, a.id
FROM (SELECT id FROM public."users" ORDER BY id LIMIT 1) a
CROSS JOIN (VALUES
  -- صيانة: نوع السماعة · بيان الحالة · بيان الصيانة
  ('MAINTENANCE', 'صيانة', 'device_type',      'نوع السماعة',  TRUE, 1),
  ('MAINTENANCE', 'صيانة', 'condition_note',   'بيان الحالة',  TRUE, 2),
  ('MAINTENANCE', 'صيانة', 'maintenance_note', 'بيان الصيانة', TRUE, 3),
  -- سماعة: نوع السماعة
  ('HEARING_AID', 'سماعة', 'device_type',      'نوع السماعة',  TRUE, 1)
) AS v(code, type_name, field_key, label_ar, is_required, sort_order)
JOIN public."sales_item_categories" c ON c.code = v.code
JOIN public."sales_item_types" t ON t.category_id = c.id AND t.name_ar = v.type_name
ON CONFLICT ("type_id", "field_key") DO NOTHING;

COMMIT;

-- ٤) تقرير بعد التنفيذ: كم صار لدينا؟ ---------------------------------------
SELECT
  (SELECT count(*) FROM public."sales_item_categories") AS "التصنيفات",
  (SELECT count(*) FROM public."sales_item_types")      AS "الأنواع",
  (SELECT count(*) FROM public."sales_item_fields")     AS "الحقول";
