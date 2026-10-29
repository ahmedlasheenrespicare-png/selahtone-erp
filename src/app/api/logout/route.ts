import { NextResponse } from "next/server";
import { destroySession, SESSION_COOKIE } from "@/lib/auth";
import { requestHost } from "@/lib/request-host";

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = requestHost(request.headers, process.env.NODE_ENV, process.env.SERVER_ACTION_ALLOWED_ORIGINS);
  if (!origin || !host) return false;
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    return url.origin === origin && url.host === new URL(`${url.protocol}//${host}`).host;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });
  let failed = false;
  try {
    await destroySession();
  } catch (error) {
    failed = true;
    console.error("Session revocation failed:", error);
  }
  // مسار نسبي حتى يعود المتصفح إلى نطاقه العام، لا عنوان الخادم الداخلي خلف الوكيل.
  const location = failed ? "/login?notice=logout_unconfirmed" : "/login";
  const response = new NextResponse(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store" } });
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0,
  });
  return response;
}
