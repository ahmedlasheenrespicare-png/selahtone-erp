-- قراءة فقط بعد ترحيل المخزون؛ لا تُشغّل بديلًا عن المراجعة والموافقة على الترحيل.
WITH expected_objects(name, kind) AS (VALUES
  ('inventory_openings', 'r'), ('inventory_serials', 'r'), ('inventory_product_creations', 'r'),
  ('inventory_openings_id_seq', 'S'), ('inventory_serials_id_seq', 'S'), ('inventory_product_creations_id_seq', 'S'),
  ('inventory_openings_pkey', 'i'), ('inventory_openings_request_id_key', 'i'),
  ('inventory_openings_warehouse_id_product_id_key', 'i'), ('inventory_openings_created_by_id_created_at_idx', 'i'),
  ('inventory_serials_pkey', 'i'), ('inventory_serials_serial_key_key', 'i'), ('inventory_serials_opening_id_idx', 'i'),
  ('inventory_product_creations_pkey', 'i'), ('inventory_product_creations_request_id_key', 'i'),
  ('inventory_product_creations_product_id_key', 'i'), ('inventory_product_creations_created_by_id_created_at_idx', 'i')
), missing_objects AS (
  SELECT e.name AS item FROM expected_objects e
  LEFT JOIN pg_class r ON r.oid = to_regclass('public.' || e.name) AND r.relkind::text = e.kind
  WHERE r.oid IS NULL
), expected_constraints(tbl, name, kind) AS (VALUES
  ('inventory_openings','inventory_openings_pkey','p'),
  ('inventory_openings','inventory_openings_quantity_check','c'),
  ('inventory_openings','inventory_openings_unit_cost_check','c'),
  ('inventory_openings','inventory_openings_request_hash_check','c'),
  ('inventory_openings','inventory_openings_warehouse_id_fkey','f'),
  ('inventory_openings','inventory_openings_product_id_fkey','f'),
  ('inventory_openings','inventory_openings_created_by_id_fkey','f'),
  ('inventory_serials','inventory_serials_pkey','p'),
  ('inventory_serials','inventory_serials_number_check','c'),
  ('inventory_serials','inventory_serials_key_check','c'),
  ('inventory_serials','inventory_serials_opening_id_fkey','f'),
  ('inventory_product_creations','inventory_product_creations_pkey','p'),
  ('inventory_product_creations','inventory_product_creations_request_hash_check','c'),
  ('inventory_product_creations','inventory_product_creations_product_id_fkey','f'),
  ('inventory_product_creations','inventory_product_creations_created_by_id_fkey','f')
), missing_constraints AS (
  SELECT e.name AS item FROM expected_constraints e
  LEFT JOIN pg_constraint c ON c.conrelid = to_regclass('public.' || e.tbl)
    AND c.conname = e.name AND c.contype::text = e.kind AND c.convalidated
  WHERE c.oid IS NULL
), expected_unique_indexes(tbl, name, cols) AS (VALUES
  ('inventory_openings','inventory_openings_request_id_key',ARRAY['request_id']),
  ('inventory_openings','inventory_openings_warehouse_id_product_id_key',ARRAY['warehouse_id','product_id']),
  ('inventory_serials','inventory_serials_serial_key_key',ARRAY['serial_key']),
  ('inventory_product_creations','inventory_product_creations_request_id_key',ARRAY['request_id']),
  ('inventory_product_creations','inventory_product_creations_product_id_key',ARRAY['product_id'])
), invalid_unique_indexes AS (
  SELECT e.name AS item FROM expected_unique_indexes e
  LEFT JOIN pg_index i ON i.indexrelid = to_regclass('public.' || e.name)
  WHERE i.indexrelid IS NULL OR NOT i.indisunique OR NOT i.indisvalid OR NOT i.indisready
    OR i.indrelid IS DISTINCT FROM to_regclass('public.' || e.tbl) OR i.indpred IS NOT NULL OR i.indexprs IS NOT NULL
    OR (SELECT array_agg(a.attname::text ORDER BY k.pos)
        FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum,pos)
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
        WHERE k.pos <= i.indnkeyatts) IS DISTINCT FROM e.cols
), expected_foreign_keys(tbl, name, col, target_tbl) AS (VALUES
  ('inventory_openings','inventory_openings_warehouse_id_fkey','warehouse_id','warehouses'),
  ('inventory_openings','inventory_openings_product_id_fkey','product_id','products'),
  ('inventory_openings','inventory_openings_created_by_id_fkey','created_by_id','users'),
  ('inventory_serials','inventory_serials_opening_id_fkey','opening_id','inventory_openings'),
  ('inventory_product_creations','inventory_product_creations_product_id_fkey','product_id','products'),
  ('inventory_product_creations','inventory_product_creations_created_by_id_fkey','created_by_id','users')
), foreign_key_mismatches AS (
  SELECT e.name AS item FROM expected_foreign_keys e
  LEFT JOIN pg_constraint c ON c.conrelid = to_regclass('public.' || e.tbl)
    AND c.conname = e.name AND c.contype = 'f' AND c.convalidated
  WHERE c.oid IS NULL OR c.confrelid IS DISTINCT FROM to_regclass('public.' || e.target_tbl)
    OR c.confupdtype <> 'c' OR c.confdeltype <> 'r'
    OR c.conkey IS DISTINCT FROM ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname=e.col)]::smallint[]
    OR c.confkey IS DISTINCT FROM ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.confrelid AND attname='id')]::smallint[]
), expected_columns(tbl, col, typ, nullable) AS (VALUES
  ('inventory_openings','id','int8','NO'), ('inventory_openings','request_id','uuid','NO'),
  ('inventory_openings','request_hash','bpchar(64)','NO'), ('inventory_openings','warehouse_id','int8','NO'),
  ('inventory_openings','product_id','int8','NO'), ('inventory_openings','quantity','numeric(12,2)','NO'),
  ('inventory_openings','unit_cost','numeric(14,4)','NO'), ('inventory_openings','created_by_id','int8','NO'),
  ('inventory_openings','created_at','timestamptz','NO'),
  ('inventory_serials','id','int8','NO'), ('inventory_serials','opening_id','int8','NO'),
  ('inventory_serials','serial_number','varchar(80)','NO'), ('inventory_serials','serial_key','varchar(80)','NO'),
  ('inventory_serials','created_at','timestamptz','NO'),
  ('inventory_product_creations','id','int8','NO'), ('inventory_product_creations','request_id','uuid','NO'),
  ('inventory_product_creations','request_hash','bpchar(64)','NO'), ('inventory_product_creations','product_id','int8','NO'),
  ('inventory_product_creations','created_by_id','int8','NO'), ('inventory_product_creations','created_at','timestamptz','NO')
), actual_columns AS (
  SELECT table_name AS tbl, column_name AS col, is_nullable AS nullable,
    CASE WHEN udt_name IN ('varchar','bpchar') THEN udt_name || '(' || character_maximum_length::text || ')'
         WHEN udt_name = 'numeric' THEN udt_name || '(' || numeric_precision::text || ',' || numeric_scale::text || ')'
         ELSE udt_name END AS typ
  FROM information_schema.columns WHERE table_schema = 'public'
), column_mismatches AS (
  SELECT e.tbl || '.' || e.col AS item FROM expected_columns e
  LEFT JOIN actual_columns a ON a.tbl = e.tbl AND a.col = e.col
  WHERE a.typ IS DISTINCT FROM e.typ OR a.nullable IS DISTINCT FROM e.nullable
)
SELECT jsonb_build_object(
  'database', current_database(), 'schema', current_schema(),
  'missing_objects', (SELECT COALESCE(jsonb_agg(item ORDER BY item), '[]'::jsonb) FROM missing_objects),
  'missing_constraints', (SELECT COALESCE(jsonb_agg(item ORDER BY item), '[]'::jsonb) FROM missing_constraints),
  'invalid_unique_indexes', (SELECT COALESCE(jsonb_agg(item ORDER BY item), '[]'::jsonb) FROM invalid_unique_indexes),
  'foreign_key_mismatches', (SELECT COALESCE(jsonb_agg(item ORDER BY item), '[]'::jsonb) FROM foreign_key_mismatches),
  'column_mismatches', (SELECT COALESCE(jsonb_agg(item ORDER BY item), '[]'::jsonb) FROM column_mismatches),
  'products_count', (SELECT COUNT(*) FROM public.products),
  'stock_rows', (SELECT COUNT(*) FROM public.stock_levels)
)::text AS result;
