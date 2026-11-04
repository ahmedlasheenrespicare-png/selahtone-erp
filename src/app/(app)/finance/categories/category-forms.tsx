"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { AppIcon } from "@/components/app-icon";
import { createCategoryAction, editCategoryAction } from "../actions";
import type { FinanceActionState } from "../finance-state";

export type CategoryOption = {
  id: string;
  code: string;
  name: string;
  active: boolean;
  revision: number;
  snapshot: string;
};

const SUGGESTED_CATEGORIES = [
  "إيجار ومرافق الفرع",
  "كهرباء ومياه وإنترنت",
  "شحن وتوصيل طلبات",
  "صيانة وتشغيل الفرع",
  "مستلزمات عيادة وفحص سمع",
  "قرطاسية ومطبوعات فواتير",
  "انتقالات ومأموريات",
  "ضيافة ونظافة الفرع",
];

const QUICK_EDIT_REASONS = [
  "توحيد مسميات دليل البنود المحاسبية",
  "تصحيح إملائي في اسم البند",
  "إيقاف بند لم يعد مستخدمًا في التشغيل",
  "إعادة تفعيل البند لتسجيل مصروفات جديدة",
];

function makeUuidFallback(seed: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return seed;
}

export function CreateCategoryForm({
  requestId: initialRequestId,
  existingNames = [],
}: {
  requestId: string;
  existingNames?: string[];
}) {
  const router = useRouter();
  const [reqId, setReqId] = useState(initialRequestId);
  const [name, setName] = useState("");
  const [feedback, setFeedback] = useState<FinanceActionState>({ status: "idle" });
  const [isPending, startTransition] = useTransition();

  const normalizedExisting = useMemo(
    () => new Set(existingNames.map((n) => n.trim().toLowerCase())),
    [existingNames],
  );

  const trimmedName = name.trim();
  const isDuplicate =
    trimmedName.length > 0 && normalizedExisting.has(trimmedName.toLowerCase());

  const availableSuggestions = useMemo(
    () =>
      SUGGESTED_CATEGORIES.filter(
        (item) => !normalizedExisting.has(item.trim().toLowerCase()),
      ).slice(0, 6),
    [normalizedExisting],
  );

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!trimmedName || isDuplicate || isPending) return;

    const fd = new FormData();
    fd.set("requestId", reqId);
    fd.set("name", trimmedName);

    startTransition(async () => {
      const result = await createCategoryAction({ status: "idle" }, fd);
      setFeedback(result);
      if (result.status === "success") {
        setName("");
        setReqId(makeUuidFallback(initialRequestId));
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="fin-form-stack">
      <div className="fin-cat-create-row">
        <label className="field fin-field fin-cat-create-row__input">
          <span className="fin-field__label">اسم البند المحاسبي الجديد</span>
          <input
            name="name"
            value={name}
            maxLength={120}
            placeholder="مثال: شحن وتوصيل طلبات، صيانة أجهزة الفحص…"
            onChange={(event) => {
              setName(event.target.value);
              if (feedback.status !== "idle") setFeedback({ status: "idle" });
            }}
            required
          />
          <span className="fin-field__hint">
            الاسم فريد، والرمز المحاسبي يُولَّد تلقائيًا ولا يُعاد استخدامه، ويمكنك إضافة عدة بنود متتالية مباشرةً.
          </span>
        </label>

        <div className="fin-cat-create-row__submit">
          <button
            type="submit"
            className="fin-button"
            disabled={isPending || trimmedName.length === 0 || isDuplicate}
          >
            <AppIcon name="plusCircle" />
            <span>{isPending ? "جارٍ الإضافة…" : "إضافة البند"}</span>
          </button>
        </div>
      </div>

      {availableSuggestions.length > 0 ? (
        <div className="fin-cat-suggestions" aria-label="مقترحات سريعة لبنود شائعة">
          <span className="fin-cat-suggestions__label">مقترحات سريعة:</span>
          {availableSuggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className="sale-fill-btn"
              onClick={() => {
                setName(suggestion);
                if (feedback.status !== "idle") setFeedback({ status: "idle" });
              }}
            >
              + {suggestion}
            </button>
          ))}
        </div>
      ) : null}

      {isDuplicate ? (
        <div className="fin-alert fin-alert--warning" role="alert">
          يوجد بند مسجّل بالفعل باسم «{trimmedName}». اختر اسمًا مختلفًا أو عدّل البند القائم من الجدول أدناه.
        </div>
      ) : null}

      {feedback.status === "error" ? (
        <div className="fin-alert fin-alert--error" role="alert">
          {feedback.message}
        </div>
      ) : null}

      {feedback.status === "success" ? (
        <div className="fin-alert fin-alert--success" role="status">
          {feedback.message} — يمكنك كتابة بند آخر وإضافته فورًا.
        </div>
      ) : null}
    </form>
  );
}

export function EditCategoryForm({
  requestId: initialRequestId,
  category,
  existingNames = [],
  onCancel,
  onSaved,
}: {
  requestId: string;
  category: CategoryOption;
  existingNames?: string[];
  onCancel?: () => void;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const [reqId, setReqId] = useState(initialRequestId);
  const [name, setName] = useState(category.name);
  const [active, setActive] = useState(category.active);
  const [reason, setReason] = useState("");
  const [feedback, setFeedback] = useState<FinanceActionState>({ status: "idle" });
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setName(category.name);
    setActive(category.active);
  }, [category.id, category.name, category.active, category.snapshot]);

  const trimmedName = name.trim();
  const nameChanged = trimmedName !== category.name;
  const statusChanged = active !== category.active;
  const changed = (nameChanged || statusChanged) && trimmedName.length > 0;

  const isDuplicateOther = useMemo(() => {
    if (!nameChanged || !trimmedName) return false;
    const lower = trimmedName.toLowerCase();
    return existingNames.some(
      (n) =>
        n.trim().toLowerCase() === lower &&
        n.trim().toLowerCase() !== category.name.trim().toLowerCase(),
    );
  }, [existingNames, nameChanged, trimmedName, category.name]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!changed || isDuplicateOther || reason.trim().length === 0 || isPending) return;

    const fd = new FormData();
    fd.set("requestId", reqId);
    fd.set("categoryId", category.id);
    fd.set("expectedSnapshot", category.snapshot);
    fd.set("name", trimmedName);
    fd.set("active", active ? "yes" : "no");
    fd.set("reason", reason.trim());

    startTransition(async () => {
      const result = await editCategoryAction({ status: "idle" }, fd);
      setFeedback(result);
      if (result.status === "success") {
        setReason("");
        setReqId(makeUuidFallback(initialRequestId));
        router.refresh();
        if (onSaved) onSaved();
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="fin-cat-edit-drawer">
      <div className="fin-cat-edit-drawer__head">
        <div>
          <strong>تحرير البند: {category.name}</strong>
          <span className="fin-cat-edit-drawer__meta">
            الإصدار الحالي #{category.revision} ← سيُحفظ كإصدار #{category.revision + 1} مع توثيق السبب والمنفِّذ
          </span>
        </div>
        {onCancel ? (
          <button
            type="button"
            className="fin-button fin-button--secondary"
            onClick={onCancel}
          >
            <AppIcon name="close" />
            <span>إغلاق</span>
          </button>
        ) : null}
      </div>

      <div className="fin-fields">
        <label className="field fin-field">
          <span className="fin-field__label">اسم البند</span>
          <input
            value={name}
            maxLength={120}
            onChange={(event) => {
              setName(event.target.value);
              if (feedback.status !== "idle") setFeedback({ status: "idle" });
            }}
            required
          />
          <span className="fin-field__hint">
            المصروفات المسجّلة سابقًا تحتفظ بلقطة الاسم القديم وقت تسجيلها.
          </span>
        </label>

        <label className="field fin-field">
          <span className="fin-field__label">حالة البند للتشغيل الجديد</span>
          <select
            value={active ? "yes" : "no"}
            onChange={(event) => {
              setActive(event.target.value === "yes");
              if (feedback.status !== "idle") setFeedback({ status: "idle" });
            }}
          >
            <option value="yes">نشط — متاح لتسجيل مصروفات جديدة</option>
            <option value="no">موقوف — يمنع المصروفات الجديدة فقط</option>
          </select>
          <span className="fin-field__hint">
            الإيقاف لا يحذف البند ولا يمسّ أي مصروف أو تقرير سابق.
          </span>
        </label>

        <div className="field fin-field fin-field--wide">
          <div className="sale-field-head">
            <label htmlFor={`cat-reason-${category.id}`} className="fin-field__label">
              سبب التعديل (إلزامي لسجل التدقيق)
            </label>
            <div className="fin-quick-amounts">
              {QUICK_EDIT_REASONS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className="sale-fill-btn"
                  onClick={() => setReason(preset)}
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>
          <input
            id={`cat-reason-${category.id}`}
            name="reason"
            value={reason}
            maxLength={300}
            placeholder="اذكر سبب تعديل الاسم أو تغيير حالة التفعيل…"
            onChange={(event) => setReason(event.target.value)}
            required
          />
        </div>
      </div>

      {changed ? (
        <div className="fin-cat-diff-preview" role="status">
          <span className="fin-cat-diff-preview__label">معاينة الأثر في سجل التدقيق:</span>
          {nameChanged ? (
            <span className="fin-cat-diff-preview__item">
              الاسم: <strong>«{category.name}»</strong> ← <strong>«{trimmedName}»</strong>
            </span>
          ) : null}
          {statusChanged ? (
            <span className="fin-cat-diff-preview__item">
              الحالة: <strong>{category.active ? "نشط" : "موقوف"}</strong> ←{" "}
              <strong>{active ? "نشط" : "موقوف"}</strong>
            </span>
          ) : null}
        </div>
      ) : null}

      {isDuplicateOther ? (
        <div className="fin-alert fin-alert--warning" role="alert">
          يوجد بند آخر بنفس الاسم «{trimmedName}»؛ اختر اسمًا غير مكرر.
        </div>
      ) : null}

      {feedback.status === "error" ? (
        <div className="fin-alert fin-alert--error" role="alert">
          {feedback.message}
        </div>
      ) : null}

      {feedback.status === "success" ? (
        <div className="fin-alert fin-alert--success" role="status">
          {feedback.message}
        </div>
      ) : null}

      <div className="fin-form-actions">
        <button
          type="submit"
          className="fin-button"
          disabled={
            isPending || !changed || isDuplicateOther || reason.trim().length === 0
          }
        >
          <AppIcon name="check" />
          <span>{isPending ? "جارٍ حفظ التعديل…" : "حفظ التعديل وتوثيق السبب"}</span>
        </button>
        {onCancel ? (
          <button
            type="button"
            className="fin-button fin-button--secondary"
            onClick={onCancel}
          >
            إلغاء
          </button>
        ) : null}
      </div>
    </form>
  );
}
