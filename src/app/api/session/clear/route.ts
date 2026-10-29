import { NextResponse } from "next/server";
import { getSession, SESSION_COOKIE } from "@/lib/auth";
import { safeNextPath } from "@/lib/auth-validation";

// لا يُمسح الكوكي إلا بعد التحقق من عدم وجود جلسة صالحة له.
export async function GET(request: Request) {
  const next = safeNextPath(new URL(request.url).searchParams.get("next"));
  const session = await getSession();
  if (session) {
    const destination = session.mustChangePassword ? `/change-password?next=${encodeURIComponent(next)}` : next;
    return new NextResponse(null, { status: 307, headers: { Location: destination, "Cache-Control": "no-store" } });
  }
  const response = new NextResponse(null, {
    status: 307,
    headers: { Location: `/login?next=${encodeURIComponent(next)}`, "Cache-Control": "no-store" },
  });
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0,
  });
  return response;
}
