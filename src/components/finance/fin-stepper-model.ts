/**
 * نموذج عرض نقي لشريط الحالة. لا يقرأ قاعدة بيانات ولا يغيّر رصيدًا أو صلاحية.
 * كل دالة تصف ما هو مسجّل فعلًا؛ التسجيل أو الإقرار لا يثبتان انتقال النقد ماديًا.
 */

export type FinStepStatus = "done" | "current" | "pending" | "blocked" | "stopped" | "skipped";

export type FinStep = {
  key: string;
  title: string;
  description?: string;
  status: FinStepStatus;
};

export const FIN_STEP_STATUS_LABEL: Record<FinStepStatus, string> = {
  done: "مكتملة",
  current: "الخطوة الحالية",
  pending: "بانتظار دورها",
  blocked: "متوقفة للمراجعة",
  stopped: "منتهية دون إتمام",
  skipped: "لا تنطبق",
};

export type InvoiceLifecycleInput = {
  cancelled: boolean;
  hasReturns: boolean;
  allReturned: boolean;
  netCollectedCents: bigint;
  refundedCents: bigint;
  dueFromCustomerCents: bigint;
  dueToCustomerCents: bigint;
};

/**
 * الفاتورة ليست خط اعتماد واحدًا: التحصيل والمرتجع ورد المال أرصدة مستقلة.
 * لذلك لا نضع «تم الرد» لمجرد عدم وجود مرتجع، ولا نلون الإلغاء أخضر.
 */
export function invoiceLifecycleSteps(input: InvoiceLifecycleInput): FinStep[] {
  const openBalance = input.dueFromCustomerCents > 0n || input.dueToCustomerCents > 0n;
  const collectionStatus: FinStepStatus = input.cancelled
    ? "stopped"
    : input.dueFromCustomerCents > 0n
      ? "current"
      : input.netCollectedCents > 0n
        ? "done"
        : "skipped";
  const refundStatus: FinStepStatus = input.dueToCustomerCents > 0n
    ? "current"
    : input.hasReturns || input.refundedCents > 0n
      ? "done"
      : "skipped";

  return [
    {
      key: "registered",
      title: "تسجيل الفاتورة",
      description: input.cancelled ? "سُجلت ثم أُلغيت في السجل" : "الفاتورة وبنودها مسجّلة",
      status: "done",
    },
    {
      key: "collection",
      title: "تحصيل قيمة الفاتورة",
      description: input.cancelled
        ? "أُلغيت الفاتورة؛ لا تحصيل جديد"
        : input.dueFromCustomerCents > 0n
          ? "ما زال على العميل متبقٍ"
          : input.netCollectedCents > 0n
            ? "اكتمل تحصيل صافي الفاتورة المسجّل"
            : "لا قيمة تحصيل مستحقة بعد المرتجع",
      status: collectionStatus,
    },
    {
      key: "returns-refunds",
      title: "المرتجعات ورد المال",
      description: input.dueToCustomerCents > 0n
        ? "يوجد مستحق للعميل بانتظار تسجيل الرد"
        : input.hasReturns || input.refundedCents > 0n
          ? input.allReturned
            ? "اكتمل المرتجع ولا مستحق رد متبقٍ"
            : "سُجل المرتجع/الرد ولا مستحق رد متبقٍ"
          : "لا مرتجع أو رد مال مسجّل",
      status: refundStatus,
    },
    {
      key: "balance",
      title: "الرصيد النهائي",
      description: openBalance
        ? "حساب العميل مفتوح حتى تسوية المتبقي"
        : input.cancelled
          ? "الفاتورة ملغاة ولا رصيد مفتوح"
          : "لا متبقي على العميل ولا مستحق له",
      status: openBalance ? "pending" : input.cancelled ? "stopped" : "done",
    },
  ];
}

export type SettlementLifecycleStatus = "OPEN" | "CONFIRMED" | "REJECTED" | "CANCELLED";

export type SettlementLifecycleInput = {
  status: SettlementLifecycleStatus | string;
  reviewing?: boolean;
  /** منع الاعتماد المعروض بالفعل في الصفحة (صلاحية أو حارس فترة/حساب). لا يقرر المنع هنا. */
  blocked?: boolean;
  transferAmount?: string | null;
  resolutionReason?: string | null;
};

/** دورة طلب تسوية محفوظ: الجرد والطلب ثم قرار الإدارة ثم التوثيق المسجل. */
export function settlementLifecycleSteps(input: SettlementLifecycleInput): FinStep[] {
  const reason = input.resolutionReason?.trim();
  if (input.status === "CONFIRMED") {
    const amount = Number(input.transferAmount);
    const transfer = Number.isFinite(amount) && amount > 0
      ? `سُجل تحويل ${input.transferAmount}؛ لا يثبت ذلك الانتقال المادي`
      : "اعتُمدت بلا مبلغ تحويل مسجّل";
    return [
      { key: "count", title: "الجرد والطلب", description: "المعدود وسبب الطلب محفوظان", status: "done" },
      { key: "decision", title: "قرار الإدارة", description: reason ? `اعتُمدت: ${reason}` : "اعتُمدت التسوية", status: "done" },
      { key: "record", title: "التوثيق والأثر المسجل", description: transfer, status: "done" },
    ];
  }
  if (input.status === "REJECTED" || input.status === "CANCELLED") {
    const rejected = input.status === "REJECTED";
    return [
      { key: "count", title: "الجرد والطلب", description: "الطلب الأصلي محفوظ في السجل", status: "done" },
      {
        key: "decision",
        title: "قرار الإدارة",
        description: `${rejected ? "رُفض" : "أُلغي"} الطلب${reason ? `: ${reason}` : " بسبب مسجّل"}`,
        status: "stopped",
      },
      { key: "record", title: "التوثيق والأثر المسجل", description: "بلا أثر مالي من هذا القرار", status: "skipped" },
    ];
  }
  if (input.status === "OPEN") {
    return [
      { key: "count", title: "الجرد والطلب", description: "المعدود وسبب الطلب محفوظان", status: "done" },
      {
        key: "decision",
        title: "مراجعة الإدارة",
        description: input.blocked
          ? "الاعتماد متوقف للمراجعة؛ راجع تنبيهات الفترة والحساب والصلاحيات أعلاه"
          : input.reviewing
            ? "راجع مبلغ التحويل والسبب قبل الحفظ"
            : "بانتظار قرار مسؤول مخوّل؛ لا اعتماد ذاتي",
        status: input.blocked ? "blocked" : "current",
      },
      { key: "record", title: "التوثيق والأثر المسجل", description: "لا يتغيّر الرصيد قبل الاعتماد", status: "pending" },
    ];
  }
  return [
    { key: "count", title: "الجرد والطلب", description: "راجع السجل الأصلي", status: "blocked" },
    { key: "decision", title: "قرار الإدارة", description: "حالة غير معروفة؛ لا نفترض اكتمالًا", status: "blocked" },
    { key: "record", title: "التوثيق والأثر المسجل", description: "يلزم فحص السجل", status: "pending" },
  ];
}

/** نموذج طلب التسوية قبل الحفظ وبعده؛ الإقرار لا يتحول إلى اعتماد تلقائي. */
export function settlementRequestSteps(input: {
  submitted: boolean;
  ready: boolean;
  reviewing: boolean;
  saving: boolean;
  hasError: boolean;
}): FinStep[] {
  if (input.submitted) {
    return [
      { key: "count", title: "عد النقد وإقراره", description: "تم تسجيل إقرار الجرد", status: "done" },
      { key: "review", title: "مراجعة الطلب", description: "رُوجعت بيانات الطلب", status: "done" },
      { key: "submit", title: "حفظ الطلب", description: "الطلب محفوظ ولا يغيّر الرصيد", status: "done" },
      { key: "decision", title: "قرار الإدارة", description: "بانتظار المراجعة والاعتماد", status: "current" },
    ];
  }
  return [
    {
      key: "count",
      title: "عد النقد وإقراره",
      description: input.reviewing || input.ready || input.saving ? "المعدود والسبب جاهزان للمراجعة" : "أدخل كل ما عددته وسبب التسوية",
      status: input.reviewing || input.ready || input.saving ? "done" : "current",
    },
    {
      key: "review",
      title: "مراجعة الطلب",
      description: input.hasError ? "أعد المراجعة بعد تنبيه الخادم" : input.saving ? "سُجل إقرار الجرد الفعلي" : input.reviewing ? "أقر بالجرد الفعلي قبل الإرسال" : input.ready ? "اضغط مراجعة الطلب بعد التحقق من المعدود والسبب" : "تظهر بعد إكمال المعدود والسبب",
      status: input.saving ? "done" : input.reviewing || input.ready ? "current" : "pending",
    },
    {
      key: "submit",
      title: "حفظ الطلب",
      description: input.saving ? "جارٍ حفظ الطلب" : "لا يغيّر الرصيد قبل الاعتماد",
      status: input.saving ? "current" : "pending",
    },
    { key: "decision", title: "قرار الإدارة", description: "بانتظار مسؤول مخوّل", status: "pending" },
  ];
}

/** مراحل سند التسليم المباشر؛ لا توجد مرحلة اعتماد وهمية بعد الحفظ. */
export function transferLifecycleSteps(input: {
  saved: boolean;
  reviewing: boolean;
  saving: boolean;
  ready: boolean;
  hasError: boolean;
}): FinStep[] {
  const afterEdit = input.saved || input.saving || input.reviewing || input.ready;
  return [
    {
      key: "parties",
      title: "المصدر والوجهة والمبلغ",
      description: input.saved ? "بيانات التسليم محفوظة" : input.ready ? "الحسابان والمبلغ جاهزون للمراجعة" : "حدّد طرفي الحركة والمبلغ المسلَّم",
      status: afterEdit ? "done" : "current",
    },
    {
      key: "review",
      title: "المراجعة والإقرار",
      description: input.hasError ? "أعد المراجعة بعد تنبيه الخادم" : input.saved || input.saving ? "سُجل إقرار التسليم والاستلام" : input.reviewing ? "أقر بالتسليم الفعلي قبل الحفظ" : input.ready ? "اضغط مراجعة سند التسليم بعد التحقق من الطرفين والمبلغ" : "تظهر بعد اكتمال بيانات السند",
      status: input.saved || input.saving ? "done" : input.reviewing || input.ready ? "current" : "pending",
    },
    {
      key: "record",
      title: "تسجيل الحركة",
      description: input.saved ? "الحركة مسجّلة في السجل" : input.saving ? "جارٍ الحفظ والتحقق من الرصيد" : "لا تُخصم أو تُضاف أرصدة قبل الحفظ",
      status: input.saved ? "done" : input.saving ? "current" : "pending",
    },
    {
      key: "voucher",
      title: "سند التسليم",
      description: input.saved ? "السند جاهز للطباعة والتوقيع خارج النظام" : "يصدر بعد نجاح الحفظ",
      status: input.saved ? "done" : "pending",
    },
  ];
}
