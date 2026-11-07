import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SignJWT } from "jose";
import { demoFindUserByEmail } from "@/lib/demo-db";

const SESSION_COOKIE = "selahtone_session";
const STANDARD_SESSION_SECONDS = 8 * 60 * 60;

function secret(): Uint8Array {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET not set");
  return new TextEncoder().encode(value);
}

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();
    
    const user = demoFindUserByEmail(email);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 401 });
    }
    
    // في الوضع التجريبي، نتحقق من كلمة المرور
    const bcrypt = (await import("bcryptjs")).default;
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }
    
    // إنشاء الجلسة
    const sessionId = Math.random().toString(36).substring(2);
    const expiresAt = new Date(Date.now() + STANDARD_SESSION_SECONDS * 1000);
    
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(user.id)
      .setJti(sessionId)
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(secret());
    
    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: STANDARD_SESSION_SECONDS,
    });
    
    return NextResponse.json({ success: true, user: { id: user.id, email: user.email, fullName: user.fullName } });
  } catch (error) {
    console.error("Demo login error:", error);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
