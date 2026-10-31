-- سقف خصم مستقل للمدير.
--
-- كان حدّ الخصم (staff_discount_bps) يسري على موظف الكاونتر وحده، فكان المحاسب
-- والمدير يمنحان أي خصم بلا حدّ. فأُضيف عمود مستقل للمدير يسري عليه، ويبقى
-- سقف الموظف على المحاسب وموظف الكاونتر.
--
-- يُطبَّق قبل نشر الكود الذي يقرأ العمود. والجدولان آمنان: commerce_settings
-- فيه صفٌّ واحد يُملأ بالقيمة الافتراضية، وcommerce_settings_changes سجلٌّ
-- تراكمي فلا يُعاد كتابة قديمه.

ALTER TABLE public.commerce_settings
  ADD COLUMN IF NOT EXISTS manager_discount_bps INTEGER NOT NULL DEFAULT 2500;

ALTER TABLE public.commerce_settings_changes
  ADD COLUMN IF NOT EXISTS manager_discount_bps INTEGER NOT NULL DEFAULT 2500;

-- تحقّق بعد التنفيذ: يجب أن يُرجع صفًّا واحدًا بقيمتين ضمن 0..10000.
-- SELECT staff_discount_bps, manager_discount_bps FROM public.commerce_settings WHERE id = 1;
