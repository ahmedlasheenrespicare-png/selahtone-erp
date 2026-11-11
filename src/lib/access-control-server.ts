import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";

import { getSession, type SessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  canonicalPageForRoute,
  KNOWN_ACCESS_KEYS,
  accessKeyAllowed,
  hiddenOnAccessStoreFailure,
  isSystemAdmin,
  parseAdminEmails,
  resolveHiddenKeys,
  writeAllowedForKeys,
} from "./access-control";

/**
 * محيط التنفيذ للصلاحيات الكاملة. يُقرأ مرة واحدة لكل طلب (React cache)، وأي فشل في
 * الوصول لقاعدة البيانات يمنع الصفحات والعناصر والإجراءات المسجلة لغير أدمن
 * النظام (fail-closed) ويعرض تنبيهًا؛ تبقى لوحة آمنة والأدمن متاحًا للإصلاح.
 *
 * يقرأ الجدول بـ SQL خام عمدًا (مثل وحدة المالية) حتى لا يعتمد نشر الصلاحيات على
 * توليد Prisma؛ يكفي تشغيل prisma/manual-access-control-upgrade.sql يدويًا كما عندهم.
 */
const ADMIN_EMAILS = parseAdminEmails(process.env.ADMIN_EMAILS);

export const WRITE_DENIED_MESSAGE =
  "«التعديل والحفظ» في هذه الصفحة معطّل بالصلاحيات. راجع الأدمن إن احتجت إجراءها.";

type AccessRow = { subject_kind: string; key: string; allowed: boolean };

export interface AccessContext {
  session: SessionUser | null;
  isSystemAdmin: boolean;
  hidden: ReadonlySet<string>;
  /** false ⇒ تعذّرت القراءة؛ يُمنع الوصول المسجّل لغير الأدمن مؤقتًا. */
  storeHealthy: boolean;
  /** true إن كان هذا المفتاح (صفحة أو عنصر) مسموحًا. */
  isAllowed(key: string): boolean;
}

async function buildAccessContext(): Promise<AccessContext> {
  const session = await getSession();
  if (!session) {
    return {
      session: null,
      isSystemAdmin: false,
      hidden: new Set(),
      storeHealthy: false,
      isAllowed: () => false,
    };
  }
  const admin = isSystemAdmin(session.role, session.email, ADMIN_EMAILS);

  let hidden: Set<string> = new Set();
  let storeHealthy = true;
  try {
    const userId = String(session.id);
    const rows = await prisma.$queryRaw<AccessRow[]>`
      SELECT subject_kind, key, allowed
      FROM public.access_control
      WHERE (subject_kind = 'role' AND subject = ${session.role})
         OR (subject_kind = 'user' AND subject = ${userId})`;
    const roleRows = new Map<string, boolean>();
    const userRows = new Map<string, boolean>();
    for (const row of rows) {
      if (row.subject_kind === "role") roleRows.set(row.key, row.allowed);
      else userRows.set(row.key, row.allowed);
    }
    hidden = resolveHiddenKeys(roleRows, userRows);
  } catch (error) {
    storeHealthy = false;
    const code =
      typeof error === "object" && error !== null && "code" in error && typeof (error as { code?: unknown }).code === "string"
        ? (error as { code: string }).code
        : "unknown";
    console.error("access_control lookup failed (fail-closed for non-admin):", code);
    if (!admin) hidden = hiddenOnAccessStoreFailure();
  }
  if (admin) hidden = new Set();

  const isAllowed = (key: string): boolean => {
    if (admin) return true;
    return accessKeyAllowed(hidden, key);
  };

  return { session, isSystemAdmin: admin, hidden, storeHealthy, isAllowed };
}

export const getAccessContext = cache(buildAccessContext);

/** حارس الصفحات: لا صفحة مخفية تُفتح من الرابط (التحويل للوحة القيادة). */
export async function requirePageAccess(route: string): Promise<void> {
  const ctx = await getAccessContext();
  if (!ctx.session) redirect("/login");
  const key = canonicalPageForRoute(route);
  if (!key || !ctx.isAllowed(key)) redirect("/dashboard");
}

/** مناطق النظام المغلقة للأدمن وحده (/admin و/setup). */
export async function requireSystemAdminOrRedirect(): Promise<void> {
  const ctx = await getAccessContext();
  if (!ctx.session) redirect("/login");
  if (!ctx.isSystemAdmin) redirect("/dashboard");
}

/** فحص الكتابة: true افتراضيًا؛ false فقط بصف صريح داخل قاعدة البيانات. */
export async function writeAccessAllowed(key: string): Promise<boolean> {
  // Misconfigured action keys are denied even for admin/store failure; this does
  // not change how unknown *stored* rules from old versions are ignored.
  if (!KNOWN_ACCESS_KEYS.has(key)) return false;
  const ctx = await getAccessContext();
  if (!ctx.session) return false;
  if (ctx.isSystemAdmin) return true;
  if (!ctx.storeHealthy) return false;
  return writeAllowedForKeys(ctx.hidden, key);
}

/** حماية API مرتبطة بالصفحة وكتابتها عند الحاجة؛ لا تعتمد على الحارس الموجود في المستدعي. */
export async function apiAccessDenial(route: string, options?: { write?: boolean }): Promise<NextResponse | null> {
  const ctx = await getAccessContext();
  const headers = { "Cache-Control": "private, no-store" };
  if (!ctx.session || ctx.session.mustChangePassword) {
    return NextResponse.json({ message: "سجّل الدخول أولًا." }, { status: 401, headers });
  }
  const key = canonicalPageForRoute(route);
  if (!key || !ctx.isAllowed(key) || (options?.write && !(await writeAccessAllowed(key)))) {
    return NextResponse.json({ message: "لا تملك صلاحية الوصول لهذه العملية." }, { status: 403, headers });
  }
  return null;
}

/** للوحة الإدارة: هل جدول access_control سليم وقابل للقراءة الآن؟ */
export async function accessControlStoreHealthy(): Promise<boolean> {
  const ctx = await getAccessContext();
  return ctx.storeHealthy;
}
