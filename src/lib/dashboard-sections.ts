import type { AppIconName } from "@/components/app-icon";

export const DASHBOARD_SECTION_IDS = [
  "pulse-wallet",
  "all",
  "pulse",
  "pace",
  "governance",
  "wallet",
  "efficiency",
  "monthly-sales",
  "collections",
  "cash-conversion",
  "cash-balance",
  "monthly-expenses",
  "profitability",
  "branch-efficiency",
  "aging-radar",
  "live-feed",
  "branch-health",
] as const;

export type DashboardSectionId = (typeof DASHBOARD_SECTION_IDS)[number];
export type DashboardSectionGroupKey = "modes" | "daily" | "spotlights" | "operations";

export const DASHBOARD_GROUP_LABELS: Record<DashboardSectionGroupKey, string> = {
  modes: "أوضاع العرض السريعة",
  daily: "١. المتابعة اليومية والرقابة",
  spotlights: "٢. المؤشرات والرسوم البيانية (كل مؤشر على حدة)",
  operations: "٣. التحصيل والعمليات الحية والفروع",
};

export type DashboardSectionStageKind = "full" | "pulse-wallet" | "wide" | "card";

export type DashboardSectionMeta = {
  id: DashboardSectionId;
  group: DashboardSectionGroupKey;
  label: string;
  description: string;
  icon: AppIconName;
  stageKind: DashboardSectionStageKind;
  badgeCount?: number;
  badgeTone?: "alert" | "neutral";
};

export type DashboardVisibilityToggle = {
  key: string;
  label: string;
  explanation: string;
};

export type DashboardSectionGuide = {
  summary: string;
  howToRead: string;
  whenToAct: string;
  toggles: readonly DashboardVisibilityToggle[];
};

const toggle = (key: string, label: string, explanation: string): DashboardVisibilityToggle => ({
  key,
  label,
  explanation,
});

const spotlightToggles = [
  toggle("metric-pair", "ملخص الأرقام", "القيم الرئيسية للمؤشر والفترة التي تقيسها."),
  toggle("view-tabs", "أزرار تغيير طريقة العرض", "التبديل بين طرق عرض الرسم المتاحة."),
  toggle("live-hud", "لوحة التفاعل الحي", "ملخص تفاعلي مرتبط بالنقطة أو الفترة المحددة."),
  toggle("visual-chart", "الرسم البياني", "الاتجاه المرئي للقيم عبر الزمن أو الفئات."),
  toggle("action-footer", "روابط وإجراءات المؤشر", "الانتقال إلى الصفحة المرتبطة بالمؤشر."),
] as const;

const pulseToggles = [
  toggle("pulse-sales", "صافي مبيعات اليوم", "قيمة المبيعات الصافية المسجلة اليوم، مع مقارنة موجزة بالأمس."),
  toggle("pulse-collections", "تحصيلات اليوم", "المبالغ المحصلة فعليًا اليوم بحسب وسيلة التحصيل."),
  toggle("pulse-tasks", "المهام العاجلة", "المعاملات أو المهام التي تنتظر تنفيذًا أو قرارًا."),
  toggle("pulse-stock", "المخزون والنواقص", "حالة قيمة المخزون والأصناف منخفضة الرصيد أو النافدة."),
  toggle("pulse-comparison", "التفاصيل المقارنة أسفل البطاقات", "السطر الإضافي الذي يوضح المقارنة أو التفصيل لكل بطاقة."),
] as const;

const guides: Record<DashboardSectionId, DashboardSectionGuide> = {
  "pulse-wallet": {
    summary: "نظرة مركّزة تجمع نبض اليوم، وتيرة الشهر، الرقابة، والحافظة المالية المتاحة لدورك.",
    howToRead: "ابدأ بمؤشرات اليوم، ثم راجع وتيرة الشهر والتنبيهات، واستخدم الحافظة لعرض البطاقات المالية والتنقل بينها.",
    whenToAct: "تابع المهام والتنبيهات أولًا، ثم راجع أي تراجع في المبيعات أو اختلاف في الأرصدة.",
    toggles: [toggle("part-pulse", "نبض اليوم", "بطاقات المبيعات والتحصيل والمهام والمخزون."), toggle("part-pace", "وتيرة الشهر", "تقدم الشهر ومتوسط البيع وتوقع الإغلاق."), toggle("part-governance", "الرقابة المالية", "حالة الضوابط والتنبيهات ذات الصلة."), toggle("part-wallet", "الحافظة المالية", "بطاقات الأرصدة والعهد المتاحة."), toggle("part-focus-hint", "تلميح الوضع المركّز", "إرشاد مختصر للانتقال إلى الأقسام الأخرى."), ...pulseToggles, toggle("pace-progress", "شريط تقدم الشهر", "نسبة الأيام المنقضية من الشهر."), toggle("pace-average", "متوسط البيع اليومي", "متوسط قيمة المبيعات لكل يوم منقضٍ."), toggle("pace-projection", "الإغلاق المتوقع", "تقدير نتيجة الشهر إذا استمرت الوتيرة الحالية."), toggle("pace-comparison", "مقارنة الشهر الماضي", "مقارنة بالفترة نفسها من الشهر السابق."), toggle("governance-summary", "ملخص حالة الرقابة", "حالة الضوابط العامة."), toggle("governance-alerts", "تفاصيل التنبيهات", "الحالات التي تتطلب مراجعة."), toggle("wallet-cards", "بطاقات الأرصدة والعهد", "تفاصيل العهدة والرصيد المتوقع."), toggle("wallet-pocket", "ملخص الجيب", "إجمالي مختصر مخفي حتى الضغط عليه."), toggle("wallet-controls", "التنقل بين البطاقات", "الأسهم والنقاط لتصفح الحافظة."), toggle("wallet-hint", "تلميح الحافظة", "تعليمات إظهار الأرقام.")],
  },
  all: {
    summary: "يعرض جميع الأقسام المتاحة لك في صفحة واحدة بدل التركيز على قسم منفرد.",
    howToRead: "مرّر الصفحة لمراجعة مؤشرات اليوم والشهر والرقابة والرسوم، ثم التحصيل والعمليات والفروع.",
    whenToAct: "استخدمه للمراجعة الشاملة؛ أخفِ الأقسام التي لا تحتاجها لتقليل ازدحام الصفحة.",
    toggles: [toggle("all-pulse", "نبض اليوم", "ملخص المبيعات والتحصيل والمهام والمخزون."), toggle("all-pace", "وتيرة الشهر", "تقدم الشهر والتوقعات والمقارنة."), toggle("all-governance", "الرقابة المالية", "حالة الضوابط والتنبيهات."), toggle("all-wallet", "الحافظة المالية", "بطاقات الأرصدة والعهد."), toggle("all-spotlights", "المؤشرات والرسوم", "بطاقات مؤشرات الأداء والرسوم البيانية."), toggle("all-aging", "رادار التحصيل", "أعمار الذمم وأولويات المتابعة."), toggle("all-activity", "آخر العمليات", "أحدث الحركات المالية والتجارية."), toggle("all-branches", "صحة الفروع والمخزون", "مقارنة الفروع وتنبيهات المخزون.")],
  },
  pulse: { summary: "ملخص تنفيذي لحركة اليوم يشمل المبيعات والتحصيل والمهام والمخزون.", howToRead: "اقرأ القيمة الأساسية، ثم السطر الإضافي للمقارنة أو التفاصيل.", whenToAct: "راجع انخفاض المبيعات أو التحصيل، والمهام المتراكمة، وأي صنف نافد أو منخفض.", toggles: pulseToggles },
  pace: { summary: "يقيس وتيرة أداء الشهر ويقدّر نتيجة الإغلاق اعتمادًا على الأيام المنقضية.", howToRead: "قارن تقدم الأيام بمتوسط البيع والتوقع، ثم قارن الأداء بالفترة المطابقة من الشهر الماضي.", whenToAct: "إذا كان التوقع أو الوتيرة أقل من المعتاد، راجع الفروع أو أسباب التباطؤ مبكرًا.", toggles: [toggle("pace-progress", "شريط تقدم الشهر", "عدد الأيام المنقضية ونسبتها من الشهر."), toggle("pace-average", "متوسط البيع اليومي", "المبيعات مقسومة على أيام الفترة المنقضية."), toggle("pace-projection", "الإغلاق المتوقع", "تقدير تقريبي إذا استمرت الوتيرة الحالية حتى نهاية الشهر."), toggle("pace-comparison", "مقارنة الشهر الماضي", "مقارنة الأداء حتى اليوم بالفترة نفسها من الشهر السابق.")] },
  governance: { summary: "يعرض سلامة الضوابط المالية وحالات الخصم والإلغاء والمرتجعات وفروقات الجرد المتاحة لدورك.", howToRead: "الحالة السليمة تعني عدم رصد تنبيه؛ أما التنبيه فيعرض وصفًا ورابطًا للمراجعة عند توفر الصلاحية.", whenToAct: "راجع التنبيهات في أقرب وقت، ووثّق قرار المعالجة وفق إجراءات المنشأة.", toggles: [toggle("governance-summary", "ملخص حالة الرقابة", "عنوان وحالة الضوابط العامة."), toggle("governance-alerts", "تفاصيل التنبيهات", "قائمة الحالات التي تتطلب مراجعة.")] },
  wallet: { summary: "حافظة بطاقات مالية تعرض الأرصدة والعهد والتسويات وفق صلاحية المستخدم.", howToRead: "تنقل بين البطاقات بالأسهم أو النقاط، واضغط الجيب لإظهار أو إخفاء الأرقام الحساسة.", whenToAct: "قارن الرصيد المتوقع بالتسويات أو العهد، وتابع الفروقات قبل إقفال الفترة.", toggles: [toggle("wallet-cards", "بطاقات الأرصدة والعهد", "بطاقات تفاصيل العهدة أو الرصيد المتوقع."), toggle("wallet-pocket", "ملخص الجيب", "إجمالي مختصر مخفي حتى الضغط عليه."), toggle("wallet-controls", "التنقل بين البطاقات", "الأسهم والنقاط لتصفح بطاقات الحافظة."), toggle("wallet-hint", "تلميح الحافظة", "تعليمات إظهار الأرقام.")] },
  efficiency: { summary: "مؤشر كفاءة التشغيل؛ يلخص الأداء التشغيلي وفق المؤشر والفترة المحددين.", howToRead: "اقرأ القيم والاتجاه معًا، ولا تعتمد على الرسم وحده دون مراعاة نطاق البيانات.", whenToAct: "تحقق من سبب التغير الملحوظ ثم قارن الفروع أو الفترات ذات الصلة.", toggles: spotlightToggles },
  "monthly-sales": { summary: "يتابع المبيعات الشهرية واتجاهها عبر الفترات المتاحة.", howToRead: "القيم الرئيسية تلخص الأداء، والرسم يوضح تغيره، ويمكن تبديل طريقة العرض.", whenToAct: "تابع التراجع المستمر أو الفجوة عن الهدف، وتحقق من الفترة والفرع.", toggles: spotlightToggles },
  collections: { summary: "يوضح التحصيلات المسجلة واتجاه دخول الأموال.", howToRead: "اقرأ قيمة التحصيل مع التغير الزمني ونمط الدفع إن ظهر في الرسم.", whenToAct: "قارن التحصيل بالذمم المفتوحة، وتحقق من التأخير أو تغير مزيج وسائل الدفع.", toggles: spotlightToggles },
  "cash-conversion": { summary: "يتابع تحويل المبيعات والذمم إلى نقد محصل.", howToRead: "ارتفاع التحصيل نسبةً إلى المبيعات قد يشير إلى تحسن التدفق، مع مراعاة توقيت الفواتير.", whenToAct: "راجع الذمم عند اتساع الفجوة بين المبيعات والتحصيل.", toggles: spotlightToggles },
  "cash-balance": { summary: "يعرض صورة أرصدة النقد والحسابات ضمن النطاق المسموح.", howToRead: "ميّز بين الرصيد الحالي والحركة خلال الفترة، واقرأ وحدة العملة والفترة.", whenToAct: "تحقق من أي رصيد غير متوقع أو حركة لا تتوافق مع التسويات.", toggles: spotlightToggles },
  "monthly-expenses": { summary: "يتابع المصروفات الشهرية واتجاهها بحسب البيانات والصلاحيات المتاحة.", howToRead: "قارن إجمالي المصروفات بالفترات السابقة ولاحظ الفئات الأكثر مساهمة.", whenToAct: "راجع الزيادة غير المعتادة وتأكد من التصنيف والمستندات.", toggles: spotlightToggles },
  profitability: { summary: "مؤشر الربحية يوضح العلاقة بين الإيرادات والتكاليف وفق البيانات المعتمدة، وهو متاح للأدوار المخولة.", howToRead: "اقرأ المؤشر مع الفترة ونطاق الفروع؛ الربحية ليست مساوية لإجمالي المبيعات.", whenToAct: "تحقق من التغيرات الكبيرة في الهامش أو التكاليف قبل اتخاذ قرار.", toggles: spotlightToggles },
  "branch-efficiency": { summary: "يقارن كفاءة الفروع ويساعد على تحديد الفروع التي تستحق مراجعة أعمق.", howToRead: "استخدم الدرجة والاتجاه مع حجم النشاط؛ اختلاف الأحجام قد يؤثر في المقارنة.", whenToAct: "راجع العوامل التشغيلية عند ظهور فجوة كبيرة أو تغير متواصل.", toggles: spotlightToggles },
  "aging-radar": { summary: "يوزع الذمم المفتوحة حسب عمر الفاتورة ويبرز أولويات التحصيل.", howToRead: "كلما طال عمر الذمة زادت أولوية المتابعة؛ راجع قيمة المتبقي وعدد الفواتير.", whenToAct: "ابدأ بالفواتير الأقدم والأعلى قيمة، وسجل نتيجة التواصل والتحصيل.", toggles: [toggle("aging-buckets", "شرائح أعمار الذمم", "عدد وقيمة الفواتير في كل فئة عمرية."), toggle("aging-priority", "الفواتير ذات الأولوية", "تفاصيل العملاء والفواتير الأجدر بالمتابعة.")] },
  "live-feed": { summary: "سجل زمني لأحدث الفواتير والتحصيلات والمصروفات والتسويات ضمن صلاحيتك.", howToRead: "راجع نوع الحركة وحالتها ومبلغها وتوقيتها؛ افتح السجل المرتبط إذا كان متاحًا.", whenToAct: "تحقق من حركة غير متوقعة أو حالة تحتاج اعتمادًا أو متابعة.", toggles: [toggle("feed-heading", "عنوان السجل ورابطه", "تعريف السجل ورابط الانتقال للمبيعات."), toggle("feed-rows", "تفاصيل الحركات", "المبالغ والحالات والتوقيت لكل حركة.")] },
  "branch-health": { summary: "يجمع مؤشرات نشاط الفروع وتنبيهات الأرصدة المخزونية المنخفضة أو النافدة.", howToRead: "راجع التنبيهات أولًا، ثم قارن مبيعات اليوم والذمم وحالة مستودعات الفروع.", whenToAct: "تابع الأصناف النافدة وراجع الفروع ذات الذمم أو الأداء غير المعتاد.", toggles: [toggle("branch-stock-alerts", "تنبيهات المخزون", "الأصناف التي وصلت إلى رصيد منخفض أو صفر."), toggle("branch-cards", "بطاقات صحة الفروع", "مبيعات اليوم والذمم والمستودعات لكل فرع.")] },
};

export function getDashboardSectionGuide(id: DashboardSectionId): DashboardSectionGuide {
  return guides[id];
}

export function isValidDashboardSectionId(raw: string): raw is DashboardSectionId {
  return (DASHBOARD_SECTION_IDS as readonly string[]).includes(raw);
}

export function resolveDashboardSectionId(raw: string | null | undefined, availableIds: readonly DashboardSectionId[], fallback: DashboardSectionId = "pulse-wallet"): DashboardSectionId {
  if (availableIds.length === 0) return fallback;
  const cleaned = typeof raw === "string" ? raw.trim() : "";
  if (cleaned && isValidDashboardSectionId(cleaned) && availableIds.includes(cleaned)) return cleaned;
  if (availableIds.includes(fallback)) return fallback;
  return availableIds[0];
}

export function stepDashboardSection(currentId: DashboardSectionId, availableIds: readonly DashboardSectionId[], delta: -1 | 1): DashboardSectionId {
  if (availableIds.length === 0) return currentId;
  const currentIdx = availableIds.indexOf(currentId);
  if (currentIdx === -1) return availableIds[0];
  return availableIds[(currentIdx + delta + availableIds.length) % availableIds.length];
}

export function groupDashboardSections(items: readonly DashboardSectionMeta[]): Array<{ group: DashboardSectionGroupKey; title: string; items: DashboardSectionMeta[] }> {
  const order: DashboardSectionGroupKey[] = ["modes", "daily", "spotlights", "operations"];
  return order.flatMap((key) => {
    const groupItems = items.filter((item) => item.group === key);
    return groupItems.length ? [{ group: key, title: DASHBOARD_GROUP_LABELS[key], items: groupItems }] : [];
  });
}
