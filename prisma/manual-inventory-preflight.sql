-- فحص قراءة فقط للمراجعة قبل ترحيل المخزون. لا يُنشئ جداول ولا يعدّل بيانات.
-- شغّله أولًا على نسخة تجريبية، وعلى القاعدة المقصودة فقط بعد التأكد من هويتها.
-- لا ترسل عناوين الاتصال أو كلمات المرور ضمن النتائج.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';

SELECT current_database() AS database_name, current_schema() AS schema_name;

-- يجب مراجعة أي اسم موجود قبل الترحيل؛ لا يُعاد الترحيل على جداول موجودة.
SELECT expected.name, to_regclass('public.' || expected.name) AS existing_relation
FROM (VALUES ('inventory_openings'), ('inventory_serials'), ('inventory_product_creations')) AS expected(name);

-- قارن جميع الأعمدة والأنواع والقيود الفعلية مع prisma/schema.prisma قبل الإضافة.
SELECT table_name, column_name, data_type, udt_name, is_nullable,
       character_maximum_length, numeric_precision, numeric_scale, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('users', 'branches', 'warehouses', 'products', 'stock_levels', 'tax_rates')
ORDER BY table_name, ordinal_position;

SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('users', 'branches', 'warehouses', 'products', 'stock_levels', 'tax_rates')
ORDER BY tablename, indexname;

SELECT relation.relname AS table_name, constraint_info.conname AS constraint_name,
       constraint_info.contype AS constraint_type, pg_get_constraintdef(constraint_info.oid) AS definition
FROM pg_constraint constraint_info
JOIN pg_class relation ON relation.oid = constraint_info.conrelid
JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
WHERE namespace.nspname = 'public'
  AND relation.relname IN ('users', 'branches', 'warehouses', 'products', 'stock_levels', 'tax_rates')
ORDER BY relation.relname, constraint_info.conname;

SELECT enum_type.typname AS enum_name, enum_value.enumlabel AS value
FROM pg_type enum_type
JOIN pg_namespace namespace ON namespace.oid = enum_type.typnamespace
JOIN pg_enum enum_value ON enum_value.enumtypid = enum_type.oid
WHERE namespace.nspname = 'public' AND enum_type.typname IN ('RoleCode', 'UserStatus', 'ProductCategory')
ORDER BY enum_type.typname, enum_value.enumsortorder;

-- قد توجد بيانات سيريال قديمة خارج المخطط المعروف؛ راجعها قبل افتراض عدم وجودها.
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND (column_name ILIKE '%serial%' OR table_name ILIKE '%serial%')
ORDER BY table_name, column_name;

-- لا يعرض هذا الفحص أسماء الأصناف أو السيريالات، بل مؤشرات على الحاجة لخطة للأرصدة الموجودة.
SELECT COUNT(*) AS stock_rows,
       COUNT(*) FILTER (WHERE qty_on_hand = 0) AS zero_stock_rows,
       COUNT(*) FILTER (WHERE qty_on_hand > 0) AS positive_stock_rows
FROM public.stock_levels;

SELECT COUNT(*) AS serialized_existing_stock_rows
FROM public.stock_levels s
JOIN public.products p ON p.id = s.product_id
WHERE s.qty_on_hand > 0 AND (p.is_serialized OR p.category = 'HEARING_AID');

ROLLBACK;
