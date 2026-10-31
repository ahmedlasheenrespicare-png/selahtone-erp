-- هجرة إنتاج واجبة قبل نشر صلاحية إلغاء البيع.
-- الكود يقرأ users.can_cancel_sales، فلن يوجد قبل تشغيل هذا الملف.
-- القيمة الافتراضية true مقصودة: المحاسب يملك الصلاحية بمجرد النشر،
-- والمدير يسحبها من شاشة الإدارة متى شاء. والتعبير IF NOT EXISTS يجعل
-- إعادة التشغيل آمنة.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS can_cancel_sales BOOLEAN NOT NULL DEFAULT true;
