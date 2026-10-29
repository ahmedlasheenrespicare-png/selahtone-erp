-- فحص مبدئي للقراءة فقط: يُختبر أولًا على قاعدة معزولة. لا يشغّل أي ترحيل.
-- هذا فحص لمجموعة أساسية من المتطلبات وليس إثباتًا للتوافق الكامل أو هوية
-- قاعدة التطبيق أو صلاحيات حساب آخر. ظهور تعارض أو نقص يعني التوقف والمراجعة.
-- لا ترسل عناوين الاتصال أو كلمات المرور. الاستعلام لا يعرض أسماء العملاء أو السيريالات.
WITH required_columns(tbl, col, typ, nullable) AS (VALUES
  ('branches','id','int8','NO'), ('branches','is_active','bool','NO'),
  ('warehouses','id','int8','NO'), ('warehouses','branch_id','int8','NO'),
  ('warehouses','is_active','bool','NO'), ('warehouses','holds_stock','bool','NO'),
  ('users','id','int8','NO'), ('users','branch_id','int8','YES'), ('users','role_code','RoleCode','NO'),
  ('users','status','UserStatus','NO'), ('users','must_change_password','bool','NO'),
  ('products','id','int8','NO'), ('products','sku','varchar(40)','NO'), ('products','name_ar','varchar(180)','NO'),
  ('products','category','ProductCategory','NO'), ('products','sale_price','numeric(14,2)','NO'),
  ('products','tax_rate_id','int4','YES'), ('products','is_serialized','bool','NO'), ('products','is_active','bool','NO'),
  ('tax_rates','id','int4','NO'), ('tax_rates','code','varchar(20)','NO'), ('tax_rates','rate','numeric(6,3)','NO'),
  ('tax_rates','kind','TaxKind','NO'), ('tax_rates','effective_from','date','NO'),
  ('tax_rates','effective_to','date','YES'), ('tax_rates','is_active','bool','NO'),
  ('stock_levels','id','int8','NO'), ('stock_levels','warehouse_id','int8','NO'), ('stock_levels','product_id','int8','NO'),
  ('stock_levels','qty_on_hand','numeric(12,2)','NO'), ('stock_levels','avg_cost','numeric(14,4)','NO'),
  ('stock_levels','updated_at','timestamptz','NO'),
  ('inventory_openings','id','int8','NO'), ('inventory_openings','warehouse_id','int8','NO'),
  ('inventory_openings','product_id','int8','NO'), ('inventory_openings','quantity','numeric(12,2)','NO'),
  ('inventory_serials','id','int8','NO'), ('inventory_serials','opening_id','int8','NO'),
  ('inventory_serials','serial_number','varchar(80)','NO'), ('inventory_serials','serial_key','varchar(80)','NO'),
  ('inventory_serials','created_at','timestamptz','NO')
), actual_columns AS (
  SELECT table_name AS tbl, column_name AS col, is_nullable AS nullable,
    CASE WHEN udt_name IN ('varchar','bpchar') THEN udt_name || '(' || character_maximum_length::text || ')'
         WHEN udt_name = 'numeric' THEN udt_name || '(' || numeric_precision::text || ',' || numeric_scale::text || ')'
         ELSE udt_name END AS typ
  FROM information_schema.columns WHERE table_schema = 'public'
), column_mismatches AS (
  SELECT e.tbl || '.' || e.col AS item FROM required_columns e
  LEFT JOIN actual_columns a ON a.tbl=e.tbl AND a.col=e.col
  WHERE a.typ IS DISTINCT FROM e.typ OR a.nullable IS DISTINCT FROM e.nullable
), expected_indexes(tbl, name, cols) AS (VALUES
  ('stock_levels','stock_levels_warehouse_id_product_id_key',ARRAY['warehouse_id','product_id']),
  ('inventory_openings','inventory_openings_warehouse_id_product_id_key',ARRAY['warehouse_id','product_id']),
  ('inventory_serials','inventory_serials_serial_key_key',ARRAY['serial_key'])
), invalid_indexes AS (
  SELECT e.name AS item FROM expected_indexes e
  LEFT JOIN pg_index i ON i.indexrelid=to_regclass('public.' || e.name)
  WHERE i.indexrelid IS NULL OR NOT i.indisunique OR NOT i.indisvalid OR NOT i.indisready
    OR i.indrelid IS DISTINCT FROM to_regclass('public.' || e.tbl) OR i.indpred IS NOT NULL OR i.indexprs IS NOT NULL
    OR (SELECT array_agg(a.attname::text ORDER BY k.pos)
        FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum,pos)
        JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum
        WHERE k.pos <= i.indnkeyatts) IS DISTINCT FROM e.cols
), existing_source_fk AS (
  SELECT c.oid FROM pg_constraint c
  WHERE c.conrelid=to_regclass('public.inventory_serials') AND c.conname='inventory_serials_opening_id_fkey'
    AND c.contype='f' AND c.convalidated AND c.confrelid=to_regclass('public.inventory_openings')
    AND c.confupdtype='c' AND c.confdeltype='r'
    AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='opening_id')]::smallint[]
    AND c.confkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.confrelid AND attname='id')]::smallint[]
), expected_enum_values(enum_name, label) AS (VALUES
  ('RoleCode','MANAGER'),('RoleCode','ACCOUNTANT'),('RoleCode','CS_AGENT'),
  ('UserStatus','ACTIVE'),('UserStatus','SUSPENDED'),
  ('ProductCategory','HEARING_AID'),('ProductCategory','ACCESSORY'),('ProductCategory','SPARE_PART'),('ProductCategory','SERVICE'),
  ('TaxKind','VAT'),('TaxKind','SCHEDULE'),('TaxKind','WITHHOLDING'),('TaxKind','COMPOSITE'),('TaxKind','EXEMPT')
), actual_enum_values AS (
  SELECT t.typname::text AS enum_name, e.enumlabel::text AS label
  FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid
  WHERE n.nspname='public' AND t.typname IN ('RoleCode','UserStatus','ProductCategory','TaxKind')
), missing_enum_values AS (
  SELECT e.enum_name || '.' || e.label AS item FROM expected_enum_values e
  LEFT JOIN actual_enum_values a ON a.enum_name=e.enum_name AND a.label=e.label WHERE a.label IS NULL
), extra_enum_values AS (
  SELECT a.enum_name || '.' || a.label AS item FROM actual_enum_values a
  LEFT JOIN expected_enum_values e ON a.enum_name=e.enum_name AND a.label=e.label WHERE e.label IS NULL
), prospective_relations(name) AS (VALUES
  ('inventory_receipts'), ('inventory_receipts_id_seq'), ('inventory_receipts_pkey'),
  ('inventory_receipts_request_id_key'), ('inventory_receipts_warehouse_id_product_id_created_at_idx'),
  ('inventory_receipts_created_by_id_created_at_idx'), ('inventory_serials_receipt_id_idx'),
  ('commerce_settings'), ('commerce_settings_pkey'),
  ('commerce_settings_changes'), ('commerce_settings_changes_id_seq'), ('commerce_settings_changes_pkey'),
  ('commerce_settings_changes_request_id_key'), ('commerce_settings_changes_created_at_idx'),
  ('commerce_sales'), ('commerce_sales_id_seq'), ('commerce_sales_pkey'), ('commerce_sales_request_id_key'),
  ('commerce_sales_branch_id_created_at_idx'), ('commerce_sales_created_by_id_created_at_idx'),
  ('commerce_sale_lines'), ('commerce_sale_lines_id_seq'), ('commerce_sale_lines_pkey'),
  ('commerce_sale_lines_sale_id_product_id_key'), ('inventory_serials_current_sale_line_id_idx'),
  ('commerce_sale_line_serials'), ('commerce_sale_line_serials_id_seq'), ('commerce_sale_line_serials_pkey'),
  ('commerce_sale_line_serials_sale_line_id_serial_id_key'), ('commerce_sale_line_serials_serial_id_idx'),
  ('commerce_collections'), ('commerce_collections_id_seq'), ('commerce_collections_pkey'),
  ('commerce_collections_request_id_key'), ('commerce_collections_initial_per_sale_key'), ('commerce_collections_sale_id_created_at_idx'),
  ('commerce_returns'), ('commerce_returns_id_seq'), ('commerce_returns_pkey'), ('commerce_returns_request_id_key'), ('commerce_returns_sale_id_created_at_idx'),
  ('commerce_return_lines'), ('commerce_return_lines_id_seq'), ('commerce_return_lines_pkey'),
  ('commerce_return_lines_return_id_sale_line_id_key'), ('commerce_return_lines_sale_line_id_idx'),
  ('commerce_return_serials'), ('commerce_return_serials_id_seq'), ('commerce_return_serials_pkey'),
  ('commerce_return_serials_sale_line_serial_id_key'), ('commerce_return_serials_return_line_id_idx'),
  ('commerce_refunds'), ('commerce_refunds_id_seq'), ('commerce_refunds_pkey'),
  ('commerce_refunds_request_id_key'), ('commerce_refunds_sale_id_created_at_idx')
), relation_collisions AS (
  SELECT name AS item FROM prospective_relations WHERE to_regclass('public.' || name) IS NOT NULL
), new_column_collisions AS (
  SELECT column_name AS item FROM information_schema.columns
  WHERE table_schema='public' AND table_name='inventory_serials' AND column_name IN ('receipt_id','current_sale_line_id')
), new_constraint_collisions AS (
  SELECT c.conname AS item FROM pg_constraint c
  WHERE c.conrelid=to_regclass('public.inventory_serials')
    AND c.conname IN ('inventory_serials_receipt_id_fkey','inventory_serials_one_source_check','inventory_serials_current_sale_line_id_fkey')
)
SELECT jsonb_build_object(
  'database', current_database(), 'schema', current_schema(),
  'required_column_mismatches', (SELECT COALESCE(jsonb_agg(item ORDER BY item),'[]'::jsonb) FROM column_mismatches),
  'invalid_unique_indexes', (SELECT COALESCE(jsonb_agg(item ORDER BY item),'[]'::jsonb) FROM invalid_indexes),
  'existing_serial_source_fk_valid', EXISTS (SELECT 1 FROM existing_source_fk),
  'missing_enum_values', (SELECT COALESCE(jsonb_agg(item ORDER BY item),'[]'::jsonb) FROM missing_enum_values),
  'extra_enum_values', (SELECT COALESCE(jsonb_agg(item ORDER BY item),'[]'::jsonb) FROM extra_enum_values),
  'relation_collisions', (SELECT COALESCE(jsonb_agg(item ORDER BY item),'[]'::jsonb) FROM relation_collisions),
  'serial_column_collisions', (SELECT COALESCE(jsonb_agg(item ORDER BY item),'[]'::jsonb) FROM new_column_collisions),
  'serial_constraint_collisions', (SELECT COALESCE(jsonb_agg(item ORDER BY item),'[]'::jsonb) FROM new_constraint_collisions),
  'current_role_can_use_public', has_schema_privilege(current_user,'public','USAGE'),
  'current_role_can_create_in_public', has_schema_privilege(current_user,'public','CREATE'),
  'current_role_can_alter_serials', COALESCE((SELECT rol.rolsuper OR pg_has_role(current_user, cls.relowner, 'USAGE')
      FROM pg_class cls JOIN pg_roles rol ON rol.rolname=current_user WHERE cls.oid=to_regclass('public.inventory_serials')),false),
  'current_role_can_reference_users', COALESCE(has_table_privilege(current_user,to_regclass('public.users'),'REFERENCES'),false),
  'current_role_can_reference_branches', COALESCE(has_table_privilege(current_user,to_regclass('public.branches'),'REFERENCES'),false),
  'current_role_can_reference_warehouses', COALESCE(has_table_privilege(current_user,to_regclass('public.warehouses'),'REFERENCES'),false),
  'current_role_can_reference_products', COALESCE(has_table_privilege(current_user,to_regclass('public.products'),'REFERENCES'),false),
  'current_role_can_reference_taxes', COALESCE(has_table_privilege(current_user,to_regclass('public.tax_rates'),'REFERENCES'),false),
  'current_role_can_reference_serials', COALESCE(has_table_privilege(current_user,to_regclass('public.inventory_serials'),'REFERENCES'),false)
)::text AS result;
