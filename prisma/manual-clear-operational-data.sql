-- ============================================================================
-- مسح بيانات التجربة التشغيلية: عهدة · صرف · بيع
-- ----------------------------------------------------------------------------
-- النطاق: البيانات التي أدخلها المستخدمون في التشغيل التجريبي فقط.
--
-- ما لا يُمسح إطلاقًا (وهو مفروغٌ منه في هذا الملف، فلا يظهر فيه):
--   · الفروع والمستخدمون وجلسات الدخول ومعدّلات الضريبة والمستودعات والمنتجات.
--   · تصنيفات البيع وأنواعها وحقولها (كتالوج) — بقاعدة: لا حذف للكتالوج.
--   · تصنيفات المصروفات وإعدادات البيع.
--   · السجلات: sales_catalog_audit · commerce_settings_changes · login_attempts
--     فهي ليست «عهدة ولا صرفًا ولا بيعًا»، وأثرها مطلوب بعد المسح.
--
-- الأمان:
--   · DELETE صريح لا TRUNCATE — فلا تجاوز صامت لقيود المفاتيح الأجنبية.
--   · الترتيب طوبولوجي: الأبناء قبل الآباء، مستخرج من قيود المخطط نفسه لا
--     بالاجتهاد. فلو حُذف أبٌ قبل ابنه لرفضت القاعدة الحذف (وهو مطلوب).
--   · معاملة واحدة: إن فشل أي سطر، تُلغى كلها ولا يُمسح شيء.
--   · آمن للتكرار: تشغيله مرة ثانية لا يفعل شيئًا (الجداول فارغة أصلًا).
-- ============================================================================

BEGIN;

-- ١) المبيعات: الأرقام التسلسلية والمرتجعات والتحصيل، ثم البنود، ثم الفواتير
DELETE FROM public."commerce_refunds";
DELETE FROM public."commerce_return_serials";
DELETE FROM public."commerce_return_lines";
DELETE FROM public."commerce_returns";
DELETE FROM public."commerce_sale_line_serials";
DELETE FROM public."commerce_collections";
DELETE FROM public."commerce_sale_lines";
DELETE FROM public."commerce_sales";

-- ٢) الفواتير القديمة (نظام سابق) وبنودها وضرائبها
DELETE FROM public."invoice_taxes";
DELETE FROM public."invoice_items";
DELETE FROM public."invoices";

-- ٣) الصرف والعهدة
DELETE FROM public."expenses";
DELETE FROM public."journal_entries";

-- ٤) المخزون: الأرقام التسلسلية، ثم الاستلام والافتتاحي، ثم الأرصدة
DELETE FROM public."inventory_serials";
DELETE FROM public."inventory_product_creations";
DELETE FROM public."inventory_receipts";
DELETE FROM public."inventory_openings";
DELETE FROM public."stock_levels";

COMMIT;

-- ============================================================================
-- تقرير التحقق: يجب أن تُصفّر كلها (وإلا فالمعاملة فشلت وأُلغي كل شيء)
-- ============================================================================
SELECT t.table_name AS "الجدول",
       (xpath('/row/c/text()',
          query_to_xml(format('select count(*) as c from %I.%I', t.table_schema, t.table_name),
                       false, true, '')))[1]::text::bigint AS "عدد الصفوف"
FROM information_schema.tables t
WHERE t.table_schema = 'public'
  AND t.table_name IN (
    'commerce_sales','commerce_sale_lines','commerce_sale_line_serials','commerce_collections',
    'commerce_returns','commerce_return_lines','commerce_return_serials','commerce_refunds',
    'invoices','invoice_items','invoice_taxes',
    'expenses','journal_entries',
    'stock_levels','inventory_openings','inventory_receipts','inventory_serials',
    'inventory_product_creations'
  )
ORDER BY 2 DESC, 1;
