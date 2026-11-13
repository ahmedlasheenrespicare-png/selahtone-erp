import type { DataColumn } from "@/components/data-driven/data-table";

export type FinancePillarRow = { id: string; pillar: string; location?: string; route?: string; locationSuffix?: string; actor: string; meaning: string };
export const financePillarRows: FinancePillarRow[] = [
  { id: "custody", pillar: "العهدة", location: "«عهدتي النقدية» / «الحسابات»", actor: "الإدارة تفتح، الموظف يستخدم", meaning: "مبلغ فعلي يسلّمه المدير أو المحاسب للموظف يدًا بيد لتغطية مصروفات الفرع" },
  { id: "counts", pillar: "الجرد", route: "/finance/counts", locationSuffix: " (للإدارة)", actor: "الإدارة تسجّل وتعتمد/تلغي", meaning: "عدّ فعلي ومطابقته للدفتري؛ تسجيل الجرد ملاحظة فقط ولا يغيّر الرصيد" },
  { id: "transfers", pillar: "تسليم النقد", route: "/finance/transfers", locationSuffix: " + «طباعة سند»", actor: "الإدارة تسلّم وتعتمد، بتوقيع الطرفين", meaning: "أي انتقال للنقد (افتتاح عهدة، توريد خزنة…) يُنتج سند استلام وتسليم نقدي مطبوع" },
];
export const financePillarColumns: DataColumn<FinancePillarRow>[] = [
  { id: "pillar", header: "الركن", renderCell: (row) => row.pillar },
  { id: "location", header: "أين تجده؟", renderCell: (row) => row.route ? <><bdi dir="ltr">{row.route}</bdi>{row.locationSuffix}</> : row.location },
  { id: "actor", header: "من ينفّذ؟", renderCell: (row) => row.actor },
  { id: "meaning", header: "ماذا يعني في سطر", renderCell: (row) => row.meaning },
];

export type FinanceAccessHelpRow = { id: string; screen: string; management: string; counter?: string; spansRoles?: boolean };
export const financeAccessHelpRows: FinanceAccessHelpRow[] = [
  { id: "accounts", screen: "«الحسابات النقدية» (جدار المالية)", management: "الكل حسب الدور", counter: "أزراره فقط" },
  { id: "expenses", screen: "«مصروفاتي» / «سجل المصروفات»", management: "سجل كامل + اعتماد وصرف", counter: "مسوّدات طلباته وحالتها فقط" },
  { id: "mine", screen: "«عهدتي النقدية» (كشف العهدة)", management: "✓", counter: "✓" },
  { id: "settlements", screen: "«طلبات التسوية» (/finance/settlements)", management: "تُحوّل تلقائيًا إلى «التسليم»", counter: "✓ (طلب مفتوح واحد لكل عهدة)" },
  { id: "counts", screen: "«جرد النقد وتسوية الفرق»", management: "✓", counter: "لا — تظهر رسالة «الجرد وتأكيد التسوية متاحان للمدير والمحاسب فقط.»" },
  { id: "transfers", screen: "«تسليم وتحويل النقد» + السجل وسنداته", management: "✓", counter: "لا" },
  { id: "reports", screen: "«التقارير» (اليوم/الأسبوع/الشهر)", management: "✓", counter: "لا" },
  { id: "limited", screen: "نطاق «مختصر» لبعض الحسابات الإدارية", management: "يصلون إلى لوحة القيادة + المبيعات + المصروفات والدليل فقط — أي شاشة أخرى تحوّلهم إلى لوحة القيادة", spansRoles: true },
];
export const financeAccessHelpColumns: DataColumn<FinanceAccessHelpRow>[] = [
  { id: "screen", header: "الشاشة", renderCell: (row) => row.screen },
  { id: "management", header: "المدير/المحاسب", renderCell: (row) => row.management, cellColSpan: (row) => row.spansRoles ? 2 : undefined },
  { id: "counter", header: "الكاونتر (CS_AGENT)", renderCell: (row) => row.counter, cellHidden: (row) => !!row.spansRoles },
];

export type FinanceErrorHelpRow = { id: string; visible: string; cause: string; action: string };
export const financeErrorHelpRows: FinanceErrorHelpRow[] = [
  { id: "deviation", visible: "فرق كبير عن مؤشر الفترة", cause: "سجلات ناقصة أو إسناد مختلف أو عدّ غير مكتمل", action: "لا تعتمد أولًا — راجع السجلات والنقد فعلًا مع المسؤول؛ لا يثبت تسجيل البيع وحده المؤشر، وألغِ الطلب وأعده بعد المراجعة" },
  { id: "vault", visible: "رسالة عن عدم وجود خزنة مفتوحة للفرع", cause: "حسابات الفرع المتعطلة أو الموقوفة", action: "فعّل/أنشئ خزنة الفرع من «الحسابات» ثم أعد المحاولة" },
  { id: "open", visible: "«لديك طلب تسوية مفتوح»", cause: "طلب سابق لم يُعتمد أو يُلغَ", action: "ألغِه بسبب واضح أو انتظر قرار الإدارة؛ طلب واحد فقط لكل عهدة" },
  { id: "stale", visible: "الجرد لا يتأكد («تتطلّب اعتمادًا…»)", cause: "تغيّر نسخة العهدة أو مصدر نقدي مسجّل بعد الجرد أو فترة ملتبسة", action: "ألغِ الطلب بسبب، راجع الحالة مع المسؤول، ثم أعد الجرد بحضور الطرفين بوثيقة سبب واضحة" },
  { id: "repeat", visible: "فرق جرد يتكرر لفرع بعينه", cause: "تقدير خاطئ / تعجّل / شبهة", action: "«جرد موجَّه» بشهادة صاحب اليد + قرار موثّق؛ لا تسوية صامتة" },
  { id: "blocked", visible: "نظام يرفض التسوية كلها", cause: "ترقية قاعدة البيانات لم تُطبّق، أو صلاحية أو حالة تمنع العملية", action: "أبلغ مسؤول النظام؛ لا تُطبّق ترقية أو تُفعّل المالية قبل المراجعة والموافقة المنفصلة وخطة انتقال آمنة" },
  { id: "empty", visible: "«لا مصروفات في هذه الفترة» / «لا يوجد جرد مُسوًى بعد»", cause: "فترة جديدة بلا حركات", action: "سلوك طبيعي — ليست مشكلة" },
  { id: "print", visible: "نافذة الطباعة لا تُظهر السند", cause: "المنع/طابعة غير معرّفة", action: "اسمح بالمنبثقة وأعد الضغط على «طباعة سند»" },
];
export const financeErrorHelpColumns: DataColumn<FinanceErrorHelpRow>[] = [
  { id: "visible", header: "ما تراه", renderCell: (row) => row.visible },
  { id: "cause", header: "السبب المعتاد", renderCell: (row) => row.cause },
  { id: "action", header: "التصرف", renderCell: (row) => row.action },
];
