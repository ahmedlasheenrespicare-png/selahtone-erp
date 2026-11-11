"use client";

import { useActionState, useState } from "react";
import { ACCESS_PAGES, isEditableAccessKey, resolveHiddenKeys, accessRulesAllowKey } from "@/lib/access-control";
import { ROLE_LABELS, type AdminRole } from "@/lib/admin-directory";
import { setPermissionAction } from "./permissions-actions";

type Row = { subject_kind: string; subject: string; key: string; allowed: boolean };
type User = { id: string; fullName: string; email: string; role: AdminRole; isSystemAdmin: boolean };

export default function PermissionsPanel({ users, rows, healthy }: { users: User[]; rows: Row[]; healthy: boolean }) {
  const [kind, setKind] = useState<"role" | "user">("role");
  const [subject, setSubject] = useState("CS_AGENT");
  const [key, setKey] = useState("/sales");
  const [state, action, pending] = useActionState(setPermissionAction, { status: "idle" });
  const row = rows.find((r) => r.subject_kind === kind && r.subject === subject && r.key === key);
  const user = kind === "user" ? users.find((u) => u.id === subject) : undefined;
  const roleRow = user && rows.find((r) => r.subject_kind === "role" && r.subject === user.role && r.key === key);
  const current = user?.isSystemAdmin ? "أدمن النظام: مسموح دائمًا" : row ? (row.allowed ? "سماح صريح" : "منع صريح") : kind === "user" ? `يرث الدور: ${roleRow && !roleRow.allowed ? "ممنوع" : "مسموح"}` : "الافتراضي: مسموح";
  const role = kind === "role" ? subject : user?.role;
  const roleRules = new Map(rows.filter((r) => r.subject_kind === "role" && r.subject === role).map((r) => [r.key, r.allowed]));
  const userRules = new Map(rows.filter((r) => kind === "user" && r.subject_kind === "user" && r.subject === subject).map((r) => [r.key, r.allowed]));
  const hidden = user?.isSystemAdmin ? new Set<string>() : resolveHiddenKeys(roleRules, userRules);
  const effectiveAllowed = accessRulesAllowKey(hidden, key);
  return (
    <section className="dashboard-surface-card" aria-labelledby="permissions-title" style={{ padding: "1.25rem", marginBlock: "1rem" }}>
      <h2 id="permissions-title">صلاحيات الأدوار والحسابات</h2>
      {!healthy && <p className="alert alert-err" role="alert">تعذرت قراءة جدول الصلاحيات. يُغلق الوصول المقيّد لغير الأدمن مؤقتًا، ولا يمكن حفظ التغييرات حتى إصلاح قاعدة البيانات.</p>}
      <p>الافتراضي مسموح؛ استثناء الحساب يعلو قالب دوره. أدمن النظام لا يمكن تقييده.</p>
      <p>نتيجة قواعد الصلاحيات لا تلغي قيود الدور أو حالة السجل أو تفعيل الوحدة؛ مثلًا المرتجع والإلغاء متاحان للمدير فقط، حتى لو سمحت القواعد للمحاسب.</p>
      <p>هذه اللوحة قيد التنفيذ: المتاح حاليًا الصفحات ومفاتيح الكتابة والعناصر المفعّلة فقط. بعض العمليات الداخلية متاحة بشكل مستقل؛ بقية العناصر الداخلية لم تُجهّز بعد.</p>
      <form action={action} style={{ display: "grid", gap: ".75rem", maxWidth: "48rem" }}>
        <label>نوع الصلاحية <select name="kind" value={kind} onChange={(e) => { const next = e.target.value as "role" | "user"; setKind(next); setSubject(next === "role" ? "CS_AGENT" : (users[0]?.id ?? "")); }}><option value="role">قالب دور</option><option value="user">استثناء حساب</option></select></label>
        <label>الدور أو الحساب <select name="subject" value={subject} onChange={(e) => setSubject(e.target.value)}>
          {kind === "role" ? (Object.keys(ROLE_LABELS) as AdminRole[]).map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>) : users.map((u) => <option key={u.id} value={u.id}>{u.fullName} — {u.email}{u.isSystemAdmin ? " (أدمن النظام)" : ""}</option>)}
        </select></label>
        <label>الصفحة أو العملية <select name="key" value={key} onChange={(e) => setKey(e.target.value)}>
          {ACCESS_PAGES.filter((page) => isEditableAccessKey(page.route) || page.elements.some((el) => isEditableAccessKey(el.key))).map((page) => <optgroup key={page.route} label={page.label}>
            {isEditableAccessKey(page.route) && <option value={page.route}>فتح {page.label}</option>}
            {page.elements.filter((el) => isEditableAccessKey(el.key)).map((el) => <option key={el.key} value={el.key}>{el.label}</option>)}
          </optgroup>)}
        </select></label>
        {healthy ? <p>الحالة المحفوظة: <strong>{current}</strong> · نتيجة قواعد الصلاحيات: <strong>{effectiveAllowed ? "مسموح" : "ممنوع"}</strong>{!effectiveAllowed && key.includes("#") ? " (قد يكون المنع من الصفحة أو قفل الكتابة إن كان ينطبق على العنصر)" : ""}</p> : <p>حالة القواعد غير معروفة حتى تستعيد قاعدة البيانات القراءة.</p>}
        <label>القيمة <select name="value" defaultValue="inherit"><option value="inherit">إزالة الاستثناء / الافتراضي</option><option value="allow">سماح صريح</option><option value="deny">منع صريح</option></select></label>
        <button type="submit" disabled={!healthy || pending || !subject}>{pending ? "جارٍ الحفظ…" : "حفظ الصلاحية"}</button>
        {state.message && <p role="status">{state.message}</p>}
      </form>
    </section>
  );
}
