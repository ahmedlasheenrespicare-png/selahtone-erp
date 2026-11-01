-- ============================================================================
-- إيقاف الأصناف المكرّرة في كتالوج البيع (لا حذف — إيقاف فقط)
-- ----------------------------------------------------------------------------
-- الخلفية: كان الكتالوج يحمل الأصل (بطاريات بأرقام لاتينية: مقاس 10/13/312/675،
-- وإير تيب في «أخرى»، وحقل «بيان الصيانة» بمفتاح work_note). ثم أضافت بذرة
-- لاحقة صيغًا عربية مكافئة (مقاس ١٣، ٦٧٥، ١٠، ٣١٢، ايرتب) وحقلًا ثانيًا
-- (maintenance_note) — فصار كل صنف معروضًا مرتين.
--
-- الأصل هو الأقدم (أرقامه ١–٤ و١ و١٤)، والزائد هو المضاف لاحقًا
-- (١٦–١٩ و٢٨ و٦). فيُوقف الزائد ويبقى الأصل.
--
-- الأمان:
--   · لا DELETE في هذا الملف أبدًا.
--   · لا يُوقف صنف استُخدم في فاتورة (شرط NOT EXISTS).
--   · لا يُوقف صنف موقوف أصلًا (شرط is_active)، فلا يتكرر أثر في السجل.
--   · كل إيقاف يُسجَّل في sales_catalog_audit بسببه وقبلَه وبعده،
--     كما تفعل شاشة المدير تمامًا — فلا يضيع أثر التغيير.
--
-- آمن للتكرار: إن أعِدت تشغيله بعد نجاحه، فلن يُوقف شيئًا ولن يُسجّل جديدًا.
-- ============================================================================

BEGIN;

-- ١) إيقاف الأنواع المكرّرة (الصيغ العربية المضافة لاحقًا + «ايرتب») ---------
WITH actor AS (SELECT id FROM public."users" ORDER BY id LIMIT 1),
stopped AS (
  UPDATE public."sales_item_types" t
     SET "is_active"     = FALSE,
         "updated_by_id" = a.id,
         "updated_at"    = CURRENT_TIMESTAMP
    FROM actor a
   WHERE t.id IN (16, 17, 18, 19, 28)      -- ٣١٢ · ١٠ · ٦٧٥ · مقاس ١٣ · ايرتب
     AND t.is_active
     AND NOT EXISTS (SELECT 1 FROM public."commerce_sale_lines" l WHERE l."catalog_type_id" = t.id)
  RETURNING t.id, a.id AS actor_id, t.name_ar,
            jsonb_build_object('id', t.id, 'name_ar', t.name_ar, 'is_active', true)  AS before_data,
            jsonb_build_object('id', t.id, 'name_ar', t.name_ar, 'is_active', false) AS after_data
)
INSERT INTO public."sales_catalog_audit"
  ("request_id", "entity", "entity_id", "action", "before_data", "after_data", "reason", "actor_id")
SELECT gen_random_uuid(), 'TYPE', s.id, 'DEACTIVATE', s.before_data, s.after_data,
       'إيقاف صنف مكرر: الأصل موجود بصيغة أخرى، ولم يُستخدم في أي فاتورة', s.actor_id
  FROM stopped s;

-- ٢) إيقاف حقل «بيان الصيانة» المكرّر (maintenance_note) وإبقاء الأصل work_note
WITH actor AS (SELECT id FROM public."users" ORDER BY id LIMIT 1),
stopped AS (
  UPDATE public."sales_item_fields" f
     SET "is_active"     = FALSE,
         "updated_by_id" = a.id,
         "updated_at"    = CURRENT_TIMESTAMP
    FROM actor a
   WHERE f.id = 6                            -- maintenance_note (المضاف لاحقًا)
     AND f.is_active
  RETURNING f.id, a.id AS actor_id,
            jsonb_build_object('id', f.id, 'field_key', f.field_key, 'label_ar', f.label_ar, 'is_active', true)  AS before_data,
            jsonb_build_object('id', f.id, 'field_key', f.field_key, 'label_ar', f.label_ar, 'is_active', false) AS after_data
)
INSERT INTO public."sales_catalog_audit"
  ("request_id", "entity", "entity_id", "action", "before_data", "after_data", "reason", "actor_id")
SELECT gen_random_uuid(), 'FIELD', s.id, 'DEACTIVATE', s.before_data, s.after_data,
       'إيقاف حقل مكرر: «بيان الصيانة» موجود أصلًا بمفتاح work_note', s.actor_id
  FROM stopped s;

COMMIT;

-- ٣) تقرير: كم بقي مفعّلًا؟ --------------------------------------------------
SELECT
  (SELECT count(*) FROM public."sales_item_types"  WHERE "is_active") AS "الأنواع المفعلة",
  (SELECT count(*) FROM public."sales_item_types"  WHERE NOT "is_active") AS "الأنواع الموقوفة",
  (SELECT count(*) FROM public."sales_item_fields" WHERE "is_active") AS "الحقول المفعلة",
  (SELECT count(*) FROM public."sales_item_fields" WHERE NOT "is_active") AS "الحقول الموقوفة";
