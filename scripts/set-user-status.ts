import "dotenv/config";
import { PrismaClient, UserStatus } from "@prisma/client";
import { emailSchema } from "../src/lib/auth-validation";

const prisma = new PrismaClient();

async function main() {
  const email = emailSchema.safeParse(process.argv[2]);
  const status = process.argv[3];
  if (!email.success || (status !== "ACTIVE" && status !== "SUSPENDED")) {
    throw new Error("الاستخدام: npm run user:status -- user@example.com ACTIVE|SUSPENDED");
  }
  const user = await prisma.user.findUnique({ where: { email: email.data }, select: { id: true } });
  if (!user) throw new Error("المستخدم غير موجود.");
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { status: status as UserStatus } }),
    prisma.authSession.deleteMany({ where: { userId: user.id } }),
  ]);
  console.log(`✓ حالة المستخدم الآن ${status}، وأُلغيت جميع جلساته.`);
}

main().catch((error) => {
  console.error("✗ فشل تغيير الحالة:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
