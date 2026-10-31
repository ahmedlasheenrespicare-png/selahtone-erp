"use client";

import { useActionState, useState } from "react";

import { ADMIN_ROLES, ROLE_LABELS, userInputError, type AdminRole } from "@/lib/admin-directory";
import { MENU_SCOPES, MENU_SCOPE_LABELS, type MenuScope } from "@/lib/menu-scope";
import {
  createBranchAction,
  createUserAction,
  renameBranchAction,
  resetPasswordAction,
  setBranchActiveAction,
  updateUserAction,
} from "./actions";
import { initialAdminActionState } from "./admin-state";

export type BranchRow = {
  id: string;
  code: string;
  nameAr: string;
  city: string | null;
  invoicePrefix: string;
  isActive: boolean;
  userCount: number;
  warehouseCount: number;
};

export type UserRow = {
  id: string;
  fullName: string;
  email: string;
  role: AdminRole;
  branchId: string | null;
  branchName: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  isSelf: boolean;
  menuScope: MenuScope;
  canCancelSales: boolean;
};

export type BranchOption = { id: string; nameAr: string; code: string };

function Result({ state, fallback }: { state: { status: string; message?: string }; fallback?: string }) {
  if (state.status === "error" && state.message) return <div className="alert alert-err" role="alert">{state.message}</div>;
  if (state.status === "success" && state.message) return <div className="alert alert-ok" role="status">{state.message}</div>;
  return fallback ? <p className="field-hint">{fallback}</p> : null;
}

export function BranchCreateForm() {
  const [state, action, pending] = useActionState(createBranchAction, initialAdminActionState);
  const [code, setCode] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [city, setCity] = useState("");
  const [invoicePrefix, setInvoicePrefix] = useState("");

  return (
    <form action={action} className="form" aria-busy={pending}>
      <Result state={state} fallback="الكود وبادئة الفاتورة بالأحرف الإنجليزية الكبيرة أو الأرقام، ولا يُنشئ النظام فرعًا إلا بمستودع افتراضي واحد." />
      <div className="field">
        <label htmlFor="branch-code">كود الفرع</label>
        <input
          id="branch-code" name="code" dir="ltr" required maxLength={8} placeholder="CAI"
          value={code} onChange={(event) => { setCode(event.target.value.toUpperCase()); if (!invoicePrefix.trim()) setInvoicePrefix(event.target.value.toUpperCase()); }}
        />
        <p className="field-hint">حرفان إلى ثمانية، مثل ISM أو SUEZ2.</p>
      </div>
      <div className="field">
        <label htmlFor="branch-name">اسم الفرع</label>
        <input id="branch-name" name="nameAr" required maxLength={120} value={nameAr} onChange={(event) => setNameAr(event.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="branch-city">المدينة (اختياري)</label>
        <input id="branch-city" name="city" maxLength={80} value={city} onChange={(event) => setCity(event.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="branch-prefix">بادئة الفواتير</label>
        <input id="branch-prefix" name="invoicePrefix" dir="ltr" required maxLength={6} value={invoicePrefix} onChange={(event) => setInvoicePrefix(event.target.value.toUpperCase())} />
      </div>
      <button className="btn" type="submit" disabled={pending}>{pending ? "جارٍ الإضافة…" : "إضافة الفرع"}</button>
    </form>
  );
}

export function BranchRenameForm({ branch }: { branch: BranchRow }) {
  const [state, action, pending] = useActionState(renameBranchAction, initialAdminActionState);
  const [nameAr, setNameAr] = useState(branch.nameAr);
  const [city, setCity] = useState(branch.city ?? "");

  return (
    <form action={action} className="form" aria-busy={pending}>
      <input type="hidden" name="branchId" value={branch.id} />
      <Result state={state} fallback="تغيير الاسم لا يغيّر الكود أو بادئة الفواتير أو أي سجل قائم." />
      <div className="field">
        <label htmlFor={`name-${branch.id}`}>اسم الفرع</label>
        <input id={`name-${branch.id}`} name="nameAr" required maxLength={120} value={nameAr} onChange={(event) => setNameAr(event.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`city-${branch.id}`}>المدينة</label>
        <input id={`city-${branch.id}`} name="city" maxLength={80} value={city} onChange={(event) => setCity(event.target.value)} />
      </div>
      <button className="btn" type="submit" disabled={pending}>{pending ? "جارٍ الحفظ…" : "حفظ الاسم"}</button>
    </form>
  );
}

export function BranchActiveForm({ branch }: { branch: BranchRow }) {
  const [state, action, pending] = useActionState(setBranchActiveAction, initialAdminActionState);
  const [confirmed, setConfirmed] = useState(false);

  return (
    <form action={action} className="form" aria-busy={pending}>
      <input type="hidden" name="branchId" value={branch.id} />
      <input type="hidden" name="active" value={branch.isActive ? "no" : "yes"} />
      <Result state={state} />
      <p className="field-hint">
        {branch.isActive
          ? `إيقاف الفرع يوقف مستودعاته (${branch.warehouseCount}) ويمنع المبيعات الجديدة فيه، وتبقى تسوية فواتيره السابقة للمدير والمحاسب فقط.`
          : "إعادة التفعيل تُعيد العمل بالمستودعات والمبيعات في الفرع."}
      </p>
      <label className="field-keyboard">
        <input type="checkbox" name="confirmed" value="yes" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
        <span>أؤكد هذا الإجراء</span>
      </label>
      <button className="btn" type="submit" disabled={pending || !confirmed}>
        {pending ? "جارٍ التنفيذ…" : branch.isActive ? "إيقاف الفرع" : "تفعيل الفرع"}
      </button>
    </form>
  );
}

export function UserCreateForm({ branches }: { branches: BranchOption[] }) {
  const [state, action, pending] = useActionState(createUserAction, initialAdminActionState);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AdminRole>("CS_AGENT");
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [mustChange, setMustChange] = useState(true);

  const error = userInputError({ fullName, email, password, role, branchId }, { requirePassword: true });

  return (
    <form action={action} className="form" aria-busy={pending}>
      <Result state={state} fallback="موظف الفرع يجب أن يكون منسوبًا إلى فرع نشط؛ والمدير والمحاسب قد يبقيان بلا فرع لإدارة كل الفروع." />
      <div className="field">
        <label htmlFor="user-name">الاسم</label>
        <input id="user-name" name="fullName" required maxLength={120} value={fullName} onChange={(event) => setFullName(event.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="user-email">البريد الإلكتروني</label>
        <input
          id="user-email" name="email" type="email" required dir="ltr" maxLength={160} autoCapitalize="none" spellCheck={false}
          value={email} onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="user-password">كلمة المرور المؤقتة</label>
        <input
          id="user-password" name="password" type="password" required dir="ltr" autoComplete="new-password"
          value={password} onChange={(event) => setPassword(event.target.value)}
        />
        <p className="field-hint">١٢ حرفًا على الأقل.</p>
      </div>
      <div className="field">
        <label htmlFor="user-role">الدور</label>
        <select id="user-role" name="role" value={role} onChange={(event) => setRole(event.target.value as AdminRole)}>
          {ADMIN_ROLES.map((value) => (<option key={value} value={value}>{ROLE_LABELS[value]}</option>))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="user-branch">الفرع</label>
        <select id="user-branch" name="branchId" value={branchId} onChange={(event) => setBranchId(event.target.value)}>
          <option value="">بدون فرع (للمدير والمحاسب)</option>
          {branches.map((branch) => (<option key={branch.id} value={branch.id}>{branch.nameAr}</option>))}
        </select>
        {role === "CS_AGENT" && !branchId && <p className="field-error">موظف الفرع يجب أن يكون منسوبًا إلى فرع.</p>}
      </div>
      <label className="field-keyboard">
        <input type="checkbox" name="mustChange" value="yes" checked={mustChange} onChange={(event) => setMustChange(event.target.checked)} />
        <span>إلزام المستخدم بتغيير كلمة المرور عند أول دخول</span>
      </label>
      {role !== "CS_AGENT" && (
        <div className="field">
          <label htmlFor="user-scope">نطاق القائمة</label>
          <select id="user-scope" name="menuScope" defaultValue="FULL">
            {MENU_SCOPES.map((value) => (<option key={value} value={value}>{MENU_SCOPE_LABELS[value]}</option>))}
          </select>
          <p className="field-hint">النطاق المختصر يمنع فتح بقية الشاشات من الخادم، لا من القائمة فقط.</p>
        </div>
      )}
      <button className="btn" type="submit" disabled={pending || error !== null}>{pending ? "جارٍ الإنشاء…" : "إنشاء المستخدم"}</button>
      {error !== null && <p className="field-hint">{error}</p>}
    </form>
  );
}

export function UserEditForm({ user, branches }: { user: UserRow; branches: BranchOption[] }) {
  const [state, action, pending] = useActionState(updateUserAction, initialAdminActionState);
  const [role, setRole] = useState<AdminRole>(user.role);
  const [branchId, setBranchId] = useState(user.branchId ?? "");
  const [active, setActive] = useState(user.isActive);

  if (user.isSelf) return <p className="field-hint">لا يمكنك تغيير دورك أو حالتك من هذه الشاشة.</p>;

  return (
    <form action={action} className="form" aria-busy={pending}>
      <input type="hidden" name="userId" value={user.id} />
      <Result state={state} />
      <div className="field">
        <label htmlFor={`role-${user.id}`}>الدور</label>
        <select id={`role-${user.id}`} name="role" value={role} onChange={(event) => setRole(event.target.value as AdminRole)}>
          {ADMIN_ROLES.map((value) => (<option key={value} value={value}>{ROLE_LABELS[value]}</option>))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`branch-${user.id}`}>الفرع</label>
        <select id={`branch-${user.id}`} name="branchId" value={branchId} onChange={(event) => setBranchId(event.target.value)}>
          <option value="">بدون فرع (للمدير والمحاسب)</option>
          {branches.map((branch) => (<option key={branch.id} value={branch.id}>{branch.nameAr}</option>))}
        </select>
        {role === "CS_AGENT" && !branchId && <p className="field-error">موظف الفرع يجب أن يكون منسوبًا إلى فرع.</p>}
      </div>
      <label className="field-keyboard">
        <input type="checkbox" name="active" value="yes" checked={active} onChange={(event) => setActive(event.target.checked)} />
        <span>الحساب نشط</span>
      </label>
      {/* صلاحية إلغاء البيع للمحاسب خاصة: المدير يملكها دائمًا، وموظف الكاونتر
          لا يملكها أصلًا. فإظهار المفتاح لغير المحاسب يوحي بصلاحية لا يملكها. */}
      {role === "ACCOUNTANT" && (
        <label className="field-keyboard">
          <input type="checkbox" name="canCancelSales" value="yes" defaultChecked={user.canCancelSales} />
          <span>يستطيع إلغاء البيع</span>
        </label>
      )}
      {role !== "CS_AGENT" && (
        <div className="field">
          <label htmlFor={`scope-${user.id}`}>نطاق القائمة</label>
          <select id={`scope-${user.id}`} name="menuScope" defaultValue={user.menuScope}>
            {MENU_SCOPES.map((value) => (<option key={value} value={value}>{MENU_SCOPE_LABELS[value]}</option>))}
          </select>
        </div>
      )}
      <button className="btn" type="submit" disabled={pending || (role === "CS_AGENT" && !branchId)}>
        {pending ? "جارٍ الحفظ…" : "حفظ"}
      </button>
    </form>
  );
}

export function PasswordResetForm({ user }: { user: UserRow }) {
  const [state, action, pending] = useActionState(resetPasswordAction, initialAdminActionState);
  const [password, setPassword] = useState("");
  const ready = password.length >= 12;

  return (
    <form action={action} className="form" aria-busy={pending}>
      <input type="hidden" name="userId" value={user.id} />
      <Result state={state} fallback="يُنهى هذا الإجراء جلسات المستخدم السابقة ويُلزمه بتغيير كلمة المرور عند أول دخول." />
      <div className="field">
        <label htmlFor={`password-${user.id}`}>كلمة المرور الجديدة</label>
        <input
          id={`password-${user.id}`} name="newPassword" type="password" required dir="ltr" autoComplete="new-password"
          value={password} onChange={(event) => setPassword(event.target.value)}
        />
        {!ready && <p className="field-hint">١٢ حرفًا على الأقل.</p>}
      </div>
      <button className="btn" type="submit" disabled={pending || !ready}>{pending ? "جارٍ التحديث…" : "تحديث كلمة المرور"}</button>
    </form>
  );
}
