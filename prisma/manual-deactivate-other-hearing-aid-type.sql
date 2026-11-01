-- ============================================================================
-- إيقاف نوع «سماعة» داخل تصنيف «أخرى» (رقمه ١٠)
-- ----------------------------------------------------------------------------
-- السبب: للسماعة تصنيف مستقل بها (وفيه النوع المستعمل فعلًا في الفواتير).
-- فبقاء نوع بنفس الاسم داخل «أخرى» يعرض الاسم مرتين على الموظف بلا معنى،
-- فيُوقف هذا النوع ويبقى تصنيف «سماعة» كما هو.
--
-- الأمان: لا DELETE · لا إيقاف لصنف استُخدم في فاتورة (وهذا استخدامه صفر) ·
-- لا إيقاف لموقوف أصلًا · والإيقاف يُسجَّل في sales_catalog_audit بسببه
-- وقبله وبعده، كما تفعل شاشة المدير.
--
-- آمن للتكرار: إن أعِدت تشغيله فلن يُوقف شيئًا ولن يُسجّل جديدًا.
-- ============================================================================

BEGIN;

WITH actor AS (SELECT id FROM public."users" ORDER BY id LIMIT 1),
stopped AS (
  UPDATE public."sales_item_types" t
     SET "is_active"     = FALSE,
         "updated_by_id" = a.id,
         "updated_at"    = CURRENT_TIMESTAMP
    FROM actor a
   WHERE t.id = 10                            -- «سماعة» داخل تصنيف «أخرى»
     AND t.is_active
     AND NOT EXISTS (SELECT 1 FROM public."commerce_sale_lines" l WHERE l."catalog_type_id" = t.id)
  RETURNING t.id, a.id AS actor_id, t.name_ar,
            jsonb_build_object('id', t.id, 'name_ar', t.name_ar, 'is_active', true)  AS before_data,
            jsonb_build_object('id', t.id, 'name_ar', t.name_ar, 'is_active', false) AS after_data
)
INSERT INTO public."sales_catalog_audit"
  ("request_id", "entity", "entity_id", "action", "before_data", "after_data", "reason", "actor_id")
SELECT gen_random_uuid(), 'TYPE', s.id, 'DEACTIVATE', s.before_data, s.after_data,
       'إيقاف نوع «سماعة» داخل «أخرى»: للسماعة تصنيف مستقل، ولم يُستخدم هذا النوع في أي فاتورة',
       s.actor_id
  FROM stopped s;

COMMIT;

-- تقرير: كم بقي مفعّلًا؟
SELECT
  (SELECT count(*) FROM public."sales_item_types" WHERE "is_active")     AS "الأنواع المفعلة",
  (SELECT count(*) FROM public."sales_item_types" WHERE NOT "is_active") AS "الأنواع الموقوفة";
