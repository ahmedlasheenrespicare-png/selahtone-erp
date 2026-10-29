import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const now = new Date();
  const auditCutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const throttleCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [sessions, attempts, throttles] = await prisma.$transaction([
    prisma.authSession.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.loginAttempt.deleteMany({ where: { createdAt: { lt: auditCutoff } } }),
    prisma.loginThrottle.deleteMany({ where: { updatedAt: { lt: throttleCutoff }, OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] } }),
  ]);
  console.log(`✓ حُذفت ${sessions.count} جلسة منتهية و${attempts.count} محاولة أقدم من 90 يومًا و${throttles.count} عدّاد قديم.`);
}

main().catch((error) => {
  console.error("✗ فشلت صيانة سجلات الدخول:", error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
