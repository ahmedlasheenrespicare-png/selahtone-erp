"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";

import { AppIcon } from "@/components/app-icon";
import {
  assignableRolesForActor,
  branchInputError,
  normalizeBranchCode,
  normalizeInvoicePrefix,
  ROLE_LABELS,
  userInputError,
  type AdminRole,
} from "@/lib/admin-directory";
import {
  createBranchAction,
  createUserAction,
  purgeInactiveSessionsAction,
  renameBranchAction,
  resetPasswordAction,
  revokeUserSessionsAction,
  setBranchActiveAction,
  updateUserAction,
} from "./actions";
import { initialAdminActionState, type AdminActionState } from "./admin-state";

export type BranchRow = {
  id: string;
  code: string;
  nameAr: string;
  city: string | null;
  phone: string | null;
  invoicePrefix: string;
  isActive: boolean;
  userCount: number;
  activeUserCount: number;
  warehouseCount: number;
  hasOpenVault: boolean;
  openCustodyCount: number;
};

export type UserRow = {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  role: AdminRole;
  branchId: string | null;
  branchName: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  isSelf: boolean;
  activeSessionCount: number;
  lastLoginLabel: string | null;
  openCustodyId: string | null;
};

export type BranchOption = { id: string; nameAr: string; code: string };

function generateStrongPassword(length = 16): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%&*";
  const all = upper + lower + digits + symbols;

  const randIndex = (max: number): number => {
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      const arr = new Uint32Array(1);
      crypto.getRandomValues(arr);
      return arr[0]! % max;
    }
    return Math.floor(Math.random() * max);
  };

  const chars: string[] = [
    upper[randIndex(upper.length)]!,
    lower[randIndex(lower.length)]!,
    digits[randIndex(digits.length)]!,
    symbols[randIndex(symbols.length)]!,
  ];
  while (chars.length < length) {
    chars.push(all[randIndex(all.length)]!);
  }
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randIndex(i + 1);
    const tmp = chars[i]!;
    chars[i] = chars[j]!;
    chars[j] = tmp;
  }
  return chars.join("");
}

function formatCredentialSlip(fullName: string, email: string, tempPassword: string): string {
  return [
    "بطاقة دخول مؤقتة — نظام صلة تون ERP",
    `الاسم: ${fullName}`,
    `البريد الإلكتروني: ${email}`,
    `كلمة المرور المؤقتة: ${tempPassword}`,
    "ملاحظة: سيُطلب تغيير كلمة المرور فور تسجيل الدخول الأول.",
  ].join("\n");
}

function StatusBanner({ state }: { state: AdminActionState }) {
  if (state.status === "error" && state.message) {
    return (
      <div className="alert alert-err" role="alert">
        {state.message}
      </div>
    );
  }
  if (state.status === "success" && state.message) {
    return (
      <div className="alert alert-ok" role="status">
        {state.message}
      </div>
    );
  }
  return null;
}

export function BranchCreateForm({
  existingCodes = [],
  existingPrefixes = [],
  onClose,
}: {
  existingCodes?: string[];
  existingPrefixes?: string[];
  onClose?: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<AdminActionState>(initialAdminActionState);

  const [code, setCode] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [city, setCity] = useState("");
  const [phone, setPhone] = useState("");
  const [invoicePrefix, setInvoicePrefix] = useState("");
  const [prefixTouched, setPrefixTouched] = useState(false);

  const normCode = normalizeBranchCode(code);
  const normPrefix = normalizeInvoicePrefix(invoicePrefix);

  const codeDuplicate = useMemo(
    () =>
      normCode.length > 0 &&
      existingCodes.some((c) => c.trim().toUpperCase() === normCode),
    [existingCodes, normCode],
  );

  const prefixDuplicate = useMemo(
    () =>
      normPrefix.length > 0 &&
      existingPrefixes.some((p) => p.trim().toUpperCase() === normPrefix),
    [existingPrefixes, normPrefix],
  );

  const validationErr = branchInputError({
    code,
    nameAr,
    city,
    phone,
    invoicePrefix,
  });

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isPending || validationErr || codeDuplicate || prefixDuplicate) return;

    const fd = new FormData();
    fd.set("code", code);
    fd.set("nameAr", nameAr);
    fd.set("city", city);
    fd.set("phone", phone);
    fd.set("invoicePrefix", invoicePrefix);

    startTransition(async () => {
      const res = await createBranchAction(initialAdminActionState, fd);
      setFeedback(res);
      if (res.status === "success") {
        setCode("");
        setNameAr("");
        setCity("");
        setPhone("");
        setInvoicePrefix("");
        setPrefixTouched(false);
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="admin-card-form" aria-busy={isPending}>
      <div className="admin-card-form__head">
        <div>
          <h3>إضافة فرع تشغيلي جديد</h3>
          <p>يُنشأ مع الفرع تلقائيًا مستودعه الرئيسي الافتراضي ({normCode || "CODE"}-W1).</p>
        </div>
        {onClose ? (
          <button type="button" className="admin-ghost-btn" onClick={onClose}>
            <AppIcon name="close" />
            <span>إغلاق</span>
          </button>
        ) : null}
      </div>

      <StatusBanner state={feedback} />

      <div className="admin-form-grid">
        <div className="field">
          <label htmlFor="branch-code">كود الفرع (إنجليزي)</label>
          <input
            id="branch-code"
            name="code"
            dir="ltr"
            required
            maxLength={8}
            placeholder="CAI"
            value={code}
            onChange={(event) => {
              const next = event.target.value.toUpperCase();
              setCode(next);
              if (!prefixTouched) {
                setInvoicePrefix(next.slice(0, 6));
              }
              if (feedback.status !== "idle") setFeedback(initialAdminActionState);
            }}
          />
          <p className="field-hint">حرفان إلى ٨ أحرف/أرقام مثل ARH أو SUEZ2.</p>
        </div>

        <div className="field">
          <label htmlFor="branch-prefix">بادئة الفواتير</label>
          <input
            id="branch-prefix"
            name="invoicePrefix"
            dir="ltr"
            required
            maxLength={6}
            placeholder="CAI"
            value={invoicePrefix}
            onChange={(event) => {
              setPrefixTouched(true);
              setInvoicePrefix(event.target.value.toUpperCase());
              if (feedback.status !== "idle") setFeedback(initialAdminActionState);
            }}
          />
          <p className="field-hint">تسبق أرقام فواتير المبيعات في هذا الفرع.</p>
        </div>

        <div className="field">
          <label htmlFor="branch-name">اسم الفرع بالعربية</label>
          <input
            id="branch-name"
            name="nameAr"
            required
            maxLength={120}
            placeholder="فرع العريش الرئيسي"
            value={nameAr}
            onChange={(event) => {
              setNameAr(event.target.value);
              if (feedback.status !== "idle") setFeedback(initialAdminActionState);
            }}
          />
        </div>

        <div className="field">
          <label htmlFor="branch-city">المدينة (اختياري)</label>
          <input
            id="branch-city"
            name="city"
            maxLength={80}
            placeholder="العريش"
            value={city}
            onChange={(event) => setCity(event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="branch-phone">هاتف الفرع (اختياري)</label>
          <input
            id="branch-phone"
            name="phone"
            dir="ltr"
            maxLength={30}
            placeholder="+20 100 000 0000"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
        </div>
      </div>

      {codeDuplicate ? (
        <div className="alert alert-err" role="alert">
          كود الفرع «{normCode}» مستخدم بالفعل؛ اختر كودًا مختلفًا.
        </div>
      ) : null}
      {prefixDuplicate ? (
        <div className="alert alert-err" role="alert">
          بادئة الفواتير «{normPrefix}» مستخدمة لفرع آخر؛ اختر بادئة فريدة.
        </div>
      ) : null}

      <div className="admin-form-actions">
        <button
          className="btn"
          type="submit"
          disabled={
            isPending ||
            validationErr !== null ||
            codeDuplicate ||
            prefixDuplicate
          }
        >
          {isPending ? "جارٍ الإنشاء…" : "إضافة الفرع والمستودع الافتراضي"}
        </button>
        {validationErr && (code || nameAr) ? (
          <span className="field-hint">{validationErr}</span>
        ) : null}
      </div>
    </form>
  );
}

export function BranchManageDrawer({
  branch,
  financeOn,
  onClose,
}: {
  branch: BranchRow;
  financeOn: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [renamePending, startRename] = useTransition();
  const [togglePending, startToggle] = useTransition();

  const [renameState, setRenameState] = useState<AdminActionState>(initialAdminActionState);
  const [toggleState, setToggleState] = useState<AdminActionState>(initialAdminActionState);

  const [nameAr, setNameAr] = useState(branch.nameAr);
  const [city, setCity] = useState(branch.city ?? "");
  const [phone, setPhone] = useState(branch.phone ?? "");
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    setNameAr(branch.nameAr);
    setCity(branch.city ?? "");
    setPhone(branch.phone ?? "");
    setConfirmed(false);
  }, [branch.id, branch.nameAr, branch.city, branch.phone, branch.isActive]);

  const renameChanged =
    nameAr.trim() !== branch.nameAr ||
    city.trim() !== (branch.city ?? "") ||
    phone.trim() !== (branch.phone ?? "");

  const blockDeactivate =
    branch.isActive &&
    (branch.activeUserCount > 0 || branch.openCustodyCount > 0);

  function submitRename(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!renameChanged || renamePending) return;
    const fd = new FormData();
    fd.set("branchId", branch.id);
    fd.set("nameAr", nameAr);
    fd.set("city", city);
    fd.set("phone", phone);
    startRename(async () => {
      const res = await renameBranchAction(initialAdminActionState, fd);
      setRenameState(res);
      if (res.status === "success") router.refresh();
    });
  }

  function submitToggle(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!confirmed || togglePending || blockDeactivate) return;
    const fd = new FormData();
    fd.set("branchId", branch.id);
    fd.set("active", branch.isActive ? "no" : "yes");
    fd.set("confirmed", "yes");
    startToggle(async () => {
      const res = await setBranchActiveAction(initialAdminActionState, fd);
      setToggleState(res);
      if (res.status === "success") {
        setConfirmed(false);
        router.refresh();
      }
    });
  }

  return (
    <div className="admin-drawer">
      <div className="admin-drawer__head">
        <div>
          <strong>إدارة الفرع: {branch.nameAr}</strong>
          <span className="admin-drawer__meta">
            الكود الثابت: <bdi dir="ltr">{branch.code}</bdi> · بادئة الفواتير:{" "}
            <bdi dir="ltr">{branch.invoicePrefix}</bdi> · المستودعات: {branch.warehouseCount}
          </span>
        </div>
        <button type="button" className="admin-ghost-btn" onClick={onClose}>
          <AppIcon name="close" />
          <span>إغلاق</span>
        </button>
      </div>

      <div className="admin-drawer__split">
        <form onSubmit={submitRename} className="admin-subcard">
          <h4>تحديث الاسم وبيانات التواصل</h4>
          <StatusBanner state={renameState} />
          <div className="admin-form-grid">
            <div className="field">
              <label htmlFor={`b-name-${branch.id}`}>اسم الفرع</label>
              <input
                id={`b-name-${branch.id}`}
                value={nameAr}
                maxLength={120}
                required
                onChange={(e) => setNameAr(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor={`b-city-${branch.id}`}>المدينة</label>
              <input
                id={`b-city-${branch.id}`}
                value={city}
                maxLength={80}
                onChange={(e) => setCity(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor={`b-phone-${branch.id}`}>هاتف الفرع</label>
              <input
                id={`b-phone-${branch.id}`}
                dir="ltr"
                value={phone}
                maxLength={30}
                placeholder="+20 ..."
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
          </div>
          <div className="admin-form-actions">
            <button
              type="submit"
              className="btn"
              disabled={renamePending || !renameChanged || nameAr.trim().length < 2}
            >
              {renamePending ? "جارٍ الحفظ…" : "حفظ بيانات الفرع"}
            </button>
          </div>
        </form>

        <form onSubmit={submitToggle} className="admin-subcard">
          <h4>{branch.isActive ? "إيقاف تشغيل الفرع" : "إعادة تفعيل الفرع"}</h4>
          <StatusBanner state={toggleState} />
          <p className="field-hint">
            {branch.isActive
              ? `إيقاف الفرع يوقف مستودعاته (${branch.warehouseCount}) ويمنع المبيعات الجديدة فيه، مع بقاء سجلاته السابقة للمراجعة.`
              : "إعادة التفعيل تعيد تشغيل الفرع ومستودعاته لاستقبال المبيعات والحركات."}
          </p>

          {branch.isActive && branch.activeUserCount > 0 ? (
            <div className="admin-inline-warn">
              يوجد حاليًا <strong>{branch.activeUserCount} موظف نشط</strong> على هذا الفرع؛ يجب نقلهم أو إيقافهم قبل إيقاف الفرع.
            </div>
          ) : null}

          {branch.isActive && branch.openCustodyCount > 0 ? (
            <div className="admin-inline-warn">
              يوجد بالفرع <strong>{branch.openCustodyCount} عهدة نقدية مفتوحة</strong>؛ يجب تصفيتها وإقفالها قبل الإيقاف. {financeOn ? <Link href="/finance/accounts">الحسابات النقدية</Link> : "المالية معطّلة؛ تواصل مع مسؤول النظام للمعالجة المعتمدة."}
            </div>
          ) : null}

          <label className="field-keyboard">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={blockDeactivate}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <span>أؤكد تنفيذ هذا الإجراء على الفرع ومستودعاته</span>
          </label>

          <div className="admin-form-actions">
            <button
              type="submit"
              className="btn sec"
              disabled={togglePending || !confirmed || blockDeactivate}
            >
              {togglePending
                ? "جارٍ التنفيذ…"
                : branch.isActive
                  ? "إيقاف الفرع ومستودعاته"
                  : "إعادة تفعيل الفرع"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function UserCreateForm({
  branches,
  actorRole,
  existingEmails = [],
  onClose,
}: {
  branches: BranchOption[];
  actorRole: AdminRole;
  existingEmails?: string[];
  onClose?: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<AdminActionState>(initialAdminActionState);

  const allowedRoles = useMemo(
    () => assignableRolesForActor(actorRole),
    [actorRole],
  );

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [role, setRole] = useState<AdminRole>("CS_AGENT");
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [mustChange, setMustChange] = useState(true);

  const [issuedSlip, setIssuedSlip] = useState<{
    fullName: string;
    email: string;
    password: string;
  } | null>(null);
  const [copiedSlip, setCopiedSlip] = useState(false);

  const emailDuplicate = useMemo(() => {
    const clean = email.trim().toLowerCase();
    return clean.length > 0 && existingEmails.some((e) => e.toLowerCase() === clean);
  }, [existingEmails, email]);

  const validationErr = userInputError(
    { fullName, email, phone, password, role, branchId },
    { requirePassword: true },
  );

  function handleGeneratePassword() {
    const generated = generateStrongPassword(16);
    setPassword(generated);
    setShowPassword(true);
  }

  function handleCopySlip(slip: { fullName: string; email: string; password: string }) {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard
        .writeText(formatCredentialSlip(slip.fullName, slip.email, slip.password))
        .catch(() => {});
      setCopiedSlip(true);
      setTimeout(() => setCopiedSlip(false), 2000);
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isPending || validationErr || emailDuplicate) return;

    const savedName = fullName.trim();
    const savedEmail = email.trim().toLowerCase();
    const savedPassword = password;

    const fd = new FormData();
    fd.set("fullName", savedName);
    fd.set("email", savedEmail);
    fd.set("phone", phone.trim());
    fd.set("password", savedPassword);
    fd.set("role", role);
    fd.set("branchId", branchId);
    if (mustChange) fd.set("mustChange", "yes");

    startTransition(async () => {
      const res = await createUserAction(initialAdminActionState, fd);
      setFeedback(res);
      if (res.status === "success") {
        setIssuedSlip({
          fullName: savedName,
          email: savedEmail,
          password: savedPassword,
        });
        setFullName("");
        setEmail("");
        setPhone("");
        setPassword("");
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="admin-card-form" aria-busy={isPending}>
      <div className="admin-card-form__head">
        <div>
          <h3>إضافة حساب مستخدم جديد</h3>
          <p>
            تُشفَّر كلمة المرور بـ <code>bcrypt</code> ولا تُعرض أو تُخزَّن نصيًا في أي سجل.
          </p>
        </div>
        {onClose ? (
          <button type="button" className="admin-ghost-btn" onClick={onClose}>
            <AppIcon name="close" />
            <span>إغلاق</span>
          </button>
        ) : null}
      </div>

      <StatusBanner state={feedback} />

      {issuedSlip ? (
        <div className="admin-credential-slip" role="region" aria-label="بطاقة الدخول المؤقتة">
          <div className="admin-credential-slip__body">
            <strong>بطاقة التسليم المؤقتة لـ «{issuedSlip.fullName}»</strong>
            <span>
              البريد: <bdi dir="ltr">{issuedSlip.email}</bdi> · كلمة المرور المؤقتة:{" "}
              <code dir="ltr">{issuedSlip.password}</code>
            </span>
          </div>
          <div className="admin-credential-slip__actions">
            <button
              type="button"
              className="admin-ghost-btn"
              onClick={() => handleCopySlip(issuedSlip)}
            >
              <span>{copiedSlip ? "نُسخت البطاقة ✓" : "نسخ بطاقة الدخول"}</span>
            </button>
            <button
              type="button"
              className="admin-ghost-btn"
              onClick={() => setIssuedSlip(null)}
            >
              إخفاء
            </button>
          </div>
        </div>
      ) : null}

      <div className="admin-form-grid">
        <div className="field">
          <label htmlFor="user-name">الاسم الكامل</label>
          <input
            id="user-name"
            name="fullName"
            required
            maxLength={120}
            placeholder="أحمد محمد..."
            value={fullName}
            onChange={(e) => {
              setFullName(e.target.value);
              if (feedback.status !== "idle") setFeedback(initialAdminActionState);
            }}
          />
        </div>

        <div className="field">
          <label htmlFor="user-email">البريد الإلكتروني</label>
          <input
            id="user-email"
            name="email"
            type="email"
            required
            dir="ltr"
            maxLength={160}
            autoCapitalize="none"
            spellCheck={false}
            placeholder="staff@selahtone.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (feedback.status !== "idle") setFeedback(initialAdminActionState);
            }}
          />
        </div>

        <div className="field">
          <label htmlFor="user-phone">رقم الهاتف (اختياري)</label>
          <input
            id="user-phone"
            name="phone"
            dir="ltr"
            maxLength={30}
            placeholder="+20 100 000 0000"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>

        <div className="field">
          <div className="admin-label-row">
            <label htmlFor="user-password">كلمة المرور المؤقتة</label>
            <div className="admin-pw-tools">
              <button
                type="button"
                className="admin-mini-btn"
                onClick={handleGeneratePassword}
              >
                توليد كلمة قوية
              </button>
              <button
                type="button"
                className="admin-mini-btn"
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? "إخفاء" : "إظهار"}
              </button>
            </div>
          </div>
          <input
            id="user-password"
            name="password"
            type={showPassword ? "text" : "password"}
            required
            dir="ltr"
            autoComplete="new-password"
            placeholder="12 حرفًا على الأقل"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="user-role">الدور الوظيفي</label>
          <select
            id="user-role"
            name="role"
            value={role}
            onChange={(e) => {
              const nextRole = e.target.value as AdminRole;
              setRole(nextRole);
              if (nextRole === "CS_AGENT" && !branchId && branches[0]) {
                setBranchId(branches[0].id);
              }
            }}
          >
            {allowedRoles.map((value) => (
              <option key={value} value={value}>
                {ROLE_LABELS[value]}
              </option>
            ))}
          </select>
          {actorRole === "ACCOUNTANT" ? (
            <p className="field-hint">حسابات الإدارة والمحاسبة ينشئها المدير العام فقط.</p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="user-branch">الفرع المنسوب إليه</label>
          <select
            id="user-branch"
            name="branchId"
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
          >
            {role !== "CS_AGENT" ? (
              <option value="">بدون فرع (إدارة مركزية لكل الفروع)</option>
            ) : null}
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.nameAr} ({branch.code})
              </option>
            ))}
          </select>
        </div>

      </div>

      <div className="admin-checks-row">
        <label className="field-keyboard">
          <input
            type="checkbox"
            checked={mustChange}
            onChange={(e) => setMustChange(e.target.checked)}
          />
          <span>إلزام المستخدم بتغيير كلمة المرور عند أول دخول</span>
        </label>
      </div>

      {emailDuplicate ? (
        <div className="alert alert-err" role="alert">
          البريد الإلكتروني «{email.trim()}» مسجّل لمستخدم قائم بالفعل.
        </div>
      ) : null}

      <div className="admin-form-actions">
        <button
          className="btn"
          type="submit"
          disabled={isPending || validationErr !== null || emailDuplicate}
        >
          {isPending ? "جارٍ إنشاء الحساب…" : "إنشاء المستخدم"}
        </button>
        {validationErr && (fullName || email || password) ? (
          <span className="field-hint">{validationErr}</span>
        ) : null}
      </div>
    </form>
  );
}

export function UserManageDrawer({
  user,
  branches,
  actorRole,
  financeOn,
  existingEmails = [],
  onClose,
}: {
  user: UserRow;
  branches: BranchOption[];
  actorRole: AdminRole;
  financeOn: boolean;
  existingEmails?: string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [subTab, setSubTab] = useState<"profile" | "password" | "sessions">(
    "profile",
  );

  const [editPending, startEdit] = useTransition();
  const [pwPending, startPw] = useTransition();
  const [sessPending, startSess] = useTransition();

  const [editState, setEditState] = useState<AdminActionState>(initialAdminActionState);
  const [pwState, setPwState] = useState<AdminActionState>(initialAdminActionState);
  const [sessState, setSessState] = useState<AdminActionState>(initialAdminActionState);

  const [fullName, setFullName] = useState(user.fullName);
  const [email, setEmail] = useState(user.email);
  const [phone, setPhone] = useState(user.phone ?? "");
  const [role, setRole] = useState<AdminRole>(user.role);
  const [branchId, setBranchId] = useState(user.branchId ?? "");
  const [active, setActive] = useState(user.isActive);

  const [newPassword, setNewPassword] = useState("");
  const [showNewPw, setShowNewPw] = useState(false);
  const [resetSlipPassword, setResetSlipPassword] = useState<string | null>(null);
  const [copiedReset, setCopiedReset] = useState(false);

  useEffect(() => {
    setFullName(user.fullName);
    setEmail(user.email);
    setPhone(user.phone ?? "");
    setRole(user.role);
    setBranchId(user.branchId ?? "");
    setActive(user.isActive);
  }, [user]);

  const allowedRoles = useMemo(
    () => assignableRolesForActor(actorRole),
    [actorRole],
  );

  const emailDuplicate = useMemo(() => {
    const clean = email.trim().toLowerCase();
    if (!clean || clean === user.email.trim().toLowerCase()) return false;
    return existingEmails.some((e) => e.toLowerCase() === clean);
  }, [existingEmails, email, user.email]);

  const branchChanging = (user.branchId ?? "") !== branchId;
  const suspending = user.isActive && !active;
  const blockedByCustody =
    Boolean(user.openCustodyId) && (branchChanging || suspending);

  const profileValidationErr = userInputError(
    { fullName, email, phone, role, branchId },
    { requirePassword: false },
  );

  function submitProfile(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (
      user.isSelf ||
      editPending ||
      profileValidationErr ||
      emailDuplicate ||
      blockedByCustody
    ) {
      return;
    }
    const fd = new FormData();
    fd.set("userId", user.id);
    fd.set("fullName", fullName.trim());
    fd.set("email", email.trim().toLowerCase());
    fd.set("phone", phone.trim());
    fd.set("role", role);
    fd.set("branchId", branchId);
    if (active) fd.set("active", "yes");

    startEdit(async () => {
      const res = await updateUserAction(initialAdminActionState, fd);
      setEditState(res);
      if (res.status === "success") router.refresh();
    });
  }

  function submitPasswordReset(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pwPending || newPassword.length < 12) return;
    const savedPw = newPassword;
    const fd = new FormData();
    fd.set("userId", user.id);
    fd.set("newPassword", savedPw);

    startPw(async () => {
      const res = await resetPasswordAction(initialAdminActionState, fd);
      setPwState(res);
      if (res.status === "success") {
        setResetSlipPassword(savedPw);
        setNewPassword("");
        router.refresh();
      }
    });
  }

  function submitRevokeSessions(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sessPending || user.isSelf || user.activeSessionCount === 0) return;
    const fd = new FormData();
    fd.set("userId", user.id);
    startSess(async () => {
      const res = await revokeUserSessionsAction(initialAdminActionState, fd);
      setSessState(res);
      if (res.status === "success") router.refresh();
    });
  }

  return (
    <div className="admin-drawer">
      <div className="admin-drawer__head">
        <div>
          <strong>إدارة حساب: {user.fullName}</strong>
          <span className="admin-drawer__meta">
            <bdi dir="ltr">{user.email}</bdi> · الدور الحالي: {ROLE_LABELS[user.role]}
            {user.openCustodyId ? ` · عهدة نقدية مفتوحة #${user.openCustodyId}` : ""}
          </span>
        </div>
        <button type="button" className="admin-ghost-btn" onClick={onClose}>
          <AppIcon name="close" />
          <span>إغلاق</span>
        </button>
      </div>

      <div className="admin-subtabs" role="tablist" aria-label="أقسام إدارة المستخدم">
        <button
          type="button"
          role="tab"
          aria-selected={subTab === "profile"}
          className={`admin-subtab${subTab === "profile" ? " is-active" : ""}`}
          onClick={() => setSubTab("profile")}
        >
          البيانات والصلاحيات
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={subTab === "password"}
          className={`admin-subtab${subTab === "password" ? " is-active" : ""}`}
          onClick={() => setSubTab("password")}
        >
          كلمة المرور المؤقتة
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={subTab === "sessions"}
          className={`admin-subtab${subTab === "sessions" ? " is-active" : ""}`}
          onClick={() => setSubTab("sessions")}
        >
          الجلسات النشطة ({user.activeSessionCount})
        </button>
      </div>

      {subTab === "profile" ? (
        user.isSelf ? (
          <div className="admin-subcard">
            <p className="field-hint">
              هذا هو حسابك الحالي؛ منعةً لقفل صلاحيتك بالخطأ لا يمكن تغيير دورك أو إيقاف حسابك من هذه اللوحة. يمكنك تغيير كلمة مرورك من صفحة{" "}
              <Link href="/change-password">تغيير كلمة المرور</Link>.
            </p>
          </div>
        ) : (
          <form onSubmit={submitProfile} className="admin-subcard">
            <StatusBanner state={editState} />

            {user.openCustodyId ? (
              <div className="admin-inline-warn">
                في ذمّة هذا الموظف <strong>عهدة نقدية مفتوحة (#{user.openCustodyId})</strong>. لا يُسمح بنقله أو إيقافه قبل تصفية العهدة وإقفالها. {financeOn ? <Link href="/finance/accounts">الحسابات النقدية</Link> : "المالية معطّلة؛ تواصل مع مسؤول النظام للمعالجة المعتمدة."}
              </div>
            ) : null}

            <div className="admin-form-grid">
              <div className="field">
                <label htmlFor={`u-name-${user.id}`}>الاسم الكامل</label>
                <input
                  id={`u-name-${user.id}`}
                  value={fullName}
                  maxLength={120}
                  required
                  onChange={(e) => setFullName(e.target.value)}
                />
              </div>

              <div className="field">
                <label htmlFor={`u-email-${user.id}`}>البريد الإلكتروني</label>
                <input
                  id={`u-email-${user.id}`}
                  type="email"
                  dir="ltr"
                  maxLength={160}
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="field">
                <label htmlFor={`u-phone-${user.id}`}>رقم الهاتف</label>
                <input
                  id={`u-phone-${user.id}`}
                  dir="ltr"
                  maxLength={30}
                  placeholder="+20 ..."
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>

              <div className="field">
                <label htmlFor={`u-role-${user.id}`}>الدور الوظيفي</label>
                <select
                  id={`u-role-${user.id}`}
                  value={role}
                  onChange={(e) => setRole(e.target.value as AdminRole)}
                >
                  {allowedRoles.map((value) => (
                    <option key={value} value={value}>
                      {ROLE_LABELS[value]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor={`u-branch-${user.id}`}>الفرع</label>
                <select
                  id={`u-branch-${user.id}`}
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value)}
                >
                  {role !== "CS_AGENT" ? (
                    <option value="">بدون فرع (إدارة مركزية)</option>
                  ) : null}
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.nameAr} ({branch.code})
                    </option>
                  ))}
                </select>
              </div>

            </div>

            <div className="admin-checks-row">
              <label className="field-keyboard">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                />
                <span>الحساب نشط ومسموح له بالدخول</span>
              </label>
            </div>

            {emailDuplicate ? (
              <div className="alert alert-err" role="alert">
                البريد الإلكتروني مستخدم لحساب آخر.
              </div>
            ) : null}

            {blockedByCustody ? (
              <div className="alert alert-err" role="alert">
                يجب تصفية وإقفال العهدة النقدية المفتوحة (#{user.openCustodyId}) قبل تغيير فرع الموظف أو إيقاف حسابه.
              </div>
            ) : null}

            <div className="admin-form-actions">
              <button
                type="submit"
                className="btn"
                disabled={
                  editPending ||
                  profileValidationErr !== null ||
                  emailDuplicate ||
                  blockedByCustody
                }
              >
                {editPending ? "جارٍ حفظ التعديلات…" : "حفظ بيانات وصلاحيات المستخدم"}
              </button>
            </div>
          </form>
        )
      ) : null}

      {subTab === "password" ? (
        <form onSubmit={submitPasswordReset} className="admin-subcard">
          <StatusBanner state={pwState} />
          <p className="field-hint">
            يُنهي تصفير كلمة المرور جميع جلسات المستخدم السابقة فورًا، ويُلزمه بتعيين كلمة مرور جديدة عند أول دخول، ويُوثَّق في سجل الأمان.
          </p>

          {resetSlipPassword ? (
            <div className="admin-credential-slip">
              <div className="admin-credential-slip__body">
                <strong>كلمة المرور المؤقتة الجديدة جاهزة للتسليم</strong>
                <span>
                  <bdi dir="ltr">{user.email}</bdi> ·{" "}
                  <code dir="ltr">{resetSlipPassword}</code>
                </span>
              </div>
              <div className="admin-credential-slip__actions">
                <button
                  type="button"
                  className="admin-ghost-btn"
                  onClick={() => {
                    if (typeof navigator !== "undefined" && navigator.clipboard) {
                      navigator.clipboard
                        .writeText(
                          formatCredentialSlip(
                            user.fullName,
                            user.email,
                            resetSlipPassword,
                          ),
                        )
                        .catch(() => {});
                      setCopiedReset(true);
                      setTimeout(() => setCopiedReset(false), 2000);
                    }
                  }}
                >
                  {copiedReset ? "نُسخت البطاقة ✓" : "نسخ بطاقة الدخول"}
                </button>
              </div>
            </div>
          ) : null}

          <div className="admin-form-grid">
            <div className="field">
              <div className="admin-label-row">
                <label htmlFor={`pw-reset-${user.id}`}>كلمة المرور المؤقتة الجديدة</label>
                <div className="admin-pw-tools">
                  <button
                    type="button"
                    className="admin-mini-btn"
                    onClick={() => {
                      setNewPassword(generateStrongPassword(16));
                      setShowNewPw(true);
                    }}
                  >
                    توليد كلمة قوية
                  </button>
                  <button
                    type="button"
                    className="admin-mini-btn"
                    onClick={() => setShowNewPw((v) => !v)}
                  >
                    {showNewPw ? "إخفاء" : "إظهار"}
                  </button>
                </div>
              </div>
              <input
                id={`pw-reset-${user.id}`}
                type={showNewPw ? "text" : "password"}
                dir="ltr"
                autoComplete="new-password"
                placeholder="12 حرفًا على الأقل"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="admin-form-actions">
            <button
              type="submit"
              className="btn"
              disabled={pwPending || newPassword.length < 12}
            >
              {pwPending ? "جارٍ التحديث…" : "تعيين كلمة المرور المؤقتة وإنهاء الجلسات"}
            </button>
          </div>
        </form>
      ) : null}

      {subTab === "sessions" ? (
        <form onSubmit={submitRevokeSessions} className="admin-subcard">
          <StatusBanner state={sessState} />
          <p className="field-hint">
            عدد الجلسات النشطة حاليًا لهذا المستخدم: <strong>{user.activeSessionCount}</strong>.{" "}
            {user.lastLoginLabel
              ? `آخر تسجيل دخول ناجح: ${user.lastLoginLabel}.`
              : "لم يُسجَّل دخول سابق بعد."}
          </p>
          {user.isSelf ? (
            <p className="field-hint">
              لإنهاء جلستك الحالية استخدم زر تسجيل الخروج في الشريط العلوي.
            </p>
          ) : (
            <div className="admin-form-actions">
              <button
                type="submit"
                className="btn sec"
                disabled={sessPending || user.activeSessionCount === 0}
              >
                {sessPending
                  ? "جارٍ إنهاء الجلسات…"
                  : `إنهاء جميع الجلسات النشطة (${user.activeSessionCount})`}
              </button>
            </div>
          )}
        </form>
      ) : null}
    </div>
  );
}

export function PurgeSessionsButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<AdminActionState>(initialAdminActionState);

  function handlePurge() {
    if (isPending) return;
    startTransition(async () => {
      const res = await purgeInactiveSessionsAction(initialAdminActionState);
      setFeedback(res);
      if (res.status === "success") router.refresh();
    });
  }

  return (
    <div className="admin-purge-box">
      <button
        type="button"
        className="admin-ghost-btn"
        onClick={handlePurge}
        disabled={isPending}
      >
        <AppIcon name="shield" />
        <span>
          {isPending
            ? "جارٍ تطهير الجلسات…"
            : "تطهير الجلسات المنتهية والموقوفة"}
        </span>
      </button>
      {feedback.status !== "idle" && feedback.message ? (
        <span className="admin-purge-box__msg">{feedback.message}</span>
      ) : null}
    </div>
  );
}
