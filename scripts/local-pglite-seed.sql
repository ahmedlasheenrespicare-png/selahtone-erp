-- LOCAL PGlite preview fixture (synthetic demo data, NOT production).
-- The bcrypt placeholder is substituted by scripts/local-pglite-preview.cjs at apply time.

-- الفروع والمستودعات
INSERT INTO branches (id, code, name_ar, city, phone, invoice_prefix, opening_date, is_active, created_at) VALUES
  (1,'ARH','فرع العريش','العريش','0683500001','ARI', CURRENT_DATE - 400, true, now() - interval '120 days'),
  (2,'SHM','فرع الشيخ زويد','الشيخ زويد','0684600002','SHZ', CURRENT_DATE - 400, true, now() - interval '110 days'),
  (3,'BID','فرع بئر العبد','بئر العبد','0684700003','BID', CURRENT_DATE - 250, true, now() - interval '100 days');
INSERT INTO warehouses (id, branch_id, code, name_ar, is_default, holds_stock, is_active) VALUES
  (1,1,'ARH-W1','فرع العريش — المستودع الرئيسي',true,true,true),
  (2,2,'SHM-W1','فرع الشيخ زويد — المستودع الرئيسي',true,true,true),
  (3,3,'BID-W1','فرع بئر العبد — المستودع الرئيسي',true,true,true);
INSERT INTO tax_rates (id, code, name_ar, rate, kind, effective_from, is_default, is_active) VALUES
  (1,'EXEMPT','معفى من الضريبة',0,'EXEMPT',CURRENT_DATE - 400, true, true),
  (2,'VAT5','ضريبة جدول — أجهزة طبية 5%',5,'SCHEDULE',CURRENT_DATE - 400, false, true),
  (3,'VAT14','القيمة المضافة — السعر العام 14%',14,'VAT',CURRENT_DATE - 400, false, true),
  (4,'COMP8','مكوّن إضافي 8% (يُحسب تراكميًا على 14%)',8,'COMPOSITE',CURRENT_DATE - 400, false, true),
  (5,'VAT22','ضريبة 22% أحادية',22,'VAT',CURRENT_DATE - 400, false, true);
INSERT INTO expense_categories (id, code, name_ar, is_active) VALUES
  (1,'RENT','إيجار الفروع',true),(2,'UTILITIES','كهرباء ومياه وإنترنت',true),(3,'SALARIES','رواتب وأجور',true),
  (4,'PETTY','مصروفات نثرية',true),(5,'SPARE_PARTS','قطع غيار وأدوات صيانة',true),(6,'MARKETING','تسويق ودعاية',true),(7,'MAINT','صيانة وإصلاحات',true);
INSERT INTO commerce_settings (id, staff_discount_bps, manager_discount_bps, updated_at) VALUES (1, 500, 2500, now());
INSERT INTO users (id, branch_id, role_code, full_name, email, password_hash, status, must_change_password, menu_scope, can_cancel_sales, created_at) VALUES
  (1, NULL, 'MANAGER', 'مدير الشركة', 'manager@selahtone.local', '__PREVIEW_BCRYPT__', 'ACTIVE', false, 'FULL', true, now() - interval '100 days'),
  (2, NULL, 'ACCOUNTANT', 'المحاسب العام', 'accountant@selahtone.local', '__PREVIEW_BCRYPT__', 'ACTIVE', false, 'FULL', true, now() - interval '100 days'),
  (3, 1, 'CS_AGENT', 'كاونتر العريش', 'arh@selahtone.local', '__PREVIEW_BCRYPT__', 'ACTIVE', false, 'FULL', true, now() - interval '100 days');
INSERT INTO products (id, sku, name_ar, category, brand, model, purchase_cost, sale_price, tax_rate_id, is_serialized, is_active, created_at) VALUES
  (1,'HA-PHK-A30','سماعة Phonak Audéo A30','HEARING_AID','Phonak','A30',11000,18500,2,true,true, now() - interval '100 days'),
  (2,'AC-BAT-312','بطارية 312 — علبة 6','ACCESSORY','PowerOne','312',30,45,3,false,true, now() - interval '100 days'),
  (3,'SP-EAR-MOLD','قطعة أذن مخصصة','SPARE_PART',NULL,'MOLD',80,600,3,false,true, now() - interval '100 days'),
  (4,'SV-CAL-01','جلسة ضبط وتعيير','SERVICE',NULL,NULL,0,150,3,false,true, now() - interval '100 days');
INSERT INTO stock_levels (id, warehouse_id, product_id, qty_on_hand, avg_cost, updated_at) VALUES
  (1,1,1,10,11000,now()),(2,1,2,500,30,now()),(3,1,3,300,80,now()),(4,1,4,0,0,now()),
  (5,2,1,6,11000,now()),(6,2,2,200,30,now()),(7,3,2,150,30,now()),(8,3,3,120,80,now());
-- الفواتير والسطور
INSERT INTO commerce_sales (id, request_id, request_hash, branch_id, warehouse_id, customer_name, customer_phone,
  subtotal, discount, taxable_base, tax_total, total, revision, cancelled_at, created_by_id, created_at) VALUES
  (1,'00000000-0000-4000-8000-000000000001', rpad('a1', 64, 'a1'), 1, 1, 'أحمد حجازي', '01000000001', 18750, 0, 18750, 0, 18750, 1, NULL, 1, (date_trunc('day', now() AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo') + interval '10 hours'),
  (2,'00000000-0000-4000-8000-000000000002', rpad('a2', 64, 'a2'), 1, 1, 'محمود علي النجار', '01000000002', 30000, 0, 30000, 0, 30000, 1, NULL, 1, (date_trunc('day', now() AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo') + interval '13 hours'),
  (3,'00000000-0000-4000-8000-000000000003', rpad('a3', 64, 'a3'), 2, 2, 'منى سالم', '01000000003', 12500, 0, 12500, 0, 12500, 1, NULL, 1, (date_trunc('day', now() AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo') - interval '1 day' + interval '11 hours'),
  (4,'00000000-0000-4000-8000-000000000004', rpad('a4', 64, 'a4'), 1, 1, 'خالد المصري', '01000000004', 5700, 0, 5700, 0, 5700, 1, NULL, 1, (date_trunc('day', now() AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo') - interval '3 days' + interval '12 hours'),
  (5,'00000000-0000-4000-8000-000000000005', rpad('a5', 64, 'a5'), 3, 3, 'سمية القاضي', '01000000005', 6000, 0, 6000, 0, 6000, 1, NULL, 1, (date_trunc('day', now() AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo') - interval '4 days' + interval '14 hours'),
  (6,'00000000-0000-4000-8000-000000000006', rpad('a6', 64, 'a6'), 1, 1, 'أحمد حجازي', '01000000001', 22000, 0, 22000, 0, 22000, 1, NULL, 1, (date_trunc('day', now() AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo') - interval '2 days' + interval '15 hours'),
  (7,'00000000-0000-4000-8000-000000000007', rpad('a7', 64, 'a7'), 1, 1, 'فاتورة ملغاة', '01000000007', 9999, 0, 9999, 0, 9999, 1, (date_trunc('day', now() AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo') + interval '16 hours', 1, (date_trunc('day', now() AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo') + interval '15 hours'),
  (8,'00000000-0000-4000-8000-000000000008', rpad('a8', 64, 'a8'), 2, 2, 'منى سالم', '01000000003', 45000, 0, 45000, 0, 45000, 1, NULL, 1, (date_trunc('day', now() AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo') + interval '9 hours'),
  (9,'00000000-0000-4000-8000-000000000009', rpad('a9', 64, 'a9'), 1, 1, 'يوسف النجار', '01000000009', 8000, 0, 8000, 0, 8000, 1, NULL, 1, (date_trunc('day', now() AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo') - interval '6 days' + interval '10 hours');
INSERT INTO commerce_sale_lines (id, sale_id, product_id, name_snapshot, quantity, unit_price, gross, discount, total, is_stock, is_serialized, sku_snapshot, tax_code_snapshot, tax_rate_snapshot) VALUES
  (1, 1, 1, 'سماعة Phonak Audéo A30', 1, 18750, 18750, 0, 18750, true, true, 'HA-PHK-A30', 'VAT5', 5),
  (2, 2, 1, 'سماعة Phonak Audéo A30', 1, 18500, 18500, 0, 18500, true, true, 'HA-PHK-A30', 'VAT5', 5),
  (3, 2, 4, 'جلسة ضبط وتعيير', 1, 11500, 11500, 0, 11500, false, false, 'SV-CAL-01', 'VAT14', 14),
  (4, 3, 1, 'سماعة Phonak Audéo A30', 1, 12500, 12500, 0, 12500, true, true, 'HA-PHK-A30', 'VAT5', 5),
  (5, 4, 2, 'بطارية 312 — علبة 6', 127, 45, 5715, 15, 5700, false, false, 'AC-BAT-312', 'VAT14', 14),
  (6, 5, 3, 'قطعة أذن مخصصة', 10, 600, 6000, 0, 6000, false, false, 'SP-EAR-MOLD', 'VAT14', 14),
  (7, 6, 1, 'سماعة Phonak Audéo A30', 1, 22000, 22000, 0, 22000, true, true, 'HA-PHK-A30', 'VAT5', 5),
  (8, 8, 1, 'سماعة Phonak Audéo A30', 2, 22500, 45000, 0, 45000, true, true, 'HA-PHK-A30', 'VAT5', 5),
  (9, 9, 4, 'جلسة ضبط وتعيير', 1, 8000, 8000, 0, 8000, false, false, 'SV-CAL-01', 'VAT14', 14);
-- التحصيلات
INSERT INTO commerce_collections (id, request_id, request_hash, sale_id, amount, method, is_initial, created_by_id, created_at) VALUES
  (1,'00000000-0000-4000-8000-000000000101', rpad('b1', 64, 'b1'), 1, 18750, 'CASH', true, 1, (date_trunc('day', now() AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo') + interval '10 hours'),
  (2,'00000000-0000-4000-8000-000000000102', rpad('b2', 64, 'b2'), 2, 12000, 'INSTAPAY', true, 3, (date_trunc('day', now() AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo') + interval '13 hours'),
  (3,'00000000-0000-4000-8000-000000000103', rpad('b3', 64, 'b3'), 4, 5700, 'CARD', true, 1, (date_trunc('day', now() AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo') - interval '3 days' + interval '12 hours'),
  (4,'00000000-0000-4000-8000-000000000104', rpad('b4', 64, 'b4'), 5, 2500, 'CASH', true, 1, (date_trunc('day', now() AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo') - interval '4 days' + interval '14 hours'),
  (5,'00000000-0000-4000-8000-000000000105', rpad('b5', 64, 'b5'), 6, 22000, 'CASH', true, 1, (date_trunc('day', now() AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo') - interval '2 days' + interval '15 hours'),
  (6,'00000000-0000-4000-8000-000000000106', rpad('b6', 64, 'b6'), 8, 5000, 'INSTAPAY', true, 3, (date_trunc('day', now() AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo') + interval '9 hours'),
  (7,'00000000-0000-4000-8000-000000000107', rpad('b7', 64, 'b7'), 9, 8000, 'CARD', true, 1, (date_trunc('day', now() AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo') - interval '6 days' + interval '10 hours');
-- مرتجع كامل للفاتورة 6 + رد النقد
INSERT INTO commerce_returns (id, request_id, request_hash, sale_id, is_cancellation, created_by_id, created_at) VALUES
  (10,'00000000-0000-4000-8000-000000000201', rpad('c1', 64, 'c1'), 6, false, 1, (date_trunc('day', now() AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo') - interval '1 day' + interval '12 hours');
INSERT INTO commerce_return_lines (id, return_id, sale_line_id, quantity, total, tax_amount) VALUES
  (10, 10, 7, 1, 22000, 0);
INSERT INTO commerce_refunds (id, request_id, request_hash, sale_id, amount, method, created_by_id, created_at) VALUES
  (10,'00000000-0000-4000-8000-000000000301', rpad('d1', 64, 'd1'), 6, 22000, 'CASH', 1, (date_trunc('day', now() AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo') - interval '1 day' + interval '12 hours');
-- مصروفات
INSERT INTO expenses (id, branch_id, category_id, amount, expense_date, status, requested_by, approved_by, created_at) VALUES
  (1, 1, 4, 250, CURRENT_DATE, 'APPROVED', 3, 1, (date_trunc('day', now() AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo') + interval '8 hours'),
  (2, 1, 3, 1200, CURRENT_DATE, 'PENDING', 3, NULL, (date_trunc('day', now() AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo') + interval '9 hours'),
  (3, 1, 2, 850, CURRENT_DATE - 1, 'PAID', 3, 1, now() - interval '1 day'),
  (4, 2, 7, 500, CURRENT_DATE - 2, 'PENDING', 3, NULL, now() - interval '2 days'),
  (5, 1, 6, 300, CURRENT_DATE - 6, 'PAID', 3, 1, now() - interval '6 days');
-- إعادة ضبط التسلسلات بعد المعرّفات الصريحة
SELECT setval(pg_get_serial_sequence('branches','id'), 100);
SELECT setval(pg_get_serial_sequence('warehouses','id'), 100);
SELECT setval(pg_get_serial_sequence('tax_rates','id'), 100);
SELECT setval(pg_get_serial_sequence('expense_categories','id'), 100);
SELECT setval(pg_get_serial_sequence('users','id'), 100);
SELECT setval(pg_get_serial_sequence('products','id'), 100);
SELECT setval(pg_get_serial_sequence('stock_levels','id'), 100);
SELECT setval(pg_get_serial_sequence('commerce_sales','id'), 100);
SELECT setval(pg_get_serial_sequence('commerce_sale_lines','id'), 100);
SELECT setval(pg_get_serial_sequence('commerce_collections','id'), 100);
SELECT setval(pg_get_serial_sequence('commerce_returns','id'), 100);
SELECT setval(pg_get_serial_sequence('commerce_return_lines','id'), 100);
SELECT setval(pg_get_serial_sequence('commerce_refunds','id'), 100);
SELECT setval(pg_get_serial_sequence('expenses','id'), 100);
