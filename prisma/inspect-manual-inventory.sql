-- قراءة فقط: تفصيل الجداول والفهارس والقيود بعد تطبيق ترحيل المخزون.
SELECT jsonb_build_object(
  'database', current_database(), 'schema', current_schema(),
  'products_count', (SELECT COUNT(*) FROM public.products),
  'stock_rows', (SELECT COUNT(*) FROM public.stock_levels),
  'openings_rows', (SELECT COUNT(*) FROM public.inventory_openings),
  'serials_rows', (SELECT COUNT(*) FROM public.inventory_serials),
  'product_creation_rows', (SELECT COUNT(*) FROM public.inventory_product_creations),
  'columns', (
    SELECT COALESCE(jsonb_agg(
      format('%s.%s|%s|len:%s|precision:%s|scale:%s|nullable:%s|default:%s',
        table_name, column_name, udt_name, COALESCE(character_maximum_length::text, '-'),
        COALESCE(numeric_precision::text, '-'), COALESCE(numeric_scale::text, '-'),
        is_nullable, COALESCE(column_default, '-')) ORDER BY table_name, ordinal_position
    ), '[]'::jsonb)
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('inventory_openings', 'inventory_serials', 'inventory_product_creations')
  ),
  'constraints', (
    SELECT COALESCE(jsonb_agg(
      format('%s.%s|validated:%s|%s', t.relname, c.conname, c.convalidated, pg_get_constraintdef(c.oid))
      ORDER BY t.relname, c.conname
    ), '[]'::jsonb)
    FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname IN ('inventory_openings', 'inventory_serials', 'inventory_product_creations')
  ),
  'indexes', (
    SELECT COALESCE(jsonb_agg(
      format('%s|unique:%s|valid:%s|ready:%s|%s', i.relname, x.indisunique, x.indisvalid, x.indisready, pg_get_indexdef(i.oid))
      ORDER BY i.relname
    ), '[]'::jsonb)
    FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid JOIN pg_class t ON t.oid = x.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname IN ('inventory_openings', 'inventory_serials', 'inventory_product_creations')
  )
)::text AS result;
