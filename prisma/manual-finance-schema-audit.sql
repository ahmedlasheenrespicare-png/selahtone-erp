-- Read-only catalog inspection for planning expenses and cash custody.
-- This reads schema metadata only: no customer names, serial numbers,
-- balances, transaction rows, default literals, or CHECK expressions.
-- It does not prove the application's database identity or privileges.
WITH public_relations AS (
  SELECT c.oid, c.relname::text AS name, c.relkind::text AS kind,
    c.relrowsecurity, c.relforcerowsecurity
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
), finance_relations AS (
  SELECT * FROM public_relations
  WHERE name ~* '(expense|cash|custod|treasur|petty|advance|journal|payment|ledger|disburse|fund)'
     OR name IN ('commerce_sales', 'commerce_collections', 'commerce_refunds')
), relation_columns AS (
  SELECT r.name,
    COALESCE(jsonb_agg(jsonb_build_object(
      'column', a.attname::text,
      'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
      'nullable', NOT a.attnotnull,
      'has_default', a.atthasdef,
      'identity', a.attidentity <> '',
      'generated', a.attgenerated <> ''
    ) ORDER BY a.attnum) FILTER (WHERE a.attnum IS NOT NULL), '[]'::jsonb) AS columns
  FROM finance_relations r
  LEFT JOIN pg_catalog.pg_attribute a
    ON a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped
  GROUP BY r.name
), relation_constraints AS (
  SELECT r.name AS table_name, c.conname::text AS constraint_name,
    jsonb_build_object(
      'table', r.name,
      'name', c.conname::text,
      'type', c.contype::text,
      'validated', c.convalidated,
      'deferrable', c.condeferrable,
      'columns', COALESCE((
        SELECT jsonb_agg(a.attname::text ORDER BY k.position)
        FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, position)
        JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
      ), '[]'::jsonb),
      'references', CASE WHEN c.contype = 'f' THEN (
        SELECT jsonb_build_object(
          'table', n.nspname::text || '.' || ref.relname::text,
          'columns', COALESCE((
            SELECT jsonb_agg(a.attname::text ORDER BY k.position)
            FROM unnest(c.confkey) WITH ORDINALITY AS k(attnum, position)
            JOIN pg_catalog.pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum
          ), '[]'::jsonb)
        )
        FROM pg_catalog.pg_class ref
        JOIN pg_catalog.pg_namespace n ON n.oid = ref.relnamespace
        WHERE ref.oid = c.confrelid
      ) ELSE NULL END
    ) AS details
  FROM finance_relations r
  JOIN pg_catalog.pg_constraint c ON c.conrelid = r.oid
  WHERE c.contype IN ('p', 'u', 'f', 'c')
)
SELECT jsonb_build_object(
  'database', current_database(),
  'current_schema', current_schema(),
  'public_relations', COALESCE((
    SELECT jsonb_agg(name ORDER BY name) FROM public_relations
  ), '[]'::jsonb),
  'financial_relations', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'table', name,
      'kind', kind,
      'row_security', relrowsecurity,
      'force_row_security', relforcerowsecurity,
      'current_role_can_select', has_table_privilege(current_user, oid, 'SELECT')
    ) ORDER BY name)
    FROM finance_relations
  ), '[]'::jsonb),
  'columns', COALESCE((
    SELECT jsonb_object_agg(name, columns ORDER BY name) FROM relation_columns
  ), '{}'::jsonb),
  'constraints', COALESCE((
    SELECT jsonb_agg(details ORDER BY table_name, constraint_name) FROM relation_constraints
  ), '[]'::jsonb)
)::text AS finance_schema_audit;
