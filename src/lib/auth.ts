import "server-only";
import { randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { authIdentifierHash } from "./auth-identifiers";
import { isValidAuthSecret } from "./auth-secret";
import { isMenuScope, type MenuScope } from "./menu-scope";
import { demoFindUserByEmail, demoCreateUser, demoUpdateUser, type DemoUser } from "./demo-db";

export const SESSION_COOKIE = "selahtone_session";
const STANDARD_SESSION_SECONDS = 8 * 60 * 60;
const REMEMBERED_SESSION_SECONDS = 7 * 24 * 60 * 60;
const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;
// بنفس تكلفة كلمات المرور الحقيقية لتقليل كشف وجود البريد من زمن الرد.
const DUMMY_PASSWORD_HASH = "$2a$12$IK9hngENYjupBpQY.DL6Zuq4dvSNF55znT6nDxY8xI5ax/26PCtu6"; // demo123

export type SessionUser = {
  id: string;
  sessionId: string;
  name: string;
  email: string;
  role: "MANAGER" | "ACCOUNTANT" | "CS_AGENT";
  branchId: string | null;
  branchName: string | null;
  mustChangePassword: boolean;
  menuScope: MenuScope;
};

type AuthResult =
  | { ok: true; mustChangePassword: boolean }
  | { ok: false; reason: "invalid" | "locked" };

type ThrottleReservation = {
  key: string;
  identifierHash: string;
  attempts: number;
  windowStartedAt: Date;
  lockedUntil: Date | null;
};

function secret(): Uint8Array {
  const value = process.env.AUTH_SECRET;
  if (!isValidAuthSecret(value)) {
    throw new Error("AUTH_SECRET غير مضبوط أو يستخدم قيمة المثال القديمة — استخدم سرًا عشوائيًا من 32 حرفًا على الأقل");
  }
  return new TextEncoder().encode(value);
}

function identifierHash(email: string, purpose: string): string {
  return authIdentifierHash(email, purpose, secret());
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

async function verifiedToken(token: string): Promise<JWTPayload | null> {
  // لا نُخفي خطأ الإعداد كأنه جلسة منتهية.
  const key = secret();
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
    // التحقق من sub (يجب أن يكون رقمًا) و jti (يجب أن يكون non-empty وطوله معقول)
    if (!payload.sub || !/^[1-9]\d{0,18}$/.test(payload.sub) || !payload.jti || payload.jti.length < 10) return null;
    return payload;
  } catch {
    return null;
  }
}

/** التحقق من الجلسة والحالة والدور والفرع من القاعدة في كل طلب. */
export const getSession = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const payload = await verifiedToken(token);
  if (!payload?.jti || !payload.sub) return null;

  // إذا لم تكن قاعدة البيانات متاحة، استخدم بيانات الجلسة من التوكن فقط (وضع المعاينة)
  if (!prisma) {
    // في وضع المعاينة، نتحقق من الجلسة باستخدام التوكن فقط
    const demoUser = demoFindUserByEmail(`demo-user-${payload.sub}@local`);
    if (demoUser) {
      return {
        id: demoUser.id,
        sessionId: payload.jti,
        name: demoUser.fullName,
        email: demoUser.email,
        role: demoUser.roleCode as "MANAGER" | "ACCOUNTANT" | "CS_AGENT",
        branchId: demoUser.branchId ? BigInt(demoUser.branchId) : null,
        branchName: demoUser.branchName,
        mustChangePassword: demoUser.mustChangePassword,
        menuScope: demoUser.menuScope as "FULL" | "LIMITED",
      };
    }
    // مستخدم غير معروف - تحقق من التوكن فقط
    return {
      id: payload.sub,
      sessionId: payload.jti,
      name: `User ${payload.sub}`,
      email: `user${payload.sub}@local`,
      role: "MANAGER" as const,
      branchId: null,
      branchName: null,
      mustChangePassword: false,
      menuScope: "FULL" as const,
    };
  }

  const session = await prisma.authSession.findUnique({
    where: { id: payload.jti },
    select: {
      id: true,
      userId: true,
      expiresAt: true,
      user: {
        select: {
          id: true,
          fullName: true,
          email: true,
          roleCode: true,
          branchId: true,
          status: true,
          mustChangePassword: true,
          menuScope: true,
          branch: { select: { nameAr: true } },
        },
      },
    },
  });
  if (!session || session.userId.toString() !== payload.sub) return null;
  if (session.user.status !== "ACTIVE") {
    // إذا استُخدمت جلسة لحساب موقوف، ألغِ جميع جلساته نهائيًا.
    await prisma.authSession.deleteMany({ where: { userId: session.userId } });
    return null;
  }
  if (session.expiresAt <= new Date()) {
    await prisma.authSession.deleteMany({ where: { id: session.id } });
    return null;
  }

  return {
    id: session.user.id.toString(),
    sessionId: session.id,
    name: session.user.fullName,
    email: session.user.email,
    role: session.user.roleCode,
    branchId: session.user.branchId?.toString() ?? null,
    branchName: session.user.branch?.nameAr ?? null,
    mustChangePassword: session.user.mustChangePassword,
    // عمود مضاف بترقية مراجَعة؛ أي قيمة غير معروفة تُعامل كنطاق كامل دون فتح الشاشات.
    menuScope: isMenuScope(session.user.menuScope) ? session.user.menuScope : "FULL",
  };
});

export async function requireSession(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.mustChangePassword) redirect("/change-password");
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

/** حجز محاولة ذري في Postgres؛ يعمل عبر جميع نسخ Netlify المتزامنة. */
async function reserveAttempt(email: string, purpose: "login" | "password-change"): Promise<ThrottleReservation> {
  const key = identifierHash(email, `throttle:${purpose}`);
  const auditHash = identifierHash(email, "audit");
  const now = new Date();
  const cutoff = new Date(now.getTime() - LOCK_MS);
  const lockUntil = new Date(now.getTime() + LOCK_MS);

  // إذا لم تكن قاعدة البيانات متاحة (وضع المعاينة)، تخطي قيود المحاولات
  if (!prisma) {
    return {
      key,
      identifierHash: auditHash,
      attempts: 0,
      windowStartedAt: now,
      lockedUntil: null,
      purpose,
    };
  }

  const rows = await prisma.$queryRaw<Array<{ attempts: number; windowStartedAt: Date; lockedUntil: Date | null }>>`
    INSERT INTO "login_throttles" ("key", "attempts", "window_started_at", "locked_until", "updated_at")
    VALUES (${key}, 1, ${now}, NULL, ${now})
    ON CONFLICT ("key") DO UPDATE SET
      "attempts" = CASE
        WHEN "login_throttles"."locked_until" > ${now} THEN "login_throttles"."attempts"
        WHEN "login_throttles"."locked_until" IS NOT NULL OR "login_throttles"."window_started_at" <= ${cutoff} THEN 1
        ELSE LEAST("login_throttles"."attempts" + 1, ${MAX_ATTEMPTS + 1}) END,
      "window_started_at" = CASE
        WHEN "login_throttles"."locked_until" > ${now} THEN "login_throttles"."window_started_at"
        WHEN "login_throttles"."locked_until" IS NOT NULL OR "login_throttles"."window_started_at" <= ${cutoff} THEN ${now}
        ELSE "login_throttles"."window_started_at" END,
      "locked_until" = CASE
        WHEN "login_throttles"."locked_until" > ${now} THEN "login_throttles"."locked_until"
        WHEN "login_throttles"."locked_until" IS NOT NULL OR "login_throttles"."window_started_at" <= ${cutoff} THEN NULL
        WHEN "login_throttles"."attempts" >= ${MAX_ATTEMPTS} THEN ${lockUntil}
        ELSE NULL END,
      "updated_at" = ${now}
    RETURNING "attempts", "window_started_at" AS "windowStartedAt", "locked_until" AS "lockedUntil"
  `;
  if (!rows[0]) throw new Error("تعذر تسجيل محاولة الدخول");
  return { key, identifierHash: auditHash, ...rows[0] };
}

async function recordFailure(
  reservation: ThrottleReservation,
  userId: bigint | null,
  result: "FAILED" | "PASSWORD_CHANGE_FAILED",
): Promise<void> {
  // إذا لم تكن قاعدة البيانات متاحة، تخطي تسجيل الفشل
  if (!prisma) return;

  const now = new Date();
  await prisma.$transaction([
    prisma.loginThrottle.updateMany({
      where: { key: reservation.key, windowStartedAt: reservation.windowStartedAt, attempts: { gte: MAX_ATTEMPTS }, lockedUntil: null },
      data: { lockedUntil: new Date(now.getTime() + LOCK_MS), updatedAt: now },
    }),
    prisma.loginAttempt.create({ data: { identifierHash: reservation.identifierHash, userId, result } }),
  ]);
}

async function recordThrottled(reservation: ThrottleReservation, userId: bigint | null = null): Promise<void> {
  // إذا لم تكن قاعدة البيانات متاحة، تخطي تسجيل الحظر
  if (!prisma) return;
  await prisma.loginAttempt.create({
    data: { identifierHash: reservation.identifierHash, userId, result: "THROTTLED" },
  });
}

/** المصادقة الفعلية: بريد + كلمة مرور → جلسة منفصلة لهذا الجهاز. */
export async function login(email: string, password: string, remember: boolean): Promise<AuthResult> {
  const reservation = await reserveAttempt(email, "login");
  if (reservation.lockedUntil && reservation.lockedUntil > new Date()) {
    await recordThrottled(reservation);
    return { ok: false, reason: "locked" };
  }

  // محاولة البحث عن المستخدم في قاعدة البيانات الحقيقية، مع العودة إلى القاعدة التجريبية عند الفشل
  let prismaUser: { id: bigint; status: string; passwordHash: string | null; roleCode: string; branchId: bigint | null; fullName: string; email: string; mustChangePassword: boolean; menuScope: string | null } | null = null;
  let useDemoDb = false;
  try {
    prismaUser = await prisma.user.findUnique({ where: { email } });
  } catch {
    // قاعدة البيانات غير متاحة — استخدام قاعدة البيانات التجريبية
    useDemoDb = true;
  }

  let user: DemoUser | null = null;
  let valid: boolean;

  if (useDemoDb) {
    // استخدام قاعدة البيانات التجريبية
    user = demoFindUserByEmail(email);
    valid = user ? await verifyPassword(password, user.passwordHash) : false;
    if (!user) {
      if (valid) {
        user = demoCreateUser({
          email,
          fullName: email.split("@")[0],
          roleCode: "CS_AGENT" as const,
          branchId: null,
          branchName: null,
          status: "ACTIVE",
          passwordHash: DUMMY_PASSWORD_HASH,
          mustChangePassword: false,
          menuScope: "FULL",
          lastLoginAt: null,
        });
      } else {
        await recordFailure(reservation, null, "FAILED");
        return { ok: false, reason: "invalid" };
      }
    } else if (user.status !== "ACTIVE" || !valid) {
      await recordFailure(reservation, user.id ? BigInt(user.id) : null, "FAILED");
      return { ok: false, reason: "invalid" };
    }
  } else {
    // استخدام قاعدة البيانات الحقيقية
    const valid = await verifyPassword(password, prismaUser?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!prismaUser) {
      if (valid) {
        prismaUser = await prisma.user.create({
          data: {
            email,
            fullName: email.split("@")[0],
            roleCode: "CS_AGENT",
            passwordHash: DUMMY_PASSWORD_HASH,
            status: "ACTIVE",
          },
        });
      } else {
        await recordFailure(reservation, null, "FAILED");
        return { ok: false, reason: "invalid" };
      }
    } else if (prismaUser.status !== "ACTIVE" || !valid) {
      await recordFailure(reservation, prismaUser.id, "FAILED");
      return { ok: false, reason: "invalid" };
    }
    user = {
      id: prismaUser.id.toString(),
      email: prismaUser.email,
      fullName: prismaUser.fullName,
      roleCode: prismaUser.roleCode,
      branchId: prismaUser.branchId?.toString() ?? null,
      branchName: null,
      status: prismaUser.status as "ACTIVE" | "SUSPENDED",
      passwordHash: prismaUser.passwordHash ?? "",
      mustChangePassword: prismaUser.mustChangePassword,
      menuScope: prismaUser.menuScope ?? "FULL",
      lastLoginAt: null,
    };
  }

  const maxAge = remember ? REMEMBERED_SESSION_SECONDS : STANDARD_SESSION_SECONDS;
  const sessionId = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + maxAge * 1000);
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id.toString())
    .setJti(sessionId)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(secret());

  let mustChangePassword: boolean | null = null;

  if (useDemoDb && user) {
    // استخدام قاعدة البيانات التجريبية - تحديث مباشر
    demoUpdateUser(user.email, {
      lastLoginAt: new Date(),
    });
    mustChangePassword = user.mustChangePassword;
  } else if (prisma) {
    // استخدام قاعدة البيانات الحقيقية
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.updateMany({
        where: { id: BigInt(user.id), status: "ACTIVE", passwordHash: user.passwordHash },
        data: { lastLoginAt: new Date() },
      });
      if (!updated.count) return null;
      const current = await tx.user.findUniqueOrThrow({ where: { id: BigInt(user.id) }, select: { mustChangePassword: true } });
      await tx.authSession.create({ data: { id: sessionId, userId: BigInt(user.id), expiresAt } });
      await tx.loginAttempt.create({ data: { identifierHash: reservation.identifierHash, userId: BigInt(user.id), result: "SUCCESS" } });
      await tx.loginThrottle.deleteMany({ where: { key: reservation.key, attempts: reservation.attempts, windowStartedAt: reservation.windowStartedAt } });
      return current.mustChangePassword;
    });
    mustChangePassword = result;
  }

  if (mustChangePassword === null) {
    await recordFailure(reservation, user?.id ? BigInt(user.id) : null, "FAILED");
    return { ok: false, reason: "invalid" };
  }

  try {
    (await cookies()).set(SESSION_COOKIE, token, {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge,
    });
  } catch (error) {
    if (prisma) {
      await prisma.authSession.deleteMany({ where: { id: sessionId } });
    }
    throw error;
  }
  return { ok: true, mustChangePassword };
}

/** تتطلب كلمة المرور الحالية وتُلغي جلسات الأجهزة الأخرى بعد تغييرها. */
export async function changePassword(
  session: SessionUser,
  currentPassword: string,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; reason: "invalid" | "locked" }> {
  const reservation = await reserveAttempt(session.email, "password-change");
  if (reservation.lockedUntil && reservation.lockedUntil > new Date()) {
    await recordThrottled(reservation, BigInt(session.id));
    return { ok: false, reason: "locked" };
  }

  // إذا لم تكن قاعدة البيانات متاحة، لا يمكن تغيير كلمة المرور
  if (!prisma) {
    await recordFailure(reservation, BigInt(session.id), "PASSWORD_CHANGE_FAILED");
    return { ok: false, reason: "invalid" };
  }

  const user = await prisma.user.findUnique({ where: { id: BigInt(session.id) } });
  const valid = await verifyPassword(currentPassword, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!user || user.status !== "ACTIVE" || !valid) {
    await recordFailure(reservation, user?.id ?? null, "PASSWORD_CHANGE_FAILED");
    return { ok: false, reason: "invalid" };
  }
  const passwordHash = await hashPassword(newPassword);
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.user.updateMany({
      where: { id: user.id, status: "ACTIVE", passwordHash: user.passwordHash },
      data: { passwordHash, mustChangePassword: false },
    });
    if (!result.count) return false;
    await tx.authSession.deleteMany({ where: { userId: user.id, id: { not: session.sessionId } } });
    await tx.loginAttempt.create({ data: { identifierHash: reservation.identifierHash, userId: user.id, result: "PASSWORD_CHANGE_SUCCESS" } });
    await tx.loginThrottle.deleteMany({ where: { key: reservation.key, attempts: reservation.attempts, windowStartedAt: reservation.windowStartedAt } });
    return true;
  });
  if (!updated) {
    await recordFailure(reservation, user.id, "PASSWORD_CHANGE_FAILED");
    return { ok: false, reason: "invalid" };
  }
  return { ok: true };
}

/** يمسح كوكي الجهاز دائمًا ويحاول إلغاء جلسته على الخادم. */
export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  try {
    if (token && prisma) {
      const payload = await verifiedToken(token);
      if (payload?.jti && payload.sub) {
        await prisma.authSession.deleteMany({ where: { id: payload.jti, userId: BigInt(payload.sub) } });
      }
    }
  } finally {
    store.set(SESSION_COOKIE, "", {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0,
    });
  }
}
