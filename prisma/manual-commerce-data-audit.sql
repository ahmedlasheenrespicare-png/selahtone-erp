-- فحص بيانات تجميعي للقراءة فقط، للمرحلة السابقة لتحديث التوريد والبيع فقط.
-- لا يعرض أسماء الأصناف أو العملاء أو السيريالات، ولا يغيّر أي بيانات.
-- شغّل فحص المخطط أولًا على قاعدة اختبار؛ خطأ أو أعمدة غير متوقعة يعني التوقف.
-- لا تعالج الاختلافات آليًا: قد تكون هناك حركات مخزون قديمة خارج الرصيد الافتتاحي.
-- مطابقة الأعداد لا تثبت سلامة كل رقم أو توافق القاعدة أو صحة المعالجة الضريبية.
WITH stage AS (
  SELECT NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='inventory_serials' AND column_name IN ('receipt_id','current_sale_line_id')
  ) AND to_regclass('public.inventory_receipts') IS NULL AND to_regclass('public.commerce_sales') IS NULL AS before_upgrades
), serial_counts AS (
  SELECT o.warehouse_id, o.product_id, count(*)::numeric AS serial_count
  FROM public.inventory_serials s
  JOIN public.inventory_openings o ON o.id=s.opening_id
  JOIN public.products p ON p.id=o.product_id
  WHERE p.category::text <> 'SERVICE' AND (p.is_serialized OR p.category::text='HEARING_AID')
  GROUP BY o.warehouse_id, o.product_id
), tracked_stock AS (
  SELECT s.warehouse_id, s.product_id, s.qty_on_hand
  FROM public.stock_levels s JOIN public.products p ON p.id=s.product_id
  WHERE p.category::text <> 'SERVICE' AND (p.is_serialized OR p.category::text='HEARING_AID')
), mismatched_stock AS (
  SELECT 1 FROM tracked_stock s FULL JOIN serial_counts n
    ON n.warehouse_id=s.warehouse_id AND n.product_id=s.product_id
  WHERE COALESCE(s.qty_on_hand,0) <> COALESCE(n.serial_count,0)
), opening_serial_counts AS (
  SELECT opening_id, COUNT(*)::numeric AS serial_count FROM public.inventory_serials GROUP BY opening_id
), tax_stats AS (
  SELECT
    COUNT(*) FILTER (WHERE p.is_active) AS active_products,
    COUNT(*) FILTER (WHERE p.is_active AND (p.tax_rate_id IS NULL OR t.id IS NULL)) AS missing_tax,
    COUNT(*) FILTER (WHERE p.is_active AND t.id IS NOT NULL AND NOT t.is_active) AS inactive_tax,
    COUNT(*) FILTER (WHERE p.is_active AND t.id IS NOT NULL AND
      (t.effective_from > (statement_timestamp() AT TIME ZONE 'Africa/Cairo')::date OR
       (t.effective_to IS NOT NULL AND t.effective_to < (statement_timestamp() AT TIME ZONE 'Africa/Cairo')::date))) AS outside_tax_dates,
    COUNT(*) FILTER (WHERE p.is_active AND t.id IS NOT NULL AND t.kind::text NOT IN ('VAT','SCHEDULE','EXEMPT')) AS unsupported_tax_kind,
    COUNT(*) FILTER (WHERE p.is_active AND t.id IS NOT NULL AND (t.rate::text IN ('NaN','Infinity','-Infinity') OR t.rate < 0 OR t.rate > 100 OR (t.kind::text='EXEMPT' AND t.rate<>0))) AS invalid_tax_rate,
    COUNT(*) FILTER (WHERE p.is_active AND p.sale_price::text IN ('NaN','Infinity','-Infinity')) AS nonfinite_price,
    COUNT(*) FILTER (WHERE p.is_active AND p.sale_price<=0) AS zero_or_negative_price,
    COUNT(*) FILTER (WHERE p.is_active AND p.category::text='SERVICE' AND p.is_serialized) AS serialized_service
  FROM public.products p LEFT JOIN public.tax_rates t ON t.id=p.tax_rate_id
)
SELECT CASE WHEN NOT (SELECT before_upgrades FROM stage) THEN
  jsonb_build_object('stage','not_before_upgrades','warning','لا تستخدم فحص الأرصدة هذا بعد ترحيل التوريد أو البيع.')
ELSE jsonb_build_object(
  'stage','before_upgrades',
  'database',current_database(),'schema',current_schema(),
  'stock_rows',(SELECT COUNT(*) FROM public.stock_levels),
  'serialized_stock_count_mismatches',(SELECT COUNT(*) FROM mismatched_stock),
  'serialized_opening_count_mismatches',(SELECT COUNT(*) FROM public.inventory_openings o
    JOIN public.products p ON p.id=o.product_id LEFT JOIN opening_serial_counts n ON n.opening_id=o.id
    WHERE p.category::text<>'SERVICE' AND (p.is_serialized OR p.category::text='HEARING_AID')
      AND o.quantity<>COALESCE(n.serial_count,0)),
  'fractional_serialized_stock_rows',(SELECT COUNT(*) FROM tracked_stock WHERE qty_on_hand<>trunc(qty_on_hand)),
  'negative_stock_or_cost_rows',(SELECT COUNT(*) FROM public.stock_levels WHERE qty_on_hand<0 OR avg_cost<0),
  'nonfinite_stock_or_cost_rows',(SELECT COUNT(*) FROM public.stock_levels WHERE qty_on_hand::text IN ('NaN','Infinity','-Infinity') OR avg_cost::text IN ('NaN','Infinity','-Infinity')),
  'stock_with_missing_product_or_warehouse',(SELECT COUNT(*) FROM public.stock_levels s
    LEFT JOIN public.products p ON p.id=s.product_id LEFT JOIN public.warehouses w ON w.id=s.warehouse_id
    WHERE p.id IS NULL OR w.id IS NULL),
  'orphan_serials',(SELECT COUNT(*) FROM public.inventory_serials s LEFT JOIN public.inventory_openings o ON o.id=s.opening_id WHERE o.id IS NULL),
  'serials_in_nonserialized_openings',(SELECT COUNT(*) FROM public.inventory_serials s
    JOIN public.inventory_openings o ON o.id=s.opening_id JOIN public.products p ON p.id=o.product_id
    WHERE p.category::text='SERVICE' OR (NOT p.is_serialized AND p.category::text<>'HEARING_AID')),
  'blank_serial_numbers_or_keys',(SELECT COUNT(*) FROM public.inventory_serials WHERE length(btrim(serial_number))=0 OR length(btrim(serial_key))=0),
  'duplicate_serial_key_groups',(SELECT COUNT(*) FROM (SELECT serial_key FROM public.inventory_serials GROUP BY serial_key HAVING COUNT(*)>1) duplicates),
  'tax_review_required',true,
  'active_products',(SELECT active_products FROM tax_stats),
  'active_products_missing_tax',(SELECT missing_tax FROM tax_stats),
  'active_products_inactive_tax',(SELECT inactive_tax FROM tax_stats),
  'active_products_outside_tax_dates',(SELECT outside_tax_dates FROM tax_stats),
  'active_products_unsupported_tax_kind',(SELECT unsupported_tax_kind FROM tax_stats),
  'active_products_invalid_tax_rate',(SELECT invalid_tax_rate FROM tax_stats),
  'active_products_nonfinite_price',(SELECT nonfinite_price FROM tax_stats),
  'active_products_zero_or_negative_price',(SELECT zero_or_negative_price FROM tax_stats),
  'active_serialized_services',(SELECT serialized_service FROM tax_stats)
) END::text AS result;
