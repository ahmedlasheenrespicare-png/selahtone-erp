import { jwtVerify } from "jose";
import { NextResponse, type NextRequest } from "next/server";
import { isValidAuthSecret } from "@/lib/auth-secret";
import { requestHost } from "@/lib/request-host";

const COOKIE_NAME = "selahtone_session";
/**
 * المسارات التي تمرّ بلا جلسة.
 *
 * ملفات تثبيت التطبيق (PWA) يجب أن تكون هنا: فالمتصفح يطلب manifest
 * و service worker والأيقونات بلا كوكي جلسة، وكانت تُعاد إلى /login
 * (٣٠٧) فيفشل تثبيت التطبيق على الجوال بلا أي رسالة خطأ ظاهرة.
 */
const PUBLIC_PATHS = [
  "/login",
  "/api/health",
  "/api/logout",
  "/api/session/clear",
  "/api/login-demo",
  "/icon.svg",
  "/manifest.webmanifest",
  "/sw.js",
  "/icons",
  "/.well-known", // ربط النطاق بتطبيق أندرويد (assetlinks.json) — يُطلب بلا جلسة
];

/** التحقق السريع عند الحافة؛ حالة الحساب والجلسة تُراجع أيضًا في الخادم وقاعدة البيانات. */
export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return NextResponse.next();
  }

  const cookieValue = request.cookies.get(COOKIE_NAME);
  console.log('[Middleware] pathname:', pathname, 'cookie:', cookieValue?.name || 'none');
  const token = cookieValue?.value;
  const authSecret = process.env.AUTH_SECRET;
  let valid = false;
  if (token && isValidAuthSecret(authSecret)) {
    try {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(authSecret), { algorithms: ["HS256"] });
      console.log('[Middleware] token verified, payload:', payload, 'sub:', payload?.sub, 'jti:', payload?.jti);
      // التحقق من sub (يجب أن يكون رقمًا) و jti (يجب أن يكون non-empty)
      valid = Boolean(
        payload.sub && /^[1-9]\d{0,18}$/.test(payload.sub) &&
        payload.jti && payload.jti.length >= 10
      );
      console.log('[Middleware] valid:', valid);
    } catch (error) {
      console.log('[Middleware] token verification failed:', error.message);
      valid = false;
    }
  } else {
    console.log('[Middleware] token missing or invalid secret');
  }
  if (valid) return NextResponse.next();

  const query = new URLSearchParams({ next: `${pathname}${search}` });
  // Middleware في Next.js يتطلب URL مطلقًا. نستخدم نطاق الطلب العام خلف الوكيل،
  // وليس عنوان الاستماع الداخلي (مثل 0.0.0.0).
  const host = requestHost(request.headers, process.env.NODE_ENV, process.env.SERVER_ACTION_ALLOWED_ORIGINS);
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0].trim().toLowerCase();
  const protocol = forwardedProtocol === "https" || forwardedProtocol === "http" ? forwardedProtocol : request.nextUrl.protocol.replace(":", "");
  let origin = request.nextUrl.origin;
  if (host) {
    try { origin = new URL(`${protocol}://${host}`).origin; } catch { /* use Next's origin */ }
  }
  const response = NextResponse.redirect(new URL(`/login?${query.toString()}`, origin));
  response.headers.set("Cache-Control", "private, no-store");
  if (token) response.cookies.set(COOKIE_NAME, "", { path: "/", maxAge: 0, httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
