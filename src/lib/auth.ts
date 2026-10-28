import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";

const COOKIE_NAME = "selahtone_session";
const SESSION_DAYS = 7;

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: "MANAGER" | "ACCOUNTANT" | "CS_AGENT";
  branchId: string | null;
  branchName: string | null;
};

function secret(): Uint8Array {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) {
    throw new Error("AUTH_SECRET غير مضبوط — راجع متغيرات البيئة (يجب أن يكون 32 حرفًا على الأقل)");
  }
  return new TextEncoder().encode(value);
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function createSession(user: SessionUser): Promise<void> {
  const token = await new SignJWT({ ...user })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret());

  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export async function getSession(): Promise<SessionUser | null> {
  try {
    const store = await cookies();
    const token = store.get(COOKIE_NAME)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, secret());
    return {
      id: String(payload.id),
      name: String(payload.name),
      email: String(payload.email),
      role: payload.role as SessionUser["role"],
      branchId: payload.branchId ? String(payload.branchId) : null,
      branchName: payload.branchName ? String(payload.branchName) : null,
    };
  } catch {
    return null;
  }
}

export async function requireSession(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

/** نطاق الفروع: المدير والمحاسب يرون كل الفروع، الكاونتر فرعه فقط */
export function branchScope(session: SessionUser): { branchId?: string } {
  if (session.role === "CS_AGENT") {
    if (!session.branchId) throw new Error("مستخدم الكاونتر بلا فرع — راجع بيانات المستخدم");
    return { branchId: session.branchId };
  }
  return {};
}

export function canSeeAllBranches(session: SessionUser): boolean {
  return session.role === "MANAGER" || session.role === "ACCOUNTANT";
}

/** المصادقة الفعلية: بريد + كلمة مرور → جلسة */
export async function login(
  email: string,
  password: string,
): Promise<{ ok: true; user: SessionUser } | { ok: false; error: string }> {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
    include: { branch: true },
  });

  if (!user || user.status !== "ACTIVE") {
    // نفس الرسالة دائمًا — لا نكشف إن كان البريد موجودًا
    return { ok: false, error: "بيانات الدخول غير صحيحة" };
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) return { ok: false, error: "بيانات الدخول غير صحيحة" };

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const sessionUser: SessionUser = {
    id: user.id.toString(),
    name: user.fullName,
    email: user.email,
    role: user.roleCode,
    branchId: user.branchId?.toString() ?? null,
    branchName: user.branch?.nameAr ?? null,
  };

  await createSession(sessionUser);
  return { ok: true, user: sessionUser };
}
