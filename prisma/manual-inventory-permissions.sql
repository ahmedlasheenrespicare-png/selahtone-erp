-- فحص قراءة فقط لصلاحيات الحساب الحالي والأعمدة اللازمة قبل ترحيل المخزون.
WITH required(table_name, column_name, udt_name) AS (VALUES
  ('users', 'id', 'int8'), ('users', 'role_code', 'RoleCode'),
  ('users', 'status', 'UserStatus'), ('users', 'must_change_password', 'bool'),
  ('warehouses', 'id', 'int8'), ('warehouses', 'branch_id', 'int8'),
  ('warehouses', 'name_ar', 'varchar'), ('warehouses', 'code', 'varchar'),
  ('warehouses', 'is_active', 'bool'), ('warehouses', 'holds_stock', 'bool'),
  ('branches', 'id', 'int8'), ('branches', 'name_ar', 'varchar'), ('branches', 'is_active', 'bool'),
  ('tax_rates', 'id', 'int4'), ('tax_rates', 'code', 'varchar'), ('tax_rates', 'name_ar', 'varchar'),
  ('tax_rates', 'rate', 'numeric'), ('tax_rates', 'is_active', 'bool')
), differences AS (
  SELECT r.table_name || '.' || r.column_name AS item
  FROM required r LEFT JOIN information_schema.columns c
    ON c.table_schema = 'public' AND c.table_name = r.table_name AND c.column_name = r.column_name
  WHERE c.udt_name IS DISTINCT FROM r.udt_name
)
SELECT jsonb_build_object(
  'column_mismatches', (SELECT COALESCE(jsonb_agg(item ORDER BY item), '[]'::jsonb) FROM differences),
  'create_tables', has_schema_privilege(current_user, 'public', 'CREATE'),
  'use_schema', has_schema_privilege(current_user, 'public', 'USAGE'),
  'reference_users', has_table_privilege(current_user, 'public.users', 'REFERENCES'),
  'reference_products', has_table_privilege(current_user, 'public.products', 'REFERENCES'),
  'reference_warehouses', has_table_privilege(current_user, 'public.warehouses', 'REFERENCES'),
  'insert_products', has_table_privilege(current_user, 'public.products', 'INSERT'),
  'insert_stock', has_table_privilege(current_user, 'public.stock_levels', 'INSERT'),
  'use_product_sequence', COALESCE(has_sequence_privilege(current_user, pg_get_serial_sequence('public.products', 'id'), 'USAGE'), false),
  'use_stock_sequence', COALESCE(has_sequence_privilege(current_user, pg_get_serial_sequence('public.stock_levels', 'id'), 'USAGE'), false),
  'products_unique_valid', COALESCE((SELECT indisunique AND indisvalid AND indisready FROM pg_index WHERE indexrelid = to_regclass('public.products_sku_key')), false),
  'stock_unique_valid', COALESCE((SELECT indisunique AND indisvalid AND indisready FROM pg_index WHERE indexrelid = to_regclass('public.stock_levels_warehouse_id_product_id_key')), false),
  'read_only_transaction', current_setting('transaction_read_only') = 'on'
)::text AS result;
