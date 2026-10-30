import "server-only";

import { redirect } from "next/navigation";

import { getSession } from "./auth";
import { isPathAllowedForScope } from "./menu-scope";

/**
 * حارس الصفحة للحسابات ذات النطاق المختصر: يُستدعى في أعلى كل شاشة خارج نطاقها،
 * فيُحوَّل الحساب إلى لوحة القيادة بدل عرضها. الحارس داخل الصفحة نفسها لا في
 * الوسيط (middleware)، حتى يبقى صحيحًا مهام اختلفت بيئة النشر.
 *
 * ملاحظة: الصفحات الجديدة تحتاج سطر حارس واحد؛ نطاق الاختبار يوثّق القائمة.
 */
export async function requireMenuScopeAccess(route: string): Promise<void> {
  const session = await getSession();
  // غياب الجلسة تُعالجه بوابة الصفحة نفسها (تسجيل الدخول أو تغيير كلمة المرور).
  if (!session) return;
  if (!isPathAllowedForScope(session.menuScope, route)) redirect("/dashboard");
}
