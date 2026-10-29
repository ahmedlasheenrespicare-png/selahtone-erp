import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { authIdentifierHash } from "../src/lib/auth-identifiers";
import { isValidAuthSecret } from "../src/lib/auth-secret";
import { emailSchema, newPasswordSchema } from "../src/lib/auth-validation";

const prisma = new PrismaClient();

async function main() {
  const email = emailSchema.safeParse(process.argv[2]);
  const password = newPasswordSchema.safeParse(process.env.TEMP_PASSWORD);
  const secret = process.env.AUTH_SECRET;
  if (!email.success) throw new Error("مرّر بريد المستخدم الصحيح بعد الأمر.");
  if (!password.success) throw new Error("اضبط TEMP_PASSWORD بكلمة مؤقتة من 12 حرفًا على الأقل ولا تزيد على 72 بايت.");
  if (!isValidAuthSecret(secret)) throw new Error("اضبط AUTH_SECRET العشوائي بالقيمة المستخدمة في التطبيق.");

  const user = await prisma.user.findUnique({ where: { email: email.data }, select: { id: true } });
  if (!user) throw new Error("المستخدم غير موجود.");
  const passwordHash = await bcrypt.hash(password.data, 12);
  const keys = ["login", "password-change"].map((purpose) => authIdentifierHash(email.data, `throttle:${purpose}`, secret));
  const auditHash = authIdentifierHash(email.data, "audit", secret);

  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: true } }),
    prisma.authSession.deleteMany({ where: { userId: user.id } }),
    prisma.loginThrottle.deleteMany({ where: { key: { in: keys } } }),
    prisma.loginAttempt.create({ data: { identifierHash: auditHash, userId: user.id, result: "PASSWORD_RESET" } }),
  ]);
  console.log("✓ أُعيد تعيين كلمة المرور وأُلغيت الجلسات. يجب تغيير الكلمة المؤقتة عند الدخول التالي.");
}

main().catch((error) => {
  console.error("✗ فشل إعادة التعيين:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
